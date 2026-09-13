/**
 * @fileoverview Camada de Cache Distribuída do Catálogo de Capacidades (Redis & Memória)
 * @module Core/RegistryCache
 * @description
 * Fornece uma camada de aceleração de leitura para o registo de serviços e correspondência
 * de capacidades, minimizando acessos à base de dados PostgreSQL. Suporta armazenamento local
 * em memória com fallback automático e integração com Redis Distribuído quando `REDIS_URL`
 * se encontra configurado. Implementa o padrão Pub/Sub do Redis para invalidação instantânea
 * de cache sincronizada entre todos os nós do cluster quando novos serviços são registados.
 *
 * @security Previne saturação de conexões à base de dados perante picos de tráfego intenso (DDoS/Spikes).
 * @audit Assegura a consistência eventual e a correta invalidação de entradas para que serviços
 * revogados ou desativados deixem de ser invocados imediatamente.
 */

import { ServiceMatch } from './types';
import { ServiceRegistration } from '../persistence/entities/ServiceRegistration';

/**
 * @description Gestor do ciclo de vida, expiração e sincronização de dados em cache.
 */
class RegistryCacheManager {
  /** Tempo de vida padrão das entradas em milissegundos (30 segundos) */
  private ttl = 30000;
  
  /** Armazenamento em memória local (utilizado como contingência ou em modo mono-nó) */
  private servicesCache: { data: ServiceRegistration[]; expiresAt: number } | null = null;
  private matchesCache = new Map<string, { data: ServiceMatch[]; expiresAt: number }>();

  private redisClient: any = null;
  private isRedisConnected = false;
  private isRedisInitialized = false;

  /**
   * @description Inicializa a ligação ao Redis de forma assíncrona caso `REDIS_URL` esteja definido.
   * Configura também um canal de subscrição Pub/Sub para escuta de comandos de invalidação remota.
   * @returns {Promise<any>} Cliente Redis ligado ou nulo caso não esteja disponível.
   */
  private async getRedisClient(): Promise<any> {
    if (this.isRedisInitialized) {
      return this.redisClient;
    }

    this.isRedisInitialized = true;
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        console.log(`[Cache] A tentar estabelecer ligação ao Redis em ${redisUrl}...`);
        const redis = require('redis');
        const client = redis.createClient({ url: redisUrl });
        client.on('error', (err: any) => {
          console.warn('[Cache] Erro no cliente Redis; a recorrer à memória local:', err.message);
          this.isRedisConnected = false;
        });
        await client.connect();
        this.redisClient = client;
        this.isRedisConnected = true;
        console.log('[Cache] Ligação ao Redis estabelecida com sucesso.');

        // Configuração de subscritor Redis Pub/Sub para invalidação atómica em tempo real entre instâncias
        const subscriber = client.duplicate();
        subscriber.on('error', (err: any) => {
          console.warn('[Cache] Erro no subscritor Redis Pub/Sub:', err.message);
        });
        await subscriber.connect();
        await subscriber.subscribe('inp:cache:invalidate', () => {
          console.log('[Cache] Mensagem de invalidação recebida via Redis Pub/Sub. A limpar cache em memória...');
          this.servicesCache = null;
          this.matchesCache.clear();
        });
      } catch (err: any) {
        console.warn('[Cache] Falha na inicialização do Redis. A recorrer à cache local em memória. Erro:', err.message);
        this.redisClient = null;
        this.isRedisConnected = false;
      }
    }
    return this.redisClient;
  }

  /**
   * @description Obtém a lista consolidada de serviços ativos em cache, se ainda válidos.
   *
   * @returns {Promise<ServiceRegistration[] | null>} Lista de serviços ou nulo se expirada/ausente.
   */
  async getServices(): Promise<ServiceRegistration[] | null> {
    const client = await this.getRedisClient();
    if (this.isRedisConnected && client) {
      try {
        const cached = await client.get('inp:services');
        if (cached) {
          return JSON.parse(cached);
        }
        return null;
      } catch (err) {
        console.warn('[Cache] Erro ao consultar serviços no Redis:', err);
      }
    }

    if (this.servicesCache && this.servicesCache.expiresAt > Date.now()) {
      return this.servicesCache.data;
    }
    return null;
  }

  /**
   * @description Armazena a lista de serviços ativos em cache com o tempo de vida (TTL) configurado.
   *
   * @param {ServiceRegistration[]} services - Lista de serviços registados e ativos.
   */
  async setServices(services: ServiceRegistration[]): Promise<void> {
    const client = await this.getRedisClient();
    if (this.isRedisConnected && client) {
      try {
        await client.setEx('inp:services', Math.floor(this.ttl / 1000), JSON.stringify(services));
        return;
      } catch (err) {
        console.warn('[Cache] Erro ao gravar serviços no Redis:', err);
      }
    }

    this.servicesCache = {
      data: services,
      expiresAt: Date.now() + this.ttl,
    };
  }

  /**
   * @description Obtém correspondências pré-calculadas para uma capacidade específica.
   *
   * @param {string} capabilityKey - Chave semântica da capacidade (ex.: "PROCESS PAYMENT").
   * @returns {Promise<ServiceMatch[] | null>} Lista de correspondências ou nulo.
   */
  async getMatches(capabilityKey: string): Promise<ServiceMatch[] | null> {
    const key = capabilityKey.toUpperCase();
    const client = await this.getRedisClient();
    if (this.isRedisConnected && client) {
      try {
        const cached = await client.get(`inp:matches:${key}`);
        if (cached) {
          return JSON.parse(cached);
        }
        return null;
      } catch (err) {
        console.warn('[Cache] Erro ao consultar correspondências no Redis:', err);
      }
    }

    const cached = this.matchesCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    return null;
  }

  /**
   * @description Guarda correspondências de serviços para uma capacidade específica em cache.
   *
   * @param {string} capabilityKey - Chave identificadora da capacidade.
   * @param {ServiceMatch[]} matches - Lista de correspondências calculadas com respetivas pontuações.
   */
  async setMatches(capabilityKey: string, matches: ServiceMatch[]): Promise<void> {
    const key = capabilityKey.toUpperCase();
    const client = await this.getRedisClient();
    if (this.isRedisConnected && client) {
      try {
        await client.setEx(`inp:matches:${key}`, Math.floor(this.ttl / 1000), JSON.stringify(matches));
        return;
      } catch (err) {
        console.warn('[Cache] Erro ao guardar correspondências no Redis:', err);
      }
    }

    this.matchesCache.set(key, {
      data: matches,
      expiresAt: Date.now() + this.ttl,
    });
  }

  /**
   * @description Invalida imediatamente toda a cache (em memória e no Redis), emitindo uma notificação
   * Pub/Sub para que todas as instâncias em cluster sincronizem a limpeza do catálogo.
   *
   * @audit Garante a eliminação rápida de registos de serviços obsoletos em toda a infraestrutura.
   */
  async invalidate(): Promise<void> {
    console.log('[Cache] A invalidar a cache do catálogo de serviços...');
    const client = await this.getRedisClient();
    if (this.isRedisConnected && client) {
      try {
        const keys = await client.keys('inp:*');
        if (keys && keys.length > 0) {
          await client.del(keys);
        }
        await client.publish('inp:cache:invalidate', 'clear');
      } catch (err) {
        console.warn('[Cache] Erro ao invalidar chaves no Redis:', err);
      }
    }

    this.servicesCache = null;
    this.matchesCache.clear();
  }
}

/**
 * @description Instância singleton exportada para acesso global à cache de registo.
 */
export const RegistryCache = new RegistryCacheManager();
