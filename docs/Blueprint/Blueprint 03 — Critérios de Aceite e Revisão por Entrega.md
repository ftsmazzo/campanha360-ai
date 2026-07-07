# Blueprint 03 — Critérios de Aceite e Revisão por Entrega

## 1. Objetivo deste documento

Este blueprint define como cada entrega do Cursor deve ser aceita, recusada ou devolvida para ajuste.

Ele existe para evitar que uma subetapa seja considerada concluída apenas porque o código foi escrito ou o build passou.

No Campanha360 AI, uma entrega só deve avançar quando cumprir critérios mínimos de escopo, segurança, tenancy, testes, documentação e deploy.

## 2. Regra principal

Toda entrega do Cursor deve passar por revisão antes de deploy ou antes da próxima subetapa.

A revisão deve responder a cinco perguntas:

- O Cursor implementou somente o escopo autorizado?
- O que já funcionava continua preservado?
- A implementação respeita organização, campanha e permissões?
- Não houve exposição de segredos ou dados sensíveis?
- O usuário consegue testar de forma objetiva?

Se qualquer resposta for negativa, a entrega deve voltar para ajuste.

## 3. Estados possíveis de uma entrega

Uma entrega pode receber um destes estados:

- Aprovada para deploy.
- Aprovada com observação.
- Requer ajuste antes de deploy.
- Reprovada por quebra de escopo.
- Reprovada por risco de segurança.
- Reprovada por falha de build ou teste.

## 4. Aprovada para deploy

Use quando:

- o escopo foi cumprido;
- nada fora do escopo foi implementado;
- typecheck passou;
- build passou;
- migrations estão corretas ou não eram necessárias;
- não há segredo exposto;
- tenancy foi respeitada;
- há instruções claras de teste;
- o commit foi enviado para origin/main.

Resultado esperado:

- usuário pode redeployar os serviços necessários no EasyPanel;
- depois do teste manual, a subetapa pode ser considerada concluída.

## 5. Aprovada com observação

Use quando:

- a entrega está funcional;
- há pequenos pontos de melhoria;
- os pontos não bloqueiam deploy;
- não há risco de segurança;
- não há risco de dados;
- não há quebra de fluxo principal.

Exemplos:

- texto de UI pode melhorar depois;
- estado vazio ainda simples;
- falta filtro avançado fora do escopo;
- audit log existe mas ainda não tem tela.

Resultado esperado:

- deploy pode seguir;
- observações viram pendência futura.

## 6. Requer ajuste antes de deploy

Use quando há erro corrigível, mas a direção está correta.

Exemplos:

- validação incompleta;
- rota funcionando, mas sem checagem adequada de permissão;
- UI chama URL errada;
- resposta final do Cursor não explica como testar;
- arquivo de documentação ficou incompleto;
- migration não foi criada quando deveria;
- campo sensível foi salvo em local inadequado, sem exposição pública ainda.

Resultado esperado:

- Cursor recebe prompt de ajuste pequeno;
- não avança para nova subetapa;
- não faz deploy antes da correção.

## 7. Reprovada por quebra de escopo

Use quando o Cursor implementou coisas que não foram autorizadas.

Exemplos:

- implementou IA antes da hora;
- implementou webhook junto com CRUD simples;
- adicionou envio automático sem autorização;
- mudou stack;
- criou serviço novo desnecessário;
- reestruturou pastas sem necessidade;
- alterou blueprints sem pedido.

Resultado esperado:

- parar avanço;
- pedir correção ou reversão parcial;
- revisar impacto antes de qualquer deploy.

## 8. Reprovada por risco de segurança

Use quando a entrega cria risco direto.

Exemplos:

- segredo real commitado;
- token exposto em documento;
- endpoint sem autenticação indevida;
- dados de outra organização acessíveis;
- opt-out ignorado;
- envio de mensagem sem verificação;
- webhook confiando cegamente no payload;
- dados reais de eleitor em arquivo versionado.

Resultado esperado:

- não fazer deploy;
- corrigir imediatamente;
- se segredo foi exposto, rotacionar credenciais;
- revisar histórico quando necessário.

## 9. Reprovada por falha de build ou teste

Use quando:

- npm run typecheck falhou;
- npm run build falhou;
- Prisma generate falhou quando necessário;
- migration falhou por erro real;
- app não sobe;
- Dockerfile quebra build;
- endpoint principal deixa de responder.

Resultado esperado:

- Cursor corrige antes de qualquer avanço;
- resposta final deve trazer novo commit e testes passando.

## 10. Checklist geral de revisão

Para cada entrega, revisar:

- escopo autorizado;
- arquivos alterados;
- migrations;
- schema Prisma;
- controllers;
- services;
- guards/permissões;
- validações;
- audit log;
- UI;
- variáveis de ambiente;
- documentação;
- testes;
- commit;
- instruções de deploy;
- instruções de teste manual.

## 11. Checklist de escopo

Verificar:

- a subetapa pedida foi implementada;
- nenhuma subetapa futura foi antecipada;
- nenhum módulo fora do escopo foi criado sem necessidade;
- documentos foram atualizados somente quando solicitado ou necessário;
- blueprints não foram alterados sem autorização.

Pergunta de revisão:

A entrega ficou menor, igual ou maior do que deveria?

Se ficou maior, revisar com cuidado.

## 12. Checklist de tenancy

Verificar:

- entidades novas possuem organizationId quando aplicável;
- entidades ligadas a campanha possuem campaignId;
- listagens filtram por organização e campanha;
- detalhes validam acesso antes de retornar dados;
- updates validam acesso antes de alterar dados;
- leitura exige membership;
- escrita exige OWNER, ADMIN ou MANAGER;
- VIEWER não escreve.

Pergunta de revisão:

Um usuário de outra organização conseguiria ver ou alterar este dado?

A resposta deve ser não.

## 13. Checklist de segurança

Verificar:

- não há segredo real em código;
- não há segredo real em documentação;
- não há segredo real em .env.example;
- endpoints sensíveis usam JWT;
- webhook tem estratégia de validação quando aplicável;
- logs não expõem payloads sensíveis sem necessidade;
- dados reais de eleitor não foram versionados;
- opt-out não foi enfraquecido.

Pergunta de revisão:

Se este repositório for público, algo sensível aparece?

A resposta deve ser não.

## 14. Checklist de banco de dados

Verificar:

- schema Prisma está coerente;
- migration existe quando schema mudou;
- migration não apaga dados sem autorização;
- índices existem quando necessários;
- relações estão corretas;
- campos obrigatórios não quebram dados existentes;
- enums foram usados de forma coerente;
- migration_lock não foi alterado indevidamente.

Pergunta de revisão:

O deploy da API aplicaria essa mudança sem quebrar produção?

A resposta deve ser sim.

## 15. Checklist de API

Verificar:

- controller usa JwtAuthGuard quando necessário;
- DTOs validam entrada;
- service concentra regra de negócio;
- erros são claros;
- filtros por organização/campanha existem;
- audit log é criado para ações relevantes;
- endpoints preservam padrão REST interno;
- não há chamada direta a provider externo fora de adapter.

Pergunta de revisão:

A API protege o dado antes de retornar ou alterar?

A resposta deve ser sim.

## 16. Checklist de Web

Verificar:

- Web chama a API correta;
- fluxo de login continua funcionando;
- token é usado nas chamadas protegidas;
- estados de carregamento existem;
- erros são mostrados;
- usuário consegue navegar de volta;
- páginas novas ficam dentro da campanha quando aplicável;
- UI não depende de dado global inseguro;
- telas não mostram segredo ou config sensível.

Pergunta de revisão:

Um usuário consegue completar o fluxo sem saber detalhes técnicos?

A resposta deve ser sim.

## 17. Checklist de Worker

Quando a entrega envolver worker, verificar:

- fila está definida claramente;
- job é idempotente quando necessário;
- falhas são registradas;
- retry é seguro;
- worker não depende de rota pública;
- variáveis necessárias estão documentadas;
- não há execução duplicada perigosa.

Pergunta de revisão:

Se o job rodar duas vezes, ele causa dano?

A resposta ideal é não.

## 18. Checklist de integrações externas

Quando envolver Evolution ou outro provider, verificar:

- integração está isolada em adapter;
- secrets vêm de env;
- erros do provider são tratados;
- payload bruto é salvo quando for webhook;
- payload normalizado é salvo separadamente;
- provider não define regra de domínio;
- opt-out é checado antes de envio;
- logs ajudam diagnóstico.

Pergunta de revisão:

Trocar o provider no futuro exigiria mexer no domínio inteiro?

A resposta deve ser não.

## 19. Checklist de IA

Quando envolver IA, verificar:

- IA está em modo sugestão;
- sugestão não envia mensagem sozinha;
- contexto da campanha é usado;
- temas restritos são considerados;
- fase eleitoral é considerada;
- resposta pode ser revisada por humano;
- uso da IA é registrado;
- opt-out não é ignorado.

Pergunta de revisão:

A IA tomou alguma ação irreversível sem humano?

A resposta deve ser não.

## 20. Checklist de compliance

Verificar:

- consentimento está preservado;
- opt-out bloqueia envio;
- origem do contato é mantida;
- ações sensíveis geram audit log;
- campanha oficial e pré-campanha são diferenciadas quando necessário;
- mensagens futuras respeitam regras eleitorais configuradas.

Pergunta de revisão:

O sistema consegue explicar por que uma mensagem foi ou não foi enviada?

A resposta deve ser sim.

## 21. Checklist de documentação

Verificar:

- documento da fase ou épico foi atualizado;
- .env.example foi atualizado se houve env nova;
- EasyPanel foi atualizado se houve mudança de deploy;
- pendências foram registradas;
- fora de escopo ficou explícito;
- instruções de teste são práticas.

Pergunta de revisão:

Outra pessoa conseguiria continuar daqui sem reler toda a conversa?

A resposta deve ser sim.

## 22. Checklist de resposta final do Cursor

A resposta final precisa conter:

- Resultado;
- Arquivos alterados;
- Como testar;
- Testes executados;
- Pendencias;
- Commit.

Se faltar commit, a entrega não está completa.

Se faltar teste executado, a entrega precisa ser esclarecida.

Se faltar como testar, a entrega precisa voltar para complementação.

## 23. Critérios para deploy no EasyPanel

Antes de deploy, confirmar:

- commit revisado;
- serviço afetado identificado;
- API precisa redeploy quando backend mudou;
- Web precisa redeploy quando frontend mudou;
- Worker precisa redeploy quando jobs mudaram;
- envs novas foram configuradas;
- migrations serão aplicadas pela API quando necessário;
- healthcheck da API continua esperado.

## 24. Critérios para validação manual

Depois do deploy, validar:

- login;
- fluxo principal da subetapa;
- fluxo anterior mais sensível;
- erro esperado;
- permissão básica;
- /health da API;
- ausência de erro no navegador;
- ausência de erro crítico nos logs.

## 25. Modelo de parecer do Arquiteto

Ao revisar uma entrega, o Arquiteto deve responder com um destes formatos.

Para aprovação:

    Revisão aprovada.
    Pode fazer redeploy de [serviços].
    Teste estes fluxos: [lista curta].
    Se passar, a subetapa fica validada.

Para ajuste:

    Não implantar ainda.
    Achei estes pontos: [lista].
    Envie este prompt de correção ao Cursor: [prompt].
    Depois traga o novo commit para revisão.

Para reprovação:

    Parar avanço.
    A entrega quebrou [escopo/segurança/build].
    Primeiro corrija [ponto crítico].
    Não fazer deploy até nova revisão.

## 26. Conclusão

O objetivo da revisão não é atrasar o projeto.

O objetivo é impedir que o projeto avance com base frágil.

Cada entrega pequena, revisada e implantada com cuidado reduz risco nas etapas maiores: Evolution, Inbox, IA, importação, landing pages e multi-canais.