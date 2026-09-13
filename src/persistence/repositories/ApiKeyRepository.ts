/**
 * @fileoverview Repositório TypeORM de Chaves de API
 * @module Persistence/Repositories/ApiKeyRepository
 * @description
 * Disponibiliza a camada de acesso à base de dados para a entidade `ApiKey`.
 * Suporta a consulta de credenciais de máquina por hash criptográfico, revogação
 * de tokens expirados e gestão de chaves corporativas e individuais.
 *
 * @security Valida a autenticidade e validade temporal de chaves criptográficas para automação.
 * @audit Viabiliza a correlação entre pedidos programáticos e respetivos proprietários.
 */

import { AppDataSource } from '../data-source';
import { ApiKey } from '../entities/ApiKey';

/**
 * @description Instância do repositório TypeORM associada à entidade `ApiKey`.
 */
export const ApiKeyRepository = AppDataSource.getRepository(ApiKey);
