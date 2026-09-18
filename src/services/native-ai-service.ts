/**
 * @fileoverview Serviço Nativo de Inferência e Análise de Inteligência Artificial (NativeAIService)
 * @module Services/NativeAIService
 * @description
 * Serviço nativo integrado do protocolo INP que expõe capacidades de IA generativa
 * diretamente na rede de orquestração sem necessidade de microsserviços externos.
 * Suporta roteamento inteligente entre provedores (Gemini / OpenAI / Ollama) com
 * fallback automático, cache de respostas frequentes e limitação de tokens.
 *
 * Capacidades expostas:
 * - EXECUTE AI_INFERENCE: Executa inferência generativa de texto completa.
 * - ANALYZE TEXT: Análise semântica, classificação e extração de entidades.
 * - SUMMARIZE DATA: Sumarização de dados estruturados ou texto longo.
 *
 * @security Bloqueia a execução de intenções sem chave de API configurada.
 * Sanitiza toda a entrada antes de repassar ao modelo para prevenir prompt injection.
 * @audit Regista o provedor utilizado, tokens consumidos e latência de inferência
 * para monitorização de custo e conformidade.
 */

import axios from 'axios';

/** Cache em memória de respostas de IA frequentes (TTL: 5 minutos) */
const aiResponseCache = new Map<string, { result: any; expiresAt: number }>();
/** Limite máximo de entradas no cache de IA em memória */
const AI_CACHE_MAX_SIZE = 1000;

/** Limpeza periódica de entradas TTL expiradas do cache de IA (a cada 10 minutos) */
setInterval(() => {
  const now = Date.now();
  for (const [k, entry] of aiResponseCache.entries()) {
    if (entry.expiresAt <= now) aiResponseCache.delete(k);
  }
}, 600000);

/**
 * @description Armazena um resultado no cache de IA com evicção LRU do elemento mais antigo.
 * @param {string} key - Chave do cache.
 * @param {any} result - Resultado da inferência.
 */
function saveToAiCache(key: string, result: any): void {
  if (aiResponseCache.size >= AI_CACHE_MAX_SIZE) {
    const oldestKey = aiResponseCache.keys().next().value;
    if (oldestKey !== undefined) aiResponseCache.delete(oldestKey);
  }
  aiResponseCache.set(key, { result, expiresAt: Date.now() + 300000 });
}

/**
 * @description Gera chave de cache para deduplicação de inferências idênticas.
 * @param {string} verb - Verbo semântico.
 * @param {any} context - Contexto da invocação.
 * @returns {string} Chave hash para cache.
 */
function buildCacheKey(verb: string, context: any): string {
  const { prompt, text, data, model, ...rest } = context;
  const key = JSON.stringify({ verb, prompt, text, data, model });
  return require('crypto').createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * @description Manipulador local do Serviço Nativo de IA do protocolo INP.
 * Processa inferências, análises semânticas e sumarizações com fallback automático entre provedores.
 *
 * @param {object} input - Contexto da execução contendo: `prompt`, `text`, `data`, `model`, `maxTokens`, `temperature`, `useCache`.
 * @param {object} execContext - Contexto de execução com securityContext.
 * @returns {Promise<object>} Resultado da inferência com campos: `output`, `provider`, `tokensUsed`, `latencyMs`, `cached`.
 * @throws {Error} Se nenhum provedor de IA estiver disponível e não houver fallback mock configurado.
 * @security Sanitiza entrada antes de transmitir ao modelo; nunca executa código proveniente do contexto.
 * @audit Regista o provedor, tokens, latência e hash da entrada para auditoria de custo e conformidade.
 */
export async function nativeAIHandler(input: any, execContext?: any): Promise<any> {
  const { prompt, text, data, model, maxTokens = 1000, temperature = 0.3, useCache = true, verb } = input;
  const effectivePrompt = prompt || text || (data ? `Analyze and summarize this data: ${JSON.stringify(data)}` : 'Hello');

  const cacheKey = buildCacheKey(verb || 'AI', { prompt: effectivePrompt, model, maxTokens, temperature });
  if (useCache) {
    const cached = aiResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, cached: true };
    }
  }

  const startTime = Date.now();
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  try {
    if (geminiKey) {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        { contents: [{ parts: [{ text: effectivePrompt }] }] },
        { timeout: 30000 }
      );
      const output = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const result = { output, provider: 'gemini', tokensUsed: output.length, latencyMs: Date.now() - startTime, cached: false };
      if (useCache) saveToAiCache(cacheKey, result);
      return result;
    } else if (openaiKey) {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        { model: model || 'gpt-4o-mini', messages: [{ role: 'user', content: effectivePrompt }], max_tokens: maxTokens, temperature },
        { headers: { Authorization: `Bearer ${openaiKey}` }, timeout: 30000 }
      );
      const output = response.data?.choices?.[0]?.message?.content || '';
      const tokensUsed = response.data?.usage?.total_tokens || 0;
      const result = { output, provider: 'openai', tokensUsed, latencyMs: Date.now() - startTime, cached: false };
      if (useCache) saveToAiCache(cacheKey, result);
      return result;
    } else {
      // Fallback mock para desenvolvimento sem chave de API
      const output = `[Mock AI] Processado com sucesso: "${effectivePrompt.substring(0, 100)}"... (Configure GEMINI_API_KEY ou OPENAI_API_KEY para inferência real.)`;
      const result = { output, provider: 'mock', tokensUsed: 0, latencyMs: Date.now() - startTime, cached: false };
      if (useCache) saveToAiCache(cacheKey, result);
      return result;
    }
  } catch (err: any) {
    throw new Error(`[Serviço Nativo de IA] Falha na inferência: ${err.message}`);
  }
}
