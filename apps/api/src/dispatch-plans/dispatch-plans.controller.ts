import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateDispatchPlanDto } from './dto/create-dispatch-plan.dto';
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
