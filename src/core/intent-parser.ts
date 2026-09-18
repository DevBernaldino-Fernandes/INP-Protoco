/**
 * @fileoverview Motor de Análise Sintática e Semântica de Intenções (IntentParser)
 * @module Core/IntentParser
 * @description
 * Converte declarações textuais — quer em linguagem específica de domínio (DSL do INP),
 * quer em linguagem natural (via heurísticas locais ou modelos de linguagem LLM) —
 * num objeto canónico `ParsedIntent`. Suporta blocos aninhados de orquestração
 * (`SEQUENCE`, `PARALLEL`, `CONDITION`, `RETRY`, `TIMEOUT`, `DEPENDENCY`, `SCOPE`, `VERIFY`),
 * validação estrita de esquemas com AJV, deteção de injeções de comandos/prompts (Prompt Injection)
 * e prevenção de dependências circulares através de análise de grafos (DFS).
 *
 * @security Bloqueia ataques de Prompt Injection (inclusive ofuscados em Base64 ou Hexadecimal),
 * previne poluição de protótipo (`__proto__`, `constructor`, `prototype`) e limita
 * a profundidade de aninhamento de blocos a um máximo de 15 níveis.
 * @audit Cada intenção recebe um identificador único imutável (UUID v4) e preserva o texto
 * original submetido (`rawText`) para efeitos de auditoria forense e não-repúdio.
 */

import { ParsedIntent, IntentContext, IntentRequirement, IntentFlowStep, IntentOutput, IntentVerb } from './types';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import Ajv from 'ajv';
import crypto from 'crypto';
import { NaturalLanguageSynthesizer } from './natural-language-synthesizer';

// Instanciação do validador formal de esquemas JSON (AJV)
const ajv = new Ajv({ allErrors: true });

/**
 * @description Cache em memória LRU de planos de intenção (AST) previamente compilados.
 * Indexado pelo hash SHA-256 do texto DSL sem os valores variáveis do CONTEXT,
 * permitindo reutilizar o grafo de execução quando apenas os dados de entrada mudam.
 * Limite máximo: 500 entradas para conter o crescimento de memória.
 * @security Garante que apenas estruturas inofensivas de grafo são armazenadas em cache (nunca dados de utilizador).
 * @audit Reduz o tempo de análise de DSLs frequentes de dezenas de ms para sub-milissegundo.
 */
const intentPlanCache = new Map<string, {
  flow: import('./types').IntentFlowStep[];
  requirements: import('./types').IntentRequirement;
  output: import('./types').IntentOutput;
}>();

const INTENT_PLAN_CACHE_MAX_SIZE = 500;

/**
 * @description Gera uma chave de cache normalizada a partir de um texto DSL,
 * removendo o bloco CONTEXT (que contém dados variáveis por requisição).
 * @param {string} dsl - Texto DSL da intenção.
 * @returns {string} Hash SHA-256 da estrutura estática da DSL.
 */
function buildPlanCacheKey(dsl: string): string {
  const withoutContext = dsl.replace(/CONTEXT\s*\{[^}]*\}/gs, 'CONTEXT {}');
  return crypto.createHash('sha256').update(withoutContext.trim()).digest('hex');
}

/**
 * Esquema formal JSON Schema para validação estrita da estrutura da intenção
 * devolvida por modelos de linguagem generativos (LLM).
 */
const parsedIntentSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    context: { type: 'object' },
    requirements: {
      type: 'object',
      properties: {
        capabilities: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['capabilities']
    },
    flow: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { 
            type: 'string', 
            enum: ['SEQUENCE', 'PARALLEL', 'CONDITION', 'RETRY', 'TIMEOUT', 'DEPENDENCY', 'PIPELINE', 'SCOPE'] 
          },
          action: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'string' } },
          timeoutMs: { type: 'number' },
          steps: { type: 'array' }
        },
        required: ['type']
      }
    }
  },
  required: ['name', 'context', 'requirements', 'flow']
};

/**
 * @description Analisador sintático e semântico de intenções com escudos de segurança e deteção de ciclos.
 */
export class IntentParser {
  /**
   * Padrões de expressões regulares para detetar tentativas conhecidas de manipulação de prompts (Prompt Injection / Jailbreak).
   */
  private static INJECTION_PATTERNS = [
    /ignore\s+(the\s+)?(previous|instructions|rules|directives)/i,
    /forget\s+(what\s+)?(i\s+said|the\s+rules|previous\s+prompt)/i,
    /system\s+(override|prompt|bypass|instructions)/i,
    /you\s+must\s+now\s+act\s+as/i,
    /as\s+a\s+new\s+role/i,
    /instead\s+of\s+your\s+instructions/i,
    /dan\s+mode/i,
    /jailbreak/i,
    /system\s+rules\s+override/i
  ];

  /**
   * @description Descodifica com segurança uma cadeia em Base64 para inspeção de conteúdo.
   * @param {string} str - Sequência codificada.
   * @returns {string} Texto decodificado em UTF-8 ou vazio se inválido.
   */
  private static decodeBase64(str: string): string {
    try {
      return Buffer.from(str, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }

  /**
   * @description Descodifica com segurança uma cadeia em Hexadecimal.
   * @param {string} str - Sequência hexadecimal.
   * @returns {string} Texto decodificado em UTF-8 ou vazio se inválido.
   */
  private static decodeHex(str: string): string {
    try {
      return Buffer.from(str, 'hex').toString('utf8');
    } catch {
      return '';
    }
  }

  /**
   * @description Analisa uma cadeia textual em busca de padrões maliciosos de injeção de prompt,
   * inspecionando texto em claro, sequências Base64 e sequências hexadecimais.
   *
   * @param {string} text - Entrada em linguagem natural submetida pelo utilizador.
   * @returns {boolean} Verdadeiro se for detetada uma tentativa de evasão ou injeção; falso caso contrário.
   * @security Previne ataques adversariais que visam forçar o LLM a ignorar políticas ou gerar fluxos não autorizados.
   * @audit Regista avisos no sistema de monitorização para alertas operacionais e SIEM.
   */
  static detectPromptInjection(text: string): boolean {
    // 1. Verificação direta em texto claro
    if (this.INJECTION_PATTERNS.some(regex => regex.test(text))) {
      return true;
    }

    // 2. Verificação de cargas úteis ofuscadas em Base64
    const base64Regex = /\b[a-zA-Z0-9+/]{16,}={0,2}\b/g;
    let match;
    while ((match = base64Regex.exec(text)) !== null) {
      const decoded = this.decodeBase64(match[0]);
      if (decoded && this.INJECTION_PATTERNS.some(regex => regex.test(decoded))) {
        console.warn(`[Escudo IA] Bloqueada injeção de prompt codificada em Base64: "${match[0]}" -> "${decoded}"`);
        return true;
      }
    }

    // 3. Verificação de cargas úteis ofuscadas em Hexadecimal
    const hexRegex = /\b[0-9a-fA-F]{16,}\b/g;
    while ((match = hexRegex.exec(text)) !== null) {
      if (match[0].length % 2 === 0) {
        const decoded = this.decodeHex(match[0]);
        if (decoded && this.INJECTION_PATTERNS.some(regex => regex.test(decoded))) {
          console.warn(`[Escudo IA] Bloqueada injeção de prompt codificada em Hexadecimal: "${match[0]}" -> "${decoded}"`);
          return true;
        }
      }
    }

    return false;
  }

  /**
   * @description Remove comentários de linha única (//) e em bloco preservando sequências literais dentro de strings.
   * @param {string} text - Texto DSL bruto.
   * @returns {string} Texto limpo sem comentários espúrios.
   * @security Previne a mutilação de URLs (ex.: "https://...") ao ignorar falsos comentários "//" dentro de aspas.
   */
  private static stripComments(text: string): string {
    let result = '';
    let inDouble = false;
    let inSingle = false;
    let inTemplate = false;
    let inBlockComment = false;
    let inLineComment = false;
    let escape = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (inLineComment) {
        if (c === '\n' || c === '\r') {
          inLineComment = false;
          result += c;
        }
        continue;
      }

      if (inBlockComment) {
        if (c === '*' && next === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }

      if (escape) {
        result += c;
        escape = false;
        continue;
      }

      if (c === '\\') {
        result += c;
        escape = true;
        continue;
      }

      if (!inSingle && !inTemplate && c === '"') {
        inDouble = !inDouble;
        result += c;
        continue;
      }

      if (!inDouble && !inTemplate && c === "'") {
        inSingle = !inSingle;
        result += c;
        continue;
      }

      if (!inDouble && !inSingle && c === '`') {
        inTemplate = !inTemplate;
        result += c;
        continue;
      }

      if (!inDouble && !inSingle && !inTemplate) {
        if (c === '/' && next === '/') {
          inLineComment = true;
          i++;
          continue;
        }
        if (c === '/' && next === '*') {
          inBlockComment = true;
          i++;
          continue;
        }
      }

      result += c;
    }

    return result.trim();
  }

  /**
   * @description Analisa e interpreta uma cadeia declarativa na DSL canónica do protocolo INP.
   * Exemplo de sintaxe suportada:
   * ```
   * INTENT "comprar_artigo" {
   *   CONTEXT { utilizador_id: "123", artigo_id: "P10" }
   *   REQUIRE { EXECUTE PAYMENT }
   *   FLOW { SEQUENCE { EXECUTE "payment" } }
   *   OUTPUT { FORMAT "json" }
   * }
   * ```
   *
   * @param {string} dsl - Definição formal textual da intenção.
   * @returns {ParsedIntent} Estrutura canónica validada com grafo de orquestração.
   * @throws {Error} Caso falte o nome da intenção, existam violações de segurança ou dependências circulares.
   * @security Valida e previne ciclos e chaves reservadas de protótipo.
   * @audit Atribui um UUID v4 à intenção e arquiva o texto original para fins probatórios.
   */
  /**
   * @description Executa a autocura sintática inteligente em definições DSL com pequenos desvios de formatação.
   * Corrige automaticamente:
   * - Chaves desbalanceadas (ex.: esqueceu de fechar o último `}`).
   * - Aspas simples trocadas por aspas duplas no nome da intenção.
   * - Aspas faltantes no nome da intenção.
   *
   * @param {string} dsl - Texto DSL bruto submetido.
   * @returns {string} Texto DSL higienizado e sintaticamente reparado.
   * @security Mantém o conteúdo estritamente intacto, balanceando apenas delimitadores sintáticos.
   */
  public repairSyntax(dsl: string): string {
    if (!dsl || typeof dsl !== 'string') return dsl;

    let repaired = dsl.trim();

    // 1. Corrige declaração de INTENT sem aspas ou com aspas simples
    repaired = repaired.replace(/INTENT\s+([a-zA-Z0-9_.-]+)\s*\{/i, 'INTENT "$1" {');
    repaired = repaired.replace(/INTENT\s+'([a-zA-Z0-9_.-]+)'\s*\{/i, 'INTENT "$1" {');

    // 2. Balanceamento inteligente de chaves { e }
    let openBraces = 0;
    let inString = false;
    let quoteChar = '';

    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];
      const prev = i > 0 ? repaired[i - 1] : '';

      if ((char === '"' || char === "'") && prev !== '\\') {
        if (!inString) {
          inString = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inString = false;
        }
      } else if (!inString) {
        if (char === '{') openBraces++;
        else if (char === '}') openBraces--;
      }
    }

    if (openBraces > 0) {
      repaired += '\n' + '}'.repeat(openBraces);
    }

    return repaired;
  }

  /**
   * @description Analisa e interpreta uma cadeia declarativa na DSL canónica do protocolo INP.
   * Exemplo de sintaxe suportada:
   * ```
   * INTENT "comprar_artigo" {
   *   CONTEXT { utilizador_id: "123", artigo_id: "P10" }
   *   REQUIRE { EXECUTE PAYMENT }
   *   FLOW { SEQUENCE { EXECUTE "payment" } }
   *   OUTPUT { FORMAT "json" }
   * }
   * ```
   *
   * @param {string} dsl - Definição formal textual da intenção.
   * @returns {ParsedIntent} Estrutura canónica validada com grafo de orquestração.
   * @throws {Error} Caso falte o nome da intenção, existam violações de segurança ou dependências circulares.
   * @security Valida e previne ciclos e chaves reservadas de protótipo.
   * @audit Atribui um UUID v4 à intenção e arquiva o texto original para fins probatórios.
   */
  parse(dsl: string): ParsedIntent {
    try {
      return this.doParse(dsl);
    } catch (err: unknown) {
      // Tentativa de Autocura Sintática Nativa
      const repaired = this.repairSyntax(dsl);
      if (repaired !== dsl) {
        try {
          const result = this.doParse(repaired);
          console.log(`[IntentParser] ✅ Autocura sintática aplicada com sucesso na DSL de "${result.name}".`);
          return result;
        } catch {
          // Se mesmo após autocura sintática falhar, relança o erro original
        }
      }
      throw err;
    }
  }

  /**
   * @description Execução interna do pipeline de análise léxica e compilação do AST da intenção.
   * @param {string} dsl - Definição textual limpa.
   * @returns {ParsedIntent} Objeto da intenção compilada.
   */
  private doParse(dsl: string): ParsedIntent {
    // Remoção de comentários consciente de strings (preserva URLs como "https://...")
    const clean = IntentParser.stripComments(dsl);

    const nameMatch = clean.match(/INTENT\s+["']?([a-zA-Z0-9_.-]+)["']?/i);
    if (!nameMatch) throw new Error('Declaração INP inválida: falta o nome da INTENT');
    const name = nameMatch[1];

    const hasCanonicalFlow = /FLOW\s*\{/i.test(clean);
    const hasSteps = /STEP\s+[a-zA-Z0-9_]+\s*:/i.test(clean) || /\bIF\b[\s\S]*?\bTHEN\b/i.test(clean);

    // Se for formato declarativo baseado em passos (STEP <id>: <VERB> ou IF/THEN/ELSE)
    if (!hasCanonicalFlow && hasSteps) {
      const stepIntent = this.parseStepBased(clean, name, dsl);
      this.detectCircularDependencies(stepIntent.flow);
      return stepIntent;
    }

    // Verificação de cache de plano compilado (evita re-análise de fluxos idênticos)
    const planKey = buildPlanCacheKey(clean);
    const cachedPlan = intentPlanCache.get(planKey);

    if (cachedPlan) {
      return {
        id: uuidv4(),
        name,
        verb: undefined,
        context: this.parseContext(clean),
        requirements: cachedPlan.requirements,
        flow: cachedPlan.flow,
        output: cachedPlan.output,
        rawText: dsl,
      };
    }

    const flow = this.parseFlow(clean);
    this.detectCircularDependencies(flow);
    const requirements = this.parseRequirements(clean);
    const output = this.parseOutput(clean);

    // Armazena o plano no cache com controlo de tamanho máximo
    if (intentPlanCache.size >= INTENT_PLAN_CACHE_MAX_SIZE) {
      const firstKey = intentPlanCache.keys().next().value;
      if (firstKey) intentPlanCache.delete(firstKey);
    }
    intentPlanCache.set(planKey, { flow, requirements, output });

    return {
      id: uuidv4(),
      name,
      verb: undefined,
      context: this.parseContext(clean),
      requirements,
      flow,
      output,
      rawText: dsl,
    };
  }

  /**
   * @description Converte uma frase em linguagem natural numa intenção estruturada recorrendo a heurísticas locais.
   * Extrai quantidades, códigos de produto, endereços de correio eletrónico, valores monetários e identificadores.
   *
   * @param {string} text - Frase submetida pelo utilizador (ex.: "Comprar 2 unidades do produto P10").
   * @returns {ParsedIntent} Objeto de intenção gerado com base nas regras heurísticas.
   */
  parseNatural(text: string, sessionId?: string): ParsedIntent {
    try {
      const { NaturalLanguageSynthesizer } = require('./natural-language-synthesizer');
      const synthesized = NaturalLanguageSynthesizer.synthesize(text, sessionId);
      if (synthesized && synthesized.flow && synthesized.flow.length > 0 && synthesized.flow[0].action !== 'EXECUTE DEFAULT') {
        return synthesized;
      }
    } catch {
      // Recorre às heurísticas locais
    }

    const lower = text.toLowerCase();
    const context: any = {};

    // Extração heurística de padrões frequentes
    const qtyMatch = text.match(/(\d+)\s*(unidade|item|produto|artigo)/i);
    if (qtyMatch) context.quantity = parseInt(qtyMatch[1], 10);
    const prodMatch = text.match(/(produto|item|artigo)\s+([A-Z0-9]+)/i);
    if (prodMatch) context.product_id = prodMatch[2];
    const emailMatch = text.match(/[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/);
    if (emailMatch) context.email = emailMatch[0];

    // Extração de identificadores de utilizador e tokens de pagamento
    const userMatch = text.match(/\b(usr_[a-zA-Z0-9_-]+)\b/i) || text.match(/utilizador\s+([a-zA-Z0-9_-]+)/i) || text.match(/usuário\s+([a-zA-Z0-9_-]+)/i);
    if (userMatch) context.user_id = userMatch[1];

    const tokenMatch = text.match(/\b(tok_[a-zA-Z0-9_-]+)\b/i) || text.match(/cartão\s+([a-zA-Z0-9_-]+)/i) || text.match(/token\s+([a-zA-Z0-9_-]+)/i);
    if (tokenMatch) context.card_token = tokenMatch[1];

    // Extração de montantes financeiros em diversas moedas (€, $, EUR, USD)
    let amount: number | undefined;
    const amountMatch1 = text.match(/(\d+(?:[.,]\d+)?)\s*(euros?|€|dólares|dollars?|usd|\$)/i);
    if (amountMatch1) {
      amount = parseFloat(amountMatch1[1].replace(',', '.'));
    } else {
      const amountMatch2 = text.match(/(\$|€)\s*(\d+(?:[.,]\d+)?)/i);
      if (amountMatch2) {
        amount = parseFloat(amountMatch2[2].replace(',', '.'));
      } else {
        const amountMatch3 = text.match(/(?:pagar|pay|valor|quantia|custo|amount|de|para)\s+(\d+(?:[.,]\d+)?)/i);
        if (amountMatch3) {
          amount = parseFloat(amountMatch3[1].replace(',', '.'));
        }
      }
    }
    if (amount !== undefined && !isNaN(amount)) {
      context.amount = amount;
    }

    let name = 'custom_intent';
    let capabilities: string[] = [];
    let flow: IntentFlowStep[] = [];

    // Mapeamento semântico com base nas intenções comuns de negócio
    if (lower.includes('comprar') || lower.includes('buy')) {
      name = 'purchase_product';
      capabilities = ['EXECUTE PAYMENT', 'FETCH INVENTORY', 'STORE ORDER', 'NOTIFY USER'];
      flow = [{ type: 'SEQUENCE', steps: [
        { type: 'SEQUENCE', action: 'FETCH INVENTORY' },
        { type: 'SEQUENCE', action: 'EXECUTE PAYMENT' },
        { type: 'SEQUENCE', action: 'STORE ORDER' },
        { type: 'SEQUENCE', action: 'NOTIFY USER' }
      ] }];
    } else if (lower.includes('transferir') || lower.includes('transfer') || lower.includes('enviar fundos') || lower.includes('send funds')) {
      name = 'transfer_funds';
      capabilities = ['TRANSFER FUNDS', 'NOTIFY USER'];
      flow = [{ type: 'SEQUENCE', steps: [
        { type: 'SEQUENCE', action: 'TRANSFER FUNDS' },
        { type: 'SEQUENCE', action: 'NOTIFY USER' }
      ] }];
    } else if (lower.includes('reembolsar') || lower.includes('refund') || lower.includes('reembolso')) {
      name = 'refund_payment';
      capabilities = ['REFUND PAYMENT', 'NOTIFY USER'];
      flow = [{ type: 'SEQUENCE', steps: [
        { type: 'SEQUENCE', action: 'REFUND PAYMENT' },
        { type: 'SEQUENCE', action: 'NOTIFY USER' }
      ] }];
    } else if (lower.includes('cancelar') || lower.includes('cancel')) {
      name = 'cancel_order';
      capabilities = ['CANCEL ORDER', 'REFUND PAYMENT'];
      flow = [{ type: 'SEQUENCE', steps: [
        { type: 'SEQUENCE', action: 'CANCEL ORDER' },
        { type: 'SEQUENCE', action: 'REFUND PAYMENT' }
      ] }];
    } else if (lower.includes('pagar') || lower.includes('pay') || lower.includes('pagamento')) {
      name = 'process_payment';
      capabilities = ['EXECUTE PAYMENT'];
      flow = [{ type: 'SEQUENCE', action: 'EXECUTE PAYMENT' }];
    } else if (lower.includes('vender') || lower.includes('sell')) {
      name = 'sell_product';
      capabilities = ['EXECUTE PAYMENT', 'STORE ORDER', 'NOTIFY USER'];
      flow = [{ type: 'SEQUENCE', steps: [
        { type: 'SEQUENCE', action: 'EXECUTE PAYMENT' },
        { type: 'SEQUENCE', action: 'STORE ORDER' },
        { type: 'SEQUENCE', action: 'NOTIFY USER' }
      ] }];
    } else if (lower.includes('reservar') || lower.includes('reserve')) {
      name = 'reserve_stock';
      capabilities = ['RESERVE STOCK'];
      flow = [{ type: 'SEQUENCE', action: 'RESERVE STOCK' }];
    } else if (lower.includes('stock') || lower.includes('inventário') || lower.includes('inventory')) {
      name = 'check_inventory';
      capabilities = ['FETCH INVENTORY'];
      flow = [{ type: 'SEQUENCE', action: 'FETCH INVENTORY' }];
    } else if (lower.includes('saldo') || lower.includes('balance')) {
      name = 'query_balance';
      capabilities = ['QUERY BALANCE'];
      flow = [{ type: 'SEQUENCE', action: 'QUERY BALANCE' }];
    } else if (lower.includes('relatório') || lower.includes('relatorio') || lower.includes('report') || lower.includes('gerar') || lower.includes('generate')) {
      name = 'generate_report';
      capabilities = ['GENERATE REPORT'];
      flow = [{ type: 'SEQUENCE', action: 'GENERATE REPORT' }];
    } else if (lower.includes('validar') || lower.includes('verificar') || lower.includes('verify') || lower.includes('identidade')) {
      name = 'verify_identity';
      capabilities = ['VERIFY IDENTITY'];
      flow = [{ type: 'SEQUENCE', action: 'VERIFY IDENTITY' }];
    } else if (lower.includes('notificar') || lower.includes('notify')) {
      name = 'send_notification';
      capabilities = ['NOTIFY USER'];
      flow = [{ type: 'SEQUENCE', action: 'NOTIFY USER' }];
    } else {
      const syn = NaturalLanguageSynthesizer.synthesize(text);
      name = syn.name;
      capabilities = syn.requirements.capabilities;
      flow = syn.flow;
      Object.assign(context, syn.context);
    }

    const result = {
      id: uuidv4(),
      name,
      verb: undefined,
      context,
      requirements: { capabilities },
      flow,
      output: { format: 'json' as 'json' },
    };
    this.detectCircularDependencies(flow);
    return result;
  }

  // ---------- Métodos Privados Auxiliares de Análise Sintática ----------

  /**
   * @description Extrai as variáveis e literais do bloco `CONTEXT` com proteção contra poluição de protótipo.
   */
  private parseContext(dsl: string): IntentContext {
    const content = this.extractBalancedBlock(dsl, 'CONTEXT');
    if (!content) return {};
    return this.parsePropertiesString(content);
  }

  /** Limite máximo de profundidade de aninhamento para mitigar ataques de DoS por estouro de pilha */
  private static readonly MAX_NESTED_DEPTH = 20;

  /**
   * @description Analisa uma cadeia de pares chave-valor (DSL de propriedades) com proteção contra Prototype Pollution e DoS.
   * Suporta tipos primitivos, cadeias com aspas, arrays, objetos aninhados e blocos de verbos aninhados (ex.: FETCH { ... }).
   *
   * @param {string} content - Conteúdo textual do bloco de propriedades.
   * @param {number} [depth=0] - Nível atual de profundidade de recursão sintática.
   * @returns {Record<string, any>} Dicionário de propriedades estruturadas.
   * @throws {Error} Se for detetada poluição de protótipo ou profundidade excessiva.
   */
  private parsePropertiesString(content: string, depth = 0): Record<string, any> {
    if (depth > IntentParser.MAX_NESTED_DEPTH) {
      throw new Error(`Violação de Segurança: Profundidade máxima de aninhamento de propriedades excedida (${IntentParser.MAX_NESTED_DEPTH} níveis).`);
    }
    const ctx: Record<string, any> = {};
    let i = 0;
    while (i < content.length) {
      while (i < content.length && /[\s,]/s.test(content[i])) {
        i++;
      }
      if (i >= content.length) break;

      const keyMatch = content.substring(i).match(/^([a-zA-Z0-9_$-]+)\s*:/);
      if (!keyMatch) {
        i++;
        continue;
      }
      const key = keyMatch[1];

      // MEDIDA DE SEGURANÇA MANDATÓRIA: Bloqueio imediato de poluição de protótipo
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error(`Violação de Segurança: Detetada a chave proibida "${key}" no contexto (prevenção de Prototype Pollution).`);
      }
      i += keyMatch[0].length;

      while (i < content.length && /\s/s.test(content[i])) {
        i++;
      }

      if (i >= content.length) break;

      if (content[i] === '"' || content[i] === "'" || content[i] === '`') {
        const quoteChar = content[i];
        let val = '';
        i++;
        let escape = false;
        while (i < content.length) {
          const char = content[i];
          if (escape) {
            val += char;
            escape = false;
            i++;
            continue;
          }
          if (char === '\\') {
            escape = true;
            i++;
            continue;
          }
          if (char === quoteChar) {
            i++;
            break;
          }
          val += char;
          i++;
        }
        ctx[key] = val;
      } else if (content[i] === '{' || content[i] === '[') {
        const startChar = content[i];
        const endChar = startChar === '{' ? '}' : ']';
        let braceCount = 1;
        let startValIdx = i;
        i++;
        let inDoubleQuote = false;
        let inSingleQuote = false;
        let inTemplateLiteral = false;
        let escape = false;
        while (i < content.length && braceCount > 0) {
          const char = content[i];
          if (escape) {
            escape = false;
            i++;
            continue;
          }
          if (char === '\\') {
            escape = true;
            i++;
            continue;
          }
          if (char === '"' && !inSingleQuote && !inTemplateLiteral) {
            inDoubleQuote = !inDoubleQuote;
          } else if (char === "'" && !inDoubleQuote && !inTemplateLiteral) {
            inSingleQuote = !inSingleQuote;
          } else if (char === '`' && !inDoubleQuote && !inSingleQuote) {
            inTemplateLiteral = !inTemplateLiteral;
          } else if (!inDoubleQuote && !inSingleQuote && !inTemplateLiteral) {
            if (char === startChar) braceCount++;
            else if (char === endChar) braceCount--;
          }
          i++;
        }
        const rawVal = content.substring(startValIdx, i);
        try {
          ctx[key] = JSON.parse(rawVal);
        } catch (err) {
          if (startChar === '{') {
            ctx[key] = this.parsePropertiesString(rawVal.slice(1, -1), depth + 1);
          } else if (startChar === '[') {
            try {
              // Suporta sintaxe JSON relaxada com chaves não delimitadas por aspas e vírgulas finais
              const relaxed = rawVal
                .replace(/([{,]\s*)([a-zA-Z0-9_$-]+)\s*:/g, '$1"$2":')
                .replace(/,\s*([\]}])/g, '$1');
              ctx[key] = JSON.parse(relaxed);
            } catch {
              ctx[key] = rawVal;
            }
          } else {
            ctx[key] = rawVal;
          }
        }
      } else {
        // Verifica se é uma declaração de verbo aninhado (ex.: FETCH { ... } ou MUTATE { ... })
        const verbBlockMatch = content.substring(i).match(/^([A-Z_]+)\s*\{/);
        if (verbBlockMatch) {
          const nestedVerb = verbBlockMatch[1];
          const braceIdx = content.indexOf('{', i);
          const nestedResult = this.extractBalancedBody(content, braceIdx);
          if (nestedResult !== null) {
            ctx[key] = {
              verb: nestedVerb,
              ...this.parsePropertiesString(nestedResult.body, depth + 1)
            };
            i = nestedResult.endIdx + 1;
            continue;
          }
        }

        let val = '';
        while (i < content.length && content[i] !== ',' && content[i] !== '\n' && content[i] !== '\r') {
          val += content[i];
          i++;
        }
        val = val.trim();
        if (val === 'true') {
          ctx[key] = true;
        } else if (val === 'false') {
          ctx[key] = false;
        } else if (val === 'null') {
          ctx[key] = null;
        } else if (!isNaN(Number(val)) && val !== '') {
          ctx[key] = Number(val);
        } else {
          ctx[key] = val;
        }
      }
    }
    return ctx;
  }

  /**
   * @description Extrai com segurança o corpo de um bloco a partir da chaveta de abertura.
   * @param {string} text - Texto fonte.
   * @param {number} openBraceIdx - Índice do caractere '{'.
   * @returns {{ body: string; endIdx: number } | null} Conteúdo e índice do fecho ou null.
   */
  private extractBalancedBody(text: string, openBraceIdx: number): { body: string; endIdx: number } | null {
    if (openBraceIdx < 0 || openBraceIdx >= text.length || text[openBraceIdx] !== '{') {
      return null;
    }
    let braceCount = 1;
    let i = openBraceIdx + 1;
    let inDouble = false;
    let inSingle = false;
    let inTemplate = false;
    let escape = false;

    while (i < text.length && braceCount > 0) {
      const char = text[i];
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (char === '\\') {
        escape = true;
        i++;
        continue;
      }
      if (char === '"' && !inSingle && !inTemplate) inDouble = !inDouble;
      else if (char === "'" && !inDouble && !inTemplate) inSingle = !inSingle;
      else if (char === '`' && !inDouble && !inSingle) inTemplate = !inTemplate;
      else if (!inDouble && !inSingle && !inTemplate) {
        if (char === '{') braceCount++;
        else if (char === '}') braceCount--;
      }
      if (braceCount === 0) break;
      i++;
    }

    if (braceCount === 0) {
      return {
        body: text.substring(openBraceIdx + 1, i).trim(),
        endIdx: i
      };
    }
    return null;
  }

  /**
   * @description Analisa intenções declarativas baseadas em passos (sintaxe STEP <id>: <VERB> { ... }),
   * suportando cabeçalhos contratuais (TARGET, TIMEOUT, IDEMPOTENCY, SCHEMA) e orquestração de Saga.
   *
   * @param {string} clean - Texto DSL sem comentários.
   * @param {string} name - Nome da intenção.
   * @param {string} rawDsl - Texto DSL original para auditoria.
   * @returns {ParsedIntent} Objeto estruturado com o grafo de fluxo canónico e capacidades resolvidas.
   */
  private parseStepBased(clean: string, name: string, rawDsl: string): ParsedIntent {
    const context: any = {};

    // 1. Extração de Cabeçalhos Contratuais (TARGET, TIMEOUT, IDEMPOTENCY)
    const targetMatch = clean.match(/TARGET\s*:\s*["']?([^"'\r\n;]+)["']?/i);
    if (targetMatch) context._target = targetMatch[1].trim();

    const timeoutMatch = clean.match(/TIMEOUT\s*:\s*(\d+)(ms|s)?/i);
    if (timeoutMatch) {
      const val = parseInt(timeoutMatch[1], 10);
      context._timeoutMs = timeoutMatch[2]?.toLowerCase() === 's' ? val * 1000 : val;
    }

    const idempMatch = clean.match(/IDEMPOTENCY\s*:\s*["']?([^"'\r\n;]+)["']?/i);
    if (idempMatch) context._idempotency = idempMatch[1].trim();

    // 2. Extração de bloco CONTEXT explícito se existir
    const explicitContext = this.parseContext(clean);
    if (explicitContext && Object.keys(explicitContext).length > 0) {
      Object.assign(context, explicitContext);
    }

    const capabilities: string[] = [];
    const steps: IntentFlowStep[] = [];

    // 3. Extração e Análise de Passos (STEP <name>: <VERB> { ... })
    const stepDeclRegex = /STEP\s+([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_]+)\s*\{/gi;
    let match;

    while ((match = stepDeclRegex.exec(clean)) !== null) {
      const stepName = match[1];
      const verb = match[2].toUpperCase();
      const openBraceIdx = match.index + match[0].length - 1;

      const stepResult = this.extractBalancedBody(clean, openBraceIdx);
      if (stepResult === null) continue;
      const stepBody = stepResult.body;

      stepDeclRegex.lastIndex = stepResult.endIdx + 1;

      // Bloco PARALLEL
      if (verb === 'PARALLEL') {
        const subSteps: IntentFlowStep[] = [];
        const innerVerbRegex = /([A-Z_]+)\s*\{/g;
        let innerMatch;
        while ((innerMatch = innerVerbRegex.exec(stepBody)) !== null) {
          const innerVerb = innerMatch[1].toUpperCase();
          if (['STEP', 'STEPS', 'CONTEXT'].includes(innerVerb)) continue;
          const innerOpenIdx = innerMatch.index + innerMatch[0].length - 1;
          const innerResult = this.extractBalancedBody(stepBody, innerOpenIdx);
          if (innerResult !== null) {
            innerVerbRegex.lastIndex = innerResult.endIdx + 1;
            const innerParams = this.parsePropertiesString(innerResult.body);
            const innerTarget = (innerParams.resource || innerParams.service || innerParams.target || 'DEFAULT').toUpperCase();
            const innerAction = `${innerVerb} ${innerTarget}`;
            subSteps.push({
              type: 'SEQUENCE',
              action: innerAction,
              parameters: innerParams
            });
            capabilities.push(innerAction);
            capabilities.push(`${innerVerb} *`);
            capabilities.push(innerVerb);
          }
        }

        steps.push({
          type: 'PARALLEL',
          name: stepName,
          steps: subSteps
        });
        continue;
      }

      // Bloco CONDITIONAL
      if (verb === 'CONDITIONAL') {
        const condMatch = stepBody.match(/condition\s*:\s*["']?([^"',\r\n]+(?:\s*[!=><]=?\s*[^"',\r\n]+)?)["']?/i);
        const condition = condMatch ? condMatch[1].trim() : '';

        let thenAction = '';
        const thenMatch = stepBody.match(/then\s*:\s*([A-Z_]+)/i);
        if (thenMatch) {
          const thenVerb = thenMatch[1].toUpperCase();
          const thenIdx = stepBody.indexOf(thenMatch[0]) + thenMatch[0].length;
          const thenResult = this.extractBalancedBody(stepBody, stepBody.indexOf('{', thenIdx));
          const thenParams = thenResult ? this.parsePropertiesString(thenResult.body) : {};
          const thenTarget = (thenParams.service || thenParams.target || 'DEFAULT').toUpperCase();
          thenAction = `${thenVerb} ${thenTarget}`;
          capabilities.push(thenAction);
          capabilities.push(`${thenVerb} *`);
          capabilities.push(thenVerb);
        }

        let elseAction = '';
        const elseMatch = stepBody.match(/else\s*:\s*([A-Z_]+)/i);
        if (elseMatch) {
          const elseVerb = elseMatch[1].toUpperCase();
          const elseIdx = stepBody.indexOf(elseMatch[0]) + elseMatch[0].length;
          const elseResult = this.extractBalancedBody(stepBody, stepBody.indexOf('{', elseIdx));
          const elseParams = elseResult ? this.parsePropertiesString(elseResult.body) : {};
          const elseTarget = (elseParams.service || elseParams.target || 'DEFAULT').toUpperCase();
          elseAction = `${elseVerb} ${elseTarget}`;
          capabilities.push(elseAction);
          capabilities.push(`${elseVerb} *`);
          capabilities.push(elseVerb);
        }

        steps.push({
          type: 'CONDITION',
          name: stepName,
          condition,
          steps: thenAction ? [{ type: 'SEQUENCE', action: thenAction }] : [],
          fallback: elseAction || undefined
        });
        continue;
      }

      // Verbos normais (AUTHENTICATE, COALESCE, MUTATE, REASON, ATTEST, VALIDATE, MEMOIZE, FETCH, etc.)
      const params = this.parsePropertiesString(stepBody);
      const targetName = (params.service || params.resource || params.target || params.provider || (context._target || 'DEFAULT')).toUpperCase();
      const action = `${verb} ${targetName}`;

      capabilities.push(action);
      capabilities.push(`${verb} *`);
      capabilities.push(verb);

      // Bloco COMPENSATE
      let compensate: { action: string; payload?: any } | undefined;
      const compIdx = stepBody.search(/COMPENSATE\s*:/i);
      if (compIdx !== -1) {
        const braceOpen = stepBody.indexOf('{', compIdx);
        if (braceOpen !== -1) {
          const compResult = this.extractBalancedBody(stepBody, braceOpen);
          if (compResult) {
            const compProps = this.parsePropertiesString(compResult.body);
            compensate = {
              action: compProps.action ? `${compProps.action}`.toUpperCase() : `${action}_COMPENSATE`,
              payload: compProps.payload || compProps
            };
          }
        }
      }

      // Bloco RETRY
      let retry: { maxAttempts?: number; backoff?: string } | undefined;
      const retryIdx = stepBody.search(/RETRY\s*:/i);
      if (retryIdx !== -1) {
        const braceOpen = stepBody.indexOf('{', retryIdx);
        if (braceOpen !== -1) {
          const retryResult = this.extractBalancedBody(stepBody, braceOpen);
          if (retryResult) {
            const retryProps = this.parsePropertiesString(retryResult.body);
            retry = {
              maxAttempts: retryProps.maxAttempts ? Number(retryProps.maxAttempts) : 3,
              backoff: retryProps.backoff || 'exponential'
            };
          }
        }
      }

      steps.push({
        type: 'SEQUENCE',
        name: stepName,
        action,
        parameters: params,
        compensate,
        retry,
        outputSchema: params.outputSchema || params.schema
      });
    }

    // 4. Suporte a blocos IF <cond> THEN { ... } ELSE { ... } fora de STEP
    const ifRegex = /IF\s+["']?([^"'{}\r\n]+)["']?\s+THEN\s*\{/gi;
    let ifMatch;
    while ((ifMatch = ifRegex.exec(clean)) !== null) {
      const condition = ifMatch[1].trim();
      const openBrace = ifMatch.index + ifMatch[0].length - 1;
      const thenResult = this.extractBalancedBody(clean, openBrace);
      let elseBody: string | null = null;
      if (thenResult !== null) {
        const rest = clean.substring(thenResult.endIdx + 1);
        const elseMatch = rest.match(/^\s*ELSE\s*\{/i);
        if (elseMatch) {
          const elseOpen = thenResult.endIdx + 1 + rest.indexOf('{');
          const elseResult = this.extractBalancedBody(clean, elseOpen);
          if (elseResult) elseBody = elseResult.body;
        }
      }

      const thenSteps: IntentFlowStep[] = [];
      if (thenResult && thenResult.body) {
        const innerStepsMatch = thenResult.body.match(/STEP\s+[a-zA-Z0-9_]+\s*:\s*([A-Z_]+)/i);
        if (innerStepsMatch) {
          const v = innerStepsMatch[1].toUpperCase();
          thenSteps.push({ type: 'SEQUENCE', action: `${v} DEFAULT` });
          capabilities.push(`${v} *`);
        }
      }

      let elseFallback: string | undefined;
      if (elseBody) {
        const elseStepMatch = elseBody.match(/STEP\s+[a-zA-Z0-9_]+\s*:\s*([A-Z_]+)/i);
        if (elseStepMatch) {
          const v = elseStepMatch[1].toUpperCase();
          elseFallback = `${v} DEFAULT`;
          capabilities.push(`${v} *`);
        }
      }

      steps.push({
        type: 'CONDITION',
        condition,
        steps: thenSteps,
        fallback: elseFallback
      });
    }

    const resultFlow: IntentFlowStep[] = steps.length > 0
      ? [{ type: 'SEQUENCE', steps }]
      : [{ type: 'SEQUENCE', action: `${name.toUpperCase()} DEFAULT` }];

    return {
      id: uuidv4(),
      name,
      verb: undefined,
      context,
      requirements: { capabilities: Array.from(new Set(capabilities)) },
      flow: resultFlow,
      output: { format: 'json' },
      rawText: rawDsl
    };
  }

  /**
   * @description Extrai com segurança o corpo de um bloco delimitado por chavetas, respeitando cadeias de texto e escapes.
   */
  private extractBalancedBlock(text: string, keyword: string): string | null {
    const regex = new RegExp(keyword + '\\s*\\{', 'i');
    const match = text.match(regex);
    if (!match) return null;
    const startIdx = (match.index || 0) + match[0].length;
    let braceCount = 1;
    let i = startIdx;
    let inDoubleQuote = false;
    let inSingleQuote = false;
    let inTemplateLiteral = false;
    let escape = false;
    while (i < text.length && braceCount > 0) {
      const char = text[i];
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (char === '\\') {
        escape = true;
        i++;
        continue;
      }
      if (char === '"' && !inSingleQuote && !inTemplateLiteral) {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === "'" && !inDoubleQuote && !inTemplateLiteral) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '`' && !inDoubleQuote && !inSingleQuote) {
        inTemplateLiteral = !inTemplateLiteral;
      } else if (!inDoubleQuote && !inSingleQuote && !inTemplateLiteral) {
        if (char === '{') braceCount++;
        else if (char === '}') braceCount--;
      }
      if (braceCount === 0) break;
      i++;
    }
    if (braceCount === 0) {
      return text.substring(startIdx, i);
    }
    return null;
  }

  /**
   * @description Extrai as capacidades obrigatórias declaradas no bloco `REQUIRE`.
   */
  private parseRequirements(dsl: string): IntentRequirement {
    const match = dsl.match(/REQUIRE\s*\{([^}]+)\}/s);
    if (!match) return { capabilities: [] };
    const caps = match[1].trim().split(/\n/).map(l => l.trim().toUpperCase()).filter(l => l.length > 0);
    return { capabilities: caps };
  }

  /**
   * @description Extrai o bloco de fluxo principal `FLOW`.
   */
  private parseFlow(dsl: string): IntentFlowStep[] {
    const match = dsl.match(/FLOW\s*\{([\s\S]+?)\}\s*(?=(?:\r?\n\s*|\s+)(?:OUTPUT|REQUIRE|CONTEXT|METADATA)\s*\{|\}$)/i) ||
                  dsl.match(/FLOW\s*\{([\s\S]+?)\}\s*(?=\n\s*\w+\s*\{|\}$)/);
    return match ? this.parseFlowBlock(match[1]) : [];
  }

  /**
   * @description Analisa recursivamente blocos aninhados de orquestração de fluxo.
   * Impõe um limite máximo de 15 níveis de aninhamento para evitar estouro de pilha.
   *
   * @param {string} content - Conteúdo do bloco textual.
   * @param {number} [depth=0] - Nível atual de recursão.
   * @returns {IntentFlowStep[]} Lista estruturada de passos de fluxo.
   */
  private parseFlowBlock(content: string, depth = 0): IntentFlowStep[] {
    if (depth > 15) {
      throw new Error('Violação de Segurança: O aninhamento do fluxo de execução excedeu o limite máximo autorizado (15 níveis).');
    }
    const steps: IntentFlowStep[] = [];
    let block = content.trim();
    if (block.startsWith('{') && block.endsWith('}')) block = block.slice(1, -1).trim();
    const lines = block.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) { i++; continue; }

      if (line.startsWith('SEQUENCE')) {
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'SEQUENCE', steps: this.parseFlowBlock(inner, depth + 1) });
        i = next;
      } else if (line.startsWith('PARALLEL')) {
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'PARALLEL', steps: this.parseFlowBlock(inner, depth + 1) });
        i = next;
      } else if (line.startsWith('CONDITION')) {
        const condMatch = line.match(/CONDITION\s+"([^"]+)"/);
        const condition = condMatch ? condMatch[1] : '';
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'CONDITION', condition, steps: this.parseFlowBlock(inner, depth + 1) });
        i = next;
      } else if ((line === 'RETRY' || line.startsWith('RETRY ') || line.startsWith('RETRY{')) && !line.startsWith('RETRY_')) {
        const retryMatch = line.match(/RETRY\s+(\d+)/);
        const retryCount = retryMatch ? parseInt(retryMatch[1], 10) : 3;
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'RETRY', retryCount, steps: this.parseFlowBlock(inner, depth + 1) });
        i = next;
      } else if (line.startsWith('FALLBACK') && line.includes('"')) {
        const fbMatch = line.match(/FALLBACK\s+"([^"]+)"/);
        steps.push({ type: 'FALLBACK', fallback: fbMatch ? fbMatch[1] : '' });
        i++;
      } else if (line.startsWith('PIPELINE')) {
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'PIPELINE', steps: this.parseFlowBlock(inner, depth + 1) });
        i = next;
      } else if (line.startsWith('SCOPE')) {
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'SCOPE', steps: this.parseFlowBlock(inner, depth + 1) });
        i = next;
      } else if (line.startsWith('CONFIDENTIAL_SCOPE')) {
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'SCOPE', action: 'CONFIDENTIAL', steps: this.parseFlowBlock(inner, depth + 1) });
        i = next;
      } else if (line.startsWith('VERIFY') && line.match(/VERIFY\s+"([^"]+)"\s*(>=|<=|>|<|==)\s*([0-9.]+)/i)) {
        const verifyMatch = line.match(/VERIFY\s+"([^"]+)"\s*(>=|<=|>|<|==)\s*([0-9.]+)/i);
        if (verifyMatch) {
          steps.push({ type: 'SCOPE', action: `VERIFY ${verifyMatch[1]} ${verifyMatch[2]} ${verifyMatch[3]}` });
        }
        i++;
      } else if (line.startsWith('DEPENDENCY')) {
        const depMatch = line.match(/DEPENDENCY\s+"([^"]+)"/);
        const dependsOn = depMatch ? depMatch[1].split(',').map(s => s.trim()) : [];
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'DEPENDENCY', dependsOn, steps: this.parseFlowBlock(inner, depth + 1) });
        i = next;
      } else if (line.startsWith('TIMEOUT')) {
        const tmMatch = line.match(/TIMEOUT\s+(\d+)/);
        const timeoutMs = tmMatch ? parseInt(tmMatch[1], 10) : 5000;
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'TIMEOUT', timeoutMs, steps: this.parseFlowBlock(inner, depth + 1) });
        i = next;
      } else if (line.startsWith('ENCRYPT')) {
        const encMatch = line.match(/ENCRYPT\s+"([^"]+)"/);
        steps.push({ type: 'SCOPE', action: `ENCRYPT ${encMatch ? encMatch[1] : ''}` });
        i++;
      } else if (line.startsWith('DECRYPT')) {
        const decMatch = line.match(/DECRYPT\s+"([^"]+)"/);
        steps.push({ type: 'SCOPE', action: `DECRYPT ${decMatch ? decMatch[1] : ''}` });
        i++;
      } else {
        // Ação atómica simples
        let action = line.toUpperCase().replace(/"/g, '');
        steps.push({ type: 'SEQUENCE', action });
        i++;
      }
    }
    return steps;
  }

  /**
   * @description Extrai o conteúdo delimitado de linhas que contêm chavetas.
   */
  private extractBlock(lines: string[], startIdx: number): { inner: string; next: number } {
    let braceCount = 0;
    let started = false;
    const collected: string[] = [];
    let i = startIdx;
    while (i < lines.length) {
      const line = lines[i];
      for (const ch of line) {
        if (ch === '{') { braceCount++; started = true; }
        else if (ch === '}') { braceCount--; if (braceCount === 0 && started) break; }
      }
      if (started && (braceCount > 0 || (braceCount === 0 && collected.length === 0))) {
        collected.push(line);
      }
      if (braceCount === 0 && started) break;
      i++;
    }
    if (collected.length) {
      collected[0] = collected[0].replace(/.*\{/, '');
      collected[collected.length-1] = collected[collected.length-1].replace(/\}.*/, '');
    }
    let inner = collected.join('\n').trim();
    inner = inner.replace(/^\{+/, '').replace(/\}+$/, '');
    return { inner, next: i+1 };
  }

  /**
   * @description Extrai a configuração do formato de saída (`OUTPUT`).
   */
  private parseOutput(dsl: string): IntentOutput {
    const match = dsl.match(/OUTPUT\s*\{[^}]*FORMAT\s+"([^"]+)"/);
    const format = match ? match[1] as 'json'|'xml'|'text'|'event' : 'json';
    return { format };
  }

  /**
   * @description Converte texto em linguagem natural através de um Modelo de Linguagem de Grande Escala (LLM).
   * Valida a resposta recebida face ao esquema JSON rigoroso utilizando AJV.
   * Recorre a heurísticas locais caso o modelo falhe, demore ou detete injeção de prompt.
   *
   * @param {string} text - Frase em linguagem natural.
   * @param {string[]} [activeCapabilities=[]] - Capacidades atualmente disponíveis na rede.
   * @returns {Promise<ParsedIntent>} Objeto estruturado da intenção.
   * @security Filtra antecipadamente o texto com `detectPromptInjection`.
   * @audit Regista erros de validação estrutural do retorno de IA.
   */
  async parseNaturalAsync(text: string, activeCapabilities: string[] = [], sessionId?: string): Promise<ParsedIntent> {
    if (IntentParser.detectPromptInjection(text)) {
      console.warn(`[Analisador] Tentativa de injeção de prompt intercetada! Texto: "${text}". A recorrer a heurísticas locais defensivas.`);
      return this.parseNatural(text, sessionId);
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log('[Analisador] Nenhuma chave de API de LLM encontrada. A utilizar analisador heurístico local.');
      return this.parseNatural(text, sessionId);
    }

    try {
      console.log('[Analisador] A interpretar intenção através do motor de IA...');
      const capabilitiesList = activeCapabilities.length > 0
        ? activeCapabilities.map(c => `"${c}"`).join(', ')
        : '"EXECUTE PAYMENT", "FETCH INVENTORY", "STORE ORDER", "NOTIFY USER"';

      let prompt = `
You are an expert Intent Parser for the INP (Intent Network Protocol).
Convert this natural language text into a structured JSON representing a ParsedIntent.

Available capabilities on the network: ${capabilitiesList}.

Natural language input: "${text}"

Your output must be a valid JSON matching this TypeScript type:
{
  "name": string,
  "context": Record<string, any>,
  "requirements": { "capabilities": string[] },
  "flow": Array<{
    "type": "SEQUENCE" | "PARALLEL" | "CONDITION" | "RETRY" | "TIMEOUT" | "DEPENDENCY" | "PIPELINE" | "SCOPE",
    "action"?: string,
    "dependsOn"?: string[],
    "timeoutMs"?: number,
    "steps"?: any[]
  }>
}

Return ONLY the JSON. Do not include markdown code blocks.
      `.trim();

      let parsed: any;
      if (process.env.GEMINI_API_KEY) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
        const response = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }] }]
        });
        const responseText = response.data.candidates[0].content.parts[0].text;
        parsed = JSON.parse(responseText.replace(/```json/g, '').replace(/```/g, '').trim());
      } else {
        const url = 'https://api.openai.com/v1/chat/completions';
        const response = await axios.post(url, {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1
        }, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const responseText = response.data.choices[0].message.content;
        parsed = JSON.parse(responseText.replace(/```json/g, '').replace(/```/g, '').trim());
      }

      // Validação Estrutural Rígida com AJV
      const validate = ajv.compile(parsedIntentSchema);
      const isValid = validate(parsed);
      if (!isValid) {
        throw new Error(`A validação estrutural falhou para a resposta do LLM. Erros: ${ajv.errorsText(validate.errors)}`);
      }

      const result = {
        id: uuidv4(),
        name: parsed.name,
        context: parsed.context || {},
        requirements: parsed.requirements || { capabilities: [] },
        flow: parsed.flow || [],
        output: { format: 'json' as 'json' },
        rawText: text
      };
      this.detectCircularDependencies(result.flow);
      return result;
    } catch (err: any) {
      console.warn(`[Analisador] Falha na interpretação via LLM: ${err.message}. A recorrer a heurísticas.`);
      return this.parseNatural(text);
    }
  }

  /**
   * @description Percorre o grafo de dependências (`DEPENDENCY` / `dependsOn`) e deteta ciclos
   * através de pesquisa em profundidade (DFS), prevenindo impasses e laços infinitos na execução.
   *
   * @param {IntentFlowStep[]} flow - Estrutura de passos do fluxo.
   * @throws {Error} Se for detetado um ciclo fechado de dependências entre passos.
   * @security Previne ataques de negação de serviço e bloqueio permanente de recursos por grafos cíclicos.
   * @audit Comprova a terminação determinística garantida do fluxo de orquestração.
   */
  private detectCircularDependencies(flow: IntentFlowStep[]): void {
    const actionsMap = new Map<string, string[]>();

    function collectActions(stepsList: IntentFlowStep[], parentDeps: string[] = []) {
      for (const step of stepsList) {
        const currentDeps = [...parentDeps];
        if (step.dependsOn) {
          currentDeps.push(...step.dependsOn.map(d => d.trim().toUpperCase()));
        }

        if (step.action) {
          const actName = step.action.trim().toUpperCase();
          const existing = actionsMap.get(actName) || [];
          actionsMap.set(actName, [...new Set([...existing, ...currentDeps])]);
        }

        if (step.steps) {
          collectActions(step.steps, currentDeps);
        }
      }
    }

    collectActions(flow);

    const visited = new Set<string>();
    const recStack = new Set<string>();

    function hasCycle(node: string): boolean {
      if (recStack.has(node)) return true;
      if (visited.has(node)) return false;

      visited.add(node);
      recStack.add(node);

      const deps = actionsMap.get(node) || [];
      for (const dep of deps) {
        if (hasCycle(dep)) return true;
      }

      recStack.delete(node);
      return false;
    }

    for (const node of actionsMap.keys()) {
      if (hasCycle(node)) {
        throw new Error(`Dependência Circular Detetada: Um ou mais passos formam um ciclo fechado de dependências envolvendo "${node}".`);
      }
    }
  }
}