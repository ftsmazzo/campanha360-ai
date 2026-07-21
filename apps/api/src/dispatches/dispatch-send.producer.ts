import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { assertDispatchQueueAllowed } from '@campanha360/shared';
import {
  DISPATCH_SEND_JOB_OPTIONS,
  DISPATCH_SEND_QUEUE_NAME,
  assertDispatchSendJobPayload,
  buildDispatchSendJobId,
  type DispatchSendJobPayload,
} from './dispatch-queue.constants';

export type DispatchSendEnqueueInput = {
  dispatchId: string;
  dispatchItemId: string;
  organizationId: string;
  campaignId: string;
};

export type DispatchSendEnqueueResult = {
  status: 'enqueued' | 'duplicate';
  jobId: string;
};

/**
 * Producer NestJS responsavel por publicar jobs minimos (apenas
 * identificadores) na fila `dispatch-send` (BullMQ/Redis). Nao contem
 * logica de envio nem worker — apenas enfileiramento idempotente.
 *
 * Base da subetapa 09.3: o servico completo de orquestracao e o worker
 * de consumo serao implementados em etapas subsequentes.
 */
@Injectable()
export class DispatchSendProducer implements OnModuleDestroy {
  private readonly logger = new Logger(DispatchSendProducer.name);
  private connection: Redis | null = null;
  private queue: Queue<DispatchSendJobPayload> | null = null;

  constructor(private readonly config: ConfigService) {}

  private getQueue(): Queue<DispatchSendJobPayload> {
    if (this.queue) {
      return this.queue;
    }

    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      throw new ServiceUnavailableException(
        'REDIS_URL nao configurado: fila de disparo indisponivel',
      );
    }

    try {
      const connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
      });
      connection.on('error', (error: Error) => {
        this.logger.error(`Erro de conexao Redis (dispatch-send): ${error.message}`);
      });

      const queue = new Queue<DispatchSendJobPayload>(DISPATCH_SEND_QUEUE_NAME, {
        connection,
      });

      this.connection = connection;
      this.queue = queue;
      return queue;
    } catch (error) {
      throw new ServiceUnavailableException(
        `Falha ao conectar na fila de disparo: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Enfileira um item de disparo. Idempotente: se um job com o mesmo
   * jobId determinístico já existir (ainda não removido da fila),
   * retorna `{ status: 'duplicate' }` sem lançar erro nem duplicar.
   */
  async enqueueItem(
    payload: DispatchSendEnqueueInput,
  ): Promise<DispatchSendEnqueueResult> {
    assertDispatchQueueAllowed();
    const validPayload = assertDispatchSendJobPayload(payload);
    const jobId = buildDispatchSendJobId(
      validPayload.dispatchId,
      validPayload.dispatchItemId,
    );

    const queue = this.getQueue();

    const existing = await this.fetchJob(queue, jobId);
    if (existing) {
      return { status: 'duplicate', jobId };
    }

    try {
      await queue.add(DISPATCH_SEND_QUEUE_NAME, validPayload, {
        ...DISPATCH_SEND_JOB_OPTIONS,
        jobId,
      });
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(
        JSON.stringify({
          action: 'DISPATCH_SEND_ENQUEUE_FAILED',
          queueName: DISPATCH_SEND_QUEUE_NAME,
          jobId,
          dispatchId: validPayload.dispatchId,
          dispatchItemId: validPayload.dispatchItemId,
          organizationId: validPayload.organizationId,
          campaignId: validPayload.campaignId,
          reason: rawMessage,
        }),
      );

      if (/custom id cannot contain/i.test(rawMessage)) {
        throw new ServiceUnavailableException(
          `Falha ao publicar job na fila: jobId invalido para BullMQ (nao pode conter ":"). jobId=${jobId}`,
        );
      }

      throw new ServiceUnavailableException(
        `Falha ao publicar job na fila operacional de disparo. Verifique Redis e tente novamente. Detalhe tecnico: ${rawMessage}`,
      );
    }

    return { status: 'enqueued', jobId };
  }

  /** Enfileira vários itens em lotes sequenciais, preservando idempotência por item. */
  async enqueueMany(
    payloads: DispatchSendEnqueueInput[],
    options: { batchSize?: number } = {},
  ): Promise<DispatchSendEnqueueResult[]> {
    assertDispatchQueueAllowed();
    const batchSize = Math.max(1, options.batchSize ?? 100);
    const results: DispatchSendEnqueueResult[] = [];

    for (let start = 0; start < payloads.length; start += batchSize) {
      const batch = payloads.slice(start, start + batchSize);
      const batchResults = await Promise.all(
        batch.map((payload) => this.enqueueItem(payload)),
      );
      results.push(...batchResults);
    }

    return results;
  }

  async getJob(
    jobId: string,
  ): Promise<Job<DispatchSendJobPayload> | undefined> {
    const queue = this.getQueue();
    return this.fetchJob(queue, jobId);
  }

  private async fetchJob(
    queue: Queue<DispatchSendJobPayload>,
    jobId: string,
  ): Promise<Job<DispatchSendJobPayload> | undefined> {
    try {
      return await queue.getJob(jobId);
    } catch (error) {
      throw new ServiceUnavailableException(
        `Falha ao consultar fila de disparo: ${(error as Error).message}`,
      );
    }
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    if (this.connection) {
      await this.connection.quit();
      this.connection = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
