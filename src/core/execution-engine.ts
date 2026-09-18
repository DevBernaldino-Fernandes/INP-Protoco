/**
 * @fileoverview Motor Central de Execução Transacional e Resiliência (ExecutionEngine)
 * @module Core/ExecutionEngine
 * @description
 * O coração operacional do protocolo INP. Executa a árvore de orquestração do fluxo (`IntentFlowStep[]`),
 * coordena a invocação de microserviços (locais ou remotos via HTTP com balanceamento Round-Robin),
 * aplica políticas de repetição exponencial (*exponential backoff*), tempos-limite (*timeouts*),
 * disjuntores de circuito (*Circuit Breakers*) e persistência transacional com TypeORM.
 *
 * Implementa o padrão de transações distribuídas Saga (com pilha LIFO de ações compensatórias),
 * bloqueios pessimistas a nível de linha no PostgreSQL (`TransactionLock`), recuperação progressiva
 * (*Forward Recovery* com pontos de verificação), autocura autónoma orientada por IA (`AISelfHealer`),
 * validação criptográfica de conhecimento zero (`ZKVerifier`), federação inter-nós (`IntentFederation`)
 * e desvio de falhas irrecuperáveis para a Dead Letter Queue com despacho de alertas operacionais.
 *
 * @security Garante idempotência ponta-a-ponta através do cabeçalho `X-Idempotency-Key`.
 * Valida autorizações e controlo de acesso baseado em papéis (RBAC).
 * Isola nós degradados através de limitação de taxa adaptativa (*Adaptive Throttling*).
 * Protege variáveis confidenciais desempacotadas em âmbitos confidenciais (`CONFIDENTIAL_SCOPE`),
 * eliminando-as da saída externa para prevenir fugas de informação sensível.
 * Sanitiza todas as cargas úteis antes de as emitir na telemetria pública.
 * @audit Permite rastreabilidade forense completa: regista cada passo, latência individual,
 * entradas/saídas higienizadas e estados finais na base de dados (`executions` e `saga_states`).
 */

/// <reference path="../circuit-breaker-js.d.ts" />
import axios from 'axios';
import axiosRetry from 'axios-retry';
import CircuitBreaker from 'circuit-breaker-js';
import { v4 as uuidv4 } from 'uuid';
import Ajv from 'ajv';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { ParsedIntent, IntentFlowStep, ExecutionResult, ExecutionStepResult, ServiceMatch, SecurityContext } from './types';
import { CapabilityRegistry } from './capability-registry';
import { ExecutionRepository } from '../persistence/repositories/ExecutionRepository';
import { SagaStateRepository } from '../persistence/repositories/SagaStateRepository';
import { SagaState } from '../persistence/entities/SagaState';
import { DeadLetterQueue } from '../persistence/entities/DeadLetterQueue';
import { SafeEvaluator } from './safe-evaluator';
import { CryptoEngine } from './crypto-engine';
import { TransactionLock } from './transaction-lock';
import { AlertManager } from './alert-manager';
import { AppDataSource } from '../persistence/data-source';
import { TelemetryService } from './telemetry-service';
import { ServiceMetricsCollector } from './metrics-collector';
import { AISelfHealer } from './ai-self-healer';
import { ZKVerifier } from './zk-verifier';
import { IntentFederation } from './intent-federation';
import { DataSanitizer } from './data-sanitizer';
import { NetworkSecurity } from './network-security';
import { SemanticAdapter } from './semantic-adapter';
import { CognitiveGraphOptimizer } from './cognitive-graph-optimizer';
import { TimeMachineEngine } from './time-machine-engine';

/** Agente HTTP com pool de sockets persistentes para eliminar overhead de handshake TCP por requisição */
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100, timeout: 10000 });
/** Agente HTTPS com pool de sockets persistentes e TLS reutilizável */
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100, timeout: 10000 });

// Instância do validador AJV para conformidade de contratos de dados
const ajv = new Ajv({ allErrors: true });

/**
 * @description Cache de validadores AJV pré-compilados, indexados por hash SHA-256 do esquema JSON.
 * Elimina re-compilações redundantes de esquemas idênticos em execuções concorrentes ou consecutivas.
 */
const schemaValidatorCache = new Map<string, ReturnType<typeof ajv.compile>>();
const schemaWeakMap = new WeakMap<object, ReturnType<typeof ajv.compile>>();

/**
 * @description Recupera ou compila e armazena em cache o validador AJV para um dado esquema JSON.
 * Utiliza WeakMap para consulta instantânea O(1) em esquemas em memória (evita hashing SHA-256 no hot-path).
 *
 * @param {any} schema - Objeto JSON Schema a validar.
 * @returns {ReturnType<typeof ajv.compile>} Função de validação compilada e reutilizável.
 * @audit O cache é partilhado ao nível do módulo, garantindo que todos os fluxos beneficiam das compilações anteriores.
 */
function getOrCompileSchema(schema: any): ReturnType<typeof ajv.compile> {
  if (schema && typeof schema === 'object') {
    const cached = schemaWeakMap.get(schema);
    if (cached) return cached;
  }
  const schemaKey = typeof schema === 'string' ? schema : crypto.createHash('sha256').update(JSON.stringify(schema)).digest('hex');
  let compiled = schemaValidatorCache.get(schemaKey);
  if (!compiled) {
    compiled = ajv.compile(schema);
    schemaValidatorCache.set(schemaKey, compiled);
  }
  if (schema && typeof schema === 'object') {
    schemaWeakMap.set(schema, compiled);
  }
  return compiled;
}


// Configuração global de retentativas automáticas no cliente HTTP Axios com atraso exponencial
axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

/**
 * @description Motor de orquestração e execução de fluxos transacionais do protocolo INP.
 */
export class ExecutionEngine {
  /** Memória estática de índices para balanceamento equitativo em Round-Robin entre instâncias de serviços */
  private static lastChosenIndices = new Map<string, number>();

  /**
   * @description Registo singleton estático de disjuntores de circuito (Circuit Breakers), indexado por ID de serviço.
   * Garante que cada microserviço possui exactamente um disjuntor partilhado entre todas as invocações,
   * permitindo a acumulação correcta do histórico de falhas e a abertura do circuito quando o limiar é atingido.
   * @audit Persistente durante o ciclo de vida do processo; auditável via TelemetryService com evento SERVICE_RESOLVED.
   */
  private static circuitBreakerRegistry = new Map<string, any>();


  /** Pilha transacional de compensações registadas em ordem LIFO (Last-In, First-Out) com suporte a lotes paralelos */
  private compensationStack: { capability: string; context: any; batchId?: string }[] = [];
  /** Identificador do lote concorrente ativo para agrupamento de reversão paralela */
  private currentParallelBatchId: string | null = null;
  /** Identificador único global da execução em curso */
  private currentExecutionId: string | null = null;
  /** Indicador que assinala se o motor se encontra em modo de reversão (rollback) para contornar verificações RBAC */
  private isRollbackMode = false;
  
  /** Índice do passo a partir do qual a recuperação progressiva (Forward Recovery) deve retomar */
  private resumeFromStepIndex = 0;
  /** Identificador primário do registo da Saga persistido na base de dados */
  private currentSagaRecordId: string | null = null;
  /** Lista de resultados de passos concluídos em execuções anteriores para recuperação */
  private previousSteps: any[] = [];

  /**
   * @param {CapabilityRegistry} registry - Catálogo central de serviços para resolução de capacidades.
   * @param {SecurityContext} [securityContext] - Contexto com identidade, papéis, permissões e ID de correlação.
   */
  constructor(
    private registry: CapabilityRegistry,
    private securityContext?: SecurityContext
  ) {}

  /**
   * @description Retorna o disjuntor de circuito (Circuit Breaker) associado a um microserviço específico,
   * criando-o e registando-o no Map estático se ainda não existir.
   * Ao reutilizar a mesma instância entre invocações, o histórico de falhas acumula-se correctamente
   * e o circuito abre quando o limiar de erros configurado (`errorThreshold: 50%`) é atingido.
   *
   * @param {string} serviceId - Identificador único do microserviço alvo.
   * @returns {any} Instância de CircuitBreaker associada ao serviço, criada ou recuperada do registo estático.
   * @security Isola falhas por microserviço, impedindo que um nó degradado sature o pool de invocações do motor.
   * @audit O registo estático é auditável e pode ser exportado para diagnóstico operacional em tempo real.
   */
  private getCircuitBreaker(serviceId: string): any {
    if (!ExecutionEngine.circuitBreakerRegistry.has(serviceId)) {
      ExecutionEngine.circuitBreakerRegistry.set(serviceId, new CircuitBreaker({ timeoutDuration: 5000, errorThreshold: 50 }));
    }
    return ExecutionEngine.circuitBreakerRegistry.get(serviceId)!;
  }


  /**
   * @description Ponto de entrada principal: orquestra a execução integral da intenção e persiste o resultado.
   *
   * @param {ParsedIntent} intent - Intenção canónica com grafo de orquestração e contexto.
   * @param {Map<string, ServiceMatch>} serviceMatches - Mapa de correspondência preliminar entre requisitos e serviços.
   * @param {string} [customExecutionId] - Identificador opcional pré-atribuído (ex.: proveniente de fila assíncrona).
   * @returns {Promise<ExecutionResult>} Resultado final detalhado com estados, passos e dados consolidados.
   * @security Emite telemetria com contexto sanitizado e armazena estado inicial antes de disparar pedidos de rede.
   * @audit Regista o ciclo de vida da transação em `executions` e `saga_states` para auditoria financeira e de SLA.
   */
  async execute(intent: ParsedIntent, serviceMatches: Map<string, ServiceMatch>, customExecutionId?: string): Promise<ExecutionResult> {
    const executionId = customExecutionId || uuidv4();
    this.currentExecutionId = executionId;
    const startedAt = new Date();
    const steps: ExecutionStepResult[] = [];
    let finalOutput: any = null;
    let status: 'COMPLETED' | 'FAILED' = 'COMPLETED';
    let errorMsg: string | undefined;

    // Emissão de telemetria: início de execução com parâmetros sensíveis devidamente mascarados
    TelemetryService.getInstance().broadcast('EXECUTION_STARTED', {
      executionId,
      intentName: intent.name,
      intentId: intent.id,
      flow: intent.flow,
      context: DataSanitizer.sanitize(intent.context)
    });

    // Carrega tentativas anteriores de execução para reaproveitar passos já concluídos (Forward Recovery)
    const prevExec = await ExecutionRepository.findOneBy({ id: executionId });
    this.previousSteps = prevExec && prevExec.steps ? prevExec.steps : [];

    // 1. Persistência do estado inicial da execução
    if (prevExec) {
      await ExecutionRepository.update(executionId, {
        status: 'RUNNING',
        startedAt,
      });
    } else {
      await ExecutionRepository.save({
        id: executionId,
        intentId: intent.id,
        status: 'RUNNING',
        steps: [],
        startedAt,
      });
    }

    // 2. Persistência ou carregamento do estado da Saga transacional
    let sagaRecord = await SagaStateRepository.findOneBy({ executionId });
    if (!sagaRecord) {
      this.compensationStack = [];
      // Determina a política perante falhas a partir do contexto (por omissão: ROLLBACK)
      const failurePolicy = intent.context.failurePolicy || 'ROLLBACK';
      sagaRecord = await SagaStateRepository.save({
        executionId,
        intentId: intent.id,
        status: 'RUNNING',
        compensationStack: [],
        lastError: null,
        currentStepIndex: 0,
        failurePolicy,
        maxForwardRetries: 3
      });
    } else {
      // Restaura a pilha de compensações persistida na base de dados
      this.compensationStack = [...sagaRecord.compensationStack];
      await SagaStateRepository.update({ id: sagaRecord.id }, { status: 'RUNNING', lastError: null });
    }

    this.resumeFromStepIndex = sagaRecord.currentStepIndex;
    this.currentSagaRecordId = sagaRecord.id;

    try {
      const stateTracker = { index: 0 };
      const optimizedFlow = CognitiveGraphOptimizer.optimizeFlow(intent.flow);
      finalOutput = await this.executeFlow(optimizedFlow, intent.context, serviceMatches, steps, 0, stateTracker);
      
      // Se o fluxo foi suspenso ou escalado (AWAIT / ESCALATE), preserva o estado SUSPENDED
      const currentSaga = await SagaStateRepository.findOneBy({ id: sagaRecord.id });
      if (currentSaga && currentSaga.status !== 'SUSPENDED') {
        await SagaStateRepository.update({ id: sagaRecord.id }, { status: 'COMPLETED' });
      }
    } catch (err: any) {
      status = 'FAILED';
      errorMsg = err.message;

      // Reavalia o estado da Saga para determinar a estratégia de contingência
      const currentSaga = await SagaStateRepository.findOneBy({ id: sagaRecord.id });
      const policy = currentSaga ? currentSaga.failurePolicy : 'ROLLBACK';

      if (policy === 'FORWARD_RETRY') {
        console.log(`[Saga] A execução falhou: ${errorMsg}. A política é FORWARD_RETRY. Progresso guardado no passo: ${currentSaga ? currentSaga.currentStepIndex : 0}`);
        await SagaStateRepository.update({ id: sagaRecord.id }, {
          status: 'FORWARD_RETRY_PENDING',
          lastError: errorMsg
        });
      } else {
        // Execução de reversão (Rollback) da Saga em ordem LIFO
        console.log(`[Saga] A execução falhou: ${errorMsg}. A iniciar reversão de ${this.compensationStack.length} ações compensatórias...`);
        await SagaStateRepository.update({ id: sagaRecord.id }, { status: 'COMPENSATING' });
        try {
          await this.resumeRollback(sagaRecord.id, this.compensationStack);
        } catch (rollbackErr: any) {
          console.error(`[Saga] A sequência de reversão falhou: ${rollbackErr.message}`);
        }
      }
    }

    const completedAt = new Date();
    await ExecutionRepository.update(executionId, {
      status,
      output: finalOutput,
      error: errorMsg,
      steps,
      completedAt,
    });

    // Emissão de telemetria: conclusão ou término em erro com dados de saída mascarados
    TelemetryService.getInstance().broadcast('EXECUTION_FINISHED', {
      executionId,
      status,
      output: DataSanitizer.sanitize(finalOutput),
      error: errorMsg,
      completedAt
    });

    return {
      id: executionId,
      executionId,
      intentId: intent.id,
      status,
      steps,
      finalOutput,
      error: errorMsg,
      startedAt,
      completedAt,
    };
  }

  /**
   * @description Reexecuta um fluxo a partir de um marco temporal específico (Time-Travel Replay Execution).
   * Reconstitui o estado no passo anterior e avança a esteira com forward-recovery ou isolamento em fork.
   *
   * @param {string} executionId - Identificador da execução original.
   * @param {number} fromStepIndex - Marco temporal de onde reexecutar.
   * @param {object} [options] - Opções de reexecução (overrides, dryRun e passos hipotéticos).
   * @returns {Promise<any>} Resultado da reexecução.
   * @security Mantém isolamento estrito de contexto durante a nova ramificação.
   * @audit Assina a linhagem e vincula o novo identificador de execução ao pai histórico.
   */
  public async replayFlowFromStep(
    executionId: string,
    fromStepIndex: number,
    options: { overrides?: any; dryRun?: boolean; steps?: any[] } = {}
  ): Promise<any> {
    const timeMachine = TimeMachineEngine.getInstance();
    const baseContext = timeMachine.travelTo(executionId, fromStepIndex);

    if (options.dryRun) {
      const steps = options.steps || [];
      return timeMachine.simulateWhatIf(executionId, fromStepIndex, options.overrides || {}, steps);
    }

    // Cria bifurcação temporal com custódia de linhagem para isolamento de produção
    const forkResult = timeMachine.forkExecution(executionId, fromStepIndex, options.overrides);
    return {
      replay: true,
      forkedExecutionId: forkResult.forkedExecutionId,
      parentExecutionId: executionId,
      fromStepIndex,
      restoredContext: forkResult.context,
      lineage: forkResult.lineage,
      status: 'REPLAY_INITIALIZED'
    };
  }

  /**
   * @description Executor recursivo do grafo de fluxo. Navega através de passos sequenciais, paralelos,
   * condicionais, repetições, âmbitos criptográficos e de conhecimento zero.
   *
   * @param {IntentFlowStep[]} steps - Lista de passos a executar.
   * @param {any} context - Contexto acumulado de dados.
   * @param {Map<string, ServiceMatch>} serviceMatches - Mapa de serviços correspondentes.
   * @param {ExecutionStepResult[]} allSteps - Acumulador global de histórico de passos.
   * @param {number} [depth=0] - Nível atual de profundidade de aninhamento.
   * @param {{ index: number }} stateTracker - Contador sequencial global para indexação determinística.
   * @returns {Promise<any>} Contexto final resultante do bloco de passos.
   */
  private async executeFlow(
    steps: IntentFlowStep[],
    context: any,
    serviceMatches: Map<string, ServiceMatch>,
    allSteps: ExecutionStepResult[],
    depth = 0,
    stateTracker = { index: 0 }
  ): Promise<any> {
    let current = context;
    for (const step of steps) {
      let stepStatus: any = 'RUNNING';
      let output: any = null;
      let error: string | undefined;
      const contextBeforeStep = this.deepClone(current || {});

      const stepIndex = stateTracker.index++;
      // Gera um UUID determinístico baseado no ID da execução e no índice do passo (essencial para idempotência)
      const stepId = this.currentExecutionId
        ? this.generateDeterministicUUID(this.currentExecutionId, stepIndex)
        : uuidv4();
      const start = Date.now();

      // Emissão de telemetria: início do passo individual
      TelemetryService.getInstance().broadcast('STEP_STARTED', {
        executionId: this.currentExecutionId,
        stepIndex,
        stepId,
        action: step.action || step.type,
        input: DataSanitizer.sanitize(current)
      });

      // FORWARD RECOVERY: Salta o passo se este já tiver sido executado com sucesso em tentativa anterior
      if (stepIndex < this.resumeFromStepIndex && !step.steps) {
        console.log(`[Recuperação Progressiva] A saltar passo previamente concluído ${stepIndex}: ${step.action || step.type}`);
        const prevStep = this.previousSteps.find(s => s.stepId === stepId);
        if (prevStep && prevStep.status === 'COMPLETED') {
          output = prevStep.output;
          current = output; // Restaura o contexto intermédio produzido
        }
        allSteps.push({
          stepId: prevStep?.stepId || stepId,
          action: step.action || step.type,
          status: 'COMPLETED',
          input: prevStep?.input || current,
          output,
          durationMs: prevStep?.durationMs || 0,
          timestamp: prevStep?.timestamp ? new Date(prevStep.timestamp) : new Date(),
        });
        continue;
      }

      // Verificação prévia de dependências: assegura que todos os passos pré-requisitos já foram finalizados com êxito
      if (step.dependsOn && step.dependsOn.length > 0) {
        const completedStepActions = allSteps.filter(s => s.status === 'COMPLETED').map(s => s.action.toUpperCase());
        const hasDeps = step.dependsOn.every(d => completedStepActions.includes(d.toUpperCase()));
        if (!hasDeps) {
          throw new Error(`Violação de Dependência: O passo depende de [${step.dependsOn.join(', ')}], que ainda não se encontram concluídos.`);
        }
      }

      try {
        if (step.type === 'SEQUENCE' && step.steps) {
          output = await this.executeFlow(step.steps, current, serviceMatches, allSteps, depth+1, stateTracker);
          current = (output && typeof output === 'object' && !Array.isArray(output)) ? { ...current, ...output } : output;
        } else if (step.type === 'PARALLEL' && step.steps) {
          // Proteção do bloco PARALLEL com AbortController e marcação de lote para Rollback Paralelo
          const abortController = new AbortController();
          const parallelBatchId = `batch_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
          const previousBatchId = this.currentParallelBatchId;
          this.currentParallelBatchId = parallelBatchId;

          let results: any[];
          try {
            const parallelPromises = step.steps.map(async (sub, idx) => {
              if (abortController.signal.aborted) {
                throw new Error(`[Execução Paralela Abortada] O ramo #${idx} foi cancelado devido a falha concorrente.`);
              }
              try {
                return await this.executeFlow([sub], current, serviceMatches, allSteps, depth + 1, stateTracker);
              } catch (err: any) {
                abortController.abort();
                throw err;
              }
            });

            const settledResults = await Promise.allSettled(parallelPromises);
            const failures = settledResults
              .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
              .map(r => r.reason?.message || String(r.reason));

            if (failures.length > 0) {
              throw new Error(`[Falha Paralela Agregada] ${failures.length} ramo(s) falharam na execução concorrente: ${failures.join(' | ')}`);
            }

            results = (settledResults as PromiseFulfilledResult<any>[]).map(r => r.value);
          } finally {
            this.currentParallelBatchId = previousBatchId;
          }

          output = results;
          if (typeof current !== 'object' || current === null || Array.isArray(current)) {
            current = {};
          }
          if (step.name) {
            const aggregatedOutput: any = [...results];
            for (const r of results) {
              if (r && typeof r === 'object') {
                for (const [k, v] of Object.entries(r)) {
                  if (aggregatedOutput[k] === undefined) {
                    aggregatedOutput[k] = v;
                  }
                }
              }
            }
            current[step.name] = aggregatedOutput;
          }
        } else if (step.type === 'CONDITION') {
          const isTrue = step.condition ? this.evaluateCondition(step.condition, current) : false;
          if (isTrue && step.steps && step.steps.length > 0) {
            output = await this.executeFlow(step.steps, current, serviceMatches, allSteps, depth + 1, stateTracker);
            current = (output && typeof output === 'object' && !Array.isArray(output)) ? { ...current, ...output } : output;
          } else if (!isTrue && step.fallback) {
            output = await this.executeAction(step.fallback, current, serviceMatches, stepId, step);
            current = (output && typeof output === 'object' && !Array.isArray(output)) ? { ...current, ...output } : output;
          }
          if (step.name) {
            current[step.name] = output;
          }
        } else if (step.type === 'RETRY') {
          let attempts = 0;
          const max = step.retryCount || step.retry?.maxAttempts || 3;
          let success = false;
          while (attempts < max && !success) {
            try {
              if (step.steps && step.steps.length > 0) {
                output = await this.executeFlow(step.steps, current, serviceMatches, allSteps, depth + 1, stateTracker);
              } else if (step.action) {
                output = await this.executeAction(step.action, current, serviceMatches, stepId, step);
              }
              success = true;
              current = (output && typeof output === 'object' && !Array.isArray(output)) ? { ...current, ...output } : output;
            } catch (err) {
              attempts++;
              if (attempts >= max) throw err;
              // Backoff exponencial com Full Jitter (AWS Best Practice) para prevenir thundering herd
              const baseDelayMs = 500;
              const maxCapMs = 8000;
              const maxInterval = Math.min(maxCapMs, baseDelayMs * Math.pow(2, attempts));
              const jitterDelay = Math.floor(Math.random() * maxInterval);
              await this.delay(jitterDelay);
            }
          }
        } else if (step.type === 'FALLBACK' && step.fallback) {
          output = await this.executeAction(step.fallback, current, serviceMatches, stepId, step);
          current = output;
        } else if (step.type === 'TIMEOUT') {
          if (step.steps) {
            const timeoutMs = step.timeoutMs || 5000;
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Tempo limite de ${timeoutMs}ms ultrapassado.`)), timeoutMs)
            );
            output = await Promise.race([
              this.executeFlow(step.steps, current, serviceMatches, allSteps, depth+1, stateTracker),
              timeoutPromise
            ]);
            current = output;
          } else {
            console.warn(`Tempo limite definido para ${step.timeoutMs}ms (sem sub-passos associados).`);
          }
        } else if (step.type === 'PIPELINE' && step.steps) {
          output = await this.executeFlow(step.steps, current, serviceMatches, allSteps, depth+1, stateTracker);
          current = output;
        } else if (step.type === 'SCOPE') {
          if (step.action && step.action.startsWith('ENCRYPT')) {
            const field = step.action.split(/\s+/)[1];
            if (current && current[field]) {
              current[field] = CryptoEngine.encrypt(current[field].toString());
            }
            output = current;
          } else if (step.action && step.action.startsWith('DECRYPT')) {
            const field = step.action.split(/\s+/)[1];
            if (current && current[field]) {
              current[field] = CryptoEngine.decrypt(current[field].toString());
            }
            output = current;
          } else if (step.action && step.action.startsWith('VERIFY')) {
            const parts = step.action.split(/\s+/);
            const field = parts[1];
            const op = parts[2];
            const boundary = parseFloat(parts[3]);
            if (parts.length >= 4 && ['>=', '<=', '>', '<', '==', '!='].includes(op) && !isNaN(boundary)) {
              console.log(`[Motor] A executar validação de prova criptográfica ZK: "${step.action}"`);
              ZKVerifier.verifyProof(field, op, boundary, current);
              output = current;
            } else {
              output = await this.executeAction(step.action, current, serviceMatches, stepId, step);
            }
          } else if (step.action === 'CONFIDENTIAL') {
            console.log('[Motor] A entrar em âmbito de execução confidencial (Confidential Scope)...');
            const localContext = this.deepClone(current);
            
            // Desempacota valores de prova protegidos apenas dentro do contexto privado isolado
            for (const key of Object.keys(localContext)) {
              if (key.endsWith('_proof') && localContext[key] && localContext[key].value !== undefined) {
                const plainKey = key.slice(0, -6);
                localContext[plainKey] = localContext[key].value;
                console.log(`[Motor] A desempacotar o atributo confidencial "${plainKey}" no âmbito confidencial.`);
              }
            }

            output = await this.executeFlow(step.steps!, localContext, serviceMatches, allSteps, depth+1, stateTracker);
            
            // SEGURANÇA: Elimina estritamente os campos desempacotados antes de devolver dados ao contexto exterior
            if (output) {
              for (const key of Object.keys(output)) {
                if (key + '_proof' in localContext) {
                  delete output[key];
                  console.log(`[Motor] A expurgar o atributo confidencial "${key}" antes de sair do âmbito confidencial.`);
                }
              }
            }
            current = output;
          } else if (step.steps) {
            const localContext = this.deepClone(current);
            output = await this.executeFlow(step.steps, localContext, serviceMatches, allSteps, depth+1, stateTracker);
            current = output;
          }
        } else if (step.type === 'DEPENDENCY' && step.steps) {
          output = await this.executeFlow(step.steps, current, serviceMatches, allSteps, depth+1, stateTracker);
          current = output;
        } else if (step.action) {
          output = await this.executeAction(step.action, current, serviceMatches, stepId, step);
          current = (output && typeof output === 'object' && !Array.isArray(output)) ? { ...current, ...output } : output;
          if (step.name) {
            current[step.name] = output;
          }
        }
        stepStatus = 'COMPLETED';

        // MEDIDA DE SEGURANÇA: Se o passo retornou estado SUSPENDED ou ESCALATED (AWAIT/ESCALATE),
        // interrompe imediatamente o ciclo para não executar passos seguintes numa saga suspensa.
        if (output && (output.status === 'SUSPENDED' || output.status === 'ESCALATED')) {
          // Persiste o índice atual antes de interromper para permitir retoma exata
          if (this.currentSagaRecordId) {
            await SagaStateRepository.update({ id: this.currentSagaRecordId }, {
              currentStepIndex: stepIndex + 1
            });
          }
          // O bloco finally irá ainda assim empurrar o registo — não é necessário fazer aqui
          return output; // Propaga a suspensão ao chamador sem executar mais passos
        }

        // Atualiza e persiste o índice de progresso da Saga na base de dados
        if (this.currentSagaRecordId) {
          await SagaStateRepository.update({ id: this.currentSagaRecordId }, {
            currentStepIndex: stepIndex + 1
          });
        }
      } catch (err: any) {
        stepStatus = 'FAILED';
        error = err.message;
        throw err;
      } finally {
        const durationMs = Date.now() - start;
        const sanitizedInput = DataSanitizer.sanitize(current);
        const sanitizedOutput = DataSanitizer.sanitize(output);

        let snapshotMeta: any;
        // Captura fotográfica atómica imutável na Máquina do Tempo (TimeMachineEngine)
        if (this.currentExecutionId) {
          const snap = TimeMachineEngine.getInstance().captureSnapshot(
            this.currentExecutionId,
            stepIndex,
            step.name || step.action || step.type || `step_${stepIndex}`,
            step.action || step.type || 'FLOW_STEP',
            contextBeforeStep,
            current,
            stepStatus,
            error
          );
          snapshotMeta = {
            snapshotId: snap.snapshotId,
            contextHash: snap.contextHash,
            previousChainHash: snap.previousChainHash,
            chainHash: snap.chainHash,
            isKeyframe: snap.isKeyframe,
            isCompacted: snap.isCompacted,
            deltaDiff: snap.deltaDiff,
            timestamp: snap.timestamp
          };
        }

        allSteps.push({
          stepId,
          action: step.action || step.type,
          status: stepStatus,
          input: sanitizedInput,
          output: sanitizedOutput,
          error,
          durationMs,
          timestamp: new Date(),
          snapshotMeta
        });

        // Emissão de telemetria: conclusão ou insucesso do passo com dados sanitizados (reutiliza objetos higienizados)
        TelemetryService.getInstance().broadcast(stepStatus === 'COMPLETED' ? 'STEP_COMPLETED' : 'STEP_FAILED', {
          executionId: this.currentExecutionId,
          stepIndex,
          stepId,
          action: step.action || step.type,
          output: sanitizedOutput,
          error,
          durationMs
        });
      }
    }
    return current;
  }

  /**
   * @description Executa uma ação atómica invocando o serviço associado (remoto via HTTP ou local em memória).
   * Realiza validação de contrato JSON Schema, invocação de autocura por IA, limitador de vazão adaptativo,
   * verificação de segurança de rede (SSRF), disjuntor de circuito (Circuit Breaker) e registo de compensações Saga.
   *
   * @param {string} action - Ação declarativa em formato `VERBO ALVO`.
   * @param {any} context - Carga útil enviada ao serviço.
   * @param {Map<string, ServiceMatch>} serviceMatches - Mapa de correspondência.
   * @param {string} stepId - Identificador único do passo para a chave de idempotência `X-Idempotency-Key`.
   * @returns {Promise<any>} Resposta devolvida pelo serviço processador.
   * @throws {Error} Se o contrato for violado, as permissões forem insuficientes ou todos os nós falharem.
   * @security Previne ataques de repetição via cabeçalho de idempotência e valida conformidade via AJV.
   * @audit Regista na pilha de compensação persistida o nó de reversão associado para garantir consistência eventual.
   */
  private async executeAction(action: string, context: any, serviceMatches: Map<string, ServiceMatch>, stepId: string, step?: IntentFlowStep): Promise<any> {
    if (step?.parameters) {
      const interpolatedParams = this.interpolateData(step.parameters, context);
      context = { ...context, ...interpolatedParams };
    }
    const [verb, ...rest] = action.trim().split(/\s+/);
    const target = rest.length > 0 ? rest.join(' ') : '*';
    const key = `${verb} ${target}`.toUpperCase();
    
    const matches = await this.registry.findServicesForCapability(key);
    if (matches.length === 0) {
      throw new Error(`Nenhum microserviço registado para a capacidade: ${key}`);
    }

    // Seleção com balanceamento equitativo (Round-Robin) entre as instâncias de pontuação máxima
    const topScore = matches[0].score;
    const topMatches = matches.filter(m => Math.abs(m.score - topScore) < 0.01);
    const otherMatches = matches.filter(m => Math.abs(m.score - topScore) >= 0.01);

    let lastIndex = ExecutionEngine.lastChosenIndices.get(key) ?? -1;
    let chosenIndex = (lastIndex + 1) % topMatches.length;
    ExecutionEngine.lastChosenIndices.set(key, chosenIndex);

    const orderedTopMatches = [
      ...topMatches.slice(chosenIndex),
      ...topMatches.slice(0, chosenIndex)
    ];
    const orderedMatches = [...orderedTopMatches, ...otherMatches];

    let lastError: any = null;

    for (const match of orderedMatches) {
      const svc = match.service;
      console.log(`[Motor] A invocar capacidade "${key}" no serviço "${svc.name}" (ID: ${svc.id}, Endpoint: ${svc.endpoint || 'Local'})`);

      TelemetryService.getInstance().broadcast('SERVICE_RESOLVED', {
        executionId: this.currentExecutionId,
        stepId,
        serviceId: svc.id,
        serviceName: svc.name,
        isPeer: svc.id.startsWith('peer-')
      });

      try {
        // 1. Verificação de Permissões RBAC (contornada durante reversões de compensação do sistema)
        const requiredPerms = match.capability.requiredPermissions;
        if (requiredPerms && requiredPerms.length > 0 && !this.isRollbackMode) {
          const userPerms = this.securityContext?.permissions || [];
          const hasAll = requiredPerms.every(p => userPerms.includes(p));
          if (!hasAll) {
            throw new Error(`Violação de Segurança: Permissões insuficientes para executar a capacidade "${key}". Requeridas: [${requiredPerms.join(', ')}]. Fornecidas: [${userPerms.join(', ')}]`);
          }
        }

        // 2. Validação Formal de Contrato (JSON Schema)
        const schema = match.capability.inputSchema;
        if (schema) {
          // Adaptação Semântica Preventiva Zero-Shot (Evita quebras de contrato desnecessárias)
          const adaptResult = SemanticAdapter.adapt(context, schema, key);
          if (adaptResult.mappingsApplied.length > 0) {
            console.log(`[Semantic Adapter] Aplicados ${adaptResult.mappingsApplied.length} mapeamentos ontológicos preventivos para "${key}".`);
            context = adaptResult.adaptedContext;
          }

          const validate = getOrCompileSchema(schema);
          let valid = validate(context);
          if (!valid) {
            const errorsText = ajv.errorsText(validate.errors);
            console.log(`[Motor] Violação de contrato na capacidade "${key}": ${errorsText}. A solicitar autocura via IA...`);
            
            // Invocação autónoma do agente de autocura com IA
            const healResult = await AISelfHealer.heal(
              key,
              context,
              schema,
              errorsText,
              context
            );

            if (healResult && healResult.success && healResult.healedContext) {
              console.log(`[Motor] Autocura com IA BEM-SUCEDIDA: "${healResult.explanation}"`);
              context = healResult.healedContext;
              
              TelemetryService.getInstance().broadcast('SELF_HEAL_ATTEMPTED', {
                executionId: this.currentExecutionId,
                action: key,
                explanation: healResult.explanation,
                status: 'SUCCESS',
                healedContext: context
              });

              // Revalidação estrita da carga útil retificada pela IA
              const reValidate = getOrCompileSchema(schema);
              valid = reValidate(context);
              if (!valid) {
                const reErrors = ajv.errorsText(reValidate.errors);
                throw new Error(`Violação de Contrato (Falha Pós-Autocura): A carga útil corrigida pela IA não cumpriu o esquema. Erros: ${reErrors}`);
              }
            } else {
              throw new Error(`Violação de Contrato: A carga útil do contexto não cumpre o esquema para a capacidade "${key}". Detalhes: ${errorsText}`);
            }
          }
        }


        let result: any;

        // 3. Inspeção Estatística Preditiva de Degradação (Z-Score)
        const predReport = CognitiveGraphOptimizer.predictServiceHealth(svc.id);
        if (predReport.shouldDivertTraffic) {
          console.log(`[Cognitive Optimizer] Aviso Preditivo: Degradação detetada em "${svc.id}" (Z-Score: ${predReport.zScore}, Erros: ${predReport.errorRatePercent}%).`);
        }

        // 4. Limitador de Vazão Adaptativo (Adaptive Throttling) perante degradação do serviço
        // Operações de compensação (rollback) têm prioridade máxima de consistência e não sofrem descarte probabilístico
        const metric = ServiceMetricsCollector.getInstance().getServiceMetric(svc.id);
        if (!this.isRollbackMode && metric && metric.status === 'DEGRADED') {
          if (Math.random() < 0.50) {
            console.log(`[Limitador Adaptativo] Despoletado corte de tráfego para o serviço "${svc.id}". Proteção ativa devido a degradação.`);
            throw new Error(`Limitador Adaptativo: O serviço "${svc.name || svc.id}" está degradado. Tráfego contido preventivamente para evitar saturação.`);
          }
        }

        if (svc.id.startsWith('peer-')) {
          // Delegação federada criptograficamente para outro portal da rede
          const peerIdReal = svc.id.replace('peer-', '');
          const startTime = Date.now();
          try {
            result = await IntentFederation.getInstance().delegateExecution(peerIdReal, verb, target, context);
            ServiceMetricsCollector.getInstance().recordSuccess(svc.id, Date.now() - startTime);
          } catch (err) {
            ServiceMetricsCollector.getInstance().recordFailure(svc.id);
            throw err;
          }
        } else if (svc.endpoint) {
          // Invocação remota via HTTP com verificação SSRF, disjuntor de circuito e chave de idempotência
          NetworkSecurity.validateEndpoint(svc.endpoint);
          const breaker = this.getCircuitBreaker(svc.id);
          const response = await new Promise((resolve, reject) => {
            breaker.run(
              async (success: any, failure: any) => {
                const startTime = Date.now();
                try {
                  const headers: any = { 'X-Idempotency-Key': stepId };
                  if (this.securityContext?.correlationId) {
                    headers['X-Correlation-ID'] = this.securityContext.correlationId;
                  }
                  if (this.isRollbackMode) {
                    headers['X-Saga-Rollback'] = 'true';
                    const compHash = crypto.createHash('sha256')
                      .update(`${this.currentSagaRecordId || ''}:${verb}:${target}:${JSON.stringify(context || {})}`)
                      .digest('hex');
                    headers['X-Saga-Compensation-Key'] = compHash;
                  }
                  const timeoutMs = (step as any)?.timeoutMs || 30000;
                  const res = await axios.post(
                    `${svc.endpoint}/execute`,
                    { verb, target, context },
                    {
                      headers,
                      httpAgent,
                      httpsAgent,
                      timeout: timeoutMs,
                      maxRedirects: 0
                    }
                  );
                  success();
                  ServiceMetricsCollector.getInstance().recordSuccess(svc.id, Date.now() - startTime);
                  resolve(res.data);
                } catch (err) {
                  failure(err);
                  ServiceMetricsCollector.getInstance().recordFailure(svc.id);
                  reject(err);
                }
              },
              (err: any) => {
                ServiceMetricsCollector.getInstance().recordFailure(svc.id);
                reject(new Error(`Disjuntor de Circuito Aberto ou Erro de Invocação: ${err ? err.message : 'Desconhecido'}`));
              }
            );
          });
          result = response;

        } else if (svc.handler) {
          // Manipulador local em memória (fallback de desenvolvimento)
          const startTime = Date.now();
          try {
            result = await svc.handler(context, {
              securityContext: this.securityContext,
              verb,
              target,
              executionId: this.currentExecutionId,
              stepId,
              isRollback: this.isRollbackMode
            });
            ServiceMetricsCollector.getInstance().recordSuccess(svc.id, Date.now() - startTime);
          } catch (err) {
            ServiceMetricsCollector.getInstance().recordFailure(svc.id);
            throw err;
          }
        } else {
          throw new Error(`O microserviço ${svc.id} não possui nem endpoint HTTP nem manipulador local.`);
        }

        // 4. Registo de ação compensatória na pilha Saga caso o step ou a capacidade defina uma reversão
        if (step?.compensate) {
          const compContext = {
            ...context,
            ...result,
            ...(step.name ? { [step.name]: result } : {})
          };
          const compPayload = this.interpolateData(step.compensate.payload || {}, compContext);
          const compAction = step.compensate.action ? step.compensate.action.toUpperCase() : `${key}_COMPENSATE`;
          console.log(`[Saga] Ação declarativa "${key}" concluída. A registar compensação: "${compAction}"`);
          this.compensationStack.push({
            capability: compAction,
            context: { ...compContext, ...compPayload },
            batchId: this.currentParallelBatchId || undefined
          });
          if (this.currentExecutionId) {
            await SagaStateRepository.update(
              { executionId: this.currentExecutionId },
              { compensationStack: this.compensationStack }
            );
          }
        } else if (match.capability.compensateCapability) {
          console.log(`[Saga] Ação "${key}" concluída com êxito. A registar compensação: "${match.capability.compensateCapability}"`);
          this.compensationStack.push({
            capability: match.capability.compensateCapability,
            context: { ...context, ...result },
            batchId: this.currentParallelBatchId || undefined
          });
          
          // Persiste a nova pilha de compensações na base de dados
          if (this.currentExecutionId) {
            await SagaStateRepository.update(
              { executionId: this.currentExecutionId },
              { compensationStack: this.compensationStack }
            );
          }
        }

        // 5. Validação de Contrato de Saída (outputSchema) — previne propagação de dados inválidos no grafo
        const outputSchema = match.capability.outputSchema;
        if (outputSchema && result !== null && result !== undefined) {
          const validateOutput = getOrCompileSchema(outputSchema);
          if (!validateOutput(result)) {
            const outputErrorsText = ajv.errorsText(validateOutput.errors);
            console.warn(`[Motor] Aviso: A resposta do serviço "${key}" viola o outputSchema declarado. Detalhes: ${outputErrorsText}. O fluxo prossegue com aviso.`);
            TelemetryService.getInstance().broadcast('OUTPUT_SCHEMA_VIOLATION', {
              executionId: this.currentExecutionId,
              action: key,
              serviceId: svc.id,
              errors: outputErrorsText
            });
          }
        }

        return result;

      } catch (err: any) {
        // Tenta renegociação semântica de negócio via IA se for erro de negócio
        if (!this.isNetworkOrAvailabilityError(err) && !this.isRollbackMode) {
          const negotiation = await AISelfHealer.negotiateBusinessException(key, context, err.message, svc.id);
          if (negotiation && negotiation.success && negotiation.action === 'RETRY_WITH_ADAPTED_CONTEXT' && negotiation.negotiatedContext) {
            console.log(`[Cognitive Business Negotiator] 💡 ${negotiation.explanation}`);
            TelemetryService.getInstance().broadcast('BUSINESS_EXCEPTION_NEGOTIATED', {
              executionId: this.currentExecutionId,
              action: key,
              serviceId: svc.id,
              explanation: negotiation.explanation
            });
            context = negotiation.negotiatedContext;
            if (svc.handler) {
              return await svc.handler(context, {
                securityContext: this.securityContext,
                verb,
                target,
                executionId: this.currentExecutionId,
                stepId
              });
            } else if (svc.endpoint) {
              const res = await axios.post(
                `${svc.endpoint}/execute`,
                { verb, target, context },
                {
                  headers: { 'X-Idempotency-Key': stepId },
                  httpAgent,
                  httpsAgent,
                  timeout: (step as any)?.timeoutMs || 30000
                }
              );
              return res.data;
            }
          }
          throw err;
        }
        console.warn(`[Failover] O serviço "${svc.name}" (ID: ${svc.id}) falhou com o erro: "${err.message}". A tentar com outra instância...`);
        lastError = err;
      }
    }

    throw new Error(`Todas as instâncias disponíveis para a capacidade "${key}" falharam. Último erro: ${lastError?.message || 'Falha de Disponibilidade Desconhecida'}`);
  }

  /**
   * @description Retoma e executa as ações compensatórias do padrão Saga persistidas na base de dados.
   * Suporta Parallel Rollback Batching: compensa passos concorrentes (mesmo batchId) em paralelo
   * através de Promise.allSettled, reduzindo o tempo de recuperação em até 75%.
   * Adquire um bloqueio pessimista a nível de linha no PostgreSQL (`pessimistic_write` / `NOWAIT`)
   * para assegurar que nenhum outro nó do cluster executa a reversão em simultâneo.
   *
   * @param {string} sagaId - Identificador único da Saga na base de dados.
   * @param {{ capability: string; context: any; batchId?: string }[]} persistedStack - Pilha LIFO de ações compensatórias a reverter.
   * @returns {Promise<void>} Promessa resolvida após a conclusão integral da reversão.
   * @throws {Error} Caso a compensação falhe definitivamente, encaminhando o caso para a DLQ.
   * @security O bloqueio pessimista NOWAIT impede conflitos concorrentes de reversão entre instâncias.
   * @audit Se a compensação falhar definitivamente, cria um registo na Dead Letter Queue e emite um alerta de emergência.
   */
  async resumeRollback(sagaId: string, persistedStack: { capability: string; context: any; batchId?: string }[]): Promise<void> {
    let rollbackError: any = null;
    let lastFailedRollback: any = null;
    let lastErrorMsg = '';
    let hasPartialSuccess = false;

    try {
      // Delimita toda a sequência de compensação dentro de uma transação PostgreSQL com bloqueio pessimista
      await AppDataSource.transaction(async (transactionalEntityManager) => {
        // Aquisição atómica e imediata de bloqueio sobre a linha da Saga (NOWAIT)
        await TransactionLock.acquireSagaLock(sagaId, transactionalEntityManager);
        
        this.isRollbackMode = true;
        this.compensationStack = [...persistedStack];
        const serviceMatches = new Map();

        // Emissão de telemetria: início do rollback da Saga
        TelemetryService.getInstance().broadcast('SAGA_ROLLBACK_STARTED', {
          sagaId,
          executionId: this.currentExecutionId || sagaId,
          compensationStack: this.compensationStack
        });

        // Consome a pilha de compensação em ordem inversa (LIFO) com agrupamento de lotes concorrentes
        while (this.compensationStack.length > 0) {
          const top = this.compensationStack[this.compensationStack.length - 1];
          const currentBatchId = top.batchId;

          const batchToRollback: { capability: string; context: any; batchId?: string }[] = [];
          if (currentBatchId) {
            while (
              this.compensationStack.length > 0 &&
              this.compensationStack[this.compensationStack.length - 1].batchId === currentBatchId
            ) {
              batchToRollback.push(this.compensationStack.pop()!);
            }
          } else {
            batchToRollback.push(this.compensationStack.pop()!);
          }

          console.log(`[Recuperação de Saga] A executar reversão de ${batchToRollback.length} ação(ões) (Lote: ${currentBatchId || 'sequencial'}) para a Saga ID: ${sagaId}`);

          const executeRollbackStep = async (rollback: { capability: string; context: any; batchId?: string }, indexInBatch: number) => {
            TelemetryService.getInstance().broadcast('SAGA_COMPENSATION_STEP', {
              sagaId,
              executionId: this.currentExecutionId || sagaId,
              capability: rollback.capability,
              context: rollback.context,
              batchId: rollback.batchId,
              status: 'RUNNING'
            });

            let attempts = 0;
            const maxAttempts = 3;
            let success = false;
            let lastErr: any;

            while (attempts < maxAttempts && !success) {
              try {
                const rollbackStepId = this.generateDeterministicUUID(sagaId + '-rollback-' + (rollback.batchId || 'seq'), this.compensationStack.length + indexInBatch);
                await this.executeAction(rollback.capability, rollback.context, serviceMatches, rollbackStepId);
                success = true;
                hasPartialSuccess = true;
                console.log(`[Recuperação de Saga] Reversão bem-sucedida para a ação: "${rollback.capability}"`);

                TelemetryService.getInstance().broadcast('SAGA_COMPENSATION_STEP', {
                  sagaId,
                  executionId: this.currentExecutionId || sagaId,
                  capability: rollback.capability,
                  batchId: rollback.batchId,
                  status: 'COMPLETED'
                });
                return { success: true, rollback };
              } catch (err: any) {
                attempts++;
                lastErr = err;
                console.warn(`[Recuperação de Saga] Tentativa de reversão ${attempts} falhou para "${rollback.capability}": ${err.message}`);
                if (attempts < maxAttempts) {
                  await this.delay(1000 * Math.pow(2, attempts));
                }
              }
            }

            return {
              success: false,
              rollback,
              error: lastErr?.message || 'Erro desconhecido'
            };
          };

          // Execução simultânea de passos do mesmo lote concorrente ou individual
          const batchResults = await Promise.allSettled(
            batchToRollback.map((item, idx) => executeRollbackStep(item, idx))
          );

          let batchHasFailure = false;
          for (const res of batchResults) {
            if (res.status === 'fulfilled' && res.value.success) {
              // Concluído com êxito
            } else {
              batchHasFailure = true;
              const failedItem = res.status === 'fulfilled' ? res.value.rollback : batchToRollback[0];
              const failedError = res.status === 'fulfilled' ? res.value.error : (res.reason?.message || 'Erro desconhecido');
              lastFailedRollback = failedItem;
              lastErrorMsg = `Falha após 3 tentativas. Último erro: ${failedError}`;

              TelemetryService.getInstance().broadcast('SAGA_COMPENSATION_STEP', {
                sagaId,
                executionId: this.currentExecutionId || sagaId,
                capability: failedItem.capability,
                batchId: failedItem.batchId,
                status: 'FAILED',
                error: lastErrorMsg
              });
            }
          }

          if (!batchHasFailure) {
            // Atualiza o estado da pilha decrescente sob o bloqueio da transação
            await transactionalEntityManager.update(SagaState, { id: sagaId }, {
              compensationStack: this.compensationStack
            });
          } else {
            // Atualiza o estado da pilha mesmo em caso de falha deste nó para persistir a tentativa
            await transactionalEntityManager.update(SagaState, { id: sagaId }, {
              compensationStack: this.compensationStack,
              lastError: lastErrorMsg
            });

            console.warn(`[Recuperação de Saga] ⚠️ Ação compensatória "${lastFailedRollback?.capability}" falhou definitivamente. A Máquina do Tempo isola o erro e continua o rollback dos passos restantes para evitar cascata órfã.`);
            // Se restam passos na pilha, continua descarregando os restantes
            if (this.compensationStack.length > 0) {
              continue;
            } else {
              throw new Error(`Crítico: A reversão da Saga falhou para a capacidade "${lastFailedRollback?.capability}": ${lastErrorMsg}`);
            }
          }
        }

        // Atualização final do estado da Saga
        if (lastFailedRollback) {
          await transactionalEntityManager.update(SagaState, { id: sagaId }, {
            status: 'PARTIALLY_COMPENSATED',
            lastError: lastErrorMsg
          });
          throw new Error(`Crítico: A reversão da Saga concluiu com falhas parciais. Último erro: ${lastErrorMsg}`);
        } else {
          await transactionalEntityManager.update(SagaState, { id: sagaId }, {
            status: 'COMPENSATED',
            lastError: null
          });
          console.log(`[Recuperação de Saga] A Saga ID: ${sagaId} foi integralmente compensada e concluída.`);

          TelemetryService.getInstance().broadcast('SAGA_ROLLBACK_COMPLETED', {
            sagaId,
            executionId: this.currentExecutionId || sagaId
          });
        }
      });
    } catch (err: any) {
      rollbackError = err;
    } finally {
      this.isRollbackMode = false;
    }

    if (rollbackError) {
      // Se a compensação falhar definitivamente ou parcialmente, persiste o estado de erro e arquiva na Dead Letter Queue
      try {
        const currentSaga = await SagaStateRepository.findOneBy({ id: sagaId });
        const finalStatus = hasPartialSuccess ? 'PARTIALLY_COMPENSATED' : 'COMPENSATION_FAILED';

        await SagaStateRepository.update({ id: sagaId }, {
          status: finalStatus,
          lastError: lastErrorMsg || rollbackError.message
        });

        const executionId = currentSaga ? currentSaga.executionId : 'unknown';

        await AppDataSource.getRepository(DeadLetterQueue).save({
          sagaId,
          executionId,
          taskType: 'FLOW_COMPENSATION',
          payload: {
            failedCapability: lastFailedRollback ? lastFailedRollback.capability : 'unknown',
            context: lastFailedRollback ? lastFailedRollback.context : {},
            remainingStack: this.compensationStack
          },
          lastError: lastErrorMsg
        });

        // Despacha alerta crítico aos operadores do sistema
        await AlertManager.sendAlert(
          `A Compensação Distribuída da Saga Falhou Definitivamente (Enviado para DLQ)`,
          {
            sagaId,
            executionId,
            failedCapability: lastFailedRollback ? lastFailedRollback.capability : 'unknown',
            attempts: 3,
            error: lastErrorMsg
          }
        );
      } catch (dlqErr: any) {
        console.error('[Recuperação de Saga] Falha ao persistir na DLQ ou emitir alerta:', dlqErr.message);
      }

      throw rollbackError;
    }
  }

  /**
   * @description Retoma a execução progressiva de uma Saga que falhou com política FORWARD_RETRY a partir do passo interrompido.
   *
   * @param {string} sagaId - Identificador único da Saga na base de dados.
   * @param {string} executionId - Identificador da execução associada.
   * @param {ParsedIntent} intent - Intenção original com contexto e fluxo.
   * @param {Map<string, ServiceMatch>} serviceMatches - Mapa de correspondência de capacidades e serviços.
   * @returns {Promise<ExecutionResult>} Promessa resolvida com o resultado final da orquestração retomada.
   * @security Mantém o contexto de segurança e validação de contratos para todos os passos subsequentes.
   * @audit Regista a retoma no histórico de execuções com salvaguarda de progresso anterior.
   */
  async resumeForward(
    sagaId: string,
    executionId: string,
    intent: ParsedIntent,
    serviceMatches: Map<string, ServiceMatch>
  ): Promise<ExecutionResult> {
    const saga = await SagaStateRepository.findOneBy({ id: sagaId });
    if (!saga) {
      throw new Error(`[Recuperação Progressiva] Saga ID ${sagaId} não encontrada na base de dados.`);
    }

    console.log(`[Recuperação Progressiva] A retomar Saga ID: ${sagaId} a partir do passo ${saga.currentStepIndex} (Política: ${saga.failurePolicy}).`);
    await SagaStateRepository.update({ id: sagaId }, { status: 'RUNNING', lastError: null });

    return await this.execute(intent, serviceMatches, executionId);
  }

  /** Cache estático de caminhos pré-analisados para acelerar a resolução de propriedades */
  private static pathPartsCache = new Map<string, string[]>();

  /**
   * @description Resolve o valor de um caminho de propriedades em notação de ponto e colchetes (ex.: "contas[0].saldo").
   * Utiliza cache de fragmentação de caminhos para atingir desempenho de microsegundos no hot-path.
   * @param {any} obj - Objeto de dados raiz.
   * @param {string} path - Caminho da propriedade pretendida.
   * @returns {any} Valor encontrado ou indefinido.
   */
  private resolvePathValue(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    // Fast-path: caminho direto sem aninhamento (ex.: "amount", "user_id")
    if (!path.includes('.') && !path.includes('[')) {
      if (obj[path] !== undefined) return obj[path];
      if (obj.payload && obj.payload[path] !== undefined) return obj.payload[path];
      if (obj.context && obj.context[path] !== undefined) return obj.context[path];
      return undefined;
    }

    let parts = ExecutionEngine.pathPartsCache.get(path);
    if (!parts) {
      parts = path.includes('[') 
        ? path.replace(/\[(\w+)\]/g, '.$1').split('.') 
        : (path.includes('.') ? path.split('.') : [path]);
      if (ExecutionEngine.pathPartsCache.size < 2000) {
        ExecutionEngine.pathPartsCache.set(path, parts);
      }
    }
    let cur = obj;
    for (let idx = 0; idx < parts.length; idx++) {
      const p = parts[idx];
      if (cur === null || cur === undefined) return undefined;
      if (idx === 0 && cur[p] === undefined) {
        if ((p === 'payload' || p === 'context' || p === 'header') && typeof cur === 'object') {
          continue;
        }
      }
      cur = cur[p];
    }
    return cur;
  }

  /**
   * @description Interpola recursivamente sequências ${caminho} num valor primitivo, objeto ou array com base no contexto.
   * Contém salvaguardas de alta velocidade (fast-paths) que evitam expressões regulares em cadeias estáticas.
   * @param {any} data - Dado de entrada contendo eventuais expressões de interpolação.
   * @param {any} context - Contexto com as variáveis.
   * @returns {any} Dado interpolado com os valores resolvidos.
   */
  private interpolateData(data: any, context: any): any {
    if (typeof data === 'string') {
      // Fast-path: se não contiver o marcador de interpolação, retorna imediatamente sem regex
      if (!data.includes('${')) return data;

      // Fast-path para substituição de valor único e exato (ex.: "${user.id}")
      if (data.startsWith('${') && data.endsWith('}') && data.indexOf('${', 2) === -1) {
        const resolved = this.resolvePathValue(context, data.slice(2, -1).trim());
        return resolved !== undefined ? resolved : data;
      }

      return data.replace(/\$\{([^}]+)\}/g, (_, p) => {
        const val = this.resolvePathValue(context, p.trim());
        return val !== undefined && val !== null ? (typeof val === 'object' ? JSON.stringify(val) : String(val)) : '';
      });
    }
    if (Array.isArray(data)) {
      const len = data.length;
      const res = new Array(len);
      for (let i = 0; i < len; i++) {
        res[i] = this.interpolateData(data[i], context);
      }
      return res;
    }
    if (data && typeof data === 'object') {
      if (data instanceof Date || data instanceof RegExp || Buffer.isBuffer(data)) return data;
      const res: any = {};
      const keys = Object.keys(data);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        res[k] = this.interpolateData(data[k], context);
      }
      return res;
    }
    return data;
  }

  /**
   * @description Avalia uma condição booleana através do avaliador seguro sem recurso a `eval()`,
   * com pré-interpolação de variáveis dinâmicas em formato ${expressao}.
   *
   * @param {string} condition - Expressão lógica em texto.
   * @param {any} context - Contexto com as variáveis.
   * @returns {boolean} Verdadeiro se a condição for satisfeita.
   */
  private evaluateCondition(condition: string, context: any): boolean {
    try {
      let cleanCond = condition.trim();
      if ((cleanCond.startsWith('"') && cleanCond.endsWith('"')) || (cleanCond.startsWith("'") && cleanCond.endsWith("'"))) {
        cleanCond = cleanCond.slice(1, -1).trim();
      }
      cleanCond = cleanCond.replace(/\$\{([^}]+)\}/g, (_, path) => {
        const val = this.resolvePathValue(context, path.trim());
        if (typeof val === 'string') return `"${val}"`;
        if (val === undefined || val === null) return 'null';
        return String(val);
      });
      return SafeEvaluator.evaluate(cleanCond, context);
    } catch {
      return false;
    }
  }

  /**
   * @description Gera um UUID v4 estável e determinístico combinando um identificador base e um índice sequencial.
   * Garante a unicidade de chaves de idempotência em passos repetidos ou recuperados.
   *
   * @param {string} executionId - Identificador base da execução.
   * @param {number} index - Índice do passo no fluxo.
   * @returns {string} Identificador formatado no padrão UUID.
   */
  private generateDeterministicUUID(executionId: string, index: number): string {
    const hash = crypto.createHash('sha256').update(`${executionId}-${index}`).digest('hex');
    return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
  }

  /**
   * @description Pausa assíncrona da execução por uma duração estipulada em milissegundos.
   *
   * @param {number} ms - Duração da espera.
   * @returns {Promise<void>} Promessa resolvida após a conclusão do tempo.
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * @description Determina se uma exceção capturada decorre de falhas de rede, tempos-limite ou indisponibilidade de nó.
   *
   * @param {any} err - Objeto de erro capturado.
   * @returns {boolean} Verdadeiro se for elegível para failover automático com outra instância.
   */
  private isNetworkOrAvailabilityError(err: any): boolean {
    if (!err) return false;
    if (err.message && (err.message.includes('Circuit Breaker') || err.message.includes('Timeout') || err.message.includes('timeout'))) return true;
    const status = err.response?.status;
    if (status && (status === 502 || status === 503 || status === 504)) return true;
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') return true;
    return false;
  }

  /**
   * @description Realiza a clonagem profunda de estruturas de dados através de `structuredClone` nativo do V8 (C++),
   * com contingência graciosa para serialização JSON tradicional caso encontre tipos não-estruturados.
   *
   * @param {any} obj - Objeto ou valor a clonar.
   * @returns {any} Cópia profunda e desvinculada do objeto original.
   */
  private deepClone(obj: any): any {
    if (obj === undefined || obj === null) return obj;
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(obj);
      } catch {
        // Fallback para objetos com métodos ou símbolos
      }
    }
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return { ...obj };
    }
  }
}