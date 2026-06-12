/**
 * Matching Engine: links intent requirements to concrete services.
 */

import { ParsedIntent, ServiceMatch } from './types';
import { CapabilityRegistry } from './capability-registry';

export class MatchingEngine {
  constructor(private registry: CapabilityRegistry) {}

  /**
   * For each required capability, find the best matching service.
   * Returns a map: capability -> ServiceMatch.
   */
  async matchIntent(intent: ParsedIntent): Promise<Map<string, ServiceMatch>> {
    const matches = new Map<string, ServiceMatch>();
    for (const req of intent.requirements.capabilities) {
      const best = await this.registry.findBestServiceForCapability(req);
      if (best) {
        matches.set(req, best);
      } else {
        console.warn(`[Matching] No service found for requirement: ${req}`);
      }
    }
    return matches;
  }

  /**
   * Check if all required capabilities can be fulfilled.
   */
  async canFulfillIntent(intent: ParsedIntent): Promise<boolean> {
    for (const req of intent.requirements.capabilities) {
      const matches = await this.registry.findServicesForCapability(req);
      if (matches.length === 0) return false;
    }
    return true;
  }
}