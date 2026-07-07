# Blueprint 00 — Visão Arquitetural do Campanha360 AI

## 1. Objetivo do produto

O Campanha360 AI é um SaaS para gestão, enriquecimento, captação, classificação e relacionamento com bases de eleitores, com foco inicial em campanhas eleitorais.

O sistema deve permitir que uma campanha organize seus eleitores, registre consentimentos, acompanhe interações por canais digitais e use IA de forma assistiva, sem permitir automações perigosas ou juridicamente frágeis no início.

O produto nasce como plataforma multi-organização e multi-campanha, preparada para evoluir para múltiplos canais: WhatsApp, WhatsApp Cloud API, e-mail, SMS, Telegram, Instagram e landing pages.

## 2. Princípio central

O projeto não deve ser tratado como remendo de sistemas anteriores.

O Campanha360 AI é um produto novo, com arquitetura própria, stack própria e documentos próprios. Repositórios legados podem servir como inspiração conceitual, mas não devem orientar diretamente o Cursor nem enviesar a implementação.

A execução deve ser progressiva, por épicos e subetapas pequenas, sempre com revisão antes de avançar.

## 3. Estado atual confirmado

Já foram implementados e validados:

- autenticação com JWT;
- registro, login e `/auth/me`;
- organizações e memberships;
- criação e seleção de organização ativa;
- campanhas por organização;
- candidato por campanha;
- contatos/eleitores por campanha;
- canais básicos de contato;
- consentimento por canal;
- opt-out básico;
- audit log inicial;
- deploy inicial no EasyPanel;
- API, Web, Worker, PostgreSQL e Redis provisionados.

A Fase 03 deve ser validada em produção antes de qualquer integração com canal real.

## 4. Stack oficial

A stack fechada do projeto é:

- Monorepo TypeScript;
- Frontend: Next.js;
- Backend: NestJS;
- Worker: Node/TypeScript;
- Banco: PostgreSQL;
- ORM: Prisma;
- Filas/cache: Redis + BullMQ;
- Deploy: Docker + EasyPanel;
- WhatsApp MVP: Evolution API;
- IA inicial: modo sugestão;
- GitHub como repositório principal.

A stack não deve ser rediscutida pelo Cursor salvo bloqueio técnico real.

## 5. Arquitetura lógica

O sistema é dividido em três aplicações principais:

- `apps/web`: painel administrativo, telas operacionais e futuras páginas públicas;
- `apps/api`: API principal, autenticação, regras de negócio e persistência;
- `apps/worker`: jobs assíncronos, processamento de filas, importações, webhooks pesados e tarefas de IA.

Pacotes compartilhados:

- `packages/shared`: tipos, contratos e utilitários comuns;
- `packages/config`: configuração compartilhada quando necessário.

Banco e infraestrutura:

- `prisma`: schema e migrations;
- `infra`: referências de deploy, Docker e EasyPanel;
- `docs`: blueprints, fases, épicos e contexto operacional para Cursor.

## 6. Regra de tenancy

Toda entidade de domínio deve carregar `organizationId`.

Toda entidade ligada a uma campanha deve carregar também `campaignId`.

Nenhuma consulta deve depender apenas de `id` global quando envolver dados de campanha, eleitor, mensagem, consentimento, canal ou IA.

A regra padrão é:

- leitura: usuário precisa ser membro da organização;
- escrita: usuário precisa ter papel `OWNER`, `ADMIN` ou `MANAGER`;
- `VIEWER` não escreve;
- permissões mais refinadas podem ser criadas em épico posterior.

## 7. Domínios principais

Os domínios do produto são:

- Auth;
- Organizations;
- Memberships;
- Campaigns;
- Candidates;
- Contacts;
- Contact Channels;
- Consents;
- Opt-outs;
- Channel Accounts;
- Conversations;
- Messages;
- AI Suggestions;
- Tags;
- Segments;
- Imports;
- Landing Pages;
- Audit;
- Compliance.

Cada domínio deve ser implementado com fronteira clara, sem misturar integração externa, UI, regra de negócio e processamento assíncrono no mesmo lugar.

## 8. Canais

O primeiro canal real será WhatsApp via Evolution API.

A Evolution deve ser tratada como adapter, não como dependência espalhada pelo sistema.

A arquitetura deve permitir trocar ou adicionar provedores depois, incluindo:

- WhatsApp Cloud API;
- Instagram;
- e-mail;
- SMS;
- Telegram.

Nenhuma regra de negócio deve depender diretamente de detalhes internos da Evolution.

## 9. IA

A IA começa em modo sugestão.

Isso significa:

- a IA pode classificar;
- a IA pode sugerir resposta;
- a IA pode propor tags;
- a IA pode resumir conversas;
- a IA não deve enviar mensagens automaticamente no início;
- qualquer automação futura exige regras explícitas, consentimento, opt-out e limites de segurança.

Antes da campanha oficial, o sistema deve bloquear ou sinalizar conteúdos que caracterizem pedido explícito de voto quando isso for juridicamente sensível.

## 10. Compliance e segurança

O sistema deve registrar:

- origem do contato;
- consentimento por canal;
- opt-out;
- eventos relevantes em audit log;
- payload bruto de webhooks;
- mensagens recebidas e enviadas;
- ações manuais feitas por usuários;
- sugestões geradas por IA, quando forem usadas.

Segredos não devem entrar no repositório.

Configurações sensíveis devem ficar no EasyPanel ou em variáveis de ambiente.

Dados de eleitores devem ser tratados como dados sensíveis operacionais.

## 11. Estratégia de execução

A execução passa a ser organizada por épicos.

Cada épico deve ser dividido em subetapas pequenas.

O Cursor nunca deve receber um pedido amplo como “implemente Evolution, Inbox e IA”.

O fluxo correto é:

1. Blueprint define visão e ordem.
2. Subetapa define escopo pequeno.
3. Cursor implementa só a subetapa.
4. Cursor faz commit e push.
5. A implementação é revisada.
6. Só então acontece deploy.
7. Só depois se libera a próxima subetapa.

## 12. Épicos do produto

### Épico 01 — Fundação SaaS

Base de autenticação, organizações, tenancy, deploy, healthcheck e estrutura inicial.

Status: praticamente concluído.

### Épico 02 — Núcleo da campanha

Campanhas, candidato, contatos, consentimento, opt-out e audit log inicial.

Status: implementado; Fase 03 deve ser validada em produção.

### Épico 03 — Canais e Inbox

Contas de canal, adapter Evolution, webhook, mensagens, conversas, inbox e resposta manual.

Não inclui IA automática.

### Épico 04 — IA assistiva

Classificação, sugestão de resposta, resumo, tags automáticas e limites de segurança.

Começa sem envio automático.

### Épico 05 — Importação e segmentação

Importação CSV, deduplicação, tags, filtros, segmentos e enriquecimento de base.

### Épico 06 — Captação pública

Landing pages, formulários, links públicos, QR Code e origem rastreável de contatos.

### Épico 07 — Multi-canais

WhatsApp oficial, Instagram, e-mail, SMS, Telegram e gestão unificada de canais.

### Épico 08 — Compliance e operação

Auditoria consultável, relatórios, permissões maduras, bloqueios legais e governança operacional.

## 13. Regra para Cursor

O Cursor deve obedecer aos documentos do projeto e não rediscutir arquitetura.

Toda instrução enviada ao Cursor deve conter:

- documentos que ele deve ler;
- subetapa exata;
- escopo permitido;
- fora de escopo explícito;
- testes esperados;
- obrigação de commit e push;
- formato de resposta final.

O Cursor não deve decidir sozinho a próxima etapa.

## 14. Próxima decisão operacional

Antes de iniciar o Épico 03, validar em produção:

- criação de contato só com telefone;
- criação de contato só com e-mail;
- criação de contato com telefone e e-mail;
- bloqueio de telefone inválido mesmo com e-mail válido;
- edição de contato;
- consentimento;
- opt-out;
- contato ficando bloqueado.

Somente depois disso o projeto deve avançar para o Épico 03.

## 15. Próximo blueprint

O próximo documento deve ser:

`Blueprint 01 — Roadmap por Épicos e Subetapas`

Ele deve detalhar a ordem de execução, checkpoints e critérios de aceite de cada épico.