/**
 * INP Core – orchestrates the entire protocol.
 * Combines parser, registry, matching, execution, and response composer.
 */

import { IntentParser } from './intent-parser';
import { CapabilityRegistry } from './capability-registry';
import { MatchingEngine } from './matching-engine';
import { ExecutionEngine } from './execution-engine';
import { ResponseComposer } from './response-composer';
import { ParsedIntent, SecurityContext, INPConfig } from './types';

export class INPCore {
  private parser: IntentParser;
  private registry: CapabilityRegistry;
  private matchingEngine: MatchingEngine;
  private responseComposer: ResponseComposer;
  private config: INPConfig;
  private securityContext?: SecurityContext;

  constructor(config?: Partial<INPConfig>, securityContext?: SecurityContext) {
    this.config = {
      enableSecurity: true,
      defaultTimeoutMs: 30000,
      maxRetries: 3,
      trustThreshold: 50,
      ...config,
    };
    this.securityContext = securityContext;
    this.parser = new IntentParser();
    this.registry = new CapabilityRegistry();
    this.matchingEngine = new MatchingEngine(this.registry);
    this.responseComposer = new ResponseComposer();
  }

  getRegistry(): CapabilityRegistry {
    return this.registry;
  }

  async processIntent(input: string, isNaturalLanguage = false): Promise<any> {
    let intent: ParsedIntent;
    if (isNaturalLanguage) {
      const services = await this.registry.getAllServices();
      const activeCaps = services.flatMap(s =>
        (s.capabilities as any[]).map(c => `${c.verb} ${c.target}`.toUpperCase())
      );
      intent = await this.parser.parseNaturalAsync(input, activeCaps);
    } else {
      intent = this.parser.parse(input);
    }
    console.log(`[INP] Parsed intent: ${intent.name}`);

    if (!(await this.matchingEngine.canFulfillIntent(intent))) {
      throw new Error(`Cannot fulfill intent ${intent.name}: missing required capabilities`);
    }

    const serviceMatches = await this.matchingEngine.matchIntent(intent);
    const normalized = new Map<string, any>();
    for (const [req, match] of serviceMatches.entries()) {
      normalized.set(req.toUpperCase(), match);
    }

    const execEngine = new ExecutionEngine(this.registry, this.securityContext);
    const result = await execEngine.execute(intent, normalized);
    return this.responseComposer.compose(result, intent.output);
  }

  async processIntentObject(intent: ParsedIntent): Promise<any> {
    if (!(await this.matchingEngine.canFulfillIntent(intent))) {
      throw new Error(`Cannot fulfill intent ${intent.name}`);
    }
    const serviceMatches = await this.matchingEngine.matchIntent(intent);
    const normalized = new Map();
    for (const [req, match] of serviceMatches.entries()) {
      normalized.set(req.toUpperCase(), match);
    }
    const execEngine = new ExecutionEngine(this.registry, this.securityContext);
    const result = await execEngine.execute(intent, normalized);
    return this.responseComposer.compose(result, intent.output);
  }
}