# Blueprint 12 — Estratégia de Testes, Qualidade e Evolução Técnica

## 1. Objetivo deste documento

Este blueprint define a estratégia de testes, qualidade e evolução técnica do Campanha360 AI.

Ele existe para evitar regressões conforme o produto cresce em módulos sensíveis como contatos, consentimento, opt-out, canais, inbox, IA, importação e landing pages.

O objetivo não é criar uma suíte de testes gigante no início. O objetivo é garantir confiança progressiva.

## 2. Princípio central

Qualidade deve crescer junto com risco.

Fluxos simples podem começar com typecheck, build e validação manual.

Fluxos sensíveis precisam de testes automatizados conforme amadurecem.

Quanto maior o risco de quebrar dados, permissões, opt-out ou envio de mensagem, maior deve ser a exigência de teste.

## 3. Camadas de qualidade

O projeto deve usar camadas progressivas:

- typecheck;
- build;
- validação manual;
- testes unitários;
- testes de integração;
- testes end-to-end;
- revisão de segurança;
- revisão de migrations;
- revisão de UX operacional.

Nem toda entrega precisa de todas as camadas, mas toda entrega precisa de alguma validação objetiva.

## 4. Testes mínimos por subetapa

Toda subetapa implementada pelo Cursor deve rodar:

    npm run typecheck
    npm run build

Quando Prisma estiver envolvido:

    npm run prisma:generate

Quando migration for criada:

    npx prisma migrate deploy

Se um comando não puder rodar por falta de banco, Redis ou env local, o Cursor deve relatar claramente.

## 5. Validação manual mínima

Depois de deploy, validar:

- login;
- fluxo alterado;
- fluxo anterior mais sensível;
- healthcheck da API;
- console do navegador sem erro crítico;
- logs da API sem erro crítico;
- logs do Worker quando aplicável.

Exemplo:

Se uma mudança afetou contatos, testar:

- criar contato;
- editar contato;
- salvar consentimento;
- registrar opt-out;
- tentar ação bloqueada.

## 6. Fluxos críticos permanentes

Estes fluxos devem continuar funcionando sempre:

- registro;
- login;
- /auth/me;
- criação de organização;
- seleção de organização ativa;
- criação de campanha;
- edição de campanha;
- edição de candidato;
- criação de contato;
- edição de contato;
- consentimento;
- opt-out;
- /health.

Toda subetapa que mexer em API, Web ou Prisma deve considerar esses fluxos.

## 7. Testes unitários

Usar testes unitários para regras puras.

Bons candidatos:

- normalização de telefone;
- validação de e-mail;
- resolução de organização ativa;
- regras de opt-out;
- mapeamento de consentimento;
- parser de CSV;
- detecção de duplicados;
- guardrails de IA;
- transformação de payload Evolution.

Testes unitários devem ser rápidos e independentes de banco.

## 8. Testes de integração

Usar testes de integração para regras que dependem de banco ou múltiplos serviços internos.

Bons candidatos:

- auth;
- permissões;
- criação de campanha;
- CRUD de contatos;
- consentimento;
- opt-out;
- ChannelAccount;
- Message;
- ConversationThread;
- ImportJob;
- LandingSubmission.

Testes de integração podem usar banco de teste no futuro.

No início, podem ser adicionados nos módulos mais sensíveis.

## 9. Testes end-to-end

Usar testes end-to-end para fluxos principais no navegador.

Fluxos candidatos:

- registro e login;
- criar organização;
- criar campanha;
- criar contato;
- registrar opt-out;
- criar canal;
- abrir inbox;
- enviar mensagem manual;
- criar landing page;
- submeter formulário público.

Não começar com E2E complexo demais, mas adicionar conforme o produto estabilizar.

## 10. Testes de permissões

Permissões são área crítica.

Testar cenários:

- OWNER cria e edita;
- ADMIN cria e edita;
- MANAGER cria e edita;
- VIEWER apenas lê;
- usuário sem membership não acessa;
- usuário de outra organização não acessa;
- usuário não edita campanha de outra organização.

Esses testes devem virar prioridade conforme múltiplos usuários forem usados.

## 11. Testes de tenancy

Tenancy precisa ser protegida.

Validar:

- contato de uma organização não aparece em outra;
- campanha de uma organização não aparece em outra;
- mensagem não vaza entre campanhas;
- canal não é usado fora da campanha;
- landing page pública associa submissão à campanha certa;
- webhook não cria dados em campanha errada.

Toda entidade nova deve ser revisada contra tenancy.

## 12. Testes de opt-out

Opt-out deve ter proteção forte.

Testar:

- registrar opt-out;
- contato vira BLOCKED quando aplicável;
- consentimento vira OPT_OUT;
- envio manual é bloqueado;
- IA não sugere envio;
- importação não remove opt-out;
- landing page não reativa opt-out;
- opt-out por canal bloqueia canal correto;
- opt-out global bloqueia canais principais.

## 13. Testes de consentimento

Testar:

- criar consentimento GRANTED;
- alterar para REVOKED;
- alterar para OPT_OUT;
- registrar source;
- registrar consentText;
- preservar collectedAt;
- preencher revokedAt;
- impedir envio quando status bloqueia.

## 14. Testes de canais

Quando ChannelAccount e Evolution entrarem, testar:

- criar canal;
- editar canal;
- listar por campanha;
- impedir acesso por outra organização;
- não exibir segredo;
- webhook identifica canal;
- mensagem inbound é criada;
- mensagem duplicada não duplica;
- envio manual respeita opt-out.

## 15. Testes de IA

Quando IA entrar, testar:

- gerar sugestão sem enviar;
- considerar candidato;
- considerar tom de voz;
- considerar temas restritos;
- bloquear pedido de voto em PRE_CAMPAIGN;
- não gerar sugestão de envio para opt-out;
- registrar sugestão;
- permitir descartar;
- permitir usar como rascunho.

## 16. Testes de importação

Quando importação entrar, testar:

- upload de CSV;
- mapeamento de colunas;
- preview;
- linha válida;
- linha inválida;
- duplicado por telefone;
- duplicado por e-mail;
- opt-out importado;
- consentimento importado;
- relatório final;
- worker processando.

## 17. Testes de landing pages

Quando landing pages entrarem, testar:

- criar página;
- publicar;
- acessar slug público;
- DRAFT não público;
- ARCHIVED não aceita submissão;
- submeter formulário;
- contato criado;
- consentimento registrado;
- origem preservada;
- QR Code aponta para URL correta.

## 18. Revisão de migrations

Toda migration deve ser revisada.

Checklist:

- cria tabela esperada;
- não apaga dados sem autorização;
- não renomeia coluna com risco;
- enums são coerentes;
- índices necessários existem;
- relações estão corretas;
- campos obrigatórios não quebram produção;
- migration combina com schema.

Migrations destrutivas devem ser evitadas.

## 19. Revisão de dependências

Antes de adicionar dependência nova, perguntar:

- já existe algo no projeto que resolve?
- é mantida?
- é necessária agora?
- aumenta muito o build?
- cria risco de segurança?
- funciona bem no Docker/EasyPanel?

Evitar dependências para problemas simples.

## 20. Revisão de performance

Não otimizar cedo demais.

Mas observar:

- listas sem paginação;
- contatos crescendo;
- mensagens crescendo;
- imports grandes;
- consultas sem filtro por campaignId;
- N+1 queries;
- payloads grandes na UI;
- rawPayload muito pesado.

Adicionar paginação quando listas começarem a crescer.

## 21. Revisão de frontend

Verificar:

- tela carrega;
- erro aparece;
- botão salva;
- formulário valida;
- navegação volta;
- token é usado;
- API URL correta;
- texto não quebra layout;
- ação proibida não aparece ou fica bloqueada.

## 22. Revisão de backend

Verificar:

- DTO valida entrada;
- service tem regra de negócio;
- controller é fino;
- guard protege rota;
- tenancy é checada;
- permissões são checadas;
- erros são adequados;
- audit log é criado;
- dados sensíveis não são retornados.

## 23. Revisão de worker

Verificar:

- job tem nome claro;
- payload tem organizationId e campaignId quando necessário;
- retry é seguro;
- job pode rodar duas vezes sem dano;
- erro é registrado;
- logs são úteis;
- worker não depende de porta pública.

## 24. Revisão de documentação

Toda entrega relevante deve atualizar docs quando necessário.

Verificar:

- fase/épico atualizado;
- .env.example atualizado;
- EasyPanel atualizado se env nova;
- blueprints não alterados sem autorização;
- instruções de teste claras;
- pendências reais registradas.

## 25. Dívida técnica

Dívida técnica deve ser registrada, não escondida.

Tipos aceitáveis no MVP:

- UI simples;
- ausência temporária de paginação;
- filtros básicos;
- audit log sem tela;
- poucos testes automatizados no início.

Tipos perigosos:

- falta de tenancy;
- opt-out frágil;
- segredo em repo;
- provider acoplado ao domínio;
- migration manual;
- IA enviando sozinha;
- webhook sem idempotência.

## 26. Quando refatorar

Refatorar quando:

- duplicação começa a atrapalhar;
- regra sensível está espalhada;
- provider externo vazou para domínio;
- service ficou grande demais;
- UI repetida começa a criar inconsistência;
- testes ficam difíceis por acoplamento.

Não refatorar por gosto pessoal durante subetapa pequena.

## 27. Estratégia de evolução técnica

A evolução técnica deve seguir:

1. Primeiro fazer funcionar com fronteiras corretas.
2. Depois proteger com testes nos fluxos sensíveis.
3. Depois melhorar UX.
4. Depois otimizar.
5. Depois abstrair mais.

Não inverter essa ordem.

## 28. Qualidade mínima para avançar épico

Um épico só deve ser considerado pronto quando:

- subetapas principais foram implementadas;
- fluxos principais testados em produção;
- bugs críticos corrigidos;
- documentação atualizada;
- riscos anotados;
- próxima dependência está clara.

## 29. Critério para pausar implementação

Pausar quando:

- arquitetura ficou confusa;
- Cursor começou a misturar escopos;
- testes falham repetidamente;
- deploy está instável;
- dados sensíveis foram expostos;
- regra de opt-out foi quebrada;
- integração externa ficou acoplada;
- usuário não consegue testar.

Nesses casos, criar blueprint ou documento de correção antes de continuar.

## 30. Próximo blueprint

O próximo documento deve ser:

Blueprint 13 — Estratégia de Execução dos Próximos Épicos

Ele deve transformar os blueprints anteriores em uma sequência prática de execução a partir do estado atual do projeto, definindo o que fazer imediatamente, o que esperar e quais prompts só devem ser usados depois de validação.