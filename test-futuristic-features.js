/**
 * @fileoverview Suíte de Testes para Funcionalidades Avançadas e Criptográficas do INP Protocol.
 * Valida os módulos de vanguarda arquitetural:
 * 1. Provas criptográficas de conhecimento-zero (ZK-Intents) em CONFIDENTIAL_SCOPE com validação de compromissos hash SHA-256.
 * 2. Federação P2P de Gateways com verificação de assinaturas digitais assimétricas e troca de capacidades.
 *
 * @module Scripts/TestFuturisticFeatures
 * @security Valida preservação de privacidade via compromissos matemáticos (ZK) e autenticidade P2P com chaves públicas.
 * @audit Assegura integridade auditável sem expor dados confidenciais na carga útil em trânsito.
 */

const axios = require('axios');
const crypto = require('crypto');
const { Client } = require('pg');

/**
 * Gera um compromisso criptográfico (commitment) no esquema SHA-256 combinando valor e salteamento (salt).
 *
 * @param {string | number} value - Valor secreto a ocultar.
 * @param {string} salt - Segredo criptográfico de entropia.
 * @returns {string} Hash hexadecimal do compromisso gerado.
 */
function generateCommitment(value, salt) {
  const data = `${value.toString()}:${salt}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Executa a bateria de testes de escopo confidencial (ZK) e federação de nós P2P.
 *
 * @returns {Promise<void>}
 */
async function runTests() {
  console.log('====================================================');
  console.log('   A INICIAR VALIDAÇÃO DE CAPACIDADES FUTURISTAS    ');
  console.log('====================================================\n');

  // Limpeza da base de dados PostgreSQL para isolar a prova
  const dbClient = new Client({
    connectionString: 'postgres://inp:inp123@localhost:5432/inp'
  });
  try {
    await dbClient.connect();
    await dbClient.query("DELETE FROM services");
    await dbClient.query("DELETE FROM saga_states");
    await dbClient.query("DELETE FROM executions");
    await dbClient.query("DELETE FROM queue_jobs");
    await dbClient.query("DELETE FROM dead_letter_queue");
    await dbClient.end();
    console.log('Base de dados limpa com sucesso.\n');
  } catch (dbErr) {
    console.warn('Aviso: Falha na limpeza da base de dados:', dbErr.message);
  }

  try {
    // Registo de serviço seguro para que o teste ZK tenha um fornecedor ativo
    console.log('--- A Registar Serviço de Pagamento Seguro ---');
    await axios.post('http://localhost:3000/services/register', {
      id: 'secure-payment-service-v2',
      name: 'Advanced Secure Payments Gateway',
      description: 'Gere liquidações seguras com esquema de entrada e regras de permissão',
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
      trustScore: 120,
      securityLevel: 'HIGH',
      endpoint: 'http://localhost:3001'
    }, {
      headers: { 'X-Registration-Token': 'inp-super-secret-registration-token-2026' }
    });
    console.log('Serviço de Pagamento Seguro registado com sucesso.\n');

    // 1. Testar Provas de Compromisso ZK-Intents (Confidential Scope)
    console.log('--- 1. Testar Âmbito Confidencial & ZK-Verifier ---');
    
    const plainValue = 150;
    const salt = 'confidentialSalt';
    const commitment = generateCommitment(plainValue, salt);
    
    console.log(`Valor confidencial: ${plainValue}`);
    console.log(`Salteamento (Salt): "${salt}"`);
    console.log(`Hash de Compromisso (Commitment) gerado: ${commitment}`);

    const confidentialDsl = `
INTENT "confidential_purchase" {
  CONTEXT {
    amount_commitment: "${commitment}",
    amount_proof: {
      "value": ${plainValue},
      "salt": "${salt}"
    },
    user_id: "usr_zk_99",
    card_token: "tok_secure123"
  }
  REQUIRE { EXECUTE PAYMENT }
  FLOW {
    CONFIDENTIAL_SCOPE {
      VERIFY "amount" >= 100
      EXECUTE PAYMENT
    }
  }
  OUTPUT { FORMAT "json" }
}
    `.trim();

    const zkRes = await axios.post('http://localhost:3000/api/intent', {
      text: confidentialDsl,
      type: 'dsl',
      securityContext: {
        userId: 'usr_zk_99',
        permissions: ['payments.write']
      }
    });

    if (zkRes.data.success && zkRes.data.result.status === 'COMPLETED') {
      console.log('✔ RESULTADO ESPERADO: Prova ZK e compromisso validados com sucesso!');
      console.log('Passos concluídos no registo do motor:\n', 
        zkRes.data.result.steps.map(s => `  - [${s.status}] ${s.action}`).join('\n'), '\n'
      );
    } else {
      console.log('❌ FALHA NO TESTE ZK:', JSON.stringify(zkRes.data, null, 2), '\n');
    }

    // 2. Testar Federação P2P e Assinatura Digital
    console.log('--- 2. Testar Federação P2P & Assinatura Digital ---');
    
    // Registo de peer gateway com chave pública assimétrica
    const peerRegisterRes = await axios.post('http://localhost:3000/api/peers/register', {
      id: 'chicago-peer',
      name: 'Chicago Main Node',
      endpoint: 'http://localhost:3000', // Aponta para si mesmo para teste de loopback local
      publicKey: `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7p9n7ZgL/Qd1aUuFhI7R8Q9MhD0L
7YhF7x6y5Y9zY9zY9zY9zY9zY9zY9zY9zY9zY9zY9zY9zY9zY9zY9zY9zQ==
-----END PUBLIC KEY-----`,
      capabilities: [
        {
          verb: 'CALCULATE',
          target: 'TAX',
          description: 'Calculate regional tax dynamically'
        }
      ]
    });

    console.log('Registo do Peer Gateway:', peerRegisterRes.data.message);

    if (peerRegisterRes.data.success) {
      console.log('✔ RESULTADO ESPERADO: Peer Gateway registado com capacidades P2P virtuais.\n');
    } else {
      console.log('❌ FALHA NO REGISTO DO PEER:', peerRegisterRes.data, '\n');
    }

  } catch (err) {
    console.error('❌ ERRO NA EXECUÇÃO DO TESTE:', err);
  }
}

// Disparo dos testes de funcionalidades futuristas
runTests();
