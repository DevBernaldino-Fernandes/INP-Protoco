/**
 * Execution Engine: executes the flow graph, invokes services (local or HTTP),
 * with retries, timeouts, circuit breakers, and persistence.
 */

/// <reference path="../circuit-breaker-js.d.ts" />
import axios from 'axios';
import axiosRetry from 'axios-retry';
import CircuitBreaker from 'circuit-breaker-js';
import { v4 as uuidv4 } from 'uuid';
import Ajv from 'ajv';
import { ParsedIntent, IntentFlowStep, ExecutionResult, ExecutionStepResult, ServiceMatch, SecurityContext } from './types';
import { CapabilityRegistry } from './capability-registry';
import { ExecutionRepository } from '../persistence/repositories/ExecutionRepository';

const ajv = new Ajv({ allErrors: true });

// Configure axios retry globally
axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

export class ExecutionEngine {
  constructor(
    private registry: CapabilityRegistry,
    private securityContext?: SecurityContext
  ) {}

  /**
   * Main entry point: executes the entire intent and persists the result.
   */
  async execute(intent: ParsedIntent, serviceMatches: Map<string, ServiceMatch>): Promise<ExecutionResult> {
    const executionId = uuidv4();
    const startedAt = new Date();
    const steps: ExecutionStepResult[] = [];
    let finalOutput: any = null;
    let status: 'COMPLETED' | 'FAILED' = 'COMPLETED';
    let errorMsg: string | undefined;

    // Persist initial state
    await ExecutionRepository.save({
      id: executionId,
      intentId: intent.id,
      status: 'RUNNING',
      steps: [],
      startedAt,
    });

    try {
      finalOutput = await this.executeFlow(intent.flow, intent.context, serviceMatches, steps);
    } catch (err: any) {
      status = 'FAILED';
      errorMsg = err.message;
    }

    const completedAt = new Date();
    await ExecutionRepository.update(executionId, {
      status,
      output: finalOutput,
      error: errorMsg,
      steps,
      completedAt,
    });

    return {
      id: executionId,
      intentId: intent.id,
      status,
      steps,
      finalOutput,
      error: errorMsg,
      startedAt,
      completedAt,
    };
  }

  /**
   * Recursive flow executor.
   */
  private async executeFlow(
    steps: IntentFlowStep[],
    context: any,
    serviceMatches: Map<string, ServiceMatch>,
    allSteps: ExecutionStepResult[],
    depth = 0
  ): Promise<any> {
    let current = context;
    for (const step of steps) {
      // Check dependencies first
      if (step.dependsOn && step.dependsOn.length > 0) {
        const completedStepActions = allSteps.filter(s => s.status === 'COMPLETED').map(s => s.action.toUpperCase());
        const hasDeps = step.dependsOn.every(d => completedStepActions.includes(d.toUpperCase()));
        if (!hasDeps) {
          throw new Error(`Dependency Violation: Step depends on [${step.dependsOn.join(', ')}], which are not yet completed.`);
        }
      }

      const stepId = uuidv4();
      const start = Date.now();
      let stepStatus: any = 'RUNNING';
      let output: any = null;
      let error: string | undefined;

      try {
        if (step.type === 'SEQUENCE' && step.steps) {
          output = await this.executeFlow(step.steps, current, serviceMatches, allSteps, depth+1);
          current = output;
        } else if (step.type === 'PARALLEL' && step.steps) {
          const promises = step.steps.map(sub =>
            this.executeFlow([sub], current, serviceMatches, allSteps, depth+1)
          );
          const results = await Promise.all(promises);
          output = results;
          current = output;
        } else if (step.type === 'CONDITION' && step.condition && this.evaluateCondition(step.condition, current)) {
          if (step.steps) {
            output = await this.executeFlow(step.steps, current, serviceMatches, allSteps, depth+1);
            current = output;
          }
        } else if (step.type === 'RETRY') {
          let attempts = 0;
          const max = step.retryCount || 3;
          let success = false;
          while (attempts < max && !success) {
            try {
              output = await this.executeAction(step.action!, current, serviceMatches);
              success = true;
              current = output;
            } catch (err) {
              attempts++;
              if (attempts >= max) throw err;
              await this.delay(1000 * Math.pow(2, attempts) + Math.random() * 200);
            }
          }
        } else if (step.type === 'FALLBACK' && step.fallback) {
          output = await this.executeAction(step.fallback, current, serviceMatches);
          current = output;
        } else if (step.type === 'TIMEOUT') {
          if (step.steps) {
            const timeoutMs = step.timeoutMs || 5000;
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Timeout of ${timeoutMs}ms exceeded`)), timeoutMs)
            );
            output = await Promise.race([
              this.executeFlow(step.steps, current, serviceMatches, allSteps, depth+1),
              timeoutPromise
            ]);
            current = output;
          } else {
            console.warn(`Timeout set to ${step.timeoutMs}ms (no sub-steps)`);
          }
        } else if (step.type === 'PIPELINE' && step.steps) {
          output = await this.executeFlow(step.steps, current, serviceMatches, allSteps, depth+1);
          current = output;
        } else if (step.type === 'SCOPE') {
          if (step.action && step.action.startsWith('ENCRYPT')) {
            const field = step.action.split(/\s+/)[1];
            if (current && current[field]) {
              current[field] = Buffer.from(current[field].toString()).toString('base64');
            }
            output = current;
          } else if (step.action && step.action.startsWith('DECRYPT')) {
            const field = step.action.split(/\s+/)[1];
            if (current && current[field]) {
              current[field] = Buffer.from(current[field].toString(), 'base64').toString('ascii');
            }
            output = current;
          } else if (step.steps) {
            const localContext = JSON.parse(JSON.stringify(current));
            output = await this.executeFlow(step.steps, localContext, serviceMatches, allSteps, depth+1);
            current = output;
          }
        } else if (step.type === 'DEPENDENCY' && step.steps) {
          output = await this.executeFlow(step.steps, current, serviceMatches, allSteps, depth+1);
          current = output;
        } else if (step.action) {
          output = await this.executeAction(step.action, current, serviceMatches);
          current = output;
        }
        stepStatus = 'COMPLETED';
      } catch (err: any) {
        stepStatus = 'FAILED';
        error = err.message;
        throw err;
      } finally {
        allSteps.push({
          stepId,
          action: step.action || step.type,
          status: stepStatus,
          input: current,
          output,
          error,
          durationMs: Date.now() - start,
          timestamp: new Date(),
        });
      }
    }
    return current;
  }

  /**
   * Execute a single action by calling the matched service (HTTP or local handler).
   */
  private async executeAction(action: string, context: any, serviceMatches: Map<string, ServiceMatch>): Promise<any> {
    const [verb, ...rest] = action.trim().split(/\s+/);
    const target = rest.join(' ');
    const key = `${verb} ${target}`.toUpperCase();
    const match = serviceMatches.get(key);
    if (!match) throw new Error(`No service registered for capability: ${key}`);

    // 1. RBAC Check: Verify user permissions against required capability permissions
    const requiredPerms = match.capability.requiredPermissions;
    if (requiredPerms && requiredPerms.length > 0) {
      const userPerms = this.securityContext?.permissions || [];
      const hasAll = requiredPerms.every(p => userPerms.includes(p));
      if (!hasAll) {
        throw new Error(`Security Violation: Insufficient permissions to execute capability "${key}". Required: [${requiredPerms.join(', ')}]. Provided: [${userPerms.join(', ')}]`);
      }
    }

    // 2. Contract Validation: Validate input context against capability inputSchema (if defined)
    const schema = match.capability.inputSchema;
    if (schema) {
      const validate = ajv.compile(schema);
      const valid = validate(context);
      if (!valid) {
        const errorsText = ajv.errorsText(validate.errors);
        throw new Error(`Contract Violation: Context payload does not match schema for capability "${key}". Details: ${errorsText}`);
      }
    }

    const svc = match.service;
    if (svc.endpoint) {
      // Remote call with circuit breaker
      const breaker = new CircuitBreaker({ timeoutDuration: 5000, errorThreshold: 50 });
      const response = await new Promise((resolve, reject) => {
        breaker.run(
          async (success: any, failure: any) => {
            try {
              const res = await axios.post(`${svc.endpoint}/execute`, { verb, target, context });
              success();
              resolve(res.data);
            } catch (err) {
              failure(err);
              reject(err);
            }
          },
          (err: any) => {
            reject(new Error(`Circuit Breaker Open or Error: ${err ? err.message : 'Unknown'}`));
          }
        );
      });
      return response;
    } else if (svc.handler) {
      // Local handler (fallback for development)
      return await svc.handler(context, { securityContext: this.securityContext });
    } else {
      throw new Error(`Service ${svc.id} has no endpoint or handler`);
    }
  }

  private evaluateCondition(condition: string, context: any): boolean {
    try {
      const fn = new Function('context', `return (${condition})`);
      return fn(context);
    } catch {
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}