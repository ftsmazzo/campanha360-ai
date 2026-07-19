import { Module } from '@nestjs/common';
import { EvolutionModule } from '../evolution/evolution.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

@Module({
  imports: [EvolutionModule],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
