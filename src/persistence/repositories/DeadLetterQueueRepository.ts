/**
 * @fileoverview Repositório TypeORM da Fila de Mensagens Mortas (Dead Letter Queue)
 * @module Persistence/Repositories/DeadLetterQueueRepository
 * @description
 * Disponibiliza a instância do repositório TypeORM associada à entidade `DeadLetterQueue`.
 * Fornece métodos de persistência, consulta, reprocessamento manual e purga de registos
 * de tarefas irrecuperáveis e passos de compensação falhados.
 *
 * @security O acesso de escrita e purga a este repositório deve ser restrito a administradores
 * ou processos de sistema autorizados para evitar perda de dados forenses.
 * @audit Permite a extração de relatórios de incidentes e análise de causas-raiz em auditorias operacionais.
 */

import { AppDataSource } from '../data-source';
import { DeadLetterQueue } from '../entities/DeadLetterQueue';

/**
 * @description Repositório TypeORM para operações de persistência e consulta na tabela `dead_letter_queue`.
 */
export const DeadLetterQueueRepository = AppDataSource.getRepository(DeadLetterQueue);
