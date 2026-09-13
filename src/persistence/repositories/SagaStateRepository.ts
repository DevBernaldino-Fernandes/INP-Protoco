/**
 * @fileoverview Repositório TypeORM de Estados de Transações Distribuídas (Saga)
 * @module Persistence/Repositories/SagaStateRepository
 * @description
 * Fornece a camada de acesso à base de dados para a entidade `SagaState`.
 * Permite persistir o progresso incremental das transações distribuídas, consultar
 * sagas pendentes para recuperação após reinicialização do sistema (*crash recovery*)
 * e gerir as pilhas de compensação transacional.
 *
 * @security Garante que o estado transacional permanece protegido contra alterações espúrias,
 * assegurando que apenas o motor de execução ou de recuperação pode manipular pilhas de compensação.
 * @audit Proporciona transparência total sobre reversões (rollbacks) e compensações executadas.
 */

import { AppDataSource } from '../data-source';
import { SagaState } from '../entities/SagaState';

/**
 * @description Repositório TypeORM para persistência e gestão de estados na tabela `saga_states`.
 */
export const SagaStateRepository = AppDataSource.getRepository(SagaState);
