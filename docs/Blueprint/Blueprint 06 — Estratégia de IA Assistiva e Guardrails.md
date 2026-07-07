# Blueprint 06 — Estratégia de IA Assistiva e Guardrails

## 1. Objetivo deste documento

Este blueprint define como a Inteligência Artificial será utilizada no Campanha360 AI.

O objetivo da IA não é substituir operadores humanos.

O objetivo é aumentar a produtividade da equipe, melhorar a qualidade das interações e transformar dados em inteligência operacional.

Toda utilização da IA deve ser rastreável, auditável e reversível.

---

# 2. Princípio central

A IA nunca é dona da decisão.

Ela apenas:

- sugere;
- classifica;
- resume;
- recomenda;
- organiza.

Quem decide é o operador da campanha.

Mesmo quando existir automação no futuro, ela deverá ser configurável e possuir mecanismos claros de aprovação.

---

# 3. Papéis da IA

No Campanha360 AI a IA possui apenas cinco funções.

## Assistente

Ajuda o operador.

Exemplos:

- escrever mensagens;
- melhorar textos;
- resumir conversas;
- responder dúvidas.

---

## Analista

Interpreta dados.

Exemplos:

- sentimento;
- intenção;
- perfil;
- classificação;
- prioridade.

---

## Organizador

Organiza o CRM.

Exemplos:

- criar tags;
- sugerir segmentos;
- detectar duplicidade;
- resumir histórico.

---

## Estrategista

Ajuda na criação de campanhas.

Exemplos:

- sugerir cronogramas;
- sugerir jornadas;
- sugerir públicos;
- sugerir canais.

---

## Copiloto

Auxilia operadores durante atendimentos.

Nunca assume o controle.

---

# 4. O que a IA NÃO deve fazer

Enquanto não existir um blueprint específico autorizando.

A IA não deve:

- enviar mensagens automaticamente;
- disparar campanhas;
- remover contatos;
- alterar consentimento;
- ignorar opt-out;
- apagar histórico;
- criar campanhas sozinha;
- alterar configurações da campanha;
- modificar dados críticos.

---

# 5. Fontes de contexto

Toda resposta deve ser baseada em contexto.

A IA poderá utilizar apenas informações autorizadas.

## Contexto da campanha

- candidato;
- cargo;
- partido;
- propostas;
- tom de voz;
- bandeiras;
- temas proibidos;
- fase eleitoral.

---

## Contexto do contato

- nome;
- cidade;
- bairro;
- tags;
- score;
- perfil político;
- jornada;
- histórico.

---

## Contexto da conversa

- últimas mensagens;
- resumo;
- sentimento;
- intenção;
- canal.

---

## Contexto institucional

Documentos internos.

FAQs.

Materiais aprovados.

Propostas.

Programas.

Agenda.

---

# 6. Hierarquia do contexto

Quando houver conflito.

A prioridade é:

1. Regras de Compliance.
2. Configuração da Campanha.
3. Dados do Contato.
4. Histórico da Conversa.
5. Conhecimento Geral da IA.

A IA nunca deve contrariar níveis superiores.

---

# 7. Tipos de sugestões

A IA poderá gerar:

## Resposta

Texto para responder um eleitor.

---

## Resumo

Resumo de conversa.

---

## Classificação

Exemplo

- dúvida;
- reclamação;
- elogio;
- convite;
- imprensa;
- liderança;
- voluntário.

---

## Sentimento

Exemplo

- positivo;
- neutro;
- negativo;
- agressivo;
- indeciso.

---

## Perfil

Exemplo

- apoiador;
- simpatizante;
- neutro;
- oposição.

---

## Prioridade

Exemplo

- baixa;
- média;
- alta;
- urgente.

---

## Tags

Sugestão automática.

Nunca aplicação automática.

---

## Jornada

Sugestão de próximo passo.

---

# 8. Score de confiança

Toda classificação feita pela IA deve possuir confidence.

Exemplo

0.00

até

1.00

Nunca assumir classificação absoluta.

---

# 9. Aprovação humana

Algumas sugestões exigem confirmação.

Exemplos:

- envio de mensagem;
- criação de tag;
- alteração de perfil;
- mudança de jornada;
- alteração de score.

Outras podem ser automáticas futuramente.

---

# 10. Guardrails

Toda execução deve respeitar:

- opt-out;
- consentimento;
- compliance;
- temas proibidos;
- fase eleitoral;
- limites configurados.

Caso exista conflito.

A IA deve recusar.

---

# 11. Temas proibidos

Cada campanha poderá cadastrar.

Exemplos

- fake news;
- ataques pessoais;
- assuntos jurídicos;
- promessas proibidas;
- pesquisas eleitorais.

Sempre que detectar.

A IA deve:

- avisar;
- explicar;
- sugerir alternativa.

---

# 12. Fase eleitoral

A IA deve conhecer:

- pré-campanha;
- campanha;
- segundo turno;
- encerramento.

Determinadas sugestões podem mudar conforme a fase.

---

# 13. Base de conhecimento

A IA utilizará futuramente.

- documentos;
- PDFs;
- propostas;
- FAQ;
- leis;
- materiais internos.

Nunca depender exclusivamente do conhecimento do modelo.

---

# 14. Memória

A IA não deve possuir memória global.

Ela deve trabalhar com memória contextual.

Exemplo.

Durante uma conversa.

Ela conhece:

- histórico daquela conversa;
- histórico daquele contato;
- histórico daquela campanha.

Não deve misturar informações entre organizações.

---

# 15. Multi-tenancy

Nunca utilizar dados de outra organização.

Mesmo que o operador possua acesso em ambas.

Cada execução deve considerar apenas:

organizationId

campaignId

---

# 16. Auditoria

Toda execução importante deve registrar:

- prompt utilizado;
- contexto utilizado;
- modelo;
- data;
- usuário;
- resposta;
- decisão do operador.

---

# 17. Modelos

A arquitetura deve permitir trocar modelos.

Exemplos.

- GPT
- Claude
- Gemini
- Llama
- DeepSeek

A IA nunca deve depender de um modelo específico.

Criar adapters também para modelos.

---

# 18. AI Adapter

Assim como canais.

Modelos devem ficar atrás de adapters.

Exemplo.

OpenAIAdapter

ClaudeAdapter

GeminiAdapter

LlamaAdapter

Todos retornam o mesmo formato interno.

---

# 19. AI Context Builder

Criar futuramente um componente responsável por montar contexto.

Ele será responsável por juntar.

- campanha;
- candidato;
- contato;
- conversa;
- documentos;
- configurações.

A IA nunca deve montar contexto diretamente.

---

# 20. AI Prompt Builder

Outro componente.

Responsável por montar prompts.

Separando:

- system;
- developer;
- user;
- contexto.

Assim será possível trocar modelos facilmente.

---

# 21. AI Guard

Antes de qualquer resposta.

Executar verificações.

Exemplos.

- opt-out;
- compliance;
- fase eleitoral;
- tema proibido;
- limite operacional.

Se reprovar.

Nem chamar o modelo.

---

# 22. AI Execution Log

Cada execução deve gerar registro.

Campos sugeridos.

- organizationId;
- campaignId;
- contactId;
- conversationId;
- provider;
- model;
- tokens;
- custo;
- duração;
- resultado;
- erro.

---

# 23. Estratégia futura

A evolução da IA deve seguir esta ordem.

Etapa 1

Resumo.

Etapa 2

Sugestão de resposta.

Etapa 3

Classificação.

Etapa 4

Tags.

Etapa 5

Score.

Etapa 6

Jornadas.

Etapa 7

Planejamento estratégico.

Etapa 8

Automações supervisionadas.

Nunca inverter essa ordem.

---

# 24. Critérios de aceite

Uma funcionalidade de IA só será considerada pronta quando:

- respeitar tenancy;
- respeitar opt-out;
- respeitar compliance;
- possuir audit log;
- possuir contexto controlado;
- utilizar adapter;
- permitir troca de modelo;
- permitir revisão humana.

---

# 25. Conclusão

A IA do Campanha360 AI não existe para substituir pessoas.

Ela existe para transformar um grande volume de dados em decisões melhores.

O operador continua responsável pelas ações.

A IA fornece velocidade.

A arquitetura fornece segurança.

O domínio fornece contexto.

A combinação dos três cria o verdadeiro diferencial competitivo do produto.

---

# 26. Próximo Blueprint

O próximo documento será:

**Blueprint 07 — CRM Inteligente e Jornada do Eleitor**

Esse blueprint definirá o maior diferencial do Campanha360 AI: transformar um simples cadastro em um modelo vivo de relacionamento, score, evolução e inteligência sobre cada eleitor.