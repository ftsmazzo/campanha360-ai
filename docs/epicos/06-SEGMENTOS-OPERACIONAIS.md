# Épico 06 — Segmentos Operacionais

## 1. Objetivo do épico

Criar a base de segmentos/listas operacionais por campanha, permitindo salvar públicos a partir de critérios simples — sem disparos em massa.

> Nota: no Blueprint 01 o “Épico 06” original trata de Captação Pública. Neste repositório, a sequência prática após a base de Contatos (05) prioriza **segmentos salvos** como Épico 06 operacional.

## 2. Contexto

Já existem Contatos, Tags, opt-out, importação CSV e remoção segura (épico 05). Faltava um filtro salvo reutilizável.

## 3. Fora de escopo (nesta fase)

- disparos em massa;
- fila de envio;
- copy/mensagem de campanha;
- IA;
- automações;
- segmentação complexa / listas dinâmicas avançadas.

## 4. Subetapas

1. **06.1 — Segmentos/listas operacionais simples.**
2. **06.2+** — refinamentos futuros (quando autorizados).

## 5. Subetapa 06.1 — Segmentos/listas operacionais simples

### Objetivo

Salvar um público da campanha com critérios simples, prévia e contagem.

### Modelo

Migration mínima `Segment`:

- `organizationId`, `campaignId`
- `name`, `description?`
- `filters` (JSON)
- `createdByUserId?`
- timestamps
- unique `(campaignId, name)`

`filters` suportados:

- `tagIds[]`
- `status` (exceto DELETED)
- `includeOptOut` (padrão `false`)
- `channel` (WHATSAPP/EMAIL via ContactChannel)

### Entregas

- página `/dashboard/campaigns/[id]/segments`
- detalhe `/dashboard/campaigns/[id]/segments/[segmentId]`
- navegação a partir da campanha e Contatos
- criar / prévia / listar / detalhe / editar / remover
- DELETED sempre excluído
- opt-out/BLOCKED excluídos por padrão; inclusão exige flag + confirmação

### Status

**Concluída.**

### Implementado

- `POST/GET/PUT/DELETE /campaigns/:campaignId/segments`
- `POST .../segments/preview`
- util `segment-filters.util` + testes

## 6. Próximo passo

**Épico 07 — Pré-validação e Disparo Operacional** (`docs/epicos/07-PREVALIDACAO-DISPARO.md`), começando por **07.1**.
