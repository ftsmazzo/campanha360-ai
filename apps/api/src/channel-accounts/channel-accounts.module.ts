import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChannelAccountsController } from './channel-accounts.controller';
import { ChannelAccountsService } from './channel-accounts.service';

@Module({
  imports: [AuditModule],
  controllers: [ChannelAccountsController],
  providers: [ChannelAccountsService],
})
export class ChannelAccountsModule {}
