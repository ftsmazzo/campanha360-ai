# Blueprint 01 — Roadmap por Épicos e Subetapas

## 1. Objetivo deste documento

Este blueprint define a ordem de construção do Campanha360 AI em épicos e subetapas.

Ele existe para evitar que o Cursor implemente partes grandes demais de uma vez, misture responsabilidades ou antecipe integrações sensíveis como Evolution, IA, disparos e Instagram antes da base estar pronta.

Este documento não é um prompt de execução. Ele é um mapa de navegação.

Cada subetapa futura deve virar um prompt próprio, pequeno, revisável e com commit separado.

## 2. Estado atual do produto

O produto já possui:

- autenticação JWT;
- registro e login;
- organizações;
- memberships;
- organização ativa;
- campanhas;
- candidato por campanha;
- contatos/eleitores;
- canais básicos do contato;
- consentimento;
- opt-out;
- audit log inicial;
- deploy no EasyPanel;
- API, Web, Worker, PostgreSQL e Redis provisionados.

Antes de avançar para integrações reais, a Fase 03 precisa estar validada em produção.

## 3. Regra de avanço

Nenhuma subetapa deve começar antes de três confirmações:

- commit anterior revisado;
- deploy aplicado quando necessário;
- fluxo principal validado manualmente no EasyPanel.

Toda subetapa deve terminar com:

- resumo objetivo;
- arquivos alterados;
- como testar;
- testes executados;
- pendências;
- commit e push.

## 4. Épico 01 — Fundação SaaS

### Objetivo

Criar a base mínima do SaaS: autenticação, tenancy, deploy, estrutura de apps e serviços.

### Status

Concluído.

### Subetapas

#### 01.1 — Bootstrap do monorepo

Entregas:

- estrutura `apps/web`, `apps/api`, `apps/worker`;
- `packages/shared`;
- `packages/config`;
- Dockerfiles;
- healthcheck da API;
- typecheck e build funcionando.

Status: concluído.

#### 01.2 — Auth e tenancy

Entregas:

- registro;
- login;
- JWT;
- `/auth/me`;
- organizações;
- memberships;
- papel `OWNER` na criação de organização;
- dashboard inicial.

Status: concluído.

#### 01.3 — Deploy inicial

Entregas:

- Postgres;
- Redis;
- API;
- Web;
- Worker;
- documentação do EasyPanel;
- variáveis sem segredos no repositório.

Status: concluído.

### Critério final do épico

Usuário consegue registrar conta, logar, criar organização e acessar dashboard em produção.

## 5. Épico 02 — Núcleo da Campanha

### Objetivo

Criar o núcleo operacional de uma campanha antes de qualquer canal externo.

### Status

Implementado. A validação final da Fase 03 em produção ainda deve ser confirmada.

### Subetapas

#### 02.1 — Campanhas

Entregas:

- CRUD inicial de campanhas;
- vínculo com organização;
- fase eleitoral;
- status;
- audit log;
- UI de listagem, criação e edição.

Status: concluído e validado.

#### 02.2 — Candidato

Entregas:

- candidato por campanha;
- nome, partido, cargo, bio, tom de voz, propostas e temas restritos;
- edição pela UI;
- audit log.

Status: concluído e validado.

#### 02.3 — Contatos e consentimento

Entregas:

- CRUD inicial de contatos;
- telefone;
- e-mail;
- cidade;
- bairro;
- status;
- metadata;
- canais básicos;
- consentimento por canal;
- opt-out;
- contato bloqueado após opt-out;
- audit log.

Status: implementado. Precisa validação final em produção.

#### 02.4 — Ajustes de qualidade do núcleo

Entregas futuras:

- busca e filtros simples de contatos;
- paginação;
- melhoria de mensagens de erro;
- estados vazios mais claros;
- eventual tela de audit log simples.

Status: planejado.

### Critério final do épico

Uma campanha consegue estruturar sua base inicial de eleitores com dados mínimos, consentimento e opt-out, sem integração externa.

## 6. Épico 03 — Canais e Inbox

### Objetivo

Preparar o sistema para receber, organizar e responder conversas por canais externos, começando pela Evolution API.

Este épico ainda não deve introduzir IA automática.

### Dependências

- Épico 02 validado em produção;
- contatos funcionando;
- consentimento e opt-out funcionando;
- campanha e candidato funcionando.

### Subetapas

#### 03.1 — Contas de canal

Entregas:

- CRUD de `ChannelAccount`;
- provider inicial `WHATSAPP_EVOLUTION`;
- nome da conta;
- status;
- `externalAccountId`;
- `config` JSON sem exposição indevida de segredos;
- vínculo com organização e campanha;
- audit log;
- UI dentro da campanha.

Fora de escopo:

- webhook;
- chamada real para Evolution;
- envio de mensagem;
- inbox;
- IA.

#### 03.2 — Adapter Evolution

Entregas:

- serviço interno para encapsular chamadas Evolution;
- leitura de `EVOLUTION_API_URL`;
- preparo para token/chave via env;
- métodos ainda mínimos e testáveis;
- tratamento padronizado de erro.

Fora de escopo:

- UI avançada;
- webhook;
- IA;
- envio automático.

#### 03.3 — Webhook Evolution inbound

Entregas:

- endpoint de webhook;
- persistência do payload bruto;
- normalização de mensagem recebida;
- criação ou associação de contato por telefone;
- criação de `Message`;
- criação/atualização de `ConversationThread`;
- respeito a opt-out;
- audit log ou log operacional mínimo.

Fora de escopo:

- resposta automática;
- IA;
- painel avançado.

#### 03.4 — Inbox básico

Entregas:

- lista de conversas por campanha;
- detalhe de conversa;
- mensagens inbound/outbound;
- status da conversa;
- vínculo com contato;
- tela inicial de inbox.

Fora de escopo:

- IA;
- filtros avançados;
- atribuição de atendente complexa.

#### 03.5 — Resposta manual

Entregas:

- envio manual de mensagem pela Evolution;
- gravação de mensagem outbound;
- bloqueio de envio se contato tiver opt-out;
- tratamento de erro do provider;
- audit log.

Fora de escopo:

- automação;
- IA enviando sozinha;
- campanhas em massa.

#### 03.6 — Hardening de canal

Entregas:

- validação de assinatura/token de webhook quando possível;
- logs de falha;
- idempotência básica por `externalMessageId`;
- prevenção de duplicidade;
- tela ou estado de falhas.

### Critério final do épico

O sistema consegue receber mensagens reais via Evolution, agrupá-las em conversas, exibir inbox e permitir resposta manual segura.

## 7. Épico 04 — IA Assistiva

### Objetivo

Adicionar IA como apoio operacional, não como automação irrestrita.

### Dependências

- Inbox funcionando;
- mensagens inbound/outbound persistidas;
- contato e opt-out funcionando;
- candidato e campanha configurados.

### Subetapas

#### 04.1 — Contexto de IA da campanha

Entregas:

- uso dos dados do candidato;
- tom de voz;
- propostas;
- temas restritos;
- fase eleitoral;
- regras de compliance.

#### 04.2 — Sugestão de resposta

Entregas:

- gerar sugestão para uma conversa;
- salvar sugestão;
- exibir sugestão no inbox;
- permitir copiar/usar manualmente;
- não enviar automaticamente.

#### 04.3 — Classificação de conversa

Entregas:

- classificar intenção;
- sentimento;
- prioridade;
- possível apoio/rejeição/indecisão;
- salvar classificação.

#### 04.4 — Tags automáticas

Entregas:

- sugerir tags;
- permitir aprovação manual;
- aplicar tags ao contato.

#### 04.5 — Guardrails eleitorais

Entregas:

- bloquear pedido explícito de voto fora do período permitido;
- sinalizar conteúdo sensível;
- registrar decisão da IA;
- permitir revisão humana.

### Critério final do épico

A IA ajuda a equipe a entender e responder, mas não fala sozinha em nome da campanha.

## 8. Épico 05 — Importação e Segmentação

### Objetivo

Permitir entrada e organização de bases maiores de eleitores.

### Subetapas

#### 05.1 — Importação CSV manual

Entregas:

- upload de CSV;
- mapeamento de colunas;
- validação;
- preview;
- importação assíncrona via worker.

#### 05.2 — Deduplicação

Entregas:

- identificação por telefone/e-mail;
- marcação de duplicados;
- política de merge futura.

#### 05.3 — Tags manuais

Entregas:

- CRUD de tags;
- aplicação em contato;
- remoção de tag.

#### 05.4 — Segmentos salvos

Entregas:

- filtros por cidade, bairro, status, consentimento, tags;
- salvar segmento;
- listar segmentos.

#### 05.5 — Enriquecimento assistido

Entregas:

- preenchimento de metadata;
- classificação inicial;
- sem disparo automático.

### Critério final do épico

O sistema consegue importar, organizar e segmentar bases eleitorais com segurança.

## 9. Épico 06 — Captação Pública

### Objetivo

Criar formas públicas de captar novos contatos e consentimentos.

### Subetapas

#### 06.1 — Landing pages por campanha

Entregas:

- modelo simples de página pública;
- vínculo com campanha;
- slug público;
- status publicado/rascunho.

#### 06.2 — Formulários públicos

Entregas:

- nome;
- telefone;
- e-mail;
- cidade;
- bairro;
- aceite/consentimento;
- origem registrada.

#### 06.3 — Links e QR Code

Entregas:

- link público;
- QR Code;
- origem/campanha rastreável.

#### 06.4 — Regras antiabuso

Entregas:

- rate limit;
- validação mínima;
- honeypot ou equivalente;
- logs de submissão.

### Critério final do épico

A campanha consegue captar contatos novos com consentimento e origem rastreável.

## 10. Épico 07 — Multi-canais

### Objetivo

Expandir a plataforma para canais além da Evolution.

### Subetapas

#### 07.1 — WhatsApp Cloud API

Entregas:

- novo provider;
- adapter próprio;
- configuração separada;
- compatibilidade com inbox.

#### 07.2 — E-mail

Entregas:

- provider transacional;
- mensagens outbound;
- registro no histórico.

#### 07.3 — SMS

Entregas:

- provider SMS;
- opt-out por SMS;
- logs de envio.

#### 07.4 — Telegram

Entregas:

- adapter;
- webhook;
- mensagens inbound/outbound.

#### 07.5 — Instagram

Entregas:

- análise do projeto legado apenas como referência;
- adapter Instagram;
- inbox compatível;
- postagem só se fizer sentido em épico separado.

### Critério final do épico

O sistema consegue operar múltiplos canais com uma experiência unificada de contato e conversa.

## 11. Épico 08 — Compliance, Auditoria e Operação

### Objetivo

Aumentar governança, rastreabilidade e segurança operacional.

### Subetapas

#### 08.1 — Tela de audit log

Entregas:

- lista de eventos;
- filtro por campanha;
- filtro por usuário;
- filtro por entidade.

#### 08.2 — Permissões avançadas

Entregas:

- papéis refinados;
- limites por módulo;
- usuários convidados.

#### 08.3 — Relatórios operacionais

Entregas:

- contatos por status;
- consentimentos;
- opt-outs;
- conversas;
- atividade por campanha.

#### 08.4 — Regras eleitorais configuráveis

Entregas:

- fase eleitoral;
- bloqueios;
- alertas;
- texto de orientação para operadores.

#### 08.5 — Segurança e privacidade

Entregas:

- revisão de exposição de dados;
- política de retenção;
- exportação;
- exclusão lógica;
- logs sensíveis.

### Critério final do épico

A operação consegue auditar, controlar e justificar o uso do sistema com segurança.

## 12. Ordem recomendada a partir de agora

A sequência recomendada é:

1. Validar Épico 02 em produção, especialmente contatos e opt-out.
2. Criar documentação do Épico 03.
3. Implementar 03.1 — Contas de canal.
4. Revisar e implantar.
5. Implementar 03.2 — Adapter Evolution.
6. Revisar e implantar.
7. Implementar 03.3 — Webhook inbound.
8. Revisar e implantar.
9. Implementar 03.4 — Inbox básico.
10. Implementar 03.5 — Resposta manual.
11. Só então iniciar IA assistiva.

## 13. Regra para prompts futuros

Cada prompt ao Cursor deve seguir este padrão:

```text
Leia os documentos X, Y e Z.

Execute apenas a subetapa N.

Implemente:
- item 1;
- item 2;
- item 3.

Regras:
- não implemente A;
- não implemente B;
- não rediscuta arquitetura;
- preserve os fluxos já existentes.

Rode:
- npm run typecheck;
- npm run build.

Faça commit e push.

Ao final, responda com:
## Resultado
## Arquivos alterados
## Como testar
## Testes executados
## Pendencias
## Commit

## 14. Regra de revisão

Toda entrega do Cursor deve ser revisada antes de deploy quando envolver:

banco;
autenticação;
tenancy;
dados de eleitor;
consentimento;
opt-out;
canais;
webhook;
IA;
envio de mensagem;
secrets;
EasyPanel.