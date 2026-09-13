/**
 * @fileoverview Script de Validação do Fluxo Básico do Protocolo INP.
 * Testa o ciclo de vida completo: registo autenticado de serviço mock, consulta de catálogo,
 * envio de intenção estruturada (INP-DSL) e tradução de intenção em linguagem natural.
 *
 * @module Scripts/TestFlow
 * @security Valida o cabeçalho 'X-Registration-Token' na rota /services/register e o despacho seguro de intenções.
 * @audit Gera registos de auditoria nas tabelas services e executions para comprovar o ciclo de vida.
 */

const axios = require('axios');

/**
 * Executa sequencialmente os passos de teste de registo e execução de intenção.
 *
 * @returns {Promise<void>}
 */
async function test() {
  try {
    console.log('--- 1. A Registar Serviço Simulado de Pagamentos (Mock Payment) ---');
    const registerRes = await axios.post('http://localhost:3000/services/register', {
      id: 'mock-payment-service',
      name: 'Mock Payment Service',
      description: 'Gere operações de liquidação eletrónica de pagamentos',
      capabilities: [
        { verb: 'EXECUTE', target: 'PAYMENT', description: 'Process payments' }
      ],
      trustScore: 95,
      securityLevel: 'HIGH',
      endpoint: 'http://localhost:3001'
    }, {
      headers: { 'X-Registration-Token': 'inp-super-secret-registration-token-2026' }
    });
    console.log('Resposta do Registo do Serviço:', registerRes.data);

    console.log('\n--- 2. A Consultar Catálogo de Serviços Ativos ---');
    const servicesRes = await axios.get('http://localhost:3000/services');
    console.log('Serviços Registados:', JSON.stringify(servicesRes.data, null, 2));

    console.log('\n--- 3. A Processar Intenção Estruturada INP-DSL ---');
    const dslText = `
INTENT "buy_product" {
  CONTEXT { amount: 125.50, user_id: "usr_99" }
  REQUIRE { EXECUTE PAYMENT }
  FLOW { SEQUENCE { EXECUTE PAYMENT } }
  OUTPUT { FORMAT "json" }
}
    `.trim();

    const dslRes = await axios.post('http://localhost:3000/api/intent', {
      text: dslText,
      type: 'dsl'
    });
    console.log('Resultado da Execução DSL:', JSON.stringify(dslRes.data, null, 2));

    console.log('\n--- 4. A Processar Intenção em Linguagem Natural ---');
    const naturalRes = await axios.post('http://localhost:3000/api/intent', {
      text: 'Quero comprar o produto P10 com o valor de 450 euros e notificar user@example.com',
      type: 'natural'
    });
    console.log('Resultado da Execução em Linguagem Natural:', JSON.stringify(naturalRes.data, null, 2));

  } catch (err) {
    console.error('Falha no teste:', err.response ? err.response.data : err.message);
  }
}

// Disparo da bateria de testes de fluxo básico
test();
