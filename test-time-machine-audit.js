/**
 * @fileoverview Suíte de Auditoria e Teste de Estresse da Máquina do Tempo do Motor (TimeMachineEngine v2.0)
 * @description
 * Valida com rigor as 6 dimensões de alta resiliência e auditoria temporal do INP Protocol:
 * 1. Reversão Resiliente de Espectro Total (Anti-Cascata Órfã em Rollback LIFO).
 * 2. Resgate Autónomo de Sagas em FORWARD_RETRY_PENDING no arranque do gateway.
 * 3. Captura Contínua de Snapshots Atómicos com Assinatura SHA-256 e Deltas Estruturais.
 * 4. Reconstituição Temporal Pontual (Point-in-Time State Recovery via travelTo).
 * 5. Simulação Preditiva "What-If" em Sandbox Dry-Run (Neutralização de Mutações Externas).
 * 6. Verbos Nativos de Viagem no Tempo (TIME_TRAVEL, REPLAY, TIMELINE) e Rotas REST.
 */

const assert = require('assert');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

async function runTimeMachineAudit() {
  console.log('='.repeat(80));
  console.log('  INP PROTOCOL — AUDITORIA COMPLETA DA MÁQUINA DO TEMPO DO MOTOR v2.0');
  console.log('='.repeat(80));

  let passedTests = 0;
  let totalTests = 0;

  async function check(desc, fn) {
    totalTests++;
    process.stdout.write(`• ${desc}... `);
    const start = process.hrtime.bigint();
    try {
      await fn();
      const dur = Number(process.hrtime.bigint() - start) / 1_000_000;
      console.log(`✅ PASSOU (${dur.toFixed(3)} ms)`);
      passedTests++;
    } catch (err) {
      console.log(`❌ FALHOU`);
      console.error(`  Erro: ${err.message}`);
    }
  }

  // Importações dos módulos compilados
  const { AppDataSource } = require('./dist/persistence/data-source');
  const { SagaStateRepository } = require('./dist/persistence/repositories/SagaStateRepository');
  const { TimeMachineEngine } = require('./dist/core/time-machine-engine');
  const { ExecutionEngine } = require('./dist/core/execution-engine');
  const { CapabilityRegistry } = require('./dist/core/capability-registry');
  const { SagaRecoveryManager } = require('./dist/core/saga-recovery-manager');
  const { nativeAdvancedVerbsHandler } = require('./dist/services/native-advanced-verbs-service');

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  let sagaTestId = null;

  try {
    // --------------------------------------------------------------------------
    // 1. REVERSÃO RESILIENTE DE ESPECTRO TOTAL (ANTI-CASCATA ÓRFÃ)
    // --------------------------------------------------------------------------
    console.log('\n--- 1. REVERSÃO RESILIENTE DE ESPECTRO TOTAL (ANTI-CASCATA ÓRFÃ) ---');

    await check('Compensação não abandona passos anteriores quando um nó intermediário falha', async () => {
      const registry = new CapabilityRegistry();
      const executedSteps = [];

      // Regista capacidades mock para testar a pilha de compensação
      await registry.register({
        id: 'mock-hotel-svc',
        name: 'Mock Hotel Service',
        capabilities: [
          { verb: 'CANCEL', target: 'HOTEL', description: 'Cancel hotel' },
          { verb: 'CANCEL', target: 'CAR', description: 'Cancel car' },
          { verb: 'REFUND', target: 'FLIGHT', description: 'Refund flight' },
          { verb: 'REFUND', target: 'CONCERT', description: 'Refund concert' }
        ],
        trustScore: 100,
        securityLevel: 'HIGH',
        handler: async (input, ctx) => {
          const action = `${input.verb || 'ACTION'} ${input.target || 'TARGET'}`;
          executedSteps.push(action);

          // O cancelamento do CAR simula falha persistente de rede (3 tentativas falhas)
          if (input.target === 'CAR' || (input.context && input.context.target === 'CAR')) {
            throw new Error('Serviço de locadora indisponível temporariamente (503 Service Unavailable).');
          }
          return { status: 'COMPENSATED_OK', action };
        }
      });

      const engine = new ExecutionEngine(registry);
      sagaTestId = uuidv4();
      const executionId = uuidv4();

      // Pilha LIFO de compensação: [CONCERT, FLIGHT, CAR, HOTEL]
      // A ordem de descarregamento LIFO será:
      // 1. CANCEL HOTEL (sucesso)
      // 2. CANCEL CAR (falha)
      // 3. REFUND FLIGHT (NÃO PODE SER ABANDONADO!)
      // 4. REFUND CONCERT (NÃO PODE SER ABANDONADO!)
      const stack = [
        { capability: 'REFUND CONCERT', context: { target: 'CONCERT', amount: 80 } },
        { capability: 'REFUND FLIGHT', context: { target: 'FLIGHT', amount: 350 } },
        { capability: 'CANCEL CAR', context: { target: 'CAR', leaseId: 'car_123' } },
        { capability: 'CANCEL HOTEL', context: { target: 'HOTEL', bookingId: 'htl_456' } }
      ];

      // Criação do registo no banco para aquisição atómica de bloqueio pessimista
      await SagaStateRepository.save({
        id: sagaTestId,
        executionId,
        intentId: 'intent_test_anti_orphan',
        status: 'RUNNING',
        compensationStack: stack,
        currentStepIndex: 4,
        failurePolicy: 'ROLLBACK'
      });

      try {
        // Executa resumeRollback no engine
        await engine.resumeRollback(sagaTestId, stack);
      } catch (rollbackErr) {
        // Esperado falhar parcialmente devido ao CAR
        assert.ok(rollbackErr.message.includes('falha') || rollbackErr.message.includes('CAR'));
      }

      // Validação crítica: os passos FLIGHT e CONCERT que estavam depois do CAR na pilha FORAM EXECUTADOS!
      const hotelExecuted = executedSteps.some(s => s.includes('HOTEL'));
      const carAttempted = executedSteps.some(s => s.includes('CAR'));
      const flightExecuted = executedSteps.some(s => s.includes('FLIGHT'));
      const concertExecuted = executedSteps.some(s => s.includes('CONCERT'));

      assert.strictEqual(hotelExecuted, true, 'HOTEL deveria ter sido compensado');
      assert.strictEqual(carAttempted, true, 'CAR deveria ter sido tentado');
      assert.strictEqual(flightExecuted, true, 'FLIGHT NÃO pode ser abandonado quando CAR falha!');
      assert.strictEqual(concertExecuted, true, 'CONCERT NÃO pode ser abandonado quando CAR falha!');

      // Verifica status final da Saga: deve ser PARTIALLY_COMPENSATED (não abandonada)
      const finalSaga = await SagaStateRepository.findOneBy({ id: sagaTestId });
      assert.strictEqual(finalSaga.status, 'PARTIALLY_COMPENSATED');
    });

    // --------------------------------------------------------------------------
    // 2. RESGATE AUTÓNOMO DE SAGAS EM FORWARD_RETRY_PENDING
    // --------------------------------------------------------------------------
    console.log('\n--- 2. RESGATE AUTÓNOMO DE SAGAS EM FORWARD_RETRY_PENDING ---');

    await check('SagaRecoveryManager identifica e avança sagas com status FORWARD_RETRY_PENDING', async () => {
      const { SagaRecoveryManager } = require('./dist/core/saga-recovery-manager');
      const registry = new CapabilityRegistry();

      // Injeta uma saga simulando ter falhado com FORWARD_RETRY há mais de 5 minutos
      const forwardSagaId = uuidv4();
      const forwardExecId = uuidv4();
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);

      await SagaStateRepository.save({
        id: forwardSagaId,
        executionId: forwardExecId,
        intentId: 'intent_forward_test',
        status: 'FORWARD_RETRY_PENDING',
        compensationStack: [],
        currentStepIndex: 2,
        failurePolicy: 'FORWARD_RETRY',
        updatedAt: sixMinutesAgo
      });

      // Força a data de atualização para simular staleness de 6 minutos
      await SagaStateRepository.createQueryBuilder()
        .update()
        .set({ updatedAt: sixMinutesAgo })
        .where('id = :id', { id: forwardSagaId })
        .execute();

      await SagaRecoveryManager.recoverPendingSagas(registry);

      // Limpeza
      await SagaStateRepository.delete({ id: forwardSagaId });
    });

    // --------------------------------------------------------------------------
    // 3. CAPTURA CONTÍNUA DE SNAPSHOTS E DELTAS ESTRUTURAIS (SHA-256)
    // --------------------------------------------------------------------------
    console.log('\n--- 3. SNAPSHOTS ATÓMICOS & DELTAS ESTRUTURAIS ---');

    await check('TimeMachineEngine captura fotografia imutável, gera hash SHA-256 e computa deltas', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      timeMachine.clearAll();

      const execId = `exec_${uuidv4()}`;

      // Passo 0: Contexto inicial
      const ctx0_before = { accountId: 'acc_01', balance: 1000 };
      const ctx0_after = { accountId: 'acc_01', balance: 1000, authenticated: true };

      const snap0 = timeMachine.captureSnapshot(
        execId, 0, 'step_auth', 'AUTHENTICATE USER',
        ctx0_before, ctx0_after, 'COMPLETED'
      );

      assert.strictEqual(snap0.stepIndex, 0);
      assert.strictEqual(snap0.status, 'COMPLETED');
      assert.ok(snap0.contextHash.length === 64, 'Hash SHA-256 deve ter 64 caracteres hex');
      assert.strictEqual(snap0.deltaDiff.added.authenticated, true);

      // Passo 1: Mutação de saldo e inclusão de taxa
      const ctx1_before = ctx0_after;
      const ctx1_after = { accountId: 'acc_01', balance: 750, authenticated: true, feeApplied: 10 };

      const snap1 = timeMachine.captureSnapshot(
        execId, 1, 'step_debit', 'DEBIT BALANCE',
        ctx1_before, ctx1_after, 'COMPLETED'
      );

      assert.strictEqual(snap1.stepIndex, 1);
      assert.strictEqual(snap1.deltaDiff.added.feeApplied, 10);
      assert.deepStrictEqual(snap1.deltaDiff.modified.balance, { before: 1000, after: 750 });

      // Consulta à linha do tempo
      const timeline = timeMachine.getTimeline(execId);
      assert.strictEqual(timeline.length, 2);
    });

    // --------------------------------------------------------------------------
    // 4. RECONSTITUIÇÃO TEMPORAL PONTUAL (travelTo) E DIFF DE ESTADOS
    // --------------------------------------------------------------------------
    console.log('\n--- 4. RECONSTITUIÇÃO TEMPORAL PONTUAL (travelTo) E DIFF ---');

    await check('travelTo recupera com exatidão cirúrgica o estado no momento do Passo 0', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const execId = timeMachine.getTimeline(Array.from(timeMachine['timelines'].keys())[0])[0].executionId;

      const restoredContext0 = timeMachine.travelTo(execId, 0);
      assert.strictEqual(restoredContext0.balance, 1000);
      assert.strictEqual(restoredContext0.feeApplied, undefined);

      const restoredContext1 = timeMachine.travelTo(execId, 1);
      assert.strictEqual(restoredContext1.balance, 750);
      assert.strictEqual(restoredContext1.feeApplied, 10);
    });

    await check('calculateStateDiff sintetiza exatamente todas as alterações entre Passo 0 e Passo 1', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const execId = timeMachine.getTimeline(Array.from(timeMachine['timelines'].keys())[0])[0].executionId;

      const diff = timeMachine.calculateStateDiff(execId, 0, 1);
      assert.strictEqual(diff.fromStepIndex, 0);
      assert.strictEqual(diff.toStepIndex, 1);
      assert.strictEqual(diff.addedKeys.feeApplied, 10);
      assert.deepStrictEqual(diff.modifiedKeys.balance, { before: 1000, after: 750 });
      assert.ok(diff.summary.includes('1 campos adicionados'));
    });

    // --------------------------------------------------------------------------
    // 5. SIMULAÇÃO PREDITIVA WHAT-IF EM SANDBOX (DRY-RUN)
    // --------------------------------------------------------------------------
    console.log('\n--- 5. SIMULAÇÃO PREDITIVA WHAT-IF EM SANDBOX (DRY-RUN) ---');

    await check('simulateWhatIf projeta execução alternativa neutralizando mutações reais de pagamento', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const execId = timeMachine.getTimeline(Array.from(timeMachine['timelines'].keys())[0])[0].executionId;

      const futureSteps = [
        { action: 'AUTHENTICATE USER' },
        { action: 'DEBIT BALANCE' },
        { action: 'TRANSFER FUNDS', payload: { transferAmount: 500 } },
        { action: 'DISPATCH NOTIFICATION', payload: { sent: true } }
      ];

      // Simula: "O que teria acontecido a partir do Passo 0 se balance fosse 50.000 em vez de 1.000?"
      const simResult = timeMachine.simulateWhatIf(
        execId,
        0,
        { balance: 50000, vipCustomer: true },
        futureSteps
      );

      assert.strictEqual(simResult.status, 'SIMULATION_SUCCESS');
      assert.strictEqual(simResult.mutationsPrevented, 1, 'Deve neutralizar a mutação de TRANSFER FUNDS');
      assert.strictEqual(simResult.projectedOutput.vipCustomer, true);
      assert.strictEqual(simResult.projectedOutput.balance, 50000);
      assert.strictEqual(simResult.projectedOutput.simulated_result_2.status, 'SIMULATED_SUCCESS');
      assert.ok(simResult.diffSummary.includes('mutações externas prevenidas'));
    });

    // --------------------------------------------------------------------------
    // 6. VERBOS NATIVOS DE VIAGEM NO TEMPO (TIME_TRAVEL, REPLAY, TIMELINE)
    // --------------------------------------------------------------------------
    console.log('\n--- 6. VERBOS NATIVOS DE VIAGEM NO TEMPO & CONTROLADORES ---');

    await check('Verbo TIMELINE recupera a linha do tempo através do motor nativo de verbos', async () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const execId = timeMachine.getTimeline(Array.from(timeMachine['timelines'].keys())[0])[0].executionId;

      const res = await nativeAdvancedVerbsHandler({
        verb: 'TIMELINE',
        target: '*',
        executionId: execId
      });

      assert.strictEqual(res.timeTravel, true);
      assert.strictEqual(res.operation, 'TIMELINE');
      assert.strictEqual(res.snapshotsCount, 2);
    });

    await check('Verbo TIME_TRAVEL com ação DIFF calcula divergências temporais via DSL', async () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const execId = timeMachine.getTimeline(Array.from(timeMachine['timelines'].keys())[0])[0].executionId;

      const res = await nativeAdvancedVerbsHandler({
        verb: 'TIME_TRAVEL',
        target: '*',
        action: 'DIFF',
        executionId: execId,
        fromStep: 0,
        toStep: 1
      });

      assert.strictEqual(res.timeTravel, true);
      assert.strictEqual(res.operation, 'DIFF');
      assert.strictEqual(res.addedKeys.feeApplied, 10);
    });

    await check('Verbo REPLAY reconstitui contexto histórico a partir de passo anterior', async () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const execId = timeMachine.getTimeline(Array.from(timeMachine['timelines'].keys())[0])[0].executionId;

      const res = await nativeAdvancedVerbsHandler({
        verb: 'REPLAY',
        target: '*',
        executionId: execId,
        stepIndex: 0
      });

      assert.strictEqual(res.timeTravel, true);
      assert.strictEqual(res.status, 'RESTORED_SUCCESSFULLY');
      assert.strictEqual(res.restoredContext.balance, 1000);
    });

    // --------------------------------------------------------------------------
    // 7. DESEMPENHO NO HOT-PATH (STRUCTUREDCLONE & FASTDEEPEQUAL)
    // --------------------------------------------------------------------------
    console.log('\n--- 7. DESEMPENHO NO HOT-PATH (STRUCTUREDCLONE & FASTDEEPEQUAL) ---');

    await check('1.000 capturas de snapshots com delta estrutural executam em alta velocidade', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const benchExecId = `exec_bench_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
      let currentCtx = { count: 0, items: [1, 2, 3], nested: { sub: 'val', active: true } };

      const t0 = process.hrtime.bigint();
      for (let i = 0; i < 1000; i++) {
        const nextCtx = { ...currentCtx, count: i + 1, updatedField: `field_${i % 10}` };
        timeMachine.captureSnapshot(benchExecId, i, `Step ${i}`, 'BENCHMARK_ACTION', currentCtx, nextCtx, 'COMPLETED');
        currentCtx = nextCtx;
      }
      const t1 = process.hrtime.bigint();
      const durMs = Number(t1 - t0) / 1_000_000;

      const timeline = timeMachine.getTimeline(benchExecId);
      assert.strictEqual(timeline.length, 500, 'MAX_SNAPSHOTS_PER_EXECUTION (500) respeitado pelo container LRU');
      assert.ok(durMs < 500, `1.000 capturas devem executar sob 500ms (tempo: ${durMs.toFixed(2)}ms)`);
    });

    // --------------------------------------------------------------------------
    // 8. PARALLEL ROLLBACK BATCHING CONCORRENTE
    // --------------------------------------------------------------------------
    console.log('\n--- 8. PARALLEL ROLLBACK BATCHING CONCORRENTE ---');

    await check('Passos paralelos com mesmo batchId são compensados concorrentemente', async () => {
      const registry = new CapabilityRegistry();
      const parallelLogs = [];

      await registry.register({
        id: 'mock-parallel-service',
        name: 'Mock Parallel Service',
        capabilities: [
          { verb: 'UNDO', target: 'SERVICE_A', description: 'Undo A' },
          { verb: 'UNDO', target: 'SERVICE_B', description: 'Undo B' },
          { verb: 'UNDO', target: 'SERVICE_C', description: 'Undo C' }
        ],
        trustScore: 100,
        securityLevel: 'HIGH',
        handler: async (input, ctx) => {
          const name = input.target || 'UNKNOWN';
          const startTime = Date.now();
          parallelLogs.push({ name, start: startTime });
          // Simula pequena latência de rede
          await new Promise(r => setTimeout(r, 60));
          const endTime = Date.now();
          const logEntry = parallelLogs.find(l => l.name === name);
          if (logEntry) logEntry.end = endTime;
          return { status: 'UNDO_OK', name, isRollback: ctx.isRollback };
        }
      });

      // Aquece a resolução de capacidades para isolar a concorrência pura do rollback
      await registry.findServicesForCapability('UNDO SERVICE_A');
      await registry.findServicesForCapability('UNDO SERVICE_B');
      await registry.findServicesForCapability('UNDO SERVICE_C');

      const engine = new ExecutionEngine(registry);
      const batchSagaId = uuidv4();
      const batchExecId = uuidv4();
      const commonBatchId = 'batch_test_concurrent_99';

      const parallelStack = [
        { capability: 'UNDO SERVICE_A', context: { target: 'SERVICE_A' }, batchId: commonBatchId },
        { capability: 'UNDO SERVICE_B', context: { target: 'SERVICE_B' }, batchId: commonBatchId },
        { capability: 'UNDO SERVICE_C', context: { target: 'SERVICE_C' }, batchId: commonBatchId }
      ];

      await SagaStateRepository.save({
        id: batchSagaId,
        executionId: batchExecId,
        intentId: 'intent_batch_test',
        status: 'RUNNING',
        compensationStack: parallelStack,
        currentStepIndex: 3,
        failurePolicy: 'ROLLBACK'
      });

      const startRollback = Date.now();
      await engine.resumeRollback(batchSagaId, parallelStack);
      const totalTime = Date.now() - startRollback;

      assert.strictEqual(parallelLogs.length, 3, 'Todos os 3 serviços foram compensados');
      // Verifica sobreposição temporal (concorrência estrita): o último a iniciar começou antes do primeiro a terminar
      const maxStart = Math.max(...parallelLogs.map(l => l.start));
      const minEnd = Math.min(...parallelLogs.map(l => l.end));
      assert.ok(maxStart <= minEnd, `As execuções devem sobrepor-se temporalmente (concorrência estrita: maxStart=${maxStart} <= minEnd=${minEnd})`);

      const finalSaga = await SagaStateRepository.findOneBy({ id: batchSagaId });
      assert.strictEqual(finalSaga.status, 'COMPENSATED');

      await SagaStateRepository.delete({ id: batchSagaId });
    });

    // --------------------------------------------------------------------------
    // 9. CABEÇALHOS DE IDEMPOTÊNCIA BANCÁRIA (X-SAGA-ROLLBACK)
    // --------------------------------------------------------------------------
    console.log('\n--- 9. CABEÇALHOS DE IDEMPOTÊNCIA BANCÁRIA ---');

    await check('Motor propaga sinalização explícita de Rollback no contexto da compensação', async () => {
      const registry = new CapabilityRegistry();
      let capturedContext = null;

      await registry.register({
        id: 'mock-banking-service',
        name: 'Mock Banking Service',
        capabilities: [
          { verb: 'REFUND', target: 'ESCROW', description: 'Refund escrow' }
        ],
        trustScore: 100,
        securityLevel: 'HIGH',
        handler: async (input, ctx) => {
          capturedContext = { ...ctx };
          return { refunded: true };
        }
      });

      const engine = new ExecutionEngine(registry);
      const bankingSagaId = uuidv4();
      const bankingExecId = uuidv4();

      const stack = [
        { capability: 'REFUND ESCROW', context: { target: 'ESCROW', amount: 5000 } }
      ];

      await SagaStateRepository.save({
        id: bankingSagaId,
        executionId: bankingExecId,
        intentId: 'intent_banking_audit',
        status: 'RUNNING',
        compensationStack: stack,
        currentStepIndex: 1,
        failurePolicy: 'ROLLBACK'
      });

      await engine.resumeRollback(bankingSagaId, stack);

      assert.ok(capturedContext !== null, 'Handler foi chamado');
      assert.strictEqual(capturedContext.isRollback, true, 'isRollback deve ser verdadeiro durante o estorno');

      await SagaStateRepository.delete({ id: bankingSagaId });
    });

    // --------------------------------------------------------------------------
    // 10. TIME-TRAVEL FORKING & RASTREIO DE LINHAGEM
    // --------------------------------------------------------------------------
    console.log('\n--- 10. TIME-TRAVEL FORKING COM LINHAGEM ---');

    await check('forkExecution ramifica execução e preserva cadeia de custódia e proveniência', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const parentExecId = `exec_parent_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

      timeMachine.captureSnapshot(
        parentExecId,
        0,
        'Initialize Account',
        'INIT',
        {},
        { accountId: 'acc_100', tier: 'SILVER', balance: 500 },
        'COMPLETED'
      );

      timeMachine.captureSnapshot(
        parentExecId,
        1,
        'Upgrade Request',
        'UPGRADE',
        { accountId: 'acc_100', tier: 'SILVER', balance: 500 },
        { accountId: 'acc_100', tier: 'GOLD', balance: 400 },
        'COMPLETED'
      );

      // Bifurcação temporal a partir do Passo 0 com substituição de tier
      const forkResult = timeMachine.forkExecution(parentExecId, 0, { tier: 'PLATINUM', bonus: 100 });

      assert.ok(forkResult.forkedExecutionId.startsWith('exec_fork_'));
      assert.strictEqual(forkResult.parentExecutionId, parentExecId);
      assert.strictEqual(forkResult.fromStepIndex, 0);
      assert.strictEqual(forkResult.context.accountId, 'acc_100');
      assert.strictEqual(forkResult.context.tier, 'PLATINUM');
      assert.strictEqual(forkResult.context.bonus, 100);
      assert.strictEqual(forkResult.context._forkedFrom.parentExecutionId, parentExecId);
      assert.strictEqual(forkResult.lineage.parentSnapshotsCount, 2);

      // Verifica se a nova linha do tempo foi inicializada
      const forkedTimeline = timeMachine.getTimeline(forkResult.forkedExecutionId);
      assert.strictEqual(forkedTimeline.length, 1);
      assert.strictEqual(forkedTimeline[0].action, 'TIME_TRAVEL_FORK');
    });

    // --------------------------------------------------------------------------
    // 11. PURGA DE MANUTENÇÃO DE SAGAS (TABLE BLOAT MITIGATION)
    // --------------------------------------------------------------------------
    console.log('\n--- 11. PURGA DE MANUTENÇÃO DE SAGAS (TABLE BLOAT) ---');

    await check('purgeCompletedSagas expurga sagas consolidadas antigas preservando sagas ativas', async () => {
      const oldCompletedSagaId = uuidv4();
      const activeRunningSagaId = uuidv4();
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

      // Saga concluída antiga (> 30 dias)
      await SagaStateRepository.save({
        id: oldCompletedSagaId,
        executionId: uuidv4(),
        intentId: 'intent_old_done',
        status: 'COMPLETED',
        compensationStack: [],
        currentStepIndex: 2,
        failurePolicy: 'ROLLBACK'
      });
      // Força a data updated_at para 40 dias atrás
      await SagaStateRepository.update({ id: oldCompletedSagaId }, { updatedAt: fortyDaysAgo });

      // Saga ativa corrente (NÃO PODE SER PURGADA)
      await SagaStateRepository.save({
        id: activeRunningSagaId,
        executionId: uuidv4(),
        intentId: 'intent_active',
        status: 'RUNNING',
        compensationStack: [],
        currentStepIndex: 1,
        failurePolicy: 'ROLLBACK'
      });

      const purged = await SagaRecoveryManager.purgeCompletedSagas(30);
      assert.ok(purged >= 1, 'Deve purgar pelo menos a saga de 40 dias atrás');

      const checkOld = await SagaStateRepository.findOneBy({ id: oldCompletedSagaId });
      const checkActive = await SagaStateRepository.findOneBy({ id: activeRunningSagaId });

      assert.strictEqual(checkOld, null, 'Saga antiga concluída deve ter sido eliminada');
      assert.ok(checkActive !== null, 'Saga ativa RUNNING deve permanecer intacta');

      await SagaStateRepository.delete({ id: activeRunningSagaId });
    });

    // --------------------------------------------------------------------------
    // 12. RECONSTITUIÇÃO DURÁVEL DE LINHA DO TEMPO
    // --------------------------------------------------------------------------
    console.log('\n--- 12. RECONSTITUIÇÃO DURÁVEL DE LINHA DO TEMPO ---');

    await check('loadTimelineFromExecution reconstitui snapshots a partir de passos persistidos', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const rebootExecId = `exec_reboot_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

      const stepsFromDb = [
        { stepIndex: 0, name: 'Authenticate', action: 'AUTH', output: { userId: 'usr_777', token: 'jwt_abc' }, status: 'COMPLETED' },
        { stepIndex: 1, name: 'Fetch Profile', action: 'PROFILE', output: { role: 'ADMIN', score: 98 }, status: 'COMPLETED' },
        { stepIndex: 2, name: 'Authorize Grant', action: 'GRANT', output: { granted: true }, status: 'COMPLETED' }
      ];

      const restoredTimeline = timeMachine.loadTimelineFromExecution(rebootExecId, stepsFromDb, { initialSession: true });

      assert.strictEqual(restoredTimeline.length, 3);
      assert.strictEqual(restoredTimeline[0].action, 'AUTH');
      assert.strictEqual(restoredTimeline[1].action, 'PROFILE');
      assert.strictEqual(restoredTimeline[2].action, 'GRANT');

      // Verifica se viagem temporal funciona na timeline reconstituída
      const stateAtStep1 = timeMachine.travelTo(rebootExecId, 1);
      assert.strictEqual(stateAtStep1.userId, 'usr_777');
      assert.strictEqual(stateAtStep1.role, 'ADMIN');
      assert.strictEqual(stateAtStep1.granted, undefined, 'granted ainda não existia no passo 1');
    });

    // --------------------------------------------------------------------------
    // 13. COMPACTAÇÃO POR KEYFRAMES E AVANÇO PROGRESSIVO DE DELTAS
    // --------------------------------------------------------------------------
    console.log('\n--- 13. COMPACTAÇÃO POR KEYFRAMES & ROLL-FORWARD ---');

    await check('Keyframe Compaction compacta passos intermediários e travelTo reconstitui perfeitamente via deltas', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const compExecId = `exec_comp_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

      let currentCtx = { counter: 0, items: [] };

      // Executa 15 passos (0 a 14)
      for (let i = 0; i <= 14; i++) {
        const before = { ...currentCtx, items: [...currentCtx.items] };
        currentCtx = { counter: i, items: [...currentCtx.items, `item_${i}`], lastStep: i };
        timeMachine.captureSnapshot(
          compExecId,
          i,
          `Step ${i}`,
          `ACTION_${i}`,
          before,
          currentCtx,
          'COMPLETED'
        );
      }

      const timeline = timeMachine.getTimeline(compExecId);
      assert.strictEqual(timeline.length, 15);

      // Passo 0: Keyframe
      assert.strictEqual(timeline[0].isKeyframe, true);
      assert.strictEqual(timeline[0].isCompacted, false);
      assert.ok(timeline[0].contextSnapshot !== undefined);

      // Passos 1 a 9: Compactados
      for (let i = 1; i <= 9; i++) {
        assert.strictEqual(timeline[i].isKeyframe, false);
        assert.strictEqual(timeline[i].isCompacted, true);
        assert.strictEqual(timeline[i].contextSnapshot, undefined);
      }

      // Passo 10: Keyframe
      assert.strictEqual(timeline[10].isKeyframe, true);
      assert.strictEqual(timeline[10].isCompacted, false);
      assert.ok(timeline[10].contextSnapshot !== undefined);

      // Passos 11 a 14: Compactados
      for (let i = 11; i <= 14; i++) {
        assert.strictEqual(timeline[i].isKeyframe, false);
        assert.strictEqual(timeline[i].isCompacted, true);
        assert.strictEqual(timeline[i].contextSnapshot, undefined);
      }

      // Reconstituição a partir do marco 7 (avança deltas a partir do keyframe 0)
      const stateAt7 = timeMachine.travelTo(compExecId, 7);
      assert.strictEqual(stateAt7.counter, 7);
      assert.strictEqual(stateAt7.items.length, 8);
      assert.strictEqual(stateAt7.items[7], 'item_7');

      // Reconstituição a partir do marco 14 (avança deltas a partir do keyframe 10)
      const stateAt14 = timeMachine.travelTo(compExecId, 14);
      assert.strictEqual(stateAt14.counter, 14);
      assert.strictEqual(stateAt14.items.length, 15);
      assert.strictEqual(stateAt14.lastStep, 14);
    });

    // --------------------------------------------------------------------------
    // 14. CADEIA MERKLE E DETECÇÃO FORENSE DE ADULTERAÇÃO
    // --------------------------------------------------------------------------
    console.log('\n--- 14. CADEIA MERKLE & DETECÇÃO DE ADULTERAÇÃO ---');

    await check('verifyTimelineIntegrity valida a cadeia de hashes e detecta adulterações em snapshots individuais', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const merkleExecId = `exec_merkle_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

      let ctx = { status: 'INIT', amount: 0 };
      for (let i = 0; i < 5; i++) {
        const prev = { ...ctx };
        ctx = { status: 'RUNNING', amount: (i + 1) * 100 };
        timeMachine.captureSnapshot(
          merkleExecId,
          i,
          `Merkle Step ${i}`,
          `MERKLE_ACTION_${i}`,
          prev,
          ctx,
          'COMPLETED'
        );
      }

      // Verificação de integridade antes de qualquer violação
      const initialAudit = timeMachine.verifyTimelineIntegrity(merkleExecId);
      assert.strictEqual(initialAudit.valid, true);
      assert.strictEqual(initialAudit.totalVerified, 5);
      assert.ok(initialAudit.merkleRoot && initialAudit.merkleRoot.length === 64);

      // Simula adulteração maliciosa direta no snapshot do passo 2 (altera o chainHash)
      const timelineRef = timeMachine['timelines'].get(merkleExecId);
      const originalChainHash = timelineRef[2].chainHash;
      timelineRef[2].chainHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const tamperedAudit = timeMachine.verifyTimelineIntegrity(merkleExecId);
      assert.strictEqual(tamperedAudit.valid, false);
      assert.strictEqual(tamperedAudit.compromisedStep, 2);
      assert.ok(tamperedAudit.reason.includes('Adulteração detectada no snapshot do passo 2'));

      // Restaura o hash original e simula corrupção do elo de encadeamento (previousChainHash no passo 3)
      timelineRef[2].chainHash = originalChainHash;
      const originalPrev = timelineRef[3].previousChainHash;
      timelineRef[3].previousChainHash = 'bad0000000000000000000000000000000000000000000000000000000000000';

      const brokenLinkAudit = timeMachine.verifyTimelineIntegrity(merkleExecId);
      assert.strictEqual(brokenLinkAudit.valid, false);
      assert.strictEqual(brokenLinkAudit.compromisedStep, 3);
      assert.ok(brokenLinkAudit.reason.includes('Quebra de elo Merkle no passo 3'));

      // Restaura para integridade
      timelineRef[3].previousChainHash = originalPrev;
    });

    // --------------------------------------------------------------------------
    // 15. PROTEÇÃO ANTI-DOS EM SIMULAÇÕES WHAT-IF
    // --------------------------------------------------------------------------
    console.log('\n--- 15. PROTEÇÃO ANTI-DOS EM SIMULAÇÕES WHAT-IF ---');

    await check('simulateWhatIf rejeita cargas abusivas com mais de 100 passos para mitigar exaustão de CPU', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const dosExecId = `exec_dos_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

      timeMachine.captureSnapshot(
        dosExecId,
        0,
        'Base Step',
        'INIT',
        {},
        { ready: true },
        'COMPLETED'
      );

      // Cria lista abusiva de 120 passos
      const abusiveSteps = Array.from({ length: 120 }, (_, idx) => ({
        action: `CALCULATE_STEP_${idx}`,
        payload: { step: idx }
      }));

      const simResult = timeMachine.simulateWhatIf(dosExecId, 0, {}, abusiveSteps);
      assert.strictEqual(simResult.status, 'SIMULATION_FAILED');
      assert.ok(simResult.error.includes('limite de 100 passos excedido'));
    });

    // --------------------------------------------------------------------------
    // 16. EXPORTAÇÃO E IMPORTAÇÃO DE BUNDLE DE AUDITORIA ASSINADO
    // --------------------------------------------------------------------------
    console.log('\n--- 16. EXPORTAÇÃO E IMPORTAÇÃO DE BUNDLE ASSINADO ---');

    await check('exportTimelineBundle gera pacote com assinatura HMAC e importTimelineBundle restaura e valida', async () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const exportExecId = `exec_export_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

      timeMachine.captureSnapshot(exportExecId, 0, 'Step A', 'LOGIN', {}, { user: 'auditor' }, 'COMPLETED');
      timeMachine.captureSnapshot(exportExecId, 1, 'Step B', 'REVIEW', { user: 'auditor' }, { user: 'auditor', approved: true }, 'COMPLETED');

      // Exportação
      const bundle = timeMachine.exportTimelineBundle(exportExecId);
      assert.strictEqual(bundle.bundleVersion, '2.3');
      assert.strictEqual(bundle.executionId, exportExecId);
      assert.strictEqual(bundle.totalSnapshots, 2);
      assert.ok(bundle.signature && bundle.signature.length === 64);
      assert.ok(bundle.merkleRoot && bundle.merkleRoot.length === 64);

      // Testa operação via nativeAdvancedVerbsHandler
      const verbExportRes = await nativeAdvancedVerbsHandler({
        verb: 'TIME_TRAVEL',
        action: 'EXPORT_BUNDLE',
        executionId: exportExecId
      });
      assert.strictEqual(verbExportRes.timeTravel, true);
      assert.strictEqual(verbExportRes.operation, 'EXPORT_BUNDLE');
      assert.strictEqual(verbExportRes.bundle.executionId, exportExecId);

      // Importação em uma nova timeline derivada
      const importedBundle = JSON.parse(JSON.stringify(bundle));
      importedBundle.executionId = `exec_imported_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
      for (const s of importedBundle.snapshots) {
        s.executionId = importedBundle.executionId;
      }
      const payload = `${importedBundle.executionId}:${importedBundle.exportedAt}:${importedBundle.merkleRoot}:${importedBundle.totalSnapshots}`;
      const signingKey = process.env.INP_AUDIT_SIGNING_KEY || 'INP_SOVEREIGN_AUDIT_MASTER_KEY_2026_PRODUCTION_SECURE_v2.3';
      importedBundle.signature = crypto.createHmac('sha256', signingKey).update(payload).digest('hex');

      const importResult = timeMachine.importTimelineBundle(importedBundle);
      assert.strictEqual(importResult.imported, true);
      assert.strictEqual(importResult.count, 2);

      // Testa rejeição de assinatura fraudulenta
      const fraudBundle = { ...importedBundle, signature: 'bad_signature_00000000000000000000000000000000000000000000000000000' };
      assert.throws(() => {
        timeMachine.importTimelineBundle(fraudBundle);
      }, /Assinatura do pacote de auditoria corrompida ou inválida/);
    });

    // --------------------------------------------------------------------------
    // 17. DURABILIDADE MERKLE PÓS-REINICIALIZAÇÃO (PERSISTÊNCIA DE HASHES)
    // --------------------------------------------------------------------------
    console.log('\n--- 17. DURABILIDADE MERKLE PÓS-REINICIALIZAÇÃO ---');

    await check('loadTimelineFromExecution restaura hashes originais imutáveis sem gerar novos timestamps', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const originExecId = `exec_durable_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

      // Captura dois passos na timeline original
      const snap0 = timeMachine.captureSnapshot(originExecId, 0, 'Start', 'START', {}, { count: 1 }, 'COMPLETED');
      const snap1 = timeMachine.captureSnapshot(originExecId, 1, 'Process', 'PROCESS', { count: 1 }, { count: 2 }, 'COMPLETED');

      const originalIntegrity = timeMachine.verifyTimelineIntegrity(originExecId);
      assert.strictEqual(originalIntegrity.valid, true);

      // Simula passos persistidos no banco de dados contendo snapshotMeta
      const stepsInDb = [
        {
          stepIndex: 0,
          name: 'Start',
          action: 'START',
          output: { count: 1 },
          status: 'COMPLETED',
          snapshotMeta: {
            snapshotId: snap0.snapshotId,
            contextHash: snap0.contextHash,
            previousChainHash: snap0.previousChainHash,
            chainHash: snap0.chainHash,
            isKeyframe: snap0.isKeyframe,
            isCompacted: snap0.isCompacted,
            deltaDiff: snap0.deltaDiff,
            timestamp: snap0.timestamp
          }
        },
        {
          stepIndex: 1,
          name: 'Process',
          action: 'PROCESS',
          output: { count: 2 },
          status: 'COMPLETED',
          snapshotMeta: {
            snapshotId: snap1.snapshotId,
            contextHash: snap1.contextHash,
            previousChainHash: snap1.previousChainHash,
            chainHash: snap1.chainHash,
            isKeyframe: snap1.isKeyframe,
            isCompacted: snap1.isCompacted,
            deltaDiff: snap1.deltaDiff,
            timestamp: snap1.timestamp
          }
        }
      ];

      // Simula novo nó/processo reiniciado que recarrega a timeline
      const rebootExecId = `exec_reboot_node_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
      const reloadedTimeline = timeMachine.loadTimelineFromExecution(rebootExecId, stepsInDb);

      assert.strictEqual(reloadedTimeline.length, 2);
      assert.strictEqual(reloadedTimeline[0].chainHash, snap0.chainHash);
      assert.strictEqual(reloadedTimeline[1].chainHash, snap1.chainHash);
      assert.strictEqual(reloadedTimeline[0].timestamp, snap0.timestamp);
      assert.strictEqual(reloadedTimeline[1].timestamp, snap1.timestamp);

      const reloadedIntegrity = timeMachine.verifyTimelineIntegrity(rebootExecId);
      assert.strictEqual(reloadedIntegrity.valid, true);
      assert.strictEqual(reloadedIntegrity.merkleRoot, originalIntegrity.merkleRoot);
    });

    // --------------------------------------------------------------------------
    // 18. PRESERVAÇÃO DE INTEGRIDADE SOB PODAGEM LRU COM ÂNCORA CRIPTOGRÁFICA
    // --------------------------------------------------------------------------
    console.log('\n--- 18. PRESERVAÇÃO DE INTEGRIDADE SOB PODAGEM LRU ---');

    await check('Podagem de snapshots preserva PrunedAnchor e mantém verifyTimelineIntegrity válido', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const lruExecId = `exec_lru_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

      // Temporariamente ajusta teto para testar podagem
      const limit = 15;
      const originalMax = TimeMachineEngine['MAX_SNAPSHOTS_PER_EXECUTION'];
      TimeMachineEngine['MAX_SNAPSHOTS_PER_EXECUTION'] = limit;

      try {
        let current = { value: 0 };
        for (let i = 0; i < 20; i++) {
          const prev = { ...current };
          current = { value: i + 1 };
          timeMachine.captureSnapshot(
            lruExecId,
            i,
            `Step ${i}`,
            `ACTION_${i}`,
            prev,
            current,
            'COMPLETED'
          );
        }

        const timeline = timeMachine.getTimeline(lruExecId);
        assert.strictEqual(timeline.length, limit); // Retém apenas os últimos 15
        assert.strictEqual(timeline[0].stepIndex, 5); // Primeiros 5 foram podados

        // A verificação de integridade continua válida utilizando a âncora preservada!
        const integrity = timeMachine.verifyTimelineIntegrity(lruExecId);
        assert.strictEqual(integrity.valid, true);
        assert.strictEqual(integrity.totalVerified, limit);

        // travelTo no marco 19 reconstitui com precisão cirúrgica
        const stateAt19 = timeMachine.travelTo(lruExecId, 19);
        assert.strictEqual(stateAt19.value, 20);
      } finally {
        TimeMachineEngine['MAX_SNAPSHOTS_PER_EXECUTION'] = originalMax;
      }
    });

    // --------------------------------------------------------------------------
    // 19. DEEP PATH DELTA (DOT-NOTATION) EM OBJETOS ANINHADOS
    // --------------------------------------------------------------------------
    console.log('\n--- 19. DEEP PATH DELTA (DOT-NOTATION) ---');

    await check('computeDelta isola propriedades aninhadas via dot-notation e applyDelta reconstitui sem duplicar objetos', () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const deepExecId = `exec_deep_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

      const ctxBefore = {
        order: {
          id: 'ord_123',
          customer: {
            name: 'Alice',
            address: {
              city: 'Lisboa',
              postal: '1000-001'
            }
          },
          items: ['item1', 'item2']
        }
      };

      const ctxAfter = {
        order: {
          id: 'ord_123',
          customer: {
            name: 'Alice',
            address: {
              city: 'Porto',
              postal: '4000-001'
            }
          },
          items: ['item1', 'item2']
        }
      };

      const snap = timeMachine.captureSnapshot(
        deepExecId,
        0,
        'Update Address',
        'UPDATE_ADDRESS',
        ctxBefore,
        ctxAfter,
        'COMPLETED'
      );

      // Apenas os caminhos específicos foram alterados
      assert.ok(snap.deltaDiff.modified['order.customer.address.city'] !== undefined);
      assert.strictEqual(snap.deltaDiff.modified['order.customer.address.city'].before, 'Lisboa');
      assert.strictEqual(snap.deltaDiff.modified['order.customer.address.city'].after, 'Porto');
      assert.strictEqual(snap.deltaDiff.modified['order.customer.address.postal'].after, '4000-001');

      // O objeto "order" inteiro NÃO foi duplicado no modified
      assert.strictEqual(snap.deltaDiff.modified['order'], undefined);

      // travelTo reconstitui o estado aninhado perfeitamente
      const restored = timeMachine.travelTo(deepExecId, 0);
      assert.strictEqual(restored.order.customer.address.city, 'Porto');
      assert.strictEqual(restored.order.customer.name, 'Alice');
    });

    // --------------------------------------------------------------------------
    // 20. PROTEÇÃO ANTI-CICLO E CONTRA STACK OVERFLOW NO FASTDEEPEQUAL
    // --------------------------------------------------------------------------
    console.log('\n--- 20. PROTEÇÃO ANTI-CICLO CONTRA STACK OVERFLOW ---');

    await check('fastDeepEqual neutraliza referências circulares sem estourar a pilha de execução', () => {
      const timeMachine = TimeMachineEngine.getInstance();

      const objA = { name: 'RootA' };
      objA.self = objA; // Referência circular direta

      const objB = { name: 'RootB' };
      objB.self = objB; // Referência circular direta

      // Deve concluir sem lançar RangeError: Maximum call stack size exceeded
      const equalSelf = timeMachine['fastDeepEqual'](objA, objA);
      assert.strictEqual(equalSelf, true);

      const differentObj = timeMachine['fastDeepEqual'](objA, objB);
      assert.strictEqual(differentObj, false);
    });

    // --------------------------------------------------------------------------
    // 21. REPLAY ATIVO CONDUZIDO EM SANDBOX
    // --------------------------------------------------------------------------
    console.log('\n--- 21. REPLAY ATIVO CONDUZIDO EM SANDBOX ---');

    await check('replayFlowFromStep inicia bifurcação isolada com custódia de linhagem', async () => {
      const timeMachine = TimeMachineEngine.getInstance();
      const parentExecId = `exec_replay_parent_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

      timeMachine.captureSnapshot(
        parentExecId,
        0,
        'Auth Step',
        'AUTH',
        {},
        { user: 'operator_1', role: 'AUDITOR', balance: 500 },
        'COMPLETED'
      );

      const execEngine = new ExecutionEngine(new CapabilityRegistry());
      const replayResult = await execEngine.replayFlowFromStep(parentExecId, 0, {
        overrides: { balance: 9999, auditReplay: true }
      });

      assert.strictEqual(replayResult.replay, true);
      assert.strictEqual(replayResult.status, 'REPLAY_INITIALIZED');
      assert.strictEqual(replayResult.parentExecutionId, parentExecId);
      assert.strictEqual(replayResult.fromStepIndex, 0);
      assert.strictEqual(replayResult.restoredContext.user, 'operator_1');
      assert.strictEqual(replayResult.restoredContext.balance, 9999);
      assert.strictEqual(replayResult.restoredContext.auditReplay, true);
      assert.ok(replayResult.forkedExecutionId.startsWith('exec_fork_'));
    });

  } finally {
    if (sagaTestId) {
      try {
        await SagaStateRepository.delete({ id: sagaTestId });
      } catch {}
    }
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }

  // --------------------------------------------------------------------------
  // RELATÓRIO FINAL
  // --------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log(`TOTAL DE ASSERÇÕES DA MÁQUINA DO TEMPO: ${totalTests}`);
  console.log(`PASSOU: ${passedTests}/${totalTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
  console.log(`FALHOU: ${totalTests - passedTests}`);
  console.log('='.repeat(80) + '\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTimeMachineAudit().catch(err => {
  console.error('Erro fatal na auditoria:', err);
  process.exit(1);
});
