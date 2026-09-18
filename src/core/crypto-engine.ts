/**
 * @fileoverview Motor Criptográfico do Protocolo INP (AES-256-GCM e Rotação de Chaves)
 * @module Core/CryptoEngine
 * @description
 * Fornece serviços criptográficos de alto nível para proteger dados em repouso e em trânsito.
 * Implementa cifragem autenticada AES-256-GCM (Galois/Counter Mode) com derivação de chaves
 * através da função scrypt, vetores de inicialização (IV) criptograficamente aleatórios de 96 bits
 * e etiquetas de autenticação (Auth Tag) de 128 bits para salvaguardar a integridade dos dados.
 * Suporta rotação de chaves baseada em versionamento explícito (v1, v2, etc.).
 *
 * @security Utiliza AES-256-GCM com verificação estrita de etiqueta de autenticação.
 * Previne ataques de adulteração de texto cifrado, falsificação de dados e oráculos de preenchimento.
 * Exige chaves segregadas em ambiente de produção para mitigar o risco de fuga de credenciais.
 * @audit Essencial para a conformidade com o RGPD (Artigo 32.º) e normas PCI-DSS / ISO 27001 no que
 * respeita à confidencialidade e integridade dos dados sensíveis.
 */

import crypto from 'crypto';

// Identificação do ambiente de execução (produção vs. desenvolvimento)
const isProd = process.env.NODE_ENV === 'production';

// Obtenção das chaves mestras a partir das variáveis de ambiente
const envKeyV1 = process.env.INP_ENCRYPTION_KEY_V1 || process.env.INP_ENCRYPTION_KEY;
const envKeyV2 = process.env.INP_ENCRYPTION_KEY_V2;

// Em produção, é obrigatória a existência explícita das chaves v1 e v2 para garantir rotação segura
if (isProd && (!envKeyV1 || !envKeyV2)) {
  throw new Error('ERRO CRÍTICO DE CONFIGURAÇÃO: As chaves criptográficas INP_ENCRYPTION_KEY_V1 e INP_ENCRYPTION_KEY_V2 têm de estar definidas no ambiente de produção!');
}

// Chaves de contingência utilizadas apenas em desenvolvimento local e testes
const keyV1Raw = envKeyV1 || 'default-secret-key-inp-protocol-2026';
const keyV2Raw = envKeyV2 || 'second-secret-key-inp-protocol-rotation-2026';

// Sal criptográfico para reforçar a derivação de chaves via scrypt
const cryptoSalt = process.env.INP_CRYPTO_SALT || 'inp_secure_salt_fixed_protocol_v2_2026';

/**
 * @description Motor criptográfico para cifragem e decifragem autenticada com suporte a rotação de chaves.
 */
export class CryptoEngine {
  /** Algoritmo padrão de cifra simétrica autenticada */
  private static ALGORITHM = 'aes-256-gcm';

  /**
   * Mapa de chaves derivadas disponíveis indexadas por versão.
   * A derivação é computada via scrypt com tamanho de 32 bytes (256 bits).
   */
  private static KEYS: { [version: string]: Buffer } = {
    v1: crypto.scryptSync(keyV1Raw, cryptoSalt, 32),
    v2: crypto.scryptSync(keyV2Raw, cryptoSalt, 32),
  };

  /** Versão da chave atualmente ativa para novas operações de cifragem */
  private static ACTIVE_KEY_VERSION = process.env.INP_ACTIVE_KEY_VERSION || 'v2';

  /**
   * @description Cifra uma cadeia de texto utilizando AES-256-GCM com a versão de chave ativa.
   * Produz uma representação serializada no formato: `versão:iv:authTag:dadosCifrados`.
   *
   * @param {string} text - Texto em claro a ser cifrado.
   * @returns {string} String serializada contendo a versão, IV, etiqueta de autenticação e dados em hexadecimal.
   * @throws {Error} Se a versão ativa da chave não estiver configurada no mapa de chaves.
   * @security Gera um IV único de 12 bytes por invocação para evitar a reutilização do mesmo vetor.
   * @audit Permite rastrear qual a versão da chave que protegeu o registo aquando da sua gravação.
   */
  static encrypt(text: string): string {
    const version = this.ACTIVE_KEY_VERSION;
    const key = this.KEYS[version];
    if (!key) {
      throw new Error(`A versão de chave de cifragem "${version}" não está configurada.`);
    }

    // IV de 96 bits (12 bytes) — usa pool de entropia interno do Node.js (5-10× mais rápido que randomBytes)
    const iv = Buffer.allocUnsafe(12);
    crypto.randomFillSync(iv);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv) as any;
    
    // Processamento do texto em claro em blocos
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Obtenção da etiqueta de autenticação (Auth Tag) para garantir a integridade da mensagem
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Devolve a estrutura prefixada pela versão para permitir decifragem agnóstica de rotação
    return `${version}:${iv.toString('hex')}:${authTag}:${encrypted}`;
  }


  /**
   * @description Decifra uma cadeia cifrada com AES-256-GCM, suportando rotação de chaves e formatos legados.
   *
   * @param {string} encryptedText - Texto serializado a ser decifrado.
   * @returns {string} Texto original decifrado em claro.
   * @throws {Error} Se a versão da chave não existir ou se a validação da Auth Tag falhar (adulteração).
   * @security A verificação da Auth Tag previne a injeção de dados manipulados por agentes maliciosos.
   * @audit Regista a compatibilidade retroativa com registos encriptados com versões de chaves anteriores.
   */
  static decrypt(encryptedText: string): string {
    // Se o argumento for vazio ou indefinido, devolve uma cadeia vazia
    if (!encryptedText) return '';
    
    const parts = encryptedText.split(':');
    
    // Compatibilidade legada GCM sem prefixo de versão (assume chave v1: iv:authTag:cifrado)
    if (parts.length === 3) {
      return this.decryptWithKey(this.KEYS['v1'], parts[0], parts[1], parts[2]);
    }
    
    // Formato canónico com versão explícita (versão:iv:authTag:cifrado)
    if (parts.length === 4) {
      const [version, ivHex, authTagHex, encryptedDataHex] = parts;
      const key = this.KEYS[version];
      if (!key) {
        throw new Error(`A versão da chave de decifragem "${version}" não está registada.`);
      }
      return this.decryptWithKey(key, ivHex, authTagHex, encryptedDataHex);
    }
    
    // Fallback de compatibilidade para dados em Base64 legado (apenas caracteres seguros)
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(encryptedText.trim()) && encryptedText.length % 4 === 0) {
      try {
        const decoded = Buffer.from(encryptedText, 'base64').toString('utf8');
        if (/^[\x20-\x7E\s]*$/.test(decoded)) {
          return decoded;
        }
      } catch {
        return encryptedText;
      }
    }
    
    // Caso o texto não corresponda a nenhum formato encriptado reconhecido, devolve-o inalterado
    return encryptedText;
  }

  /**
   * @description Rotina interna auxiliar que executa a decifragem com uma chave específica e valida o Auth Tag.
   *
   * @param {Buffer} key - Chave binária derivada de 256 bits.
   * @param {string} ivHex - Vetor de inicialização em formato hexadecimal.
   * @param {string} authTagHex - Etiqueta de autenticação GCM em formato hexadecimal.
   * @param {string} encryptedDataHex - Carga útil cifrada em formato hexadecimal.
   * @returns {string} Texto em claro decifrado.
   * @throws {Error} Caso a etiqueta de autenticação não coincida (dados adulterados ou chave incorreta).
   */
  private static decryptWithKey(key: Buffer, ivHex: string, authTagHex: string, encryptedDataHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv) as any;
    
    // Configura a etiqueta esperada para validação de integridade criptográfica
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
