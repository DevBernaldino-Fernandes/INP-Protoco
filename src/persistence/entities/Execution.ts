/**
 * @fileoverview Entidade TypeORM do Histórico de Execuções
 * @module Persistence/Entities/Execution
 * @description
 * Modela a tabela `executions` na base de dados PostgreSQL.
 * Guarda o registo histórico imutável de cada ciclo de vida de execução de intenção
 * no protocolo INP, incluindo o estado final, a árvore de passos executados,
 * tempos de resposta, saídas consolidadas e detalhes de erros.
 *
 * @security Garante o armazenamento não volátil das ações executadas, impedindo a negação
 * de autoria e permitindo inspecionar acessos anómalos ou parâmetros suspeitos.
 * @audit Elemento fulcral em processos de auditoria técnica e financeira para comprovar
 * o cumprimento de contratos digitais e transações distribuídas.
 */

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * @description Entidade representativa de uma execução concluída ou em curso de uma intenção.
 */
@Entity('executions')
export class Execution {
  /**
   * Identificador único global (UUID v4) da execução.
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Identificador da intenção original submetida pelo cliente ou consumidor.
   */
  @Column({ name: 'intent_id' })
  intentId: string;

  /**
   * Identificador do utilizador ou cliente que despoletou a execução.
   */
  @Column({ name: 'user_id', type: 'varchar', nullable: true })
  userId?: string;

  /**
   * Estado atual ou final da execução ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', etc.).
   */
  @Column()
  status: string;

  /**
   * Estrutura de dados resultante da orquestração dos serviços envolvidos.
   */
  @Column({ type: 'jsonb', nullable: true })
  output: any;

  /**
   * Mensagem descritiva de erro capturada caso o fluxo tenha falhado.
   */
  @Column({ type: 'text', nullable: true })
  error: string;

  /**
   * Lista sequencial detalhada de todos os passos executados, com tempos e estados.
   */
  @Column({ type: 'jsonb', nullable: true })
  steps: any;

  /**
   * Carimbo temporal em que a orquestração teve início.
   */
  @CreateDateColumn({ name: 'started_at' })
  startedAt: Date;

  /**
   * Carimbo temporal em que a orquestração foi dada por finalizada ou terminada em erro.
   */
  @UpdateDateColumn({ name: 'completed_at', nullable: true })
  completedAt: Date;
}