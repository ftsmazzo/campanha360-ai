import { Module } from '@nestjs/common';
import { ContactTimelineController } from './contact-timeline.controller';
import { ContactTimelineService } from './contact-timeline.service';

@Module({
  controllers: [ContactTimelineController],
  providers: [ContactTimelineService],
})
export class ContactTimelineModule {}
