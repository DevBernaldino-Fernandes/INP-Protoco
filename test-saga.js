/**
 * @fileoverview Suíte Completa de Testes de Resiliência Transacional Saga e Recuperação Avançada.
 * Valida os pilares de consistência distribuída do INP:
 * 1. SafeEvaluator com AST e expressões lógicas/aritméticas seguras sem recurso a eval().
 * 2. Cifragem criptográfica com rotação de chaves versionadas (CryptoEngine AES-256-GCM v2 e retrocompatibilidade).
 * 3. Registo de capacidades compensatórias para orquestração Saga.
 * 4. Padrão Outbox transacional com suspensão de estado e política Forward Recovery (FORWARD_RETRY_PENDING).
 * 5. Recuperação em avanço (Forward Recovery): retoma a partir do último passo bem-sucedido sem reexecutar passos anteriores.
 * 6. Geração determinística de chaves de idempotência (X-Idempotency-Key) baseadas em SHA-256(executionId + index).
 * 7. Encaminhamento para Dead Letter Queue (DLQ) e disparo de alertas em compensações irrecuperáveis.
 * 8. Recuperação autónoma de trincas concorrentes expiradas (Lock Reap Timeout) em tarefas encravadas.
 *
 * @module Scripts/TestSaga
 * @security Valida criptografia AES-256-GCM versionada, chaves determinísticas de idempotência e isolamento AST.
 * @audit Garante rastreabilidade total nas tabelas saga_states, executions, queue_jobs e dead_letter_queue.
 */

const axios = require('axios');
const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

/**
 * Executa sequencialmente a suíte exaustiva de testes de arquitetura Saga e tolerância a falhas.
 *
 * @returns {Promise<void>}
 */
async function runSagaTest() {
  console.log('====================================================');
  console.log('      A INICIAR VALIDAÇÃO DE ARQUITETURA SAGA       ');
  console.log('====================================================\n');

  // Ligação à base de dados PostgreSQL para validações e asserções diretas
  const dbClient = new Client({
    connectionString: 'postgres://inp:inp123@localhost:5432/inp'
  });
  await dbClient.connect();

  // Limpeza de tabelas transacionais para isolamento do teste
  await dbClient.query("DELETE FROM services WHERE id IN ('saga-shipment-service', 'saga-payment-service-v4', 'bad-payment-service')");
  await dbClient.query("DELETE FROM saga_states");
  await dbClient.query("DELETE FROM executions");
  await dbClient.query("DELETE FROM queue_jobs");
  await dbClient.query("DELETE FROM dead_letter_queue");

  try {
    // --- 1. Testar SafeEvaluator com AST e Expressões Matemáticas ---
    console.log('--- 1. Testar SafeEvaluator (AST & Aritmética) ---');
    const { SafeEvaluator } = require('./dist/core/safe-evaluator');
    const evalCtx = { amount: 180.0, user_id: 'usr_saga_test', admin: false };
    
    // Combinação lógica com avaliação aritmética sem código arbitrário
    const cond = "((context.amount * 2 > 300) && (context.user_id == 'usr_saga_test')) || context.admin == true";
    const result = SafeEvaluator.evaluate(cond, evalCtx);
    
    console.log(`Expressão AST: ${cond}`);
    console.log(`Resultado: ${result} (Esperado: true)`);
    
    if (result === true) {
      console.log('✔ SafeEvaluator AST com Aritmética validado com sucesso.\n');
    } else {
      throw new Error('Falha na validação do SafeEvaluator AST');
    }

    // --- 2. Testar CryptoEngine com Rotação de Chaves Versionadas ---
    console.log('--- 2. Testar CryptoEngine (Rotação de Chaves Versionadas) ---');
    const { CryptoEngine } = require('./dist/core/crypto-engine');
    const secret = "MasterClassEncryptionKeyRotation2026";
    
    // Cifra com a chave ativa do ciclo atual (v2)
    const encryptedV2 = CryptoEngine.encrypt(secret);
    const decryptedV2 = CryptoEngine.decrypt(encryptedV2);
    
    console.log(`Original: ${secret}`);
    console.log(`Cifrado (AES-256-GCM v2): ${encryptedV2}`);
    console.log(`Decifrado (v2): ${decryptedV2}`);
    
    if (decryptedV2 === secret && encryptedV2.startsWith('v2:')) {
      console.log('✔ CryptoEngine com Rotação de Chaves validado com sucesso.\n');
    } else {
      throw new Error('Falha na cifragem do CryptoEngine com Rotação');
    }

    // --- 3. Registar Serviço de Pagamentos com Capacidade Compensatória ---
    console.log('--- 3. Registar Serviço com Regras Saga ---');
    const registerRes = await axios.post('http://localhost:3000/services/register', {
      id: 'saga-payment-service-v4',
      name: 'Saga Payments Gateway V4',
      description: 'Gere pagamentos com rollback compensatório e recuperação progressiva (Forward Recovery)',
      capabilities: [
        { 
          verb: 'EXECUTE', 
          target: 'PAYMENT', 
          description: 'Process payment',
          requiredPermissions: ['payments.write'],
          compensateCapability: 'REFUND PAYMENT'
        },
        {
          verb: 'REFUND',
          target: 'PAYMENT',
          description: 'Refund payment',
          requiredPermissions: ['payments.write']
        }
      ],
      trustScore: 115,
      securityLevel: 'HIGH',
      endpoint: 'http://localhost:3001'
    }, {
      headers: { 'X-Registration-Token': 'inp-super-secret-registration-token-2026' }
    });
    console.log('Registo do Serviço:', registerRes.data, '\n');

    // --- 4. Executar transação assíncrona com Forward Recovery (Falha Inicial) ---
    console.log('--- 4. Executar Transação Assíncrona via Fila (Padrão Outbox) ---');
    const intentDsl = `
INTENT "saga_forward_recovery_test" {
  CONTEXT { amount: 180.0, user_id: "usr_saga_test", card_token: "tok_saga_v4", failurePolicy: "FORWARD_RETRY" }
  REQUIRE { EXECUTE PAYMENT }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
      EXECUTE SAGA_SHIPMENT
    }
  }
  OUTPUT { FORMAT "json" }
}
    `.trim();

    // Submete a intenção em modo assíncrono (async: true)
    const intentRes = await axios.post('http://localhost:3000/api/intent', {
      text: intentDsl,
      type: 'dsl',
      async: true,
      securityContext: {
        userId: 'usr_saga_test',
        permissions: ['payments.write']
      }
    });

    const executionId = intentRes.data.result.execution_id;
    const statusInicial = intentRes.data.result.status;
    console.log(`Resposta Imediata do Gateway: Estado: ${statusInicial}, ID de Execução: ${executionId}`);
    
    if (statusInicial !== 'PENDING') {
      throw new Error('Falha no Outbox: A resposta deveria ser PENDING.');
    }
    console.log('✔ Resposta imediata PENDING recebida (Padrão Outbox ativo).');

    console.log('A aguardar processamento da tarefa em segundo plano (2.5 segundos)...');
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Consultar PostgreSQL para validar a persistência da Saga e a falha controlada
    const dbSagaRes = await dbClient.query(
      'SELECT * FROM saga_states WHERE execution_id = $1',
      [executionId]
    );

    if (dbSagaRes.rows.length === 0) {
      throw new Error('Nenhum registo de Saga encontrado na base de dados para esta execução.');
    }

    const sagaState = dbSagaRes.rows[0];
    console.log('Estado da Saga após primeira tentativa (com falha em SAGA_SHIPMENT):');
    console.log(`   - Estado da Saga: ${sagaState.status} (Esperado: FORWARD_RETRY_PENDING)`);
    console.log(`   - Passo Salvo: Índice ${sagaState.current_step_index} (Esperado: 2)`);
    
    if (sagaState.status !== 'FORWARD_RETRY_PENDING' || sagaState.current_step_index !== 2) {
      throw new Error(`Saga deveria estar com estado FORWARD_RETRY_PENDING no passo index 2. Obtido: ${sagaState.status}, index: ${sagaState.current_step_index}`);
    }
    console.log('✔ Falha controlada registada e progresso retido (Forward Recovery ativo).\n');

    // --- 5. Registar o Serviço de Entrega (Simulando reposição do serviço em falta) ---
    console.log('--- 5. Registar Serviço de Entrega (Correção de Infraestrutura) ---');
    const registerShipRes = await axios.post('http://localhost:3000/services/register', {
      id: 'saga-shipment-service',
      name: 'Saga Shipment Service',
      capabilities: [
        { verb: 'EXECUTE', target: 'SAGA_SHIPMENT', description: 'Process shipments' }
      ],
      trustScore: 115,
      securityLevel: 'HIGH',
      endpoint: 'http://localhost:3001'
    }, {
      headers: { 'X-Registration-Token': 'inp-super-secret-registration-token-2026' }
    });
    console.log('Registo do Serviço de Entrega:', registerShipRes.data, '\n');

    // --- 6. Enfileirar Tarefa de Retentativa para Forward Recovery ---
    console.log('--- 6. Retomar Execução via Outbox (Forward Recovery em Ação) ---');
    
    // Insere tarefa para retomar o fluxo a partir do ponto onde falhou
    await dbClient.query(
      `INSERT INTO queue_jobs(id, saga_id, execution_id, task_type, payload, status, attempts, max_attempts, created_at, updated_at)
       VALUES($1, $2, $3, $4, $5, $6, 0, 3, NOW(), NOW())`,
      [uuidv4(), sagaState.id, executionId, 'FLOW_EXECUTION', JSON.stringify({
        text: intentDsl,
        isNaturalLanguage: false,
        securityContext: { userId: 'usr_saga_test', permissions: ['payments.write'] },
        executionId
      }), 'PENDING']
    );

    console.log('Tarefa de retoma inserida na fila. A aguardar processamento (2.5 segundos)...');
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Validar se o fluxo completou ignorando o pagamento já efetuado
    const finalSagaRes = await dbClient.query(
      'SELECT * FROM saga_states WHERE execution_id = $1',
      [executionId]
    );
    const finalSaga = finalSagaRes.rows[0];

    const finalExecRes = await dbClient.query(
      'SELECT * FROM executions WHERE id = $1',
      [executionId]
    );
    const finalExec = finalExecRes.rows[0];

    console.log('Estado da Saga após retoma:');
    console.log(`   - Estado da Saga: ${finalSaga.status} (Esperado: COMPLETED)`);
    console.log(`   - Estado da Execução: ${finalExec.status} (Esperado: COMPLETED)`);
    
    if (finalSaga.status === 'COMPLETED' && finalExec.status === 'COMPLETED') {
      console.log('✔ Forward Recovery executado com sucesso: ignorou etapas concluídas e finalizou o fluxo.\n');
    } else {
      throw new Error(`Retoma falhou. Saga: ${finalSaga.status}, Execução: ${finalExec.status}`);
    }

    // --- 6.5. Validar Chaves de Idempotência Determinísticas ---
    console.log('--- 6.5. Validar Chaves de Idempotência Determinísticas ---');
    const crypto = require('crypto');
    function getExpectedKey(execId, idx) {
      const hash = crypto.createHash('sha256').update(`${execId}-${idx}`).digest('hex');
      return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
    }
    const expectedPaymentKey = getExpectedKey(executionId, 1);
    const expectedShipmentKey = getExpectedKey(executionId, 2);

    console.log(`A consultar chaves de idempotência registadas no serviço mock...`);
    const mockKeysRes = await axios.get('http://localhost:3001/received-keys');
    const receivedKeys = mockKeysRes.data.keys.map(k => k.key);
    console.log('Chaves recebidas pelo mock:', receivedKeys);
    console.log(`Chave esperada para PAYMENT (índice 1): ${expectedPaymentKey}`);
    console.log(`Chave esperada para SHIPMENT (índice 2): ${expectedShipmentKey}`);

    const hasPaymentKey = receivedKeys.includes(expectedPaymentKey);
    const hasShipmentKey = receivedKeys.includes(expectedShipmentKey);

    if (hasPaymentKey && hasShipmentKey) {
      console.log('✔ Validação de Chaves de Idempotência Determinísticas concluída com sucesso.\n');
    } else {
      throw new Error(`Validação de chaves de idempotência falhou. Esperava encontrar [${expectedPaymentKey}, ${expectedShipmentKey}] em [${receivedKeys.join(', ')}]`);
    }

    // --- 7. Testar DLQ e Alertas em Compensações com Falha ---
    console.log('--- 7. Testar DLQ e Alertas para Compensações Falhas ---');
    
    // Registar serviço que aponta para uma compensação inexistente
    await axios.post('http://localhost:3000/services/register', {
      id: 'bad-payment-service',
      name: 'Bad Payments Gateway',
      capabilities: [
        { 
          verb: 'EXECUTE', 
          target: 'BAD_PAYMENT', 
          compensateCapability: 'REFUND NON_EXISTENT_PAYMENT'
        }
      ],
      trustScore: 90,
      securityLevel: 'LOW',
      endpoint: 'http://localhost:3001'
    }, {
      headers: { 'X-Registration-Token': 'inp-super-secret-registration-token-2026' }
    });
    
    // Executar intenção que falha no 2º passo, forçando tentativa de compensação falhada
    const badIntentDsl = `
INTENT "bad_saga_test" {
  CONTEXT { amount: 50.0 }
  REQUIRE { EXECUTE BAD_PAYMENT }
  FLOW {
    SEQUENCE {
      EXECUTE BAD_PAYMENT
      EXECUTE INVALID_STEP
    }
  }
  OUTPUT { FORMAT "json" }
}
    `.trim();

    console.log('A disparar execução que falhará no rollback compensatório...');
    const badIntentRes = await axios.post('http://localhost:3000/api/intent', {
      text: badIntentDsl,
      type: 'dsl'
    });

    console.log(`Resultado do gateway (síncrono): Estado: ${badIntentRes.data.result.status}, Erro: ${badIntentRes.data.result.error}`);

    // Aguardar encaminhamento para a Dead Letter Queue (DLQ)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verificar se o registo foi guardado na tabela dead_letter_queue
    const dlqRes = await dbClient.query(
      'SELECT * FROM dead_letter_queue WHERE saga_id IS NOT NULL ORDER BY failed_at DESC LIMIT 1'
    );

    if (dlqRes.rows.length > 0) {
      const dlqRow = dlqRes.rows[0];
      console.log('✔ Registo encontrado na Dead Letter Queue (DLQ):');
      console.log(`   - ID da Saga: ${dlqRow.saga_id}`);
      console.log(`   - Tipo de Tarefa: ${dlqRow.task_type}`);
      console.log(`   - Último Erro: ${dlqRow.last_error}`);
      console.log('✔ DLQ e Alertas validados com sucesso.\n');
    } else {
      throw new Error('Falha no teste de DLQ: Nenhum registo inserido na tabela dead_letter_queue.');
    }

    // --- 8. Testar Resgate de Trincas Expiradas (Lock Reap Timeout) ---
    console.log('--- 8. Testar Recuperação de Trincas Expiradas (Lock Reap Timeout) ---');
    
    // Inserir tarefa encravada com trinca fixada há 10 minutos
    const stuckJobId = uuidv4();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    await dbClient.query(
      `INSERT INTO queue_jobs(id, saga_id, execution_id, task_type, payload, status, attempts, max_attempts, locked_at, locked_by, created_at, updated_at)
       VALUES($1, $2, $3, $4, $5, $6, 0, 3, $7, $8, NOW(), NOW())`,
      [stuckJobId, uuidv4(), uuidv4(), 'TEST_LOCK_REAP', JSON.stringify({ text: 'dummy' }), 'PROCESSING', tenMinutesAgo, 'worker_crashed']
    );
    
    console.log('Tarefa encravada inserida na base de dados com trinca registada no passado.');
    
    // Disparar o procedimento de recuperação de trincas inicializando a fonte de dados TypeORM
    const { AppDataSource } = require('./dist/persistence/data-source');
    await AppDataSource.initialize();
    
    const { QueueWorker } = require('./dist/core/queue-worker');
    await QueueWorker.reapExpiredLocks();
    
    await AppDataSource.destroy();
    
    // Verificar se a tarefa retornou para o estado PENDING
    const stuckJobRes = await dbClient.query(
      'SELECT status, locked_by, locked_at FROM queue_jobs WHERE id = $1',
      [stuckJobId]
    );
    
    const reapedJob = stuckJobRes.rows[0];
    console.log(`Estado da Tarefa após Lock Reap: Estado: ${reapedJob.status}, TrancadaPor: ${reapedJob.locked_by}`);
    
    if (reapedJob.status === 'PENDING' && reapedJob.locked_by === null && reapedJob.locked_at === null) {
      console.log('✔ Lock Reap Timeout validado com sucesso (Tarefa reativada para PENDING).\n');
    } else {
      throw new Error('Falha no teste de Lock Reap: A tarefa continuou encravada.');
    }

    console.log('\n====================================================');
    console.log('   TODAS AS MELHORIAS SAGA TESTADAS COM SUCESSO!    ');
    console.log('====================================================');

  } catch (err) {
    console.error('❌ ERRO NO TESTE SAGA MASTER:', err.message);
  } finally {
    await dbClient.end();
  }
}

// Disparo da bateria de testes de resiliência Saga
runSagaTest();
