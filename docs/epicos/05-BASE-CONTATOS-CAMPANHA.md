# Épico 05 — Base de Contatos da Campanha

## 1. Objetivo do épico

Consolidar a base operacional de Contatos por campanha, conectando CRM, Atendimento/WhatsApp e próximos fluxos de importação/segmentação.

Este épico **não** começa por CSV. A primeira entrega usa contatos já gerados pelas conversas e pelo cadastro manual.

## 2. Contexto atual

Já existem:

- CRM operacional (épico 03): cadastro, tags, notas, tarefas, filtros;
- canais WhatsApp Evolution e inbox (épico 04);
- criação/atualização de contatos no webhook inbound;
- listagem operacional com última interação e atalho para Atendimento (05.1).

## 3. Fora de escopo do épico (nesta fase)

- importação CSV em massa;
- segmentação avançada / listas salvas;
- disparos em massa;
- IA;
- templates;
- enriquecimento externo avançado.

## 4. Subetapas

1. **05.1 — Base inicial de Contatos por campanha.**
2. **05.2 — Edição e organização básica de contatos.**
3. **05.3 — Importação CSV manual** (posterior; alinhada ao Blueprint 01/07).
4. **05.4 — Filtros/segmentação inicial** (posterior).

## 5. Subetapa 05.1 — Base inicial de Contatos por campanha

### Status

**Concluída.**

### Implementado

- enriquecimento da listagem/detalhe: `lastInteractionAt`, `messageCount`, `latestThreadId`, `latestChannel`;
- util `contact-interaction.util` + testes;
- UI de Contatos com canal, interação, mensagens e link ao Atendimento;
- webhook preenche nome a partir do `pushName` quando ausente.

## 6. Subetapa 05.2 — Edição e organização básica de contatos

### Objetivo

Permitir que o operador organize contatos individualmente: editar nome, registrar notas internas e marcar/desmarcar opt-out/bloqueio com confirmação — sem CSV, segmentação ou disparos.

### Entregas

- detalhe do contato com **modo de edição** (abrir/fechar formulário);
- edição de nome (e demais dados cadastrais já existentes) via API `PUT`;
- notas internas via `ContactNote` (modelo já existente; sem migration);
- exibição clara de telefone, canal/origem, status, opt-out/bloqueio e última interação;
- marcar e **desmarcar** opt-out/bloqueio manual com confirmação;
- feedback de sucesso/erro;
- link **Abrir conversa** preservado;
- lista de Contatos atualiza ao voltar (remount + refresh em foco);
- documentação deste épico.

### Regras

- tenancy por `organizationId` + `campaignId`;
- não implementar CSV, tags/listas avançadas novas, segmentação, disparos ou IA;
- não alterar webhook Evolution, envio manual do Atendimento ou autenticação;
- sem migration (modelo já suportava notas e opt-out).

### Critério de aceite

Operador edita nome, salva, vê alteração na lista; marca opt-out e envio no Atendimento fica bloqueado; desmarca e envio volta a ficar disponível.

### Status

**Concluída.**

### Implementado

- `DELETE /campaigns/:campaignId/contacts/:contactId/opt-out` (`clearOptOut`);
- `update` retorna contato enriquecido com interação;
- util `contact-opt-out.util` + testes;
- UI: modo edição, confirmação marcar/desmarcar, resumo operacional no detalhe;
- refresh da lista ao focar a janela.

### Fora de escopo (mantido)

- CSV;
- segmentação avançada;
- disparos;
- IA.

## 7. Próximo passo

**05.3 — Importação CSV manual**, apenas quando autorizada explicitamente.
