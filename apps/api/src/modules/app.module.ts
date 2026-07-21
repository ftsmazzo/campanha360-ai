import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ChannelAccountsModule } from '../channel-accounts/channel-accounts.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { ContactNotesModule } from '../contact-notes/contact-notes.module';
import { ContactTasksModule } from '../contact-tasks/contact-tasks.module';
import { ContactTimelineModule } from '../contact-timeline/contact-timeline.module';
import { ContactsModule } from '../contacts/contacts.module';
import { EvolutionModule } from '../evolution/evolution.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TagsModule } from '../tags/tags.module';
import { SegmentsModule } from '../segments/segments.module';
import { DispatchPlansModule } from '../dispatch-plans/dispatch-plans.module';
import { EvolutionWebhookModule } from '../webhooks/evolution-webhook.module';
import { InboxModule } from '../inbox/inbox.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    CampaignsModule,
    ChannelAccountsModule,
    ContactsModule,
    TagsModule,
    SegmentsModule,
    DispatchPlansModule,
    ContactNotesModule,
    ContactTasksModule,
    ContactTimelineModule,
    EvolutionModule,
    EvolutionWebhookModule,
    InboxModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
