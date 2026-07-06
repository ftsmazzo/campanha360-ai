import { ConflictException, Injectable } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { slugify } from '../common/slug.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: {
        id: true,
        role: true,
        createdAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      membershipId: membership.id,
      role: membership.role,
      joinedAt: membership.createdAt,
      organization: membership.organization,
    }));
  }

  async createForUser(userId: string, dto: CreateOrganizationDto) {
    const baseSlug = dto.slug?.trim() || slugify(dto.name);
    const slug = await this.ensureUniqueSlug(baseSlug);

    try {
      const organization = await this.prisma.organization.create({
        data: {
          name: dto.name.trim(),
          slug,
          memberships: {
            create: {
              userId,
              role: MembershipRole.OWNER,
            },
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          memberships: {
            where: { userId },
            select: {
              id: true,
              role: true,
            },
          },
        },
      });

      return {
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
          createdAt: organization.createdAt,
        },
        membership: organization.memberships[0],
      };
    } catch {
      throw new ConflictException('Nao foi possivel criar a organizacao');
    }
  }

  private async ensureUniqueSlug(baseSlug: string) {
    let slug = baseSlug;
    let suffix = 1;

    while (await this.prisma.organization.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }
}
