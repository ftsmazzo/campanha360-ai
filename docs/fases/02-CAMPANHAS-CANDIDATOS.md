# Fase 2 - Campanhas e candidatos

Status: **concluida**

## Implementado

- CRUD inicial de campanhas vinculado a organizacao (listar, criar, detalhar, atualizar);
- organizacao ativa no dashboard (localStorage + seletor);
- cadastro e edicao do candidato por campanha (upsert);
- fase eleitoral e status da campanha;
- audit log para criacao/alteracao de campanha e candidato;
- rotas API conforme especificacao;
- UI para listar, criar e editar campanhas;
- UI para editar candidato da campanha.

## Rotas API

- `GET /campaigns?organizationId=`
- `POST /campaigns`
- `GET /campaigns/:id`
- `PUT /campaigns/:id`
- `GET /campaigns/:id/candidate`
- `PUT /campaigns/:id/candidate`

## UI

- `/dashboard` — selecao de organizacao ativa
- `/dashboard/campaigns` — lista e criacao de campanhas
- `/dashboard/campaigns/[id]` — edicao de campanha
- `/dashboard/campaigns/[id]/candidate` — edicao do candidato

## Migrations

Nenhuma migration nova: tabelas `Campaign`, `Candidate` e `AuditLog` ja existiam na migration init.

## Fora de escopo

- contatos;
- Evolution;
- IA;
- exclusao de campanhas;
- consulta de audit log na UI.

## Proxima fase

`docs/fases/03-CONTATOS-CONSENTIMENTO.md`
