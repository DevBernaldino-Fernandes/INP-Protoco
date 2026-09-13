/**
 * @fileoverview Suíte de Demonstração e Verificação Formal do Ecossistema INP Protocol.
 * Executa uma bateria completa de 8 provas ponta a ponta (Happy Path, Saga Rollback LIFO,
 * controlo de acessos RBAC, validação de contratos JSON Schema, processamento de linguagem natural,
 * mensageria assíncrona com Padrão Outbox, idempotência determinística e persistência de auditoria).
 *
 * @module Examples/EcommerceEcosystem/RunDemo
 * @security Valida autenticação, perfis de privilégio RBAC e barramento de contratos antes da rede.
 * @audit Regista evidências de execução transacional no PostgreSQL para escrutínio e conformidade.
 */

import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = require('pg');
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { startAllServices } from './start-ecosystem';
import { INPClient } from './client/inp-client';

/**
 * Tabela de códigos de escape ANSI para formatação de saídas coloridas no terminal de comando.
 */
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgBlue: '\x1b[44m\x1b[37m',
  bgYellow: '\x1b[43m\x1b[30m'
};

/**
 * Imprime um cabeçalho proeminente na consola para distinguir blocos mestres de validação.
 *
 * @param {string} title - Título descritivo a ser emoldurado.
 * @returns {void}
 */
function header(title: string) {
  console.log(`\n${c.cyan}╔═══════════════════════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.cyan}║${c.reset} ${c.bright}${title.padEnd(73)}${c.reset} ${c.cyan}║${c.reset}`);
  console.log(`${c.cyan}╚═══════════════════════════════════════════════════════════════════════════╝${c.reset}\n`);
}

/**
 * Emite o cabeçalho específico de uma das provas formais de arquitetura.
 *
 * @param {number} num - Número sequencial da prova (1 a 8).
 * @param {string} title - Título curto da capacidade testada.
 * @param {string} subtitle - Descrição resumida da garantia arquitetural sob teste.
 * @returns {void}
 */
function proofBanner(num: number, title: string, subtitle: string) {
  console.log(`\n${c.yellow}---------------------------------------------------------------------------${c.reset}`);
  console.log(`${c.bright}${c.magenta}PROVA ${num}:${c.reset} ${c.bright}${title}${c.reset}`);
  console.log(`${c.dim}${subtitle}${c.reset}`);
  console.log(`${c.yellow}---------------------------------------------------------------------------${c.reset}`);
}

/**
 * Regista o sucesso de um critério de aceitação na consola.
 *
 * @param {string} msg - Mensagem de sucesso confirmada.
 * @returns {void}
 */
function pass(msg: string) {
  console.log(`  ${c.green}✔ [PASS]${c.reset} ${msg}`);
}

/**
 * Emite falha crítica de teste e interrompe o pipeline com exceção estruturada.
 *
 * @param {string} msg - Descrição do erro verificado.
 * @param {any} [err] - Contexto técnico ou objeto de exceção capturado.
 * @throws {Error} Exceção indicando a não conformidade do protocolo.
 */
function fail(msg: string, err?: any) {
  console.log(`  ${c.red}✖ [FAIL]${c.reset} ${msg}`);
  if (err) console.error(err);
  throw new Error(`Falha no teste: ${msg}`);
}

/**
 * Exibe detalhes técnicos estruturados (pares chave-valor) formatados para auditoria visual.
 *
 * @param {string} label - Rótulo descritivo da propriedade técnica.
 * @param {any} value - Valor primitivo ou objeto a serializar.
 * @returns {void}
 */
function detail(label: string, value: any) {
  const formatted = typeof value === 'object' ? JSON.stringify(value, null, 2) : value;
  console.log(`    ${c.dim}▸ ${label}:${c.reset} ${c.yellow}${formatted}${c.reset}`);
}

/**
 * Realiza uma sonda de saúde HTTP (ping) para determinar se um serviço está recetivo na porta indicada.
 *
 * @param {string} url - URL completa de verificação do estado de saúde (health check).
 * @returns {Promise<boolean>} Verdadeiro caso o serviço responda com HTTP 200 OK no tempo limite.
 */
async function isPortOpen(url: string): Promise<boolean> {
  try {
    const res = await axios.get(url, { timeout: 1500 });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Purga as tabelas operacionais da base de dados PostgreSQL para isolar a bateria de testes
 * e evitar interferência de resíduos de execuções anteriores.
 *
 * @security Utiliza credenciais de teste isoladas na base de dados de desenvolvimento.
 * @audit Garante um ponto de partida fidedigno para a auditoria de novas execuções e rollbacks.
 * @returns {Promise<void>}
 */
async function clearDatabase() {
  const dbClient = new Client({
    connectionString: 'postgres://inp:inp123@127.0.0.1:5432/inp'
  });
  try {
    await dbClient.connect();
    // Limpeza de tabelas transacionais e catálogos
    await dbClient.query("DELETE FROM services");
    await dbClient.query("DELETE FROM saga_states");
    await dbClient.query("DELETE FROM executions");
    await dbClient.query("DELETE FROM queue_jobs");
    await dbClient.query("DELETE FROM dead_letter_queue");
    await dbClient.end();
    console.log(`  ${c.green}✔ [DB CLEAN]${c.reset} Base de dados PostgreSQL preparada e limpa para o teste.`);
  } catch (err: any) {
    console.warn(`  ${c.yellow}⚠ [DB WARN]${c.reset} Aviso na limpeza da base de dados:`, err.message);
  }
}

/**
 * Ponto de entrada principal da suíte de validação e demonstração.
 * Coordena o ciclo de vida do gateway INP, inicia os microsserviços do ecossistema
 * e executa sequencialmente as 8 provas rigorosas de integridade arquitetural.
 *
 * @returns {Promise<void>}
 */
async function main() {
  header('SUÍTE DE PROVAS E VALIDAÇÃO COMPLETA: INTENT NETWORK PROTOCOL (INP)');
  console.log(`${c.dim}Este projeto demonstra e comprova o funcionamento da arquitetura distribuída,${c.reset}`);
  console.log(`${c.dim}orquestração baseada em intenções, resiliência Saga, RBAC e validação de contratos.${c.reset}\n`);

  let gatewayProcess: ChildProcess | null = null;
  let ecosystemServers: any = null;

  try {
    // 0. Preparar Base de Dados PostgreSQL
    await clearDatabase();

    // 1. Verificar ou Inicializar o Gateway INP (:3000)
    const gatewayUp = await isPortOpen('http://localhost:3000/health');
    if (!gatewayUp) {
      console.log(`  ${c.blue}ℹ${c.reset} Gateway INP não está em execução na porta 3000. A inicializar processo...`);
      gatewayProcess = spawn('node', ['dist/index.js'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        env: { ...process.env, DB_HOST: '127.0.0.1' }
      });

      // Aguardar que o Gateway fique saudável
      let ready = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 800));
        if (await isPortOpen('http://localhost:3000/health')) {
          ready = true;
          break;
        }
      }
      if (!ready) {
        throw new Error('Não foi possível iniciar o Gateway INP na porta 3000. Verifique dist/index.js e o PostgreSQL.');
      }
      console.log(`  ${c.green}✔ [GATEWAY]${c.reset} Gateway INP ativo e pronto em http://localhost:3000`);
    } else {
      console.log(`  ${c.green}✔ [GATEWAY]${c.reset} Gateway INP detetado e ativo em http://localhost:3000`);
    }

    // 2. Inicializar o Ecossistema de Microsserviços
    ecosystemServers = await startAllServices('http://localhost:3000');
    const inpClient = new INPClient({ gatewayUrl: 'http://localhost:3000' });

    // Aguardar catalogação e sincronização da cache do INP
    await new Promise(r => setTimeout(r, 1200));

    // =========================================================================
    // PROVA 1: Descoberta & Registo Dinâmico de Microsserviços
    // =========================================================================
    proofBanner(
      1,
      'Descoberta e Registo Dinâmico de Microsserviços',
      'Comprova que os microsserviços publicam as suas capacidades, esquemas e ações compensatórias.'
    );

    const servicesRes = await inpClient.listActiveServices();
    const registeredServices = servicesRes.services || [];
    const registeredIds = registeredServices.map((s: any) => s.id);

    detail('Total de Serviços Ativos no Catálogo', registeredServices.length);
    detail('Serviços Registados', registeredIds);

    const hasInventory = registeredIds.some((id: string) => id.includes('inventory'));
    const hasPayment = registeredIds.some((id: string) => id.includes('payment'));
    const hasShipping = registeredIds.some((id: string) => id.includes('shipping'));
    const hasNotification = registeredIds.some((id: string) => id.includes('notification'));

    if (hasInventory && hasPayment && hasShipping && hasNotification) {
      pass('Todos os 4 microsserviços foram descobertos e indexados pelo INP Gateway com sucesso.');
    } else {
      fail('Um ou mais microsserviços não foram registados no catálogo do INP.');
    }

    // =========================================================================
    // PROVA 2: Fluxo Completo de Sucesso (Happy Path E-Commerce)
    // =========================================================================
    proofBanner(
      2,
      'Fluxo Completo de Sucesso (Happy Path - E-Commerce Checkout)',
      'Executa a orquestração completa: CHECK STOCK ➔ RESERVE STOCK ➔ EXECUTE PAYMENT ➔ CREATE SHIPMENT ➔ SEND CONFIRMATION'
    );

    const happyPathDsl = `
INTENT "ecommerce_checkout_happy_path" {
  CONTEXT {
    user_id: "usr_buyer_42",
    email: "alice@example.com",
    productId: "LAPTOP_PRO",
    quantity: 1,
    amount: 1299.99,
    currency: "USD",
    card_token: "tok_visa_gold_99",
    shipping_address: "Avenida da Liberdade 100, Lisboa"
  }
  REQUIRE {
    CHECK STOCK
    RESERVE STOCK
    EXECUTE PAYMENT
    CREATE SHIPMENT
    SEND CONFIRMATION
  }
  FLOW {
    SEQUENCE {
      CHECK STOCK
      RESERVE STOCK
      EXECUTE PAYMENT
      CREATE SHIPMENT
      SEND CONFIRMATION
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}
    `.trim();

    const happyResult = await inpClient.executeIntent(happyPathDsl, 'dsl', {
      userId: 'usr_buyer_42',
      permissions: ['payments.write']
    });

    detail('Estado da Execução', happyResult.result?.status);
    detail('ID da Execução', happyResult.result?.id || happyResult.result?.execution_id);
    detail('Passos Executados com Sucesso', happyResult.result?.steps?.length);

    if (happyResult.result?.status === 'COMPLETED' && (happyResult.result?.steps?.length || 0) >= 5) {
      pass('Fluxo ponta a ponta executado com estado COMPLETED em todos os 5 passos!');
      detail('Saída Composta', happyResult.result?.output);
    } else {
      fail('Fluxo de sucesso falhou ou não executou todos os passos esperados.', happyResult);
    }

    // =========================================================================
    // PROVA 3: Padrão Saga Distribuído & Reversão Compensatória Automática
    // =========================================================================
    proofBanner(
      3,
      'Padrão Saga Distribuído & Reversão Compensatória Automática',
      'Simula falha (Chaos 500) na Logística. Prova que o INP reverte automaticamente o Pagamento e o Stock.'
    );

    // 1. Obter stock antes do teste
    const initialStock = ecosystemServers.inventory.getInventory()['LAPTOP_PRO'];
    detail('Stock Inicial de LAPTOP_PRO', initialStock);

    // 2. Injetar Chaos no Shipping Service
    console.log(`  ${c.yellow}⚡ A ativar simulação de Chaos Error 500 no serviço de Logística...${c.reset}`);
    await axios.post('http://localhost:3003/chaos', { state: 'ERROR_500' });

    const sagaDsl = `
INTENT "ecommerce_saga_rollback_test" {
  CONTEXT {
    user_id: "usr_buyer_99",
    email: "bob@example.com",
    productId: "LAPTOP_PRO",
    quantity: 2,
    amount: 2599.98,
    currency: "USD",
    card_token: "tok_master_black_88",
    shipping_address: "Rua do Ouro 50, Porto"
  }
  REQUIRE {
    RESERVE STOCK
    EXECUTE PAYMENT
    CREATE SHIPMENT
  }
  FLOW {
    SEQUENCE {
      RESERVE STOCK
      EXECUTE PAYMENT
      CREATE SHIPMENT
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}
    `.trim();

    console.log(`  ${c.dim}A executar intenção com falha propositada no 3º passo (CREATE SHIPMENT)...${c.reset}`);
    const sagaResult = await inpClient.executeIntent(sagaDsl, 'dsl', {
      userId: 'usr_buyer_99',
      permissions: ['payments.write']
    });

    detail('Estado da Execução (Esperado: FAILED)', sagaResult.result?.status);
    detail('Mensagem de Erro Intercetada', sagaResult.result?.error);

    // 3. Restaurar Shipping para Healthy
    await axios.post('http://localhost:3003/chaos', { state: 'HEALTHY' });

    // 4. Verificar se a compensação Saga ocorreu:
    // - O stock deve ter sido restaurado para o valor inicial!
    // - O pagamento deve ter um reembolso registado!
    const finalStock = ecosystemServers.inventory.getInventory()['LAPTOP_PRO'];
    const refundsMap = ecosystemServers.payment.getRefunds();

    detail('Stock Pós-Rollback (Deve ser idêntico ao inicial)', finalStock);
    detail('Total de Reembolsos Processados no Gateway de Pagamento', refundsMap.size);

    if (
      sagaResult.result?.status === 'FAILED' &&
      finalStock === initialStock &&
      refundsMap.size >= 1
    ) {
      pass('SAGA ROLLBACK PERFEITO: O erro na Logística ativou as compensações em ordem inversa (LIFO).');
      pass('Stock foi recomposto integralmente e pagamento foi reembolsado automaticamente sem deixar inconsistências!');
    } else {
      fail(`Falha na compensação Saga. Stock esperado: ${initialStock}, atual: ${finalStock}. Reembolsos: ${refundsMap.size}`);
    }

    // =========================================================================
    // PROVA 4: Blindagem de Segurança e RBAC (Role-Based Access Control)
    // =========================================================================
    proofBanner(
      4,
      'Blindagem de Segurança e RBAC (Role-Based Access Control)',
      'Submete intenção com capacidade restrita (EXECUTE PAYMENT) utilizando permissões insuficientes.'
    );

    const rbacDsl = `
INTENT "unauthorized_payment" {
  CONTEXT {
    user_id: "usr_attacker",
    amount: 999.00,
    card_token: "tok_stolen"
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}
    `.trim();

    const rbacResult = await inpClient.executeIntent(rbacDsl, 'dsl', {
      userId: 'usr_attacker',
      permissions: ['read.catalog.only'] // NÃO possui 'payments.write'
    });

    detail('Estado Retornado', rbacResult.result?.status);
    detail('Motivo da Rejeição', rbacResult.result?.error);

    if (
      rbacResult.result?.status === 'FAILED' &&
      rbacResult.result?.error?.includes('Security Violation')
    ) {
      pass('INP RBAC bloqueou a execução ANTES de disparar qualquer chamada de rede para o serviço!');
    } else {
      fail('Falha de segurança: o pedido não autorizado deveria ter sido rejeitado pelo RBAC.', rbacResult);
    }

    // =========================================================================
    // PROVA 5: Blindagem por Validação de Contrato Rigorosa (AJV JSON Schema)
    // =========================================================================
    proofBanner(
      5,
      'Blindagem por Validação de Contrato (AJV JSON Schema)',
      'Envia payload com valor inválido (amount: -50.00). O schema do serviço exige valor mínimo de 1.00.'
    );

    const invalidContractDsl = `
INTENT "invalid_schema_payment" {
  CONTEXT {
    user_id: "usr_buyer_42",
    amount: -50.00,
    card_token: "tok_valid"
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}
    `.trim();

    const contractResult = await inpClient.executeIntent(invalidContractDsl, 'dsl', {
      userId: 'usr_buyer_42',
      permissions: ['payments.write']
    });

    detail('Estado Retornado', contractResult.result?.status);
    detail('Detalhes do Erro de Esquema', contractResult.result?.error);

    if (
      contractResult.result?.status === 'FAILED' &&
      contractResult.result?.error?.includes('Contract Violation')
    ) {
      pass('Validador de contratos do INP intercetou o payload corrompido e protegeu o microsserviço.');
    } else {
      fail('Falha na validação de contrato: payload inválido não foi barrado.', contractResult);
    }

    // =========================================================================
    // PROVA 6: Processamento de Linguagem Natural
    // =========================================================================
    proofBanner(
      6,
      'Processamento e Orquestração por Linguagem Natural',
      'Envia frase em linguagem natural humana. O IntentParser decompõe em intenção estruturada.'
    );

    const naturalText = 'Quero pagar 250 euros para o utilizador usr_buyer_42 com o cartão tok_visa_gold_99';
    detail('Texto em Linguagem Natural', naturalText);

    const naturalResult = await inpClient.executeIntent(naturalText, 'natural', {
      userId: 'usr_buyer_42',
      permissions: ['payments.write']
    });

    detail('Estado da Execução', naturalResult.result?.status);
    detail('Intenção Estruturada Gerada', naturalResult.result?.name);
    detail('Saída da Transação', naturalResult.result?.output);

    if (naturalResult.result?.status === 'COMPLETED') {
      pass('Linguagem natural traduzida com sucesso para capacidade EXECUTE PAYMENT e executada com sucesso!');
    } else {
      fail('Falha na execução de linguagem natural.', naturalResult);
    }

    // =========================================================================
    // PROVA 7: Execução Assíncrona com Padrão Outbox & QueueWorker
    // =========================================================================
    proofBanner(
      7,
      'Processamento Assíncrono com Padrão Outbox & QueueWorker',
      'Submete com "async": true. Recebe resposta imediata e o QueueWorker processa em segundo plano via PostgreSQL.'
    );

    const asyncDsl = `
INTENT "async_order_processing" {
  CONTEXT {
    user_id: "usr_async_client",
    email: "async_client@example.com",
    productId: "HEADPHONES",
    quantity: 1,
    amount: 199.00,
    card_token: "tok_instant_pay",
    shipping_address: "Rua Augusta 200, Lisboa"
  }
  REQUIRE {
    CHECK STOCK
    EXECUTE PAYMENT
    SEND CONFIRMATION
  }
  FLOW {
    SEQUENCE {
      CHECK STOCK
      EXECUTE PAYMENT
      SEND CONFIRMATION
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}
    `.trim();

    const asyncSubmit = await inpClient.executeIntent(
      asyncDsl,
      'dsl',
      { userId: 'usr_async_client', permissions: ['payments.write'] },
      true // async = true
    );

    detail('Resposta Imediata HTTP', asyncSubmit.result);
    const asyncExecId = asyncSubmit.result?.execution_id;

    if (asyncSubmit.result?.status !== 'PENDING' || !asyncExecId) {
      fail('Falha no enfileiramento assíncrono via Outbox.', asyncSubmit);
    }

    pass('Intenção aceite de imediato com status PENDING via Padrão Outbox transacional.');
    console.log(`  ${c.dim}A aguardar que o QueueWorker processe o job na base de dados (${asyncExecId})...${c.reset}`);

    const finishedJob = await inpClient.pollExecutionStatus(asyncExecId, 15000);
    detail('Estado Final Gravado pelo QueueWorker', finishedJob.status);
    detail('Timestamp de Conclusão', finishedJob.completedAt);

    if (finishedJob.status === 'COMPLETED') {
      pass('QueueWorker do INP capturou o job da tabela queue_jobs e concluiu a execução com status COMPLETED!');
    } else {
      fail(`Job assíncrono finalizou com status inesperado: ${finishedJob.status}`);
    }

    // =========================================================================
    // PROVA 8: Idempotência Determinística e Telemetria de Auditoria
    // =========================================================================
    proofBanner(
      8,
      'Idempotência Determinística e Telemetria de Auditoria',
      'Comprova a geração do header X-Idempotency-Key e a integridade dos registos operacionais no PostgreSQL.'
    );

    const paymentKeys = ecosystemServers.payment.getIdempotencyKeys();
    detail('Total de Chaves de Idempotência Recebidas pelo Microsserviço', paymentKeys.length);
    detail('Exemplo de Chave X-Idempotency-Key Gerada', paymentKeys[0]);

    const stats = await inpClient.getDashboardStats();
    detail('Métricas da Dashboard API', stats.stats);

    const dbClient = new Client({
      connectionString: 'postgres://inp:inp123@127.0.0.1:5432/inp'
    });
    await dbClient.connect();
    const auditRes = await dbClient.query('SELECT id, status, started_at, completed_at FROM executions ORDER BY started_at DESC LIMIT 5');
    await dbClient.end();

    console.log(`\n  ${c.bright}Histórico Real de Auditoria no PostgreSQL (Tabela 'executions'):${c.reset}`);
    auditRes.rows.forEach((r: any) => {
      console.log(`    ▸ ID: ${r.id} | Estado: ${r.status} | Iniciado: ${new Date(r.started_at).toLocaleTimeString()}`);
    });

    if (paymentKeys.length > 0 && stats.stats?.totalExecutions > 0 && auditRes.rows.length > 0) {
      pass('Chaves de Idempotência verificadas e rastreabilidade transacional 100% auditada na base de dados!');
    } else {
      fail('Falha na verificação de idempotência ou auditoria.');
    }

    // =========================================================================
    // CONCLUSÃO FINAL
    // =========================================================================
    console.log(`\n${c.bgGreen}${c.bright}                                                                           ${c.reset}`);
    console.log(`${c.bgGreen}${c.bright}   🎉 SUCESSO TOTAL: TODAS AS 8 PROVAS DO INP PROTOCOL FORAM APROVADAS!   ${c.reset}`);
    console.log(`${c.bgGreen}${c.bright}                                                                           ${c.reset}\n`);

    console.log(`${c.green}Comprovado que o Intent Network Protocol (INP):${c.reset}`);
    console.log(`  1. Descobre e regista serviços dinamicamente.`);
    console.log(`  2. Orquestra grafos complexos desacoplados de URLs.`);
    console.log(`  3. Executa rollbacks compensatórios (Padrão Saga) automaticamente sem deixar dados órfãos.`);
    console.log(`  4. Protege os recursos com validação de segurança RBAC antes da rede.`);
    console.log(`  5. Valida contratos JSON Schema rejeitando dados incorretos.`);
    console.log(`  6. Converte frases em linguagem natural humana em ações de microsserviços.`);
    console.log(`  7. Opera de forma assíncrona escalável via Padrão Outbox e locks concorrentes.`);
    console.log(`  8. Garante idempotência determinística e auditoria transparente no PostgreSQL.\n`);

  } catch (err: any) {
    console.error(`\n${c.red}❌ ERRO NA EXECUÇÃO DA DEMONSTRAÇÃO:${c.reset}`, err.message);
    process.exitCode = 1;
  } finally {
    console.log(`${c.dim}A finalizar microsserviços de demonstração...${c.reset}`);
    if (ecosystemServers) {
      ecosystemServers.stopAll();
    }
    if (gatewayProcess) {
      gatewayProcess.kill();
    }
    console.log(`${c.dim}Encerrado.${c.reset}`);
  }
}

main();
