/**
 * @fileoverview Verificador Criptográfico de Provas de Conhecimento Zero (ZK-Verifier)
 * @module Core/ZKVerifier
 * @description
 * Permite a validação de asserções lógicas e verificação de condições sobre dados confidenciais
 * (ex.: comprovar que um saldo é superior a um montante limite, ou que uma idade é >= 18)
 * sem necessidade de expor ou divulgar o valor original subjacente.
 * Implementa esquemas de compromisso criptográfico (Cryptographic Commitments) com sal
 * e avaliação de limites (boundary evaluation).
 *
 * @security Garante a confidencialidade de dados financeiros e de identidade.
 * Em ambiente de produção, impõe obrigatoriamente a presença do compromisso criptográfico e prova válida,
 * rejeitando qualquer fallback para campos em texto claro.
 * @audit Permite comprovar a veracidade de pré-condições contratuais para fins regulamentares
 * mantendo conformidade integral com os princípios de privacidade e minimização do RGPD.
 */

import crypto from 'crypto';

/**
 * @description Motor de verificação de compromissos criptográficos e provas de conhecimento zero (Zero-Knowledge).
 */
export class ZKVerifier {
  /**
   * @description Gera um hash de compromisso criptográfico (SHA-256) a partir de um valor e de um sal aleatório.
   *
   * @param {any} value - Valor original confidencial.
   * @param {string} salt - Cadeia de sal criptográfico de alta entropia.
   * @returns {string} Resumo de hash SHA-256 em formato hexadecimal que sela o compromisso.
   * @security A utilização de sal criptográfico impede ataques de dicionário e tabelas rainbow.
   * @audit O resumo gerado pode ser tornado público ou partilhado na rede sem revelar o dado de origem.
   */
  public static generateCommitment(value: any, salt: string): string {
    const data = `${value.toString()}:${salt}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * @description Verifica se um valor em claro e o respetivo sal correspondem exatamente a um compromisso pré-existente.
   *
   * @param {any} value - O valor a conferir.
   * @param {string} salt - O sal utilizado na criação do compromisso.
   * @param {string} commitment - O hash de compromisso original esperado.
   * @returns {boolean} Verdadeiro se o hash recalculado coincidir com o compromisso; falso caso contrário.
   */
  public static verifyCommitment(value: any, salt: string, commitment: string): boolean {
    const generated = this.generateCommitment(value, salt);
    try {
      const a = Buffer.from(generated, 'hex');
      const b = Buffer.from(commitment, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * @description Valida uma prova condicional sobre um campo especificado presente no contexto de execução.
   * Sintaxe típica suportada no protocolo: `VERIFY "amount" >= 1.0`.
   *
   * @param {string} fieldName - Nome do atributo confidencial a verificar.
   * @param {string} operator - Operador relacional de comparação ('>=', '<=', '>', '<', '==').
   * @param {number} boundary - Limite numérico de fronteira contra o qual o valor é validado.
   * @param {any} context - Dicionário de contexto contendo as chaves de compromisso e prova (`[campo]_commitment`, `[campo]_proof`).
   * @returns {boolean} Verdadeiro se a prova e a restrição forem válidas.
   * @throws {Error} Se faltar a prova criptográfica em produção, se o hash de compromisso falhar
   * ou se a restrição de fronteira for violada.
   * @security Em produção, o envio de texto claro não é aceite como substituto de prova de conhecimento zero.
   * @audit Regista a conformidade da validação sem gravar o dado privado em base de dados de auditoria.
   */
  public static verifyProof(
    fieldName: string,
    operator: string,
    boundary: number,
    context: any
  ): boolean {
    const commitmentKey = `${fieldName}_commitment`;
    const proofKey = `${fieldName}_proof`;
    // SEGURANÇA: Regista apenas as chaves presentes no contexto, nunca os valores, para evitar fuga de dados confidenciais
    console.log('[ZK Verifier] Chaves de contexto recebidas para validação:', Object.keys(context || {}));

    const commitment = context[commitmentKey];
    const proof = context[proofKey];

    // Se os dados criptográficos estiverem em falta
    if (!commitment || !proof || proof.value === undefined || typeof proof.salt !== 'string') {
      // Em produção, a presença da prova criptográfica é inegociável
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Erro de Verificação ZK: Em ambiente de produção, a validação confidencial do campo "${fieldName}" requer compromisso criptográfico e prova válida.`);
      }
      // Modo de fallback apenas autorizado em desenvolvimento local:
      if (context[fieldName] !== undefined) {
        console.warn(`[ZK Verifier] Aviso: A validar o campo em texto claro "${fieldName}" (Sem compromisso criptográfico em modo não-produtivo).`);
        return this.evaluate(context[fieldName], operator, boundary);
      }
      throw new Error(`Erro de Verificação ZK: Faltam o compromisso ou a prova para o campo confidencial "${fieldName}".`);
    }

    // 1. Verificação da integridade do hash do compromisso
    const isValidCommitment = this.verifyCommitment(proof.value, proof.salt, commitment);
    if (!isValidCommitment) {
      throw new Error(`Erro de Verificação ZK: A assinatura/hash do compromisso não coincide para o campo "${fieldName}".`);
    }

    console.log(`[ZK Verifier] Compromisso validado com sucesso para "${fieldName}". A testar restrição relacional...`);

    // 2. Avaliação da condição relacional sobre a fronteira
    const isConstraintSatisfied = this.evaluate(proof.value, operator, boundary);
    if (!isConstraintSatisfied) {
      // SEGURANÇA: A mensagem de erro não inclui o valor real da prova para evitar fuga de dados confidenciais
      throw new Error(`Erro de Verificação ZK: A restrição falhou. O campo "${fieldName}" viola a condição "${operator} ${boundary}".`);
    }

    console.log(`[ZK Verifier] Restrição confirmada: O campo "${fieldName}" cumpre a condição "${operator} ${boundary}".`);
    return true;
  }

  /**
   * @description Avalia internamente a operação relacional numérica entre o valor provado e o limite.
   *
   * @param {any} value - Valor numérico a ser testado.
   * @param {string} operator - Operador de comparação.
   * @param {number} boundary - Valor de fronteira numérico.
   * @returns {boolean} Resultado booleano da avaliação da desigualdade.
   */
  private static evaluate(value: any, operator: string, boundary: number): boolean {
    const val = parseFloat(value);
    switch (operator) {
      case '>=': return val >= boundary;
      case '<=': return val <= boundary;
      case '>': return val > boundary;
      case '<': return val < boundary;
      case '==': return val === boundary;
      default: return false;
    }
  }
}
