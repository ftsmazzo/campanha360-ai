import { Module } from '@nestjs/common';
import { HardResetService } from './hard-reset.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, HardResetService],
})
export class OrganizationsModule {}
