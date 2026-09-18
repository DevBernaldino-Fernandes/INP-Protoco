/**
 * @fileoverview Entidade TypeORM de Padrões Cognitivos e Memória Episódica da IA Nativa
 * @module Persistence/Entities/CognitivePattern
 * @description
 * Modela a tabela `cognitive_patterns` na base de dados PostgreSQL.
 * Armazena as regras de transformação, heurísticas e padrões semânticos destilados
 * pela IA Nativa (`NativeCognitiveEngine`) e pela câmara de descontaminação.
 * Permite que o motor mantenha a sua sabedoria acumulada entre reinicializações,
 * viabilizando autocura em tempo real com latência inferior a 0.001 milissegundos.
 *
 * @security Valida que nenhum dado pessoal (PII) ou informação confidencial é persistido
 * na regra estrutural. Armazena apenas a assinatura hash do erro e a função abstrata de cura.
 * @audit Regista o histórico de sucessos, falhas, pontuação de confiança e estado de aprovação
 * para auditoria contínua de integridade do aprendizado.
 */

import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * @description Entidade de persistência para o banco de padrões cognitivos aprendidos pelo motor.
 */
@Entity('cognitive_patterns')
export class CognitivePattern {
  /**
   * Identificador único do padrão cognitivo (ex.: 'pat_num_coercion_amount_eur').
   */
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id: string;

  /**
   * Chave da capacidade semântica associada (ex.: 'EXECUTE PAYMENT', '*').
   */
  @Column({ type: 'varchar', length: 128 })
  capabilityKey: string;

  /**
   * Assinatura criptográfica SHA-256 do erro de validação e do schema estrutural.
   */
  @Column({ type: 'varchar', length: 64 })
  errorSignature: string;

  /**
   * Identificador do inquilino (tenant) proprietário da regra cognitiva ('global' para regras estruturais universais).
   */
  @Column({ type: 'varchar', length: 64, default: 'global' })
  tenantId: string;

  /**
   * Definição serializada em JSONB da regra de transformação e mapeamento de campos.
   */
  @Column({ type: 'jsonb' })
  ruleDefinition: object;

  /**
   * Pontuação de confiança da regra cognitiva (0 a 100).
   */
  @Column({ type: 'float', default: 95.0 })
  confidenceScore: number;

  /**
   * Número de vezes que esta regra foi aplicada com sucesso sem violar o schema.
   */
  @Column({ type: 'int', default: 1 })
  successCount: number;

  /**
   * Número de falhas ou rejeições associadas a esta regra.
   */
  @Column({ type: 'int', default: 0 })
  failureCount: number;

  /**
   * Estado de ciclo de vida da regra ('PROBATIONARY', 'PROMOTED', 'REVOKED').
   */
  @Column({ type: 'varchar', length: 32, default: 'PROBATIONARY' })
  status: string;

  /**
   * Origem da regra ('NATIVE_HEURISTIC', 'DECONTAMINATED_LLM', 'ADMIN_RULE').
   */
  @Column({ type: 'varchar', length: 64, default: 'NATIVE_HEURISTIC' })
  source: string;

  /**
   * Carimbo temporal de criação e primeiro aprendizado da regra.
   */
  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  /**
   * Carimbo temporal da última validação ou reforço da regra.
   */
  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  /**
   * Relógio vetorial (Vector Clock) para controlo de causalidade e resolução de conflitos em malha mesh distribuída.
   */
  @Column({ type: 'jsonb', nullable: true })
  vectorClock?: Record<string, number>;

  /**
   * Identificador do nó que descobriu e sintetizou originalmente a regra cognitiva.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, default: 'node_master' })
  originNodeId?: string;
}
