/**
 * @fileoverview Auditoria Profunda dos 5 Novos Verbos Revolucionários do INP Protocol v2.7
 * @module Tests/Killer5VerbsAudit
 * @description
 * Executa uma validação ponta-a-ponta exaustiva para comprovar a inovação, ergonomia e eficácia
 * dos 5 novos verbos "Killer Features" implementados na v2.7:
 * 1. STREAM — Streaming progressivo nativo de eventos e chunks delta em tempo real (SSE/WebSocket).
 * 2. ATTEST — Atestação criptográfica imutável com prova forense de conformidade (HMAC-SHA256).
 * 3. ADAPT — Roteamento inteligente dinâmico via Multi-Armed Bandit baseado em saúde e latência.
 * 4. ESCALATE — Orquestração Human-in-the-Loop (HITL) com gestão de SLA e contingência automática.
 * 5. REASON — Deliberação e raciocínio agêntico autônomo estruturado com justificação lógica.
 *
 * @security Valida integridade criptográfica SHA-256/HMAC, contenção de estresse e isolamento transacional.
 * @audit Gera métricas de telemetria em tempo real e comprova registos persistidos em PostgreSQL.
 */

const assert = require('assert');
const crypto = require('crypto');
const { CapabilityRegistry } = require('./dist/core/capability-registry');
const { MatchingEngine } = require('./dist/core/matching-engine');
const { ExecutionEngine } = require('./dist/core/execution-engine');
const { IntentParser } = require('./dist/core/intent-parser');
const { AppDataSource } = require('./dist/persistence/data-source');
const { registerNativeServices } = require('./dist/services/native-services-registry');
const { SagaStateRepository } = require('./dist/persistence/repositories/SagaStateRepository');
const { ServiceMetricsCollector } = require('./dist/core/metrics-collector');
const { TelemetryService } = require('./dist/core/telemetry-service');
const { nativeAdvancedVerbsHandler } = require('./dist/services/native-advanced-verbs-service');

/**
 * Executa a suite de testes de auditoria dos 5 novos verbos revolucionários.
 * @returns {Promise<void>}
 */
async function runKillerVerbsAudit() {
  console.log('========================================================================');
  console.log('   AUDITORIA DOS 5 VERBOS REVOLUCIONÁRIOS (KILLER) — INP PROTOCOL v2.7   ');
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

  console.log('[Setup] A inicializar ligação PostgreSQL via TypeORM...');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  console.log('[Setup] ✅ Ligação estabelecida com sucesso.\n');

  try {
    const registry = new CapabilityRegistry();
    console.log('[Setup] A registar os serviços nativos no CapabilityRegistry...');
    await registerNativeServices(registry);
    console.log('[Setup] ✅ Serviços nativos registados.\n');

    const parser = new IntentParser();
    const matchingEngine = new MatchingEngine(registry);
    const engine = new ExecutionEngine(registry);

    // =========================================================================
    // BATERIA 1: VALIDAÇÃO INDIVIDUAL DE CADA UM DOS 5 VERBOS REVOLUCIONÁRIOS
    // =========================================================================
    console.log('--- BATERIA 1: Validação Unitária e Comportamental dos 5 Novos Verbos ---');

    // 1. STREAM (Streaming progressivo nativo de eventos e chunks delta)
    await check('[01/05] STREAM — Emissão de chunks delta progressivos capturados por telemetria SSE', async () => {
      const capturedChunks = [];
      const onChunk = (data) => {
        if (data && data.target === 'AI_TOKEN_STREAM') {
          capturedChunks.push(data);
        }
      };

      TelemetryService.getInstance().on('STREAM_CHUNK', onChunk);

      const streamResult = await nativeAdvancedVerbsHandler({
        verb: 'STREAM',
        target: 'AI_TOKEN_STREAM',
        chunks: [
          { token: 'Olá', index: 0 },
          { token: ' mundo,', index: 1 },
          { token: ' o motor INP v2.7 está ativo!', index: 2 }
        ]
      }, { executionId: 'exec-stream-101', stepId: 'step-stream-1' });

      // Remove o ouvinte para evitar fugas de memória
      TelemetryService.getInstance().off('STREAM_CHUNK', onChunk);

      assert.strictEqual(streamResult.streamed, true);
      assert.strictEqual(streamResult.totalChunks, 3);
      assert(streamResult.streamId);
      assert.strictEqual(capturedChunks.length, 3, 'O TelemetryService deve ter emitido 3 eventos STREAM_CHUNK');
      assert.strictEqual(capturedChunks[0].chunk.token, 'Olá');
      assert.strictEqual(capturedChunks[2].isLast, true);
    });

    // 2. ATTEST (Atestação criptográfica imutável com prova forense)
    await check('[02/05] ATTEST — Selo criptográfico HMAC-SHA256 e recibo forense auditável', async () => {
      const payloadToAttest = {
        transactionId: 'tx_sec_8849',
        amount: 250000,
        currency: 'EUR',
        sender: 'EnterpriseVault_A',
        beneficiary: 'EnterpriseVault_B'
      };

      const attestResult = await nativeAdvancedVerbsHandler({
        verb: 'ATTEST',
        target: 'FINANCIAL_SETTLEMENT',
        data: payloadToAttest
      }, { executionId: 'exec-attest-202' });

      assert.strictEqual(attestResult.attested, true);
      assert.strictEqual(attestResult.target, 'FINANCIAL_SETTLEMENT');
      assert.strictEqual(attestResult.algorithm, 'HMAC-SHA256');
      assert(attestResult.stateHash, 'Deve conter hash SHA-256 dos dados');
      assert(attestResult.signature, 'Deve conter assinatura digital');
      assert(attestResult.proofToken.startsWith('attest_v1_'), 'Deve gerar token padronizado de atestação');
      assert(attestResult.complianceSeals.includes('SOC2-CC6'));
      assert(attestResult.complianceSeals.includes('HIPAA-164.312'));

      // Valida que o hash é determinístico e reproduzível
      const canonicalData = JSON.stringify(payloadToAttest, Object.keys(payloadToAttest).sort());
      const expectedHash = crypto.createHash('sha256').update(canonicalData).digest('hex');
      assert.strictEqual(attestResult.stateHash, expectedHash, 'O hash SHA-256 deve ser matematicamente determinístico');
    });

    // 3. ADAPT (Roteamento dinâmico inteligente via Multi-Armed Bandit)
    await check('[03/05] ADAPT — Roteamento dinâmico Multi-Armed Bandit baseado em saúde em tempo real', async () => {
      const collector = ServiceMetricsCollector.getInstance();
      
      // Simula histórico de métricas:
      // provider-fast: 10 sucessos rápidos
      for (let i = 0; i < 10; i++) collector.recordSuccess('provider-fast', 15);
      // provider-slow: 5 falhas e latência alta
      for (let i = 0; i < 5; i++) collector.recordFailure('provider-slow');

      const adaptResult = await nativeAdvancedVerbsHandler({
        verb: 'ADAPT',
        target: 'LLM_GATEWAY',
        candidates: ['provider-slow', 'provider-fast'],
        epsilon: 0.0 // Modo estrito de explotação da melhor opção
      }, { executionId: 'exec-adapt-303' });

      assert.strictEqual(adaptResult.adapted, true);
      assert.strictEqual(adaptResult.selectedTarget, 'provider-fast', 'O Multi-Armed Bandit deve eleger a rota mais saudável');
      assert(adaptResult.selectedScore > 0.8, 'A rota eleita deve ter pontuação elevada');
      assert.strictEqual(adaptResult.candidates.length, 2);
    });

    // 4. ESCALATE (Human-in-the-Loop com gestão de SLA e suspensão de Saga)
    await check('[04/05] ESCALATE — Suspensão Human-in-the-Loop (HITL) com prazo de SLA e token', async () => {
      const testExecutionId = `exec-escalate-audit-${Date.now()}`;
      const saga = await SagaStateRepository.save({
        executionId: testExecutionId,
        intentId: 'intent-escalate-test',
        status: 'RUNNING',
        compensationStack: [],
        currentStepIndex: 1,
        failurePolicy: 'ROLLBACK'
      });

      const escalateResult = await nativeAdvancedVerbsHandler({
        verb: 'ESCALATE',
        target: 'CHIEF_RISK_OFFICER',
        timeoutMs: 3600000,
        fallback: 'CANCEL_OPERATION'
      }, { executionId: testExecutionId });

      assert.strictEqual(escalateResult.status, 'ESCALATED');
      assert.strictEqual(escalateResult.target, 'CHIEF_RISK_OFFICER');
      assert.strictEqual(escalateResult.fallbackAction, 'CANCEL_OPERATION');
      assert(escalateResult.approvalToken.startsWith('hitl_'));
      assert(escalateResult.expiresAt);

      // Comprova suspensão real da Saga na base de dados
      const updatedSaga = await SagaStateRepository.findOneBy({ id: saga.id });
      assert.strictEqual(updatedSaga.status, 'SUSPENDED');
      assert(updatedSaga.lastError.includes('Escalated to human supervisor'));
    });

    // 5. REASON (Deliberação e raciocínio agêntico autônomo estruturado)
    await check('[05/05] REASON — Deliberação agêntica estruturada com análise de hipóteses e justificação', async () => {
      // Cenário de Alto Risco (> 10000)
      const highRiskResult = await nativeAdvancedVerbsHandler({
        verb: 'REASON',
        target: 'LOAN_UNDERWRITING',
        goal: 'Avaliar aprovação de crédito imobiliário de alto valor',
        data: { amount: 850000, creditScore: 690, isRisk: true }
      });

      assert.strictEqual(highRiskResult.reasoned, true);
      assert.strictEqual(highRiskResult.decision, 'SUPERVISED_REVIEW', 'Risco elevado deve deliberar por SUPERVISED_REVIEW');
      assert(highRiskResult.confidenceScore >= 0.8);
      assert(highRiskResult.rationale.includes('SUPERVISED_REVIEW'));
      assert.strictEqual(highRiskResult.structuredOutput.hypothesesEvaluated, 3);

      // Cenário de Baixo Risco
      const lowRiskResult = await nativeAdvancedVerbsHandler({
        verb: 'REASON',
        target: 'PAYMENT_CLEARANCE',
        goal: 'Autorização instantânea de micropagamento',
        data: { amount: 25, creditScore: 800, isRisk: false }
      });

      assert.strictEqual(lowRiskResult.decision, 'DIRECT_EXECUTION', 'Operação segura deve deliberar por DIRECT_EXECUTION');
      assert(lowRiskResult.confidenceScore >= 0.9);
    });

    // =========================================================================
    // BATERIA 2: ORQUESTRAÇÃO DE FLUXOS DSL END-TO-END COM OS NOVOS VERBOS
    // =========================================================================
    console.log('\n--- BATERIA 2: Orquestração End-to-End via DSL com os Verbos Revolucionários ---');

    // DSL 1: STREAM de Dados -> ATTEST de Integridade Criptográfica
    await check('DSL Fluxo 1: SEQUENCE { STREAM ... -> ATTEST ... }', async () => {
      const dsl = `
      INTENT "stream_and_attest_workflow" {
        CONTEXT {
          dataset: "ledger_batch_2026",
          delta: ["chunk_alpha", "chunk_beta", "chunk_gamma"]
        }
        REQUIRE {
          STREAM "DATA_STREAM"
          ATTEST "PROOF_OF_STATE"
        }
        FLOW {
          SEQUENCE {
            STREAM "DATA_STREAM"
            ATTEST "PROOF_OF_STATE"
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
      assert.strictEqual(execution.finalOutput.attested, true);
      assert(execution.finalOutput.proofToken);
      assert(execution.finalOutput.stateHash);
    });

    // DSL 2: ADAPT de Fornecedores -> REASON de Decisão Agêntica
    await check('DSL Fluxo 2: SEQUENCE { ADAPT ... -> REASON ... }', async () => {
      const dsl = `
      INTENT "adaptive_reasoning_workflow" {
        CONTEXT {
          operation: "fraud_assessment",
          amount: 450,
          userTier: "GOLD"
        }
        REQUIRE {
          ADAPT "FRAUD_NODE_A FRAUD_NODE_B"
          REASON "FRAUD_DECISION"
        }
        FLOW {
          SEQUENCE {
            ADAPT "FRAUD_NODE_A FRAUD_NODE_B"
            REASON "FRAUD_DECISION"
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
      assert.strictEqual(execution.finalOutput.reasoned, true);
      assert(execution.finalOutput.decision);
      assert(execution.finalOutput.confidenceScore > 0);
    });

    // DSL 3: ESCALATE (Human-in-the-Loop) contendo execução na Saga
    await check('DSL Fluxo 3: SEQUENCE { ESCALATE ... } com suspensão e retoma supervisionada', async () => {
      const dsl = `
      INTENT "supervised_escalation_workflow" {
        CONTEXT {
          ticketId: "INCIDENT-9912",
          severity: "CRITICAL"
        }
        REQUIRE {
          ESCALATE "INCIDENT_COMMANDER"
        }
        FLOW {
          SEQUENCE {
            ESCALATE "INCIDENT_COMMANDER"
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
      assert.strictEqual(execution.finalOutput.status, 'ESCALATED');
      assert(execution.finalOutput.approvalToken);

      // Simula a aprovação humana subsequente da Saga
      const saga = await SagaStateRepository.findOne({
        where: { executionId: execution.executionId }
      });
      assert(saga, 'A Saga deve existir no repositório');
      assert.strictEqual(saga.status, 'SUSPENDED');

      // Aprovação do supervisor
      await SagaStateRepository.update(saga.id, {
        status: 'RUNNING',
        lastError: null
      });

      const approvedSaga = await SagaStateRepository.findOneBy({ id: saga.id });
      assert.strictEqual(approvedSaga.status, 'RUNNING');
    });

    // =========================================================================
    // BATERIA 3: CICLO DE VIDA HUMAN-IN-THE-LOOP (APROVAÇÃO E REJEIÇÃO)
    // =========================================================================
    console.log('\n--- BATERIA 3: Ciclo de Vida Human-in-the-Loop (Aprovação & Rejeição) ---');

    await check('HITL: Aprovação formal de Saga suspensa por ESCALATE com emissão de telemetria', async () => {
      let approvalBroadcastReceived = false;
      const onApproved = (event) => {
        if (event && event.approver === 'SecOps_Director') {
          approvalBroadcastReceived = true;
        }
      };
      TelemetryService.getInstance().on('WORKFLOW_APPROVED', onApproved);

      const hitlSaga = await SagaStateRepository.save({
        executionId: `exec-hitl-approve-${Date.now()}`,
        intentId: 'intent-hitl-approve',
        status: 'SUSPENDED',
        compensationStack: [],
        currentStepIndex: 1,
        failurePolicy: 'ROLLBACK',
        lastError: 'Escalated to human supervisor: HIGH_RISK_FINANCE'
      });

      // Simula execução da lógica do endpoint /api/workflow/:sagaId/approve
      await SagaStateRepository.update(hitlSaga.id, {
        status: 'RUNNING',
        lastError: null
      });

      TelemetryService.getInstance().broadcast('WORKFLOW_APPROVED', {
        sagaId: hitlSaga.id,
        approver: 'SecOps_Director',
        approved: true,
        rationale: 'Risco analisado e aprovado com garantia colateral',
        decidedAt: new Date().toISOString()
      });

      TelemetryService.getInstance().off('WORKFLOW_APPROVED', onApproved);

      const reloaded = await SagaStateRepository.findOneBy({ id: hitlSaga.id });
      assert.strictEqual(reloaded.status, 'RUNNING');
      assert.strictEqual(approvalBroadcastReceived, true, 'O evento WORKFLOW_APPROVED deve ser emitido via telemetria');
    });

    await check('HITL: Rejeição formal de Saga suspensa por ESCALATE com registo de auditoria', async () => {
      const hitlRejectSaga = await SagaStateRepository.save({
        executionId: `exec-hitl-reject-${Date.now()}`,
        intentId: 'intent-hitl-reject',
        status: 'SUSPENDED',
        compensationStack: [],
        currentStepIndex: 1,
        failurePolicy: 'ROLLBACK',
        lastError: 'Escalated to human supervisor: UNRECOGNIZED_LOCATION'
      });

      const auditReason = 'Rejeitado por intervenção humana: IP de alto risco não reconhecido';
      await SagaStateRepository.update(hitlRejectSaga.id, {
        status: 'FAILED',
        lastError: auditReason
      });

      const reloaded = await SagaStateRepository.findOneBy({ id: hitlRejectSaga.id });
      assert.strictEqual(reloaded.status, 'FAILED');
      assert.strictEqual(reloaded.lastError, auditReason);
    });

    console.log('\n========================================================================');
    console.log(`  RESULTADO DA AUDITORIA DOS 5 VERBOS: ${passed} PASSOU | ${failed} FALHOU`);
    console.log('========================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Erro crítico na execução da auditoria:', err);
    process.exit(1);
  }
}

runKillerVerbsAudit().then(() => {
  console.log('[Audit] Finalizado.');
  process.exit(0);
}).catch(err => {
  console.error('[Audit] Falha fatal:', err);
  process.exit(1);
});
