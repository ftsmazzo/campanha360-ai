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

  @Post(':dispatchId/prepare')
  prepare(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('dispatchId') dispatchId: string,
  ) {
    return this.dispatchesService.prepare(user.id, campaignId, dispatchId);
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
