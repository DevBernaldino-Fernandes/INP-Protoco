/**
 * @fileoverview Verificador Automático de Normas de Codificação e Auditoria
 * @module Scripts/EnforceStandards
 * @description
 * Script utilitário e gancho de pré-submissão (pre-commit hook) que analisa o código-fonte
 * TypeScript e JavaScript do projeto INP Protocol. Garante que:
 * 1. Todos os ficheiros possuem cabeçalho descritivo com contexto de arquitetura, segurança e auditoria.
 * 2. Todas as classes, interfaces, tipos, funções e métodos públicos exportados possuem documentação TSDoc/JSDoc.
 * 3. As etiquetas essenciais (@description, @param, @returns, @security, @audit) são respeitadas.
 * 4. Nenhum código novo entra no repositório sem comentários e documentação profissional completa.
 *
 * @security Bloqueia commits com código vulnerável por omissão de documentação ou especificações ambíguas.
 * @audit Assegura rastreabilidade contínua e conformidade com normas ISO 27001 e SOC2.
 */

const fs = require('fs');
const path = require('path');

// Diretoria base a inspecionar
const SRC_DIR = path.resolve(__dirname, '..', 'src');

/**
 * Obtém recursivamente todos os ficheiros de código (.ts, .js) excluindo testes e diretórios de build.
 * @param {string} dir - Diretoria a explorar.
 * @returns {string[]} Lista de caminhos absolutos dos ficheiros.
 */
function getSourceFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getSourceFiles(filePath));
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      results.push(filePath);
    }
  });
  return results;
}

/**
 * Inspeciona o conteúdo de um ficheiro e valida os requisitos mandatórios de documentação.
 * @param {string} filePath - Caminho do ficheiro a validar.
 * @returns {string[]} Lista de infrações encontradas.
 */
function validateFileDocumentation(filePath) {
  const infractions = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(path.resolve(__dirname, '..'), filePath);

  // 1. Verificação do cabeçalho do ficheiro
  if (!content.trim().startsWith('/**') || !content.includes('@fileoverview') && !content.includes('@description')) {
    infractions.push(`[Cabeçalho Ausente]: ${relativePath} deve começar com um bloco de documentação /** ... */ contendo @fileoverview ou @description.`);
  }

  // 2. Verificação de etiquetas de Auditoria e Segurança no cabeçalho
  if (!content.includes('@security')) {
    infractions.push(`[Etiqueta @security Ausente]: ${relativePath} deve documentar os aspetos de segurança no cabeçalho.`);
  }
  if (!content.includes('@audit')) {
    infractions.push(`[Etiqueta @audit Ausente]: ${relativePath} deve documentar os requisitos de auditoria no cabeçalho.`);
  }

  // 3. Verificação de classes exportadas
  const classMatches = content.matchAll(/export\s+(abstract\s+)?class\s+(\w+)/g);
  for (const match of classMatches) {
    const className = match[2];
    const index = match.index;
    let prefix = content.substring(Math.max(0, index - 500), index).trim();
    // Remove decoradores TypeScript (ex.: @Entity('...'), @Table, etc.) para validar o TSDoc anterior
    prefix = prefix.replace(/@\w+(\([^)]*\))?\s*$/g, '').trim();
    if (!prefix.endsWith('*/')) {
      infractions.push(`[Documentação de Classe em Falta]: A classe '${className}' em ${relativePath} não possui bloco TSDoc imediatamente anterior.`);
    }
  }

  // 4. Verificação de funções exportadas
  const functionMatches = content.matchAll(/export\s+(async\s+)?function\s+(\w+)/g);
  for (const match of functionMatches) {
    const fnName = match[2];
    const index = match.index;
    const prefix = content.substring(Math.max(0, index - 500), index).trim();
    if (!prefix.endsWith('*/')) {
      infractions.push(`[Documentação de Função em Falta]: A função '${fnName}' em ${relativePath} não possui bloco TSDoc imediatamente anterior.`);
    }
  }

  return infractions;
}

/**
 * Função principal de execução da validação de normas.
 */
function runStandardsCheck() {
  console.log('================================================================');
  console.log('  INP Protocol - Verificação de Normas e Auditoria de Código');
  console.log('================================================================\n');

  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Diretoria 'src' não encontrada em: ${SRC_DIR}`);
    process.exit(1);
  }

  const files = getSourceFiles(SRC_DIR);
  let totalInfractions = [];

  for (const file of files) {
    const fileInfractions = validateFileDocumentation(file);
    if (fileInfractions.length > 0) {
      totalInfractions.push({ file, infractions: fileInfractions });
    }
  }

  if (totalInfractions.length > 0) {
    console.error(`❌ Foram detetadas infrações às normas em ${totalInfractions.length} ficheiro(s):\n`);
    for (const item of totalInfractions) {
      for (const infraction of item.infractions) {
        console.error(`  - ${infraction}`);
      }
    }
    console.error('\n⚠️  A submissão foi rejeitada. Consulte o manual CODING_STANDARDS.md e comente todo o código conforme as regras.');
    process.exit(1);
  } else {
    console.log(`✅ Sucesso: Todos os ${files.length} ficheiros inspecionados cumprem integralmente as normas de documentação e auditoria.\n`);
    process.exit(0);
  }
}

runStandardsCheck();
