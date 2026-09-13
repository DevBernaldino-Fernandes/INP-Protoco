/**
 * @fileoverview Repositório TypeORM de Registo e Descoberta de Serviços
 * @module Persistence/Repositories/ServiceRepository
 * @description
 * Fornece a interface de acesso à base de dados para a entidade `ServiceRegistration`.
 * Suporta o registo, desregisto, atualização de capacidades, registo de heartbeats
 * e consulta de microserviços ativos e elegíveis para correspondência de intenções.
 *
 * @security Assegura a integridade das listas de serviços autorizados e previne o registo
 * malicioso de pontos de extremidade (endpoints) não validados.
 * @audit Regista alterações nas capacidades e parâmetros dos serviços, fornecendo rasto
 * histórico para auditorias de conformidade arquitetural.
 */

import { AppDataSource } from '../data-source';
import { ServiceRegistration } from '../entities/ServiceRegistration';

/**
 * @description Repositório TypeORM para operações de catálogo na tabela `services`.
 */
export const ServiceRepository = AppDataSource.getRepository(ServiceRegistration);