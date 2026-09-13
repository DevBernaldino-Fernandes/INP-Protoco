/**
 * @fileoverview Catálogo e Registo de Capacidades e Descoberta de Serviços (CapabilityRegistry)
 * @module Core/CapabilityRegistry
 * @description
 * Gere o ciclo de vida completo de registo, atualização, batimentos cardíacos (heartbeat),
 * desregisto e descoberta de microserviços no protocolo INP. Utiliza a base de dados PostgreSQL
 * para persistência relacional com aceleração via `RegistryCache`. Realiza correspondência
 * semântica entre requisitos e capacidades técnicas, ordenando os serviços candidatos
 * através de um algoritmo ponderado que combina o índice de confiança (*trustScore*),
 * o nível de segurança (*securityLevel*) e o multiplicador dinâmico de saúde operacional
 * fornecido pelo `ServiceMetricsCollector`.
 *
 * @security Valida os endpoints contra SSRF via NetworkSecurity antes de aceitar o registo.
 * Previne o sequestro de capacidades (*Capability Hijacking*) restringindo o trustScore
 * inicial de novos serviços dinâmicos entre 10 e 80.
 * @audit Cada registo, atualização ou desregisto invalida a cache distribuída e fica
 * documentado na tabela `services` para auditoria de catálogo e topologia de microserviços.
 */

import { ServiceRepository } from '../persistence/repositories/ServiceRepository';
import { ServiceRegistration } from '../persistence/entities/ServiceRegistration';
import { Service, Capability, ServiceMatch } from './types';
import { RegistryCache } from './registry-cache';
import { ServiceMetricsCollector } from './metrics-collector';
import { NetworkSecurity } from './network-security';

/**
 * @description Gestor do catálogo central de serviços e resolução de capacidades no ecossistema INP.
 */
export class CapabilityRegistry {
  /**
   * @description Regista ou atualiza um microserviço e as respetivas capacidades técnicas.
   *
   * @param {Service} service - Objeto contendo a identificação, capacidades, endpoint e nível de segurança.
   * @returns {Promise<void>} Promessa resolvida após persistência na base de dados e invalidação de cache.
   * @throws {Error} Caso o endpoint remoto falhe a validação de segurança de rede (SSRF).
   * @security Validação SSRF do URL e limitação prudencial do trustScore para conter nós não verificados.
   * @audit Regista a criação ou modificação do serviço no catálogo persistido.
   */
  async register(service: Service): Promise<void> {
    if (service.endpoint) {
      NetworkSecurity.validateEndpoint(service.endpoint);
    }

    // MEDIDA DE SEGURANÇA: Limitação preventiva do trustScore (entre 10 e 80) para evitar sequestro de capacidades
    const rawScore = typeof service.trustScore === 'number' && !isNaN(service.trustScore) ? service.trustScore : 50;
    const sanitizedTrustScore = Math.min(Math.max(rawScore, 10), 80);

    const validLevels: ('LOW' | 'MEDIUM' | 'HIGH')[] = ['LOW', 'MEDIUM', 'HIGH'];
    const sanitizedSecurityLevel = validLevels.includes(service.securityLevel) ? service.securityLevel : 'MEDIUM';

    const entity = ServiceRepository.create({
      id: service.id,
      name: service.name,
      description: service.description,
      capabilities: service.capabilities || [],
      trustScore: sanitizedTrustScore,
      securityLevel: sanitizedSecurityLevel,
      endpoint: service.endpoint,
      lastHeartbeat: new Date(),
      active: true,
    });
    await ServiceRepository.save(entity);
    await RegistryCache.invalidate();
  }

  /**
   * @description Remove um microserviço do catálogo através do seu identificador.
   *
   * @param {string} serviceId - Identificador único do serviço a remover.
   * @returns {Promise<boolean>} Verdadeiro se o serviço foi removido; falso se não foi encontrado.
   * @audit Invalida a cache para que o nó deixe de ser selecionado pelo motor de correspondência.
   */
  async unregister(serviceId: string): Promise<boolean> {
    const result = await ServiceRepository.delete({ id: serviceId });
    const success = result.affected !== 0;
    if (success) {
      await RegistryCache.invalidate();
    }
    return success;
  }

  /**
   * @description Atualiza o carimbo temporal de batimento cardíaco (heartbeat) para atestar vivacidade.
   *
   * @param {string} serviceId - Identificador do serviço.
   */
  async heartbeat(serviceId: string): Promise<void> {
    await ServiceRepository.update({ id: serviceId }, { lastHeartbeat: new Date() });
  }

  /**
   * @description Procura um serviço ativo na base de dados pelo seu identificador único.
   *
   * @param {string} id - Identificador do serviço.
   * @returns {Promise<ServiceRegistration | null>} Entidade encontrada ou nulo.
   */
  async getService(id: string): Promise<ServiceRegistration | null> {
    return await ServiceRepository.findOneBy({ id, active: true });
  }

  /**
   * @description Devolve a lista de todos os microserviços atualmente ativos, recorrendo à cache se disponível.
   *
   * @returns {Promise<ServiceRegistration[]>} Lista de serviços ativos.
   */
  async getAllServices(): Promise<ServiceRegistration[]> {
    const cached = await RegistryCache.getServices();
    if (cached) {
      return cached;
    }
    const services = await ServiceRepository.findBy({ active: true });
    await RegistryCache.setServices(services);
    return services;
  }

  /**
   * @description Localiza e classifica todos os serviços aptos a satisfazer uma dada capacidade (ex.: "EXECUTE PAYMENT").
   * Aplica ponderações de segurança e ajusta dinamicamente a pontuação em tempo real com base no estado
   * de saúde reportado pelo `ServiceMetricsCollector`.
   *
   * @param {string} requirement - Ação semântica requerida em formato `VERBO ALVO`.
   * @returns {Promise<ServiceMatch[]>} Lista de correspondências ordenadas por pontuação decrescente.
   * @audit Garante que a seleção de fornecedores de serviços favorece os nós mais seguros e estáveis.
   */
  async findServicesForCapability(requirement: string): Promise<ServiceMatch[]> {
    const normalized = requirement.trim().toUpperCase();
    let matches: ServiceMatch[] = [];
    const cachedMatches = await RegistryCache.getMatches(normalized);
    
    if (cachedMatches) {
      // Clona o vetor em cache para evitar mutações acidentais da ordenação original
      matches = [...cachedMatches];
    } else {
      const parts = normalized.split(/\s+/);
      if (parts.length < 2) return [];
      const [reqVerb, reqTarget] = parts;
      const all = await this.getAllServices();

      for (const svc of all) {
        const caps = svc.capabilities as Capability[];
        for (const cap of caps) {
          if (cap.verb === reqVerb && cap.target.toUpperCase() === reqTarget) {
            let score = svc.trustScore / 100;
            // Bónus de pontuação para níveis elevados de segurança; penalização para níveis baixos
            if (svc.securityLevel === 'HIGH') score *= 1.1;
            if (svc.securityLevel === 'LOW') score *= 0.9;
            matches.push({
              service: {
                id: svc.id,
                name: svc.name,
                capabilities: caps,
                trustScore: svc.trustScore,
                securityLevel: svc.securityLevel as any,
                endpoint: svc.endpoint,
              } as Service,
              capability: cap,
              score,
            });
          }
        }
      }
      matches.sort((a, b) => b.score - a.score);
      await RegistryCache.setMatches(normalized, matches);
    }

    // Ajuste dinâmico preditivo da pontuação com base nas métricas reais de latência e falhas
    const collector = ServiceMetricsCollector.getInstance();
    for (const match of matches) {
      let baseScore = match.service.trustScore / 100;
      if (match.service.securityLevel === 'HIGH') baseScore *= 1.1;
      if (match.service.securityLevel === 'LOW') baseScore *= 0.9;
      
      const healthMultiplier = collector.getHealthScore(match.service.id, 100);
      match.score = baseScore * healthMultiplier;
    }

    // Reordena os candidatos após a incorporação da penalização de saúde em tempo real
    matches.sort((a, b) => b.score - a.score);
    return matches;
  }

  /**
   * @description Devolve o melhor serviço candidato (com a pontuação mais elevada) para cumprir a capacidade.
   *
   * @param {string} requirement - Requisito semântico da capacidade.
   * @returns {Promise<ServiceMatch | undefined>} Melhor correspondência encontrada ou indefinido se não houver candidatos.
   */
  async findBestServiceForCapability(requirement: string): Promise<ServiceMatch | undefined> {
    const matches = await this.findServicesForCapability(requirement);
    return matches[0];
  }
}
