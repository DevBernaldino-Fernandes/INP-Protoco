const axios = require('axios');

async function test() {
  try {
    console.log('--- 1. Registering Mock Payment Service ---');
    const registerRes = await axios.post('http://localhost:3000/services/register', {
      id: 'mock-payment-service',
      name: 'Mock Payment Service',
      description: 'Handles electronic payment operations',
      capabilities: [
        { verb: 'EXECUTE', target: 'PAYMENT', description: 'Process payments' }
      ],
      trustScore: 95,
      securityLevel: 'HIGH',
      endpoint: 'http://localhost:3001'
    });
    console.log('Register Service Response:', registerRes.data);

    console.log('\n--- 2. Checking Registered Services ---');
    const servicesRes = await axios.get('http://localhost:3000/services');
    console.log('Registered Services:', JSON.stringify(servicesRes.data, null, 2));

    console.log('\n--- 3. Processing DSL Intent ---');
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
    console.log('DSL Execution Result:', JSON.stringify(dslRes.data, null, 2));

    console.log('\n--- 4. Processing Natural Language Intent ---');
    const naturalRes = await axios.post('http://localhost:3000/api/intent', {
      text: 'Quero comprar o produto P10 com o valor de 450 euros e notificar user@example.com',
      type: 'natural'
    });
    console.log('Natural Language Execution Result:', JSON.stringify(naturalRes.data, null, 2));

  } catch (err) {
    console.error('Test failed:', err.response ? err.response.data : err.message);
  }
}

test();
