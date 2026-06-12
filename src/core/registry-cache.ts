/**
 * RegistryCache: In-memory cache layer for the Capability Registry.
 * Reduces database queries to PostgreSQL.
 * Can be easily integrated with Redis in production.
 */

import { ServiceMatch } from './types';
import { ServiceRegistration } from '../persistence/entities/ServiceRegistration';

class RegistryCacheManager {
  // TTL in milliseconds (default 30 seconds)
  private ttl = 30000;
  
  // Cache storage
  private servicesCache: { data: ServiceRegistration[]; expiresAt: number } | null = null;
  private matchesCache = new Map<string, { data: ServiceMatch[]; expiresAt: number }>();

  /**
   * Get all active services from cache if not expired.
   */
  getServices(): ServiceRegistration[] | null {
    if (this.servicesCache && this.servicesCache.expiresAt > Date.now()) {
      return this.servicesCache.data;
    }
    return null;
  }

  /**
   * Save all active services to cache.
   */
  setServices(services: ServiceRegistration[]): void {
    this.servicesCache = {
      data: services,
      expiresAt: Date.now() + this.ttl,
    };
  }

  /**
   * Get service matches for a capability from cache if not expired.
   */
  getMatches(capabilityKey: string): ServiceMatch[] | null {
    const cached = this.matchesCache.get(capabilityKey.toUpperCase());
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    return null;
  }

  /**
   * Save service matches for a capability to cache.
   */
  setMatches(capabilityKey: string, matches: ServiceMatch[]): void {
    this.matchesCache.set(capabilityKey.toUpperCase(), {
      data: matches,
      expiresAt: Date.now() + this.ttl,
    });
  }

  /**
   * Clear all cached data (called on service register/unregister/heartbeat change).
   */
  invalidate(): void {
    console.log('[Cache] Invalidating registry cache...');
    this.servicesCache = null;
    this.matchesCache.clear();
  }
}

export const RegistryCache = new RegistryCacheManager();
