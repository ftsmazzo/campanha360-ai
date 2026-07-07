# Blueprint 07 — Estratégia de Importação, Segmentação e Enriquecimento

## 1. Objetivo deste documento

Este blueprint define como o Campanha360 AI deve importar, organizar, segmentar e enriquecer bases de eleitores.

Ele existe para garantir que a entrada de dados seja controlada, auditável e útil para operação, sem criar duplicidades desnecessárias, sem perder origem e sem ignorar consentimento.

Este documento não autoriza disparos ou automações em massa.

## 2. Princípio central

Importar contatos não é apenas gravar linhas no banco.

Toda entrada de base deve responder:

- de onde veio o contato;
- para qual organização pertence;
- para qual campanha pertence;
- qual canal está disponível;
- existe consentimento;
- existe opt-out;
- o contato já existe;
- quais dados são confiáveis;
- quais dados precisam de revisão.

A importação deve melhorar a base, não apenas aumentar volume.

## 3. Escopo inicial

O escopo inicial de importação deve ser simples e seguro.

Inclui:

- upload de CSV;
- leitura de colunas;
- mapeamento manual de campos;
- preview antes de importar;
- validação de telefone e e-mail;
- criação de contatos;
- atualização controlada de contatos existentes;
- registro de erros;
- execução via worker;
- resumo final da importação.

Não inclui inicialmente:

- disparo após importação;
- enriquecimento automático externo;
- compra de base;
- integração com bases públicas;
- deduplicação complexa com merge inteligente;
- automação por IA sem revisão.

## 4. Formatos suportados

Formato inicial recomendado:

- CSV.

Formatos futuros:

- XLSX;
- Google Sheets;
- integrações externas;
- formulários públicos;
- webhooks de captação;
- APIs de terceiros.

CSV deve ser suficiente para validar o fluxo de importação com segurança.

## 5. Campos principais de contato

Campos mínimos suportados na importação:

- name;
- phoneNumber;
- email;
- city;
- neighborhood;
- status;
- metadata;
- source;
- consentChannel;
- consentStatus;
- consentText;
- tags.

Campos obrigatórios:

- pelo menos phoneNumber ou email.

Campos internos definidos pelo sistema:

- organizationId;
- campaignId;
- createdAt;
- updatedAt.

## 6. Origem dos dados

Toda importação deve registrar origem.

Exemplos de origem:

- planilha manual;
- evento;
- formulário;
- apoiadores;
- reunião;
- lista interna;
- landing page;
- QR Code;
- importação legada.

A origem pode entrar em:

- metadata do contato;
- consent source;
- import job;
- audit log.

A origem é importante para compliance, auditoria e qualidade da base.

## 7. Consentimento na importação

Importação deve tratar consentimento com cuidado.

Cenários possíveis:

### Sem consentimento informado

O contato pode ser criado, mas consentimento deve ficar UNKNOWN.

### Consentimento informado

Se a planilha trouxer origem e texto de consentimento, pode criar Consent com status GRANTED.

### Opt-out informado

Se a planilha indicar opt-out, o contato deve ser criado ou atualizado como BLOCKED e Consent deve ficar OPT_OUT.

### Consentimento ambíguo

Se o valor for ambíguo, manter UNKNOWN e registrar observação.

## 8. Opt-out na importação

Opt-out deve prevalecer sobre qualquer outro dado.

Se uma linha indicar opt-out:

- criar OptOut;
- marcar contato como BLOCKED;
- consentimento do canal deve virar OPT_OUT;
- registrar origem;
- não permitir envio futuro.

Se o contato já existia com consentimento GRANTED, opt-out importado deve sobrescrever a permissão para aquele canal.

## 9. Deduplicação inicial

Deduplicação inicial deve ser simples e previsível.

Critérios iniciais:

- telefone normalizado dentro da mesma campanha;
- e-mail normalizado dentro da mesma campanha.

Ordem recomendada:

1. Se telefone normalizado existir, usar telefone como chave principal.
2. Se não houver telefone, usar e-mail.
3. Se ambos existirem e apontarem para contatos diferentes, marcar conflito.
4. Se não houver nenhum identificador, rejeitar linha.

## 10. Estratégia para duplicados

Quando contato já existir:

Opção padrão:

- atualizar campos vazios;
- preservar dados existentes preenchidos;
- adicionar metadata de importação;
- registrar no resumo como atualizado.

Não atualizar automaticamente:

- status BLOCKED;
- opt-out;
- consentimento OPT_OUT;
- dados sensíveis;
- campos preenchidos com informação conflitante.

Conflitos devem ser registrados para revisão.

## 11. ImportJob

Criar entidade futura ou usar estrutura equivalente para representar uma importação.

Campos recomendados:

- organizationId;
- campaignId;
- uploadedByUserId;
- fileName;
- fileSize;
- status;
- mapping;
- source;
- totalRows;
- processedRows;
- successRows;
- updatedRows;
- skippedRows;
- errorRows;
- startedAt;
- finishedAt;
- createdAt.

Status possíveis:

- DRAFT;
- PREVIEWED;
- QUEUED;
- PROCESSING;
- COMPLETED;
- COMPLETED_WITH_ERRORS;
- FAILED;
- CANCELED.

## 12. ImportRow

Criar entidade futura ou estrutura equivalente para rastrear linhas.

Campos recomendados:

- importJobId;
- rowNumber;
- rawData;
- normalizedData;
- status;
- contactId;
- errorMessage;
- warningMessage;
- createdAt.

Status possíveis:

- PENDING;
- VALID;
- INVALID;
- IMPORTED;
- UPDATED;
- SKIPPED;
- CONFLICT.

## 13. Preview antes da importação

Antes de importar, o sistema deve mostrar preview.

O preview deve informar:

- total de linhas;
- colunas encontradas;
- campos mapeados;
- amostra de linhas;
- erros detectados;
- duplicados prováveis;
- quantos serão criados;
- quantos serão atualizados;
- quantos serão ignorados.

Importação sem preview deve ser evitada.

## 14. Mapeamento de colunas

O usuário deve poder mapear colunas da planilha para campos internos.

Exemplos:

- Nome -> name;
- Celular -> phoneNumber;
- WhatsApp -> phoneNumber;
- Email -> email;
- Cidade -> city;
- Bairro -> neighborhood;
- Origem -> source;
- Consentimento -> consentStatus;
- Tags -> tags.

O sistema pode sugerir mapeamento por nomes comuns, mas deve permitir revisão.

## 15. Validação

Validar por linha:

- telefone, quando informado;
- e-mail, quando informado;
- pelo menos telefone ou e-mail;
- status válido;
- consentimento válido;
- tags em formato aceito;
- metadata em JSON quando aplicável.

Linhas inválidas não devem quebrar a importação inteira.

## 16. Normalização

Normalizar:

- telefone para dígitos;
- e-mail para lowercase;
- status para enum interno;
- consentimento para enum interno;
- tags com trim;
- cidade e bairro com trim.

Guardar dado original em rawData para auditoria de importação.

## 17. Tags

Tags servem para organizar contatos.

Uso inicial:

- criar tags manualmente;
- aplicar tags durante importação;
- aplicar tags em edição de contato;
- listar contatos por tag futuramente.

Regras:

- tag é única por campanha;
- tag deve ter nome limpo;
- importação pode criar tag automaticamente se autorizado;
- aplicação de tag deve ser rastreável.

## 18. Segmentos

Segmento é um filtro salvo, não uma cópia de contatos.

Exemplos de filtros:

- cidade;
- bairro;
- status;
- tags;
- consentimento;
- canal disponível;
- opt-out;
- classificação futura da IA.

Campos recomendados para Segment futuro:

- organizationId;
- campaignId;
- name;
- description;
- filters;
- createdByUserId;
- createdAt;
- updatedAt.

## 19. Enriquecimento

Enriquecimento é adicionar informação útil ao contato.

Tipos possíveis:

- manual;
- via importação;
- via formulário;
- via interação;
- via IA;
- via integração externa futura.

No MVP, priorizar enriquecimento manual e por importação.

IA pode sugerir enriquecimento, mas não deve alterar dados críticos sem confirmação.

## 20. Enriquecimento por IA

A IA pode futuramente sugerir:

- tags;
- intenção;
- nível de apoio;
- sentimento;
- interesse;
- resumo;
- pendência.

Regras:

- sugestão deve ser revisável;
- confiança deve ser registrada;
- operador deve aprovar alterações sensíveis;
- IA não deve inventar informação factual sobre o eleitor.

## 21. Worker

Importação deve rodar via worker.

Motivos:

- arquivos podem ser grandes;
- processamento pode demorar;
- erros devem ser isolados;
- retry pode ser necessário;
- API não deve travar.

Fluxo recomendado:

1. API recebe arquivo.
2. API cria ImportJob.
3. API salva arquivo ou conteúdo temporário.
4. Worker processa preview.
5. Usuário confirma importação.
6. Worker executa importação.
7. API exibe status e resultado.

## 22. Storage

No início, pode-se evitar storage complexo se o arquivo for pequeno.

Mas para produção, considerar:

- storage persistente;
- limpeza de arquivos antigos;
- limite de tamanho;
- proteção contra acesso indevido.

Não salvar arquivos sensíveis publicamente.

## 23. Segurança

Importação deve evitar:

- arquivos enormes sem limite;
- conteúdo malicioso;
- dados reais em logs;
- planilhas commitadas no repo;
- erro expondo dados de outra campanha;
- importação sem organizationId/campaignId;
- atualização de contato bloqueado sem regra explícita.

## 24. Audit log

Registrar audit log para:

- criação de import job;
- confirmação de importação;
- conclusão;
- falha;
- criação em massa de contatos, de forma resumida;
- alterações relevantes de consentimento;
- opt-outs importados.

Audit log não precisa registrar cada linha individual no MVP se ImportRow já armazenar detalhes.

## 25. UI de importação

Fluxo de UI recomendado:

1. Acessar campanha.
2. Entrar em Contatos.
3. Clicar em Importar CSV.
4. Selecionar arquivo.
5. Mapear colunas.
6. Ver preview.
7. Confirmar importação.
8. Acompanhar processamento.
9. Ver resumo.
10. Corrigir erros se necessário.

## 26. Relatório da importação

Ao final, mostrar:

- total de linhas;
- contatos criados;
- contatos atualizados;
- linhas ignoradas;
- erros;
- conflitos;
- tags criadas;
- opt-outs registrados.

Permitir baixar relatório de erros futuramente.

## 27. Filtros iniciais

Antes de segmentos avançados, implementar filtros simples em contatos:

- busca por nome, telefone ou e-mail;
- status;
- cidade;
- bairro;
- consentimento;
- opt-out;
- tag.

Esses filtros servem como base para segmentos.

## 28. O que não fazer cedo demais

Evitar no início:

- editor complexo de segmentos;
- automação de jornada;
- scoring avançado;
- compra ou scraping de bases;
- enriquecimento externo pago;
- merge automático complexo;
- disparo automático pós-importação;
- importação sem revisão.

## 29. Critério de aceite da importação

A importação inicial estará aceitável quando:

- usuário sobe CSV;
- mapeia colunas;
- vê preview;
- confirma;
- worker processa;
- contatos são criados ou atualizados;
- erros são registrados;
- duplicados básicos são tratados;
- origem é preservada;
- consentimento e opt-out são respeitados;
- resultado final é claro.

## 30. Ordem recomendada

Implementar este épico em subetapas:

### 30.1 Tags manuais

Antes da importação, criar tags básicas.

### 30.2 Filtros de contatos

Adicionar filtros simples na lista de contatos.

### 30.3 ImportJob e estrutura base

Criar entidades de importação e fluxo inicial.

### 30.4 Upload e preview CSV

Permitir upload, leitura e mapeamento.

### 30.5 Processamento via worker

Executar importação assíncrona.

### 30.6 Relatório de erros

Mostrar resultado e erros.

### 30.7 Segmentos salvos

Criar filtros salvos como segmentos.

## 31. Próximo blueprint

O próximo documento deve ser:

Blueprint 08 — Estratégia de Landing Pages e Captação Pública

Ele deve definir como páginas públicas, formulários, QR Codes e links rastreáveis entram no produto sem quebrar consentimento, origem e tenancy.