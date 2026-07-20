# Épico 07 — Pré-validação e Disparo Operacional

## 1. Objetivo do épico

Preparar e controlar a elegibilidade de públicos para comunicação em massa, com compliance primeiro — começando por análise sem envio.

> Nota: no Blueprint 01 o “Épico 07” original trata de Multi-canais. Neste repositório, após Segmentos (06), a sequência prática prioriza **pré-validação de público** como Épico 07 operacional.

## 2. Contexto

Já existem segmentos salvos (06.1), opt-out, DELETED, canais WhatsApp Evolution e Contatos.

## 3. Fora de escopo (nesta fase)

- disparo em massa;
- fila de envio;
- criação de campanha de envio;
- template/copy;
- IA;
- alteração de webhook/Atendimento/CSV/opt-out.

## 4. Subetapas

1. **07.1 — Pré-validação de público para disparo.**
2. **07.2+** — disparo controlado (somente quando autorizado).

## 5. Subetapa 07.1 — Pré-validação de público para disparo

### Objetivo

Analisar elegibilidade/risco de um segmento antes de qualquer disparo, sem enviar mensagens.

### Entregas

- `GET /campaigns/:campaignId/segments/:segmentId/prevalidate`
- painel **Pré-validação de disparo** no detalhe do segmento
- contagens: bruto, elegíveis, opt-out/BLOCKED, DELETED, telefone inválido, duplicados, sem canal compatível
- status de canal WhatsApp conectado da campanha
- alertas objetivos (sem canal, público vazio, bloqueados, inválidos, duplicidade, volume acima do limite provisório)
- `canDispatch: false` sempre nesta subetapa
- opt-out/BLOCKED e DELETED nunca entram em elegíveis

### Limite provisório

`SEGMENT_DISPATCH_SOFT_LIMIT` (env) ou padrão `500`.

### Status

**Concluída.**

### Implementado

- util `segment-prevalidate.util` + testes
- UI no detalhe do segmento

## 6. Próximo passo

Disparo controlado apenas quando autorizado explicitamente.
