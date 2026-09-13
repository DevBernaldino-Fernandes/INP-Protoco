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
7. [Transações Distribuídas com o Padrão Saga](#7-transações-distribuídas-com-o-padrão-saga)
8. [Fila Transacional Assíncrona (Outbox Pattern)](#8-fila-transacional-assíncrona-outbox-pattern)
9. [Concorrência Resiliente (SKIP LOCKED e NOWAIT)](#9-concorrência-resiliente-skip-locked-e-nowait)
10. [Políticas de Falha Avançadas (Rollback vs Forward Recovery)](#10-políticas-de-falha-avandadas-rollback-vs-forward-recovery)
11. [AST SafeEvaluator e Rotação de Chaves de Criptografia](#11-ast-safeevaluator-e-rotação-de-chaves-de-criptografia)
12. [Melhorias de Nível Master: Lock Reap Timeout, DLQ & Webhooks, Chaves de Idempotência](#12-melhorias-de-nível-master-lock-reap-timeout-dlq--webhooks-chaves-de-idempotência)

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

---

## 7. Transações Distribuídas com o Padrão Saga

### O Problema
Ao executar fluxos compostos por chamadas a múltiplos microsserviços independentes, se um dos passos posteriores falhar (ex: falha de estoque após cobrança efetuada), o sistema ficaria em um estado inconsistente se não houvesse reversão das ações anteriores concluídas com sucesso.

### A Solução
Implementamos o **Padrão Saga Orquestrado**. Cada capacidade cadastrada no catálogo pode agora declarar uma capacidade de compensação (`compensateCapability`). Quando uma ação com compensação é executada com sucesso, o motor registra a tarefa de reversão em uma pilha de compensações LIFO persistida na tabela `saga_states`. Se o fluxo falhar, o motor de execução percorre a pilha e executa as compensações correspondentes para restaurar o estado original dos microsserviços.

### O Código ([src/core/execution-engine.ts](file:///C:/inp_protocol/src/core/execution-engine.ts))
No método `executeAction`, se a capacidade declarar uma compensação, ela é registrada na pilha local e salva de forma transacional no banco:
```typescript
if (match.capability.compensateCapability) {
  this.compensationStack.push({
    capability: match.capability.compensateCapability,
    context: { ...context, ...result }
  });
  if (this.currentExecutionId) {
    await SagaStateRepository.update(
      { executionId: this.currentExecutionId },
      { compensationStack: this.compensationStack }
    );
  }
}
```

---

## 8. Fila Transacional Assíncrona (Outbox Pattern)

### O Problema
Processar intenções de forma puramente síncrona acopla o tempo de resposta do cliente ao tempo de execução de todo o grafo. Se a conexão HTTP cair ou se o servidor principal sofrer uma queda durante o fluxo, o progresso da orquestração seria perdido, impossibilitando garantias de consistência eventual.

### A Solução
Implementamos a fila transacional baseada em banco (**Transactional Outbox Pattern**). Ao enviar uma requisição com `"async": true`, o payload da intenção é gravado na tabela `queue_jobs` como um Job de execução pendente. O gateway responde imediatamente ao cliente com o ID de execução e o status `PENDING`. Um serviço em background de varredura (`QueueWorker`) busca novos jobs sequencialmente e executa o fluxo em segundo plano de forma assíncrona.

### O Modelo de Dados ([src/persistence/entities/QueueJob.ts](file:///C:/inp_protocol/src/persistence/entities/QueueJob.ts))
```typescript
@Entity('queue_jobs')
export class QueueJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', name: 'saga_id' })
  sagaId: string;

  @Column({ type: 'varchar', name: 'execution_id' })
  executionId: string;

  @Column({ type: 'varchar', name: 'task_type' })
  taskType: string; // FLOW_EXECUTION, FLOW_COMPENSATION

  @Column({ type: 'jsonb' })
  payload: any;

  @Column({ type: 'varchar', default: 'PENDING' })
  status: string; // PENDING, PROCESSING, COMPLETED, FAILED
  
  // Controle de tentativas
  @Column({ type: 'int', default: 0 })
  attempts: number;
}
```

---

## 9. Concorrência Resiliente (SKIP LOCKED e NOWAIT)

### O Problema
Se múltiplas instâncias (workers) do gateway do INP executarem a varredura da fila em paralelo, elas podem tentar pegar o mesmo Job pendente, resultando em condições de corrida e múltiplas execuções indesejadas. Similarmente, se dois nós tentarem executar compensações concorrentes sobre a mesma Saga interrompida, podem corromper o histórico do banco de dados.

### A Solução
1. **Fila com `SKIP LOCKED`**: O `QueueWorker` utiliza a funcionalidade nativa do PostgreSQL para travar de forma exclusiva a linha que está lendo (`FOR UPDATE`) e pular automaticamente qualquer linha que já esteja travada por outro worker (`SKIP LOCKED`).
2. **Rollback com `NOWAIT`**: Ao iniciar um rollback (`resumeRollback`), o `ExecutionEngine` tenta obter um bloqueio pessimista imediato (`FOR UPDATE NOWAIT`) na linha correspondente da Saga. Se outro nó já estiver realizando a compensação, a transação falha rápido sem travar a thread.

### O Código ([src/core/queue-worker.ts](file:///C:/inp_protocol/src/core/queue-worker.ts) & [src/core/transaction-lock.ts](file:///C:/inp_protocol/src/core/transaction-lock.ts))
Exemplo de busca na fila com SKIP LOCKED usando o QueryBuilder do TypeORM:
```typescript
const job = await entityManager.createQueryBuilder(QueueJob, 'job')
  .setLock('pessimistic_write')
  .setOnLocked('skip_locked')
  .where("job.status = 'PENDING'")
  .orderBy('job.created_at', 'ASC')
  .getOne();
```

---

## 10. Políticas de Falha Avançadas (Rollback vs Forward Recovery)

### O Problema
Nem sempre a melhor política para tratar falhas transacionais é reverter tudo (Rollback). Em fluxos longos ou complexos, reverter pode ser caro ou impossível (ex: transferências bancárias efetuadas). Nesses casos, corrigir e tentar de novo do ponto onde falhou (Forward Recovery) é o mais indicado.

### A Solução
Adicionamos suporte a duas políticas configuráveis no `CONTEXT` da intenção através da propriedade `failurePolicy`:
1. **`ROLLBACK`** (Padrão): Desfaz de trás para frente (LIFO) todas as etapas compensáveis executadas até a falha.
2. **`FORWARD_RETRY`**: Em caso de falha de um passo, o motor persiste o progresso (índice do passo atual) no `SagaState` com status `FORWARD_RETRY_PENDING`. Em tentativas subsequentes enviadas com o mesmo `executionId`, o motor carrega o progresso anterior, **pula** as etapas já completadas restaurando seus dados do banco de dados (evitando re-executar APIs), e retoma a orquestração a partir do ponto de falha.

### O Código ([src/core/execution-engine.ts](file:///C:/inp_protocol/src/core/execution-engine.ts))
Lógica de pulo de passos com restauração de outputs no motor de fluxo:
```typescript
if (stepIndex < this.resumeFromStepIndex) {
  const prevStep = this.previousSteps[stepIndex];
  if (prevStep && prevStep.status === 'COMPLETED') {
    output = prevStep.output;
    current = output; // Restaura o contexto intermediário
  }
  allSteps.push({ ... });
  continue;
}
```

---

## 11. AST SafeEvaluator e Rotação de Chaves de Criptografia

### O Problema
1. O uso de `eval()` para validar expressões no bloco `CONDITION` expõe o sistema a injeções de código JavaScript malicioso que poderiam comprometer todo o servidor.
2. Criptografar chaves confidenciais do contexto (comandos `ENCRYPT` / `DECRYPT`) com uma única chave estática de longa duração viola as boas práticas de segurança de dados (ex: PCI-DSS).

### A Solução
1. **Avaliador Lógico por AST (`SafeEvaluator`)**: Desenvolvemos um Parser de Descida Recursiva que lê a string da expressão (ex: `context.amount > 100`), divide-a em tokens, e avalia a árvore de expressões de maneira isolada e segura baseada nas chaves permitidas do contexto, sem acionar o motor nativo do JS (`eval`).
2. **Criptografia Rotativa (`CryptoEngine`)**: Implementamos AES-256-GCM. Novos payloads confidenciais são criptografados usando uma chave marcada como ativa. O valor gerado recebe um prefixo do formato `[versao]:[iv]:[authTag]:[dados_encriptados]`. Na descriptografia, o `CryptoEngine` lê o prefixo e seleciona a chave correspondente à versão, permitindo a rotação transparente e mantendo compatibilidade retroativa.

---

## 12. Melhorias de Nível Master: Lock Reap Timeout, DLQ & Webhooks, Chaves de Idempotência

Para garantir a confiabilidade da orquestração de transações em ambientes de produção altamente distribuídos, implementamos três extensões avançadas de resiliência e controle operacional.

### A. Lock Reap Timeout (Auto-recuperação de Workers)
*   **O Problema**: Se uma instância do gateway INP sofrer uma queda brusca de hardware (crash, falta de energia ou OOM) enquanto processa um Job da fila, o registro do Job permanecerá eternamente com status `PROCESSING` e bloqueado pelo ID daquele worker falhado, impossibilitando que outros servidores na rede assumam o job.
*   **A Solução**: Implementamos um mecanismo de reapropriação de bloqueios expirados (`reapExpiredLocks`). O `QueueWorker` executa periodicamente uma varredura utilizando um QueryBuilder otimizado do TypeORM que busca por registros que estão em `PROCESSING` há mais de 5 minutos (configurável) e reseta seu status para `PENDING`, zerando seus campos de bloqueio (`locked_by` e `locked_at` como `null`).
*   **Código de Varredura**:
    ```typescript
    const expirationLimit = new Date(Date.now() - 5 * 60 * 1000); // 5 minutos de tolerância
    await AppDataSource.getRepository(QueueJob)
      .createQueryBuilder('job')
      .update()
      .set({ status: 'PENDING', lockedBy: null, lockedAt: null })
      .where("status = 'PROCESSING' AND lockedAt < :limit", { limit: expirationLimit })
      .execute();
    ```

### B. Dead Letter Queue (DLQ) & Alertas de Webhook (Governança Operacional)
*   **O Problema**: Se um fluxo ou suas compensações falharem continuamente até estourar o limite de tentativas (`max_attempts`), a transação entra em estado inconsistente e precisa de intervenção humana (ex: suporte de TI ou auditoria financeira). Se tentarmos salvar o erro ou disparar alertas de webhook dentro da transação principal do banco, e esta sofrer um Rollback do PostgreSQL, os registros de erro seriam descartados.
*   **A Solução**: Criamos uma tabela dedicada `dead_letter_queue` mapeada pela entidade `DeadLetterQueue`. Quando o motor atinge falha crítica permanente na recuperação progressiva ou no rollback de uma Saga:
    1. A execução do motor de transação é capturada.
    2. O motor persiste as informações da Saga inconsistente na tabela `dead_letter_queue` em uma conexão separada, fora do bloco de transação sujeito a Rollback.
    3. Dispara alertas imediatos chamando o webhook HTTP POST definido em `ALERT_WEBHOOK_URL`.
*   **O Modelo da DLQ ([src/persistence/entities/DeadLetterQueue.ts](file:///C:/inp_protocol/src/persistence/entities/DeadLetterQueue.ts))**:
    ```typescript
    @Entity('dead_letter_queue')
    export class DeadLetterQueue {
      @PrimaryGeneratedColumn('uuid')
      id: string;

      @Column({ type: 'varchar', nullable: true, name: 'saga_id' })
      sagaId: string | null;

      @Column({ type: 'varchar', name: 'execution_id' })
      executionId: string;

      @Column({ type: 'varchar', name: 'failed_capability' })
      failedCapability: string;

      @Column({ type: 'int', default: 3 })
      attempts: number;

      @Column({ type: 'text', name: 'last_error' })
      lastError: string;

      @CreateDateColumn({ name: 'failed_at' })
      failedAt: Date;
    }
    ```

### C. Chaves de Idempotência Determinísticas (Garantia de Execução Única)
*   **O Problema**: Em transações distribuídas baseadas em microsserviços, falhas de rede podem fazer com que uma resposta HTTP se perca, fazendo o orquestrador INP disparar uma retentativa. Se o serviço de destino não souber se aquela chamada é nova ou repetida, ele pode processá-la duas vezes (ex: cobrar duas vezes o cartão de crédito).
*   **A Solução**: Implementamos chaves de idempotência determinísticas e estáveis no motor de execução. Cada etapa do fluxo recebe uma chave `X-Idempotency-Key` única e idêntica entre retentativas ou retomadas (Forward Recovery). O valor é derivado de forma criptográfica usando SHA-256 combinando o ID da execução principal (`executionId`) e o índice do passo atual (`stepIndex`):
*   **Implementação Criptográfica**:
    ```typescript
    private generateDeterministicUUID(executionId: string, index: number): string {
      const hash = crypto.createHash('sha256').update(`${executionId}-${index}`).digest('hex');
      return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
    }
    ```
    Essa chave é anexada ao cabeçalho HTTP de cada chamada de microsserviço efetuada pelo `CircuitBreaker` no `ExecutionEngine`.

