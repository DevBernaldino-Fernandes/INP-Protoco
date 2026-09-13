/**
 * @fileoverview Repositório TypeORM de Registos de Auditoria Forense
 * @module Persistence/Repositories/AuditLogRepository
 * @description
 * Fornece a interface de persistência e pesquisa para a entidade `AuditLog`.
 * Permite aos auditores e administradores inspecionar trilhos de auditoria,
 * filtrar eventos por ação, utilizador ou intervalo temporal e exportar relatórios de conformidade.
 *
 * @security Salvaguarda a integridade do histórico forense contra manipulações diretas.
 * @audit Fonte primária para auditorias regulamentares externas (SOC2, ISO 27001 e GDPR).
 */

import { AppDataSource } from '../data-source';
import { AuditLog } from '../entities/AuditLog';

/**
 * @description Instância do repositório TypeORM associada à entidade `AuditLog`.
 */
export const AuditLogRepository = AppDataSource.getRepository(AuditLog);
