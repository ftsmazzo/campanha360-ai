# Blueprint 02 — Regras Operacionais para Cursor

## 1. Objetivo deste documento

Este blueprint define como o Cursor deve trabalhar no projeto Campanha360 AI.

Ele existe para evitar execução solta, decisões improvisadas, mudanças amplas demais, commits incompletos, falta de testes, rediscussão de arquitetura e implementação fora de escopo.

O Cursor deve ser usado como executor técnico, não como arquiteto principal do produto.

A arquitetura, ordem de execução e limites de escopo são definidos nos blueprints e nos prompts enviados pelo Arquiteto de Projeto.

## 2. Papel do Cursor

O Cursor deve:

- ler os documentos indicados no prompt;
- executar apenas a subetapa autorizada;
- preservar decisões arquiteturais já fechadas;
- implementar código de forma incremental;
- rodar os testes solicitados;
- fazer commit e push;
- responder no formato definido.

O Cursor não deve:

- rediscutir stack;
- consultar repositórios legados;
- implementar etapas futuras por iniciativa própria;
- trocar arquitetura sem bloqueio técnico real;
- criar serviços desnecessários;
- expor segredos em arquivos;
- deixar trabalho sem commit;
- responder com discussões longas de produto quando foi solicitado resultado técnico.

## 3. Hierarquia de documentos

O Cursor deve obedecer os documentos nesta ordem:

1. Prompt atual enviado pelo usuário.
2. docs/CURSOR-CONTEXTO.md.
3. Blueprints em docs/blueprints/.
4. Documento da subetapa ou fase em docs/fases/ ou docs/epicos/.
5. docs/ARQUITETURA.md.
6. README.md.

Se houver conflito entre documentos, o prompt atual prevalece, desde que não viole decisões estruturais já fechadas.

Se o conflito for relevante, o Cursor deve parar e relatar o conflito em vez de escolher sozinho.

## 4. Regra de escopo

O Cursor deve implementar somente o que está autorizado no prompt.

Se o prompt disser “execute apenas a subetapa 03.1”, o Cursor não deve implementar 03.2, 03.3 ou qualquer item futuro.

Toda resposta do Cursor deve deixar claro:

- o que foi implementado;
- o que ficou fora do escopo;
- quais pendências permanecem;
- qual commit foi enviado.

## 5. Regra de preservação

O Cursor deve preservar os fluxos já funcionando:

- /health;
- registro;
- login;
- /auth/me;
- organizações;
- organização ativa;
- campanhas;
- candidato;
- contatos;
- consentimento;
- opt-out;
- audit log;
- build da API;
- build da Web;
- build do Worker.

Qualquer mudança que possa quebrar um fluxo existente deve ser tratada como risco e mencionada na resposta final.

## 6. Regra de tenancy

Toda implementação deve respeitar multi-tenancy.

Entidades de domínio devem carregar organizationId.

Entidades ligadas a campanha devem carregar também campaignId.

Consultas e updates devem validar acesso por organização e campanha.

Leitura exige membership.

Escrita exige papel compatível, normalmente:

- OWNER;
- ADMIN;
- MANAGER.

VIEWER não deve escrever.

## 7. Regra de dados sensíveis

O Cursor nunca deve commitar:

- senhas reais;
- tokens reais;
- URLs com credenciais;
- chaves da Evolution;
- JWT secrets;
- dados reais de eleitores;
- dumps de banco;
- prints com dados sensíveis.

Arquivos como .env.example devem conter placeholders.

Exemplo correto:

    DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=disable
    JWT_SECRET=<JWT_SECRET>
    EVOLUTION_API_KEY=<EVOLUTION_API_KEY>

Exemplo proibido:

    DATABASE_URL=postgresql://usuario:senha-real@host:5432/banco
    JWT_SECRET=segredo-real

## 8. Regra de EasyPanel

O deploy padrão do projeto é EasyPanel.

O Cursor deve considerar:

- API como serviço web;
- Web como serviço web;
- Worker como serviço separado;
- PostgreSQL como serviço gerenciado no EasyPanel;
- Redis como serviço gerenciado no EasyPanel;
- migrations aplicadas no processo de deploy da API quando configurado.

O Cursor não deve orientar o usuário a resolver migrations ou dependências críticas com comandos manuais avulsos em produção, salvo diagnóstico excepcional.

Mudanças de ambiente devem ser documentadas para o EasyPanel.

## 9. Regra de migrations

Sempre que alterar prisma/schema.prisma, o Cursor deve:

- criar migration;
- garantir que a migration é versionada;
- rodar npm run prisma:generate;
- rodar npm run typecheck;
- rodar npm run build;
- explicar impacto da migration no deploy.

Se não houver migration nova, o Cursor deve dizer explicitamente por quê.

## 10. Regra de testes mínimos

Toda subetapa deve rodar no mínimo:

    npm run typecheck
    npm run build

Quando houver Prisma ou banco:

    npm run prisma:generate

Quando houver migration:

    npx prisma migrate deploy

Se algum teste não puder ser executado localmente por falta de Postgres, Redis ou variável de ambiente, o Cursor deve dizer isso claramente.

## 11. Regra de commit e push

Toda subetapa concluída deve terminar com commit e push.

O commit deve ser pequeno, focado e descrever a subetapa.

Exemplos bons:

    Implementa contas de canal do Epico 03.
    Corrige validacao de contatos da Fase 03.
    Adiciona inbox basico de conversas.

Exemplos ruins:

    updates
    fix
    varios ajustes
    final

## 12. Formato obrigatório de resposta

Ao final de cada execução, o Cursor deve responder exatamente neste formato:

    ## Resultado

    Resumo objetivo do que foi implementado.

    ## Arquivos alterados

    Lista dos arquivos principais alterados.

    ## Como testar

    Passos práticos para testar no ambiente local ou EasyPanel.

    ## Testes executados

    Lista dos comandos executados e resultado.

    ## Pendencias

    Pendências reais, limitações e itens fora de escopo.

    ## Commit

    SHA do commit enviado para origin/main.

## 13. Regra para documentação

Quando uma subetapa alterar comportamento importante, o Cursor deve atualizar a documentação correspondente.

Exemplos:

- docs/fases/...
- docs/epicos/...
- docs/EASYPANEL-DEPLOY-INICIAL.md
- .env.example
- blueprints, somente se solicitado.

O Cursor não deve alterar blueprints por iniciativa própria se o prompt não pedir.

## 14. Regra para integrações externas

Integrações externas devem ser implementadas em adapters.

A Evolution API deve ficar isolada em adapter próprio.

O código de domínio não deve depender diretamente de detalhes da Evolution.

Futuros canais também devem seguir a mesma lógica:

- WhatsApp Cloud API;
- Instagram;
- e-mail;
- SMS;
- Telegram.

## 15. Regra para IA

A IA inicial funciona em modo sugestão.

O Cursor não deve implementar envio automático por IA sem autorização explícita.

A IA pode futuramente:

- sugerir respostas;
- classificar contatos;
- resumir conversas;
- sugerir tags;
- apoiar compliance.

A IA não deve inicialmente:

- enviar mensagem sozinha;
- ignorar opt-out;
- fazer disparos em massa;
- pedir voto fora das regras configuradas;
- alterar dados críticos sem confirmação humana.

## 16. Regra de opt-out

Qualquer funcionalidade de mensagem deve respeitar opt-out.

Antes de enviar mensagem, o sistema deve verificar:

- status do contato;
- consentimento do canal;
- opt-out registrado;
- canal solicitado.

Se houver opt-out, o envio deve ser bloqueado.

## 17. Regra de audit log

Ações relevantes devem registrar audit log.

Exemplos:

- criação de campanha;
- edição de campanha;
- criação de candidato;
- edição de candidato;
- criação de contato;
- edição de contato;
- alteração de consentimento;
- opt-out;
- criação/edição de canal;
- envio manual de mensagem;
- uso/aprovação de sugestão de IA.

## 18. Regra de webhook

Webhooks devem:

- salvar payload bruto;
- normalizar dados;
- evitar duplicidade quando houver identificador externo;
- registrar falhas relevantes;
- nunca confiar cegamente no payload;
- validar token/assinatura quando disponível.

Webhooks não devem acionar IA ou envio automático sem subetapa específica autorizada.

## 19. Regra de UI

A UI deve ser funcional, simples e operacional.

Prioridades:

- clareza;
- fluxo direto;
- estados de erro;
- estados vazios;
- preservação de sessão;
- navegação consistente dentro da campanha.

Não priorizar estética avançada antes do fluxo operacional estar sólido.

## 20. Regra de parada

O Cursor deve parar e relatar antes de continuar se encontrar:

- conflito entre documentos;
- necessidade de mudar stack;
- risco de expor segredo;
- migration destrutiva;
- alteração que pode apagar dados;
- dependência externa sem configuração;
- falha de build;
- falha de typecheck;
- dúvida que muda arquitetura.

## 21. Regra de revisão pelo Arquiteto

Após cada commit do Cursor, o usuário deve trazer o resultado para revisão.

O Arquiteto revisa:

- escopo;
- segurança;
- tenancy;
- dados sensíveis;
- migrations;
- deploy;
- coerência com blueprint;
- próximos passos.

Só depois da revisão o usuário deve fazer deploy ou avançar para a próxima subetapa.

## 22. Conclusão

O Cursor deve operar como executor disciplinado.

O projeto deve evoluir por blocos pequenos, revisáveis e implantáveis.

A prioridade é construir uma base sólida, auditável e segura antes de adicionar automação, IA e múltiplos canais.