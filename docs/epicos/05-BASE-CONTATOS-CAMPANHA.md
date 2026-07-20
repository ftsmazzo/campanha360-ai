# Épico 05 — Base de Contatos da Campanha

## 1. Objetivo do épico

Consolidar a base operacional de Contatos por campanha, conectando CRM, Atendimento/WhatsApp e próximos fluxos de importação/segmentação.

Este épico **não** começa por CSV. A primeira entrega usa contatos já gerados pelas conversas e pelo cadastro manual.

## 2. Contexto atual

Já existem:

- CRM operacional (épico 03): cadastro, tags, notas, tarefas, filtros;
- canais WhatsApp Evolution e inbox (épico 04);
- criação/atualização de contatos no webhook inbound;
- listagem operacional com última interação e atalho para Atendimento (05.1);
- edição básica e opt-out manual (05.2).

## 3. Fora de escopo do épico (nesta fase)

- importação CSV em massa;
- segmentação avançada / listas dinâmicas;
- disparos em massa;
- IA;
- templates;
- enriquecimento externo avançado;
- automações baseadas em tag.

## 4. Subetapas

1. **05.1 — Base inicial de Contatos por campanha.**
2. **05.2 — Edição e organização básica de contatos.**
3. **05.3 — Tags/listas simples de contatos.**
4. **05.4 — Importação CSV manual** (posterior; alinhada ao Blueprint 01/07).
5. **05.5 — Segmentação inicial avançada** (posterior).

## 5. Subetapa 05.1 — Base inicial de Contatos por campanha

### Status

**Concluída.**

## 6. Subetapa 05.2 — Edição e organização básica de contatos

### Status

**Concluída.**

## 7. Subetapa 05.3 — Tags/listas simples de contatos

### Objetivo

Permitir organização simples dos contatos por tags da campanha, preparando segmentação futura sem disparos em massa.

### Estrutura reutilizada

Modelos Prisma já existentes (sem migration):

- `Tag` — por `organizationId` + `campaignId`, nome único por campanha;
- `ContactTag` — associação N:N contato ↔ tag.

Não há `List`/`Segment` dinâmicos; tags simples cobrem esta subetapa.

### Entregas

- criar/listar/editar/excluir tags da campanha (`/dashboard/campaigns/[id]/tags`);
- associar/remover tags no detalhe do contato;
- exibir tags na lista de Contatos;
- filtrar contatos por tag (combinável com busca nome/telefone);
- empty state quando a tag filtrada não tiver contatos;
- feedback de sucesso/erro;
- documentação deste épico.

### Regras

- tags pertencem à campanha/tenant (não globais);
- não implementar listas dinâmicas, segmentação complexa, CSV, disparos, IA ou automações por tag;
- não alterar webhook Evolution, Atendimento ou opt-out validado;
- sem migration.

### Critério de aceite

Operador cria tag, associa a um contato, vê a tag na lista, filtra por tag e remove a tag com atualização visível.

### Status

**Concluída.**

### Implementado / reforçado

- reutilização de `TagsService` + `ContactsService.applyTag/removeTag`;
- util `contact-tag.util` (normalização, apply/remove, filtro busca+tag) + testes;
- empty state específico de filtro por tag;
- atalho **Gerenciar tags** / **Criar tags** na página de Contatos;
- filtro `tagId` + `q` na listagem.

### Fora de escopo (mantido)

- CSV;
- segmentação avançada;
- disparos;
- IA;
- automações por tag.

## 8. Próximo passo

**05.4 — Importação CSV manual**, apenas quando autorizada explicitamente.
