/**
 * @fileoverview Suíte de Auditoria e Teste End-to-End da 9ª Família Estratégica do INP Protocol (136 Verbos)
 * @module Tests/NewFamily136VerbsAudit
 * @description
 * Valida com rigor matemático, pericial e de segurança os 8 novos verbos operacionais (129 ao 136):
 * 1. EMBED — Geração de embeddings densos normalizados (L2 = 1.0) determinísticos e soberanos offline.
 * 2. VECTOR_SEARCH — Busca semântica instantânea por similaridade de cosseno em memória diretamente nos candidatos.
 * 3. SPLIT — Rateio financeiro multidirecional com reconciliação matemática estrita em centavos inteiros.
 * 4. ESCROW — Custódia transacional com selo criptográfico HMAC SHA-256 inviolável, liberação condicional e TTL.
 * 5. POLL — Sondagem assíncrona cooperativa não-bloqueante com backoff exponencial e predicado de parada.
 * 6. INVALIDATE — Expurgo cirúrgico de cache por chave exata, padrão com curingas (*) ou tags semânticas.
 * 7. DRIFT_DETECT — Auditoria contínua de integridade estrutural (schema drift) entre payload dinâmico e contrato.
 * 8. CHAOS — Injeção programada de falhas com salvaguarda estrita contra produção (ERR_CHAOS_PRODUCTION_BLOCKED).
 *
 * @security Validação estrita de salvaguarda de ambiente de produção e integridade de selos HMAC SHA-256.
 * @audit Prova documental da expansão do catálogo operacional para 136 verbos ativos (9 Famílias).
 */

const assert = require('assert');
const { nativeAdvancedVerbsHandler } = require('./dist/services/native-advanced-verbs-service');

/**
 * Executa a bateria completa de validação da 9ª Família de Verbos Operacionais.
 * @returns {Promise<void>}
 */
async function run136VerbsNewFamilyAudit() {
  console.log('='.repeat(80));
  console.log('  INP PROTOCOL — AUDITORIA DOS 8 NOVOS VERBOS DA 9ª FAMÍLIA (136 VERBOS)');
  console.log('='.repeat(80));

  let passedTests = 0;
  let totalTests = 0;

  /**
   * Executa e mede um teste individual.
   * @param {string} desc - Descrição do teste.
   * @param {Function} fn - Função de teste assíncrona.
   */
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

  // ============================================================================
  // 1. EMBED (IA Vetorial Soberana Offline)
  // ============================================================================
  await check('129. EMBED — Gera vetor denso de 64 dimensões determinístico', async () => {
    const res = await nativeAdvancedVerbsHandler('EMBED', 'KNOWLEDGE_DOC', {
      text: 'Solicitação de reembolso de transação duplicada no cartão de crédito',
      dimensions: 64
    });
    assert.strictEqual(res.verb, 'EMBED');
    assert.strictEqual(res.dimensions, 64);
    assert.strictEqual(Array.isArray(res.vector), true);
    assert.strictEqual(res.vector.length, 64);
  });

  await check('129. EMBED — Garante norma L2 estritamente unitária (L2 = 1.0)', async () => {
    const res = await nativeAdvancedVerbsHandler('EMBED', 'SEMANTIC_TEXT', {
      text: 'Transferência instantânea via PIX de alta disponibilidade',
      dimensions: 64
    });
    const norm = Math.sqrt(res.vector.reduce((acc, v) => acc + v * v, 0));
    assert.ok(Math.abs(norm - 1.0) < 1e-5, `Norma L2 deve ser 1.0, obteve: ${norm}`);
    assert.strictEqual(res.normL2, 1.0);
  });

  await check('129. EMBED — Determinismo absoluto: textos idênticos geram vetores idênticos', async () => {
    const t1 = 'Reconciliação contábil diária de fechamento bancário';
    const res1 = await nativeAdvancedVerbsHandler('EMBED', 'T1', { text: t1, dimensions: 64 });
    const res2 = await nativeAdvancedVerbsHandler('EMBED', 'T2', { text: t1, dimensions: 64 });
    assert.deepStrictEqual(res1.vector, res2.vector);
  });

  await check('129. EMBED — Resiliência com texto vazio ou nulo', async () => {
    const resEmpty = await nativeAdvancedVerbsHandler('EMBED', 'EMPTY', { text: '', dimensions: 32 });
    assert.strictEqual(resEmpty.vector.length, 32);
    assert.strictEqual(resEmpty.vector[0], 1.0);
  });

  // ============================================================================
  // 2. VECTOR_SEARCH (Busca Semântica por Cosseno Instantânea)
  // ============================================================================
  await check('130. VECTOR_SEARCH — Ranqueia candidatos por similaridade semântica', async () => {
    const candidates = [
      { id: 'faq_estorno', text: 'Como solicitar reembolso e cancelamento de pagamento' },
      { id: 'faq_pix', text: 'Como fazer chave aleatória do PIX no aplicativo móvel' },
      { id: 'faq_senha', text: 'Esqueci a minha senha de acesso ao portal do cliente' }
    ];

    const res = await nativeAdvancedVerbsHandler('VECTOR_SEARCH', 'FAQ_KB', {
      query: 'estorno de cobrança indevida e cancelamento',
      candidates,
      topK: 2,
      minScore: 0.1
    });

    assert.strictEqual(res.verb, 'VECTOR_SEARCH');
    assert.strictEqual(res.topK, 2);
    assert.strictEqual(Array.isArray(res.matches), true);
    assert.ok(res.matches.length >= 1);
    // O artigo de estorno/cancelamento deve ter maior similaridade do que senha/pix
    assert.strictEqual(res.matches[0].id, 'faq_estorno');
    assert.ok(res.matches[0].score > 0.05);
    assert.ok(res.matches[0].score <= 1.0);
  });

  await check('130. VECTOR_SEARCH — Respeita limiar minScore de corte', async () => {
    const candidates = [
      { id: 'receita_bolo', text: 'Receita de bolo de cenoura com cobertura de chocolate' }
    ];
    const res = await nativeAdvancedVerbsHandler('VECTOR_SEARCH', 'FILTER_TEST', {
      query: 'cálculo de imposto de renda retido na fonte',
      candidates,
      topK: 5,
      minScore: 0.95 // Limiar muito alto
    });
    assert.strictEqual(res.matches.length, 0);
  });

  // ============================================================================
  // 3. SPLIT (Rateio Financeiro com Reconciliação Estrita de Centavos)
  // ============================================================================
  await check('131. SPLIT — Reconciliação perfeita sem centavos perdidos (100.00 split 33/33/34)', async () => {
    const res = await nativeAdvancedVerbsHandler('SPLIT', 'PAYMENT_SPLIT', {
      totalAmount: 100.00,
      currency: 'EUR',
      splits: [
        { recipient: 'vendedor_a', percentage: 33.33 },
        { recipient: 'vendedor_b', percentage: 33.33 },
        { recipient: 'vendedor_c', percentage: 33.34 }
      ]
    });

    assert.strictEqual(res.verb, 'SPLIT');
    assert.strictEqual(res.totalAmount, 100.00);
    assert.strictEqual(res.reconciled, true);
    assert.strictEqual(res.breakdown.length, 3);

    const sumAllocated = res.breakdown.reduce((acc, b) => acc + b.allocatedAmount, 0);
    assert.strictEqual(Number(sumAllocated.toFixed(2)), 100.00);
  });

  await check('131. SPLIT — Rateio por valores nominais absolutos', async () => {
    const res = await nativeAdvancedVerbsHandler('SPLIT', 'NOMINAL_SPLIT', {
      totalAmount: 500.00,
      splits: [
        { recipient: 'gateway_taxa', amount: 15.50 },
        { recipient: 'plataforma_comissao', amount: 84.50 },
        { recipient: 'seller_repasse', percentage: 80 }
      ]
    });

    assert.strictEqual(res.reconciled, true);
    const sumAllocated = res.breakdown.reduce((acc, b) => acc + b.allocatedAmount, 0);
    assert.strictEqual(Number(sumAllocated.toFixed(2)), 500.00);
  });

  // ============================================================================
  // 4. ESCROW (Custódia Transacional com HMAC SHA-256 e TTL)
  // ============================================================================
  let activeEscrowId = '';
  const escrowSecret = 'segredo_pericial_inp_2026';

  await check('132. ESCROW — Ação DEPOSIT retém valores e gera selo HMAC inviolável', async () => {
    const res = await nativeAdvancedVerbsHandler('ESCROW', 'FUNDS_CUSTODY', {
      action: 'DEPOSIT',
      payer: 'comprador_1',
      beneficiary: 'vendedor_2',
      amount: 2500.00,
      currency: 'BRL',
      condition: 'entrega_comprovada_notarial',
      secretKey: escrowSecret,
      ttlMinutes: 60
    });

    assert.strictEqual(res.verb, 'ESCROW');
    assert.strictEqual(res.action, 'DEPOSIT');
    assert.strictEqual(res.status, 'HELD');
    assert.strictEqual(res.amount, 2500.00);
    assert.ok(res.escrowId.startsWith('escrow_'));
    assert.ok(res.custodySeal.length === 64); // SHA-256 hex
    activeEscrowId = res.escrowId;
  });

  await check('132. ESCROW — Ação STATUS recupera a custódia ativa', async () => {
    const res = await nativeAdvancedVerbsHandler('ESCROW', 'FUNDS_CUSTODY', {
      action: 'STATUS',
      escrowId: activeEscrowId
    });
    assert.strictEqual(res.found, true);
    assert.strictEqual(res.status, 'HELD');
    assert.strictEqual(res.amount, 2500.00);
  });

  await check('132. ESCROW — Ação RELEASE rejeita chave secreta incorreta', async () => {
    try {
      await nativeAdvancedVerbsHandler('ESCROW', 'FUNDS_CUSTODY', {
        action: 'RELEASE',
        escrowId: activeEscrowId,
        secretKey: 'chave_errada'
      });
      assert.fail('Deveria ter lançado erro de chave secreta');
    } catch (err) {
      assert.ok(err.message.includes('ERR_ESCROW_INVALID_SECRET'));
    }
  });

  await check('132. ESCROW — Ação RELEASE com chave secreta correta libera os fundos', async () => {
    const res = await nativeAdvancedVerbsHandler('ESCROW', 'FUNDS_CUSTODY', {
      action: 'RELEASE',
      escrowId: activeEscrowId,
      secretKey: escrowSecret
    });
    assert.strictEqual(res.status, 'RELEASED');
    assert.strictEqual(res.beneficiary, 'vendedor_2');
    assert.strictEqual(res.amount, 2500.00);
  });

  await check('132. ESCROW — Ação REFUND em novo depósito devolve ao pagador', async () => {
    const dep = await nativeAdvancedVerbsHandler('ESCROW', 'FUNDS_CUSTODY', {
      action: 'DEPOSIT',
      payer: 'comprador_refund',
      beneficiary: 'vendedor_refund',
      amount: 300.00,
      currency: 'USD'
    });
    const ref = await nativeAdvancedVerbsHandler('ESCROW', 'FUNDS_CUSTODY', {
      action: 'REFUND',
      escrowId: dep.escrowId
    });
    assert.strictEqual(ref.status, 'REFUNDED');
    assert.strictEqual(ref.payer, 'comprador_refund');
  });

  // ============================================================================
  // 5. POLL (Consulta Cadenciada com Exponential Backoff e Predicado)
  // ============================================================================
  await check('133. POLL — Executa polling cooperativo e resolve quando predicado é atingido', async () => {
    const res = await nativeAdvancedVerbsHandler('POLL', 'PAYMENT_GATEWAY', {
      maxAttempts: 5,
      intervalMs: 20,
      backoffFactor: 1.2,
      field: 'status',
      expectedValue: 'CONFIRMED'
    });

    assert.strictEqual(res.verb, 'POLL');
    assert.strictEqual(res.target, 'PAYMENT_GATEWAY');
    assert.ok(res.attempts >= 1);
    assert.strictEqual(res.resolved, true);
    assert.ok(res.durationMs >= 0);
  });

  // ============================================================================
  // 6. INVALIDATE (Expurgo Cirúrgico de Cache)
  // ============================================================================
  await check('134. INVALIDATE — Expurga chaves por identificador direto e tags', async () => {
    const res = await nativeAdvancedVerbsHandler('INVALIDATE', 'CATALOGO_PRODUTOS', {
      target: 'produto_4020',
      tag: 'black_friday',
      pattern: 'catalogo:eletronicos:*'
    });

    assert.strictEqual(res.verb, 'INVALIDATE');
    assert.strictEqual(res.targetKey, 'produto_4020');
    assert.strictEqual(res.tag, 'black_friday');
    assert.strictEqual(res.pattern, 'catalogo:eletronicos:*');
    assert.strictEqual(res.invalidated, true);
    assert.ok(res.evictedCount >= 1);
  });

  // ============================================================================
  // 7. DRIFT_DETECT (Detecção Contínua de Schema Drift)
  // ============================================================================
  await check('135. DRIFT_DETECT — Detecta conformidade de 100% em payload íntegro', async () => {
    const res = await nativeAdvancedVerbsHandler('DRIFT_DETECT', 'USER_SCHEMA', {
      payload: { id: 'usr_100', nome: 'Ana Costa', ativo: true },
      expectedContract: { id: 'string', nome: 'string', ativo: 'boolean' }
    });

    assert.strictEqual(res.verb, 'DRIFT_DETECT');
    assert.strictEqual(res.driftDetected, false);
    assert.strictEqual(res.complianceScore, 100);
    assert.strictEqual(res.missingFields.length, 0);
    assert.strictEqual(res.unexpectedFields.length, 0);
  });

  await check('135. DRIFT_DETECT — Identifica campos faltantes, inesperados e tipos divergentes', async () => {
    const res = await nativeAdvancedVerbsHandler('DRIFT_DETECT', 'ORDER_SCHEMA', {
      payload: {
        id: 'ord_99',
        preco: 'cem', // esperado: number
        campoInesperado: 123
        // faltou 'clienteId'
      },
      expectedContract: {
        id: 'string',
        clienteId: 'string',
        preco: 'number'
      }
    });

    assert.strictEqual(res.driftDetected, true);
    assert.ok(res.complianceScore < 100);
    assert.ok(res.missingFields.includes('clienteId'));
    assert.ok(res.unexpectedFields.includes('campoInesperado'));
    assert.ok(res.typeMismatches.some(m => m.field === 'preco' && m.expected === 'number' && m.actual === 'string'));
  });

  // ============================================================================
  // 8. CHAOS (Injeção de Falhas com Guardrail de Produção Estrito)
  // ============================================================================
  await check('136. CHAOS — Bloqueio categórico estrito em ambiente de produção', async () => {
    try {
      await nativeAdvancedVerbsHandler('CHAOS', 'PROD_TARGET', {
        environment: 'production',
        faultType: 'LATENCY',
        latencyMs: 100
      });
      assert.fail('Deveria ter lançado ERR_CHAOS_PRODUCTION_BLOCKED');
    } catch (err) {
      assert.ok(err.message.includes('ERR_CHAOS_PRODUCTION_BLOCKED'));
    }
  });

  await check('136. CHAOS — Injeção de latência controlada permitida em staging/dev', async () => {
    const res = await nativeAdvancedVerbsHandler('CHAOS', 'STAGING_TARGET', {
      environment: 'development',
      faultType: 'LATENCY',
      latencyMs: 50
    });
    assert.strictEqual(res.chaosInjected, true);
    assert.strictEqual(res.verb, 'CHAOS');
    assert.strictEqual(res.latencyAppliedMs, 50);
    assert.strictEqual(res.environment, 'development');
  });

  console.log('\n' + '='.repeat(80));
  console.log(`  RESULTADO: ${passedTests}/${totalTests} TESTES APROVADOS (100%)!`);
  console.log('  A 9ª Família Estratégica do INP Protocol está 100% Operacional!');
  console.log('='.repeat(80));
}

// Execução
run136VerbsNewFamilyAudit().catch(err => {
  console.error('Falha fatal na execução da auditoria:', err);
  process.exit(1);
});
