/**
 * @fileoverview Ponto de Entrada Principal da Aplicação (INP Gateway Bootstrap)
 * @module AppBootstrap
 * @description
 * Ficheiro de arranque primordial do gateway do Intent Network Protocol (INP).
 * Inicializa a biblioteca `reflect-metadata` exigida pelos decoradores do TypeORM,
 * carrega e valida as variáveis de ambiente a partir do ficheiro de configuração `.env`
 * e despoleta o arranque do servidor HTTP da API Express (`src/api/server.ts`).
 *
 * @security Garante que todas as configurações de ambiente são injetadas antes da inicialização
 * de módulos criptográficos, da base de dados ou das portas de rede.
 * @audit Marca o início do ciclo de vida da instância do nó e define o contexto operacional global.
 */

import 'reflect-metadata';
import dotenv from 'dotenv';

// Carregamento inicial das variáveis de ambiente
dotenv.config();

// Tratamento defensivo contra exceções não capturadas para garantir alta disponibilidade
process.on('uncaughtException', (err: any) => {
  console.error('[Proteção do Processo] Exceção não capturada contida:', err.message || err);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[Proteção do Processo] Promessa rejeitada contida:', reason?.message || reason);
});

// Inicialização do servidor HTTP e rotas da API REST
import './api/server';