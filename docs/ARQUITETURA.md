# Arquitetura

## Objetivo

SaaS multi-campanha para gestao de bases eleitorais, canais, conversas e IA assistiva.

## Apps

- `apps/web`: painel e paginas publicas.
- `apps/api`: API NestJS.
- `apps/worker`: jobs assincronos.

## Modulos planejados

- Auth
- Organizations
- Campaigns
- Candidates
- Contacts
- Consents
- Segments
- Imports
- Channels
- Evolution
- Conversations
- Messages
- AI
- Compliance
- Audit
- Landing Pages

## Regra de tenancy

Toda entidade de dominio deve carregar `organizationId`; entidades de campanha tambem carregam `campaignId`.

## Canal WhatsApp

O MVP usa Evolution API. A arquitetura deve isolar a Evolution em um adapter para permitir WhatsApp Cloud API no futuro.

## Compliance

O sistema deve registrar origem, consentimento, opt-out e auditoria. Antes de campanha oficial, deve bloquear pedido explicito de voto.
