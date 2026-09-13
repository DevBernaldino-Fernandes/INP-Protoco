/**
 * @fileoverview Configuração da Camada de Dados e Ligação TypeORM
 * @module Persistence/DataSource
 * @description
 * Inicializa e exporta a instância central `AppDataSource` do TypeORM para PostgreSQL.
 * Este módulo gere o agrupamento de ligações (connection pooling), o mapeamento objeto-relacional (ORM)
 * e o registo de todas as entidades de persistência do protocolo INP (Execuções, Serviços,
 * Estados de Saga, Filas de Tarefas e Dead Letter Queue).
 *
 * @security Assegura que as credenciais da base de dados são carregadas exclusivamente a partir
 * de variáveis de ambiente seguras (.env), evitando a exposição de segredos no código-fonte.
 * Em ambientes produtivos, a opção `synchronize` deve manter-se desativada para prevenir perdas de dados.
 * @audit Todos os dados transacionais, estados de saga e histórico de auditoria dependem
 * da integridade referencial mantida por esta ligação à base de dados.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Execution } from './entities/Execution';
import { ServiceRegistration } from './entities/ServiceRegistration';
import { SagaState } from './entities/SagaState';
import { QueueJob } from './entities/QueueJob';
import { DeadLetterQueue } from './entities/DeadLetterQueue';
import { User } from './entities/User';
import { ApiKey } from './entities/ApiKey';
import { AuditLog } from './entities/AuditLog';
import dotenv from 'dotenv';

// Carrega as variáveis de ambiente a partir do ficheiro .env
dotenv.config();

/**
 * @description Instância principal do DataSource TypeORM ligada ao PostgreSQL.
 * Fornece acesso aos repositórios e gere as transações ACID do protocolo.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'inp',
  password: process.env.DB_PASSWORD || 'inp123',
  database: process.env.DB_NAME || 'inp',
  // NOTA DE SEGURANÇA/AUDITORIA: A sincronização automática de esquema só deve ser permitida
  // em ambiente de desenvolvimento local. Em produção devem utilizar-se migrações controladas.
  synchronize: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV,
  logging: false,
  entities: [Execution, ServiceRegistration, SagaState, QueueJob, DeadLetterQueue, User, ApiKey, AuditLog],
});