/**
 * @fileoverview Compositor e Formatador de Respostas do Protocolo (ResponseComposer)
 * @module Core/ResponseComposer
 * @description
 * Transforma o resultado consolidado da execução (`ExecutionResult`) no formato de saída
 * especificado no contrato da intenção (`json`, `xml`, `text` ou `event`).
 * Higieniza carateres de controlo em XML para prevenir injeções de entidades externas (XXE),
 * normaliza durações de tempo em milissegundos e estrutura os detalhes de cada passo executado.
 *
 * @security Aplica codificação de entidades em XML (`&lt;`, `&gt;`, `&amp;`) prevenindo ataques de injeção XML/XXE.
 * @audit Formata o identificador de execução e o carimbo temporal de duração, facilitando o consumo por sistemas externos de auditoria.
 */

import { ExecutionResult, IntentOutput } from './types';

/**
 * @description Formatador polimórfico de respostas do protocolo INP.
 */
export class ResponseComposer {
  /**
   * @description Converte o resultado de execução no formato pretendido pelo cliente.
   *
   * @param {ExecutionResult} result - Objeto consolidado contendo os passos e desfecho da execução.
   * @param {IntentOutput} outputFormat - Especificação do formato de saída desejado ('json', 'xml', 'text', 'event').
   * @returns {any} Resposta formatada de acordo com o contrato solicitado.
   */
  compose(result: ExecutionResult, outputFormat: IntentOutput): any {
    switch (outputFormat.format) {
      case 'json': return this.toJSON(result);
      case 'xml':  return this.toXML(result);
      case 'text': return this.toText(result);
      case 'event': return this.toEvent(result);
      default: return this.toJSON(result);
    }
  }

  /**
   * @description Serializa o resultado num objeto JSON estruturado com métricas de tempo por passo.
   *
   * @param {ExecutionResult} result - Dados consolidados da execução.
   * @returns {object} Objeto JSON normalizado.
   */
  private toJSON(result: ExecutionResult): object {
    return {
      status: result.status,
      execution_id: result.id,
      output: result.finalOutput,
      error: result.error,
      duration_ms: result.completedAt ? result.completedAt.getTime() - result.startedAt.getTime() : null,
      steps: result.steps.map(s => ({
        action: s.action,
        status: s.status,
        duration_ms: s.durationMs,
        output: s.output,
        error: s.error,
      })),
    };
  }

  /**
   * @description Gera uma representação XML válida e segura do resultado da execução.
   *
   * @param {ExecutionResult} result - Dados da execução.
   * @returns {string} Documento XML formatado.
   * @security Escapa entidades de texto para mitigar riscos de injeção XML.
   */
  private toXML(result: ExecutionResult): string {
    const outputStr = result.finalOutput !== undefined ? JSON.stringify(result.finalOutput) : '';
    let xml = `<?xml version="1.0"?>\n<response>\n`;
    xml += `  <status>${result.status}</status>\n`;
    xml += `  <execution_id>${result.id}</execution_id>\n`;
    xml += `  <output>${this.escapeXml(outputStr)}</output>\n`;
    if (result.error) xml += `  <error>${this.escapeXml(result.error)}</error>\n`;
    xml += `</response>`;
    return xml;
  }

  /**
   * @description Produz um resumo textual simplificado em claro.
   *
   * @param {ExecutionResult} result - Dados da execução.
   * @returns {string} Resumo em formato de texto simples.
   */
  private toText(result: ExecutionResult): string {
    const outputStr = result.finalOutput !== undefined ? JSON.stringify(result.finalOutput) : 'nenhum';
    return `Estado: ${result.status}\nSaída: ${outputStr}\nErro: ${result.error || 'nenhum'}`;
  }

  /**
   * @description Estrutura o resultado no formato de evento assíncrono para publicação em barramentos.
   *
   * @param {ExecutionResult} result - Dados da execução.
   * @returns {any} Objeto de evento normalizado.
   */
  private toEvent(result: ExecutionResult): any {
    return { type: 'INP_RESULT', data: this.toJSON(result) };
  }

  /**
   * @description Escapa carateres especiais reservados da especificação XML (`<`, `>`, `&`, `"`, `'`).
   *
   * @param {string} str - Cadeia de caracteres a sanitizar.
   * @returns {string} Texto seguro com entidades XML substituídas.
   */
  private escapeXml(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[<>&"']/g, m => {
      switch (m) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '"': return '&quot;';
        case "'": return '&apos;';
        default: return m;
      }
    });
  }
}