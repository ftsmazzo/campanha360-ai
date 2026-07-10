import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EvolutionAdapter } from './evolution.adapter';
import { EvolutionController } from './evolution.controller';
import { EvolutionService } from './evolution.service';

@Module({
  imports: [AuditModule],
  controllers: [EvolutionController],
  providers: [EvolutionAdapter, EvolutionService],
  exports: [EvolutionAdapter],
})
export class EvolutionModule {}
