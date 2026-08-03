import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EvolutionAdapter } from './evolution.adapter';
import { EvolutionController } from './evolution.controller';
import { EvolutionLifecycleService } from './evolution-lifecycle.service';
import { EvolutionService } from './evolution.service';

@Module({
  imports: [AuditModule],
  controllers: [EvolutionController],
  providers: [EvolutionAdapter, EvolutionService, EvolutionLifecycleService],
  exports: [EvolutionAdapter, EvolutionLifecycleService],
})
export class EvolutionModule {}
