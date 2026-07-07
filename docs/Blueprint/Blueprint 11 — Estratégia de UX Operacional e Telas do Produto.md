# Blueprint 11 — Estratégia de UX Operacional e Telas do Produto

## 1. Objetivo deste documento

Este blueprint define a estratégia de experiência do usuário e organização das telas do Campanha360 AI.

Ele existe para garantir que o painel cresça de forma operacional, clara e consistente, sem virar uma coleção confusa de páginas desconectadas.

O foco inicial não é marketing visual. O foco é uma ferramenta de trabalho para operação de campanha.

## 2. Princípio central

A interface deve ser operacional.

O usuário deve conseguir:

- entender em qual organização está;
- entender em qual campanha está;
- navegar entre módulos da campanha;
- executar tarefas sem depender de terminal;
- ver erros de forma clara;
- voltar para o fluxo anterior;
- operar contatos, canais, inbox e IA com segurança.

O painel deve priorizar clareza, rastreabilidade e eficiência.

## 3. Usuários principais

Perfis previstos:

### Dono da operação

Pessoa que cria organização e coordena a campanha.

Precisa:

- configurar campanha;
- cadastrar equipe;
- acompanhar operação;
- revisar canais;
- ver relatórios;
- controlar riscos.

### Gestor de campanha

Pessoa que organiza a execução diária.

Precisa:

- gerenciar contatos;
- acompanhar conversas;
- revisar tags;
- cuidar de segmentação;
- aprovar fluxos.

### Operador

Pessoa que responde conversas e atualiza contatos.

Precisa:

- ver inbox;
- responder manualmente;
- usar sugestões de IA;
- registrar informações;
- respeitar opt-out.

### Compliance ou jurídico

Pessoa que revisa riscos.

Precisa:

- ver audit logs;
- conferir consentimentos;
- revisar opt-outs;
- acompanhar uso de IA;
- validar regras eleitorais.

## 4. Estrutura de navegação

A navegação deve ter três níveis:

### Nível 1 — Organização

Define o tenant ativo.

Exemplo:

- Organização ativa: Campanha Municipal 2026.

### Nível 2 — Campanha

Define o contexto operacional.

Exemplo:

- Campanha: João Prefeito 2026.

### Nível 3 — Módulo

Define a tarefa.

Módulos:

- Visão geral;
- Candidato;
- Contatos;
- Canais;
- Inbox;
- Importações;
- Segmentos;
- Landing Pages;
- IA;
- Auditoria;
- Configurações.

## 5. Dashboard inicial

O dashboard inicial deve mostrar:

- organização ativa;
- campanhas da organização;
- botão para criar campanha;
- acesso rápido para campanhas recentes;
- próximos módulos planejados apenas enquanto ainda não existirem.

Com o crescimento do produto, o dashboard deve se tornar uma visão operacional.

Futuro dashboard pode mostrar:

- total de contatos;
- contatos com opt-out;
- conversas abertas;
- canais conectados;
- importações recentes;
- alertas de compliance;
- atividade recente.

## 6. Página da campanha

A página da campanha deve virar o centro operacional.

Deve mostrar:

- nome da campanha;
- ano;
- cargo;
- território;
- fase eleitoral;
- status;
- candidato;
- atalhos para módulos;
- indicadores principais.

Atalhos recomendados:

- editar campanha;
- candidato;
- contatos;
- canais;
- inbox;
- importações;
- landing pages;
- auditoria.

## 7. Contatos

A área de contatos deve permitir:

- listar contatos;
- criar contato;
- editar contato;
- ver canais do contato;
- ver consentimentos;
- registrar opt-out;
- ver tags futuramente;
- filtrar e buscar.

Prioridades de UI:

- busca por nome, telefone e e-mail;
- status visível;
- opt-out visível;
- consentimento visível;
- cidade e bairro visíveis;
- link rápido para conversa quando existir.

Não esconder opt-out em detalhe secundário.

## 8. Candidato

A área de candidato deve permitir configurar:

- nome;
- partido;
- cargo;
- bio;
- tom de voz;
- propostas principais;
- temas restritos.

Esses campos são importantes para IA.

A UI deve deixar claro que esses dados guiam sugestões futuras, mas sem transformar a tela em documentação longa.

## 9. Canais

A área de canais deve permitir:

- listar contas conectadas;
- criar canal;
- editar canal;
- ver provider;
- ver status;
- ver identificador externo;
- acessar logs básicos futuramente.

Não mostrar segredos.

Config sensível deve ficar fora da UI ou mascarada.

Estados úteis:

- PENDING;
- ACTIVE;
- ERROR;
- DISABLED.

## 10. Inbox

A Inbox deve ser operacional.

Layout recomendado:

- coluna esquerda com conversas;
- área central com mensagens;
- área direita opcional com dados do contato/campanha.

Na primeira versão, pode ser mais simples:

- lista de conversas;
- detalhe de conversa;
- envio manual.

A Inbox deve mostrar:

- contato;
- canal;
- última mensagem;
- status;
- opt-out;
- consentimento;
- mensagens inbound/outbound;
- campo de resposta;
- sugestão de IA futuramente.

## 11. IA na interface

IA deve aparecer como apoio, não como piloto automático.

Elementos recomendados:

- botão para gerar sugestão;
- card de sugestão;
- nível de risco;
- observações de compliance;
- botão copiar;
- botão usar como rascunho;
- botão descartar.

Evitar:

- botão “enviar automaticamente”;
- sugestão sem contexto;
- esconder risco;
- mostrar IA como decisão final.

## 12. Importações

A UI de importação deve seguir fluxo guiado.

Etapas:

1. Upload do arquivo.
2. Mapeamento de colunas.
3. Preview.
4. Confirmação.
5. Processamento.
6. Resultado.

A tela deve mostrar:

- linhas totais;
- válidas;
- inválidas;
- criadas;
- atualizadas;
- ignoradas;
- erros.

Importação não deve ser uma tela de upload cega.

## 13. Segmentos

Segmentos devem ser apresentados como filtros salvos.

A UI deve permitir futuramente:

- criar filtro;
- salvar como segmento;
- listar segmentos;
- abrir contatos do segmento;
- ver critérios usados.

Evitar tratar segmento como cópia fixa de contatos.

## 14. Landing Pages

A área de landing pages deve permitir:

- listar páginas;
- criar página;
- editar conteúdo básico;
- definir slug;
- definir texto de consentimento;
- publicar;
- arquivar;
- copiar link;
- ver QR Code;
- ver submissões.

A UI pública da landing page deve ser simples:

- título;
- texto curto;
- formulário;
- consentimento;
- mensagem de sucesso.

## 15. Auditoria

A tela de auditoria deve permitir futuramente:

- filtrar por campanha;
- filtrar por usuário;
- filtrar por entidade;
- filtrar por ação;
- ver data e hora;
- ver detalhes do evento.

Não precisa ser bonita no início. Precisa ser confiável.

## 16. Configurações

Configurações devem ser separadas por contexto.

### Organização

- nome;
- membros;
- papéis;
- configurações gerais.

### Campanha

- fase;
- status;
- candidato;
- canais;
- compliance;
- IA.

### Usuário

- perfil;
- sessão;
- preferências simples.

Evitar uma única página gigante de configurações.

## 17. Estados de tela

Toda tela operacional deve prever:

- carregando;
- vazio;
- erro;
- sucesso;
- salvando;
- sem permissão;
- sem dados;
- item não encontrado.

Mensagens devem ser claras.

Exemplos:

- “Nenhum contato cadastrado nesta campanha.”
- “Este contato possui opt-out registrado.”
- “Você não tem permissão para alterar este item.”
- “Não foi possível carregar os canais.”

## 18. Erros

Erros devem ser compreensíveis.

A UI deve evitar mostrar stack trace.

Mostrar:

- o que falhou;
- se o usuário pode tentar novamente;
- se precisa revisar dado;
- se precisa falar com administrador.

Erros técnicos podem ficar nos logs.

## 19. Confirmações

Ações sensíveis devem exigir confirmação.

Exemplos:

- registrar opt-out;
- arquivar campanha;
- arquivar landing page;
- excluir ou marcar contato como deleted;
- publicar landing page;
- enviar mensagem manual em canal sensível futuramente.

No MVP, confirmar pelo menos ações irreversíveis ou difíceis de desfazer.

## 20. Tabelas e listas

Listas devem ser escaneáveis.

Para contatos:

- nome;
- telefone;
- e-mail;
- cidade/bairro;
- status;
- opt-out;
- ações.

Para campanhas:

- nome;
- cargo;
- ano;
- fase;
- status;
- candidato;
- ações.

Para canais:

- nome;
- provider;
- status;
- identificação;
- ações.

Para conversas:

- contato;
- canal;
- última mensagem;
- status;
- horário;
- alerta.

## 21. Busca e filtros

Busca e filtros devem entrar progressivamente.

Prioridade:

1. Busca em contatos.
2. Filtro por status.
3. Filtro por opt-out.
4. Filtro por cidade/bairro.
5. Filtro por tag.
6. Filtro por consentimento.
7. Segmentos salvos.

Não criar motor complexo antes dos filtros básicos.

## 22. Responsividade

O painel deve funcionar em desktop primeiro.

Mas não deve quebrar no mobile.

Prioridades:

- formulários utilizáveis;
- listas legíveis;
- botões não sobrepostos;
- navegação simples;
- textos sem corte ruim.

Inbox avançado pode ter experiência melhor em desktop.

## 23. Visual

Direção visual:

- limpo;
- sóbrio;
- operacional;
- sem excesso de decoração;
- foco em leitura;
- cards simples;
- botões claros;
- estados bem definidos.

Evitar:

- landing page de marketing como primeira tela do app;
- gradientes decorativos sem função;
- excesso de cards aninhados;
- textos gigantes em área operacional;
- estética que prejudique densidade.

## 24. Navegação recomendada

URLs internas recomendadas:

- /dashboard
- /dashboard/campaigns
- /dashboard/campaigns/[id]
- /dashboard/campaigns/[id]/candidate
- /dashboard/campaigns/[id]/contacts
- /dashboard/campaigns/[id]/contacts/new
- /dashboard/campaigns/[id]/contacts/[contactId]
- /dashboard/campaigns/[id]/channels
- /dashboard/campaigns/[id]/inbox
- /dashboard/campaigns/[id]/imports
- /dashboard/campaigns/[id]/segments
- /dashboard/campaigns/[id]/landing-pages
- /dashboard/campaigns/[id]/audit

URLs públicas futuras:

- /p/[slug]

## 25. Componentes reutilizáveis

Criar progressivamente:

- DashboardShell;
- CampaignShell;
- OrganizationSelector;
- CampaignHeader;
- EmptyState;
- ErrorState;
- LoadingState;
- StatusBadge;
- ConsentBadge;
- OptOutBadge;
- ConfirmDialog;
- FormSection;
- PageHeader.

Não criar biblioteca de componentes complexa cedo demais.

## 26. UX de permissões

Quando usuário não puder executar ação:

- esconder botão se não for relevante;
- ou mostrar desabilitado com indicação;
- backend continua sendo fonte de verdade.

Para VIEWER:

- pode ver;
- não pode criar/editar;
- botões de escrita devem sumir ou ficar bloqueados.

## 27. UX de opt-out

Opt-out deve ser altamente visível.

Em contato:

- badge “Opt-out”;
- status bloqueado;
- aviso no topo.

Em inbox:

- bloquear campo de resposta;
- explicar motivo;
- não permitir envio.

Em IA:

- não gerar sugestão de envio;
- avisar que contato está bloqueado.

## 28. UX de consentimento

Consentimento deve aparecer onde houver canal.

Em contato:

- status por canal;
- origem;
- data quando possível.

Em envio:

- alerta se UNKNOWN;
- bloqueio se REVOKED ou OPT_OUT.

Em landing page:

- checkbox claro;
- texto aceito visível.

## 29. Critério de aceite de UX

Uma tela operacional está aceitável quando:

- usuário entende onde está;
- consegue voltar;
- sabe o que fazer;
- vê erro quando algo falha;
- não perde dados facilmente;
- não consegue executar ação proibida pela UI;
- backend também bloqueia ação proibida;
- funciona sem conhecimento técnico.

## 30. O que não fazer cedo demais

Evitar:

- redesign visual grande;
- dashboard cheio de gráficos falsos;
- editor visual complexo;
- componentes genéricos demais;
- permissões visuais sem backend;
- inbox sofisticado antes do básico;
- automações escondidas;
- páginas de marketing no lugar do app.

## 31. Próximo blueprint

O próximo documento deve ser:

Blueprint 12 — Estratégia de Testes, Qualidade e Evolução Técnica

Ele deve definir quais testes usar, quais fluxos validar manualmente, como evitar regressões e como manter o projeto saudável conforme os épicos avançam.