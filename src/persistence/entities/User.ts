/**
 * @fileoverview Entidade TypeORM de Utilizadores e Controlo de Acesso
 * @module Persistence/Entities/User
 * @description
 * Modela a tabela `users` na base de dados PostgreSQL do protocolo INP.
 * Armazena as contas de utilizador, credenciais protegidas por derivação criptográfica,
 * perfis de sistema (Administrador, Clientes, Auditores, DBA com níveis hierárquicos),
 * quotas de transações e identificação de organizações ou clientes independentes.
 *
 * @security Armazena apenas hashes salgados de palavras-passe com scrypt, mitigando ataques de dicionário e rainbow tables.
 * @audit Cada criação, alteração de estado e acesso do utilizador é associada ao respetivo identificador UUID para fins forenses.
 */

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * @description Tipos de papéis ou perfis de utilizador suportados pelo ecossistema INP.
 */
export type UserRole = 
  | 'ADMIN' 
  | 'CLIENT_ENTERPRISE' 
  | 'CLIENT_INDIVIDUAL' 
  | 'AUDITOR' 
  | 'DBA' 
  | 'DEVELOPER' 
  | 'SECOPS';

/**
 * @description Níveis hierárquicos de privilégio para Administradores de Bases de Dados (DBA).
 * Nível 1: Monitorização e métricas de desempenho em modo de leitura.
 * Nível 2: Gestão operacional, manutenção da fila de mensagens falhadas (DLQ) e cancelamento de tarefas.
 * Nível 3: Privilégio avançado com execução de VACUUM ANALYZE, inspeção DDL e sandbox de consultas SQL.
 */
export type DbaLevel = 1 | 2 | 3;

/**
 * @description Entidade representativa de um utilizador ou ator credenciado no protocolo INP.
 */
@Entity('users')
export class User {
  /**
   * Identificador único global (UUID v4) do utilizador.
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Endereço eletrónico único utilizado para autenticação.
   */
  @Column({ unique: true })
  email: string;

  /**
   * Nome completo ou denominação comercial da entidade/utilizador.
   */
  @Column()
  name: string;

  /**
   * Hash criptográfico da palavra-passe com sal incorporado (formato scrypt: salt$derivedKey).
   */
  @Column({ name: 'password_hash' })
  passwordHash: string;

  /**
   * Papel primordial atribuído ao utilizador para efeitos de autorização RBAC.
   */
  @Column({ type: 'varchar', default: 'CLIENT_INDIVIDUAL' })
  role: UserRole;

  /**
   * Nível de privilégio DBA atribuído (aplicável quando o papel for 'DBA').
   */
  @Column({ name: 'dba_level', type: 'smallint', nullable: true })
  dbaLevel?: DbaLevel;

  /**
   * Nome da empresa ou entidade corporativa a que o utilizador pertence.
   */
  @Column({ nullable: true })
  company?: string;

  /**
   * Limite mensal de execuções de intenções atribuído à conta.
   */
  @Column({ name: 'quota_limit', type: 'int', default: 1000 })
  quotaLimit: number;

  /**
   * Quantidade de intenções consumidas no ciclo corrente.
   */
  @Column({ name: 'quota_used', type: 'int', default: 0 })
  quotaUsed: number;

  /**
   * Indicador do estado de ativação da conta. Contas inativas são impedidas de autenticar.
   */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  /**
   * Carimbo temporal do último início de sessão bem-sucedido.
   */
  @Column({ name: 'last_login_at', type: 'timestamp with time zone', nullable: true })
  lastLoginAt?: Date;

  /**
   * Carimbo temporal da criação do registo.
   */
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /**
   * Carimbo temporal da última atualização de metadados da conta.
   */
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
