/**
 * @fileoverview Cliente SDK TypeScript para Consumo do Protocolo INP (INPClient)
 * @module Examples/EcommerceEcosystem/Client/INPClient
 * @description
 * Biblioteca cliente que encapsula a comunicação HTTP com o Gateway do protocolo INP.
 * Permite a envio de intenções declarativas (DSL) ou em linguagem natural, registo de capacidades,
 * consulta de catálogos de serviços, obtenção de estatísticas operacionais e sondagem (polling)
 * do estado de tarefas assíncronas até ao seu desfecho ('COMPLETED' ou 'FAILED').
 *
 * @security Propaga identificadores de correlação e credenciais de autorização (`X-Registration-Token`)
 * de forma controlada nos pedidos HTTP.
 * @audit Facilita a integração de sistemas externos mantendo os requisitos de rastreabilidade do protocolo.
 */

import axios, { AxiosInstance } from 'axios';

/**
 * @description Opções de configuração para inicialização da instância do cliente INP.
 */
export interface INPClientOptions {
  /** URL base do Gateway INP (por omissão: http://localhost:3000) */
  gatewayUrl?: string;
  /** Chave secreta de registo para autenticação no gateway */
  registrationToken?: string;
  /** Limite de tempo em milissegundos para as chamadas HTTP (por omissão: 30000ms) */
  timeoutMs?: number;
}

/**
 * @description Estrutura de contexto de segurança enviada pelo consumidor nos pedidos.
 */
export interface SecurityContext {
  /** Identificador do utilizador final ou aplicação cliente */
  userId?: string;
  /** Lista de permissões associadas (RBAC) */
  permissions?: string[];
  /** Papéis atribuídos ao consumidor */
  roles?: string[];
  /** Identificador de correlação para rastreio distribuído ponta-a-ponta */
  correlationId?: string;
}

/**
 * @description Cliente TypeScript para integração de aplicações e microserviços com o INP Protocol.
 */
export class INPClient {
  private http: AxiosInstance;
  private gatewayUrl: string;
  private registrationToken: string;

  /**
   * @param {INPClientOptions} [options={}] - Configuração do cliente (URL do gateway, token e timeout).
   */
  constructor(options: INPClientOptions = {}) {
    this.gatewayUrl = options.gatewayUrl || 'http://localhost:3000';
    this.registrationToken = options.registrationToken || 'inp-super-secret-registration-token-2026';
    this.http = axios.create({
      baseURL: this.gatewayUrl,
      timeout: options.timeoutMs || 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * @description Submete uma intenção de alto nível ao Gateway INP (em formato DSL ou Linguagem Natural).
   *
   * @param {string} text - Texto declarativo da intenção.
   * @param {'dsl' | 'natural'} [type='dsl'] - Tipo de sintaxe utilizada na submissão.
   * @param {SecurityContext} [securityContext] - Contexto de segurança e autorização opcional.
   * @param {boolean} [isAsync=false] - Se for verdadeiro, processa de forma desacoplada através da fila de trabalhos.
   * @returns {Promise<any>} Resposta devolvida pelo gateway (resultado síncrono ou ID da tarefa assíncrona).
   * @audit Envia o contexto de segurança e correlação exigido pelas políticas de auditoria.
   */
  async executeIntent(
    text: string,
    type: 'dsl' | 'natural' = 'dsl',
    securityContext?: SecurityContext,
    isAsync = false
  ) {
    const response = await this.http.post('/api/intent', {
      text,
      type,
      securityContext,
      async: isAsync
    });
    return response.data;
  }

  /**
   * @description Regista uma nova capacidade ou microserviço no catálogo central do INP.
   *
   * @param {any} serviceConfig - Configuração descritiva do serviço e das suas capacidades.
   * @returns {Promise<any>} Confirmação de registo devolvida pelo gateway.
   * @security Injeta o cabeçalho `X-Registration-Token` para autenticar a operação.
   */
  async registerService(serviceConfig: any) {
    const response = await this.http.post('/services/register', serviceConfig, {
      headers: {
        'X-Registration-Token': this.registrationToken
      }
    });
    return response.data;
  }

  /**
   * @description Consulta a lista de microserviços registados e atualmente ativos no protocolo.
   *
   * @returns {Promise<any>} Lista de serviços ativos.
   */
  async listActiveServices() {
    const response = await this.http.get('/services');
    return response.data;
  }

  /**
   * @description Obtém estatísticas consolidadas de desempenho e operações do gateway.
   *
   * @returns {Promise<any>} Estatísticas operacionais (serviços ativos, execuções concluídas, etc.).
   */
  async getDashboardStats() {
    const response = await this.http.get('/api/dashboard/stats');
    return response.data;
  }

  /**
   * @description Consulta os registos de execuções recentes guardados na base de dados de auditoria.
   *
   * @returns {Promise<any>} Lista das últimas execuções com dados confidenciais mascarados.
   */
  async getRecentExecutions() {
    const response = await this.http.get('/api/dashboard/executions');
    return response.data;
  }

  /**
   * @description Efetua a sondagem periódica (polling) das execuções até que a tarefa atinja o estado COMPLETED ou FAILED.
   *
   * @param {string} executionId - Identificador único da execução assíncrona.
   * @param {number} [maxWaitMs=15000] - Tempo máximo de tolerância em milissegundos antes de disparar timeout.
   * @param {number} [pollIntervalMs=800] - Intervalo entre cada verificação de estado.
   * @returns {Promise<any>} Registo da execução finalizada.
   * @throws {Error} Se o tempo limite de espera for ultrapassado sem conclusão da tarefa.
   */
  async pollExecutionStatus(executionId: string, maxWaitMs = 15000, pollIntervalMs = 800) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const data = await this.getRecentExecutions();
      const match = (data.executions || []).find((e: any) => e.id === executionId);
      if (match) {
        if (match.status === 'COMPLETED' || match.status === 'FAILED') {
          return match;
        }
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`Tempo limite excedido ao aguardar pela conclusão da execução ${executionId}`);
  }
}
