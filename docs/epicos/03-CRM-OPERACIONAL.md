# Épico 03 — CRM Operacional

## 1. Objetivo do épico

O objetivo deste épico é transformar a base de contatos do Campanha360 AI em um CRM operacional de campanha.

O sistema já permite cadastrar contatos, consentimentos e opt-outs. Agora precisa permitir que a equipe trabalhe esses contatos de forma organizada antes de conectar canais externos, inbox, IA ou importações maiores.

Ao final deste épico, a campanha deve conseguir:

- visualizar cada contato em uma tela 360;
- classificar contatos com tags;
- registrar notas internas;
- criar tarefas e follow-ups;
- definir responsável pelo contato;
- acompanhar status operacional;
- buscar e filtrar a base;
- ver uma timeline básica de eventos do contato.

Este épico prepara a base para Evolution, Inbox e IA.

## 2. Contexto atual

O produto já possui:

- autenticação;
- organizações;
- memberships;
- campanhas;
- candidato por campanha;
- contatos por campanha;
- canais básicos do contato;
- consentimento por canal;
- opt-out;
- audit log inicial;
- deploy no EasyPanel.

Ainda falta uma camada de operação diária sobre a base.

Hoje o contato existe como cadastro. Depois deste épico, o contato passa a ser uma entidade trabalhável pela equipe da campanha.

## 3. Princípio central

CRM, no Campanha360 AI, não significa um CRM comercial genérico.

CRM significa uma central operacional de relacionamento político-eleitoral com cada contato.

A tela e as APIs devem responder:

- quem é este contato;
- de onde veio;
- em qual campanha está;
- quais canais possui;
- qual consentimento existe;
- se há opt-out;
- quais tags possui;
- quais notas internas existem;
- quais tarefas estão pendentes;
- quem é o responsável;
- qual é a próxima ação recomendada pela equipe;
- qual histórico relevante já existe.

## 4. Fora de escopo deste épico

Não implementar neste épico:

- Evolution;
- webhook;
- inbox;
- envio de mensagem;
- IA;
- importação CSV;
- landing pages;
- Instagram;
- WhatsApp Cloud API;
- disparos;
- automações;
- relatórios avançados;
- permissões complexas.

Esses itens pertencem a épicos futuros.

## 5. Subetapas do épico

O épico deve ser executado em subetapas pequenas:

1. 03.1 — Visão 360 do contato.
2. 03.2 — Tags manuais.
3. 03.3 — Notas internas.
4. 03.4 — Tarefas e follow-ups.
5. 03.5 — Responsável e status operacional.
6. 03.6 — Busca e filtros básicos.
7. 03.7 — Timeline do contato.

Nenhuma subetapa deve implementar itens futuros sem autorização explícita.

## 6. Subetapa 03.1 — Visão 360 do contato

### Objetivo

Reorganizar a tela de detalhe do contato para virar a base da visão 360.

### Entregas

- melhorar a página atual do contato;
- organizar seções claras;
- exibir dados básicos;
- exibir canais;
- exibir consentimentos;
- exibir opt-out;
- exibir campanha relacionada;
- exibir espaço reservado para tags, notas, tarefas e timeline;
- melhorar navegação de volta para campanha e lista de contatos;
- preservar criação, edição, consentimento e opt-out funcionando.

### Seções recomendadas da tela

- Cabeçalho do contato;
- Dados principais;
- Canais;
- Consentimento;
- Opt-out;
- CRM operacional;
- Histórico e atividade futura.

### Fora de escopo

- criar tags;
- criar notas;
- criar tarefas;
- criar timeline real;
- alterar schema;
- implementar IA;
- implementar inbox.

### Critério de aceite

A subetapa estará aceita quando:

- a tela do contato estiver mais clara e organizada;
- opt-out estiver visível;
- consentimentos estiverem visíveis;
- canais estiverem visíveis;
- ações existentes continuarem funcionando;
- não houver mudança estrutural desnecessária;
- typecheck e build passarem.

### Status

**Concluída.**

### Implementado

- `apps/web/app/dashboard/campaigns/[id]/contacts/[contactId]/page.tsx` — visão 360 com seções de leitura e painel de ações;
- `apps/web/components/contact-section.tsx` — componentes de seção e placeholders CRM;
- breadcrumb e navegação para campanha e lista de contatos;
- alerta e destaque visual para opt-out ativo;
- placeholders para tags, notas, tarefas e timeline (sem funcionalidade);
- edição, consentimento e opt-out preservados.

### Commit

`0f9b7f3` — Implementa visão 360 do contato (subetapa 03.1).

## 7. Subetapa 03.2 — Tags manuais

### Objetivo

Permitir classificar contatos com tags por campanha.

### Entregas

- CRUD básico de tags por campanha;
- aplicar tag a contato;
- remover tag de contato;
- listar tags no detalhe do contato;
- mostrar tags na lista de contatos;
- audit log para criação de tag e aplicação/remoção quando fizer sentido.

### Regras

- tag pertence a organizationId e campaignId;
- nome da tag deve ser único por campanha;
- escrita exige OWNER, ADMIN ou MANAGER;
- VIEWER não cria nem aplica tag.

### Fora de escopo

- IA sugerindo tags;
- segmentos salvos;
- importação por tags;
- automação.

### Critério de aceite

Usuário consegue criar uma tag e aplicá-la/removê-la de um contato da campanha.

## 8. Subetapa 03.3 — Notas internas

### Objetivo

Permitir que a equipe registre observações internas sobre um contato.

### Entregas

- criar nota interna vinculada ao contato;
- listar notas no detalhe do contato;
- registrar autor;
- registrar data;
- permitir edição simples ou criar nova nota de correção;
- audit log para criação/edição.

### Regras

- nota pertence a organizationId, campaignId e contactId;
- nota não deve ser enviada ao contato;
- nota é informação interna da campanha;
- escrita exige OWNER, ADMIN ou MANAGER.

### Fora de escopo

- anexos;
- menções;
- comentários em thread;
- editor rico.

### Critério de aceite

Usuário autorizado consegue registrar e visualizar notas internas no contato.

## 9. Subetapa 03.4 — Tarefas e follow-ups

### Objetivo

Permitir criar tarefas operacionais vinculadas a contatos.

### Entregas

- criar tarefa para contato;
- título;
- descrição opcional;
- responsável opcional;
- data prevista opcional;
- status;
- marcar como concluída;
- listar tarefas no detalhe do contato;
- listar tarefas pendentes da campanha, se simples.

### Status sugeridos

- OPEN;
- IN_PROGRESS;
- DONE;
- CANCELED.

### Regras

- tarefa pertence a organizationId, campaignId e contactId;
- tarefa pode ter assignedToUserId;
- conclusão deve registrar completedAt;
- escrita exige OWNER, ADMIN ou MANAGER.

### Fora de escopo

- recorrência;
- calendário avançado;
- notificações;
- integração com agenda externa.

### Critério de aceite

Usuário consegue criar uma tarefa, vê-la no contato e marcá-la como concluída.

## 10. Subetapa 03.5 — Responsável e status operacional

### Objetivo

Permitir acompanhar quem está cuidando do contato e qual o estado operacional dele.

### Entregas

- campo de responsável pelo contato;
- status operacional do relacionamento;
- exibição na lista e detalhe;
- edição na tela do contato;
- audit log para alteração.

### Status operacionais sugeridos

- NEW;
- IN_PROGRESS;
- FOLLOW_UP;
- SUPPORTER;
- UNDECIDED;
- NOT_INTERESTED;
- BLOCKED.

### Regras

- status operacional não substitui ContactStatus técnico;
- ContactStatus continua tratando ACTIVE, INVALID, DUPLICATE, BLOCKED e DELETED;
- se contato tiver opt-out, isso deve continuar visível e prevalecer para comunicação.

### Fora de escopo

- automação de mudança de status;
- scoring por IA;
- relatórios.

### Critério de aceite

Usuário consegue atribuir responsável e definir status operacional sem quebrar o status técnico do contato.

## 11. Subetapa 03.6 — Busca e filtros básicos

### Objetivo

Melhorar a operação da lista de contatos.

### Entregas

- busca por nome, telefone ou e-mail;
- filtro por status técnico;
- filtro por opt-out;
- filtro por cidade;
- filtro por bairro;
- filtro por tag, se tags já existirem;
- filtro por responsável, se responsável já existir;
- filtro por status operacional, se já existir.

### Regras

- filtros devem respeitar organizationId e campaignId;
- não retornar contato de outra campanha;
- lista deve continuar simples e rápida.

### Fora de escopo

- segmentos salvos;
- busca full-text avançada;
- analytics.

### Critério de aceite

Usuário consegue encontrar contatos sem percorrer a lista inteira manualmente.

## 12. Subetapa 03.7 — Timeline do contato

### Objetivo

Criar uma visão cronológica básica das atividades relevantes do contato.

### Eventos possíveis

- criação do contato;
- edição do contato;
- consentimento criado/alterado;
- opt-out registrado;
- tag aplicada/removida;
- nota criada;
- tarefa criada/concluída;
- mensagem recebida futura;
- mensagem enviada futura;
- sugestão de IA futura.

### Entregas

- seção de timeline na visão 360;
- eventos ordenados por data;
- tipo do evento;
- descrição curta;
- ator quando houver.

### Regras

- usar audit log e entidades existentes quando possível;
- não duplicar dado desnecessariamente;
- respeitar tenancy;
- não expor segredo ou payload sensível.

### Fora de escopo

- timeline em tempo real;
- filtros avançados;
- eventos de canais ainda não implementados.

### Critério de aceite

Usuário consegue ver uma linha do tempo básica do contato com os principais eventos já registrados.

## 13. Regras de tenancy

Toda entidade nova do CRM deve carregar:

- organizationId;
- campaignId;
- contactId quando ligada ao contato.

Toda consulta deve validar:

- usuário pertence à organização;
- contato pertence à campanha;
- escrita exige papel adequado.

## 14. Regras de audit log

Registrar audit log para:

- criação de tag;
- edição de tag;
- aplicação de tag;
- remoção de tag;
- criação de nota;
- edição de nota;
- criação de tarefa;
- conclusão de tarefa;
- alteração de responsável;
- alteração de status operacional.

Audit log não deve conter segredo nem dado sensível desnecessário.

## 15. Regras de UI

A UI deve ser operacional e simples.

Prioridades:

- clareza;
- opt-out visível;
- consentimento visível;
- navegação consistente;
- mensagens de erro claras;
- estados vazios;
- ações fáceis de encontrar.

Não transformar o CRM em dashboard visual complexo antes dos fluxos básicos funcionarem.

## 16. Regras de teste

Toda subetapa deve rodar:

- npm run typecheck;
- npm run build.

Quando houver alteração no Prisma:

- npm run prisma:generate;
- migration versionada;
- explicar impacto no deploy.

Quando não houver migration, dizer explicitamente.

## 17. Ordem de execução

Executar na ordem:

1. 03.1 — Visão 360 do contato.
2. 03.2 — Tags manuais.
3. 03.3 — Notas internas.
4. 03.4 — Tarefas e follow-ups.
5. 03.5 — Responsável e status operacional.
6. 03.6 — Busca e filtros básicos.
7. 03.7 — Timeline do contato.

## 18. Critério final do épico

O Épico 03 estará concluído quando a equipe conseguir operar a base de contatos como CRM básico, sem depender ainda de canais externos.

A campanha deve conseguir:

- abrir um contato;
- entender sua situação;
- ver consentimento e opt-out;
- aplicar tags;
- registrar notas;
- criar follow-ups;
- atribuir responsável;
- filtrar a base;
- acompanhar histórico básico.

## 19. Próximo passo após este documento

A subetapa **03.1 — Visão 360 do contato** está concluída.

O próximo prompt ao Cursor deve executar apenas:

**03.2 — Tags manuais.**

O Cursor não deve criar notas, tarefas, Evolution, Inbox ou IA nesse passo.
