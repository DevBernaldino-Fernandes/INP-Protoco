/**
 * @fileoverview Servidor HTTP Express e Ponto de Extremidade REST da API (Server)
 * @module Api/Server
 * @description
 * Servidor HTTP central do Intent Network Protocol (INP) construído sobre a framework Express.
 * Disponibiliza as rotas públicas e protegidas da API REST:
 * - Submissão e processamento de intenções (síncronas e assíncronas via Outbox Pattern).
 * - Catálogo e registo de microserviços com validação de tokens e batimentos cardíacos (heartbeat).
 * - Monitorização e telemetria em tempo real via Server-Sent Events (SSE).
 * - Federação entre nós parceiros (P2P) com verificação de assinaturas digitais assimétricas.
 * - Painel de administração web (`portal.html`), laboratório interativo (`demo`) e exportação de SDK/Postman.
 * - Simulações de engenharia de caos (*Chaos Engineering*) e comutação de estado dos serviços.
 *
 * @security Implementa cabeçalhos defensivos com Helmet, limitação de taxa (*Rate Limiting*)
 * contra ataques de negação de serviço (DoS), restrição de tamanho de payload (10kb),
 * injeção de ID de correlação (`X-Correlation-ID`) para rastreamento distribuído,
 * validação rigorosa de tokens de registo e mascaramento obrigatório de dados sensíveis.
 * @audit Cada pedido HTTP é correlacionado por um identificador único e cada execução
 * é registada nas tabelas da base de dados PostgreSQL para conferência em auditorias.
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { AppDataSource } from '../persistence/data-source';
import { INPCore } from '../core/inp-core';
import { Service } from '../core/types';
import { ServiceRepository } from '../persistence/repositories/ServiceRepository';
import { ExecutionRepository } from '../persistence/repositories/ExecutionRepository';
import { QueueJobRepository } from '../persistence/repositories/QueueJobRepository';
import { SagaRecoveryManager } from '../core/saga-recovery-manager';
import { QueueWorker } from '../core/queue-worker';
import { RegistryCache } from '../core/registry-cache';
import { TelemetryService } from '../core/telemetry-service';
import { ServiceMetricsCollector } from '../core/metrics-collector';
import { IntentFederation } from '../core/intent-federation';
import { DataSanitizer } from '../core/data-sanitizer';
import { NetworkSecurity } from '../core/network-security';
import { AuthService } from '../core/auth-service';
import { AccessControl, PERMISSIONS } from '../core/access-control';
import { DBAService } from '../core/dba-service';
import { UserRepository } from '../persistence/repositories/UserRepository';
import { ApiKeyRepository } from '../persistence/repositories/ApiKeyRepository';
import { AuditLogRepository } from '../persistence/repositories/AuditLogRepository';
import { UserRole, DbaLevel } from '../persistence/entities/User';

const app = express();

// Proteção com cabeçalhos HTTP padrão de segurança
app.use(helmet({
  contentSecurityPolicy: false // Desativado para permitir a execução de scripts do portal web local
}));

// Ativação do suporte a partilha de recursos de origem cruzada (CORS)
app.use(cors());

// Limitação prudencial do tamanho do corpo do pedido
app.use(express.json({ limit: '2mb' }));

// Disponibilização de ficheiros estáticos para a interface gráfica e ativos da demonstração
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(process.cwd(), 'src', 'api')));
app.use('/demo-assets', express.static(path.join(process.cwd(), 'examples', 'ecommerce-ecosystem')));

/**
 * Middleware de Rastreamento Distribuído (Correlation ID):
 * Injeta ou propaga um identificador de correlação único em cada pedido HTTP.
 */
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || req.headers['x-request-id'] || uuidv4();
  req.headers['x-correlation-id'] = correlationId as string;
  res.setHeader('x-correlation-id', correlationId as string);
  next();
});

/**
 * Middleware de Limitação de Taxa (Rate Limiting) para prevenção de DoS/DDoS na API:
 * Limita cada endereço IP a um máximo de 100 pedidos por janela de 15 minutos.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Limite de pedidos excedido para este endereço IP. Por favor, tente novamente após 15 minutos.'
  }
});

/**
 * @description Middleware de autenticação obrigatória para operações de registo de serviços e federação.
 * Valida a presença e conformidade do cabeçalho `X-Registration-Token`.
 *
 * @param {express.Request} req - Pedido HTTP recebido.
 * @param {express.Response} res - Resposta HTTP.
 * @param {express.NextFunction} next - Função de continuidade do fluxo do middleware.
 * @security Bloqueia o registo não autorizado de serviços por atores não credenciados na rede.
 */
function requireRegistrationToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const regSecret = process.env.INP_REGISTRATION_SECRET || (process.env.NODE_ENV !== 'production' ? 'inp-super-secret-registration-token-2026' : undefined);
  if (regSecret) {
    const token = req.headers['x-registration-token'];
    if (token !== regSecret) {
      return res.status(401).json({ success: false, error: 'Não autorizado: Cabeçalho X-Registration-Token em falta ou inválido.' });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return res.status(401).json({ success: false, error: 'Não autorizado: INP_REGISTRATION_SECRET não se encontra configurado no ambiente de produção.' });
  }
  next();
}

/**
 * Middleware de Resolução de Autenticação e Credenciais:
 * Extrai o token Bearer ou chave X-API-Key e preenche o contexto de segurança (SecurityContext).
 */
app.use(async (req, res, next) => {
  const correlationId = (req.headers['x-correlation-id'] || req.headers['x-request-id'] || uuidv4()) as string;
  let secContext: any = {
    correlationId,
    role: 'ANONYMOUS',
    permissions: []
  };

  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const tokenPayload = AuthService.verifyToken(token);
    if (tokenPayload) {
      secContext = {
        userId: tokenPayload.userId,
        email: tokenPayload.email,
        name: tokenPayload.name,
        role: tokenPayload.role,
        dbaLevel: tokenPayload.dbaLevel,
        company: tokenPayload.company,
        permissions: tokenPayload.permissions,
        correlationId,
        authType: 'JWT'
      };
      (req as any).user = tokenPayload;
    }
  } else if (apiKeyHeader) {
    const keyAuth = await AuthService.authenticateApiKey(apiKeyHeader);
    if (keyAuth) {
      const { user, apiKey } = keyAuth;
      secContext = {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        dbaLevel: user.dbaLevel,
        company: user.company,
        permissions: apiKey.permissions || AccessControl.getPermissionsForRole(user.role, user.dbaLevel),
        correlationId,
        authType: 'API_KEY'
      };
      (req as any).user = user;
      (req as any).apiKey = apiKey;
    }
  }

  (req as any).securityContext = secContext;
  next();
});

/**
 * @description Middleware de controlo de acesso para rotas administrativas ou de simulação de caos.
 *
 * @param {express.Request} req - Pedido HTTP recebido.
 * @param {express.Response} res - Resposta HTTP.
 * @param {express.NextFunction} next - Função de continuidade do middleware.
 * @security Garante que apenas utilizadores com perfil ADMIN ou com permissões adequadas executam ações operacionais.
 * @audit Bloqueia e audita tentativas não autorizadas de manipular estado de serviços.
 */
function requireAdminOrLocal(req: express.Request, res: express.Response, next: express.NextFunction) {
  const secContext = (req as any).securityContext;
  if (secContext) {
    if (secContext.role === 'ADMIN' || secContext.permissions?.includes(PERMISSIONS.CHAOS_MANAGE) || secContext.permissions?.includes(PERMISSIONS.SERVICE_TOGGLE)) {
      return next();
    }
    return res.status(403).json({ success: false, error: 'Acesso negado: Requer privilégios de Administrador.' });
  }

  const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  const token = req.headers['x-registration-token'];
  const regSecret = process.env.INP_REGISTRATION_SECRET || (process.env.NODE_ENV !== 'production' ? 'inp-super-secret-registration-token-2026' : undefined);

  if (process.env.NODE_ENV === 'production') {
    if (!regSecret || token !== regSecret) {
      return res.status(401).json({ success: false, error: 'Não autorizado: Ação administrativa restrita em ambiente de produção.' });
    }
    return next();
  }

  // Em desenvolvimento, permite scripts locais de teste CLI que não enviem cabeçalhos de navegador
  if (isLocalhost && !req.headers['origin'] && !req.headers['referer']) {
    return next();
  }

  if (token && token === regSecret) {
    return next();
  }

  return res.status(401).json({ success: false, error: 'Acesso não autorizado: Inicie sessão com perfil de Administrador.' });
}

let inpCore: INPCore;

// Inicialização da fonte de dados PostgreSQL e arranque do ecossistema INP
AppDataSource.initialize()
  .then(async () => {
    console.log('✅ Base de dados PostgreSQL ligada com sucesso');

    // Aprovisionamento automático de utilizadores predefinidos (Seed)
    await AuthService.seedDefaultUsers();

    inpCore = new INPCore();
    
    // Recuperação automática de Sagas interrompidas com compasso de espera de 5 segundos
    setTimeout(() => {
      SagaRecoveryManager.recoverPendingSagas(inpCore.getRegistry())
        .catch(err => console.error('[Recuperação de Sagas] Erro na recuperação no arranque:', err));
    }, 5000);

    // Inicialização do trabalhador de fila assíncrono de tarefas (Transactional Outbox)
    QueueWorker.start();

    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`🚀 Servidor INP em execução na porta ${port}`));
  })
  .catch(err => {
    console.error('❌ Falha na ligação à base de dados:', err);
    process.exit(1);
  });

/**
 * Rota de Diagnóstico de Saúde da Aplicação (Health Check)
 */
app.get('/health', (req, res) => res.json({ status: 'ok' }));

/**
 * Rota de Streaming de Telemetria em Tempo Real (Server-Sent Events - SSE)
 */
app.get('/api/telemetry', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const telemetry = TelemetryService.getInstance();
  telemetry.addClient(res);

  const cleanup = () => {
    clearInterval(pingInterval);
    telemetry.removeClient(res);
  };

  // Batimento periódico a cada 15 segundos para preservar o túnel TCP aberto com salvaguarda
  const pingInterval = setInterval(() => {
    if (res.writableEnded || (res as any).closed || !res.writable) {
      cleanup();
      return;
    }
    try {
      res.write('event: ping\ndata: {"time":"' + new Date().toISOString() + '"}\n\n');
    } catch {
      cleanup();
    }
  }, 15000);

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('finish', cleanup);
  res.on('error', cleanup);
});

/**
 * Rota de Inspeção do Estado da Base de Dados PostgreSQL
 */
app.get('/api/db-status', (req, res) => {
  res.json({
    success: true,
    connected: AppDataSource.isInitialized,
    name: AppDataSource.options.database
  });
});

/**
 * Rota da Interface Gráfica Principal / Portal Oficial
 */
app.get('/', (req, res) => {
  try {
    let htmlPath = path.join(__dirname, 'portal.html');
    if (!fs.existsSync(htmlPath)) {
      htmlPath = path.join(process.cwd(), 'src', 'api', 'portal.html');
    }
    const html = fs.readFileSync(htmlPath, 'utf8');
    res.send(html);
  } catch (err: any) {
    res.status(500).send('Erro ao carregar o portal administrativo: ' + err.message);
  }
});

/**
 * Rota do Laboratório e Demonstração Interativa
 */
app.get('/demo', (req, res) => {
  try {
    const demoHtmlPath = path.join(process.cwd(), 'examples', 'ecommerce-ecosystem', 'dashboard.html');
    if (fs.existsSync(demoHtmlPath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      const html = fs.readFileSync(demoHtmlPath, 'utf8');
      return res.type('html').send(html);
    }
    res.status(404).send('Painel de demonstração não encontrado.');
  } catch (err: any) {
    res.status(500).send('Erro ao carregar o laboratório: ' + err.message);
  }
});

/**
 * Rota para Registo de Novos Microserviços
 */
app.post('/services/register', apiLimiter, requireRegistrationToken, async (req, res) => {
  try {
    const service: Service = req.body;
    await inpCore.getRegistry().register(service);
    res.json({ success: true, message: 'Serviço registado com sucesso' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Batimento Cardíaco (Heartbeat) de Serviços
 */
app.post('/services/heartbeat/:serviceId', async (req, res) => {
  try {
    await inpCore.getRegistry().heartbeat(req.params.serviceId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota para Listar Serviços Ativos
 */
app.get('/services', async (req, res) => {
  const services = await inpCore.getRegistry().getAllServices();
  res.json({ services });
});

// Mapa de estados de simulação de engenharia de caos em memória
const chaosStates = new Map<string, string>();

/**
 * @description Rota para Listar Todos os Serviços com Métricas Enriquecidas de Telemetria.
 * Exibe endpoints internos e controles de caos exclusivamente para administradores autenticados.
 *
 * @security Mascara endpoints de rede física e estados de injeção de caos para utilizadores públicos.
 * @audit Disponibiliza visibilidade controlada do catálogo em conformidade com as regras PoLP.
 */
app.get('/api/services/all', async (req, res) => {
  try {
    const services = await ServiceRepository.find();
    const secContext = (req as any).securityContext;
    const isAdmin = secContext && (secContext.role === 'ADMIN' || secContext.permissions?.includes(PERMISSIONS.SERVICE_VIEW));

    const collector = ServiceMetricsCollector.getInstance();
    const enrichedServices = services.map(s => {
      const metric = collector.getServiceMetric(s.id);
      const healthScore = collector.getHealthScore(s.id, s.trustScore);
      return {
        ...s,
        endpoint: isAdmin ? (s.endpoint || 'Local Handler') : 'Roteamento Interno Gateway',
        status: metric ? metric.status : 'HEALTHY',
        avgLatency: metric && metric.latencies.length > 0
          ? Math.round(metric.latencies.reduce((a, b) => a + b, 0) / metric.latencies.length)
          : null,
        errorRate: metric ? (metric.failureCount / (metric.successCount + metric.failureCount || 1)) : 0,
        healthScore: Math.round(healthScore * 100),
        chaosState: isAdmin ? (chaosStates.get(s.id) || 'HEALTHY') : undefined
      };
    });

    res.json({ success: true, services: enrichedServices });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Injeção de Falhas para Engenharia de Caos (Chaos Engineering)
 */
app.post('/api/chaos', apiLimiter, requireAdminOrLocal, async (req, res) => {
  try {
    const { serviceId, state } = req.body;
    chaosStates.set(serviceId, state);
    const services = await inpCore.getRegistry().getAllServices();
    const service = services.find(s => s.id === serviceId);
    
    if (!service) {
      const dbService = await ServiceRepository.findOneBy({ id: serviceId });
      if (!dbService) {
        return res.status(404).json({ success: false, error: 'Serviço não encontrado no catálogo nem na BD' });
      }
      if (dbService.endpoint) NetworkSecurity.validateEndpoint(dbService.endpoint);
      const response = await axios.post(`${dbService.endpoint}/chaos`, { state }, { timeout: 5000 });
      return res.json({ success: true, forwardResponse: response.data });
    }

    if (service.endpoint) NetworkSecurity.validateEndpoint(service.endpoint);
    const response = await axios.post(`${service.endpoint}/chaos`, { state }, { timeout: 5000 });
    res.json({ success: true, forwardResponse: response.data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota para Ativar ou Desativar um Serviço Manualmente
 */
app.post('/api/services/:id/toggle-active', apiLimiter, requireAdminOrLocal, async (req, res) => {
  try {
    const { id } = req.params;
    const service = await ServiceRepository.findOneBy({ id });
    if (!service) {
      return res.status(404).json({ success: false, error: 'Serviço não encontrado' });
    }
    service.active = !service.active;
    await ServiceRepository.save(service);
    await RegistryCache.invalidate();
    res.json({ success: true, active: service.active });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @description Converte erros técnicos de validação em mensagens amigáveis de conversação para o utilizador.
 *
 * @param {string} errMsg - Mensagem original de erro.
 * @returns {string | undefined} Mensagem amigável adaptada ou undefined.
 */
function getConversationalMsg(errMsg: string): string | undefined {
  if (errMsg.includes('Contract Violation') || errMsg.includes('validation failed') || errMsg.includes('Strict validation failed')) {
    if (errMsg.includes('amount must be') || errMsg.includes('amount is required') || errMsg.includes('amount should be')) {
      return 'Parece que o valor da transação está incorreto ou em falta. O serviço de pagamentos exige um valor mínimo (mínimo de 1.00). Qual o montante correto que deseja processar?';
    } else if (errMsg.includes('card_token')) {
      return 'Para concluir esta operação, o serviço de pagamentos exige um token de cartão válido (card_token). Poderia facultar o token do cartão?';
    } else if (errMsg.includes('user_id')) {
      return 'Não foi possível identificar o identificador de utilizador (user_id) associado a esta operação. Por favor, forneça o ID de utilizador para prosseguirmos.';
    }
    return 'Lamentamos, ocorreu um problema com os parâmetros facultados: ' + (errMsg.split('Details:')[1] || errMsg);
  }
  return undefined;
}

/**
 * Rota Central para Processamento de Intenções (DSL ou Linguagem Natural)
 * Suporta execução síncrona imediata ou assíncrona desacoplada via fila de trabalhos.
 */
app.post('/api/intent', apiLimiter, async (req, res) => {
  const { text, type, securityContext, async } = req.body;
  if (!text) {
    return res.status(400).json({ success: false, error: 'O parâmetro "text" da intenção é obrigatório.' });
  }
  try {
    const executionId = uuidv4();
    const correlationId = req.headers['x-correlation-id'] as string;
    
    // Resolução de credenciais autenticadas vs contexto explícito
    const authenticatedContext = (req as any).securityContext || {};
    const effectiveUserId = authenticatedContext.userId || securityContext?.userId;
    const effectiveRole = authenticatedContext.role || securityContext?.role || 'ANONYMOUS';
    const effectivePermissions = authenticatedContext.permissions?.length
      ? authenticatedContext.permissions
      : (securityContext?.permissions || []);

    // Verificação e débito de quota de execução para clientes Empresa e Individuais
    if (authenticatedContext.userId && (effectiveRole === 'CLIENT_INDIVIDUAL' || effectiveRole === 'CLIENT_ENTERPRISE')) {
      const dbUser = await UserRepository.findOneBy({ id: authenticatedContext.userId });
      if (dbUser) {
        if (dbUser.quotaUsed >= dbUser.quotaLimit) {
          return res.status(429).json({
            success: false,
            error: `Quota mensal de intenções excedida (${dbUser.quotaUsed}/${dbUser.quotaLimit}). Por favor, atualize o seu plano para prosseguir.`
          });
        }
        dbUser.quotaUsed += 1;
        await UserRepository.save(dbUser);
      }
    }

    const secContext = {
      correlationId,
      ...authenticatedContext,
      ...(securityContext || {}),
      userId: effectiveUserId,
      role: effectiveRole,
      permissions: effectivePermissions
    };

    if (async === true) {
      // Padrão Transactional Outbox: Regista a tarefa em fila e devolve o ID de execução de imediato
      await QueueJobRepository.save({
        sagaId: uuidv4(),
        executionId,
        taskType: 'FLOW_EXECUTION',
        payload: {
          text,
          isNaturalLanguage: type === 'natural',
          securityContext: secContext,
          executionId
        },
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        scheduledAt: new Date()
      });
      
      res.json({
        success: true,
        result: {
          status: 'PENDING',
          execution_id: executionId,
          message: 'Intenção enfileirada com sucesso para processamento assíncrono.'
        }
      });
    } else {
      // Execução síncrona em linha
      const core = new INPCore(undefined, secContext);
      const result = await core.processIntent(text, type === 'natural');
      
      const responseData: any = { success: true, result };
      if (type === 'natural' && result.status === 'FAILED' && result.error) {
        const convMsg = getConversationalMsg(result.error);
        if (convMsg) {
          responseData.conversationalResponse = convMsg;
        }
      }
      res.json(responseData);
    }
  } catch (err: any) {
    const errMsg = err.message || '';
    const responseData: any = { success: false, error: errMsg };
    if (type === 'natural') {
      const convMsg = getConversationalMsg(errMsg);
      if (convMsg) {
        responseData.conversationalResponse = convMsg;
      }
    }
    res.status(500).json(responseData);
  }
});

/**
 * Rota de Estatísticas Gerais do Painel de Controlo
 */
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const serviceCount = await ServiceRepository.count({ where: { active: true } });
    const totalExecutions = await ExecutionRepository.count();
    const failedExecutions = await ExecutionRepository.count({ where: { status: 'FAILED' } });
    const completedExecutions = await ExecutionRepository.count({ where: { status: 'COMPLETED' } });
    
    const rawStats = await ExecutionRepository
      .createQueryBuilder('execution')
      .select('AVG(EXTRACT(EPOCH FROM (execution.completed_at - execution.started_at)) * 1000)', 'avgDuration')
      .where("execution.status = 'COMPLETED'")
      .getRawOne();
      
    res.json({
      success: true,
      stats: {
        activeServices: serviceCount,
        totalExecutions,
        failedExecutions,
        completedExecutions,
        avgDurationMs: Math.round(parseFloat(rawStats?.avgDuration || '0'))
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @description Rota de Consulta das Execuções Transacionais com Isolamento RBAC e Mascaramento.
 * Exibe todas as execuções para Administradores e Auditores, e apenas as próprias execuções para Clientes.
 *
 * @security Bloqueia o acesso público indiscriminado a dados transacionais e executa sanitização integral de PII.
 * @audit Permite aos auditores e administradores inspecionar o histórico forense com integridade.
 */
app.get('/api/dashboard/executions', async (req, res) => {
  try {
    const secContext = (req as any).securityContext;
    const hasFullAccess = secContext && (secContext.role === 'ADMIN' || secContext.role === 'AUDITOR' || secContext.role === 'SECOPS' || secContext.permissions?.includes(PERMISSIONS.INTENT_VIEW_ALL));
    const hasOwnAccess = secContext && secContext.userId && (secContext.permissions?.includes(PERMISSIONS.INTENT_VIEW_OWN) || secContext.role === 'CLIENT_ENTERPRISE' || secContext.role === 'CLIENT_INDIVIDUAL');

    let executions: any[] = [];
    if (hasFullAccess) {
      executions = await ExecutionRepository.find({
        order: { startedAt: 'DESC' },
        take: 50
      });
    } else if (hasOwnAccess) {
      executions = await ExecutionRepository.find({
        where: { userId: secContext.userId },
        order: { startedAt: 'DESC' },
        take: 50
      });
    } else {
      return res.json({
        success: true,
        executions: [],
        message: 'Histórico de execuções confidencial: Apenas utilizadores autenticados com permissões podem aceder aos seus registos.'
      });
    }

    // MEDIDA DE SEGURANÇA: Mascaramento integral de PII e segredos antes do envio para o browser
    res.json({ success: true, executions: DataSanitizer.sanitize(executions) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Exportação da Coleção Postman
 */
app.get('/api/export/postman', (req, res) => {
  const host = req.get('host') || 'localhost:3000';
  const postman = {
    info: {
      name: "INP Protocol Collection",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: [
      {
        name: "Execute Intent (DSL)",
        request: {
          method: "POST",
          header: [
            { key: "Content-Type", value: "application/json" }
          ],
          body: {
            mode: "raw",
            raw: JSON.stringify({
              text: 'INTENT "buy_product" {\n  CONTEXT { amount: 250.75, user_id: "usr_22", card_token: "tok_secure123" }\n  REQUIRE { EXECUTE PAYMENT }\n  FLOW { SEQUENCE { EXECUTE PAYMENT } }\n  OUTPUT { FORMAT "json" }\n}',
              type: "dsl",
              securityContext: { userId: "usr_22", permissions: ["payments.write"] }
            }, null, 2)
          },
          url: { raw: `http://${host}/api/intent` }
        }
      },
      {
        name: "Execute Intent (Natural Language)",
        request: {
          method: "POST",
          header: [
            { key: "Content-Type", value: "application/json" }
          ],
          body: {
            mode: "raw",
            raw: JSON.stringify({
              text: "Quero pagar 150 euros para o utilizador usr_22 com o cartão tok_secure123",
              type: "natural"
            }, null, 2)
          },
          url: { raw: `http://${host}/api/intent` }
        }
      },
      {
        name: "Register Service",
        request: {
          method: "POST",
          header: [
            { key: "Content-Type", value: "application/json" },
            { key: "X-Registration-Token", value: "inp-super-secret-registration-token-2026" }
          ],
          body: {
            mode: "raw",
            raw: JSON.stringify({
              id: "my-custom-service",
              name: "Custom Payment Service",
              capabilities: [
                { verb: "EXECUTE", target: "PAYMENT", description: "Process standard payment" }
              ],
              trustScore: 100,
              securityLevel: "HIGH",
              endpoint: "http://localhost:3001"
            }, null, 2)
          },
          url: { raw: `http://${host}/services/register` }
        }
      },
      {
        name: "List Active Services",
        request: {
          method: "GET",
          url: { raw: `http://${host}/services` }
        }
      },
      {
        name: "Dashboard Stats",
        request: {
          method: "GET",
          url: { raw: `http://${host}/api/dashboard/stats` }
        }
      }
    ]
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=inp-collection.postman_collection.json');
  res.send(JSON.stringify(postman, null, 2));
});

/**
 * Rota de Descarregamento de Esqueleto do SDK Node.js
 */
app.get('/api/export/sdk', (req, res) => {
  const host = req.get('host') || 'localhost:3000';
  const sdk = `
/**
 * INP Protocol Node.js Client SDK
 * Gerado automaticamente para integração de microserviços e consumidores.
 */
const axios = require('axios');

class INPClient {
  constructor(baseUrl = 'http://${host}', registrationToken = 'inp-super-secret-registration-token-2026') {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'X-Registration-Token': registrationToken
      }
    });
  }

  /**
   * Executa uma intenção (linguagem natural ou DSL formal)
   */
  async executeIntent(text, type = 'dsl', securityContext = {}, isAsync = false) {
    const response = await this.client.post('/api/intent', {
      text,
      type,
      securityContext,
      async: isAsync
    });
    return response.data;
  }

  /**
   * Regista um microserviço e respetivas capacidades
   */
  async registerService(serviceConfig) {
    const response = await this.client.post('/services/register', serviceConfig);
    return response.data;
  }

  /**
   * Envia batimento cardíaco para manter o serviço ativo
   */
  async sendHeartbeat(serviceId) {
    const response = await this.client.post(\`/services/heartbeat/\${serviceId}\`);
    return response.data;
  }
}

module.exports = INPClient;
  `.trim();
  res.setHeader('Content-Type', 'text/javascript');
  res.setHeader('Content-Disposition', 'attachment; filename=inp-sdk.js');
  res.send(sdk);
});

/**
 * Rota de Registo de Nós Parceiros na Federação P2P
 */
app.post('/api/peers/register', apiLimiter, requireRegistrationToken, async (req, res) => {
  try {
    const { id, name, endpoint, publicKey, capabilities } = req.body;
    if (!id || !name || !endpoint || !publicKey) {
      return res.status(400).json({ success: false, error: 'Parâmetros obrigatórios em falta (id, name, endpoint, publicKey)' });
    }

    const peerId = `peer-${id}`;
    await inpCore.getRegistry().register({
      id: peerId,
      name: `[Parceiro Federado] ${name}`,
      trustScore: 70,
      securityLevel: 'MEDIUM',
      endpoint: endpoint,
      capabilities: capabilities || []
    });

    IntentFederation.getInstance().registerPeer({ id, name, endpoint, publicKey });
    res.json({ success: true, message: `Portal parceiro "${name}" registado com sucesso.` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Execução Delegada entre Nós Federados com Assinatura Criptográfica
 */
app.post('/api/peers/execute', apiLimiter, async (req, res) => {
  const { text, requesterPublicKey, signature } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ success: false, error: 'Texto da intenção em falta ou inválido' });
  }

  // Se o solicitante enviar a chave pública e assinatura digital, valida a autenticidade
  if (requesterPublicKey && signature) {
    const isValid = IntentFederation.getInstance().verifySignature(text, signature, requesterPublicKey);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Não autorizado: Assinatura digital do parceiro inválida.' });
    }
  }

  try {
    const core = new INPCore();
    const result = await core.processIntent(text, false);
    
    // Assina a resposta com a chave privada deste portal antes de a devolver
    const resSignature = IntentFederation.getInstance().signPayload(result);
    res.json({
      success: true,
      result,
      signature: resSignature
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// ROTAS DO SISTEMA DE ACESSO E AUTENTICAÇÃO (AUTH & PERFIS)
// ============================================================================

/**
 * Rota de Início de Sessão (Login):
 * Autentica o utilizador por email e palavra-passe, emitindo um token criptográfico assinado.
 */
app.post('/api/auth/login', apiLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email e palavra-passe são obrigatórios.' });
    }

    const user = await UserRepository.findOneBy({ email: email.toLowerCase().trim() });
    if (!user) {
      await AuthService.logAudit({
        userEmail: email,
        action: 'LOGIN_FAILED',
        resource: '/api/auth/login',
        status: 'DENIED',
        details: { reason: 'Utilizador não encontrado' },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        correlationId: req.headers['x-correlation-id'] as string
      });
      return res.status(401).json({ success: false, error: 'Credenciais inválidas.' });
    }

    if (!user.active) {
      return res.status(403).json({ success: false, error: 'Esta conta de utilizador encontra-se inativa. Contacte o Administrador.' });
    }

    const isValid = AuthService.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      await AuthService.logAudit({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: 'LOGIN_FAILED',
        resource: '/api/auth/login',
        status: 'DENIED',
        details: { reason: 'Palavra-passe incorreta' },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        correlationId: req.headers['x-correlation-id'] as string
      });
      return res.status(401).json({ success: false, error: 'Credenciais inválidas.' });
    }

    user.lastLoginAt = new Date();
    await UserRepository.save(user);

    const token = AuthService.generateToken(user);
    const permissions = AccessControl.getPermissionsForRole(user.role, user.dbaLevel);

    await AuthService.logAudit({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: 'LOGIN_SUCCESS',
      resource: '/api/auth/login',
      status: 'SUCCESS',
      details: { role: user.role, dbaLevel: user.dbaLevel },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      correlationId: req.headers['x-correlation-id'] as string
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        dbaLevel: user.dbaLevel,
        company: user.company,
        quotaLimit: user.quotaLimit,
        quotaUsed: user.quotaUsed,
        permissions
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Registo Público de Novos Utilizadores (Cadastro):
 * Permite o auto-registo com atribuição de perfil (Individual, Empresa, DBA ou Auditor),
 * validação criptográfica de palavra-passe e emissão imediata de token de sessão.
 */
app.post('/api/auth/register', apiLimiter, async (req, res) => {
  try {
    const { name, email, password, role, company, dbaLevel } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Nome, email e palavra-passe são obrigatórios.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = String(email).toLowerCase().trim();
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Formato de endereço de email inválido.' });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'A palavra-passe deve ter pelo menos 6 caracteres.' });
    }

    // Papéis públicos elegíveis para auto-registo (restringe ADMIN por segurança)
    const allowedRoles: UserRole[] = ['CLIENT_INDIVIDUAL', 'CLIENT_ENTERPRISE', 'DBA', 'AUDITOR'];
    const chosenRole: UserRole = allowedRoles.includes(role) ? role : 'CLIENT_INDIVIDUAL';

    const existing = await UserRepository.findOneBy({ email: cleanEmail });
    if (existing) {
      await AuthService.logAudit({
        userEmail: cleanEmail,
        action: 'REGISTER_FAILED',
        resource: '/api/auth/register',
        status: 'DENIED',
        details: { reason: 'Email já registado' },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        correlationId: req.headers['x-correlation-id'] as string
      });
      return res.status(409).json({ success: false, error: 'Este endereço de email já se encontra registado no sistema.' });
    }

    // Atribuição de cotas padrão por perfil
    let quotaLimit = 1000;
    if (chosenRole === 'CLIENT_ENTERPRISE') quotaLimit = 100000;
    else if (chosenRole === 'DBA' || chosenRole === 'AUDITOR') quotaLimit = 25000;

    const parsedDbaLevel = chosenRole === 'DBA' ? (Number(dbaLevel) === 2 ? 2 : Number(dbaLevel) === 3 ? 3 : 1) as DbaLevel : undefined;

    const newUser = UserRepository.create({
      email: cleanEmail,
      name: String(name).trim(),
      passwordHash: AuthService.hashPassword(password),
      role: chosenRole,
      dbaLevel: parsedDbaLevel,
      company: company ? String(company).trim() : (chosenRole === 'CLIENT_ENTERPRISE' ? 'Empresa Sem Nome' : undefined),
      quotaLimit,
      quotaUsed: 0,
      active: true
    });

    const saved = await UserRepository.save(newUser);
    const token = AuthService.generateToken(saved);
    const permissions = AccessControl.getPermissionsForRole(saved.role, saved.dbaLevel);

    await AuthService.logAudit({
      userId: saved.id,
      userEmail: saved.email,
      userRole: saved.role,
      action: 'USER_REGISTERED',
      resource: '/api/auth/register',
      status: 'SUCCESS',
      details: { role: saved.role, dbaLevel: saved.dbaLevel, company: saved.company },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      correlationId: req.headers['x-correlation-id'] as string
    });

    res.status(201).json({
      success: true,
      message: 'Registo efetuado com sucesso! Sessão iniciada.',
      token,
      user: {
        id: saved.id,
        email: saved.email,
        name: saved.name,
        role: saved.role,
        dbaLevel: saved.dbaLevel,
        company: saved.company,
        quotaLimit: saved.quotaLimit,
        quotaUsed: saved.quotaUsed,
        permissions
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Obtenção do Perfil Autenticado Corrente:
 */
app.get('/api/auth/me', async (req, res) => {
  const secContext = (req as any).securityContext;
  if (!secContext || !secContext.userId || secContext.role === 'ANONYMOUS') {
    return res.status(401).json({ success: false, error: 'Não autenticado.' });
  }

  try {
    const user = await UserRepository.findOneBy({ id: secContext.userId });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Utilizador não encontrado.' });
    }

    const permissions = AccessControl.getPermissionsForRole(user.role, user.dbaLevel);
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        dbaLevel: user.dbaLevel,
        company: user.company,
        quotaLimit: user.quotaLimit,
        quotaUsed: user.quotaUsed,
        active: user.active,
        permissions
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Listagem de Utilizadores (Restrita a Administrador):
 */
app.get('/api/auth/users', AccessControl.requireRole('ADMIN'), async (req, res) => {
  try {
    const users = await UserRepository.find({
      order: { createdAt: 'DESC' }
    });
    const sanitized = users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      dbaLevel: u.dbaLevel,
      company: u.company,
      quotaLimit: u.quotaLimit,
      quotaUsed: u.quotaUsed,
      active: u.active,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt
    }));
    res.json({ success: true, users: sanitized });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Criação de Novos Utilizadores (Restrita a Administrador):
 */
app.post('/api/auth/users', AccessControl.requireRole('ADMIN'), async (req, res) => {
  try {
    const { email, name, password, role, dbaLevel, company, quotaLimit } = req.body;
    if (!email || !name || !password || !role) {
      return res.status(400).json({ success: false, error: 'Email, nome, palavra-passe e papel são obrigatórios.' });
    }

    const existing = await UserRepository.findOneBy({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ success: false, error: 'Já existe um utilizador registado com este endereço de email.' });
    }

    const newUser = UserRepository.create({
      email: email.toLowerCase().trim(),
      name: name.trim(),
      passwordHash: AuthService.hashPassword(password),
      role: role as UserRole,
      dbaLevel: role === 'DBA' ? (dbaLevel || 1) : undefined,
      company: company ? company.trim() : undefined,
      quotaLimit: quotaLimit || 1000,
      quotaUsed: 0,
      active: true
    });

    const saved = await UserRepository.save(newUser);

    await AuthService.logAudit({
      userId: (req as any).securityContext?.userId,
      userEmail: (req as any).securityContext?.email,
      userRole: (req as any).securityContext?.role,
      action: 'USER_CREATED',
      resource: `user:${saved.id}`,
      status: 'SUCCESS',
      details: { email: saved.email, role: saved.role, dbaLevel: saved.dbaLevel }
    });

    res.json({
      success: true,
      message: 'Utilizador criado com sucesso.',
      user: {
        id: saved.id,
        email: saved.email,
        name: saved.name,
        role: saved.role,
        dbaLevel: saved.dbaLevel,
        company: saved.company,
        quotaLimit: saved.quotaLimit,
        active: saved.active
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Alternância de Estado do Utilizador Ativo/Inativo (Restrita a Administrador):
 */
app.post('/api/auth/users/:id/toggle', AccessControl.requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = await UserRepository.findOneBy({ id });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Utilizador não encontrado.' });
    }

    user.active = !user.active;
    await UserRepository.save(user);

    await AuthService.logAudit({
      userId: (req as any).securityContext?.userId,
      userEmail: (req as any).securityContext?.email,
      userRole: (req as any).securityContext?.role,
      action: 'USER_STATUS_TOGGLED',
      resource: `user:${user.id}`,
      status: 'SUCCESS',
      details: { targetEmail: user.email, active: user.active }
    });

    res.json({ success: true, active: user.active, message: `Estado do utilizador alterado para ${user.active ? 'Ativo' : 'Inativo'}.` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Listagem de Chaves de API:
 */
app.get('/api/auth/api-keys', AccessControl.requirePermission(PERMISSIONS.APIKEY_MANAGE_OWN), async (req, res) => {
  try {
    const secContext = (req as any).securityContext;
    const whereClause: any = {};
    if (secContext.role !== 'ADMIN') {
      whereClause.userId = secContext.userId;
    }
    const keys = await ApiKeyRepository.find({
      where: whereClause,
      order: { createdAt: 'DESC' }
    });
    res.json({ success: true, apiKeys: keys });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Emissão de Nova Chave de API:
 */
app.post('/api/auth/api-keys', AccessControl.requirePermission(PERMISSIONS.APIKEY_MANAGE_OWN), async (req, res) => {
  try {
    const secContext = (req as any).securityContext;
    const { name, permissions, expiresInDays } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'O nome identificador da chave de API é obrigatório.' });
    }

    const { apiKey, secretKey } = await AuthService.createApiKey(
      secContext.userId,
      name,
      permissions,
      expiresInDays
    );

    res.json({
      success: true,
      message: 'Chave de API criada com sucesso. Guarde o segredo agora, pois não será exibido novamente.',
      apiKey,
      secretKey
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Revogação de Chave de API:
 */
app.delete('/api/auth/api-keys/:id', AccessControl.requirePermission(PERMISSIONS.APIKEY_MANAGE_OWN), async (req, res) => {
  try {
    const { id } = req.params;
    const secContext = (req as any).securityContext;
    const key = await ApiKeyRepository.findOneBy({ id });
    if (!key) {
      return res.status(404).json({ success: false, error: 'Chave de API não encontrada.' });
    }
    if (secContext.role !== 'ADMIN' && key.userId !== secContext.userId) {
      return res.status(403).json({ success: false, error: 'Apenas o proprietário ou um Administrador pode revogar esta chave.' });
    }

    key.active = false;
    await ApiKeyRepository.save(key);

    await AuthService.logAudit({
      userId: secContext.userId,
      userEmail: secContext.email,
      userRole: secContext.role,
      action: 'API_KEY_REVOKED',
      resource: `apikey:${id}`,
      status: 'SUCCESS',
      details: { keyName: key.name }
    });

    res.json({ success: true, message: 'Chave de API revogada com sucesso.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// ROTAS DE AUDITORIA E CONFORMIDADE (AUDITORES E ADMIN)
// ============================================================================

/**
 * Rota de Consulta de Registos de Auditoria Forense:
 */
app.get('/api/audit/logs', AccessControl.requirePermission(PERMISSIONS.AUDIT_READ), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string || '50', 10);
    const action = req.query.action as string | undefined;
    const status = req.query.status as string | undefined;

    const queryBuilder = AuditLogRepository.createQueryBuilder('log')
      .orderBy('log.created_at', 'DESC')
      .take(limit);

    if (action) {
      queryBuilder.andWhere('log.action = :action', { action });
    }
    if (status) {
      queryBuilder.andWhere('log.status = :status', { status });
    }

    const logs = await queryBuilder.getMany();
    res.json({ success: true, logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Resumo de Conformidade e Métricas de Auditoria:
 */
app.get('/api/audit/summary', AccessControl.requirePermission(PERMISSIONS.AUDIT_READ), async (req, res) => {
  try {
    const totalLogs = await AuditLogRepository.count();
    const deniedEvents = await AuditLogRepository.count({ where: { status: 'DENIED' } });
    const successEvents = await AuditLogRepository.count({ where: { status: 'SUCCESS' } });
    const loginsCount = await AuditLogRepository.count({ where: { action: 'LOGIN_SUCCESS' } });
    const dbaEvents = await AuditLogRepository
      .createQueryBuilder('log')
      .where("log.action LIKE 'DBA_%'")
      .getCount();

    res.json({
      success: true,
      summary: {
        totalLogs,
        deniedEvents,
        successEvents,
        loginsCount,
        dbaEvents,
        complianceScore: totalLogs > 0 ? Math.round(((totalLogs - deniedEvents) / totalLogs) * 100) : 100
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// ROTAS DE GESTÃO DE BASE DE DADOS (DBA NÍVEL 1, 2 E 3)
// ============================================================================

/**
 * Rota de Métricas e Saúde da Base de Dados (DBA Nível 1+):
 */
app.get('/api/dba/overview', AccessControl.requireDbaLevel(1), async (req, res) => {
  try {
    const overview = await DBAService.getOverview();
    res.json({ success: true, overview });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Inspeção da Dead Letter Queue (DBA Nível 2+):
 */
app.get('/api/dba/dlq', AccessControl.requireDbaLevel(2), async (req, res) => {
  try {
    const items = await DBAService.getDeadLetterQueueItems();
    res.json({ success: true, items });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Reprocessamento de Mensagem da Dead Letter Queue (DBA Nível 2+):
 */
app.post('/api/dba/dlq/retry/:id', AccessControl.requireDbaLevel(2), async (req, res) => {
  try {
    const result = await DBAService.retryDeadLetterItem(req.params.id, (req as any).securityContext);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Limpeza Integral da Dead Letter Queue (DBA Nível 2+):
 */
app.post('/api/dba/dlq/purge', AccessControl.requireDbaLevel(2), async (req, res) => {
  try {
    const result = await DBAService.purgeDeadLetterQueue((req as any).securityContext);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Manutenção Preventiva VACUUM ANALYZE (DBA Nível 3 & Admin):
 */
app.post('/api/dba/maintenance/vacuum', AccessControl.requireDbaLevel(3), async (req, res) => {
  try {
    const result = await DBAService.runVacuumAnalyze(req.body.targetTable, (req as any).securityContext);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Rota de Execução de Consultas Diagnósticas no Sandbox SQL (DBA Nível 3 & Admin):
 */
app.post('/api/dba/query', AccessControl.requireDbaLevel(3), async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, error: 'A consulta SQL de diagnóstico é obrigatória.' });
    }
    const result = await DBAService.executeDiagnosticQuery(query, (req as any).securityContext);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Middleware Global de Tratamento e Captura de Erros do Express:
 */
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'O tamanho da carga útil (payload) excedeu o limite permitido.' });
  }
  console.error('[Express Error Handler]', err.message || err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Erro interno no servidor' });
  }
});