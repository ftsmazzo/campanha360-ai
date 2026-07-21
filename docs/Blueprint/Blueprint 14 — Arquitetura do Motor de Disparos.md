# Blueprint 14 — Arquitetura do Motor de Disparos

## 1. Objetivo deste documento

Este blueprint define a arquitetura do motor de disparos do Campanha360 AI.

Ele estabelece as entidades, responsabilidades, estados, blindagens, filas, processos de execução, mecanismos de recuperação e limites operacionais que deverão orientar os próximos épicos.

O motor de disparos será um dos núcleos mais sensíveis do produto.

Por isso, nenhum disparo em massa deverá ser implementado diretamente a partir de um segmento, lista de contatos ou botão de interface.

Toda execução deverá passar por planejamento, congelamento do público, validação, aprovação, fila e monitoramento.

---

## 2. Princípio central

O sistema nunca deve executar um disparo diretamente a partir de um segmento dinâmico.

O fluxo obrigatório será:

Segmento

↓

Plano de Disparo

↓

Snapshot do Público

↓

Blindagens

↓

Simulação

↓

Aprovação

↓

Disparo

↓

Fila

↓

Execução

↓

Relatórios

Cada etapa possui responsabilidade própria.

Nenhuma etapa deve assumir a responsabilidade de outra.

---

## 3. Problema que esta arquitetura resolve

Segmentos são dinâmicos.

Um segmento pode possuir 1.000 contatos hoje e 1.250 amanhã.

Se um disparo utilizar diretamente um segmento, surgem dúvidas importantes:

- qual público foi realmente usado;
- quais contatos entraram;
- quais contatos foram excluídos;
- quando a elegibilidade foi calculada;
- quais regras estavam vigentes;
- se houve mudança no segmento durante a execução;
- se um contato recebeu mais de uma vez;
- se um opt-out posterior foi respeitado;
- como retomar uma execução interrompida.

O Plano de Disparo resolve esse problema criando um snapshot imutável do público naquele momento.

---

## 4. Conceitos fundamentais

### 4.1 Segmento

Segmento define regras.

Exemplos:

- tag igual a Apoiador;
- cidade igual a Goiânia;
- status operacional igual a SUPPORTER;
- responsável igual a determinado usuário;
- canal igual a WhatsApp;
- sem opt-out;
- contato ativo.

O segmento não representa uma lista permanente de pessoas.

Ele representa filtros salvos.

O resultado de um segmento pode mudar ao longo do tempo.

---

### 4.2 Plano de Disparo

O Plano de Disparo representa o planejamento congelado de uma futura execução.

Ele deve registrar:

- campanha;
- segmento de origem;
- canal;
- público resolvido;
- critérios utilizados;
- contatos elegíveis;
- contatos excluídos;
- motivos das exclusões;
- mensagem futura ou referência de conteúdo;
- limites;
- janela de envio;
- data da criação;
- criador;
- estado de validação;
- aprovação.

O Plano não envia mensagens.

O Plano apenas organiza e valida o que poderá virar um disparo.

---

### 4.3 Snapshot do Público

O snapshot é a fotografia do público no momento da criação do Plano.

Depois de criado, ele não deve mudar automaticamente.

Exemplo:

O segmento possuía 1.000 contatos no momento da criação.

O snapshot registra:

- 1.000 contatos avaliados;
- 920 elegíveis;
- 40 opt-out;
- 20 telefones inválidos;
- 10 duplicados;
- 10 removidos.

Mesmo que o segmento passe a ter 1.300 contatos posteriormente, o Plano continua representando os 1.000 contatos avaliados originalmente.

Para utilizar o público atualizado, deve ser criado um novo Plano ou uma nova versão explícita do Plano.

---

### 4.4 Disparo

O Disparo representa uma execução aprovada.

Ele nasce de um Plano aprovado.

O Disparo deve conter:

- plano de origem;
- canal escolhido;
- conteúdo;
- configuração de velocidade;
- janela operacional;
- status;
- quantidade planejada;
- quantidade processada;
- quantidade enviada;
- quantidade entregue quando disponível;
- quantidade com erro;
- quantidade ignorada;
- datas de início e término;
- usuário responsável pela aprovação.

O Disparo não deve recalcular o público.

Ele usa o snapshot do Plano.

---

### 4.5 Item de Disparo

Cada destinatário elegível deve gerar um item individual.

Nome sugerido:

DispatchItem

ou

DispatchRecipient

Cada item representa uma tentativa de envio para um contato específico.

Campos conceituais:

- id;
- organizationId;
- campaignId;
- dispatchId;
- dispatchPlanId;
- contactId;
- channelAccountId;
- destination;
- status;
- attemptCount;
- scheduledAt;
- startedAt;
- sentAt;
- deliveredAt;
- failedAt;
- skippedAt;
- errorCode;
- errorMessage;
- providerMessageId;
- metadata;
- createdAt;
- updatedAt.

Cada contato elegível gera no máximo um item por disparo e destino normalizado.

---

### 4.6 Execução

A execução controla o processamento operacional do Disparo.

Ela deve coordenar:

- criação dos jobs;
- enfileiramento;
- início;
- pausa;
- retomada;
- cancelamento;
- limite de velocidade;
- janela de horário;
- recuperação após falha;
- métricas.

A execução não deve conter regras de CRM.

Ela opera sobre itens já aprovados.

---

## 5. Fluxo arquitetural completo

O fluxo previsto será:

1. Usuário seleciona ou cria um segmento.
2. Sistema gera pré-validação.
3. Usuário cria um Plano de Disparo.
4. Sistema resolve o segmento.
5. Sistema cria snapshot do público.
6. Sistema aplica blindagens.
7. Sistema apresenta simulação.
8. Usuário revisa e aprova.
9. Sistema cria o Disparo.
10. Sistema cria os itens individuais.
11. Sistema publica jobs no BullMQ.
12. Worker processa cada item.
13. Adapter envia ao provider.
14. Provider retorna resposta.
15. Sistema atualiza item e métricas.
16. Webhooks podem atualizar status posteriores.
17. Sistema exibe relatório final.

---

## 6. Fronteiras de responsabilidade

### Segmentos

Responsáveis por:

- filtros;
- critérios;
- visualização dinâmica do público;
- contagem atual.

Não são responsáveis por:

- congelar público;
- aprovar envio;
- executar disparo;
- controlar fila.

---

### Plano de Disparo

Responsável por:

- congelar público;
- registrar exclusões;
- registrar blindagens;
- preparar simulação;
- receber aprovação.

Não é responsável por:

- enviar mensagens;
- processar jobs;
- retentar falhas;
- atualizar entregas.

---

### Disparo

Responsável por:

- representar a execução aprovada;
- armazenar conteúdo e configuração;
- agrupar itens;
- controlar status geral;
- consolidar métricas.

Não é responsável por:

- recalcular segmento;
- ignorar blindagens;
- enviar diretamente para provider.

---

### DispatchItem

Responsável por:

- representar um destinatário;
- controlar status individual;
- armazenar tentativas;
- armazenar erro;
- armazenar identificador externo;
- impedir duplicidade.

---

### Worker

Responsável por:

- consumir jobs;
- validar estado atual do item;
- aplicar validações de última milha;
- chamar adapter;
- registrar resultado;
- realizar retry seguro.

Não é responsável por:

- definir público;
- aprovar disparo;
- alterar segmento;
- ignorar opt-out.

---

### Adapter

Responsável por:

- traduzir pedido interno para provider;
- enviar;
- normalizar resposta;
- tratar erro técnico;
- retornar identificador externo.

Não é responsável por:

- decidir elegibilidade;
- validar permissão;
- escolher público;
- ignorar bloqueios.

---

## 7. Entidades previstas

### DispatchPlan

Campos conceituais:

- id;
- organizationId;
- campaignId;
- segmentId;
- name;
- description;
- channelType;
- channelAccountId;
- status;
- filtersSnapshot;
- validationSnapshot;
- simulationSnapshot;
- totalEvaluated;
- totalEligible;
- totalExcluded;
- createdByUserId;
- approvedByUserId;
- approvedAt;
- createdAt;
- updatedAt.

---

### DispatchPlanRecipient

Representa cada contato avaliado no snapshot.

Campos conceituais:

- id;
- organizationId;
- campaignId;
- dispatchPlanId;
- contactId;
- destination;
- normalizedDestination;
- eligibilityStatus;
- exclusionReason;
- contactSnapshot;
- consentSnapshot;
- optOutSnapshot;
- createdAt.

Status conceituais:

- ELIGIBLE;
- EXCLUDED_OPT_OUT;
- EXCLUDED_BLOCKED;
- EXCLUDED_DELETED;
- EXCLUDED_INVALID_DESTINATION;
- EXCLUDED_DUPLICATE;
- EXCLUDED_NO_CHANNEL;
- EXCLUDED_POLICY;
- EXCLUDED_OTHER.

---

### Dispatch

Campos conceituais:

- id;
- organizationId;
- campaignId;
- dispatchPlanId;
- channelAccountId;
- name;
- contentSnapshot;
- status;
- speedConfig;
- scheduleConfig;
- totalItems;
- processedItems;
- sentItems;
- deliveredItems;
- failedItems;
- skippedItems;
- startedAt;
- pausedAt;
- completedAt;
- canceledAt;
- createdByUserId;
- approvedByUserId;
- createdAt;
- updatedAt.

---

### DispatchItem

Campos conceituais:

- id;
- organizationId;
- campaignId;
- dispatchId;
- contactId;
- destination;
- normalizedDestination;
- status;
- attemptCount;
- scheduledAt;
- lockedAt;
- startedAt;
- sentAt;
- deliveredAt;
- failedAt;
- skippedAt;
- providerMessageId;
- errorCode;
- errorMessage;
- metadata;
- createdAt;
- updatedAt.

---

### DispatchExecution

Pode ser uma entidade própria ou parte do Dispatch.

Se for entidade própria, deve controlar:

- dispatchId;
- executionNumber;
- status;
- startedAt;
- pausedAt;
- resumedAt;
- completedAt;
- workerVersion;
- metadata.

No MVP, essa entidade pode ser evitada se Dispatch já armazenar as informações necessárias.

---

### DispatchAudit

O AuditLog existente pode ser utilizado inicialmente.

Eventos mínimos:

- DISPATCH_PLAN_CREATED;
- DISPATCH_PLAN_VALIDATED;
- DISPATCH_PLAN_APPROVED;
- DISPATCH_CREATED;
- DISPATCH_QUEUED;
- DISPATCH_STARTED;
- DISPATCH_PAUSED;
- DISPATCH_RESUMED;
- DISPATCH_CANCELED;
- DISPATCH_COMPLETED;
- DISPATCH_FAILED;
- DISPATCH_ITEM_RETRIED;
- DISPATCH_EMERGENCY_STOPPED.

---

## 8. Imutabilidade

Após aprovação, certos campos não podem ser alterados.

No Plano aprovado:

- segmento de origem;
- snapshot do público;
- destinatários elegíveis;
- exclusões;
- canal;
- conteúdo;
- blindagens;
- simulação.

Se houver alteração necessária, deve ser criada uma nova versão ou novo Plano.

No Disparo iniciado:

- público;
- conteúdo;
- canal;
- destino dos itens;
- configuração fundamental.

Podem mudar apenas:

- status;
- métricas;
- horários;
- erros;
- tentativas;
- estado de pausa/cancelamento.

---

## 9. Máquina de estados do Plano

Estados sugeridos:

- DRAFT;
- VALIDATING;
- VALIDATED;
- BLOCKED;
- APPROVED;
- REJECTED;
- EXPIRED;
- CANCELED.

Transições permitidas:

DRAFT

↓

VALIDATING

↓

VALIDATED

↓

APPROVED

Também:

VALIDATING

↓

BLOCKED

BLOCKED

↓

DRAFT

VALIDATED

↓

REJECTED

VALIDATED

↓

EXPIRED

APPROVED

↓

CANCELED, somente antes da criação do Disparo

Um Plano aprovado não deve voltar para DRAFT.

---

## 10. Máquina de estados do Disparo

Estados sugeridos:

- DRAFT;
- READY;
- QUEUED;
- RUNNING;
- PAUSING;
- PAUSED;
- COMPLETED;
- COMPLETED_WITH_ERRORS;
- FAILED;
- CANCELED.

Fluxo principal:

DRAFT

↓

READY

↓

QUEUED

↓

RUNNING

↓

COMPLETED

Fluxo com pausa:

RUNNING

↓

PAUSING

↓

PAUSED

↓

QUEUED

↓

RUNNING

Fluxo com erro parcial:

RUNNING

↓

COMPLETED_WITH_ERRORS

Fluxo com falha geral:

QUEUED ou RUNNING

↓

FAILED

Fluxo com cancelamento:

DRAFT, READY, QUEUED, RUNNING ou PAUSED

↓

CANCELED

Cancelamento não deve apagar itens já enviados.

---

## 11. Máquina de estados do item

Estados sugeridos:

- PENDING;
- SCHEDULED;
- QUEUED;
- PROCESSING;
- SENT;
- DELIVERED;
- READ;
- FAILED;
- RETRY_SCHEDULED;
- SKIPPED;
- CANCELED.

Fluxo principal:

PENDING

↓

QUEUED

↓

PROCESSING

↓

SENT

Depois, se provider informar:

SENT

↓

DELIVERED

↓

READ

Fluxo de retry:

PROCESSING

↓

FAILED

↓

RETRY_SCHEDULED

↓

QUEUED

Fluxo de bloqueio:

PENDING ou QUEUED

↓

SKIPPED

---

## 12. Blindagens obrigatórias antes da aprovação

Antes de aprovar um Plano, validar:

- organização e campanha corretas;
- usuário autorizado;
- segmento existente;
- snapshot criado;
- público não vazio;
- canal selecionado;
- canal conectado;
- canal não arquivado;
- destinos válidos;
- opt-outs excluídos;
- contatos BLOCKED excluídos;
- contatos DELETED excluídos;
- telefones duplicados removidos;
- telefones inválidos excluídos;
- mensagem preenchida;
- conteúdo dentro de limites;
- janela de envio válida;
- limite de volume válido;
- velocidade configurada;
- ausência de conflito com outra execução;
- ausência de destinatários duplicados no mesmo Plano.

Nenhum Plano pode ser aprovado com erro crítico.

---

## 13. Blindagens de última milha

Mesmo após aprovação, o Worker deve revalidar algumas regras antes de cada envio.

Isso é necessário porque o estado do contato pode mudar entre a criação do Plano e a execução.

Antes de enviar cada item, validar novamente:

- Dispatch continua RUNNING;
- item continua elegível;
- contato não foi removido;
- contato não virou BLOCKED;
- opt-out não foi registrado depois do snapshot;
- canal continua conectado;
- destino continua válido;
- item não foi enviado anteriormente;
- janela de envio ainda está aberta;
- limite de velocidade não foi excedido;
- cancelamento ou pausa não foi solicitado.

Se alguma regra falhar, marcar item como SKIPPED com motivo.

---

## 14. Opt-out após snapshot

Se o contato estava elegível no momento do snapshot, mas registrou opt-out antes do envio, o Worker deve bloquear o envio.

O snapshot serve para auditoria e planejamento.

Ele nunca autoriza ignorar uma alteração posterior de opt-out.

Regra:

Opt-out atual prevalece sobre snapshot anterior.

---

## 15. Deduplicação

A deduplicação deve ocorrer em múltiplas camadas.

### No Plano

Não permitir mais de um recipient com o mesmo destino normalizado.

### No Disparo

Não criar mais de um item para o mesmo contato/destino.

### No Worker

Antes de enviar, verificar se o item já possui:

- sentAt;
- providerMessageId;
- status SENT, DELIVERED ou READ.

### No provider

Utilizar idempotency key quando o provider suportar.

Chave sugerida:

dispatchId + dispatchItemId

---

## 16. Filas

Tecnologia prevista:

- Redis;
- BullMQ;
- Worker separado.

Filas sugeridas:

- dispatch-prepare;
- dispatch-send;
- dispatch-status;
- dispatch-retry;
- dispatch-cleanup.

No MVP, pode existir inicialmente apenas:

- dispatch-send.

Mas o código deve permitir evolução.

---

## 17. Payload do job

O job não deve carregar todo o contato nem toda a mensagem.

Payload mínimo:

- dispatchId;
- dispatchItemId;
- organizationId;
- campaignId;
- channelAccountId.

O Worker deve buscar os dados atuais no banco antes do envio.

Isso reduz risco de payload desatualizado.

---

## 18. Concorrência

O motor deve limitar concorrência.

Exemplo conceitual:

- 1 a 5 jobs simultâneos por canal;
- limite global por Worker;
- limite específico por organização;
- limite específico por campanha;
- limite específico por provider.

Esses valores não devem ser fixados diretamente no código de domínio.

Devem ser configuráveis futuramente.

---

## 19. Velocidade e intervalos

O motor deve permitir configurar:

- mensagens por minuto;
- atraso mínimo;
- atraso máximo;
- lote;
- pausa entre lotes;
- janela de envio.

O Worker deve aplicar jitter.

Exemplo:

intervalo mínimo: 8 segundos

intervalo máximo: 15 segundos

O atraso real deve variar dentro desse intervalo.

A arquitetura não deve assumir que disparo em massa significa envio instantâneo.

---

## 20. Janela de envio

O Plano e o Disparo devem considerar:

- timezone da campanha;
- horário inicial;
- horário final;
- dias permitidos;
- data de início;
- data limite.

Se o job for processado fora da janela:

- não enviar;
- reagendar para a próxima janela;
- ou marcar como aguardando janela.

Nunca ignorar a janela silenciosamente.

---

## 21. Limites operacionais

Limites iniciais devem ser conservadores.

Exemplos conceituais:

- limite máximo de contatos por Plano;
- limite máximo diário por canal;
- limite por hora;
- limite por execução;
- limite por organização;
- limite por campanha.

Os valores reais deverão ser definidos em épico próprio de blindagens.

Este blueprint define apenas que tais limites devem existir.

---

## 22. Pausa

Ao pausar um Disparo:

- novos jobs não devem começar;
- item já em processamento pode terminar;
- itens pendentes permanecem na fila ou aguardam;
- status geral deve mudar para PAUSING e depois PAUSED.

Pausa não apaga jobs.

---

## 23. Retomada

Ao retomar:

- validar novamente canal;
- validar janela;
- validar opt-out atual;
- reenfileirar apenas itens elegíveis não enviados;
- não duplicar itens já concluídos.

---

## 24. Cancelamento

Ao cancelar:

- impedir início de novos jobs;
- itens já enviados permanecem enviados;
- itens pendentes passam para CANCELED;
- jobs ainda não processados devem ser removidos ou ignorados;
- registrar audit log;
- não permitir retomada do mesmo Disparo.

Para reenviar, criar novo Disparo.

---

## 25. Pausa emergencial

O sistema deve possuir futuramente uma ação de emergência.

A pausa emergencial deve:

- interromper todos os disparos da campanha;
- impedir novos jobs;
- marcar razão;
- registrar usuário;
- registrar data;
- permitir investigação.

Ela deve existir antes de liberar volumes elevados.

---

## 26. Recuperação após falha

Se API, Redis, Worker ou servidor cair:

- jobs persistidos no BullMQ devem permanecer;
- itens com status PROCESSING devem possuir timeout;
- locks expirados devem ser recuperados;
- Worker deve revalidar item antes de reenviar;
- item com providerMessageId não deve ser reenviado automaticamente;
- métricas devem ser recalculáveis pelo banco.

A fonte de verdade é o banco.

BullMQ coordena execução, mas não substitui persistência de estado.

---

## 27. Retry

Retries devem ser classificados.

### Erros transitórios

Podem gerar retry:

- timeout;
- provider indisponível;
- HTTP 429;
- HTTP 502;
- HTTP 503;
- erro de rede.

### Erros permanentes

Não devem gerar retry automático:

- telefone inválido;
- contato bloqueado;
- opt-out;
- canal inexistente;
- credencial inválida persistente;
- conteúdo rejeitado;
- contato removido.

Estratégia sugerida:

- tentativa inicial;
- retry 1;
- retry 2;
- retry 3;
- falha definitiva.

Usar backoff exponencial.

---

## 28. Idempotência

A execução deve ser idempotente.

Mesmo que o job seja processado mais de uma vez, o sistema não deve enviar a mesma mensagem novamente.

Antes do envio:

- verificar status;
- verificar providerMessageId;
- verificar sentAt;
- obter lock do item;
- atualizar para PROCESSING atomicamente.

Depois do envio:

- salvar providerMessageId;
- salvar sentAt;
- atualizar status para SENT.

---

## 29. Transações e locks

Operações críticas devem usar transação ou atualização condicional.

Exemplo:

Atualizar item para PROCESSING somente se status atual for QUEUED ou RETRY_SCHEDULED.

Se nenhum registro for atualizado, outro Worker já assumiu o item.

Evitar locks longos de banco durante chamada HTTP externa.

Fluxo recomendado:

1. adquirir item atomicamente;
2. sair da transação;
3. chamar provider;
4. persistir resultado;
5. liberar estado.

---

## 30. Conteúdo da mensagem

O conteúdo deve ser congelado no Disparo.

Nunca buscar texto dinâmico editável durante a execução.

Campos futuros:

- body;
- templateId;
- variables;
- media;
- fallbackText;
- version.

No MVP inicial, pode ser apenas texto.

---

## 31. Personalização

Variáveis futuras:

- nome;
- cidade;
- bairro;
- candidato;
- campanha;
- campos personalizados.

A renderização deve ocorrer antes do envio ou no Worker, mas sempre de forma determinística.

Se uma variável obrigatória estiver ausente:

- usar fallback;
- ou marcar item como SKIPPED;
- nunca enviar texto quebrado.

---

## 32. Canais

O motor deve ser independente de provider.

Fluxo:

DispatchItem

↓

Channel Adapter

↓

Provider

Adapters futuros:

- EvolutionAdapter;
- WhatsAppCloudAdapter;
- EmailAdapter;
- SmsAdapter;
- TelegramAdapter;
- InstagramAdapter.

O domínio não deve conhecer URLs específicas de providers.

---

## 33. Status do provider

O provider pode retornar eventos posteriores.

Exemplos:

- sent;
- delivered;
- read;
- failed.

Esses eventos devem atualizar DispatchItem por providerMessageId.

Nunca confiar apenas no webhook sem validar:

- organizationId;
- campaignId;
- channelAccountId;
- providerMessageId.

---

## 34. Relatórios

Métricas mínimas:

- total planejado;
- total elegível;
- total excluído;
- total enfileirado;
- total processado;
- total enviado;
- total entregue;
- total lido;
- total falhou;
- total ignorado;
- total cancelado;
- duração;
- velocidade média;
- erros por categoria.

Relatórios devem ser derivados de DispatchItem.

Contadores no Dispatch podem ser usados para performance, mas devem ser reconciliáveis.

---

## 35. Auditoria

Toda ação sensível deve gerar auditoria.

Registrar:

- criação do Plano;
- alteração do Plano;
- validação;
- aprovação;
- criação do Disparo;
- início;
- pausa;
- retomada;
- cancelamento;
- conclusão;
- alteração de limites;
- retry manual;
- pausa emergencial.

Não registrar conteúdo sensível completo em metadata.

---

## 36. Permissões

Papéis iniciais:

### VIEWER

- pode visualizar Plano, Disparo e relatórios;
- não cria;
- não aprova;
- não executa.

### OPERATOR

- pode visualizar;
- pode acompanhar execução;
- não aprova disparo em massa inicialmente.

### MANAGER

- pode criar Plano;
- pode editar enquanto DRAFT;
- pode solicitar validação;
- pode iniciar Disparo aprovado, conforme regra futura.

### ADMIN

- pode criar;
- aprovar;
- pausar;
- cancelar;
- configurar limites permitidos.

### OWNER

- controle total;
- inclusive pausa emergencial e políticas da organização.

### COMPLIANCE

- pode revisar;
- bloquear aprovação;
- consultar auditoria;
- validar exclusões e blindagens.

A matriz final deve ser definida no épico de implementação.

---

## 37. Aprovação

Nenhum Disparo em massa deve iniciar sem aprovação explícita.

A aprovação deve registrar:

- usuário;
- data;
- Plano;
- versão do snapshot;
- total elegível;
- canal;
- conteúdo;
- blindagens;
- simulação.

No MVP, aprovação pode ser realizada por ADMIN ou OWNER.

Futuramente, poderá exigir dupla aprovação.

---

## 38. Simulação

Antes da aprovação, apresentar:

- total bruto;
- total elegível;
- exclusões;
- previsão de duração;
- velocidade;
- janela;
- quantidade por hora;
- canal;
- riscos;
- impacto esperado;
- limitações.

A simulação não envia nada.

---

## 39. Expiração do Plano

Planos podem expirar.

Motivos:

- canal desconectado;
- conteúdo desatualizado;
- Plano antigo demais;
- mudança de política;
- mudança importante no contato;
- janela de envio vencida.

A regra de expiração será definida posteriormente.

Plano expirado não pode gerar Disparo sem nova validação.

---

## 40. Versionamento

Se o Plano for alterado antes da aprovação:

- incrementar versão;
- invalidar validação anterior;
- recalcular snapshot quando público mudar;
- recalcular simulação;
- exigir nova aprovação.

Depois de aprovado, não editar.

Criar novo Plano ou nova versão explícita.

---

## 41. Observabilidade

Logs estruturados devem conter:

- dispatchId;
- dispatchItemId;
- organizationId;
- campaignId;
- channelAccountId;
- jobId;
- status;
- attempt;
- errorCode.

Nunca logar:

- API keys;
- tokens;
- conteúdo completo desnecessário;
- payload bruto sensível;
- lista completa de contatos.

---

## 42. Métricas técnicas

Métricas futuras:

- jobs por minuto;
- tempo médio por job;
- filas aguardando;
- falhas por provider;
- retries;
- canais desconectados;
- dispatches pausados;
- quantidade enviada por organização;
- tempo de processamento.

---

## 43. Alertas operacionais

Alertas futuros:

- canal desconectado durante execução;
- taxa de erro elevada;
- fila parada;
- Worker indisponível;
- Redis indisponível;
- limite atingido;
- execução fora da janela;
- muitos retries;
- crescimento inesperado de falhas.

---

## 44. Segurança

Regras obrigatórias:

- tenancy em todas as entidades;
- autorização na API;
- jobs contendo IDs mínimos;
- secrets apenas em env;
- adapters sem expor credenciais;
- conteúdo congelado;
- audit log;
- opt-out prevalecendo;
- nenhuma execução direta pelo frontend.

Frontend apenas solicita ações.

Backend valida e coordena.

Worker executa.

---

## 45. LGPD e compliance

O sistema deve permitir reconstruir:

- por que o contato entrou no Plano;
- qual era o consentimento;
- se havia opt-out;
- por que foi excluído;
- quando foi enviado;
- por qual canal;
- qual conteúdo foi enviado;
- quem aprovou;
- qual provider respondeu.

Esses dados devem permitir auditoria posterior.

---

## 46. O que não fazer

É proibido:

- disparar diretamente de Segment;
- enviar em loop dentro da API;
- enviar diretamente pelo frontend;
- enfileirar contatos sem snapshot;
- ignorar opt-out atual;
- recalcular público durante execução;
- alterar conteúdo após início;
- reenviar item SENT;
- depender apenas do BullMQ como fonte de verdade;
- criar jobs sem DispatchItem persistido;
- permitir disparo sem aprovação;
- permitir canal desconectado;
- executar sem limite;
- esconder falhas do usuário.

---

## 47. Estratégia de implementação

A implementação deve ser incremental.

### Épico 08 — Planejamento de Disparo

#### 08.1 — Plano de Disparo

- criar DispatchPlan;
- vincular segmento;
- escolher canal;
- registrar nome e descrição;
- ainda sem snapshot completo.

#### 08.2 — Snapshot do Público

- criar DispatchPlanRecipient;
- congelar contatos;
- registrar elegibilidade;
- registrar exclusões.

#### 08.3 — Blindagens Avançadas

- validar público;
- validar canal;
- validar opt-out;
- validar destino;
- validar duplicidade;
- validar limites.

#### 08.4 — Simulação

- estimar duração;
- volume;
- velocidade;
- riscos;
- janela.

#### 08.5 — Aprovação

- estados;
- permissões;
- audit log;
- imutabilidade.

---

### Épico 09 — Motor de Disparo

#### 09.1 — Entidade Dispatch

- criar Disparo a partir de Plano aprovado.

#### 09.2 — DispatchItems

- gerar itens individuais.

#### 09.3 — BullMQ

- criar fila;
- publicar jobs;
- controlar estados.

#### 09.4 — Worker de envio

- processar item;
- chamar adapter;
- persistir resultado.

#### 09.5 — Pausa, retomada e cancelamento

- controlar execução segura.

#### 09.6 — Retry e recuperação

- backoff;
- locks;
- idempotência;
- retomada após falha.

#### 09.7 — Monitoramento e relatórios

- progresso;
- métricas;
- erros;
- relatório final.

---

## 48. Critérios para iniciar o Épico 08

Antes de iniciar:

- Segmentos operacionais funcionando;
- pré-validação 07.1 validada;
- opt-out funcionando;
- contatos removidos excluídos;
- canais conectados identificáveis;
- permissões básicas funcionando;
- audit log disponível;
- Blueprint 14 aprovado.

Essas condições já estão majoritariamente atendidas.

---

## 49. Critérios para iniciar envio real

Nenhum envio em massa real deverá ocorrer antes de:

- Plano aprovado;
- snapshot congelado;
- blindagens concluídas;
- conteúdo congelado;
- canal conectado;
- fila BullMQ funcional;
- Worker funcional;
- idempotência testada;
- pausa testada;
- cancelamento testado;
- retry testado;
- opt-out de última milha testado;
- limite conservador configurado;
- execução piloto com poucos contatos.

---

## 50. Execução piloto

O primeiro disparo real deverá ser limitado.

Sugestão conceitual:

- 3 a 5 contatos internos;
- depois 10 contatos;
- depois 25 contatos;
- depois 50 contatos.

O limite só deve aumentar após validação.

Nunca iniciar com base completa.

---

## 51. Evolução multicanal

O mesmo motor deverá servir para:

- WhatsApp Evolution;
- WhatsApp Cloud API;
- e-mail;
- SMS;
- Telegram;
- outros canais futuros.

O que muda:

- adapter;
- validações específicas;
- limites;
- conteúdo;
- retorno do provider.

O que permanece:

- Plano;
- snapshot;
- blindagens;
- aprovação;
- Disparo;
- itens;
- fila;
- Worker;
- auditoria;
- relatórios.

---

## 52. Critério de aceite arquitetural

A arquitetura estará respeitada quando:

- Segment não envia;
- Plano não envia;
- Disparo só nasce de Plano aprovado;
- público é congelado;
- cada destinatário possui item persistido;
- Worker não escolhe público;
- adapter não decide elegibilidade;
- opt-out é revalidado;
- execução pode pausar;
- execução pode cancelar;
- jobs são idempotentes;
- falha não gera envio duplicado;
- sistema pode retomar após queda;
- relatórios derivam de itens;
- tudo é auditável.

---

## 53. Próximo documento

O próximo documento deve ser:

**Épico 08 — Planejamento de Disparo**

Arquivo sugerido:

`docs/epicos/08-PLANEJAMENTO-DE-DISPARO.md`

Esse documento deve transformar este blueprint em subetapas práticas, começando por:

**08.1 — Estrutura inicial do Plano de Disparo**

A primeira subetapa não deve criar fila, Worker nem enviar mensagens.

Ela deve apenas criar a entidade Plano de Disparo, seus estados iniciais, vínculo com segmento e canal, API básica e interface de rascunho.