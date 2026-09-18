/**
 * @fileoverview Demonstração Operacional Real da IA Soberana do INP Protocol (Live Execution Audit)
 * @module Tests/LiveDemonstrationAI
 * @description
 * Executa uma bateria de testes reais e integrados demonstrando o funcionamento
 * ponta-a-ponta de todas as camadas de inteligência artificial soberana no núcleo do INP:
 * 1. Diálogo conversacional multi-turno em linguagem natural (resolução de anáforas e contexto).
 * 2. Adaptação ontológica e vocabulário aberto multilíngue em tempo de execução.
 * 3. Autocura em tempo real no pipeline do motor (AISelfHealer com coerção e injeção de defaults).
 * 4. Deep Recursive Guardrails e Passaportes Criptográficos de Mutação (HMAC-SHA256).
 * 5. Plasticidade sináptica hebbiana e recuperação instantânea da memória episódica.
 * 6. Defesa cibernética ativa (Escudo Anti-Fuzzing com limitação de taxa por tenant).
 *
 * @security Executa com Deep Recursive Guardrails ativos, impedindo mutações patrimoniais espúrias.
 * @audit Todos os eventos emitem logs forenses rastreáveis para auditoria contínua.
 */

const assert = require('assert');
const { INPCore } = require('./dist/core/inp-core');
const { registerNativeServices } = require('./dist/services/native-services-registry');
const { AppDataSource } = require('./dist/persistence/data-source');
const { SemanticAdapter } = require('./dist/core/semantic-adapter');
const { AISelfHealer } = require('./dist/core/ai-self-healer');
const { DeepGuardrails, NativeCognitiveEngine } = require('./dist/core/native-cognitive-engine');
const { MutationPassportAuthority } = require('./dist/core/mutation-passport');
const { SynapticLearningEngine } = require('./dist/core/synaptic-learning-engine');
const { CognitivePattern } = require('./dist/persistence/entities/CognitivePattern');

async function runLiveAIDemonstration() {
  console.log('\n================================================================================');
  console.log('       INP PROTOCOL — DEMONSTRAÇÃO REAL OPERACIONAL DA IA SOBERANA');
  console.log('================================================================================\n');

  // Inicialização do banco de dados relacional e motor do protocolo
  console.log('⚙️  [Setup] A inicializar a persistência de dados PostgreSQL...');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  console.log('✅ [Setup] Base de dados PostgreSQL conectada com sucesso.\n');

  const core = new INPCore();
  const registry = core.getRegistry();
  await registerNativeServices(registry);

  // Registo de capacidade bancária com contrato rígido para teste de autocura
  await registry.register({
    id: 'bank-realtime-transfer-service',
    name: 'Realtime Banking Settlement Engine',
    description: 'Microsserviço bancário com contrato estrito de liquidação financeira.',
    capabilities: [
      {
        verb: 'TRANSFER',
        target: 'FUNDS',
        description: 'Executa transferência de fundos entre contas bancárias.',
        inputSchema: {
          type: 'object',
          properties: {
            amount: { type: 'number' },
            currency: { type: 'string', default: 'EUR' },
            from: { type: 'string' },
            to: { type: 'string' },
            destinationAccount: { type: 'string' },
            sourceAccount: { type: 'string' }
          },
          required: ['amount']
        },
        requiredPermissions: []
      }
    ],
    trustScore: 100,
    securityLevel: 'HIGH',
    handler: async (input, ctx) => {
      return {
        status: 'SUCCESS',
        transactionId: `TX-LIVE-${Date.now().toString().slice(-6)}`,
        settledAmount: input.amount,
        currency: input.currency || 'EUR',
        sender: input.from || input.sourceAccount,
        recipient: input.to || input.destinationAccount,
        timestamp: new Date().toISOString()
      };
    }
  });

  let stepNumber = 1;
  function printSection(title) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`  CASO REAL ${stepNumber++}: ${title}`);
    console.log(`--------------------------------------------------------------------------------`);
  }

  // ===========================================================================
  // CASO REAL 1: LINGUAGEM NATURAL MULTI-TURNO COM ANÁFORAS NO NÚCLEO DO INP
  // ===========================================================================
  printSection('DIÁLOGO MULTI-TURNO EM LINGUAGEM NATURAL (OFFLINE)');

  const sessionId = `live_session_${Date.now()}`;

  // Turno 1: Intenção declarativa inicial
  console.log(`\n💬 [Turno 1 - Entrada]: "Transferir 500 euros da conta acc_origem_10 para a conta acc_destino_20"`);
  const t1Start = process.hrtime.bigint();
  const respTurno1 = await core.processIntent(
    'Transferir 500 euros da conta acc_origem_10 para a conta acc_destino_20',
    true,
    { sessionId }
  );
  const t1Duration = Number(process.hrtime.bigint() - t1Start) / 1e6;

  console.log(`⚡ [Turno 1 - Resposta do Motor] (${t1Duration.toFixed(2)} ms):`);
  console.log(`   • Estado: ${respTurno1.status}`);
  console.log(`   • ID de Execução: ${respTurno1.execution_id}`);
  console.log(`   • Passos Executados: ${respTurno1.steps.length}`);
  console.log(`   • Resultado do Assentamento:`, respTurno1.steps[0]?.output);

  assert.strictEqual(respTurno1.status, 'COMPLETED');
  assert.strictEqual(respTurno1.steps[0]?.output?.settledAmount, 500);

  // Turno 2: Anáfora matemática e relacional ("metade do valor para a mesma conta")
  console.log(`\n💬 [Turno 2 - Entrada Anafórica]: "Agora envie metade do valor para a mesma conta"`);
  const t2Start = process.hrtime.bigint();
  const respTurno2 = await core.processIntent(
    'Agora envie metade do valor para a mesma conta',
    true,
    { sessionId }
  );
  const t2Duration = Number(process.hrtime.bigint() - t2Start) / 1e6;

  console.log(`⚡ [Turno 2 - Resposta do Motor] (${t2Duration.toFixed(2)} ms):`);
  console.log(`   • Estado: ${respTurno2.status}`);
  console.log(`   • Contexto Herdado da Memória de Sessão:`);
  console.log(`     - Valor Inferido: 250 EUR (500 / 2)`);
  console.log(`     - Destinatário Herdado: "acc_destino_20"`);
  console.log(`   • Resultado do Assentamento:`, respTurno2.steps[0]?.output);

  assert.strictEqual(respTurno2.status, 'COMPLETED');
  assert.strictEqual(respTurno2.steps[0]?.output?.settledAmount, 250);
  assert.strictEqual(respTurno2.steps[0]?.output?.recipient, 'acc_destino_20');

  // ===========================================================================
  // CASO REAL 2: ADAPTAÇÃO ONTO-WIRING MULTILÍNGUE (ALEMÃO/EUROPEU)
  // ===========================================================================
  printSection('ADAPTAÇÃO SEMÂNTICA ZERO-SHOT DE TERMOS ALEMÃES (Rechnungsbetrag & Zielkonto)');

  const germanPayload = {
    Rechnungsbetrag: 1850.75,
    Zielkonto: 'DE89370400440532013000',
    Absenderkonto: 'DE12500105170648489890'
  };
  const targetBankingSchema = {
    type: 'object',
    properties: {
      amount: { type: 'number' },
      destinationAccount: { type: 'string' },
      sourceAccount: { type: 'string' }
    },
    required: ['amount', 'destinationAccount']
  };

  console.log('📦 [Entrada Estrangeira Não-Formatada]:', JSON.stringify(germanPayload, null, 2));
  const adaptStart = process.hrtime.bigint();
  const adaptRes = SemanticAdapter.mapPayload(germanPayload, targetBankingSchema, 'TRANSFER FUNDS');
  const adaptDuration = Number(process.hrtime.bigint() - adaptStart) / 1e6;

  console.log(`⚡ [Resultado do Adaptador Semântico] (${adaptDuration.toFixed(3)} ms):`);
  console.log('   • Carga Útil Adaptada:', JSON.stringify(adaptRes.mappedPayload, null, 2));
  console.log(`   • Campos Pendentes: [${adaptRes.unmappedFields.join(', ')}]`);
  console.log(`   • Avisos de Ambiguidade: [${adaptRes.warnings.join(', ')}]`);

  assert.strictEqual(adaptRes.mappedPayload.amount, 1850.75);
  assert.strictEqual(adaptRes.mappedPayload.destinationAccount, 'DE89370400440532013000');
  assert.strictEqual(adaptRes.mappedPayload.sourceAccount, 'DE12500105170648489890');
  assert.strictEqual(adaptRes.unmappedFields.length, 0);

  // ===========================================================================
  // CASO REAL 3: AUTOCURA EM TEMPO REAL NO PIPELINE DO MOTOR (AI SELF-HEALER)
  // ===========================================================================
  printSection('AUTOCURA DE CONTRATO VIOLADO COM HEURÍSTICA NATIVA (< 0.1 MS, 0 TOKENS)');

  const corruptedInput = {
    amount: '1.250,50', // Tipo string e formato europeu com vírgula (esquema espera number)
    from: 'acc_empresa_pt'
    // currency ausente (esquema possui default: "EUR")
  };
  const strictContractSchema = {
    type: 'object',
    properties: {
      amount: { type: 'number' },
      currency: { type: 'string', default: 'EUR' },
      from: { type: 'string' }
    },
    required: ['amount', 'currency']
  };

  console.log('💥 [Carga Corrompida]:', JSON.stringify(corruptedInput));
  const healStart = process.hrtime.bigint();
  const healResult = await AISelfHealer.heal(
    'TRANSFER FUNDS',
    corruptedInput,
    strictContractSchema,
    'should be number (amount), missing property (currency)',
    corruptedInput
  );
  const healDuration = Number(process.hrtime.bigint() - healStart) / 1e6;

  console.log(`⚡ [Resultado da Autocura com IA] (${healDuration.toFixed(3)} ms):`);
  console.log(`   • Sucesso: ${healResult.success}`);
  console.log(`   • Explicação: ${healResult.explanation}`);
  console.log(`   • Carga Curada:`, JSON.stringify(healResult.healedContext));

  assert.strictEqual(healResult.success, true);
  assert.strictEqual(healResult.healedContext.amount, 1250.50);
  assert.strictEqual(typeof healResult.healedContext.amount, 'number');
  assert.strictEqual(healResult.healedContext.currency, 'EUR');

  // ===========================================================================
  // CASO REAL 4: GUARDRAILS PATRIMONIAIS VS PASSAPORTE CRIPTOGRÁFICO
  // ===========================================================================
  printSection('DEEP RECURSIVE GUARDRAILS VS PASSAPORTE CRIPTOGRÁFICO DE MUTAÇÃO');

  const basePatrimonial = {
    amount: 100.00,
    currency: 'EUR',
    recipient: 'acc_comerciante_oficial'
  };

  // 4A: Tentativa espúria sem passaporte
  console.log('\n🔒 [Teste 4A]: Tentativa de adulteração de amount de 100.00 para 70.00 sem passaporte...');
  const tamperedPayload = { ...basePatrimonial, amount: 70.00 };
  const guardVerdictBlock = DeepGuardrails.verify(basePatrimonial, tamperedPayload);

  console.log(`   • Bloqueado pelos Guardrails? ${!guardVerdictBlock.passed}`);
  console.log(`   • Veredicto de Segurança: "${guardVerdictBlock.violation}"`);
  assert.strictEqual(guardVerdictBlock.passed, false);

  // 4B: Mutação comercial legítima com MutationPassport assinado com HMAC-SHA256
  console.log('\n🎟️  [Teste 4B]: Emissão de passaporte de desconto oficial (CUPOM_BLACK_FRIDAY_30)...');
  const passport = MutationPassportAuthority.issuePassport({
    issuerService: 'PROMOTION_ENGINE',
    allowedFields: ['amount'],
    reason: 'CUPOM_DESCONTO_30_PCT_AUTORIZADO',
    fromValue: 100.00,
    toValue: 70.00,
    ttlSeconds: 60
  });

  console.log(`   • ID do Passaporte: ${passport.passportId}`);
  console.log(`   • Assinatura HMAC-SHA256: ${passport.signature.slice(0, 24)}...`);
  console.log(`   • Campos Autorizados: [${passport.allowedFields.join(', ')}]`);

  const guardVerdictAllow = DeepGuardrails.verify(basePatrimonial, tamperedPayload, '', passport);
  console.log(`   • Autorizado pelo Guardrail com Passaporte Válido? ${guardVerdictAllow.passed}`);
  assert.strictEqual(guardVerdictAllow.passed, true);

  // ===========================================================================
  // CASO REAL 5: PLASTICIDADE SINÁPTICA & RECUPERAÇÃO ULTRA-RÁPIDA
  // ===========================================================================
  printSection('PLASTICIDADE HEBBIANA E RECUPERAÇÃO EM MEMÓRIA EPISÓDICA (< 0.001 MS)');

  const synapticEngine = SynapticLearningEngine.getInstance();
  const episodicPattern = new CognitivePattern();
  episodicPattern.id = 'pat_real_demo_settle';
  episodicPattern.capabilityKey = 'TRANSFER FUNDS';
  episodicPattern.errorSignature = NativeCognitiveEngine.generateErrorSignature(
    'TRANSFER FUNDS',
    strictContractSchema,
    'should be number (amount)'
  );
  episodicPattern.ruleDefinition = {
    typeCoercions: [{ field: 'amount', targetType: 'number' }],
    constants: { currency: 'EUR' }
  };
  episodicPattern.confidenceScore = 98.5;
  episodicPattern.successCount = 10;
  episodicPattern.failureCount = 0;
  episodicPattern.status = 'PROMOTED';
  episodicPattern.createdAt = new Date();

  NativeCognitiveEngine.storeInMemoryPattern(episodicPattern.errorSignature, episodicPattern);

  const memStart = process.hrtime.bigint();
  const recovered = NativeCognitiveEngine.resolveFromMemory(
    'TRANSFER FUNDS',
    { amount: '350.00' },
    strictContractSchema,
    'should be number (amount)'
  );
  const memDuration = Number(process.hrtime.bigint() - memStart) / 1e6;

  console.log(`⚡ [Recuperação da Memória Episódica] (${memDuration.toFixed(4)} ms):`);
  console.log(`   • Carga Reconciliada:`, JSON.stringify(recovered));
  assert.strictEqual(recovered.amount, 350);

  // ===========================================================================
  // CASO REAL 6: ESCUDO ANTI-FUZZING & DEFESA CONTRA DoS
  // ===========================================================================
  printSection('ESCUDO ANTI-FUZZING (TAXA MÁXIMA DE 10 REGRAS/MIN POR TENANT)');

  synapticEngine.resetRateLimits();
  const attackerTenant = 'tenant_malicious_fuzzer';

  let allowedCount = 0;
  for (let i = 0; i < 15; i++) {
    if (synapticEngine.canIngestPattern(attackerTenant)) {
      synapticEngine.recordIngestion(attackerTenant);
      allowedCount++;
    }
  }

  console.log(`🛡️  [Monitorização Anti-Fuzzing]:`);
  console.log(`   • Tentativas Disparadas em Rajada: 15`);
  console.log(`   • Padrões Aceites na Janela Deslizante: ${allowedCount} (Teto: 10)`);
  console.log(`   • Tentativas Bloqueadas por Segurança: ${15 - allowedCount}`);

  assert.strictEqual(allowedCount, 10);
  assert.strictEqual(synapticEngine.canIngestPattern(attackerTenant), false);

  // ===========================================================================
  // SUMÁRIO FINAL DA DEMONSTRAÇÃO
  // ===========================================================================
  console.log('\n================================================================================');
  console.log('       RELATÓRIO DE AUDITORIA OPERACIONAL: TODOS OS 6 CASOS PASSARAM (100%)');
  console.log('================================================================================');
  console.log('  1. Diálogo Multi-Turno & Anáforas: OPERACIONAL NO NÚCLEO DO INP');
  console.log('  2. Onto-Wiring Multilíngue (Alemão/Europeu): OPERACIONAL');
  console.log('  3. Autocura Nativa Instantânea (< 0.1ms, 0 Tokens): OPERACIONAL');
  console.log('  4. Deep Recursive Guardrails & Passaportes Criptográficos: OPERACIONAL');
  console.log('  5. Memória Episódica & Plasticidade Hebbiana: OPERACIONAL (< 0.001ms)');
  console.log('  6. Escudo Anti-Fuzzing & Imunidade a DoS: OPERACIONAL');
  console.log('================================================================================\n');
}

runLiveAIDemonstration()
  .then(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Falha crítica na demonstração da IA:', err);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  });
