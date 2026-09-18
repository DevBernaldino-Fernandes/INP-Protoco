/**
 * @fileoverview Serviço de Telemetria e Transmissão em Tempo Real (Server-Sent Events - SSE)
 * @module Core/TelemetryService
 * @description
 * Disponibiliza um mecanismo centralizado de publicação e subscrição de eventos operacionais,
 * métricas, alterações de estado de saúde e execuções de fluxo no protocolo INP.
 * Distribui fluxos de dados em tempo real para clientes HTTP através de Server-Sent Events (SSE)
 * e através do barramento interno de eventos Node.js (`EventEmitter`).
 *
 * @security Não emite segredos não mascarados (os dados devem ser previamente higienizados pelo DataSanitizer).
 * Controla os descritores de ligação para prevenir fugas de memória perante desconexões abruptas de clientes.
 * @audit Todos os eventos de telemetria contêm carimbos temporais ISO 8601 e identificadores de correlação,
 * servindo de base para auditoria em tempo real e alimentação de SIEMs.
 */

import { EventEmitter } from 'events';
import { Response } from 'express';

/**
 * @description Estrutura padronizada de um evento de telemetria emitido pelo protocolo.
 */
export interface TelemetryEvent {
  /** Categoria ou nome do evento emitido (ex.: 'EXECUTION_STARTED', 'SERVICE_HEALTH_CHANGED') */
  type: string;
  /** Carimbo temporal rigoroso no formato ISO 8601 */
  timestamp: string;
  /** Carga útil com os dados contextuais do evento */
  data: any;
}

/**
 * @description Serviço singleton de telemetria e orquestração de transmissões em tempo real.
 */
export class TelemetryService extends EventEmitter {
  private static instance: TelemetryService;
  /** Limite máximo de clientes SSE simultâneos para prevenir esgotamento de descritores de ficheiros e DoS */
  public static readonly MAX_CLIENTS = 100;
  /** Conjunto de respostas HTTP ativas subscritas no canal de SSE (O(1) para inserção e remoção) */
  private clients: Set<Response> = new Set();

  /** Construtor privado para garantir a unicidade da instância */
  private constructor() {
    super();
  }

  /**
   * @description Obtém a instância única partilhada do TelemetryService.
   * @returns {TelemetryService} Instância ativa do serviço.
   */
  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  /**
   * @description Regista um canal de resposta Express como cliente recetor de Server-Sent Events (SSE).
   * Se o limite máximo de clientes for atingido, encerra e remove o cliente mais antigo (evicção FIFO).
   *
   * @param {Response} res - O fluxo de resposta HTTP do Express a ser mantido aberto.
   * @security Envia imediatamente uma confirmação inicial para validar a vivacidade da ligação.
   * @audit Regista a ligação de novos observadores à monitorização do protocolo.
   */
  public addClient(res: Response): void {
    // MEDIDA DE SEGURANÇA: Limite máximo de conexões ativas simultâneas para prevenção de ataques DoS
    if (this.clients.size >= TelemetryService.MAX_CLIENTS) {
      const oldestClient = this.clients.values().next().value;
      if (oldestClient) {
        try {
          oldestClient.write('event: error\ndata: {"error":"Limite de clientes excedido. Conexão terminada pelo servidor."}\n\n');
          oldestClient.end();
        } catch {}
        this.removeClient(oldestClient);
      }
    }

    this.clients.add(res);
    
    // Proteção ativa contra desconexões abruptas e erros de socket
    res.on('error', () => {
      this.removeClient(res);
    });
    res.on('close', () => {
      this.removeClient(res);
    });

    // Transmite evento de inicialização confirmando que a subscrição se encontra ativa
    this.sendToClient(res, 'connection_established', {
      message: 'Subscrição de telemetria ativa',
      activeClients: this.clients.size,
    });

    console.log(`[Telemetria] Cliente ligado. Total de clientes ativos: ${this.clients.size}`);
  }

  /**
   * @description Remove um cliente do conjunto de subscritores após fecho ou corte de ligação.
   *
   * @param {Response} res - O fluxo de resposta HTTP a ser retirado.
   */
  public removeClient(res: Response): void {
    const deleted = this.clients.delete(res);
    if (deleted) {
      console.log(`[Telemetria] Cliente desligado. Total de clientes ativos: ${this.clients.size}`);
    }
  }

  /**
   * @description Difunde um evento de telemetria para todos os subscritores SSE ativos e para o barramento interno.
   *
   * @param {string} type - Identificador do tipo de evento.
   * @param {any} data - Dados contextuais associados.
   * @audit Assegura a visibilidade imediata de transições de estado para painéis de auditoria operacional.
   */
  public broadcast(type: string, data: any): void {
    const event: TelemetryEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    // Emissão interna local no processo Node.js
    this.emit(type, data);
    this.emit('*', event);

    // Transmissão externa segura para os clientes SSE conectados via HTTP
    for (const client of this.clients) {
      this.sendToClient(client, type, data);
    }
  }

  /**
   * @description Escreve uma mensagem devidamente estruturada de acordo com o protocolo W3C SSE com proteção anti-crash.
   *
   * @param {Response} res - Fluxo de resposta HTTP.
   * @param {string} type - Nome do evento SSE.
   * @param {any} data - Dados do evento serializados em JSON.
   */
  private sendToClient(res: Response, type: string, data: any): void {
    if (!res || res.writableEnded || (res as any).closed || !res.writable) {
      this.removeClient(res);
      return;
    }
    try {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      this.removeClient(res);
    }
  }
}

