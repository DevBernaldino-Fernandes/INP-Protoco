/**
 * @fileoverview Gestor Central de Notificações e Alertas Operacionais (AlertManager)
 * @module Core/AlertManager
 * @description
 * Gere o despacho de alertas críticos de incidentes, falhas permanentes de Sagas,
 * estouro de tentativas em filas (Dead Letter Queue) e anomalias de segurança.
 * Suporta o envio automatizado para webhooks HTTP externos (ex.: Slack, Discord, PagerDuty, Teams)
 * ou emissão estruturada para as consolas de monitorização e telemetria.
 *
 * @security Não expõe segredos ou credenciais em claro no payload dos alertas (higienizado previamente).
 * O envio assíncrono de alertas é protegido contra exceções para não interromper a execução do protocolo.
 * @audit Cada alerta despachado constitui um registo de incidente crítico sujeito a conferência em auditorias operacionais.
 */

import axios from 'axios';

/**
 * @description Gestor responsável por emitir avisos de incidentes a operadores e canais externos.
 */
export class AlertManager {
  /**
   * @description Envia uma notificação de alerta operacional.
   * Se a variável de ambiente `ALERT_WEBHOOK_URL` estiver configurada, efetua um pedido HTTP POST formatado;
   * caso contrário, emite uma mensagem estruturada na consola do sistema para simulação/desenvolvimento.
   *
   * @param {string} title - Título sumário do incidente ou notificação.
   * @param {any} details - Dados contextuais detalhados e carga útil associada ao erro.
   * @returns {Promise<void>} Promessa resolvida após o envio ou registo do alerta.
   * @security Encapsula a chamada externa num bloco try/catch para garantir que uma falha no webhook
   * nunca derruba o fluxo transacional principal.
   * @audit Regista carimbo temporal e detalhes forenses do erro para auditoria pós-incidente.
   */
  static async sendAlert(title: string, details: any): Promise<void> {
    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    if (!webhookUrl) {
      console.log(`[Alert Manager] [Alerta Simulado] ${title}:`, JSON.stringify(details, null, 2));
      return;
    }

    try {
      console.log(`[Alert Manager] A despachar alerta via webhook para: ${title}`);
      await axios.post(webhookUrl, {
        text: `⚠️ *[ALERTA DE SISTEMA INP]*: ${title}\n*Carimbo Temporal:* ${new Date().toISOString()}\n*Detalhes:* \`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\``
      });
      console.log('[Alert Manager] Notificação de webhook transmitida com sucesso.');
    } catch (err: any) {
      console.error('[Alert Manager] Falha ao expedir notificação via webhook:', err.message);
    }
  }
}
