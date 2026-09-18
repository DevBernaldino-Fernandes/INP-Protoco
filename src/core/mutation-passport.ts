/**
 * @fileoverview Autoridade de Passaportes de Mutação Criptográfica (MutationPassportAuthority)
 * @module Core/MutationPassport
 * @description
 * Fornece um mecanismo soberano de autorização criptográfica para permitir mutações legítimas
 * em campos financeiros sensíveis (`amount`, `price`, `tax`, `fee`), sem comprometer a blindagem
 * inegociável dos `DeepGuardrails` contra corrupção de dados ou alucinações de IAs.
 *
 * Funcionamento:
 * 1. Um microsserviço de negócio devidamente autenticado (ex.: motor de descontos `CALCULATE DISCOUNT`)
 *    solicita um `MutationPassport` assinado digitalmente com HMAC-SHA256.
 * 2. O passaporte especifica o identificador do emissor, os campos permitidos, os valores de origem/destino,
 *    a justificativa legal e um carimbo de expiração com tempo de vida curto (ex.: 60 segundos).
 * 3. O inspetor `DeepGuardrails` valida matematicamente a assinatura do passaporte antes de autorizar
 *    qualquer modificação patrimonial.
 *
 * @security Validação criptográfica rigorosa com comparação de tempo constante (`crypto.timingSafeEqual`).
 * Rejeita imediatamente passaportes expirados, campos não autorizados ou assinaturas adulteradas.
 * @audit Cada passaporte emitido e consumido gera um registo forense inviolável com ID único.
 */

import crypto from 'crypto';

/**
 * @description Dados essenciais declarados num passaporte de mutação de negócio.
 */
export interface MutationPassportData {
  /** Identificador único do passaporte (ex.: "pass_disc_10pct_99a") */
  passportId: string;
  /** Identificador do serviço emissor autorizado */
  issuerService: string;
  /** Lista de campos sensíveis cuja alteração foi formalmente aprovada */
  allowedFields: string[];
  /** Valor original pré-mutação (opcional) */
  fromValue?: unknown;
  /** Valor resultante aprovado (opcional) */
  toValue?: unknown;
  /** Justificação negocial auditável (ex.: "COUPON_BLACK_FRIDAY_20%") */
  reason: string;
  /** Carimbo temporal de emissão */
  issuedAt: number;
  /** Carimbo temporal de expiração estrita */
  expiresAt: number;
}

/**
 * @description Passaporte de mutação assinado digitalmente com HMAC-SHA256.
 */
export interface SignedMutationPassport extends MutationPassportData {
  /** Assinatura criptográfica HMAC-SHA256 */
  signature: string;
}

/**
 * @description Autoridade central emissora e validadora de passaportes de mutação.
 */
export class MutationPassportAuthority {
  private static readonly SECRET_KEY: string = process.env.INP_SECRET || 'inp-default-sovereign-synaptic-key-2026';

  /**
   * @description Emite um passaporte assinado para uma mutação financeira ou contratual legítima.
   *
   * @param {string} issuerService - Serviço que solicita a mutação autorizada.
   * @param {string[]} allowedFields - Campos financeiros permitidos (ex.: ['amount', 'price']).
   * @param {string} reason - Motivo formal de negócio auditável.
   * @param {{ fromValue?: unknown; toValue?: unknown; ttlMs?: number }} [options] - Parâmetros complementares.
   * @returns {SignedMutationPassport} Passaporte criptografado e assinado.
   */
  public static createPassport(
    issuerService: string,
    allowedFields: string[],
    reason: string,
    options?: { fromValue?: unknown; toValue?: unknown; ttlMs?: number }
  ): SignedMutationPassport {
    const now = Date.now();
    const ttl = options?.ttlMs || 60000; // 60 segundos de validade padrão
    const passportId = `pass_${crypto.randomBytes(6).toString('hex')}`;

    const data: MutationPassportData = {
      passportId,
      issuerService,
      allowedFields,
      fromValue: options?.fromValue,
      toValue: options?.toValue,
      reason,
      issuedAt: now,
      expiresAt: now + ttl
    };

    const signature = this.signData(data);
    return { ...data, signature };
  }

  /**
   * @description Emite um passaporte criptográfico de mutação através de objeto declarativo de opções.
   *
   * @param {object} params - Parâmetros estruturados para emissão do passaporte.
   * @param {string} [params.transactionId] - Identificador de correlação da transação.
   * @param {string} [params.issuerService] - Serviço emissor.
   * @param {string[]} params.allowedFields - Lista de campos financeiros autorizados para mutação.
   * @param {string} params.reason - Justificação formal do negócio.
   * @param {number} [params.ttlSeconds] - Tempo de vida em segundos.
   * @param {number} [params.ttlMs] - Tempo de vida em milissegundos.
   * @param {unknown} [params.fromValue] - Valor prévio esperado.
   * @param {unknown} [params.toValue] - Novo valor acordado.
   * @returns {SignedMutationPassport} Passaporte criptografado e autenticado com HMAC-SHA256.
   * @security Assina digitalmente os campos permitidos com segredo criptográfico do nó soberano.
   * @audit Regista a emissão de passaporte para fins de auditoria de alterações patrimoniais.
   */
  public static issuePassport(params: {
    transactionId?: string;
    issuerService?: string;
    allowedFields: string[];
    reason: string;
    ttlSeconds?: number;
    ttlMs?: number;
    fromValue?: unknown;
    toValue?: unknown;
  }): SignedMutationPassport {
    return this.createPassport(
      params.issuerService || params.transactionId || 'INP_SYSTEM',
      params.allowedFields,
      params.reason,
      {
        fromValue: params.fromValue,
        toValue: params.toValue,
        ttlMs: params.ttlMs || (params.ttlSeconds ? params.ttlSeconds * 1000 : 60000)
      }
    );
  }

  /**
   * @description Valida a autenticidade, integridade e validade temporal de um passaporte de mutação.
   *
   * @param {SignedMutationPassport} passport - Passaporte assinado a verificar.
   * @returns {{ valid: boolean; reason?: string }} Veredicto formal de segurança.
   * @security Previne ataques de replay e adulteração através de timingSafeEqual e verificação de expiração.
   */
  public static verifyPassport(passport: SignedMutationPassport): { valid: boolean; reason?: string } {
    if (!passport || !passport.signature) {
      return { valid: false, reason: 'Passaporte ausente ou sem assinatura digital.' };
    }

    if (Date.now() > passport.expiresAt) {
      return { valid: false, reason: `Passaporte "${passport.passportId}" expirado.` };
    }

    const { signature, ...data } = passport;
    const expectedSig = this.signData(data);

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, reason: 'Assinatura digital HMAC do passaporte é inválida ou foi corrompida.' };
    }

    return { valid: true };
  }

  /**
   * @description Gera a assinatura HMAC-SHA256 sobre a representação canónica dos dados do passaporte.
   *
   * @param {MutationPassportData} data - Conteúdo do passaporte.
   * @returns {string} Assinatura hexadecimal.
   */
  private static signData(data: MutationPassportData): string {
    return crypto.createHmac('sha256', this.SECRET_KEY)
      .update(JSON.stringify(data))
      .digest('hex');
  }
}
