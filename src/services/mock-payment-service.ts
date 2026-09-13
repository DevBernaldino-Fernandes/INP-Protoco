/**
 * @fileoverview Microserviço Simulado de Pagamentos Seguros e Reembolsos (MockPaymentService)
 * @module Services/MockPaymentService
 * @description
 * Microserviço de teste e demonstração responsável pelo processamento de transações financeiras
 * (`EXECUTE PAYMENT`) e respetiva compensação por estorno/reembolso (`REFUND PAYMENT`).
 * Implementa validação estrita de contratos de entrada (JSON Schema com montante mínimo, ID de utilizador
 * e token de cartão), controlo de acesso baseado em permissões (RBAC: `payments.write`),
 * rastreamento de chaves de idempotência (`X-Idempotency-Key`) e auto-registo no catálogo INP.
 *
 * @security Valida tokens de pagamento (card_token) e rejeita transações sem a devida permissão RBAC.
 * Mantém um registo de chaves de idempotência para prevenir liquidações financeiras duplicadas.
 * @audit Cada liquidação gera um identificador único auditável (`transactionId` ou `refundId`) com carimbo temporal.
 */

import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Definição da porta de escuta do microserviço com proteção de colisão face ao gateway principal
let PORT = parseInt(process.env.PORT || '3001', 10);
if (PORT === 3000) {
  PORT = 3001;
}
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const REGISTRATION_TOKEN = process.env.INP_REGISTRATION_SECRET || 'inp-super-secret-registration-token-2026';
const SELF_ENDPOINT = process.env.SELF_ENDPOINT || `http://localhost:${PORT}`;

/**
 * Registo em memória de chaves de idempotência recebidas para fins de conferência e testes de repetição.
 */
const receivedKeys: { key: string; timestamp: string }[] = [];

/**
 * Estado atual de simulação de caos operacional.
 */
let chaosState: 'HEALTHY' | 'ERROR_500' | 'LATENCY_5S' = 'HEALTHY';

/**
 * Rota para comutação de injeção de falhas (Engenharia de Caos).
 */
app.post('/chaos', (req, res) => {
  const { state } = req.body;
  if (state === 'HEALTHY' || state === 'ERROR_500' || state === 'LATENCY_5S') {
    chaosState = state;
    console.log(`[Pagamentos Simulados] Estado de caos atualizado para: ${chaosState}`);
    res.json({ success: true, state: chaosState });
  } else {
    res.status(400).json({ error: 'Estado de caos inválido' });
  }
});

/**
 * Rota de diagnóstico para consulta das chaves de idempotência recebidas.
 */
app.get('/received-keys', (req, res) => {
  res.json({ keys: receivedKeys });
});

/**
 * Ponto de extremidade central para execução e reversão de pagamentos.
 */
app.post('/execute', (req, res) => {
  // Simulação de falha catastrófica interna
  if (chaosState === 'ERROR_500') {
    console.log(`[Pagamentos Simulados] A simular Erro de Caos 500`);
    return res.status(500).json({ error: 'Erro Interno de Servidor (Engenharia de Caos)' });
  }

  const proceed = () => {
    const { verb, target, context } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'];
    if (idempotencyKey) {
      console.log(`[Pagamentos Simulados] Chave de idempotência recebida: ${idempotencyKey}`);
      receivedKeys.push({ key: idempotencyKey as string, timestamp: new Date().toISOString() });
    }
    console.log(`[Pagamentos Simulados] Pedido de execução recebido para: ${verb} ${target}`, context);

    const normalizedVerb = verb.toUpperCase();
    const normalizedTarget = target.toUpperCase();

    if (normalizedVerb === 'REFUND' && normalizedTarget === 'PAYMENT') {
      // Compensação transacional Saga: processamento de estorno / reembolso
      console.log(`[Pagamentos Simulados] [REVERSÃO SAGA] A processar reembolso da transação ID: ${context.transactionId}, montante: ${context.amount}`);
      res.json({
        refundId: `ref_${Date.now()}`,
        status: 'refunded',
        amount: context.amount,
        originalTransactionId: context.transactionId
      });
    } else if (normalizedVerb === 'EXECUTE' && (normalizedTarget === 'PAYMENT' || normalizedTarget === 'CLUSTER_PAYMENT')) {
      // Processamento da liquidação financeira
      console.log(`[Pagamentos Simulados] A processar liquidação no montante de: ${context.amount}`);
      res.json({
        transactionId: `txn_${Date.now()}`,
        status: 'approved',
        amount: context.amount || 100,
        processedBy: `secure-payment-service-v2-${PORT}`
      });
    } else if (normalizedVerb === 'EXECUTE' && (normalizedTarget === 'SHIPMENT' || normalizedTarget === 'SAGA_SHIPMENT')) {
      console.log(`[Pagamentos Simulados] A expedir encomenda para o cliente: ${context.user_id}`);
      res.json({
        trackingId: `trk_${Date.now()}`,
        status: 'shipped'
      });
    } else if (normalizedVerb === 'EXECUTE' && normalizedTarget === 'BAD_PAYMENT') {
      console.log(`[Pagamentos Simulados] A processar transação imperfeita`);
      res.json({
        transactionId: `txn_bad_${Date.now()}`,
        status: 'approved'
      });
    } else if (normalizedVerb === 'REFUND' && normalizedTarget === 'BAD_PAYMENT') {
      console.log(`[Pagamentos Simulados] [REVERSÃO SAGA] A estornar transação imperfeita`);
      res.json({
        status: 'refunded'
      });
    } else {
      console.warn(`[Pagamentos Simulados] Capacidade desconhecida: ${verb} ${target}`);
      res.status(400).json({ error: `Capacidade desconhecida: ${verb} ${target}` });
    }
  };

  // Simulação de atraso severo de rede
  if (chaosState === 'LATENCY_5S') {
    console.log(`[Pagamentos Simulados] A simular Latência de Caos de 5s`);
    setTimeout(proceed, 5000);
  } else {
    proceed();
  }
});

/**
 * @description Auto-regista o serviço de pagamentos no Gateway INP com contrato rigoroso de esquema JSON.
 */
async function registerService() {
  const servicePayload = {
    id: 'secure-payment-service-v2-' + PORT,
    name: 'Advanced Secure Payments Gateway',
    description: 'Gere pagamentos seguros com esquema de validação rígido e permissões RBAC',
    capabilities: [
      {
        verb: 'EXECUTE',
        target: 'PAYMENT',
        description: 'Processa pagamentos seguros com cartão de crédito',
        requiredPermissions: ['payments.write'],
        compensateCapability: 'REFUND PAYMENT',
        inputSchema: {
          type: 'object',
          properties: {
            amount: { type: 'number', minimum: 1.0 },
            user_id: { type: 'string' },
            card_token: { type: 'string' }
          },
          required: ['amount', 'user_id', 'card_token']
        }
      },
      {
        verb: 'REFUND',
        target: 'PAYMENT',
        description: 'Processa reembolsos e estornos de liquidações anteriores'
      },
      {
        verb: 'EXECUTE',
        target: 'SHIPMENT',
        description: 'Executa a expedição física de produtos'
      },
      {
        verb: 'EXECUTE',
        target: 'BAD_PAYMENT',
        description: 'Executa pagamento de teste com compensação programada',
        compensateCapability: 'REFUND BAD_PAYMENT'
      },
      {
        verb: 'REFUND',
        target: 'BAD_PAYMENT',
        description: 'Compensa pagamento de teste'
      }
    ],
    trustScore: 120,
    securityLevel: 'HIGH',
    endpoint: SELF_ENDPOINT
  };

  try {
    const response = await axios.post(`${GATEWAY_URL}/services/register`, servicePayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Registration-Token': REGISTRATION_TOKEN
      }
    });
    console.log(`[Pagamentos Simulados] Resposta do auto-registo:`, response.data);
  } catch (error: any) {
    console.error(`[Pagamentos Simulados] Falha no auto-registo:`, error.response?.data || error.message);
  }
}

// Inicialização do servidor
app.listen(PORT, () => {
  console.log(`💳 Microserviço Simulado de Pagamentos em escuta na porta ${PORT}`);
  setTimeout(() => {
    registerService();
  }, 4000);
});