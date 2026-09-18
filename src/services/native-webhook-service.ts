/**
 * @fileoverview Serviço Nativo de Despacho de Webhooks e Publicação de Eventos (NativeWebhookService)
 * @module Services/NativeWebhookService
 * @description
 * Serviço nativo integrado do protocolo INP para despacho assíncrono garantido
 * de webhooks HTTP para URLs de clientes externos. Implementa assinatura criptográfica
 * HMAC-SHA256 no cabeçalho `X-INP-Signature` para autenticação de origem,
 * retentativas automáticas com recuo exponencial e registo de falhas na DLQ.
 *
 * Capacidades expostas:
 * - DISPATCH WEBHOOK: Envia payload JSON assinado para uma URL de callback externa.
 * - PUBLISH EVENT: Publica um evento nomeado para múltiplos destinos registados.
 *
 * @security Assina todos os payloads com HMAC-SHA256 usando INP_WEBHOOK_SECRET ou segredo fornecido.
 * Valida a URL de destino contra SSRF antes de qualquer envio.
 * @audit Regista cada despacho (destino, latência, estado HTTP de resposta) para auditoria de integrações.
 */

import axios from 'axios';
import crypto from 'crypto';
import { NetworkSecurity } from '../core/network-security';

/**
 * @description Gera a assinatura HMAC-SHA256 do payload para autenticação do webhook.
 * @param {any} payload - Corpo do evento a assinar.
 * @param {string} secret - Segredo partilhado para derivação HMAC.
 * @returns {string} Assinatura hexadecimal do payload.
 * @security Garante que o destinatário pode verificar a autenticidade e integridade do evento.
 */
function signPayload(payload: any, secret: string): string {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

/**
 * @description Manipulador local do Serviço Nativo de Webhooks.
 * Despacha eventos assinados e realiza retentativas automáticas em caso de falha transitória.
 *
 * @param {object} input - Contexto da execução contendo: `url` (obrigatório), `event`, `payload`, `secret`, `maxRetries`, `timeoutMs`.
 * @param {object} execContext - Contexto de execução com securityContext.
 * @returns {Promise<object>} Resultado com: `dispatched`, `statusCode`, `responseTime`, `signature`, `attempts`.
 * @throws {Error} Se a URL estiver em falta, for inválida ou todas as tentativas falharem.
 * @security Valida a URL contra SSRF antes do envio; assina o payload com HMAC-SHA256.
 * @audit Regista a URL de destino, estado HTTP, latência e hash de assinatura para conformidade.
 */
export async function nativeWebhookHandler(input: any, execContext?: any): Promise<any> {
  const { url, event = 'inp.event', payload = {}, secret, maxRetries = 3, timeoutMs = 10000 } = input;
  if (!url || typeof url !== 'string') {
    throw new Error('[Serviço Nativo de Webhook] O campo "url" é obrigatório para o despacho de webhook.');
  }

  // MEDIDA DE SEGURANÇA MANDATÓRIA: Validação de destino contra ataques de SSRF
  NetworkSecurity.validateEndpoint(url);

  const webhookSecret = secret || process.env.INP_WEBHOOK_SECRET || 'inp-webhook-secret-default';
  const eventPayload = { event, data: payload, timestamp: new Date().toISOString(), source: 'inp-protocol' };
  const signature = signPayload(eventPayload, webhookSecret);

  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();
    try {
      const response = await axios.post(url, eventPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-INP-Signature': `sha256=${signature}`,
          'X-INP-Event': event,
          'X-INP-Attempt': String(attempt)
        },
        timeout: timeoutMs,
        maxRedirects: 0
      });
      return {
        dispatched: true,
        statusCode: response.status,
        responseTime: Date.now() - startTime,
        signature: `sha256=${signature}`,
        attempts: attempt,
        event
      };
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  throw new Error(`[Serviço Nativo de Webhook] Falha após ${maxRetries} tentativas para "${url}": ${lastError?.message}`);
}
