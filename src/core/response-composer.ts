/**
 * Response Composer: formats the execution result into JSON, XML, text, or event.
 */

import { ExecutionResult, IntentOutput } from './types';

export class ResponseComposer {
  compose(result: ExecutionResult, outputFormat: IntentOutput): any {
    switch (outputFormat.format) {
      case 'json': return this.toJSON(result);
      case 'xml':  return this.toXML(result);
      case 'text': return this.toText(result);
      case 'event': return this.toEvent(result);
      default: return this.toJSON(result);
    }
  }

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

  private toXML(result: ExecutionResult): string {
    let xml = `<?xml version="1.0"?>\n<response>\n`;
    xml += `  <status>${result.status}</status>\n`;
    xml += `  <execution_id>${result.id}</execution_id>\n`;
    xml += `  <output>${this.escapeXml(JSON.stringify(result.finalOutput))}</output>\n`;
    if (result.error) xml += `  <error>${this.escapeXml(result.error)}</error>\n`;
    xml += `</response>`;
    return xml;
  }

  private toText(result: ExecutionResult): string {
    return `Status: ${result.status}\nOutput: ${JSON.stringify(result.finalOutput)}\nError: ${result.error || 'none'}`;
  }

  private toEvent(result: ExecutionResult): any {
    return { type: 'INP_RESULT', data: this.toJSON(result) };
  }

  private escapeXml(str: string): string {
    return str.replace(/[<>&]/g, m => {
      if (m === '<') return '&lt;';
      if (m === '>') return '&gt;';
      if (m === '&') return '&amp;';
      return m;
    });
  }
}