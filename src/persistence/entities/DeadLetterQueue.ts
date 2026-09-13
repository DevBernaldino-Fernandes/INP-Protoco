/**
 * @fileoverview Entidade TypeORM da Fila de Mensagens Mortas (Dead Letter Queue - DLQ)
 * @module Persistence/Entities/DeadLetterQueue
 * @description
 * Modela a tabela `dead_letter_queue` na base de dados PostgreSQL.
 * Esta entidade é utilizada para arquivar permanentemente tarefas assíncronas e passos
 * de compensação do padrão Saga que esgotaram todas as tentativas de reprocessamento (retries).
 * Permite a inspeção humana, reprocessamento manual e análise forense de falhas irrecuperáveis.
 *
 * @security Isola cargas úteis corrompidas ou potencialmente maliciosas, impedindo que bloqueiem
 * as filas ativas de processamento do ecossistema.
 * @audit Cada registo na DLQ constitui uma prova auditável de falha de sistema ou de integração,
 * contendo o contexto completo do payload e o rasto do erro.
 */

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * @description Entidade de persistência para itens encaminhados para a Dead Letter Queue.
 */
@Entity('dead_letter_queue')
export class DeadLetterQueue {
  /**
   * Identificador único global (UUID) do registo na DLQ.
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Identificador da Saga transacional associada (se aplicável).
   */
  @Column({ type: 'varchar', name: 'saga_id', nullable: true })
  sagaId: string | null;

  /**
   * Identificador da execução do fluxo onde ocorreu a falha definitiva.
   */
  @Column({ name: 'execution_id' })
  executionId: string;

  /**
   * Tipo ou categoria da tarefa que sofreu falha (ex.: 'COMPENSATION', 'FORWARD_RECOVERY').
   */
  @Column({ name: 'task_type' })
  taskType: string;

  /**
   * Carga útil (payload) contextual no momento exato em que ocorreu a falha.
   */
  @Column({ type: 'jsonb' })
  payload: any;

  /**
   * Descrição ou rasto da última mensagem de erro capturada.
   */
  @Column({ type: 'text', name: 'last_error' })
  lastError: string;

  /**
   * Carimbo temporal em que o trabalho foi transferido para a DLQ.
   */
  @CreateDateColumn({ name: 'failed_at' })
  failedAt: Date;
}
