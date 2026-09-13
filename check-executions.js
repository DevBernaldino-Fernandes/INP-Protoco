/**
 * @fileoverview Script de Inspeção e Auditoria Rápida de Execuções e Estados Saga no PostgreSQL.
 * Estabelece ligação direta à base de dados para extrair e imprimir o registo mais recente
 * das tabelas transacionais 'executions' e 'saga_states', permitindo auditoria visual imediata.
 *
 * @module Scripts/CheckExecutions
 * @security Utiliza credenciais de infraestrutura local para inspeção transacional de diagnóstico.
 * @audit Permite aos operadores e auditores validar o estado final de rollback ou conclusão de intenções.
 */

const { Client } = require('pg');

/**
 * Consulta e exibe no terminal os registos mais recentes de execução e estado de saga.
 *
 * @audit Realiza leitura pontual de registos transacionais para análise pós-execução.
 * @returns {Promise<void>}
 */
async function check() {
  const client = new Client({
    connectionString: 'postgres://inp:inp123@localhost:5432/inp'
  });
  await client.connect();

  try {
    // 1. Obter a execução mais recente registada
    const execs = await client.query('SELECT * FROM executions ORDER BY started_at DESC LIMIT 1');
    console.log('--- ÚLTIMA EXECUÇÃO REGISTADA (EXECUTIONS) ---');
    console.log(JSON.stringify(execs.rows[0], null, 2));

    // 2. Obter o estado de saga distribuída mais recente
    const sagas = await client.query('SELECT * FROM saga_states ORDER BY created_at DESC LIMIT 1');
    console.log('--- ÚLTIMO ESTADO SAGA (SAGA_STATES) ---');
    console.log(JSON.stringify(sagas.rows[0], null, 2));

  } catch (err) {
    console.error('Erro na inspeção de auditoria da base de dados:', err);
  } finally {
    await client.end();
  }
}

// Disparo da verificação de auditoria
check();
