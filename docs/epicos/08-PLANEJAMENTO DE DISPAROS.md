# Épico 08 — Planejamento de Disparo

## 1. Objetivo do épico

O objetivo deste épico é criar a camada de planejamento que antecede qualquer disparo em massa no Campanha360 AI.

Este épico não envia mensagens.

Ele transforma um segmento dinâmico em um Plano de Disparo controlado, auditável e progressivamente imutável.

Ao final deste épico, o sistema deve permitir:

- criar um Plano de Disparo;
- vincular um segmento;
- selecionar um canal;
- definir conteúdo textual inicial;
- congelar o público em um snapshot;
- registrar contatos elegíveis e excluídos;
- aplicar blindagens;
- simular duração e volume;
- aprovar ou rejeitar o Plano;
- impedir alterações indevidas após aprovação;
- preparar a base para o futuro Motor de Disparo.

---

## 2. Contexto atual

O Campanha360 AI já possui:

- autenticação;
- organizações;
- campanhas;
- permissões;
- CRM operacional;
- contatos;
- tags;
- notas;
- tarefas;
- opt-out;
- bloqueio;
- importação CSV;
- segmentos operacionais;
- pré-validação de público;
- canais WhatsApp Evolution;
- conexão por QR Code;
- webhook autenticado;
- Atendimento com mensagens inbound e outbound;
- audit log;
- PostgreSQL;
- Redis;
- BullMQ e Worker disponíveis na infraestrutura.

Essas bases permitem iniciar o planejamento de disparos sem ainda executar envios em massa.

---

## 3. Princípio central

Nenhum disparo deve nascer diretamente de um segmento.

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

Disparo futuro

O Plano é a fronteira entre seleção dinâmica e execução controlada.

---

## 4. Diferença entre segmento e Plano

### Segmento

Define critérios dinâmicos.

Exemplos:

- tag Apoiador;
- cidade determinada;
- status operacional;
- canal disponível;
- sem opt-out.

O resultado pode mudar a qualquer momento.

### Plano de Disparo

Congela a decisão.

Ele registra:

- qual segmento foi usado;
- quando foi avaliado;
- quais contatos foram analisados;
- quais foram elegíveis;
- quais foram excluídos;
- por qual motivo;
- qual canal foi selecionado;
- qual conteúdo seria enviado;
- quais blindagens foram aplicadas;
- quem aprovou.

O Plano não deve mudar automaticamente se o segmento mudar.

---

## 5. Fora de escopo deste épico

Não implementar neste épico:

- envio real de mensagens;
- fila BullMQ de disparo;
- Worker de disparo;
- Dispatch;
- DispatchItem;
- retry;
- pausa;
- retomada;
- cancelamento de execução;
- envio em lotes;
- métricas de entrega;
- WebSocket;
- automações;
- IA;
- templates avançados;
- mídia;
- e-mail;
- SMS;
- Instagram;
- Telegram.

Esses itens pertencem aos épicos seguintes.

---

## 6. Subetapas do épico

O épico será dividido em:

1. 08.1 — Estrutura inicial do Plano de Disparo.
2. 08.2 — Snapshot do Público.
3. 08.3 — Blindagens Avançadas.
4. 08.4 — Simulação de Disparo.
5. 08.5 — Aprovação e Imutabilidade.

A ordem deve ser respeitada.

---

# 7. Subetapa 08.1 — Estrutura inicial do Plano de Disparo

## 7.1 Objetivo

Criar a entidade inicial de Plano de Disparo e permitir que o usuário salve um rascunho vinculado a segmento, canal e conteúdo textual.

Ainda não deve existir snapshot completo nem aprovação.

---

## 7.2 Entidade DispatchPlan

Campos iniciais sugeridos:

- id;
- organizationId;
- campaignId;
- segmentId;
- channelAccountId;
- name;
- description;
- channelType;
- content;
- status;
- version;
- createdByUserId;
- createdAt;
- updatedAt.

Status iniciais:

- DRAFT;
- VALIDATING;
- VALIDATED;
- BLOCKED;
- APPROVED;
- REJECTED;
- EXPIRED;
- CANCELED.

Na 08.1, o fluxo operacional deve usar principalmente DRAFT.

---

## 7.3 Entregas da 08.1

### Prisma

- criar enum DispatchPlanStatus;
- criar modelo DispatchPlan;
- relações com Organization;
- relações com Campaign;
- relação com Segment;
- relação com ChannelAccount;
- relação com User criador;
- índices por organizationId e campaignId;
- índice por status;
- migration versionada.

### API

Rotas sugeridas:

- GET /campaigns/:campaignId/dispatch-plans
- POST /campaigns/:campaignId/dispatch-plans
- GET /campaigns/:campaignId/dispatch-plans/:dispatchPlanId
- PUT /campaigns/:campaignId/dispatch-plans/:dispatchPlanId
- DELETE ou POST de cancelamento apenas se necessário

Operações esperadas:

- listar Planos da campanha;
- criar Plano em DRAFT;
- visualizar detalhe;
- editar Plano enquanto DRAFT;
- cancelar Plano ainda não aprovado;
- validar tenancy;
- validar segmento;
- validar canal;
- validar permissões;
- registrar audit log.

### Web

Criar:

- link Planejamento de Disparos na campanha;
- página de listagem;
- página de criação;
- página de detalhe;
- edição de rascunho;
- status visível;
- seleção de segmento;
- seleção de canal;
- campo de nome;
- descrição opcional;
- conteúdo textual inicial;
- aviso explícito de que nada será enviado.

---

## 7.4 Regras da 08.1

- Plano pertence obrigatoriamente a organizationId e campaignId;
- segmento deve pertencer à mesma campanha;
- canal deve pertencer à mesma campanha;
- canal deve ser do tipo compatível;
- Plano inicia em DRAFT;
- apenas OWNER, ADMIN ou MANAGER podem criar e editar;
- VIEWER pode visualizar;
- conteúdo textual pode ser simples;
- nenhuma mensagem deve ser enviada;
- nenhuma fila deve ser criada;
- nenhum recipient deve ser criado ainda;
- não recalcular segmento automaticamente;
- registrar audit log de criação e edição.

---

## 7.5 Audit log da 08.1

Eventos mínimos:

- DISPATCH_PLAN_CREATED;
- DISPATCH_PLAN_UPDATED;
- DISPATCH_PLAN_CANCELED.

Metadata segura pode conter:

- dispatchPlanId;
- segmentId;
- channelAccountId;
- status;
- version.

Não registrar conteúdo completo da mensagem no audit log.

---

## 7.6 Critério de aceite da 08.1

A subetapa estará concluída quando:

- usuário cria Plano em DRAFT;
- Plano aparece na listagem;
- usuário abre o detalhe;
- usuário edita nome, descrição, segmento, canal e conteúdo;
- VIEWER não edita;
- tenancy está protegida;
- migration aplicada;
- nenhum envio acontece;
- nenhum job é criado;
- typecheck e build passam.

---

# 8. Subetapa 08.2 — Snapshot do Público

## 8.1 Objetivo

Congelar o público do segmento dentro do Plano.

O snapshot deve registrar contatos elegíveis e excluídos naquele momento.

---

## 8.2 Entidade DispatchPlanRecipient

Campos sugeridos:

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

---

## 8.3 Status de elegibilidade

Enum sugerido:

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

## 8.4 Entregas da 08.2

### API

Criar ação explícita:

- POST /campaigns/:campaignId/dispatch-plans/:dispatchPlanId/snapshot

A ação deve:

1. validar Plano DRAFT;
2. carregar segmento;
3. resolver filtros;
4. avaliar contatos;
5. normalizar destinos;
6. detectar duplicados;
7. registrar elegibilidade;
8. criar recipients;
9. atualizar totais;
10. incrementar versão se necessário;
11. registrar audit log.

### Campos agregados no Plano

Adicionar ou preencher:

- totalEvaluated;
- totalEligible;
- totalExcluded;
- snapshotCreatedAt;
- filtersSnapshot;
- validationSnapshot inicial.

### Web

No detalhe do Plano:

- botão Gerar snapshot;
- confirmação antes de substituir snapshot existente;
- resumo com:
  - total avaliado;
  - elegíveis;
  - excluídos;
  - motivos;
- tabela ou lista de recipients;
- filtro por elegibilidade;
- aviso de que o público foi congelado.

---

## 8.5 Regras da 08.2

- snapshot não deve ser criado automaticamente ao abrir a página;
- gerar snapshot deve ser ação explícita;
- Plano aprovado não pode regenerar snapshot;
- ao regenerar snapshot em DRAFT:
  - apagar recipients anteriores em transação;
  - criar novo conjunto;
  - incrementar versão;
  - invalidar validações anteriores;
- opt-out deve excluir;
- BLOCKED deve excluir;
- DELETED deve excluir;
- telefone inválido deve excluir;
- duplicidade deve excluir todos os excedentes;
- cada destino normalizado deve aparecer no máximo uma vez como ELIGIBLE.

---

## 8.6 Snapshot de contato

contactSnapshot deve conter apenas dados necessários, por exemplo:

- nome;
- telefone;
- cidade;
- bairro;
- tags;
- status operacional;
- origem;
- responsável.

Não copiar dados desnecessários.

---

## 8.7 Snapshot de consentimento

consentSnapshot deve registrar:

- canal;
- status;
- source;
- collectedAt;
- revokedAt.

---

## 8.8 Snapshot de opt-out

optOutSnapshot deve registrar:

- existência;
- canal;
- data;
- motivo, se houver.

---

## 8.9 Critério de aceite da 08.2

A subetapa estará concluída quando:

- Plano DRAFT gera snapshot;
- recipients são persistidos;
- total avaliado é correto;
- elegíveis e excluídos são registrados;
- motivos de exclusão são visíveis;
- duplicados não entram como elegíveis;
- opt-out/BLOCKED/DELETED não entram;
- segmento alterado depois não muda o snapshot;
- nenhum envio acontece.

---

# 9. Subetapa 08.3 — Blindagens Avançadas

## 9.1 Objetivo

Aplicar validações obrigatórias antes que o Plano possa ser considerado válido.

---

## 9.2 Blindagens mínimas

Validar:

- Plano possui snapshot;
- público elegível não está vazio;
- segmento existe;
- canal existe;
- canal não está ARCHIVED;
- canal está CONNECTED;
- conteúdo não está vazio;
- conteúdo está dentro do limite inicial;
- Plano possui recipients;
- destinos elegíveis são únicos;
- opt-out não está em elegíveis;
- BLOCKED não está em elegíveis;
- DELETED não está em elegíveis;
- destinos são válidos;
- volume está dentro do limite provisório;
- usuário possui permissão;
- campanha está ativa;
- não há outro bloqueio crítico.

---

## 9.3 Resultado da validação

validationSnapshot deve registrar:

- checkedAt;
- passed;
- criticalErrors;
- warnings;
- totals;
- channelStatus;
- contentChecks;
- audienceChecks;
- policyChecks.

---

## 9.4 Severidades

### ERROR

Impede validação.

Exemplos:

- canal desconectado;
- público vazio;
- conteúdo vazio;
- snapshot inexistente;
- opt-out entre elegíveis;
- duplicidade crítica.

### WARNING

Não impede necessariamente.

Exemplos:

- público elevado;
- canal recém-conectado;
- Plano antigo;
- conteúdo próximo do limite;
- muitos contatos sem nome.

### INFO

Informações operacionais.

Exemplos:

- total de contatos;
- canal escolhido;
- data do snapshot;
- quantidade de excluídos.

---

## 9.5 Estados

Ao iniciar:

DRAFT

↓

VALIDATING

Se passar:

VALIDATING

↓

VALIDATED

Se falhar:

VALIDATING

↓

BLOCKED

Ao editar um Plano VALIDATED:

- voltar para DRAFT;
- invalidar validationSnapshot;
- exigir nova validação.

---

## 9.6 API

Ação sugerida:

- POST /campaigns/:campaignId/dispatch-plans/:dispatchPlanId/validate

Resposta:

- status;
- passed;
- criticalErrors;
- warnings;
- totals.

---

## 9.7 Web

No detalhe do Plano:

- botão Validar Plano;
- painel de blindagens;
- erros críticos destacados;
- warnings separados;
- status atualizado;
- sem botão de aprovação quando BLOCKED;
- indicação do que corrigir.

---

## 9.8 Limite provisório

Definir limite conservador inicial apenas para planejamento.

Exemplo:

- até 100 contatos elegíveis no primeiro estágio.

Esse limite ainda não autoriza envio.

Ele apenas gera warning ou bloqueio configurável.

O valor não deve ficar espalhado no código.

Usar constante central ou configuração.

---

## 9.9 Critério de aceite da 08.3

A subetapa estará concluída quando:

- Plano pode ser validado;
- erros críticos bloqueiam;
- warnings aparecem;
- canal desconectado bloqueia;
- público vazio bloqueia;
- conteúdo vazio bloqueia;
- alterações invalidam validação anterior;
- status muda corretamente;
- nenhum envio acontece.

---

# 10. Subetapa 08.4 — Simulação de Disparo

## 10.1 Objetivo

Estimar como seria a execução, sem enviar mensagens.

---

## 10.2 Dados da simulação

Calcular:

- total elegível;
- total excluído;
- mensagens por minuto;
- atraso mínimo;
- atraso máximo;
- duração estimada;
- data/hora estimada de início;
- data/hora estimada de término;
- quantidade por hora;
- quantidade por lote;
- pausas estimadas;
- canal;
- janela de envio;
- riscos.

---

## 10.3 Configurações iniciais

Campos conceituais:

- messagesPerMinute;
- minDelaySeconds;
- maxDelaySeconds;
- batchSize;
- pauseBetweenBatchesSeconds;
- timezone;
- allowedStartTime;
- allowedEndTime;
- allowedDays.

Na primeira versão, pode existir configuração simples e conservadora.

---

## 10.4 Regras da simulação

- não criar jobs;
- não chamar Evolution;
- não alterar contatos;
- não alterar mensagens;
- não criar Dispatch;
- simulação depende de Plano VALIDATED;
- se Plano mudar, simulação deve ser invalidada;
- duração deve considerar intervalo médio;
- janela deve considerar timezone.

---

## 10.5 API

Ação sugerida:

- POST /campaigns/:campaignId/dispatch-plans/:dispatchPlanId/simulate

A resposta deve conter:

- simulationSnapshot;
- warnings;
- estimatedDurationSeconds;
- estimatedStartAt;
- estimatedEndAt.

---

## 10.6 Web

No detalhe:

- painel Simulação;
- controles de velocidade;
- janela de envio;
- duração estimada;
- volume;
- warnings;
- botão Recalcular simulação.

---

## 10.7 Critério de aceite da 08.4

A subetapa estará concluída quando:

- Plano VALIDATED gera simulação;
- duração é calculada;
- janela é exibida;
- riscos são mostrados;
- simulação é persistida;
- alteração do Plano invalida simulação;
- nenhum envio ocorre.

---

# 11. Subetapa 08.5 — Aprovação e Imutabilidade

## 11.1 Objetivo

Permitir aprovação explícita do Plano e impedir alterações após aprovação.

---

## 11.2 Quem pode aprovar

Inicialmente:

- OWNER;
- ADMIN.

MANAGER pode:

- criar;
- editar;
- gerar snapshot;
- validar;
- simular.

MANAGER não aprova inicialmente.

VIEWER apenas visualiza.

COMPLIANCE poderá revisar futuramente.

---

## 11.3 Pré-condições para aprovação

O Plano só pode ser aprovado se:

- status VALIDATED;
- snapshot existe;
- totalEligible maior que zero;
- sem criticalErrors;
- simulationSnapshot existe;
- canal continua válido;
- conteúdo existe;
- usuário tem permissão;
- versão validada é a versão atual.

---

## 11.4 Campos de aprovação

Adicionar:

- approvedByUserId;
- approvedAt;
- approvalSnapshot;
- status APPROVED.

approvalSnapshot deve registrar:

- versão;
- totais;
- canal;
- conteúdo;
- blindagens;
- simulação;
- data;
- usuário.

---

## 11.5 Rejeição

Usuário autorizado pode rejeitar Plano VALIDATED.

Campos:

- rejectedByUserId;
- rejectedAt;
- rejectionReason;
- status REJECTED.

Plano rejeitado não deve gerar Disparo.

Pode ser duplicado em novo Plano futuramente.

---

## 11.6 Cancelamento

Plano DRAFT, BLOCKED ou VALIDATED pode ser cancelado.

Plano APPROVED pode ser cancelado apenas antes da criação de Dispatch.

Após criar Dispatch, o Plano permanece aprovado e o controle passa ao Disparo.

---

## 11.7 Imutabilidade

Após APPROVED, bloquear edição de:

- nome, se fizer parte da identificação oficial;
- segmento;
- canal;
- conteúdo;
- snapshot;
- recipients;
- blindagens;
- simulação;
- configurações de envio.

A API deve bloquear, não apenas a UI.

---

## 11.8 API

Ações sugeridas:

- POST /campaigns/:campaignId/dispatch-plans/:dispatchPlanId/approve
- POST /campaigns/:campaignId/dispatch-plans/:dispatchPlanId/reject
- POST /campaigns/:campaignId/dispatch-plans/:dispatchPlanId/cancel

---

## 11.9 Web

No detalhe:

- resumo final;
- botão Aprovar;
- confirmação explícita;
- botão Rejeitar;
- campo motivo;
- estado somente leitura após aprovação;
- aviso de imutabilidade;
- nenhum botão de envio real.

---

## 11.10 Audit log

Eventos:

- DISPATCH_PLAN_VALIDATED;
- DISPATCH_PLAN_BLOCKED;
- DISPATCH_PLAN_SIMULATED;
- DISPATCH_PLAN_APPROVED;
- DISPATCH_PLAN_REJECTED;
- DISPATCH_PLAN_CANCELED.

---

## 11.11 Critério de aceite da 08.5

A subetapa estará concluída quando:

- OWNER/ADMIN aprova Plano válido;
- MANAGER não aprova;
- Plano APPROVED fica imutável;
- API rejeita edição;
- rejeição exige motivo;
- cancelamento funciona dentro das regras;
- audit log é criado;
- nenhum envio é realizado.

---

# 12. Estrutura de navegação

Rotas sugeridas:

- /dashboard/campaigns/[id]/dispatch-plans
- /dashboard/campaigns/[id]/dispatch-plans/new
- /dashboard/campaigns/[id]/dispatch-plans/[dispatchPlanId]

Na campanha, adicionar acesso:

- Planejamento de Disparos

Não chamar simplesmente de Disparos enquanto ainda não existir execução.

---

# 13. UX do Plano

A página de detalhe deve apresentar etapas claras:

1. Rascunho
2. Snapshot
3. Blindagens
4. Simulação
5. Aprovação

Cada etapa deve mostrar:

- status;
- pendências;
- ações permitidas;
- erros;
- conclusão.

Evitar uma página gigante sem hierarquia.

---

# 14. Componente de progresso

Componente sugerido:

DispatchPlanProgress

Etapas:

- Configuração;
- Público;
- Validação;
- Simulação;
- Aprovação.

Estados visuais:

- pendente;
- em andamento;
- concluído;
- bloqueado.

---

# 15. Regras de tenancy

Todas as entidades devem carregar:

- organizationId;
- campaignId.

Toda operação deve validar:

- usuário pertence à organização;
- Plano pertence à campanha;
- Segment pertence à campanha;
- ChannelAccount pertence à campanha;
- recipients pertencem ao Plano;
- usuário possui papel adequado.

---

# 16. Regras de segurança

- nenhuma credencial no Plano;
- nenhum token em snapshot;
- nenhum payload bruto da Evolution;
- conteúdo não deve aparecer integralmente em logs;
- API é fonte de verdade;
- frontend não decide permissão;
- aprovação deve ser protegida no backend;
- Plano aprovado não pode ser alterado por chamada direta.

---

# 17. Regras de compliance

O sistema deve permitir responder:

- por que o contato entrou;
- por que foi excluído;
- qual era seu status;
- se havia consentimento;
- se havia opt-out;
- quando o snapshot foi criado;
- quem criou;
- quem aprovou;
- qual conteúdo foi aprovado;
- qual canal foi selecionado.

---

# 18. Regras de versionamento

Campo version inicia em 1.

Incrementar quando:

- segmento mudar;
- canal mudar;
- conteúdo mudar;
- snapshot for regenerado;
- configuração relevante mudar.

Ao incrementar:

- invalidar validação;
- invalidar simulação;
- remover aprovação pendente;
- status volta para DRAFT.

Plano APPROVED não incrementa.

Criar novo Plano.

---

# 19. Regras de exclusão

Não realizar hard delete de Plano com snapshot, validação ou aprovação.

Usar status CANCELED.

Plano DRAFT sem recipients pode permitir remoção física apenas se seguro, mas não é prioridade.

Preferência:

- cancelamento lógico;
- preservação para auditoria.

---

# 20. Regras de performance

Snapshot pode crescer.

Cuidados:

- criação em transação controlada;
- batch insert;
- índices;
- paginação de recipients;
- não retornar todos os recipients em uma única resposta;
- agregações no backend;
- filtros por eligibilityStatus.

Na primeira versão, limitar tamanho do Plano.

---

# 21. Limite inicial recomendado

Para homologação:

- até 100 recipients por Plano.

Depois:

- 500;
- 1.000;
- valores maiores somente após Motor de Disparo estável.

O limite deve ser configurável.

---

# 22. Regras de testes

Toda subetapa deve executar:

- npm run prisma:generate, quando Prisma mudar;
- npm run typecheck;
- npm run build;
- testes existentes;
- testes novos do módulo.

---

# 23. Testes da 08.1

Testar:

- criar Plano;
- listar Planos;
- visualizar detalhe;
- editar DRAFT;
- bloquear acesso entre campanhas;
- VIEWER não escreve;
- canal de outra campanha rejeitado;
- segmento de outra campanha rejeitado.

---

# 24. Testes da 08.2

Testar:

- gerar snapshot;
- congelar público;
- opt-out excluído;
- BLOCKED excluído;
- DELETED excluído;
- telefone inválido excluído;
- duplicado excluído;
- regeneração incrementa versão;
- segmento posterior não altera snapshot.

---

# 25. Testes da 08.3

Testar:

- canal desconectado bloqueia;
- público vazio bloqueia;
- conteúdo vazio bloqueia;
- Plano válido passa;
- alteração posterior invalida validação;
- warnings não são tratados como errors.

---

# 26. Testes da 08.4

Testar:

- duração estimada;
- janela de envio;
- timezone;
- quantidade por minuto;
- simulação sem envio;
- alteração invalida simulação.

---

# 27. Testes da 08.5

Testar:

- OWNER aprova;
- ADMIN aprova;
- MANAGER não aprova;
- VIEWER não aprova;
- Plano inválido não aprova;
- APPROVED não edita;
- rejeição exige motivo;
- cancelamento respeita estado.

---

# 28. Ordem de deploy

Quando houver migration:

1. push do commit;
2. deploy da API com prisma migrate deploy;
3. confirmar health;
4. deploy da Web;
5. validar funcionalidade;
6. revisar logs;
7. marcar subetapa como concluída.

Worker não deve ser alterado neste épico.

---

# 29. Critério final do Épico 08

O Épico 08 estará concluído quando:

- usuário cria Plano em DRAFT;
- seleciona segmento e canal;
- define conteúdo;
- gera snapshot;
- visualiza elegíveis e excluídos;
- aplica blindagens;
- gera simulação;
- OWNER ou ADMIN aprova;
- Plano aprovado fica imutável;
- nenhum envio real ocorre;
- tudo é auditável.

---

# 30. Estado esperado ao final

Ao terminar o épico, o usuário deve enxergar:

Plano de Disparo

- Público congelado
- 842 contatos avaliados
- 790 elegíveis
- 22 opt-out
- 12 inválidos
- 8 duplicados
- 10 removidos
- Canal conectado
- Conteúdo validado
- Duração estimada
- Blindagens aprovadas
- Plano aprovado

Mas ainda sem botão de executar disparo real.

---

# 31. Próximo épico

O próximo documento deve ser:

**Épico 09 — Motor de Disparo**

Arquivo sugerido:

`docs/epicos/09-MOTOR-DE-DISPARO.md`

Subetapas previstas:

- 09.1 — Entidade Dispatch;
- 09.2 — DispatchItems;
- 09.3 — Fila BullMQ;
- 09.4 — Worker de envio;
- 09.5 — Pausa, retomada e cancelamento;
- 09.6 — Retry, idempotência e recuperação;
- 09.7 — Monitoramento e relatórios.

Nenhuma dessas etapas deve começar antes da conclusão e validação do Épico 08.

---

# 32. Proxima acao pratica

## Estado da 08.1

**Concluida no codigo (estrutura inicial).**

Entregue:

- enum `DispatchPlanStatus` e modelo `DispatchPlan` no Prisma;
- migration `20260721123000_dispatch_plans`;
- API CRUD + cancelamento em `/campaigns/:campaignId/dispatch-plans`;
- audit `DISPATCH_PLAN_CREATED`, `DISPATCH_PLAN_UPDATED`, `DISPATCH_PLAN_CANCELED`;
- paginas Web de listagem, criacao e detalhe;
- link **Planejamento de Disparos** na campanha;
- testes de utilitarios da 08.1.

Fora desta subetapa (intencional):

- snapshot / recipients;
- validacao / blindagens;
- simulacao;
- aprovacao;
- fila / Worker / envio.

## Estado da 08.2

**Concluida no codigo (snapshot persistido do publico).**

Entregue:

- enum `DispatchPlanRecipientEligibilityStatus`;
- modelo `DispatchPlanRecipient`, com tenancy, snapshots JSON, indices e
  restricao unica por Plano/contato/destino;
- campos agregados e snapshots reservados no `DispatchPlan`;
- migration `20260721133000_dispatch_plan_recipients`;
- `POST /campaigns/:campaignId/dispatch-plans/:dispatchPlanId/snapshot`;
- `GET /campaigns/:campaignId/dispatch-plans/:dispatchPlanId/recipients`,
  paginada e filtravel;
- resolucao estrutural pelos mesmos filtros usados na pre-validacao 07.1;
- classificacao de elegiveis, opt-out, bloqueados, removidos, destinos
  invalidos, duplicados e contatos sem canal WhatsApp ativo;
- `contactSnapshot`, `consentSnapshot` e `optOutSnapshot` apenas com dados
  reais e necessarios;
- regeneracao atomica em `DRAFT`, com substituicao integral dos recipients,
  incremento de versao e limpeza de `validationSnapshot`;
- audit `DISPATCH_PLAN_SNAPSHOT_CREATED` e
  `DISPATCH_PLAN_SNAPSHOT_REGENERATED`, sem contatos, telefones, conteudo ou
  filtros completos no metadata;
- etapa Publico na pagina de detalhe, com resumo, distribuicao, busca,
  filtros e tabela paginada;
- testes unitarios e de servico da geracao, elegibilidade, tenancy,
  regeneracao e paginacao.

Limitacoes atuais:

- snapshot disponivel somente para Planos em `DRAFT`;
- limite tecnico atual de 5.000 contatos avaliados por geracao, alinhado ao
  teto ja usado pela pre-validacao 07.1;
- somente destino WhatsApp em canal `WHATSAPP_EVOLUTION`;
- `validationSnapshot` permanece reservado e sempre e limpo na regeneracao;
- a elegibilidade congelada nao substitui a revalidacao de ultima milha
  prevista para o futuro Worker.

Fora desta subetapa (intencional):

- blindagens e estados da 08.3;
- simulacao;
- aprovacao ou rejeicao;
- `Dispatch` e `DispatchItem`;
- BullMQ, Worker, Evolution send, retry, pausa ou execucao.

## Proxima subetapa

Implementar apenas:

**08.3 — Blindagens Avancadas**