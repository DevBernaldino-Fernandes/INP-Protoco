# Guia de Operações, Deployment e Troubleshooting - INP Protocol

Este guia fornece orientações práticas para administradores de infraestrutura, operadores DevOps e engenheiros de confiabilidade (SRE) na implantação, sustentação e resolução de problemas do **Intent Network Protocol (INP)**.

---

## 1. Requisitos de Infraestrutura

- **Node.js**: Versão 18.x LTS ou 20.x LTS.
- **Banco de Dados**: PostgreSQL 14+ (recomendado 15+ para compatibilidade completa com índices JSONB e concorrência).
- **Cache / Barramento de Invalidação (Opcional para Cluster)**: Redis 7.0+ (com suporte a comandos pub/sub).
- **Recursos Mínimos (Instância de Gateway)**:
  - 1 vCPU, 1 GB de memória RAM para instâncias leves.
  - 2+ vCPUs, 4 GB de memória RAM para ambientes produtivos com tráfego elevado (> 1000 intents/minuto).

---

## 2. Matriz de Variáveis de Ambiente

| Variável | Padrão (Dev) | Obrigatória em Produção? | Descrição |
| :--- | :--- | :--- | :--- |
| `PORT` | `3000` | Não | Porta TCP em que o Express HTTP Gateway escuta. |
| `NODE_ENV` | `development` | **Sim** (`production`) | Modo de execução. Habilita validações rígidas de HTTPS e chaves. |
| `DB_HOST` | `localhost` | **Sim** | Hostname ou IP do PostgreSQL. |
| `DB_PORT` | `5432` | Não | Porta do banco PostgreSQL. |
| `DB_USER` | `inp` | **Sim** | Usuário de banco com permissões DDL e DML. |
| `DB_PASSWORD` | `inp123` | **Sim** | Senha do banco de dados (nunca usar o padrão em prod). |
| `DB_NAME` | `inp` | **Sim** | Nome do banco de dados do INP. |
| `INP_REGISTRATION_SECRET` | *(string padrão)* | **Sim** | Chave secreta compartilhada para autorizar registro de novos serviços. |
| `INP_ENCRYPTION_KEY_V1` | *(string padrão)* | **Sim** | Chave simétrica primária para o `CryptoEngine`. |
| `INP_ENCRYPTION_KEY_V2` | *(string padrão)* | **Sim** | Chave de rotação ativa para novos dados criptografados. |
| `INP_ACTIVE_KEY_VERSION` | `v2` | Não | Versão da chave utilizada para novas operações de cifra (`v1` ou `v2`). |
| `REDIS_URL` | *(vazia)* | Não | URL de conexão Redis (ex: `redis://:senha@redis-host:6379`). Habilita cache L2 e Pub/Sub. |
| `ALERT_WEBHOOK_URL` | *(vazia)* | Não | URL de Webhook HTTP POST para receber alertas de DLQ e falhas críticas. |
| `GEMINI_API_KEY` | *(vazia)* | Não | Chave da Google Cloud para parsing de linguagem natural via Gemini. |
| `OPENAI_API_KEY` | *(vazia)* | Não | Chave de API OpenAI como fallback para o parser e autocura. |
| `LOCK_EXPIRATION_MS` | `300000` (5 min) | Não | Tempo de expiração após o qual jobs travados em `PROCESSING` são recuperados pelo Lock Reaper. |

---

## 3. Implantação com Docker e Docker Compose

O repositório inclui arquivos prontos para execução em contêineres:

### Subindo o ambiente completo com microsserviços simulados:
```bash
docker-compose up -d --build
```

### Verificando a saúde dos contêineres:
```bash
docker-compose ps
```

### Visualizando os logs em tempo real:
```bash
docker-compose logs -f inp-server
```

---

## 4. Monitoramento e Gestão de Incidentes (DLQ & Alertas)

### A. Inspeção da Fila de Mensagens Mortas (Dead Letter Queue)
Quando uma transação Saga ou Job assíncrono falha definitivamente após 3 tentativas de compensação, o registro é isolado na tabela `dead_letter_queue`.

Para consultar ocorrências não resolvidas:
```sql
SELECT id, saga_id, execution_id, task_type, last_error, failed_at 
FROM dead_letter_queue 
ORDER BY failed_at DESC;
```

### B. Webhooks de Alerta Automático
Se `ALERT_WEBHOOK_URL` estiver definido no `.env`, o `AlertManager` dispara um payload no formato padrão:
```json
{
  "text": "⚠️ *[INP SYSTEM ALERT]*: Asynchronous Job Failed: FLOW_EXECUTION\n*Timestamp:* 2026-09-05T16:00:00.000Z\n*Details:* {\"jobId\": \"...\", \"error\": \"...\"}"
}
```
Esse formato é compatível nativamente com Webhooks do Slack, Discord, Microsoft Teams e PagerDuty.

---

## 5. Guia de Resolução de Problemas (Troubleshooting Runbook)

### Sintoma 1: `Circuit Breaker Open or Error`
*   **Causa**: O microsserviço de destino retornou taxa de erro superior a 50% ou latência acima de 5000ms.
*   **Ação**:
    1. Verifique a saúde do serviço remoto acessando seu endpoint de `/health`.
    2. Inspecione se há gargalos de concorrência ou banco de dados no microsserviço.
    3. O Circuit Breaker fecha automaticamente após o período de repouso se as próximas requisições forem bem-sucedidas.

### Sintoma 2: `Dependency Violation: Step depends on [X], which are not yet completed`
*   **Causa**: Um passo do bloco `DEPENDENCY` foi acionado antes que a ação referenciada tenha terminado com status `COMPLETED`.
*   **Ação**:
    1. Verifique a ordem dos passos dentro do bloco `FLOW`.
    2. Garanta que o passo dependente esteja em uma `SEQUENCE` posterior ao passo necessário.

### Sintoma 3: `CRITICAL CONFIGURATION ERROR: Cryptographic keys ... must be defined`
*   **Causa**: A variável `NODE_ENV=production` foi definida sem configurar `INP_ENCRYPTION_KEY_V1` e `INP_ENCRYPTION_KEY_V2`.
*   **Ação**: Configure as chaves de 256 bits nas variáveis de ambiente do contêiner antes de inicializar o servidor.

### Sintoma 4: Jobs parados em status `PROCESSING`
*   **Causa**: Um nó do Gateway sofreu crash inesperado ou out-of-memory (OOM) enquanto processava um job assíncrono.
*   **Ação**: O componente `Lock Reaper` do `QueueWorker` varre a cada 30 segundos os jobs cujo `locked_at` tenha ultrapassado `LOCK_EXPIRATION_MS` (5 minutos por padrão), revertendo-os para `PENDING` para reprocessamento seguro.
