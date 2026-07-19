import {
  Body,
  Controller,
  Get,
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

  @Get(':channelAccountId/health')
  getHealth(@Param('channelAccountId') channelAccountId: string) {
    return this.evolutionWebhookService.getHealth(channelAccountId);
  }

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
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-evolution-webhook-secret') evolutionSecret: string | undefined,
    @Headers('x-campanha360-webhook-secret') campanhaSecret: string | undefined,
    @Body() body: unknown,
  ) {
    return this.evolutionWebhookService.handleInbound(channelAccountId, body, {
      authorization,
      evolutionSecret,
      campanhaSecret,
    });
  }
}
