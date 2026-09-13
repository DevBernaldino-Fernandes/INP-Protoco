/**
 * @fileoverview Script de Teste Rápido de Fumo (Smoke Test) para Orquestração de Intenções.
 * Submete uma intenção DSL completa de e-commerce diretamente ao Gateway INP (:3000)
 * para validar a saúde operacional de todos os microsserviços integrados no fluxo de checkout.
 *
 * @module Scripts/TestQuick
 * @security Submete credenciais e contexto de segurança com a permissão 'payments.write'.
 * @audit Permite comprovar a composição correta dos identificadores de reserva, transação e logística.
 */

const axios = require('axios');

/**
 * Dispara uma intenção DSL de finalização de compra rápida contra a API do Gateway INP.
 *
 * @returns {Promise<void>}
 */
async function testCheckout() {
  const dsl = `
INTENT "quick_checkout" {
  CONTEXT {
    amount: 1999.0,
    user_id: "usr_buyer_42",
    card_token: "tok_visa_infinite_99",
    productId: "LAPTOP_PRO",
    quantity: 1,
    email: "cliente@globalshop.com",
    shipping_address: "Avenida da Liberdade 100, Lisboa"
  }
  REQUIRE {
    CHECK STOCK
    RESERVE STOCK
    EXECUTE PAYMENT
    CREATE SHIPMENT
    SEND CONFIRMATION
  }
  FLOW {
    SEQUENCE {
      CHECK STOCK
      RESERVE STOCK
      EXECUTE PAYMENT
      CREATE SHIPMENT
      SEND CONFIRMATION
    }
  }
  OUTPUT { FORMAT "json" }
}
  `.trim();

  try {
    const res = await axios.post('http://localhost:3000/api/intent', {
      text: dsl,
      type: 'dsl',
      securityContext: {
        userId: 'usr_buyer_42',
        permissions: ['payments.write']
      }
    });

    console.log('ESTADO:', res.data.result.status);
    console.log('CÓDIGO DE RASTREIO:', res.data.result.output.trackingCode);
    console.log('ID DA TRANSAÇÃO:', res.data.result.output.transactionId);
    console.log('ID DA RESERVA:', res.data.result.output.reservationId);
    console.log('SUCESSO! Encomenda processada com êxito pelo INP Protocol!');
  } catch (err) {
    console.error('ERRO:', err.response ? err.response.data : err.message);
  }
}

// Disparo imediato do teste de fumo
testCheckout();
