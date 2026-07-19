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

### Ajuste de UX — múltiplos canais WhatsApp

A tela foi remodelada para um **painel único de canais**:

- botão **Novo canal WhatsApp** com formulário simples (nome + instância Evolution opcional);
- cada conta `WHATSAPP_EVOLUTION` ativa aparece como **card próprio** com ações isoladas;
- QR Code, loading e mensagens ficam no card correspondente;
- criar um novo canal não oculta nem substitui canais anteriores;
- **Arquivar canal** usa `PUT` com status `ARCHIVED` e remove o card do painel;
- arquivar **não** exclui a instância na Evolution (exclusão real fica fora do escopo);
- configurações avançadas ficam recolhidas por card.

### Fora de escopo (mantido)

- webhook;
- inbox;
- envio;
- recebimento;
- IA;
- automações;
- exclusão real da instância na Evolution.

## 9. Subetapa 04.4 — Webhook Evolution inbound

### Objetivo

Receber mensagens reais da Evolution e persistir no domínio do Campanha360, sem inbox.

### Entregas

- endpoint público `POST /webhooks/evolution/:channelAccountId`;
- validação da conta (`WHATSAPP_EVOLUTION`, não `ARCHIVED`);
- normalização mínima (externalMessageId, telefone, texto, timestamp);
- persistência de `Contact`, `ConversationThread` e `Message` inbound;
- deduplicação por `externalMessageId` quando disponível;
- respeito a opt-out (ainda grava inbound; marca `optOutActive: true` no `rawPayload`);
- audit/log seguro sem payload completo sensível.

### URL esperada

```text
{API_PUBLIC_URL}/webhooks/evolution/{channelAccountId}
```

Exemplo:

```text
https://campanha-360-ia-api.kxryyk.easypanel.host/webhooks/evolution/<channelAccountId>
```

O **prepare** sincroniza este URL na Evolution (e `jwt_key` quando `EVOLUTION_WEBHOOK_SECRET` existe).
A URL continua visível na UI de Canais para diagnóstico.

### Segurança

- env opcional `EVOLUTION_WEBHOOK_SECRET`;
- no prepare, a API sincroniza automaticamente o webhook na Evolution com a URL acima e,
  se o secret existir, `headers.jwt_key` — a Evolution envia `Authorization: Bearer <JWT HS256>`
  (claims `app=evolution`, `action=webhook`);
- alternativa manual: header estático `x-evolution-webhook-secret` (ou legado
  `x-campanha360-webhook-secret`) com o valor cru do secret;
- se **não** existir `EVOLUTION_WEBHOOK_SECRET`, o webhook é aceito sem autenticação
  (apenas homologação/teste) — documentado em `.env.example`;
- `API_PUBLIC_URL` é necessário para o sync automático no prepare;
- `GET /webhooks/evolution/:channelAccountId/health` não exige secret.

### Regras

- não implementar inbox;
- não implementar envio de mensagens;
- não implementar resposta automática;
- não implementar IA nem automações;
- preservar conexão/QR já validada e `GET /health`.

### Critério de aceite

A Evolution consegue enviar webhook para a API; mensagens inbound são normalizadas e persistidas no domínio, com dedup e opt-out respeitado (sem auto-resposta).

### Status

**Concluída.**

### Implementado

- módulo `apps/api/src/webhooks/`;
- índices Prisma em `Message` (externalMessageId) e `ConversationThread` (lookup por conta/contato);
- audit `CHANNEL_EVOLUTION_WEBHOOK_PROCESSED` / `CHANNEL_EVOLUTION_WEBHOOK_IGNORED` /
  `CHANNEL_EVOLUTION_WEBHOOK_SYNCED`;
- sync automático do webhook no prepare (`setInstanceWebhook` com `jwt_key` quando secret existe);
- env `EVOLUTION_WEBHOOK_SECRET` em `.env.example`.

### Fora de escopo (mantido)

- inbox;
- envio de mensagens;
- resposta automática;
- IA;
- automações.

## 10. Subetapa 04.5 — Inbox básico

### Objetivo

Exibir conversas e mensagens para operação manual (somente leitura nesta etapa).

### Entregas

- API de listagem/detalhe de conversas por campanha;
- tela `/dashboard/campaigns/[id]/inbox` (Atendimento);
- lista de conversas com última mensagem;
- detalhe com histórico inbound/outbound (sem envio);
- vínculo com contato e indicação de opt-out;
- navegação a partir da campanha;
- estados vazios e de erro.

### Regras

- leitura para membros da organização da campanha;
- tenancy por `organizationId` + `campaignId`;
- não implementar envio de mensagem;
- não implementar IA nem automações;
- não alterar autenticação/configuração do webhook Evolution.

### Critério de aceite

Operador consegue abrir Atendimento na campanha, ver conversas geradas pelo webhook e abrir o histórico de uma conversa.

### Status

**Concluída.**

### Implementado

- módulo `apps/api/src/inbox/`:
  - `GET /campaigns/:campaignId/inbox/threads`
  - `GET /campaigns/:campaignId/inbox/threads/:threadId`
- página `/dashboard/campaigns/[id]/inbox`;
- link **Atendimento** na página da campanha.

### Fora de escopo (mantido)

- IA;
- automações;
- atribuição complexa de inbox.

## 11. Subetapa 04.6 — Resposta manual

### Objetivo

Permitir envio manual de mensagens pela Evolution com segurança, a partir do Atendimento.

### Entregas

- campo e botão de resposta no detalhe da conversa;
- `POST /campaigns/:campaignId/inbox/threads/:threadId/messages`;
- envio via Evolution `POST /message/sendText/{instance}`;
- persistência de `Message` outbound;
- bloqueio de envio vazio e de contato com opt-out/BLOCKED;
- canal precisa estar `CONNECTED`;
- audit `INBOX_MANUAL_REPLY_SENT`;
- atualização local do histórico sem reload (polling continua).

### Regras

- escrita apenas para OWNER/ADMIN/MANAGER;
- não implementar IA, automação, templates ou mídia;
- não alterar autenticação do webhook;
- usar `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`.

### Critério de aceite

Operador envia texto simples pelo Atendimento; a mensagem aparece como enviada no histórico e chega no WhatsApp; inbound continua atualizando via polling.

### Status

**Concluída.**

### Implementado

- `EvolutionAdapter.sendTextMessage`;
- `InboxService.sendReply`;
- UI de resposta no inbox;
- util/testes de normalização de body e telefone.

### Fora de escopo (mantido)

- IA;
- automações;
- templates;
- anexos/mídia;
- múltiplos operadores.

## 12. Subetapa 04.7 — Acabamento operacional do Atendimento

### Objetivo

Melhorar confiabilidade e usabilidade do Atendimento já funcional, sem abrir novos módulos.

### Entregas

- estados de envio claros (enviando / enviado / erro);
- erro amigável no envio e persistência de outbound com status `ERROR`;
- botão discreto **Tentar reenviar** para outbound com falha;
- prevenção de duplo clique durante envio;
- timestamps relativos + ordenação estável;
- diferenciação visual inbound/outbound/erro;
- empty states da lista e do detalhe;
- opt-out/BLOCKED como bloqueio explícito de envio;
- polling preservado (pausa durante envio; falha não quebra a tela).

### Regras

- não implementar IA, automação, templates, mídia ou disparo em massa;
- não alterar webhook Evolution nem configuração de instância;
- sem migration (status `ERROR` usa campo `Message.status` existente).

### Critério de aceite

Operador envia resposta com feedback claro; falha aparece no histórico com opção de reenvio; inbound continua atualizando via polling.

### Status

**Concluída.**

### Implementado

- `InboxService.sendReply` persiste `ERROR` e retorna `failedMessage` no HTTP 502;
- `POST .../messages/:messageId/retry`;
- UI de Atendimento com estados, retry, empty states e opt-out/BLOCKED.

### Fora de escopo (mantido)

- IA;
- automações;
- templates;
- mídia;
- hardening avançado de webhook (já tratado em 04.4).

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

A subetapa **04.7 — Acabamento operacional do Atendimento** está concluída.

O épico **04 — Canais e WhatsApp Evolution** fica operacionalmente fechado para inbox + resposta manual.

Próximo épico documentado: **05 — Base de Contatos da Campanha** (`docs/epicos/05-BASE-CONTATOS-CAMPANHA.md`), começando por **05.1**.

Próximos épicos de IA/automações apenas quando autorizados.
