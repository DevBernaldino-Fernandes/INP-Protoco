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

// Instanciação do validador formal de esquemas JSON (AJV)
const ajv = new Ajv({ allErrors: true });

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
    // Remoção de comentários de linha única (//)
    const clean = dsl.replace(/\/\/.*$/gm, '').trim();
    const nameMatch = clean.match(/INTENT\s+"([^"]+)"/);
    if (!nameMatch) throw new Error('Declaração INP inválida: falta o nome da INTENT');
    const name = nameMatch[1];

    const flow = this.parseFlow(clean);
    // Verificação de segurança contra impasses ou ciclos fechados de dependência no grafo
    this.detectCircularDependencies(flow);

    return {
      id: uuidv4(),
      name,
      verb: undefined,
      context: this.parseContext(clean),
      requirements: this.parseRequirements(clean),
      flow,
      output: this.parseOutput(clean),
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
  parseNatural(text: string): ParsedIntent {
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
    } else if (lower.includes('stock') || lower.includes('inventário')) {
      name = 'check_inventory';
      capabilities = ['FETCH INVENTORY'];
      flow = [{ type: 'SEQUENCE', action: 'FETCH INVENTORY' }];
    } else if (lower.includes('notificar')) {
      name = 'send_notification';
      capabilities = ['NOTIFY USER'];
      flow = [{ type: 'SEQUENCE', action: 'NOTIFY USER' }];
    } else {
      capabilities = ['EXECUTE ACTION'];
      flow = [{ type: 'SEQUENCE', action: 'EXECUTE ACTION' }];
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

    const ctx: IntentContext = {};
    let i = 0;
    while (i < content.length) {
      while (i < content.length && /[\s,]/s.test(content[i])) {
        i++;
      }
      if (i >= content.length) break;

      const keyMatch = content.substring(i).match(/^(\w+)\s*:/);
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
          ctx[key] = rawVal;
        }
      } else {
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
    const match = dsl.match(/FLOW\s*\{([\s\S]+?)\}\s*(?=\n\s*\w+\s*\{|\}$)/);
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
      } else if (line.startsWith('RETRY')) {
        const retryMatch = line.match(/RETRY\s+(\d+)/);
        const retryCount = retryMatch ? parseInt(retryMatch[1], 10) : 3;
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'RETRY', retryCount, steps: this.parseFlowBlock(inner, depth + 1) });
        i = next;
      } else if (line.startsWith('FALLBACK')) {
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
      } else if (line.startsWith('VERIFY')) {
        const verifyMatch = line.match(/VERIFY\s+"([^"]+)"\s*(>=|<=|>|<|==)\s*([0-9.]+)/i);
        if (verifyMatch) {
          steps.push({ type: 'SCOPE', action: `VERIFY ${verifyMatch[1]} ${verifyMatch[2]} ${verifyMatch[3]}` });
        } else {
          steps.push({ type: 'SCOPE', action: line });
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
  async parseNaturalAsync(text: string, activeCapabilities: string[] = []): Promise<ParsedIntent> {
    if (IntentParser.detectPromptInjection(text)) {
      console.warn(`[Analisador] Tentativa de injeção de prompt intercetada! Texto: "${text}". A recorrer a heurísticas locais defensivas.`);
      return this.parseNatural(text);
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log('[Analisador] Nenhuma chave de API de LLM encontrada. A utilizar analisador heurístico local.');
      return this.parseNatural(text);
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