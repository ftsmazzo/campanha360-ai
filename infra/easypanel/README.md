# EasyPanel

Apps previstos:

- `campanha360-web`
- `campanha360-api`
- `campanha360-worker`
- `postgres`
- `redis`

Configurar variaveis de ambiente pelo painel do EasyPanel.

Migrations rodam automaticamente no deploy da API (`scripts/api-entrypoint.sh`):
`prisma migrate deploy`, com recuperacao automatica de P3009 na migration init.

Nao e necessario executar comandos manuais no terminal nem SQL no Postgres para deploy normal.
