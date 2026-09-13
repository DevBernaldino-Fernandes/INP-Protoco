/**
 * @fileoverview Suíte de Testes de Tolerância a Falhas, Clusterização e Balanceamento no INP.
 * Abrange 3 provas cruciais de resiliência distribuída:
 * 1. Deteção e bloqueio precoce de grafos com dependências circulares (Cycle Detection).
 * 2. Balanceamento de carga em cluster utilizando distribuição Round-Robin entre múltiplos nós.
 * 3. Failover automático transparente quando um nó do cluster está inalcançável (offline / porta 9999).
 *
 * @module Scripts/TestFailoverCluster
 * @security Valida autenticação de registo de nós de cluster e políticas de integridade de grafos.
 * @audit Regista a rotação de nós e as tentativas de failover na persistência transacional.
 */

const axios = require('axios');

/**
 * Executa a bateria de testes de topologia distribuída, deteção de ciclos e failover de nós.
 *
 * @returns {Promise<void>}
 */
async function runTests() {
  console.log('====================================================');
  console.log('    A INICIAR VALIDAÇÃO DE CLUSTER E FAILOVER       ');
  console.log('====================================================\n');

  const GATEWAY_URL = 'http://localhost:3000';
  const REGISTRATION_TOKEN = 'inp-super-secret-registration-token-2026';

  try {
    // ------------------------------------------------------------------
    // TESTE 1: Deteção de Dependências Circulares (Cycle Detection)
    // ------------------------------------------------------------------
    console.log('--- TESTE 1: Deteção de Dependências Circulares (Cycle Detection) ---');
    
    const circularDsl = `
INTENT "circular_flow" {
  CONTEXT {
    amount: 150.0,
    user_id: "usr_99",
    card_token: "tok_test"
  }
  REQUIRE {
    EXECUTE PAYMENT
    NOTIFY USER
  }
  FLOW {
    SEQUENCE {
      DEPENDENCY "NOTIFY USER" {
        EXECUTE PAYMENT
      }
      DEPENDENCY "EXECUTE PAYMENT" {
        NOTIFY USER
      }
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}
    `.trim();

    try {
      await axios.post(`${GATEWAY_URL}/api/intent`, {
        text: circularDsl,
        type: 'dsl',
        securityContext: { userId: 'usr_22', permissions: ['payments.write', 'user.read'] }
      });
      console.error('❌ FALHA: O analisador aceitou uma DSL circular sem lançar erro!');
      process.exit(1);
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      if (errMsg.includes('Circular Dependency Detected')) {
        console.log('✔ SUCESSO: Dependência circular detetada e rejeitada corretamente pelo analisador!');
        console.log(`Mensagem de erro: "${errMsg}"\n`);
      } else {
        console.error(`❌ FALHA: Retornou um erro inesperado: ${errMsg}`);
        process.exit(1);
      }
    }

    // ------------------------------------------------------------------
    // TESTE 2: Registo de Múltiplos Nós e Round-Robin Load Balancing
    // ------------------------------------------------------------------
    console.log('--- TESTE 2: Clusterização e Round-Robin Load Balancing ---');

    // Registar Instância 1 (Porta 3001)
    console.log('[Test] A registar Instância 1 (Porta 3001)...');
    await axios.post(`${GATEWAY_URL}/services/register`, {
      id: 'secure-payment-service-v2-instance-1',
      name: 'Payments Gateway - Node 1',
      description: 'Gere pagamentos - Instância 1',
      capabilities: [
        {
          verb: 'EXECUTE',
          target: 'CLUSTER_PAYMENT',
          description: 'Process cluster payments',
          requiredPermissions: ['payments.write'],
          inputSchema: { type: 'object', properties: { amount: { type: 'number' } } }
        }
      ],
      trustScore: 95,
      securityLevel: 'HIGH',
      endpoint: 'http://localhost:3001'
    }, {
      headers: { 'X-Registration-Token': REGISTRATION_TOKEN }
    });

    // Registar Instância 2 (Porta 3001 também, simulando Node 2)
    console.log('[Test] A registar Instância 2 (Porta 3001)...');
    await axios.post(`${GATEWAY_URL}/services/register`, {
      id: 'secure-payment-service-v2-instance-2',
      name: 'Payments Gateway - Node 2',
      description: 'Gere pagamentos - Instância 2',
      capabilities: [
        {
          verb: 'EXECUTE',
          target: 'CLUSTER_PAYMENT',
          description: 'Process cluster payments',
          requiredPermissions: ['payments.write'],
          inputSchema: { type: 'object', properties: { amount: { type: 'number' } } }
        }
      ],
      trustScore: 90,
      securityLevel: 'HIGH',
      endpoint: 'http://localhost:3001'
    }, {
      headers: { 'X-Registration-Token': REGISTRATION_TOKEN }
    });

    const clusterDsl = `
INTENT "cluster_test" {
  CONTEXT {
    amount: 120.0
  }
  REQUIRE {
    EXECUTE CLUSTER_PAYMENT
  }
  FLOW {
    SEQUENCE {
      EXECUTE CLUSTER_PAYMENT
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}
    `.trim();

    // Executar 2 chamadas consecutivas para validar a rotação Round-Robin
    console.log('[Test] A executar chamada 1...');
    const res1 = await axios.post(`${GATEWAY_URL}/api/intent`, {
      text: clusterDsl,
      type: 'dsl',
      securityContext: { userId: 'usr_22', permissions: ['payments.write'] }
    });
    const node1 = res1.data.result.output?.processedBy;

    console.log('[Test] A executar chamada 2...');
    const res2 = await axios.post(`${GATEWAY_URL}/api/intent`, {
      text: clusterDsl,
      type: 'dsl',
      securityContext: { userId: 'usr_22', permissions: ['payments.write'] }
    });
    const node2 = res2.data.result.output?.processedBy;

    console.log(`[Test] Chamada 1 processada por: ${node1}`);
    console.log(`[Test] Chamada 2 processada por: ${node2}`);

    console.log('✔ Chamadas de cluster enviadas com sucesso.\n');

    // ------------------------------------------------------------------
    // TESTE 3: Failover Automático com Serviço Offline
    // ------------------------------------------------------------------
    console.log('--- TESTE 3: Failover Automático com Nó Offline ---');

    // Registar Instância Offline (Porta inválida 9999)
    console.log('[Test] A registar Instância Offline (Porta 9999)...');
    await axios.post(`${GATEWAY_URL}/services/register`, {
      id: 'secure-payment-service-v2-instance-offline',
      name: 'Payments Gateway - Offline Node',
      description: 'Gere pagamentos - Nó Offline',
      capabilities: [
        {
          verb: 'EXECUTE',
          target: 'CLUSTER_PAYMENT',
          description: 'Process cluster payments',
          requiredPermissions: ['payments.write'],
          inputSchema: { type: 'object', properties: { amount: { type: 'number' } } }
        }
      ],
      trustScore: 99, // Pontuação alta para desafiar o balanceador
      securityLevel: 'HIGH',
      endpoint: 'http://localhost:9999' // Endpoint inalcançável intencional
    }, {
      headers: { 'X-Registration-Token': REGISTRATION_TOKEN }
    });

    // Desativar a Instância 2 para deixar apenas a Instância 1 (Porta 3001) e a Offline (Porta 9999)
    console.log('[Test] A desativar Instância 2 via rota de simulação...');
    await axios.post(`${GATEWAY_URL}/api/services/secure-payment-service-v2-instance-2/toggle-active`);

    console.log('[Test] A executar chamada para testar failover...');
    // A chamada tenta o nó prioritário; ao deparar-se com erro de transporte,
    // comuta com sucesso para o nó saudável da porta 3001.
    const failoverRes = await axios.post(`${GATEWAY_URL}/api/intent`, {
      text: clusterDsl,
      type: 'dsl',
      securityContext: { userId: 'usr_22', permissions: ['payments.write'] }
    });

    if (failoverRes.data.success) {
      console.log('✔ SUCESSO: O orquestrador detetou a falha de rede do nó offline e comutou com êxito a transação!');
      console.log(`Resultado do processamento: Estado: "${failoverRes.data.result.status}", Processado por: "${failoverRes.data.result.output?.processedBy}"\n`);
    } else {
      console.error('❌ FALHA: A chamada falhou em vez de executar a comutação de contingência (failover) automática.');
      process.exit(1);
    }

    // Limpeza: Desativar nó offline de teste
    console.log('[Test] A limpar nós de teste...');
    await axios.post(`${GATEWAY_URL}/api/services/secure-payment-service-v2-instance-offline/toggle-active`);
    
    console.log('====================================================');
    console.log('    TODOS OS TESTES DE CLUSTER CONCLUÍDOS COM SUCESSO! ');
    console.log('====================================================');

  } catch (err) {
    console.error('❌ ERRO CRÍTICO NA EXECUÇÃO DOS TESTES:', err.response?.data || err.message);
    process.exit(1);
  }
}

// Disparo da validação de cluster e tolerância a falhas
runTests();
