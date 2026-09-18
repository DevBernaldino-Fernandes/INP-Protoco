/**
 * @fileoverview Definições de Tipos e Contratos Nucleares do Protocolo INP
 * @module Core/Types
 * @description
 * Define todas as interfaces, uniões de tipos, estruturas de dados e modelos contratuais
 * que regem o funcionamento do Intent Network Protocol (INP). Abrange a representação
 * de intenções declarativas, passos de fluxo de orquestração, registo de serviços,
 * resultados de execução, telemetria de segurança e contexto transacional.
 *
 * @security Estabelece contratos estritos de segurança, níveis de confiança (trustScore)
 * e permissões requeridas (RBAC) para prevenir acessos não autorizados entre microserviços.
 * @audit Todos os identificadores de execução, carimbos temporais e estados de transação
 * aqui tipificados são essenciais para a rastreabilidade e integridade em auditorias forenses.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * @description Verbos canónicos de intenção reconhecidos pelo motor semântico.
 * Representam as ações semânticas fundamentais executáveis pelos microserviços registados.
 * Agrupados por domínios funcionais: CRUD, Execução/Processamento, Finanças/Saga,
 * Segurança/Identidade, Comunicação/Distribuição e Operações de Recursos.
 */
export type IntentVerb =
  | 'CREATE' | 'READ' | 'UPDATE' | 'DELETE'
  | 'EXECUTE' | 'PROCESS' | 'ANALYZE' | 'GENERATE'
  | 'TRANSFER' | 'VALIDATE' | 'AUTHENTICATE' | 'AUTHORIZE'
  | 'NOTIFY' | 'SYNC' | 'ROUTE' | 'COMPOSE'
  | 'FETCH' | 'STORE' | 'CALCULATE'
  | 'REFUND' | 'CANCEL' | 'APPROVE' | 'REJECT'
  | 'CHECK' | 'RESERVE' | 'RELEASE' | 'SEND'
  | 'DISPATCH' | 'PUBLISH' | 'ARCHIVE' | 'AUDIT'
  | 'FILTER'
  // Verbos Canónicos Adicionais v2.7 (Especificação Completa)
  | 'QUERY' | 'RESOLVE' | 'RETRIEVE' | 'STREAM_READ'
  | 'MUTATE' | 'UPSERT' | 'PATCH' | 'LOOP' | 'BRANCH'
  | 'TRANSFORM' | 'MAP' | 'REDUCE' | 'AGGREGATE' | 'ENRICH'
  | 'ASSERT' | 'SANITIZE' | 'ENFORCE_SCHEMA' | 'CHECK_POLICY'
  // Verbos Estratégicos Anti-Stress v2.6/v2.7
  | 'COALESCE' | 'MEMOIZE' | 'GUARD' | 'THROTTLE'
  | 'BATCH' | 'DEFER' | 'MERGE' | 'AWAIT'
  | 'PROBE' | 'SHADOW' | 'REDACT' | 'CHECKPOINT'
  | 'SIMULATE' | 'FANOUT' | 'RATE_LIMIT' | 'CIRCUIT_BREAKER'
  | 'SHARD' | 'COMPRESS' | 'DEBOUNCE' | 'PRIORITY_QUEUE'
  | 'HEALTH_CHECK' | 'SHED_LOAD' | 'RETRY_BACKOFF' | 'FALLBACK'
  // Verbos Revolucionários v2.7 (Killer Features: Reatividade, IA Agêntica & Prova Criptográfica)
  | 'STREAM' | 'ATTEST' | 'ADAPT' | 'ESCALATE'
  | 'REASON' | 'CONSENSUS'
  // Verbos Criptográficos, Mensageria e Concorrência Distribuída
  | 'TRIGGER' | 'SUBSCRIBE' | 'ENCRYPT' | 'DECRYPT'
  | 'SIGN' | 'VERIFY' | 'LOCK' | 'UNLOCK' | 'ACQUIRE'
  // Verbos de Alta Produtividade e Resolução de Dores Críticas (Anti-Headache & DevOps Resiliente v2.7)
  | 'DEDUPLICATE' | 'REDRIVE' | 'CANARY' | 'DIFF'
  | 'CORRELATE' | 'ISOLATE' | 'ANONYMIZE' | 'DRAIN'
  | 'QUARANTINE' | 'LEASE' | 'BACKPRESSURE' | 'MIGRATE'
  | 'SAMPLE' | 'RECONCILE' | 'CHALLENGE' | 'MUTEX'
  // Verbos de Interconexão entre Sistemas e Desmembramento Descomplicado (Bridge & Ergonomia v2.7)
  | 'BRIDGE' | 'OUTBOUND' | 'INGEST' | 'FANIN'
  | 'EMIT' | 'PLUCK' | 'FLATTEN' | 'MASK'
  | 'CAST' | 'CLAMP' | 'COOLDOWN' | 'UNDO'
  | 'SNAPSHOT' | 'DIVERGE' | 'HEARTBEAT'
  // Novos Verbos Estratégicos de Resiliência, Observabilidade e Dados v2.8 & v2.9
  | 'COMPENSATE' | 'BENCHMARK' | 'NORMALIZE' | 'ENQUEUE' | 'INSPECT'
  | 'TIME_TRAVEL' | 'REPLAY' | 'TIMELINE'
  // 8 Verbos Estratégicos da 9ª Família (IA Vetorial, Finanças Atómicas & Confiabilidade SRE v3.0)
  | 'EMBED' | 'VECTOR_SEARCH' | 'SPLIT' | 'ESCROW'
  | 'POLL' | 'INVALIDATE' | 'DRIFT_DETECT' | 'CHAOS';

/**
 * @description Palavras-chave de controlo de fluxo no grafo de orquestração.
 * Suporta execuções sequenciais, concorrentes, condicionais, com repetição e compensação.
 */
export type FlowControl =
  | 'SEQUENCE' | 'PARALLEL' | 'CONDITION' | 'RETRY'
  | 'FALLBACK' | 'TIMEOUT' | 'DEPENDENCY' | 'PIPELINE' | 'SCOPE';

/**
 * @description Palavras-chave de segurança para políticas declarativas e encriptação no protocolo.
 */
export type SecurityKeyword = 
  | 'SECURE' | 'ENCRYPT' | 'DECRYPT' | 'VERIFY'
  | 'TRUST' | 'PERMISSION' | 'POLICY';

/**
 * @description Contexto de execução da intenção, contendo variáveis de entrada e parâmetros dinâmicos.
 */
export interface IntentContext {
  /** Parâmetros flexíveis chave-valor fornecidos na declaração da intenção */
  [key: string]: any;
}

/**
 * @description Requisitos e capacidades obrigatórias para que a intenção possa ser satisfeita.
 */
export interface IntentRequirement {
  /** Lista de capacidades exigidas (ex.: "EXECUTE PAYMENT", "FETCH INVENTORY") */
  capabilities: string[];
}

/**
 * @description Estrutura de um passo individual ou composto dentro do grafo de orquestração do fluxo.
 */
export interface IntentFlowStep {
  /** Tipo de controlo de fluxo a aplicar neste passo */
  type: FlowControl;
  /** Identificador ou nome semântico do passo */
  name?: string;
  /** Ação semântica atómica a executar (ex.: "FETCH INVENTORY") */
  action?: string;
  /** Expressão booleana avaliada em passos do tipo CONDITION */
  condition?: string;
  /** Número máximo de tentativas em caso de falha transitória */
  retryCount?: number;
  /** Ação ou passo alternativo a executar em caso de falha persistente */
  fallback?: string;
  /** Limite de tempo em milissegundos para a conclusão do passo */
  timeoutMs?: number;
  /** Identificadores de passos dos quais este depende para iniciar */
  dependsOn?: string[];
  /** Sub-passos aninhados para blocos compostos (ex.: SEQUENCE, PARALLEL) */
  steps?: IntentFlowStep[];
  /** Parâmetros declarativos ou corpo de carga útil associados ao passo */
  parameters?: Record<string, any>;
  /** Configuração de ação compensatória do padrão Saga (reversão LIFO) */
  compensate?: { action: string; payload?: any };
  /** Esquema JSON Schema exigido para validação do resultado do passo */
  outputSchema?: any;
  /** Política de retentativa declarativa com contagem e estratégia de recuo */
  retry?: { maxAttempts?: number; backoff?: string };
}

/**
 * @description Especificação do formato de saída pretendido para o resultado da intenção.
 */
export interface IntentOutput {
  /** Formato de serialização da resposta final */
  format: 'json' | 'xml' | 'text' | 'event';
  /** Esquema de validação opcional (JSON Schema) para a resposta */
  schema?: any;
}

/**
 * @description Objeto canónico representativo de uma intenção após análise sintática e semântica.
 * @audit O identificador UUID permite correlacionar pedidos externos com os registos de auditoria.
 */
export interface ParsedIntent {
  /** Identificador único global (UUID v4) da intenção */
  id: string;
  /** Nome identificador da intenção */
  name: string;
  /** Verbo semântico principal associado */
  verb?: IntentVerb;
  /** Variáveis e dados contextuais da intenção */
  context: IntentContext;
  /** Requisitos funcionais necessários para a execução */
  requirements: IntentRequirement;
  /** Árvore/grafo de execução do fluxo */
  flow: IntentFlowStep[];
  /** Especificação de formatação da saída */
  output: IntentOutput;
  /** Texto original submetido em linguagem natural ou sintaxe formal */
  rawText?: string;
}

/**
 * @description Especificação de uma capacidade técnica exposta por um microserviço.
 */
export interface Capability {
  /** Verbo da ação semântica */
  verb: IntentVerb;
  /** Objeto alvo ou domínio sobre o qual a ação atua */
  target: string;
  /** Descrição funcional detalhada da capacidade */
  description?: string;
  /** Lista de permissões RBAC exigidas para invocar esta capacidade */
  requiredPermissions?: string[];
  /** Esquema JSON para validação rigorosa dos dados de entrada */
  inputSchema?: any;
  /** Esquema JSON da estrutura devolvida pela capacidade */
  outputSchema?: any;
  /** Capacidade inversa para compensação transacional em padrões Saga */
  compensateCapability?: string;
  /** Pureza e garantia de ausência de efeitos colaterais ('PURE', 'IDEMPOTENT_READ', 'STATEFUL_MUTATION') */
  purity?: 'PURE' | 'IDEMPOTENT_READ' | 'STATEFUL_MUTATION';
  /** Indica se a operação é segura e idempotente para execução concorrente */
  isIdempotent?: boolean;
}

/**
 * @description Restrições operacionais e limites de infraestrutura associados a um serviço.
 * @security Previne ataques de negação de serviço (DoS) e saturação de recursos.
 */
export interface ServiceConstraint {
  /** Número máximo de invocações concorrentes permitidas */
  maxConcurrent?: number;
  /** Tamanho máximo permitido para o corpo do pedido em Megabytes */
  maxPayloadSizeMB?: number;
  /** Limite de tempo em milissegundos para respostas do serviço */
  timeoutMs?: number;
  /** Permissões de segurança gerais exigidas pelo serviço */
  requiredPermissions?: string[];
}

/**
 * @description Registo descritivo de um microserviço registado no ecossistema INP.
 * @security O índice de confiança (trustScore) e o nível de segurança regulam a elegibilidade de invocação.
 */
export interface Service {
  /** Identificador único do serviço no registo */
  id: string;
  /** Nome comercial ou funcional do serviço */
  name: string;
  /** Descrição detalhada da finalidade do microserviço */
  description?: string;
  /** Catálogo de capacidades funcionais suportadas */
  capabilities: Capability[];
  /** Esquema global de entrada (se aplicável) */
  inputSchema?: any;
  /** Esquema global de saída (se aplicável) */
  outputSchema?: any;
  /** Restrições de invocação e limites de taxa */
  constraints?: ServiceConstraint;
  /** Pontuação de reputação e fiabilidade calculada (0 a 100) */
  trustScore: number;
  /** Classificação de segurança para controlo de acesso */
  securityLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  /** URL base HTTP do ponto de extremidade para invocações remotas */
  endpoint?: string;
  /** Manipulador local em memória utilizado para testes ou fallbacks diretos */
  handler?: (input: any, context?: any) => Promise<any>;
}

/**
 * @description Resultado da correspondência algorítmica entre uma exigência de fluxo e um serviço.
 */
export interface ServiceMatch {
  /** Instância do serviço selecionado pelo motor */
  service: Service;
  /** Capacidade específica correspondente ao requisito */
  capability: Capability;
  /** Pontuação ponderada de adequação e fiabilidade */
  score: number;
}

/**
 * @description Estados do ciclo de vida de uma execução transacional.
 * @audit Essencial para determinar o estado de finalização e responsabilidade de auditoria.
 */
export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'RETRYING' | 'CANCELLED';

/**
 * @description Registo detalhado do resultado de um passo atómico de execução.
 */
export interface ExecutionStepResult {
  /** Identificador do passo */
  stepId: string;
  /** Ação semântica invocada */
  action: string;
  /** Estado de desfecho do passo */
  status: ExecutionStatus;
  /** Dados enviados como entrada na invocação */
  input?: any;
  /** Resposta devolvida pelo serviço */
  output?: any;
  /** Mensagem ou pilha de erro em caso de insucesso */
  error?: string;
  /** Tempo total decorrido em milissegundos */
  durationMs: number;
  /** Data e hora exatas da execução */
  timestamp: Date;
  /** Metadados criptográficos do snapshot capturado na Máquina do Tempo para persistência durável da trilha Merkle */
  snapshotMeta?: any;
}

/**
 * @description Registo global consolidado de uma execução completa de intenção.
 * @audit Este registo é persistido em base de dados e consultado para fins de conformidade e auditoria forense.
 */
export interface ExecutionResult {
  /** Identificador único global (UUID v4) da execução */
  id: string;
  /** Identificador único da execução (alias alternativo para id) */
  executionId?: string;
  /** Identificador da intenção que despoletou a execução */
  intentId: string;
  /** Estado final consolidado do fluxo */
  status: ExecutionStatus;
  /** Histórico sequencial de resultados por passo */
  steps: ExecutionStepResult[];
  /** Dados finais agregados e formatados */
  finalOutput?: any;
  /** Detalhe da causa de falha geral se aplicável */
  error?: string;
  /** Carimbo temporal de início */
  startedAt: Date;
  /** Carimbo temporal de conclusão ou cancelamento */
  completedAt?: Date;
}

/**
 * @description Contexto de segurança contendo a identidade do ator e privilégios de acesso.
 * @security Suporta autenticação baseada em tokens, papéis (RBAC) e correlação de auditoria.
 */
export interface SecurityContext {
  /** Identificador do utilizador ou serviço originador */
  userId?: string;
  /** Endereço eletrónico do utilizador autenticado */
  email?: string;
  /** Papel principal do ator no sistema (ADMIN, CLIENT_ENTERPRISE, CLIENT_INDIVIDUAL, AUDITOR, DBA, etc.) */
  role?: string;
  /** Nível hierárquico específico de DBA (1: Monitorização, 2: Operacional, 3: Manutenção/Sénior) */
  dbaLevel?: 1 | 2 | 3;
  /** Empresa ou organização à qual o utilizador pertence */
  company?: string;
  /** Tipo de credencial utilizada na autenticação ('JWT' | 'API_KEY' | 'SYSTEM') */
  authType?: 'JWT' | 'API_KEY' | 'SYSTEM';
  /** Lista de papéis associados ao ator no sistema */
  roles?: string[];
  /** Permissões granulares concedidas */
  permissions?: string[];
  /** Nível de confiança mínimo atribuído à sessão */
  trustLevel?: number;
  /** Identificador de correlação transacional para rastreio entre serviços distribuídos */
  correlationId?: string;
}

/**
 * @description Configuração global de inicialização do núcleo do protocolo INP.
 */
export interface INPConfig {
  /** Ativa ou desativa as validações de segurança e permissões */
  enableSecurity: boolean;
  /** Tempo limite padrão em milissegundos para invocações */
  defaultTimeoutMs: number;
  /** Número máximo de repetições automáticas em caso de falha */
  maxRetries: number;
  /** Limiar mínimo de pontuação de confiança (trustScore) exigido para seleção de serviços */
  trustThreshold: number;
}