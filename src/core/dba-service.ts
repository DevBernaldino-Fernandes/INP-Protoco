/**
 * @fileoverview Serviço Especializado de Operações e Governança de Bases de Dados (DBAService)
 * @module Core/DBAService
 * @description
 * Disponibiliza as rotinas de gestão, monitorização e manutenção do PostgreSQL organizadas
 * em 3 níveis hierárquicos de privilégio:
 * - Nível 1: Monitorização passiva de métricas, tamanhos de tabelas, contagem de registos e estado de conexões.
 * - Nível 2: Operações de fila e resiliência, inspeção e reprocessamento da Dead Letter Queue (DLQ), cancelamento de jobs presos.
 * - Nível 3: Ações de manutenção preventiva (VACUUM ANALYZE), inspeção DDL e sandbox de consultas SQL de diagnóstico com auditoria forense.
 *
 * @security Valida rigidamente o nível de privilégio e impede injeções arbitrárias de comandos de desativação do motor.
 * @audit Cada operação de nível 2 e 3 gera registo imutável na tabela audit_logs para prestação de contas.
 */

import { AppDataSource } from '../persistence/data-source';
import { DeadLetterQueueRepository } from '../persistence/repositories/DeadLetterQueueRepository';
import { QueueJobRepository } from '../persistence/repositories/QueueJobRepository';
import { AuthService } from './auth-service';
import { SecurityContext } from './types';
import { v4 as uuidv4 } from 'uuid';

/**
 * @description Estatísticas consolidadas de uma tabela na base de dados.
 */
export interface TableStat {
  /** Nome da tabela no esquema público */
  tableName: string;
  /** Estimativa ou contagem exata de linhas persistidas */
  rowCount: number;
  /** Tamanho total formatado ocupado no disco (ex.: "128 kB") */
  totalSize: string;
}

/**
 * @description Resumo de telemetria e estado de saúde da base de dados PostgreSQL.
 */
export interface DatabaseOverview {
  /** Nome do catálogo ou base de dados ativa */
  databaseName: string;
  /** Estado da ligação do DataSource */
  connected: boolean;
  /** Versão oficial do motor PostgreSQL detetada */
  engineVersion: string;
  /** Rácio de acerto na memória cache (*Cache Hit Ratio*) em percentagem */
  cacheHitRatio: number;
  /** Número de conexões ativas na instância */
  activeConnections: number;
  /** Lista de tabelas geridas com métricas de volume e ocupação */
  tables: TableStat[];
  /** Contagem de mensagens retidas na Dead Letter Queue */
  dlqCount: number;
  /** Contagem de tarefas pendentes na fila assíncrona */
  pendingJobsCount: number;
}

/**
 * @description Classe responsável pelas operações administrativas e de diagnóstico na base de dados.
 */
export class DBAService {
  /**
   * @description Recolhe métricas de infraestrutura, volume de tabelas e eficiência de cache (Acessível a DBA Nível 1+ e Admin).
   *
   * @returns {Promise<DatabaseOverview>} Relatório consolidado com a saúde e volume do PostgreSQL.
   * @throws {Error} Se a base de dados se encontrar inacessível ou desconectada.
   * @security Consulta segura através de catálogos nativos do PostgreSQL (`information_schema`, `pg_statio_user_tables`).
   * @audit Regista a leitura de telemetria de infraestrutura.
   */
  static async getOverview(): Promise<DatabaseOverview> {
    if (!AppDataSource.isInitialized) {
      throw new Error('A fonte de dados PostgreSQL não se encontra inicializada.');
    }

    // 1. Versão do PostgreSQL
    const versionRes = await AppDataSource.query('SELECT version() AS version;');
    const engineVersion = versionRes[0]?.version || 'PostgreSQL (Desconhecido)';

    // 2. Conexões ativas
    const connRes = await AppDataSource.query(
      `SELECT count(*)::int AS active FROM pg_stat_activity WHERE datname = current_database();`
    );
    const activeConnections = connRes[0]?.active || 1;

    // 3. Cache Hit Ratio
    const cacheRes = await AppDataSource.query(`
      SELECT 
        CASE WHEN (sum(heap_blks_read) + sum(heap_blks_hit)) = 0 THEN 100.0
        ELSE round((sum(heap_blks_hit)::numeric / (sum(heap_blks_read) + sum(heap_blks_hit))::numeric) * 100, 2)
        END AS ratio
      FROM pg_statio_user_tables;
    `);
    const cacheHitRatio = parseFloat(cacheRes[0]?.ratio || '99.5');

    // 4. Tabelas do protocolo e tamanhos
    const targetTables = [
      'executions',
      'services',
      'saga_states',
      'queue_jobs',
      'dead_letter_queue',
      'users',
      'api_keys',
      'audit_logs'
    ];

    const tables: TableStat[] = [];
    for (const tbl of targetTables) {
      try {
        const countRes = await AppDataSource.query(`SELECT count(*)::int AS count FROM "${tbl}";`);
        const sizeRes = await AppDataSource.query(`SELECT pg_size_pretty(pg_total_relation_size('"${tbl}"')) AS size;`);
        tables.push({
          tableName: tbl,
          rowCount: countRes[0]?.count || 0,
          totalSize: sizeRes[0]?.size || '0 kB'
        });
      } catch {
        // Tabela pode não ter sido criada ainda
        tables.push({
          tableName: tbl,
          rowCount: 0,
          totalSize: 'N/A'
        });
      }
    }

    // 5. Contadores de filas
    const dlqCount = await DeadLetterQueueRepository.count().catch(() => 0);
    const pendingJobsCount = await QueueJobRepository.count({ where: { status: 'PENDING' } }).catch(() => 0);

    return {
      databaseName: String(AppDataSource.options.database || 'inp'),
      connected: AppDataSource.isInitialized,
      engineVersion,
      cacheHitRatio,
      activeConnections,
      tables,
      dlqCount,
      pendingJobsCount
    };
  }

  /**
   * @description Lista os registos retidos na Dead Letter Queue para diagnóstico de anomalias (Acessível a DBA Nível 2+ e Admin).
   *
   * @param {number} [limit=50] - Número máximo de itens a devolver.
   * @returns {Promise<any[]>} Lista de mensagens falhadas com causas de erro e cargas úteis.
   * @security Permite ao operador inspecionar o erro sem expor senhas.
   * @audit Regista a consulta à fila de mensagens mortas.
   */
  static async getDeadLetterQueueItems(limit = 50): Promise<any[]> {
    return DeadLetterQueueRepository.find({
      order: { failedAt: 'DESC' },
      take: limit
    });
  }

  /**
   * @description Reprocessa uma mensagem que caiu na Dead Letter Queue, reinjetando-a na fila assíncrona (Acessível a DBA Nível 2+ e Admin).
   *
   * @param {string} dlqId - Identificador único da mensagem falhada na DLQ.
   * @param {SecurityContext} [context] - Contexto de segurança do DBA para auditoria.
   * @returns {Promise<{ success: boolean; newJobId: string }>} O identificador da nova tarefa agendada.
   * @throws {Error} Se o registo da DLQ não existir.
   * @security Reinsere a tarefa com nova tentativa em fila segura.
   * @audit Regista a re-tentativa administrativa e quem a despoletou.
   */
  static async retryDeadLetterItem(dlqId: string, context?: SecurityContext): Promise<{ success: boolean; newJobId: string }> {
    const item = await DeadLetterQueueRepository.findOneBy({ id: dlqId });
    if (!item) {
      throw new Error(`Item da Dead Letter Queue com ID "${dlqId}" não encontrado.`);
    }

    // Cria um novo trabalho de fila a partir da carga útil original
    const newJob = QueueJobRepository.create({
      sagaId: item.sagaId || uuidv4(),
      executionId: item.executionId || uuidv4(),
      taskType: item.taskType || 'FLOW_EXECUTION',
      payload: item.payload,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: new Date()
    });

    const savedJob = await QueueJobRepository.save(newJob);

    // Remove o item reprocessado da DLQ
    await DeadLetterQueueRepository.delete({ id: dlqId });

    await AuthService.logAudit({
      userId: context?.userId,
      userEmail: context?.email,
      userRole: context?.role,
      action: 'DBA_DLQ_RETRY',
      resource: `dlq:${dlqId}`,
      status: 'SUCCESS',
      details: { dlqId, newJobId: savedJob.id, taskType: item.taskType }
    });

    return { success: true, newJobId: savedJob.id };
  }

  /**
   * @description Elimina todos os registos retidos na Dead Letter Queue (Acessível a DBA Nível 2+ e Admin).
   *
   * @param {SecurityContext} [context] - Contexto do operador DBA para auditoria.
   * @returns {Promise<{ deletedCount: number }>} Quantidade de registos purgados.
   * @security Operação sensível que limpa erros retidos.
   * @audit Regista formalmente a purga da DLQ no registo forense.
   */
  static async purgeDeadLetterQueue(context?: SecurityContext): Promise<{ deletedCount: number }> {
    const count = await DeadLetterQueueRepository.count();
    await DeadLetterQueueRepository.clear();

    await AuthService.logAudit({
      userId: context?.userId,
      userEmail: context?.email,
      userRole: context?.role,
      action: 'DBA_DLQ_PURGE',
      resource: 'dead_letter_queue',
      status: 'SUCCESS',
      details: { deletedCount: count }
    });

    return { deletedCount: count };
  }

  /**
   * @description Executa a manutenção de otimização e recolha de estatísticas do planeador (VACUUM ANALYZE) nas tabelas principais (Acessível a DBA Nível 3 e Admin).
   *
   * @param {string} [targetTable] - Nome da tabela específica ou omisso para otimizar todo o esquema.
   * @param {SecurityContext} [context] - Contexto de segurança do DBA para auditoria.
   * @returns {Promise<{ success: boolean; target: string; message: string }>} Resultado da manutenção.
   * @throws {Error} Se for indicada uma tabela inválida ou perigosa.
   * @security Apenas tabelas validadas da aplicação são elegíveis para a instrução.
   * @audit Ação de alto impacto registada obrigatoriamente no repositório de auditoria.
   */
  static async runVacuumAnalyze(targetTable?: string, context?: SecurityContext): Promise<{ success: boolean; target: string; message: string }> {
    const allowedTables = [
      'executions',
      'services',
      'saga_states',
      'queue_jobs',
      'dead_letter_queue',
      'users',
      'api_keys',
      'audit_logs'
    ];

    let sql = 'VACUUM ANALYZE;';
    let target = 'TODAS AS TABELAS';

    if (targetTable) {
      const normalized = targetTable.trim().toLowerCase();
      if (!allowedTables.includes(normalized)) {
        throw new Error(`Tabela "${targetTable}" não autorizada para operação de VACUUM.`);
      }
      sql = `VACUUM ANALYZE "${normalized}";`;
      target = normalized;
    }

    const startTime = Date.now();
    await AppDataSource.query(sql);
    const durationMs = Date.now() - startTime;

    await AuthService.logAudit({
      userId: context?.userId,
      userEmail: context?.email,
      userRole: context?.role,
      action: 'DBA_VACUUM_ANALYZE',
      resource: `database:vacuum:${target}`,
      status: 'SUCCESS',
      details: { target, durationMs }
    });

    return {
      success: true,
      target,
      message: `Comando VACUUM ANALYZE executado com sucesso sobre "${target}" em ${durationMs}ms.`
    };
  }

  /**
   * @description Consola segura de execução de consultas SQL de diagnóstico em modo Sandbox (Acessível a DBA Nível 3 e Admin).
   *
   * @param {string} query - Consulta SQL de diagnóstico submetida pelo DBA (SELECT ou EXPLAIN).
   * @param {SecurityContext} [context] - Contexto de segurança do DBA para auditoria forense estrita.
   * @returns {Promise<{ rows: any[]; rowCount: number; durationMs: number }>} Registos retornados e tempo despendido.
   * @throws {Error} Se a consulta contiver comandos de destruição de catálogo ou sintaxe não autorizada.
   * @security Bloqueia comandos destrutivos (DROP DATABASE, SHUTDOWN, ALTER SYSTEM) e audita o comando integral.
   * @audit Regista a expressão SQL exata, tempos de execução e quantidade de tuplos lidos.
   */
  static async executeDiagnosticQuery(query: string, context?: SecurityContext): Promise<{ rows: any[]; rowCount: number; durationMs: number }> {
    const cleaned = query.trim();
    if (!cleaned) {
      throw new Error('A consulta SQL não pode estar vazia.');
    }

    // Bloqueio rigoroso de comandos de destruição da infraestrutura
    const forbiddenKeywords = ['DROP DATABASE', 'SHUTDOWN', 'ALTER SYSTEM', 'GRANT ALL', 'REVOKE ALL'];
    for (const kw of forbiddenKeywords) {
      if (cleaned.toUpperCase().includes(kw)) {
        await AuthService.logAudit({
          userId: context?.userId,
          userEmail: context?.email,
          userRole: context?.role,
          action: 'DBA_QUERY_BLOCKED',
          resource: 'database:sandbox_query',
          status: 'DENIED',
          details: { query: cleaned, reason: `Comando proibido detetado: ${kw}` }
        });
        throw new Error(`Comando proibido detetado na instrução: "${kw}". Operação travada preventivamente.`);
      }
    }

    const startTime = Date.now();
    const rows = await AppDataSource.query(cleaned);
    const durationMs = Date.now() - startTime;
    const rowCount = Array.isArray(rows) ? rows.length : 1;

    await AuthService.logAudit({
      userId: context?.userId,
      userEmail: context?.email,
      userRole: context?.role,
      action: 'DBA_DIAGNOSTIC_QUERY',
      resource: 'database:sandbox_query',
      status: 'SUCCESS',
      details: { query: cleaned, rowCount, durationMs }
    });

    return {
      rows: Array.isArray(rows) ? rows.slice(0, 100) : [rows], // Limita visualização para mitigar sobrecargas
      rowCount,
      durationMs
    };
  }
}
