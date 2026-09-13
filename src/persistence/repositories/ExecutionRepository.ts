/**
 * @fileoverview Repositório TypeORM de Execuções e Auditoria de Fluxos
 * @module Persistence/Repositories/ExecutionRepository
 * @description
 * Fornece a interface de acesso à base de dados para a entidade `Execution`.
 * Responsável por persistir o ciclo de vida completo das orquestrações de intenções,
 * registar os resultados de cada passo e viabilizar consultas analíticas e de monitorização.
 *
 * @security Salvaguarda a integridade dos dados históricos de execuções contra alterações não autorizadas.
 * @audit Serve como fonte primária para auditorias de conformidade de SLA e análise transacional retrospetiva.
 */

import { AppDataSource } from '../data-source';
import { Execution } from '../entities/Execution';

/**
 * @description Repositório TypeORM configurado para manipulação e consulta da tabela `executions`.
 */
export const ExecutionRepository = AppDataSource.getRepository(Execution);