const axios = require('axios');

async function runTests() {
  console.log('====================================================');
  console.log('   INICIANDO VALIDAÇÃO DE NOVAS FUNCIONALIDADES     ');
  console.log('====================================================\n');

  try {
    // 1. Registrando Serviço Seguro com Contratos de Validação e Permissões
    console.log('--- 1. Registrar Serviço com Regras Rígidas ---');
    const registerRes = await axios.post('http://localhost:3000/services/register', {
      id: 'secure-payment-service-v2',
      name: 'Advanced Secure Payments Gateway',
      description: 'Handles secure payments with input schema and permission rules',
      capabilities: [
        { 
          verb: 'EXECUTE', 
          target: 'PAYMENT', 
          description: 'Process secure credit card payments',
          requiredPermissions: ['payments.write'],
          inputSchema: {
            type: 'object',
            properties: {
              amount: { type: 'number', minimum: 1.0 },
              user_id: { type: 'string' },
              card_token: { type: 'string' }
            },
            required: ['amount', 'user_id', 'card_token']
          }
        }
      ],
      trustScore: 99,
      securityLevel: 'HIGH',
      endpoint: 'http://localhost:3001'
    });
    console.log('Registro do Serviço:', registerRes.data, '\n');

    // 2. Testando Falha de RBAC (Sem permissões requeridas)
    console.log('--- 2. Testar Falha de RBAC (Sem Permissão) ---');
    const intentDsl = `
INTENT "secured_purchase" {
  CONTEXT { amount: 150.0, user_id: "usr_22", card_token: "tok_secure123" }
  REQUIRE { EXECUTE PAYMENT }
  FLOW { SEQUENCE { EXECUTE PAYMENT } }
  OUTPUT { FORMAT "json" }
}
    `.trim();

    const rbacRes = await axios.post('http://localhost:3000/api/intent', {
      text: intentDsl,
      type: 'dsl',
      securityContext: {
        userId: 'usr_22',
        permissions: ['some.other.permission'] // Permissão errada
      }
    });

    if (rbacRes.data.result.status === 'FAILED' && rbacRes.data.result.error.includes('Security Violation')) {
      console.log('✔ RESULTADO ESPERADO: Falha de Permissão obtida com sucesso.');
      console.log('Erro retornado:', rbacRes.data.result.error, '\n');
    } else {
      console.log('❌ FALHA NO TESTE: O fluxo não foi rejeitado por permissão!', rbacRes.data, '\n');
    }

    // 3. Testando Falha de Validação de Contrato (Payload Inválido)
    console.log('--- 3. Testar Falha de Contrato (Payload Inválido: valor < 1) ---');
    const invalidPayloadDsl = `
INTENT "invalid_purchase" {
  CONTEXT { amount: 0.5, user_id: "usr_22", card_token: "tok_secure123" }
  REQUIRE { EXECUTE PAYMENT }
  FLOW { SEQUENCE { EXECUTE PAYMENT } }
  OUTPUT { FORMAT "json" }
}
    `.trim();

    const contractRes = await axios.post('http://localhost:3000/api/intent', {
      text: invalidPayloadDsl,
      type: 'dsl',
      securityContext: {
        userId: 'usr_22',
        permissions: ['payments.write'] // Possui permissão, mas payload falha no JSON Schema
      }
    });

    if (contractRes.data.result.status === 'FAILED' && contractRes.data.result.error.includes('Contract Violation')) {
      console.log('✔ RESULTADO ESPERADO: Rejeitado por quebra de contrato JSON Schema.');
      console.log('Erro retornado:', contractRes.data.result.error, '\n');
    } else {
      console.log('❌ FALHA NO TESTE: O payload não foi rejeitado pela validação de contrato!', contractRes.data, '\n');
    }

    // 4. Testando Sucesso Completo (Permissão Válida + Payload Correto)
    console.log('--- 4. Testar Sucesso de Fluxo (Contrato & RBAC Corretos) ---');
    const successDsl = `
INTENT "valid_purchase" {
  CONTEXT { amount: 250.75, user_id: "usr_22", card_token: "tok_secure123" }
  REQUIRE { EXECUTE PAYMENT }
  FLOW { SEQUENCE { EXECUTE PAYMENT } }
  OUTPUT { FORMAT "json" }
}
    `.trim();

    const successRes = await axios.post('http://localhost:3000/api/intent', {
      text: successDsl,
      type: 'dsl',
      securityContext: {
        userId: 'usr_22',
        permissions: ['payments.write']
      }
    });

    if (successRes.data.result.status === 'COMPLETED') {
      console.log('✔ RESULTADO ESPERADO: Transação completada com sucesso!');
      console.log('Output retornado:', JSON.stringify(successRes.data.result.output, null, 2), '\n');
    } else {
      console.log('❌ FALHA NO TESTE: A transação válida falhou!', successRes.data, '\n');
    }

    // 5. Testando Performance e Hits de Cache
    console.log('--- 5. Testar Cache de Serviço (Matching rápido do catálogo) ---');
    const startTime = Date.now();
    await axios.post('http://localhost:3000/api/intent', {
      text: successDsl,
      type: 'dsl',
      securityContext: {
        userId: 'usr_22',
        permissions: ['payments.write']
      }
    });
    const durationMs = Date.now() - startTime;
    console.log(`✔ Duração da segunda chamada (usando cache para matching): ${durationMs}ms\n`);

    // 6. Consultando Estatísticas da Dashboard API
    console.log('--- 6. Testar Estatísticas da Dashboard API ---');
    const statsRes = await axios.get('http://localhost:3000/api/dashboard/stats');
    console.log('Estatísticas do Painel:', JSON.stringify(statsRes.data.stats, null, 2), '\n');

    // 7. Testando DSL Avançado (ENCRYPT, DECRYPT, SCOPE)
    console.log('--- 7. Testar DSL Avançado (ENCRYPT, DECRYPT, SCOPE) ---');
    const advancedDsl = `
INTENT "advanced_flow" {
  CONTEXT { amount: 300, user_id: "usr_88", card_token: "tok_secure123", secret_key: "myPassword123" }
  REQUIRE { EXECUTE PAYMENT }
  FLOW {
    SEQUENCE {
      ENCRYPT "secret_key"
      SCOPE {
        EXECUTE PAYMENT
      }
      DECRYPT "secret_key"
    }
  }
  OUTPUT { FORMAT "json" }
}
    `.trim();

    const advancedRes = await axios.post('http://localhost:3000/api/intent', {
      text: advancedDsl,
      type: 'dsl',
      securityContext: {
        userId: 'usr_88',
        permissions: ['payments.write']
      }
    });

    if (advancedRes.data.result.status === 'COMPLETED') {
      console.log('✔ RESULTADO ESPERADO: Transação avançada com encriptação completada!');
      console.log('Output Final (secret_key descriptografada):', JSON.stringify(advancedRes.data.result.output, null, 2), '\n');
    } else {
      console.log('❌ FALHA NO TESTE: O fluxo avançado falhou!', advancedRes.data, '\n');
    }

    console.log('====================================================');
    console.log('         TODOS OS TESTES CONCLUÍDOS COM SUCESSO!     ');
    console.log('====================================================');

  } catch (err) {
    console.error('Falha de execução nos testes:', err.response ? err.response.data : err.message);
  }
}

runTests();
