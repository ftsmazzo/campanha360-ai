# Campanha360 AI

SaaS multi-campanha para gestao, enriquecimento, captacao, classificacao e relacionamento com bases de eleitores por WhatsApp e canais futuros, com IA assistiva, consentimento, opt-out, auditoria e compliance eleitoral.

## Decisoes fechadas

- Projeto novo, sem copiar repositorios legados.
- Frontend: Next.js + TypeScript.
- Backend: NestJS + TypeScript.
- Banco: PostgreSQL.
- ORM: Prisma.
- Filas/cache: Redis + BullMQ.
- WhatsApp MVP: Evolution API.
- Deploy: Docker + EasyPanel.
- IA inicial: modo sugestao, sem envio automatico irrestrito.

## Estrutura

```text
apps/
  web/       # Next.js
  api/       # NestJS
  worker/    # jobs assincronos
packages/
  shared/    # tipos e contratos compartilhados
  config/    # configuracoes compartilhadas
prisma/      # schema e migrations
infra/       # EasyPanel e Docker
docs/        # contexto e fases para Cursor
```

## Como o Cursor deve trabalhar

1. Leia `docs/CURSOR-CONTEXTO.md`.
2. Leia `docs/ARQUITETURA.md`.
3. Execute apenas uma fase por vez em `docs/fases/`.
4. Nao rediscuta stack ou arquitetura.

## Desenvolvimento local

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run dev
```

## Docker

```bash
docker compose up --build
```

