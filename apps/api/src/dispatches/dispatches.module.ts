import { Module } from '@nestjs/common';
import { DispatchesController } from './dispatches.controller';
import { DispatchesService } from './dispatches.service';
import { DispatchQueueService } from './dispatch-queue.service';
import { DispatchSendProducer } from './dispatch-send.producer';
import { DispatchStartService } from './dispatch-start.service';
import { DispatchOperationalService } from './dispatch-operational.service';
import { DispatchRecoveryService } from './dispatch-recovery.service';
import { DispatchProtectionService } from './dispatch-protection.service';

@Module({
  controllers: [DispatchesController],
  providers: [
    DispatchesService,
    DispatchQueueService,
    DispatchSendProducer,
    DispatchStartService,
    DispatchOperationalService,
    DispatchRecoveryService,
    DispatchProtectionService,
  ],
  exports: [
    DispatchSendProducer,
    DispatchQueueService,
    DispatchStartService,
    DispatchOperationalService,
    DispatchRecoveryService,
    DispatchProtectionService,
  ],
})
export class DispatchesModule {}
