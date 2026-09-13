/**
 * @fileoverview Script de Validação de Parser INP-DSL Multilinha com Blocos Aninhados.
 * Valida se o analisador sintático (IntentParser) processa corretamente quebras de linha e
 * indentação hierárquica nos blocos SEQUENCE de intenções declarativas.
 *
 * @module Scripts/TestFlowMultiline
 * @security Valida a integridade léxica e estrutural do comando DSL antes do despacho ao motor de execução.
 * @audit Regista a execução da intenção resultante na persistência PostgreSQL.
 */

const axios = require('axios');

/**
 * Submete uma intenção DSL com formatação multilinha e blocos aninhados para validar o parser.
 *
 * @returns {Promise<void>}
 */
async function test() {
  try {
    console.log('--- A Processar Intenção DSL Formatada em Múltiplas Linhas ---');
    const dslText = `
INTENT "buy_product" {
  CONTEXT { amount: 125, user_id: "usr_99" }
  REQUIRE { EXECUTE PAYMENT }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
  OUTPUT { FORMAT "json" }
}
    `.trim();

    const dslRes = await axios.post('http://localhost:3000/api/intent', {
      text: dslText,
      type: 'dsl'
    });
    console.log('Resultado da Execução DSL:', JSON.stringify(dslRes.data, null, 2));

  } catch (err) {
    console.error('Falha no teste multilinha:', err.response ? err.response.data : err.message);
  }
}

// Disparo da validação do parser multilinha
test();
