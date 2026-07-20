import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateSegmentDto,
  PreviewSegmentDto,
  UpdateSegmentDto,
} from './dto/segment.dto';
import { SegmentsService } from './segments.service';

@Controller('campaigns/:campaignId/segments')
@UseGuards(JwtAuthGuard)
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('campaignId') campaignId: string) {
    return this.segmentsService.list(user.id, campaignId);
  }

  @Post('preview')
  preview(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Body() dto: PreviewSegmentDto,
  ) {
    return this.segmentsService.preview(user.id, campaignId, dto);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateSegmentDto,
  ) {
    return this.segmentsService.create(user.id, campaignId, dto);
  }

  @Get(':segmentId/prevalidate')
  prevalidate(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('segmentId') segmentId: string,
  ) {
    return this.segmentsService.prevalidate(user.id, campaignId, segmentId);
  }

  @Get(':segmentId')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('segmentId') segmentId: string,
  ) {
    return this.segmentsService.getById(user.id, campaignId, segmentId);
  }

  @Put(':segmentId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('segmentId') segmentId: string,
    @Body() dto: UpdateSegmentDto,
  ) {
    return this.segmentsService.update(user.id, campaignId, segmentId, dto);
  }

  @Delete(':segmentId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('segmentId') segmentId: string,
  ) {
    return this.segmentsService.remove(user.id, campaignId, segmentId);
  }
}
