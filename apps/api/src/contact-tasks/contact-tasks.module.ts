import { Module } from '@nestjs/common';
import { ContactTasksController } from './contact-tasks.controller';
import { ContactTasksService } from './contact-tasks.service';

@Module({
  controllers: [ContactTasksController],
  providers: [ContactTasksService],
})
export class ContactTasksModule {}
