/**
 * @fileoverview Entidade TypeORM de Chaves de API para Acesso Programático
 * @module Persistence/Entities/ApiKey
 * @description
 * Modela a tabela `api_keys` na base de dados PostgreSQL.
 * Permite que clientes corporativos, desenvolvedores e clientes independentes autentiquem
 * sistemas automáticos, pipelines de CI/CD e microsserviços parceiros sem exposição
 * de palavras-passe de utilizador.
 *
 * @security Armazena apenas o hash SHA-256 da chave gerada e um prefixo público identificador.
 * @audit Cada invocação com chave de API atualiza o carimbo temporal de utilização para rastreamento.
 */

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './User';

/**
 * @description Entidade que representa um token de longa duração (API Key) emitido para um utilizador.
 */
@Entity('api_keys')
export class ApiKey {
  /**
   * Identificador único global (UUID v4) do registo da chave de API.
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Identificador do utilizador proprietário da chave de API.
   */
  @Column({ name: 'user_id' })
  userId: string;

  /**
   * Ligação relacional ao utilizador proprietário.
   */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /**
   * Nome amigável ou rótulo descritivo da finalidade da chave.
   */
  @Column()
  name: string;

  /**
   * Prefixo legível da chave (ex.: "inp_live_abc123..."), seguro para exibição no portal.
   */
  @Column({ name: 'key_prefix' })
  keyPrefix: string;

  /**
   * Hash criptográfico SHA-256 da chave de API completa para comparação segura.
   */
  @Column({ name: 'key_hash', unique: true })
  keyHash: string;

  /**
   * Lista explícita de permissões concedidas a esta chave específica.
   */
  @Column({ type: 'jsonb', default: '[]' })
  permissions: string[];

  /**
   * Indicador se a chave se encontra ativa ou revogada administrativamente.
   */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /**
   * Carimbo temporal da última utilização em chamadas de API.
   */
  @Column({ name: 'last_used_at', type: 'timestamp with time zone', nullable: true })
  lastUsedAt?: Date;

  /**
   * Data e hora de expiração opcional da chave de API.
   */
  @Column({ name: 'expires_at', type: 'timestamp with time zone', nullable: true })
  expiresAt?: Date;

  /**
   * Carimbo temporal de criação da chave.
   */
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
