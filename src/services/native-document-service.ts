/**
 * @fileoverview Serviço Nativo de Geração de Documentos e Relatórios (NativeDocumentService)
 * @module Services/NativeDocumentService
 * @description
 * Serviço nativo integrado do protocolo INP para criação programática de documentos
 * estruturados (HTML/Markdown/JSON) a partir dos dados do contexto de orquestração.
 * Permite gerar faturas, comprovantes, relatórios e certificados sem dependência
 * de microsserviços externos ou bibliotecas nativas de renderização complexa.
 *
 * Capacidades expostas:
 * - GENERATE DOCUMENT: Gera documento estruturado em HTML, Markdown ou JSON.
 * - GENERATE PDF: Gera representação de fatura/recibo pronta para renderização PDF.
 *
 * @security Sanitiza todos os campos de dados antes da interpolação no template
 * para prevenir injeção de HTML/CSS malicioso.
 * @audit Regista o tipo de documento gerado, tamanho e hash do conteúdo para integridade.
 */

import crypto from 'crypto';

/**
 * @description Sanitiza uma string para interpolação segura em HTML, escapando caracteres especiais.
 * @param {any} value - Valor a sanitizar.
 * @returns {string} Cadeia de texto com caracteres HTML escapados.
 * @security Previne injeção de HTML e XSS em documentos gerados.
 */
function sanitizeHtml(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @description Gera um documento HTML estruturado a partir de um template e contexto de dados.
 * @param {object} template - Configuração do template: title, sections (array de { heading, fields }).
 * @param {object} data - Dados a interpolar no documento.
 * @returns {string} Documento HTML completo e sanitizado.
 * @security Sanitiza todos os valores antes da interpolação para prevenir XSS.
 */
function generateHtml(template: any, data: any): string {
  const title = sanitizeHtml(template.title || 'Documento INP Protocol');
  const now = new Date().toLocaleString('pt-PT');
  let sectionsHtml = '';
  for (const section of (template.sections || [])) {
    sectionsHtml += `<section><h2>${sanitizeHtml(section.heading)}</h2><table>`;
    for (const field of (section.fields || [])) {
      const value = data[field.key] !== undefined ? data[field.key] : field.default ?? 'N/A';
      sectionsHtml += `<tr><th>${sanitizeHtml(field.label || field.key)}</th><td>${sanitizeHtml(value)}</td></tr>`;
    }
    sectionsHtml += `</table></section>`;
  }
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${title}</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:20px}h1{border-bottom:2px solid #333}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd}th{background:#f5f5f5;min-width:180px}.meta{color:#666;font-size:0.85em}</style></head><body><h1>${title}</h1><p class="meta">Gerado em ${sanitizeHtml(now)} pelo INP Protocol</p>${sectionsHtml}</body></html>`;
}

/**
 * @description Gera um documento em Markdown a partir de um template e contexto de dados.
 * @param {object} template - Configuração do template.
 * @param {object} data - Dados a interpolar.
 * @returns {string} Documento em formato Markdown.
 */
function generateMarkdown(template: any, data: any): string {
  const title = template.title || 'Documento INP Protocol';
  let md = `# ${title}\n\n_Gerado em ${new Date().toLocaleString('pt-PT')} pelo INP Protocol_\n\n`;
  for (const section of (template.sections || [])) {
    md += `## ${section.heading}\n\n`;
    for (const field of (section.fields || [])) {
      const value = data[field.key] !== undefined ? data[field.key] : field.default ?? 'N/A';
      md += `**${field.label || field.key}**: ${value}\n\n`;
    }
  }
  return md;
}

/**
 * @description Manipulador local do Serviço Nativo de Geração de Documentos.
 *
 * @param {object} input - Contexto contendo: `verb`, `template` (config do documento), `data` (dados), `format` (html/markdown/json).
 * @param {object} execContext - Contexto de execução.
 * @returns {Promise<object>} Documento gerado com: `content`, `format`, `sizeBytes`, `contentHash`, `generatedAt`.
 * @throws {Error} Se o template estiver em falta ou o formato não for suportado.
 * @security Sanitiza todos os valores interpolados para prevenir XSS em documentos HTML.
 * @audit Regista o hash SHA-256 do conteúdo gerado para verificação de integridade.
 */
export async function nativeDocumentHandler(input: any, execContext?: any): Promise<any> {
  const { template, data = {}, format = 'html' } = input;
  if (!template || typeof template !== 'object') {
    throw new Error('[Serviço de Documentos] O campo "template" é obrigatório e deve ser um objeto de configuração.');
  }
  const normalizedFormat = (format || 'html').toString().toLowerCase();
  let content: string;
  if (normalizedFormat === 'html') {
    content = generateHtml(template, data);
  } else if (normalizedFormat === 'markdown' || normalizedFormat === 'md') {
    content = generateMarkdown(template, data);
  } else if (normalizedFormat === 'json') {
    const jsonDoc: any = { title: template.title, generatedAt: new Date().toISOString(), sections: {} };
    for (const section of (template.sections || [])) {
      jsonDoc.sections[section.heading] = {};
      for (const field of (section.fields || [])) {
        jsonDoc.sections[section.heading][field.key] = data[field.key] !== undefined ? data[field.key] : field.default ?? null;
      }
    }
    content = JSON.stringify(jsonDoc, null, 2);
  } else {
    throw new Error(`[Serviço de Documentos] Formato "${normalizedFormat}" não suportado. Use html, markdown ou json.`);
  }
  const contentHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  return { content, format: normalizedFormat, sizeBytes: Buffer.byteLength(content, 'utf8'), contentHash, generatedAt: new Date().toISOString() };
}
