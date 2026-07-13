import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvolutionApiException, toSafeEvolutionError } from './evolution.errors';

export const EVOLUTION_INSTANCE_NOT_FOUND_MESSAGE =
  'Instancia Evolution nao encontrada. Prepare a conexao novamente.';

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
  qrcode?: {
    base64?: string;
    code?: string;
    pairingCode?: string;
  };
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
    const target = this.normalizeName(instanceName);
    if (!target) return null;

    return (
      instances.find((item) => this.normalizeName(item.instanceName) === target) ?? null
    );
  }

  async createInstance(instanceName: string): Promise<EvolutionPrepareResult> {
    const payload = await this.request('POST', '/instance/create', {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    });

    const record = this.asRecord(payload) ?? {};
    const instance = this.asRecord(record.instance);
    const resolvedName =
      this.asString(instance?.instanceName) ??
      this.asString(record.instanceName) ??
      instanceName;

    const qrFields = this.extractQrCodeFields(payload);
    const hasQr = Boolean(qrFields.base64 || qrFields.code || qrFields.pairingCode);

    if (!hasQr) {
      this.logger.warn(
        `Evolution create sem QR reconhecido para instancia "${resolvedName}". ${this.describePayloadShape(payload)}`,
      );
    }

    return {
      instanceName: resolvedName,
      created: true,
      state: this.extractState(payload) ?? 'connecting',
      qrcode: hasQr
        ? {
            base64: qrFields.base64,
            code: qrFields.code,
            pairingCode: qrFields.pairingCode,
          }
        : undefined,
    };
  }

  async getConnectionState(instanceName: string): Promise<EvolutionConnectionState> {
    try {
      const payload = await this.request(
        'GET',
        `/instance/connectionState/${encodeURIComponent(instanceName)}`,
      );

      return {
        instanceName,
        state: this.extractState(payload) ?? 'unknown',
      };
    } catch (error) {
      throw this.mapMissingInstanceError(error);
    }
  }

  async getQrCode(instanceName: string): Promise<EvolutionQrCodeResult> {
    try {
      const payload = await this.request(
        'GET',
        `/instance/connect/${encodeURIComponent(instanceName)}`,
      );

      const extracted = this.extractQrCodeFields(payload);

      if (!extracted.base64 && !extracted.code && !extracted.pairingCode) {
        this.logger.warn(
          `Evolution QR Code sem campos reconhecidos para instancia "${instanceName}". ${this.describePayloadShape(payload)}`,
        );
      }

      return {
        instanceName,
        base64: extracted.base64,
        code: extracted.code,
        pairingCode: extracted.pairingCode,
      };
    } catch (error) {
      throw this.mapMissingInstanceError(error);
    }
  }

  private extractQrCodeFields(payload: unknown): {
    base64?: string;
    code?: string;
    pairingCode?: string;
  } {
    const root = this.asRecord(payload) ?? {};
    const qrcode =
      this.asRecord(root.qrcode) ??
      this.asRecord(root.qrCode) ??
      null;
    const instance = this.asRecord(root.instance) ?? this.asRecord(root.Instance) ?? null;
    const response =
      this.asRecord(root.response) ?? this.asRecord(root.result) ?? this.asRecord(root.data) ?? null;
    const responseQrcode =
      this.asRecord(response?.qrcode) ?? this.asRecord(response?.qrCode) ?? null;
    const instanceQrcode =
      this.asRecord(instance?.qrcode) ?? this.asRecord(instance?.qrCode) ?? null;

    const base64 =
      this.asQrBase64(root.base64) ??
      this.asQrBase64(root.qrcode) ??
      this.asQrBase64(root.qrCode) ??
      this.asQrBase64(qrcode?.base64) ??
      this.asQrBase64(qrcode?.qrcode) ??
      this.asQrBase64(qrcode?.qrCode) ??
      this.asQrBase64(instance?.base64) ??
      this.asQrBase64(instance?.qrcode) ??
      this.asQrBase64(instance?.qrCode) ??
      this.asQrBase64(instanceQrcode?.base64) ??
      this.asQrBase64(instanceQrcode?.qrcode) ??
      this.asQrBase64(response?.base64) ??
      this.asQrBase64(response?.qrcode) ??
      this.asQrBase64(response?.qrCode) ??
      this.asQrBase64(responseQrcode?.base64) ??
      this.asQrBase64(responseQrcode?.qrcode);

    const code =
      this.asNonImageCode(root.code) ??
      this.asNonImageCode(qrcode?.code) ??
      this.asNonImageCode(instance?.code) ??
      this.asNonImageCode(response?.code) ??
      this.asNonImageCode(responseQrcode?.code) ??
      this.asNonImageCode(instanceQrcode?.code);

    const pairingCode =
      this.asString(root.pairingCode) ??
      this.asString(qrcode?.pairingCode) ??
      this.asString(instance?.pairingCode) ??
      this.asString(response?.pairingCode) ??
      this.asString(responseQrcode?.pairingCode) ??
      this.asString(instanceQrcode?.pairingCode);

    return {
      base64: base64 || undefined,
      code: code || undefined,
      pairingCode: pairingCode || undefined,
    };
  }

  private asQrBase64(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    // QR as data URL or raw base64 — preserve both.
    if (trimmed.startsWith('data:image')) {
      return trimmed;
    }

    // Avoid treating short codes / pairing strings as base64 images.
    if (trimmed.length < 64 && !/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed)) {
      return undefined;
    }

    // If it looks like a short alphanumeric code, leave it for `code`.
    if (trimmed.length < 64 && /^[A-Za-z0-9-]+$/.test(trimmed)) {
      return undefined;
    }

    return trimmed;
  }

  private asNonImageCode(value: unknown): string | undefined {
    const text = this.asString(value);
    if (!text) return undefined;
    if (text.startsWith('data:image')) return undefined;
    // Long base64 blobs are QR images, not pairing/text codes.
    if (text.length >= 64 && /^[A-Za-z0-9+/=\r\n]+$/.test(text)) return undefined;
    return text;
  }

  private topLevelKeys(payload: unknown): string[] {
    if (Array.isArray(payload)) {
      return ['[array]'];
    }
    const record = this.asRecord(payload);
    if (!record) return [];
    return Object.keys(record).sort();
  }

  private describePayloadShape(payload: unknown): string {
    const root = this.asRecord(payload);
    const parts = [
      `Chaves de alto nivel: ${this.topLevelKeys(payload).join(', ') || '(nenhuma)'}`,
    ];

    if (!root) {
      return parts.join(' | ');
    }

    const nestedTargets: Array<{ label: string; value: unknown }> = [
      { label: 'instance', value: root.instance },
      { label: 'response', value: root.response },
      { label: 'data', value: root.data },
      { label: 'qrcode', value: root.qrcode },
      { label: 'qrCode', value: root.qrCode },
    ];

    for (const target of nestedTargets) {
      const nested = this.asRecord(target.value);
      if (!nested) continue;
      parts.push(
        `Chaves de ${target.label}: ${Object.keys(nested).sort().join(', ') || '(nenhuma)'}`,
      );
    }

    return parts.join(' | ');
  }

  async prepareInstance(instanceName: string): Promise<EvolutionPrepareResult> {
    const existing = await this.findInstance(instanceName);
    if (existing) {
      let state = existing.status;
      try {
        const connection = await this.getConnectionState(existing.instanceName);
        state = connection.state;
      } catch (error) {
        if (this.isInstanceNotFoundError(error)) {
          return this.createInstance(instanceName);
        }
        // Mantem status da listagem se connectionState falhar por outro motivo.
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
          response.status === 404
            ? HttpStatus.NOT_FOUND
            : response.status >= 500
              ? HttpStatus.BAD_GATEWAY
              : HttpStatus.BAD_REQUEST,
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
      return EVOLUTION_INSTANCE_NOT_FOUND_MESSAGE;
    }

    return 'Evolution API retornou erro';
  }

  private mapMissingInstanceError(error: unknown): never {
    if (this.isInstanceNotFoundError(error)) {
      throw new EvolutionApiException(
        EVOLUTION_INSTANCE_NOT_FOUND_MESSAGE,
        HttpStatus.NOT_FOUND,
      );
    }
    throw error;
  }

  private isInstanceNotFoundError(error: unknown) {
    if (!(error instanceof EvolutionApiException)) {
      return false;
    }

    if (error.getStatus() === HttpStatus.NOT_FOUND) {
      return true;
    }

    const payload = error.getResponse();
    const message =
      typeof payload === 'string'
        ? payload
        : typeof payload === 'object' && payload && 'message' in payload
          ? String((payload as { message?: unknown }).message ?? '')
          : error.message;

    return /nao encontrad/i.test(message) || /not found/i.test(message);
  }

  private containsSensitiveToken(value: string) {
    return /apikey|api[_-]?key|authorization|bearer|token/i.test(value);
  }

  private normalizeInstanceList(payload: unknown): EvolutionInstanceSummary[] {
    const items = this.collectInstanceCandidates(payload);
    const unique = new Map<string, EvolutionInstanceSummary>();

    for (const item of items) {
      const normalized = this.normalizeInstance(item);
      if (!normalized) continue;
      unique.set(this.normalizeName(normalized.instanceName), normalized);
    }

    return [...unique.values()];
  }

  private collectInstanceCandidates(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (typeof payload === 'string') {
      return [payload];
    }

    const record = this.asRecord(payload);
    if (!record) return [];

    const candidates: unknown[] = [];

    for (const key of ['instances', 'data', 'response', 'result', 'items']) {
      const value = record[key];
      if (Array.isArray(value)) {
        candidates.push(...value);
      } else if (value) {
        candidates.push(value);
      }
    }

    if (this.asString(record.instanceName) || this.asString(record.name) || record.instance) {
      candidates.push(record);
    }

    return candidates;
  }

  private normalizeInstance(value: unknown): EvolutionInstanceSummary | null {
    if (typeof value === 'string') {
      const instanceName = value.trim();
      return instanceName ? { instanceName } : null;
    }

    const record = this.asRecord(value);
    if (!record) return null;

    const nested =
      this.asRecord(record.instance) ??
      this.asRecord(record.Instance) ??
      this.asRecord(record.data) ??
      record;

    const instanceName =
      this.asString(nested.instanceName) ??
      this.asString(nested.instanceId) ??
      this.asString(nested.name) ??
      this.asString(nested.id) ??
      this.asString(record.instanceName) ??
      this.asString(record.instanceId) ??
      this.asString(record.name) ??
      this.asString(record.id);

    if (!instanceName) return null;

    return {
      instanceName,
      status:
        this.asString(nested.connectionStatus) ??
        this.asString(nested.status) ??
        this.asString(nested.state) ??
        this.asString(record.connectionStatus) ??
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
      this.asString(nested.connectionStatus) ??
      this.asString(record.state) ??
      this.asString(record.status) ??
      this.asString(record.connectionStatus) ??
      undefined
    );
  }

  private normalizeName(value: string) {
    return value.trim().toLowerCase();
  }

  private asRecord(value: unknown): JsonRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as JsonRecord;
  }

  private asString(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private describeError(error: unknown) {
    if (error instanceof Error) return error.message;
    return 'erro desconhecido';
  }
}
