/**
 * INP Protocol - Cópia de Ativos Estáticos para a Distribuição (dist)
 * 
 * Garante que os ficheiros do portal (HTML, CSS, JS) são sincronizados
 * automaticamente para a diretoria `dist/api/` após a compilação do TypeScript.
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'api');
const distDir = path.join(__dirname, '..', 'dist', 'api');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const assets = ['portal.html', 'portal.css', 'portal.js'];

for (const asset of assets) {
  const srcFile = path.join(srcDir, asset);
  const distFile = path.join(distDir, asset);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, distFile);
    console.log(`[Build] Ativo estático sincronizado: ${asset} -> dist/api/`);
  }
}
