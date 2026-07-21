import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma unico do processo worker. Usa o mesmo schema raiz
 * (prisma/schema.prisma) compartilhado com apps/api — sem schema
 * duplicado, apenas o client gerado no node_modules do monorepo.
 */
export const prisma = new PrismaClient();
