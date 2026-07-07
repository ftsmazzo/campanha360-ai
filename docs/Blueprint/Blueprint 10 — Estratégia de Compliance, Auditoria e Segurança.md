# Blueprint 10 — Estratégia de Compliance, Auditoria e Segurança

## 1. Objetivo deste documento

Este blueprint define os princípios de compliance, auditoria, privacidade e segurança do Campanha360 AI.

Seu objetivo é garantir que todas as funcionalidades do sistema sejam desenvolvidas respeitando:

- rastreabilidade;
- responsabilidade;
- proteção de dados;
- segregação entre campanhas;
- consentimento;
- opt-out;
- segurança operacional;
- evolução futura para ambientes de produção de grande escala.

Este documento complementa os Blueprints anteriores e deve ser considerado obrigatório para qualquer nova funcionalidade.

---

# 2. Princípio Central

No Campanha360 AI nenhuma ação importante pode acontecer sem possibilidade de reconstruir posteriormente:

- quem fez;
- quando fez;
- onde fez;
- por que aconteceu;
- qual era o estado anterior;
- qual ficou sendo o novo estado.

Se não for possível responder essas perguntas, a funcionalidade ainda não está pronta.

---

# 3. Princípios de Segurança

O sistema será construído seguindo os princípios:

- Menor privilégio
- Defesa em profundidade
- Segregação por organização
- Segregação por campanha
- Auditoria por padrão
- Segurança por padrão
- Negação por padrão
- Opt-out prevalece sempre

---

# 4. Multi-Tenancy

A separação entre organizações é obrigatória.

Nunca poderá existir consulta sem filtro de organização quando o domínio exigir.

Toda entidade operacional deve pertencer a:

- organizationId

Quando fizer sentido operacional:

- campaignId

O sistema nunca poderá confiar apenas no frontend para validar acesso.

---

# 5. Privilégios

Papéis atuais:

- OWNER
- ADMIN
- MANAGER
- OPERATOR
- COMPLIANCE
- VIEWER

Regra geral

VIEWER

- apenas leitura

OPERATOR

- operação diária

MANAGER

- operação e configuração

ADMIN

- administração da organização

OWNER

- controle total

COMPLIANCE

- acesso a auditorias e ferramentas específicas

---

# 6. Autenticação

Toda autenticação deve utilizar JWT.

A API nunca deve confiar em:

- IDs enviados pelo frontend;
- organizationId enviado manualmente;
- campaignId sem validação.

Toda autorização deve partir do usuário autenticado.

---

# 7. Autorização

Toda rota protegida deve validar:

- usuário autenticado;
- membership;
- papel;
- organização;
- campanha.

Nunca validar apenas:

"usuário existe".

---

# 8. Auditoria

Toda alteração relevante deve gerar Audit Log.

Exemplos:

- login administrativo (futuro)
- criação de campanha
- edição de campanha
- criação de candidato
- alteração de candidato
- criação de contato
- alteração de contato
- importação
- criação de canal
- envio manual
- aprovação de IA
- alteração de permissões
- publicação de landing page

---

# 9. AuditLog

Campos mínimos recomendados

- id
- organizationId
- campaignId
- actorUserId
- entityType
- entityId
- action
- metadata
- createdAt

Nunca depender apenas de logs do servidor.

---

# 10. Dados Sensíveis

São considerados dados sensíveis para o sistema:

- telefone
- e-mail
- endereço
- IP
- tokens
- JWT
- credenciais
- consentimentos
- opt-outs
- documentos futuros
- dados de integração

Esses dados devem ser tratados com cuidado.

---

# 11. Segredos

Nunca armazenar no Git:

- JWT_SECRET
- DATABASE_URL real
- REDIS_URL real
- API Keys
- Tokens
- Senhas

Utilizar sempre:

.env.example

com placeholders.

---

# 12. Consentimento

Consentimento pertence ao contato.

Sempre por canal.

Exemplo.

WhatsApp

GRANTED

Email

UNKNOWN

SMS

OPT_OUT

Nunca assumir consentimento global automaticamente.

---

# 13. Opt-Out

Opt-out possui prioridade máxima.

Se houver opt-out:

- IA não sugere envio;
- API bloqueia envio;
- Worker bloqueia envio;
- Adapter não deve ser chamado.

Opt-out só pode ser removido por ação explícita autorizada.

---

# 14. LGPD

O sistema deve permitir futuramente:

- localizar dados do titular;
- exportar dados;
- anonimizar dados;
- excluir dados quando permitido;
- registrar origem do dado;
- registrar consentimento.

Mesmo que essas funcionalidades não existam inicialmente, a arquitetura deve permitir sua implementação.

---

# 15. Origem dos Dados

Todo dado importante deve possuir origem.

Exemplos.

- CSV
- Landing Page
- QR Code
- Evento
- WhatsApp
- Instagram
- Importação Manual

Origem melhora:

- auditoria
- qualidade da base
- rastreabilidade

---

# 16. Webhooks

Todo webhook deve:

- registrar payload bruto;
- validar origem quando possível;
- evitar duplicidade;
- registrar erro;
- nunca executar lógica crítica sem validação.

---

# 17. Logs

Logs devem ajudar diagnóstico.

Não devem expor:

- senha;
- JWT;
- telefone completo quando desnecessário;
- API Keys;
- payloads extremamente sensíveis.

---

# 18. Soft Delete

Sempre que possível.

Preferir:

status

deletedAt

ao invés de remoção física.

Exclusão definitiva deve ser exceção.

---

# 19. Hard Delete

Só utilizar quando:

- necessário tecnicamente;
- autorizado;
- sem impacto de auditoria;
- documentado.

---

# 20. Rate Limit

Toda rota pública deve prever proteção.

Exemplos:

- login;
- landing pages;
- webhooks;
- formulários.

---

# 21. Uploads

Arquivos enviados devem possuir:

- limite de tamanho;
- validação de tipo;
- validação de conteúdo;
- armazenamento seguro.

Nunca confiar apenas na extensão.

---

# 22. Integrações Externas

Toda integração deve ficar atrás de Adapter.

Nunca espalhar chamadas HTTP pelo domínio.

---

# 23. IA

A IA nunca pode:

- alterar banco diretamente;
- enviar mensagens;
- remover contatos;
- modificar permissões.

Sempre passar pelo domínio.

---

# 24. Worker

Worker deve respeitar exatamente as mesmas regras da API.

Não existe "atalho" por ser processamento interno.

---

# 25. Segurança do Frontend

Frontend nunca protege dados.

Frontend apenas melhora UX.

Toda proteção deve existir na API.

---

# 26. Configurações

Configurações da campanha devem ser versionáveis futuramente.

Mudanças relevantes devem gerar Audit Log.

---

# 27. Backup

Mudanças destrutivas devem considerar backup.

Especialmente:

- migrations
- contatos
- mensagens
- consentimentos

---

# 28. Recuperação

O projeto deve evoluir para permitir:

- restauração;
- rollback;
- reprocessamento de webhooks;
- reprocessamento de filas.

---

# 29. Checklist de Segurança

Antes de aprovar qualquer entrega verificar:

- tenancy
- autenticação
- autorização
- audit log
- opt-out
- consentimento
- secrets
- envs
- migrations
- logs
- adapters
- IA
- Worker

---

# 30. Critério de Aceite

Uma funcionalidade só poderá ser considerada pronta quando:

- respeitar organização;
- respeitar campanha;
- respeitar permissões;
- gerar auditoria quando necessário;
- respeitar opt-out;
- respeitar consentimento;
- não expor segredos;
- passar pelos testes definidos;
- possuir documentação.

---

# 31. Riscos Arquiteturais

Evitar:

- consultas sem organizationId;
- regras apenas no frontend;
- chamadas diretas para providers;
- IA alterando domínio;
- ausência de auditoria;
- migrations destrutivas;
- segredos em repositório;
- envio ignorando opt-out.

---

# 32. Próximo Blueprint

O próximo documento deve ser:

**Blueprint 11 — UX, Design System e Experiência Operacional**

Ele definirá toda a experiência visual do Campanha360 AI:

- layout;
- navegação;
- dashboards;
- componentes;
- tabelas;
- inbox;
- CRM;
- responsividade;
- identidade visual;
- padrões de interação.

Esse documento será importante para que todas as telas pareçam fazer parte do mesmo produto, mesmo sendo desenvolvidas em momentos diferentes.