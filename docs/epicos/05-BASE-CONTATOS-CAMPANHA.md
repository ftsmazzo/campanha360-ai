# Épico 05 — Base de Contatos da Campanha

## 1. Objetivo do épico

Consolidar a base operacional de Contatos por campanha, conectando CRM, Atendimento/WhatsApp e próximos fluxos de importação/segmentação.

Este épico **não** começa por CSV. A primeira entrega usa contatos já gerados pelas conversas e pelo cadastro manual.

## 2. Contexto atual

Já existem:

- CRM operacional (épico 03): cadastro, tags, notas, tarefas, filtros;
- canais WhatsApp Evolution e inbox (épico 04);
- criação/atualização de contatos no webhook inbound.

Falta tornar a lista de Contatos a visão operacional clara da base vinda do Atendimento, com última interação e atalho para a conversa.

## 3. Fora de escopo do épico (nesta fase)

- importação CSV em massa;
- segmentação avançada / listas salvas;
- disparos em massa;
- IA;
- templates;
- enriquecimento externo avançado.

## 4. Subetapas

1. **05.1 — Base inicial de Contatos por campanha.**
2. **05.2 — Importação CSV manual** (posterior; alinhada ao Blueprint 01/07).
3. **05.3 — Filtros/segmentação inicial** (posterior).

## 5. Subetapa 05.1 — Base inicial de Contatos por campanha

### Objetivo

Exibir e operar a base de contatos da campanha com dados mínimos úteis para relacionamento, incluindo contatos criados pelo WhatsApp/Atendimento.

### Entregas

- página `/dashboard/campaigns/[id]/contacts` (já existente, enriquecida);
- navegação a partir da campanha;
- listagem com busca por nome/telefone;
- campos mínimos: nome, telefone, canal/origem, status, opt-out/bloqueio, última interação, quantidade de mensagens;
- atalho **Abrir conversa** no Atendimento quando houver thread;
- empty state orientando cadastro manual ou mensagens WhatsApp;
- webhook atualiza nome do contato quando pushName chega e o contato ainda não tem nome;
- documentação deste épico.

### Regras

- tenancy por `organizationId` + `campaignId`;
- não implementar CSV, segmentação avançada, disparos ou IA;
- não alterar envio manual validado;
- webhook só no mínimo necessário (create/update de contato);
- sem migration (modelo atual já suportava os campos).

### Critério de aceite

Operador abre Contatos, vê contatos vindos do Atendimento, busca por telefone/nome e abre a conversa correspondente.

### Status

**Concluída.**

### Implementado

- enriquecimento da listagem/detalhe: `lastInteractionAt`, `messageCount`, `latestThreadId`, `latestChannel`;
- util `contact-interaction.util` + testes;
- UI de Contatos com canal, interação, mensagens e link ao Atendimento;
- webhook preenche nome a partir do `pushName` quando ausente.

### Fora de escopo (mantido)

- CSV;
- tags avançadas novas;
- segmentação;
- disparos;
- IA.

## 6. Próximo passo

**05.2 — Importação CSV manual**, apenas quando autorizada explicitamente.
