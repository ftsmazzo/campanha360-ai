import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { HardResetDto } from './dto/hard-reset.dto';
import { HardResetService } from './hard-reset.service';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly hardResetService: HardResetService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.organizationsService.listForUser(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrganizationDto) {
    return this.organizationsService.createForUser(user.id, dto);
  }

  /**
   * Apaga organizacoes em que o usuario e OWNER e todo o conteudo de teste.
   * Mantem a conta de usuario. Requer HARD_RESET_ENABLED e confirmacao.
   */
  @Post('hard-reset')
  hardReset(@CurrentUser() user: AuthUser, @Body() dto: HardResetDto) {
    return this.hardResetService.hardResetOwnedData(user.id, dto.confirmation);
  }
}
