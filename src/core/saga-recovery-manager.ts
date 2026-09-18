/**
 * @fileoverview Gestor de Recuperação e Desastre de Sagas Interrompidas (SagaRecoveryManager)
 * @module Core/SagaRecoveryManager
 * @description
 * Executado no arranque do gateway para inspecionar a base de dados PostgreSQL à procura
 * de transações distribuídas (Sagas) deixadas em estados pendentes ou inconsistentes
 * devido a paragens abruptas do servidor, reinicializações ou quebras de rede.
 * Reassume automaticamente a reversão por compensação (`resumeRollback`), garantindo
 * que o ecossistema recupera a consistência eventual sem intervenção manual.
 *
 * @security Evita o abandono de reservas financeiras ou retenções de inventário órfãs causadas por falhas de infraestrutura.
 * @audit Cada saga recuperada gera um rasto formal de auditoria, comprovando a execução retrospetiva
 * das compensações contratuais exigidas por conformidade financeira.
 */

import { SagaStateRepository } from '../persistence/repositories/SagaStateRepository';
import { ExecutionRepository } from '../persistence/repositories/ExecutionRepository';
import { AppDataSource } from '../persistence/data-source';
import { QueueJob } from '../persistence/entities/QueueJob';
import { CapabilityRegistry } from './capability-registry';
import { ExecutionEngine } from './execution-engine';

/**
 * @description Gestor autónomo de recuperação de desastres e consistência eventual de Sagas no arranque do sistema.
 */
export class SagaRecoveryManager {
  /**
   * @description Analisa a tabela `saga_states` em busca de registos interrompidos nos estados
   * `RUNNING`, `COMPENSATING`, `COMPENSATION_FAILED` ou `FORWARD_RETRY_PENDING` e executa a respetiva compensação ou retoma.
   *
   * @param {CapabilityRegistry} registry - Catálogo de capacidades para resolução dos nós compensatórios.
   * @returns {Promise<void>} Promessa resolvida após a conclusão da varredura e compensações.
   * @security Assegura que nenhum recurso permanece bloqueado ou transação financeira por compensar.
   * @audit Regista no log de auditoria cada ID de saga recuperada e o estado final de compensação.
   */
  static async recoverPendingSagas(registry: CapabilityRegistry): Promise<void> {
    console.log('[Recuperação de Sagas] A verificar a existência de transações interrompidas...');
    try {
      // MEDIDA DE SEGURANÇA: Apenas sagas desatualizadas há mais de 5 minutos são elegíveis para recuperação.
      // Sagas RUNNING que foram atualizadas recentemente estão a ser processadas ativamente e não devem ser perturbadas.
      const stalenessThreshold = new Date(Date.now() - 5 * 60 * 1000);
      const pendingSagas = await SagaStateRepository.createQueryBuilder('saga')
        .where("saga.status IN ('RUNNING', 'COMPENSATING', 'COMPENSATION_FAILED', 'FORWARD_RETRY_PENDING')")
        .andWhere('saga.updated_at < :threshold', { threshold: stalenessThreshold })
        .getMany();

      if (pendingSagas.length === 0) {
        console.log('[Recuperação de Sagas] Nenhuma transação pendente detetada. O sistema encontra-se consistente.');
        return;
      }

      console.log(`[Recuperação de Sagas] Foram identificadas ${pendingSagas.length} transações para compensação ou avanço de contingência.`);

      for (const saga of pendingSagas) {
        // Se a política for FORWARD_RETRY, avança a execução em vez de desfazer
        if (saga.status === 'FORWARD_RETRY_PENDING' || saga.failurePolicy === 'FORWARD_RETRY') {
          console.log(`[Recuperação de Sagas] A retomar Saga com política FORWARD_RETRY: ID ${saga.id} (Passo: ${saga.currentStepIndex})`);
          const execution = await ExecutionRepository.findOneBy({ id: saga.executionId });
          if (execution) {
            await AppDataSource.getRepository(QueueJob).save({
              sagaId: saga.id,
              executionId: saga.executionId,
              taskType: 'FLOW_EXECUTION',
              payload: {
                executionId: saga.executionId,
                intentId: saga.intentId,
                isForwardRecovery: true
              },
              status: 'PENDING',
              attempts: 0,
              maxAttempts: saga.maxForwardRetries || 3
            });
            console.log(`[Recuperação de Sagas] Saga ID ${saga.id} reenfileirada com sucesso para continuação progressiva.`);
          }
          continue;
        }

        console.log(`[Recuperação de Sagas] A reiniciar reversão da Saga ID: ${saga.id} (Estado: ${saga.status}, Passos: ${saga.compensationStack.length})`);
        
        // Instanciação isolada do motor de execução para o contexto de reversão
        const engine = new ExecutionEngine(registry);
        
        // Atualização do estado para COMPENSATING para sinalizar recuperação em curso
        await SagaStateRepository.update({ id: saga.id }, { status: 'COMPENSATING' });
        
        try {
          // Despoleta a execução LIFO da pilha de compensação persistida
          await engine.resumeRollback(saga.id, saga.compensationStack);
          console.log(`[Recuperação de Sagas] A Saga ID ${saga.id} foi compensada com sucesso.`);
        } catch (err: any) {
          console.error(`[Recuperação de Sagas] ERRO CRÍTICO: Falha na recuperação da Saga ID ${saga.id}: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.error('[Recuperação de Sagas] Exceção durante a varredura de recuperação:', err.message);
    }
  }

  /**
   * @description Executa a purga de manutenção de sagas consolidadas (COMPLETED ou COMPENSATED)
   * que ultrapassaram o período de retenção, mitigando o inchaço de tabelas (table bloat) no PostgreSQL.
   *
   * @param {number} [olderThanDays=30] - Janela temporal em dias para expiração de dados arquivados.
   * @returns {Promise<number>} Quantidade de registos de sagas purgados.
   * @security Mantém intactas quaisquer sagas nos estados ativos ou pendentes de recuperação.
   * @audit Regista no log do sistema a quantidade de linhas liberadas para manutenção e desempenho de índices.
   */
  static async purgeCompletedSagas(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
      const deleteResult = await SagaStateRepository.createQueryBuilder()
        .delete()
        .where("status IN ('COMPLETED', 'COMPENSATED')")
        .andWhere('updated_at < :cutoff', { cutoff: cutoffDate })
        .execute();

      const purgedCount = deleteResult.affected || 0;
      console.log(`[Recuperação de Sagas] Purga de manutenção concluída: ${purgedCount} sagas consolidadas (> ${olderThanDays} dias) removidas.`);
      return purgedCount;
    } catch (err: any) {
      console.error('[Recuperação de Sagas] Falha ao purgar sagas consolidadas:', err.message);
      return 0;
    }
  }
}
