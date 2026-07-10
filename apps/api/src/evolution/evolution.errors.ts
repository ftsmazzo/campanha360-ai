import { HttpException, HttpStatus } from '@nestjs/common';

export class EvolutionApiException extends HttpException {
  constructor(
    message: string,
    status: HttpStatus = HttpStatus.BAD_GATEWAY,
  ) {
    super({ message }, status);
  }
}

export function toSafeEvolutionError(error: unknown): EvolutionApiException {
  if (error instanceof EvolutionApiException) {
    return error;
  }

  if (error instanceof HttpException) {
    return new EvolutionApiException(
      'Falha ao comunicar com a Evolution API',
      error.getStatus() >= 500 ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_REQUEST,
    );
  }

  return new EvolutionApiException('Falha ao comunicar com a Evolution API');
}
