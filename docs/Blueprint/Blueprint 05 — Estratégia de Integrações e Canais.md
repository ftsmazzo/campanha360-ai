# Blueprint 05 — Estratégia de Integrações e Canais

## 1. Objetivo deste documento

Este blueprint define como o Campanha360 AI deve lidar com canais externos e integrações.

Ele existe para impedir que o produto fique acoplado a um único provedor, especialmente à Evolution API, e para garantir que WhatsApp, Instagram, e-mail, SMS, Telegram e landing pages possam evoluir dentro de uma arquitetura comum.

Este documento não autoriza implementação imediata de todos os canais. Ele define a estratégia.

## 2. Princípio central

O domínio do Campanha360 AI não deve depender diretamente de provedores externos.

O sistema deve trabalhar com conceitos internos normalizados:

- contas de canal;
- contatos;
- conversas;
- mensagens;
- consentimentos;
- opt-outs;
- eventos de webhook;
- adapters de provider.

Providers externos devem ser detalhes de infraestrutura, não o centro da regra de negócio.

## 3. Conceitos internos

### ChannelAccount

Representa uma conta conectada a uma campanha.

Exemplos:

- instância Evolution;
- número oficial do WhatsApp Cloud API;
- conta Instagram;
- remetente de e-mail;
- remetente SMS;
- bot Telegram.

### Message

Representa uma mensagem normalizada.

Pode ser:

- inbound;
- outbound.

Deve guardar:

- provider;
- channel;
- direction;
- body;
- externalMessageId;
- rawPayload quando aplicável;
- status;
- timestamps.

### ConversationThread

Agrupa mensagens entre campanha e contato.

Deve permitir que o operador veja o histórico por contato e canal.

### Provider Adapter

Camada responsável por falar com o provedor externo.

Exemplos:

- EvolutionAdapter;
- WhatsAppCloudAdapter;
- InstagramAdapter;
- EmailAdapter;
- SmsAdapter;
- TelegramAdapter.

## 4. Regra de isolamento por adapter

Toda integração externa deve passar por adapter.

O adapter deve:

- receber entrada interna normalizada;
- traduzir para o formato do provider;
- chamar a API externa;
- tratar erros;
- retornar resposta normalizada.

O adapter não deve:

- decidir se a mensagem pode ser enviada;
- ignorar opt-out;
- alterar consentimento;
- decidir fase eleitoral;
- acessar UI;
- conter regra de campanha;
- misturar lógica de IA.

## 5. Fluxo inbound padrão

Todo canal que recebe mensagem deve seguir este fluxo:

1. Provider envia webhook ou evento.
2. API recebe payload.
3. Sistema salva payload bruto.
4. Sistema valida origem quando possível.
5. Sistema normaliza payload.
6. Sistema identifica campanha e channel account.
7. Sistema identifica ou cria contato quando permitido.
8. Sistema cria ou atualiza conversation thread.
9. Sistema salva message inbound.
10. Sistema atualiza lastMessageAt.
11. Sistema registra logs relevantes.
12. Inbox exibe a conversa.

A IA não deve responder automaticamente nesse fluxo inicial.

## 6. Fluxo outbound padrão

Todo envio de mensagem deve seguir este fluxo:

1. Operador escreve ou aprova mensagem.
2. API valida usuário e permissão.
3. API identifica contato, campanha e canal.
4. API verifica opt-out.
5. API verifica consentimento quando aplicável.
6. API verifica status do contato.
7. API chama adapter do provider.
8. Sistema salva message outbound.
9. Sistema atualiza conversation thread.
10. Sistema registra audit log.
11. UI mostra status de envio.

Nenhum provider deve receber mensagem antes dessas verificações.

## 7. Prioridade dos canais

A ordem recomendada é:

1. Evolution API.
2. Inbox interno.
3. Resposta manual por WhatsApp Evolution.
4. IA em modo sugestão.
5. WhatsApp Cloud API.
6. Landing pages e formulários públicos.
7. E-mail.
8. SMS.
9. Instagram.
10. Telegram.

Instagram pode ser antecipado se houver necessidade comercial clara, mas não deve vir antes de uma base de inbox e mensagens bem definida.

## 8. Evolution API

### Papel

A Evolution API será o primeiro provider de WhatsApp.

Ela é útil para MVP porque já está disponível no ambiente do usuário e facilita validação rápida do fluxo de conversa.

### O que a Evolution deve fazer

- receber mensagens via webhook;
- permitir envio manual;
- entregar payload bruto;
- permitir identificar número/instância;
- permitir operação inicial de WhatsApp.

### O que a Evolution não deve definir

- modelo de dados interno;
- regra de opt-out;
- regra de consentimento;
- estrutura do inbox;
- regra de IA;
- regra de campanha.

### Risco

A Evolution não é a API oficial do WhatsApp.

Por isso, o sistema deve manter a Evolution isolada para futura troca ou convivência com WhatsApp Cloud API.

## 9. WhatsApp Cloud API

### Papel

Será o caminho oficial para WhatsApp quando o produto precisar de maior robustez, compliance e operação formal.

### Quando entrar

Depois que o sistema já tiver:

- ChannelAccount;
- adapter pattern;
- Message;
- ConversationThread;
- opt-out;
- consentimento;
- inbox;
- envio manual funcionando.

### Regras

- implementar como provider separado;
- não substituir Evolution de forma brusca;
- preservar o mesmo modelo interno de mensagem;
- usar adapter próprio.

## 10. Instagram

### Papel

Instagram pode entrar como canal futuro de relacionamento e captação.

O projeto legado `sistema-instagram` pode ser analisado apenas como referência conceitual, especialmente para entender interações e postagens.

### O que pode ser aproveitado conceitualmente

- ideia de conectar conta;
- leitura de interações;
- associação de interação a contato;
- histórico de mensagens/comentários;
- eventual agenda de postagens se fizer sentido.

### O que não deve ser copiado cegamente

- estrutura antiga;
- dependências sem revisão;
- modelo de dados acoplado;
- lógica de postagem antes de inbox;
- automações sem consentimento ou revisão.

### Ordem recomendada

Instagram deve entrar depois do inbox estar maduro.

Primeiro tratar Instagram como canal de conversa/interação.

Postador ou agendamento de postagens deve ser outro épico ou subépico, não parte inicial do inbox.

## 11. E-mail

### Papel

E-mail pode ser usado para comunicação, confirmação, captação e relacionamento.

### Regras

- e-mail é canal separado;
- consentimento deve ser por e-mail;
- opt-out de e-mail deve bloquear envios;
- mensagens devem entrar no histórico do contato quando enviadas pelo sistema;
- provider deve ser adapter.

### Fora de escopo inicial

- campanhas de e-mail marketing em massa;
- editor visual avançado;
- automações complexas.

## 12. SMS

### Papel

SMS pode ser canal de contato curto e direto.

### Regras

- consentimento por SMS;
- opt-out por SMS;
- provider isolado;
- custo por envio deve ser considerado futuramente;
- mensagem outbound deve ficar registrada.

### Fora de escopo inicial

- disparo em massa;
- cobrança por crédito;
- automação.

## 13. Telegram

### Papel

Telegram pode ser canal complementar.

### Regras

- bot ou conta conectada deve virar ChannelAccount;
- mensagens inbound devem virar Message;
- conversas devem aparecer no mesmo inbox;
- provider deve ser adapter.

### Prioridade

Baixa no MVP, salvo demanda específica.

## 14. Landing Pages

### Papel

Landing pages não são canal de conversa, mas são canal de captação.

Elas servem para entrada de novos contatos com origem rastreável e consentimento.

### Regras

- cada landing page pertence a organização e campanha;
- submissão cria ou atualiza contato;
- origem deve ser registrada;
- consentimento deve ser registrado;
- QR Code deve apontar para URL rastreável;
- dados devem passar por validação.

### Relação com canais

Landing pages podem coletar autorização para canais como:

- WhatsApp;
- e-mail;
- SMS;
- Telegram.

## 15. ChannelAccount

### Responsabilidade

Guardar a representação interna da conta externa conectada.

### Campos recomendados

- organizationId;
- campaignId;
- provider;
- name;
- status;
- externalAccountId;
- config.

### Config

O campo config pode guardar dados não sensíveis.

Exemplos permitidos:

- nome da instância;
- identificador externo;
- preferências não secretas;
- configurações de comportamento.

Exemplos proibidos sem criptografia ou estratégia explícita:

- token real;
- senha;
- API key;
- refresh token;
- segredo de webhook.

Segredos devem ficar preferencialmente em variáveis de ambiente ou mecanismo seguro.

## 16. WebhookEvent

### Recomendação

Criar uma entidade ou estrutura equivalente para registrar webhooks recebidos.

Campos recomendados:

- organizationId quando identificável;
- campaignId quando identificável;
- channelAccountId quando identificável;
- provider;
- eventType;
- externalEventId;
- rawPayload;
- status;
- errorMessage;
- processedAt;
- createdAt.

### Regras

- salvar antes de processar quando possível;
- processar de forma idempotente;
- registrar falhas;
- permitir reprocessamento futuro.

## 17. Idempotência

Webhooks podem chegar duplicados.

O sistema deve evitar duplicar mensagens usando:

- provider;
- externalMessageId;
- channelAccountId;
- direction;
- campaignId.

Quando o provider não enviar identificador confiável, criar estratégia alternativa com hash do payload ou combinação de campos.

## 18. Opt-out em canais

Antes de qualquer outbound:

- verificar Contact.status;
- verificar OptOut;
- verificar Consent;
- verificar canal;
- verificar campanha.

Regra padrão:

- Contact BLOCKED não recebe outbound;
- Consent OPT_OUT bloqueia canal;
- OptOut registrado bloqueia canal ou todos, conforme registro;
- Consent REVOKED bloqueia canal;
- Consent UNKNOWN deve ser tratado com cautela, conforme política futura.

## 19. IA e canais

A IA não deve conversar diretamente com provider.

Fluxo correto:

1. Mensagem inbound chega.
2. Inbox mostra conversa.
3. IA gera sugestão.
4. Operador revisa.
5. Operador envia manualmente.
6. API valida opt-out e consentimento.
7. Adapter envia.

Futuramente, modos automáticos podem existir, mas devem ser outro épico com guardrails próprios.

## 20. Worker e filas

Integrações podem usar worker quando houver:

- processamento pesado;
- retry;
- importação;
- envio em lote futuro;
- enriquecimento;
- IA;
- reprocessamento de webhook;
- sincronização externa.

No MVP, webhooks simples podem começar síncronos, mas a arquitetura deve permitir migração para filas.

## 21. Observabilidade

Integrações precisam registrar:

- payload recebido;
- erro do provider;
- status de mensagem;
- falha de envio;
- duplicidade ignorada;
- tempo de processamento;
- vínculo com contato e campanha.

O objetivo não é criar observabilidade sofisticada no início, mas permitir diagnóstico operacional.

## 22. Estratégia de evolução

A evolução recomendada é:

### Etapa 1

Criar ChannelAccount.

Sem chamar provider.

### Etapa 2

Criar adapter Evolution.

Com métodos mínimos e sem UI complexa.

### Etapa 3

Receber webhook Evolution.

Salvar payload bruto e mensagem inbound.

### Etapa 4

Criar inbox básico.

Mostrar conversas e mensagens.

### Etapa 5

Enviar resposta manual.

Com opt-out e audit log.

### Etapa 6

Adicionar IA sugestiva.

Sem envio automático.

### Etapa 7

Adicionar WhatsApp Cloud API.

Mantendo o mesmo domínio interno.

### Etapa 8

Adicionar demais canais.

Sem quebrar inbox.

## 23. Riscos a evitar

Evitar:

- chamar Evolution diretamente de controllers;
- salvar token real em config sem proteção;
- tratar WhatsApp como único canal possível;
- criar inbox acoplado a Evolution;
- deixar webhook criar dados sem organizationId/campaignId;
- enviar mensagem sem opt-out;
- deixar IA chamar adapter diretamente;
- duplicar mensagem por webhook repetido;
- misturar postagens Instagram com inbox antes da hora.

## 24. Critério de aceite para qualquer canal

Um canal só está bem integrado quando:

- tem ChannelAccount;
- tem provider definido;
- usa adapter;
- inbound vira Message;
- outbound vira Message;
- opt-out é respeitado;
- erros são registrados;
- dados são filtrados por organização e campanha;
- UI não mostra segredo;
- troca futura de provider é possível sem reescrever o domínio.

## 25. Próximo blueprint

O próximo documento deve ser:

Blueprint 06 — Estratégia de IA Assistiva e Guardrails

Ele deve definir como a IA será usada no produto, quais limites deve respeitar, como o contexto da campanha entra nas respostas e como impedir automações perigosas.