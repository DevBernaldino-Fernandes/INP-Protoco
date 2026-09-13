/**
 * @fileoverview Microserviço de Notificações a Clientes do Ecossistema (NotificationService)
 * @module Examples/EcommerceEcosystem/Services/NotificationService
 * @description
 * Microserviço dedicado ao despacho de comunicações com clientes finais no ecossistema
 * de comércio eletrónico: confirmações de encomenda (`SEND CONFIRMATION`, `NOTIFY USER`)
 * e emissão de alertas prioritários (`SEND ALERT`) através de Email e SMS.
 * Mantém registo em memória das mensagens expedidas para conferência operacional.
 *
 * @security Não persiste credenciais nem segredos de autenticação nas mensagens enviadas.
 * @audit Gera identificadores atómicos de notificação (`notificationId`) com carimbos temporais
 * para comprovar o envio tempestivo de recibos comerciais e comprovativos de transação.
 */

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * @description Fábrica de criação e instanciação do microserviço de notificações.
 *
 * @param {number} [port=3004] - Porta TCP de escuta HTTP.
 * @param {string} [gatewayUrl='http://localhost:3000'] - URL do Gateway INP.
 * @returns {object} Instância configurada com aplicação Express e rotas de notificação.
 */
export function createNotificationService(port = 3004, gatewayUrl = 'http://localhost:3000') {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const REGISTRATION_TOKEN = process.env.INP_REGISTRATION_SECRET || 'inp-super-secret-registration-token-2026';
  const SELF_ENDPOINT = `http://localhost:${port}`;

  /** Histórico em memória de notificações expedidas */
  const dispatchedNotifications: any[] = [];

  /**
   * Rota de verificação de estado e contagem de notificações emitidas.
   */
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'notification-service',
      totalDispatched: dispatchedNotifications.length
    });
  });

  /**
   * Rota para consulta das notificações registadas.
   */
  app.get('/notifications', (req, res) => {
    res.json({ notifications: dispatchedNotifications });
  });

  /**
   * Ponto de extremidade para envio de confirmações e alertas.
   */
  app.post('/execute', (req, res) => {
    const { verb, target, context } = req.body;
    const v = (verb || '').toUpperCase();
    const t = (target || '').toUpperCase();
    const idempotencyKey = req.headers['x-idempotency-key'];

    console.log(`[Serviço de Notificações] Pedido recebido: ${v} ${t} | Chave: ${idempotencyKey || 'N/A'}`);

    if ((v === 'SEND' && t === 'CONFIRMATION') || (v === 'NOTIFY' && t === 'USER')) {
      const email = context.email || 'cliente@exemplo.com';
      const userId = context.user_id || context.customer_id || 'usr_desconhecido';
      const notificationId = `notif_${Date.now()}`;

      const item = {
        notificationId,
        userId,
        email,
        type: 'ORDER_CONFIRMATION',
        trackingCode: context.trackingCode || 'N/A',
        amount: context.amount || 0,
        sentAt: new Date().toISOString()
      };

      dispatchedNotifications.push(item);
      console.log(`[Serviço de Notificações] Email de confirmação expedido para: ${email} (Utilizador: ${userId})`);

      return res.json({
        ...context,
        status: 'DELIVERED',
        notificationId,
        recipient: email,
        channel: 'EMAIL',
        subject: 'A sua encomenda no Global Shop Hub foi confirmada com sucesso!'
      });
    }

    if (v === 'SEND' && t === 'ALERT') {
      const email = context.email || 'cliente@exemplo.com';
      const message = context.message || 'Alerta prioritário sobre a sua encomenda';
      const notificationId = `alert_${Date.now()}`;

      const item = {
        notificationId,
        email,
        type: 'ALERT',
        message,
        sentAt: new Date().toISOString()
      };

      dispatchedNotifications.push(item);
      console.log(`[Serviço de Notificações] Alerta prioritário expedido para: ${email}`);

      return res.json({
        status: 'DELIVERED',
        notificationId,
        recipient: email,
        channel: 'EMAIL_AND_SMS',
        message
      });
    }

    return res.status(400).json({ error: `Capacidade não suportada: ${verb} ${target}` });
  });

  const registerDefinition = {
    id: `ecommerce-notification-service-${port}`,
    name: 'E-Commerce Notification System',
    description: 'Expede recibos de encomenda, atualizações de envio e alertas via Email & SMS',
    trustScore: 95,
    securityLevel: 'LOW',
    endpoint: SELF_ENDPOINT,
    capabilities: [
      {
        verb: 'SEND',
        target: 'CONFIRMATION',
        description: 'Envia recibo e confirmação de encomenda ao cliente',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            email: { type: 'string' }
          },
          required: ['user_id', 'email']
        }
      },
      {
        verb: 'NOTIFY',
        target: 'USER',
        description: 'Notifica o utilizador da conclusão da encomenda'
      },
      {
        verb: 'SEND',
        target: 'ALERT',
        description: 'Emite um alerta operacional prioritário'
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
      console.log(`[Serviço de Notificações] Auto-registo concluído com êxito:`, response.data);
    } catch (err: any) {
      console.warn(`[Serviço de Notificações] Falha no auto-registo:`, err.response?.data || err.message);
    }
  }

  return {
    app,
    port,
    registerDefinition,
    register,
    getNotifications: () => [...dispatchedNotifications],
    start: () => {
      return new Promise<any>((resolve) => {
        const server = app.listen(port, () => {
          console.log(`🔔 Serviço de Notificações ativo em http://localhost:${port}`);
          resolve(server);
        });
      });
    }
  };
}

if (require.main === module) {
  const service = createNotificationService(parseInt(process.env.PORT || '3004', 10));
  service.start().then(() => service.register());
}
