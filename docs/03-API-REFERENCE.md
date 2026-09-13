# Referência Completa da API REST & SSE - INP Protocol

O **INP Gateway** expõe uma interface HTTP REST e Server-Sent Events (SSE) para submissão de intenções, registro de serviços, telemetria em tempo real, auditoria e federação P2P.

- **Porta Padrão**: `3000` (configurável via variável `PORT`)
- **Content-Type**: `application/json`
- **Cabeçalhos Globais**:
  - `X-Correlation-ID`: Identificador de rastreamento distribuído (propagado caso fornecido, ou gerado automaticamente em formato UUID v4).
  - `X-Registration-Token`: Token de autorização para registro de serviços (obrigatório se `INP_REGISTRATION_SECRET` estiver configurado).

---

## 1. Tabela Resumo dos Endpoints

| Método | Caminho | Autenticação | Descrição |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Pública | Verificação de disponibilidade do Gateway |
| `GET` | `/api/db-status` | Pública | Status da conexão com o banco PostgreSQL |
| `GET` | `/api/telemetry` | Pública (SSE) | Stream em tempo real de eventos do orquestrador |
| `POST` | `/api/intent` | Rate-Limited | Submissão de intenção síncrona ou assíncrona |
| `POST` | `/services/register` | Token / Rate-Limited | Cadastro de novo microsserviço no catálogo |
| `POST` | `/services/heartbeat/:serviceId` | Pública | Atualização do batimento cardíaco do serviço |
| `GET` | `/services` | Pública | Listagem de serviços ativos no catálogo |
| `GET` | `/api/services/all` | Pública | Listagem detalhada com métricas de telemetria |
| `POST` | `/api/services/:id/toggle-active` | Pública | Ativação/desativação simulada de serviço |
| `POST` | `/api/chaos` | Pública | Injeção de falhas (Chaos Engineering) |
| `GET` | `/api/dashboard/stats` | Pública | Estatísticas consolidadas de execuções |
| `GET` | `/api/dashboard/executions` | Pública | Listagem das 20 execuções mais recentes |
| `GET` | `/api/export/postman` | Pública | Download da Postman Collection oficial |
| `GET` | `/api/export/sdk` | Pública | Download do SDK cliente Node.js gerado |
| `POST` | `/api/peers/register` | Aberta (P2P) | Registro de nó federado P2P |
| `POST` | `/api/peers/execute` | Aberta (P2P) | Execução remota de sub-intenção federada |

---

## 2. Detalhamento dos Endpoints

### `POST /api/intent` - Processar Intenção
Ponto de entrada primário para clientes submeterem intenções ao protocolo.

#### Cabeçalhos:
- `Content-Type: application/json`
- `X-Correlation-ID: <uuid>` *(Opcional)*

#### Payload de Requisição (Síncrono):
```json
{
  "text": "INTENT \"quick_buy\" { CONTEXT { amount: 100, user_id: \"usr_1\", card_token: \"tok_abc\" } REQUIRE { EXECUTE PAYMENT } FLOW { SEQUENCE { EXECUTE PAYMENT } } OUTPUT { FORMAT \"json\" } }",
  "type": "dsl",
  "securityContext": {
    "userId": "usr_1",
    "permissions": ["payments.write"],
    "roles": ["customer"]
  }
}
```

#### Payload de Requisição (Linguagem Natural):
```json
{
  "text": "Quero pagar 150 dólares para o usuário usr_22 com o cartão tok_secure123",
  "type": "natural",
  "securityContext": {
    "userId": "usr_22",
    "permissions": ["payments.write"]
  }
}
```

#### Payload de Requisição (Assíncrono via Fila Outbox):
Adicione `"async": true` no corpo da requisição.
```json
{
  "text": "INTENT \"async_buy\" { ... }",
  "type": "dsl",
  "async": true
}
```

#### Resposta de Sucesso (Síncrono - `200 OK`):
```json
{
  "success": true,
  "result": {
    "status": "COMPLETED",
    "execution_id": "d1c01e6a-2f47-49e2-bb4e-76e3d231d683",
    "duration_ms": 42,
    "output": {
      "transactionId": "txn_1741190000",
      "status": "approved"
    },
    "steps": [
      {
        "action": "EXECUTE PAYMENT",
        "status": "COMPLETED",
        "duration_ms": 38,
        "output": { "transactionId": "txn_1741190000", "status": "approved" }
      }
    ]
  }
}
```

#### Resposta de Sucesso (Assíncrono - `200 OK`):
```json
{
  "success": true,
  "result": {
    "status": "PENDING",
    "execution_id": "d1c01e6a-2f47-49e2-bb4e-76e3d231d683",
    "message": "Intent enqueued for asynchronous execution"
  }
}
```

---

### `POST /services/register` - Registrar Microsserviço
Registra um microsserviço provedor de capacidades no catálogo do INP.

#### Cabeçalhos:
- `Content-Type: application/json`
- `X-Registration-Token: <token>` *(Necessário se configurado)*

#### Payload de Requisição:
```json
{
  "id": "payment-gateway-service",
  "name": "Global Payment Service",
  "description": "Processes credit card charges and refunds",
  "capabilities": [
    {
      "verb": "EXECUTE",
      "target": "PAYMENT",
      "description": "Process primary credit card charge",
      "requiredPermissions": ["payments.write"],
      "compensateCapability": "REFUND PAYMENT",
      "inputSchema": {
        "type": "object",
        "properties": {
          "amount": { "type": "number", "minimum": 1.0 },
          "user_id": { "type": "string" },
          "card_token": { "type": "string" }
        },
        "required": ["amount", "user_id", "card_token"]
      }
    },
    {
      "verb": "REFUND",
      "target": "PAYMENT",
      "description": "Rollback refund for failed transactions",
      "requiredPermissions": ["payments.refund"]
    }
  ],
  "trustScore": 95,
  "securityLevel": "HIGH",
  "endpoint": "http://localhost:3001"
}
```

#### Resposta:
```json
{
  "success": true,
  "message": "Service registered"
}
```

---

### `GET /api/telemetry` - Stream de Telemetria (SSE)
Estabelece conexão unidirecional contínua Server-Sent Events para envio de telemetria em tempo real para painéis de monitoramento.

#### Eventos Transmitidos:
- `connection_established`: Confirmação da subscrição SSE.
- `ping`: Keep-alive a cada 15 segundos.
- `EXECUTION_STARTED`: Notifica o início de um novo fluxo.
- `STEP_STARTED`: Notifica a entrada em uma etapa específica.
- `SERVICE_RESOLVED`: Notifica qual microsserviço foi selecionado para atender à ação.
- `STEP_COMPLETED` / `STEP_FAILED`: Desfecho da etapa.
- `SAGA_ROLLBACK_STARTED` / `SAGA_COMPENSATION_STEP` / `SAGA_ROLLBACK_COMPLETED`: Auditoria de transações Saga.
- `SELF_HEAL_ATTEMPTED`: Notifica quando a IA realizou autocura de um payload.
- `SERVICE_HEALTH_CHANGED`: Mudança de status de degradação do serviço.

---

### `GET /api/dashboard/stats` - Estatísticas de Auditoria
Retorna métricas consolidadas agregadas diretamente do banco PostgreSQL:
```json
{
  "success": true,
  "stats": {
    "activeServices": 3,
    "totalExecutions": 142,
    "failedExecutions": 12,
    "completedExecutions": 130,
    "avgDurationMs": 35
  }
}
```

---

### `POST /api/peers/register` - Registro de Nós Federados P2P
Conecta gateways INP externos na malha de federação descentralizada.

#### Payload de Requisição:
```json
{
  "id": "peer-ny-gateway",
  "name": "New York Gateway Node",
  "endpoint": "https://ny.inp-network.io",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...\n-----END PUBLIC KEY-----",
  "capabilities": [
    {
      "verb": "EXECUTE",
      "target": "CROSS_BORDER_SETTLEMENT",
      "description": "High value settlement through NY banking gateway"
    }
  ]
}
```
