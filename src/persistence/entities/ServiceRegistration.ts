/**
 * @fileoverview Entidade TypeORM de Registo e Catálogo de Serviços
 * @module Persistence/Entities/ServiceRegistration
 * @description
 * Modela a tabela `services` na base de dados PostgreSQL.
 * Armazena a metadata de todos os microserviços registados no ecossistema INP,
 * incluindo as suas capacidades semânticas, níveis de confiança (`trustScore`),
 * classificações de segurança (`securityLevel`), URLs de extremidade (endpoints HTTP),
 * batimentos cardíacos periódicos (`lastHeartbeat`) e estado de ativação operacional.
 *
 * @security Valida a autenticidade e o nível de segurança do serviço antes de permitir
 * que participe no roteamento de intenções ou aceda a dados sensíveis.
 * @audit Permite a rastreabilidade completa do ciclo de vida dos microserviços, comprovando
 * quando foram registados, modificados ou marcados como inativos.
 */

import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * @description Entidade de persistência para o catálogo e descoberta de microserviços do protocolo.
 */
@Entity('services')
export class ServiceRegistration {
  /**
   * Identificador único alfanumérico do serviço (ex.: 'payment-service', 'inventory-service').
   */
  @PrimaryColumn()
  id: string;

  /**
   * Nome comercial ou semântico atribuído ao serviço.
   */
  @Column()
  name: string;

  /**
   * Descrição funcional do âmbito de atuação do microserviço.
   */
  @Column({ nullable: true })
  description: string;

  /**
   * Lista serializada em JSONB de todas as capacidades expostas pelo microserviço.
   */
  @Column({ type: 'jsonb' })
  capabilities: object;

  /**
   * Pontuação de reputação, disponibilidade e histórico de sucesso (0 a 100).
   */
  @Column({ type: 'float', default: 80 })
  trustScore: number;

  /**
   * Nível de segurança e isolamento do serviço ('LOW', 'MEDIUM', 'HIGH').
   */
  @Column({ default: 'MEDIUM' })
  securityLevel: string;

  /**
   * Ponto de extremidade HTTP base utilizado para invocações remotas via rede.
   */
  @Column({ nullable: true })
  endpoint: string;

  /**
   * Carimbo temporal do último batimento cardíaco (heartbeat) recebido para atestar vivacidade.
   */
  @Column({ name: 'last_heartbeat', type: 'timestamp', nullable: true })
  lastHeartbeat: Date;

  /**
   * Indicador booleano que determina se o serviço está ativo e elegível para correspondência.
   */
  @Column({ default: true })
  active: boolean;

  /**
   * Carimbo temporal do registo inicial do serviço no sistema.
   */
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /**
   * Carimbo temporal da última alteração de configuração ou estado do serviço.
   */
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}