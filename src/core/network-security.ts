/**
 * @fileoverview Segurança de Rede e Mitigação de SSRF (Server-Side Request Forgery)
 * @module Core/NetworkSecurity
 * @description
 * Fornece validação estrita de URLs e endereços de destino antes de qualquer invocação remota
 * realizada pelo motor de execução do protocolo INP. Bloqueia ativamente tentativas de SSRF,
 * impedindo que pedidos originados no servidor alcancem a rede interna da infraestrutura,
 * serviços de metadados da nuvem (AWS/GCP/Azure) ou endereços privados protegidos (RFC 1918).
 *
 * @security Bloqueia endereços IP privados, interfaces de loopback, endereços link-local
 * e pontos de metadados de instâncias de nuvem. Em produção, impõe obrigatoriamente HTTPS.
 * @audit Permite comprovar em auditorias de segurança (ex.: OWASP Top 10 A10:2021) que o sistema
 * possui controlos ativos contra SSRF e exploração de perímetros internos de rede.
 */

import { URL } from 'url';

/**
 * @description Mecanismo de defesa de rede para validação de pontos de extremidade HTTP/HTTPS.
 */
export class NetworkSecurity {
  /**
   * Expressões regulares que identificam intervalos de endereços IP privados e reservados.
   */
  private static PRIVATE_IP_PATTERNS = [
    /^127\./,                           // Loopback IPv4 (127.0.0.0/8)
    /^10\./,                            // Rede Privada RFC 1918 Classe A (10.0.0.0/8)
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,   // Rede Privada RFC 1918 Classe B (172.16.0.0/12)
    /^192\.168\./,                      // Rede Privada RFC 1918 Classe C (192.168.0.0/16)
    /^169\.254\./,                      // Endereço Link-local / Metadados de Nuvem (169.254.0.0/16)
    /^0\./,                             // Rede corrente
    /^::1$/,                            // Loopback IPv6
    /^fc00:/i,                          // Intervalo Local Único IPv6 (Unique Local)
    /^fe80:/i,                          // Intervalo Link-local IPv6
    // MEDIDA DE SEGURANÇA: Bloqueia representações alternativas de IPs privados para DNS rebinding
    /^0x7f/i,                           // Loopback em hexadecimal (0x7f000001 = 127.0.0.1)
    /^0x0a/i,                           // RFC 1918 Classe A em hex (0x0a = 10.x.x.x)
    /^0xc0a8/i,                         // RFC 1918 Classe C em hex (0xc0a8 = 192.168.x.x)
    /^0xa9fe/i,                         // Link-local em hex (0xa9fe = 169.254.x.x)
    /^2130706433$/,                     // 127.0.0.1 como inteiro decimal
    /^3232\d{6}$/,                      // 192.168.x.x como inteiro decimal (3232235520 - 3232301055)
    /^0177\./,                          // Loopback em octal (0177.0.0.1)
    /^00*17[67]/,                       // Variações octais de loopback
  ];

  /**
   * @description Valida se um URL de destino é seguro para invocação remota, prevenindo SSRF.
   *
   * @param {string} endpoint - O URL do serviço remoto a ser inspecionado.
   * @param {boolean} [allowLocal] - Se for verdadeiro, autoriza nós locais (útil em testes ou desenvolvimento).
   * @throws {Error} Se o URL for inválido, não utilizar HTTP/HTTPS, tentar aceder à rede privada
   * ou violar o requisito de HTTPS obrigatório em produção.
   * @security Bloqueia acessos a `localhost`, `127.0.0.1`, `metadata.google.internal`, etc.
  /** Cache estático de endpoints previamente validados e seguros */
  private static validatedCache = new Set<string>();
  private static readonly MAX_CACHE_SIZE = 1000;

  /**
   * @description Valida se um URL de destino é seguro para invocação remota, prevenindo SSRF.
   *
   * @param {string} endpoint - O URL do serviço remoto a ser inspecionado.
   * @param {boolean} [allowLocal] - Se for verdadeiro, autoriza nós locais (útil em testes ou desenvolvimento).
   * @throws {Error} Se o URL for inválido, não utilizar HTTP/HTTPS, tentar aceder à rede privada
   * ou violar o requisito de HTTPS obrigatório em produção.
   * @security Bloqueia acessos a `localhost`, `127.0.0.1`, `metadata.google.internal`, etc.
   * @audit Regista a conformidade do ponto de extremidade antes de despoletar tráfego de rede exterior.
   */
  static validateEndpoint(endpoint: string, allowLocal?: boolean): void {
    // Validação inicial do tipo de argumento
    if (!endpoint || typeof endpoint !== 'string') {
      throw new Error('Proteção SSRF: O URL do ponto de extremidade deve ser uma cadeia de texto não vazia.');
    }

    const isProd = process.env.NODE_ENV === 'production';
    const cacheKey = `${endpoint}::${allowLocal ?? ''}::${isProd}`;
    if (this.validatedCache.has(cacheKey)) {
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new Error(`Proteção SSRF: URL de ponto de extremidade inválido: "${endpoint}"`);
    }

    // Apenas os protocolos HTTP e HTTPS são admissíveis no protocolo INP
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Proteção SSRF: O protocolo "${parsed.protocol}" não é permitido. Apenas HTTP e HTTPS são suportados.`);
    }

    // REGRA DE PRODUÇÃO: Imposição estrita de HTTPS para garantir encriptação TLS em trânsito
    if (isProd && parsed.protocol !== 'https:') {
      throw new Error(`Proteção SSRF: Os pontos de extremidade em ambiente de produção devem utilizar obrigatoriamente HTTPS! Fornecido: "${endpoint}"`);
    }

    const hostname = parsed.hostname.toLowerCase();

    // Determina se chamadas locais estão expressamente autorizadas neste contexto
    const isLocalAllowed = allowLocal !== undefined
      ? allowLocal
      : (process.env.ALLOW_LOCAL_SERVICES === 'true' || (!isProd && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)));

    // Verificação de nomes de anfitrião de loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
      if (!isLocalAllowed) {
        throw new Error(`Proteção SSRF: O acesso a localhost / loopback está bloqueado neste ambiente.`);
      }
      if (this.validatedCache.size < this.MAX_CACHE_SIZE) this.validatedCache.add(cacheKey);
      return; // Autorizado exclusivamente em modo de desenvolvimento local
    }

    // Nomes de anfitrião reservados de metadados da nuvem (AWS / GCP / Azure / OpenStack)
    if (
      hostname === 'metadata.google.internal' ||
      hostname === 'instance-data' ||
      hostname === '169.254.169.254' ||
      hostname === 'metadata.aws.internal' ||
      hostname === '169.254.169.254.nip.io'
    ) {
      throw new Error(`Proteção SSRF: O acesso aos serviços de metadados da nuvem é estritamente proibido.`);
    }

    // MEDIDA DE SEGURANÇA: Bloqueia domínios de DNS curinga que incorporam IPs privados (ex.: 127.0.0.1.nip.io, test.192.168.1.1)
    const embeddedPrivateIp = /(^|\.)(127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)($|\.)/;
    if (embeddedPrivateIp.test(hostname)) {
      if (!isLocalAllowed) {
        throw new Error(`Proteção SSRF: O ponto de extremidade embute um endereço IP privado/loopback restrito: "${hostname}".`);
      }
      if (this.validatedCache.size < this.MAX_CACHE_SIZE) this.validatedCache.add(cacheKey);
      return;
    }

    // Validação face aos padrões de intervalos de endereços IP privados
    for (const pattern of this.PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        if (isLocalAllowed && (hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.'))) {
          if (this.validatedCache.size < this.MAX_CACHE_SIZE) this.validatedCache.add(cacheKey);
          return; // Autorizado apenas se serviços locais estiverem explicitamente permitidos
        }
        throw new Error(`Proteção SSRF: O ponto de extremidade resolve para um endereço privado/link-local restrito: "${hostname}".`);
      }
    }

    // Armazena no cache se aprovado
    if (this.validatedCache.size < this.MAX_CACHE_SIZE) {
      this.validatedCache.add(cacheKey);
    }
  }

  /**
   * @description Limpa o cache de validações (para testes ou mudanças de ambiente).
   */
  static clearCache(): void {
    this.validatedCache.clear();
  }
}
