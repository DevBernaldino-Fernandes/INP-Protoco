/**
 * @fileoverview Orquestrador de Inicialização do Ecossistema de Microserviços (start-ecosystem.ts)
 * @module Examples/EcommerceEcosystem/StartEcosystem
 * @description
 * Script utilitário que inicializa concorrentemente todos os microserviços do ecossistema
 * de comércio eletrónico (Inventário na porta 3001, Pagamentos na porta 3002,
 * Logística na porta 3003 e Notificações na porta 3004) e efetua o registo automático
 * das suas respetivas capacidades no Gateway central do protocolo INP.
 *
 * @security Inicializa os microserviços com portas isoladas e credenciais seguras de auto-registo.
 * @audit Permite subir um ambiente de demonstração completo para auditoria de fluxos e validação funcional.
 */

import { createInventoryService } from './services/inventory-service';
import { createPaymentService } from './services/payment-service';
import { createShippingService } from './services/shipping-service';
import { createNotificationService } from './services/notification-service';
import axios from 'axios';

/**
 * @description Inicializa todas as instâncias de microserviços e regista as suas capacidades no Gateway.
 *
 * @param {string} [gatewayUrl='http://localhost:3000'] - URL do Gateway INP.
 * @returns {Promise<object>} Objeto contendo as instâncias de servidor e método para paragem conjunta (`stopAll`).
 * @audit Regista na consola de operações os endpoints locais de cada nó inicializado.
 */
export async function startAllServices(gatewayUrl = 'http://localhost:3000') {
  console.log('================================================================');
  console.log('  🚀 A INICIALIZAR ECOSSISTEMA DE MICROSERVIÇOS (GLOBAL SHOP)   ');
  console.log('================================================================\n');

  const inventory = createInventoryService(3001, gatewayUrl);
  const payment = createPaymentService(3002, gatewayUrl);
  const shipping = createShippingService(3003, gatewayUrl);
  const notification = createNotificationService(3004, gatewayUrl);

  const servers = await Promise.all([
    inventory.start(),
    payment.start(),
    shipping.start(),
    notification.start()
  ]);

  console.log('\n⏳ A registar capacidades no Gateway INP...\n');

  // Intervalo breve para estabilização dos sockets de rede
  await new Promise(r => setTimeout(r, 1000));

  await Promise.all([
    inventory.register(),
    payment.register(),
    shipping.register(),
    notification.register()
  ]);

  console.log('\n✅ Todos os 4 microserviços foram inicializados e registados com sucesso!');
  console.log('   - 📦 Inventário:   http://localhost:3001');
  console.log('   - 💳 Pagamentos:   http://localhost:3002');
  console.log('   - 🚚 Logística:    http://localhost:3003');
  console.log('   - 🔔 Notificações: http://localhost:3004\n');

  // Envio periódico de batimentos cardíacos (Heartbeat) a cada 20 segundos para manter os serviços ativos
  const serviceIds = [
    inventory.registerDefinition.id,
    payment.registerDefinition.id,
    shipping.registerDefinition.id,
    notification.registerDefinition.id
  ];

  const heartbeatInterval = setInterval(() => {
    serviceIds.forEach(id => {
      axios.post(`${gatewayUrl}/services/heartbeat/${id}`).catch(() => {});
    });
  }, 20000);

  return {
    servers,
    inventory,
    payment,
    shipping,
    notification,
    stopAll: () => {
      servers.forEach(s => s.close());
    }
  };
}

if (require.main === module) {
  startAllServices().catch(console.error);
}
