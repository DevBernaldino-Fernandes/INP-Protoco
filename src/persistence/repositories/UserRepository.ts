/**
 * @fileoverview Repositório TypeORM de Utilizadores e Contas
 * @module Persistence/Repositories/UserRepository
 * @description
 * Disponibiliza a interface de acesso e operações de persistência na tabela `users`.
 * Permite a pesquisa de utilizadores por email, gestão de palavras-passe,
 * atualização de quotas de consumo e ativação de contas no protocolo INP.
 *
 * @security Garante acesso centralizado aos registos de utilizadores com integridade referencial.
 * @audit Utilizado para auditoria de identidade e resolução de atores no sistema.
 */

import { AppDataSource } from '../data-source';
import { User } from '../entities/User';

/**
 * @description Instância do repositório TypeORM associada à entidade `User`.
 */
export const UserRepository = AppDataSource.getRepository(User);
