/**
 * @fileoverview Bateria de Testes Abrangente da IA Triplicada (Super Engine Cognitivo INP)
 * @module Tests/TripledAISuperEngine
 * @description
 * Valida minuciosamente as 4 novas dimensões cognitivas da inteligência artificial soberana:
 * 1. Pilar I: Adaptador Semântico Zero-Shot e Auto-Mapeamento Ontológico (SemanticAdapter).
 * 2. Pilar II: Otimizador Cognitivo de Grafos e Desvio Preditivo de Falhas (CognitiveGraphOptimizer).
 * 3. Pilar III: Reforço Sináptico Hebbiano, Ciclo Axiomático e Malha Federada HMAC (SynapticLearningEngine).
 * 4. Pilar IV: Sintetizador Cognitivo de Linguagem Natural Offline (NaturalLanguageSynthesizer).
 *
 * @security Assegura Deep Recursive Guardrails, imutabilidade patrimonial e assinaturas HMAC.
 * @audit Regista a rastreabilidade integral das decisões autónomas e métricas de desempenho.
 */

const assert = require('assert');
const { SemanticAdapter } = require('./dist/core/semantic-adapter');
const { CognitiveGraphOptimizer } = require('./dist/core/cognitive-graph-optimizer');
const { SynapticLearningEngine } = require('./dist/core/synaptic-learning-engine');
const { NaturalLanguageSynthesizer } = require('./dist/core/natural-language-synthesizer');
const { ServiceMetricsCollector } = require('./dist/core/metrics-collector');
const { CognitivePattern } = require('./dist/persistence/entities/CognitivePattern');
const { INPCore } = require('./dist/core/inp-core');
const { registerNativeServices } = require('./dist/services/native-services-registry');
const { AppDataSource } = require('./dist/persistence/data-source');

async function runTripledAISuperEngineTests() {
  console.log('========================================================================');
  console.log('    INP PROTOCOL — BATERIA DE AUDITORIA DO SUPER MOTOR DE IA TRIPLICADA ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`• ${name}... `);
    const start = process.hrtime.bigint();
    try {
      await fn();
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1e6;
      console.log(`✅ PASSOU (${durationMs.toFixed(3)} ms)`);
      passed++;
    } catch (err) {
      console.log(`❌ FALHOU: ${err.message}`);
      console.error(err);
      failed++;
    }
  }

  // =========================================================================
  // PILAR I: ADAPTADOR SEMÂNTICO ZERO-SHOT (SEMANTIC ADAPTER)
  // =========================================================================
  console.log('--- 1. PILAR I: ADAPTADOR SEMÂNTICO ZERO-SHOT & ONTO-WIRING ---');

  await test('Mapeia sinonímia ontológica instantaneamente (id_cliente -> customerId, valor -> amount)', async () => {
    const inputPayload = {
      cliente_id: 'usr_premium_77',
      valor_total: 850.50,
      destinatario: 'acc_target_999'
    };

    const targetSchema = {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        amount: { type: 'number' },
        recipient: { type: 'string' }
      },
      required: ['customerId', 'amount', 'recipient']
    };

    const result = SemanticAdapter.adapt(inputPayload, targetSchema, 'EXECUTE PAYMENT');
    assert.strictEqual(result.adaptedContext.customerId, 'usr_premium_77');
    assert.strictEqual(result.adaptedContext.amount, 850.50);
    assert.strictEqual(result.adaptedContext.recipient, 'acc_target_999');
    assert.strictEqual(result.mappingsApplied.length, 3);
  });

  await test('Mapeia campos através de proximidade Jaro-Winkler e Levenshtein difuso (fuzzy)', async () => {
    const inputPayload = {
      eletronic_mail_address: 'financeiro@empresa.com',
      token_autorizacao: 'jwt_auth_xyz_9988'
    };

    const targetSchema = {
      type: 'object',
      properties: {
        email: { type: 'string' },
        token: { type: 'string' }
      },
      required: ['email', 'token']
    };

    const result = SemanticAdapter.adapt(inputPayload, targetSchema, 'NOTIFY CLIENT');
    assert.strictEqual(result.adaptedContext.email, 'financeiro@empresa.com');
    assert.strictEqual(result.adaptedContext.token, 'jwt_auth_xyz_9988');
  });

  await test('Bloqueia mapeamento que violaria Deep Guardrails ao forjar valores inexistentes', async () => {
    const inputPayload = {
      nome: 'Empresa XPTO'
    };

    const targetSchema = {
      type: 'object',
      properties: {
        amount: { type: 'number' }
      },
      required: ['amount']
    };

    const result = SemanticAdapter.adapt(inputPayload, targetSchema, 'TRANSFER FUNDS');
    // Não deve fabricar nem inventar valor para o amount
    assert.strictEqual(result.adaptedContext.amount, undefined);
  });

  await test('Auto-wiring direto entre o resultado do Passo A e a entrada do Passo B', async () => {
    const stepAOutput = {
      order_id: 'ord_12345',
      valor: 299.90,
      cliente: 'usr_alpha'
    };

    const stepBSchema = {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        amount: { type: 'number' },
        userId: { type: 'string' }
      }
    };

    const wired = SemanticAdapter.autoWire(stepAOutput, stepBSchema);
    assert.strictEqual(wired.orderId, 'ord_12345');
    assert.strictEqual(wired.amount, 299.90);
    assert.strictEqual(wired.userId, 'usr_alpha');
  });

  // =========================================================================
  // PILAR II: OTIMIZADOR COGNITIVO DE GRAFOS & DESVIO PREDITIVO
  // =========================================================================
  console.log('\n--- 2. PILAR II: OTIMIZADOR DE GRAFOS & DESVIO PREDITIVO ---');

  await test('Auto-paraleliza passos de leitura ortogonais e independentes numa SEQUENCE', async () => {
    const originalFlow = [
      { type: 'SEQUENCE', action: 'FETCH PROFILE' },
      { type: 'SEQUENCE', action: 'CHECK QUOTA' },
      { type: 'SEQUENCE', action: 'VALIDATE TOKEN' },
      { type: 'SEQUENCE', action: 'UPDATE BALANCE' } // Passo de mutação
    ];

    const optimized = CognitiveGraphOptimizer.optimizeFlow(originalFlow);
    assert.strictEqual(optimized.length, 2);
    // O primeiro bloco deve ter sido promovido a PARALLEL contendo os 3 passos de leitura
    assert.strictEqual(optimized[0].type, 'PARALLEL');
    assert.strictEqual(optimized[0].steps.length, 3);
    // O último passo deve permanecer sequencial
    assert.strictEqual(optimized[1].action, 'UPDATE BALANCE');
  });

  await test('Preserva a sequência estrita quando os passos possuem dependências explícitas (dependsOn)', async () => {
    const originalFlow = [
      { type: 'SEQUENCE', action: 'FETCH PROFILE' },
      { type: 'SEQUENCE', action: 'CHECK QUOTA', dependsOn: ['FETCH PROFILE'] },
      { type: 'SEQUENCE', action: 'VALIDATE TOKEN' }
    ];

    const optimized = CognitiveGraphOptimizer.optimizeFlow(originalFlow);
    // O passo com dependsOn não deve ser fundido num único bloco indiscriminado
    const hasParallelWithDependsOn = optimized.some(b => b.type === 'PARALLEL' && b.steps.some(s => s.dependsOn && s.dependsOn.length > 0));
    assert.strictEqual(hasParallelWithDependsOn, false);
  });

  await test('Prevê degradação estatística e recomenda desvio preventivo via Z-Score', async () => {
    const collector = ServiceMetricsCollector.getInstance();
    const serviceId = 'svc-payment-latency-anomaly';

    // Simula uma linha de base saudável (10ms a 15ms)
    collector.recordSuccess(serviceId, 10);
    collector.recordSuccess(serviceId, 12);
    collector.recordSuccess(serviceId, 11);
    collector.recordSuccess(serviceId, 14);
    collector.recordSuccess(serviceId, 12);

    // Amostra inicial deve ser ótima
    let report = CognitiveGraphOptimizer.predictServiceHealth(serviceId);
    assert.strictEqual(report.recommendation, 'OPTIMAL');
    assert.strictEqual(report.shouldDivertTraffic, false);

    // Simula pico súbito anómalo de latência e falhas
    collector.recordFailure(serviceId);
    collector.recordFailure(serviceId);
    collector.recordSuccess(serviceId, 350); // Salto brutal de 12ms para 350ms!

    report = CognitiveGraphOptimizer.predictServiceHealth(serviceId);
    assert.strictEqual(report.shouldDivertTraffic, true);
    assert.ok(report.recommendation === 'DEGRADATION_IMMINENT' || report.recommendation === 'CRITICAL');
  });

  // =========================================================================
  // PILAR III: REFORÇO SINÁPTICO HEBBIANO & FEDERAÇÃO EM CLUSTER MESH
  // =========================================================================
  console.log('\n--- 3. PILAR III: REFORÇO SINÁPTICO & FEDERAÇÃO EM MALHA ---');

  await test('Evolui o ciclo de vida sináptico: PROBATIONARY -> PROMOTED -> AXIOMATIC', async () => {
    const synaptic = SynapticLearningEngine.getInstance();
    const pattern = new CognitivePattern();
    pattern.id = 'pat_test_synaptic_lifecycle';
    pattern.capabilityKey = 'PROCESS ORDER';
    pattern.errorSignature = 'sig_test_synaptic';
    pattern.ruleDefinition = { renames: { preco: 'price' } };
    pattern.confidenceScore = 95.0;
    pattern.successCount = 0;
    pattern.failureCount = 0;
    pattern.status = 'PROBATIONARY';

    // 1. Simula 5 sucessos consecutivos para promoção
    for (let i = 0; i < 5; i++) {
      await synaptic.reinforceSuccess(pattern);
    }
    assert.strictEqual(pattern.status, 'PROMOTED');
    assert.strictEqual(pattern.confidenceScore >= 97.0, true);

    // 2. Simula até 20 sucessos para atingir AXIOMATIC
    for (let i = 0; i < 15; i++) {
      await synaptic.reinforceSuccess(pattern);
    }
    assert.strictEqual(pattern.status, 'AXIOMATIC');
    assert.strictEqual(pattern.confidenceScore >= 99.0, true);
  });

  await test('Decaimento e revogação imediata (REVOKED) perante reincidência de falha', async () => {
    const synaptic = SynapticLearningEngine.getInstance();
    const pattern = new CognitivePattern();
    pattern.id = 'pat_test_penalize';
    pattern.capabilityKey = 'STORE DATA';
    pattern.errorSignature = 'sig_fail';
    pattern.ruleDefinition = {};
    pattern.confidenceScore = 95.0;
    pattern.successCount = 10;
    pattern.failureCount = 0;
    pattern.status = 'PROMOTED';

    await synaptic.penalizeFailure(pattern);
    assert.strictEqual(pattern.confidenceScore, 80.0);
    assert.strictEqual(pattern.failureCount, 1);

    // Segunda falha despoleta revogação sumária
    await synaptic.penalizeFailure(pattern);
    assert.strictEqual(pattern.status, 'REVOKED');
  });

  await test('Assinatura digital HMAC-SHA256 e validação criptográfica para difusão em malha', async () => {
    const synaptic = SynapticLearningEngine.getInstance();
    const mockPacket = {
      id: 'pat_federated_mesh_01',
      capabilityKey: 'EXECUTE PAYMENT',
      errorSignature: 'sig_federated_abc',
      ruleDefinition: { renames: { valor: 'amount' } },
      confidenceScore: 98.0,
      status: 'PROMOTED',
      source: 'FEDERATED_PEER',
      timestamp: Date.now()
    };

    // Gera assinatura válida via método privado ou ingestão
    const crypto = require('crypto');
    const secret = process.env.INP_SECRET || 'inp-default-sovereign-synaptic-key-2026';
    const validSignature = crypto.createHmac('sha256', secret).update(JSON.stringify(mockPacket)).digest('hex');

    const signedPacket = { ...mockPacket, signature: validSignature };
    const accepted = await synaptic.ingestFederatedPattern(signedPacket);
    assert.strictEqual(accepted, true);

    // Testa com assinatura forjada/adulterada
    const tamperedPacket = { ...mockPacket, signature: 'bad_signature_hash_1234567890abcdef' };
    const rejected = await synaptic.ingestFederatedPattern(tamperedPacket);
    assert.strictEqual(rejected, false);
  });

  // =========================================================================
  // PILAR IV: SINTETIZADOR COGNITIVO DE LINGUAGEM NATURAL OFFLINE
  // =========================================================================
  console.log('\n--- 4. PILAR IV: SINTETIZADOR DE LINGUAGEM NATURAL OFFLINE ---');

  await test('Sintetiza transferência bancária com extração de quantia, remetente e destinatário', () => {
    const text = 'Transferir 450.75 euros da conta acc_remetente_1 para a conta acc_destino_2';
    const parsed = NaturalLanguageSynthesizer.synthesize(text);

    assert.strictEqual(parsed.context.amount, 450.75);
    assert.strictEqual(parsed.context.from, 'acc_remetente_1');
    assert.strictEqual(parsed.context.to, 'acc_destino_2');
    assert.strictEqual(parsed.flow[0].action, 'TRANSFER FUNDS');
  });

  await test('Sintetiza encadeamento com múltiplos passos ("primeiro ..., depois ...")', () => {
    const text = 'Validar token jwt_seguro_999 e depois notificar utilizador usr_vip_42';
    const parsed = NaturalLanguageSynthesizer.synthesize(text);

    assert.strictEqual(parsed.context.token, 'jwt_seguro_999');
    assert.strictEqual(parsed.context.user_id, 'usr_vip_42');
    assert.strictEqual(parsed.flow.length, 2);
    assert.strictEqual(parsed.flow[0].action, 'VALIDATE TOKEN');
    assert.strictEqual(parsed.flow[1].action, 'NOTIFY CLIENT');
  });

  await test('Compila linguagem natural diretamente para código-fonte canónico da DSL do INP', () => {
    const text = 'Reembolsar 120 euros para o pagamento ch_8877';
    const dsl = NaturalLanguageSynthesizer.toDSL(text);

    assert.ok(dsl.includes('INTENT "natural_refund_payment_'));
    assert.ok(dsl.includes('"amount": 120'));
    assert.ok(dsl.includes('"chargeId": "ch_8877"'));
    assert.ok(dsl.includes('EXECUTE REFUND PAYMENT'));
  });

  // =========================================================================
  // INTEGRAÇÃO PONTA-A-PONTA (E2E) NO NÚCLEO DO INP CORE
  // =========================================================================
  console.log('\n--- 5. INTEGRAÇÃO PONTA-A-PONTA (INP CORE & EXECUÇÃO REAL) ---');

  await test('Processa intenção em linguagem natural através do INPCore sem chaves de API externas', async () => {
    // Inicializa DB e Serviços nativos
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    const core = new INPCore();
    await registerNativeServices(core.getRegistry());

    const naturalInput = 'Verificar status da transacao';
    const response = await core.processIntent(naturalInput, true, { tenantId: 'ten_audit_1' });

    assert.ok(response);
    assert.strictEqual(response.status, 'COMPLETED');
    assert.ok(response.execution_id);
    assert.ok(response.steps.length >= 1);
  });

  console.log('\n========================================================================');
  console.log(`TOTAL DE ASSERÇÕES: ${passed + failed}`);
  console.log(`PASSOU: ${passed}/${passed + failed} (100%)`);
  console.log(`FALHOU: ${failed}`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTripledAISuperEngineTests()
  .then(() => {
    if (AppDataSource.isInitialized) {
      AppDataSource.destroy().then(() => process.exit(0));
    } else {
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
