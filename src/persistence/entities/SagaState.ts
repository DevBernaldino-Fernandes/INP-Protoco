/**
 * @fileoverview Entidade TypeORM do Estado de Transações Distribuídas (Padrão Saga)
 * @module Persistence/Entities/SagaState
 * @description
 * Modela a tabela `saga_states` na base de dados PostgreSQL.
 * Persiste o estado transacional completo de orquestrações complexas no protocolo INP.
 * Armazena a pilha LIFO de ações compensatórias (`compensation_stack`), o índice do passo
 * em execução, a política de tratamento de falhas (`ROLLBACK` ou `FORWARD_RETRY`)
 * e os contadores de recuperação progressiva.
 *
 * @security Permite a recuperação do estado transacional após falhas de rede ou paragens
 * inesperadas de nós, garantindo a consistência eventual e prevenindo estados órfãos.
 * @audit Essencial para auditorias de integridade financeira e contratual, documentando
 * com exatidão se uma operação distribuída foi concluída, compensada ou revertida.
 */

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * @description Entidade de persistência do estado e progresso de uma Saga transacional.
 */
@Entity('saga_states')
export class SagaState {
  /**
   * Identificador único global (UUID v4) do registo de estado da Saga.
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Identificador único da execução à qual este registo transacional está associado.
   */
  @Column({ name: 'execution_id', unique: true })
  executionId: string;

  /**
   * Identificador da intenção que deu origem à transação.
   */
  @Column({ name: 'intent_id' })
  intentId: string;

  /**
   * Estado transacional corrente da Saga ('RUNNING', 'COMPLETED', 'COMPENSATING',
   * 'COMPENSATED', 'COMPENSATION_FAILED', 'FORWARD_RETRIES_EXCEEDED').
   */
  @Column()
  status: string;

  /**
   * Pilha LIFO (Last-In, First-Out) de compensações a executar em caso de reversão de fluxo.
   */
  @Column({ type: 'jsonb', name: 'compensation_stack' })
  compensationStack: { capability: string; context: any }[];

  /**
   * Descrição detalhada do último erro ocorrido na execução da transação.
   */
  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError: string | null;

  /**
   * Índice sequencial do passo que se encontra atualmente em execução.
   */
  @Column({ name: 'current_step_index', default: 0 })
  currentStepIndex: number;

  /**
   * Política declarada para recuperação perante falhas ('ROLLBACK' ou 'FORWARD_RETRY').
   */
  @Column({ name: 'failure_policy', default: 'ROLLBACK' })
  failurePolicy: string;

  /**
   * Limite máximo de tentativas permitidas na estratégia de recuperação progressiva (Forward Recovery).
   */
  @Column({ name: 'max_forward_retries', default: 3 })
  maxForwardRetries: number;

  /**
   * Carimbo temporal de inicialização da Saga.
   */
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /**
   * Carimbo temporal da última transição de estado da Saga.
   */
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
