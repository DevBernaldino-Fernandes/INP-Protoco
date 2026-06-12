# Guia do Desenvolvedor: Evolução e Extensões do INP Protocol

Este guia documenta detalhadamente as novas funcionalidades adicionadas ao **Intent Network Protocol (INP)** para torná-lo pronto para o mercado corporativo. Aqui, explicamos passo a passo como o sistema foi estendido, como configurar as melhorias e como utilizá-las na prática.

---

## Índice
1. [Validação de Contratos (JSON Schema)](#1-validação-de-contratos-json-schema)
2. [Otimização de Performance (Caching de Registro)](#2-otimização-de-performance-caching-de-registro)
3. [Segurança e Controle de Acesso (RBAC)](#3-segurança-e-controle-de-acesso-rbac)
4. [Mecanismo de IA/LLM para Parsing de Linguagem Natural](#4-mecanismo-de-iallm-para-parsing-de-linguagem-natural)
5. [Endpoints de Auditoria (Dashboard API)](#5-endpoints-de-auditoria-dashboard-api)
6. [Exemplo Prático Completo de Integração](#6-exemplo-prático-completo-de-integração)

---

## 1. Validação de Contratos (JSON Schema)

### O Problema
Anteriormente, o payload enviado ao microsserviço era um JSON genérico (`context`). Se o cliente enviasse dados ausentes ou com tipos errados, a falha só seria descoberta após a chamada HTTP chegar ao microsserviço de destino.

### A Solução
Adicionamos a biblioteca `ajv` ao projeto. Agora, as capacidades registradas no catálogo de serviços podem definir um `inputSchema` (um JSON Schema padrão). O motor de execução valida o payload **antes** de fazer a requisição HTTP.

### O Código ([src/core/execution-engine.ts](file:///C:/inp_protocol/src/core/execution-engine.ts))
No método `executeAction`, a validação do contrato é feita da seguinte forma:
```typescript
// Instanciação global do AJV com reporte de múltiplos erros
import Ajv from 'ajv';
const ajv = new Ajv({ allErrors: true });

// ... dentro do executeAction:
const schema = match.capability.inputSchema;
if (schema) {
  const validate = ajv.compile(schema);
  const valid = validate(context);
  if (!valid) {
    const errorsText = ajv.errorsText(validate.errors);
    throw new Error(`Contract Violation: Context payload does not match schema for capability "${key}". Details: ${errorsText}`);
  }
}
```

---

## 2. Otimização de Performance (Caching de Registro)

### O Problema
Sempre que uma intenção era executada, o orquestrador precisava ler a lista de microsserviços ativos do PostgreSQL para encontrar a melhor correspondência (matching). Isso adicionava latência de IO a cada transação.

### A Solução
Criamos um gerenciador de cache em memória ([src/core/registry-cache.ts](file:///C:/inp_protocol/src/core/registry-cache.ts)) com TTL de 30 segundos. Sempre que um microsserviço se registra ou sai da rede, o cache é invalidado.

### Como Funciona ([src/core/registry-cache.ts](file:///C:/inp_protocol/src/core/registry-cache.ts))
```typescript
class RegistryCacheManager {
  private ttl = 30000; // 30 segundos
  private servicesCache: { data: ServiceRegistration[]; expiresAt: number } | null = null;
  private matchesCache = new Map<string, { data: ServiceMatch[]; expiresAt: number }>();

  // Recuperação e persistência dos dados em memória cacheada
  getServices() { ... }
  setServices(services) { ... }
  invalidate() {
    this.servicesCache = null;
    this.matchesCache.clear();
  }
}
```
*Dica para Produção*: Para escalar horizontalmente o INP Server em vários servidores, basta substituir o objeto `Map` interno deste cache pelo cliente do **Redis** (`redis.get` / `redis.set`).

---

## 3. Segurança e Controle de Acesso (RBAC)

### O Problema
Qualquer cliente com acesso ao endpoint do orquestrador podia disparar fluxos que executavam capacidades críticas (como transações financeiras).

### A Solução
Adicionamos o campo `requiredPermissions` nas capacidades. O orquestrador valida se as permissões do usuário em trânsito (`securityContext.permissions`) contêm todas as permissões exigidas pela capacidade.

### O Código ([src/core/execution-engine.ts](file:///C:/inp_protocol/src/core/execution-engine.ts))
```typescript
const requiredPerms = match.capability.requiredPermissions;
if (requiredPerms && requiredPerms.length > 0) {
  const userPerms = this.securityContext?.permissions || [];
  const hasAll = requiredPerms.every(p => userPerms.includes(p));
  if (!hasAll) {
    throw new Error(`Security Violation: Insufficient permissions to execute capability "${key}". Required: [${requiredPerms.join(', ')}]. Provided: [${userPerms.join(', ')}]`);
  }
}
```

---

## 4. Mecanismo de IA/LLM para Parsing de Linguagem Natural

### O Problema
Heurísticas baseadas em expressões regulares não conseguem lidar com a linguagem natural fluida e flexível do dia a dia dos usuários.

### A Solução
Adicionamos suporte a chamada assíncrona de LLM ([src/core/intent-parser.ts](file:///C:/inp_protocol/src/core/intent-parser.ts#L215-L277)). Se a variável de ambiente `GEMINI_API_KEY` ou `OPENAI_API_KEY` estiver configurada no `.env`, o orquestrador realiza uma chamada à API para traduzir o texto em um objeto de intenção estruturado com tratamento nativo de falhas (fallback para regex local).

### Fluxo de Prompt Utilizado
Configuramos a IA com instruções estritas para extrair o contexto e mapear as etapas do fluxo (`SEQUENCE`, `PARALLEL`, `CONDITION`, `RETRY`).
```typescript
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
// O prompt instrui o modelo a retornar apenas JSON puro mapeado para as capacidades do sistema.
```

---

## 5. Endpoints de Auditoria (Dashboard API)

Para possibilitar o monitoramento visual do sistema por parte das empresas, implementamos rotas de observabilidade no servidor HTTP ([src/api/server.ts](file:///C:/inp_protocol/src/api/server.ts)):

1.  `GET /api/dashboard/stats`: Retorna contadores de microsserviços ativos, histórico de execuções completadas/falhas e cálculo de **latência média** de processamento de ponta a ponta.
2.  `GET /api/dashboard/executions`: Retorna os logs das últimas 20 execuções detalhadas (incluindo status de sub-passos, dados de input/output e stack de erros caso ocorram falhas).

---

## 6. Exemplo Prático Completo de Integração

### Passo A: Registrar o Microsserviço com Contratos e Permissões
Faça uma requisição `POST` para `http://localhost:3000/services/register` definindo o contrato de dados (`inputSchema`) e permissões requeridas (`requiredPermissions`):

```json
{
  "id": "secured-payment-service",
  "name": "Secure Payments Gateway",
  "capabilities": [
    {
      "verb": "EXECUTE",
      "target": "PAYMENT",
      "description": "Processa pagamentos seguros de cartões",
      "requiredPermissions": ["payments.write"],
      "inputSchema": {
        "type": "object",
        "properties": {
          "amount": { "type": "number", "minimum": 1 },
          "user_id": { "type": "string" },
          "card_token": { "type": "string" }
        },
        "required": ["amount", "user_id", "card_token"]
      }
    }
  ],
  "trustScore": 99,
  "securityLevel": "HIGH",
  "endpoint": "http://localhost:3001"
}
```

### Passo B: Executar a Intenção Enviando o Contexto de Segurança
Envie a intenção via `POST` para `http://localhost:3000/api/intent`. Repare que adicionamos o `securityContext` do usuário logado:

```json
{
  "text": "INTENT \"buy_item\" { CONTEXT { amount: 150, user_id: \"usr_77\", card_token: \"tok_456\" } REQUIRE { EXECUTE PAYMENT } FLOW { SEQUENCE { EXECUTE PAYMENT } } OUTPUT { FORMAT \"json\" } }",
  "type": "dsl",
  "securityContext": {
    "userId": "usr_77",
    "permissions": ["payments.write"]
  }
}
```

#### Se o payload estiver incorreto (ex: `amount: 0` ou sem `card_token`):
O motor rejeitará imediatamente retornando:
`"error": "Contract Violation: Context payload does not match schema for capability \"EXECUTE PAYMENT\". Details: data/amount must be >= 1"`

#### Se o usuário não possuir a permissão `payments.write`:
O motor rejeitará com:
`"error": "Security Violation: Insufficient permissions to execute capability \"EXECUTE PAYMENT\". Required: [payments.write]. Provided: []"`
