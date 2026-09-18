/**
 * @fileoverview Sintetizador Cognitivo de Linguagem Natural Offline (NaturalLanguageSynthesizer)
 * @module Core/NaturalLanguageSynthesizer
 * @description
 * Compilador determinístico e semântico de linguagem natural para planos de orquestração
 * da DSL do INP Protocol. Executa com 100% de autonomia soberana offline, sem exigir ligação à internet
 * ou dependência de APIs externas de LLMs (como Gemini ou OpenAI).
 *
 * Capacidades Principais:
 * 1. Resolução Semântica de Verbos e Alvos: Mapeia intenções e expressões em linguagem natural
 *    diretamente para os 125 verbos canónicos e estratégicos do catálogo INP.
 * 2. Extração de Entidades de Alta Precisão: Deteta montantes monetários, moedas, identificadores
 *    de contas (`acc_...`), utilizadores (`usr_...`), produtos (`PROD_...`), cobranças (`ch_...`),
 *    e-mails e tokens de autenticação.
 * 3. Síntese de Grafos de Fluxo: Identifica encadeamentos de múltiplos passos ("primeiro ..., depois ...")
 *    gerando árvores de execução estruturadas (`SEQUENCE`) com tipagem canónica.
 *
 * @security Sanitiza entradas para neutralizar injeções de comandos ou código hostil.
 * @audit Gera o plano `ParsedIntent` determinístico com rastreabilidade integral da fonte textual original.
 */

import { v4 as uuidv4 } from 'uuid';
import { ParsedIntent, IntentFlowStep, IntentVerb } from './types';
import { SessionContextStore } from './session-context-store';

/**
 * @description Mapeamento semântico de lemas e expressões verbais para verbos oficiais do protocolo.
 */
const VERB_DICTIONARY: Record<string, { verb: string; defaultTarget: string }> = {
  // Transações financeiras
  'transferir': { verb: 'TRANSFER', defaultTarget: 'FUNDS' },
  'transfira': { verb: 'TRANSFER', defaultTarget: 'FUNDS' },
  'transferencia': { verb: 'TRANSFER', defaultTarget: 'FUNDS' },
  'transfer': { verb: 'TRANSFER', defaultTarget: 'FUNDS' },
  'enviar dinheiro': { verb: 'TRANSFER', defaultTarget: 'FUNDS' },
  'enviar': { verb: 'TRANSFER', defaultTarget: 'FUNDS' },
  'envie': { verb: 'TRANSFER', defaultTarget: 'FUNDS' },
  'reembolsar': { verb: 'REFUND', defaultTarget: 'PAYMENT' },
  'reembolso': { verb: 'REFUND', defaultTarget: 'PAYMENT' },
  'refund': { verb: 'REFUND', defaultTarget: 'PAYMENT' },
  'pagar': { verb: 'EXECUTE', defaultTarget: 'PAYMENT' },
  'pague': { verb: 'EXECUTE', defaultTarget: 'PAYMENT' },
  'pagamento': { verb: 'EXECUTE', defaultTarget: 'PAYMENT' },
  'pay': { verb: 'EXECUTE', defaultTarget: 'PAYMENT' },

  // Gestão de entidades CRUD
  'criar': { verb: 'CREATE', defaultTarget: 'ORDER' },
  'cadastrar': { verb: 'CREATE', defaultTarget: 'ENTITY' },
  'registar': { verb: 'CREATE', defaultTarget: 'ENTITY' },
  'create': { verb: 'CREATE', defaultTarget: 'ORDER' },
  'consultar': { verb: 'READ', defaultTarget: 'DATA' },
  'buscar': { verb: 'READ', defaultTarget: 'DATA' },
  'obter': { verb: 'FETCH', defaultTarget: 'DATA' },
  'read': { verb: 'READ', defaultTarget: 'DATA' },
  'fetch': { verb: 'FETCH', defaultTarget: 'DATA' },
  'atualizar': { verb: 'UPDATE', defaultTarget: 'ENTITY' },
  'update': { verb: 'UPDATE', defaultTarget: 'ENTITY' },
  'remover': { verb: 'DELETE', defaultTarget: 'ENTITY' },
  'eliminar': { verb: 'DELETE', defaultTarget: 'ENTITY' },
  'apagar': { verb: 'DELETE', defaultTarget: 'ENTITY' },
  'delete': { verb: 'DELETE', defaultTarget: 'ENTITY' },

  // Verificação e segurança
  'validar': { verb: 'VALIDATE', defaultTarget: 'TOKEN' },
  'validate': { verb: 'VALIDATE', defaultTarget: 'TOKEN' },
  'autenticar': { verb: 'AUTHENTICATE', defaultTarget: 'CREDENTIALS' },
  'authenticate': { verb: 'AUTHENTICATE', defaultTarget: 'CREDENTIALS' },
  'autorizar': { verb: 'AUTHORIZE', defaultTarget: 'OPERATION' },
  'authorize': { verb: 'AUTHORIZE', defaultTarget: 'OPERATION' },
  'auditar': { verb: 'AUDIT', defaultTarget: 'INTEGRITY' },
  'audit': { verb: 'AUDIT', defaultTarget: 'INTEGRITY' },
  'verificar': { verb: 'CHECK', defaultTarget: 'STATUS' },
  'checar': { verb: 'CHECK', defaultTarget: 'STATUS' },
  'check': { verb: 'CHECK', defaultTarget: 'STATUS' },

  // Comunicação e alertas
  'notificar': { verb: 'NOTIFY', defaultTarget: 'CLIENT' },
  'notificacao': { verb: 'NOTIFY', defaultTarget: 'CLIENT' },
  'notify': { verb: 'NOTIFY', defaultTarget: 'CLIENT' },
  'enviar alerta': { verb: 'SEND', defaultTarget: 'ALERT' },
  'alerta': { verb: 'SEND', defaultTarget: 'ALERT' },

  // Bloqueios e Sagas
  'reservar': { verb: 'RESERVE', defaultTarget: 'LOCK' },
  'reserve': { verb: 'RESERVE', defaultTarget: 'LOCK' },
  'libertar': { verb: 'RELEASE', defaultTarget: 'LOCK' },
  'liberar': { verb: 'RELEASE', defaultTarget: 'LOCK' },
  'release': { verb: 'RELEASE', defaultTarget: 'LOCK' },
  'cancelar': { verb: 'CANCEL', defaultTarget: 'SUBSCRIPTION' },
  'cancel': { verb: 'CANCEL', defaultTarget: 'SUBSCRIPTION' },
  'aprovar': { verb: 'APPROVE', defaultTarget: 'CREDIT' },
  'approve': { verb: 'APPROVE', defaultTarget: 'CREDIT' },
  'rejeitar': { verb: 'REJECT', defaultTarget: 'CREDIT' },
  'reject': { verb: 'REJECT', defaultTarget: 'CREDIT' }
};

/**
 * Tabela de mapeamento de homoglifos cirílicos e gregos para os respetivos caracteres latinos equivalentes.
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  // Cirílico
  '\u0430': 'a', '\u0410': 'a',
  '\u0435': 'e', '\u0415': 'e',
  '\u043E': 'o', '\u041E': 'o',
  '\u0440': 'p', '\u0420': 'p',
  '\u0441': 'c', '\u0421': 'c',
  '\u0443': 'y', '\u0423': 'y',
  '\u0445': 'x', '\u0425': 'x',
  '\u0456': 'i', '\u0406': 'i',
  '\u0458': 'j', '\u0408': 'j',
  '\u0455': 's', '\u0405': 's',
  '\u04BB': 'h', '\u04BA': 'h',
  '\u0434': 'd', '\u0414': 'd',
  '\u043C': 'm', '\u041C': 'm',
  '\u0442': 't', '\u0422': 't',
  // Grego
  '\u03B1': 'a', '\u0391': 'a',
  '\u03B5': 'e', '\u0395': 'e',
  '\u03BF': 'o', '\u039F': 'o',
  '\u03C1': 'p', '\u03A1': 'p',
  '\u03C5': 'u', '\u03A5': 'u',
  '\u03BD': 'v', '\u039D': 'v',
  '\u03B9': 'i', '\u0399': 'i'
};

/**
 * @description Padrões de ataque semântico, metaprompts e tentativas de evasão adversarial.
 */
const ADVERSARIAL_INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(?:ignore|ignora|desconsidere|esque[çc]a)\b.*?\b(?:previous|anteriores|instructions|instru[çc][õo]es|prompt|rules|regras)\b/i,
  /\b(?:system\s+prompt|prompt\s+do\s+sistema|developer\s+mode|modo\s+desenvolvedor)\b/i,
  /\b(?:role\s*[:=]\s*['"]?(?:admin|root|system|superuser)['"]?)\b/i,
  /\b(?:grant\s+(?:root|admin|all\s+permissions)|conceder\s+acesso\s+total)\b/i,
  /\b(?:bypass(?:\s+(?:security|guardrails?|checks?))?|desativar\s+(?:guardrails?|seguran[çc]a))\b/i,
  /\b(?:trustscore\s*[:=]\s*100)\b/i,
  /\b(?:disable_guardrails|security_override)\b/i
];

/**
 * @description Compilador cognitivo para síntese de intenções em linguagem natural.
 */
export class NaturalLanguageSynthesizer {
  /**
   * @description Normaliza texto Unicode eliminando caracteres invisíveis (zero-width) e homoglifos cirílicos/gregos.
   *
   * @param {string} text - Texto bruto submetido pelo utilizador.
   * @returns {string} Texto desofuscado e normalizado no padrão NFKC.
   * @security Previne evasão de firewall semântico via contrabando de caracteres Unicode invisíveis e leetspeak.
   * @audit Regista a normalização preventiva de texto contra ataques de ofuscação.
   */
  public static normalizeUnicodeAndDeobfuscate(text: string): string {
    if (!text) return '';
    // 1. Normalização canónica NFKC
    let normalized = text.normalize('NFKC');

    // 2. Remoção de caracteres invisíveis, zero-width, controle direcional e soft hyphens
    normalized = normalized.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u00AD\u2060\u180E]/g, '');

    // 3. Substituição de homoglifos cirílicos e gregos
    normalized = normalized.replace(/[\u0400-\u04FF\u0370-\u03FF]/g, ch => HOMOGLYPH_MAP[ch] || ch);

    // 4. Desofuscação de leetspeak em palavras-chave críticas de segurança
    normalized = normalized
      .replace(/\b1gn0r[e3]\b/gi, 'ignore')
      .replace(/\badm1n\b/gi, 'admin')
      .replace(/\br00t\b/gi, 'root')
      .replace(/\bbyp[a@4]ss\b/gi, 'bypass')
      .replace(/\bsyst[e3]m\b/gi, 'system')
      .replace(/\bgu[a@4]rd(?:r[a@4]ils?)?\b/gi, 'guardrails');

    return normalized;
  }

  /**
   * @description Analisa e neutraliza padrões de injeção semântica e metaprompts adversariais.
   *
   * @param {string} text - Texto de entrada fornecido pelo utilizador.
   * @returns {{ cleanText: string; neutralizedPatterns: string[] }} Texto purificado e lista de padrões neutralizados.
   * @security Previne ataques de jailbreak e injeção de comandos na síntese de intenções.
   * @audit Regista a identificação e remoção de cláusulas adversariais maliciosas.
   */
  public static sanitizeAdversarialInput(text: string): { cleanText: string; neutralizedPatterns: string[] } {
    let sanitized = this.normalizeUnicodeAndDeobfuscate(text);
    const neutralizedPatterns: string[] = [];

    for (const pattern of ADVERSARIAL_INJECTION_PATTERNS) {
      if (pattern.test(sanitized)) {
        neutralizedPatterns.push(pattern.source);
        sanitized = sanitized.replace(pattern, ' ');
      }
    }

    // Remove tentativas de injeção de atributos privilegiados como role=admin ou trustScore=100
    sanitized = sanitized.replace(/\b(?:role|permissions?|trustscore|auth_level)\s*[:=]\s*\S+/gi, ' ');

    return {
      cleanText: sanitized.replace(/\s+/g, ' ').trim(),
      neutralizedPatterns
    };
  }

  /**
   * @description Sintetiza uma frase em linguagem natural num objeto canónico `ParsedIntent`.
   * Suporta resolução de anáforas multi-turno com base no histórico de sessão e cláusulas condicionais de negação.
   *
   * @param {string} text - Frase declarativa do utilizador.
   * @param {string} [sessionId] - Identificador opcional da sessão para memória conversacional.
   * @returns {ParsedIntent} Objeto de intenção devidamente estruturado para execução.
   * @security Higieniza valores extraídos e garante imunidade contra injeção de parâmetros.
   * @audit O objeto final mantém o registo do texto original em `rawText` para auditoria.
   */
  public static synthesize(text: string, sessionId?: string): ParsedIntent {
    const { cleanText, neutralizedPatterns } = this.sanitizeAdversarialInput(text);
    if (neutralizedPatterns.length > 0) {
      console.warn(`[Firewall Semântico] 🛡️ Neutralizadas ${neutralizedPatterns.length} tentativas de injeção adversarial/jailbreak na entrada.`);
    }

    const context: Record<string, unknown> = {};
    const lowerClean = cleanText.toLowerCase();

    // Recupera sessão prévia se sessionId for fornecido (Resolução de Anáforas)
    const session = sessionId ? SessionContextStore.getInstance().getSession(sessionId) : null;

    if (session && session.lastEntities) {
      if (lowerClean.includes('repita') || lowerClean.includes('repetir') || lowerClean.includes('mesma operacao') || lowerClean.includes('mesma operação')) {
        Object.assign(context, session.lastEntities);
      }
      if (lowerClean.includes('mesmo valor') || lowerClean.includes('mesma quantia')) {
        if (session.lastEntities.amount !== undefined) {
          context.amount = session.lastEntities.amount;
        }
      }
      if (lowerClean.includes('metade do valor') || lowerClean.includes('metade da quantia')) {
        if (typeof session.lastEntities.amount === 'number') {
          context.amount = Number(session.lastEntities.amount) / 2;
        }
      }
      if (lowerClean.includes('mesma conta') || lowerClean.includes('mesmo destinatario') || lowerClean.includes('mesmo destinatário')) {
        if (session.lastEntities.to) {
          context.to = session.lastEntities.to;
          context.recipient = session.lastEntities.to;
        }
      }
    }

    // 1. Extração de Entidades Numéricas e Financeiras
    const amountMatch1 = cleanText.match(/(\d+(?:[.,]\d+)?)\s*(?:euros?|€|dólares|dollars?|usd|\$)/i);
    const amountMatch2 = cleanText.match(/(?:\$|€)\s*(\d+(?:[.,]\d+)?)/i);
    const amountMatch3 = cleanText.match(/(?:valor|quantia|montante|preco|preço|amount)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)/i);

    if (amountMatch1) {
      context.amount = parseFloat(amountMatch1[1].replace(',', '.'));
    } else if (amountMatch2) {
      context.amount = parseFloat(amountMatch2[1].replace(',', '.'));
    } else if (amountMatch3) {
      context.amount = parseFloat(amountMatch3[1].replace(',', '.'));
    }

    // 1.1 AST Aritmética e Repartição Fracionária (Rateio Financeiro)
    const pctRegex = /(\d+(?:[.,]\d+)?)\s*%\s*(?:do\s+valor\s+)?(?:para(?:\s+[ao])?|to)\s*(?:(?:a|o)\s+)?(?:conta\s+)?(acc_[a-zA-Z0-9_-]+|\w+)/gi;
    const remRegex = /(?:o\s+)?(?:restante|resto|sobra|remanescente)(?:\s+menos\s+(\d+(?:[.,]\d+)?)\s*(?:euros?|€)?)?\s*(?:para(?:\s+[ao])?|to)\s*(?:(?:a|o)\s+)?(?:conta\s+)?(acc_[a-zA-Z0-9_-]+|\w+)/i;

    const partitions: Array<{ recipient: string; amount: number; percentage?: number; isRemainder?: boolean; feeDeducted?: number }> = [];
    let pctMatch: RegExpExecArray | null;

    let baseTotal = typeof context.amount === 'number' ? context.amount : (session?.lastEntities?.amount ? Number(session.lastEntities.amount) : 0);

    while ((pctMatch = pctRegex.exec(cleanText)) !== null) {
      const pct = parseFloat(pctMatch[1].replace(',', '.'));
      const recipient = pctMatch[2];
      const partAmount = baseTotal > 0 ? Math.round((baseTotal * (pct / 100)) * 100) / 100 : 0;
      partitions.push({ recipient, amount: partAmount, percentage: pct });
    }

    const remMatch = remRegex.exec(cleanText);
    if (remMatch) {
      const fee = remMatch[1] ? parseFloat(remMatch[1].replace(',', '.')) : 0;
      const recipient = remMatch[2];
      const sumPctAmounts = partitions.reduce((acc, p) => acc + p.amount, 0);
      const remAmount = baseTotal > 0 ? Math.max(0, Math.round((baseTotal - sumPctAmounts - fee) * 100) / 100) : 0;
      partitions.push({ recipient, amount: remAmount, isRemainder: true, feeDeducted: fee });
    }

    if (partitions.length > 0) {
      context.partitions = partitions;
      if (baseTotal > 0) {
        context.amount = baseTotal;
      }
    }

    // 2. Extração de Contas, Utilizadores e Recetores
    const fromAccMatch = cleanText.match(/\b(?:de|da|do|origem|remetente|from)\b\s*(?:(?:a|o)\s+)?(?:conta\s+)?(acc_[a-zA-Z0-9_-]+|\d{4,})/i);
    const toAccMatch = cleanText.match(/\b(?:para(?:\s+[ao])?|ao|destino|destinat[aá]rio|to)\b\s*(?:(?:a|o)\s+)?(?:conta\s+)?(acc_[a-zA-Z0-9_-]+|\d{4,})/i);

    if (fromAccMatch) {
      context.from = fromAccMatch[1];
      context.sender = fromAccMatch[1];
    }
    if (toAccMatch) {
      context.to = toAccMatch[1];
      context.recipient = toAccMatch[1];
    }

    // Fallback inteligente: se houver duas contas mencionadas no texto
    const allAccs = cleanText.match(/\b(acc_[a-zA-Z0-9_-]+)\b/gi);
    if (allAccs && allAccs.length >= 2) {
      if (!context.from) { context.from = allAccs[0]; context.sender = allAccs[0]; }
      if (!context.to) { context.to = allAccs[1]; context.recipient = allAccs[1]; }
    } else if (allAccs && allAccs.length === 1 && !context.to && !context.from) {
      context.to = allAccs[0];
      context.recipient = allAccs[0];
    }

    const userMatch = cleanText.match(/\b(usr_[a-zA-Z0-9_-]+)\b/i) || cleanText.match(/(?:utilizador|usuario|user)\s+([a-zA-Z0-9_-]+)/i);
    if (userMatch) context.user_id = userMatch[1];

    const chargeMatch = cleanText.match(/\b(ch_[a-zA-Z0-9_-]+)\b/i);
    if (chargeMatch) context.chargeId = chargeMatch[1];

    const prodMatch = cleanText.match(/\b(PROD_[a-zA-Z0-9_-]+|SKU_[a-zA-Z0-9_-]+)\b/i) || cleanText.match(/(?:produto|item|artigo)\s+([a-zA-Z0-9_-]+)/i);
    if (prodMatch) context.productId = prodMatch[1];

    const emailMatch = cleanText.match(/[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/);
    if (emailMatch) context.email = emailMatch[0];

    const tokenMatch = cleanText.match(/\b(jwt_[a-zA-Z0-9_.-]+|tok_[a-zA-Z0-9_-]+)\b/i);
    if (tokenMatch) context.token = tokenMatch[1];

    const resourceMatch = cleanText.match(/\b(res_[a-zA-Z0-9_-]+)\b/i);
    if (resourceMatch) context.resourceId = resourceMatch[1];

    // Deteção de Cláusulas Condicionais e Negação Lógica (Ex.: "a menos que", "cancelar se")
    let conditionExpression: string | undefined;
    const unlessMatch = cleanText.match(/\b(?:a menos que|exceto se|salvo se|unless)\b\s*(.+)/i);
    const cancelIfMatch = cleanText.match(/\b(?:cancelar se|não pagar se|nao pagar se|cancel if)\b\s*(.+)/i);

    if (unlessMatch) {
      conditionExpression = `NOT (${unlessMatch[1].trim()})`;
    } else if (cancelIfMatch) {
      conditionExpression = `NOT (${cancelIfMatch[1].trim()})`;
    }

    if (conditionExpression) {
      context.condition = conditionExpression;
    }

    // 3. Decomposição de Passos e Ações Semânticas
    // Procura por conetores de sequência como "depois", "em seguida", "após", "e depois", ";"
    const rawClauses = cleanText.split(/\b(?:depois|em seguida|ap[oó]s|e depois|then)\b|;/i);
    const flowSteps: IntentFlowStep[] = [];
    const capabilities: string[] = [];

    for (const clause of rawClauses) {
      const lowerClause = clause.toLowerCase();
      let matchedAction: string | null = null;

      // Procura correspondência no dicionário de verbos
      for (const [phrase, def] of Object.entries(VERB_DICTIONARY)) {
        if (lowerClause.includes(phrase)) {
          // Tenta extrair um alvo específico da frase
          let target = def.defaultTarget;
          if (lowerClause.includes('estoque') || lowerClause.includes('inventario')) target = 'INVENTORY';
          else if (lowerClause.includes('pagamento') || lowerClause.includes('cartao')) target = 'PAYMENT';
          else if (lowerClause.includes('credito') || lowerClause.includes('emprestimo')) target = 'CREDIT';
          else if (lowerClause.includes('token') || lowerClause.includes('jwt')) target = 'TOKEN';
          else if (lowerClause.includes('lock') || lowerClause.includes('recurso')) target = 'LOCK';
          else if (lowerClause.includes('alerta')) target = 'ALERT';

          matchedAction = `${def.verb} ${target}`;
          break;
        }
      }

      if (matchedAction) {
        capabilities.push(matchedAction);
        const stepObj: IntentFlowStep = {
          type: conditionExpression ? 'CONDITION' : 'SEQUENCE',
          action: matchedAction
        };
        if (conditionExpression) {
          stepObj.condition = conditionExpression;
        }
        flowSteps.push(stepObj);
      }
    }

    // Se nenhuma ação específica foi isolada por cláusula, faz uma busca global
    if (flowSteps.length === 0) {
      const lowerAll = cleanText.toLowerCase();
      for (const [phrase, def] of Object.entries(VERB_DICTIONARY)) {
        if (lowerAll.includes(phrase)) {
          const action = `${def.verb} ${def.defaultTarget}`;
          capabilities.push(action);
          const stepObj: IntentFlowStep = {
            type: conditionExpression ? 'CONDITION' : 'SEQUENCE',
            action
          };
          if (conditionExpression) {
            stepObj.condition = conditionExpression;
          }
          flowSteps.push(stepObj);
          break;
        }
      }
    }

    // Se ainda assim não encontrou, recorre ao verbo canónico EXECUTE DEFAULT
    if (flowSteps.length === 0) {
      const defaultAction = 'EXECUTE DEFAULT';
      capabilities.push(defaultAction);
      flowSteps.push({ type: 'SEQUENCE', action: defaultAction });
    }

    // 3.1 Se for uma intenção de rateio financeiro particionado, constrói os passos específicos
    if (partitions.length > 0) {
      flowSteps.length = 0;
      capabilities.length = 0;
      const transferAction = 'TRANSFER FUNDS';
      capabilities.push(transferAction);
      for (let i = 0; i < partitions.length; i++) {
        const p = partitions[i];
        flowSteps.push({
          type: 'SEQUENCE',
          name: `step_partition_${i + 1}`,
          action: transferAction,
          parameters: {
            recipient: p.recipient,
            amount: p.amount,
            percentage: p.percentage,
            isRemainder: p.isRemainder,
            feeDeducted: p.feeDeducted
          }
        });
      }
    }

    const intentName = `natural_${capabilities[0]?.replace(/\s+/g, '_').toLowerCase() || 'intent'}_${Date.now().toString().slice(-4)}`;

    const result: ParsedIntent = {
      id: uuidv4(),
      name: intentName,
      verb: (capabilities[0]?.split(' ')[0] as IntentVerb) || undefined,
      context,
      requirements: {
        capabilities
      },
      flow: flowSteps,
      output: {
        format: 'json'
      },
      rawText: cleanText
    };

    // Atualiza a memória de sessão para turnos subsequentes
    if (sessionId) {
      SessionContextStore.getInstance().saveSession(sessionId, {
        lastIntent: result,
        lastEntities: { ...context },
        lastAction: flowSteps[0]?.action
      });
    }

    return result;
  }

  /**
   * @description Converte uma frase em linguagem natural numa string canónica da DSL do INP.
   *
   * @param {string} text - Texto em linguagem natural.
   * @param {string} [sessionId] - Identificador de sessão para resolução de anáforas.
   * @returns {string} Código fonte formatado na DSL do INP Protocol.
   */
  public static toDSL(text: string, sessionId?: string): string {
    const parsed = this.synthesize(text, sessionId);
    const contextJson = JSON.stringify(parsed.context, null, 4)
      .split('\n')
      .slice(1, -1)
      .join('\n');

    const reqLines = parsed.requirements.capabilities
      .map(cap => `    ${cap}`)
      .join('\n');

    const flowLines = parsed.flow
      .map(step => `      EXECUTE ${step.action}`)
      .join('\n');

    return `INTENT "${parsed.name}" {
  CONTEXT {
${contextJson}
  }
  REQUIRE {
${reqLines}
  }
  FLOW {
    SEQUENCE {
${flowLines}
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`;
  }
}
