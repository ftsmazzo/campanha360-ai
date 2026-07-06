import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [AuditModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
