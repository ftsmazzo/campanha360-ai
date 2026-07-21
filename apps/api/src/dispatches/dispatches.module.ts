import { Module } from '@nestjs/common';
import { DispatchesController } from './dispatches.controller';
import { DispatchesService } from './dispatches.service';
import { DispatchQueueService } from './dispatch-queue.service';
import { DispatchSendProducer } from './dispatch-send.producer';

@Module({
  controllers: [DispatchesController],
  providers: [DispatchesService, DispatchQueueService, DispatchSendProducer],
  exports: [DispatchSendProducer, DispatchQueueService],
})
export class DispatchesModule {}
