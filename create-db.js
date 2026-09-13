/**
 * @fileoverview Utilitário de Aprovisionamento e Inicialização da Base de Dados PostgreSQL.
 * Estabelece ligação administrativa à base de dados padrão ('postgres') para verificar a existência
 * do catálogo 'inp' e do utilizador de sistema com as devidas permissões de persistência.
 *
 * @module Scripts/CreateDatabase
 * @security Configura o utilizador de serviço para acesso controlado às tabelas transacionais do protocolo.
 * @audit Assegura a infraestrutura de dados base necessária para registo de auditoria imutável.
 */

const { Client } = require('pg');

/**
 * Executa o fluxo idempotente de criação da base de dados 'inp' e utilizador 'inp'.
 *
 * @security Cria ou atualiza as credenciais do utilizador de base de dados para o protocolo.
 * @returns {Promise<void>}
 */
async function run() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'inp',
    password: 'inp123',
    database: 'postgres',
  });

  try {
    await client.connect();
    
    // 1. Verificar se a base de dados 'inp' já existe no catálogo do PostgreSQL
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname='inp'");
    if (res.rows.length === 0) {
      console.log("A base de dados 'inp' não existe. A criar...");
      await client.query("CREATE DATABASE inp");
      console.log("Base de dados 'inp' criada com sucesso.");
    } else {
      console.log("A base de dados 'inp' já se encontra registada.");
    }

    // 2. Verificar e aprovisionar a role/utilizador 'inp'
    const userRes = await client.query("SELECT 1 FROM pg_roles WHERE rolname='inp'");
    if (userRes.rows.length === 0) {
      console.log("O utilizador 'inp' não existe. A criar...");
      await client.query("CREATE USER inp WITH PASSWORD 'inp123'");
      await client.query("ALTER USER inp WITH SUPERUSER"); // Concede privilégios administrativos necessários
      console.log("Utilizador 'inp' criado com sucesso com a credencial predefinida.");
    } else {
      console.log("O utilizador 'inp' já existe. A atualizar privilégios...");
      await client.query("ALTER USER inp WITH PASSWORD 'inp123'");
      await client.query("ALTER USER inp WITH SUPERUSER");
      console.log("Utilizador 'inp' atualizado.");
    }

    await client.end();
  } catch (err) {
    console.error("Erro no aprovisionamento da base de dados/utilizador:", err);
    process.exit(1);
  }
}

// Disparo da inicialização de infraestrutura
run();
