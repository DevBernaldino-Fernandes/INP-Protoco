/**
 * @fileoverview Repositório TypeORM de Tarefas da Fila Assíncrona
 * @module Persistence/Repositories/QueueJobRepository
 * @description
 * Fornece operações de persistência e consulta para a entidade `QueueJob`.
 * Suporta a manipulação do padrão Transactional Outbox, permitindo o agendamento,
 * aquisição atómica de tarefas por trabalhadores distribuídos (via locks) e
 * atualização de estados ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED').
 *
 * @security Garante concorrência segura com controlo transacional, prevenindo o processamento duplicado
 * ou a apropriação indevida de tarefas em execução.
 * @audit Permite auditar atrasos no consumo de filas (*queue latency*), taxas de sucesso e limites de retentativas.
 */

import { AppDataSource } from '../data-source';
import { QueueJob } from '../entities/QueueJob';

/**
 * @description Repositório TypeORM para operações transacionais na tabela `queue_jobs`.
 */
export const QueueJobRepository = AppDataSource.getRepository(QueueJob);
