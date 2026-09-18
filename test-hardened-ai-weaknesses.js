/**
 * @fileoverview Bateria de Validação de Hardening e Eliminação das 6 Fraquezas da IA Soberana
 * @module Tests/HardenedAIWeaknesses
 * @description
 * Valida minuciosamente a imunização e o hardening do Cérebro Cognitivo Soberano do INP Protocol:
 * 1. Fraqueza 1: Detecção e Rejeição de Ambiguidade de Polaridade (Origem vs Destino).
 * 2. Fraqueza 2: Decomposição Morfológica BPE de Nomes Compostos Alemães e Vocabulário Multilíngue.
 * 3. Fraqueza 3: Isolamento de Efeitos Colaterais Ocultos em Microsserviços e Bloqueio de Paralelização Tainted.
 * 4. Fraqueza 4: Diálogo Multi-Turno com Resolução Anafórica ("mesmo valor", "metade") e Negação Condicional.
 * 5. Fraqueza 5: Passaporte Criptográfico de Mutação Autorizada (MutationPassport) com Verificação HMAC.
 * 6. Fraqueza 6: Escudo Anti-Fuzzing (Rate Limiter 10/min) e Expurgamento TTL de Padrões Probatórios Obsoletos.
 *
 * @security Valida que nenhuma mutação arbitrária de património ocorre sem passaporte criptográfico válido.
 * @audit Regista a conformidade total contra vetores de poluição, envenenamento e ambiguidades semânticas.
 */

const assert = require('assert');
const { SemanticAdapter } = require('./dist/core/semantic-adapter');
const { CognitiveGraphOptimizer } = require('./dist/core/cognitive-graph-optimizer');
const { SessionContextStore } = require('./dist/core/session-context-store');
const { NaturalLanguageSynthesizer } = require('./dist/core/natural-language-synthesizer');
const { MutationPassportAuthority } = require('./dist/core/mutation-passport');
const { DeepGuardrails, NativeCognitiveEngine } = require('./dist/core/native-cognitive-engine');
const { SynapticLearningEngine } = require('./dist/core/synaptic-learning-engine');
const { CognitivePattern } = require('./dist/persistence/entities/CognitivePattern');

async function runHardenedAIWeaknessesTests() {
  console.log('================================================================================');
  console.log('    INP PROTOCOL — BATERIA DE HARDENING & RESOLUÇÃO DAS 6 FRAQUEZAS DA IA      ');
  console.log('================================================================================\n');

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
  // 1. FRAQUEZA 1: AMBIGUIDADE DE POLARIDADE (ORIGEM VS DESTINO)
  // =========================================================================
  console.log('--- 1. RESOLUÇÃO DE AMBIGUIDADE DE POLARIDADE (ORIGIN vs DESTINATION) ---');

  await test('Identifica polaridades intrínsecas corretas em chaves semânticas', async () => {
    assert.strictEqual(SemanticAdapter.getPolarity('origem_conta'), 'ORIGIN');
    assert.strictEqual(SemanticAdapter.getPolarity('source_account_id'), 'ORIGIN');
    assert.strictEqual(SemanticAdapter.getPolarity('de_conta'), 'ORIGIN');
    assert.strictEqual(SemanticAdapter.getPolarity('remetente'), 'ORIGIN');

    assert.strictEqual(SemanticAdapter.getPolarity('destino_conta'), 'DESTINATION');
    assert.strictEqual(SemanticAdapter.getPolarity('target_user'), 'DESTINATION');
    assert.strictEqual(SemanticAdapter.getPolarity('para_conta'), 'DESTINATION');
    assert.strictEqual(SemanticAdapter.getPolarity('destinataire'), 'DESTINATION');

    assert.strictEqual(SemanticAdapter.getPolarity('valor'), 'NEUTRAL');
    assert.strictEqual(SemanticAdapter.getPolarity('currency'), 'NEUTRAL');
  });

  await test('Detecta colisão polar quando origem e destino competem por um campo neutro único', async () => {
    const ambiguousInput = {
      origem_conta: 'ACC-111-ORIGEM',
      destino_conta: 'ACC-999-DESTINO'
    };
    const targetSchema = {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'Identificador genérico neutro da conta' }
      }
    };

    const result = SemanticAdapter.mapPayload(ambiguousInput, targetSchema);
    // Em colisão polar onde ambos têm scores idênticos e polaridades opostas contra um alvo neutro,
    // o adaptador deve recusar-se a adivinhar e alertar a ambiguidade.
    assert.ok(result.warnings.some(w => w.includes('Ambiguidade de Polaridade Detectada')));
  });

  await test('Mapeia sem colisão quando os campos de destino têm polaridades correspondentes', async () => {
    const bankingInput = {
      conta_origem: 'ACC-ORIG-10',
      conta_destino: 'ACC-DEST-90',
      valor_remessa: 250.00
    };
    const targetSchema = {
      type: 'object',
      properties: {
        sourceAccount: { type: 'string' },
        destinationAccount: { type: 'string' },
        amount: { type: 'number' }
      }
    };

    const result = SemanticAdapter.mapPayload(bankingInput, targetSchema);
    assert.strictEqual(result.mappedPayload.sourceAccount, 'ACC-ORIG-10');
    assert.strictEqual(result.mappedPayload.destinationAccount, 'ACC-DEST-90');
    assert.strictEqual(result.mappedPayload.amount, 250.00);
    assert.strictEqual(result.unmappedFields.length, 0);
  });

  // =========================================================================
  // 2. FRAQUEZA 2: OPEN-WORLD KNOWLEDGE & DECOMPOSIÇÃO BPE (ALEMÃO E MULTILÍNGUE)
  // =========================================================================
  console.log('\n--- 2. CONHECIMENTO OPEN-WORLD & DECOMPOSIÇÃO MORFOLÓGICA BPE ---');

  await test('Decompõe palavras compostas aglutinadas alemãs (Rechnungsbetrag, Rechnungsnummer)', async () => {
    const parts1 = SemanticAdapter.decomposeCompoundWord('Rechnungsbetrag');
    assert.deepStrictEqual(parts1, ['rechnung', 'betrag']);

    const parts2 = SemanticAdapter.decomposeCompoundWord('Rechnungsnummer');
    assert.deepStrictEqual(parts2, ['rechnung', 'nummer']);

    const parts3 = SemanticAdapter.decomposeCompoundWord('Zielkonto');
    assert.deepStrictEqual(parts3, ['ziel', 'konto']);
  });

  await test('Mapeia termos alemães aglutinados para o esquema canónico com sucesso', async () => {
    const germanInput = {
      Rechnungsbetrag: 1450.50,
      Rechnungsnummer: 'INV-BERLIN-2026',
      Zielkonto: 'DE89370400440532013000'
    };
    const canonicalSchema = {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        invoiceNumber: { type: 'string' },
        destinationAccount: { type: 'string' }
      }
    };

    const result = SemanticAdapter.mapPayload(germanInput, canonicalSchema);
    assert.strictEqual(result.mappedPayload.amount, 1450.50);
    assert.strictEqual(result.mappedPayload.invoiceNumber, 'INV-BERLIN-2026');
    assert.strictEqual(result.mappedPayload.destinationAccount, 'DE89370400440532013000');
  });

  await test('Mapeia vocabulário europeu multilíngue (Francês, Espanhol, Italiano)', async () => {
    const multilingualInput = {
      montant: 850.00,
      destinataire: 'acc_paris_01',
      remitente: 'acc_madrid_02',
      bonifico: 'TX-MILANO-77'
    };
    const schema = {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        destinationAccount: { type: 'string' },
        sourceAccount: { type: 'string' },
        transactionReference: { type: 'string' }
      }
    };

    const result = SemanticAdapter.mapPayload(multilingualInput, schema);
    assert.strictEqual(result.mappedPayload.amount, 850.00);
    assert.strictEqual(result.mappedPayload.destinationAccount, 'acc_paris_01');
    assert.strictEqual(result.mappedPayload.sourceAccount, 'acc_madrid_02');
    assert.strictEqual(result.mappedPayload.transactionReference, 'TX-MILANO-77');
  });

  // =========================================================================
  // 3. FRAQUEZA 3: EFEITOS COLATERAIS OCULTOS (TAINTED MUTATIONS)
  // =========================================================================
  console.log('\n--- 3. DETECÇÃO DE EFEITOS COLATERAIS & ISOLAMENTO DE TAINTED MUTATIONS ---');

  await test('Regista e identifica ações impuras ou com efeitos colaterais ocultos', async () => {
    const optimizer = CognitiveGraphOptimizer.getInstance();
    optimizer.markTaintedMutation('GET_BALANCE_AND_CHARGE_FEE');

    assert.strictEqual(optimizer.isActionTainted('GET_BALANCE_AND_CHARGE_FEE'), true);
    assert.strictEqual(optimizer.isActionTainted('PURE_READ_PROFILE'), false);
  });

  await test('Impede paralelização de leitura adulterada por mutação de estado (Tainted Isolation)', async () => {
    const optimizer = CognitiveGraphOptimizer.getInstance();
    optimizer.markTaintedMutation('INSPECT_ACCOUNT_WITH_MUTATION');

    const flow = [
      { type: 'SEQUENCE', action: 'READ_CUSTOMER_NAME' },
      { type: 'SEQUENCE', action: 'INSPECT_ACCOUNT_WITH_MUTATION' },
      { type: 'SEQUENCE', action: 'READ_CUSTOMER_TIER' }
    ];

    const purities = new Map([
      ['READ_CUSTOMER_NAME', 'PURE'],
      ['INSPECT_ACCOUNT_WITH_MUTATION', 'STATEFUL_MUTATION'],
      ['READ_CUSTOMER_TIER', 'PURE']
    ]);

    const optimized = optimizer.optimizeFlow(flow, purities);

    // O passo impuro INSPECT_ACCOUNT_WITH_MUTATION não pode estar agrupado em paralelo
    const parallelWithTainted = optimized.find(step =>
      step.type === 'PARALLEL' && step.steps && step.steps.some(s => s.action === 'INSPECT_ACCOUNT_WITH_MUTATION')
    );
    assert.strictEqual(
      parallelWithTainted,
      undefined,
      'Ação impura com efeito colateral nunca pode ser incluída num bloco PARALLEL.'
    );
  });

  // =========================================================================
  // 4. FRAQUEZA 4: DIÁLOGO MULTI-TURNO & NEGAÇÃO LÓGICA COMPLEXA
  // =========================================================================
  console.log('\n--- 4. DIÁLOGO MULTI-TURNO, ANÁFORAS E NEGAÇÃO LÓGICA CONDICIONAL ---');

  await test('Mantém contexto de conversação multi-turno e resolve anáforas ("mesmo valor", "metade")', async () => {
    const sessionId = 'session_test_multiturn_' + Date.now();

    // Turno 1: Estabelece o contexto inicial
    const turn1 = NaturalLanguageSynthesizer.synthesize(
      'Transferir 400 euros para a conta 998877',
      sessionId
    );
    assert.strictEqual(turn1.context.amount, 400);
    assert.strictEqual(turn1.context.to, '998877');

    // Turno 2: "mesmo valor" para outra conta
    const turn2 = NaturalLanguageSynthesizer.synthesize(
      'Agora envie o mesmo valor para a conta 112233',
      sessionId
    );
    assert.strictEqual(turn2.context.amount, 400, 'Deve herdar o valor de 400 EUR da anáfora "mesmo valor"');
    assert.strictEqual(turn2.context.to, '112233');

    // Turno 3: "metade do valor para a mesma conta"
    const turn3 = NaturalLanguageSynthesizer.synthesize(
      'Envie metade do valor para a mesma conta',
      sessionId
    );
    assert.strictEqual(turn3.context.amount, 200, 'Deve computar metade do valor anterior (400 / 2 = 200)');
    assert.strictEqual(turn3.context.to, '112233', 'Deve herdar o destinatário do turno anterior');
  });

  await test('Extrai cláusula de negação lógica condicional ("a menos que")', async () => {
    const prompt = 'Pagar 150 euros para a conta 445566 a menos que o saldo seja inferior a 500';
    const result = NaturalLanguageSynthesizer.synthesize(prompt);

    assert.strictEqual(result.context.amount, 150);
    assert.strictEqual(result.context.to, '445566');
    assert.ok(
      result.context.condition && result.context.condition.includes('NOT (o saldo seja inferior a 500)'),
      'Deve extrair uma cláusula negativa condicional NOT (...)'
    );
  });

  // =========================================================================
  // 5. FRAQUEZA 5: PASSAPORTE CRIPTOGRÁFICO DE MUTAÇÃO (MUTATION PASSPORT)
  // =========================================================================
  console.log('\n--- 5. PASSAPORTE CRIPTOGRÁFICO DE MUTAÇÃO (MUTATION PASSPORT) ---');

  const originalPayload = {
    amount: 100.00,
    currency: 'EUR',
    recipient: 'acc_target_merchant',
    fee: 2.50
  };

  await test('Bloqueia mutação patrimonial arbitrária quando não há passaporte de mutação', async () => {
    const alteredPayload = {
      ...originalPayload,
      amount: 80.00 // Mutação não autorizada
    };

    const verdict = DeepGuardrails.verify(originalPayload, alteredPayload);
    assert.strictEqual(verdict.passed, false);
    assert.ok(verdict.violation && verdict.violation.includes('Tentativa de adulteração no campo sensível "amount"'));
  });

  await test('Rejeita passaporte forjado com assinatura HMAC inválida', async () => {
    const forgedPassport = {
      transactionId: 'TX-FORGED-01',
      allowedFields: ['amount'],
      reason: 'COUPON_DESCONTO_ILEGAL',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      signature: '0000000000000000000000000000000000000000000000000000000000000000'
    };

    const alteredPayload = { ...originalPayload, amount: 80.00 };
    const verdict = DeepGuardrails.verify(originalPayload, alteredPayload, '', forgedPassport);
    assert.strictEqual(verdict.passed, false);
    assert.ok(verdict.violation && verdict.violation.includes('Passaporte de mutação inválido'));
  });

  await test('Autoriza mutação comercial legítima com passaporte assinado criptograficamente', async () => {
    const validPassport = MutationPassportAuthority.issuePassport({
      transactionId: 'TX-LEGIT-100',
      allowedFields: ['amount'],
      reason: 'CUPOM_DESCONTO_OFICIAL_20_PCT',
      ttlSeconds: 60
    });

    const discountedPayload = {
      ...originalPayload,
      amount: 80.00 // 20% de desconto autorizado pelo passaporte
    };

    const verdict = DeepGuardrails.verify(originalPayload, discountedPayload, '', validPassport);
    assert.strictEqual(verdict.passed, true, 'Deve aprovar a mutação do campo amount sob passaporte válido.');
  });

  await test('Impede mutação de campos que não constam na lista autorizada do passaporte', async () => {
    const passportForAmountOnly = MutationPassportAuthority.issuePassport({
      transactionId: 'TX-LEGIT-101',
      allowedFields: ['amount'],
      reason: 'ALTERAÇÃO_DE_PRECO_AUTORIZADA'
    });

    const tamperedPayload = {
      ...originalPayload,
      amount: 80.00, // Permitido
      recipient: 'acc_hacker_divert' // Proibido! Não consta em allowedFields
    };

    const verdict = DeepGuardrails.verify(originalPayload, tamperedPayload, '', passportForAmountOnly);
    assert.strictEqual(verdict.passed, false);
    assert.ok(verdict.violation && verdict.violation.includes('recipient'));
  });

  // =========================================================================
  // 6. FRAQUEZA 6: ESCUDO ANTI-FUZZING & GESTÃO DE MEMÓRIA (LRU / TTL)
  // =========================================================================
  console.log('\n--- 6. ESCUDO ANTI-FUZZING & LIMPEZA DE MEMÓRIA (LRU / TTL) ---');

  await test('Escudo Anti-Fuzzing bloqueia tempestade de aprendizagem sintética (>10 padrões/min)', async () => {
    const synapticEngine = SynapticLearningEngine.getInstance();
    synapticEngine.resetRateLimits();

    const tenant = 'tenant_fuzzing_attacker';
    const original = { valor: '100' };
    const schema = { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] };

    // Ingestão de 10 padrões sucessivos
    for (let i = 0; i < 10; i++) {
      const allowed = synapticEngine.canIngestPattern(tenant);
      assert.strictEqual(allowed, true, `Padrão ${i + 1} deve ser permitido dentro da cota`);
      synapticEngine.recordIngestion(tenant);
    }

    // 11ª tentativa deve ser terminantemente barrada
    const overLimit = synapticEngine.canIngestPattern(tenant);
    assert.strictEqual(overLimit, false, '11ª tentativa no mesmo minuto deve ser barrada pelo Anti-Fuzzing Shield');

    // Tentativa através da câmara de descontaminação completa
    const rejection = await NativeCognitiveEngine.decontaminateAndLearn(
      'TEST_ATTACK',
      original,
      { amount: 100 },
      schema,
      'erro sintético de teste',
      tenant
    );
    assert.strictEqual(rejection.success, false);
    assert.ok(rejection.explanation.includes('Anti-Fuzzing Protection'));
  });

  await test('Expurga da memória padrões probatórios que expiraram sem maturidade (TTL Pruning)', async () => {
    NativeCognitiveEngine.clearInMemoryPatterns();

    // Cria um padrão probatório artificial com data de 8 dias atrás
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const expiredProbationary = new CognitivePattern();
    expiredProbationary.id = 'pat_expired_fuzz';
    expiredProbationary.capabilityKey = 'FUZZ_OP';
    expiredProbationary.errorSignature = 'sig_expired_001';
    expiredProbationary.ruleDefinition = {};
    expiredProbationary.confidenceScore = 95.0;
    expiredProbationary.successCount = 1; // Menos de 5 sucessos
    expiredProbationary.status = 'PROBATIONARY';
    expiredProbationary.createdAt = eightDaysAgo;

    // Cria outro padrão recente que NÃO deve ser expurgado
    const recentProbationary = new CognitivePattern();
    recentProbationary.id = 'pat_recent_valid';
    recentProbationary.capabilityKey = 'VALID_OP';
    recentProbationary.errorSignature = 'sig_recent_002';
    recentProbationary.ruleDefinition = {};
    recentProbationary.confidenceScore = 96.0;
    recentProbationary.successCount = 2;
    recentProbationary.status = 'PROBATIONARY';
    recentProbationary.createdAt = new Date();

    NativeCognitiveEngine.storeInMemoryPattern('sig_expired_001', expiredProbationary);
    NativeCognitiveEngine.storeInMemoryPattern('sig_recent_002', recentProbationary);

    assert.strictEqual(NativeCognitiveEngine.getInMemoryPatternCount(), 2);

    // Executa o expurgo de 7 dias
    const prunedCount = NativeCognitiveEngine.pruneInMemoryProbationary(7 * 24 * 60 * 60 * 1000);
    assert.strictEqual(prunedCount, 1, 'Deve expurgar exatamente 1 padrão probatório expirado.');
    assert.strictEqual(NativeCognitiveEngine.getInMemoryPatternCount(), 1, 'Deve reter apenas o padrão recente.');
  });

  console.log('\n================================================================================');
  console.log(`  RESULTADO DO TESTE DE HARDENING: ${passed} PASSARAM, ${failed} FALHARAM`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runHardenedAIWeaknessesTests().catch(err => {
  console.error('Falha crítica na bateria de testes de hardening:', err);
  process.exit(1);
});
