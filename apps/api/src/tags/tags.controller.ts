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
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { TagsService } from './tags.service';

@Controller('campaigns/:campaignId/tags')
@UseGuards(JwtAuthGuard)
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('campaignId') campaignId: string) {
    return this.tagsService.list(user.id, campaignId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateTagDto,
  ) {
    return this.tagsService.create(user.id, campaignId, dto);
  }

  @Put(':tagId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('tagId') tagId: string,
    @Body() dto: UpdateTagDto,
  ) {
    return this.tagsService.update(user.id, campaignId, tagId, dto);
  }

  @Delete(':tagId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('tagId') tagId: string,
  ) {
    return this.tagsService.remove(user.id, campaignId, tagId);
  }
}
