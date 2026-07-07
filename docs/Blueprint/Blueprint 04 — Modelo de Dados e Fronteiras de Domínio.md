# Blueprint 04 — Modelo de Dados e Fronteiras de Domínio

## 1. Objetivo deste documento

Este blueprint define os principais domínios do Campanha360 AI, suas responsabilidades e suas fronteiras.

Ele existe para evitar que o projeto cresça com módulos misturados, entidades sem dono claro ou regras espalhadas entre API, Web, Worker e integrações externas.

Este documento não substitui o schema Prisma. Ele orienta a evolução do schema e da arquitetura de domínio.

## 2. Princípio central

Cada domínio deve ter uma responsabilidade clara.

A regra geral é:

- Auth cuida de identidade.
- Organizations cuida de tenancy.
- Campaigns cuida da operação eleitoral.
- Contacts cuida da base de eleitores.
- Channels cuida das contas conectadas.
- Conversations cuida do histórico de conversa.
- AI cuida de sugestões e classificações.
- Compliance cuida de bloqueios, consentimento, opt-out e auditoria.
- Imports cuida de entrada em massa de dados.
- Landing Pages cuida de captação pública.

Nenhum domínio deve assumir responsabilidade de outro sem decisão explícita.

## 3. Regra de tenancy

Toda entidade operacional deve carregar organizationId.

Toda entidade ligada a uma campanha deve carregar campaignId.

Exemplos:

- Campaign: organizationId.
- Candidate: organizationId e campaignId.
- Contact: organizationId e campaignId.
- Consent: organizationId e campaignId.
- Message: organizationId e campaignId.
- ConversationThread: organizationId e campaignId.
- ChannelAccount: organizationId e campaignId.
- AuditLog: organizationId e campaignId quando aplicável.

A ausência desses campos deve ser exceção justificada.

## 4. Auth

### Responsabilidade

Gerenciar identidade de usuário e autenticação.

### Entidades principais

- User.

### Deve conter

- nome;
- e-mail;
- senha com hash;
- status;
- data de criação;
- data de atualização.

### Não deve conter

- organização ativa;
- dados de campanha;
- permissões específicas fora de memberships;
- preferências complexas de UI nesta etapa.

### Regras

- login retorna JWT;
- senha nunca é salva em texto puro;
- e-mail deve ser único;
- usuário pode pertencer a múltiplas organizações.

## 5. Organizations

### Responsabilidade

Representar tenants do SaaS.

Uma organização pode ser uma campanha, agência, gabinete, consultoria ou operação política que gerencia uma ou mais campanhas.

### Entidades principais

- Organization.
- Membership.

### Deve conter

Organization:

- id;
- name;
- slug;
- status.

Membership:

- userId;
- organizationId;
- role.

### Papéis iniciais

- OWNER;
- ADMIN;
- MANAGER;
- OPERATOR;
- COMPLIANCE;
- VIEWER.

### Regras

- criação de organização gera membership OWNER para o criador;
- leitura exige membership;
- escrita operacional exige OWNER, ADMIN ou MANAGER;
- VIEWER não escreve;
- permissões refinadas ficam para épico futuro.

## 6. Campaigns

### Responsabilidade

Representar uma campanha operacional dentro de uma organização.

### Entidades principais

- Campaign.

### Deve conter

- organizationId;
- name;
- electionYear;
- office;
- territory;
- phase;
- status.

### Fases eleitorais

- PRE_CAMPAIGN;
- INTRA_PARTY;
- OFFICIAL_CAMPAIGN;
- RUNOFF;
- CLOSED.

### Status

- DRAFT;
- ACTIVE;
- ARCHIVED.

### Regras

- campanha pertence a uma organização;
- campanha agrupa candidato, contatos, mensagens, canais e configurações;
- fase eleitoral deve ser usada futuramente por regras de compliance e IA;
- campanhas arquivadas não devem receber novas ações operacionais sensíveis sem regra explícita.

## 7. Candidates

### Responsabilidade

Guardar a configuração política e comunicacional da campanha.

### Entidades principais

- Candidate.

### Deve conter

- organizationId;
- campaignId;
- name;
- party;
- office;
- bio;
- toneOfVoice;
- mainProposals;
- restrictedTopics.

### Regras

- cada campanha tem no máximo um candidato principal nesta etapa;
- propostas e temas restritos alimentam a IA futuramente;
- candidato não deve ser usado para envio automático sem validação humana;
- mudanças devem gerar audit log.

## 8. Contacts

### Responsabilidade

Representar os eleitores, apoiadores, leads ou contatos da campanha.

### Entidades principais

- Contact.
- ContactChannel.

### Contact deve conter

- organizationId;
- campaignId;
- name;
- phoneNumber;
- email;
- city;
- neighborhood;
- metadata;
- status.

### ContactChannel deve conter

- organizationId;
- campaignId;
- contactId;
- channel;
- value;
- normalizedValue;
- isPrimary;
- status.

### Status de contato

- ACTIVE;
- INVALID;
- DUPLICATE;
- BLOCKED;
- DELETED.

### Regras

- contato precisa ter pelo menos telefone ou e-mail;
- telefone deve ser normalizado;
- e-mail deve ser normalizado em lowercase;
- WhatsApp é canal primário quando há telefone;
- e-mail é canal primário apenas quando não há telefone;
- contato com opt-out deve ser bloqueado para envio;
- contatos não devem ser compartilhados entre organizações.

## 9. Consent

### Responsabilidade

Registrar permissão, desconhecimento, revogação ou opt-out por canal.

### Entidades principais

- Consent.
- OptOut.

### Consent deve conter

- organizationId;
- campaignId;
- contactId;
- channel;
- status;
- source;
- consentText;
- collectedAt;
- revokedAt.

### Status de consentimento

- UNKNOWN;
- GRANTED;
- REVOKED;
- OPT_OUT.

### OptOut deve conter

- organizationId;
- campaignId;
- contactId;
- channel;
- reason;
- source;
- createdAt.

### Regras

- opt-out deve prevalecer sobre consentimento concedido;
- opt-out bloqueia envio no canal correspondente;
- opt-out global ou sem canal deve bloquear canais principais;
- origem deve ser registrada sempre que possível;
- alterações devem gerar audit log.

## 10. Tags e Segments

### Responsabilidade

Organizar contatos por classificação manual, automática ou filtros salvos.

### Entidades principais

- Tag.
- ContactTag.
- Segment, futuro.

### Tag deve conter

- organizationId;
- campaignId;
- name;
- color;
- description.

### Regras

- nome de tag deve ser único por campanha;
- tag pode ser aplicada manualmente;
- IA pode sugerir tag futuramente;
- aplicação automática deve exigir regra específica;
- segmentos devem ser filtros salvos, não cópias de contatos.

## 11. Channel Accounts

### Responsabilidade

Representar contas externas conectadas a uma campanha.

Exemplos:

- uma instância Evolution;
- uma conta WhatsApp oficial;
- uma conta de e-mail;
- uma conta Instagram;
- um provider SMS.

### Entidades principais

- ChannelAccount.

### Deve conter

- organizationId;
- campaignId;
- provider;
- name;
- status;
- externalAccountId;
- config.

### Providers previstos

- WHATSAPP_EVOLUTION;
- WHATSAPP_CLOUD_API;
- INSTAGRAM;
- EMAIL;
- SMS;
- TELEGRAM.

### Regras

- secrets não devem ser salvos em config sem decisão explícita;
- config pode guardar dados não sensíveis;
- provider externo deve ser acessado por adapter;
- conta de canal deve pertencer a campanha e organização;
- mudanças devem gerar audit log.

## 12. Conversations

### Responsabilidade

Agrupar mensagens em uma conversa operacional com um contato.

### Entidades principais

- ConversationThread.
- Message.

### ConversationThread deve conter

- organizationId;
- campaignId;
- contactId;
- channelAccountId;
- channel;
- status;
- assignedToUserId;
- lastMessageAt;
- summary.

### Message deve conter

- organizationId;
- campaignId;
- contactId;
- conversationId;
- channelAccountId;
- provider;
- direction;
- externalMessageId;
- body;
- status;
- rawPayload;
- createdAt.

### Direções

- INBOUND;
- OUTBOUND.

### Regras

- payload bruto de webhook deve ser preservado;
- mensagem normalizada deve ser armazenada;
- externalMessageId deve ser usado para evitar duplicidade quando disponível;
- conversa deve atualizar lastMessageAt;
- opt-out deve bloquear outbound;
- inbound deve continuar sendo salvo mesmo se contato estiver bloqueado.

## 13. AI

### Responsabilidade

Gerar apoio assistivo para operadores da campanha.

### Entidades futuras

- AiSuggestion;
- AiClassification;
- AiRunLog.

### AiSuggestion deve conter futuramente

- organizationId;
- campaignId;
- contactId;
- conversationId;
- messageId opcional;
- suggestionText;
- status;
- reviewedByUserId;
- usedAt;
- createdAt.

### AiClassification deve conter futuramente

- organizationId;
- campaignId;
- contactId;
- conversationId opcional;
- intent;
- sentiment;
- supportLevel;
- confidence;
- metadata.

### Regras

- IA começa em modo sugestão;
- IA não envia mensagem automaticamente;
- IA deve respeitar opt-out;
- IA deve usar dados do candidato;
- IA deve considerar fase eleitoral;
- IA deve respeitar temas restritos;
- uso relevante da IA deve ser auditável.

## 14. Imports

### Responsabilidade

Processar entrada em massa de contatos.

### Entidades futuras

- ImportJob;
- ImportRow;
- ImportError.

### ImportJob deve conter futuramente

- organizationId;
- campaignId;
- uploadedByUserId;
- fileName;
- status;
- totalRows;
- processedRows;
- successRows;
- errorRows;
- mapping;
- createdAt;
- finishedAt.

### Regras

- importação deve rodar via worker;
- deve haver preview antes de importar;
- erros devem ser rastreáveis;
- duplicados não devem ser ignorados silenciosamente;
- consentimento/origem devem ser tratados explicitamente.

## 15. Landing Pages

### Responsabilidade

Captar contatos publicamente com origem e consentimento.

### Entidades futuras

- LandingPage;
- LandingSubmission.

### LandingPage deve conter futuramente

- organizationId;
- campaignId;
- title;
- slug;
- status;
- content;
- formConfig;
- consentText.

### LandingSubmission deve conter futuramente

- organizationId;
- campaignId;
- landingPageId;
- contactId;
- rawPayload;
- source;
- createdAt.

### Regras

- formulário deve registrar origem;
- consentimento deve ser registrado;
- spam e abuso devem ser mitigados;
- QR Code deve apontar para landing page ou formulário rastreável.

## 16. Audit

### Responsabilidade

Registrar ações relevantes do sistema e dos usuários.

### Entidade principal

- AuditLog.

### Deve conter

- organizationId;
- campaignId quando aplicável;
- actorUserId;
- action;
- entityType;
- entityId;
- metadata;
- createdAt.

### Regras

Gerar audit log para:

- criação e alteração de campanha;
- criação e alteração de candidato;
- criação e alteração de contato;
- alteração de consentimento;
- opt-out;
- criação e alteração de canal;
- envio manual de mensagem;
- uso ou aprovação de sugestão de IA;
- mudanças relevantes de configuração.

## 17. Compliance

### Responsabilidade

Definir e aplicar regras de segurança eleitoral, consentimento e operação.

Compliance não precisa ser um único módulo no início, mas suas regras devem atravessar o produto.

### Regras centrais

- opt-out prevalece sobre tudo;
- consentimento deve ser por canal;
- origem deve ser registrada;
- fase eleitoral deve influenciar IA e mensagens;
- pedido explícito de voto antes do período permitido deve ser bloqueado ou sinalizado;
- ações sensíveis devem ser auditáveis.

## 18. Fronteiras entre API, Worker e Web

### API

Responsável por:

- autenticação;
- validação de entrada;
- regras de negócio síncronas;
- persistência;
- autorização;
- endpoints REST;
- disparo de jobs quando necessário.

### Worker

Responsável por:

- importações;
- processamento de filas;
- tarefas demoradas;
- chamadas externas em lote;
- processamento assíncrono de webhook quando necessário;
- IA em segundo plano.

### Web

Responsável por:

- telas operacionais;
- formulários;
- navegação;
- chamadas à API;
- exibição de erros;
- experiência do usuário.

A Web não deve conter regra de segurança crítica sozinha.

## 19. Fronteiras de adapters

Adapters são responsáveis por conversar com sistemas externos.

Exemplos:

- EvolutionAdapter;
- WhatsAppCloudAdapter;
- InstagramAdapter;
- EmailAdapter;
- SmsAdapter;
- TelegramAdapter.

Adapters devem:

- receber dados internos normalizados;
- chamar provider externo;
- tratar erro;
- retornar resposta normalizada.

Adapters não devem:

- decidir se pode enviar mensagem;
- ignorar opt-out;
- alterar contato diretamente;
- definir regra eleitoral;
- substituir regra de domínio.

## 20. Entidades que não devem ser criadas cedo demais

Evitar criar antes da necessidade real:

- billing;
- planos comerciais;
- permissões extremamente granulares;
- automação complexa de jornada;
- campanhas de disparo em massa;
- CRM avançado;
- relatórios sofisticados;
- editor visual completo de landing page;
- motor avançado de segmentação;
- automação irrestrita por IA.

Esses itens podem surgir depois, mas não devem contaminar o MVP.

## 21. Riscos arquiteturais a evitar

Evitar:

- Evolution espalhada pelo código;
- IA chamando envio diretamente;
- mensagem sem checar opt-out;
- contato sem organizationId/campaignId;
- webhook que duplica mensagens;
- config com segredo salvo em JSON visível;
- UI com regra crítica que não existe no backend;
- worker fazendo alteração sem auditabilidade;
- importação que cria contatos sem origem;
- permissões tratadas apenas no frontend.

## 22. Critério de qualidade do modelo

O modelo de dados será considerado saudável quando:

- cada entidade tiver dono claro;
- consultas forem filtradas por tenant;
- dados sensíveis forem protegidos;
- integrações externas forem isoladas;
- opt-out for respeitado;
- eventos importantes forem auditáveis;
- novas features puderem ser adicionadas sem reescrever o núcleo.

## 23. Próximo blueprint

O próximo documento deve ser:

Blueprint 05 — Estratégia de Integrações e Canais

Ele deve detalhar como Evolution, WhatsApp oficial, Instagram, e-mail, SMS, Telegram e landing pages entram no produto sem acoplar o domínio aos provedores.