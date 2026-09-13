/**
 * @fileoverview Trabalhador Assíncrono de Fila de Tarefas e Compensações (QueueWorker)
 * @module Core/QueueWorker
 * @description
 * Processa de forma assíncrona tarefas persistidas na tabela de outbox (`queue_jobs`).
 * Executa fluxos diferidos (`FLOW_EXECUTION`) e compensações do padrão Saga (`FLOW_COMPENSATION`).
 * Recorre a bloqueios pessimistas da base de dados PostgreSQL com a cláusula `SKIP LOCKED`
 * para garantir que múltiplos nós de trabalho concorrentes não disputam nem bloqueiam
 * os mesmos registos, alcançando escalabilidade horizontal sem colisões.
 * Gere retentativas com recuo exponencial (*exponential backoff*), encaminhamento para DLQ e
 * recuperação periódica de bloqueios órfãos (*lock reaping*).
 *
 * @security O isolamento via `SKIP LOCKED` e a atribuição de identificador único de trabalhador
 * (`workerId`) previnem condições de corrida, execuções duplicadas e saturação transacional.
 * @audit Cada transição de estado na fila (PENDING -> PROCESSING -> COMPLETED/FAILED) é
 * transacionalmente persistida em PostgreSQL, garantindo integridade e rastreabilidade total.
 */

import { AppDataSource } from '../persistence/data-source';
import { QueueJob } from '../persistence/entities/QueueJob';
import { DeadLetterQueue } from '../persistence/entities/DeadLetterQueue';
import { INPCore } from './inp-core';
import { ExecutionEngine } from './execution-engine';
import { AlertManager } from './alert-manager';
import { v4 as uuidv4 } from 'uuid';

/**
 * @description Trabalhador de segundo plano para processamento distribuído e tolerante a falhas de tarefas em fila.
 */
export class QueueWorker {
  /** Identificador único desta instância do trabalhador no cluster */
  private static workerId = `trabalhador_${uuidv4()}`;
  /** Indicador do estado operacional do ciclo de escuta */
  private static isRunning = false;
  /** Temporizador de controlo da rotina periódica de sondagem (polling) */
  private static timer: NodeJS.Timeout | null = null;
  /** Carimbo temporal da última execução da limpeza de bloqueios expirados */
  private static lastReapTime = 0;
  /** Intervalo entre verificações de tarefas órfãs (30 segundos) */
  private static REAP_INTERVAL_MS = 30000;

  /**
   * @description Inicializa o ciclo contínuo de escuta e consumo de tarefas da fila.
   * @audit Regista a entrada em funcionamento da instância do trabalhador com o seu identificador único.
   */
  static start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[Trabalhador de Fila] Ativo e em escuta com o identificador: ${this.workerId}`);
    this.poll();
  }

  /**
   * @description Interrompe de forma ordeira o ciclo de sondagem do trabalhador.
   */
  static stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    console.log('[Trabalhador de Fila] Processamento interrompido.');
  }

  /**
   * @description Ciclo central de sondagem (polling) executado a cada 500ms.
   * Executa a captura atómica de um trabalho com `SKIP LOCKED` dentro de uma transação ACID.
   */
  private static async poll() {
    if (!this.isRunning) return;

    // Limpeza periódica preventiva de tarefas bloqueadas por processos que possam ter caído
    const now = Date.now();
    if (now - this.lastReapTime > this.REAP_INTERVAL_MS) {
      this.lastReapTime = now;
      await this.reapExpiredLocks();
    }

    try {
      // Execução delimitada numa transação isolada da base de dados
      await AppDataSource.transaction(async (entityManager) => {
        // Seleciona um trabalho com estado PENDING, ignorando linhas bloqueadas por outros trabalhadores
        const job = await entityManager.createQueryBuilder(QueueJob, 'job')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .where("job.status = 'PENDING' AND job.task_type NOT LIKE 'TEST_%' AND job.scheduled_at <= :now", { now: new Date() })
          .orderBy('job.created_at', 'ASC')
          .getOne();

        if (job) {
          console.log(`[Trabalhador de Fila] Tarefa capturada: ID ${job.id} (Tipo: ${job.taskType})`);
          
          // Altera o estado para PROCESSING e sela a posse do registo com o identificador deste nó
          job.status = 'PROCESSING';
          job.attempts += 1;
          job.lockedBy = this.workerId;
          job.lockedAt = new Date();
          await entityManager.save(job);

          try {
            if (job.taskType === 'FLOW_EXECUTION') {
              const { text, isNaturalLanguage, securityContext, executionId } = job.payload;
              const core = new INPCore(undefined, securityContext);
              
              const registry = core.getRegistry();
              const parser = core.getParser();
              const matchingEngine = core.getMatchingEngine();

              // Análise sintática da intenção
              let intent;
              if (isNaturalLanguage) {
                const services = await registry.getAllServices();
                const activeCaps = services.flatMap(s =>
                  (s.capabilities as any[]).map(c => `${c.verb} ${c.target}`.toUpperCase())
                );
                intent = await parser.parseNaturalAsync(text, activeCaps);
              } else {
                intent = parser.parse(text);
              }

              // Correspondência com serviços registados
              const serviceMatches = await matchingEngine.matchIntent(intent);
              const normalized = new Map();
              for (const [req, match] of serviceMatches.entries()) {
                normalized.set(req.toUpperCase(), match);
              }

              // Execução da orquestração reutilizando o ID previamente emitido na fila
              const execEngine = new ExecutionEngine(registry, securityContext);
              await execEngine.execute(intent, normalized, executionId);
              
            } else if (job.taskType === 'FLOW_COMPENSATION') {
              // Execução de compensação distribuída em caso de rollback assíncrono
              const { sagaId, persistedStack } = job.payload;
              const core = new INPCore();
              const execEngine = new ExecutionEngine(core.getRegistry());
              await execEngine.resumeRollback(sagaId, persistedStack);
            }

            // Marcação de conclusão bem-sucedida
            job.status = 'COMPLETED';
            job.lastError = null;
          } catch (err: any) {
            console.error(`[Trabalhador de Fila] A execução da tarefa ID ${job.id} falhou:`, err.message);
            job.lastError = err.message;

            // Se o limite de retentativas ainda não foi esgotado, recalcula novo agendamento com backoff
            if (job.attempts < job.maxAttempts) {
              job.status = 'PENDING';
              // Recuo exponencial: 2 elevado ao número de tentativas em segundos
              const delaySeconds = Math.pow(2, job.attempts);
              job.scheduledAt = new Date(Date.now() + delaySeconds * 1000);
            } else {
              // Limite de retentativas excedido: marca como FAILED e migra para a Dead Letter Queue (DLQ)
              job.status = 'FAILED';
              
              try {
                await entityManager.save(DeadLetterQueue, {
                  sagaId: job.sagaId,
                  executionId: job.executionId,
                  taskType: job.taskType,
                  payload: job.payload,
                  lastError: err.message
                });
                
                // Emissão de alerta urgente de falha definitiva para operadores
                await AlertManager.sendAlert(
                  `Falha Definitiva de Tarefa Assíncrona: ${job.taskType}`,
                  {
                    jobId: job.id,
                    sagaId: job.sagaId,
                    executionId: job.executionId,
                    taskType: job.taskType,
                    attempts: job.attempts,
                    error: err.message
                  }
                );
              } catch (dlqErr: any) {
                console.error('[Trabalhador de Fila] Falha ao persistir na Dead Letter Queue:', dlqErr.message);
              }
            }
          }
          
          // Liberta o bloqueio e persiste o desfecho da tentativa
          job.lockedAt = null;
          job.lockedBy = null;
          await entityManager.save(job);
        }
      });
    } catch (err: any) {
      console.error('[Trabalhador de Fila] Erro na transação de sondagem:', err.message);
    }

    // Reagenda a próxima iteração após 500 milissegundos
    this.timer = setTimeout(() => this.poll(), 500);
  }

  /**
   * @description Recupera e desbloqueia tarefas que permaneceram no estado PROCESSING
   * por tempo excessivo (ex.: paragem abrupta do nó de execução).
   * Repõe o estado para PENDING para que outro trabalhador ativo possa assumir o processamento.
   *
   * @audit Garante a resiliência e recuperação automática do cluster sem necessidade de intervenção manual.
   */
  private static async reapExpiredLocks(): Promise<void> {
    try {
      const expirationMs = parseInt(process.env.LOCK_EXPIRATION_MS || '300000', 10);
      const expiredTime = new Date(Date.now() - expirationMs);
      
      const result = await AppDataSource.getRepository(QueueJob)
        .createQueryBuilder('job')
        .update()
        .set({
          status: 'PENDING',
          lockedBy: null,
          lockedAt: null
        })
        .where("status = 'PROCESSING' AND locked_at < :expiredTime", { expiredTime })
        .execute();

      if (result.affected && result.affected > 0) {
        console.log(`[Trabalhador de Fila] Limpeza de Bloqueios: Recuperadas ${result.affected} tarefas bloqueadas indevidamente.`);
      }
    } catch (err: any) {
      console.error('[Trabalhador de Fila] Erro na limpeza de bloqueios expirados:', err.message);
    }
  }
}
