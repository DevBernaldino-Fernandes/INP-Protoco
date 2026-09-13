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
Declara a lista de capacidades indispensáveis para que a intenção possa ser aceita para execução. Cada linha define um par `VERBO ALVO`.
- **Verbos Válidos**: `CREATE`, `READ`, `UPDATE`, `DELETE`, `EXECUTE`, `PROCESS`, `ANALYZE`, `GENERATE`, `TRANSFER`, `VALIDATE`, `AUTHENTICATE`, `AUTHORIZE`, `NOTIFY`, `SYNC`, `ROUTE`, `COMPOSE`, `FETCH`, `STORE`, `CALCULATE`, `REFUND`, `CANCEL`, `APPROVE`, `REJECT`.
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
