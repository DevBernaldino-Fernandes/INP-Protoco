/**
 * @fileoverview Serviço Nativo de Transformação e Mapeamento de Dados (NativeDataTransformerService)
 * @module Services/NativeDataTransformerService
 * @description
 * Serviço nativo integrado do protocolo INP para manipulação declarativa de dados
 * estruturados (JSON) dentro do grafo de orquestração. Permite renomear campos,
 * projetar subconjuntos, filtrar listas, formatar valores e calcular campos derivados
 * sem a necessidade de implementar um microsserviço intermediário dedicado.
 *
 * Capacidades expostas:
 * - TRANSFORM PAYLOAD: Aplica regras de transformação a um objeto JSON.
 * - MAP DATA: Remapeia campos de um objeto de origem para um objeto de destino.
 * - FILTER LIST: Filtra uma lista de objetos com base em condições declarativas.
 *
 * @security Avalia condições através de comparações estritas sem uso de eval() ou Function().
 * @audit Regista o número de transformações aplicadas e campos modificados para rastreabilidade.
 */

/**
 * @description Resolve um caminho de acesso a campo aninhado (ex: "user.profile.name") num objeto.
 * @param {any} obj - Objeto de origem.
 * @param {string} path - Caminho de acesso separado por pontos.
 * @returns {any} Valor encontrado ou undefined.
 */
function getNestedValue(obj: any, path: string): any {
  if (!path || typeof path !== 'string' || !obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  for (const part of parts) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
  }
  return parts.reduce((acc, key) => acc?.[key], obj);
}

/**
 * @description Define um valor num caminho de campo aninhado num objeto com salvaguarda estrita contra poluição de protótipo.
 * @param {any} obj - Objeto de destino.
 * @param {string} path - Caminho de acesso separado por pontos.
 * @param {any} value - Valor a definir.
 * @throws {Error} Se o caminho contiver chaves reservadas de protótipo (__proto__, constructor, prototype).
 * @security Bloqueia injeção de propriedades maliciosas no protótipo global do JavaScript.
 */
function setNestedValue(obj: any, path: string, value: any): void {
  if (!path || typeof path !== 'string' || !obj || typeof obj !== 'object') return;
  const parts = path.split('.');

  // MEDIDA DE SEGURANÇA MANDATÓRIA: Bloqueio estrito de poluição de protótipo (Prototype Pollution)
  for (const part of parts) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
      throw new Error(`[Transformador] Violação de Segurança: Tentativa de poluição de protótipo detetada com a chave proibida "${part}".`);
    }
  }

  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!current[p] || typeof current[p] !== 'object') {
      current[p] = {};
    }
    current = current[p];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * @description Avalia uma condição de filtro simples com segurança sem eval().
 * @param {any} item - Item a testar.
 * @param {object} condition - Condição: { field, operator, value }.
 * @returns {boolean} Verdadeiro se o item satisfaz a condição.
 * @security Utiliza comparações estritas sem eval() ou new Function().
 */
function evaluateCondition(item: any, condition: any): boolean {
  const fieldVal = getNestedValue(item, condition.field);
  const condVal = condition.value;
  switch (condition.operator || '==') {
    case '==': case 'eq': return fieldVal == condVal;
    case '===': return fieldVal === condVal;
    case '!=': case 'neq': return fieldVal != condVal;
    case '>': case 'gt': return Number(fieldVal) > Number(condVal);
    case '>=': case 'gte': return Number(fieldVal) >= Number(condVal);
    case '<': case 'lt': return Number(fieldVal) < Number(condVal);
    case '<=': case 'lte': return Number(fieldVal) <= Number(condVal);
    case 'contains': return String(fieldVal).includes(String(condVal));
    case 'startsWith': return String(fieldVal).startsWith(String(condVal));
    case 'endsWith': return String(fieldVal).endsWith(String(condVal));
    case 'in': return Array.isArray(condVal) && condVal.includes(fieldVal);
    default: return false;
  }
}

/**
 * @description Manipulador local do Serviço Nativo de Transformação de Dados.
 *
 * @param {object} input - Contexto contendo: `verb`, `data` (objeto/lista), `mappings` (array de {from, to, transform}), `conditions` (para filtragem).
 * @param {object} execContext - Contexto de execução.
 * @returns {Promise<object>} Dados transformados com campo `result` e `operationsApplied`.
 * @throws {Error} Se os dados de entrada forem inválidos ou as regras de mapeamento estiverem malformadas.
 * @security Não utiliza eval(); avalia condições de forma declarativa e determinística.
 * @audit Regista o número de transformações e campos modificados para rastreabilidade.
 */
export async function nativeDataTransformerHandler(input: any, execContext?: any): Promise<any> {
  const { verb, data, mappings = [], conditions = [], fields, sortBy, sortOrder = 'asc', limit } = input;
  const normalizedVerb = (verb || '').toString().toUpperCase();
  let operationsApplied = 0;

  if (normalizedVerb === 'TRANSFORM PAYLOAD' || normalizedVerb === 'TRANSFORM') {
    if (!data || typeof data !== 'object') throw new Error('[Transformador] O campo "data" deve ser um objeto JSON válido.');
    const result = JSON.parse(JSON.stringify(data));
    for (const mapping of mappings) {
      if (!mapping.from || !mapping.to) continue;
      const value = getNestedValue(result, mapping.from);
      if (value !== undefined) {
        let transformed = value;
        if (mapping.transform === 'toString') transformed = String(value);
        else if (mapping.transform === 'toNumber') transformed = Number(value);
        else if (mapping.transform === 'toBoolean') transformed = Boolean(value);
        else if (mapping.transform === 'toUpperCase') transformed = String(value).toUpperCase();
        else if (mapping.transform === 'toLowerCase') transformed = String(value).toLowerCase();
        else if (mapping.transform === 'trim') transformed = String(value).trim();
        else if (mapping.transform === 'toISODate') transformed = new Date(value).toISOString();
        setNestedValue(result, mapping.to, transformed);
        if (mapping.from !== mapping.to) {
          const fromParts = mapping.from.split('.');
          const fromParent = fromParts.length > 1 ? getNestedValue(result, fromParts.slice(0, -1).join('.')) : result;
          if (fromParent) delete fromParent[fromParts[fromParts.length - 1]];
        }
        operationsApplied++;
      }
    }
    if (fields && Array.isArray(fields)) {
      const projected: any = {};
      for (const f of fields) { projected[f] = result[f]; }
      return { result: projected, operationsApplied };
    }
    return { result, operationsApplied };
  }

  if (normalizedVerb === 'MAP DATA' || normalizedVerb === 'MAP') {
    if (!data) throw new Error('[Transformador] O campo "data" é obrigatório para MAP DATA.');
    const source = Array.isArray(data) ? data : [data];
    const result = source.map(item => {
      const mapped: any = {};
      for (const mapping of mappings) {
        if (!mapping.from || !mapping.to) continue;
        const value = getNestedValue(item, mapping.from);
        if (value !== undefined) {
          setNestedValue(mapped, mapping.to, value);
          operationsApplied++;
        }
      }
      return mapped;
    });
    return { result: Array.isArray(data) ? result : result[0], operationsApplied };
  }

  if (normalizedVerb === 'FILTER LIST' || normalizedVerb === 'FILTER') {
    if (!Array.isArray(data)) throw new Error('[Transformador] O campo "data" deve ser uma lista (array) para FILTER LIST.');
    let result = data.filter(item => conditions.every((cond: any) => evaluateCondition(item, cond)));
    if (sortBy) {
      result = result.sort((a: any, b: any) => {
        const aVal = getNestedValue(a, sortBy);
        const bVal = getNestedValue(b, sortBy);
        return sortOrder === 'desc' ? (aVal > bVal ? -1 : 1) : (aVal < bVal ? -1 : 1);
      });
    }
    if (limit && typeof limit === 'number') result = result.slice(0, limit);
    return { result, count: result.length, originalCount: data.length, filtered: data.length - result.length };
  }

  throw new Error(`[Transformador] Operação desconhecida: "${normalizedVerb}". Use TRANSFORM PAYLOAD, MAP DATA ou FILTER LIST.`);
}
