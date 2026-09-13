/**
 * @fileoverview Microserviço de Logística e Expedição de Encomendas (ShippingService)
 * @module Examples/EcommerceEcosystem/Services/ShippingService
 * @description
 * Microserviço responsável pela emissão de guias de transporte, agendamento de transportadoras
 * (`CREATE SHIPMENT`, `STORE ORDER`) e cancelamento de expedições (`CANCEL SHIPMENT`)
 * no âmbito de reversões do padrão Saga. Emite códigos de rastreio de entrega (`trackingCode`)
 * e suporta contingência de injeção de falhas controlada para testes de fiabilidade.
 *
 * @security Valida moradas e identificadores de cliente através de esquema JSON rigoroso.
 * @audit Cada expedição gera um código de rastreio atómico e histórico de cancelamento
 * auditável para fins de conformidade logística e contratual.
 */

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * @description Fábrica de criação e instanciação do microserviço de expedição e transporte.
 *
 * @param {number} [port=3003] - Porta TCP de escuta HTTP.
 * @param {string} [gatewayUrl='http://localhost:3000'] - URL do Gateway INP.
 * @returns {object} Instância configurada com aplicação Express e rotas de logística.
 */
export function createShippingService(port = 3003, gatewayUrl = 'http://localhost:3000') {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const REGISTRATION_TOKEN = process.env.INP_REGISTRATION_SECRET || 'inp-super-secret-registration-token-2026';
  const SELF_ENDPOINT = `http://localhost:${port}`;

  /** Registo em memória de expedições efetuadas indexadas por código de rastreio */
  const shipments = new Map<string, any>();
  /** Registo em memória de cancelamentos de expedição */
  const cancellations = new Map<string, any>();

  /** Estado corrente de injeção de caos */
  let chaosState: 'HEALTHY' | 'ERROR_500' = 'HEALTHY';

  /**
   * Rota de diagnóstico de saúde do serviço e contagem de expedições.
   */
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'shipping-service',
      shipmentCount: shipments.size,
      cancellationCount: cancellations.size
    });
  });

  /**
   * Rota para comutação de falhas de transporte (Engenharia de Caos).
   */
  app.post('/chaos', (req, res) => {
    const { state } = req.body;
    if (state === 'HEALTHY' || state === 'ERROR_500') {
      chaosState = state;
      console.log(`[Serviço de Expedição] Estado de caos configurado para: ${chaosState}`);
      if (state === 'ERROR_500') {
        setTimeout(() => {
          if (chaosState === 'ERROR_500') {
            chaosState = 'HEALTHY';
            console.log(`[Serviço de Expedição] Estado de caos reposto automaticamente para HEALTHY`);
          }
        }, 8000);
      }
      res.json({ success: true, chaosState });
    } else {
      res.status(400).json({ error: 'Estado de caos inválido' });
    }
  });

  /**
   * Rota de consulta de expedições e cancelamentos.
   */
  app.get('/shipments', (req, res) => {
    res.json({
      shipments: Object.fromEntries(shipments),
      cancellations: Object.fromEntries(cancellations)
    });
  });

  /**
   * Ponto de extremidade para emissão e cancelamento de expedições.
   */
  app.post('/execute', (req, res) => {
    if (chaosState === 'ERROR_500') {
      chaosState = 'HEALTHY'; // Reverte automaticamente após uma falha para permitir recuperação
      console.log(`[Serviço de Expedição] Erro de Caos 500 despoletado! Falha na transportadora. Estado reposto para HEALTHY.`);
      return res.status(500).json({ error: 'Falha na Transportadora Externa (Caos Simulado para Teste de Saga)' });
    }

    const { verb, target, context } = req.body;
    const v = (verb || '').toUpperCase();
    const t = (target || '').toUpperCase();
    const idempotencyKey = req.headers['x-idempotency-key'];

    console.log(`[Serviço de Expedição] Pedido recebido: ${v} ${t} | Chave: ${idempotencyKey || 'N/A'}`);

    // Capacidade 1: CREATE SHIPMENT / STORE ORDER
    if ((v === 'CREATE' && t === 'SHIPMENT') || (v === 'STORE' && t === 'ORDER')) {
      const address = context.shipping_address || 'Avenida da Liberdade, 100, Lisboa';
      const userId = context.user_id || context.customer_id || 'usr_desconhecido';
      const trackingCode = `TRK-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

      const shipmentRecord = {
        trackingCode,
        userId,
        address,
        carrier: 'FastLogistics Express Portugal',
        status: 'DISPATCHED',
        estimatedDays: 2,
        createdAt: new Date().toISOString()
      };

      shipments.set(trackingCode, shipmentRecord);
      console.log(`[Serviço de Expedição] Expedição criada! Rastreio: ${trackingCode} para ${userId} em ${address}`);

      return res.json({
        ...context,
        status: 'DISPATCHED',
        trackingCode,
        carrier: 'FastLogistics Express Portugal',
        estimatedDelivery: '2 dias úteis',
        address
      });
    }

    // Capacidade 2: CANCEL SHIPMENT (Compensação Transacional Saga)
    if (v === 'CANCEL' && t === 'SHIPMENT') {
      const trackingCode = context.trackingCode || 'TRK-DEFAULT';
      const cancellationId = `can_${Date.now()}`;

      cancellations.set(cancellationId, {
        trackingCode,
        cancelledAt: new Date().toISOString()
      });

      if (shipments.has(trackingCode)) {
        const item = shipments.get(trackingCode);
        item.status = 'CANCELLED';
      }

      console.log(`[Serviço de Expedição] [REVERSÃO SAGA] Expedição cancelada: Rastreio ${trackingCode}`);

      return res.json({
        status: 'CANCELLED',
        cancellationId,
        trackingCode
      });
    }

    return res.status(400).json({ error: `Capacidade não suportada: ${verb} ${target}` });
  });

  const registerDefinition = {
    id: `ecommerce-shipping-service-${port}`,
    name: 'E-Commerce Logistics & Shipping Service',
    description: 'Gera etiquetas de transporte, coordena transportadoras e processa cancelamentos',
    trustScore: 97,
    securityLevel: 'MEDIUM',
    endpoint: SELF_ENDPOINT,
    capabilities: [
      {
        verb: 'CREATE',
        target: 'SHIPMENT',
        description: 'Cria envio e gera código de rastreio',
        compensateCapability: 'CANCEL SHIPMENT',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            shipping_address: { type: 'string' }
          },
          required: ['user_id', 'shipping_address']
        }
      },
      {
        verb: 'STORE',
        target: 'ORDER',
        description: 'Regista encomenda concluída e gera expedição'
      },
      {
        verb: 'CANCEL',
        target: 'SHIPMENT',
        description: 'Cancela a etiqueta de expedição na reversão da Saga'
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
      console.log(`[Serviço de Expedição] Auto-registo concluído com êxito:`, response.data);
    } catch (err: any) {
      console.warn(`[Serviço de Expedição] Falha no auto-registo:`, err.response?.data || err.message);
    }
  }

  return {
    app,
    port,
    registerDefinition,
    register,
    getShipments: () => new Map(shipments),
    getCancellations: () => new Map(cancellations),
    start: () => {
      return new Promise<any>((resolve) => {
        const server = app.listen(port, () => {
          console.log(`🚚 Serviço de Expedição ativo em http://localhost:${port}`);
          resolve(server);
        });
      });
    }
  };
}

if (require.main === module) {
  const service = createShippingService(parseInt(process.env.PORT || '3003', 10));
  service.start().then(() => service.register());
}
