# Blueprint 08 — Estratégia de Landing Pages e Captação Pública

## 1. Objetivo deste documento

Este blueprint define como o Campanha360 AI deve criar páginas públicas, formulários, links e QR Codes para captação de contatos.

Ele existe para garantir que novos eleitores, apoiadores ou leads entrem no sistema com origem, consentimento, campanha e organização bem definidos.

Este documento não autoriza criação de um construtor visual avançado de páginas no início.

## 2. Princípio central

Captação pública não é apenas um formulário.

Toda captação deve registrar:

- organização;
- campanha;
- página ou origem;
- dados enviados;
- canal de contato;
- consentimento;
- texto aceito;
- data da submissão;
- contexto de origem;
- vínculo com contato criado ou atualizado.

O objetivo é captar com rastreabilidade e segurança.

## 3. Escopo inicial

O escopo inicial deve ser simples:

- landing page por campanha;
- slug público;
- formulário básico;
- consentimento explícito;
- origem registrada;
- criação ou atualização de contato;
- QR Code para a página;
- status publicado ou rascunho.

Não inclui inicialmente:

- editor visual complexo;
- múltiplos templates avançados;
- pagamento;
- automações;
- disparo após cadastro;
- testes A/B;
- domínio próprio por cliente;
- personalização completa de design.

## 4. Tipos de captação

Tipos previstos:

- landing page pública;
- formulário simples;
- link de cadastro;
- QR Code;
- formulário embarcado futuro;
- integração com Instagram futura;
- integração com anúncios futura.

A primeira versão deve focar em landing page e formulário.

## 5. LandingPage

Entidade futura recomendada.

Campos sugeridos:

- id;
- organizationId;
- campaignId;
- title;
- slug;
- status;
- description;
- heroText;
- formTitle;
- consentText;
- thankYouMessage;
- themeConfig;
- createdByUserId;
- publishedAt;
- createdAt;
- updatedAt.

Status possíveis:

- DRAFT;
- PUBLISHED;
- ARCHIVED.

## 6. LandingSubmission

Entidade futura recomendada.

Campos sugeridos:

- id;
- organizationId;
- campaignId;
- landingPageId;
- contactId;
- rawPayload;
- normalizedPayload;
- source;
- ipHash;
- userAgent;
- consentText;
- consentStatus;
- createdAt.

A submissão deve preservar o payload enviado e o resultado normalizado.

## 7. URL pública

Formato recomendado:

- /p/[slug]

Exemplo:

- /p/joao-prefeito-2026

A URL pública deve resolver a landing page publicada.

Páginas em DRAFT não devem ser públicas.

Páginas ARCHIVED não devem aceitar novas submissões.

## 8. Slug

Regras:

- slug deve ser único;
- slug deve ser amigável;
- slug deve ser validado;
- slug não deve expor dados sensíveis;
- slug pode conter campanha, nome ou território;
- alteração de slug deve ser auditável.

Exemplos:

- maria-vereadora-2026;
- campanha-centro-2026;
- voluntarios-joao-2026.

## 9. Formulário inicial

Campos recomendados:

- nome;
- telefone;
- e-mail;
- cidade;
- bairro;
- aceite de consentimento;
- campo oculto de origem.

Regras:

- telefone ou e-mail deve ser obrigatório;
- consentimento deve ser explícito;
- texto de consentimento deve ser registrado;
- dados devem ser validados no backend;
- submissão deve criar ou atualizar contato.

## 10. Consentimento

Toda landing page deve ter texto de consentimento.

Exemplo de texto genérico:

- “Autorizo o recebimento de comunicações desta campanha pelos canais informados.”

O texto exato deve ser configurável.

Ao submeter:

- criar Consent para os canais informados;
- status deve ser GRANTED se o aceite foi marcado;
- source deve indicar landing page;
- consentText deve salvar o texto aceito;
- collectedAt deve ser preenchido.

Se não houver aceite, a submissão não deve criar consentimento GRANTED.

## 11. Origem

Toda submissão deve registrar origem.

Exemplos:

- landing_page;
- qr_code;
- instagram_link;
- whatsapp_link;
- evento;
- formulario_publico.

A origem deve entrar em:

- LandingSubmission;
- metadata do contato;
- Consent.source;
- audit log quando aplicável.

## 12. Criação ou atualização de contato

Ao receber submissão:

1. Normalizar telefone e e-mail.
2. Procurar contato existente na campanha.
3. Se existir, atualizar campos vazios ou metadata de origem.
4. Se não existir, criar contato.
5. Criar ou atualizar canais do contato.
6. Criar consentimento.
7. Vincular LandingSubmission ao contato.

Não sobrescrever opt-out.

Se o contato tiver opt-out:

- não remover bloqueio;
- registrar submissão;
- não reativar envio automaticamente;
- sinalizar internamente para revisão.

## 13. QR Code

Cada landing page publicada pode gerar um QR Code.

O QR Code deve apontar para a URL pública.

Futuramente, pode incluir parâmetros de origem.

Exemplo:

- /p/joao-prefeito-2026?src=evento-centro

Regras:

- QR Code não deve conter segredo;
- QR Code deve ser regenerável;
- origem do QR Code deve ser rastreável quando possível.

## 14. Parâmetros de tracking

Parâmetros permitidos:

- src;
- utm_source;
- utm_medium;
- utm_campaign;
- ref.

Esses parâmetros podem ser salvos em metadata e LandingSubmission.

Não usar tracking para burlar consentimento.

## 15. Antiabuso

A captação pública precisa de proteções mínimas.

Medidas recomendadas:

- rate limit por IP;
- honeypot simples;
- validação backend;
- limite de tamanho dos campos;
- bloqueio de payload inválido;
- log de submissões suspeitas.

CAPTCHA pode ser considerado depois, mas não precisa ser primeira medida.

## 16. UI administrativa

Dentro da campanha, a UI deve permitir:

- listar landing pages;
- criar landing page;
- editar conteúdo básico;
- definir slug;
- definir texto de consentimento;
- publicar;
- arquivar;
- copiar link público;
- visualizar QR Code;
- ver submissões básicas.

## 17. UI pública

A landing page pública deve ser simples e clara.

Elementos iniciais:

- título;
- descrição;
- chamada principal;
- formulário;
- checkbox de consentimento;
- mensagem de sucesso;
- identificação da campanha quando adequado.

Evitar:

- excesso de texto;
- promessas não cadastradas;
- pedido explícito de voto fora da fase adequada;
- elementos que pareçam oficiais do governo;
- captação sem consentimento claro.

## 18. Relação com candidato

A landing page pode usar dados da campanha e candidato.

Pode exibir:

- nome do candidato;
- cargo;
- território;
- propostas principais;
- bio curta.

Mas deve respeitar:

- fase eleitoral;
- temas restritos;
- compliance;
- informações realmente cadastradas.

Não inventar proposta ou promessa.

## 19. Relação com contatos

Toda submissão deve resultar em:

- contato criado;
- contato atualizado;
- ou submissão registrada com erro.

Contato criado pela landing page deve ter metadata de origem.

Exemplo:

    source: landing_page
    landingPageId: ...
    submittedAt: ...

## 20. Relação com tags

Landing page pode aplicar tags automaticamente no futuro.

Exemplos:

- voluntario;
- interessado;
- evento-centro;
- quer-receber-whatsapp.

Na primeira versão, isso pode ficar fora do escopo ou limitado a uma tag fixa configurada.

## 21. Relação com segmentos

Submissões de landing pages podem alimentar segmentos.

Exemplos:

- contatos captados por QR Code;
- contatos de uma página específica;
- contatos por origem;
- contatos com consentimento WhatsApp.

Segmentos devem ser filtros salvos, não cópias.

## 22. Relação com canais

Landing page pode captar consentimento para:

- WhatsApp;
- e-mail;
- SMS;
- Telegram futuro.

A primeira versão deve focar em WhatsApp e e-mail, porque já existem como canais básicos de contato.

## 23. Audit log

Registrar audit log para:

- criação de landing page;
- edição de landing page;
- publicação;
- arquivamento;
- alteração de slug;
- alteração de texto de consentimento.

Submissões públicas podem ser registradas em LandingSubmission e não precisam gerar audit log individual no MVP, salvo decisão posterior.

## 24. Worker

No início, submissão pode ser síncrona.

Worker pode entrar futuramente para:

- processar alto volume;
- enriquecer dados;
- enviar notificação;
- aplicar tags;
- gerar relatórios.

Não adicionar worker cedo sem necessidade real.

## 25. SEO e indexação

Como são páginas de campanha, definir política por status.

DRAFT:

- não indexar;
- não público.

PUBLISHED:

- público;
- indexação pode ser configurável.

ARCHIVED:

- não aceitar submissão;
- pode mostrar mensagem de encerramento ou 404.

## 26. Domínios personalizados

Domínio personalizado por campanha fica fora do MVP.

No início, usar domínio padrão da Web.

Exemplo:

- https://campanha-360-ia-web.kxryyk.easypanel.host/p/slug

Futuramente, permitir domínio próprio exigirá:

- configuração DNS;
- SSL;
- associação com organização;
- validação de ownership.

## 27. Segurança e privacidade

Landing pages devem evitar:

- expor dados internos;
- permitir enumeração de campanhas privadas;
- aceitar payload grande demais;
- salvar IP bruto sem necessidade;
- exibir erro técnico;
- reativar contato bloqueado;
- aceitar consentimento falso sem checkbox;
- gravar segredo em URL.

## 28. Critério de aceite da primeira versão

A primeira versão estará aceitável quando:

- usuário cria landing page dentro da campanha;
- define slug e texto básico;
- publica página;
- acessa URL pública;
- submete formulário;
- contato é criado ou atualizado;
- consentimento é registrado;
- origem é preservada;
- QR Code aponta para a página;
- página arquivada não aceita nova submissão.

## 29. Ordem recomendada

Implementar este épico em subetapas:

### 29.1 Estrutura de LandingPage

Criar entidade, CRUD administrativo e documentação.

### 29.2 Página pública simples

Renderizar página publicada por slug.

### 29.3 Formulário e submissão

Criar contato, consentimento e LandingSubmission.

### 29.4 QR Code e link rastreável

Gerar QR Code e copiar link.

### 29.5 Antiabuso mínimo

Adicionar rate limit, honeypot e validações.

### 29.6 Melhorias de conteúdo

Permitir conteúdo básico mais configurável.

## 30. O que não fazer cedo demais

Evitar:

- construtor drag-and-drop;
- múltiplos temas complexos;
- domínio próprio;
- automação após cadastro;
- envio automático de WhatsApp;
- integração com anúncios;
- analytics sofisticado;
- testes A/B.

## 31. Próximo blueprint

O próximo documento deve ser:

Blueprint 09 — Estratégia de Deploy, Ambientes e Operação no EasyPanel

Ele deve definir como os serviços API, Web, Worker, Postgres, Redis, variáveis de ambiente, migrations, logs e deploys devem ser tratados.