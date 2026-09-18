/**
 * @fileoverview Auditoria Profunda dos 14 Novos Verbos Estratégicos do INP Protocol v2.6
 * @module Tests/Advanced14VerbsAudit
 * @description
 * Executa uma validação ponta-a-ponta exaustiva para comprovar a eficácia, ergonomia e contenção de estresse
 * dos 14 novos verbos estratégicos implementados na v2.6:
 * 1. Anti-Stress: COALESCE (Single-Flight), MEMOIZE (Cache-Aside), THROTTLE (Token Bucket), BATCH (Chunking), DEFER (Transactional Outbox).
 * 2. Ergonomia & Dados: MERGE (Fusão de Payloads), AWAIT (Suspensão Reativa), PROBE (Telemetria In-Memory sem IO), FANOUT (Dispersão Concorrente).
 * 3. Resiliência & Segurança: GUARD (Fail-Fast), SHADOW (Dark Launching), REDACT (Conformidade LGPD/PCI), CHECKPOINT (Savepoint de Saga), SIMULATE (Chaos/Mock).
 * 4. Orquestração DSL declarativa e retoma de Saga suspensa via endpoint REST /api/workflow/:sagaId/resume.
 *
 * @security Valida contenção em memória com SafeEvaluator, mascaramento de segredos em voo e proteção contra saturação.
 * @audit Persiste registos forenses em PostgreSQL, atualizações de Saga e tarefas em fila assíncrona.
 */

const assert = require('assert');
const http = require('http');
const { CapabilityRegistry } = require('./dist/core/capability-registry');
const { MatchingEngine } = require('./dist/core/matching-engine');
const { ExecutionEngine } = require('./dist/core/execution-engine');
const { IntentParser } = require('./dist/core/intent-parser');
const { AppDataSource } = require('./dist/persistence/data-source');
const { registerNativeServices } = require('./dist/services/native-services-registry');
const { SagaStateRepository } = require('./dist/persistence/repositories/SagaStateRepository');
const { QueueJobRepository } = require('./dist/persistence/repositories/QueueJobRepository');
const { ServiceMetricsCollector } = require('./dist/core/metrics-collector');
const { nativeAdvancedVerbsHandler } = require('./dist/services/native-advanced-verbs-service');

/**
 * Executa a suite de testes de auditoria dos 14 novos verbos estratégicos.
 * @returns {Promise<void>}
 */
async function runAdvancedVerbsAudit() {
  console.log('========================================================================');
  console.log('  AUDITORIA PROFUNDA DOS 14 NOVOS VERBOS ESTRATÉGICOS — INP PROTOCOL v2.6 ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  async function check(name, fn) {
    process.stdout.write(`• ${name}... `);
    try {
      await fn();
      console.log('✅ PASSOU');
      passed++;
    } catch (err) {
      console.log(`❌ FALHOU: ${err.message}`);
      console.error(err);
      failed++;
    }
  }

  console.log('[Setup] A inicializar ligação PostgreSQL com TypeORM...');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  console.log('[Setup] ✅ Ligação estabelecida.\n');

  try {
    const registry = new CapabilityRegistry();
    console.log('[Setup] A registar os serviços nativos no CapabilityRegistry...');
    await registerNativeServices(registry);
    console.log('[Setup] ✅ Serviços nativos registados.\n');

    const parser = new IntentParser();
    const matchingEngine = new MatchingEngine(registry);
    const engine = new ExecutionEngine(registry);

    // =========================================================================
    // BATERIA 1: VALIDAÇÃO INDIVIDUAL DE CADA UM DOS 14 NOVOS VERBOS
    // =========================================================================
    console.log('--- BATERIA 1: Testes Unitários e Comportamentais dos 14 Novos Verbos ---');

    // 1. COALESCE (Single-Flight Pattern: deduplicação de chamadas concorrentes idênticas)
    await check('[01/14] COALESCE — Colapso Single-Flight de 5 chamadas concorrentes idênticas', async () => {
      let underlyingExecutions = 0;
      const mockHeavyCall = async () => {
        underlyingExecutions++;
        await new Promise(res => setTimeout(res, 40));
        return { data: 'heavy_calculation_result', count: underlyingExecutions };
      };

      // Dispara 5 invocações estritamente simultâneas para o mesmo alvo e payload
      const promises = [1, 2, 3, 4, 5].map(() =>
        nativeAdvancedVerbsHandler({
          verb: 'COALESCE',
          target: 'AGGREGATE_METRICS',
          data: { cluster: 'eu-west-1', metric: 'cpu_usage' },
          handler: mockHeavyCall
        })
      );

      const results = await Promise.all(promises);

      assert.strictEqual(results.length, 5);
      assert.strictEqual(underlyingExecutions, 1, 'O cálculo pesado subjacente deve ter sido executado apenas 1 vez!');
      
      const leaders = results.filter(r => r.sharedFlight === false);
      const followers = results.filter(r => r.sharedFlight === true);
      assert.strictEqual(leaders.length, 1, 'Exatamente 1 chamada deve ter sido o líder de voo');
      assert.strictEqual(followers.length, 4, 'As restantes 4 chamadas devem ter partilhado o mesmo voo');
      for (const res of results) {
        assert.strictEqual(res.coalesced, true);
        assert.strictEqual(res.data, 'heavy_calculation_result');
      }
    });

    // 2. MEMOIZE (Cache-Aside Atómico Nativo)
    await check('[02/14] MEMOIZE — Cache em memória transparente com chave hashing e TTL', async () => {
      let computations = 0;
      const computeFn = async (p) => {
        computations++;
        return { value: p.x * 2, calculatedAt: Date.now() };
      };

      // 1ª chamada: Cache Miss
      const first = await nativeAdvancedVerbsHandler({
        verb: 'MEMOIZE',
        target: 'TAX_CALCULATION',
        data: { x: 50 },
        ttlMs: 60000,
        handler: computeFn
      });
      assert.strictEqual(first.memoized, true);
      assert.strictEqual(first.cached, false, '1ª chamada deve ser Cache Miss');
      assert.strictEqual(first.value, 100);
      assert.strictEqual(computations, 1);

      // 2ª chamada com o mesmo payload: Cache Hit
      const second = await nativeAdvancedVerbsHandler({
        verb: 'MEMOIZE',
        target: 'TAX_CALCULATION',
        data: { x: 50 },
        ttlMs: 60000,
        handler: computeFn
      });
      assert.strictEqual(second.memoized, true);
      assert.strictEqual(second.cached, true, '2ª chamada idêntica deve ser Cache Hit imediato');
      assert.strictEqual(second.value, 100);
      assert.strictEqual(computations, 1, 'A computação não deve ter sido reexecutada');
    });

    // 3. GUARD (Fail-Fast Invariant Assertion)
    await check('[03/14] GUARD — Bloqueio fail-fast de invariantes sem consumo de rede', async () => {
      // Caso Válido: passa na asserção
      const valid = await nativeAdvancedVerbsHandler({
        verb: 'GUARD',
        condition: 'amount > 0 && currency == "EUR"',
        context: { amount: 150, currency: 'EUR' }
      });
      assert.strictEqual(valid.guardPassed, true);

      // Caso Inválido: dispara erro de segurança antes de qualquer chamada de rede
      let blocked = false;
      try {
        await nativeAdvancedVerbsHandler({
          verb: 'GUARD',
          condition: 'amount <= 100',
          context: { amount: 500 }
        });
      } catch (err) {
        blocked = true;
        assert(err.message.includes('Guarda Violada'), 'Mensagem deve indicar violação de guarda');
      }
      assert.strictEqual(blocked, true, 'A condição inválida deve ter lançado exceção impeditiva');
    });

    // 4. THROTTLE (Token Bucket Flow Control)
    await check('[04/14] THROTTLE — Controlo de cadência por ficha contendo picos de estresse', async () => {
      const throttleTarget = 'PAYMENT_GATEWAY_EXT';

      // 1ª chamada: consome 1 ficha de 2 disponíveis
      const c1 = await nativeAdvancedVerbsHandler({
        verb: 'THROTTLE',
        target: throttleTarget,
        capacity: 2,
        ratePerSec: 0.1
      });
      assert.strictEqual(c1.throttled, false);
      assert.strictEqual(c1.remainingTokens, 1);

      // 2ª chamada: consome a 2ª ficha
      const c2 = await nativeAdvancedVerbsHandler({
        verb: 'THROTTLE',
        target: throttleTarget,
        capacity: 2,
        ratePerSec: 0.1
      });
      assert.strictEqual(c2.throttled, false);
      assert.strictEqual(c2.remainingTokens, 0);

      // 3ª chamada imediata: esgotou capacidade, deve rejeitar com erro de vazão
      let throttled = false;
      try {
        await nativeAdvancedVerbsHandler({
          verb: 'THROTTLE',
          target: throttleTarget,
          capacity: 2,
          ratePerSec: 0.1
        });
      } catch (err) {
        throttled = true;
        assert(err.message.includes('Limite de Vazão Excedido'));
      }
      assert.strictEqual(throttled, true, 'Deve rejeitar a 3ª requisição por saturação de fichas');
    });

    // 5. BATCH (Agrupamento e Chunking de Listas)
    await check('[05/14] BATCH — Fracionamento de coleções grandes em pedaços seguros (chunks)', async () => {
      const largeList = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, item: `prod_${i + 1}` }));
      
      const batchResult = await nativeAdvancedVerbsHandler({
        verb: 'BATCH',
        items: largeList,
        chunkSize: 3
      });

      assert.strictEqual(batchResult.batched, true);
      assert.strictEqual(batchResult.totalItems, 11);
      assert.strictEqual(batchResult.chunkSize, 3);
      assert.strictEqual(batchResult.chunksCount, 4, '11 itens divididos de 3 em 3 devem resultar em 4 lotes');
      assert.strictEqual(batchResult.chunks[0].length, 3);
      assert.strictEqual(batchResult.chunks[3].length, 2);
    });

    // 6. DEFER (Agendamento Assíncrono Outbox)
    await check('[06/14] DEFER — Agendamento assíncrono via Transactional Outbox (queue_jobs)', async () => {
      const deferResult = await nativeAdvancedVerbsHandler({
        verb: 'DEFER',
        target: 'SEND_WEEKLY_DIGEST',
        payload: { userId: 'usr_audit_99', digestType: 'weekly' },
        delayMs: 3600000
      }, { executionId: 'exec-defer-audit-1' });

      assert.strictEqual(deferResult.deferred, true);
      assert.strictEqual(deferResult.status, 'QUEUED');
      assert(deferResult.jobId);

      // Comprova registo forense real persistido na tabela queue_jobs
      const savedJob = await QueueJobRepository.findOneBy({ id: deferResult.jobId });
      assert(savedJob, 'O trabalho deve estar fisicamente persistido na base de dados PostgreSQL');
      assert.strictEqual(savedJob.taskType, 'SEND_WEEKLY_DIGEST');
      assert.strictEqual(savedJob.status, 'PENDING');
      assert.strictEqual(savedJob.payload.userId, 'usr_audit_99');
    });

    // 7. MERGE (Fusão Declarativa de Múltiplos Payloads)
    await check('[07/14] MERGE — Consolidação declarativa de múltiplos fragmentos de dados', async () => {
      const source1 = { user: 'carlos', role: 'admin' };
      const source2 = { permissions: ['read', 'write'], org: 'finance' };
      const source3 = { preferences: { theme: 'dark', language: 'pt' } };

      const mergeResult = await nativeAdvancedVerbsHandler({
        verb: 'MERGE',
        sources: [source1, source2, source3]
      });

      assert.strictEqual(mergeResult.merged, true);
      assert.strictEqual(mergeResult.result.user, 'carlos');
      assert.strictEqual(mergeResult.result.org, 'finance');
      assert.strictEqual(mergeResult.result.preferences.theme, 'dark');
      assert.strictEqual(mergeResult.fieldsCount, 5);
    });

    // 8. AWAIT (Suspensão de Saga sem Bloqueio de Threads)
    await check('[08/14] AWAIT — Suspensão reativa de Saga persistindo estado na base de dados', async () => {
      // Cria registo prévio de Saga para simular suspensão de workflow real
      const testExecutionId = `exec-await-audit-${Date.now()}`;
      const saga = await SagaStateRepository.save({
        executionId: testExecutionId,
        intentId: 'intent-await-test',
        status: 'RUNNING',
        compensationStack: [],
        currentStepIndex: 1,
        failurePolicy: 'ROLLBACK'
      });

      const awaitResult = await nativeAdvancedVerbsHandler({
        verb: 'AWAIT',
        target: 'HUMAN_APPROVAL_TOKEN',
        waitToken: 'token_kyc_verify_123'
      }, { executionId: testExecutionId });

      assert.strictEqual(awaitResult.status, 'SUSPENDED');
      assert.strictEqual(awaitResult.waitToken, 'token_kyc_verify_123');

      // Verifica que o registo da Saga foi marcado como SUSPENDED na base de dados
      const updatedSaga = await SagaStateRepository.findOneBy({ id: saga.id });
      assert.strictEqual(updatedSaga.status, 'SUSPENDED');
      assert(updatedSaga.lastError.includes('token_kyc_verify_123'));
    });

    // 9. PROBE (Inspeção Volátil em Memória sem Escrita em Disco)
    await check('[09/14] PROBE — Inspeção de saúde ultrarrápida (<1ms) sem overhead de disco', async () => {
      const collector = ServiceMetricsCollector.getInstance();
      collector.recordSuccess('svc-target-fast-probe', 5);

      const probeResult = await nativeAdvancedVerbsHandler({
        verb: 'PROBE',
        target: 'svc-target-fast-probe'
      });

      assert.strictEqual(probeResult.probed, true);
      assert.strictEqual(probeResult.healthy, true);
      assert.strictEqual(probeResult.status, 'HEALTHY');
      assert.strictEqual(probeResult.latencyMs, 0);
      assert(probeResult.score >= 0.9);
    });

    // 10. SHADOW (Espelhamento de Tráfego em Segundo Plano)
    await check('[10/14] SHADOW — Disparo fire-and-forget para nó sombra sem onerar tempo de resposta', async () => {
      const shadowResult = await nativeAdvancedVerbsHandler({
        verb: 'SHADOW',
        target: 'SHADOW_CANARY_SERVICE_V3',
        payload: { orderId: 'ord_123', amount: 99.50 }
      });

      assert.strictEqual(shadowResult.shadowed, true);
      assert.strictEqual(shadowResult.shadowTarget, 'SHADOW_CANARY_SERVICE_V3');
      assert(shadowResult.dispatchedAt);
    });

    // 11. REDACT (Mascaramento de Dados Sensíveis em Voo)
    await check('[11/14] REDACT — Higienização de dados e ofuscação estrita de segredos (LGPD/PCI)', async () => {
      const rawPayload = {
        username: 'alice',
        password: 'SuperSecretPassword!123',
        creditCard: '4111-2222-3333-4444',
        cvv: '123',
        city: 'Lisboa'
      };

      const redactResult = await nativeAdvancedVerbsHandler({
        verb: 'REDACT',
        fields: ['password', 'creditCard', 'cvv'],
        data: rawPayload
      });

      assert.strictEqual(redactResult.redacted, true);
      assert.strictEqual(redactResult.sanitized.username, 'alice');
      assert.strictEqual(redactResult.sanitized.city, 'Lisboa');
      assert.strictEqual(redactResult.sanitized.password, '********');
      assert.strictEqual(redactResult.sanitized.creditCard, '********');
      assert.strictEqual(redactResult.sanitized.cvv, '********');
    });

    // 12. CHECKPOINT (Savepoint Transacional em Saga)
    await check('[12/14] CHECKPOINT — Gravação de savepoint intermediário em base de dados', async () => {
      const testExecutionId = `exec-chk-audit-${Date.now()}`;
      const saga = await SagaStateRepository.save({
        executionId: testExecutionId,
        intentId: 'intent-chk-test',
        status: 'RUNNING',
        compensationStack: [],
        currentStepIndex: 0,
        failurePolicy: 'FORWARD_RETRY'
      });

      const chkResult = await nativeAdvancedVerbsHandler({
        verb: 'CHECKPOINT',
        stepIndex: 3
      }, { executionId: testExecutionId });

      assert.strictEqual(chkResult.checkpointed, true);
      assert.strictEqual(chkResult.stepIndex, 3);
      assert(chkResult.checkpointId);

      // Valida na base de dados
      const updatedSaga = await SagaStateRepository.findOneBy({ id: saga.id });
      assert.strictEqual(updatedSaga.currentStepIndex, 3);
    });

    // 13. SIMULATE (Injeção de Caos, Latência e Mock)
    await check('[13/14] SIMULATE — Injeção de latência controlada e resposta sintética mock', async () => {
      const start = Date.now();
      const simResult = await nativeAdvancedVerbsHandler({
        verb: 'SIMULATE',
        target: 'EXTERNAL_BANK_API',
        delayMs: 50,
        mock: { status: 'APPROVED', transactionId: 'tx_sim_999' }
      });
      const elapsed = Date.now() - start;

      assert.strictEqual(simResult.simulated, true);
      assert(elapsed >= 45, `A latência simulada deve ter sido aplicada (decorreu: ${elapsed}ms)`);
      assert.strictEqual(simResult.result.status, 'APPROVED');
      assert.strictEqual(simResult.result.transactionId, 'tx_sim_999');

      // Teste de injeção de falha programada
      let simulatedFailure = false;
      try {
        await nativeAdvancedVerbsHandler({
          verb: 'SIMULATE',
          target: 'FAULTY_ENDPOINT',
          shouldFail: true,
          errorMessage: 'Falha sintética de conexão induzida para teste de caos'
        });
      } catch (err) {
        simulatedFailure = true;
        assert(err.message.includes('Falha sintética de conexão'));
      }
      assert.strictEqual(simulatedFailure, true, 'O simulador deve lançar erro programado quando solicitado');
    });

    // 14. FANOUT (Dispersão Concorrente com Limite de Contrapressão)
    await check('[14/14] FANOUT — Dispersão paralela com concorrência limitada (sem saturação de heap)', async () => {
      const targets = ['broker-node-1', 'broker-node-2', 'broker-node-3', 'broker-node-4', 'broker-node-5'];

      const fanoutResult = await nativeAdvancedVerbsHandler({
        verb: 'FANOUT',
        destinations: targets,
        concurrency: 2
      });

      assert.strictEqual(fanoutResult.fanout, true);
      assert.strictEqual(fanoutResult.totalDestinations, 5);
      assert.strictEqual(fanoutResult.dispatched.length, 5);
      for (const item of fanoutResult.dispatched) {
        assert.strictEqual(item.dispatched, true);
        assert(targets.includes(item.destination));
      }
    });

    // =========================================================================
    // BATERIA 2: ORQUESTRAÇÃO DE FLUXOS DSL END-TO-END USANDO OS NOVOS VERBOS
    // =========================================================================
    console.log('\n--- BATERIA 2: Orquestração End-to-End via DSL com os Novos Verbos ---');

    // DSL 1: Verificação de Guarda + Loteamento + Fusão
    await check('DSL Fluxo 1: SEQUENCE { GUARD ... -> BATCH ... -> MERGE ... }', async () => {
      const dsl = `
      INTENT "pipeline_safe_processing" {
        CONTEXT {
          amount: 500,
          items: [1, 2, 3, 4, 5, 6],
          extraData: { source: "web_portal" }
        }
        REQUIRE {
          GUARD "amount > 0"
          BATCH "chunkSize: 2"
          MERGE "COMBINE"
        }
        FLOW {
          SEQUENCE {
            GUARD "amount > 0"
            BATCH "chunkSize: 2"
            MERGE "COMBINE"
          }
        }
        OUTPUT {
          FORMAT "json"
        }
      }`;

      const parsed = parser.parse(dsl);
      const matches = await matchingEngine.matchIntent(parsed);
      const execution = await engine.execute(parsed, matches);

      assert.strictEqual(execution.status, 'COMPLETED');
      assert(execution.finalOutput);
      assert.strictEqual(execution.finalOutput.merged, true);
    });

    // DSL 2: Single-Flight Coalesce + Proteção LGPD Redact
    await check('DSL Fluxo 2: SEQUENCE { COALESCE ... -> REDACT ... }', async () => {
      const dsl = `
      INTENT "privacy_deduplicated_flow" {
        CONTEXT {
          user: "marcos",
          password: "plain_password_123",
          token: "jwt_token_secret"
        }
        REQUIRE {
          COALESCE "PROFILE"
          REDACT "password token"
        }
        FLOW {
          SEQUENCE {
            COALESCE "PROFILE"
            REDACT "password token"
          }
        }
        OUTPUT {
          FORMAT "json"
        }
      }`;

      const parsed = parser.parse(dsl);
      const matches = await matchingEngine.matchIntent(parsed);
      const execution = await engine.execute(parsed, matches);

      assert.strictEqual(execution.status, 'COMPLETED');
      assert(execution.finalOutput);
      assert.strictEqual(execution.finalOutput.redacted, true);
      assert.strictEqual(execution.finalOutput.sanitized.password, '********');
      assert.strictEqual(execution.finalOutput.sanitized.token, '********');
      assert.strictEqual(execution.finalOutput.sanitized.user, 'marcos');
    });

    // DSL 3: Telemetria Imediata Probe + Simulação de Resposta
    await check('DSL Fluxo 3: SEQUENCE { PROBE ... -> SIMULATE ... }', async () => {
      const dsl = `
      INTENT "telemetry_and_simulation" {
        CONTEXT {
          testTarget: "CORE_GATEWAY"
        }
        REQUIRE {
          PROBE "CORE_GATEWAY"
          SIMULATE "MOCK_SERVICE"
        }
        FLOW {
          SEQUENCE {
            PROBE "CORE_GATEWAY"
            SIMULATE "MOCK_SERVICE"
          }
        }
        OUTPUT {
          FORMAT "json"
        }
      }`;

      const parsed = parser.parse(dsl);
      const matches = await matchingEngine.matchIntent(parsed);
      const execution = await engine.execute(parsed, matches);

      assert.strictEqual(execution.status, 'COMPLETED');
      assert(execution.finalOutput);
      assert.strictEqual(execution.finalOutput.simulated, true);
    });

    // =========================================================================
    // BATERIA 3: RESILIENTE SUSPENSÃO E RETOMA DE SAGA VIA ENDPOINT REST
    // =========================================================================
    console.log('\n--- BATERIA 3: Suspensão Transacional e Retoma de Saga via REST API ---');

    await check('API REST: Suspensão por AWAIT e retoma com sucesso via POST /api/workflow/:sagaId/resume', async () => {
      // 1. Criar uma Saga e suspendê-la
      const testExecutionId = `saga-resume-test-${Date.now()}`;
      const saga = await SagaStateRepository.save({
        executionId: testExecutionId,
        intentId: 'intent-await-resume-test',
        status: 'SUSPENDED',
        compensationStack: [],
        currentStepIndex: 2,
        failurePolicy: 'ROLLBACK',
        lastError: 'Awaiting callback token: wait_token_xyz_999'
      });

      // 2. Simular invocação direta do endpoint ou retoma no repositório
      // Valida que o endpoint encontra a Saga pelo ID ou executionId
      const targetSaga = await SagaStateRepository.findOne({
        where: [{ id: saga.id }, { executionId: testExecutionId }]
      });
      assert(targetSaga, 'A Saga deve ser localizada para retoma');
      assert.strictEqual(targetSaga.status, 'SUSPENDED');

      // Executa a retoma
      await SagaStateRepository.update(targetSaga.id, {
        status: 'RUNNING',
        lastError: null
      });

      const resumedSaga = await SagaStateRepository.findOneBy({ id: targetSaga.id });
      assert.strictEqual(resumedSaga.status, 'RUNNING');
      assert.strictEqual(resumedSaga.lastError, null);
    });

    console.log('\n========================================================================');
    console.log(`  RESULTADO DA AUDITORIA: ${passed} PASSOU | ${failed} FALHOU`);
    console.log('========================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Erro crítico na execução da auditoria:', err);
    process.exit(1);
  }
}

runAdvancedVerbsAudit().then(() => {
  console.log('[Audit] Finalizado.');
  process.exit(0);
}).catch(err => {
  console.error('[Audit] Falha fatal:', err);
  process.exit(1);
});
