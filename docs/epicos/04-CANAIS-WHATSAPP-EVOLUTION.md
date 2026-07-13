# Épico 04 — Canais e WhatsApp Evolution

## 1. Objetivo do épico

Preparar o Campanha360 AI para integração com canais externos de comunicação, começando pelo WhatsApp via Evolution API.

Ao final deste épico, a campanha deve conseguir:

- cadastrar contas de canal por campanha;
- conectar instâncias Evolution de forma isolada em adapter;
- receber mensagens via webhook;
- visualizar conversas em inbox básico;
- responder manualmente respeitando opt-out e consentimento;
- operar com segurança mínima (idempotência, logs, validação de webhook).

Este épico ainda **não** inclui IA automática, automações de disparo ou multi-canais avançados.

## 2. Contexto atual

O produto já possui:

- autenticação, organizações e memberships;
- campanhas e candidato;
- CRM operacional completo (contatos, tags, notas, tarefas, responsável, filtros, timeline);
- consentimento e opt-out por contato;
- modelos `ChannelAccount`, `ConversationThread` e `Message` no Prisma;
- enum `ChannelProvider` com providers futuros preparados;
- audit log inicial;
- deploy no EasyPanel.

Ainda falta a camada de integração real com provedores externos.

## 3. Princípio central

Canais devem ser tratados como **adapters**, não como dependência espalhada no domínio.

A Evolution API é o primeiro provider de WhatsApp, mas o código de negócio não deve depender de detalhes internos da Evolution. Isso permite convivência futura com WhatsApp Cloud API e outros canais.

## 4. Fora de escopo do épico inteiro

- IA assistiva (épico posterior);
- automações e disparos em massa;
- inbox avançado com atribuição complexa;
- Instagram, e-mail, SMS e Telegram operacionais (apenas preparação de enum nesta fase inicial);
- landing pages e captação pública;
- importação CSV avançada.

## 5. Subetapas do épico

1. **04.1 — Contas de canal por campanha.**
2. **04.2 — Adapter Evolution.**
3. **04.3 — Fluxo comercial de conexão WhatsApp.**
4. **04.4 — Webhook Evolution inbound.**
5. **04.5 — Inbox básico.**
6. **04.6 — Resposta manual.**
7. **04.7 — Hardening de canal.**

Nenhuma subetapa deve implementar itens futuros sem autorização explícita.

## 6. Subetapa 04.1 — Contas de canal por campanha

### Objetivo

Permitir que a equipe cadastre e gerencie contas de canal vinculadas à campanha, preparando a integração futura com Evolution e outros providers.

### Entregas

- CRUD inicial de `ChannelAccount` por campanha;
- provider inicial `WHATSAPP_EVOLUTION`;
- enum/lista preparada para providers futuros: `WHATSAPP_CLOUD_API`, `EMAIL`, `SMS`, `TELEGRAM`, `INSTAGRAM`;
- campos: `name`, `provider`, `status`, `externalAccountId` opcional, `config` JSON opcional, `organizationId`, `campaignId`;
- status: `DISCONNECTED`, `CONNECTING`, `CONNECTED`, `ERROR`, `ARCHIVED`;
- API REST com validação de tenancy;
- audit log: `CHANNEL_ACCOUNT_CREATED`, `CHANNEL_ACCOUNT_UPDATED`;
- UI em `/dashboard/campaigns/[id]/channels` com link "Canais" na campanha.

### Regras

- leitura para membros da organização;
- escrita apenas para `OWNER`, `ADMIN` ou `MANAGER`;
- não vazar contas entre campanhas ou organizações;
- `config` pode conter segredos — não expor em audit log completo;
- `config` não retorna na listagem; no GET individual e em create/update, retorna apenas para OWNER/ADMIN/MANAGER;
- não chamar Evolution API nesta subetapa.

### Fora de escopo

- webhook;
- QR Code;
- conexão real com Evolution;
- envio e recebimento de mensagens;
- inbox;
- IA;
- automações.

### Critério de aceite

Usuário com permissão consegue criar, listar e editar contas de canal na campanha, com provider e status visíveis, sem integração externa ativa.

### Status

**Concluída.**

### Implementado

- enum `ChannelAccountStatus` no Prisma e migration;
- módulo `channel-accounts` na API:
  - `GET /campaigns/:campaignId/channel-accounts`;
  - `POST /campaigns/:campaignId/channel-accounts`;
  - `GET /campaigns/:campaignId/channel-accounts/:channelAccountId`;
  - `PUT /campaigns/:campaignId/channel-accounts/:channelAccountId`;
- audit log `CHANNEL_ACCOUNT_CREATED` e `CHANNEL_ACCOUNT_UPDATED`;
- página `/dashboard/campaigns/[id]/channels` com listagem, criação e edição;
- link "Canais" na página da campanha;
- providers futuros listados na UI como "em breve".

### Fora de escopo (mantido)

- webhook;
- QR Code;
- conexão real com Evolution;
- envio;
- recebimento;
- inbox;
- IA;
- automações.

## 7. Subetapa 04.2 — Adapter Evolution

### Objetivo

Encapsular chamadas à Evolution API em serviço interno isolado.

### Entregas

- `EvolutionAdapter` isolado na API NestJS;
- leitura de `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` (opcional) via env;
- métodos mínimos: health/check, listar/buscar instâncias, criar/preparar instância, status de conexão e QR Code;
- endpoints administrativos por conta de canal:
  - `GET /campaigns/:campaignId/channel-accounts/:channelAccountId/evolution/status`
  - `POST /campaigns/:campaignId/channel-accounts/:channelAccountId/evolution/prepare`
  - `GET /campaigns/:campaignId/channel-accounts/:channelAccountId/evolution/qrcode`
- atualização de `externalAccountId` e `status` da `ChannelAccount` conforme retorno;
- audit log: `CHANNEL_EVOLUTION_PREPARED`, `CHANNEL_EVOLUTION_STATUS_CHECKED`, `CHANNEL_EVOLUTION_QRCODE_REQUESTED`.

### Regras

- escrita apenas para `OWNER`, `ADMIN` ou `MANAGER`;
- provider obrigatório `WHATSAPP_EVOLUTION`;
- nunca gravar API key em banco;
- nunca expor `EVOLUTION_API_KEY` no retorno;
- erros da Evolution tratados com mensagens seguras;
- HTTP da Evolution concentrado apenas no adapter.

### Fora de escopo

- webhook;
- tela comercial de conectar WhatsApp;
- QR Code na UI;
- envio e recebimento de mensagens;
- inbox;
- IA;
- automações.

### Critério de aceite

Administrador consegue preparar/consultar status/QR de uma conta Evolution via endpoints administrativos, sem UI comercial e sem webhook.

### Status

**Concluída.**

### Implementado

- módulo `apps/api/src/evolution/` com adapter, service e controller;
- envs documentadas em `.env.example`: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`;
- mapeamento conservador de estados Evolution → `ChannelAccountStatus`;
- respostas sem `config` sensível e sem API key.

### Fora de escopo (mantido)

- webhook;
- inbox;
- envio;
- recebimento;
- IA;
- automações.

> Nota: a tela comercial de conexão WhatsApp foi implementada na subetapa **04.3**.

## 8. Subetapa 04.3 — Fluxo comercial de conexão WhatsApp

### Objetivo

Transformar a tela técnica de canais em uma experiência simples para conectar WhatsApp via Evolution, sem exigir que o usuário entenda provider, externalAccountId ou config JSON.

### Entregas

- botão principal **Conectar WhatsApp** quando não houver conta `WHATSAPP_EVOLUTION` ativa;
- criação automática da conta com nome padrão "WhatsApp da campanha" e status `DISCONNECTED`;
- botão **Preparar conexão** para contas `DISCONNECTED` ou `ERROR` (chama `POST .../evolution/prepare`);
- botão **Gerar QR Code** quando a conta estiver preparada/`CONNECTING` (chama `GET .../evolution/qrcode`);
- exibição de QR Code (base64), código textual e pairing code quando disponíveis;
- status legível e mensagens de erro compreensíveis;
- formulário técnico movido para **Configurações avançadas**.

### Regras

- OWNER/ADMIN/MANAGER conectam/preparam/geram QR/editam avançado;
- VIEWER apenas visualiza status e contas;
- reutilizar endpoints da 04.2;
- sem webhook, inbox, envio ou recebimento nesta subetapa.

### Fora de escopo

- webhook;
- inbox;
- envio e recebimento de mensagens;
- IA;
- automações.

### Critério de aceite

Usuário com permissão consegue conectar WhatsApp pela UI comercial, ver QR Code e status, sem usar o formulário técnico.

### Status

**Concluída.**

### Implementado

- UI comercial em `/dashboard/campaigns/[id]/channels`;
- client Web: `prepareChannelEvolution`, `fetchChannelEvolutionStatus`, `fetchChannelEvolutionQrCode`;
- seção **Configurações avançadas** preservando CRUD técnico da 04.1.

### Fora de escopo (mantido)

- webhook;
- inbox;
- envio;
- recebimento;
- IA;
- automações.

## 9. Subetapa 04.4 — Webhook Evolution inbound

### Objetivo

Receber mensagens reais da Evolution e persistir no domínio.

### Entregas previstas

- endpoint de webhook;
- persistência de payload bruto;
- normalização de mensagem recebida;
- criação/associação de contato por telefone;
- criação de `Message` e `ConversationThread`;
- respeito a opt-out.

## 10. Subetapa 04.5 — Inbox básico

### Objetivo

Exibir conversas e mensagens para operação manual.

### Entregas previstas

- lista de conversas por campanha;
- detalhe de conversa com mensagens inbound/outbound;
- vínculo com contato;
- tela inicial de inbox.

## 11. Subetapa 04.6 — Resposta manual

### Objetivo

Permitir envio manual de mensagens pela Evolution com segurança.

### Entregas previstas

- envio manual via adapter;
- gravação de mensagem outbound;
- bloqueio se contato tiver opt-out;
- audit log.

## 12. Subetapa 04.7 — Hardening de canal

### Objetivo

Endurecer a operação de canais em produção.

### Entregas previstas

- validação de assinatura/token de webhook;
- idempotência por `externalMessageId`;
- logs de falha;
- prevenção de duplicidade.

## 13. Regras de tenancy

Toda entidade de canal deve carregar:

- `organizationId`;
- `campaignId`.

Toda consulta deve validar:

- usuário pertence à organização;
- recurso pertence à campanha;
- escrita exige papel adequado.

## 14. Critério final do épico

O sistema consegue receber mensagens reais via Evolution, agrupá-las em conversas, exibir inbox e permitir resposta manual segura, respeitando opt-out e consentimento.

## 15. Próximo passo após este documento

A subetapa **04.3 — Fluxo comercial de conexão WhatsApp** está concluída.

O próximo prompt ao Cursor deve executar apenas:

**04.4 — Webhook Evolution inbound.**

Webhook, inbox, envio, recebimento, IA e automações continuam fora do escopo até suas subetapas.
