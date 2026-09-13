/**
 * @fileoverview Entidade TypeORM de Registos de Auditoria Imutáveis e Forense
 * @module Persistence/Entities/AuditLog
 * @description
 * Modela a tabela `audit_logs` na base de dados PostgreSQL.
 * Grava de forma persistente e imutável cada evento sensível do sistema, incluindo:
 * inícios de sessão, criação/alteração de utilizadores, operações de manutenção DBA,
 * consultas no sandbox SQL, expurgo/re-tentativas na Dead Letter Queue, alterações de serviços
 * e rejeições de acesso por violação de permissões RBAC.
 *
 * @security Garante conformidade com normas regulamentares (LGPD, GDPR, SOC2 e ISO 27001).
 * @audit Cada registo é enriquecido com endereço IP, agente de utilizador, identificador de correlação e resultado.
 */

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * @description Entidade de persistência para registos de eventos de auditoria e conformidade.
 */
@Entity('audit_logs')
export class AuditLog {
  /**
   * Identificador único global (UUID v4) do evento de auditoria.
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Identificador do utilizador associado à ação (ou nulo para eventos de sistema não autenticados).
   */
  @Column({ name: 'user_id', nullable: true })
  userId?: string;

  /**
   * Endereço eletrónico do utilizador no momento da ação para rastreabilidade direta.
   */
  @Column({ name: 'user_email', nullable: true })
  userEmail?: string;

  /**
   * Papel do utilizador que desencadeou a ação (ADMIN, CLIENT_ENTERPRISE, AUDITOR, DBA, etc.).
   */
  @Column({ name: 'user_role', nullable: true })
  userRole?: string;

  /**
   * Ação auditada realizada (ex.: "USER_LOGIN", "DBA_VACUUM", "DLQ_RETRY", "PERMISSION_DENIED").
   */
  @Column()
  action: string;

  /**
   * Recurso ou entidade alvo da ação (ex.: "/api/dba/vacuum", "service:payment", "user:123").
   */
  @Column()
  resource: string;

  /**
   * Estado de desfecho da operação ('SUCCESS', 'DENIED', 'FAILED').
   */
  @Column()
  status: string;

  /**
   * Carga útil estruturada contendo detalhes higienizados do evento.
   */
  @Column({ type: 'jsonb', nullable: true })
  details?: any;

  /**
   * Endereço IP do cliente originador do pedido.
   */
  @Column({ name: 'ip_address', nullable: true })
  ipAddress?: string;

  /**
   * Cabeçalho de identificação do navegador ou cliente HTTP (User-Agent).
   */
  @Column({ name: 'user_agent', nullable: true })
  userAgent?: string;

  /**
   * Identificador único de correlação transacional distribuída (X-Correlation-ID).
   */
  @Column({ name: 'correlation_id', nullable: true })
  correlationId?: string;

  /**
   * Carimbo temporal exato de ocorrência do evento de auditoria.
   */
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
