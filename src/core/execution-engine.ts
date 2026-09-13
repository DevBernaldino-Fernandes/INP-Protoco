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

// Instância do validador AJV para conformidade de contratos de dados
const ajv = new Ajv({ allErrors: true });

// Configuração global de retentativas automáticas no cliente HTTP Axios com atraso exponencial
axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

/**
 * @description Motor de orquestração e execução de fluxos transacionais do protocolo INP.
 */
export class ExecutionEngine {
  /** Memória estática de índices para balanceamento equitativo em Round-Robin entre instâncias de serviços */
  private static lastChosenIndices = new Map<string, number>();

  /** Pilha transacional de compensações registadas em ordem LIFO (Last-In, First-Out) */
  private compensationStack: { capability: string; context: any }[] = [];
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
      finalOutput = await this.executeFlow(intent.flow, intent.context, serviceMatches, steps, 0, stateTracker);
      
      // Marca a Saga como concluída com êxito na base de dados
      await SagaStateRepository.update({ id: sagaRecord.id }, { status: 'COMPLETED' });
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
          const promises = step.steps.map(sub =>
            this.executeFlow([sub], current, serviceMatches, allSteps, depth+1, stateTracker)
          );
          const results = await Promise.all(promises);
          output = results;
          current = output;
        } else if (step.type === 'CONDITION' && step.condition && this.evaluateCondition(step.condition, current)) {
          if (step.steps) {
            output = await this.executeFlow(step.steps, current, serviceMatches, allSteps, depth+1, stateTracker);
            current = output;
          }
        } else if (step.type === 'RETRY') {
          let attempts = 0;
          const max = step.retryCount || 3;
          let success = false;
          while (attempts < max && !success) {
            try {
              output = await this.executeAction(step.action!, current, serviceMatches, stepId);
              success = true;
              current = output;
            } catch (err) {
              attempts++;
              if (attempts >= max) throw err;
              await this.delay(1000 * Math.pow(2, attempts) + Math.random() * 200);
            }
          }
        } else if (step.type === 'FALLBACK' && step.fallback) {
          output = await this.executeAction(step.fallback, current, serviceMatches, stepId);
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
            console.log(`[Motor] A executar validação de prova criptográfica ZK: "${step.action}"`);
            ZKVerifier.verifyProof(field, op, boundary, current);
            output = current;
          } else if (step.action === 'CONFIDENTIAL') {
            console.log('[Motor] A entrar em âmbito de execução confidencial (Confidential Scope)...');
            const localContext = JSON.parse(JSON.stringify(current));
            
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
            const localContext = JSON.parse(JSON.stringify(current));
            output = await this.executeFlow(step.steps, localContext, serviceMatches, allSteps, depth+1, stateTracker);
            current = output;
          }
        } else if (step.type === 'DEPENDENCY' && step.steps) {
          output = await this.executeFlow(step.steps, current, serviceMatches, allSteps, depth+1, stateTracker);
          current = output;
        } else if (step.action) {
          output = await this.executeAction(step.action, current, serviceMatches, stepId);
          current = (output && typeof output === 'object' && !Array.isArray(output)) ? { ...current, ...output } : output;
        }
        stepStatus = 'COMPLETED';

        // Atualiza e persiste o índice de progresso da Saga na base de dados
        if (this.currentSagaRecordId) {
          await SagaStateRepository.update(this.currentSagaRecordId, {
            currentStepIndex: stepIndex + 1
          });
        }
      } catch (err: any) {
        stepStatus = 'FAILED';
        error = err.message;
        throw err;
      } finally {
        const durationMs = Date.now() - start;
        allSteps.push({
          stepId,
          action: step.action || step.type,
          status: stepStatus,
          input: DataSanitizer.sanitize(current),
          output: DataSanitizer.sanitize(output),
          error,
          durationMs,
          timestamp: new Date(),
        });

        // Emissão de telemetria: conclusão ou insucesso do passo com dados sanitizados
        TelemetryService.getInstance().broadcast(stepStatus === 'COMPLETED' ? 'STEP_COMPLETED' : 'STEP_FAILED', {
          executionId: this.currentExecutionId,
          stepIndex,
          stepId,
          action: step.action || step.type,
          output: DataSanitizer.sanitize(output),
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
  private async executeAction(action: string, context: any, serviceMatches: Map<string, ServiceMatch>, stepId: string): Promise<any> {
    const [verb, ...rest] = action.trim().split(/\s+/);
    const target = rest.join(' ');
    const key = `${verb} ${target}`.toUpperCase();
    
    const matches = await this.registry.findServicesForCapability(key);
    if (matches.length === 0) {
      throw new Error(`Nenhum microserviço registado para a capacidade: ${key}`);
    }

    // Seleção com balanceamento equitativo (Round-Robin) entre as instâncias disponíveis
    let lastIndex = ExecutionEngine.lastChosenIndices.get(key) ?? -1;
    let chosenIndex = (lastIndex + 1) % matches.length;
    ExecutionEngine.lastChosenIndices.set(key, chosenIndex);

    const orderedMatches = [
      ...matches.slice(chosenIndex),
      ...matches.slice(0, chosenIndex)
    ];

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
          const validate = ajv.compile(schema);
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
              const reValidate = ajv.compile(schema);
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

        // 3. Limitador de Vazão Adaptativo (Adaptive Throttling) perante degradação do serviço
        const metric = ServiceMetricsCollector.getInstance().getServiceMetric(svc.id);
        if (metric && metric.status === 'DEGRADED') {
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
          const breaker = new CircuitBreaker({ timeoutDuration: 5000, errorThreshold: 50 });
          const response = await new Promise((resolve, reject) => {
            breaker.run(
              async (success: any, failure: any) => {
                const startTime = Date.now();
                try {
                  const headers: any = { 'X-Idempotency-Key': stepId };
                  if (this.securityContext?.correlationId) {
                    headers['X-Correlation-ID'] = this.securityContext.correlationId;
                  }
                  const res = await axios.post(
                    `${svc.endpoint}/execute`,
                    { verb, target, context },
                    { headers }
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
            result = await svc.handler(context, { securityContext: this.securityContext });
            ServiceMetricsCollector.getInstance().recordSuccess(svc.id, Date.now() - startTime);
          } catch (err) {
            ServiceMetricsCollector.getInstance().recordFailure(svc.id);
            throw err;
          }
        } else {
          throw new Error(`O microserviço ${svc.id} não possui nem endpoint HTTP nem manipulador local.`);
        }

        // 4. Registo de ação compensatória na pilha Saga caso a capacidade defina uma reversão
        if (match.capability.compensateCapability) {
          console.log(`[Saga] Ação "${key}" concluída com êxito. A registar compensação: "${match.capability.compensateCapability}"`);
          this.compensationStack.push({
            capability: match.capability.compensateCapability,
            context: { ...context, ...result }
          });
          
          // Persiste a nova pilha de compensações na base de dados
          if (this.currentExecutionId) {
            await SagaStateRepository.update(
              { executionId: this.currentExecutionId },
              { compensationStack: this.compensationStack }
            );
          }
        }

        return result;

      } catch (err: any) {
        // Se o erro não for de conectividade ou disponibilidade, interrompe o fluxo imediatamente
        if (!this.isNetworkOrAvailabilityError(err)) {
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
   * Adquire um bloqueio pessimista a nível de linha no PostgreSQL (`pessimistic_write` / `NOWAIT`)
   * para assegurar que nenhum outro nó do cluster executa a reversão em simultâneo.
   *
   * @param {string} sagaId - Identificador único da Saga na base de dados.
   * @param {{ capability: string; context: any }[]} persistedStack - Pilha LIFO de ações compensatórias a reverter.
   * @returns {Promise<void>} Promessa resolvida após a conclusão integral da reversão.
   * @throws {Error} Caso a compensação falhe definitivamente, encaminhando o caso para a DLQ.
   * @security O bloqueio pessimista NOWAIT impede conflitos concorrentes de reversão entre instâncias.
   * @audit Se a compensação falhar definitivamente, cria um registo na Dead Letter Queue e emite um alerta de emergência.
   */
  async resumeRollback(sagaId: string, persistedStack: { capability: string; context: any }[]): Promise<void> {
    let rollbackError: any = null;
    let lastFailedRollback: any = null;
    let lastErrorMsg = '';

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

        // Consome a pilha de compensação em ordem inversa (LIFO)
        while (this.compensationStack.length > 0) {
          const rollback = this.compensationStack.pop()!;
          console.log(`[Recuperação de Saga] A executar reversão: "${rollback.capability}" para a Saga ID: ${sagaId}`);
          
          TelemetryService.getInstance().broadcast('SAGA_COMPENSATION_STEP', {
            sagaId,
            executionId: this.currentExecutionId || sagaId,
            capability: rollback.capability,
            context: rollback.context,
            status: 'RUNNING'
          });
          
          let attempts = 0;
          const maxAttempts = 3;
          let success = false;
          let lastErr: any;
          
          while (attempts < maxAttempts && !success) {
            try {
              const rollbackStepId = this.generateDeterministicUUID(sagaId + '-rollback', this.compensationStack.length);
              await this.executeAction(rollback.capability, rollback.context, serviceMatches, rollbackStepId);
              success = true;
              console.log(`[Recuperação de Saga] Reversão bem-sucedida para a ação: "${rollback.capability}"`);
              
              TelemetryService.getInstance().broadcast('SAGA_COMPENSATION_STEP', {
                sagaId,
                executionId: this.currentExecutionId || sagaId,
                capability: rollback.capability,
                status: 'COMPLETED'
              });
            } catch (err: any) {
              attempts++;
              lastErr = err;
              console.warn(`[Recuperação de Saga] Tentativa de reversão ${attempts} falhou para "${rollback.capability}": ${err.message}`);
              if (attempts < maxAttempts) {
                await this.delay(1000 * Math.pow(2, attempts));
              }
            }
          }

          if (success) {
            // Atualiza o estado da pilha decrescente sob o bloqueio da transação
            await transactionalEntityManager.update(SagaState, { id: sagaId }, {
              compensationStack: this.compensationStack
            });
          } else {
            lastFailedRollback = rollback;
            lastErrorMsg = `Falha após ${maxAttempts} tentativas. Último erro: ${lastErr.message}`;
            
            TelemetryService.getInstance().broadcast('SAGA_COMPENSATION_STEP', {
              sagaId,
              executionId: this.currentExecutionId || sagaId,
              capability: rollback.capability,
              status: 'FAILED',
              error: lastErrorMsg
            });

            throw new Error(`Crítico: A reversão da Saga falhou para a capacidade "${rollback.capability}": ${lastErr.message}`);
          }
        }

        // Atualização final do estado da Saga para COMPENSATED
        await transactionalEntityManager.update(SagaState, { id: sagaId }, {
          status: 'COMPENSATED',
          lastError: null
        });
        console.log(`[Recuperação de Saga] A Saga ID: ${sagaId} foi integralmente compensada e concluída.`);

        TelemetryService.getInstance().broadcast('SAGA_ROLLBACK_COMPLETED', {
          sagaId,
          executionId: this.currentExecutionId || sagaId
        });
      });
    } catch (err: any) {
      rollbackError = err;
    } finally {
      this.isRollbackMode = false;
    }

    if (rollbackError) {
      // Se a compensação falhar definitivamente, persiste o estado de erro e arquiva na Dead Letter Queue
      try {
        await SagaStateRepository.update(sagaId, {
          status: 'COMPENSATION_FAILED',
          lastError: lastErrorMsg
        });

        const currentSaga = await SagaStateRepository.findOneBy({ id: sagaId });
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
   * @description Avalia uma condição booleana através do avaliador seguro sem recurso a `eval()`.
   *
   * @param {string} condition - Expressão lógica em texto.
   * @param {any} context - Contexto com as variáveis.
   * @returns {boolean} Verdadeiro se a condição for satisfeita.
   */
  private evaluateCondition(condition: string, context: any): boolean {
    try {
      return SafeEvaluator.evaluate(condition, context);
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
}