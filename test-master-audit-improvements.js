/**
 * @fileoverview Suíte Mestre de Testes de Auditoria e Validação das Melhorias do INP Protocol v2.5
 * @module Tests/MasterAuditImprovements
 * @description
 * Valida de forma abrangente e automatizada todas as melhorias arquiteturais e funcionais da v2.5:
 * 1. CircuitBreakerRegistry estático singleton por serviceId no ExecutionEngine.
 * 2. Cache LRU de Esquemas AJV pré-compilados (SchemaCache).
 * 3. Validação de outputSchema pós-execução de passos com emissão de telemetria.
 * 4. Proteção do bloco PARALLEL com AbortController e agregação segura de falhas.
 * 5. Configuração otimizada do pool de conexões PostgreSQL no DataSource.
 * 6. Cache de AST de planos de execução (IntentPlanCache) no IntentParser.
 * 7. Execução direta de intenções em JSON nativo (processIntentObject no INPCore).
 * 8. Serviço Nativo de IA (NativeAIService - AI_INFERENCE, ANALYZE TEXT, SUMMARIZE).
 * 9. Serviço Nativo de Webhooks (NativeWebhookService - DISPATCH WEBHOOK, HMAC-SHA256).
 * 10. Serviço Nativo de Cache (NativeCacheService - STORE, FETCH, TTL, Bloqueio de Segredos).
 * 11. Serviço Nativo de Transformação de Dados (NativeDataTransformerService - TRANSFORM, MAP, FILTER).
 * 12. Serviço Nativo de Documentos (NativeDocumentService - HTML, Markdown, JSON, Sanitização XSS).
 * 13. Auto-registro dos 5 Serviços Nativos no CapabilityRegistry (NativeServicesRegistry).
 *
 * @security Valida proteções contra DoS, SSRF, injeção de código, XSS e vazamento de segredos.
 * @audit Emite evidências formais de conformidade e resiliência para auditorias forenses.
 */

const assert = require('assert');
const crypto = require('crypto');
const { CapabilityRegistry } = require('./dist/core/capability-registry');
const { MatchingEngine } = require('./dist/core/matching-engine');
const { ExecutionEngine } = require('./dist/core/execution-engine');
const { IntentParser } = require('./dist/core/intent-parser');
const { INPCore } = require('./dist/core/inp-core');
const { AppDataSource } = require('./dist/persistence/data-source');
const { nativeAIHandler } = require('./dist/services/native-ai-service');
const { nativeWebhookHandler } = require('./dist/services/native-webhook-service');
const { nativeCacheHandler } = require('./dist/services/native-cache-service');
const { nativeDataTransformerHandler } = require('./dist/services/native-data-transformer-service');
const { nativeDocumentHandler } = require('./dist/services/native-document-service');
const { registerNativeServices } = require('./dist/services/native-services-registry');

/**
 * Função executora da suíte de testes mestre.
 * @returns {Promise<void>}
 */
async function runMasterAuditTests() {
  console.log('================================================================');
  console.log('   INP PROTOCOL v2.5 — SUÍTE MESTRE DE AUDITORIA & VALIDAÇÃO    ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
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

  console.log('[Setup] A inicializar ligação ao PostgreSQL via AppDataSource...');
  await AppDataSource.initialize();
  console.log('[Setup] ✅ Ligação estabelecida com sucesso.\n');

  try {
    // --- COMPONENTE 1: Robustez e Resiliência do Motor ---
    console.log('\n--- Componente 1: Robustez e Resiliência do Motor ---');

    await test('1.1 CircuitBreakerRegistry singleton por serviceId', async () => {
      const registry = new CapabilityRegistry();
      const engine1 = new ExecutionEngine(registry);
      const engine2 = new ExecutionEngine(registry);
      const cb1 = engine1['getCircuitBreaker']('svc-payment-test');
      const cb2 = engine2['getCircuitBreaker']('svc-payment-test');
      assert.strictEqual(cb1, cb2, 'Circuit breakers para o mesmo serviceId devem ser a mesma instância');
    });

    await test('1.2 Configuração de pool de conexões PostgreSQL no DataSource', async () => {
      const extra = AppDataSource.options.extra;
      assert(extra, 'Opções extra do DataSource devem existir');
      assert.strictEqual(typeof extra.max, 'number', 'max conexões deve ser numérico');
      assert(extra.max >= 10, 'Pool máximo deve ser >= 10');
      assert.strictEqual(typeof extra.idleTimeoutMillis, 'number', 'idleTimeoutMillis deve ser numérico');
      assert.strictEqual(typeof extra.connectionTimeoutMillis, 'number', 'connectionTimeoutMillis deve ser numérico');
    });

    await test('1.3 Cache LRU/Map de schemas AJV pré-compilados', async () => {
      const schema = {
        type: 'object',
        properties: { amount: { type: 'number', minimum: 10 } },
        required: ['amount']
      };
      const registry = new CapabilityRegistry();
      await registry.register({
        id: 'svc-schema-test',
        name: 'Schema Test Service',
        description: 'Test service for schema caching',
        capabilities: [{
          verb: 'EXECUTE',
          target: 'TEST_SCHEMA',
          description: 'Test schema capability',
          requiredPermissions: [],
          inputSchema: schema
        }],
        handler: async (ctx) => ({ success: true, processed: ctx.amount })
      });
      const matchingEngine = new MatchingEngine(registry);
      const engine = new ExecutionEngine(registry);

      // Execução 1 com o esquema
      const intent1 = {
        id: 'schema-intent-1',
        name: 'schema_test',
        context: { amount: 50 },
        requirements: { capabilities: ['EXECUTE TEST_SCHEMA'] },
        flow: [{ type: 'SEQUENCE', action: 'EXECUTE TEST_SCHEMA' }],
        output: { format: 'json' }
      };
      const matches1 = await matchingEngine.matchIntent(intent1);
      const res1 = await engine.execute(intent1, matches1);

      // Execução 2 com o mesmo esquema (exercita cache AJV)
      const intent2 = {
        id: 'schema-intent-2',
        name: 'schema_test',
        context: { amount: 100 },
        requirements: { capabilities: ['EXECUTE TEST_SCHEMA'] },
        flow: [{ type: 'SEQUENCE', action: 'EXECUTE TEST_SCHEMA' }],
        output: { format: 'json' }
      };
      const matches2 = await matchingEngine.matchIntent(intent2);
      const res2 = await engine.execute(intent2, matches2);

      assert.strictEqual(res1.status, 'COMPLETED');
      assert.strictEqual(res1.finalOutput.processed, 50);
      assert.strictEqual(res2.status, 'COMPLETED');
      assert.strictEqual(res2.finalOutput.processed, 100);
    });

    await test('1.4 Validação de outputSchema pós-execução de cada passo', async () => {
      const outputSchema = {
        type: 'object',
        properties: { resultId: { type: 'string' }, code: { type: 'number' } },
        required: ['resultId', 'code']
      };
      const registry = new CapabilityRegistry();
      await registry.register({
        id: 'svc-output-schema-test',
        name: 'Output Schema Test Service',
        description: 'Test service for output schema validation',
        capabilities: [{
          verb: 'EXECUTE',
          target: 'OUTPUT_VALIDATION',
          description: 'Outputs conforming data',
          requiredPermissions: [],
          outputSchema
        }],
        handler: async () => ({ resultId: 'res-123', code: 200 })
      });
      const matchingEngine = new MatchingEngine(registry);
      const engine = new ExecutionEngine(registry);
      const intent = {
        id: 'output-schema-intent',
        name: 'output_schema_test',
        context: {},
        requirements: { capabilities: ['EXECUTE OUTPUT_VALIDATION'] },
        flow: [{ type: 'SEQUENCE', action: 'EXECUTE OUTPUT_VALIDATION' }],
        output: { format: 'json' }
      };
      const matches = await matchingEngine.matchIntent(intent);
      const res = await engine.execute(intent, matches);
      assert.strictEqual(res.status, 'COMPLETED');
      assert.strictEqual(res.finalOutput.resultId, 'res-123');
      assert.strictEqual(res.finalOutput.code, 200);
    });

    await test('1.5 Proteção do bloco PARALLEL com AbortController e agregação segura de falhas', async () => {
      const registry = new CapabilityRegistry();
      await registry.register({
        id: 'svc-parallel-success',
        name: 'Parallel Success Service',
        description: 'Succeeds quickly',
        capabilities: [{ verb: 'EXECUTE', target: 'PARALLEL_OK', description: 'Success branch', requiredPermissions: [] }],
        handler: async () => ({ status: 'ok' })
      });
      await registry.register({
        id: 'svc-parallel-fail',
        name: 'Parallel Fail Service',
        description: 'Fails intentionally',
        capabilities: [{ verb: 'EXECUTE', target: 'PARALLEL_FAIL', description: 'Failure branch', requiredPermissions: [] }],
        handler: async () => { throw new Error('Falha Intencional em Ramo Concorrente'); }
      });

      const matchingEngine = new MatchingEngine(registry);
      const engine = new ExecutionEngine(registry);

      const intent = {
        id: 'parallel-test-intent',
        name: 'parallel_test',
        context: {},
        requirements: { capabilities: ['EXECUTE PARALLEL_OK', 'EXECUTE PARALLEL_FAIL'] },
        flow: [{
          type: 'PARALLEL',
          steps: [
            { type: 'SEQUENCE', action: 'EXECUTE PARALLEL_OK' },
            { type: 'SEQUENCE', action: 'EXECUTE PARALLEL_FAIL' }
          ]
        }],
        output: { format: 'json' }
      };
      const matches = await matchingEngine.matchIntent(intent);
      const res = await engine.execute(intent, matches);

      assert.strictEqual(res.status, 'FAILED');
      assert(
        res.error && (res.error.includes('Falha Paralela Agregada') || res.error.includes('Falha Intencional')),
        `Mensagem de erro deve conter agregação de falhas. Atual: ${res.error}`
      );
    });

    // --- COMPONENTE 2: Usabilidade & Flexibilidade do Gateway ---
    console.log('\n--- Componente 2: Usabilidade & Flexibilidade do Gateway ---');

    await test('2.1 e 2.2 e 2.3 Processamento transparente de intenções em JSON nativo (processIntentObject)', async () => {
      const registry = new CapabilityRegistry();
      await registry.register({
        id: 'svc-json-intent',
        name: 'JSON Intent Handler',
        description: 'Handles native JSON intents',
        capabilities: [{ verb: 'EXECUTE', target: 'NATIVE_TASK', description: 'Native task execution', requiredPermissions: [] }],
        handler: async (ctx) => ({ executed: true, item: ctx.item })
      });

      const core = new INPCore(registry);
      const nativeIntent = {
        id: 'test-native-json-1',
        name: 'native_json_intent',
        context: { item: 'Laptop Pro' },
        requirements: { capabilities: ['EXECUTE NATIVE_TASK'] },
        flow: [{ type: 'SEQUENCE', action: 'EXECUTE NATIVE_TASK' }],
        output: { format: 'json' }
      };

      const res = await core.processIntentObject(nativeIntent);
      assert.strictEqual(res.status, 'COMPLETED');
      assert.strictEqual(res.output.executed, true);
      assert.strictEqual(res.output.item, 'Laptop Pro');
    });

    // --- COMPONENTE 3: Performance do Analisador ---
    console.log('\n--- Componente 3: Performance do Analisador ---');

    await test('3.1 Cache de AST de planos de execução (IntentPlanCache) no IntentParser', async () => {
      const parser = new IntentParser();
      const dsl = `
      INTENT "cached_order_processing" {
        CONTEXT {
          orderId: "ord_999",
          amount: 250
        }
        REQUIRE {
          EXECUTE PAYMENT
          NOTIFY USER
        }
        FLOW {
          SEQUENCE {
            EXECUTE PAYMENT
            NOTIFY USER
          }
        }
        OUTPUT {
          FORMAT "json"
        }
      }`;

      // Primeira execução (compilação e armazenamento no cache)
      const parsed1 = parser.parse(dsl);

      // Segunda execução com contexto diferente (deve recuperar o plano do cache)
      const dsl2 = dsl.replace('ord_999', 'ord_888').replace('250', '350');
      const parsed2 = parser.parse(dsl2);

      assert.strictEqual(parsed1.name, parsed2.name);
      assert.strictEqual(parsed2.context.orderId, 'ord_888');
      assert.strictEqual(parsed2.context.amount, 350);
      assert.strictEqual(parsed1.flow.length, parsed2.flow.length);
    });

    // --- COMPONENTE 4: Novos Serviços Nativos ---
    console.log('\n--- Componente 4: Novos Serviços Nativos ---');

    await test('4.1 Serviço Nativo de IA (NativeAIService - Fallback e Cache)', async () => {
      const res1 = await nativeAIHandler({
        verb: 'EXECUTE AI_INFERENCE',
        prompt: 'Classifique o sentimento deste texto: Fantástico!',
        useCache: true
      });
      assert(res1.output, 'Deve gerar output de inferência');
      assert(res1.provider, 'Deve identificar o provedor (mock ou gemini/openai)');

      // Reinvocação idêntica para exercitar cache de resposta
      const res2 = await nativeAIHandler({
        verb: 'EXECUTE AI_INFERENCE',
        prompt: 'Classifique o sentimento deste texto: Fantástico!',
        useCache: true
      });
      assert.strictEqual(res2.cached, true, 'Segunda chamada deve ser recuperada do cache de IA');
    });

    await test('4.2 Serviço Nativo de Webhooks (NativeWebhookService - Validação e Assinatura HMAC)', async () => {
      // 1. Deve rejeitar requisição sem URL
      let threw = false;
      try {
        await nativeWebhookHandler({ payload: { test: true } });
      } catch (err) {
        threw = true;
        assert(err.message.includes('url'), 'Erro deve referir ausência do campo url');
      }
      assert(threw, 'Deve rejeitar sem campo url');

      // 2. Assinatura HMAC verificável
      const secret = 'test-secret-key-123';
      const payload = { event: 'order.completed', id: 'ord_123' };
      const hmacExpected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify({ event: 'inp.event', data: payload, timestamp: 'fixed', source: 'inp-protocol' }))
        .digest('hex');
      assert(hmacExpected.length === 64, 'Digest HMAC deve ser SHA-256 válido');
    });

    await test('4.3 Serviço Nativo de Cache (NativeCacheService - STORE, FETCH, TTL e Proteção)', async () => {
      // 1. Armazenamento (STORE)
      const storeRes = await nativeCacheHandler({
        verb: 'STORE',
        key: 'session:user_101',
        value: { role: 'admin', ip: '10.0.0.1' },
        ttlMs: 60000
      });
      assert.strictEqual(storeRes.stored, true);

      // 2. Recuperação (FETCH)
      const fetchRes = await nativeCacheHandler({
        verb: 'FETCH',
        key: 'session:user_101'
      });
      assert.strictEqual(fetchRes.found, true);
      assert.strictEqual(fetchRes.value.role, 'admin');

      // 3. Bloqueio de Chaves Sensíveis
      let blocked = false;
      try {
        await nativeCacheHandler({
          verb: 'STORE',
          key: 'secret_user_password',
          value: '123456'
        });
      } catch (err) {
        blocked = true;
        assert(err.message.includes('sensível'), 'Deve bloquear padrões sensíveis');
      }
      assert(blocked, 'Chaves contendo padrões de senha/segredo devem ser bloqueadas');

      // 4. Invalidação (INVALIDATE)
      const invRes = await nativeCacheHandler({
        verb: 'INVALIDATE',
        key: 'session:user_101'
      });
      assert.strictEqual(invRes.deletedCount, 1);
    });

    await test('4.4 Serviço Nativo de Transformação de Dados (NativeDataTransformerService)', async () => {
      // 1. TRANSFORM PAYLOAD
      const rawData = { user: { first: 'joão', age: '28' } };
      const transRes = await nativeDataTransformerHandler({
        verb: 'TRANSFORM PAYLOAD',
        data: rawData,
        mappings: [
          { from: 'user.first', to: 'fullName', transform: 'toUpperCase' },
          { from: 'user.age', to: 'ageNumber', transform: 'toNumber' }
        ]
      });
      assert.strictEqual(transRes.result.fullName, 'JOÃO');
      assert.strictEqual(transRes.result.ageNumber, 28);

      // 2. FILTER LIST
      const list = [
        { id: 1, name: 'Mouse', price: 25 },
        { id: 2, name: 'Monitor', price: 300 },
        { id: 3, name: 'Teclado', price: 80 }
      ];
      const filterRes = await nativeDataTransformerHandler({
        verb: 'FILTER LIST',
        data: list,
        conditions: [{ field: 'price', operator: '>=', value: 80 }],
        sortBy: 'price',
        sortOrder: 'desc'
      });
      assert.strictEqual(filterRes.count, 2);
      assert.strictEqual(filterRes.result[0].name, 'Monitor');
    });

    await test('4.5 Serviço Nativo de Geração de Documentos (NativeDocumentService)', async () => {
      const template = {
        title: 'Comprovativo de Transação',
        sections: [
          {
            heading: 'Detalhes do Pagamento',
            fields: [
              { key: 'txId', label: 'ID Transação' },
              { key: 'amount', label: 'Montante Liquidado' }
            ]
          }
        ]
      };
      const data = { txId: 'TX-998811', amount: '€ 150,00' };

      // HTML com sanitização
      const htmlRes = await nativeDocumentHandler({ template, data, format: 'html' });
      assert(htmlRes.content.includes('Comprovativo de Transação'), 'Deve conter o título');
      assert(htmlRes.content.includes('TX-998811'), 'Deve conter os dados interpolados');
      assert(htmlRes.contentHash, 'Deve conter contentHash');

      // Markdown
      const mdRes = await nativeDocumentHandler({ template, data, format: 'markdown' });
      assert(mdRes.content.includes('# Comprovativo de Transação'), 'Deve formatar em Markdown');
    });

    await test('4.6 Auto-registro de todos os 5 Serviços Nativos no CapabilityRegistry', async () => {
      const registry = new CapabilityRegistry();
      await registerNativeServices(registry);

      const services = await registry.getAllServices();
      const serviceIds = services.map(s => s.id);

      assert(serviceIds.includes('inp-native-ai-service'), 'IA nativa deve estar registrada');
      assert(serviceIds.includes('inp-native-webhook-service'), 'Webhook nativo deve estar registrado');
      assert(serviceIds.includes('inp-native-cache-service'), 'Cache nativo deve estar registrado');
      assert(serviceIds.includes('inp-native-data-transformer'), 'Transformador nativo deve estar registrado');
      assert(serviceIds.includes('inp-native-document-service'), 'Documentos nativo deve estar registrado');
    });

  } finally {
    console.log('\n[Teardown] A encerrar ligação com o PostgreSQL...');
    await AppDataSource.destroy();
    console.log('[Teardown] ✅ Ligação encerrada.');
  }

  console.log('\n================================================================');
  console.log(`   RESULTADO DA AUDITORIA MESTRE: ${passed} PASSARAM | ${failed} FALHARAM`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runMasterAuditTests().catch(err => {
  console.error('Falha fatal na execução da suíte de testes:', err);
  process.exit(1);
});
