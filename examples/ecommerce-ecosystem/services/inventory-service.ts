/**
 * @fileoverview Microserviço de Gestão de Armazém e Stock do Ecossistema (InventoryService)
 * @module Examples/EcommerceEcosystem/Services/InventoryService
 * @description
 * Microserviço autônomo do ecossistema de comércio eletrónico que gere o catálogo físico
 * de armazém, reservas de artigos (`CHECK STOCK`, `RESERVE STOCK`) e compensações transacionais
 * no padrão Saga (`RESTORE STOCK`, `RESTORE INVENTORY`).
 * Regista-se de forma autónoma no gateway INP com esquemas formais de validação (JSON Schema)
 * e suporta simulação de contingências e falhas (Chaos Engineering).
 *
 * @security Valida montantes mínimos e tipos de dados no esquema JSON, além de exigir o token
 * `X-Registration-Token` durante o auto-registo.
 * @audit Permite rastrear identificadores de reserva atómicos (`reservationId`) para verificação
 * de consistência eventual em auditorias transacionais.
 */

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * @description Fábrica de criação e instanciação do microserviço de inventário e armazém.
 *
 * @param {number} [port=3001] - Porta TCP de escuta HTTP.
 * @param {string} [gatewayUrl='http://localhost:3000'] - URL base do Gateway INP.
 * @returns {object} Instância configurada com aplicação Express, rotas e métodos de arranque.
 */
export function createInventoryService(port = 3001, gatewayUrl = 'http://localhost:3000') {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const REGISTRATION_TOKEN = process.env.INP_REGISTRATION_SECRET || 'inp-super-secret-registration-token-2026';
  const SELF_ENDPOINT = `http://localhost:${port}`;

  /**
   * Catálogo de artigos e quantidades em stock mantido em memória para testes.
   */
  const stockInventory: Record<string, number> = {
    LAPTOP_PRO: 25,
    SMARTPHONE_X: 40,
    HEADPHONES: 100
  };

  /**
   * Registo ativo de reservas pendentes indexadas por identificador de reserva (Saga tracking).
   */
  const activeReservations = new Map<string, { productId: string; quantity: number; createdAt: string }>();

  /**
   * Estado de injeção de caos operacional.
   */
  let chaosState: 'HEALTHY' | 'ERROR_500' = 'HEALTHY';

  /**
   * Rota de verificação de saúde e estado de stock atual.
   */
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'inventory-service', stock: stockInventory });
  });

  /**
   * Rota de injeção de caos para testes de resiliência.
   */
  app.post('/chaos', (req, res) => {
    const { state } = req.body;
    if (state === 'HEALTHY' || state === 'ERROR_500') {
      chaosState = state;
      console.log(`[Serviço de Inventário] Estado de caos configurado para: ${chaosState}`);
      res.json({ success: true, chaosState });
    } else {
      res.status(400).json({ error: 'Estado de caos inválido' });
    }
  });

  /**
   * Rota para consulta de reservas ativas em armazém.
   */
  app.get('/reservations', (req, res) => {
    res.json({ reservations: Object.fromEntries(activeReservations) });
  });

  /**
   * Ponto de extremidade para processamento e compensação de stock.
   */
  app.post('/execute', (req, res) => {
    if (chaosState === 'ERROR_500') {
      console.log(`[Serviço de Inventário] Erro de Caos 500 despoletado!`);
      return res.status(500).json({ error: 'Falha do Serviço de Inventário (Caos Simulado)' });
    }

    const { verb, target, context } = req.body;
    const v = (verb || '').toUpperCase();
    const t = (target || '').toUpperCase();
    const idempotencyKey = req.headers['x-idempotency-key'];

    console.log(`[Serviço de Inventário] Pedido recebido: ${v} ${t} | Chave de Idempotência: ${idempotencyKey || 'N/A'}`);

    // Capacidade 1: CHECK STOCK / FETCH INVENTORY
    if ((v === 'CHECK' || v === 'FETCH') && (t === 'STOCK' || t === 'INVENTORY')) {
      const productId = context.productId || context.product_id || 'LAPTOP_PRO';
      const quantity = Number(context.quantity || 1);
      const available = stockInventory[productId] || 0;

      if (available >= quantity) {
        return res.json({
          ...context,
          status: 'AVAILABLE',
          productId,
          requested: quantity,
          inStock: available
        });
      } else {
        return res.status(400).json({
          error: `Stock insuficiente para ${productId}. Disponível: ${available}, Solicitado: ${quantity}`
        });
      }
    }

    // Capacidade 2: RESERVE STOCK (Ação Transacional Saga)
    if (v === 'RESERVE' && t === 'STOCK') {
      const productId = context.productId || 'LAPTOP_PRO';
      const quantity = Number(context.quantity || 1);
      const available = stockInventory[productId] || 0;

      if (available < quantity) {
        return res.status(400).json({
          error: `Não é possível reservar stock. Disponível: ${available}, Solicitado: ${quantity}`
        });
      }

      stockInventory[productId] -= quantity;
      const reservationId = `res_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      activeReservations.set(reservationId, {
        productId,
        quantity,
        createdAt: new Date().toISOString()
      });

      console.log(`[Serviço de Inventário] Reservadas ${quantity} unidades de ${productId}. Reserva ID: ${reservationId}. Stock restante: ${stockInventory[productId]}`);

      return res.json({
        ...context,
        status: 'RESERVED',
        reservationId,
        productId,
        quantityReserved: quantity,
        remainingStock: stockInventory[productId]
      });
    }

    // Capacidade 3: RESTORE STOCK / RESTORE INVENTORY (Compensação Transacional Saga)
    if (v === 'RESTORE' && (t === 'STOCK' || t === 'INVENTORY')) {
      const reservationId = context.reservationId;
      console.log(`[Serviço de Inventário] [REVERSÃO SAGA] A repor stock para a reserva: ${reservationId}`);

      let restoredQuantity = 0;
      let targetProduct = context.productId || context.product_id || 'LAPTOP_PRO';

      if (reservationId && activeReservations.has(reservationId)) {
        const item = activeReservations.get(reservationId)!;
        targetProduct = item.productId;
        restoredQuantity = item.quantity;
        activeReservations.delete(reservationId);
      } else {
        restoredQuantity = Number(context.quantity || context.quantityReserved || 1);
      }

      stockInventory[targetProduct] = (stockInventory[targetProduct] || 0) + restoredQuantity;
      console.log(`[Serviço de Inventário] [REVERSÃO CONCLUÍDA] Artigo: ${targetProduct}, Reposto: ${restoredQuantity}, Novo Stock: ${stockInventory[targetProduct]}`);

      return res.json({
        status: 'RESTORED',
        reservationId,
        productId: targetProduct,
        restoredQuantity,
        currentStock: stockInventory[targetProduct]
      });
    }

    return res.status(400).json({ error: `Capacidade não suportada: ${verb} ${target}` });
  });

  const registerDefinition = {
    id: `ecommerce-inventory-service-${port}`,
    name: 'E-Commerce Inventory & Warehouse System',
    description: 'Gere stock físico de armazém, reservas e compensações Saga',
    trustScore: 98,
    securityLevel: 'HIGH',
    endpoint: SELF_ENDPOINT,
    capabilities: [
      {
        verb: 'CHECK',
        target: 'STOCK',
        description: 'Verifica a disponibilidade atual de stock em armazém',
        inputSchema: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            quantity: { type: 'number', minimum: 1 }
          },
          required: ['productId', 'quantity']
        }
      },
      {
        verb: 'FETCH',
        target: 'INVENTORY',
        description: 'Consulta stock em armazém'
      },
      {
        verb: 'RESERVE',
        target: 'STOCK',
        description: 'Reserva stock físico para uma encomenda de cliente',
        compensateCapability: 'RESTORE STOCK',
        inputSchema: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            quantity: { type: 'number', minimum: 1 }
          },
          required: ['productId', 'quantity']
        }
      },
      {
        verb: 'RESTORE',
        target: 'STOCK',
        description: 'Compensa reserva de stock caso a encomenda falhe (Rollback Saga)'
      },
      {
        verb: 'RESTORE',
        target: 'INVENTORY',
        description: 'Compensa reserva de stock caso a encomenda falhe (Rollback Saga)'
      }
    ]
  };

  /**
   * @description Regista o microserviço no gateway central INP.
   */
  async function register() {
    try {
      const response = await axios.post(`${gatewayUrl}/services/register`, registerDefinition, {
        headers: {
          'Content-Type': 'application/json',
          'X-Registration-Token': REGISTRATION_TOKEN
        }
      });
      console.log(`[Serviço de Inventário] Auto-registo concluído com êxito:`, response.data);
    } catch (err: any) {
      console.warn(`[Serviço de Inventário] Falha no auto-registo:`, err.response?.data || err.message);
    }
  }

  return {
    app,
    port,
    registerDefinition,
    register,
    getInventory: () => ({ ...stockInventory }),
    getReservations: () => new Map(activeReservations),
    start: () => {
      return new Promise<any>((resolve) => {
        const server = app.listen(port, () => {
          console.log(`📦 Serviço de Inventário ativo em http://localhost:${port}`);
          resolve(server);
        });
      });
    }
  };
}

if (require.main === module) {
  const service = createInventoryService(parseInt(process.env.PORT || '3001', 10));
  service.start().then(() => service.register());
}
