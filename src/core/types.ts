/**
 * Core type definitions for the INP protocol.
 */

import { v4 as uuidv4 } from 'uuid';

// Intent verbs (actions)
export type IntentVerb =
  | 'CREATE' | 'READ' | 'UPDATE' | 'DELETE'
  | 'EXECUTE' | 'PROCESS' | 'ANALYZE' | 'GENERATE'
  | 'TRANSFER' | 'VALIDATE' | 'AUTHENTICATE' | 'AUTHORIZE'
  | 'NOTIFY' | 'SYNC' | 'ROUTE' | 'COMPOSE'
  | 'FETCH' | 'STORE' | 'CALCULATE'
  | 'REFUND' | 'CANCEL' | 'APPROVE' | 'REJECT';

// Flow control keywords
export type FlowControl =
  | 'SEQUENCE' | 'PARALLEL' | 'CONDITION' | 'RETRY'
  | 'FALLBACK' | 'TIMEOUT' | 'DEPENDENCY' | 'PIPELINE' | 'SCOPE';

// Security keywords
export type SecurityKeyword = 
  | 'SECURE' | 'ENCRYPT' | 'DECRYPT' | 'VERIFY'
  | 'TRUST' | 'PERMISSION' | 'POLICY';

// Context is a free-form JSON object
export interface IntentContext {
  [key: string]: any;
}

// Required capabilities for the intent
export interface IntentRequirement {
  capabilities: string[];   // e.g., "EXECUTE PAYMENT"
}

// One step in the flow (can be nested)
export interface IntentFlowStep {
  type: FlowControl;
  name?: string;
  action?: string;          // for simple steps: "FETCH INVENTORY"
  condition?: string;       // JavaScript expression for CONDITION
  retryCount?: number;
  fallback?: string;
  timeoutMs?: number;
  dependsOn?: string[];
  steps?: IntentFlowStep[]; // nested steps
}

// Output format specification
export interface IntentOutput {
  format: 'json' | 'xml' | 'text' | 'event';
  schema?: any;
}

// Fully parsed intent
export interface ParsedIntent {
  id: string;               // UUID
  name: string;
  verb?: IntentVerb;
  context: IntentContext;
  requirements: IntentRequirement;
  flow: IntentFlowStep[];
  output: IntentOutput;
  rawText?: string;
}

// A capability that a service exposes
export interface Capability {
  verb: IntentVerb;
  target: string;
  description?: string;
  requiredPermissions?: string[];
  inputSchema?: any;
  outputSchema?: any;
}

// Service constraints (optional)
export interface ServiceConstraint {
  maxConcurrent?: number;
  maxPayloadSizeMB?: number;
  timeoutMs?: number;
  requiredPermissions?: string[];
}

// Service definition (local or remote)
export interface Service {
  id: string;
  name: string;
  description?: string;
  capabilities: Capability[];
  inputSchema?: any;
  outputSchema?: any;
  constraints?: ServiceConstraint;
  trustScore: number;       // 0-100
  securityLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  endpoint?: string;        // HTTP base URL for remote calls
  handler?: (input: any, context?: any) => Promise<any>; // local fallback
}

// Result of matching a requirement to a service
export interface ServiceMatch {
  service: Service;
  capability: Capability;
  score: number;
}

// Execution status
export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'RETRYING' | 'CANCELLED';

// Detailed result of a single step
export interface ExecutionStepResult {
  stepId: string;
  action: string;
  status: ExecutionStatus;
  input?: any;
  output?: any;
  error?: string;
  durationMs: number;
  timestamp: Date;
}

// Complete execution result
export interface ExecutionResult {
  id: string;
  intentId: string;
  status: ExecutionStatus;
  steps: ExecutionStepResult[];
  finalOutput?: any;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

// Security context (user, roles, permissions)
export interface SecurityContext {
  userId?: string;
  roles?: string[];
  permissions?: string[];
  trustLevel?: number;
}

// Configuration for the INP core
export interface INPConfig {
  enableSecurity: boolean;
  defaultTimeoutMs: number;
  maxRetries: number;
  trustThreshold: number;
}