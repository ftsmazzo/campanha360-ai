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
import { ListDispatchesQueryDto } from './dto/list-dispatches-query.dto';
import { DispatchesService } from './dispatches.service';

@Controller('campaigns/:campaignId/dispatches')
@UseGuards(JwtAuthGuard)
export class DispatchesController {
  constructor(private readonly dispatchesService: DispatchesService) {}

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

  @Get(':dispatchId')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
  ) {
    return this.dispatchesService.getById(user.id, campaignId, dispatchId);
  }
}
