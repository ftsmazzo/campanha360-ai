# Deploy inicial no EasyPanel

Documentacao do ambiente real ja implantado para o projeto **Campanha360 AI** no EasyPanel (host `kxryyk.easypanel.host`).

Este documento descreve o ambiente implantado no EasyPanel. A partir da Fase 01, a API expoe autenticacao JWT e gestao inicial de organizacoes.

> **Segredos:** senhas de Postgres, Redis e `JWT_SECRET` ficam **apenas** nas variaveis de ambiente do EasyPanel. Este arquivo e o repositorio Git nao devem conter credenciais reais. Use os placeholders abaixo e copie os valores do painel ao configurar cada app.

## Visao geral

| Servico | Tipo | Host interno (rede EasyPanel) | Porta interna | URL publica |
|---------|------|-------------------------------|---------------|-------------|
| PostgreSQL | banco | `campanha-360-ia_postgres` | `5432` | nao exposto |
| Redis | cache/filas | `campanha-360-ia_redis` | `6379` | nao exposto |
| API | app (`apps/api`) | container da API | `3001` | https://campanha-360-ia-api.kxryyk.easypanel.host |
| Web | app (`apps/web`) | container da Web | `3000` | https://campanha-360-ia-web.kxryyk.easypanel.host |
| Worker | app (`apps/worker`) | container do Worker | sem HTTP | https://campanha-360-ia-worker.kxryyk.easypanel.host/ |
| Evolution API | infra compartilhada | `infra-core-whatsapp-core` | conforme stack Evolution | https://infra-core-whatsapp-core.kxryyk.easypanel.host |

## Servicos existentes

### PostgreSQL

Banco principal do projeto. Usado pela API (Prisma) e pelo Worker (BullMQ + acesso futuro ao banco).

Formato da connection string (preencher `<POSTGRES_PASSWORD>` com o valor exibido no EasyPanel):

```
postgresql://campanha360:<POSTGRES_PASSWORD>@campanha-360-ia_postgres:5432/campanha360_ai?sslmode=disable
```

- **Usuario:** `campanha360`
- **Host interno:** `campanha-360-ia_postgres`
- **Banco:** `campanha360_ai`
- **SSL:** desabilitado na rede interna do EasyPanel (`sslmode=disable`)

### Redis

Cache e filas (BullMQ). Usado pela API e pelo Worker.

Formato da connection string (preencher `<REDIS_PASSWORD>` com o valor exibido no EasyPanel):

```
redis://default:<REDIS_PASSWORD>@campanha-360-ia_redis:6379
```

- **Usuario:** `default`
- **Host interno:** `campanha-360-ia_redis`

### API (NestJS)

Backend HTTP. Expoe `GET /health` no bootstrap.

- **URL publica:** https://campanha-360-ia-api.kxryyk.easypanel.host
- **Porta interna do container:** `3001`
- **Dockerfile:** `apps/api/Dockerfile`

### Web (Next.js)

Frontend com paginas estaticas de bootstrap (`/`, `/login`, `/dashboard`).

- **URL publica:** https://campanha-360-ia-web.kxryyk.easypanel.host
- **Porta interna do container:** `3000`
- **Dockerfile:** `apps/web/Dockerfile`

### Worker

Processo assincrono (BullMQ). No bootstrap apenas inicializa e registra log; nao expoe rotas HTTP.

- **URL publica no EasyPanel:** https://campanha-360-ia-worker.kxryyk.easypanel.host/
- **Dockerfile:** `apps/worker/Dockerfile`

> **Observacao sobre o Worker:** o worker nao precisa receber trafego publico. Ele processa jobs em background e se conecta a Postgres e Redis pela rede interna. A URL publica existe hoje por limitacao atual do EasyPanel (todo app recebe dominio). Nao configure webhooks nem integracoes apontando para o worker; trate essa URL como indisponivel para uso funcional ate que o painel permita apps sem exposicao HTTP.

### Evolution API (infra externa ao repo)

Instancia compartilhada de WhatsApp ja existente na infra. Sera consumida a partir da Fase 04 (Evolution/Inbox/IA).

- **URL:** https://infra-core-whatsapp-core.kxryyk.easypanel.host

## Variaveis de ambiente por servico

Configure cada variavel no app correspondente no painel do EasyPanel. Referencia completa de placeholders: `.env.example`.

### API

| Variavel | Valor / placeholder | Observacao |
|----------|---------------------|------------|
| `DATABASE_URL` | `postgresql://campanha360:<POSTGRES_PASSWORD>@campanha-360-ia_postgres:5432/campanha360_ai?sslmode=disable` | Senha no painel do servico Postgres |
| `REDIS_URL` | `redis://default:<REDIS_PASSWORD>@campanha-360-ia_redis:6379` | Senha no painel do servico Redis |
| `PORT` | `3001` | Porta escutada pelo NestJS dentro do container |
| `WEB_PUBLIC_URL` | `https://campanha-360-ia-web.kxryyk.easypanel.host` | Usada no CORS da API |
| `API_PUBLIC_URL` | `https://campanha-360-ia-api.kxryyk.easypanel.host` | Referencia publica da API (fases futuras) |
| `JWT_SECRET` | `<JWT_SECRET>` | Valor forte gerado no painel; obrigatorio antes da Fase 01 |
| `EVOLUTION_API_URL` | `https://infra-core-whatsapp-core.kxryyk.easypanel.host` | Reservado para fases de canal WhatsApp |
| `NODE_ENV` | `production` | Padrao do Dockerfile |

### Web

| Variavel | Valor / placeholder | Observacao |
|----------|---------------------|------------|
| `PORT` | `3000` | Porta do Next.js dentro do container |
| `WEB_PUBLIC_URL` | `https://campanha-360-ia-web.kxryyk.easypanel.host` | URL canonica do frontend |
| `API_PUBLIC_URL` | `https://campanha-360-ia-api.kxryyk.easypanel.host` | **Obrigatoria em runtime** — proxy `/api` da Web encaminha para a API |
| `NEXT_PUBLIC_API_URL` | opcional | Legado; preferir `API_PUBLIC_URL` em runtime |
| `NODE_ENV` | `production` | Padrao do Dockerfile |

### Worker

| Variavel | Valor / placeholder | Observacao |
|----------|---------------------|------------|
| `DATABASE_URL` | `postgresql://campanha360:<POSTGRES_PASSWORD>@campanha-360-ia_postgres:5432/campanha360_ai?sslmode=disable` | Mesmo banco da API |
| `REDIS_URL` | `redis://default:<REDIS_PASSWORD>@campanha-360-ia_redis:6379` | Filas BullMQ |
| `NODE_ENV` | `production` | Padrao do Dockerfile |

### Postgres e Redis

Provisionados pelo EasyPanel. Usuario, host interno e nome do banco estao documentados acima; as senhas sao exibidas somente no painel de cada servico ao criar ou inspecionar o container.

## Portas internas (mapa rapido)

```text
campanha-360-ia_postgres  -> 5432
campanha-360-ia_redis     -> 6379
api (container)           -> 3001  (mapeada para HTTPS no dominio publico)
web (container)           -> 3000  (mapeada para HTTPS no dominio publico)
worker (container)        -> sem porta HTTP
```

O EasyPanel termina TLS nos dominios publicos e encaminha para a porta interna configurada em cada app.

## URLs publicas

| Finalidade | URL |
|------------|-----|
| API | https://campanha-360-ia-api.kxryyk.easypanel.host |
| Web | https://campanha-360-ia-web.kxryyk.easypanel.host |
| Worker (nao usar) | https://campanha-360-ia-worker.kxryyk.easypanel.host/ |
| Evolution API | https://infra-core-whatsapp-core.kxryyk.easypanel.host |

## Como validar a API (`/health`)

1. Confirme no EasyPanel que o app **api** esta com status *running*.
2. Acesse ou faca uma requisicao GET:

```bash
curl -s https://campanha-360-ia-api.kxryyk.easypanel.host/health
```

3. Resposta esperada:

```json
{
  "ok": true,
  "service": "campanha360-api"
}
```

Se falhar, verifique logs do container da API, variaveis `PORT`/`DATABASE_URL`/`REDIS_URL` e se o deploy usou a imagem mais recente do repositorio.

## Como validar a Web

1. Confirme no EasyPanel que o app **web** esta com status *running*.
2. Abra no navegador:

```
https://campanha-360-ia-web.kxryyk.easypanel.host
```

3. Validacoes minimas do bootstrap:
   - pagina inicial carrega com titulo **Campanha360 AI**;
   - link **Entrar** abre `/login`;
   - link **Ver painel** abre `/dashboard` com cards dos modulos planejados.

As paginas `/login` e `/dashboard` exigem autenticacao JWT (Fase 01).

## Migration falha (P3009) — recuperacao automatica

Se a API reiniciar em loop com `Error: P3009` na migration `20260706120000_init`, **basta redeployar a API** no EasyPanel.

O entrypoint (`scripts/api-entrypoint.sh`) detecta o P3009, executa `prisma migrate resolve --rolled-back` e reaplica `prisma migrate deploy` sem intervencao manual.

No log, deve aparecer:

```text
[api] Migration 20260706120000_init marcada como failed. Recuperacao automatica no deploy...
[api] Reaplicando migrations...
[api] Starting NestJS...
```

Depois valide `GET https://campanha-360-ia-api.kxryyk.easypanel.host/health`.

## Proximos passos operacionais

1. **Garantir `JWT_SECRET` forte** no app API.
2. **Confirmar migrations aplicadas** apos cada deploy da API.
3. **Confirmar health da API** e login na Web apos cada deploy.
4. **Configurar `NEXT_PUBLIC_API_URL`** no build da Web.
5. **Manter Postgres e Redis apenas na rede interna**.
6. **Proxima fase de produto:** `docs/fases/02-CAMPANHAS-CANDIDATOS.md`.
