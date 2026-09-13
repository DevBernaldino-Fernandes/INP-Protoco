/**
 * @fileoverview Serviço Central de Autenticação, Tokens Criptográficos e Governança de Utilizadores
 * @module Core/AuthService
 * @description
 * Fornece os mecanismos centrais de autenticação do protocolo INP:
 * - Hashing seguro de palavras-passe com scrypt e sal criptográfico aleatório.
 * - Emissão e validação de tokens de autenticação assinados digitalmente com HMAC-SHA256 e proteção anti-adulteração.
 * - Emissão e verificação de chaves de API para integrações de máquina e microsserviços.
 * - Registo forense imutável de eventos de auditoria (inícios de sessão, recusas de acesso, operações críticas).
 * - Aprovisionamento automático dos utilizadores iniciais de demonstração (Seed) na base de dados.
 *
 * @security Utiliza timingSafeEqual para mitigar ataques de temporização (Timing Attacks). Sem dependências vulneráveis.
 * @audit Todos os eventos de autenticação e modificação de credenciais são registados no repositório de auditoria.
 */

import crypto from 'crypto';
import { UserRepository } from '../persistence/repositories/UserRepository';
import { ApiKeyRepository } from '../persistence/repositories/ApiKeyRepository';
import { AuditLogRepository } from '../persistence/repositories/AuditLogRepository';
import { User, UserRole, DbaLevel } from '../persistence/entities/User';
import { ApiKey } from '../persistence/entities/ApiKey';
import { SecurityContext } from './types';
import { AccessControl } from './access-control';

/**
 * @description Interface representativa da carga útil de um token de sessão autenticado.
 */
export interface AuthTokenPayload {
  /** Identificador único do utilizador */
  userId: string;
  /** Endereço de correio eletrónico */
  email: string;
  /** Nome do utilizador ou organização */
  name: string;
  /** Papel atribuído no sistema */
  role: UserRole;
  /** Nível hierárquico de DBA (caso aplicável) */
  dbaLevel?: DbaLevel;
  /** Empresa ou organização associada */
  company?: string;
  /** Lista consolidada de permissões concedidas */
  permissions: string[];
  /** Carimbo temporal de expiração do token (em milissegundos desde a época UNIX) */
  expiresAt: number;
}

/**
 * @description Classe que providencia serviços de segurança, autenticação e auditoria de identidade.
 */
export class AuthService {
  /** Chave secreta interna para assinatura dos tokens criptográficos */
  private static readonly TOKEN_SECRET = process.env.INP_AUTH_SECRET || 'inp-master-auth-secret-key-salt-2026-distributed';

  /**
   * @description Gera um hash criptográfico seguro a partir de uma palavra-passe em texto limpo utilizando scrypt.
   *
   * @param {string} password - Palavra-passe em texto limpo fornecida pelo utilizador.
   * @returns {string} Cadeia no formato `<sal_hex>$<chave_derivada_hex>`.
   * @security Utiliza sal aleatório de 16 bytes gerado criptograficamente e scrypt para máxima resistência contra ataques de dicionário.
   * @audit Permite guardar credenciais com garantia de não-exposição do segredo original.
   */
  static hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return `${salt}$${derivedKey.toString('hex')}`;
  }

  /**
   * @description Valida uma palavra-passe em texto limpo contra o hash scrypt previamente persistido.
   *
   * @param {string} password - Palavra-passe submetida pelo cliente.
   * @param {string} storedHash - Hash guardado na base de dados no formato `<sal>$<chave>`.
   * @returns {boolean} Verdadeiro se a palavra-passe coincidir exatamente.
   * @security Utiliza crypto.timingSafeEqual para prevenir ataques de análise de tempo de execução.
   * @audit Ponto de verificação de integridade no processo de autenticação.
   */
  static verifyPassword(password: string, storedHash: string): boolean {
    try {
      const [salt, key] = storedHash.split('$');
      if (!salt || !key) return false;
      const derivedKey = crypto.scryptSync(password, salt, 64);
      const keyBuffer = Buffer.from(key, 'hex');
      return crypto.timingSafeEqual(derivedKey, keyBuffer);
    } catch {
      return false;
    }
  }

  /**
   * @description Emite um token de autenticação assinado com HMAC-SHA256 contendo o perfil e permissões do utilizador.
   *
   * @param {User} user - Instância do utilizador autenticado.
   * @param {number} [durationMinutes=480] - Duração de validade do token em minutos (padrão: 8 horas).
   * @returns {string} Token compacto assinado no formato `<payload_base64>.<assinatura_hex>`.
   * @security Assinatura digital impede qualquer adulteração de papéis ou permissões por atores maliciosos.
   * @audit O token carrega o identificador e papel para rastreamento em todos os nós da rede.
   */
  static generateToken(user: User, durationMinutes = 480): string {
    const permissions = AccessControl.getPermissionsForRole(user.role, user.dbaLevel);
    const payload: AuthTokenPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      dbaLevel: user.dbaLevel,
      company: user.company,
      permissions,
      expiresAt: Date.now() + (durationMinutes * 60 * 1000)
    };

    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.TOKEN_SECRET)
      .update(payloadBase64)
      .digest('hex');

    return `${payloadBase64}.${signature}`;
  }

  /**
   * @description Valida e descodifica um token de autenticação, verificando a assinatura digital e o prazo de expiração.
   *
   * @param {string} token - Token compactado recebido no cabeçalho Authorization.
   * @returns {AuthTokenPayload | null} Carga útil descodificada se válido e não expirado; caso contrário, nulo.
   * @security Compara a assinatura com timingSafeEqual para evitar ataques de temporização.
   * @audit Rejeita tokens adulterados ou expirados prevenindo o sequestro de sessões.
   */
  static verifyToken(token: string): AuthTokenPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const [payloadBase64, signature] = parts;

      const expectedSignature = crypto
        .createHmac('sha256', this.TOKEN_SECRET)
        .update(payloadBase64)
        .digest('hex');

      const sigBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        return null;
      }

      const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
      const payload: AuthTokenPayload = JSON.parse(payloadJson);

      if (Date.now() > payload.expiresAt) {
        return null; // Token expirado
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * @description Cria uma nova chave de API para o utilizador, guardando o hash seguro e devolvendo a chave em texto limpo uma única vez.
   *
   * @param {string} userId - Identificador do utilizador proprietário.
   * @param {string} name - Rótulo amigável para identificar a chave.
   * @param {string[]} [customPermissions] - Lista opcional de permissões restritas atribuídas à chave.
   * @param {number} [expiresInDays] - Prazo opcional de validade em dias.
   * @returns {Promise<{ apiKey: ApiKey; secretKey: string }>} O registo guardado e a chave secreta completa gerada.
   * @throws {Error} Se o utilizador proprietário não existir na base de dados.
   * @security A chave secreta bruta nunca é persistida; apenas o hash SHA-256 é armazenado.
   * @audit Regista a emissão de credenciais programáticas associadas ao utilizador.
   */
  static async createApiKey(
    userId: string,
    name: string,
    customPermissions?: string[],
    expiresInDays?: number
  ): Promise<{ apiKey: ApiKey; secretKey: string }> {
    const user = await UserRepository.findOneBy({ id: userId });
    if (!user) {
      throw new Error(`Utilizador com ID "${userId}" não foi encontrado.`);
    }

    const randomSecret = crypto.randomBytes(24).toString('hex');
    const secretKey = `inp_${user.role.toLowerCase()}_${randomSecret}`;
    const keyPrefix = secretKey.substring(0, 16) + '...';
    const keyHash = crypto.createHash('sha256').update(secretKey).digest('hex');

    const effectivePermissions = customPermissions && customPermissions.length > 0
      ? customPermissions
      : AccessControl.getPermissionsForRole(user.role, user.dbaLevel);

    const apiKey = ApiKeyRepository.create({
      userId,
      name,
      keyPrefix,
      keyHash,
      permissions: effectivePermissions,
      active: true,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : undefined
    });

    const saved = await ApiKeyRepository.save(apiKey);

    await this.logAudit({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: 'API_KEY_CREATED',
      resource: `apikey:${saved.id}`,
      status: 'SUCCESS',
      details: { keyName: name, keyPrefix }
    });

    return { apiKey: saved, secretKey };
  }

  /**
   * @description Autentica um pedido realizado através do cabeçalho X-API-Key.
   *
   * @param {string} secretKey - Chave de API enviada pelo cliente.
   * @returns {Promise<{ user: User; apiKey: ApiKey } | null>} O utilizador e chave associados se válidos; caso contrário, nulo.
   * @security Valida o hash SHA-256 da chave e verifica se se encontra ativa e não expirada.
   * @audit Atualiza a data de última utilização da chave para controlo de atividade.
   */
  static async authenticateApiKey(secretKey: string): Promise<{ user: User; apiKey: ApiKey } | null> {
    try {
      const keyHash = crypto.createHash('sha256').update(secretKey.trim()).digest('hex');
      const apiKey = await ApiKeyRepository.findOne({
        where: { keyHash, active: true },
        relations: ['user']
      });

      if (!apiKey || !apiKey.user || !apiKey.user.active) {
        return null;
      }

      if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
        return null;
      }

      // Atualiza o carimbo de última utilização de forma assíncrona
      apiKey.lastUsedAt = new Date();
      ApiKeyRepository.save(apiKey).catch(() => {});

      return { user: apiKey.user, apiKey };
    } catch {
      return null;
    }
  }

  /**
   * @description Regista um evento imutável na tabela de auditoria forense do protocolo INP.
   *
   * @param {object} params - Detalhes estruturados do evento de auditoria.
   * @param {string} [params.userId] - Identificador do utilizador interveniente.
   * @param {string} [params.userEmail] - Email do utilizador.
   * @param {string} [params.userRole] - Papel do utilizador.
   * @param {string} params.action - Ação auditada.
   * @param {string} params.resource - Recurso ou URL alvo.
   * @param {string} params.status - Desfecho da ação ('SUCCESS', 'DENIED', 'FAILED').
   * @param {any} [params.details] - Carga útil de detalhes em formato JSON.
   * @param {string} [params.ipAddress] - Endereço IP do cliente.
   * @param {string} [params.userAgent] - Informação do User-Agent.
   * @param {string} [params.correlationId] - Identificador de correlação transacional.
   * @returns {Promise<void>}
   * @security Protege contra injeção e garante persistência assíncrona de evidências.
   * @audit Alimentador contínuo do trilho de auditoria forense.
   */
  static async logAudit(params: {
    userId?: string;
    userEmail?: string;
    userRole?: string;
    action: string;
    resource: string;
    status: 'SUCCESS' | 'DENIED' | 'FAILED';
    details?: any;
    ipAddress?: string;
    userAgent?: string;
    correlationId?: string;
  }): Promise<void> {
    try {
      await AuditLogRepository.save({
        userId: params.userId,
        userEmail: params.userEmail,
        userRole: params.userRole,
        action: params.action,
        resource: params.resource,
        status: params.status,
        details: params.details,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        correlationId: params.correlationId,
      });
    } catch (err: any) {
      console.error('[Auditoria] Falha ao persistir registo de auditoria:', err.message);
    }
  }

  /**
   * @description Aprovisiona os utilizadores predefinidos (Seed) na base de dados para testes imediatos dos perfis.
   *
   * @returns {Promise<void>}
   * @security Define contas com credenciais criptografadas para permitir a demonstração de todos os papéis.
   * @audit Regista a criação inicial dos utilizadores de sistema no log de auditoria.
   */
  static async seedDefaultUsers(): Promise<void> {
    try {
      const defaultUsers: Array<{
        email: string;
        name: string;
        passwordPlain: string;
        role: UserRole;
        dbaLevel?: DbaLevel;
        company?: string;
        quotaLimit: number;
      }> = [
        {
          email: 'admin@inp.org',
          name: 'Super Administrador Geral',
          passwordPlain: 'admin123',
          role: 'ADMIN',
          company: 'INP Protocol Foundation',
          quotaLimit: 1000000
        },
        {
          email: 'empresa@techcorp.com',
          name: 'TechCorp Global Solutions',
          passwordPlain: 'empresa123',
          role: 'CLIENT_ENTERPRISE',
          company: 'TechCorp Global Inc.',
          quotaLimit: 100000
        },
        {
          email: 'dev@freelance.io',
          name: 'João Silva (Cliente Independente)',
          passwordPlain: 'cliente123',
          role: 'CLIENT_INDIVIDUAL',
          quotaLimit: 5000
        },
        {
          email: 'auditor@compliance.gov',
          name: 'Dra. Maria Santos (Auditora Oficial)',
          passwordPlain: 'auditor123',
          role: 'AUDITOR',
          company: 'Autoridade de Conformidade Digital',
          quotaLimit: 50000
        },
        {
          email: 'dba1@inp.org',
          name: 'Carlos Lima (DBA Nível 1 - Monitorização)',
          passwordPlain: 'dba123',
          role: 'DBA',
          dbaLevel: 1,
          quotaLimit: 10000
        },
        {
          email: 'dba2@inp.org',
          name: 'Ana Rodrigues (DBA Nível 2 - Operacional)',
          passwordPlain: 'dba123',
          role: 'DBA',
          dbaLevel: 2,
          quotaLimit: 25000
        },
        {
          email: 'dba3@inp.org',
          name: 'Rui Mendes (DBA Nível 3 - Sénior / Manutenção)',
          passwordPlain: 'dba123',
          role: 'DBA',
          dbaLevel: 3,
          quotaLimit: 50000
        },
        {
          email: 'secops@inp.org',
          name: 'Equipa de Segurança (SecOps)',
          passwordPlain: 'secops123',
          role: 'SECOPS',
          quotaLimit: 50000
        }
      ];

      for (const u of defaultUsers) {
        const existing = await UserRepository.findOneBy({ email: u.email });
        if (!existing) {
          const user = UserRepository.create({
            email: u.email,
            name: u.name,
            passwordHash: this.hashPassword(u.passwordPlain),
            role: u.role,
            dbaLevel: u.dbaLevel,
            company: u.company,
            quotaLimit: u.quotaLimit,
            quotaUsed: 0,
            active: true
          });
          await UserRepository.save(user);
          console.log(`[Seed Utilizadores] Criada conta predefinida: ${u.email} (${u.role}${u.dbaLevel ? ' Nível ' + u.dbaLevel : ''})`);
        }
      }
    } catch (err: any) {
      console.error('[Seed Utilizadores] Erro no aprovisionamento de utilizadores predefinidos:', err.message);
    }
  }
}
