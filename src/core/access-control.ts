/**
 * @fileoverview Motor de Controlo de Acesso Baseado em Papéis e Permissões (RBAC / ABAC)
 * @module Core/AccessControl
 * @description
 * Define a matriz de autorizações granulares, os privilégios atribuídos a cada perfil
 * (Administrador, Cliente Empresa, Cliente Independente, Auditor, DBA e outros) e os níveis
 * operacionais para Administradores de Base de Dados (DBA Níveis 1, 2 e 3).
 * Disponibiliza métodos utilitários de avaliação de segurança e middlewares de proteção
 * para integração com rotas HTTP do Express.
 *
 * @security Bloqueia acessos não autorizados segundo o princípio do menor privilégio (PoLP).
 * @audit Cada recusa ou validação de permissão pode ser auditada para deteção de acessos indevidos.
 */

import { Request, Response, NextFunction } from 'express';
import { UserRole, DbaLevel } from '../persistence/entities/User';
import { SecurityContext } from './types';

/**
 * @description Catálogo canónico de permissões atómicas do protocolo INP.
 */
export const PERMISSIONS = {
  // Execução de Intenções
  INTENT_EXECUTE: 'intent:execute',
  INTENT_ASYNC: 'intent:async',
  INTENT_VIEW_OWN: 'intent:view_own',
  INTENT_VIEW_ALL: 'intent:view_all',

  // Gestão de Microsserviços e Rede
  SERVICE_REGISTER: 'service:register',
  SERVICE_TOGGLE: 'service:toggle',
  SERVICE_DELETE: 'service:delete',
  SERVICE_VIEW: 'service:view',

  // Engenharia de Caos & Simulações
  CHAOS_MANAGE: 'chaos:manage',

  // Auditoria e Conformidade
  AUDIT_READ: 'audit:read',
  AUDIT_EXPORT: 'audit:export',
  AUDIT_VERIFY: 'audit:verify',

  // Gestão de Utilizadores e Contas
  USER_MANAGE: 'user:manage',
  USER_VIEW: 'user:view',

  // Chaves de API
  APIKEY_MANAGE_OWN: 'apikey:manage_own',
  APIKEY_MANAGE_ALL: 'apikey:manage_all',

  // Operações de Base de Dados (DBA)
  DBA_MONITOR: 'dba:monitor',     // Nível 1, 2, 3 e Admin
  DBA_OPERATE: 'dba:operate',     // Nível 2, 3 e Admin (DLQ retry/purge, cancel jobs)
  DBA_ADMIN: 'dba:admin',         // Nível 3 e Admin (VACUUM ANALYZE, DDL, Sandbox SQL)

  // Federação P2P
  PEERS_MANAGE: 'peers:manage',
} as const;

/**
 * @description Matriz estática de associação entre papéis de utilizador e permissões concedidas.
 */
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  ADMIN: [
    PERMISSIONS.INTENT_EXECUTE,
    PERMISSIONS.INTENT_ASYNC,
    PERMISSIONS.INTENT_VIEW_OWN,
    PERMISSIONS.INTENT_VIEW_ALL,
    PERMISSIONS.SERVICE_REGISTER,
    PERMISSIONS.SERVICE_TOGGLE,
    PERMISSIONS.SERVICE_DELETE,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.CHAOS_MANAGE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_EXPORT,
    PERMISSIONS.AUDIT_VERIFY,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.USER_VIEW,
    PERMISSIONS.APIKEY_MANAGE_OWN,
    PERMISSIONS.APIKEY_MANAGE_ALL,
    PERMISSIONS.DBA_MONITOR,
    PERMISSIONS.DBA_OPERATE,
    PERMISSIONS.DBA_ADMIN,
    PERMISSIONS.PEERS_MANAGE,
  ],
  CLIENT_ENTERPRISE: [
    PERMISSIONS.INTENT_EXECUTE,
    PERMISSIONS.INTENT_ASYNC,
    PERMISSIONS.INTENT_VIEW_OWN,
    PERMISSIONS.SERVICE_REGISTER,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.APIKEY_MANAGE_OWN,
  ],
  CLIENT_INDIVIDUAL: [
    PERMISSIONS.INTENT_EXECUTE,
    PERMISSIONS.INTENT_ASYNC,
    PERMISSIONS.INTENT_VIEW_OWN,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.APIKEY_MANAGE_OWN,
  ],
  AUDITOR: [
    PERMISSIONS.INTENT_VIEW_ALL,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_EXPORT,
    PERMISSIONS.AUDIT_VERIFY,
    PERMISSIONS.DBA_MONITOR,
  ],
  DBA: [
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.DBA_MONITOR,
  ],
  DEVELOPER: [
    PERMISSIONS.INTENT_EXECUTE,
    PERMISSIONS.INTENT_ASYNC,
    PERMISSIONS.INTENT_VIEW_OWN,
    PERMISSIONS.SERVICE_REGISTER,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.APIKEY_MANAGE_OWN,
  ],
  SECOPS: [
    PERMISSIONS.INTENT_VIEW_ALL,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_EXPORT,
    PERMISSIONS.AUDIT_VERIFY,
    PERMISSIONS.CHAOS_MANAGE,
    PERMISSIONS.DBA_MONITOR,
  ],
};

/**
 * @description Classe responsável pelo controlo de acesso, cálculo de permissões e autorização no INP.
 */
export class AccessControl {
  /** Cache em memória de permissões resolvidas por papel e nível DBA */
  private static rolePermissionsCache = new Map<string, string[]>();

  /**
   * @description Calcula a lista completa e deduplicada de permissões para um utilizador com base no papel e nível DBA.
   *
   * @param {UserRole} role - Papel primordial do utilizador.
   * @param {DbaLevel} [dbaLevel] - Nível hierárquico caso o papel seja 'DBA'.
   * @returns {string[]} Lista de códigos de permissão concedidos.
   * @security Assegura concessão estrita de permissões conforme a hierarquia do utilizador.
   * @audit Regista a determinação de autorizações aplicadas à sessão.
   */
  static getPermissionsForRole(role: UserRole, dbaLevel?: DbaLevel): string[] {
    const key = `${role}:${dbaLevel || 1}`;
    const cached = this.rolePermissionsCache.get(key);
    if (cached) return cached;

    const basePermissions = [...(ROLE_PERMISSIONS[role] || [])];

    if (role === 'DBA') {
      const level = dbaLevel || 1;
      if (level >= 1) {
        if (!basePermissions.includes(PERMISSIONS.DBA_MONITOR)) {
          basePermissions.push(PERMISSIONS.DBA_MONITOR);
        }
      }
      if (level >= 2) {
        basePermissions.push(PERMISSIONS.DBA_OPERATE);
      }
      if (level >= 3) {
        basePermissions.push(PERMISSIONS.DBA_ADMIN);
      }
    }

    const result = Array.from(new Set(basePermissions));
    this.rolePermissionsCache.set(key, result);
    return result;
  }

  /**
   * @description Avalia se um determinado contexto de segurança possui a permissão solicitada.
   *
   * @param {SecurityContext | undefined} context - Contexto de segurança contendo as permissões do utilizador.
   * @param {string} permission - Identificador da permissão requerida.
   * @returns {boolean} Verdadeiro se a permissão estiver presente ou se for superadministrador.
   * @security Validação atómica de permissão antes de executar ações protegidas.
   * @audit Ponto de decisão para auditoria de controlo de acessos.
   */
  static hasPermission(context: SecurityContext | undefined, permission: string): boolean {
    if (!context) return false;
    if (context.role === 'ADMIN' || context.roles?.includes('ADMIN')) return true;
    const permissions = context.permissions || [];
    return permissions.includes(permission);
  }

  /**
   * @description Verifica se o utilizador possui o nível mínimo de DBA exigido (ou se é Administrador).
   *
   * @param {SecurityContext | undefined} context - Contexto de segurança ativo.
   * @param {DbaLevel} minLevel - Nível de privilégio mínimo requerido (1, 2 ou 3).
   * @returns {boolean} Verdadeiro se o utilizador cumpre o nível ou se é Administrador.
   * @security Impede que DBAs de menor privilégio executem operações avançadas de manutenção ou DDL.
   * @audit Essencial para garantir a separação de deveres (Separation of Duties).
   */
  static hasDbaLevel(context: SecurityContext | undefined, minLevel: DbaLevel): boolean {
    if (!context) return false;
    if (context.role === 'ADMIN' || context.roles?.includes('ADMIN')) return true;
    if (context.role !== 'DBA') return false;
    const level = context.dbaLevel || 1;
    return level >= minLevel;
  }

  /**
   * @description Middleware Express que valida se o pedido autenticado possui a permissão requerida.
   *
   * @param {string} permission - Permissão obrigatória para aceder à rota.
   * @returns {(req: Request, res: Response, next: NextFunction) => void} Função de middleware Express.
   * @security Bloqueia o processamento HTTP com código 403 Forbidden caso a permissão falte.
   * @audit Envia resposta estruturada para registo imediato de violação de segurança.
   */
  static requirePermission(permission: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const secContext: SecurityContext | undefined = (req as any).securityContext;
      if (!secContext || !AccessControl.hasPermission(secContext, permission)) {
        res.status(403).json({
          success: false,
          error: `Acesso negado: Permissão "${permission}" requerida.`,
          requiredPermission: permission,
          userRole: secContext?.role || 'ANONYMOUS'
        });
        return;
      }
      next();
    };
  }

  /**
   * @description Middleware Express que restringe a rota aos papéis autorizados.
   *
   * @param {UserRole[]} roles - Lista de papéis elegíveis para aceder ao recurso.
   * @returns {(req: Request, res: Response, next: NextFunction) => void} Função de middleware Express.
   * @security Garante isolamento estrito de rotas com base no perfil de utilizador.
   * @audit Gera evento 403 Forbidden rastreável em caso de violação de perfil.
   */
  static requireRole(...roles: UserRole[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const secContext: SecurityContext | undefined = (req as any).securityContext;
      const currentRole = secContext?.role as UserRole | undefined;

      if (!secContext || !currentRole || (!roles.includes(currentRole) && currentRole !== 'ADMIN')) {
        res.status(403).json({
          success: false,
          error: `Acesso restrito aos seguintes papéis: [${roles.join(', ')}].`,
          currentRole: currentRole || 'ANONYMOUS'
        });
        return;
      }
      next();
    };
  }

  /**
   * @description Middleware Express que impõe o nível mínimo hierárquico de DBA para operações na base de dados.
   *
   * @param {DbaLevel} minLevel - Nível mínimo requerido (1: Monitorização, 2: Operações/DLQ, 3: Manutenção/Sandbox).
   * @returns {(req: Request, res: Response, next: NextFunction) => void} Função de middleware Express.
   * @security Assegura que apenas DBAs qualificados com nível adequado (ou Admins) executem ações críticas na base de dados.
   * @audit Previne abuso de privilégios e valida a hierarquia operacional de infraestrutura.
   */
  static requireDbaLevel(minLevel: DbaLevel) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const secContext: SecurityContext | undefined = (req as any).securityContext;
      if (!AccessControl.hasDbaLevel(secContext, minLevel)) {
        res.status(403).json({
          success: false,
          error: `Acesso restrito: Requer privilégio de DBA Nível ${minLevel} ou superior.`,
          userRole: secContext?.role || 'ANONYMOUS',
          currentDbaLevel: secContext?.dbaLevel || 0,
          requiredLevel: minLevel
        });
        return;
      }
      next();
    };
  }
}
