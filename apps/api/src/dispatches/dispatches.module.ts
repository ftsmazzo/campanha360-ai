import { Module } from '@nestjs/common';
import { DispatchesController } from './dispatches.controller';
import { DispatchesService } from './dispatches.service';
import { DispatchQueueService } from './dispatch-queue.service';
import { DispatchSendProducer } from './dispatch-send.producer';
import { DispatchStartService } from './dispatch-start.service';
import { DispatchOperationalService } from './dispatch-operational.service';

@Module({
  controllers: [DispatchesController],
  providers: [
    DispatchesService,
    DispatchQueueService,
    DispatchSendProducer,
    DispatchStartService,
    DispatchOperationalService,
  ],
  exports: [
    DispatchSendProducer,
    DispatchQueueService,
    DispatchStartService,
    DispatchOperationalService,
  ],
})
export class DispatchesModule {}
