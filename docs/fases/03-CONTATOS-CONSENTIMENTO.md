# Fase 3 - Contatos, consentimento e opt-out

Status: **concluida**

## Implementado

- CRUD inicial de contatos vinculados a organizacao e campanha;
- listagem de contatos por campanha;
- criacao e edicao manual de contato;
- campos: nome, telefone, e-mail, cidade, bairro, status e metadata;
- canais sincronizados (WhatsApp e e-mail) em `ContactChannel`;
- consentimento por canal com origem registrada;
- opt-out basico por contato/canal;
- validacoes minimas de telefone e e-mail;
- audit log para contato, consentimento e opt-out;
- UI dentro da campanha para gerenciar contatos.

## Rotas API

- `GET /campaigns/:campaignId/contacts`
- `POST /campaigns/:campaignId/contacts`
- `GET /campaigns/:campaignId/contacts/:contactId`
- `PUT /campaigns/:campaignId/contacts/:contactId`
- `PUT /campaigns/:campaignId/contacts/:contactId/consents`
- `POST /campaigns/:campaignId/contacts/:contactId/opt-out`

## UI

- `/dashboard/campaigns/[id]/contacts` — lista
- `/dashboard/campaigns/[id]/contacts/new` — criacao
- `/dashboard/campaigns/[id]/contacts/[contactId]` — edicao, consentimento e opt-out

## Migrations

Nenhuma migration nova: tabelas ja existiam na migration init.

## Fora de escopo

- importacao CSV;
- tags e segmentos;
- Evolution;
- IA;
- disparos/mensageria;
- consulta de audit log na UI.

## Proxima fase

`docs/fases/04-EVOLUTION-INBOX-IA.md`
