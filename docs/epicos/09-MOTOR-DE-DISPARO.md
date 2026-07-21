# Épico 09 — Motor de Disparo

## 1. Objetivo do épico

O objetivo deste épico é transformar um Plano de Disparo aprovado em uma execução real, controlada, auditável, recuperável e segura.

O Épico 08 encerrou o planejamento:

- Plano criado;
- público congelado;
- elegibilidade registrada;
- blindagens aplicadas;
- simulação persistida;
- aprovação explícita;
- imutabilidade garantida.

O Épico 09 inicia a execução operacional.

Ao final deste épico, o Campanha360 AI deverá permitir:

- criar um Disparo a partir de um Plano aprovado;
- materializar os destinatários elegíveis em itens individuais;
- preparar e enfileirar os itens;
- processar os envios por Worker;
- utilizar o adapter da Evolution API;
- controlar velocidade e janela operacional;
- pausar;
- retomar;
- cancelar;
- interromper emergencialmente;
- realizar retries seguros;
- recuperar a execução após falhas;
- evitar envios duplicados;
- acompanhar progresso e resultados;
- executar um piloto real com limite rígido.

---

## 2. Princípio central

Nenhuma mensagem pode ser enviada diretamente pelo frontend, controller, service HTTP ou loop síncrono da API.

O fluxo obrigatório será:

Plano aprovado

↓

Dispatch

↓

DispatchItems

↓

BullMQ

↓

Worker

↓

Channel Adapter

↓

Evolution API

↓

Persistência do resultado

↓

Webhook e atualização de status

↓

Relatórios

A API coordena.

O banco é a fonte de verdade.

O BullMQ organiza a execução.

O Worker envia.

O adapter traduz a comunicação com o provider.

---

## 3. Pré-condições para iniciar este épico

O Épico 09 só pode ser implementado porque o sistema já possui:

- organizações e campanhas;
- autenticação;
- permissões;
- CRM operacional;
- contatos;
- opt-out;
- bloqueio;
- exclusão lógica;
- segmentos;
- pré-validação;
- Plano de Disparo;
- snapshot persistido;
- recipients elegíveis e excluídos;
- blindagens;
- simulação;
- aprovação;
- imutabilidade;
- canais WhatsApp Evolution;
- conexão por QR Code;
- webhook autenticado;
- mensagens inbound e outbound;
- Redis;
- BullMQ;
- Worker disponível na infraestrutura;
- audit log.

---

## 4. Resultado arquitetural esperado

Ao final, o fluxo será:

Segmento

↓

DispatchPlan

↓

DispatchPlanRecipient

↓

Aprovação

↓

Dispatch

↓

DispatchItem

↓

Job BullMQ

↓

Worker

↓

Evolution Adapter

↓

Provider

↓

Webhook

↓

Status individual

↓

Métricas consolidadas

---

## 5. Fora de escopo deste épico

Não implementar neste épico:

- IA para criação de conteúdo;
- geração automática de mensagens;
- automações comportamentais;
- jornadas;
- nutrição;
- e-mail;
- SMS;
- Telegram;
- Instagram;
- templates avançados;
- mídia;
- chatbot de campanha;
- segmentação por inferência;
- persuasão baseada em atributos sensíveis;
- otimização automática de conteúdo;
- testes A/B;
- agendamento recorrente;
- múltiplos providers de WhatsApp;
- dashboards analíticos avançados;
- cobrança;
- franquia de mensagens;
- marketplace de canais.

O foco é criar um motor confiável para texto via WhatsApp Evolution.

---

## 6. Subetapas do épico

O Épico 09 será dividido em:

1. 09.1 — Entidade Dispatch.
2. 09.2 — Materialização dos DispatchItems.
3. 09.3 — Preparação e Enfileiramento.
4. 09.4 — Worker de Envio.
5. 09.5 — Controle Operacional.
6. 09.6 — Retry, Idempotência e Recuperação.
7. 09.7 — Monitoramento e Relatórios.
8. 09.8 — Piloto Controlado.

A ordem deve ser respeitada.

Nenhuma etapa deve antecipar responsabilidades das seguintes.

---

# 7. Subetapa 09.1 — Entidade Dispatch

## 7.1 Objetivo

Criar a entidade que representa uma execução derivada de um Plano aprovado.

Nesta subetapa:

- não criar DispatchItems;
- não criar jobs;
- não chamar Evolution;
- não enviar mensagens.

O Dispatch será apenas o registro imutável da execução futura.

---

## 7.2 Princípio

O Dispatch nasce exclusivamente de um `DispatchPlan` com status `APPROVED`.

Não deve ser possível criar um Dispatch:

- diretamente de um Segment;
- diretamente de uma lista de contatos;
- diretamente do frontend sem Plano;
- a partir de Plano DRAFT;
- a partir de Plano VALIDATED não aprovado;
- a partir de Plano REJECTED;
- a partir de Plano CANCELED;
- a partir de Plano EXPIRED.

---

## 7.3 Entidade Dispatch

Campos conceituais:

- id;
- organizationId;
- campaignId;
- dispatchPlanId;
- channelAccountId;
- name;
- description opcional;
- channelType;
- contentSnapshot;
- configurationSnapshot;
- approvalSnapshot;
- status;
- totalItems;
- pendingItems;
- queuedItems;
- processingItems;
- sentItems;
- deliveredItems;
- readItems;
- failedItems;
- skippedItems;
- canceledItems;
- createdByUserId;
- createdAt;
- updatedAt;
- preparedAt opcional;
- queuedAt opcional;
- startedAt opcional;
- pausingAt opcional;
- pausedAt opcional;
- resumedAt opcional;
- completedAt opcional;
- failedAt opcional;
- canceledAt opcional;
- emergencyStoppedAt opcional;
- lastProgressAt opcional.

---

## 7.4 Status do Dispatch

Enum sugerido:

- DRAFT;
- PREPARING;
- READY;
- QUEUED;
- RUNNING;
- PAUSING;
- PAUSED;
- COMPLETED;
- COMPLETED_WITH_ERRORS;
- FAILED;
- CANCELED;
- EMERGENCY_STOPPED.

Na 09.1, utilizar apenas:

- DRAFT;
- READY, se a criação já puder concluir as verificações iniciais.

A máquina completa será ativada progressivamente.

---

## 7.5 Snapshots obrigatórios

O Dispatch deve copiar do Plano aprovado:

### contentSnapshot

- tipo;
- conteúdo aprovado;
- hash SHA-256;
- comprimento;
- versão.

### configurationSnapshot

- velocidade solicitada;
- velocidade efetiva;
- delays;
- lote;
- pausa entre lotes;
- timezone;
- janela;
- dias permitidos;
- início estimado;
- fim estimado.

### approvalSnapshot

- dados da aprovação;
- versão aprovada;
- responsável;
- totais;
- validação;
- simulação.

O Dispatch não deve depender de campos editáveis do Plano durante a execução.

---

## 7.6 Criação do Dispatch

Rota conceitual:

`POST /campaigns/:campaignId/dispatch-plans/:dispatchPlanId/create-dispatch`

Ou:

`POST /campaigns/:campaignId/dispatches`

com `dispatchPlanId` no body.

A implementação deve seguir o padrão de rotas predominante do projeto.

---

## 7.7 Pré-condições

Antes de criar:

- Plano existe;
- Plano pertence à organização e campanha;
- Plano está APPROVED;
- Plano é imutável;
- approvalSnapshot existe;
- approvedAt existe;
- approvedByUserId existe;
- snapshot existe;
- totalEligible maior que zero;
- validationSnapshot passou;
- simulationSnapshot é atual;
- conteúdo possui hash;
- canal existe;
- canal pertence à campanha;
- provider é WHATSAPP_EVOLUTION;
- usuário possui permissão;
- não existe outro Dispatch ativo para o mesmo Plano.

---

## 7.8 Unicidade

Um Plano aprovado deve gerar no máximo um Dispatch ativo.

Sugestão:

- chave única por dispatchPlanId;
- ou regra de negócio equivalente.

Se houver cancelamento antes de qualquer materialização, a política de recriação deve ser definida explicitamente.

Preferência inicial:

- um Plano aprovado gera apenas um Dispatch;
- para nova tentativa, duplicar o Plano em etapa futura.

---

## 7.9 Permissões

Criar Dispatch:

- OWNER;
- ADMIN.

MANAGER:

- visualiza;
- não cria execução real inicialmente.

VIEWER:

- somente leitura.

Isso pode ser ampliado futuramente.

---

## 7.10 Audit log

Registrar:

- DISPATCH_CREATED.

Metadata segura:

- dispatchId;
- dispatchPlanId;
- version;
- totalEligible;
- channelAccountId;
- channelType;
- contentHash;
- status;
- createdAt.

Não registrar conteúdo completo.

---

## 7.11 Web

Adicionar ao Plano APPROVED:

- ação “Criar Disparo”;
- apenas OWNER/ADMIN;
- confirmação explícita;
- aviso de que a criação ainda não inicia os envios nesta subetapa.

Criar páginas:

- `/dashboard/campaigns/[id]/dispatches`
- `/dashboard/campaigns/[id]/dispatches/[dispatchId]`

Listagem inicial:

- nome;
- status;
- Plano de origem;
- canal;
- total previsto;
- data de criação.

Detalhe inicial:

- Plano de origem;
- público;
- conteúdo resumido;
- configuração;
- aprovação;
- status;
- aviso de que ainda não há execução.

---

## 7.12 Critério de aceite da 09.1

A subetapa estará concluída quando:

- Dispatch nasce apenas de Plano APPROVED;
- snapshots são copiados;
- Plano não é alterado;
- não há items;
- não há jobs;
- não há envio;
- tenancy funciona;
- permissões funcionam;
- auditoria funciona;
- build e testes passam.

### Status da 09.1 — CONCLUÍDA

Implementação registrada:

- **Modelagem:** enum `DispatchStatus` e modelo `Dispatch` no Prisma; unicidade por `dispatchPlanId`; contadores e timestamps operacionais; sem `DispatchItem`.
- **Status inicial:** criação sempre em `DRAFT`.
- **Rota de criação:** `POST /campaigns/:campaignId/dispatches` com body `{ dispatchPlanId }` (recurso próprio, alinhado ao padrão de listagem/detalhe).
- **Listagem:** `GET /campaigns/:campaignId/dispatches` com paginação, filtro `status` e busca por nome/plano; sem snapshots completos.
- **Detalhe:** `GET /campaigns/:campaignId/dispatches/:dispatchId` com snapshots, contadores, timestamps e `allowedActions` (`canPrepare=false` nesta subetapa).
- **Snapshots:** `contentSnapshot` (conteúdo aprovado + hash), `configurationSnapshot` (da simulação) e `approvalSnapshot` (cópia do Plano).
- **Hash:** SHA-256 recalculado do conteúdo aprovado e comparado com o hash do `approvalSnapshot`; divergência rejeita criação.
- **Permissões:** criar = OWNER/ADMIN; listar/detalhar = membros da organização; MANAGER/VIEWER não criam.
- **Unicidade:** constraint única em `dispatchPlanId` + `ConflictException` explícito (não retorna o existente).
- **Canal na criação:** canal ausente, de outra campanha, ARCHIVED ou provider ≠ `WHATSAPP_EVOLUTION` bloqueiam. Canal `DISCONNECTED` após aprovação **não** bloqueia na 09.1; revalidação fica para preparação/envio (09.2+).
- **Audit log:** `DISPATCH_CREATED` com metadata segura (`contentHash`, sem conteúdo/telefones/credenciais).
- **Web:** link Disparos na campanha; listagem e detalhe; botão “Criar Disparo” no Plano APPROVED (OWNER/ADMIN) com confirmação e tratamento de conflito.
- **Fora de escopo preservado:** DispatchItem, prepare, BullMQ, Worker, Evolution send, fila, pause/resume/cancel/emergency, retry, reconciliação.

Migration: `prisma/migrations/20260721173000_dispatch_entity`.

---

# 8. Subetapa 09.2 — Materialização dos DispatchItems

## 8.1 Objetivo

Transformar cada recipient elegível do Plano em um item individual de execução.

Ainda não enviar mensagens.

---

## 8.2 Entidade DispatchItem

Campos conceituais:

- id;
- organizationId;
- campaignId;
- dispatchId;
- dispatchPlanId;
- dispatchPlanRecipientId;
- contactId;
- channelAccountId;
- destination;
- normalizedDestination;
- contentSnapshot;
- status;
- attemptCount;
- maxAttempts;
- scheduledAt opcional;
- queuedAt opcional;
- lockedAt opcional;
- lockToken opcional;
- startedAt opcional;
- sentAt opcional;
- deliveredAt opcional;
- readAt opcional;
- failedAt opcional;
- skippedAt opcional;
- canceledAt opcional;
- providerMessageId opcional;
- providerStatus opcional;
- errorCategory opcional;
- errorCode opcional;
- errorMessage opcional;
- lastAttemptAt opcional;
- nextRetryAt opcional;
- metadata opcional;
- createdAt;
- updatedAt.

---

## 8.3 Status do DispatchItem

Enum sugerido:

- PENDING;
- SCHEDULED;
- QUEUED;
- PROCESSING;
- SENT;
- DELIVERED;
- READ;
- RETRY_SCHEDULED;
- FAILED;
- SKIPPED;
- CANCELED;
- UNKNOWN_PROVIDER_STATE.

---

## 8.4 Fonte dos itens

Criar items somente a partir de:

`DispatchPlanRecipient.eligibilityStatus = ELIGIBLE`

Não criar item para recipients:

- opt-out;
- BLOCKED;
- DELETED;
- inválidos;
- duplicados;
- sem canal;
- excluídos por política;
- outros excluídos.

---

## 8.5 Imutabilidade

Cada item deve guardar:

- destino normalizado;
- contato de origem;
- conteúdo congelado;
- canal;
- Plano;
- Dispatch;
- recipient de origem.

Alterações posteriores no contato não devem modificar o snapshot do item.

Entretanto, o Worker deverá revalidar opt-out e bloqueios atuais antes do envio.

---

## 8.6 Unicidade

Garantir:

- um item por Dispatch e recipient;
- um item elegível por Dispatch e normalizedDestination.

Restrições sugeridas:

- unique dispatchId + dispatchPlanRecipientId;
- unique dispatchId + normalizedDestination.

---

## 8.7 Materialização explícita

Ação sugerida:

`POST /campaigns/:campaignId/dispatches/:dispatchId/prepare`

A ação deve:

1. validar Dispatch;
2. validar status DRAFT;
3. alterar para PREPARING;
4. buscar recipients elegíveis;
5. criar items em lotes;
6. conferir totais;
7. atualizar contadores;
8. definir preparedAt;
9. alterar status para READY;
10. registrar auditoria.

---

## 8.8 Atomicidade

Se ocorrer falha:

- não deixar conjunto parcial inconsistente;
- rollback quando possível;
- ou operação idempotente recuperável.

A materialização deve poder ser repetida com segurança sem duplicar items.

---

## 8.9 Conteúdo do item

Na primeira versão, cada item pode copiar o mesmo texto do Dispatch.

Futuramente poderá existir personalização por destinatário.

Não implementar variáveis nesta subetapa.

---

## 8.10 Audit log

Registrar:

- DISPATCH_PREPARATION_STARTED;
- DISPATCH_PREPARED;
- DISPATCH_PREPARATION_FAILED.

Metadata:

- dispatchId;
- totalExpected;
- totalCreated;
- duration;
- status.

---

## 8.11 Web

No detalhe do Dispatch:

- botão “Preparar destinatários”;
- apenas quando DRAFT;
- confirmação;
- progresso simples;
- resumo ao concluir.

Mostrar:

- total previsto;
- total materializado;
- pendentes;
- inconsistências, se existirem.

Ainda sem botão de iniciar envio.

---

## 8.12 Critério de aceite da 09.2

A subetapa estará concluída quando:

- somente elegíveis geram items;
- não há duplicidade;
- conteúdo está congelado;
- totals são consistentes;
- Dispatch chega a READY;
- nenhuma fila é criada;
- nenhuma mensagem é enviada;
- operação é idempotente;
- testes passam.

### Status da 09.2 — CONCLUÍDA

Implementação registrada:

- **Modelagem:** enums `DispatchItemStatus` e `DispatchItemErrorCategory`; modelo `DispatchItem` com snapshots, unicidade `(dispatchId, dispatchPlanRecipientId)` e `(dispatchId, normalizedDestination)`; `providerMessageId` indexado (sem unique global).
- **Status operacional:** items nascem `PENDING`; Dispatch passa `DRAFT → PREPARING → READY`.
- **Fonte:** apenas `DispatchPlanRecipient` com `eligibilityStatus = ELIGIBLE` do Plano aprovado; sem recalcular Segment.
- **Rota prepare:** `POST /campaigns/:campaignId/dispatches/:dispatchId/prepare` (OWNER/ADMIN).
- **Listagem:** `GET .../dispatches/:dispatchId/items` paginada; destination mascarado; sem body completo.
- **Detalhe de item:** `GET .../items/:dispatchItemId` implementado (mascarado + contentSnapshot).
- **Atomicidade:** transação `createMany` + update condicional para READY; falha sem items → volta para `DRAFT`.
- **Idempotência:** READY ou items existentes → `ConflictException`; claim condicional `DRAFT → PREPARING`.
- **Canal:** preparação exige canal `CONNECTED` (ARCHIVED/outro tenant/provider inválido bloqueiam).
- **Contadores:** `totalItems`/`pendingItems` = criados; demais zerados; `preparedAt` preenchido.
- **Audit:** `DISPATCH_PREPARATION_STARTED`, `DISPATCH_PREPARED`, `DISPATCH_PREPARATION_FAILED` (metadata sem telefones/conteúdo).
- **Web:** botão Preparar destinatários, progresso, tabela paginada, aviso 09.3.
- **Fora de escopo:** BullMQ, fila, Worker, Evolution send, queue/start/pause/retry.

Migration: `prisma/migrations/20260721180000_dispatch_item_materialization`.

---

## Extensao multi-instancia (motor)

### Entidade DispatchChannel

Materializada na criacao do `Dispatch` a partir de `DispatchPlanChannel`:

- `dispatchPlanChannelId`, `channelAccountId`, `priority`, `weight`;
- `effectiveDailyLimit`, `assignedItems`, contadores operacionais;
- `operationalStatus` (`READY`, `PAUSED`, `COOLDOWN`, `BLOCKED`, `DISABLED`);
- `cooldownUntil`, `consecutiveErrors`.

Relacionamento: `Dispatch.channels[]`.

### DispatchItem.dispatchChannelId

Cada item materializado referencia o canal de execucao:

- `dispatchChannelId` — instancia atual;
- `originalDispatchChannelId` — instancia da distribuicao inicial;
- `reassignmentCount`, `lastReassignedAt` — historico de failover.

Distribuicao na preparacao: **CAPACITY_WEIGHTED** (mesma estrategia do Plano).

### Flags no Dispatch

- `multiInstance` — derivado do Plano (`multiInstanceEnabled` e nao legado);
- `requiringRedistribution` — pool operacional desalinhado; **bloqueia enfileiramento** ate redistribuicao.

### legacySingleChannel / requiringRedistribution

- Planos `legacySingleChannel=true` com pool >1 instancia nao geram Dispatch multi-instancia sem reabertura;
- `requiringRedistribution=true` apos materializacao legada READY (ou desalinhamento do pool) exige `POST .../dispatches/:id/redistribute` antes de enfileirar.

### Failover (regras conceituais)

Quando uma instancia entra em cooldown/bloqueio durante execucao:

1. items pendentes podem ser reatribuidos a outra instancia elegivel do pool;
2. respeita capacidade remanescente e prioridade/peso;
3. incrementa `reassignmentCount`; preserva `originalDispatchChannelId`;
4. se nenhuma instancia absorver, `requiringRedistribution=true`.

**Nota:** failover automatico e Worker permanecem fora do escopo atual (sem BullMQ/Evolution send).

### Web (09 multi-instancia)

- detalhe do Dispatch: tabela `DispatchChannels`, contagem de items por instancia;
- aviso destacado se `requiringRedistribution`;
- botao Redistribuir (`POST .../redistribute`) — exibe erro se rota indisponivel.

### Fora de escopo atual

- Worker de envio;
- adapter Evolution para disparo em massa;
- fila BullMQ;
- retry automatico entre instancias em producao.

Migration adicional: `prisma/migrations/20260721190000_multi_instance_dispatch`.

---

# 9. Subetapa 09.3 — Preparação e Enfileiramento

## 9.1 Objetivo

Criar a infraestrutura de fila e enfileirar os DispatchItems sem chamar a Evolution.

Nesta etapa, o Worker deverá consumir jobs em modo seguro de preparação ou simulação técnica, sem envio externo.

---

## 9.2 Fila inicial

Nome sugerido:

`dispatch-send`

O nome final deve seguir os padrões do projeto.

---

## 9.3 Payload do job

Payload mínimo:

- dispatchId;
- dispatchItemId;
- organizationId;
- campaignId;
- channelAccountId.

Não incluir:

- conteúdo completo;
- contato completo;
- credenciais;
- token;
- payload da Evolution;
- listas.

---

## 9.4 Job ID

Usar identificador determinístico.

Sugestão:

`dispatch:{dispatchId}:item:{dispatchItemId}`

Isso ajuda a evitar jobs duplicados.

---

## 9.5 Enfileiramento

Ação sugerida:

`POST /campaigns/:campaignId/dispatches/:dispatchId/queue`

Pré-condições:

- Dispatch READY;
- items existentes;
- todos os items em PENDING ou estado elegível;
- canal configurado;
- sem execução concorrente;
- usuário autorizado.

Na 09.3, o enfileiramento não deve ativar envio real.

Pode existir um modo técnico:

- DRY_RUN;
- PREPARE_ONLY;
- WORKER_DISABLED_FOR_SEND.

A solução deve ser simples e explícita.

---

## 9.6 Estados

Ao enfileirar:

- Dispatch READY → QUEUED;
- DispatchItem PENDING → QUEUED;
- preencher queuedAt;
- registrar jobId, se houver campo.

---

## 9.7 Worker técnico

O Worker desta subetapa deve:

- consumir o job;
- carregar o item;
- validar tenancy e estado;
- registrar que o job foi processado tecnicamente;
- não chamar provider;
- não marcar como SENT.

Pode manter o item em QUEUED ou usar um estado técnico temporário documentado.

Preferência:

- validar fila e consumo sem alterar o fluxo definitivo indevidamente;
- remover o modo técnico quando a 09.4 entrar.

---

## 9.8 Limite do enfileiramento

Na primeira versão:

- limitar o número de items;
- respeitar o limite conservador do Plano;
- não permitir volume acima do teto de homologação.

---

## 9.9 Audit log

Registrar:

- DISPATCH_QUEUE_REQUESTED;
- DISPATCH_QUEUED.

---

## 9.10 Web

No detalhe:

- mostrar status da preparação da fila;
- não exibir botão “Enviar”;
- exibir aviso de que o enfileiramento técnico ainda não chama a Evolution.

---

## 9.11 Critério de aceite da 09.3

A subetapa estará concluída quando:

- jobs são criados;
- job IDs são determinísticos;
- jobs duplicados são evitados;
- Worker consome tecnicamente;
- nenhuma chamada à Evolution acontece;
- nenhuma mensagem é enviada;
- estados são consistentes;
- testes de Redis/BullMQ passam.

### Status da 09.3 — CONCLUÍDA

Implementação registrada:

- **Fila:** nome final `dispatch-send` (BullMQ + IORedis), definida em `packages/shared/src/dispatch-queue.constants.ts` e reexportada em `apps/api/src/dispatches/dispatch-queue.constants.ts`.
- **Payload do job:** 4 campos apenas — `dispatchId`, `dispatchItemId`, `organizationId`, `campaignId`. `channelAccountId` **não** trafega no job (o Worker relê o canal do banco a cada execução, permitindo failover sem invalidar jobs já enfileirados); `assertDispatchSendJobPayload` rejeita qualquer chave adicional (destino/conteúdo/token/telefone).
- **Job ID:** determinístico, `dispatch:{dispatchId}:item:{dispatchItemId}` (`buildDispatchSendJobId`). `DispatchSendProducer.enqueueItem` é idempotente: se o job já existe (não removido), retorna `{ status: 'duplicate' }` sem duplicar.
- **Flags:** `DISPATCH_ENGINE_ENABLED`, `DISPATCH_QUEUE_ENABLED` e `DISPATCH_SEND_ENABLED` (todas com default `false`; `DISPATCH_SEND_ENABLED` nunca deve ter default `true`). `assertDispatchQueueAllowed()` bloqueia o enfileiramento se motor/fila estiverem off.
- **Serviço de enfileiramento:** `DispatchQueueService` (`apps/api/src/dispatches/dispatch-queue.service.ts`), com `queue()` e `reconcileQueue()`. `queue()` exige OWNER/ADMIN, Dispatch `READY` com `pendingItems > 0`, `requiringRedistribution = false` e `approvalSnapshot` com `protectionPolicy`/`distributionStrategy`/`multiInstance` presentes (aprovação 09.plan). Claim condicional `READY → QUEUED` (`updateMany` com verificação de `count`).
- **Estados:** `Dispatch READY → QUEUED`; `DispatchItem PENDING → QUEUED` (com `queuedAt`, `queueJobId`, `queueName`, `queueCreatedAt`) **ou** `PENDING → SCHEDULED` quando não há canal elegível no momento (`lastQueueError = 'NO_ELIGIBLE_CHANNEL'`, reagendado para `now + 5min`). O Dispatch permanece `QUEUED` sempre que houver ao menos um job criado ou item `SCHEDULED` pendente de retomada (reconcile); só volta a `READY` no caso defensivo de nada ter progredido.
- **Failover no enfileiramento:** antes de cada item, valida se o `DispatchChannel` atribuído está apto (enabled, não arquivado, `ChannelAccount.status = CONNECTED`, `operationalStatus = READY`, fora de cooldown, com capacidade). Se não estiver apto (inclui items sem `dispatchChannelId`), tenta `selectNextEligibleDispatchChannel` + `buildReassignmentUpdate` (shared) antes de enfileirar; se nenhum canal elegível existir, o item é diferido (não bloqueia o restante do lote).
- **Paginação:** cursor por `id`, lotes de 100 items `PENDING` por vez, processados até esgotar.
- **Worker técnico (`apps/worker`):** `dispatch-send.processor.ts` consome o job, valida tenancy/estado do Dispatch (aborta silenciosamente em status terminal: `PAUSING/PAUSED/CANCELED/EMERGENCY_STOPPED/FAILED/COMPLETED/COMPLETED_WITH_ERRORS`), aplica lock atômico (`PROCESSING`, `lockToken`, `lockExpiresAt = now+30s`), revalida/faz failover de canal, valida a janela operacional (`isWithinOperationalWindow`/`resolveNextOperationalWindowStart`, shared) e — se tudo OK — marca `technicalValidatedAt = now` e devolve o item para `QUEUED` (aguardando 09.4). **Nunca** chama a Evolution, nunca seta `providerMessageId`/`sentAt`/`SENT`. Se `DISPATCH_SEND_ENABLED=true`, apenas loga aviso e segue no caminho técnico (envio real só em 09.4).
- **Reconciliação:** `POST /campaigns/:campaignId/dispatches/:dispatchId/reconcile-queue` (`DispatchQueueService.reconcileQueue`) — reenfileira `QUEUED` sem `queueJobId` e libera/reenfileira `PROCESSING` com `lockExpiresAt` expirado. Não chama a Evolution.
- **Rotas:** `POST .../dispatches/:dispatchId/queue` e `POST .../dispatches/:dispatchId/reconcile-queue` (ambas OWNER/ADMIN via `requireApproveAccess`).
- **Permissões/ações:** `buildDispatchAllowedActionsForPrepare` — `canQueue` exige OWNER/ADMIN, `READY`, `totalItems > 0`, `!requiringRedistribution`, `DISPATCH_ENGINE_ENABLED` e `DISPATCH_QUEUE_ENABLED`; `canReconcile` exige OWNER/ADMIN e status `QUEUED`.
- **Exposição de dados (API):** `listItems`/`getItemById` passaram a expor `dispatchChannelId`, `originalDispatchChannelId`, `reassignmentCount`, `scheduledAt`, `queuedAt`, `technicalValidatedAt`, `queueJobId` (sem destino em texto puro — mantém `destinationMasked`).
- **Audit log:** `DISPATCH_QUEUE_REQUESTED`, `DISPATCH_QUEUED`, `DISPATCH_QUEUE_FAILED`, `DISPATCH_QUEUE_RECONCILED` (metadata sem conteúdo/destino).
- **Testes:** `dispatch-queue.util.spec.ts`, `dispatch-queue.service.spec.ts` (API) e `dispatch-send.processor.spec.ts` (Worker) cobrindo OWNER/MANAGER, `requiringRedistribution`, `DRAFT`, failover, ausência de canal, job duplicado, contadores, audit e o caminho `DISPATCH_SEND_ENABLED=false`.
- **Fora de escopo (mantido para 09.4):** chamada à Evolution, `providerMessageId`, `sentAt`, status `SENT`.

---

# 10. Subetapa 09.4 — Worker de Envio

## 10.1 Objetivo

Ativar o envio real de mensagens individuais por meio do Worker e do adapter Evolution.

Essa é a primeira etapa em que o sistema poderá tecnicamente chamar o provider.

O envio deverá permanecer bloqueado por limite de homologação até a 09.8.

---

## 10.2 Fluxo do Worker

Para cada job:

1. carregar Dispatch;
2. carregar DispatchItem;
3. validar status;
4. verificar se Dispatch está RUNNING;
5. adquirir lock;
6. revalidar opt-out atual;
7. revalidar BLOCKED;
8. revalidar DELETED;
9. revalidar destino;
10. revalidar canal;
11. revalidar janela;
12. revalidar limite;
13. verificar idempotência;
14. renderizar conteúdo congelado;
15. chamar adapter;
16. persistir resposta;
17. atualizar item;
18. atualizar métricas;
19. liberar processamento.

---

## 10.3 Adapter Evolution

O Worker não deve conhecer diretamente:

- URL final;
- headers;
- formato específico;
- detalhes de autenticação;
- payload proprietário.

Usar adapter existente ou criar interface padronizada.

Interface conceitual:

`sendText(input): Promise<SendResult>`

Entrada:

- channelAccountId;
- destination;
- text;
- idempotencyKey;
- metadata segura.

Saída normalizada:

- success;
- providerMessageId;
- providerStatus;
- errorCategory;
- errorCode;
- errorMessage;
- rawMetadata segura opcional.

---

## 10.4 Fonte das credenciais

As credenciais devem vir do ChannelAccount e da infraestrutura de secrets já existente.

Nunca colocar credencial:

- no job;
- no DispatchItem;
- em logs;
- em audit metadata;
- no frontend.

---

## 10.5 Validações de última milha

Mesmo que o Plano tenha sido aprovado, o Worker deve impedir o envio quando:

- contato possui opt-out atual;
- contato ficou BLOCKED;
- contato foi DELETED;
- canal foi desconectado;
- canal foi arquivado;
- Dispatch foi pausado;
- Dispatch foi cancelado;
- parada emergencial foi acionada;
- item já foi enviado;
- providerMessageId já existe;
- janela está fechada;
- limite foi atingido;
- destino tornou-se inválido;
- conteúdo está ausente.

Nesses casos:

- não chamar provider;
- marcar SKIPPED ou manter aguardando, conforme a condição;
- registrar motivo.

---

## 10.6 Início do Dispatch

Ação sugerida:

`POST /campaigns/:campaignId/dispatches/:dispatchId/start`

Pré-condições:

- Dispatch READY ou QUEUED, conforme fluxo final;
- items preparados;
- canal conectado;
- limite permitido;
- usuário autorizado;
- parada emergencial desativada;
- ambiente autorizado para envio.

Ao iniciar:

- Dispatch → RUNNING;
- startedAt preenchido;
- jobs liberados para processamento.

---

## 10.7 Ambiente seguro

Deve existir configuração explícita:

- `DISPATCH_SEND_ENABLED=false` por padrão em ambientes não autorizados;
- ou mecanismo equivalente já adotado pelo projeto.

Sem essa configuração habilitada:

- Worker não chama Evolution;
- retorna erro operacional claro;
- não marca item como SENT.

---

## 10.8 Status após resposta

Sucesso:

- status SENT;
- providerMessageId;
- sentAt;
- attemptCount incrementado;
- error limpo.

Falha transitória:

- RETRY_SCHEDULED.

Falha permanente:

- FAILED.

Bloqueio de última milha:

- SKIPPED.

---

## 10.9 Atualização de métricas

Após cada item:

- recalcular ou incrementar contadores com segurança;
- atualizar lastProgressAt;
- verificar conclusão.

Quando todos os items estiverem em estado terminal:

- COMPLETED;
- ou COMPLETED_WITH_ERRORS.

Estados terminais de item:

- SENT;
- DELIVERED;
- READ;
- FAILED definitivo;
- SKIPPED;
- CANCELED.

---

## 10.10 Audit e logs

Não criar AuditLog para cada envio individual se isso gerar volume excessivo.

Usar:

- logs estruturados;
- status no DispatchItem;
- audit para ações humanas e transições globais.

Audit global:

- DISPATCH_STARTED;
- DISPATCH_COMPLETED;
- DISPATCH_COMPLETED_WITH_ERRORS;
- DISPATCH_FAILED.

---

## 10.11 Web

No detalhe:

- botão “Iniciar execução” apenas para papel autorizado;
- confirmação explícita;
- resumo de público;
- canal;
- conteúdo;
- velocidade;
- janela;
- aviso de envio real.

Durante RUNNING:

- progresso;
- enviados;
- falhas;
- ignorados;
- pendentes.

---

## 10.12 Critério de aceite da 09.4

A subetapa estará concluída quando:

- Worker chama adapter;
- adapter chama Evolution;
- uma mensagem individual de teste pode ser enviada;
- opt-out de última milha funciona;
- idempotência básica funciona;
- providerMessageId é persistido;
- status é atualizado;
- nenhuma credencial vaza;
- limites de homologação permanecem ativos.

---

# 11. Subetapa 09.5 — Controle Operacional

## 11.1 Objetivo

Permitir controlar uma execução em andamento.

Ações:

- pausar;
- retomar;
- cancelar;
- parada emergencial.

---

## 11.2 Pausa

Rota sugerida:

`POST /campaigns/:campaignId/dispatches/:dispatchId/pause`

Fluxo:

RUNNING

↓

PAUSING

↓

PAUSED

Regras:

- jobs novos não devem iniciar;
- item em processamento pode terminar;
- items pendentes permanecem;
- não remover histórico;
- registrar responsável e motivo opcional;
- atualizar pausedAt.

---

## 11.3 Retomada

Rota sugerida:

`POST /campaigns/:campaignId/dispatches/:dispatchId/resume`

Fluxo:

PAUSED

↓

QUEUED ou RUNNING

Antes de retomar:

- validar canal;
- validar janela;
- validar parada emergencial;
- validar configuração;
- reenfileirar somente itens pendentes;
- não reenviar SENT, DELIVERED ou READ;
- revalidar opt-out no Worker.

---

## 11.4 Cancelamento

Rota sugerida:

`POST /campaigns/:campaignId/dispatches/:dispatchId/cancel`

Regras:

- motivo obrigatório;
- impedir novos jobs;
- marcar items pendentes como CANCELED;
- preservar items já enviados;
- item em processamento pode terminar ou ser tratado conforme política;
- status final CANCELED;
- não permitir retomada.

---

## 11.5 Parada emergencial

Deve existir controle em nível de:

- Dispatch;
- campanha;
- organização, futuramente.

Na primeira versão, pelo menos por campanha.

A parada emergencial deve:

- impedir novos envios;
- ser verificada pelo Worker antes de cada item;
- registrar usuário;
- registrar motivo;
- registrar data;
- pausar ou interromper Dispatches ativos;
- exigir OWNER ou ADMIN.

Não apagar jobs ou histórico silenciosamente.

---

## 11.6 Estados concorrentes

Proteger:

- pausa durante cancelamento;
- retomada durante parada emergencial;
- cancelamento durante processamento;
- dois usuários pausando;
- dois usuários retomando;
- start duplo.

Usar atualização condicional por status.

---

## 11.7 Audit log

Registrar:

- DISPATCH_PAUSE_REQUESTED;
- DISPATCH_PAUSED;
- DISPATCH_RESUMED;
- DISPATCH_CANCELED;
- DISPATCH_EMERGENCY_STOPPED.

---

## 11.8 Web

Adicionar ações conforme allowedActions:

- Pausar;
- Retomar;
- Cancelar;
- Parada emergencial.

Exigir confirmação para ações destrutivas.

Mostrar:

- status;
- motivo;
- responsável;
- horário;
- impacto nos items.

---

## 11.9 Critério de aceite da 09.5

A subetapa estará concluída quando:

- pausa impede novos envios;
- retomada continua somente pendentes;
- cancelamento não reenviará items;
- emergência bloqueia Worker;
- concorrência é tratada;
- tudo é auditável.

---

# 12. Subetapa 09.6 — Retry, Idempotência e Recuperação

## 12.1 Objetivo

Garantir que falhas técnicas não gerem duplicidade, perda silenciosa ou corrupção da execução.

---

## 12.2 Classificação de erros

Categorias sugeridas:

- TRANSIENT_NETWORK;
- PROVIDER_RATE_LIMIT;
- PROVIDER_UNAVAILABLE;
- PROVIDER_TIMEOUT;
- CHANNEL_DISCONNECTED;
- AUTHENTICATION_ERROR;
- INVALID_DESTINATION;
- CONTENT_REJECTED;
- CONTACT_OPT_OUT;
- CONTACT_BLOCKED;
- CONTACT_DELETED;
- DISPATCH_PAUSED;
- DISPATCH_CANCELED;
- OUTSIDE_WINDOW;
- DUPLICATE_PREVENTED;
- UNKNOWN.

---

## 12.3 Erros transitórios

Podem gerar retry:

- timeout;
- falha de rede;
- HTTP 429;
- HTTP 502;
- HTTP 503;
- indisponibilidade temporária;
- erro transitório do provider.

---

## 12.4 Erros permanentes

Não gerar retry automático:

- telefone inválido;
- opt-out;
- bloqueio;
- contato removido;
- conteúdo rejeitado;
- credencial inválida persistente;
- canal arquivado;
- erro de política;
- duplicidade detectada.

---

## 12.5 Estratégia de retry

Configuração inicial sugerida:

- tentativa inicial;
- retry 1;
- retry 2;
- retry 3;
- falha definitiva.

Backoff exponencial com limite.

Exemplo conceitual:

- 1 minuto;
- 5 minutos;
- 15 minutos.

Valores devem ser centralizados.

---

## 12.6 Idempotência

Antes de enviar:

- verificar status;
- verificar sentAt;
- verificar providerMessageId;
- adquirir item atomicamente;
- verificar jobId;
- verificar lock;
- usar idempotencyKey.

Chave sugerida:

`dispatchId:dispatchItemId`

Se Evolution não suportar idempotency key nativa, manter proteção interna.

---

## 12.7 Estado desconhecido do provider

Caso a chamada tenha sido enviada, mas a resposta tenha sido perdida:

- não reenviar automaticamente sem investigação;
- marcar `UNKNOWN_PROVIDER_STATE`;
- tentar consultar status, se provider permitir;
- exigir reconciliação segura.

Esse estado é preferível a duplicar envio.

---

## 12.8 Locks

Usar lock curto e identificável.

Campos possíveis:

- lockedAt;
- lockToken;
- lockExpiresAt.

Regras:

- lock expira;
- outro Worker pode recuperar após expiração;
- item SENT não pode ser recuperado;
- não manter transação aberta durante chamada HTTP.

---

## 12.9 Recuperação após queda

Ao iniciar Worker ou rotina de recuperação:

- localizar items PROCESSING com lock expirado;
- verificar providerMessageId;
- verificar sentAt;
- decidir:
  - SENT;
  - UNKNOWN_PROVIDER_STATE;
  - RETRY_SCHEDULED;
  - FAILED.

Não redefinir tudo para PENDING.

---

## 12.10 Reconciliação

Criar rotina administrativa futura ou nesta etapa:

- recalcular contadores do Dispatch;
- reconciliar items;
- identificar jobs ausentes;
- identificar jobs duplicados;
- reenfileirar apenas estados permitidos.

Rota restrita sugerida:

`POST /campaigns/:campaignId/dispatches/:dispatchId/reconcile`

Somente OWNER ou ADMIN.

---

## 12.11 Retry manual

Permitir retry manual apenas para items elegíveis e falhas transitórias.

Não permitir retry para:

- opt-out;
- BLOCKED;
- DELETED;
- invalid destination;
- SENT;
- DELIVERED;
- READ;
- CANCELED.

---

## 12.12 Audit log

Registrar ações humanas:

- DISPATCH_RECONCILED;
- DISPATCH_ITEM_MANUAL_RETRY;
- DISPATCH_RECOVERY_EXECUTED.

Evitar AuditLog por retry automático individual.

---

## 12.13 Critério de aceite da 09.6

A subetapa estará concluída quando:

- retry diferencia erros;
- backoff funciona;
- duplicidade é evitada;
- lock expirado é recuperado;
- estado desconhecido não é reenviado automaticamente;
- contadores podem ser reconciliados;
- queda de Worker não reinicia tudo.

---

# 13. Subetapa 09.7 — Monitoramento e Relatórios

## 13.1 Objetivo

Permitir acompanhamento operacional e análise do resultado de cada Dispatch.

---

## 13.2 Métricas mínimas

Exibir:

- total planejado;
- total materializado;
- pendentes;
- agendados;
- enfileirados;
- processando;
- enviados;
- entregues;
- lidos;
- falhas;
- retries;
- ignorados;
- cancelados;
- estado desconhecido;
- percentual concluído;
- duração;
- velocidade média;
- última atividade.

---

## 13.3 Métricas por erro

Agrupar:

- categoria;
- código;
- quantidade;
- percentual.

Exemplos:

- telefone inválido;
- canal desconectado;
- timeout;
- opt-out de última milha;
- falha do provider.

---

## 13.4 Métricas por período

Exibir, quando possível:

- items por minuto;
- items por hora;
- início;
- fim;
- tempo ativo;
- tempo pausado;
- tempo total.

---

## 13.5 Fonte de verdade

Relatórios derivam dos DispatchItems.

Contadores no Dispatch são cache operacional.

Deve existir forma de reconciliar:

- contadores do Dispatch;
- agregações reais dos items.

---

## 13.6 Atualização da interface

Primeira versão pode utilizar polling.

Sugestão:

- 5 segundos durante RUNNING;
- intervalo maior em estados terminais.

WebSocket não é obrigatório neste épico.

---

## 13.7 Listagem de items

Criar rota paginada:

`GET /campaigns/:campaignId/dispatches/:dispatchId/items`

Filtros:

- status;
- errorCategory;
- search;
- tentativa;
- período.

Retorno seguro:

- contato resumido;
- destino mascarado;
- status;
- tentativas;
- horários;
- erro resumido;
- provider status.

Evitar exposição desnecessária de telefone completo.

---

## 13.8 Detalhe do item

Pode existir rota:

`GET /campaigns/:campaignId/dispatches/:dispatchId/items/:itemId`

Mostrar:

- timeline operacional;
- status;
- tentativas;
- erro;
- providerMessageId parcialmente mascarado;
- datas.

Não expor credenciais ou payload bruto.

---

## 13.9 Relatório final

Quando terminar:

- status final;
- totais;
- duração;
- taxa de sucesso;
- taxa de falha;
- taxa de exclusão de última milha;
- erros principais;
- canal;
- configuração utilizada;
- responsável;
- Plano de origem.

---

## 13.10 Exportação

CSV pode ser considerado apenas se simples e seguro.

Caso implementado:

- respeitar tenancy;
- mascarar dados;
- incluir somente campos necessários;
- registrar auditoria.

Não é requisito obrigatório para concluir a 09.7.

---

## 13.11 Alertas

Mostrar alertas operacionais para:

- taxa de erro elevada;
- canal desconectado;
- fila sem progresso;
- muitos retries;
- Dispatch pausado;
- parada emergencial;
- estado desconhecido do provider.

---

## 13.12 Critério de aceite da 09.7

A subetapa estará concluída quando:

- progresso é visível;
- métricas são confiáveis;
- items são paginados;
- erros são agrupados;
- contadores são reconciliáveis;
- estados terminais possuem relatório final.

---

# 14. Subetapa 09.8 — Piloto Controlado

## 14.1 Objetivo

Executar os primeiros envios reais com limites rígidos e destinatários internos autorizados.

Essa etapa não deve iniciar com uma base ampla.

---

## 14.2 Progressão obrigatória

A progressão deverá ser gradual:

1. 1 contato interno;
2. 3 contatos internos;
3. 5 contatos internos;
4. 10 contatos autorizados;
5. 25 contatos, após avaliação;
6. 50 contatos, somente após estabilidade.

Não liberar aumento automático.

---

## 14.3 Lista autorizada

O piloto deve exigir:

- contatos internos;
- números conhecidos;
- consentimento;
- possibilidade de verificar recebimento;
- ausência de opt-out.

Pode existir allowlist temporária de destinos para homologação.

---

## 14.4 Limite rígido

Configuração obrigatória:

- limite máximo por Dispatch;
- limite máximo diário por canal;
- limite máximo por campanha;
- limite máximo no ambiente.

Esses limites devem ser aplicados no backend e no Worker.

Não confiar apenas na UI.

---

## 14.5 Ambiente de produção

Antes do primeiro envio:

- migrations aplicadas;
- Redis persistente;
- Worker ativo;
- fila monitorável;
- canal conectado;
- secrets corretos;
- logs estruturados;
- parada emergencial disponível;
- opt-out de última milha validado;
- relógio e timezone corretos;
- backup do banco;
- health checks ativos.

---

## 14.6 Cenários obrigatórios do piloto

Testar:

- envio com sucesso;
- telefone inválido;
- opt-out antes do envio;
- contato bloqueado antes do envio;
- canal desconectado;
- pausa;
- retomada;
- cancelamento;
- retry transitório;
- Worker reiniciado;
- Redis reiniciado, quando seguro;
- job duplicado;
- providerMessageId persistido;
- webhook de status;
- relatório final.

---

## 14.7 Critérios para ampliar volume

Somente ampliar se:

- nenhum envio duplicado;
- opt-out respeitado;
- pausa funciona;
- cancelamento funciona;
- recuperação funciona;
- métricas batem;
- canal permanece estável;
- erros estão explicáveis;
- logs não expõem dados sensíveis;
- relatório final é consistente.

---

## 14.8 Critério de aceite da 09.8

A subetapa estará concluída quando:

- piloto real for executado;
- resultados forem verificados;
- nenhuma duplicidade ocorrer;
- controles operacionais funcionarem;
- documentação registrar o comportamento;
- volume permanecer limitado.

---

# 15. Máquina de estados do Dispatch

## 15.1 Fluxo principal

DRAFT

↓

PREPARING

↓

READY

↓

QUEUED

↓

RUNNING

↓

COMPLETED

---

## 15.2 Conclusão com erros

RUNNING

↓

COMPLETED_WITH_ERRORS

Usar quando:

- processamento terminou;
- existem items FAILED, SKIPPED ou UNKNOWN_PROVIDER_STATE;
- não existem items pendentes ou processando.

---

## 15.3 Pausa

RUNNING

↓

PAUSING

↓

PAUSED

↓

QUEUED ou RUNNING

---

## 15.4 Falha geral

PREPARING, QUEUED ou RUNNING

↓

FAILED

Usar apenas para falha estrutural que impeça continuar.

Falhas individuais não devem necessariamente colocar o Dispatch em FAILED.

---

## 15.5 Cancelamento

DRAFT, PREPARING, READY, QUEUED, RUNNING ou PAUSED

↓

CANCELED

Itens já enviados são preservados.

---

## 15.6 Emergência

QUEUED, RUNNING, PAUSING ou PAUSED

↓

EMERGENCY_STOPPED

A retomada deve exigir ação explícita e revalidação.

---

# 16. Máquina de estados do DispatchItem

## 16.1 Fluxo principal

PENDING

↓

SCHEDULED ou QUEUED

↓

PROCESSING

↓

SENT

↓

DELIVERED

↓

READ

---

## 16.2 Retry

PROCESSING

↓

RETRY_SCHEDULED

↓

QUEUED

↓

PROCESSING

---

## 16.3 Falha definitiva

PROCESSING

↓

FAILED

---

## 16.4 Bloqueio de última milha

PENDING, SCHEDULED ou QUEUED

↓

SKIPPED

---

## 16.5 Cancelamento

PENDING, SCHEDULED, QUEUED ou RETRY_SCHEDULED

↓

CANCELED

---

## 16.6 Estado desconhecido

PROCESSING

↓

UNKNOWN_PROVIDER_STATE

Não reenviar automaticamente.

---

# 17. Regras de velocidade

A configuração deve vir do snapshot aprovado.

Considerar:

- messagesPerMinute;
- minDelaySeconds;
- maxDelaySeconds;
- batchSize;
- pauseBetweenBatchesSeconds;
- timezone;
- janela;
- dias permitidos.

O Worker deve obedecer ao limitante mais conservador.

---

## 18. Rate limiting

Implementar limites em múltiplas camadas:

- por canal;
- por Dispatch;
- por campanha;
- por organização;
- global por Worker.

Na primeira versão, pelo menos:

- por canal;
- por Dispatch.

Os limites devem ser centralizados.

---

## 19. Jitter

Aplicar variação dentro da faixa aprovada:

- minDelaySeconds;
- maxDelaySeconds.

O jitter deve servir para distribuir a carga e respeitar a configuração operacional.

Não deve ser usado para contornar políticas de plataforma.

---

## 20. Janela de envio

Antes de cada item:

- verificar timezone;
- verificar dia permitido;
- verificar horário;
- reagendar se fora da janela;
- não marcar falha apenas por estar fora da janela.

Estado possível:

- SCHEDULED;
- ou RETRY_SCHEDULED com razão operacional específica.

---

## 21. Opt-out

O opt-out atual sempre prevalece.

Mesmo se o contato estava elegível no Plano aprovado, não enviar se houver opt-out antes do processamento.

Registrar:

- item SKIPPED;
- categoria CONTACT_OPT_OUT;
- data da checagem.

---

## 22. Bloqueio e exclusão

Contato atualmente:

- BLOCKED;
- DELETED;

não deve receber.

Registrar como SKIPPED.

---

## 23. Conteúdo

O Worker utiliza o conteúdo congelado no Dispatch ou DispatchItem.

Não buscar conteúdo editável do Plano.

Não permitir alteração durante execução.

---

## 24. Compliance e uso responsável

O motor deve operar com base em:

- consentimento aplicável;
- opt-out;
- origem auditável;
- finalidade declarada;
- limites operacionais;
- regras da plataforma;
- legislação aplicável.

É proibido utilizar o motor para:

- envio a contatos sem base legítima;
- ignorar opt-out;
- contornar bloqueios da plataforma;
- mascarar origem;
- usar atributos sensíveis para manipulação;
- inferir vulnerabilidade política;
- direcionar conteúdo com base em raça, religião, saúde, orientação sexual ou outros atributos protegidos;
- executar assédio, intimidação ou desinformação.

---

## 25. Tenancy

Todas as entidades devem carregar:

- organizationId;
- campaignId.

Toda operação deve validar:

- usuário;
- organização;
- campanha;
- Plano;
- Dispatch;
- item;
- canal;
- contato.

Nenhum dado pode atravessar tenants.

---

## 26. Segurança

Regras obrigatórias:

- secrets fora do banco operacional quando aplicável;
- payload mínimo no job;
- conteúdo não exposto em logs;
- telefone mascarado na UI quando possível;
- providerMessageId tratado como dado operacional;
- locks atômicos;
- autorização no backend;
- parada emergencial;
- rate limiting;
- audit log;
- nenhuma execução direta pelo frontend.

---

## 27. Observabilidade

Logs estruturados devem conter:

- dispatchId;
- dispatchItemId;
- jobId;
- organizationId;
- campaignId;
- channelAccountId;
- attempt;
- status;
- errorCategory;
- errorCode;
- durationMs.

Não registrar:

- token;
- API key;
- conteúdo completo;
- telefone completo;
- payload bruto sensível.

---

## 28. Health checks

Adicionar verificações quando apropriado:

- Redis;
- BullMQ;
- Worker;
- banco;
- fila;
- adapter;
- canal.

Não tornar o health global dependente de provider externo de forma que cause indisponibilidade desnecessária.

Pode haver health detalhado separado.

---

## 29. Auditoria

Eventos mínimos do Épico 09:

- DISPATCH_CREATED;
- DISPATCH_PREPARATION_STARTED;
- DISPATCH_PREPARED;
- DISPATCH_PREPARATION_FAILED;
- DISPATCH_QUEUE_REQUESTED;
- DISPATCH_QUEUED;
- DISPATCH_STARTED;
- DISPATCH_PAUSE_REQUESTED;
- DISPATCH_PAUSED;
- DISPATCH_RESUMED;
- DISPATCH_CANCELED;
- DISPATCH_EMERGENCY_STOPPED;
- DISPATCH_COMPLETED;
- DISPATCH_COMPLETED_WITH_ERRORS;
- DISPATCH_FAILED;
- DISPATCH_RECONCILED;
- DISPATCH_ITEM_MANUAL_RETRY.

---

## 30. Permissões

### VIEWER

- visualizar Dispatch;
- visualizar progresso;
- visualizar relatório;
- não criar;
- não iniciar;
- não pausar;
- não cancelar;
- não retentar.

### MANAGER

Inicialmente:

- visualizar;
- acompanhar;
- eventualmente pausar, se política futura permitir;
- não criar execução real;
- não iniciar.

### ADMIN

- criar Dispatch;
- preparar;
- enfileirar;
- iniciar;
- pausar;
- retomar;
- cancelar;
- reconciliar;
- retry manual;
- parada emergencial.

### OWNER

- controle total;
- configurar limites permitidos;
- executar parada emergencial;
- autorizar piloto.

A matriz pode ser refinada durante a implementação.

---

## 31. Allowed actions

O detalhe do Dispatch deve retornar flags:

- canPrepare;
- canQueue;
- canStart;
- canPause;
- canResume;
- canCancel;
- canEmergencyStop;
- canReconcile;
- canRetryFailedItems;
- canViewSensitiveDetails.

A API é a fonte de verdade.

---

## 32. Performance

Evitar:

- uma consulta por item durante preparação;
- carregar todos os items no frontend;
- atualizar contadores com condições de corrida;
- armazenar conteúdo repetido desnecessariamente sem avaliar custo;
- criar milhares de jobs em uma única transação longa;
- N+1 no Worker.

Usar:

- createMany;
- paginação;
- lotes;
- agregações;
- índices;
- atualização condicional;
- processamento incremental.

---

## 33. Índices sugeridos

Dispatch:

- organizationId + campaignId;
- campaignId + status;
- dispatchPlanId;
- channelAccountId;
- status + createdAt.

DispatchItem:

- dispatchId;
- dispatchId + status;
- organizationId + campaignId;
- channelAccountId + status;
- normalizedDestination;
- providerMessageId;
- nextRetryAt;
- lockedAt;
- createdAt.

---

## 34. Testes gerais obrigatórios

Cada subetapa deve executar:

- `npm run prisma:generate`, quando necessário;
- `npm run typecheck`;
- `npm run build`;
- suíte existente;
- testes específicos.

---

## 35. Testes de segurança obrigatórios

Testar:

- tenant cruzado;
- campanha cruzada;
- canal cruzado;
- item cruzado;
- VIEWER sem escrita;
- MANAGER sem aprovação de execução, conforme regra;
- DTO sem status arbitrário;
- token ausente de logs;
- conteúdo ausente de AuditLog;
- telefone ausente de metadata.

---

## 36. Testes de idempotência obrigatórios

Testar:

- start duplo;
- queue duplo;
- job duplicado;
- Worker processando o mesmo item;
- item SENT reprocessado;
- item com providerMessageId;
- lock concorrente;
- retry após timeout;
- recuperação após queda;
- reconciliação.

---

## 37. Testes de última milha

Testar:

- opt-out após aprovação;
- BLOCKED após aprovação;
- DELETED após aprovação;
- canal desconectado;
- canal arquivado;
- janela fechada;
- Dispatch pausado;
- Dispatch cancelado;
- emergência ativa;
- destino inválido;
- conteúdo ausente.

---

## 38. Testes do provider

Utilizar mocks para a maior parte dos testes.

Teste real somente no piloto controlado.

Simular:

- sucesso;
- timeout;
- 429;
- 502;
- 503;
- autenticação inválida;
- destino inválido;
- resposta sem providerMessageId;
- conexão interrompida após envio.

---

## 39. Deploy

Ordem recomendada:

1. aplicar migrations;
2. subir API;
3. confirmar health;
4. subir Redis;
5. confirmar persistência;
6. subir Worker com envio desabilitado;
7. validar fila;
8. subir Web;
9. testar criação do Dispatch;
10. testar preparação;
11. testar enfileiramento técnico;
12. habilitar envio somente no piloto.

---

## 40. Feature flags

Configurações recomendadas:

- DISPATCH_ENGINE_ENABLED;
- DISPATCH_SEND_ENABLED;
- DISPATCH_MAX_ITEMS_PER_RUN;
- DISPATCH_MAX_DAILY_PER_CHANNEL;
- DISPATCH_WORKER_CONCURRENCY;
- DISPATCH_EMERGENCY_STOP;
- DISPATCH_PILOT_MODE;
- DISPATCH_ALLOWED_DESTINATIONS, se necessário no piloto.

As configurações reais podem seguir o padrão existente do projeto.

---

## 41. Estado inicial seguro

Após deploy do código:

- motor pode estar habilitado para criação e preparação;
- envio real deve permanecer desabilitado;
- Worker pode processar em modo técnico;
- piloto só começa após autorização explícita.

---

## 42. Critério final do Épico 09

O Épico 09 estará concluído quando:

- Dispatch nasce de Plano APPROVED;
- recipients elegíveis viram DispatchItems;
- items são enfileirados;
- Worker processa;
- Evolution Adapter envia;
- opt-out atual é respeitado;
- bloqueios atuais são respeitados;
- conteúdo é imutável;
- idempotência impede duplicidade;
- retry é seguro;
- queda não reinicia tudo;
- pausa funciona;
- retomada funciona;
- cancelamento funciona;
- emergência funciona;
- progresso é visível;
- relatório é confiável;
- piloto controlado foi validado;
- limites conservadores permanecem ativos.

---

## 43. Estado esperado ao final

O usuário deverá visualizar algo semelhante a:

### Disparo

- Status: Concluído com erros
- Plano: Mobilização Regional — 21/07
- Canal: Rua Evangelista
- Público aprovado: 50
- Preparados: 50
- Enviados: 46
- Entregues: 42
- Lidos: 31
- Falhas: 2
- Ignorados: 2
- Retentativas: 3
- Início: 14:00
- Término: 14:18
- Velocidade média: 2,6 mensagens por minuto
- Duplicidades: 0
- Opt-outs respeitados na última milha: 1
- Contatos bloqueados antes do envio: 1

---

## 44. Próximo épico

Após a conclusão do Épico 09, o próximo documento será:

**Épico 10 — Templates e Conteúdo de Mensagens**

Arquivo sugerido:

`docs/epicos/10-TEMPLATES-E-CONTEUDO.md`

Subetapas previstas:

- templates de texto;
- versionamento;
- variáveis;
- preview;
- validação;
- biblioteca;
- conteúdo por canal;
- mídia futura.

O Épico 10 não deve alterar as garantias do Motor de Disparo.

---

## 45. Próxima ação prática

A **09.1 — Entidade Dispatch**, a **09.2 — Materialização dos DispatchItems** e a **09.3 — Preparação e Enfileiramento** estão concluídas.

A próxima implementação deve ser apenas:

**09.4 — Worker de Envio**

Ativar o envio real via adapter Evolution (usando `DISPATCH_SEND_ENABLED`), reaproveitando o Worker técnico da 09.3 (lock, failover, janela operacional) e substituindo a validação técnica pelo envio efetivo (`providerMessageId`, `sentAt`, `SENT`).