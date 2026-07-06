import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { OrganizationAccessService } from '../common/organization-access.service';

@Global()
@Module({
  providers: [AuditService, OrganizationAccessService],
  exports: [AuditService, OrganizationAccessService],
})
export class AuditModule {}
