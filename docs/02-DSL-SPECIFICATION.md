# Especificação da Linguagem INP DSL (Domain Specific Language)

A **INP DSL** é uma linguagem declarativa legível por humanos projetada para expressar fluxos de execução orquestrados, requisitos de capacidades, dados de contexto e transformações de segurança.

---

## 1. Estrutura Canônica de um Documento INP

Todo documento INP deve conter os seguintes blocos de primeiro nível:

```text
INTENT "<nome_identificador>" {
  CONTEXT {
    <chave>: <valor>,
    ...
  }

  REQUIRE {
    <VERBO> <ALVO>
    ...
  }

  FLOW {
    <ESTRUTURA_DE_FLUXO>
  }

  OUTPUT {
    FORMAT "<json | xml | text | event>"
  }
}
```

### Comentários
São suportados comentários de linha única iniciados por `//`:
```text
// Este é um comentário explicativo
INTENT "demo" { ... }
```

---

## 2. Blocos de Primeiro Nível

### A. `INTENT "<nome>"`
Declara o identificador único da intenção. O nome deve ser descritivo e preferencialmente em `snake_case` (ex: `"checkout_order"`, `"transfer_funds"`).

### B. `CONTEXT { ... }`
Define os parâmetros de entrada e variáveis de estado da intenção. Os tipos suportados incluem:
- **Strings**: delimitadas por aspas duplas (`"texto"`), aspas simples (`'texto'`) ou template literals (\`texto\`).
- **Números**: inteiros ou de ponto flutuante (`150`, `25.75`, `-10`).
- **Booleanos**: `true` ou `false`.
- **Nulos**: `null`.
- **Objetos Aninhados e Arrays**: sintaxe padrão JSON (`{ "key": "val" }`, `[1, 2, 3]`).

#### Parâmetros Especiais de Controle de Contexto:
- `failurePolicy: "ROLLBACK"` (padrão): Executa rollback compensatório LIFO via Saga se qualquer etapa falhar.
- `failurePolicy: "FORWARD_RETRY"`: Salva o estado e reinicia a partir do ponto de falha sem desfazer etapas prévias bem-sucedidas.

### C. `REQUIRE { ... }`
Declara a lista de capacidades indispensáveis para que a intenção possa ser aceita para execução. Cada linha define um par `VERBO ALVO`. O motor suporta **120 verbos operacionais oficiais** divididos em 7 famílias:
- **32 Canônicos Operacionais**: `FETCH`, `QUERY`, `RESOLVE`, `READ`, `RETRIEVE`, `STREAM_READ`, `STORE`, `MUTATE`, `CREATE`, `UPDATE`, `DELETE`, `UPSERT`, `PATCH`, `EXECUTE`, `PROCESS`, `CALCULATE`, `TRANSFER`, `REFUND`, `CANCEL`, `APPROVE`, `REJECT`, `CHECK`, `RESERVE`, `RELEASE`, `SEND`, `DISPATCH`, `PUBLISH`, `ARCHIVE`, `AUDIT`, `VALIDATE`, `AUTHENTICATE`, `AUTHORIZE`.
- **24 Anti-Estresse & Alta Resiliência**: `COALESCE`, `MEMOIZE`, `CIRCUIT_BREAKER`, `RATE_LIMIT`, `GUARD`, `THROTTLE`, `BATCH`, `DEBOUNCE`, `RETRY`, `RETRY_BACKOFF`, `PRIORITY_QUEUE`, `SHARD`, `SHED_LOAD`, `COMPRESS`, `FALLBACK`, `DEFER`, `MERGE`, `AWAIT`, `PROBE`, `SHADOW`, `REDACT`, `CHECKPOINT`, `SIMULATE`, `FANOUT`.
- **6 Killer Features Revolucionárias**: `STREAM`, `ATTEST`, `ADAPT`, `ESCALATE`, `REASON`, `CONSENSUS`.
- **9 Criptografia, Mensageria & Concorrência**: `ENCRYPT`, `DECRYPT`, `SIGN`, `VERIFY`, `LOCK`, `UNLOCK`, `ACQUIRE`, `HEALTH_CHECK`, `NOTIFY`.
- **18 Funcionais, Eventos & Governança**: `FILTER`, `MAP`, `REDUCE`, `AGGREGATE`, `ENRICH`, `ASSERT`, `SANITIZE`, `ENFORCE_SCHEMA`, `CHECK_POLICY`, `LOOP`, `BRANCH`, `TRANSFORM`, `NOTIFY_SUBSCRIBERS`, `ROUTE`, `COMPOSE`, `ANALYZE`, `GENERATE`, `SYNC`.
- **16 Anti-Headache & DevOps Resiliente**: `DEDUPLICATE`, `REDRIVE`, `CANARY`, `DIFF`, `CORRELATE`, `ISOLATE`, `ANONYMIZE`, `DRAIN`, `QUARANTINE`, `LEASE`, `BACKPRESSURE`, `MIGRATE`, `SAMPLE`, `RECONCILE`, `CHALLENGE`, `MUTEX`.
- **15 Interconexão entre Sistemas & Ergonomia**: `BRIDGE`, `OUTBOUND`, `INGEST`, `FANIN`, `EMIT`, `PLUCK`, `FLATTEN`, `MASK`, `CAST`, `CLAMP`, `COOLDOWN`, `UNDO`, `SNAPSHOT`, `DIVERGE`, `HEARTBEAT`.
- *(Consulte a [Seção 5](#5-catálogo-canônico-de-verbos-de-intenção-semântica-finalidade-e-guia-de-decisão) para a matriz detalhada, regras de idempotência e compensação Saga).*
- Exemplo:
  ```text
  REQUIRE {
    EXECUTE PAYMENT
    FETCH INVENTORY
    NOTIFY USER
  }
  ```

### D. `FLOW { ... }`
Define a topologia do grafo de execução. Pode combinar múltiplos blocos de controle de fluxo de forma recursiva.

### E. `OUTPUT { FORMAT "<tipo>" }`
Determina a transformação final gerada pelo `ResponseComposer`:
- `"json"`: Objeto JSON estruturado com status, duração, passos detalhados e output final.
- `"xml"`: Documento XML padrão com tags `<response>`, `<status>`, `<execution_id>`, `<output>`.
- `"text"`: Representação textual simples.
- `"event"`: Payload encapsulado como evento SSE (`INP_RESULT`).

---

## 3. Estruturas de Fluxo (`FLOW`)

### 1. `SEQUENCE { ... }`
Executa os passos internos em ordem estritamente linear e síncrona. A saída de um passo é mesclada no contexto do passo seguinte.
```text
SEQUENCE {
  FETCH INVENTORY
  EXECUTE PAYMENT
  STORE ORDER
}
```

### 2. `PARALLEL { ... }`
Executa os blocos internos concorrentemente utilizando `Promise.all`. Ideal para operações I/O não dependentes entre si.
```text
PARALLEL {
  NOTIFY EMAIL
  NOTIFY SMS
  NOTIFY SLACK
}
```

### 3. `CONDITION "<expressão>" { ... }`
Executa o bloco interno apenas se a expressão lógica resultar em verdadeiro. A expressão é avaliada pelo `SafeEvaluator` (AST seguro sem `eval`).
- Suporta operadores: `==`, `===`, `!=`, `!==`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!`, `+`, `-`, `*`, `/`, `()`.
- Variáveis de contexto são acessadas via `context.<campo>`.
```text
CONDITION "context.amount > 1000 && context.vipUser == true" {
  EXECUTE APPLY_DISCOUNT
}
```

### 4. `RETRY <limite> { ... }`
Tenta executar o passo até `<limite>` vezes com backoff exponencial antes de propagar o erro.
```text
RETRY 5 {
  EXECUTE EXTERNAL_GATEWAY
}
```

### 5. `FALLBACK "<AÇÃO_ALTERNATIVAR>" { ... }`
Define uma rota alternativa caso a ação principal falhe.
```text
FALLBACK "EXECUTE SECONDARY_PAYMENT" {
  EXECUTE PRIMARY_PAYMENT
}
```

### 6. `TIMEOUT <milissegundos> { ... }`
Impõe um tempo limite estrito de execução via `Promise.race`. Se o bloco exceder o tempo estipulado, a execução falha com timeout.
```text
TIMEOUT 3000 {
  FETCH EXTERNAL_RATES
}
```

### 7. `DEPENDENCY "<passo1>, <passo2>" { ... }`
Garante que o bloco interno só inicie se os passos especificados já tiverem sido concluídos com sucesso dentro do mesmo fluxo. O `IntentParser` verifica em tempo de compilação se há ciclos (`Circular Dependency Detection`).
```text
DEPENDENCY "EXECUTE PAYMENT" {
  EXECUTE SHIPMENT
}
```

### 8. `PIPELINE { ... }`
Executa uma cadeia de transformações onde a saída exata da etapa anterior alimenta diretamente a entrada da seguinte.

### 9. `SCOPE { ... }`
Cria uma fronteira de isolamento de contexto (cópia profunda de payload), prevenindo que mutações acidentais dentro do escopo vazem para o contexto externo.

---

## 4. Primitivas de Segurança e Privacidade

### Criptografia em Trânsito (`ENCRYPT` e `DECRYPT`)
Permite cifrar campos confidenciais do contexto antes de enviá-los a serviços de terceiros e decifrá-los posteriormente utilizando o `CryptoEngine` (AES-256-GCM).
```text
SEQUENCE {
  ENCRYPT "card_token"
  SCOPE {
    EXECUTE AUDIT_LOG
  }
  DECRYPT "card_token"
  EXECUTE PAYMENT
}
```

### Escopo Confidencial & Verificação de Compromissos (`CONFIDENTIAL_SCOPE` & `VERIFY`)
Permite verificar restrições sobre campos confidenciais protegidos por compromissos criptográficos (`<campo>_commitment` e `<campo>_proof`) sem expor dados desnecessariamente.
```text
CONFIDENTIAL_SCOPE {
  VERIFY "amount" >= 100
  EXECUTE PAYMENT
}
```

---

## 5. Exemplo Completo de Referência Corporativa

```text
INTENT "enterprise_order_fulfillment" {
  CONTEXT {
    order_id: "ord_987654",
    user_id: "usr_corp_12",
    amount: 1250.00,
    currency: "USD",
    card_token: "tok_visa_enterprise_44",
    shipping_address: "Av. Paulista, 1000 - SP",
    failurePolicy: "ROLLBACK"
  }

  REQUIRE {
    FETCH INVENTORY
    EXECUTE PAYMENT
    REFUND PAYMENT
    EXECUTE LOGISTICS
    NOTIFY USER
  }

  FLOW {
    SEQUENCE {
      // 1. Verificar inventário com timeout estrito
      TIMEOUT 2000 {
        FETCH INVENTORY
      }

      // 2. Processar pagamento protegido por escopo e criptografia
      CONFIDENTIAL_SCOPE {
        ENCRYPT "card_token"
        EXECUTE PAYMENT
        DECRYPT "card_token"
      }

      // 3. Logística dependente do pagamento concluído
      DEPENDENCY "EXECUTE PAYMENT" {
        RETRY 3 {
          EXECUTE LOGISTICS
        }
      }

      // 4. Notificações concorrentes
      PARALLEL {
        NOTIFY EMAIL
        NOTIFY SMS
      }
    }
  }

  OUTPUT {
    FORMAT "json"
  }
}
```

---

## 5. Catálogo Canônico de Verbos de Intenção (Semântica, Finalidade e Guia de Decisão)

No **Intent Network Protocol (INP)**, os **Verbos de Intenção** constituem os blocos atômicos da semântica operacional da rede. Enquanto o **Alvo (Target)** identifica o recurso ou domínio sobre o qual a ação incide (ex.: `PAYMENT`, `INVENTORY`, `USER`, `REPORT`), o **Verbo** define a natureza fundamental, a política de idempotência, o impacto no estado e o comportamento transacional/Saga da operação.

Esta seção detalha os **105 verbos oficiais do INP Protocol v2.7**, organizados em **6 famílias estratégicas**:
1. **32 Verbos Canónicos Operacionais** (Fundamentos de Negócio e Estado)
2. **24 Verbos Estratégicos Anti-Estresse e Alta Resiliência** (Armadura de Sobrevivência)
3. **6 Killer Features Revolucionárias** (Streaming, Prova Forense, IA Agêntica, HITL & Consenso)
4. **9 Verbos Criptográficos, Mensageria e Concorrência Distribuída** (Barramento e Travas)
5. **18 Verbos Funcionais, Eventos e Governança de Dados** (Pipelines e Filtragens)
6. **16 Verbos Anti-Headache & DevOps Resiliente** (Solução de Dores Críticas de Infraestrutura)

---

### Tabela Comparativa Consolidada dos 105 Verbos Operacionais

| Verbo | Categoria | Natureza / Efeito | Idempotente? | Compensação Saga Típica | Quando Usar (Resumo) |
|---|---|---|---|---|---|
| **CREATE** | CRUD / Domínio | Mutante (Insere novo) | Não (sem chave) | `DELETE` / `CANCEL` | Criar nova entidade durável com ciclo de vida próprio. |
| **READ** | CRUD / Consulta | Leitura local | Sim | Nenhuma | Consultar entidade local existente por ID ou chave primária. |
| **UPDATE** | CRUD / Mutação | Mutante (Modifica) | Sim | `UPDATE` (Restaurar) | Alterar atributos de um recurso que já existe. |
| **DELETE** | CRUD / Destrutivo | Destrutivo (Remove) | Sim | `RESTORE` / `CREATE` | Eliminar fisicamente ou expurgar uma entidade do sistema. |
| **EXECUTE** | Operação / Comando | Ação crítica imediata | Depende da API | `REFUND` / `CANCEL` | Disparar cobranças, transações bancárias e ordens imperativas. |
| **PROCESS** | Processamento | Computação / Lote | Sim | DLQ / Reprocessamento | Tratar pipelines contínuos, lotes de dados ou filas assíncronas. |
| **ANALYZE** | Inteligência / Auditoria | Leitura analítica | Sim | Nenhuma | Extrair diagnósticos, scoring de fraude, riscos ou telemetria. |
| **GENERATE** | Síntese / Conteúdo | Produção derivativa | Sim | `DELETE` (Limpar) | Gerar relatórios PDF, tokens JWT, QR codes ou chaves temporárias. |
| **TRANSFER** | Transacional / Finanças | Débito & Crédito atômico | Não (sem chave) | `TRANSFER` (Inverso) | Mover fundos, ativos ou posse entre duas entidades. |
| **VALIDATE** | Integridade / Regras | Inspeção de conformidade | Sim | Nenhuma | Validar schemas, consistência de dados e regras de negócio. |
| **AUTHENTICATE** | Segurança / Identidade | Verificação de credenciais | Sim | Nenhuma | Confirmar identidade (*"Quem é você?"* via senha/token). |
| **AUTHORIZE** | Segurança / RBAC | Checagem de privilégios | Sim | Nenhuma | Confirmar permissão (*"Você pode fazer isso?"* via RBAC). |
| **NOTIFY** | Comunicação | Alerta unilateral | Sim | `NOTIFY CANCELLATION` | Avisar clientes via SMS, push ou webhook sem travar o fluxo. |
| **SYNC** | Conectividade | Alinhamento de réplicas | Sim | `SYNC` | Reconciliar discrepâncias entre bancos, nós ou ERPs externos. |
| **ROUTE** | Infraestrutura | Despacho de tráfego | Sim | Nenhuma | Encaminhar intenções ou pacotes para partições/shards ótimos. |
| **COMPOSE** | Agregação | Consolidação de saídas | Sim | Nenhuma | Fundir dados de múltiplos serviços num payload único de resposta. |
| **FETCH** | I/O / Integração | Busca remota em APIs | Sim | Nenhuma | Recuperar dados via rede de serviços remotos ou legados. |
| **STORE** | Armazenamento | Persistência física bruta | Sim | `DELETE` | Gravar payloads brutos, cache ou estados em banco/storage. |
| **CALCULATE** | Matemática / Lógica | Computação pura | Sim | Nenhuma | Calcular impostos, taxas, frete ou descontos com fórmulas. |
| **REFUND** | Finanças / Saga | Estorno financeiro | Sim | Nenhuma (Terminal) | Devolver valores monetários cobrados anteriormente. |
| **CANCEL** | Ciclo de Vida / Saga | Aborto de processo | Sim | `REOPEN` | Cancelar pedidos, agendamentos ou reservas em aberto. |
| **APPROVE** | Workflow / Alçada | Transição positiva | Sim | `REJECT` / `CANCEL` | Conceder aprovação humana ou de crédito formal a um pedido. |
| **REJECT** | Workflow / Alçada | Transição negativa | Sim | Nenhuma (Terminal) | Recusar formalmente proposta, cadastro ou transação suspeita. |
| **CHECK** | Verificação Rápida | Consulta de disponibilidade | Sim | Nenhuma | Consultar se há estoque ou saldo livre sem reter ou travar. |
| **RESERVE** | Transacional / Estoque | Retenção temporária (TTL) | Não (sem chave) | `RELEASE` | Garantir estoque ou saldo durante o processo de checkout. |
| **RELEASE** | Transacional / Saga | Desbloqueio de reserva | Sim | Nenhuma | Devolver à disponibilidade geral itens que haviam sido retidos. |
| **SEND** | Mensageria Direta | Expedição de payload | Sim | Nenhuma | Enviar e-mail com fatura em anexo, recibo ou SMS direto. |
| **DISPATCH** | Operacional / Fila | Acionamento de worker | Sim | `CANCEL` | Lançar entrega física ou despachar job para worker assíncrono. |
| **PUBLISH** | Event-Driven | Emissão em barramento | Sim | Compensating Event | Publicar eventos em Kafka, RabbitMQ ou barramentos pub/sub. |
| **ARCHIVE** | Retenção / Legal | Armazenamento frio | Sim | `RESTORE` | Mover histórico de transações e auditoria para guarda legal. |
| **AUDIT** | Segurança / Forense | Verificação de conformidade | Sim | Nenhuma | Validar logs contra adulteração e auditar trilha transacional. |
| **COALESCE** | Anti-Stress / Single-Flight | Colapso de concorrência | Sim | Nenhuma | Deduplicar requisições em voo mitigando thundering herd. |
| **MEMOIZE** | Anti-Stress / Cache | Cache-aside volátil | Sim | Nenhuma | Memorizar cálculos/consultas com hashing SHA-256 e TTL. |
| **GUARD** | Resiliência / Fail-Fast | Invariante em memória | Sim | Nenhuma | Barrar fluxos inválidos antes de consumir rede ou banco. |
| **THROTTLE** | Anti-Stress / Vazão | Token bucket pacing | Sim | Nenhuma | Modular a cadência de requisições por segundo para APIs frágeis. |
| **BATCH** | Anti-Stress / Lotes | Chunking declarativo | Sim | Nenhuma | Fracionar coleções grandes em pedaços seguros, sem sobrecarga N+1. |
| **DEFER** | Anti-Stress / Async | Transactional Outbox | Sim | Nenhuma | Agendar tarefas assíncronas no PostgreSQL liberando o cliente. |
| **MERGE** | Ergonomia / Composição | Fusão profunda | Sim | Nenhuma | Consolidar saídas parciais em um payload coerente unificado. |
| **AWAIT** | Ergonomia / Saga | Suspensão reativa | Sim | Nenhuma | Pausar a Saga liberando threads até retoma externa por webhook. |
| **PROBE** | Telemetria / Métricas | Zero-IO health check | Sim | Nenhuma | Inspecionar status em memória (<1ms) via ServiceMetricsCollector. |
| **SHADOW** | Resiliência / Canary | Tráfego espelho | Sim | Nenhuma | Disparar carga sombra em background sem impactar latência. |
| **REDACT** | Segurança / LGPD | Sanitização de dados | Sim | Nenhuma | Mascarar senhas, cartões e tokens com tarjas irreversíveis. |
| **CHECKPOINT** | Resiliência / Saga | Savepoint intermediário | Sim | Nenhuma | Gravar marco de execução no banco para recuperação cirúrgica. |
| **SIMULATE** | Resiliência / Chaos | Injeção de latência/mock | Sim | Nenhuma | Simular falhas programadas para testes de carga e resiliência. |
| **FANOUT** | Ergonomia / Paralelismo | Bounded concurrency | Sim | Nenhuma | Dispersar trabalho com limite estrito de concorrência e heap. |
| **STREAM** | Real-Time / Streaming | Emissão progressiva | Sim | Nenhuma | Transmitir deltas em tempo real via SSE para UIs e IA generativa. |
| **ATTEST** | Criptografia / Forense | Prova forense HMAC | Sim | Nenhuma | Selar estado de execução com HMAC-SHA256 para SOC2/LGPD. |
| **ADAPT** | IA / Roteamento | Multi-Armed Bandit | Sim | Nenhuma | Roteamento adaptativo (epsilon-greedy) que desvia de nós lentos. |
| **ESCALATE** | Governança / HITL | Suspensão com SLA | Sim | Nenhuma | Suspender fluxos atípicos para aprovação humana supervisionada. |
| **REASON** | Orquestração Agêntica | Deliberação CoT | Sim | Nenhuma | Deliberação reflexiva estruturada com justificativa formal auditável. |
| **DEDUPLICATE** | Anti-Headache / Resiliência | Filtro deslizante SHA-256 | Sim | Nenhuma | Eliminar webhooks redundantes e mensagens repetidas de fila (<0.05ms). |
| **REDRIVE** | Anti-Headache / Fila | Reprocessamento de DLQ | Sim | Nenhuma | Reprocessar mensagens falhadas da DLQ de volta à fila primária com dry-run. |
| **CANARY** | Anti-Headache / Deploy | Roteamento ponderado | Sim | Nenhuma | Direcionar fração percentual de tráfego (ex: 15%) para nova versão com fallback. |
| **DIFF** | Anti-Headache / Auditoria | Comparação profunda recursiva | Sim | Nenhuma | Isolar deltas estruturais exatos (adicionados, modificados, removidos) em memória. |
| **CORRELATE** | Anti-Headache / Rastreio | Injeção W3C TraceContext | Sim | Nenhuma | Amarrar requisições sob traceId, spanId e correlationId universal. |
| **ISOLATE** | Anti-Headache / Multi-Tenant | Segregação corporativa | Sim | Nenhuma | Impedir vazamento de dados ou comandos entre empresas distintas. |
| **ANONYMIZE** | Anti-Headache / LGPD | Hashing salgado de PII | Sim | Nenhuma | Mascarar CPFs, e-mails e nomes irreversivelmente antes de telemetria/analytics. |
| **DRAIN** | Anti-Headache / DevOps | Graceful shutdown | Sim | Nenhuma | Encerrar nó sem derrubar conexões ativas no Kubernetes/deploys. |
| **QUARANTINE** | Anti-Headache / Resiliência | Isolamento de Poison Pills | Sim | Nenhuma | Enviar payloads malformados para cofre forense sem travar a fila de consumo. |
| **LEASE** | Anti-Headache / Concorrência | Bloqueio com heartbeat ativo | Sim | `RELEASE` | Obter posse exclusiva de tarefas/cron jobs com renovação periódica. |
| **BACKPRESSURE** | Anti-Headache / Fluxo | Controle reativo de vazão | Sim | Nenhuma | Frear produtores velozes quando a fila atingir mais de 80% da capacidade. |
| **MIGRATE** | Anti-Headache / Adaptação | Mapeamento on-the-fly | Sim | Nenhuma | Converter payloads de versões antigas (v1) para a versão moderna (v2) sem quebra. |
| **SAMPLE** | Anti-Headache / Custos | Filtragem adaptativa de logs | Sim | Nenhuma | Reter 100% dos erros e apenas 5% dos sucessos para cortar 90% dos custos de APM. |
| **RECONCILE** | Anti-Headache / Financeiro | Batimento O(n) | Sim | Nenhuma | Conciliar livros-razão, extratos bancários e estoques com alta performance. |
| **CHALLENGE** | Anti-Headache / Segurança | Desafio Step-Up MFA | Sim | Nenhuma | Exigir autenticação biométrica ou push token em transações financeiras anômalas. |
| **MUTEX** | Anti-Headache / Concorrência | Exclusão mútua local estrita | Sim | `UNLOCK` | Proteger seções críticas e números sequenciais fiscais contra race conditions. |
| **QUERY** | CRUD / Consulta | Filtro paginado | Sim | Nenhuma | Consultas filtradas e paginadas com limite obrigatório. |
| **RESOLVE** | Descoberta / Rede | Descoberta semântica | Sim | Nenhuma | Mapear nomes de microsserviços em URLs físicas no cluster. |
| **RETRIEVE** | Consulta / Grafo | Expansão recursiva | Sim | Nenhuma | Carregar entidade pai com coleções agregadas (eager loading). |
| **STREAM_READ** | I/O / Big Data | Consumo em blocos | Sim | Nenhuma | Ler arquivos sequenciais gigantescos sem estourar a memória RAM. |
| **MUTATE** | Transacional / Saga | Alteração com compensação | Não (sem chave) | Cláusula `COMPENSATE` | Alterar estado de negócio garantindo rollback automático LIFO. |
| **UPSERT** | CRUD / Concorrência | Fusão atômica | Sim | `DELETE` / `UPDATE` | Inserir novo se ausente ou atualizar se existente. |
| **PATCH** | CRUD / Parcial | Modificação cirúrgica | Sim | `PATCH` (Inverso) | Atualizar apenas campos específicos sem trafegar a entidade inteira. |
| **CIRCUIT_BREAKER** | Resiliência / Falhas | Disjuntor de circuito | Sim | Nenhuma | Interromper tráfego para nós instáveis evitando retenção de conexões. |
| **RATE_LIMIT** | Resiliência / Vazão | Token Bucket | Sim | Nenhuma | Limitar requisições por IP, usuário ou janela temporal contra abusos. |
| **DEBOUNCE** | Resiliência / Eventos | Atraso estabilizador | Sim | Nenhuma | Aguardar quietude de eventos antes de disparar ação final. |
| **RETRY** | Resiliência / Falhas | Retentativa configurável | Sim | Nenhuma | Reexecutar passos transitórios com recuo exponencial e jitter. |
| **RETRY_BACKOFF** | Resiliência / Falhas | Retentativa com recuo | Sim | Nenhuma | Reexecutar requisições com atraso crescente contra serviços parceiros. |
| **PRIORITY_QUEUE** | Resiliência / Fila | Fila ponderada | Sim | Nenhuma | Ordenar tarefas por classe de serviço (VIP, normal, background). |
| **SHARD** | Resiliência / Partição | Hash partitioning | Sim | Nenhuma | Distribuir carga entre múltiplas partições por chave semântica. |
| **SHED_LOAD** | Resiliência / Sobrevivência | Descarte adaptativo | Sim | Nenhuma | Rejeitar trabalho secundário sob sobrecarga térmica/CPU do servidor. |
| **COMPRESS** | Otimização / I/O | Compressão GZIP/Brotli | Sim | Nenhuma | Reduzir volume de tráfego de payloads volumosos na rede. |
| **FALLBACK** | Resiliência / Contingência | Rota alternativa | Sim | Nenhuma | Executar caminho de contingência se o caminho primário falhar. |
| **CONSENSUS** | Consenso / Quórum | Votação distribuída | Sim | Nenhuma | Exigir concordância de maioria (quórum) de nós antes de aprovar decisão. |
| **ENCRYPT** | Criptografia / Proteção | Cifragem AES-GCM | Sim | Nenhuma | Cifrar dados sensíveis com chave simétrica antes de armazenar. |
| **DECRYPT** | Criptografia / Acesso | Decifragem AES-GCM | Sim | Nenhuma | Recuperar texto em claro a partir de payload criptografado. |
| **SIGN** | Criptografia / Autoria | Assinatura digital | Sim | Nenhuma | Assinar documento com chave privada garantindo não-repúdio. |
| **VERIFY** | Criptografia / Integridade | Validação de assinatura | Sim | Nenhuma | Checar se assinatura digital confere com chave pública do emissor. |
| **LOCK** | Concorrência / Exclusão | Trinco distribuído | Sim | `UNLOCK` | Adquirir exclusividade de recurso por chave em cluster. |
| **UNLOCK** | Concorrência / Liberação | Liberação de trinco | Sim | Nenhuma | Liberar recurso previamente travado para os demais nós. |
| **ACQUIRE** | Concorrência / Semáforo | Permissão de vazão | Sim | `RELEASE` | Obter ficha em semáforo contador de acessos concorrentes. |
| **HEALTH_CHECK** | Telemetria / Diagnóstico | Sondagem de saúde | Sim | Nenhuma | Inspecionar status operacional de serviços e bancos de dados. |
| **FILTER** | Funcional / Coleção | Predicado lógico | Sim | Nenhuma | Filtrar itens de listas mantendo apenas os que satisfazem condição. |
| **MAP** | Funcional / Transformação | Projeção elemento a elemento | Sim | Nenhuma | Projetar atributos específicos de cada elemento de uma lista. |
| **REDUCE** | Funcional / Agregação | Acumulador escalar | Sim | Nenhuma | Somar ou acumular valores de uma lista em um único resultado. |
| **AGGREGATE** | Funcional / Estatística | Agrupamento dimensional | Sim | Nenhuma | Calcular soma, média e contagem agrupadas por dimensão de negócio. |
| **ENRICH** | Funcional / Fusão | Acoplamento de dados | Sim | Nenhuma | Anexar informações complementares a uma entidade base. |
| **ASSERT** | Integridade / Regras | Invariante de negócio | Sim | Nenhuma | Abortar execução imediatamente se predicado for violado. |
| **SANITIZE** | Segurança / Limpeza | Higienização de strings | Sim | Nenhuma | Remover tags HTML, scripts e caracteres perigosos contra XSS. |
| **ENFORCE_SCHEMA** | Segurança / Contrato | Coerção e descarte estrito | Sim | Nenhuma | Expurgar campos desconhecidos protegendo contra injeção de parâmetros. |
| **CHECK_POLICY** | Governança / OPA | Regras declarativas | Sim | Nenhuma | Avaliar conformidade corporativa contra políticas OPA/Rego. |
| **LOOP** | Fluxo / Iteração | Laço com limite rígido | Sim | Nenhuma | Iterar sobre coleções garantindo proteção contra loops infinitos. |
| **BRANCH** | Fluxo / Decisão | Roteamento multi-caminho | Sim | Nenhuma | Bifurcar fluxo por chave categórica eliminando IFs aninhados. |
| **TRANSFORM** | Funcional / Schema | Mapeamento declarativo | Sim | Nenhuma | Mapear propriedades de entrada para nomes aceitos no destino. |
| **NOTIFY_SUBSCRIBERS** | Event-Driven / PubSub | Disparo em leque | Sim | Nenhuma | Notificar lista de assinantes registrados em um canal. |
| **BRIDGE** | Interoperabilidade / Protocolos | Adaptador universal | Sim | Nenhuma | Conversão e mapeamento de formatos (SOAP <-> REST, XML <-> JSON). |
| **OUTBOUND** | Interoperabilidade / HTTP | Disparo resiliente | Sim | Nenhuma | Chamada HTTP/REST com retry, backoff e timeout embutidos. |
| **INGEST** | Interoperabilidade / Webhooks | Ingestão e assinatura | Sim | Nenhuma | Receber webhooks com checagem de assinatura HMAC segura. |
| **FANIN** | Interoperabilidade / Async | Agregação convergente | Sim | Nenhuma | Junção de respostas concorrentes com quórum mínimo. |
| **EMIT** | Event-Driven / PubSub | Emissão assíncrona leve | Sim | Nenhuma | Publicação fire-and-forget de eventos sem bloqueio de threads. |
| **PLUCK** | Funcional / Ergonomia | Extração cirúrgica | Sim | Nenhuma | Extrair campos específicos de listas ou objetos sem loops. |
| **FLATTEN** | Funcional / Ergonomia | Aplainamento de listas | Sim | Nenhuma | Aplainar matrizes multidimensionais aninhadas em lista plana. |
| **MASK** | Segurança / Exibição | Mascaramento visual | Sim | Nenhuma | Mascaramento de dados sensíveis (cartão, CPF, e-mail). |
| **CAST** | Tipagem / Ergonomia | Coerção segura de tipos | Sim | Nenhuma | Conversão segura de tipos primitivos com fallback sem exceções. |
| **CLAMP** | Validação / Numérico | Delimitação de intervalo | Sim | Nenhuma | Travar números dentro de intervalo fixo [min, max]. |
| **COOLDOWN** | Controle / Temporização | Pausa cooperativa | Sim | Nenhuma | Pausa não-bloqueante na esteira com suporte a cancelamento. |
| **UNDO** | Resiliência / Reversão | Desfazer atômico pontual | Não | Nenhuma | Reverter cirurgicamente o passo anterior sem Saga inteira. |
| **SNAPSHOT** | Forense / Auditoria | Foto de estado em memória | Sim | Nenhuma | Captura fotográfica com hash SHA-256 para auditoria ou replay. |
| **DIVERGE** | Concorrência / Async | Bifurcação em background | Sim | Nenhuma | Disparar rotina assíncrona secundária em background. |
| **HEARTBEAT** | Telemetria / SLA | Sinal de vivacidade | Sim | Nenhuma | Emitir pulsos periódicos de vivacidade prevenindo falsos timeouts. |

---

### Detalhamento dos 23 Verbos Canônicos

#### 1. `CREATE`
- **Definição Semântica**: Cria uma nova entidade permanente no domínio de negócio, atribuindo-lhe um identificador global único e inicializando o seu ciclo de vida.
- **Para que serve**: Instanciar registros formais de domínio, tais como novas contas de clientes, ordens de serviço, novas faturas ou remessas de frete.
- **Quando usar**: Sempre que a operação resultar na criação durável de um novo objeto de negócio gerenciado pela aplicação.
- **Quando NÃO usar**:
  - Não use para salvar snapshots ou dados brutos em cache (use `STORE`).
  - Não use para modificação de entidades existentes (use `UPDATE`).
  - Não use para sintetizar artefatos derivados como PDFs ou tokens efêmeros (use `GENERATE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    CREATE SHIPMENT
  }
  FLOW {
    SEQUENCE {
      CREATE SHIPMENT
    }
  }
  ```
- **Comportamento Transacional & Saga**: Operação de escrita mutante. Se o fluxo global for revertido via Saga, a compensação associada típica é a eliminação ou anulação (`DELETE SHIPMENT` ou `CANCEL SHIPMENT`).

---

#### 2. `READ`
- **Definição Semântica**: Consulta e recupera a representação canônica e os atributos de uma entidade de negócio existente a partir da sua chave primária ou identificador no domínio local.
- **Para que serve**: Aceder a perfis cadastrais de usuários, consultar o estado atual de um pedido gravado na base de dados ou inspecionar configurações salvas.
- **Quando usar**: Quando o cliente precisa recuperar dados de um registro do domínio mantido pela infraestrutura local ou microsserviço de persistência.
- **Quando NÃO usar**:
  - Não use para chamadas remotas de I/O a fornecedores externos de terceiros (use `FETCH`).
  - Não use para checagens booleanas rápidas de saldo ou disponibilidade sem retorno de entidade (use `CHECK`).
  - Não use para inspeção analítica de grandes volumes de dados (use `ANALYZE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    READ USER_PROFILE
  }
  ```
- **Comportamento Transacional & Saga**: Operação de leitura pura (safe & idempotent). Não altera o estado do sistema e não requer ação compensatória em caso de rollback.

---

#### 3. `UPDATE`
- **Definição Semântica**: Altera o estado, os campos ou os atributos de um recurso existente sem destruir a sua identidade histórica.
- **Para que serve**: Atualizar o endereço de entrega de um cliente, modificar as preferências de notificação ou atualizar o status operacional de uma tarefa.
- **Quando usar**: Quando o recurso alvo já existe na base de dados e deve sofrer mutações parciais ou totais nos seus valores.
- **Quando NÃO usar**:
  - Não use para criar um recurso se ele não existir (use `CREATE`).
  - Não use para transições formais de encerramento de negócios como cancelamentos ou estornos (use `CANCEL` ou `REFUND`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    UPDATE SHIPPING_ADDRESS
  }
  ```
- **Comportamento Transacional & Saga**: Mutante. Em fluxos distribuídos com rollback via Saga, o microsserviço deve registrar um snapshot do estado anterior para restaurá-lo via compensação ou registrar evento de reversão.

---

#### 4. `DELETE`
- **Definição Semântica**: Remove fisicamente ou logicamente uma entidade do sistema de arquivos ou do banco de dados relacional/NoSQL.
- **Para que serve**: Excluir sessões ativas expiradas, purgar dados sob demanda da LGPD/GDPR ("direito ao esquecimento") ou revogar registros obsoletos.
- **Quando usar**: Para descartar permanentemente um recurso que não deve mais existir no armazenamento operacional ativo.
- **Quando NÃO usar**:
  - Não use para abortar pedidos comerciais que continuam fazendo parte da contabilidade (use `CANCEL`).
  - Não use para arquivamento histórico e conformidade fiscal (use `ARCHIVE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    DELETE USER_SESSION
  }
  ```
- **Comportamento Transacional & Saga**: Operação destrutiva. A compensação em Saga exige restauração a partir de lixeira lógica (`RESTORE`) ou reinserção via `CREATE`.

---

#### 5. `EXECUTE`
- **Definição Semântica**: Dispara uma ação operacional atômica, comando imperativo ou transação de negócio de alta criticidade que gera efeitos colaterais substanciais.
- **Para que serve**: Efetuar cobrança em cartão de crédito, liquidar transação bancária instantânea (PIX/SEPA), acionar fechamento de contrato ou disparar webhook crítico.
- **Quando usar**: Para transações pontuais e atômicas de alta relevância no ecossistema (especialmente financeiras e operacionais).
- **Quando NÃO usar**:
  - Não use para computação contínua de filas ou lotes em segundo plano (use `PROCESS`).
  - Não use para cálculos matemáticos sem efeito colateral no mundo real (use `CALCULATE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
  ```
- **Comportamento Transacional & Saga**: Altamente sensível. Microserviços que expõem `EXECUTE PAYMENT` devem obrigatoriamente cadastrar a capacidade inversa no catálogo (`compensateCapability: "REFUND PAYMENT"`).

---

#### 6. `PROCESS`
- **Definição Semântica**: Submete um lote de registros, uma fila de mensagens ou um fluxo de eventos a uma sequência ordenada de tratamentos, transformações e validações.
- **Para que serve**: Processar a folha de pagamento mensal da empresa, drenar lotes de imagens para redimensionamento ou processar fila de transações pendentes.
- **Quando usar**: Quando a tarefa envolve múltiplos itens em fluxo contínuo ou em lote com múltiplos estágios de tratamento.
- **Quando NÃO usar**:
  - Não use para uma única transação atômica individual (use `EXECUTE`).
  - Não use para checar simples regras de negócio unitárias (use `VALIDATE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    PROCESS BATCH_ORDERS
  }
  ```
- **Comportamento Transacional & Saga**: Lotes processados com falha parcial devem salvar o ponteiro de progresso (`cursor`) e despachar registros defeituosos para Dead Letter Queue (DLQ).

---

#### 7. `ANALYZE`
- **Definição Semântica**: Aplica modelos estatísticos, regras heurísticas, algoritmos de inteligência artificial ou telemetria para inspecionar um conjunto de dados e extrair conclusões diagnósticas.
- **Para que serve**: Análise preditiva de score de fraude bancária, detecção de padrões anômalos de tráfego, análise de risco de crédito ou diagnóstico de saúde do cluster.
- **Quando usar**: Quando a resposta necessita de avaliação interpretativa sem alterar os dados analisados.
- **Quando NÃO usar**:
  - Não use para validação estrutural determinística de tipos ou campos (use `VALIDATE`).
  - Não use para operações aritméticas exatas (use `CALCULATE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    ANALYZE FRAUD_RISK
  }
  ```
- **Comportamento Transacional & Saga**: Operação de leitura analítica idempotente e sem efeitos colaterais. Não exige compensação.

---

#### 8. `GENERATE`
- **Definição Semântica**: Produz novos artefatos digitais, códigos, relatórios consolidados, documentos derivados ou credenciais computadas a partir de parâmetros de entrada.
- **Para que serve**: Emitir relatórios financeiros em formato PDF, criar tokens criptográficos de acesso (JWT), gerar comprovantes com QR Code ou gerar chaves de ativação.
- **Quando usar**: Sempre que a saída da operação for um artefato sintético, derivado e reproduzível.
- **Quando NÃO usar**:
  - Não use para persistir entidades de negócio permanentes como clientes ou remessas (use `CREATE`).
  - Não use para cálculos aritméticos isolados (use `CALCULATE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    GENERATE INVOICE_PDF
    GENERATE AUTH_TOKEN
  }
  ```
- **Comportamento Transacional & Saga**: Operação normalmente idempotente. Artefatos temporários em disco ou bucket S3 podem ser purgados com `DELETE` se o fluxo for cancelado.

---

#### 9. `TRANSFER`
- **Definição Semântica**: Movimenta valores, fundos, ativos digitais, inventário ou direitos de propriedade de um nó/conta de origem para um nó/conta de destino de forma balanceada.
- **Para que serve**: Transferências financeiras entre contas correntes bancárias, transferência de mercadorias entre centros de distribuição, transferência de titularidade de assinaturas.
- **Quando usar**: Quando a operação envolve uma transação de partida dobrada (débito obrigatório na origem acompanhado de crédito simultâneo no destino).
- **Quando NÃO usar**:
  - Não use para pagamentos simples ponto-a-ponto com gateway (use `EXECUTE PAYMENT`).
  - Não use para sincronização de dados entre réplicas (use `SYNC`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    TRANSFER FUNDS
  }
  ```
- **Comportamento Transacional & Saga**: Transacional rigoroso com chave de idempotência obrigatória. A compensação no padrão Saga é a execução do `TRANSFER` reverso.

---

#### 10. `VALIDATE`
- **Definição Semântica**: Inspeciona a estrutura, tipagem, restrições e conformidade de um payload de dados contra esquemas formais (JSON Schema) ou regras contratuais.
- **Para que serve**: Validar formato de e-mail, checar integridade de documentos (CPF, CNPJ, IBAN), validar corpo de requisição contra contrato da API.
- **Quando usar**: Como etapa de guarda preliminar (*guard rail*) antes de submeter requisições a processamentos que custam recursos.
- **Quando NÃO usar**:
  - Não use para confirmar se quem envia a requisição é quem diz ser (use `AUTHENTICATE`).
  - Não use para checar se o usuário tem privilégios de acesso ao recurso (use `AUTHORIZE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    VALIDATE ORDER_PAYLOAD
  }
  ```
- **Comportamento Transacional & Saga**: Função determinística sem mutação de estado. Não requer compensação.

---

#### 11. `AUTHENTICATE`
- **Definição Semântica**: Verifica a autenticidade das credenciais de um usuário, sistema ou máquina, validando a sua identidade perante o provedor de segurança.
- **Para que serve**: Efetuar login com e-mail e senha hash (Argon2), validar tokens JWT recebidos no cabeçalho `Authorization`, conferir assinaturas digitais ou chaves de API.
- **Quando usar**: Para responder de forma irrefutável à pergunta de segurança: *"Quem é o solicitante?"*.
- **Quando NÃO usar**:
  - Não use para verificar se o usuário já identificado tem permissão para uma ação restrita (use `AUTHORIZE`).
  - Não use para checar se os dados da requisição contêm tipos corretos (use `VALIDATE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    AUTHENTICATE USER
  }
  ```
- **Comportamento Transacional & Saga**: Operação de verificação criptográfica; gera contexto de sessão ou token. Idempotente sob o prisma do domínio de negócio.

---

#### 12. `AUTHORIZE`
- **Definição Semântica**: Inspeciona a matriz de controle de acesso (RBAC ou ABAC) e determina se a identidade autenticada possui os privilégios necessários para executar uma operação específica sobre um recurso.
- **Para que serve**: Verificar se um cliente comum possui permissão para emitir estornos (`payments.refund`), checar alçadas financeiras ou validar escopos OAuth2.
- **Quando usar**: Para responder à pergunta regulatória: *"Este usuário autenticado tem permissão legal para executar esta ação específica neste momento?"*.
- **Quando NÃO usar**:
  - Não use para checar senhas ou emitir sessões (use `AUTHENTICATE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    AUTHORIZE PAYMENT_SCOPE
  }
  ```
- **Comportamento Transacional & Saga**: Avaliação booleana em memória/cache de políticas. Rejeições disparam exceções de violação de segurança (`SECURITY_VIOLATION`) abortando o pipeline imediatamente.

---

#### 13. `NOTIFY`
- **Definição Semântica**: Dispara mensagens de notificação, alertas em tempo real ou avisos de evento para usuários humanos ou serviços terceiros através de canais de comunicação.
- **Para que serve**: Enviar mensagens de SMS, notificações push em aplicativos móveis, alertas corporativos no Slack/Teams ou webhooks para parceiros comerciais.
- **Quando usar**: Para informar o destinatário sobre um fato já ocorrido de forma assíncrona e sem bloquear o processamento principal.
- **Quando NÃO usar**:
  - Não use para publicar mensagens estruturadas que devam ser processadas transacionalmente por outros nós do cluster (use `PUBLISH`).
  - Não use para entrega física de mercadorias (use `DISPATCH`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    NOTIFY USER
    NOTIFY SLACK
  }
  FLOW {
    PARALLEL {
      NOTIFY USER
      NOTIFY SLACK
    }
  }
  ```
- **Comportamento Transacional & Saga**: Operação externa no mundo real (uma notificação lida não pode ser fisicamente desfeita). Se um fluxo for revertido, a estratégia recomendada é disparar uma notificação de retificação (`NOTIFY CANCELLATION`).

---

#### 14. `SYNC`
- **Definição Semântica**: Executa conciliação bidirecional ou propagação diferencial de dados entre nós distribuídos, réplicas secundárias ou sistemas corporativos legados.
- **Para que serve**: Sincronizar dados de produtos entre banco local e ERP SAP, replicar catálogo para filiais remotas ou atualizar réplicas de leitura com a réplica mestre.
- **Quando usar**: Quando duas ou mais bases de dados independentes precisam alcançar consistência de dados em comum.
- **Quando NÃO usar**:
  - Não use para gravar um único registro novo no banco relacional local (use `CREATE` ou `STORE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    SYNC INVENTORY_CATALOG
  }
  ```
- **Comportamento Transacional & Saga**: Idempotente. Múltiplas execuções sucessivas de `SYNC` convergem para o mesmo estado sem duplicar dados.

---

#### 15. `ROUTE`
- **Definição Semântica**: Analisa os metadados de uma requisição e direciona o tráfego ou a intenção para o endpoint físico, microsserviço ou cluster ideal.
- **Para que serve**: Roteamento baseado em geolocalização do usuário, balanceamento de carga entre zonas de disponibilidade, roteamento por contrato de SLA.
- **Quando usar**: Em malhas de serviços (service mesh), proxies inteligentes ou nós de federação do protocolo INP.
- **Quando NÃO usar**:
  - Não use para estruturar as etapas de negócio de um pedido (use blocos de fluxo como `SEQUENCE` ou `PARALLEL`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    ROUTE INTENT_FEDERATION
  }
  ```
- **Comportamento Transacional & Saga**: Ação de infraestrutura de rede, sem alteração de dados de negócio.

---

#### 16. `COMPOSE`
- **Definição Semântica**: Reúne fragmentos de dados, respostas parciais e payloads de múltiplos microsserviços e transforma-os num modelo unificado de resposta consolidada.
- **Para que serve**: Montar o painel analítico agregando dados de vendas, estoque e logística; compor a resposta final de checkout contendo frete, taxa e detalhes de pagamento.
- **Quando usar**: Na fase final de pipelines orquestrados (após execuções em paralelo) para fornecer um único JSON conciso ao cliente.
- **Quando NÃO usar**:
  - Não use para salvar dados de forma permanente no disco (use `STORE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    COMPOSE CHECKOUT_SUMMARY
  }
  ```
- **Comportamento Transacional & Saga**: Transformação lógica em memória. Idempotente e isenta de efeitos colaterais.

---

#### 17. `FETCH`
- **Definição Semântica**: Realiza consulta ativa e recuperação de informações em serviços remotos, APIs externas de parceiros, camadas de cache ou depósitos físicos.
- **Para que serve**: Buscar dados de rastreamento nos Correios/FedEx, consultar cotação de moedas em tempo real no Banco Central, recuperar previsão do tempo.
- **Quando usar**: Sempre que a obtenção da informação envolver I/O de rede externa ou consulta a nós remotos fora do contexto local imediato.
- **Quando NÃO usar**:
  - Não use para ler um registro simples da tabela local do seu próprio banco de dados (use `READ`).
  - Não use para checagem rápida de disponibilidade sem retorno do objeto completo (use `CHECK`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    FETCH INVENTORY
    FETCH CURRENCY_RATES
  }
  ```
- **Comportamento Transacional & Saga**: Operação segura de leitura (safe read). Não necessita de compensação.

---

#### 18. `STORE`
- **Definição Semântica**: Grava fisicamente dados brutos, payloads intermediários, snapshots de estado ou artefatos em camadas de persistência (PostgreSQL, Redis, S3).
- **Para que serve**: Salvar o rascunho de um carrinho de compras, gravar o payload bruto retornado por um fornecedor externo ou persistir chave-valor em cache.
- **Quando usar**: Quando o objetivo for a persistência técnica pura e armazenamento de dados em mídias físicas ou caches.
- **Quando NÃO usar**:
  - Não use quando estiver criando uma entidade formal de domínio que dispara regras de negócio e eventos de ciclo de vida (use `CREATE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    STORE EXECUTION_LOG
    STORE ORDER
  }
  ```
- **Comportamento Transacional & Saga**: Mutante. A compensação típica é a remoção da chave ou registro via `DELETE`.

---

#### 19. `CALCULATE`
- **Definição Semântica**: Aplica formulações matemáticas, cálculos financeiros ou operações lógicas determinísticas sobre parâmetros numéricos.
- **Para que serve**: Calcular o valor de imposto sobre valor agregado (IVA), estimar prazo e preço de frete a partir de peso e coordenadas, calcular descontos promocionais escalonados.
- **Quando usar**: Quando a operação for uma função pura que recebe números ou variáveis de contexto e devolve um valor calculado.
- **Quando NÃO usar**:
  - Não use quando o cálculo depender de chamadas externas de rede para obter dados (combine `FETCH` para obter as cotações e em seguida `CALCULATE` para o resultado).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    CALCULATE TAX
    CALCULATE SHIPPING_COST
  }
  ```
- **Comportamento Transacional & Saga**: Função matemática pura, totalmente determinística e idempotente.

---

#### 20. `REFUND`
- **Definição Semântica**: Realiza o estorno de valores financeiros cobrados previamente, debitando a conta recebedora e creditando a conta de origem do pagador.
- **Para que serve**: Devolver o dinheiro de uma compra após desistência do consumidor, compensar um débito indevido ou estornar transação em falhas de orquestração.
- **Quando usar**: Em fluxos de pós-venda, devoluções comerciais ou como ação de compensação mandatória para transações financeiras (`EXECUTE PAYMENT`).
- **Quando NÃO usar**:
  - Não use para cancelar reservas de produtos físicos em estoque (use `RELEASE STOCK`).
  - Não use para cancelar ordens sem dinheiro envolvido (use `CANCEL ORDER`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    REFUND PAYMENT
  }
  ```
- **Comportamento Transacional & Saga**: Ação de compensação por excelência no padrão Saga. Deve possuir chave de idempotência rigorosa para evitar estornos duplicados.

---

#### 21. `CANCEL`
- **Definição Semântica**: Interrompe formalmente a continuidade de um processo de negócio, invalidando contratos, reservas ou ordens ativas e marcando-os como "CANCELADO".
- **Para que serve**: Cancelar uma remessa antes de ser coletada pelo caminhão, cancelar agendamento de consulta médica, abortar contrato de serviço antes da ativação.
- **Quando usar**: Para transicionar o estado de um ciclo de vida de negócio de "ATIVO" ou "PENDENTE" para "CANCELADO".
- **Quando NÃO usar**:
  - Não use para realizar estorno de dinheiro de volta ao cartão do cliente (use `REFUND`).
  - Não use para deletar fisicamente o registro do banco de dados (use `DELETE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    CANCEL SHIPMENT
    CANCEL ORDER
  }
  ```
- **Comportamento Transacional & Saga**: Ação de encerramento ou compensação. Tipicamente idempotente.

---

#### 22. `APPROVE`
- **Definição Semântica**: Registra a autorização formal de uma proposta ou requisição que aguardava parecer administrativo, validação de conformidade ou liberação de alçada.
- **Para que serve**: Aprovar concessão de limite de crédito para cliente, aprovar cadastro de novo parceiro comercial na rede, autorizar requisição de compra corporativa.
- **Quando usar**: Em fluxos de governança que exigem validação manual, dupla checagem ou pontuação de aprovação automática acima do limiar.
- **Quando NÃO usar**:
  - Não use para validações automáticas de schema técnico de dados (use `VALIDATE`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    APPROVE CREDIT_LIMIT
  }
  ```
- **Comportamento Transacional & Saga**: Transição de estado de negócio para "APROVADO". Caso ocorra rollback posterior, a compensação associada é o `REJECT` ou `CANCEL`.

---

#### 23. `REJECT`
- **Definição Semântica**: Recusa formally uma solicitação, pedido de adesão ou transação, encerrando o fluxo em conformidade com as regras de governança e auditoria.
- **Para que serve**: Rejeitar sinistro de seguro por falta de cobertura, recusar transação de alto risco identificada pela análise de fraude, reprovar cadastro com dados incorretos.
- **Quando usar**: Para formalizar a recusa de uma intenção que dependia de avaliação prévia.
- **Quando NÃO usar**:
  - Não use para tratar falhas transitórias de conexão de rede ou erros 500 de servidores (use blocos de resiliência `RETRY` e `TIMEOUT`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    REJECT LOAN_PROPOSAL
  }
  ```
- **Comportamento Transacional & Saga**: Estado terminal. Uma intenção rejeitada encerra a transação com registro no log de auditoria.

---

### Detalhamento dos 8 Verbos Operacionais & Transacionais Adicionais

#### 24. `CHECK`
- **Definição Semântica**: Consulta instantânea de estado ou disponibilidade de recursos sem realizar alocações, reservas ou mutações.
- **Para que serve**: Verificar se um produto está disponível na prateleira (`CHECK STOCK`), consultar a saúde de um nó (`CHECK HEALTH`), checar saldo da conta (`CHECK BALANCE`).
- **Diferença com `FETCH` e `RESERVE`**: O `CHECK` apenas responde se o recurso existe e está disponível no instante atual. O `FETCH` busca e transfere os dados completos. O `RESERVE` bloqueia ativamente o recurso para que ninguém mais possa comprá-lo.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    CHECK STOCK
  }
  ```
- **Transacional**: Somente leitura, puramente idempotente e de baixíssima latência.

---

#### 25. `RESERVE`
- **Definição Semântica**: Bloqueia e retém temporariamente uma quantidade específica de recursos (produtos, assentos, saldo financeiro) com tempo de expiração (TTL).
- **Para que serve**: Reter 1 unidade de produto no armazém por 15 minutos enquanto o pagamento é processado no gateway externo.
- **Diferença com `CHECK` e `CREATE`**: `CHECK` não retém o recurso; `CREATE` cria um recurso novo. `RESERVE` diminui temporariamente a disponibilidade pública do recurso existente.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    RESERVE STOCK
  }
  ```
- **Transacional & Saga**: Exige ação compensatória obrigatória: se a compra não for concluída, o orquestrador dispara automaticamente `RELEASE STOCK` para disponibilizar o produto novamente.

---

#### 26. `RELEASE`
- **Definição Semântica**: Desbloqueia e devolve à disponibilidade geral recursos previamente retidos pelo verbo `RESERVE`.
- **Para que serve**: Liberar o estoque reservado após o cartão de crédito do cliente ser rejeitado, desbloquear assentos em voos após expiração do tempo de checkout.
- **Diferença com `DELETE`**: `DELETE` remove o item do banco de dados para sempre; `RELEASE` devolve o item para a prateleira comercial.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    RELEASE STOCK
  }
  ```
- **Transacional & Saga**: Ação primária de compensação no padrão Saga para reversão de reservas. Deve ser estritamente idempotente.

---

#### 27. `SEND`
- **Definição Semântica**: Realiza a expedição física ou digital direta de um artefato específico ou mensagem a um destinatário definido.
- **Para que serve**: Enviar recibo fiscal por e-mail, enviar fatura anexada, expedir pacote físico de mercadorias.
- **Diferença com `NOTIFY` e `PUBLISH`**: `NOTIFY` foca no alerta leve de status; `PUBLISH` emite um evento no barramento para múltiplos assinantes; `SEND` transfere um payload de entrega pontual.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    SEND CONFIRMATION
    SEND INVOICE
  }
  ```
- **Transacional**: Comunicação no mundo real, com efeito colateral persistente.

---

#### 28. `DISPATCH`
- **Definição Semântica**: Aciona a execução de trabalhadores assíncronos em segundo plano ou despacha tarefas operacionais para a cadeia logística física.
- **Para que serve**: Acionar worker de fila para codificação de vídeo, notificar transportadora para retirada de encomenda no armazém.
- **Diferença com `EXECUTE`**: `EXECUTE` roda comandos no fluxo síncrono imediato; `DISPATCH` aciona operações delegadas e desacopladas.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    DISPATCH SHIPMENT
    DISPATCH WORKER
  }
  ```
- **Transacional**: Disparo desacoplado de execuções em background.

---

#### 29. `PUBLISH`
- **Definição Semântica**: Emite um evento de negócio ou mensagem formatada para um tópico em um barramento distribuído (ex.: Apache Kafka, RabbitMQ, Redis Pub/Sub).
- **Para que serve**: Notificar o ecossistema distribuído de que um evento de domínio ocorreu (ex.: `ORDER_PLACED`), desacoplando produtores de consumidores.
- **Diferença com `NOTIFY`**: `NOTIFY` é voltado a pessoas ou webhooks pontuais; `PUBLISH` é a espinha dorsal de Arquiteturas Orientadas a Eventos (EDA).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    PUBLISH ORDER_EVENT
  }
  ```
- **Transacional & Saga**: O evento emitido deve carregar a chave de correlação (`correlationId`) para permitir rastreamento distribuído e eventos compensatórios.

---

#### 30. `ARCHIVE`
- **Definição Semântica**: Transfere dados inativos ou históricos de tabelas operacionais de alta velocidade para repositórios frios com retenção imutável.
- **Para que serve**: Arquivar logs de auditoria após 1 ano, mover pedidos antigos para storage em nuvem de baixo custo, cumprir conformidade SOC2 e ISO 27001.
- **Diferença com `DELETE`**: `DELETE` destrói o dado; `ARCHIVE` preserva a integridade e histórico do dado para fiscalização futura fora do banco de produção.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    ARCHIVE AUDIT_LOGS
  }
  ```
- **Transacional**: Idempotente e focado em governança de dados.

---

#### 31. `AUDIT`
- **Definição Semântica**: Inspeciona a integridade das trilhas forenses, assinaturas criptográficas e conformidade das transações registradas no sistema.
- **Para que serve**: Verificar se os registros do banco sofreram adulterações, validar conformidade de relatórios financeiros, auditar permissões de usuários.
- **Diferença com `VALIDATE`**: `VALIDATE` checa o payload antes de executar; `AUDIT` examina o que foi executado para garantir lisura forense.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    AUDIT TRANSACTION_TRAIL
  }
  ```
- **Transacional**: Somente leitura analítica especializada em segurança.

---

### Detalhamento dos 14 Verbos Estratégicos & Anti-Estresse (v2.6)

#### 32. `COALESCE`
- **Definição Semântica**: Implementa o padrão *Single-Flight*: colapsa requisições concorrentes idênticas em voo numa única chamada real ao microsserviço, partilhando o mesmo resultado com todas as requisições aguardando.
- **Para que serve**: Eliminar o efeito *Thundering Herd* perante expiração de cache ou picos de tráfego instantâneo sobre relatórios ou métricas pesadas.
- **Quando usar**: Em endpoints de leitura intensiva onde centenas de clientes solicitam o mesmo dado simultaneamente.
- **Quando NÃO usar**: Em operações com mutações ou efeitos colaterais de negócio únicos por utilizador (ex: pagamentos).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    COALESCE METRICS_SNAPSHOT
  }
  ```

#### 33. `MEMOIZE`
- **Definição Semântica**: Realiza cache-aside transparente em memória com geração de chave criptográfica SHA-256 e TTL (tempo de vida) estritamente delimitado.
- **Para que serve**: Armazenar resultados de cálculos matemáticos pesados ou consultas idempotentes repetitivas sem tráfego de rede desnecessário.
- **Quando usar**: Tabelas de frete, alíquotas fiscais, catálogos de produtos e dados que mudam com baixa frequência.
- **Quando NÃO usar**: Dados em tempo real voláteis que requerem consistência estrita imediata.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    MEMOIZE TAX_CALCULATION
  }
  ```

#### 34. `GUARD`
- **Definição Semântica**: Barreira defensiva *fail-fast* que avalia invariantes críticas e regras de validação em memória antes de consumir qualquer recurso de rede.
- **Para que serve**: Abortar instantaneamente requisições com dados absurdos (ex.: `amount <= 0`) sem onerar microsserviços nem gastar conexões no pool.
- **Quando usar**: No início de qualquer sequência de transações como pré-condição obrigatória.
- **Quando NÃO usar**: Quando a validação depender de consultas dinâmicas em bancos de dados remotos.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    GUARD "amount > 0"
  }
  ```

#### 35. `THROTTLE`
- **Definição Semântica**: Modula e cadencia a taxa de requisições por segundo através do algoritmo *Token Bucket*, enfileirando ou contendo picos de estresse.
- **Para que serve**: Proteger microsserviços legados ou respeitar cotas estritas de rate limiting de APIs externas parceiras.
- **Quando usar**: Comunicação com provedores de terceiros (ex: bureaus de crédito, APIs de mensageria).
- **Quando NÃO usar**: Em rotinas internas de baixíssima latência que não possuem limites de taxa.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    THROTTLE LEGACY_CRM
  }
  ```

#### 36. `BATCH`
- **Definição Semântica**: Fraciona coleções volumosas em lotes (*chunks*) seguros pré-dimensionados, eliminando a sobrecarga de memória e o problema N+1.
- **Para que serve**: Processar milhares de pedidos, pagamentos em lote ou sincronizações de inventário em fatias seguras de 50 ou 100 itens.
- **Quando usar**: Sempre que a carga útil de entrada for uma lista de entidades arbitrária.
- **Quando NÃO usar**: Operações atômicas de registro único.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    BATCH CHUNK_ORDERS
  }
  ```

#### 37. `DEFER`
- **Definição Semântica**: Padrão *Transactional Outbox*: desacopla tarefas secundárias da resposta síncrona do motor, persistindo a intenção na tabela `queue_jobs`.
- **Para que serve**: Enviar notificações por email, gerar relatórios em PDF ou despachar analíticos em segundo plano liberando a API imediatamente.
- **Quando usar**: Passos não-bloqueantes onde o cliente não precisa aguardar o retorno para continuar sua navegação.
- **Quando NÃO usar**: Etapas transacionais que definem o sucesso da operação (ex.: débito bancário).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    DEFER EMAIL_NOTIFICATION
  }
  ```

#### 38. `MERGE`
- **Definição Semântica**: Fusão profunda declarativa que combina múltiplos fragmentos ou saídas parciais de passos prévios num único objeto coerente.
- **Para que serve**: Unir dados de perfil, histórico de pedidos e preferências vindos de 3 microsserviços diferentes em um payload único.
- **Quando usar**: Em orquestrações de agregação (*API Composition Pattern*).
- **Quando NÃO usar**: Quando apenas o resultado do último passo for relevante para a saída.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    MERGE USER_AGGREGATE
  }
  ```

#### 39. `AWAIT`
- **Definição Semântica**: Suspensão reativa de Saga: persiste o estado da execução como `SUSPENDED` no PostgreSQL e liberta a thread do motor, aguardando retoma externa.
- **Para que serve**: Fluxos com confirmação assíncrona por webhook (ex: confirmação de Pix, callback de adquirente bancária).
- **Quando usar**: Quando uma etapa depender de um evento externo de tempo indeterminado.
- **Quando NÃO usar**: Para chamadas síncronas que respondem em menos de alguns segundos.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    AWAIT PAYMENT_CONFIRMATION
  }
  ```

#### 40. `PROBE`
- **Definição Semântica**: Inspeção de vivacidade ultrarrápida (*Zero-IO Health Check*) que consulta métricas em memória (<1ms) diretamente no `ServiceMetricsCollector`.
- **Para que serve**: Checagem de disponibilidade antes de disparar operações de altíssimo valor financeiro.
- **Quando usar**: Guardrails operacionais antes de fluxos pesados.
- **Quando NÃO usar**: Para testes de caixa-preta ou monitoramento sintético profundo.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    PROBE CORE_GATEWAY
  }
  ```

#### 41. `SHADOW`
- **Definição Semântica**: Disparo assíncrono espelho (*Dark Launching / Canary*): duplica a requisição para um serviço experimental em homologação sem afetar o cliente.
- **Para que serve**: Validar novas versões de microsserviços sob tráfego de produção real com zero risco de impacto ao usuário.
- **Quando usar**: Migrações de arquitetura e testes comparativos de precisão/latência.
- **Quando NÃO usar**: Em serviços espelho que possam gerar cobranças reais duplicadas (sem sandbox).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    SHADOW CANARY_PAYMENT
  }
  ```

#### 42. `REDACT`
- **Definição Semântica**: Higienização e mascaramento irreversível de dados sensíveis (senhas, cartões, tokens, CPFs) antes de gravação em logs ou telemetria.
- **Para que serve**: Cumprimento estrito de normas de privacidade LGPD, GDPR e requisitos PCI-DSS de proteção de credenciais.
- **Quando usar**: Antes de persistir qualquer trilha em logs ou transmitir eventos para ferramentas de terceiros.
- **Quando NÃO usar**: Em fluxos internos seguros que ainda necessitam da credencial em texto puro para criptografar.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    REDACT PASSWORD_TOKEN
  }
  ```

#### 43. `CHECKPOINT`
- **Definição Semântica**: Gravação explícita de um marco intermediário do estado de execução no banco de dados para recuperação cirúrgica.
- **Para que serve**: Salvar o estado de processamento após etapas pesadas de um pipeline para que falhas posteriores não exijam reexecução integral.
- **Quando usar**: Pipelines de dados em múltiplos estágios e transações multipartes.
- **Quando NÃO usar**: Em fluxos triviais de passo único.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    CHECKPOINT STAGE_1_PASSED
  }
  ```

#### 44. `SIMULATE`
- **Definição Semântica**: Injeção controlada de falhas sintéticas, latência artificial ou respostas simuladas (*Chaos Engineering*).
- **Para que serve**: Testar o comportamento do motor, disjuntores de circuito e compensações de Saga em ambientes de desenvolvimento e homologação.
- **Quando usar**: Testes de resiliência, validação de failover e benchmarks de estresse.
- **Quando NÃO usar**: Em ambiente de produção ativo.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    SIMULATE LATENCY_200MS
  }
  ```

#### 45. `FANOUT`
- **Definição Semântica**: Dispersão paralela com contrapressão estrita (*Bounded Concurrency*): distribui trabalho para múltiplos nós sem esgotar o pool de conexões.
- **Para que serve**: Notificar 500 parceiros ou consultar 30 fornecedores simultaneamente mantendo a concorrência contida em lotes de 5 ou 10 por vez.
- **Quando usar**: Dispersões paralelas em larga escala.
- **Quando NÃO usar**: Quando houver menos de 3 tarefas simultâneas (use `PARALLEL`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    FANOUT MULTI_NOTIFY
  }
  ```

---

### Detalhamento dos 5 Verbos Revolucionários ("Killer Features" - v2.7)

#### 46. `STREAM`
- **Definição Semântica**: Emissão progressiva em tempo real: transmite deltas e fragmentos de resposta através de Server-Sent Events (SSE) ou WebSockets sem bloquear o motor.
- **Para que serve**: Habilitar streaming de respostas de IA generativa (estilo ChatGPT/Copilot), atualizações de cotações financeiras ao vivo e telemetria contínua.
- **Quando usar**: Quando o cliente precisa consumir dados conforme eles são produzidos sem aguardar o processamento completo.
- **Quando NÃO usar**: Em comandos atômicos transacionais que dependem de confirmação única binária.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    STREAM AI_RESPONSE
  }
  FLOW {
    SEQUENCE {
      STREAM AI_RESPONSE
    }
  }
  OUTPUT {
    FORMAT "event"
  }
  ```

#### 47. `ATTEST`
- **Definição Semântica**: Prova criptográfica inviolável de estado: gera um selo determinístico com HMAC-SHA256 atestando a integridade dos dados e o estado da transação.
- **Para que serve**: Cumprimento estrito de conformidade SOC2, HIPAA, ISO 27001 e auditoria regulatória em operações financeiras e de saúde.
- **Quando usar**: Ao concluir transferências de alto valor, auditorias de acesso privilegiado ou aprovações formais de crédito.
- **Quando NÃO usar**: Em consultas efêmeras ou requisições de leitura de baixa relevância.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    ATTEST PROOF_OF_STATE
  }
  ```

#### 48. `ADAPT`
- **Definição Semântica**: Roteamento adaptativo inteligente baseado no algoritmo *Multi-Armed Bandit* ($\epsilon$-greedy): seleciona dinamicamente a melhor rota com base em métricas de latência e taxa de erro em tempo real.
- **Para que serve**: Balancear tráfego entre múltiplos provedores de microsserviços (ex.: adquirentes de cartão A, B e C), desviando de falhas antes que o usuário perceba lentidão.
- **Quando usar**: Cenários com múltiplos provedores redundantes sujeitos a degradações pontuais de rede.
- **Quando NÃO usar**: Quando houver apenas um provedor fixo cadastrado para a capacidade.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    ADAPT PROVIDER_A PROVIDER_B
  }
  ```

#### 49. `ESCALATE`
- **Definição Semântica**: Supervisão *Human-in-the-Loop* (HITL): suspende a Saga perante transações suspeitas ou de alto risco, emitindo token de decisão e prazo de SLA para deliberação humana formal.
- **Para que serve**: Prevenção de fraudes financeiras, liberação de empréstimos vultosos ou aprovação de operações sensíveis de infraestrutura.
- **Quando usar**: Quando um score de risco ultrapassar o limiar de segurança e exigir aprovação expressa de um gerente ou operador humano.
- **Quando NÃO usar**: Em fluxos 100% automatizados de alta velocidade que não admitem intervenção manual.
- **Exemplo DSL**:
  ```text
  REQUIRE {
    ESCALATE COMPLIANCE_OFFICER
  }
  ```

#### 50. `REASON`
- **Definição Semântica**: Deliberação racional estruturada (*Chain-of-Thought*): executa reflexão agêntica avaliando hipóteses, prós, contras e escores de confiança com fundamentação auditável da decisão.
- **Para que serve**: Orquestração de agentes autônomos de IA que precisam tomar decisões explicáveis, tais como triagem clínica, aprovação de crédito ou diagnóstico de sistemas.
- **Quando usar**: Processos complexos de tomada de decisão onde a justificativa formal é tão importante quanto a decisão em si.
- **Quando NÃO usar**: Validações determinísticas simples de esquemas ou invariantes (use `VALIDATE` ou `GUARD`).
- **Exemplo DSL**:
  ```text
  REQUIRE {
    REASON FRAUD_DECISION
  }
  ```

---

### Guia Rápido: Como Escolher o Verbo Correto? (Árvore de Decisão Rápida)

Quando estiver modelando um fluxo ou registrando um microsserviço no INP Protocol, faça as seguintes perguntas:

1. **A ação cria um registro de negócio com ID próprio?** ➔ Use `CREATE`. (Se for só gravação em cache/storage, use `STORE`).
2. **A ação lê dados do seu próprio banco ou de uma API externa?** ➔ Do próprio banco: use `READ`. De uma API externa: use `FETCH`.
3. **A ação apenas verifica disponibilidade sem reter nada?** ➔ Use `CHECK`. (Se precisar bloquear o item com prazo, use `RESERVE`).
4. **O fluxo falhou e você precisa desfazer a reserva de estoque?** ➔ Use `RELEASE`.
5. **O fluxo falhou e você precisa devolver o dinheiro cobrado?** ➔ Use `REFUND`.
6. **A ação altera status de negócio para cancelado ou aprovado?** ➔ Use `CANCEL` ou `APPROVE`.
7. **A ação envolve cobrança financeira atômica imediata?** ➔ Use `EXECUTE PAYMENT`.
8. **A ação precisa checar quem é a pessoa vs quais as permissões dela?** ➔ Quem é: use `AUTHENTICATE`. Permissões: use `AUTHORIZE`.
9. **A ação calcula valores com fórmulas matemáticas puras?** ➔ Use `CALCULATE`.
10. **A ação avisa pessoas sobre o resultado de forma leve?** ➔ Use `NOTIFY`.
11. **A ação emite dados para múltiplos microsserviços em mensageria?** ➔ Use `PUBLISH`.
12. **Muitos clientes pedem o mesmo dado pesado ao mesmo tempo?** ➔ Use `COALESCE` (Single-Flight).
13. **O resultado de uma consulta muda raramente e pode ficar em memória?** ➔ Use `MEMOIZE`.
14. **Você quer barrar parâmetros inválidos antes de gastar rede?** ➔ Use `GUARD` (Fail-Fast).
15. **A API externa limita requisições por segundo?** ➔ Use `THROTTLE` (Token Bucket).
16. **Você precisa processar uma lista grande de dados sem travar?** ➔ Use `BATCH` (Chunking).
17. **O cliente não precisa esperar a conclusão desta etapa?** ➔ Use `DEFER` (Outbox).
18. **A etapa depende de um webhook externo futuro?** ➔ Use `AWAIT`.
19. **Você quer transmitir tokens de IA em tempo real para a UI?** ➔ Use `STREAM`.
20. **A operação exige recibo criptográfico auditável para conformidade legal?** ➔ Use `ATTEST`.
21. **Você tem múltiplos provedores e quer desviar de nós lentos?** ➔ Use `ADAPT`.
22. **A transação é de alto risco e exige aprovação de um gerente humano?** ➔ Use `ESCALATE`.
23. **Um agente de IA precisa justificar o raciocínio de sua decisão?** ➔ Use `REASON`.

