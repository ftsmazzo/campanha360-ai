import { BadRequestException } from '@nestjs/common';
import { normalizePhone } from '../common/phone.util';

export function normalizeOutboundReplyBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new BadRequestException('Informe o texto da mensagem');
  }
  if (trimmed.length > 4000) {
    throw new BadRequestException('Mensagem muito longa (maximo 4000 caracteres)');
  }
  return trimmed;
}

export function resolveWhatsAppDestination(input: {
  phoneNumber?: string | null;
  channelNormalizedValue?: string | null;
}): string | null {
  const fromChannel = input.channelNormalizedValue
    ? normalizePhone(input.channelNormalizedValue)
    : '';
  if (fromChannel.length >= 10) {
    return fromChannel;
  }

  const fromPhone = input.phoneNumber ? normalizePhone(input.phoneNumber) : '';
  if (fromPhone.length >= 10) {
    return fromPhone;
  }

  return null;
}
