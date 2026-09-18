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
  /** Memória estática de manipuladores locais em memória (serviços nativos e testes) */
  private static localHandlers = new Map<string, (input: any, ctx?: any) => Promise<any>>();

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
    if (service.handler) {
      CapabilityRegistry.localHandlers.set(service.id, service.handler);
    }
    if (service.endpoint) {
      NetworkSecurity.validateEndpoint(service.endpoint);
    }

    // MEDIDA DE SEGURANÇA: IDs com prefixo "inp-native-" são reservados exclusivamente a serviços internos.
    // Nós externos com endpoint HTTP não podem registar-se com IDs nativos reservados.
    const isNativeId = service.id.startsWith('inp-native-');
    if (isNativeId && service.endpoint) {
      throw new Error(`Registo Negado: O identificador "${service.id}" é reservado a serviços nativos internos do protocolo INP e não pode ser registado por nós externos.`);
    }

    // Para serviços nativos (sem endpoint externo), aceita o trustScore original sem limitação.
    // Para serviços externos/dinâmicos, limita preventivamente o trustScore entre 10 e 80.
    const rawScore = typeof service.trustScore === 'number' && !isNaN(service.trustScore) ? service.trustScore : 50;
    const sanitizedTrustScore = isNativeId
      ? Math.min(Math.max(rawScore, 0), 100)   // Nativos: intervalo completo [0, 100]
      : Math.min(Math.max(rawScore, 10), 80);  // Externos: intervalo restrito [10, 80]

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
   * @description Sinónimo ergonómico para registar um serviço no catálogo.
   * @param {Service} service - Serviço a registar.
   * @returns {Promise<void>}
   */
  async registerService(service: Service): Promise<void> {
    return this.register(service);
  }

  /**
   * @description Remove um microserviço do catálogo através do seu identificador.
   *
   * @param {string} serviceId - Identificador único do serviço a remover.
   * @returns {Promise<boolean>} Verdadeiro se o serviço foi removido; falso se não foi encontrado.
   * @audit Invalida a cache para que o nó deixe de ser selecionado pelo motor de correspondência.
   */
  async unregister(serviceId: string): Promise<boolean> {
    CapabilityRegistry.localHandlers.delete(serviceId);
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

    // MEDIDA DE SEGURANÇA: Filtra serviços cujo batimento cardíaco (heartbeat) está desatualizado há mais de 2 minutos.
    // Serviços sem endpoint remoto (apenas manipuladores em memória) não emitem heartbeat e não são filtrados.
    const heartbeatThreshold = new Date(Date.now() - 2 * 60 * 1000);
    const activeServices = services.filter(svc => {
      if (!svc.endpoint) return true; // Serviços locais em memória não precisam de heartbeat
      if (!svc.lastHeartbeat) return false;
      return new Date(svc.lastHeartbeat) >= heartbeatThreshold;
    });

    await RegistryCache.setServices(activeServices);
    return activeServices;
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
      // Clona o vetor em cache para evitar mutações e reanexa manipuladores locais perdidos na serialização
      matches = cachedMatches.map(m => {
        const localHandler = CapabilityRegistry.localHandlers.get(m.service.id);
        return {
          ...m,
          service: {
            ...m.service,
            handler: m.service.handler || localHandler
          }
        };
      });
    } else {
      const parts = normalized.split(/\s+/);
      if (parts.length === 0 || !parts[0]) return [];
      const reqVerb = parts[0];
      const reqTarget = parts.length > 1 ? parts.slice(1).join(' ') : '*';
      const reqTargetUnder = parts.length > 1 ? parts.slice(1).join('_') : '*';
      const all = await this.getAllServices();

      for (const svc of all) {
        const caps = svc.capabilities as Capability[];
        for (const cap of caps) {
          const capTarget = cap.target.toUpperCase();
          const capTargetNorm = capTarget.replace(/\s+/g, ' ');
          const capTargetUnder = capTarget.replace(/\s+/g, '_');
          const isExactMatch = capTarget === reqTarget || 
                               capTargetNorm === reqTarget || 
                               capTargetUnder === reqTargetUnder || 
                               capTargetNorm === reqTargetUnder || 
                               capTargetUnder === reqTarget;
          const isWildcardMatch = capTarget === '*' || capTarget === 'DEFAULT' || reqTarget === '*';

          if (cap.verb === reqVerb && (isExactMatch || isWildcardMatch)) {
            const localHandler = CapabilityRegistry.localHandlers.get(svc.id);
            // Ignora serviços locais órfãos (sem endpoint HTTP e sem handler em memória no processo atual)
            if (!svc.endpoint && !localHandler) {
              continue;
            }

            let score = svc.trustScore / 100;
            // A correspondência exata de alvo (target) tem prioridade mandatória sobre wildcards genéricos '*'
            if (isExactMatch) score += 5.0;
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
                handler: localHandler,
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
      const healthMultiplier = collector.getHealthScore(match.service.id, 100);
      match.score = match.score * healthMultiplier;
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
