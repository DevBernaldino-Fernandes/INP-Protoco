/**
 * @fileoverview Gestão de Bloqueios Transacionais Distribuídos (Pessimistic Locking)
 * @module Core/TransactionLock
 * @description
 * Fornece utilitários para aquisição de bloqueios pessimistas a nível de linha (Row-Level Locking)
 * na base de dados PostgreSQL, recorrendo à semântica `SELECT ... FOR UPDATE NOWAIT`.
 * Garante que apenas um nó ou processo de execução ativo no cluster pode transitar ou compensar
 * o estado de uma Saga em determinado instante, eliminando condições de corrida e inconsistências.
 *
 * @security Previne ataques de corrida (Race Conditions) e execuções concorrentes não autorizadas
 * sobre a mesma transação distribuída em ambientes multi-nó ou em cluster.
 * @audit Assegura a rastreabilidade estrita da posse do bloqueio e a preservação da integridade
 * ACID e de consistência eventual exigida em processos de auditoria financeira.
 */

import { EntityManager } from 'typeorm';
import { SagaState } from '../persistence/entities/SagaState';

/**
 * @description Utilitário de coordenação e sincronização de concorrência com bloqueios de base de dados.
 */
export class TransactionLock {
  /**
   * @description Adquire um bloqueio pessimista exclusivo de escrita (`pessimistic_write` / `NOWAIT`)
   * sobre o registo da entidade `SagaState` dentro da transação corrente gerida pelo TypeORM.
   * Se outra transação ou nó já possuir o bloqueio, a base de dados rejeita a operação de imediato
   * sem bloqueio indefinido (prevenindo impasses / deadlocks).
   *
   * @param {string} sagaId - Identificador único global (UUID) da Saga a ser bloqueada.
   * @param {EntityManager} manager - Gestor de entidades TypeORM associado à transação ativa.
   * @returns {Promise<SagaState>} A instância persistida da entidade SagaState com bloqueio adquirido.
   * @throws {Error} Se o registo da Saga não for encontrado ou se o bloqueio for recusado por concorrência.
   * @security Garante isolamento estrito contra modificações paralelas na mesma Saga.
   * @audit Regista a aquisição atómica do recurso, essencial para a validação forense de transações.
   */
  static async acquireSagaLock(sagaId: string, manager: EntityManager): Promise<SagaState> {
    const saga = await manager.createQueryBuilder(SagaState, 'saga')
      .setLock('pessimistic_write')
      .setOnLocked('nowait')
      .where('saga.id = :id', { id: sagaId })
      .getOne();
      
    if (!saga) {
      throw new Error(`O registo de estado da Saga com ID "${sagaId}" não foi encontrado para bloqueio.`);
    }
    return saga;
  }
}
