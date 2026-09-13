/**
 * @fileoverview Script de Diagnóstico e Verificação de Conetividade à Base de Dados PostgreSQL.
 * Realiza testes sistemáticos de ligação com credenciais de desenvolvimento conhecidas para
 * validar a acessibilidade e autenticação no porto 5432 antes do arranque do protocolo.
 *
 * @module Scripts/TestDatabase
 * @security Valida as credenciais locais autorizadas para a instância PostgreSQL de desenvolvimento.
 * @audit Permite diagnosticar falhas de acesso de forma auditável e registada no terminal.
 */

const { Client } = require('pg');

/**
 * Lista de nomes de utilizador padrão para diagnóstico de conetividade local.
 */
const users = ['postgres', 'inp'];

/**
 * Lista de palavras-passe comuns para teste de ambiente de desenvolvimento.
 */
const passwords = ['', 'postgres', 'admin', 'inp123', 'root', '123456', '1234'];

/**
 * Itera pelas credenciais até estabelecer uma ligação válida à base de dados.
 *
 * @returns {Promise<void>}
 */
async function test() {
  for (const user of users) {
    for (const password of passwords) {
      console.log(`A tentar ligação com utilizador: ${user}, palavra-passe: "${password}"...`);
      const client = new Client({
        host: 'localhost',
        port: 5432,
        user: user,
        password: password,
        database: 'postgres',
      });
      try {
        await client.connect();
        console.log(`SUCESSO! Ligação estabelecida com o utilizador: ${user}, palavra-passe: "${password}"`);
        await client.end();
        return;
      } catch (err) {
        console.log(`Falha: ${err.message}`);
      }
    }
  }
  console.log('Todas as tentativas de ligação falharam.');
}

// Disparo do diagnóstico de conetividade
test();
