/**
 * @fileoverview Coletor de Métricas de Desempenho e Estado de Saúde dos Serviços
 * @module Core/MetricsCollector
 * @description
 * Monitoriza dinamicamente o desempenho, latência média e taxas de erro dos microserviços
 * registados no protocolo INP. Calcula a pontuação de saúde ponderada (*Health Score*)
 * penalizando serviços lentos ou instáveis, ajustando o índice de confiança (*trustScore*)
 * e notificando a camada de telemetria perante degradações de serviço.
 *
 * @security Evita o roteamento de tráfego crítico para serviços comprometidos ou sob ataque DoS,
 * isolando nós degradados antes que contaminem a disponibilidade do ecossistema.
 * @audit Fornece métricas quantitativas de cumprimento de Acordos de Nível de Serviço (SLA)
 * para auditorias de infraestrutura e fiabilidade operacional.
 */

import { TelemetryService } from './telemetry-service';

/**
 * @description Estrutura de métricas operacionais agregadas por serviço.
 */
export interface ServiceMetric {
  /** Identificador único do microserviço */
  serviceId: string;
  /** Amostras recentes de latência em milissegundos (janela deslizante) */
  latencies: number[];
  /** Contagem acumulada de invocações bem-sucedidas */
  successCount: number;
  /** Contagem acumulada de invocações falhadas */
  failureCount: number;
  /** Classificação operacional do serviço ('HEALTHY', 'DEGRADED', 'OFFLINE') */
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
}

/**
 * @description Coletor centralizado de métricas operacionais baseado no padrão Singleton.
 */
export class ServiceMetricsCollector {
  private static instance: ServiceMetricsCollector;
  /** Mapa em memória indexado por identificador de serviço contendo as respetivas métricas */
  private metricsMap = new Map<string, ServiceMetric>();

  /** Construtor privado para salvaguarda do padrão Singleton */
  private constructor() {}

  /**
   * @description Devolve a instância partilhada única do ServiceMetricsCollector.
   * @returns {ServiceMetricsCollector} Instância do coletor de métricas.
   */
  public static getInstance(): ServiceMetricsCollector {
    if (!ServiceMetricsCollector.instance) {
      ServiceMetricsCollector.instance = new ServiceMetricsCollector();
    }
    return ServiceMetricsCollector.instance;
  }

  /**
   * @description Regista uma invocação remota concluída com êxito e atualiza a latência.
   * Mantém uma janela deslizante com as últimas 10 medições.
   *
   * @param {string} serviceId - Identificador do serviço que processou o pedido.
   * @param {number} latencyMs - Tempo decorrido em milissegundos.
   * @audit Regista a latência para aferição contínua de SLAs.
   */
  public recordSuccess(serviceId: string, latencyMs: number): void {
    let metric = this.metricsMap.get(serviceId);
    if (!metric) {
      metric = { serviceId, latencies: [], successCount: 0, failureCount: 0, status: 'HEALTHY' };
      this.metricsMap.set(serviceId, metric);
    }

    metric.successCount++;
    metric.latencies.push(latencyMs);
    // Limita a janela deslizante às últimas 10 chamadas para refletir o estado operacional recente
    if (metric.latencies.length > 10) {
      metric.latencies.shift();
    }

    this.evaluateStatus(metric);
  }

  /**
   * @description Regista uma falha operacional de um serviço e reavalia o seu estado de saúde.
   *
   * @param {string} serviceId - Identificador do serviço no qual ocorreu a falha.
   * @security Alimenta o cálculo de penalizações para afastar tráfego de nós em colapso.
   */
  public recordFailure(serviceId: string): void {
    let metric = this.metricsMap.get(serviceId);
    if (!metric) {
      metric = { serviceId, latencies: [], successCount: 0, failureCount: 0, status: 'HEALTHY' };
      this.metricsMap.set(serviceId, metric);
    }

    metric.failureCount++;
    this.evaluateStatus(metric);
  }

  /**
   * @description Calcula a pontuação final dinâmica de saúde (0.0 a 1.0) combinando o trustScore base
   * com penalizações decorrentes da latência média e da percentagem de erros.
   *
   * @param {string} serviceId - Identificador do serviço.
   * @param {number} baseTrustScore - Pontuação estática de confiança do catálogo (0 a 100).
   * @returns {number} Pontuação normalizada ponderada (mínimo 0.1, máximo 1.0).
   * @security Previne a monopolização do sistema por serviços lentos ou instáveis.
   */
  public getHealthScore(serviceId: string, baseTrustScore: number): number {
    const metric = this.metricsMap.get(serviceId);
    if (!metric) return baseTrustScore / 100;

    const totalCalls = metric.successCount + metric.failureCount;
    if (totalCalls === 0) return baseTrustScore / 100;

    const errorRate = metric.failureCount / totalCalls;
    const avgLatency = metric.latencies.reduce((a, b) => a + b, 0) / (metric.latencies.length || 1);

    let penalty = 0;
    
    // Penalização progressiva para latências médias superiores a 1 segundo
    if (avgLatency > 1000) {
      penalty += Math.min(0.4, (avgLatency - 1000) / 2000);
    }

    // Penalização proporcional à taxa percentual de erros
    penalty += errorRate * 0.6;

    const finalScore = Math.max(0.1, (baseTrustScore / 100) * (1 - penalty));
    return finalScore;
  }

  /**
   * @description Obtém a fotografia atual das métricas de um determinado serviço.
   *
   * @param {string} serviceId - Identificador do serviço.
   * @returns {ServiceMetric | undefined} Objeto de métricas ou undefined caso ainda não tenha atividade.
   */
  public getServiceMetric(serviceId: string): ServiceMetric | undefined {
    return this.metricsMap.get(serviceId);
  }

  /**
   * @description Avalia a transição de estado operacional de um serviço com base no histórico recente.
   * Emite um evento via TelemetryService quando o estado transita para DEGRADED ou HEALTHY.
   *
   * @param {ServiceMetric} metric - Objeto de métricas a reavaliar.
   */
  private evaluateStatus(metric: ServiceMetric): void {
    const totalCalls = metric.successCount + metric.failureCount;
    // Aguarda um número estatisticamente relevante de pedidos (mínimo 3) antes de reclassificar
    if (totalCalls < 3) return;

    const errorRate = metric.failureCount / totalCalls;
    const avgLatency = metric.latencies.reduce((a, b) => a + b, 0) / (metric.latencies.length || 1);
    
    let newStatus: 'HEALTHY' | 'DEGRADED' | 'OFFLINE' = 'HEALTHY';
    if (errorRate > 0.4 || avgLatency > 2500) {
      newStatus = 'DEGRADED';
    }

    if (newStatus !== metric.status) {
      metric.status = newStatus;
      console.log(`[Métricas] O estado do serviço "${metric.serviceId}" alterou-se para ${newStatus}. Latência média: ${avgLatency.toFixed(1)}ms, Taxa de Erro: ${(errorRate * 100).toFixed(1)}%`);
      
      // Difunde a alteração de estado para observabilidade em tempo real
      TelemetryService.getInstance().broadcast('SERVICE_HEALTH_CHANGED', {
        serviceId: metric.serviceId,
        status: newStatus,
        avgLatency,
        errorRate
      });
    }
  }
}
