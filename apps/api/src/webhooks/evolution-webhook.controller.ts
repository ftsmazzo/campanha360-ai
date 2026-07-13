import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { EvolutionWebhookService } from './evolution-webhook.service';

@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  constructor(private readonly evolutionWebhookService: EvolutionWebhookService) {}

  @Post(':channelAccountId')
  @HttpCode(200)
  @UsePipes(
    new ValidationPipe({
      transform: false,
      whitelist: false,
      forbidNonWhitelisted: false,
    }),
  )
  handleInbound(
    @Param('channelAccountId') channelAccountId: string,
    @Headers('x-campanha360-webhook-secret') secretHeader: string | undefined,
    @Body() body: unknown,
  ) {
    return this.evolutionWebhookService.handleInbound(channelAccountId, body, secretHeader);
  }
}
