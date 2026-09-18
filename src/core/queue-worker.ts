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
  /** Intervalo dinâmico de sondagem adaptativa (evita saturação em períodos ociosos) */
  private static pollIntervalMs = 500;
  private static readonly MIN_POLL_INTERVAL_MS = 500;
  private static readonly MAX_POLL_INTERVAL_MS = 5000;

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

    let foundJob = false;
    let claimedJob: QueueJob | null = null;

    try {
      // FASE 1 — Transação curta de captura atómica: seleciona e reserva um trabalho com SKIP LOCKED
      await AppDataSource.transaction(async (entityManager) => {
        const job = await entityManager.createQueryBuilder(QueueJob, 'job')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .where("job.status = 'PENDING' AND job.task_type NOT LIKE 'TEST_%' AND job.scheduled_at <= :now", { now: new Date() })
          .orderBy('job.created_at', 'ASC')
          .getOne();

        if (job) {
          foundJob = true;
          job.status = 'PROCESSING';
          job.attempts += 1;
          job.lockedBy = this.workerId;
          job.lockedAt = new Date();
          await entityManager.save(job);
          claimedJob = job;
          console.log(`[Trabalhador de Fila] Tarefa capturada: ID ${job.id} (Tipo: ${job.taskType})`);
        }
      });

      // FASE 2 — Execução fora de qualquer transação: a conexão à BD fica livre durante invocações HTTP
      if (claimedJob) {
        const job = claimedJob as QueueJob;
        let executionError: any = null;

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
        } catch (err: any) {
          console.error(`[Trabalhador de Fila] A execução da tarefa ID ${job.id} falhou:`, err.message);
          executionError = err;
        }

        // FASE 3 — Transação curta de finalização: persiste o resultado e liberta o bloqueio
        await AppDataSource.transaction(async (entityManager) => {
          // Recarrega o registo para obter a versão mais recente antes de atualizar
          const freshJob = await entityManager.findOneBy(QueueJob, { id: job.id });
          if (!freshJob) return;

          freshJob.lockedAt = null;
          freshJob.lockedBy = null;

          if (!executionError) {
            freshJob.status = 'COMPLETED';
            freshJob.lastError = null;
          } else {
            freshJob.lastError = executionError.message;

            if (freshJob.attempts < freshJob.maxAttempts) {
              freshJob.status = 'PENDING';
              const delaySeconds = Math.pow(2, freshJob.attempts);
              freshJob.scheduledAt = new Date(Date.now() + delaySeconds * 1000);
            } else {
              freshJob.status = 'FAILED';
              
              try {
                await entityManager.save(DeadLetterQueue, {
                  sagaId: freshJob.sagaId,
                  executionId: freshJob.executionId,
                  taskType: freshJob.taskType,
                  payload: freshJob.payload,
                  lastError: executionError.message
                });
                
                await AlertManager.sendAlert(
                  `Falha Definitiva de Tarefa Assíncrona: ${freshJob.taskType}`,
                  {
                    jobId: freshJob.id,
                    sagaId: freshJob.sagaId,
                    executionId: freshJob.executionId,
                    taskType: freshJob.taskType,
                    attempts: freshJob.attempts,
                    error: executionError.message
                  }
                );
              } catch (dlqErr: any) {
                console.error('[Trabalhador de Fila] Falha ao persistir na Dead Letter Queue:', dlqErr.message);
              }
            }
          }

          await entityManager.save(freshJob);
        });
      }
    } catch (err: any) {
      console.error('[Trabalhador de Fila] Erro na transação de sondagem:', err.message);
    }

    // Regulação adaptativa: se encontrou tarefa, retoma 500ms; se ocioso, aumenta até 5s para poupar CPU
    if (foundJob) {
      this.pollIntervalMs = this.MIN_POLL_INTERVAL_MS;
    } else {
      this.pollIntervalMs = Math.min(this.MAX_POLL_INTERVAL_MS, Math.floor(this.pollIntervalMs * 1.5));
    }
    this.timer = setTimeout(() => this.poll(), this.pollIntervalMs);
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
