# Deploy inicial no EasyPanel

Documentacao do ambiente real ja implantado para o projeto **Campanha360 AI** no EasyPanel (host `kxryyk.easypanel.host`).

Este documento descreve o estado atual pos-bootstrap (Fase 00). Autenticacao e modulos de dominio ainda nao foram implementados.

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

```
postgresql://campanha360:v5i3ub8rt6pffzps8u7q@campanha-360-ia_postgres:5432/campanha360_ai?sslmode=disable
```

- **Usuario:** `campanha360`
- **Banco:** `campanha360_ai`
- **SSL:** desabilitado na rede interna do EasyPanel (`sslmode=disable`)

### Redis

Cache e filas (BullMQ). Usado pela API e pelo Worker.

```
redis://default:dkecpice48usppahfbwl@campanha-360-ia_redis:6379
```

- **Usuario:** `default`

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

### API

| Variavel | Valor no ambiente implantado | Observacao |
|----------|-------------------------------|------------|
| `DATABASE_URL` | `postgresql://campanha360:v5i3ub8rt6pffzps8u7q@campanha-360-ia_postgres:5432/campanha360_ai?sslmode=disable` | Host interno do Postgres |
| `REDIS_URL` | `redis://default:dkecpice48usppahfbwl@campanha-360-ia_redis:6379` | Host interno do Redis |
| `PORT` | `3001` | Porta escutada pelo NestJS dentro do container |
| `WEB_PUBLIC_URL` | `https://campanha-360-ia-web.kxryyk.easypanel.host` | Usada no CORS da API |
| `API_PUBLIC_URL` | `https://campanha-360-ia-api.kxryyk.easypanel.host` | Referencia publica da API (fases futuras) |
| `JWT_SECRET` | definir valor forte no painel | Obrigatorio antes da Fase 01 (Auth) |
| `EVOLUTION_API_URL` | `https://infra-core-whatsapp-core.kxryyk.easypanel.host` | Reservado para fases de canal WhatsApp |
| `NODE_ENV` | `production` | Padrao do Dockerfile |

### Web

| Variavel | Valor no ambiente implantado | Observacao |
|----------|-------------------------------|------------|
| `PORT` | `3000` | Porta do Next.js dentro do container |
| `WEB_PUBLIC_URL` | `https://campanha-360-ia-web.kxryyk.easypanel.host` | URL canonica do frontend |
| `API_PUBLIC_URL` | `https://campanha-360-ia-api.kxryyk.easypanel.host` | Base da API para chamadas do browser (Fase 01+) |
| `NODE_ENV` | `production` | Padrao do Dockerfile |

### Worker

| Variavel | Valor no ambiente implantado | Observacao |
|----------|-------------------------------|------------|
| `DATABASE_URL` | `postgresql://campanha360:v5i3ub8rt6pffzps8u7q@campanha-360-ia_postgres:5432/campanha360_ai?sslmode=disable` | Mesmo banco da API |
| `REDIS_URL` | `redis://default:dkecpice48usppahfbwl@campanha-360-ia_redis:6379` | Filas BullMQ |
| `NODE_ENV` | `production` | Padrao do Dockerfile |

### Postgres e Redis

Configurados pelo proprio EasyPanel ao provisionar os servicos. As connection strings acima ja refletem usuario, senha e host internos gerados pelo painel.

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

As paginas `/login` e `/dashboard` sao estaticas nesta fase; login ainda nao funciona (Fase 01).

## Proximos passos antes da Fase 01

1. **Garantir `JWT_SECRET` forte** no app API (valor unico, nao usar o placeholder do `.env.example`).
2. **Rodar migrations Prisma em producao** no processo de deploy da API (`prisma migrate deploy`), conforme `infra/easypanel/README.md`.
3. **Confirmar health da API** e carregamento da Web apos cada deploy.
4. **Manter Postgres e Redis apenas na rede interna**; nao expor credenciais fora do EasyPanel.
5. **Ignorar a URL publica do worker** para integracoes; apenas monitorar logs ate haver jobs reais.
6. **Iniciar Fase 01 (Auth e tenancy)** com as variaveis acima ja configuradas:
   - `POST /auth/register`, `POST /auth/login`, `GET /auth/me`;
   - organizacoes e memberships;
   - tela de login funcional apontando para `API_PUBLIC_URL`.

Nao implementar autenticacao antes de concluir estes passos de validacao do ambiente implantado.
