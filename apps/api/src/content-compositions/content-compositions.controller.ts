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
import { ContentCompositionsService } from './content-compositions.service';
import { ApproveCompositionDto } from './dto/approve-composition.dto';
import { CreateCompositionDto } from './dto/create-composition.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { GenerateAiVariantsDto } from './dto/generate-ai-variants.dto';
import { PreviewCompositionDto } from './dto/preview-composition.dto';
import { UpdateCompositionDto } from './dto/update-composition.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

@Controller('campaigns/:campaignId/content-compositions')
@UseGuards(JwtAuthGuard)
export class ContentCompositionsController {
  constructor(private readonly service: ContentCompositionsService) {}

  @Get('catalog')
  catalog(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
  ) {
    return this.service.catalog(user.id, campaignId);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
  ) {
    return this.service.list(user.id, campaignId);
  }

  @Get(':compositionId')
  get(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('compositionId') compositionId: string,
  ) {
    return this.service.get(user.id, campaignId, compositionId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateCompositionDto,
  ) {
    return this.service.create(user.id, campaignId, dto);
  }

  @Put(':compositionId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('compositionId') compositionId: string,
    @Body() dto: UpdateCompositionDto,
  ) {
    return this.service.update(user.id, campaignId, compositionId, dto);
  }

  @Post(':compositionId/variants')
  addVariant(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('compositionId') compositionId: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.service.addVariant(user.id, campaignId, compositionId, dto);
  }

  @Put(':compositionId/variants/:variantId')
  updateVariant(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('compositionId') compositionId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.service.updateVariant(
      user.id,
      campaignId,
      compositionId,
      variantId,
      dto,
    );
  }

  @Delete(':compositionId/variants/:variantId')
  removeVariant(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('compositionId') compositionId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.service.removeVariant(
      user.id,
      campaignId,
      compositionId,
      variantId,
    );
  }

  @Post(':compositionId/generate-ai')
  generateAi(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('compositionId') compositionId: string,
    @Body() dto: GenerateAiVariantsDto,
  ) {
    return this.service.generateAiVariants(
      user.id,
      campaignId,
      compositionId,
      dto,
    );
  }

  @Post(':compositionId/ready-for-review')
  readyForReview(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('compositionId') compositionId: string,
  ) {
    return this.service.markReadyForReview(user.id, campaignId, compositionId);
  }

  @Post(':compositionId/approve')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('compositionId') compositionId: string,
    @Body() dto: ApproveCompositionDto,
  ) {
    return this.service.approve(user.id, campaignId, compositionId, dto);
  }

  @Post(':compositionId/preview')
  preview(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('compositionId') compositionId: string,
    @Body() dto: PreviewCompositionDto,
  ) {
    return this.service.preview(user.id, campaignId, compositionId, dto);
  }

  @Get(':compositionId/similarity')
  similarity(
    @CurrentUser() user: AuthUser,
    @Param('campaignId') campaignId: string,
    @Param('compositionId') compositionId: string,
  ) {
    return this.service.similarityReport(user.id, campaignId, compositionId);
  }
}
