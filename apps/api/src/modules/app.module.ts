import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { ContactNotesModule } from '../contact-notes/contact-notes.module';
import { ContactTasksModule } from '../contact-tasks/contact-tasks.module';
import { ContactTimelineModule } from '../contact-timeline/contact-timeline.module';
import { ContactsModule } from '../contacts/contacts.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TagsModule } from '../tags/tags.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    CampaignsModule,
    ContactsModule,
    TagsModule,
    ContactNotesModule,
    ContactTasksModule,
    ContactTimelineModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
