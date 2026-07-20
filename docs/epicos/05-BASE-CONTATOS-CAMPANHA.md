# Épico 05 — Base de Contatos da Campanha

## 1. Objetivo do épico

Consolidar a base operacional de Contatos por campanha, conectando CRM, Atendimento/WhatsApp e próximos fluxos de importação/segmentação.

## 2. Contexto atual

Já existem:

- CRM operacional (épico 03): cadastro, tags, notas, tarefas, filtros;
- canais WhatsApp Evolution e inbox (épico 04);
- listagem operacional (05.1), edição/opt-out (05.2), tags simples (05.3).

## 3. Fora de escopo do épico (nesta fase)

- segmentação avançada / listas dinâmicas;
- disparos em massa;
- IA;
- templates;
- enriquecimento externo avançado;
- automações pós-importação.

## 4. Subetapas

1. **05.1 — Base inicial de Contatos por campanha.**
2. **05.2 — Edição e organização básica de contatos.**
3. **05.3 — Tags/listas simples de contatos.**
4. **05.4 — Importação CSV simples de contatos.**
5. **05.5 — Segmentação inicial avançada** (posterior).

## 5–7. Subetapas 05.1 a 05.3

**Concluídas.** Ver histórico deste arquivo e commits no repositório.

## 8. Subetapa 05.4 — Importação CSV simples de contatos

### Objetivo

Permitir importar contatos por CSV dentro de uma campanha, com validação, deduplicação básica por telefone e preservação de opt-out — sem disparos e sem segmentação avançada.

### Entregas

- upload/importação na página de Contatos;
- colunas mínimas: `nome`, `telefone`;
- opcionais: `observacao`, `tags` (`;` ou `|`);
- telefone obrigatório e normalizado (`normalizePhone`);
- cria novos / atualiza existentes pelo telefone na mesma campanha;
- **nunca** desbloqueia contato com opt-out/BLOCKED;
- cria/reutiliza tags da campanha e associa;
- observação vira `ContactNote`;
- resumo: criados, atualizados, ignorados, erros;
- auditoria sem telefones completos;
- documentação deste épico.

### Regras

- tenancy `organizationId` + `campaignId`;
- sem disparos, segmentação, IA, enriquecimento externo, webhook/Atendimento/opt-out alterados;
- sem migration (modelo atual suficiente).

### Critério de aceite

Operador importa CSV pequeno, vê o resumo, confere lista/busca/tags e contato bloqueado permanece bloqueado.

### Status

**Concluída.**

### Implementado

- `POST /campaigns/:campaignId/contacts/import`;
- util `contact-import.util` + testes;
- UI de upload + resumo na lista de Contatos.

### Fora de escopo (mantido)

- disparos;
- segmentação avançada;
- preview multi-etapa / worker assíncrono;
- IA.

## 9. Próximo passo

**05.5 — Segmentação inicial avançada**, apenas quando autorizada explicitamente.
