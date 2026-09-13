/**
 * @fileoverview Sanitizador e Mascarador de Dados Sensíveis (RGPD / PCI-DSS)
 * @module Core/DataSanitizer
 * @description
 * Fornece métodos de higienização, mascaramento e proteção de dados confidenciais
 * (PII - Dados Pessoais Identificáveis, tokens de cartão, senhas, chaves privadas e segredos).
 * Garante que nenhuma informação crítica é exposta inadvertidamente em registos de telemetria,
 * ficheiros de log, interfaces administrativas ou históricos de auditoria.
 *
 * @security Previne a fuga de credenciais e dados de pagamento em conformidade com o PCI-DSS.
 * Inclui defesas ativas contra poluição de protótipo (*Prototype Pollution*), ignorando
 * chaves reservadas como `__proto__`, `constructor` e `prototype`.
 * @audit Assegura o cumprimento do princípio da minimização de dados do RGPD (Artigo 5.º),
 * permitindo a rastreabilidade do fluxo sem persistir segredos em claro.
 */

export class DataSanitizer {
  /**
   * Lista de palavras-chave que identificam propriedades contendo dados sensíveis.
   */
  private static SENSITIVE_KEYS = [
    'card_token', 'token', 'card', 'password', 'secret', 'cvv', 'pin',
    'private_key', 'authorization', 'api_key', 'apikey'
  ];

  /**
   * @description Aplica uma máscara de ofuscação a uma cadeia de caracteres sensível,
   * preservando apenas os primeiros e últimos 4 carateres para fins de conferência operacional.
   *
   * @param {string} val - O valor sensível em claro a ser mascarado.
   * @returns {string} Cadeia de texto mascarada com asteriscos (ex.: "ABCD****WXYZ") ou "****" se muito curta.
   * @security Previne a visualização desnecessária de números de cartão ou credenciais completas.
   * @audit Permite correlacionar registos sem revelar o segredo integral aos operadores de suporte.
   */
  static maskValue(val: string): string {
    if (!val || typeof val !== 'string') return val;
    // Se a cadeia for muito curta, mascara o conteúdo na totalidade
    if (val.length <= 6) return '****';
    const prefix = val.substring(0, 4);
    const suffix = val.substring(val.length - 4);
    return `${prefix}****${suffix}`;
  }

  /**
   * @description Percorre recursivamente objetos e matrizes (arrays), mascarando quaisquer
   * propriedades identificadas como sensíveis e neutralizando potenciais ataques de poluição de protótipo.
   *
   * @param {any} obj - Objeto, matriz ou valor primitivo a sanitizar.
   * @returns {any} Estrutura profunda clonada e devidamente higienizada.
   * @security Ignora estritamente `__proto__`, `constructor` e `prototype` para bloquear poluição de objetos.
   * @audit Garante que os dados enviados para a base de dados de auditoria não contêm dados em claro.
   */
  static sanitize(obj: any): any {
    // Casos base de valores nulos, indefinidos ou primitivos não manipuláveis
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    // Processamento recursivo de listas / matrizes
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitize(item));
    }

    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      // MEDIDA DE SEGURANÇA: Bloqueio estrito de poluição de protótipo (Prototype Pollution)
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }

      const lowerKey = key.toLowerCase();
      // Avalia se o nome da chave coincide ou contém algum termo sensível
      const isSensitive = this.SENSITIVE_KEYS.some(s => lowerKey === s || lowerKey.includes(s));

      if (isSensitive && typeof obj[key] === 'string') {
        cleaned[key] = this.maskValue(obj[key]);
      } else if (typeof obj[key] === 'object') {
        // Sanitização recursiva de objetos aninhados
        cleaned[key] = this.sanitize(obj[key]);
      } else {
        cleaned[key] = obj[key];
      }
    }
    return cleaned;
  }
}
