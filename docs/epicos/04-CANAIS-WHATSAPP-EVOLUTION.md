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
3. **04.3 — Webhook Evolution inbound.**
4. **04.4 — Inbox básico.**
5. **04.5 — Resposta manual.**
6. **04.6 — Hardening de canal.**

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

### Entregas previstas

- `EvolutionAdapter` ou serviço equivalente;
- leitura de `EVOLUTION_API_URL` e credenciais via env;
- métodos mínimos testáveis;
- tratamento padronizado de erro.

### Fora de escopo

- webhook;
- UI avançada;
- envio automático;
- IA.

## 8. Subetapa 04.3 — Webhook Evolution inbound

### Objetivo

Receber mensagens reais da Evolution e persistir no domínio.

### Entregas previstas

- endpoint de webhook;
- persistência de payload bruto;
- normalização de mensagem recebida;
- criação/associação de contato por telefone;
- criação de `Message` e `ConversationThread`;
- respeito a opt-out.

## 9. Subetapa 04.4 — Inbox básico

### Objetivo

Exibir conversas e mensagens para operação manual.

### Entregas previstas

- lista de conversas por campanha;
- detalhe de conversa com mensagens inbound/outbound;
- vínculo com contato;
- tela inicial de inbox.

## 10. Subetapa 04.5 — Resposta manual

### Objetivo

Permitir envio manual de mensagens pela Evolution com segurança.

### Entregas previstas

- envio manual via adapter;
- gravação de mensagem outbound;
- bloqueio se contato tiver opt-out;
- audit log.

## 11. Subetapa 04.6 — Hardening de canal

### Objetivo

Endurecer a operação de canais em produção.

### Entregas previstas

- validação de assinatura/token de webhook;
- idempotência por `externalMessageId`;
- logs de falha;
- prevenção de duplicidade.

## 12. Regras de tenancy

Toda entidade de canal deve carregar:

- `organizationId`;
- `campaignId`.

Toda consulta deve validar:

- usuário pertence à organização;
- recurso pertence à campanha;
- escrita exige papel adequado.

## 13. Critério final do épico

O sistema consegue receber mensagens reais via Evolution, agrupá-las em conversas, exibir inbox e permitir resposta manual segura, respeitando opt-out e consentimento.

## 14. Próximo passo após este documento

A subetapa **04.1 — Contas de canal por campanha** está concluída.

O próximo prompt ao Cursor deve executar apenas:

**04.2 — Adapter Evolution.**

Webhook, QR Code, inbox, envio, recebimento, IA e automações continuam fora do escopo até suas subetapas.
