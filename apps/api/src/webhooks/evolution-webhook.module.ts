import { Module } from '@nestjs/common';
import { EvolutionModule } from '../evolution/evolution.module';
import { EvolutionWebhookController } from './evolution-webhook.controller';
import { EvolutionWebhookService } from './evolution-webhook.service';

@Module({
  imports: [EvolutionModule],
  controllers: [EvolutionWebhookController],
  providers: [EvolutionWebhookService],
})
export class EvolutionWebhookModule {}
