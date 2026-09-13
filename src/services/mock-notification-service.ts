/**
 * @fileoverview Microserviço Simulado de Notificações a Utilizadores (MockNotificationService)
 * @module Services/MockNotificationService
 * @description
 * Microserviço de teste responsável pela emissão simulada de notificações (`NOTIFY USER`)
 * aos utilizadores finais via correio eletrónico (email) ou SMS.
 * Suporta injeção de estados de falha e latência para testes de tolerância a falhas
 * e auto-regista-se no gateway INP via HTTP.
 *
 * @security Não expõe dados privados de contacto em ficheiros de log permanentes.
 * Utiliza token `X-Registration-Token` para autenticar o auto-registo.
 * @audit Gera um `messageId` com carimbo temporal para comprovar a expedição do aviso.
 */

import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

// Configuração da porta de escuta do serviço (por omissão: 3003)
let PORT = parseInt(process.env.PORT || '3003', 10);
if (PORT === 3000) {
  PORT = 3003;
}
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const REGISTRATION_TOKEN = process.env.INP_REGISTRATION_SECRET || 'inp-super-secret-registration-token-2026';
const SELF_ENDPOINT = process.env.SELF_ENDPOINT || `http://localhost:${PORT}`;

/**
 * Estado corrente de simulação de caos operacional.
 */
let chaosState: 'HEALTHY' | 'ERROR_500' | 'LATENCY_5S' = 'HEALTHY';

/**
 * Rota para manipulação de injeção de falhas (Engenharia de Caos).
 */
app.post('/chaos', (req, res) => {
  const { state } = req.body;
  if (state === 'HEALTHY' || state === 'ERROR_500' || state === 'LATENCY_5S') {
    chaosState = state;
    console.log(`[Notificações Simuladas] Estado de caos atualizado para: ${chaosState}`);
    res.json({ success: true, state: chaosState });
  } else {
    res.status(400).json({ error: 'Estado de caos inválido' });
  }
});

/**
 * Ponto de extremidade para execução de notificações.
 */
app.post('/execute', (req, res) => {
  // Simulação de erro interno de servidor
  if (chaosState === 'ERROR_500') {
    console.log(`[Notificações Simuladas] A simular Erro de Caos 500`);
    return res.status(500).json({ error: 'Erro Interno de Servidor (Engenharia de Caos)' });
  }

  const proceed = () => {
    const { verb, target, context } = req.body;
    const normalizedVerb = verb.toUpperCase();
    const normalizedTarget = target.toUpperCase();

    console.log(`[Notificações Simuladas] A executar: ${normalizedVerb} ${normalizedTarget}`, context);

    if (normalizedVerb === 'NOTIFY' && normalizedTarget === 'USER') {
      const email = context.email || 'utilizador@exemplo.com';
      console.log(`[Notificações Simuladas] A expedir notificação para: ${email}`);
      res.json({
        notificationStatus: 'sent',
        recipient: email,
        messageId: `msg_${Date.now()}`
      });
    } else {
      console.warn(`[Notificações Simuladas] Capacidade desconhecida: ${verb} ${target}`);
      res.status(400).json({ error: `Capacidade desconhecida: ${verb} ${target}` });
    }
  };

  // Simulação de latência de rede
  if (chaosState === 'LATENCY_5S') {
    console.log(`[Notificações Simuladas] A simular Latência de Caos de 5s`);
    setTimeout(proceed, 5000);
  } else {
    proceed();
  }
});

// Inicialização e auto-registo
app.listen(PORT, () => {
  console.log(`🔔 Microserviço Simulado de Notificações em escuta na porta ${PORT}`);

  setTimeout(async () => {
    try {
      await axios.post(`${GATEWAY_URL}/services/register`, {
        id: 'mock-notification-service-' + PORT,
        name: 'Mock Notification System',
        description: 'Envia notificações aos utilizadores via email ou SMS',
        capabilities: [
          {
            verb: 'NOTIFY',
            target: 'USER',
            description: 'Notifica o utilizador da conclusão do fluxo transacional'
          }
        ],
        trustScore: 100,
        securityLevel: 'LOW',
        endpoint: SELF_ENDPOINT
      }, {
        headers: { 'X-Registration-Token': REGISTRATION_TOKEN }
      });
      console.log('[Notificações Simuladas] Registado com sucesso no Gateway INP.');
    } catch (err: any) {
      console.warn('[Notificações Simuladas] Falha no auto-registo: ', err.response ? err.response.data : err.message);
    }
  }, 4000);
});
