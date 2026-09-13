/**
 * @fileoverview Declaração de Tipos para a Biblioteca Externa circuit-breaker-js
 * @module Typings/CircuitBreaker
 * @description
 * Fornece a interface de tipagem TypeScript para o módulo `circuit-breaker-js`,
 * permitindo a sua integração estrita com o motor de execução (ExecutionEngine)
 * do protocolo INP. O disjuntor de circuito (Circuit Breaker) previne falhas em cascata
 * ao interromper temporariamente invocações para serviços remotos degradados ou indisponíveis.
 *
 * @security Evita o esgotamento de recursos e ataques de saturação ao cortar chamadas repetidas a nós instáveis.
 * @audit Mudanças no estado do circuito (Aberto/Fechado/Semi-aberto) devem ser registadas na telemetria.
 */

declare module 'circuit-breaker-js' {
  export interface CircuitBreakerOptions {
    windowDuration?: number;
    numBuckets?: number;
    errorThresholdPercentage?: number;
    errorThreshold?: number;
    volumeThreshold?: number;
    timeoutDuration?: number;
    [key: string]: any;
  }

  export default class CircuitBreaker {
    constructor(options?: CircuitBreakerOptions);
    run(
      command: (success: () => void, failure: (err?: any) => void) => void,
      fallback?: (err?: any) => void
    ): void;
    forceClose(): void;
    forceOpen(): void;
    unforce(): void;
  }
}
