/**
 * @fileoverview Microserviço Simulado de Gestão de Inventário e Stock (MockInventoryService)
 * @module Services/MockInventoryService
 * @description
 * Microserviço de teste que expõe capacidades de reserva de artigos (`FETCH INVENTORY`)
 * e respetiva compensação transacional (`RESTORE INVENTORY`) no padrão Saga.
 * Suporta injeção de estados de engenharia de caos (`HEALTHY`, `ERROR_500`, `LATENCY_5S`)
 * para validação de disjuntores de circuito, limitação adaptativa e failover automático.
 * Regista-se dinamicamente no gateway INP através do endpoint `/services/register`.
 *
 * @security Exige e valida o token `X-Registration-Token` durante o auto-registo no gateway.
 * @audit Permite rastrear identificadores de reserva (`reservedId`) para validação de reversões e compensações Saga.
 */

import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

// Configuração da porta de escuta do microserviço (por omissão: 3002)
let PORT = parseInt(process.env.PORT || '3002', 10);
if (PORT === 3000) {
  PORT = 3002;
}
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const REGISTRATION_TOKEN = process.env.INP_REGISTRATION_SECRET || 'inp-super-secret-registration-token-2026';
const SELF_ENDPOINT = process.env.SELF_ENDPOINT || `http://localhost:${PORT}`;

/**
 * Registo em memória de reservas de stock efetuadas para fins de verificação de testes.
 */
const reservedBookings: { reservedId: string; productId: string; quantity: number; timestamp: string }[] = [];

/**
 * Estado atual de simulação de caos operacional.
 */
let chaosState: 'HEALTHY' | 'ERROR_500' | 'LATENCY_5S' = 'HEALTHY';

/**
 * Rota para comutação de estado de caos operacional (injeção de erros ou latência).
 */
app.post('/chaos', (req, res) => {
  const { state } = req.body;
  if (state === 'HEALTHY' || state === 'ERROR_500' || state === 'LATENCY_5S') {
    chaosState = state;
    console.log(`[Inventário Simulado] Estado de caos atualizado para: ${chaosState}`);
    res.json({ success: true, state: chaosState });
  } else {
    res.status(400).json({ error: 'Estado de caos inválido' });
  }
});

/**
 * Rota central de execução de capacidades do serviço de inventário.
 */
app.post('/execute', (req, res) => {
  // Simulação de erro interno 500 para teste de resiliência e disjuntor
  if (chaosState === 'ERROR_500') {
    console.log(`[Inventário Simulado] A simular Erro de Caos 500`);
    return res.status(500).json({ error: 'Erro Interno de Servidor (Engenharia de Caos)' });
  }

  const proceed = () => {
    const { verb, target, context } = req.body;
    const normalizedVerb = verb.toUpperCase();
    const normalizedTarget = target.toUpperCase();

    console.log(`[Inventário Simulado] A executar: ${normalizedVerb} ${normalizedTarget}`, context);

    if (normalizedVerb === 'FETCH' && normalizedTarget === 'INVENTORY') {
      const productId = context.product_id || 'P_UNKNOWN';
      const quantity = context.quantity || 1;
      const reservedId = `res_${Date.now()}`;
      
      console.log(`[Inventário Simulado] A verificar stock para o artigo ${productId}, quantidade: ${quantity}. Reserva: ${reservedId}`);
      
      reservedBookings.push({ reservedId, productId, quantity, timestamp: new Date().toISOString() });
      
      res.json({
        stockStatus: 'available',
        productId,
        quantity,
        reservedId
      });
    } else if (normalizedVerb === 'RESTORE' && normalizedTarget === 'INVENTORY') {
      // Compensação transacional (Rollback da Saga)
      const reservedId = context.reservedId;
      console.log(`[Inventário Simulado] [REVERSÃO SAGA] A repor reserva de inventário: ${reservedId}`);
      res.json({
        status: 'restored',
        reservedId
      });
    } else {
      console.warn(`[Inventário Simulado] Capacidade desconhecida: ${verb} ${target}`);
      res.status(400).json({ error: `Capacidade desconhecida: ${verb} ${target}` });
    }
  };

  // Simulação de degradação com latência de 5 segundos
  if (chaosState === 'LATENCY_5S') {
    console.log(`[Inventário Simulado] A simular Latência de Caos de 5s`);
    setTimeout(proceed, 5000);
  } else {
    proceed();
  }
});

// Inicialização do servidor HTTP e auto-registo no gateway
app.listen(PORT, () => {
  console.log(`📦 Microserviço Simulado de Inventário em escuta na porta ${PORT}`);
  
  // Auto-registo no catálogo de capacidades após 4 segundos
  setTimeout(async () => {
    try {
      await axios.post(`${GATEWAY_URL}/services/register`, {
        id: 'mock-inventory-service-' + PORT,
        name: 'Mock Inventory Manager',
        description: 'Gere stock simulado de produtos e reservas para testes',
        capabilities: [
          {
            verb: 'FETCH',
            target: 'INVENTORY',
            description: 'Verifica disponibilidade e reserva stock',
            compensateCapability: 'RESTORE INVENTORY'
          },
          {
            verb: 'RESTORE',
            target: 'INVENTORY',
            description: 'Compensa e liberta a reserva de stock'
          }
        ],
        trustScore: 100,
        securityLevel: 'MEDIUM',
        endpoint: SELF_ENDPOINT
      }, {
        headers: { 'X-Registration-Token': REGISTRATION_TOKEN }
      });
      console.log('[Inventário Simulado] Registado com sucesso no Gateway INP.');
    } catch (err: any) {
      console.warn('[Inventário Simulado] Falha no auto-registo: ', err.response ? err.response.data : err.message);
    }
  }, 4000);
});
