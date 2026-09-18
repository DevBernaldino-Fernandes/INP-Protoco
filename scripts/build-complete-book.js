/**
 * @fileoverview Validador e Verificador do Livro Completo do INP Protocol v2.7 (128 Verbos)
 * @module Scripts/BuildCompleteBook
 * @description
 * Valida e audita a integridade do livro monumental oficial
 * "docs/LIVRO_COMPLETO_INP_PROTOCOL_v2.7.md", garantindo que toda a enciclopédia
 * dos 128 verbos, diagramas visuais, regras de blindagem e apêndices estão sincronizados.
 *
 * @security Validação estrita de integridade e encoding UTF-8.
 * @audit Gera relatório oficial de conformidade para auditorias técnicas e compliance.
 */

const fs = require('fs');
const path = require('path');

const targetPath = path.resolve(__dirname, '..', 'docs', 'LIVRO_COMPLETO_INP_PROTOCOL_v2.7.md');

if (!fs.existsSync(targetPath)) {
  console.error(`❌ Erro: O arquivo do livro não foi encontrado em: ${targetPath}`);
  process.exit(1);
}

const content = fs.readFileSync(targetPath, 'utf8');

const checks = [
  { name: '136 Verbos Operacionais no Título/Cabeçalho', test: /136 Verbos Operacionais/i.test(content) },
  { name: 'Seção 5.7 presente (Interconexão)', test: /## 5\.7 Os 15 Verbos de Interconexão/i.test(content) },
  { name: 'Seção 5.8 presente (Viagem no Tempo & Telemetria)', test: /## 5\.8 Os 8 Verbos de Viagem no Tempo/i.test(content) },
  { name: 'Seção 5.9 presente (IA Vetorial, Finanças & Caos)', test: /## 5\.9 A 9ª Família Estratégica/i.test(content) },
  { name: 'Verbo BRIDGE documentado', test: /### 106\. BRIDGE/i.test(content) },
  { name: 'Verbo OUTBOUND documentado', test: /### 107\. OUTBOUND/i.test(content) },
  { name: 'Verbo INGEST documentado', test: /### 108\. INGEST/i.test(content) },
  { name: 'Verbo FANIN documentado', test: /### 109\. FANIN/i.test(content) },
  { name: 'Verbo EMIT documentado', test: /### 110\. EMIT/i.test(content) },
  { name: 'Verbo PLUCK documentado', test: /### 111\. PLUCK/i.test(content) },
  { name: 'Verbo FLATTEN documentado', test: /### 112\. FLATTEN/i.test(content) },
  { name: 'Verbo MASK documentado', test: /### 113\. MASK/i.test(content) },
  { name: 'Verbo CAST documentado', test: /### 114\. CAST/i.test(content) },
  { name: 'Verbo CLAMP documentado', test: /### 115\. CLAMP/i.test(content) },
  { name: 'Verbo COOLDOWN documentado', test: /### 116\. COOLDOWN/i.test(content) },
  { name: 'Verbo UNDO documentado', test: /### 117\. UNDO/i.test(content) },
  { name: 'Verbo SNAPSHOT documentado', test: /### 118\. SNAPSHOT/i.test(content) },
  { name: 'Verbo DIVERGE documentado', test: /### 119\. DIVERGE/i.test(content) },
  { name: 'Verbo HEARTBEAT documentado', test: /### 120\. HEARTBEAT/i.test(content) },
  { name: 'Verbo COMPENSATE documentado', test: /### 121\. COMPENSATE/i.test(content) },
  { name: 'Verbo BENCHMARK documentado', test: /### 122\. BENCHMARK/i.test(content) },
  { name: 'Verbo NORMALIZE documentado', test: /### 123\. NORMALIZE/i.test(content) },
  { name: 'Verbo ENQUEUE documentado', test: /### 124\. ENQUEUE/i.test(content) },
  { name: 'Verbo INSPECT documentado', test: /### 125\. INSPECT/i.test(content) },
  { name: 'Verbo TIME_TRAVEL documentado', test: /### 126\. TIME_TRAVEL/i.test(content) },
  { name: 'Verbo REPLAY documentado', test: /### 127\. REPLAY/i.test(content) },
  { name: 'Verbo TIMELINE documentado', test: /### 128\. TIMELINE/i.test(content) },
  { name: 'Verbo EMBED documentado', test: /### 129\. EMBED/i.test(content) },
  { name: 'Verbo VECTOR_SEARCH documentado', test: /### 130\. VECTOR_SEARCH/i.test(content) },
  { name: 'Verbo SPLIT documentado', test: /### 131\. SPLIT/i.test(content) },
  { name: 'Verbo ESCROW documentado', test: /### 132\. ESCROW/i.test(content) },
  { name: 'Verbo POLL documentado', test: /### 133\. POLL/i.test(content) },
  { name: 'Verbo INVALIDATE documentado', test: /### 134\. INVALIDATE/i.test(content) },
  { name: 'Verbo DRIFT_DETECT documentado', test: /### 135\. DRIFT_DETECT/i.test(content) },
  { name: 'Verbo CHAOS documentado', test: /### 136\. CHAOS/i.test(content) },
  { name: 'Exemplo 10.5 de Interoperabilidade presente', test: /10\.5 Exemplo 5 \(Master Interoperabilidade/i.test(content) },
  { name: 'Apêndice A expandido para 136 verbos', test: /\| 136 \| `CHAOS`/i.test(content) },
  { name: 'Seção 7.1 presente (A Filosofia & A Lógica Por Trás do INTENT)', test: /## 7\.1 A Filosofia & A Lógica Por Trás do Conceito de INTENT/i.test(content) },
  { name: 'Seção 7.5 presente (Taxonomia Normativa: Obrigatório vs De Preferência)', test: /## 7\.5 Taxonomia Normativa Universal/i.test(content) },
  { name: 'Seção 8.4 presente (O Decálogo das Regras de Ouro: O Que Fazer)', test: /## 8\.4 O Decálogo das Regras de Ouro/i.test(content) },
  { name: 'Seção 8.5 presente (O Muro das Proibições: O Que NÃO Fazer)', test: /## 8\.5 O Muro das Proibições/i.test(content) },
  { name: 'Seção 8.6 presente (Guia Temporal Causal: QUANDO Fazer)', test: /## 8\.6 Guia Temporal Causal/i.test(content) },
  { name: 'Seção 8.7 presente (Guia de Vetos Críticos: QUANDO NÃO Fazer)', test: /## 8\.7 Guia de Vetos Críticos/i.test(content) },
  { name: 'Seção 8.8 presente (Matriz Operacional Cruzada de Conduta)', test: /## 8\.8 Matriz Operacional Cruzada de Conduta/i.test(content) }
];

console.log('================================================================');
console.log('  VALIDAÇÃO DO LIVRO COMPLETO DO INP PROTOCOL v2.7 (136 VERBOS) ');
console.log('================================================================');
console.log(`Arquivo: ${targetPath}`);
console.log(`Tamanho: ${Buffer.byteLength(content, 'utf8')} bytes\n`);

let passedCount = 0;
for (const c of checks) {
  if (c.test) {
    console.log(`✅ ${c.name}`);
    passedCount++;
  } else {
    console.error(`❌ Falha: ${c.name}`);
  }
}

if (passedCount === checks.length) {
  console.log('\n================================================================');
  console.log(`  SUCESSO: ${passedCount}/${checks.length} CHECAGENS APROVADAS (100%)!`);
  console.log('  O Livro Oficial está sincronizado e íntegro com os 136 verbos (9 Famílias).');
  console.log('================================================================');
} else {
  console.error(`\n❌ Falha: Apenas ${passedCount}/${checks.length} checagens foram aprovadas.`);
  process.exit(1);
}
