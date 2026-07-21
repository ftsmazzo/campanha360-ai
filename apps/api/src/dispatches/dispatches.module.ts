import { Module } from '@nestjs/common';
import { DispatchesController } from './dispatches.controller';
import { DispatchesService } from './dispatches.service';
import { DispatchQueueService } from './dispatch-queue.service';
import { DispatchSendProducer } from './dispatch-send.producer';
import { DispatchStartService } from './dispatch-start.service';

@Module({
  controllers: [DispatchesController],
  providers: [
    DispatchesService,
    DispatchQueueService,
    DispatchSendProducer,
    DispatchStartService,
  ],
  exports: [DispatchSendProducer, DispatchQueueService, DispatchStartService],
})
export class DispatchesModule {}
