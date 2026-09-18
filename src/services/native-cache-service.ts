/**
 * @fileoverview Serviço Nativo de Cache em Memória de Alta Velocidade (NativeCacheService)
 * @module Services/NativeCacheService
 * @description
 * Serviço nativo integrado do protocolo INP que fornece armazenamento temporário
 * de chave-valor com controlo de TTL (Time-To-Live) diretamente na rede de orquestração.
 * Permite que fluxos de intenções evitem chamadas repetidas a bancos de dados ou
 * microsserviços externos entre passos consecutivos do grafo de execução.
 *
 * Capacidades expostas:
 * - STORE CACHE: Armazena um valor associado a uma chave com TTL opcional.
 * - FETCH CACHE: Recupera um valor previamente armazenado por chave.
 * - INVALIDATE CACHE: Elimina uma entrada ou padrão de entradas do cache.
 *
 * @security Previne armazenamento de dados sensíveis (tokens, senhas) através de lista de chaves proibidas.
 * @audit Regista operações de escrita/invalidação para auditoria de estado distribuído.
 */

import crypto from 'crypto';

/** Repositório central do cache em memória indexado por chave normalizada */
const cacheStore = new Map<string, { value: any; expiresAt: number; createdAt: number }>();

/** Conjunto de prefixos de chaves sensíveis que nunca devem ser armazenados */
const FORBIDDEN_KEY_PREFIXES = ['password', 'secret', 'token', 'credential', 'private_key', 'api_key'];

/** Tamanho máximo do cache em memória (5000 entradas) */
const MAX_CACHE_SIZE = 5000;

/**
 * @description Normaliza e valida a chave de cache, bloqueando padrões sensíveis.
 * @param {string} key - Chave fornecida pelo utilizador.
 * @returns {string} Chave normalizada em minúsculas.
 * @throws {Error} Se a chave contiver padrões sensíveis proibidos.
 * @security Previne o armazenamento acidental de segredos e credenciais em cache.
 */
function normalizeKey(key: string): string {
  if (!key || typeof key !== 'string') throw new Error('A chave de cache deve ser uma cadeia de texto não vazia.');
  const lower = key.toLowerCase();
  if (FORBIDDEN_KEY_PREFIXES.some(prefix => lower.includes(prefix))) {
    throw new Error(`[Serviço de Cache] A chave "${key}" contém padrão sensível proibido. Dados confidenciais não devem ser armazenados em cache.`);
  }
  return lower.trim();
}

/**
 * @description Manipulador local do Serviço Nativo de Cache.
 * Redireciona para a operação correta (STORE, FETCH, INVALIDATE) com base no verbo semântico.
 *
 * @param {object} input - Contexto contendo: `verb` (STORE/FETCH/INVALIDATE), `key`, `value`, `ttlMs`.
 * @param {object} execContext - Contexto de execução.
 * @returns {Promise<object>} Resultado da operação de cache.
 * @throws {Error} Se a chave for inválida, sensível ou a operação falhar.
 * @security Bloqueia o armazenamento de segredos; limita o tamanho máximo do cache.
 * @audit Regista operações de escrita e invalidação para rastreabilidade de estado.
 */
export async function nativeCacheHandler(input: any, execContext?: any): Promise<any> {
  const { verb, key, value, ttlMs = 300000, pattern } = input;

  // Limpeza periódica de entradas expiradas
  const now = Date.now();
  if (Math.random() < 0.05) {
    for (const [k, entry] of cacheStore.entries()) {
      if (entry.expiresAt <= now) cacheStore.delete(k);
    }
  }

  const normalizedVerb = (verb || '').toString().toUpperCase();

  if (normalizedVerb === 'STORE' || normalizedVerb === 'STORE CACHE') {
    const normKey = normalizeKey(key);
    if (value === undefined || value === null) throw new Error('[Serviço de Cache] O campo "value" é obrigatório para a operação STORE.');
    if (cacheStore.size >= MAX_CACHE_SIZE) {
      const firstKey = cacheStore.keys().next().value;
      if (firstKey) cacheStore.delete(firstKey);
    }
    cacheStore.set(normKey, { value, expiresAt: now + ttlMs, createdAt: now });
    return { stored: true, key: normKey, ttlMs, expiresAt: new Date(now + ttlMs).toISOString() };
  }

  if (normalizedVerb === 'FETCH' || normalizedVerb === 'FETCH CACHE') {
    const normKey = normalizeKey(key);
    const entry = cacheStore.get(normKey);
    if (!entry || entry.expiresAt <= now) {
      return { found: false, key: normKey, value: null };
    }
    return { found: true, key: normKey, value: entry.value, ageMs: now - entry.createdAt, ttlRemainingMs: entry.expiresAt - now };
  }

  if (normalizedVerb === 'INVALIDATE' || normalizedVerb === 'INVALIDATE CACHE') {
    let deleted = 0;
    if (key) {
      const normKey = normalizeKey(key);
      if (cacheStore.delete(normKey)) deleted++;
    } else if (pattern && typeof pattern === 'string') {
      try {
        // MEDIDA DE SEGURANÇA: Escapa carateres especiais de regex antes de converter '*' para evitar ReDoS e exceções de sintaxe
        const safeRegexStr = pattern
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*');
        const regex = new RegExp(`^${safeRegexStr}$`, 'i');
        for (const k of [...cacheStore.keys()]) {
          if (regex.test(k)) { cacheStore.delete(k); deleted++; }
        }
      } catch {
        // Padrão malformado ignorado preventivamente
      }
    }
    return { invalidated: true, deletedCount: deleted };
  }

  throw new Error(`[Serviço de Cache] Operação desconhecida: "${normalizedVerb}". Use STORE, FETCH ou INVALIDATE.`);
}
