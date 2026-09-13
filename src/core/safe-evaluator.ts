/**
 * @fileoverview Avaliador Seguro de Expressões Lógicas e Aritméticas (AST sem eval)
 * @module Core/SafeEvaluator
 * @description
 * Analisa e avalia expressões booleanas, relacionais e aritméticas em passos de fluxo
 * condicionais (`CONDITION`), operando sobre o objeto de contexto sem recorrer a `eval()`
 * ou `new Function()`. Implementa um analisador léxico (tokenizador) e um analisador
 * sintático de descida recursiva (Recursive Descent Parser) com limites de profundidade
 * e contagem de símbolos para prevenir ataques de negação de serviço (DoS).
 *
 * @security Bloqueia injeções de código arbitrário ao evitar completamente a execução dinâmica de JavaScript.
 * Impõe controlos rígidos contra poluição de protótipo (`__proto__`, `constructor`, `prototype`),
 * limita o tamanho da expressão (500 carateres) e a profundidade de recursão (máximo 25 níveis).
 * @audit Permite auditar com precisão determinística os critérios de ramificação do fluxo de orquestração.
 */

export class SafeEvaluator {
  /**
   * @description Avalia com segurança uma cadeia condicional confrontando-a com os dados do contexto.
   *
   * @param {string} condition - Expressão lógica em formato textual (ex.: "context.amount > 100 && context.vip == true").
   * @param {any} context - Objeto contendo as variáveis contextuais referenciadas na expressão.
   * @returns {boolean} Devolve verdadeiro (true) se a condição for satisfeita, caso contrário falso (false).
   * @security Valida limites de comprimento (<= 500 carateres) e quantidade de tokens (<= 100) para evitar DoS.
   * @audit Regista em log falhas sintáticas ou tentativas de ultrapassagem de limites operacionais.
   */
  static evaluate(condition: string, context: any): boolean {
    if (!condition || typeof condition !== 'string') return false;

    // Salvaguarda contra expressões desmesuradas (potencial tentativa de DoS)
    if (condition.length > 500) {
      console.error('[SafeEvaluator] A condição excede o limite máximo permitido (500 carateres).');
      return false;
    }

    try {
      const tokens = this.tokenize(condition);
      if (tokens.length === 0) return false;
      if (tokens.length > 100) {
        console.error('[SafeEvaluator] O número de tokens excede o limite de segurança (100 tokens).');
        return false;
      }
      const parser = new Parser(tokens, context);
      return !!parser.parseExpression();
    } catch (err: any) {
      console.error('[SafeEvaluator] Erro na análise sintática da expressão:', err.message);
      return false;
    }
  }

  /**
   * @description Decompõe a cadeia condicional numa sequência atómica de tokens (operadores, literais e variáveis).
   *
   * @param {string} str - A expressão condicional bruta.
   * @returns {string[]} Vetor de tokens identificados.
   */
  private static tokenize(str: string): string[] {
    const regex = /(".*?"|'.*?'|===|==|!==|!=|>=|<=|&&|\|\||[+\-*\/()!><]|[a-zA-Z_][a-zA-Z0-9_.*[\]'"]*|-?\d+(?:\.\d+)?)/g;
    const tokens: string[] = [];
    let match;
    while ((match = regex.exec(str)) !== null) {
      const token = match[0].trim();
      if (token) {
        tokens.push(token);
      }
    }
    return tokens;
  }
}

/**
 * @description Analisador Sintático de Descida Recursiva para avaliação segura de expressões lógicas e matemáticas.
 */
class Parser {
  /** Índice do token atualmente em análise */
  private index = 0;
  /** Contador da profundidade de recursão corrente */
  private depth = 0;
  /** Limite máximo de aninhamento de parênteses/subexpressões para prevenir estouro de pilha (Stack Overflow) */
  private static MAX_DEPTH = 25;

  /**
   * @param {string[]} tokens - Lista de símbolos lexicais a processar.
   * @param {any} context - Dicionário de contexto para resolução de identificadores.
   */
  constructor(private tokens: string[], private context: any) {}

  /**
   * Consulta o próximo token sem avançar o cursor.
   */
  private peek(): string | undefined {
    return this.tokens[this.index];
  }

  /**
   * Consome e devolve o token corrente, avançando o cursor.
   */
  private next(): string | undefined {
    return this.tokens[this.index++];
  }

  /**
   * @description Analisa operadores lógicos disjuntivos (OR / ||) com menor precedência.
   * @returns {any} Resultado da avaliação da subexpressão.
   * @throws {Error} Se o limite de profundidade de recursão for ultrapassado.
   */
  parseExpression(): any {
    if (++this.depth > Parser.MAX_DEPTH) {
      throw new Error('Violação de Segurança: A recursão da expressão excedeu a profundidade máxima autorizada (25 níveis).');
    }
    try {
      let node = this.parseAnd();
      while (this.peek() === '||') {
        this.next(); // Consome o operador '||'
        const right = this.parseAnd();
        node = node || right;
      }
      return node;
    } finally {
      this.depth--;
    }
  }

  /**
   * @description Analisa operadores lógicos conjuntivos (AND / &&).
   * @returns {any} Resultado da subexpressão lógica conjuntiva.
   */
  private parseAnd(): any {
    let node = this.parseRelation();
    while (this.peek() === '&&') {
      this.next(); // Consome o operador '&&'
      const right = this.parseRelation();
      node = node && right;
    }
    return node;
  }

  /**
   * @description Analisa operadores relacionais e de igualdade (===, ==, !==, !=, >, <, >=, <=).
   * @returns {any} Booleano resultante da comparação relacional.
   */
  private parseRelation(): any {
    let node = this.parseAdditive();
    const ops = ['===', '==', '!==', '!=', '>=', '<=', '>', '<'];
    while (this.peek() && ops.includes(this.peek()!)) {
      const op = this.next()!;
      const right = this.parseAdditive();
      switch (op) {
        case '==':
        case '===':
          node = node === right;
          break;
        case '!=':
        case '!==':
          node = node !== right;
          break;
        case '>':
          node = node > right;
          break;
        case '<':
          node = node < right;
          break;
        case '>=':
          node = node >= right;
          break;
        case '<=':
          node = node <= right;
          break;
      }
    }
    return node;
  }

  /**
   * @description Analisa operações aditivas (+, -).
   * @returns {any} Valor numérico resultante da adição ou subtração.
   */
  private parseAdditive(): any {
    let node = this.parseMultiplicative();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.next()!;
      const right = this.parseMultiplicative();
      if (op === '+') {
        node = Number(node) + Number(right);
      } else {
        node = Number(node) - Number(right);
      }
    }
    return node;
  }

  /**
   * @description Analisa operações multiplicativas (*, /).
   * @returns {any} Valor numérico resultante da multiplicação ou divisão.
   */
  private parseMultiplicative(): any {
    let node = this.parseUnary();
    while (this.peek() === '*' || this.peek() === '/') {
      const op = this.next()!;
      const right = this.parseUnary();
      if (op === '*') {
        node = Number(node) * Number(right);
      } else {
        node = Number(node) / Number(right);
      }
    }
    return node;
  }

  /**
   * @description Analisa operadores unários (! para negação lógica booleana, - para números negativos).
   * @returns {any} Valor unário avaliado.
   */
  private parseUnary(): any {
    if (this.peek() === '!') {
      this.next(); // Consome o operador de negação '!'
      return !this.parseUnary();
    }
    if (this.peek() === '-') {
      this.next(); // Consome o sinal negativo '-'
      return -this.parseUnary();
    }
    return this.parsePrimary();
  }

  /**
   * @description Analisa terminais primários: literais de texto, números, booleanos,
   * expressões entre parênteses e identificadores resolvidos no contexto.
   * @returns {any} Valor resolvido do nó folha da árvore de análise sintática.
   * @throws {Error} Em caso de término inesperado de expressão ou violação de acesso a protótipo.
   */
  private parsePrimary(): any {
    const token = this.next();
    if (token === undefined) {
      throw new Error('Fim inesperado da expressão.');
    }

    // Resolução de subexpressões agrupadas entre parênteses
    if (token === '(') {
      const node = this.parseExpression();
      if (this.next() !== ')') {
        throw new Error('Esperado o fecho de parêntese correspondente ")".');
      }
      return node;
    }

    // Literais de cadeia de caracteres (delimitados por plicas ou aspas)
    if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
      return token.substring(1, token.length - 1);
    }

    // Literais numéricos (inteiros ou ponto flutuante)
    if (/^-?\d+(\.\d+)?$/.test(token)) {
      return Number(token);
    }

    // Literais booleanos
    if (token === 'true') return true;
    if (token === 'false') return false;

    // Literal nulo
    if (token === 'null') return null;

    // BLOQUEIO ATIVO DE SEGURANÇA: Prevenção de travessia e poluição de protótipo
    if (token === '__proto__' || token === 'constructor' || token === 'prototype') {
      throw new Error(`Violação de Segurança: O acesso à propriedade "${token}" é expressamente proibido.`);
    }

    // Resolução de caminhos hierárquicos contextuais (ex.: "context.user.id" ou "context['amount']")
    if (token.startsWith('context')) {
      const parts = token.split(/\.|\[|\]/).filter(Boolean);
      let current = this.context;
      for (let i = 1; i < parts.length; i++) {
        if (current === null || current === undefined) {
          return undefined;
        }
        let key = parts[i].trim();
        if ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith('"') && key.endsWith('"'))) {
          key = key.substring(1, key.length - 1);
        }
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          throw new Error(`Violação de Segurança: O acesso à propriedade "${key}" é expressamente proibido.`);
        }
        current = current[key];
      }
      return current;
    }

    // Resolução direta de variáveis de topo presentes no contexto
    if (this.context && typeof this.context === 'object' && Object.prototype.hasOwnProperty.call(this.context, token)) {
      return this.context[token];
    }

    throw new Error(`Token inesperado ou desconhecido: ${token}`);
  }
}
