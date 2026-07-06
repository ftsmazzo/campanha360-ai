# Fase 1 - Auth e tenancy

Status: **concluida**

## Implementado

- registro de usuario (`POST /auth/register`);
- login com JWT (`POST /auth/login`);
- perfil autenticado (`GET /auth/me`);
- listagem de organizacoes (`GET /organizations`);
- criacao de organizacao com membership `OWNER` (`POST /organizations`);
- roles via enum `MembershipRole` no Prisma;
- migration inicial Prisma (`20260706120000_init`);
- deploy da API com `prisma migrate deploy` no container;
- tela de login funcional (`/login`);
- tela de registro (`/register`);
- dashboard com criacao e listagem de organizacoes (`/dashboard`);
- `GET /health` preservado.

## Fora de escopo nesta fase

- campanhas;
- contatos;
- Evolution API;
- convites de membros;
- troca de organizacao ativa no contexto da UI.

## Rotas

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `GET /organizations`
- `POST /organizations`
- `GET /health`

## UI

- `/login` — autenticacao
- `/register` — cadastro
- `/dashboard` — organizacoes do usuario autenticado

## Variaveis necessarias

- API: `DATABASE_URL`, `JWT_SECRET`, `WEB_PUBLIC_URL`
- Web: `NEXT_PUBLIC_API_URL` (ou `API_PUBLIC_URL` no build Docker)

## Proxima fase

`docs/fases/02-CAMPANHAS-CANDIDATOS.md`
