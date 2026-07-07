# Blueprint 13 — Estratégia de Execução dos Próximos Épicos

## 1. Objetivo deste documento

Este blueprint transforma os blueprints anteriores em uma sequência prática de execução a partir do estado atual do Campanha360 AI.

Ele define o que fazer imediatamente, o que esperar, quais épicos vêm primeiro e quais prompts só devem ser usados depois de validação.

Este documento também corrige uma decisão importante: antes de avançar para canais externos, Evolution, Inbox ou IA, o produto precisa consolidar o CRM operacional da campanha.

## 2. Estado atual do projeto

O projeto já possui:

- monorepo estruturado;
- API NestJS;
- Web Next.js;
- Worker;
- PostgreSQL;
- Redis;
- Prisma;
- deploy no EasyPanel;
- autenticação JWT;
- organizações;
- memberships;
- campanhas;
- candidato por campanha;
- contatos/eleitores;
- canais básicos de contato;
- consentimento por canal;
- opt-out;
- audit log inicial.

O produto já tem uma base de dados operacional.

Mas ainda não tem um CRM completo.

## 3. Problema de execução identificado

A sequência anterior colocava Canais e Inbox como próximo bloco natural.

Isso é tecnicamente possível, mas estrategicamente incompleto.

Antes de receber e responder mensagens por canais externos, a campanha precisa conseguir trabalhar a base internamente como CRM:

- organizar contatos;
- classificar contatos;
- registrar notas;
- criar tarefas;
- marcar responsáveis;
- acompanhar follow-ups;
- visualizar histórico;
- segmentar;
- priorizar atendimento;
- entender o estado de cada eleitor dentro da campanha.

Sem isso, Inbox e IA viram apenas mensagens soltas, não operação de relacionamento.

## 4. Decisão de execução

A próxima grande frente deve ser:

Épico 03 — CRM Operacional

Depois dele, entram:

Épico 04 — Canais e Inbox

Depois:

Épico 05 — IA Assistiva

Depois:

Épico 06 — Importação e Segmentação Avançada

Depois:

Épico 07 — Landing Pages e Captação Pública

Depois:

Épico 08 — Multi-canais e Instagram

Depois:

Épico 09 — Compliance Avançado e Operação

## 5. Nova ordem dos épicos

### Épico 01 — Fundação SaaS

Status: concluído.

Inclui:

- bootstrap;
- auth;
- organizações;
- tenancy;
- deploy inicial.

### Épico 02 — Núcleo da Campanha

Status: implementado.

Inclui:

- campanhas;
- candidato;
- contatos;
- consentimento;
- opt-out;
- audit log inicial.

### Épico 03 — CRM Operacional

Status: próximo.

Inclui:

- visão 360 do contato;
- tags manuais;
- notas internas;
- tarefas e follow-ups;
- responsável pelo contato;
- status operacional;
- filtros;
- busca;
- timeline do contato;
- preparação para inbox.

### Épico 04 — Canais e Inbox

Status: depois do CRM.

Inclui:

- contas de canal;
- adapter Evolution;
- webhook;
- mensagens;
- conversas;
- inbox;
- resposta manual.

### Épico 05 — IA Assistiva

Status: depois de Inbox.

Inclui:

- sugestão de resposta;
- classificação;
- resumo;
- tags sugeridas;
- guardrails.

### Épico 06 — Importação e Segmentação Avançada

Status: depois do CRM básico.

Inclui:

- importação CSV;
- deduplicação;
- segmentos salvos;
- relatórios de importação.

### Épico 07 — Landing Pages e Captação Pública

Status: depois de contatos e CRM básicos.

Inclui:

- páginas públicas;
- formulários;
- QR Code;
- origem;
- consentimento.

### Épico 08 — Multi-canais e Instagram

Status: futuro.

Inclui:

- WhatsApp oficial;
- Instagram;
- e-mail;
- SMS;
- Telegram.

### Épico 09 — Compliance Avançado e Operação

Status: contínuo e futuro.

Inclui:

- audit log consultável;
- permissões avançadas;
- relatórios;
- regras eleitorais configuráveis.

## 6. Por que CRM vem antes de Evolution

CRM vem antes porque:

- contatos já existem;
- consentimento já existe;
- opt-out já existe;
- mas ainda falta operação diária sobre a base;
- canais vão gerar mais interações;
- sem CRM, essas interações não terão estrutura;
- IA precisa de contexto operacional;
- inbox precisa de visão do contato;
- importação precisa de tags e filtros;
- landing pages precisam alimentar um CRM, não só uma tabela de contatos.

O CRM é a camada que transforma cadastro em operação.

## 7. Definição de CRM no Campanha360 AI

CRM, neste projeto, não significa um CRM comercial genérico.

CRM significa uma central operacional de relacionamento da campanha com cada contato.

O CRM deve responder:

- quem é este contato;
- de onde veio;
- em qual campanha está;
- quais canais possui;
- qual consentimento existe;
- se há opt-out;
- qual seu status operacional;
- quais tags possui;
- quais notas existem;
- quais tarefas estão pendentes;
- quem é responsável;
- qual histórico existe;
- qual deve ser a próxima ação.

## 8. Subetapas do Épico 03 — CRM Operacional

### 03.1 — Visão 360 do contato

Criar uma tela mais completa do contato, consolidando:

- dados básicos;
- canais;
- consentimentos;
- opt-out;
- campanha;
- tags futuras;
- notas futuras;
- tarefas futuras;
- histórico futuro.

Na primeira subetapa, pode reorganizar a tela atual do contato para virar base da visão 360.

### 03.2 — Tags manuais

Implementar:

- CRUD de tags por campanha;
- aplicação de tags em contatos;
- remoção de tags;
- visualização na lista e detalhe.

Fora de escopo:

- IA sugerindo tags;
- segmentos automáticos;
- importação por tags.

### 03.3 — Notas internas

Implementar:

- notas por contato;
- autor da nota;
- data;
- edição ou histórico simples;
- exibição na visão 360.

Fora de escopo:

- comentários em thread;
- menções;
- anexos.

### 03.4 — Tarefas e follow-ups

Implementar:

- tarefa vinculada ao contato;
- título;
- descrição;
- responsável;
- data prevista;
- status;
- conclusão;
- listagem de tarefas pendentes.

Fora de escopo:

- calendário avançado;
- notificações;
- recorrência.

### 03.5 — Responsável e status operacional

Implementar:

- responsável pelo contato;
- status operacional de relacionamento;
- campos simples para priorização.

Exemplos de status operacional:

- NOVO;
- EM_ATENDIMENTO;
- ACOMPANHAR;
- CONVERTIDO;
- SEM_INTERESSE;
- BLOQUEADO.

### 03.6 — Busca e filtros básicos

Implementar filtros por:

- nome;
- telefone;
- e-mail;
- cidade;
- bairro;
- status;
- opt-out;
- tag;
- responsável.

### 03.7 — Timeline do contato

Unificar eventos relevantes:

- criação;
- edição;
- consentimento;
- opt-out;
- notas;
- tarefas;
- mensagens futuras;
- tags aplicadas.

No início, pode usar audit log e entidades do CRM como base.

## 9. Critério de conclusão do Épico 03

O CRM Operacional estará concluído quando:

- a tela do contato funcionar como visão 360;
- tags manuais existirem;
- notas internas existirem;
- tarefas/follow-ups existirem;
- responsável ou status operacional existir;
- busca e filtros básicos existirem;
- usuário conseguir operar uma base sem depender de canal externo.

## 10. O que não entra no CRM agora

Não implementar agora:

- Evolution;
- webhook;
- inbox;
- IA;
- importação CSV;
- landing pages;
- Instagram;
- automações;
- disparos;
- relatórios avançados;
- permissões complexas.

## 11. Próximo documento prático

O próximo documento deve ser:

docs/epicos/03-CRM-OPERACIONAL.md

Ele deve detalhar o Épico 03 e suas subetapas, ainda sem implementar código.

## 12. Primeiro prompt futuro ao Cursor

O primeiro prompt futuro deve executar apenas:

03.1 — Visão 360 do contato

Mas esse prompt só deve ser criado depois que o documento docs/epicos/03-CRM-OPERACIONAL.md estiver escrito.

## 13. Regra de parada

Se o Cursor tentar implementar canais, Evolution, inbox ou IA durante o Épico 03, a entrega deve ser recusada por quebra de escopo.

## 14. Conclusão

A execução correta agora é fortalecer o CRM.

O Campanha360 AI precisa primeiro virar uma ferramenta operacional sólida de relacionamento com contatos.

Depois disso, canais, inbox e IA terão uma base muito mais consistente para funcionar.