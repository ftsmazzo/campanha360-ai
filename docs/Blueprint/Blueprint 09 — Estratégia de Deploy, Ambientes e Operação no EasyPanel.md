# Blueprint 09 — Estratégia de Deploy, Ambientes e Operação no EasyPanel

## 1. Objetivo deste documento

Este blueprint define como o Campanha360 AI deve ser implantado, configurado e operado no EasyPanel.

Ele existe para evitar deploy improvisado, variáveis espalhadas, migrations manuais inseguras, serviços mal definidos e dúvidas sobre quando redeployar API, Web ou Worker.

## 2. Princípio central

O EasyPanel é o ambiente operacional padrão do projeto.

Toda mudança relevante deve considerar:

- qual serviço precisa redeploy;
- quais variáveis de ambiente são necessárias;
- se há migration;
- se o worker precisa atualizar;
- como testar após o deploy;
- como verificar logs;
- como evitar exposição de segredos.

## 3. Serviços principais

O ambiente do Campanha360 AI deve conter:

- PostgreSQL;
- Redis;
- API;
- Web;
- Worker.

Integrações externas, como Evolution API, podem existir em outro serviço, mas devem ser documentadas como dependências externas.

## 4. PostgreSQL

### Responsabilidade

Armazenar dados principais do produto.

Inclui:

- usuários;
- organizações;
- campanhas;
- contatos;
- consentimentos;
- opt-outs;
- canais;
- mensagens;
- audit logs;
- configurações;
- importações futuras.

### Regras

- DATABASE_URL deve ficar apenas no EasyPanel;
- senha real não deve ir para o repositório;
- migrations devem ser aplicadas no deploy da API quando configurado;
- backup deve ser considerado antes de mudanças destrutivas;
- mudanças de schema exigem revisão.

## 5. Redis

### Responsabilidade

Suportar filas, cache e processamento assíncrono.

Uso previsto:

- BullMQ;
- jobs de importação;
- jobs de IA;
- processamento de webhooks;
- retry de integrações;
- tarefas futuras.

### Regras

- REDIS_URL deve ficar apenas no EasyPanel;
- senha real não deve ir para o repositório;
- API e Worker podem precisar acessar Redis;
- Web não deve precisar acessar Redis diretamente.

## 6. API

### Responsabilidade

Serviço backend principal.

Cuida de:

- autenticação;
- autorização;
- regras de negócio;
- Prisma;
- migrations;
- endpoints REST;
- webhooks;
- comunicação com adapters;
- criação de jobs.

### Variáveis típicas

- DATABASE_URL;
- REDIS_URL;
- JWT_SECRET;
- WEB_PUBLIC_URL;
- API_PUBLIC_URL;
- EVOLUTION_API_URL quando integração estiver ativa;
- EVOLUTION_API_KEY quando necessário;
- variáveis de IA futuramente.

### Regras

- API deve expor /health;
- API deve aplicar migrations quando configurado;
- API deve ter CORS compatível com a Web;
- API não deve depender de variáveis públicas do frontend;
- API deve ser redeployada quando backend, Prisma ou env de backend mudar.

## 7. Web

### Responsabilidade

Serviço frontend do painel e futuras páginas públicas.

Cuida de:

- login;
- dashboard;
- campanhas;
- contatos;
- canais;
- inbox;
- landing pages;
- chamadas à API.

### Variáveis típicas

- NEXT_PUBLIC_API_URL;
- API_PUBLIC_URL, se usado no build;
- WEB_PUBLIC_URL, quando necessário.

### Regras

- Web deve chamar a URL pública da API;
- variáveis NEXT_PUBLIC são expostas ao navegador, então não podem conter segredos;
- Web deve ser redeployada quando frontend ou env pública mudar;
- Web não deve acessar banco, Redis ou secrets diretamente.

## 8. Worker

### Responsabilidade

Executar tarefas assíncronas.

Uso previsto:

- importação CSV;
- processamento de filas;
- IA em lote;
- retries;
- webhooks pesados;
- sincronizações externas.

### Variáveis típicas

- DATABASE_URL;
- REDIS_URL;
- EVOLUTION_API_URL quando necessário;
- EVOLUTION_API_KEY quando necessário;
- variáveis de IA futuramente.

### Regras

- Worker não deve receber tráfego público;
- se EasyPanel exigir porta/domínio, isso deve ser tratado como limitação operacional;
- Worker deve logar que está pronto;
- Worker deve ser redeployado quando jobs ou dependências assíncronas mudarem.

## 9. Evolution API

### Responsabilidade

Provider externo inicial para WhatsApp.

### Regras

- deve ser tratada como dependência externa;
- URL deve ficar em variável de ambiente;
- chave/token deve ficar em variável de ambiente;
- não salvar segredo da Evolution em documento;
- não acoplar domínio à Evolution.

## 10. Ambientes

No início, pode existir apenas produção no EasyPanel.

Mas o projeto deve distinguir conceitualmente:

- local;
- produção;
- staging futuro.

### Local

Usado para desenvolvimento.

Pode usar:

- .env local;
- Docker compose;
- banco local;
- Redis local.

### Produção

Usado pelo EasyPanel.

Deve usar:

- envs do painel;
- Postgres do EasyPanel;
- Redis do EasyPanel;
- serviços separados;
- deploy por GitHub.

### Staging futuro

Recomendado antes de uso real com campanhas maiores.

Deve usar:

- banco separado;
- Redis separado;
- Evolution separada;
- URLs separadas.

## 11. Variáveis de ambiente

### Regras gerais

- segredos ficam no EasyPanel;
- .env.example usa placeholders;
- env real não entra no GitHub;
- NEXT_PUBLIC só para valores realmente públicos;
- mudanças de env devem ser documentadas.

### Exemplos de placeholders

    DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=disable
    REDIS_URL=redis://default:PASSWORD@HOST:6379
    JWT_SECRET=<JWT_SECRET>
    API_PUBLIC_URL=https://api.example.com
    WEB_PUBLIC_URL=https://web.example.com
    NEXT_PUBLIC_API_URL=https://api.example.com
    EVOLUTION_API_URL=https://evolution.example.com
    EVOLUTION_API_KEY=<EVOLUTION_API_KEY>

## 12. Segredos

São segredos:

- senha do banco;
- senha do Redis;
- JWT_SECRET;
- API keys;
- tokens;
- secrets de webhook;
- credenciais de provider;
- dados reais exportados.

Regras:

- nunca commitar;
- nunca colocar em docs;
- nunca colocar em prints públicos;
- rotacionar se expostos;
- usar placeholders em documentação.

## 13. Migrations

### Regra geral

Alterações no Prisma exigem migration versionada.

### Fluxo recomendado

1. Cursor altera schema.
2. Cursor cria migration.
3. Cursor roda prisma generate.
4. Cursor roda typecheck.
5. Cursor roda build.
6. Arquiteto revisa migration.
7. API é redeployada.
8. Deploy da API aplica migration quando configurado.
9. Fluxo principal é testado.

### Proibido

- alterar banco manualmente em produção sem registrar migration;
- rodar comandos destrutivos sem revisão;
- apagar dados sem backup e autorização.

## 14. Quando redeployar cada serviço

### Redeploy API

Quando mudar:

- apps/api;
- prisma/schema.prisma;
- migrations;
- packages usados pela API;
- env de backend;
- Dockerfile da API.

### Redeploy Web

Quando mudar:

- apps/web;
- packages usados pela Web;
- env pública;
- Dockerfile da Web.

### Redeploy Worker

Quando mudar:

- apps/worker;
- jobs;
- filas;
- packages usados pelo Worker;
- env do Worker;
- Dockerfile do Worker.

### Redeploy Postgres ou Redis

Normalmente não se redeploya.

Alterações devem ser feitas com cuidado e preferencialmente via configuração do EasyPanel.

## 15. Ordem de deploy

Quando houver mudança completa:

1. Confirmar commit revisado.
2. Configurar envs novas.
3. Redeploy API.
4. Verificar /health.
5. Verificar logs da API.
6. Redeploy Worker, se necessário.
7. Verificar logs do Worker.
8. Redeploy Web.
9. Testar fluxo pelo navegador.

Se houver migration, API deve ir antes da Web.

## 16. Healthcheck

A API deve manter endpoint:

    GET /health

Resposta esperada:

    { "ok": true, "service": "campanha360-api" }

Esse endpoint deve continuar funcionando em todas as fases.

## 17. Logs

Logs devem ser usados para diagnóstico.

Verificar logs quando:

- deploy falha;
- API não sobe;
- migration falha;
- Web não chama API;
- Worker não inicializa;
- webhook não chega;
- provider externo retorna erro.

Logs não devem expor segredos.

## 18. CORS

A API deve aceitar chamadas da Web.

WEB_PUBLIC_URL deve apontar para a URL pública da Web.

Se houver erro de CORS:

- confirmar WEB_PUBLIC_URL;
- confirmar URL da Web;
- confirmar redeploy da API;
- verificar se navegador chama API correta.

## 19. URL da API no frontend

A Web deve usar:

    NEXT_PUBLIC_API_URL

Esse valor deve apontar para a URL pública da API.

Exemplo:

    NEXT_PUBLIC_API_URL=https://campanha-360-ia-api.kxryyk.easypanel.host

A Web não deve chamar /api local se não houver proxy configurado.

## 20. Worker sem tráfego público

O Worker não precisa ser acessado pelo navegador.

Se EasyPanel exigir domínio ou porta:

- manter serviço rodando;
- não usar URL pública como endpoint de usuário;
- documentar que não deve receber tráfego;
- verificar apenas logs.

## 21. Backup

Antes de mudanças arriscadas:

- migration destrutiva;
- alteração de enum sensível;
- remoção de coluna;
- mudança em contatos;
- mudança em consentimento;
- mudança em mensagens;
- mudança em opt-out.

Fazer ou confirmar backup do banco.

No MVP, pelo menos evitar migrations destrutivas sem extrema necessidade.

## 22. Rollback

Rollback deve considerar:

- código;
- migration;
- dados alterados;
- envs.

Rollback de código é simples.

Rollback de banco pode ser difícil.

Por isso, migrations destrutivas devem ser evitadas.

## 23. Checklist antes de deploy

Confirmar:

- commit enviado;
- revisão aprovada;
- serviços afetados identificados;
- envs necessárias configuradas;
- migration revisada;
- API build passou;
- Web build passou;
- Worker build passou quando aplicável;
- não há segredo no repo.

## 24. Checklist depois de deploy

Validar:

- /health da API;
- login;
- fluxo principal alterado;
- fluxo anterior mais sensível;
- DevTools sem chamada errada;
- logs sem erro crítico;
- Worker ready quando aplicável.

## 25. Erros comuns

### Cannot POST /auth/register

Possíveis causas:

- API antiga em produção;
- Web chamando URL errada;
- NEXT_PUBLIC_API_URL ausente;
- rota não existe no build atual.

### CORS

Possíveis causas:

- WEB_PUBLIC_URL incorreta;
- API sem redeploy;
- Web em domínio diferente.

### Migration falhou

Possíveis causas:

- DATABASE_URL incorreta;
- Postgres inacessível;
- migration incompatível;
- schema divergente.

### Worker laranja no EasyPanel

Pode ser normal se o worker está pronto mas EasyPanel espera porta pública.

Validar pelos logs.

## 26. Documentação de deploy

Manter atualizado:

- docs/EASYPANEL-DEPLOY-INICIAL.md;
- .env.example;
- docs/blueprints/09-ESTRATEGIA-DEPLOY-EASYPANEL.md, se criado no repo;
- documentos de fase quando houver env nova.

Nunca documentar segredo real.

## 27. Critério de aceite operacional

Uma entrega está operacionalmente pronta quando:

- deploy foi feito;
- serviço sobe;
- healthcheck responde;
- fluxo principal funciona;
- logs não mostram erro crítico;
- envs estão corretas;
- migrations foram aplicadas;
- usuário consegue testar sem terminal.

## 28. Próximo blueprint

O próximo documento deve ser:

Blueprint 10 — Estratégia de Compliance, Auditoria e Segurança

Ele deve consolidar regras sobre opt-out, consentimento, auditoria, LGPD, cuidado eleitoral, dados sensíveis e limites operacionais.