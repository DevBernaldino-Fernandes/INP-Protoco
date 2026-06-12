/**
 * Intent Parser: Converts DSL or natural language into a ParsedIntent object.
 * Supports nested blocks (SEQUENCE, PARALLEL, CONDITION, RETRY, etc.).
 */

import { ParsedIntent, IntentContext, IntentRequirement, IntentFlowStep, IntentOutput, IntentVerb } from './types';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

export class IntentParser {
  /**
   * Parse an INP DSL string.
   * Example:
   * INTENT "buy_product" {
   *   CONTEXT { user_id: "123", product_id: "P10" }
   *   REQUIRE { EXECUTE PAYMENT }
   *   FLOW { SEQUENCE { EXECUTE "payment" } }
   *   OUTPUT { FORMAT "json" }
   * }
   */
  parse(dsl: string): ParsedIntent {
    const clean = dsl.replace(/\/\/.*$/gm, '').trim();
    const nameMatch = clean.match(/INTENT\s+"([^"]+)"/);
    if (!nameMatch) throw new Error('Invalid INP: missing INTENT name');
    const name = nameMatch[1];

    return {
      id: uuidv4(),
      name,
      verb: undefined,
      context: this.parseContext(clean),
      requirements: this.parseRequirements(clean),
      flow: this.parseFlow(clean),
      output: this.parseOutput(clean),
      rawText: dsl,
    };
  }

  /**
   * Convert natural language to intent using heuristics.
   * Extracts quantities, product IDs, emails, amounts.
   */
  parseNatural(text: string): ParsedIntent {
    const lower = text.toLowerCase();
    const context: any = {};

    // Extract common patterns
    const qtyMatch = text.match(/(\d+)\s*(unidade|item|produto)/i);
    if (qtyMatch) context.quantity = parseInt(qtyMatch[1], 10);
    const prodMatch = text.match(/(produto|item|artigo)\s+([A-Z0-9]+)/i);
    if (prodMatch) context.product_id = prodMatch[2];
    const emailMatch = text.match(/[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/);
    if (emailMatch) context.email = emailMatch[0];
    const amountMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(euros?|€)/i);
    if (amountMatch) context.amount = parseFloat(amountMatch[1].replace(',', '.'));

    let name = 'custom_intent';
    let capabilities: string[] = [];
    let flow: IntentFlowStep[] = [];

    if (lower.includes('comprar') || lower.includes('buy')) {
      name = 'purchase_product';
      capabilities = ['EXECUTE PAYMENT', 'FETCH INVENTORY', 'STORE ORDER', 'NOTIFY USER'];
      flow = [{ type: 'SEQUENCE', steps: [
        { type: 'SEQUENCE', action: 'FETCH INVENTORY' },
        { type: 'SEQUENCE', action: 'EXECUTE PAYMENT' },
        { type: 'SEQUENCE', action: 'STORE ORDER' },
        { type: 'SEQUENCE', action: 'NOTIFY USER' }
      ] }];
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

    return {
      id: uuidv4(),
      name,
      verb: undefined,
      context,
      requirements: { capabilities },
      flow,
      output: { format: 'json' },
    };
  }

  // ---------- Private parsing helpers ----------

  private parseContext(dsl: string): IntentContext {
    const match = dsl.match(/CONTEXT\s*\{([^}]+)\}/s);
    if (!match) return {};
    const content = match[1];
    const pairs = content.match(/(\w+)\s*:\s*("[^"]*"|\d+(?:\.\d+)?|true|false|{[^}]*}|\[[^\]]*\])/g);
    if (!pairs) return {};
    const ctx: IntentContext = {};
    for (const pair of pairs) {
      const [key, value] = pair.split(':').map(s => s.trim());
      let parsed: any = value;
      if (value.startsWith('"') && value.endsWith('"')) parsed = value.slice(1, -1);
      else if (value === 'true') parsed = true;
      else if (value === 'false') parsed = false;
      else if (!isNaN(Number(value))) parsed = Number(value);
      else if (value.startsWith('{')) parsed = JSON.parse(value);
      else if (value.startsWith('[')) parsed = JSON.parse(value);
      ctx[key] = parsed;
    }
    return ctx;
  }

  private parseRequirements(dsl: string): IntentRequirement {
    const match = dsl.match(/REQUIRE\s*\{([^}]+)\}/s);
    if (!match) return { capabilities: [] };
    const caps = match[1].trim().split(/\n/).map(l => l.trim().toUpperCase()).filter(l => l.length > 0);
    return { capabilities: caps };
  }

  private parseFlow(dsl: string): IntentFlowStep[] {
    const match = dsl.match(/FLOW\s*\{([\s\S]+?)\}\s*(?=\n\s*\w+\s*\{|\}$)/);
    return match ? this.parseFlowBlock(match[1]) : [];
  }

  private parseFlowBlock(content: string): IntentFlowStep[] {
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
        steps.push({ type: 'SEQUENCE', steps: this.parseFlowBlock(inner) });
        i = next;
      } else if (line.startsWith('PARALLEL')) {
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'PARALLEL', steps: this.parseFlowBlock(inner) });
        i = next;
      } else if (line.startsWith('CONDITION')) {
        const condMatch = line.match(/CONDITION\s+"([^"]+)"/);
        const condition = condMatch ? condMatch[1] : '';
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'CONDITION', condition, steps: this.parseFlowBlock(inner) });
        i = next;
      } else if (line.startsWith('RETRY')) {
        const retryMatch = line.match(/RETRY\s+(\d+)/);
        const retryCount = retryMatch ? parseInt(retryMatch[1], 10) : 3;
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'RETRY', retryCount, steps: this.parseFlowBlock(inner) });
        i = next;
      } else if (line.startsWith('FALLBACK')) {
        const fbMatch = line.match(/FALLBACK\s+"([^"]+)"/);
        steps.push({ type: 'FALLBACK', fallback: fbMatch ? fbMatch[1] : '' });
        i++;
      } else if (line.startsWith('PIPELINE')) {
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'PIPELINE', steps: this.parseFlowBlock(inner) });
        i = next;
      } else if (line.startsWith('SCOPE')) {
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'SCOPE', steps: this.parseFlowBlock(inner) });
        i = next;
      } else if (line.startsWith('DEPENDENCY')) {
        const depMatch = line.match(/DEPENDENCY\s+"([^"]+)"/);
        const dependsOn = depMatch ? depMatch[1].split(',').map(s => s.trim()) : [];
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'DEPENDENCY', dependsOn, steps: this.parseFlowBlock(inner) });
        i = next;
      } else if (line.startsWith('TIMEOUT')) {
        const tmMatch = line.match(/TIMEOUT\s+(\d+)/);
        const timeoutMs = tmMatch ? parseInt(tmMatch[1], 10) : 5000;
        const { inner, next } = this.extractBlock(lines, i);
        steps.push({ type: 'TIMEOUT', timeoutMs, steps: this.parseFlowBlock(inner) });
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
        // simple action
        let action = line.toUpperCase().replace(/"/g, '');
        steps.push({ type: 'SEQUENCE', action });
        i++;
      }
    }
    return steps;
  }

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

  private parseOutput(dsl: string): IntentOutput {
    const match = dsl.match(/OUTPUT\s*\{[^}]*FORMAT\s+"([^"]+)"/);
    const format = match ? match[1] as 'json'|'xml'|'text'|'event' : 'json';
    return { format };
  }

  async parseNaturalAsync(text: string, activeCapabilities: string[] = []): Promise<ParsedIntent> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log('[Parser] No LLM API Key found. Using local heuristic parser.');
      return this.parseNatural(text);
    }

    try {
      console.log('[Parser] Resolving intent via LLM...');
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
  "name": string, // descriptive name like "purchase_product"
  "context": Record<string, any>, // extracted key-value pairs (like amount, product_id, quantity, email)
  "requirements": { "capabilities": string[] }, // array of required capabilities
  "flow": Array<{
    "type": "SEQUENCE" | "PARALLEL" | "CONDITION" | "RETRY" | "TIMEOUT" | "DEPENDENCY" | "PIPELINE" | "SCOPE",
    "action"?: string, // action name if simple step like "EXECUTE PAYMENT", or "ENCRYPT fieldName", "DECRYPT fieldName"
    "dependsOn"?: string[], // array of steps this step depends on (optional)
    "timeoutMs"?: number, // timeout in ms for TIMEOUT block (optional)
    "steps"?: any[] // nested steps
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

      return {
        id: uuidv4(),
        name: parsed.name,
        context: parsed.context || {},
        requirements: parsed.requirements || { capabilities: [] },
        flow: parsed.flow || [],
        output: { format: 'json' },
        rawText: text
      };
    } catch (err: any) {
      console.warn(`[Parser] LLM parsing failed: ${err.message}. Falling back to heuristics.`);
      return this.parseNatural(text);
    }
  }
}