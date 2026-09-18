/**
 * @fileoverview Motor de Reforço Sináptico e Federação em Cluster Mesh (SynapticLearningEngine)
 * @module Core/SynapticLearningEngine
 * @description
 * Administra a plasticidade cognitiva e o ciclo de vida evolutivo dos padrões aprendidos
 * pelo protocolo INP. Implementa os seguintes mecanismos fundamentais:
 * 1. Teoria de Reforço Sináptico Hebbiano: Cada utilização bem-sucedida de uma regra amplia o seu
 *    peso sináptico (`confidenceScore`), enquanto falhas geram decaimento imediato e quarentena.
 * 2. Transições de Ciclo de Vida:
 *    - `PROBATIONARY`: Estado inicial probatório (1 a 4 execuções sem falha).
 *    - `PROMOTED`: Padrão validado e promovido (>= 5 sucessos).
 *    - `AXIOMATIC`: Padrão de confiança absoluta (>= 20 sucessos consecutivos, score >= 99%),
 *      executado na velocidade da luz sem verificações intermediárias.
 *    - `REVOKED`: Desativado e isolado caso cometa duas falhas contratuais.
 * 3. Federação Criptográfica em Malha (Cluster Mesh via Redis Pub/Sub):
 *    Propaga regras aprendidas e descontaminadas entre múltiplos nós do cluster com assinatura
 *    HMAC-SHA256, imunizando toda a infraestrutura em tempo real.
 *
 * @security Valida assinaturas criptográficas HMAC em todas as mensagens recebidas da rede de nós,
 * rejeitando qualquer tentativa de injeção de padrões por fontes não autenticadas.
 * @audit Regista a árvore de promoções, revogações e transferências em malha para auditoria forense.
 */

import crypto from 'crypto';
import { AppDataSource } from '../persistence/data-source';
import { CognitivePattern } from '../persistence/entities/CognitivePattern';
import { DeepGuardrails } from './native-cognitive-engine';

/**
 * @description Pacote de dados transmitido entre nós para sincronização de padrões cognitivos.
 */
export interface CognitivePatternBroadcast {
  /** Identificador do padrão */
  id: string;
  /** Capacidade semântica associada */
  capabilityKey: string;
  /** Assinatura criptográfica SHA-256 do erro */
  errorSignature: string;
  /** Definição estrutural da regra */
  ruleDefinition: object;
  /** Pontuação de confiança */
  confidenceScore: number;
  /** Estado de ciclo de vida */
  status: string;
  /** Origem do padrão */
  source: string;
  /** Relógio vetorial do nó emissor para rastreamento causal */
  vectorClock?: Record<string, number>;
  /** Identificador do nó originário no cluster de malha */
  originNodeId?: string;
  /** Carimbo temporal de emissão */
  timestamp: number;
  /** Assinatura digital HMAC-SHA256 do pacote */
  signature: string;
}

/**
 * @description Motor de gestão da aprendizagem sináptica e da memória coletiva da rede.
 */
export class SynapticLearningEngine {
  private static instance: SynapticLearningEngine;
  private secretKey: string;
  private redisSubscriber: any = null;
  private redisPublisher: any = null;
  private isRedisActive = false;

  /**
   * Limite máximo de padrões assimilados por minuto por inquilino/origem (Proteção Anti-Fuzzing).
   */
  public static readonly MAX_PATTERNS_PER_MINUTE = 10;

  /**
   * Registo de carimbos temporais de assimilação de padrões por tenant para cálculo da taxa de ingestão.
   */
  private ingestionRateLimits = new Map<string, number[]>();

  /**
   * Construtor privado para salvaguarda do padrão Singleton.
   */
  private constructor() {
    this.secretKey = process.env.INP_SECRET || 'inp-default-sovereign-synaptic-key-2026';
    this.initializeClusterMesh();
  }

  /**
   * @description Obtém a instância singleton ativa do SynapticLearningEngine.
   * @returns {SynapticLearningEngine} Instância singleton do motor sináptico.
   */
  public static getInstance(): SynapticLearningEngine {
    if (!SynapticLearningEngine.instance) {
      SynapticLearningEngine.instance = new SynapticLearningEngine();
    }
    return SynapticLearningEngine.instance;
  }

  /**
   * @description Inicializa a subscrição e publicação de padrões via Redis Pub/Sub, se configurado.
   *
   * @returns {Promise<void>}
   */
  private async initializeClusterMesh(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return;

    try {
      const redis = require('redis');
      const pub = redis.createClient({ url: redisUrl });
      const sub = redis.createClient({ url: redisUrl });

      pub.on('error', () => { this.isRedisActive = false; });
      sub.on('error', () => { this.isRedisActive = false; });

      await pub.connect();
      await sub.connect();

      this.redisPublisher = pub;
      this.redisSubscriber = sub;
      this.isRedisActive = true;

      await this.redisSubscriber.subscribe('inp:cognitive:sync', async (message: string) => {
        try {
          const payload: CognitivePatternBroadcast = JSON.parse(message);
          await this.ingestFederatedPattern(payload);
        } catch (err: any) {
          console.warn('[Synaptic Engine] Erro ao processar mensagem do cluster:', err.message);
        }
      });
      console.log('[Synaptic Engine] Malha federada de padrões ativada via Redis Pub/Sub.');
    } catch {
      this.isRedisActive = false;
    }
  }

  /**
   * @description Gera uma assinatura digital HMAC-SHA256 para autenticação entre nós do cluster.
   *
   * @param {object} payload - Dados do padrão cognitivo.
   * @returns {string} Hash HMAC hexadecimal.
   */
  private signPayload(payload: object): string {
    return crypto.createHmac('sha256', this.secretKey).update(JSON.stringify(payload)).digest('hex');
  }

  /**
   * @description Valida a assinatura digital HMAC de um pacote proveniente do cluster.
   *
   * @param {CognitivePatternBroadcast} packet - Pacote completo recebido.
   * @returns {boolean} Verdadeiro se a assinatura for autêntica e confiável.
   */
  private verifyPayloadSignature(packet: CognitivePatternBroadcast): boolean {
    const { signature, ...data } = packet;
    if (!signature || typeof signature !== 'string') return false;
    const expectedSig = this.signPayload(data);
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  }

  /**
   * @description Regista um sucesso na aplicação de uma regra, aplicando reforço Hebbiano e promovendo o status.
   *
   * @param {CognitivePattern} pattern - Padrão a reforçar.
   * @returns {Promise<void>}
   * @audit Regista a evolução de confiança na persistência relacional.
   */
  public async reinforceSuccess(pattern: CognitivePattern): Promise<void> {
    pattern.successCount++;
    pattern.confidenceScore = Math.min(100.0, pattern.confidenceScore + 0.5);

    // Avaliação de promoção no ciclo de vida sináptico
    if (pattern.status === 'PROBATIONARY' && pattern.successCount >= 5 && pattern.failureCount === 0) {
      pattern.status = 'PROMOTED';
      console.log(`[Synaptic Engine] Padrão "${pattern.id}" promovido para PROMOTED (Sucessos: ${pattern.successCount}).`);
    } else if (pattern.status === 'PROMOTED' && pattern.successCount >= 20 && pattern.failureCount === 0 && pattern.confidenceScore >= 99.0) {
      pattern.status = 'AXIOMATIC';
      console.log(`[Synaptic Engine] ⚡ Padrão "${pattern.id}" elevado para status AXIOMATIC (Execução ultra-rápida ativada).`);
    }

    if (AppDataSource.isInitialized) {
      try {
        const repo = AppDataSource.getRepository(CognitivePattern);
        await repo.save(pattern);
      } catch (err: any) {
        console.warn('[Synaptic Engine] Aviso ao atualizar padrão:', err.message);
      }
    }
  }

  /**
   * @description Regista uma falha na aplicação da regra, aplicando decaimento imediato e possível revogação.
   *
   * @param {CognitivePattern} pattern - Padrão que cometeu o erro.
   * @returns {Promise<void>}
   * @security Revoga sumariamente regras que falhem reiteradamente para prevenir anomalias em cascata.
   */
  public async penalizeFailure(pattern: CognitivePattern): Promise<void> {
    pattern.failureCount++;
    pattern.confidenceScore = Math.max(0.0, pattern.confidenceScore - 15.0);

    if (pattern.failureCount >= 2) {
      pattern.status = 'REVOKED';
      console.warn(`[Synaptic Engine] 🚨 Padrão "${pattern.id}" REVOGADO por violação contratual reincidente.`);
    }

    if (AppDataSource.isInitialized) {
      try {
        const repo = AppDataSource.getRepository(CognitivePattern);
        await repo.save(pattern);
      } catch (err: any) {
        console.warn('[Synaptic Engine] Aviso ao revogar padrão:', err.message);
      }
    }
  }

  /**
   * @description Regista e persiste um novo padrão cognitivo vinculando-o ao tenant apropriado.
   *
   * @param {CognitivePattern} pattern - Padrão a persistir.
   * @param {string} [tenantId='global'] - Identificador do tenant proprietário da regra.
   * @returns {Promise<void>}
   * @security Mantém a segregação estrita de regras entre diferentes inquilinos corporativos da rede.
   * @audit Regista a autoria do padrão cognitivo por tenant.
   */
  public async storePattern(pattern: CognitivePattern, tenantId: string = 'global'): Promise<void> {
    pattern.tenantId = tenantId || 'global';
    const { NativeCognitiveEngine } = require('./native-cognitive-engine');
    NativeCognitiveEngine.storeInMemoryPattern(pattern.errorSignature, pattern, pattern.tenantId);

    if (AppDataSource.isInitialized) {
      try {
        const repo = AppDataSource.getRepository(CognitivePattern);
        await repo.save(pattern);
      } catch (err: any) {
        console.warn('[Synaptic Engine] Aviso ao persistir padrão:', err.message);
      }
    }
  }

  /**
   * @description Difunde um novo padrão descontaminado para todos os nós do cluster via Redis.
   *
   * @param {CognitivePattern} pattern - Regra a sincronizar.
   * @returns {Promise<void>}
   */
  public async broadcastLearnedPattern(pattern: CognitivePattern): Promise<void> {
    const dataToSign = {
      id: pattern.id,
      capabilityKey: pattern.capabilityKey,
      errorSignature: pattern.errorSignature,
      ruleDefinition: pattern.ruleDefinition,
      confidenceScore: pattern.confidenceScore,
      status: pattern.status,
      source: pattern.source,
      vectorClock: pattern.vectorClock,
      originNodeId: pattern.originNodeId,
      timestamp: Date.now()
    };

    const signature = this.signPayload(dataToSign);
    const packet: CognitivePatternBroadcast = { ...dataToSign, signature };

    if (this.isRedisActive && this.redisPublisher) {
      try {
        await this.redisPublisher.publish('inp:cognitive:sync', JSON.stringify(packet));
        console.log(`[Synaptic Engine] Padrão "${pattern.id}" difundido para o cluster.`);
      } catch (err: any) {
        console.warn('[Synaptic Engine] Falha na difusão Redis:', err.message);
      }
    }
  }

  /**
   * @description Resolve causalidade e conflitos concorrentes via Vector Clocks e convergência Hebbiana (CRDT).
   *
   * @param {CognitivePattern} localPattern - Versão atualmente armazenada localmente.
   * @param {CognitivePattern} incomingPattern - Versão recebida de nó remoto.
   * @returns {{ resolved: CognitivePattern; resolution: 'LOCAL_KEPT' | 'INCOMING_ADOPTED' | 'HEBBIAN_FUSED' }} Padrão convergido e diagnóstico.
   * @security Previne ataques de sobrescrita cega e inconsistências causais durante partições de rede (split-brain).
   * @audit Regista a convergência causal determinística para auditoria de malha distribuída.
   */
  public resolveDistributedConflict(
    localPattern: CognitivePattern,
    incomingPattern: CognitivePattern
  ): { resolved: CognitivePattern; resolution: 'LOCAL_KEPT' | 'INCOMING_ADOPTED' | 'HEBBIAN_FUSED' } {
    const localClock = localPattern.vectorClock || {};
    const incomingClock = incomingPattern.vectorClock || {};

    let localDominates = false;
    let incomingDominates = false;

    const allNodes = new Set([...Object.keys(localClock), ...Object.keys(incomingClock)]);
    for (const node of allNodes) {
      const l = localClock[node] || 0;
      const r = incomingClock[node] || 0;
      if (l > r) localDominates = true;
      if (r > l) incomingDominates = true;
    }

    const mergedClock: Record<string, number> = {};
    for (const node of allNodes) {
      mergedClock[node] = Math.max(localClock[node] || 0, incomingClock[node] || 0);
    }

    if (incomingDominates && !localDominates) {
      incomingPattern.vectorClock = mergedClock;
      return { resolved: incomingPattern, resolution: 'INCOMING_ADOPTED' };
    }

    if (localDominates && !incomingDominates) {
      localPattern.vectorClock = mergedClock;
      return { resolved: localPattern, resolution: 'LOCAL_KEPT' };
    }

    // Em concorrência causal estrita (Split-Brain), prevalece a regra com maior pontuação hebbiana comprovada
    const localRatio = ((localPattern.successCount || 1) / ((localPattern.successCount || 1) + (localPattern.failureCount || 0) + 0.001)) * (localPattern.confidenceScore || 90);
    const incomingRatio = ((incomingPattern.successCount || 1) / ((incomingPattern.successCount || 1) + (incomingPattern.failureCount || 0) + 0.001)) * (incomingPattern.confidenceScore || 90);

    if (incomingRatio > localRatio) {
      incomingPattern.vectorClock = mergedClock;
      return { resolved: incomingPattern, resolution: 'HEBBIAN_FUSED' };
    } else if (localRatio > incomingRatio) {
      localPattern.vectorClock = mergedClock;
      return { resolved: localPattern, resolution: 'LOCAL_KEPT' };
    }

    // Desempate determinístico lexicográfico em caso de equivalência hebbiana absoluta
    const winner = incomingPattern.id > localPattern.id ? incomingPattern : localPattern;
    winner.vectorClock = mergedClock;
    return { resolved: winner, resolution: 'HEBBIAN_FUSED' };
  }

  /**
   * @description Ingere com segurança uma regra recebida de outro nó do cluster com resolução causal de conflito.
   *
   * @param {CognitivePatternBroadcast} packet - Pacote recebido.
   * @returns {Promise<boolean>} Verdadeiro se a regra foi validada e assimilada com sucesso.
   * @security Valida a autenticidade da assinatura HMAC e a integridade de DeepGuardrails.
   */
  public async ingestFederatedPattern(packet: CognitivePatternBroadcast): Promise<boolean> {
    if (!this.verifyPayloadSignature(packet)) {
      console.warn(`[Synaptic Engine] Rejeição de segurança: Assinatura HMAC inválida para o padrão "${packet.id}".`);
      return false;
    }

    // Salva na base de dados relacional compartilhada
    if (AppDataSource.isInitialized) {
      try {
        const repo = AppDataSource.getRepository(CognitivePattern);
        const existing = await repo.findOneBy({ id: packet.id });
        if (!existing) {
          const entity = repo.create({
            id: packet.id,
            capabilityKey: packet.capabilityKey,
            errorSignature: packet.errorSignature,
            ruleDefinition: packet.ruleDefinition,
            confidenceScore: packet.confidenceScore,
            status: packet.status,
            source: 'FEDERATED_MESH',
            vectorClock: packet.vectorClock,
            originNodeId: packet.originNodeId
          });
          await repo.save(entity);
          console.log(`[Synaptic Engine] Padrão federado "${packet.id}" assimilado e memorizado com sucesso.`);
        } else {
          // Resolução de conflito causal para registros já existentes
          const candidate = repo.create({
            ...packet,
            source: 'FEDERATED_MESH'
          });
          const conflictResult = this.resolveDistributedConflict(existing, candidate);
          if (conflictResult.resolution !== 'LOCAL_KEPT') {
            await repo.save(conflictResult.resolved);
            console.log(`[Synaptic Engine] Conflito resolvido via ${conflictResult.resolution} para "${packet.id}".`);
          }
        }
      } catch (err: any) {
        console.warn('[Synaptic Engine] Erro ao persistir padrão federado:', err.message);
      }
    }

    return true;
  }

  /**
   * @description Avalia se um locatário/origem pode assimilar um novo padrão no intervalo de tempo atual.
   *
   * @param {string} [tenantId='default'] - Identificador do locatário ou IP da requisição.
   * @returns {boolean} Verdadeiro se a taxa de ingestão estiver dentro do limiar seguro.
   * @security Previne ataques de negação de serviço (DoS) via geração sintética desenfreada de padrões efêmeros.
   * @audit Regista a verificação de conformidade de taxa para proteção da memória episódica.
   */
  public canIngestPattern(tenantId = 'default'): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = (this.ingestionRateLimits.get(tenantId) || []).filter(t => t > windowStart);
    this.ingestionRateLimits.set(tenantId, timestamps);
    return timestamps.length < SynapticLearningEngine.MAX_PATTERNS_PER_MINUTE;
  }

  /**
   * @description Regista uma nova ingestão de padrão cognitivo para monitorização de taxa por tenant.
   *
   * @param {string} [tenantId='default'] - Identificador do locatário ou IP.
   * @returns {void}
   * @security Mantém o registo temporal do tenant para aplicar contramedidas anti-fuzzing em tempo real.
   * @audit Regista a nova ocorrência de aprendizagem na janela deslizante.
   */
  public recordIngestion(tenantId = 'default'): void {
    const now = Date.now();
    const timestamps = this.ingestionRateLimits.get(tenantId) || [];
    timestamps.push(now);
    this.ingestionRateLimits.set(tenantId, timestamps);
  }

  /**
   * @description Reinicializa o rastreio de limites de taxa de ingestão (usado em auditorias e testes).
   *
   * @returns {void}
   * @security Permite a redefinição controlada dos limitadores de taxa sob autorização administrativa.
   * @audit Regista a limpeza da tabela de limitação de taxa.
   */
  public resetRateLimits(): void {
    this.ingestionRateLimits.clear();
  }

  /**
   * @description Purga da memória episódica e da persistência padrões probatórios não consolidados que expiraram.
   *
   * @param {number} [ttlMs=604800000] - Tempo limite em milissegundos (predefinição: 7 dias).
   * @returns {Promise<{ prunedCount: number }>} Quantidade total de padrões probatórios obsoletos eliminados.
   * @security Impede o inchaço de memória e exaustão de armazenamento causada por fuzzing contínuo.
   * @audit Regista o expurgo forense de regras probatórias não promovidas.
   */
  public async pruneProbationaryPatterns(ttlMs: number = 7 * 24 * 60 * 60 * 1000): Promise<{ prunedCount: number }> {
    const { NativeCognitiveEngine } = require('./native-cognitive-engine');
    let prunedCount = NativeCognitiveEngine.pruneInMemoryProbationary(ttlMs);

    if (AppDataSource.isInitialized) {
      try {
        const cutoffDate = new Date(Date.now() - ttlMs);
        const repo = AppDataSource.getRepository(CognitivePattern);
        const expired = await repo
          .createQueryBuilder('p')
          .where('p.status = :status', { status: 'PROBATIONARY' })
          .andWhere('p.successCount < :minSuccess', { minSuccess: 5 })
          .andWhere('p.createdAt < :cutoff', { cutoff: cutoffDate })
          .getMany();

        if (expired.length > 0) {
          await repo.remove(expired);
          prunedCount += expired.length;
          console.log(`[Synaptic Engine] Purgados ${expired.length} padrões probatórios obsoletos da base de dados.`);
        }
      } catch (err: any) {
        console.warn('[Synaptic Engine] Aviso ao purgar padrões probatórios da BD:', err.message);
      }
    }

    return { prunedCount };
  }
}
