# Auditoria e Hardening de Segurança - INP Protocol

Este documento apresenta a análise de segurança em profundidade realizada no **Intent Network Protocol (INP)**, cobrindo modelagem de ameaças (STRIDE), vulnerabilidades identificadas, severidade de riscos e o guia de implementação de blindagem recomendada.

---

## 1. Matriz de Ameaças (STRIDE)

| Categoria STRIDE | Cenário de Risco no INP | Mecanismo Atual | Status / Avaliação |
| :--- | :--- | :--- | :--- |
| **Spoofing** (Falsificação) | Clientes ou nós forjando identidade ou fingindo ser microsserviços legítimos | Registro exige `X-Registration-Token`; nós P2P usam chaves ECDSA | **Atenção**: Registro P2P não exige token; chaves P2P são efêmeras em memória |
| **Tampering** (Adulteração) | Modificação de payloads em trânsito ou bypass de validação de esquemas | JSON Schema (AJV) estrito antes de invocar serviços externos | **Seguro**: Contratos são compilados e validados rigorosamente |
| **Repudiation** (Repúdio) | Negação de operações financeiras ou comandos executados | Tabelas `executions` e `saga_states` com logs e timestamps | **Seguro**: Auditoria persistida em banco relacional |
| **Information Disclosure** (Vazamento) | Exposição de dados de contexto confidenciais (cartões, senhas, PII) | `CryptoEngine` (AES-256-GCM) em passos `ENCRYPT`/`DECRYPT` | **Crítico**: O stream SSE `/api/telemetry` transmite contexto integral sem autenticação |
| **Denial of Service** (Negação de Serviço) | Esgotamento de conexões ou flooding de intenções pesadas | RateLimit (100 req/15min), Circuit Breaker e `SKIP LOCKED` | **Atenção**: Transação DB longa no `QueueWorker` pode causar connection starvation |
| **Elevation of Privilege** (Elevação de Privilégio) | Usuário sem papel executando capacidades restritas | Validação de RBAC (`requiredPermissions` vs `securityContext`) | **Seguro**: Verificação antes da execução de cada ação folha |

---

## 2. Vulnerabilidades Identificadas e Plano de Mitigação

### Vulnerabilidade 1: Stream SSE `/api/telemetry` Aberto e Vazamento de Dados Sensíveis
*   **Severidade**: **CRÍTICA** (CVSS: 9.1)
*   **Localização**: `src/api/server.ts:91-109`, `src/core/execution-engine.ts:66, 205`
*   **Descrição**: O endpoint `/api/telemetry` permite conexões sem qualquer autenticação (sem token JWT, Bearer ou API Key). Em tempo de execução, o `ExecutionEngine` faz broadcast de `EXECUTION_STARTED` e `STEP_STARTED` contendo o objeto `context` e `input` brutos. Se um fluxo contiver dados de cartões, senhas ou dados bancários, qualquer usuário que acesse o endpoint no navegador ou via script intercepta essas informações em tempo real.
*   **Remediação Recomendada**:
    1. Proteger `/api/telemetry` com middleware de autenticação (ex: JWT ou token de operador).
    2. Sanitizar dados confidenciais nos eventos de telemetria utilizando mascaramento (redaction) automático de campos como `card_token`, `password`, `secret_key`, etc.

---

### Vulnerabilidade 2: Falta de Autenticação no Registro e Execução Federada P2P
*   **Severidade**: **ALTA** (CVSS: 8.2)
*   **Localização**: `src/api/server.ts:522-567`
*   **Descrição**: As rotas `/api/peers/register` e `/api/peers/execute` não solicitam nenhum token de administração. Qualquer ator malicioso na rede interna ou externa pode registrar um nó falso com pontuação de confiança artificial (`trustScore: 95`), sequestrando fluxos de intenção e recebendo dados confidenciais do usuário.
*   **Remediação Recomendada**:
    1. Aplicar validação com `X-Registration-Token` ou lista de permissão (mTLS / CA confiável) no registro de peers.
    2. Na rota `/api/peers/execute`, validar previamente se a chave pública do requisitante pertence a um nó peer previamente autorizado.

---

### Vulnerabilidade 3: Par de Chaves P2P Efêmero e Falta de Canonicalização JSON
*   **Severidade**: **MÉDIA-ALTA** (CVSS: 7.0)
*   **Localização**: `src/core/intent-federation.ts:21-29, 103, 114`
*   **Descrição**:
    1. Ao inicializar, o singleton `IntentFederation` gera um novo par de chaves ECDSA na memória RAM. Ao reiniciar o servidor INP, as chaves mudam, quebrando a confiança de todos os nós previamente federados.
    2. A assinatura digital assina `JSON.stringify(payload)`. Em JavaScript, a ordenação de propriedades de objetos não é determinística entre diferentes ambientes ou parsers, permitindo falhas espúrias de assinatura e vulnerabilidades de ataque de maleabilidade de assinatura.
*   **Remediação Recomendada**:
    1. Carregar chave privada e certificado público de arquivos persistentes configurados via variáveis de ambiente (`INP_P2P_PRIVATE_KEY_PATH`, `INP_P2P_PUBLIC_KEY_PATH`).
    2. Adotar biblioteca de canonicalização RFC 8785 (ex: `canonical-json` ou `fast-json-stable-stringify`).

---

### Vulnerabilidade 4: Salt Estático e Fallback Indevido no CryptoEngine
*   **Severidade**: **MÉDIA** (CVSS: 6.5)
*   **Localização**: `src/core/crypto-engine.ts:27-28, 81-86`
*   **Descrição**:
    1. O derivador de chave `crypto.scryptSync(keyRaw, 'salt', 32)` utiliza a palavra literal `'salt'` fixa como salt. Isso anula a resistência do KDF contra ataques pré-computados (tabelas rainbow).
    2. O método `decrypt` possui um fallback cego para decodificação Base64 caso o texto não possua o formato delimitado por dois-pontos. Isso pode produzir saídas corrompidas ou comportamento inesperado se o dado de entrada for inválido.
*   **Remediação Recomendada**:
    1. Utilizar um salt configurável por ambiente (`INP_KEY_SALT`) ou gerar chaves de 32 bytes completas diretamente com entropia criptográfica (`crypto.randomBytes(32)`).
    2. Lançar exceção estrita quando a decifragem falhar, em vez de recorrer a fallbacks silenciosos.

---

### Vulnerabilidade 5: "ZKVerifier" Falso (Não é Zero-Knowledge)
*   **Severidade**: **MÉDIA (Arquitetural / Auditoria de Conformidade)**
*   **Localização**: `src/core/zk-verifier.ts:35-56`
*   **Descrição**: O componente se autodenomina "ZKVerifier" e promete "Zero-Knowledge Intents", mas a implementação exige que o cliente envie `proof.value` (o próprio valor em texto plano!) e `proof.salt`. Trata-se de um esquema de compromisso hash SHA-256 trivial, não de uma prova de conhecimento zero real (zk-SNARK / zk-STARK / Bulletproofs). Chamar isso de Zero-Knowledge em documentação corporativa configura risco de conformidade e auditoria.
*   **Remediação Recomendada**:
    1. Renomear o componente e a documentação para `CommitmentVerifier` (Esquema de Compromisso Criptográfico), ou implementar uma biblioteca real de zk-SNARKs (como Snarkjs / ZoKrates) se for estritamente necessário validar limites sem nunca enviar o valor ao servidor.

---

### Vulnerabilidade 6: Risco de Integridade de Negócio na Autocura com IA (`AISelfHealer`)
*   **Severidade**: **ALTA** (CVSS: 7.8)
*   **Localização**: `src/core/ai-self-healer.ts:42-43`
*   **Descrição**: A diretiva do prompt diz: *"If a value violates a minimum/maximum constraint (e.g. amount is 0.5 but minimum is 1.0), and we are in sandbox/simulation mode, you may adjust the value to the minimum required to allow the execution to proceed."* Permitir que uma IA altere valores financeiros de transações para que passem em esquemas de validação viola o princípio contábil de integridade de dados e pode ser explorado para aprovação indevida de pagamentos.
*   **Remediação Recomendada**:
    1. Restringir a autocura exclusivamente a coerções inofensivas de tipo primitivo (ex: `"150"` -> `150`) e mapeamento de nomes de campos sintaticamente óbvios (`token_card` -> `card_token`).
    2. Proibir explicitamente qualquer alteração de montantes financeiros (`amount`, `balance`, `currency`) ou identificadores de usuários.
