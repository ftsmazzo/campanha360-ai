import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvolutionApiException, toSafeEvolutionError } from './evolution.errors';

export type EvolutionHealthResult = {
  ok: boolean;
  message: string;
};

export type EvolutionInstanceSummary = {
  instanceName: string;
  status?: string;
};

export type EvolutionConnectionState = {
  instanceName: string;
  state: string;
};

export type EvolutionQrCodeResult = {
  instanceName: string;
  base64?: string;
  code?: string;
  pairingCode?: string;
};

export type EvolutionPrepareResult = {
  instanceName: string;
  created: boolean;
  state?: string;
};

type JsonRecord = Record<string, unknown>;

@Injectable()
export class EvolutionAdapter {
  private readonly logger = new Logger(EvolutionAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async checkHealth(): Promise<EvolutionHealthResult> {
    this.requireBaseUrl();

    try {
      await this.request('GET', '/instance/fetchInstances');
      return { ok: true, message: 'Evolution API alcancavel' };
    } catch (error) {
      this.logger.warn(`Evolution health check falhou: ${this.describeError(error)}`);
      return { ok: false, message: 'Evolution API indisponivel ou inacessivel' };
    }
  }

  async listInstances(): Promise<EvolutionInstanceSummary[]> {
    const payload = await this.request('GET', '/instance/fetchInstances');
    return this.normalizeInstanceList(payload);
  }

  async findInstance(instanceName: string): Promise<EvolutionInstanceSummary | null> {
    const instances = await this.listInstances();
    const normalized = instanceName.trim().toLowerCase();
    return (
      instances.find((item) => item.instanceName.trim().toLowerCase() === normalized) ?? null
    );
  }

  async createInstance(instanceName: string): Promise<EvolutionPrepareResult> {
    const payload = await this.request('POST', '/instance/create', {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    });

    return {
      instanceName,
      created: true,
      state: this.extractState(payload) ?? 'connecting',
    };
  }

  async getConnectionState(instanceName: string): Promise<EvolutionConnectionState> {
    const payload = await this.request(
      'GET',
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    );

    return {
      instanceName,
      state: this.extractState(payload) ?? 'unknown',
    };
  }

  async getQrCode(instanceName: string): Promise<EvolutionQrCodeResult> {
    const payload = await this.request(
      'GET',
      `/instance/connect/${encodeURIComponent(instanceName)}`,
    );

    const record = this.asRecord(payload) ?? {};
    const nested =
      this.asRecord(record.qrcode) ?? this.asRecord(record.instance) ?? record;

    const base64 =
      this.asString(nested.base64) ??
      this.asString(nested.qrcode) ??
      this.asString(record.base64);
    const code = this.asString(nested.code) ?? this.asString(record.code);
    const pairingCode =
      this.asString(nested.pairingCode) ?? this.asString(record.pairingCode);

    return {
      instanceName,
      base64: base64 || undefined,
      code: code || undefined,
      pairingCode: pairingCode || undefined,
    };
  }

  async prepareInstance(instanceName: string): Promise<EvolutionPrepareResult> {
    const existing = await this.findInstance(instanceName);
    if (existing) {
      let state = existing.status;
      try {
        const connection = await this.getConnectionState(instanceName);
        state = connection.state;
      } catch {
        // Mantem status da listagem se connectionState falhar.
      }

      return {
        instanceName: existing.instanceName,
        created: false,
        state,
      };
    }

    return this.createInstance(instanceName);
  }

  private requireBaseUrl() {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw new EvolutionApiException(
        'EVOLUTION_API_URL nao configurada',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return baseUrl;
  }

  private getBaseUrl() {
    return (this.config.get<string>('EVOLUTION_API_URL') || '').trim().replace(/\/+$/, '');
  }

  private getApiKey() {
    return (this.config.get<string>('EVOLUTION_API_KEY') || '').trim() || undefined;
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: JsonRecord,
  ): Promise<unknown> {
    const baseUrl = this.requireBaseUrl();
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    const apiKey = this.getApiKey();
    if (apiKey) {
      headers.apikey = apiKey;
    }

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const raw = await response.text();
      let data: unknown = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = null;
        }
      }

      if (!response.ok) {
        this.logger.warn(
          `Evolution ${method} ${path} retornou ${response.status}`,
        );
        throw new EvolutionApiException(
          this.messageFromEvolutionBody(data, response.status),
          response.status >= 500 ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_REQUEST,
        );
      }

      return data;
    } catch (error) {
      if (error instanceof EvolutionApiException) {
        throw error;
      }
      this.logger.warn(`Evolution ${method} ${path} falhou: ${this.describeError(error)}`);
      throw toSafeEvolutionError(error);
    }
  }

  private messageFromEvolutionBody(data: unknown, status: number) {
    const record = this.asRecord(data);
    const nestedResponse = this.asRecord(record?.response);
    const message =
      this.asString(record?.message) ??
      this.asString(record?.error) ??
      this.asString(nestedResponse?.message);

    if (message && !this.containsSensitiveToken(message)) {
      return `Evolution API: ${message}`;
    }

    if (status === 401 || status === 403) {
      return 'Evolution API recusou a autenticacao';
    }

    if (status === 404) {
      return 'Recurso nao encontrado na Evolution API';
    }

    return 'Evolution API retornou erro';
  }

  private containsSensitiveToken(value: string) {
    return /apikey|api[_-]?key|authorization|bearer|token/i.test(value);
  }

  private normalizeInstanceList(payload: unknown): EvolutionInstanceSummary[] {
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(this.asRecord(payload)?.instances)
        ? (this.asRecord(payload)?.instances as unknown[])
        : Array.isArray(this.asRecord(payload)?.data)
          ? (this.asRecord(payload)?.data as unknown[])
          : [];

    return items
      .map((item) => this.normalizeInstance(item))
      .filter((item): item is EvolutionInstanceSummary => Boolean(item));
  }

  private normalizeInstance(value: unknown): EvolutionInstanceSummary | null {
    const record = this.asRecord(value);
    if (!record) return null;

    const nested = this.asRecord(record.instance) ?? record;
    const instanceName =
      this.asString(nested.instanceName) ??
      this.asString(nested.name) ??
      this.asString(record.instanceName) ??
      this.asString(record.name);

    if (!instanceName) return null;

    return {
      instanceName,
      status:
        this.asString(nested.status) ??
        this.asString(nested.state) ??
        this.asString(record.status) ??
        this.asString(record.state) ??
        undefined,
    };
  }

  private extractState(payload: unknown): string | undefined {
    const record = this.asRecord(payload);
    if (!record) return undefined;

    const nested =
      this.asRecord(record.instance) ??
      this.asRecord(record.connectionState) ??
      record;

    return (
      this.asString(nested.state) ??
      this.asString(nested.status) ??
      this.asString(record.state) ??
      this.asString(record.status) ??
      undefined
    );
  }

  private asRecord(value: unknown): JsonRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as JsonRecord;
  }

  private asString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private describeError(error: unknown) {
    if (error instanceof Error) return error.message;
    return 'erro desconhecido';
  }
}
