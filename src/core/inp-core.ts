/**
 * @fileoverview Orquestrador Central do Protocolo INP (INPCore)
 * @module Core/INPCore
 * @description
 * Fachada principal que unifica e coordena todos os subsistemas do Intent Network Protocol:
 * 1. Análise sintática e semântica de intenções (`IntentParser`).
 * 2. Catálogo e descoberta de microserviços (`CapabilityRegistry`).
 * 3. Resolução e correspondência inteligente de capacidades (`MatchingEngine`).
 * 4. Motor de execução resiliente, transacional e com padrões Saga (`ExecutionEngine`).
 * 5. Compositor e serializador de respostas nos formatos pretendidos (`ResponseComposer`).
 *
 * @security Encapsula o contexto de segurança (`SecurityContext`) e garante a validação
 * prévia da exequibilidade de cada intenção antes de despoletar invocações de rede.
 * @audit Serve de ponto de entrada unificado para a orquestração do protocolo, viabilizando
 * auditorias de ponta-a-ponta e assegurando integridade na resposta final devolvida ao consumidor.
 */

import { IntentParser } from './intent-parser';
import { CapabilityRegistry } from './capability-registry';
import { MatchingEngine } from './matching-engine';
import { ExecutionEngine } from './execution-engine';
import { ResponseComposer } from './response-composer';
import { ParsedIntent, SecurityContext, INPConfig } from './types';

/**
 * @description Classe central de coordenação e orquestração do protocolo INP.
 */
export class INPCore {
  private parser: IntentParser;
  private registry: CapabilityRegistry;
  private matchingEngine: MatchingEngine;
  private responseComposer: ResponseComposer;
  private config: INPConfig;
  private securityContext?: SecurityContext;

  /**
   * @param {Partial<INPConfig>} [config] - Configurações opcionais de inicialização do protocolo.
   * @param {SecurityContext} [securityContext] - Contexto de segurança contendo permissões e identificador do utilizador.
   */
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

  /**
   * @description Devolve a instância ativa do catálogo de capacidades e registo de serviços.
   * @returns {CapabilityRegistry} Registo de capacidades do protocolo.
   */
  getRegistry(): CapabilityRegistry {
    return this.registry;
  }

  /**
   * @description Devolve a instância do analisador de intenções.
   * @returns {IntentParser} Analisador sintático/semântico.
   */
  getParser(): IntentParser {
    return this.parser;
  }

  /**
   * @description Devolve a instância do motor de correspondência e vinculação de capacidades.
   * @returns {MatchingEngine} Motor de correspondência.
   */
  getMatchingEngine(): MatchingEngine {
    return this.matchingEngine;
  }

  /**
   * @description Processa uma intenção a partir de uma cadeia de texto bruto (DSL formal ou linguagem natural).
   * Conduz o pedido por todas as fases: análise, verificação de satisfatibilidade, correspondência,
   * orquestração transacional e composição da resposta.
   *
   * @param {string | any} input - Texto declarativo na DSL do INP, frase em linguagem natural ou objeto de intenção.
   * @param {boolean | any} [contextOrNatural=false] - Indica se é linguagem natural ou recebe diretamente o mapa de contexto de execução.
   * @param {any} [contextArg] - Contexto explícito caso o segundo parâmetro seja booleano.
   * @returns {Promise<any>} Resposta serializada no formato requerido pela intenção (JSON, XML, Texto ou Evento).
   * @throws {Error} Se faltarem capacidades obrigatórias ou se a orquestração falhar irrecuperavelmente.
   * @security Valida permissões e executa através do ExecutionEngine com proteção transacional.
   * @audit Regista a intenção processada e emite os respetivos eventos na telemetria de auditoria.
   */
  async processIntent(input: string | any, contextOrNatural: boolean | any = false, contextArg?: any): Promise<any> {
    if (typeof input === 'object' && input !== null) {
      const explicitContext = typeof contextOrNatural === 'object' && contextOrNatural !== null ? contextOrNatural : contextArg;
      return this.processIntentObject(input, explicitContext);
    }

    let isNaturalLanguage = false;
    let context: any = undefined;

    if (typeof contextOrNatural === 'boolean') {
      isNaturalLanguage = contextOrNatural;
      context = contextArg;
    } else if (typeof contextOrNatural === 'object' && contextOrNatural !== null) {
      context = contextOrNatural;
      isNaturalLanguage = false;
    }

    const isDSL = typeof input === 'string' && (
      /\bINTENT\b/i.test(input) ||
      /\bFLOW\b/i.test(input) ||
      /\bREQUIRE\b/i.test(input) ||
      /\bSTEP\b/i.test(input) ||
      /\bIF\b/i.test(input)
    );

    if (isDSL) {
      isNaturalLanguage = false;
    }

    let intent: ParsedIntent;
    if (isNaturalLanguage) {
      const services = await this.registry.getAllServices();
      const activeCaps = services.flatMap(s =>
        (s.capabilities as any[]).map(c => `${c.verb} ${c.target}`.toUpperCase())
      );
      const sessionId = context?.sessionId;
      intent = await this.parser.parseNaturalAsync(input, activeCaps, sessionId);
    } else {
      intent = this.parser.parse(input);
    }

    if (context && typeof context === 'object') {
      intent.context = { ...(intent.context || {}), ...context };
    }

    console.log(`[INP] Intenção analisada com sucesso: ${intent.name}`);

    if (!(await this.matchingEngine.canFulfillIntent(intent))) {
      throw new Error(`Não é possível satisfazer a intenção "${intent.name}": faltam capacidades obrigatórias na rede.`);
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

  /**
   * @description Executa uma intenção previamente analisada e estruturada (`ParsedIntent`).
   *
   * @param {ParsedIntent} intent - Objeto canónico estruturado da intenção.
   * @param {any} [extraContext] - Dados de contexto dinâmico adicional.
   * @returns {Promise<any>} Resposta final formatada.
   * @throws {Error} Se a rede não conseguir satisfazer os requisitos da intenção.
   */
  async processIntentObject(intent: ParsedIntent | any, extraContext?: any): Promise<any> {
    const normalizedIntent: ParsedIntent = {
      id: intent.id || require('uuid').v4(),
      name: intent.name || 'unnamed_intent',
      verb: intent.verb,
      context: { ...(intent.context || {}), ...(extraContext || {}) },
      requirements: intent.requirements || { capabilities: [] },
      flow: intent.flow || [],
      output: intent.output || { format: 'json' },
      rawText: intent.rawText || JSON.stringify(intent)
    };

    if ((!normalizedIntent.flow || normalizedIntent.flow.length === 0) && Array.isArray((intent as any).steps)) {
      const stepsList: any[] = (intent as any).steps;
      const flowSteps: any[] = [];
      const caps: string[] = [];

      for (const st of stepsList) {
        const verb = (st.verb || 'EXECUTE').toUpperCase();
        const target = (st.target || st.parameters?.resource || st.parameters?.service || 'DEFAULT').toUpperCase();
        const act = `${verb} ${target}`;
        flowSteps.push({
          type: 'SEQUENCE',
          name: st.id || st.name,
          action: act,
          parameters: st.parameters || st.payload || {}
        });
        caps.push(act);
        caps.push(`${verb} *`);
        caps.push(verb);
      }

      normalizedIntent.flow = [{ type: 'SEQUENCE', steps: flowSteps }];
      if (normalizedIntent.requirements.capabilities.length === 0) {
        normalizedIntent.requirements.capabilities = Array.from(new Set(caps));
      }
    }

    if (!(await this.matchingEngine.canFulfillIntent(normalizedIntent))) {
      throw new Error(`Não é possível satisfazer a intenção "${normalizedIntent.name}": faltam capacidades obrigatórias na rede.`);
    }
    const serviceMatches = await this.matchingEngine.matchIntent(normalizedIntent);
    const normalized = new Map();
    for (const [req, match] of serviceMatches.entries()) {
      normalized.set(req.toUpperCase(), match);
    }
    const execEngine = new ExecutionEngine(this.registry, this.securityContext);
    const result = await execEngine.execute(normalizedIntent, normalized);
    return this.responseComposer.compose(result, normalizedIntent.output);
  }
}