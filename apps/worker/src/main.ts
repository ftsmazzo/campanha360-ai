import { DelayedError, Worker } from 'bullmq';
import {
  DISPATCH_SEND_QUEUE_NAME,
  isDispatchEngineEnabled,
  isDispatchQueueEnabled,
  isDispatchSendEnabled,
  sendEvolutionText,
} from '@campanha360/shared';
import { createRedisConnection } from './redis';
import { prisma } from './prisma';
import {
  processDispatchSendJob,
  type DispatchSendProcessResult,
} from './dispatch-send.processor';

async function bootstrap(): Promise<void> {
  console.log('Campanha360 worker iniciando...');

  if (!isDispatchEngineEnabled() || !isDispatchQueueEnabled()) {
    console.log(
      '[worker] DISPATCH_ENGINE_ENABLED/DISPATCH_QUEUE_ENABLED desabilitados; worker tecnico permanece ocioso (nao consome a fila dispatch-send).',
    );
    return;
  }

  const connection = createRedisConnection();

  const worker = new Worker(
    DISPATCH_SEND_QUEUE_NAME,
    async (job, token) => {
      const result = await processDispatchSendJob(job, {
        prisma,
        // Injetado explicitamente (em vez do default interno do processor)
        // para deixar claro o ponto unico de integracao com a Evolution.
        // NAO logar apiKey/telefone/conteudo — sendEvolutionText ja garante isso.
        sendText: sendEvolutionText,
        evolutionBaseUrl: process.env.EVOLUTION_API_URL,
        evolutionApiKey: process.env.EVOLUTION_API_KEY,
      });

      // Padrao oficial BullMQ: moveToDelayed + DelayedError.
      // Sem o throw, o Worker tenta moveToFinished com o lock ja consumido
      // ("Missing lock for job ... moveToFinished / moveToDelayed").
      if (result.delayUntil) {
        await job.moveToDelayed(result.delayUntil.getTime(), token);
        throw new DelayedError();
      }

      return result;
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('ready', () => {
    const mode = isDispatchSendEnabled() ? 'envio real 09.4' : 'modo tecnico 09.3, sem envio';
    console.log(`[worker] pronto para consumir a fila "${DISPATCH_SEND_QUEUE_NAME}" (${mode})`);
  });

  worker.on('completed', (job, result: DispatchSendProcessResult) => {
    console.log(
      `[worker] job concluido id=${job.id} action=${result?.action ?? 'desconhecida'}`,
    );
  });

  worker.on('failed', (job, error) => {
    if (error instanceof DelayedError) return;
    console.error(`[worker] job falhou id=${job?.id ?? 'desconhecido'} erro=${error.message}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] sinal ${signal} recebido, encerrando graciosamente...`);
    try {
      await worker.close();
    } finally {
      await Promise.allSettled([prisma.$disconnect(), connection.quit()]);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  console.error('[worker] falha fatal ao iniciar', error);
  process.exit(1);
});
