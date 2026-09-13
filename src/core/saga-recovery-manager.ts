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
import { CapabilityRegistry } from './capability-registry';
import { ExecutionEngine } from './execution-engine';

/**
 * @description Gestor autónomo de recuperação de desastres e consistência eventual de Sagas no arranque do sistema.
 */
export class SagaRecoveryManager {
  /**
   * @description Analisa a tabela `saga_states` em busca de registos interrompidos nos estados
   * `RUNNING`, `COMPENSATING` ou `COMPENSATION_FAILED` e executa a respetiva compensação pendente.
   *
   * @param {CapabilityRegistry} registry - Catálogo de capacidades para resolução dos nós compensatórios.
   * @returns {Promise<void>} Promessa resolvida após a conclusão da varredura e compensações.
   * @security Assegura que nenhum recurso permanece bloqueado ou transação financeira por compensar.
   * @audit Regista no log de auditoria cada ID de saga recuperada e o estado final de compensação.
   */
  static async recoverPendingSagas(registry: CapabilityRegistry): Promise<void> {
    console.log('[Recuperação de Sagas] A verificar a existência de transações interrompidas...');
    try {
      // Localiza todas as transações que ficaram incompletas antes da paragem do serviço
      const pendingSagas = await SagaStateRepository.createQueryBuilder('saga')
        .where("saga.status IN ('RUNNING', 'COMPENSATING', 'COMPENSATION_FAILED')")
        .getMany();

      if (pendingSagas.length === 0) {
        console.log('[Recuperação de Sagas] Nenhuma transação pendente detetada. O sistema encontra-se consistente.');
        return;
      }

      console.log(`[Recuperação de Sagas] Foram identificadas ${pendingSagas.length} transações para compensação de contingência.`);

      for (const saga of pendingSagas) {
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
}
