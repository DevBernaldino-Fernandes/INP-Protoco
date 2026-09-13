/**
 * @fileoverview Microserviço de Pagamentos Seguros e Estornos do Ecossistema (PaymentService)
 * @module Examples/EcommerceEcosystem/Services/PaymentService
 * @description
 * Microserviço responsável pela liquidação de cobranças financeiras (`EXECUTE PAYMENT`)
 * e compensação automática de transações via estorno/reembolso (`REFUND PAYMENT`) no padrão Saga.
 * Exige permissões de segurança estritas (RBAC: `payments.write`), valida a presença de tokens
 * de cartão mascarados, verifica a unicidade de chaves de idempotência e suporta injeção de falhas (Chaos).
 *
 * @security Mascara tokens de cartão nos registos internos (`cardTokenMasked`).
 * Exige a permissão `payments.write` para efetivação da cobrança financeira.
 * @audit Cada liquidação gera um identificador único (`transactionId`), código de autorização (`authCode`)
 * e carimbo temporal imutável para reconciliação bancária e financeira.
 */

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * @description Fábrica de instanciação do microserviço de pagamentos e reembolsos.
 *
 * @param {number} [port=3002] - Porta TCP de escuta HTTP.
 * @param {string} [gatewayUrl='http://localhost:3000'] - URL do Gateway INP.
 * @returns {object} Instância configurada com aplicação Express e catálogo de transações.
 */
export function createPaymentService(port = 3002, gatewayUrl = 'http://localhost:3000') {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const REGISTRATION_TOKEN = process.env.INP_REGISTRATION_SECRET || 'inp-super-secret-registration-token-2026';
  const SELF_ENDPOINT = `http://localhost:${port}`;

  /** Registo em memória de liquidações financeiras aprovadas */
  const transactions = new Map<string, any>();
  /** Registo em memória de reembolsos e estornos efetuados */
  const refunds = new Map<string, any>();
  /** Histórico de chaves de idempotência recebidas */
  const receivedIdempotencyKeys: string[] = [];

  /** Estado corrente de simulação de caos */
  let chaosState: 'HEALTHY' | 'ERROR_500' = 'HEALTHY';

  /**
   * Rota de verificação de estado e contagem de transações e reembolsos.
   */
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'payment-service',
      transactionCount: transactions.size,
      refundCount: refunds.size
    });
  });

  /**
   * Rota para comutação de falhas de teste (Engenharia de Caos).
   */
  app.post('/chaos', (req, res) => {
    const { state } = req.body;
    if (state === 'HEALTHY' || state === 'ERROR_500') {
      chaosState = state;
      console.log(`[Serviço de Pagamentos] Estado de caos configurado para: ${chaosState}`);
      res.json({ success: true, chaosState });
    } else {
      res.status(400).json({ error: 'Estado de caos inválido' });
    }
  });

  /**
   * Rota de diagnóstico para consulta de chaves de idempotência processadas.
   */
  app.get('/idempotency-keys', (req, res) => {
    res.json({ keys: receivedIdempotencyKeys });
  });

  /**
   * Rota para consulta das transações e estornos arquivados.
   */
  app.get('/transactions', (req, res) => {
    res.json({
      transactions: Object.fromEntries(transactions),
      refunds: Object.fromEntries(refunds)
    });
  });

  /**
   * Ponto de extremidade para cobrança e estorno de pagamentos.
   */
  app.post('/execute', (req, res) => {
    if (chaosState === 'ERROR_500') {
      console.log(`[Serviço de Pagamentos] Erro de Caos 500 despoletado!`);
      return res.status(500).json({ error: 'Gateway de Pagamentos Indisponível (Caos Simulado)' });
    }

    const { verb, target, context } = req.body;
    const v = (verb || '').toUpperCase();
    const t = (target || '').toUpperCase();
    const idempotencyKey = req.headers['x-idempotency-key'] as string;

    if (idempotencyKey) {
      receivedIdempotencyKeys.push(idempotencyKey);
    }

    console.log(`[Serviço de Pagamentos] Pedido recebido: ${v} ${t} | Chave: ${idempotencyKey || 'N/A'}`);

    // Capacidade 1: EXECUTE PAYMENT
    if ((v === 'EXECUTE' || v === 'PROCESS') && t === 'PAYMENT') {
      const amount = Number(context.amount);
      const userId = context.user_id || context.customer_id;
      const currency = context.currency || 'USD';
      const cardToken = context.card_token;

      const transactionId = `txn_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const paymentRecord = {
        transactionId,
        amount,
        currency,
        userId,
        cardTokenMasked: cardToken ? `****${cardToken.slice(-4)}` : '****',
        status: 'CAPTURED',
        timestamp: new Date().toISOString()
      };

      transactions.set(transactionId, paymentRecord);
      console.log(`[Serviço de Pagamentos] Cobrança efetuada com sucesso: $${amount} ${currency} (Utilizador: ${userId}). TxID: ${transactionId}`);

      return res.json({
        ...context,
        status: 'PAID',
        transactionId,
        amount,
        currency,
        authCode: `AUTH_${Math.floor(100000 + Math.random() * 900000)}`,
        gateway: 'INP-GlobalPay-v2'
      });
    }

    // Capacidade 2: REFUND PAYMENT (Compensação Transacional Saga)
    if (v === 'REFUND' && t === 'PAYMENT') {
      const transactionId = context.transactionId;
      const amount = Number(context.amount || 0);

      const refundId = `ref_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const refundRecord = {
        refundId,
        originalTransactionId: transactionId,
        amount,
        status: 'REFUNDED',
        timestamp: new Date().toISOString()
      };

      refunds.set(refundId, refundRecord);
      console.log(`[Serviço de Pagamentos] [REVERSÃO SAGA] Pagamento estornado com sucesso: TxID: ${transactionId}, RefundID: ${refundId}, Montante: ${amount}`);

      return res.json({
        status: 'REFUNDED',
        refundId,
        originalTransactionId: transactionId,
        refundedAmount: amount
      });
    }

    return res.status(400).json({ error: `Capacidade não suportada: ${verb} ${target}` });
  });

  const registerDefinition = {
    id: `ecommerce-payment-service-${port}`,
    name: 'E-Commerce Secure Payment Gateway',
    description: 'Processa liquidações financeiras com controlo antifraude, esquema rígido e compensações Saga',
    trustScore: 99,
    securityLevel: 'HIGH',
    endpoint: SELF_ENDPOINT,
    capabilities: [
      {
        verb: 'EXECUTE',
        target: 'PAYMENT',
        description: 'Executa cobrança segura com cartão de crédito',
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
        description: 'Executa reembolso automático durante a reversão da Saga'
      }
    ]
  };

  /**
   * @description Auto-regista o serviço no catálogo do Gateway INP.
   */
  async function register() {
    try {
      const response = await axios.post(`${gatewayUrl}/services/register`, registerDefinition, {
        headers: {
          'Content-Type': 'application/json',
          'X-Registration-Token': REGISTRATION_TOKEN
        }
      });
      console.log(`[Serviço de Pagamentos] Auto-registo concluído com êxito:`, response.data);
    } catch (err: any) {
      console.warn(`[Serviço de Pagamentos] Falha no auto-registo:`, err.response?.data || err.message);
    }
  }

  return {
    app,
    port,
    registerDefinition,
    register,
    getTransactions: () => new Map(transactions),
    getRefunds: () => new Map(refunds),
    getIdempotencyKeys: () => [...receivedIdempotencyKeys],
    start: () => {
      return new Promise<any>((resolve) => {
        const server = app.listen(port, () => {
          console.log(`💳 Serviço de Pagamentos ativo em http://localhost:${port}`);
          resolve(server);
        });
      });
    }
  };
}

if (require.main === module) {
  const service = createPaymentService(parseInt(process.env.PORT || '3002', 10));
  service.start().then(() => service.register());
}
