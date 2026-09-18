/**
 * @fileoverview Adaptador Semântico Zero-Shot e Auto-Mapeamento de Contexto (SemanticAdapter)
 * @module Core/SemanticAdapter
 * @description
 * Módulo cognitivo preditivo de inteligência artificial soberana que analisa cargas úteis
 * e esquemas JSON contratuais em tempo de execução. Em vez de aguardar a ocorrência de falhas
 * contratuais para acionar autocura reativa, o SemanticAdapter antecipa e reconcilia impedâncias
 * sintáticas e ontológicas entre microsserviços heterogéneos através de:
 * 1. Métricas de distância semântica combinadas (Jaro-Winkler e Levenshtein Normalizado).
 * 2. Tesauro ontológico de domínio bancário, transacional e corporativo.
 * 3. Auto-cablagem (*Context Auto-Wiring*) entre a saída de um passo e a entrada do passo seguinte.
 *
 * @security Aplica salvaguardas estritas de integridade: campos sensíveis e financeiros
 * (como montantes e credenciais) só podem ser mapeados se o valor escalar correspondente existir
 * no contexto de origem, impedindo rigorosamente qualquer fabricação de valores ou adulteração patrimonial.
 * @audit Todos os mapeamentos semânticos automáticos geram registos forenses com pontuação de confiança
 * e justificação auditável para posterior rastreabilidade em relatórios regulamentares.
 */

import { DeepGuardrails } from './native-cognitive-engine';

/**
 * @description Estrutura de auditoria que regista um mapeamento semântico individual aplicado.
 */
export interface SemanticMapping {
  /** Nome da chave original de origem */
  sourceKey: string;
  /** Nome da chave de destino esperada pelo esquema */
  targetKey: string;
  /** Pontuação de similaridade ou confiança do mapeamento (0 a 100) */
  confidence: number;
  /** Justificação técnica do mapeamento (ex.: "ONTOLOGY_SYNONYM", "JARO_WINKLER_MATCH") */
  reason: string;
}

/**
 * @description Resultado consolidado da adaptação semântica de uma carga útil.
 */
export interface SemanticAdaptResult {
  /** Carga útil ajustada com as propriedades necessárias mapeadas */
  adaptedContext: Record<string, unknown>;
  /** Lista detalhada de todos os mapeamentos inferidos e aplicados */
  mappingsApplied: SemanticMapping[];
  /** Alertas de segurança ou ambiguidades identificadas durante a adaptação */
  warnings?: string[];
}

/**
 * @description Grupos ontológicos de sinonímia semântica utilizados na resolução de esquemas.
 */
const ONTOLOGY_GROUPS: readonly (readonly string[])[] = [
  // Identificadores de clientes e utilizadores (Multilíngue: PT, EN, DE, FR, ES, IT)
  ['userid', 'user_id', 'id_utilizador', 'cliente', 'cliente_id', 'clienteid', 'usuario', 'user', 'customer', 'customerid', 'customer_id', 'accountid', 'account_id', 'account', 'applicantid', 'applicant_id', 'kundennummer', 'kunden_id', 'benutzer', 'benutzer_id', 'client_id', 'compte_id', 'codice_utente', 'identifiant', 'conta', 'conta_id', 'contaid', 'konto', 'konto_id', 'compte'],
  // Valores financeiros e montantes (Multilíngue: PT, EN, DE, FR, ES, IT)
  ['amount', 'amount_eur', 'amounteur', 'valor', 'valor_total', 'valortotal', 'quantia', 'preco', 'price', 'total', 'montante', 'custo', 'cost', 'fee', 'taxa', 'rechnungsbetrag', 'betrag', 'gesamtbetrag', 'preis', 'montant', 'prix', 'importo', 'prezzo', 'saldo', 'importe', 'monto'],
  // Moedas e unidades cambiais
  ['currency', 'moeda', 'curr', 'coin', 'divisa', 'waehrung', 'devise', 'valuta'],
  // Destinatários e recetores
  ['recipient', 'destinatario', 'destino', 'destination', 'target', 'receiver', 'to', 'target_account', 'targetaccount', 'destination_account', 'destinationaccount', 'empfaenger', 'destinataire', 'destinatario_conto', 'beneficiario', 'beneficiary', 'zielkonto'],
  // Remetentes e origens
  ['sender', 'remetente', 'remitente', 'origem', 'origin', 'from', 'source', 'source_account', 'sourceaccount', 'absender', 'expediteur', 'mittente', 'ordinante', 'herkunftskonto', 'absenderkonto'],
  // Faturas, recibos, números de fatura e referências de transação (Multilíngue)
  ['invoice', 'invoicenumber', 'invoice_number', 'rechnungsnummer', 'rechnung', 'nummer', 'number', 'fatura', 'faturanumero', 'fatura_numero', 'factura', 'facture', 'bonifico', 'transactionreference', 'transaction_reference', 'orderid', 'order_id', 'referencenumber', 'reference_number', 'reference'],
  // Estados e situações
  ['status', 'estado', 'state', 'situacao', 'phase', 'zustand', 'etat', 'stato'],
  // Comunicação e contactos
  ['email', 'mail', 'correio', 'electronic_mail', 'eletronic_mail', 'email_address', 'mail_address'],
  // Quantidades e contadores
  ['quantity', 'quantidade', 'qty', 'count', 'total_items', 'totalitems', 'quota', 'remaining', 'menge', 'anzahl', 'quantite'],
  // Tokens e identificadores de pagamento
  ['card_token', 'cardtoken', 'token', 'token_pagamento', 'payment_token', 'jwt_token', 'auth_token', 'token_autorizacao'],
  // Datas, horas e carimbos temporais (Multilíngue: PT, EN, DE, FR, ES, IT)
  ['timestamp', 'time', 'date', 'datetime', 'date_time', 'created_at', 'createdat', 'creation_date', 'data', 'data_criacao', 'hora', 'tempo', 'zeitstempel', 'datum', 'zeit', 'horodatage', 'fecha', 'data_ora']
];

/** Termos que denotam polaridade de remetente ou origem */
const ORIGIN_POLARITY_TERMS: readonly string[] = [
  'origem', 'remetente', 'remitente', 'from', 'source', 'sender', 'de', 'da', 'do', 'absender', 'absenderkonto', 'expediteur', 'mittente', 'herkunft', 'herkunftskonto', 'quelle'
];

/** Termos que denotam polaridade de destinatário ou destino */
const DESTINATION_POLARITY_TERMS: readonly string[] = [
  'destino', 'destinatario', 'destination', 'to', 'target', 'recipient', 'para', 'ao', 'empfaenger', 'empfaengerkonto', 'destinataire', 'beneficiario', 'beneficiary', 'ziel', 'zielkonto'
];

/**
 * Índice estático invertido pré-computado de conceitos ontológicos: termo normalizado -> lista de IDs de grupo.
 */
const ONTOLOGY_CONCEPT_INDEX = new Map<string, number[]>();

/**
 * Grupos ontológicos pré-normalizados na inicialização para eliminação de alocações em loop.
 */
const NORMALIZED_ONTOLOGY_GROUPS: string[][] = [];

ONTOLOGY_GROUPS.forEach((group, groupIdx) => {
  const normGroup: string[] = [];
  for (const term of group) {
    const clean = term.replace(/[_-]/g, '').toLowerCase();
    normGroup.push(clean);
    const existing = ONTOLOGY_CONCEPT_INDEX.get(clean) || [];
    existing.push(groupIdx);
    ONTOLOGY_CONCEPT_INDEX.set(clean, existing);
  }
  NORMALIZED_ONTOLOGY_GROUPS.push(normGroup);
});

/**
 * @description Motor cognitivo para adaptação e tradução de dados sem quebra de contrato.
 */
export class SemanticAdapter {
  /**
   * @description Calcula a similaridade Jaro-Winkler entre duas cadeias de caracteres.
   *
   * @param {string} s1 - Primeira cadeia.
   * @param {string} s2 - Segunda cadeia.
   * @returns {number} Coeficiente de similaridade entre 0.0 (sem afinidade) e 1.0 (idênticas).
   * @security Algoritmo puramente matemático e sem efeitos colaterais.
   * @audit Utilizado para fundamentar a pontuação de confiança de cada mapeamento inferido.
   */
  public static calculateJaroWinkler(s1: string, s2: string): number {
    const a = s1.toLowerCase().trim();
    const b = s2.toLowerCase().trim();

    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;

    const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
    const aMatches = new Array(a.length).fill(false);
    const bMatches = new Array(b.length).fill(false);

    let matches = 0;
    for (let i = 0; i < a.length; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, b.length);

      for (let j = start; j < end; j++) {
        if (!bMatches[j] && a[i] === b[j]) {
          aMatches[i] = true;
          bMatches[j] = true;
          matches++;
          break;
        }
      }
    }

    if (matches === 0) return 0.0;

    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < a.length; i++) {
      if (aMatches[i]) {
        while (!bMatches[k]) k++;
        if (a[i] !== b[k]) transpositions++;
        k++;
      }
    }

    const jaro = (
      matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches
    ) / 3.0;

    // Prefixo comum até 4 caracteres (fator de escala Winkler standard = 0.1)
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(a.length, b.length)); i++) {
      if (a[i] === b[i]) prefix++;
      else break;
    }

    return jaro + prefix * 0.1 * (1.0 - jaro);
  }

  /**
   * @description Calcula a distância de Levenshtein normalizada entre duas cadeias usando Programação Dinâmica Two-Row O(N).
   *
   * @param {string} s1 - Primeira cadeia.
   * @param {string} s2 - Segunda cadeia.
   * @returns {number} Proximidade normalizada de 0.0 a 1.0.
   */
  public static calculateLevenshteinSimilarity(s1: string, s2: string): number {
    const a = s1.toLowerCase().trim();
    const b = s2.toLowerCase().trim();

    if (a === b) return 1.0;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;

    // Algoritmo Two-Row DP: consome apenas 2 vetores de tamanho min(N, M) + 1 em vez de matriz completa
    const minStr = a.length <= b.length ? a : b;
    const maxStr = a.length <= b.length ? b : a;

    let prevRow = new Array(minStr.length + 1);
    let currRow = new Array(minStr.length + 1);

    for (let j = 0; j <= minStr.length; j++) {
      prevRow[j] = j;
    }

    for (let i = 1; i <= maxStr.length; i++) {
      currRow[0] = i;
      const maxChar = maxStr.charAt(i - 1);

      for (let j = 1; j <= minStr.length; j++) {
        const cost = maxChar === minStr.charAt(j - 1) ? 0 : 1;
        currRow[j] = Math.min(
          currRow[j - 1] + 1,       // Inserção
          prevRow[j] + 1,           // Eliminação
          prevRow[j - 1] + cost     // Substituição
        );
      }

      const temp = prevRow;
      prevRow = currRow;
      currRow = temp;
    }

    const distance = prevRow[minStr.length];
    return Math.max(0, 1.0 - distance / maxLen);
  }

  /**
   * @description Determina a polaridade semântica de uma chave (ORIGIN, DESTINATION ou NEUTRAL).
   *
   * @param {string} key - Nome da chave a inspecionar.
   * @returns {'ORIGIN' | 'DESTINATION' | 'NEUTRAL'} Polaridade identificada.
   */
  public static getPolarity(key: string): 'ORIGIN' | 'DESTINATION' | 'NEUTRAL' {
    const clean = key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    const tokens = clean.split(/[_\-\s]+/);
    const subwords = this.decomposeCompoundWord(key);
    const allTokens = [...new Set([...tokens, ...subwords])];

    for (const token of allTokens) {
      if (ORIGIN_POLARITY_TERMS.includes(token)) return 'ORIGIN';
      if (DESTINATION_POLARITY_TERMS.includes(token)) return 'DESTINATION';
    }

    // Substring fallback para compostos aglutinados
    for (const token of tokens) {
      for (const originTerm of ORIGIN_POLARITY_TERMS) {
        if (token.includes(originTerm)) return 'ORIGIN';
      }
      for (const destTerm of DESTINATION_POLARITY_TERMS) {
        if (token.includes(destTerm)) return 'DESTINATION';
      }
    }

    return 'NEUTRAL';
  }

  /** Cache LRU de raízes morfológicas decompostas por BPE */
  private static readonly bpeCache = new Map<string, string[]>();
  private static readonly MAX_BPE_CACHE = 2000;

  /**
   * @description Decompõe termos compostos e aglutinados em morfemas/sub-palavras com aceleração por cache.
   *
   * @param {string} word - Termo composto a analisar.
   * @returns {string[]} Lista de raízes morfológicas identificadas.
   */
  public static decomposeCompoundWord(word: string): string[] {
    const cached = this.bpeCache.get(word);
    if (cached) return cached;

    const matched: Array<{ root: string; pos: number }> = [];
    const lower = word.toLowerCase().replace(/[_-]/g, '');
    const knownRoots = [
      'rechnung', 'betrag', 'gesamt', 'preis', 'kunde', 'nummer', 'benutzer',
      'konto', 'empfaenger', 'absender', 'wert', 'steuer', 'zahl', 'auftrag',
      'ziel', 'quelle', 'herkunft'
    ];
    for (const root of knownRoots) {
      const pos = lower.indexOf(root);
      if (pos !== -1) {
        matched.push({ root, pos });
      }
    }
    matched.sort((a, b) => a.pos - b.pos);
    const result = matched.map(m => m.root);

    if (this.bpeCache.size >= this.MAX_BPE_CACHE) {
      const oldest = this.bpeCache.keys().next().value;
      if (oldest) this.bpeCache.delete(oldest);
    }
    this.bpeCache.set(word, result);
    return result;
  }

  /**
   * @description Verifica se duas chaves pertencem ao mesmo grupo de sinonímia ontológica via índice O(1).
   *
   * @param {string} key1 - Chave A.
   * @param {string} key2 - Chave B.
   * @returns {boolean} Verdadeiro se forem conceitos análogos mapeados no tesauro.
   */
  public static areOntologicallyEquivalent(key1: string, key2: string): boolean {
    const clean1 = key1.replace(/[_-]/g, '').toLowerCase();
    const clean2 = key2.replace(/[_-]/g, '').toLowerCase();

    if (clean1 === clean2) return true;

    // 1. Resolução ultrarrápida O(1) no índice invertido pré-computado
    const concepts1 = ONTOLOGY_CONCEPT_INDEX.get(clean1);
    const concepts2 = ONTOLOGY_CONCEPT_INDEX.get(clean2);

    if (concepts1 && concepts2) {
      for (const c1 of concepts1) {
        if (concepts2.includes(c1)) return true;
      }
    }

    // 2. Correspondência por tokens de camelCase / snake_case e raízes BPE
    const tokens1 = key1.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[_\-\s]+/);
    const tokens2 = key2.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[_\-\s]+/);
    const subwords1 = this.decomposeCompoundWord(key1);
    const subwords2 = this.decomposeCompoundWord(key2);

    for (let groupIdx = 0; groupIdx < NORMALIZED_ONTOLOGY_GROUPS.length; groupIdx++) {
      const normalizedGroup = NORMALIZED_ONTOLOGY_GROUPS[groupIdx];

      const token1Matches = tokens1.some(t => normalizedGroup.includes(t)) || (concepts1 && concepts1.includes(groupIdx));
      const token2Matches = tokens2.some(t => normalizedGroup.includes(t)) || (concepts2 && concepts2.includes(groupIdx));
      if (token1Matches && token2Matches) {
        return true;
      }

      const sw1Matches = subwords1.some(sw => normalizedGroup.includes(sw));
      const sw2Matches = subwords2.some(sw => normalizedGroup.includes(sw));

      if (sw1Matches && (normalizedGroup.includes(clean2) || sw2Matches || tokens2.some(t => normalizedGroup.includes(t)))) {
        return true;
      }
      if (sw2Matches && (normalizedGroup.includes(clean1) || sw1Matches || tokens1.some(t => normalizedGroup.includes(t)))) {
        return true;
      }
    }

    return false;
  }

  /**
   * @description Adapta preventivamente o contexto para satisfazer o esquema JSON contratual.
   *
   * @param {Record<string, unknown>} context - Carga útil fornecida ao motor.
   * @param {Record<string, unknown>} schema - Esquema JSON Schema exigido pela capacidade.
   * @param {string} [capabilityKey=''] - Nome da capacidade para registo de auditoria.
   * @returns {SemanticAdaptResult} Contexto adaptado e registo de mapeamentos.
   * @security Bloqueia mapeamentos em caso de ambiguidade polar e não permite mutações monetárias arbitrárias.
   * @audit Gera auditoria explícita para cada propriedade mapeada ou rejeitada por ambiguidade.
   */
  public static adapt(
    context: Record<string, unknown>,
    schema: Record<string, unknown>,
    capabilityKey = ''
  ): SemanticAdaptResult {
    if (!schema || typeof schema !== 'object' || !schema.properties) {
      return { adaptedContext: context, mappingsApplied: [] };
    }

    const adapted: Record<string, unknown> = { ...context };
    const mappingsApplied: SemanticMapping[] = [];
    const warnings: string[] = [];
    const schemaProps = (schema.properties || {}) as Record<string, any>;

    const existingKeys = Object.keys(context);

    for (const targetProp of Object.keys(schemaProps)) {
      // Se a propriedade já está presente e preenchida, não é necessário intervir
      if (adapted[targetProp] !== undefined && adapted[targetProp] !== null) {
        continue;
      }

      const targetPolarity = this.getPolarity(targetProp);
      const candidates: Array<{ key: string; score: number; reason: string; polarity: 'ORIGIN' | 'DESTINATION' | 'NEUTRAL' }> = [];

      // 1. Pesquisa direta por sinonímia ontológica no tesauro
      for (const srcKey of existingKeys) {
        if (this.areOntologicallyEquivalent(srcKey, targetProp)) {
          let score = 1.0;
          const sTokens = srcKey.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[_\-\s]+/);
          const tTokens = targetProp.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[_\-\s]+/);
          const sSub = this.decomposeCompoundWord(srcKey);
          const tSub = this.decomposeCompoundWord(targetProp);
          const allS = [...new Set([...sTokens, ...sSub])];
          const allT = [...new Set([...tTokens, ...tSub])];

          for (const s of allS) {
            if (allT.includes(s)) score += 0.2;
          }
          if (allS.includes('betrag') && allT.includes('number')) score -= 0.5;
          if (allS.includes('nummer') && allT.includes('number')) score += 0.5;

          const candPol = this.getPolarity(srcKey);
          if (targetPolarity !== 'NEUTRAL' && candPol === targetPolarity) {
            score += 0.8;
          }

          candidates.push({
            key: srcKey,
            score,
            reason: 'ONTOLOGY_EQUIVALENCE',
            polarity: candPol
          });
        }
      }

      // 2. Pesquisa difusa via Jaro-Winkler e Levenshtein se não encontrar na ontologia
      if (candidates.length === 0) {
        for (const srcKey of existingKeys) {
          const jaro = this.calculateJaroWinkler(srcKey, targetProp);
          const lev = this.calculateLevenshteinSimilarity(srcKey, targetProp);
          let composite = jaro * 0.6 + lev * 0.4;

          const srcTokens = srcKey.toLowerCase().split(/[_\-\s]+/);
          const tgtTokens = targetProp.toLowerCase().split(/[_\-\s]+/);
          for (const sTok of srcTokens) {
            for (const tTok of tgtTokens) {
              const tokenJaro = this.calculateJaroWinkler(sTok, tTok);
              if (tokenJaro > 0.85) {
                composite = Math.max(composite, tokenJaro);
              }
            }
          }

          const candPol = this.getPolarity(srcKey);
          if (targetPolarity !== 'NEUTRAL' && candPol === targetPolarity) {
            composite += 0.2;
          }

          if (composite >= 0.70) {
            candidates.push({
              key: srcKey,
              score: composite,
              reason: `FUZZY_STRING_SIMILARITY (${(composite * 100).toFixed(1)}%)`,
              polarity: candPol
            });
          }
        }
      }

      // 3. Filtro de Polaridade e Detetor de Ambiguidade de Segurança
      let filteredCandidates = candidates;
      if (targetPolarity !== 'NEUTRAL') {
        filteredCandidates = candidates.filter(c => c.polarity === targetPolarity || c.polarity === 'NEUTRAL');
      } else {
        // Se o alvo for neutro (ex: accountId), mas houver múltiplos candidatos com polaridades opostas (ORIGIN vs DESTINATION)
        const originCand = candidates.find(c => c.polarity === 'ORIGIN');
        const destCand = candidates.find(c => c.polarity === 'DESTINATION');
        if (originCand && destCand) {
          const warningMsg = `Ambiguidade de Polaridade Detectada para "${targetProp}": múltiplos candidatos conflitantes ("${originCand.key}" vs "${destCand.key}"). Mapeamento recusado por segurança bancária.`;
          warnings.push(warningMsg);
          console.warn(`[Semantic Adapter] ⚠️ ${warningMsg}`);
          continue; // Pula este campo para não arriscar inverter contas!
        }
      }

      if (filteredCandidates.length === 0) continue;

      filteredCandidates.sort((a, b) => b.score - a.score);
      const best = filteredCandidates[0];

      // 4. Aplicação do mapeamento inferido com salvaguarda de segurança
      if (best && adapted[best.key] !== undefined) {
        let valueToTransfer = adapted[best.key];
        const targetPropDef = schemaProps[targetProp] || {};
        let dimensionalReason = best.reason;

        // Reconciliação Dimensional 1: Centavos vs Moeda Decimal
        const isTargetCents = targetProp.toLowerCase().includes('cent') || targetProp.toLowerCase().includes('cents') || targetProp.toLowerCase().includes('centavos') || (targetPropDef.type === 'integer' && targetProp.toLowerCase().includes('amount'));
        const isSourceCents = best.key.toLowerCase().includes('cent') || best.key.toLowerCase().includes('cents') || best.key.toLowerCase().includes('centavos');

        if (isTargetCents && !isSourceCents && typeof valueToTransfer === 'number') {
          valueToTransfer = Math.round(valueToTransfer * 100);
          dimensionalReason += ' [RECONCILIAÇÃO DIMENSIONAL: Moeda Decimal -> Centavos Inteiros (*100)]';
        } else if (!isTargetCents && isSourceCents && typeof valueToTransfer === 'number') {
          valueToTransfer = valueToTransfer / 100;
          dimensionalReason += ' [RECONCILIAÇÃO DIMENSIONAL: Centavos Inteiros -> Moeda Decimal (/100)]';
        }

        // Reconciliação Dimensional 2: Temporal (Unix Epoch vs ISO-8601 String)
        const isTargetIsoDate = targetPropDef.format === 'date-time' || (targetPropDef.type === 'string' && (targetProp.toLowerCase().includes('date') || targetProp.toLowerCase().includes('time') || targetProp.toLowerCase().includes('at')));
        const isTargetEpoch = (targetPropDef.type === 'integer' || targetPropDef.type === 'number') && (targetProp.toLowerCase().includes('timestamp') || targetProp.toLowerCase().includes('epoch'));

        if (isTargetIsoDate && typeof valueToTransfer === 'number') {
          const ms = valueToTransfer < 10000000000 ? valueToTransfer * 1000 : valueToTransfer;
          valueToTransfer = new Date(ms).toISOString();
          dimensionalReason += ' [RECONCILIAÇÃO TEMPORAL: Unix Epoch -> ISO-8601 String]';
        } else if (isTargetEpoch && typeof valueToTransfer === 'string') {
          const parsed = Date.parse(valueToTransfer);
          if (!isNaN(parsed)) {
            valueToTransfer = targetProp.toLowerCase().includes('sec') ? Math.floor(parsed / 1000) : parsed;
            dimensionalReason += ' [RECONCILIAÇÃO TEMPORAL: ISO-8601 String -> Unix Epoch Integer]';
          }
        }

        // Guardrail: se for campo sensível, valida que o valor existe fielmente na origem
        const guardrail = DeepGuardrails.verify(context, { ...context, [targetProp]: valueToTransfer });
        if (guardrail.passed) {
          adapted[targetProp] = valueToTransfer;
          mappingsApplied.push({
            sourceKey: best.key,
            targetKey: targetProp,
            confidence: Math.round(best.score * 100),
            reason: dimensionalReason
          });
        }
      }
    }

    return { adaptedContext: adapted, mappingsApplied, warnings };
  }

  /**
   * @description Mapeia a carga útil aplicando adaptação ontológica e devolvendo estrutura com avisos de ambiguidade.
   *
   * @param {Record<string, unknown>} context - Carga útil fornecida ao motor.
   * @param {Record<string, unknown>} schema - Esquema contratual esperado.
   * @param {string} [capabilityKey=''] - Nome da capacidade para auditoria.
   * @returns {{ mappedPayload: Record<string, unknown>; warnings: string[]; unmappedFields: string[] }} Resultado detalhado.
   * @security Bloqueia mapeamentos em caso de ambiguidade polar e protege campos sensíveis.
   * @audit Regista a resolução completa de mapeamento ontológico.
   */
  public static mapPayload(
    context: Record<string, unknown>,
    schema: Record<string, unknown>,
    capabilityKey = ''
  ): { mappedPayload: Record<string, unknown>; warnings: string[]; unmappedFields: string[] } {
    const res = this.adapt(context, schema, capabilityKey);
    const schemaProps = (schema.properties || {}) as Record<string, any>;
    const unmappedFields = Object.keys(schemaProps).filter(k => res.adaptedContext[k] === undefined);
    return {
      mappedPayload: res.adaptedContext,
      warnings: res.warnings || [],
      unmappedFields
    };
  }

  /**
   * @description Realiza auto-cablagem direta entre o resultado de um passo de origem e os requisitos do próximo passo.
   *
   * @param {Record<string, unknown>} sourceOutput - Resultado devolvido pelo passo antecedente.
   * @param {Record<string, unknown>} targetSchema - Esquema de entrada do passo subsequente.
   * @returns {Record<string, unknown>} Carga útil cabeada pronta para o próximo passo.
   */
  public static autoWire(
    sourceOutput: Record<string, unknown>,
    targetSchema: Record<string, unknown>
  ): Record<string, unknown> {
    const result = this.adapt(sourceOutput, targetSchema, 'AUTO_WIRE_PIPELINE');
    return result.adaptedContext;
  }
}
