import { Module } from '@nestjs/common';
import { ContactNotesController } from './contact-notes.controller';
import { ContactNotesService } from './contact-notes.service';

@Module({
  controllers: [ContactNotesController],
  providers: [ContactNotesService],
})
export class ContactNotesModule {}
