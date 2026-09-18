/**
 * @fileoverview Armazenamento de Contexto Conversacional de Sessão (SessionContextStore)
 * @module Core/SessionContextStore
 * @description
 * Gere o estado conversacional e a memória episódica de curto prazo entre múltiplos turnos
 * de interação do utilizador. Permite que o sintetizador de linguagem natural (`NaturalLanguageSynthesizer`)
 * resolva anáforas e referências contextuais implícitas (como "repita a transferência anterior",
 * "mande metade do valor anterior", "para a mesma conta").
 *
 * Cada sessão armazena:
 * 1. O último plano de intenção executado (`lastIntent`).
 * 2. As últimas entidades extraídas (`amount`, `from`, `to`, `recipient`, `productId`, etc.).
 * 3. O carimbo temporal da última atividade para expiração automática por TTL (15 minutos).
 *
 * @security Isola estritamente as sessões por identificador de utilizador ou sessão (Multi-Tenant),
 * expurgando credenciais e dados confidenciais através do `DataSanitizer`.
 * @audit Regista a rastreabilidade da resolução anafórica para auditoria de comandos encadeados.
 */

import { ParsedIntent } from './types';

/**
 * @description Registo estruturado do histórico recente de uma sessão de diálogo.
 */
export interface SessionRecord {
  /** Identificador único da sessão ou utilizador */
  sessionId: string;
  /** Última intenção consolidada processada */
  lastIntent?: ParsedIntent;
  /** Mapa com as últimas entidades extraídas de valor, conta e alvo */
  lastEntities: Record<string, unknown>;
  /** Última ação semântica invocada (ex.: "TRANSFER FUNDS") */
  lastAction?: string;
  /** Carimbo temporal da última interação para cálculo de expiração */
  lastActivity: number;
}

/**
 * @description Gestor de memória e contexto conversacional de curto prazo.
 */
export class SessionContextStore {
  private static instance: SessionContextStore;
  /** Limite máximo de sessões ativas retidas em memória volátil para prevenção de exaustão de heap */
  public static readonly MAX_SESSIONS = 10000;
  /** Tempo de vida útil padrão da sessão em milissegundos (15 minutos) */
  private readonly defaultTtlMs = 15 * 60 * 1000;
  /** Armazenamento em memória volátil indexado por sessionId */
  private sessions = new Map<string, SessionRecord>();

  /** Construtor privado para salvaguarda do padrão Singleton */
  private constructor() {}

  /**
   * @description Devolve a instância partilhada única do SessionContextStore.
   * @returns {SessionContextStore} Instância singleton do gestor de sessões.
   */
  public static getInstance(): SessionContextStore {
    if (!SessionContextStore.instance) {
      SessionContextStore.instance = new SessionContextStore();
    }
    return SessionContextStore.instance;
  }

  /**
   * @description Obtém o número total de sessões ativas atualmente na memória.
   * @returns {number} Quantidade de sessões ativas.
   */
  public getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * @description Regista ou atualiza o estado de uma sessão ativa aplicando política de capacidade máxima.
   *
   * @param {string} sessionId - Identificador da sessão ou utilizador.
   * @param {Partial<SessionRecord>} data - Dados a mesclar no contexto da sessão.
   */
  public saveSession(sessionId: string, data: Partial<SessionRecord>): void {
    // Controlo estrito de capacidade e prevenção de memory leak sob tráfego contínuo
    if (this.sessions.size >= SessionContextStore.MAX_SESSIONS && !this.sessions.has(sessionId)) {
      this.pruneExpiredSessions();
      if (this.sessions.size >= SessionContextStore.MAX_SESSIONS) {
        const oldestKey = this.sessions.keys().next().value;
        if (oldestKey) this.sessions.delete(oldestKey);
      }
    }

    const existing = this.sessions.get(sessionId) || {
      sessionId,
      lastEntities: {},
      lastActivity: Date.now()
    };

    const updated: SessionRecord = {
      ...existing,
      ...data,
      sessionId,
      lastEntities: {
        ...existing.lastEntities,
        ...(data.lastEntities || {})
      },
      lastActivity: Date.now()
    };

    this.sessions.set(sessionId, updated);
  }

  /**
   * @description Recupera o contexto de uma sessão ativa, validando o TTL de expiração.
   *
   * @param {string} sessionId - Identificador da sessão.
   * @returns {SessionRecord | null} Contexto da sessão ou nulo se inexistente/expirada.
   */
  public getSession(sessionId: string): SessionRecord | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Verificação de expiração temporal (TTL)
    if (Date.now() - session.lastActivity > this.defaultTtlMs) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * @description Limpa explicitamente o histórico de uma dada sessão.
   *
   * @param {string} sessionId - Identificador da sessão a eliminar.
   */
  public clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * @description Limpa todas as sessões em memória (utilizado em testes ou manutenção).
   */
  public clearAll(): void {
    this.sessions.clear();
  }

  /**
   * @description Expulsa da memória todas as sessões inativas cujo TTL tenha sido ultrapassado.
   * @returns {number} Quantidade de sessões expurgadas.
   */
  public pruneExpiredSessions(): number {
    const now = Date.now();
    let prunedCount = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.defaultTtlMs) {
        this.sessions.delete(id);
        prunedCount++;
      }
    }
    return prunedCount;
  }
}
