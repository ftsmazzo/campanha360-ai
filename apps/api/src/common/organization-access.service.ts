import { ForbiddenException, Injectable } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const WRITE_ROLES: MembershipRole[] = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.MANAGER,
];

const APPROVE_ROLES: MembershipRole[] = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
];

@Injectable()
export class OrganizationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireMembership(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId, organizationId },
      },
    });

    if (!membership) {
      throw new ForbiddenException('Sem acesso a esta organizacao');
    }

    return membership;
  }

  async requireWriteAccess(userId: string, organizationId: string) {
    const membership = await this.requireMembership(userId, organizationId);

    if (!WRITE_ROLES.includes(membership.role)) {
      throw new ForbiddenException('Permissao insuficiente para esta acao');
    }

    return membership;
  }

  async requireApproveAccess(userId: string, organizationId: string) {
    const membership = await this.requireMembership(userId, organizationId);

    if (!APPROVE_ROLES.includes(membership.role)) {
      throw new ForbiddenException(
        'Permissao insuficiente para aprovar ou rejeitar',
      );
    }

    return membership;
  }
}
