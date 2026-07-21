import { Module } from '@nestjs/common';
import { DispatchPlansController } from './dispatch-plans.controller';
import { DispatchPlansService } from './dispatch-plans.service';

@Module({
  controllers: [DispatchPlansController],
  providers: [DispatchPlansService],
})
export class DispatchPlansModule {}
