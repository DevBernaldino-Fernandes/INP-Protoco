/**
 * @fileoverview Entidade TypeORM de Tarefas em Fila (Transactional Outbox Pattern)
 * @module Persistence/Entities/QueueJob
 * @description
 * Modela a tabela `queue_jobs` na base de dados PostgreSQL.
 * Implementa o padrão Transactional Outbox para processamento assíncrono fiável
 * de tarefas de fluxo e passos de compensação no ecossistema INP.
 * Suporta bloqueio pessimista / lease distribuído (`locked_by`, `locked_at`)
 * para prevenir que múltiplos trabalhadores processem a mesma tarefa concorrentemente.
 *
 * @security O bloqueio por identificador de instância previne ataques de repetição e condições de corrida.
 * @audit Permite rastrear o número de tentativas (`attempts`), os limites estabelecidos (`max_attempts`)
 * e os erros intermédios para auditoria de resiliência e conformidade operacional.
 */

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * @description Entidade representativa de uma tarefa assíncrona gerida na fila do sistema.
 */
@Entity('queue_jobs')
export class QueueJob {
  /**
   * Identificador único global (UUID v4) da tarefa em fila.
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Identificador da Saga transacional à qual a tarefa pertence.
   */
  @Column({ type: 'varchar', name: 'saga_id' })
  sagaId: string;

  /**
   * Identificador da execução associada.
   */
  @Column({ type: 'varchar', name: 'execution_id' })
  executionId: string;

  /**
   * Categoria da tarefa ('FLOW_EXECUTION', 'FLOW_COMPENSATION', etc.).
   */
  @Column({ type: 'varchar', name: 'task_type' })
  taskType: string;

  /**
   * Carga útil contendo os parâmetros contextuais necessários à execução.
   */
  @Column({ type: 'jsonb' })
  payload: any;

  /**
   * Estado atual da tarefa na fila ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED').
   */
  @Column({ type: 'varchar', default: 'PENDING' })
  status: string;

  /**
   * Número de tentativas de execução já efetuadas.
   */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /**
   * Número máximo de tentativas autorizadas antes de mover para a Dead Letter Queue.
   */
  @Column({ type: 'int', name: 'max_attempts', default: 3 })
  maxAttempts: number;

  /**
   * Mensagem descritiva do último erro ocorrido durante uma tentativa com falha.
   */
  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError: string | null;

  /**
   * Carimbo temporal em que a tarefa foi bloqueada por um trabalhador ativo.
   */
  @Column({ type: 'timestamp', name: 'locked_at', nullable: true })
  lockedAt: Date | null;

  /**
   * Identificador único do trabalhador (worker) que detém atualmente o bloqueio.
   */
  @Column({ type: 'varchar', name: 'locked_by', nullable: true })
  lockedBy: string | null;

  /**
   * Momento agendado para a execução ou reprocessamento da tarefa.
   */
  @Column({ type: 'timestamp', name: 'scheduled_at', default: () => 'CURRENT_TIMESTAMP' })
  scheduledAt: Date;

  /**
   * Data de criação do registo da tarefa na fila.
   */
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /**
   * Data da última atualização de estado ou incremento de tentativa.
   */
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
