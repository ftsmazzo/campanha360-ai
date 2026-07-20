# Épico 05 — Base de Contatos da Campanha

## 1. Objetivo do épico

Consolidar a base operacional de Contatos por campanha, conectando CRM, Atendimento/WhatsApp e próximos fluxos de importação/segmentação.

## 2. Contexto atual

Já existem:

- CRM operacional (épico 03): cadastro, tags, notas, tarefas, filtros;
- canais WhatsApp Evolution e inbox (épico 04);
- listagem (05.1), edição/opt-out (05.2), tags (05.3), importação CSV (05.4).

## 3. Fora de escopo do épico (nesta fase)

- segmentação avançada / listas dinâmicas;
- disparos em massa;
- IA;
- exclusão em massa;
- restauração de contatos removidos;
- automações pós-importação.

## 4. Subetapas

1. **05.1 — Base inicial de Contatos por campanha.**
2. **05.2 — Edição e organização básica de contatos.**
3. **05.3 — Tags/listas simples de contatos.**
4. **05.4 — Importação CSV simples de contatos.**
5. **05.5 — Remoção segura de contato.**

## 5–8. Subetapas 05.1 a 05.4

**Concluídas.**

## 9. Subetapa 05.5 — Remoção segura de contato

### Objetivo

Permitir remover contato criado/importado por engano, sem quebrar histórico, opt-out ou mensagens.

### Estrutura reutilizada

- `ContactStatus.DELETED` já existia — soft delete/arquivamento sem migration.
- Hard delete apenas quando não há mensagens, threads nem opt-outs.

### Entregas

- ação **Remover contato** no detalhe, com confirmação;
- `DELETE /campaigns/:campaignId/contacts/:contactId`;
- listagem/busca padrão exclui `DELETED`;
- com histórico: status `DELETED`, mensagens/threads/opt-out preservados;
- sem histórico: hard delete de cadastro auxiliar (canais, tags, notas, tarefas, consents);
- importação CSV continua sem reativar `DELETED` (não altera status);
- feedback e redirecionamento para a lista;
- documentação deste épico.

### Regras

- tenancy `organizationId` + `campaignId`;
- não apagar mensagens nem opt-out;
- não exclusão em massa / restauração / segmentação / disparos / IA;
- Atendimento e webhook não alterados nesta subetapa.

### Critério de aceite

Operador remove contato errado; some da lista/busca; com histórico o Atendimento permanece íntegro; opt-out preservado.

### Status

**Concluída.**

### Implementado

- util `contact-removal.util` + testes;
- filtro padrão `status != DELETED` em `buildContactListAndClauses`;
- UI de remoção no detalhe.

## 10. Próximo passo

Épico 05 operacionalmente fechado para base de contatos. Próximos épicos apenas quando autorizados.
