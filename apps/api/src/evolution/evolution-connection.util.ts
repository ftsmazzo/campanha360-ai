import { ChannelAccountStatus } from '@prisma/client';

/**
 * Mapeia o estado de conexao reportado pela Evolution para o status
 * persistido do ChannelAccount. Usado pelo webhook connection.update e
 * pelo refresh controlado do Inbox — sem acoplar ao Motor de Disparo.
 */
export function mapEvolutionConnectionStateToStatus(
  state?: string | null,
): ChannelAccountStatus | null {
  if (!state) return null;
  const normalized = state.trim().toLowerCase();

  if (['open', 'connected', 'authenticated'].includes(normalized)) {
    return ChannelAccountStatus.CONNECTED;
  }

  if (['connecting', 'pairing', 'qr', 'qrcode', 'timeout'].includes(normalized)) {
    return ChannelAccountStatus.CONNECTING;
  }

  if (['close', 'closed', 'disconnected', 'logout'].includes(normalized)) {
    return ChannelAccountStatus.DISCONNECTED;
  }

  if (['error', 'failed', 'conflict'].includes(normalized)) {
    return ChannelAccountStatus.ERROR;
  }

  return null;
}

export const INBOX_INSTANCE_DISCONNECTED_MESSAGE =
  'A instancia desta conversa esta desconectada. Reconecte-a para responder.';

export function isEvolutionDisconnectErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    /desconect|disconnect|closed|logout|not connected|connection closed|instancia.*nao encontrada|instance.*not found/i.test(
      normalized,
    )
  );
}
