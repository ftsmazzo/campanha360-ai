import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateDispatchPlanDto } from './dto/create-dispatch-plan.dto';
import { ListDispatchPlanRecipientsQueryDto } from './dto/list-dispatch-plan-recipients-query.dto';
import { SimulateDispatchPlanDto } from './dto/simulate-dispatch-plan.dto';
import { UpdateDispatchPlanDto } from './dto/update-dispatch-plan.dto';
import { DispatchPlansService } from './dispatch-plans.service';

@Controller('campaigns/:campaignId/dispatch-plans')
@UseGuards(JwtAuthGuard)
export class DispatchPlansController {
  constructor(private readonly dispatchPlansService: DispatchPlansService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('campaignId') campaignId: string) {
    return this.dispatchPlansService.list(user.id, campaignId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateDispatchPlanDto,
  ) {
    return this.dispatchPlansService.create(user.id, campaignId, dto);
  }

  @Get(':dispatchPlanId')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchPlanId') dispatchPlanId: string,
  ) {
    return this.dispatchPlansService.getById(
      user.id,
      campaignId,
      dispatchPlanId,
    );
  }

  @Get(':dispatchPlanId/recipients')
  listRecipients(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchPlanId') dispatchPlanId: string,
    @Query() query: ListDispatchPlanRecipientsQueryDto,
  ) {
    return this.dispatchPlansService.listRecipients(
      user.id,
      campaignId,
      dispatchPlanId,
      query,
    );
  }

  @Post(':dispatchPlanId/snapshot')
  generateSnapshot(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchPlanId') dispatchPlanId: string,
  ) {
    return this.dispatchPlansService.generateSnapshot(
      user.id,
      campaignId,
      dispatchPlanId,
    );
  }

  @Post(':dispatchPlanId/validate')
  validate(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchPlanId') dispatchPlanId: string,
  ) {
    return this.dispatchPlansService.validate(
      user.id,
      campaignId,
      dispatchPlanId,
    );
  }

  @Post(':dispatchPlanId/reopen')
  reopen(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchPlanId') dispatchPlanId: string,
  ) {
    return this.dispatchPlansService.reopen(
      user.id,
      campaignId,
      dispatchPlanId,
    );
  }

  @Post(':dispatchPlanId/simulate')
  simulate(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchPlanId') dispatchPlanId: string,
    @Body() dto: SimulateDispatchPlanDto,
  ) {
    return this.dispatchPlansService.simulate(
      user.id,
      campaignId,
      dispatchPlanId,
      dto,
    );
  }

  @Put(':dispatchPlanId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchPlanId') dispatchPlanId: string,
    @Body() dto: UpdateDispatchPlanDto,
  ) {
    return this.dispatchPlansService.update(
      user.id,
      campaignId,
      dispatchPlanId,
      dto,
    );
  }

  @Post(':dispatchPlanId/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchPlanId') dispatchPlanId: string,
  ) {
    return this.dispatchPlansService.cancel(
      user.id,
      campaignId,
      dispatchPlanId,
    );
  }
}
