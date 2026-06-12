/**
 * Capability Registry – manages service registration, discovery, and heartbeat.
 * Uses PostgreSQL for persistence and supports remote service endpoints.
 */

import { ServiceRepository } from '../persistence/repositories/ServiceRepository';
import { ServiceRegistration } from '../persistence/entities/ServiceRegistration';
import { Service, Capability, ServiceMatch } from './types';
import { RegistryCache } from './registry-cache';

export class CapabilityRegistry {
  /**
   * Register a new service (upsert).
   */
  async register(service: Service): Promise<void> {
    const entity = ServiceRepository.create({
      id: service.id,
      name: service.name,
      description: service.description,
      capabilities: service.capabilities,
      trustScore: service.trustScore,
      securityLevel: service.securityLevel,
      endpoint: service.endpoint,
      lastHeartbeat: new Date(),
      active: true,
    });
    await ServiceRepository.save(entity);
    RegistryCache.invalidate();
  }

  /**
   * Remove a service by ID.
   */
  async unregister(serviceId: string): Promise<boolean> {
    const result = await ServiceRepository.delete({ id: serviceId });
    const success = result.affected !== 0;
    if (success) {
      RegistryCache.invalidate();
    }
    return success;
  }

  /**
   * Update heartbeat timestamp to keep service alive.
   */
  async heartbeat(serviceId: string): Promise<void> {
    await ServiceRepository.update({ id: serviceId }, { lastHeartbeat: new Date() });
  }

  /**
   * Get service by ID (only active).
   */
  async getService(id: string): Promise<ServiceRegistration | null> {
    return await ServiceRepository.findOneBy({ id, active: true });
  }

  /**
   * List all active services.
   */
  async getAllServices(): Promise<ServiceRegistration[]> {
    const cached = RegistryCache.getServices();
    if (cached) {
      return cached;
    }
    const services = await ServiceRepository.findBy({ active: true });
    RegistryCache.setServices(services);
    return services;
  }

  /**
   * Find all services that can fulfill a given capability (e.g., "EXECUTE PAYMENT").
   * Returns a list of matches sorted by score (trust, security, latency).
   */
  async findServicesForCapability(requirement: string): Promise<ServiceMatch[]> {
    const normalized = requirement.trim().toUpperCase();
    const cachedMatches = RegistryCache.getMatches(normalized);
    if (cachedMatches) {
      return cachedMatches;
    }

    const parts = normalized.split(/\s+/);
    if (parts.length < 2) return [];
    const [reqVerb, reqTarget] = parts;
    const all = await this.getAllServices();
    const matches: ServiceMatch[] = [];

    for (const svc of all) {
      const caps = svc.capabilities as Capability[];
      for (const cap of caps) {
        if (cap.verb === reqVerb && cap.target.toUpperCase() === reqTarget) {
          let score = svc.trustScore / 100;
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
    matches.sort((a,b) => b.score - a.score);
    RegistryCache.setMatches(normalized, matches);
    return matches;
  }

  /**
   * Find the single best service for a capability.
   */
  async findBestServiceForCapability(requirement: string): Promise<ServiceMatch | undefined> {
    const matches = await this.findServicesForCapability(requirement);
    return matches[0];
  }
}