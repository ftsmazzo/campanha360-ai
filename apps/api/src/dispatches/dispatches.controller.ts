import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateDispatchDto } from './dto/create-dispatch.dto';
import { ListDispatchItemsQueryDto } from './dto/list-dispatch-items-query.dto';
import { ListDispatchesQueryDto } from './dto/list-dispatches-query.dto';
import { DispatchesService } from './dispatches.service';
import { DispatchQueueService } from './dispatch-queue.service';
import { DispatchStartService } from './dispatch-start.service';
import { DispatchOperationalService } from './dispatch-operational.service';
import {
  CancelDispatchDto,
  EmergencyStopDispatchDto,
  PauseDispatchDto,
} from './dto/operational-dispatch.dto';

@Controller('campaigns/:campaignId/dispatches')
@UseGuards(JwtAuthGuard)
export class DispatchesController {
  constructor(
    private readonly dispatchesService: DispatchesService,
    private readonly dispatchQueueService: DispatchQueueService,
    private readonly dispatchStartService: DispatchStartService,
    private readonly dispatchOperationalService: DispatchOperationalService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Query() query: ListDispatchesQueryDto,
  ) {
    return this.dispatchesService.list(user.id, campaignId, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateDispatchDto,
  ) {
    return this.dispatchesService.create(user.id, campaignId, dto);
  }

  @Post(':dispatchId/redistribute')
  redistribute(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
  ) {
    return this.dispatchesService.redistribute(
      user.id,
      campaignId,
      dispatchId,
    );
  }

  @Post(':dispatchId/prepare')
  prepare(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
  ) {
    return this.dispatchesService.prepare(user.id, campaignId, dispatchId);
  }

  @Post(':dispatchId/queue')
  queue(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
  ) {
    return this.dispatchQueueService.queue(user.id, campaignId, dispatchId);
  }

  @Post(':dispatchId/reconcile-queue')
  reconcileQueue(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
  ) {
    return this.dispatchQueueService.reconcileQueue(
      user.id,
      campaignId,
      dispatchId,
    );
  }

  @Post(':dispatchId/start')
  start(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
  ) {
    return this.dispatchStartService.start(user.id, campaignId, dispatchId);
  }

  @Post(':dispatchId/pause')
  pause(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
    @Body() dto: PauseDispatchDto,
  ) {
    return this.dispatchOperationalService.pause(
      user.id,
      campaignId,
      dispatchId,
      dto.reason,
    );
  }

  @Post(':dispatchId/resume')
  resume(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
  ) {
    return this.dispatchOperationalService.resume(
      user.id,
      campaignId,
      dispatchId,
    );
  }

  @Post(':dispatchId/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
    @Body() dto: CancelDispatchDto,
  ) {
    return this.dispatchOperationalService.cancel(
      user.id,
      campaignId,
      dispatchId,
      dto.reason,
    );
  }

  @Post(':dispatchId/emergency-stop')
  emergencyStop(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
    @Body() dto: EmergencyStopDispatchDto,
  ) {
    return this.dispatchOperationalService.emergencyStop(
      user.id,
      campaignId,
      dispatchId,
      dto.reason,
    );
  }

  @Get(':dispatchId/items')
  listItems(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
    @Query() query: ListDispatchItemsQueryDto,
  ) {
    return this.dispatchesService.listItems(
      user.id,
      campaignId,
      dispatchId,
      query,
    );
  }

  @Get(':dispatchId/items/:dispatchItemId')
  getItemById(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
    @Param('dispatchItemId') dispatchItemId: string,
  ) {
    return this.dispatchesService.getItemById(
      user.id,
      campaignId,
      dispatchId,
      dispatchItemId,
    );
  }

  @Get(':dispatchId')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
  ) {
    return this.dispatchesService.getById(user.id, campaignId, dispatchId);
  }
}
