/**
 * @fileoverview Lógica e Controladores de Interface do Portal Web Administrativo (portal.js)
 * @module Api/PortalUI
 * @description
 * Script de cliente (executado no navegador) que alimenta o portal administrativo e dashboard oficial
 * do protocolo INP. Controla a navegação entre separadores (tabs), os editores interativos de DSL,
 * o envio assíncrono de intenções para a API REST, a visualização em tempo real do fluxo de telemetria
 * via Server-Sent Events (SSE), a comutação de injeção de falhas (Chaos Engineering) e a renderização
 * de métricas de saúde dos microserviços registados.
 *
 * @security Não manipula nem expõe segredos no lado do cliente. Trata as respostas recebidas
 * de forma sanitizada para prevenir injeções de script no navegador (XSS).
 * @audit Permite a operadores e auditores visualizar graficamente os fluxos, passos executados,
 * latências e estados de transação em tempo real.
 */

/**
 * @description Altera o separador ativo da interface web com verificação rigorosa de autorização (RBAC).
 * Redireciona para o login e exibe notificação caso o utilizador tente aceder a consolas restritas sem perfil correspondente.
 *
 * @param {Event | null} event - Evento disparado pelo clique do utilizador ou nulo.
 * @param {string} tabId - Identificador do elemento de conteúdo do separador a apresentar.
 * @security Bloqueia a navegação em separadores administrativos e de auditoria para utilizadores sem permissões.
 * @audit Previne a renderização indevida de dados forenses e de infraestrutura.
 */
function switchTab(event, tabId) {
  const role = currentAuthUser ? currentAuthUser.role : null;

  // Verificação rigorosa de autorização para abas privadas (RBAC)
  if (tabId === 'tab-governance' && role !== 'ADMIN') {
    if (typeof showToast === 'function') showToast('Acesso Restrito: O painel de Governança requer perfil de Administrador.', 'warning');
    if (typeof openAuthModal === 'function') openAuthModal('login');
    return;
  }
  if (tabId === 'tab-audit' && !(role === 'ADMIN' || role === 'AUDITOR' || role === 'SECOPS')) {
    if (typeof showToast === 'function') showToast('Acesso Restrito: A Consola de Auditoria Forense requer credenciais de Auditor ou Administrador.', 'warning');
    if (typeof openAuthModal === 'function') openAuthModal('login');
    return;
  }
  if (tabId === 'tab-dba' && !(role === 'ADMIN' || role === 'DBA')) {
    if (typeof showToast === 'function') showToast('Acesso Restrito: A Consola de DBA requer credenciais de Administrador de Base de Dados.', 'warning');
    if (typeof openAuthModal === 'function') openAuthModal('login');
    return;
  }
  if (tabId === 'tab-client' && !(role === 'ADMIN' || role === 'CLIENT_ENTERPRISE' || role === 'CLIENT_INDIVIDUAL' || role === 'DEVELOPER')) {
    if (typeof showToast === 'function') showToast('Acesso Restrito: Inicie sessão para aceder à sua Área de Cliente.', 'warning');
    if (typeof openAuthModal === 'function') openAuthModal('login');
    return;
  }

  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  
  const contentEl = document.getElementById(tabId);
  if (contentEl) {
    contentEl.classList.add('active');
  }
  
  // Realçar todos os botões correspondentes à aba ativa (Desktop e Mobile)
  document.querySelectorAll(`.tab-btn[data-tab="${tabId}"]`).forEach(btn => btn.classList.add('active'));

  // Atualizar realce visual dos seletores de agrupamento (Dropdowns)
  const ecosystemTabs = ['tab-dictionary', 'tab-tutorial', 'tab-microservices'];
  const privateTabs = ['tab-governance', 'tab-audit', 'tab-dba', 'tab-client'];
  const ecoBtn = document.getElementById('btn-dropdown-ecosystem');
  const privBtn = document.getElementById('btn-dropdown-private');
  if (ecoBtn) ecoBtn.classList.toggle('active', ecosystemTabs.includes(tabId));
  if (privBtn) privBtn.classList.toggle('active', privateTabs.includes(tabId));

  // Fechar gaveta de navegação mobile e dropdowns abertos
  const mobileDrawer = document.getElementById('nav-mobile-drawer');
  const mobileToggle = document.getElementById('btn-mobile-toggle');
  if (mobileDrawer && mobileDrawer.classList.contains('open')) {
    mobileDrawer.classList.remove('open');
    if (mobileToggle) mobileToggle.classList.remove('open');
  }
  document.querySelectorAll('.nav-dropdown').forEach(dd => dd.classList.remove('open'));

  // Despoleta carregamento modular das consolas especializadas de perfil
  if (tabId === 'tab-governance') {
    if (typeof loadUsersList === 'function') loadUsersList();
    if (typeof loadAdminServiceControls === 'function') loadAdminServiceControls();
  }
  if (tabId === 'tab-audit') {
    if (typeof loadAuditData === 'function') loadAuditData();
    if (typeof loadDatabaseLogs === 'function') loadDatabaseLogs();
  }
  if (tabId === 'tab-dba' && typeof loadDbaDashboard === 'function') loadDbaDashboard();
  if (tabId === 'tab-client') {
    if (typeof loadClientDashboard === 'function') loadClientDashboard();
    if (typeof loadClientExecutions === 'function') loadClientExecutions();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Playgrounds presets repository
const presets = {
  'dsl-tutorial': {
    type: 'dsl',
    lang: 'INP DSL',
    text: `INTENT "meu_primeiro_fluxo" {
  CONTEXT {
    amount: 150,
    user_id: "usr_zk_99",
    card_token: "tok_secure123"
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`
  },
  'dsl-purchase': {
    type: 'dsl',
    lang: 'INP DSL',
    text: `INTENT "buy_product" {
  CONTEXT {
    amount: 250.75,
    user_id: "usr_22",
    card_token: "tok_secure123"
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`
  },
  'dsl-advanced': {
    type: 'dsl',
    lang: 'INP DSL',
    text: `INTENT "secure_scoped_flow" {
  CONTEXT {
    amount: 300,
    user_id: "usr_88",
    card_token: "tok_secure123",
    secret_key: "myPassword123"
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      ENCRYPT "secret_key"
      SCOPE {
        EXECUTE PAYMENT
      }
      DECRYPT "secret_key"
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`
  },
  'dsl-resilience': {
    type: 'dsl',
    lang: 'INP DSL',
    text: `INTENT "resilient_payment_flow" {
  CONTEXT {
    amount: 100,
    user_id: "usr_55",
    card_token: "tok_fast123"
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      TIMEOUT 2000 {
        RETRY 3 {
          EXECUTE PAYMENT
        }
      }
    }
  }
  FALLBACK "LOG_ERROR"
  OUTPUT {
    FORMAT "json"
  }
}`
  },
  'dsl-zk-intents': {
    type: 'dsl',
    lang: 'INP DSL',
    text: `INTENT "secure_scoped_flow" {
  CONTEXT {
    amount: 150,
    user_id: "usr_zk_99",
    card_token: "tok_secure123",
    commitment: "74895084a3aaf8f8a047c1d39ced874075948d72733b02c7c126c243b6b5102f",
    proof: "150.confidentialSalt"
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      CONFIDENTIAL_SCOPE {
        VERIFY amount >= 100
        EXECUTE PAYMENT
      }
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`
  },
  'dsl-stream': {
    type: 'dsl',
    lang: 'INP DSL',
    text: `INTENT "streaming_ai_response" {
  CONTEXT {
    prompt: "Gere um plano de arquitetura resiliente para microsserviços",
    streamChannel: "sse_realtime_channel",
    chunkSize: 64
  }
  REQUIRE {
    STREAM AI_RESPONSE
  }
  FLOW {
    SEQUENCE {
      STREAM AI_RESPONSE
    }
  }
  OUTPUT {
    FORMAT "event"
  }
}`
  },
  'dsl-attest': {
    type: 'dsl',
    lang: 'INP DSL',
    text: `INTENT "audit_and_attest_state" {
  CONTEXT {
    auditScope: "SOC2_FINANCIAL_COMPLIANCE",
    transactionId: "tx_998822",
    amount: 15000.00
  }
  REQUIRE {
    ATTEST PROOF_OF_STATE
  }
  FLOW {
    SEQUENCE {
      ATTEST PROOF_OF_STATE
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`
  },
  'dsl-adapt': {
    type: 'dsl',
    lang: 'INP DSL',
    text: `INTENT "intelligent_dynamic_routing" {
  CONTEXT {
    routingStrategy: "EPSILON_GREEDY",
    epsilon: 0.1,
    candidates: ["payment-provider-eu", "payment-provider-us", "payment-provider-latam"]
  }
  REQUIRE {
    ADAPT PAYMENT_PROVIDER
  }
  FLOW {
    SEQUENCE {
      ADAPT PAYMENT_PROVIDER
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`
  },
  'dsl-escalate': {
    type: 'dsl',
    lang: 'INP DSL',
    text: `INTENT "high_risk_human_supervision" {
  CONTEXT {
    amount: 75000.00,
    user_id: "usr_vip_99",
    riskScore: 0.92,
    supervisorRole: "COMPLIANCE_OFFICER",
    slaTimeoutSeconds: 300
  }
  REQUIRE {
    ESCALATE FRAUD_SUSPICION
  }
  FLOW {
    SEQUENCE {
      ESCALATE FRAUD_SUSPICION
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`
  },
  'dsl-reason': {
    type: 'dsl',
    lang: 'INP DSL',
    text: `INTENT "agentic_chain_of_thought" {
  CONTEXT {
    hypothesis: "Aprovação de limite de crédito corporativo",
    evidence: { creditScore: 820, annualRevenue: 2500000, defaultHistory: false },
    confidenceThreshold: 0.85
  }
  REQUIRE {
    REASON CREDIT_DECISION
  }
  FLOW {
    SEQUENCE {
      REASON CREDIT_DECISION
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`
  },
  'natural-purchase': {
    type: 'natural',
    lang: 'Linguagem Humana',
    text: 'Quero comprar o produto P10 com o valor de 450 euros e notificar user@example.com'
  }
};

function updateLineNumbers() {
  const codeEl = document.getElementById('playground-code');
  const gutterEl = document.getElementById('editor-line-numbers');
  if (!codeEl || !gutterEl) return;
  
  const lines = codeEl.value.split('\n');
  const linesCount = lines.length;
  let html = '';
  for (let i = 1; i <= linesCount; i++) {
    html += `<span>${i}</span>`;
  }
  gutterEl.innerHTML = html;
  gutterEl.scrollTop = codeEl.scrollTop;
}

function loadPlaygroundPreset() {
  const select = document.getElementById('playground-presets');
  const data = select ? presets[select.value] : null;
  if (data) {
    const typeEl = document.getElementById('playground-type');
    const codeEl = document.getElementById('playground-code');
    const langEl = document.getElementById('editor-lang-indicator');
    if (typeEl) typeEl.value = data.type;
    if (codeEl) codeEl.value = data.text;
    if (langEl) langEl.innerText = data.lang;
    updateLineNumbers();
    updateFlowPreview();
  }
}

function runEditorLinter(code) {
  const panel = document.getElementById('editor-lint-panel');
  if (!panel) return;

  if (!code || !code.trim()) {
    panel.style.display = 'none';
    return;
  }

  // Helper to show success
  function showSuccess() {
    panel.style.display = 'block';
    panel.style.background = 'rgba(16, 185, 129, 0.05)';
    panel.style.border = '1px solid rgba(16, 185, 129, 0.2)';
    panel.style.color = '#10b981';
    panel.innerHTML = '✔ <strong>Sintaxe DSL Válida!</strong> O formato do fluxo e os blocos estão corretos.';

    const btnRun = document.getElementById('btn-run-intent');
    if (btnRun) {
      btnRun.removeAttribute('disabled');
      btnRun.style.opacity = '1';
      btnRun.style.cursor = 'pointer';
    }
  }

  // Helper to show error
  function showError(lineNum, message, fixTip) {
    panel.style.display = 'block';
    panel.style.background = 'rgba(255, 42, 95, 0.04)';
    panel.style.border = '1px solid rgba(255, 42, 95, 0.25)';
    panel.style.color = 'var(--error)';
    panel.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 4px;">❌ Erro de Sintaxe (IntelliSense)</div>
      <div>${lineNum ? `<strong>Linha ${lineNum}:</strong> ` : ''}${message}</div>
      ${fixTip ? `<div style="color: var(--text-muted); font-size: 11.5px; margin-top: 4px;">💡 <em>Dica: ${fixTip}</em></div>` : ''}
    `;

    const btnRun = document.getElementById('btn-run-intent');
    if (btnRun) {
      btnRun.setAttribute('disabled', 'true');
      btnRun.style.opacity = '0.4';
      btnRun.style.cursor = 'not-allowed';
    }
  }

  // 1. Balanced Braces Validation
  let openBraces = 0;
  let closeBraces = 0;
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    openBraces += (line.match(/\{/g) || []).length;
    closeBraces += (line.match(/\}/g) || []).length;
  }

  if (openBraces !== closeBraces) {
    if (openBraces > closeBraces) {
      showError(null, `Chaves desbalanceadas: Há ${openBraces} chaves abertas '{' e apenas ${closeBraces} fechadas '}'.`, `Adicione ${openBraces - closeBraces} chave(s) fechada(s) '}' no final do arquivo para fechar os blocos.`);
    } else {
      showError(null, `Chaves desbalanceadas: Há ${closeBraces} chaves fechadas '}' e apenas ${openBraces} abertas '{'.`, `Remova as chaves fechadas '}' sobressalentes ou adicione as chaves abertas correspondentes.`);
    }
    return;
  }

  // 2. Strict Line-by-Line Regex Validation
  const patterns = [
    /^INTENT\s+"[a-zA-Z0-9_\-]+"(\s*\{)?$/,
    /^CONTEXT(\s*\{)?$/,
    /^REQUIRE(\s*\{)?$/,
    /^FLOW(\s*\{)?$/,
    /^OUTPUT(\s*\{)?$/,
    /^SEQUENCE(\s*\{)?$/,
    /^PARALLEL(\s*\{)?$/,
    /^PIPELINE(\s*\{)?$/,
    /^TIMEOUT\s+[0-9]+(\s*\{)?$/,
    /^RETRY\s+[0-9]+(\s*\{)?$/,
    /^CONDITION\s+"[^"]+"(\s*\{)?$/,
    /^DEPENDENCY\s+"[^"]+"(\s*\{)?$/,
    /^(CONFIDENTIAL_SCOPE|SCOPE)(\s*\{)?$/,
    /^(EXECUTE|VERIFY)\s+[A-Z0-9_]+(\s+[A-Z0-9_]+)*$/,
    /^(ENCRYPT|DECRYPT)\s+"[a-zA-Z0-9_\-]+"$/,
    /^VERIFY\s+[a-zA-Z0-9_\-"]+\s*(>=|<=|>|<|==)\s*[0-9.]+$/,
    /^FALLBACK\s+"[a-zA-Z0-9_\-]+"$/,
    /^FORMAT\s+"[a-zA-Z0-9_\-]+"$/,
    /^\}$/
  ];

  const reservedWordsLower = [
    'intent', 'context', 'flow', 'sequence', 'parallel', 'pipeline',
    'require', 'execute', 'encrypt', 'decrypt', 'output', 'fallback',
    'scope', 'confidential_scope', 'verify', 'timeout', 'retry',
    'condition', 'dependency', 'format'
  ];

  let inContext = false;
  let contextNesting = 0;
  const mandatoryBlocks = {
    'INTENT': false,
    'CONTEXT': false,
    'REQUIRE': false,
    'FLOW': false,
    'OUTPUT': false
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNum = i + 1;

    // Strip comments
    const commentIdx = rawLine.indexOf('//');
    let cleanLine = rawLine;
    if (commentIdx !== -1) {
      cleanLine = rawLine.substring(0, commentIdx);
    }
    cleanLine = cleanLine.trim();

    if (!cleanLine) continue;

    // A. Detect block boundaries and nesting
    if (cleanLine.includes('CONTEXT {')) {
      inContext = true;
      contextNesting = 1;
    }

    let netBraces = 0;
    if (inContext && !cleanLine.includes('CONTEXT {')) {
      let openCount = 0;
      let closeCount = 0;
      let inDoubleQuote = false;
      let inSingleQuote = false;
      let escape = false;
      for (let charIdx = 0; charIdx < cleanLine.length; charIdx++) {
        const char = cleanLine[charIdx];
        if (escape) { escape = false; continue; }
        if (char === '\\') { escape = true; continue; }
        if (char === '"' && !inSingleQuote) { inDoubleQuote = !inDoubleQuote; continue; }
        if (char === "'" && !inDoubleQuote) { inSingleQuote = !inSingleQuote; continue; }
        if (!inDoubleQuote && !inSingleQuote) {
          if (char === '{' || char === '[') openCount++;
          if (char === '}' || char === ']') closeCount++;
        }
      }
      netBraces = openCount - closeCount;
    }

    // B. Match strict patterns
    let matched = false;
    if (inContext && !cleanLine.includes('CONTEXT {')) {
      const tempNesting = contextNesting + netBraces;
      if (tempNesting === 0 && cleanLine === '}') {
        matched = true;
        inContext = false;
        contextNesting = 0;
      } else {
        if (contextNesting === 1) {
          const simplePattern = /^[a-zA-Z0-9_\-]+:\s*("[^"]*"|[0-9]+(\.[0-9]+)?|true|false)\s*,?$/;
          const nestedStartPattern = /^[a-zA-Z0-9_\-]+:\s*(\{|\[)\s*$/;
          matched = simplePattern.test(cleanLine) || nestedStartPattern.test(cleanLine);
        } else {
          const nestedKeyValuePattern = /^("[a-zA-Z0-9_\-]+"|[a-zA-Z0-9_\-]+):\s*("[^"]*"|[0-9]+(\.[0-9]+)?|true|false|(\{|\[))\s*,?$/;
          const arrayItemPattern = /^("[^"]*"|[0-9]+(\.[0-9]+)?|true|false)\s*,?$/;
          const closingPattern = /^(\{|\[|\}|\]),?$/;
          matched = nestedKeyValuePattern.test(cleanLine) || arrayItemPattern.test(cleanLine) || closingPattern.test(cleanLine);
        }
        contextNesting = tempNesting;
      }
    } else {
      for (const pattern of patterns) {
        if (pattern.test(cleanLine)) {
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      showError(lineNum, `Comando inválido, caractere estranho ou erro de sintaxe detectado: "${cleanLine}"`, `Remova caracteres inválidos (como pontos '.', vírgulas ',' em locais incorretos ou termos não suportados) para que a DSL possa ser compilada.`);
      return;
    }

    // C. Detect reserved words in lowercase
    const tokens = cleanLine.split(/[\s"{}()]+/);
    for (const token of tokens) {
      if (reservedWordsLower.includes(token.toLowerCase()) && token !== token.toUpperCase()) {
        showError(lineNum, `Palavra reservada '${token}' escrita em caixa baixa ou mista.`, `A DSL diferencia maiúsculas de minúsculas. Escreva sempre em letras maiúsculas: "${token.toUpperCase()}".`);
        return;
      }
    }

    // D. Check block presence
    for (const key of Object.keys(mandatoryBlocks)) {
      if (cleanLine.toUpperCase().includes(key + ' {') || cleanLine.toUpperCase().startsWith(key + ' "') || cleanLine.toUpperCase() === key) {
        mandatoryBlocks[key] = true;
      }
    }

    // E. Detailed check inside CONTEXT
    if (inContext && !cleanLine.includes('CONTEXT {') && contextNesting >= 1) {
      if (cleanLine.includes(':')) {
        const parts = cleanLine.split(':');
        const key = parts[0].trim();
        const valuePart = parts.slice(1).join(':').trim();
        const valueClean = valuePart.replace(/,$/, '').trim();

        if (contextNesting === 1) {
          const nextLineIdx = i + 1;
          let nextLine = '';
          for (let j = nextLineIdx; j < lines.length; j++) {
            const nl = lines[j].split('//')[0].trim();
            if (nl) {
              nextLine = nl;
              break;
            }
          }
          const isLastItem = nextLine === '}';
          if (!valuePart.endsWith(',') && !isLastItem && !valueClean.endsWith('{') && !valueClean.endsWith('[')) {
            showError(lineNum, `Falta uma vírgula ',' para separar este dado do próximo no CONTEXT.`, `Adicione uma vírgula no final da linha: "${cleanLine},".`);
            return;
          }
        }

        if (valueClean && isNaN(Number(valueClean)) && valueClean !== 'true' && valueClean !== 'false' && !valueClean.startsWith('{') && !valueClean.startsWith('[')) {
          if (!valueClean.startsWith('"') || !valueClean.endsWith('"')) {
            showError(lineNum, `O valor de texto '${valueClean}' não está entre aspas duplas.`, `Strings na DSL devem ser encapsuladas em aspas: "${key}: \\"${valueClean}\\"${valuePart.endsWith(',') ? ',' : ''}".`);
            return;
          }
        }
      }
    }

    // F. Detailed check outside CONTEXT
    if (!inContext && !cleanLine.includes('CONTEXT {')) {
      if (cleanLine.includes(',')) {
        showError(lineNum, `Vírgula ',' indevida encontrada fora do bloco CONTEXT.`, `Remova a vírgula do final da linha. Os blocos FLOW, REQUIRE e outros não utilizam vírgulas.`);
        return;
      }
    }
  }

  // 3. Mandatory blocks check
  for (const [key, present] of Object.entries(mandatoryBlocks)) {
    if (!present) {
      showError(null, `Bloco obrigatório '${key}' ausente ou com sintaxe incorreta.`, `Toda DSL funcional precisa conter os blocos INTENT, CONTEXT, REQUIRE, FLOW e OUTPUT.`);
      return;
    }
  }

  showSuccess();
}

function updateFlowPreview() {
  const codeEl = document.getElementById('playground-code');
  const typeEl = document.getElementById('playground-type');
  const container = document.getElementById('flow-preview-container');
  const canvas = document.getElementById('flow-preview-canvas');

  if (!codeEl || !typeEl || !container || !canvas) return;

  const code = codeEl.value;
  const isDsl = typeEl.value === 'dsl';
  
  if (!isDsl || !code.trim()) {
    container.style.display = 'none';
    const panel = document.getElementById('editor-lint-panel');
    if (panel) panel.style.display = 'none';
    return;
  }

  runEditorLinter(code);
  
  try {
    canvas.innerHTML = '';
    
    const flowMatch = code.match(/FLOW\s*\{([\s\S]*)\}/i);
    if (!flowMatch) {
      canvas.innerHTML = '<span style="color: var(--text-muted); font-size: 11px;">Escreva um bloco FLOW { ... } na DSL para visualizar o fluxo...</span>';
      container.style.display = 'block';
      return;
    }
    
    const flowContent = flowMatch[1];
    const lines = flowContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let currentBlock = canvas;
    let blockStack = [canvas];
    let indentLevel = 0;
    
    for (const line of lines) {
      if (line.includes('{')) {
        const blockType = line.split('{')[0].trim().toUpperCase() || 'BLOCK';
        const blockDiv = document.createElement('div');
        blockDiv.className = 'flow-block';
        blockDiv.style.borderLeft = '3px solid ' + (blockType.includes('PARALLEL') ? 'var(--warning)' : 'var(--primary)');
        blockDiv.style.paddingLeft = '10px';
        blockDiv.style.margin = '4px 0';
        blockDiv.style.background = 'rgba(255, 255, 255, 0.02)';
        blockDiv.style.borderRadius = '4px';
        blockDiv.style.padding = '8px';
        
        const label = document.createElement('div');
        label.style.fontWeight = 'bold';
        label.style.fontSize = '10px';
        label.style.color = blockType.includes('PARALLEL') ? 'var(--warning)' : 'var(--primary)';
        label.innerText = blockType;
        blockDiv.appendChild(label);
        
        const stepsContainer = document.createElement('div');
        stepsContainer.className = 'steps-container';
        stepsContainer.style.display = 'flex';
        stepsContainer.style.flexDirection = blockType.includes('PARALLEL') ? 'row' : 'column';
        stepsContainer.style.flexWrap = 'wrap';
        stepsContainer.style.gap = '8px';
        stepsContainer.style.marginTop = '4px';
        blockDiv.appendChild(stepsContainer);
        
        currentBlock.appendChild(blockDiv);
        blockStack.push(stepsContainer);
        currentBlock = stepsContainer;
        indentLevel++;
      } else if (line.includes('}')) {
        if (blockStack.length > 1) {
          blockStack.pop();
          currentBlock = blockStack[blockStack.length - 1];
        } else {
          currentBlock = canvas;
        }
        indentLevel = Math.max(0, indentLevel - 1);
      } else if (line.toUpperCase().startsWith('EXECUTE') || line.toUpperCase().startsWith('ENCRYPT') || line.toUpperCase().startsWith('DECRYPT') || line.toUpperCase().startsWith('VERIFY')) {
        const parts = line.split(/\s+/);
        const verb = parts[0].toUpperCase();
        const target = parts.slice(1).join(' ').replace(/['"{}]/g, '').trim();
        const stepDiv = document.createElement('div');
        stepDiv.className = 'flow-step';
        stepDiv.style.background = 'rgba(16, 185, 129, 0.05)';
        stepDiv.style.border = '1px solid var(--secondary)';
        stepDiv.style.borderRadius = '6px';
        stepDiv.style.padding = '4px 10px';
        stepDiv.style.fontSize = '11px';
        stepDiv.style.display = 'inline-flex';
        stepDiv.style.alignItems = 'center';
        stepDiv.style.gap = '6px';
        
        stepDiv.innerHTML = `
          <span style="color: var(--secondary); font-weight: bold;">●</span>
          <span>${verb}: <strong>${target}</strong></span>
        `;
        
        currentBlock.appendChild(stepDiv);
      }
    }
    
    if (canvas.children.length === 0) {
      canvas.innerHTML = '<span style="color: var(--text-muted); font-size: 11px;">Estrutura do fluxo vazia...</span>';
    }
    
    container.style.display = 'block';
  } catch (err) {
    canvas.innerHTML = '<span style="color: var(--error); font-size: 11px;">Erro no preview: ' + err.message + '</span>';
    container.style.display = 'block';
  }
}

function downloadPostmanCollection() {
  window.open('/api/export/postman', '_blank');
}

function downloadNodeSDK() {
  window.open('/api/export/sdk', '_blank');
}

// Notification Toast Helper
/**
 * @description Apresenta uma notificação flutuante holográfica de feedback instantâneo.
 * @param {string} message - Mensagem amigável a apresentar ao utilizador.
 * @param {'success' | 'warning' | 'error' | 'info'} [type='success'] - Categoria visual da notificação.
 */
function showToast(message, type = 'success') {
  let toast = document.getElementById('inp-global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'inp-global-toast';
    toast.className = 'inp-toast';
    document.body.appendChild(toast);
  }
  const icons = {
    success: '✓',
    warning: '⚠️',
    error: '✕',
    info: 'ℹ️'
  };
  const colors = {
    success: '#00ff9d',
    warning: '#f59e0b',
    error: '#f43f5e',
    info: '#00f5ff'
  };
  toast.innerHTML = `<span style="color: ${colors[type] || '#00ff9d'}; font-size: 16px;">${icons[type] || '✓'}</span> <span>${message}</span>`;
  toast.classList.add('show');
  
  if (window._toastTimeout) {
    clearTimeout(window._toastTimeout);
  }
  window._toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

/**
 * @description Copia um snippet de código para a área de transferência com feedback visual futurista.
 * @param {string} text - Texto ou código a ser copiado.
 * @param {HTMLElement} [buttonEl] - Elemento do botão que acionou a cópia para feedback instantâneo.
 */
function copySnippet(text, buttonEl) {
  const onSuccess = () => {
    showToast('✓ Copiado com Sucesso!');
    if (buttonEl && buttonEl.innerText) {
      const originalText = buttonEl.innerText;
      buttonEl.innerText = '✓ Copiado com Sucesso!';
      buttonEl.style.borderColor = 'var(--emerald)';
      buttonEl.style.color = '#00ff9d';
      buttonEl.style.boxShadow = '0 0 15px rgba(0, 255, 157, 0.35)';
      setTimeout(() => {
        buttonEl.innerText = originalText;
        buttonEl.style.borderColor = '';
        buttonEl.style.color = '';
        buttonEl.style.boxShadow = '';
      }, 2000);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
      fallbackCopy(text, onSuccess);
    });
  } else {
    fallbackCopy(text, onSuccess);
  }
}

/**
 * @description Mecanismo de contingência para cópia em contextos não seguros ou navegadores legados.
 * @param {string} text - Texto a ser copiado.
 * @param {Function} [callback] - Função executada após o sucesso da cópia.
 */
function fallbackCopy(text, callback) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    if (callback) {
      callback();
    } else {
      showToast('✓ Copiado com Sucesso!');
    }
  } catch (err) {
    console.error('Erro ao copiar snippet:', err);
  }
  document.body.removeChild(textArea);
}

// Try snippet button action
function trySnippet(presetKey) {
  const select = document.getElementById('playground-presets');
  if (select) {
    select.value = presetKey;
    loadPlaygroundPreset();
  }
  switchTab(null, 'tab-playground');
}

// FAQ Accordion toggler
function toggleFaqAccordion(element) {
  const isOpen = element.classList.contains('open');
  document.querySelectorAll('.faq-card').forEach(el => el.classList.remove('open'));
  if (!isOpen) {
    element.classList.add('open');
  }
}

// Exec intent from Playground
async function runPlaygroundIntent() {
  const codeEl = document.getElementById('playground-code');
  const typeEl = document.getElementById('playground-type');
  const userEl = document.getElementById('play-user-id');
  const permsEl = document.getElementById('play-permissions');
  const statusBadge = document.getElementById('play-status-badge');
  const convAlert = document.getElementById('play-conversational-alert');

  if (!codeEl || !typeEl || !userEl || !permsEl || !statusBadge) return;

  const text = codeEl.value;
  const type = typeEl.value;
  const userId = userEl.value;
  const permsString = permsEl.value;
  const permissions = permsString.split(',').map(s => s.trim()).filter(s => s.length > 0);

  statusBadge.innerText = 'Executando...';
  statusBadge.className = 'badge badge-running';

  if (convAlert) {
    convAlert.style.display = 'none';
  }

  try {
    const res = await fetch('/api/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        type,
        securityContext: { userId, permissions }
      })
    });

    const data = await res.json();
    
    // Render JSON formatting output
    const jsonOutput = document.getElementById('play-result-json');
    if (jsonOutput) {
      jsonOutput.innerText = JSON.stringify(data, null, 2);
    }

    // Render conversational alert if available
    const convText = document.getElementById('play-conversational-text');
    if (data.conversationalResponse && convAlert && convText) {
      convText.innerText = data.conversationalResponse;
      convAlert.style.display = 'block';
    }

    if (data.success && data.result && data.result.status === 'COMPLETED') {
      statusBadge.innerText = 'Sucesso';
      statusBadge.className = 'badge badge-success';
    } else {
      statusBadge.innerText = 'Falha';
      statusBadge.className = 'badge badge-error';
    }

    // Render execution path timeline
    const timeline = document.getElementById('play-timeline');
    if (timeline) {
      if (data.result && data.result.steps && data.result.steps.length > 0) {
        timeline.innerHTML = data.result.steps.map((s, idx) => {
          const isCompleted = s.status === 'COMPLETED';
          const duration = s.durationMs || s.duration_ms || 0;
          const stepId = 'step-' + idx;
          
          return `
            <div class="timeline-item">
              <div class="timeline-dot ${isCompleted ? 'completed' : 'failed'}"></div>
              <div class="timeline-card">
                <div class="timeline-header" data-toggle-target="${stepId}">
                  <span class="timeline-action">${s.action}</span>
                  <div style="display: flex; gap: 10px; align-items: center;">
                    <span class="badge ${isCompleted ? 'badge-success' : 'badge-error'}">${s.status}</span>
                    <span class="timeline-time">${duration}ms</span>
                  </div>
                </div>
                <div id="${stepId}" class="timeline-details" style="display: none;">
                  <div><strong>Input Context:</strong></div>
                  <pre>${JSON.stringify(s.input || {}, null, 2)}</pre>
                  <div style="margin-top: 6px;"><strong>Output Context / Result:</strong></div>
                  <pre>${JSON.stringify(s.output || {}, null, 2)}</pre>
                  ${s.error ? `<div style="color: var(--error); margin-top: 6px;"><strong>Erro:</strong> ${s.error}</div>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        timeline.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding-left: 5px;">Nenhum passo no fluxo ou falha prévia de análise.</div>';
      }
    }

    // Refresh stats, audit forensics and client executions table
    loadHomeStats();
    if (typeof loadDatabaseLogs === 'function') loadDatabaseLogs();
    if (typeof loadClientExecutions === 'function') loadClientExecutions();

  } catch (err) {
    statusBadge.innerText = 'Erro HTTP';
    statusBadge.className = 'badge badge-error';
    const jsonOutput = document.getElementById('play-result-json');
    if (jsonOutput) {
      jsonOutput.innerText = 'Erro de requisição: ' + err.message;
    }
  }
}

function toggleDetails(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }
}

// Load active stats for home Welcome
let prevStats = { active: -1, total: -1, latency: -1, rate: -1 };

function animateCounter(el, targetValue, suffix = '') {
  if (!el || isNaN(targetValue)) return;
  const duration = 800; // ms
  const startTime = performance.now();
  
  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out quad
    const easeProgress = progress * (2 - progress);
    const current = Math.floor(easeProgress * targetValue);
    el.innerText = current + suffix;
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.innerText = targetValue + suffix;
    }
  }
  requestAnimationFrame(update);
}

async function loadHomeStats() {
  try {
    const res = await fetch('/api/dashboard/stats');
    const data = await res.json();
    if (data.success) {
      const activeEl = document.getElementById('stat-active');
      const totalEl = document.getElementById('stat-total');
      const latencyEl = document.getElementById('stat-latency');
      const successRateEl = document.getElementById('stat-success-rate');

      const activeVal = data.stats.activeServices || 0;
      const totalVal = data.stats.totalExecutions || 0;
      const latencyVal = Math.round(data.stats.avgDurationMs || 0);
      
      const completed = data.stats.completedExecutions || 0;
      const total = data.stats.totalExecutions || 0;
      const rateVal = total > 0 ? Math.round((completed / total) * 100) : 100;

      if (activeEl && prevStats.active !== activeVal) {
        animateCounter(activeEl, activeVal, '');
        prevStats.active = activeVal;
      }
      if (totalEl && prevStats.total !== totalVal) {
        animateCounter(totalEl, totalVal, '');
        prevStats.total = totalVal;
      }
      if (latencyEl && prevStats.latency !== latencyVal) {
        animateCounter(latencyEl, latencyVal, ' ms');
        prevStats.latency = latencyVal;
      }
      if (successRateEl && prevStats.rate !== rateVal) {
        animateCounter(successRateEl, rateVal, '%');
        prevStats.rate = rateVal;
      }
    }
  } catch (err) {
    console.error('Home stats failed:', err);
  }
}

// Carregamento público do catálogo de microsserviços ativos (Visão de Interesse Geral)
/**
 * @description Apresenta o catálogo público de microsserviços com saúde, métricas agregadas e capacidades.
 * Isola totalmente controles administrativos e botões de injeção de caos para garantir segurança.
 *
 * @security Não expõe endpoints de rede física nem controlos operacionais para visitantes anónimos.
 * @audit Permite a transparência e conformidade de catálogo no protocolo.
 */
async function loadActiveServices() {
  try {
    const res = await fetch('/api/services/all');
    const data = await res.json();
    const listContainer = document.getElementById('home-services-list');
    if (!listContainer) return;
    
    if (data.services && data.services.length > 0) {
      listContainer.innerHTML = data.services.map(s => {
        const caps = s.capabilities || [];
        const capBadges = caps.map(c => `<span class="cap-badge">${c.verb} ${c.target}</span>`).join('');
        
        let statusClass = s.active ? 'online' : 'offline';
        let statusLabel = s.active ? 'ONLINE' : 'OFFLINE';
        if (s.active && s.status === 'DEGRADED') {
          statusClass = 'degraded';
          statusLabel = 'DEGRADED (Proativo)';
        }
        
        const latencyText = s.avgLatency ? `⏱️ <strong>${s.avgLatency}ms</strong>` : 'N/A';
        const healthScoreText = s.healthScore !== undefined ? `🩺 <strong>${s.healthScore}%</strong>` : `⭐ <strong>${s.trustScore}%</strong>`;

        return `
          <div class="service-card ${s.active ? 'active' : 'inactive'} ${s.status === 'DEGRADED' ? 'degraded' : ''}">
            <div class="service-header">
              <span class="service-name">${s.name}</span>
              <span class="status-indicator ${statusClass}">
                <span class="dot"></span> ${statusLabel}
              </span>
            </div>
            <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 8px; display: flex; gap: 12px; flex-wrap: wrap;">
              <span>Score de Confiança: ${healthScoreText}</span>
              <span>Nível de Segurança: <strong>${s.securityLevel}</strong></span>
              <span>Latência Média: ${latencyText}</span>
            </div>
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-top: 10px; margin-bottom: 6px;">Capacidades Registadas:</div>
            <div class="service-caps">${capBadges}</div>
          </div>
        `;
      }).join('');
    } else {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 30px; border: 1px dashed var(--card-border); border-radius: 12px;">
          <div style="font-size: 24px; margin-bottom: 8px;">🔌</div>
          <div style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">Nenhum microsserviço ativo</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">Inicie o serviço de pagamentos simulado para visualização no catálogo.</div>
          <pre style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; font-family: monospace; font-size: 11px; display: inline-block;">npm run mock-service</pre>
        </div>
      `;
    }
  } catch (err) {
    console.error('Falha ao carregar catálogo público de serviços:', err);
  }
}

/**
 * @description Carrega o painel operacional de microsserviços na aba de Governança (Admin).
 * Inclui endpoints físicos, injeção de falhas (Chaos Engineering) e alternância de estado de serviços.
 *
 * @security Exclusivo para administradores autenticados com permissão de gestão de rede e caos.
 * @audit Cada injeção de falha e alteração de estado é rastreada na base de dados.
 */
async function loadAdminServiceControls() {
  try {
    const res = await authFetch('/api/services/all');
    const data = await res.json();
    const listContainer = document.getElementById('admin-services-list');
    if (!listContainer) return;
    
    if (data.services && data.services.length > 0) {
      listContainer.innerHTML = data.services.map(s => {
        const caps = s.capabilities || [];
        const capBadges = caps.map(c => `<span class="cap-badge">${c.verb} ${c.target}</span>`).join('');
        
        let statusClass = s.active ? 'online' : 'offline';
        let statusLabel = s.active ? 'ONLINE' : 'OFFLINE';
        if (s.active && s.status === 'DEGRADED') {
          statusClass = 'degraded';
          statusLabel = 'DEGRADED (Proativo)';
        }
        
        const latencyText = s.avgLatency ? `⏱️ <strong>${s.avgLatency}ms</strong>` : 'N/A';
        const healthScoreText = s.healthScore !== undefined ? `🩺 <strong>${s.healthScore}%</strong>` : `⭐ <strong>${s.trustScore}%</strong>`;

        return `
          <div class="service-card ${s.active ? 'active' : 'inactive'} ${s.status === 'DEGRADED' ? 'degraded' : ''}">
            <div class="service-header">
              <span class="service-name">${s.name}</span>
              <span class="status-indicator ${statusClass}">
                <span class="dot"></span> ${statusLabel}
              </span>
            </div>
            <div style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 6px;">
              Endpoint Físico: <span class="service-url">${s.endpoint || 'Local Handler'}</span>
            </div>
            <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 6px; display: flex; gap: 10px; flex-wrap: wrap;">
              <span>Score de Confiança: ${healthScoreText}</span>
              <span>Nível: <strong>${s.securityLevel}</strong></span>
              <span>Latência Média: ${latencyText}</span>
            </div>
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-top: 10px;">Capacidades:</div>
            <div class="service-caps">${capBadges}</div>
            
            <div style="margin-top: 12px; border-top: 1px solid var(--card-border); padding-top: 12px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">Simulador de Caos (Resiliência):</div>
              <div class="chaos-btn-group">
                <button class="chaos-btn ${s.chaosState === 'HEALTHY' ? 'active healthy' : ''}" data-service-id="${s.id}" data-chaos-state="HEALTHY">
                  🟢 Saudável
                </button>
                <button class="chaos-btn ${s.chaosState === 'ERROR_500' ? 'active error' : ''}" data-service-id="${s.id}" data-chaos-state="ERROR_500">
                  🔴 Erro 500
                </button>
                <button class="chaos-btn ${s.chaosState === 'LATENCY_5S' ? 'active latency' : ''}" data-service-id="${s.id}" data-chaos-state="LATENCY_5S">
                  🟡 Latência 5s
                </button>
              </div>
            </div>

            <div style="margin-top: 15px; display: flex; justify-content: flex-end;">
              <button class="btn-toggle-service ${s.active ? 'btn-deactivate' : 'btn-activate'}" data-service-id="${s.id}">
                ${s.active ? '🔌 Desativar Serviço' : '⚡ Ativar Serviço'}
              </button>
            </div>
          </div>
        `;
      }).join('');
    } else {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 30px; border: 1px dashed var(--card-border); border-radius: 12px;">
          <div style="font-size: 24px; margin-bottom: 8px;">🔌</div>
          <div style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">Nenhum microsserviço registado</div>
          <div style="font-size: 12px; color: var(--text-muted);">Inicie os microsserviços do cluster para operações e testes de resiliência.</div>
        </div>
      `;
    }
  } catch (err) {
    console.error('Falha ao carregar controlos de administrador dos serviços:', err);
  }
}

/**
 * @description Carrega o histórico forense de execuções persistidas na aba de Auditoria.
 *
 * @security Autenticado com cabeçalho Bearer do auditor ou administrador.
 * @audit Garante rastreabilidade total das transações executadas no PostgreSQL.
 */
async function loadDatabaseLogs() {
  try {
    const res = await authFetch('/api/dashboard/executions');
    const data = await res.json();
    const tableBody = document.querySelector('#audit-db-executions-table tbody');
    if (!tableBody) return;
    
    if (data.success && data.executions && data.executions.length > 0) {
      tableBody.innerHTML = data.executions.map(e => {
        const isCompleted = e.status === 'COMPLETED';
        const statusClass = isCompleted ? 'badge-success' : (e.status === 'RUNNING' ? 'badge-running' : 'badge-error');
        const summary = e.error || (e.output ? 'Sucesso (JSON)' : '-');
        const start = new Date(e.startedAt).toLocaleString();
        const duration = e.completedAt ? `${Math.max(1, new Date(e.completedAt) - new Date(e.startedAt))}ms` : 'Em curso';
        const user = e.userId || 'Anónimo / Sistema';
        
        return `
          <tr>
            <td style="font-family: monospace; font-size: 11.5px; color: var(--secondary);">${e.id}</td>
            <td><span class="badge ${statusClass}">${e.status}</span></td>
            <td style="font-size: 12px; color: var(--text-muted);">${user}</td>
            <td style="font-size: 12px;">${start}</td>
            <td style="font-size: 12px; font-family: monospace;">${duration}</td>
            <td style="font-size: 12px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${summary}">${summary}</td>
          </tr>
        `;
      }).join('');
    } else {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">Nenhuma execução encontrada ou acesso restrito a administradores e auditores.</td>
        </tr>
      `;
    }
  } catch (err) {
    console.error('Falha ao carregar registos de execuções do PostgreSQL:', err);
  }
}

/**
 * @description Carrega o histórico de execuções próprio do cliente autenticado na Área de Cliente.
 *
 * @security Isola estritamente as execuções do utilizador em sessão.
 * @audit Permite conferência de quota consumida e transações pelo próprio cliente.
 */
async function loadClientExecutions() {
  try {
    const res = await authFetch('/api/dashboard/executions');
    const data = await res.json();
    const tableBody = document.getElementById('client-executions-tbody');
    if (!tableBody) return;
    
    if (data.success && data.executions && data.executions.length > 0) {
      tableBody.innerHTML = data.executions.map(e => {
        const isCompleted = e.status === 'COMPLETED';
        const statusClass = isCompleted ? 'badge-success' : (e.status === 'RUNNING' ? 'badge-running' : 'badge-error');
        const summary = e.error || (e.output ? 'Sucesso (JSON)' : '-');
        const start = new Date(e.startedAt).toLocaleString();
        const duration = e.completedAt ? `${Math.max(1, new Date(e.completedAt) - new Date(e.startedAt))}ms` : 'Em curso';
        
        return `
          <tr>
            <td style="font-family: monospace; font-size: 11.5px; color: var(--secondary);">${e.id}</td>
            <td><span class="badge ${statusClass}">${e.status}</span></td>
            <td style="font-size: 12px;">${start}</td>
            <td style="font-size: 12px; font-family: monospace;">${duration}</td>
            <td style="font-size: 12px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${summary}">${summary}</td>
          </tr>
        `;
      }).join('');
    } else {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">Ainda não foram submetidas intenções nesta conta.</td>
        </tr>
      `;
    }
  } catch (err) {
    console.error('Falha ao carregar histórico próprio do cliente:', err);
  }
}

// Check DB Status
async function checkDbConnection() {
  const badge = document.getElementById('db-status');
  if (!badge) return;
  try {
    const res = await fetch('/api/db-status');
    const data = await res.json();
    if (data.success && data.connected) {
      badge.className = 'status-badge online';
      badge.innerHTML = '<span class="dot"></span> DB: PostgreSQL Connected';
    } else {
      badge.className = 'status-badge offline';
      badge.innerHTML = '<span class="dot"></span> DB: PostgreSQL Offline';
    }
  } catch (err) {
    badge.className = 'status-badge offline';
    badge.innerHTML = '<span class="dot"></span> DB: Error';
  }
}

// Expose functions globally to window for HTML onclick attributes compatibility
window.switchTab = switchTab;
window.loadPlaygroundPreset = loadPlaygroundPreset;
window.updateFlowPreview = updateFlowPreview;

// Telemetry DAG Layout and SSE Event Handlers
let currentFlowData = null;
let currentLayoutMode = 'vertical';
let nodeStatuses = {}; // key: idx, value: { classes: [], text: '', color: '' }
let edgeStatuses = {}; // key: idx, value: 'active' | 'completed' | 'rollback'
let telemetryChart = null;

function renderTelemetryDAG(flow) {
  const wrap = document.getElementById('live-visualizer-svg-wrap');
  if (!wrap) return;
  
  wrap.innerHTML = '';
  let nodes = [];
  let index = 0;
  
  function walk(items, depth = 0, parentX = 300) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const stepIdx = index++;
      
      const node = {
        index: stepIdx,
        label: item.action || item.type,
        type: item.type,
        depth: depth,
        width: 190,
        height: 44
      };
      nodes.push(node);
      
      if (item.steps) {
        walk(item.steps, depth + 1, parentX);
      }
    }
  }
  
  walk(flow);
  
  const mode = currentLayoutMode;
  let svgWidth = 600;
  let svgHeight = 220;
  
  if (mode === 'vertical') {
    svgWidth = 600;
    svgHeight = 60 + nodes.length * 80;
    nodes.forEach((node, idx) => {
      node.x = 300;
      node.y = 40 + idx * 80;
    });
  } else if (mode === 'horizontal') {
    svgWidth = 100 + nodes.length * 210;
    svgHeight = 240;
    nodes.forEach((node, idx) => {
      node.x = 100 + idx * 210;
      node.y = 120;
    });
  } else if (mode === 'radial') {
    svgWidth = 600;
    svgHeight = 380;
    const centerX = 300;
    const centerY = 190;
    const R = 130;
    
    if (nodes.length > 0) {
      nodes[0].x = centerX;
      nodes[0].y = centerY;
      nodes[0].isCentral = true;
    }
    
    const satellitesCount = nodes.length - 1;
    for (let i = 1; i < nodes.length; i++) {
      const angle = ((i - 1) / satellitesCount) * 2 * Math.PI - Math.PI / 2;
      nodes[i].x = centerX + R * Math.cos(angle);
      nodes[i].y = centerY + R * Math.sin(angle);
      nodes[i].isCentral = false;
    }
  } else if (mode === 'matrix') {
    svgWidth = 600;
    svgHeight = 80 + nodes.length * 75;
    nodes.forEach((node, idx) => {
      node.x = (idx % 2 === 0) ? 180 : 420;
      node.y = 50 + idx * 75;
    });
  } else if (mode === 'stack') {
    svgWidth = 600;
    svgHeight = 80 + nodes.length * 65;
    nodes.forEach((node, idx) => {
      node.x = 300 - idx * 10;
      node.y = 50 + idx * 65;
    });
  }
  
  let svgContent = `<svg width="100%" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="background: transparent;">`;
  svgContent += `
    <defs>
      <filter id="glow-running" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="8" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
  `;

  // Draw Edges
  if (mode === 'radial') {
    const from = nodes[0];
    for (let i = 1; i < nodes.length; i++) {
      const to = nodes[i];
      const edgeClass = edgeStatuses[i - 1] === 'completed' ? 'dag-edge completed' : 
                        (edgeStatuses[i - 1] === 'active' ? 'dag-edge active' : 
                        (edgeStatuses[i - 1] === 'rollback' ? 'dag-edge rollback' : 'dag-edge'));
      
      const flowStyle = edgeStatuses[i - 1] === 'active' ? 'display: block;' : 'display: none;';
      
      svgContent += `
        <path id="dag-edge-${i - 1}" d="M ${from.x} ${from.y} L ${to.x} ${to.y}" class="${edgeClass}" />
        <g id="dag-edge-flow-${i - 1}" style="${flowStyle}">
          <circle r="6" fill="#00f5ff" filter="url(#glow-running)">
            <animateMotion dur="0.8s" repeatCount="indefinite" path="M ${from.x} ${from.y} L ${to.x} ${to.y}" />
          </circle>
        </g>
      `;
    }
  } else {
    for (let i = 0; i < nodes.length - 1; i++) {
      const from = nodes[i];
      const to = nodes[i+1];
      const edgeClass = edgeStatuses[i] === 'completed' ? 'dag-edge completed' : 
                        (edgeStatuses[i] === 'active' ? 'dag-edge active' : 
                        (edgeStatuses[i] === 'rollback' ? 'dag-edge rollback' : 'dag-edge'));
      
      const flowStyle = edgeStatuses[i] === 'active' ? 'display: block;' : 'display: none;';
      
      let pathD = '';
      if (mode === 'horizontal') {
        pathD = `M ${from.x + 95} ${from.y} L ${to.x - 95} ${to.y}`;
      } else if (mode === 'stack') {
        pathD = `M ${from.x} ${from.y + 20} L ${to.x} ${to.y - 20}`;
      } else {
        pathD = `M ${from.x} ${from.y + 22} L ${to.x} ${to.y - 22}`;
      }
      
      svgContent += `
        <path id="dag-edge-${i}" d="${pathD}" class="${edgeClass}" />
        <g id="dag-edge-flow-${i}" style="${flowStyle}">
          <circle r="6" fill="#00f5ff" filter="url(#glow-running)">
            <animateMotion dur="0.8s" repeatCount="indefinite" path="${pathD}" />
          </circle>
        </g>
      `;
    }
  }
  
  // Render nodes with specific classes and shapes based on selected layout
  nodes.forEach(node => {
    let nodeClass = 'dag-node';
    let icon = '⚡';
    let rx = 10;
    let ry = 10;

    if (node.type === 'SEQUENCE') {
      nodeClass += ' dag-node-sequence';
      icon = '⛓️';
      rx = 6;
      ry = 6;
    } else if (node.type === 'PARALLEL') {
      nodeClass += ' dag-node-parallel';
      icon = '♊';
      rx = 6;
      ry = 6;
    } else if (node.type === 'CONDITION') {
      nodeClass += ' dag-node-condition';
      icon = '❓';
      rx = 20;
      ry = 20;
    } else if (node.type === 'RETRY') {
      nodeClass += ' dag-node-retry';
      icon = '🔁';
      rx = 12;
      ry = 12;
    } else if (node.type === 'TIMEOUT') {
      nodeClass += ' dag-node-timeout';
      icon = '⏱️';
      rx = 12;
      ry = 12;
    } else if (node.label.startsWith('ENCRYPT')) {
      nodeClass += ' dag-node-security';
      icon = '🔐';
    } else if (node.label.startsWith('DECRYPT')) {
      nodeClass += ' dag-node-security';
      icon = '🔓';
    } else if (node.label.includes('PAYMENT')) {
      nodeClass += ' dag-node-payment';
      icon = '💰';
    } else if (node.label.includes('INVENTORY')) {
      nodeClass += ' dag-node-inventory';
      icon = '📦';
    } else if (node.label.includes('NOTIFICATION')) {
      nodeClass += ' dag-node-notification';
      icon = '✉️';
    } else {
      nodeClass += ' dag-node-action';
    }
    
    // Look up status from state cache
    let statusClass = '';
    let statusText = 'PENDENTE';
    let statusColor = 'var(--text-muted)';
    if (nodeStatuses[node.index]) {
      statusClass = ' ' + nodeStatuses[node.index].classes.join(' ');
      statusText = nodeStatuses[node.index].text;
      statusColor = nodeStatuses[node.index].color;
    }
    
    if (mode === 'radial') {
      const r = node.isCentral ? 38 : 32;
      if (node.isCentral) {
        nodeClass += ' dag-node-central';
        icon = '🌌';
      }
      
      svgContent += `
        <g id="dag-node-group-${node.index}">
          <circle id="dag-node-${node.index}" cx="${node.x}" cy="${node.y}" r="${r}" class="${nodeClass}${statusClass}" />
          <text x="${node.x}" y="${node.y - 2}" class="dag-node-text" style="font-size: 10px;">${icon} ${node.label.substring(0, 10)}</text>
          <text id="dag-node-status-${node.index}" x="${node.x}" y="${node.y + 12}" class="dag-node-subtext" style="fill: ${statusColor}; font-size: 8px;">${statusText}</text>
        </g>
      `;
    } else if (mode === 'stack') {
      svgContent += `
        <g id="dag-node-group-${node.index}">
          <polygon id="dag-node-${node.index}" points="${node.x},${node.y-20} ${node.x+120},${node.y} ${node.x},${node.y+20} ${node.x-120},${node.y}" class="${nodeClass}${statusClass}" />
          <text x="${node.x}" y="${node.y - 2}" class="dag-node-text">${icon} ${node.label}</text>
          <text id="dag-node-status-${node.index}" x="${node.x}" y="${node.y + 10}" class="dag-node-subtext" style="fill: ${statusColor};">${statusText}</text>
        </g>
      `;
    } else if (mode === 'matrix') {
      svgContent += `
        <g id="dag-node-group-${node.index}">
          <polygon id="dag-node-${node.index}" points="${node.x-95},${node.y} ${node.x-60},${node.y-22} ${node.x+60},${node.y-22} ${node.x+95},${node.y} ${node.x+60},${node.y+22} ${node.x-60},${node.y+22}" class="${nodeClass}${statusClass}" />
          <text x="${node.x}" y="${node.y - 4}" class="dag-node-text">${icon} ${node.label}</text>
          <text id="dag-node-status-${node.index}" x="${node.x}" y="${node.y + 12}" class="dag-node-subtext" style="fill: ${statusColor};">${statusText}</text>
        </g>
      `;
    } else {
      svgContent += `
        <g id="dag-node-group-${node.index}">
          <rect id="dag-node-${node.index}" x="${node.x - node.width/2}" y="${node.y - node.height/2}" width="${node.width}" height="${node.height}" rx="${rx}" ry="${ry}" class="${nodeClass}${statusClass}" />
          <text x="${node.x}" y="${node.y - 4}" class="dag-node-text">${icon} ${node.label}</text>
          <text id="dag-node-status-${node.index}" x="${node.x}" y="${node.y + 12}" class="dag-node-subtext" style="fill: ${statusColor};">${statusText}</text>
        </g>
      `;
    }
  });
  
  svgContent += `</svg>`;
  wrap.innerHTML = svgContent;
}

function addTelemetryLog(msg, type = 'info') {
  const logBody = document.getElementById('live-telemetry-log-body');
  if (!logBody) return;
  
  if (type === 'start') {
    logBody.innerHTML = '';
  }
  
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];
  
  let color = '#a5b4fc';
  let prefix = 'ℹ️';
  if (type === 'start') { color = '#60a5fa'; prefix = '⚡'; }
  else if (type === 'step') { color = '#38bdf8'; prefix = '▶️'; }
  else if (type === 'success') { color = '#34d399'; prefix = '✔️'; }
  else if (type === 'error') { color = '#f87171'; prefix = '❌'; }
  else if (type === 'heal') { color = '#c084fc'; prefix = '🤖'; }
  else if (type === 'heal-info') { color = '#e9d5ff'; prefix = '💡'; }
  else if (type === 'resolve') { color = '#2dd4bf'; prefix = '🔌'; }
  else if (type === 'warn') { color = '#fbbf24'; prefix = '⚠️'; }
  
  const line = document.createElement('div');
  line.style.display = 'flex';
  line.style.gap = '6px';
  line.style.alignItems = 'flex-start';
  line.style.color = color;
  line.style.padding = '2px 0';
  line.style.borderBottom = '1px solid rgba(255, 255, 255, 0.01)';
  
  line.innerHTML = `
    <span style="color: rgba(255,255,255,0.25); flex-shrink: 0;">[${timeStr}]</span>
    <span style="flex-shrink: 0;">${prefix}</span>
    <span style="word-break: break-all;">${msg}</span>
  `;
  
  logBody.appendChild(line);
  logBody.scrollTop = logBody.scrollHeight;
}

class TelemetryChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.dataPoints = [];
    this.maxDataPoints = 40;
    
    this.currentSecondLatencies = [];
    this.currentSecondThroughput = 0;
    
    this.init();
  }
  
  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    // Initialize with zeros
    for (let i = 0; i < this.maxDataPoints; i++) {
      this.dataPoints.push({ latency: 0, throughput: 0 });
    }
    
    // Update every 1 second
    setInterval(() => {
      const avgLatency = this.currentSecondLatencies.length > 0
        ? this.currentSecondLatencies.reduce((a, b) => a + b, 0) / this.currentSecondLatencies.length
        : 0;
        
      this.dataPoints.push({
        latency: Math.min(avgLatency, 5000),
        throughput: this.currentSecondThroughput
      });
      
      if (this.dataPoints.length > this.maxDataPoints) {
        this.dataPoints.shift();
      }
      
      this.currentSecondLatencies = [];
      this.currentSecondThroughput = 0;
    }, 1000);
    
    this.animate();
  }
  
  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.width = rect.width;
    this.height = rect.height;
  }
  
  recordStep(durationMs) {
    this.currentSecondLatencies.push(durationMs);
    this.currentSecondThroughput++;
  }
  
  animate() {
    this.draw();
    requestAnimationFrame(() => this.animate());
  }
  
  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    
    ctx.clearRect(0, 0, w, h);
    
    const isLight = document.body.classList.contains('light-theme');
    
    // Draw Grid
    ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.05)' : 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    const gridCols = 8;
    const gridRows = 4;
    
    for (let i = 0; i <= gridCols; i++) {
      const x = (w / gridCols) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let i = 0; i <= gridRows; i++) {
      const y = (h / gridRows) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    
    // Find limits
    let maxLat = 100;
    let maxThrough = 5;
    for (const pt of this.dataPoints) {
      if (pt.latency > maxLat) maxLat = pt.latency;
      if (pt.throughput > maxThrough) maxThrough = pt.throughput;
    }
    
    maxLat = Math.ceil(maxLat / 50) * 50;
    maxThrough = Math.ceil(maxThrough / 2) * 2;
    
    const margin = { top: 25, right: 60, bottom: 20, left: 60 };
    const chartW = w - margin.left - margin.right;
    const chartH = h - margin.top - margin.bottom;
    
    ctx.font = '500 10px sans-serif';
    ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.5)' : 'rgba(255, 255, 255, 0.4)';
    
    // Left scale (Latency)
    ctx.textAlign = 'right';
    ctx.fillText(`${maxLat}ms`, margin.left - 8, margin.top + 4);
    ctx.fillText(`${Math.round(maxLat / 2)}ms`, margin.left - 8, margin.top + chartH / 2 + 4);
    ctx.fillText('0ms', margin.left - 8, margin.top + chartH + 4);
    
    // Right scale (Throughput)
    ctx.textAlign = 'left';
    ctx.fillText(`${maxThrough} req/s`, w - margin.right + 8, margin.top + 4);
    ctx.fillText(`${Math.round(maxThrough / 2)} req/s`, w - margin.right + 8, margin.top + chartH / 2 + 4);
    ctx.fillText('0 req/s', w - margin.right + 8, margin.top + chartH + 4);
    
    const getX = (index) => margin.left + (index / (this.maxDataPoints - 1)) * chartW;
    const getLatencyY = (val) => margin.top + chartH - (val / maxLat) * chartH;
    const getThroughputY = (val) => margin.top + chartH - (val / maxThrough) * chartH;
    
    const latencyColor = isLight ? '#0284c7' : '#00f5ff';
    const throughputColor = isLight ? '#7c3aed' : '#a259ff';
    
    // Draw Latency line
    ctx.beginPath();
    ctx.strokeStyle = latencyColor;
    ctx.lineWidth = 2;
    for (let i = 0; i < this.dataPoints.length; i++) {
      const x = getX(i);
      const y = getLatencyY(this.dataPoints[i].latency);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Fill Latency area
    ctx.lineTo(getX(this.dataPoints.length - 1), margin.top + chartH);
    ctx.lineTo(getX(0), margin.top + chartH);
    ctx.closePath();
    const latGrad = ctx.createLinearGradient(0, margin.top, 0, margin.top + chartH);
    latGrad.addColorStop(0, isLight ? 'rgba(2, 132, 199, 0.1)' : 'rgba(0, 245, 255, 0.1)');
    latGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = latGrad;
    ctx.fill();
    
    // Draw Throughput line
    ctx.beginPath();
    ctx.strokeStyle = throughputColor;
    ctx.lineWidth = 2;
    for (let i = 0; i < this.dataPoints.length; i++) {
      const x = getX(i);
      const y = getThroughputY(this.dataPoints[i].throughput);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Fill Throughput area
    ctx.lineTo(getX(this.dataPoints.length - 1), margin.top + chartH);
    ctx.lineTo(getX(0), margin.top + chartH);
    ctx.closePath();
    const throughGrad = ctx.createLinearGradient(0, margin.top, 0, margin.top + chartH);
    throughGrad.addColorStop(0, isLight ? 'rgba(124, 60, 237, 0.1)' : 'rgba(162, 89, 255, 0.1)');
    throughGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = throughGrad;
    ctx.fill();
  }
}

function setupTelemetryListener() {
  const sseStatus = document.getElementById('sse-status-badge');
  const liveContainer = document.getElementById('live-visualizer-container');
  
  console.log('[Telemetry] Connecting to SSE telemetry...');
  const authToken = localStorage.getItem('inp_auth_token');
  const sseUrl = authToken ? `/api/telemetry?token=${encodeURIComponent(authToken)}` : '/api/telemetry';
  const source = new EventSource(sseUrl);
  
  source.onopen = () => {
    console.log('[Telemetry] SSE connected');
    if (sseStatus) {
      sseStatus.innerText = 'Connected';
      sseStatus.style.color = 'var(--secondary)';
    }
  };
  
  source.onerror = () => {
    if (sseStatus) {
      sseStatus.innerText = 'Disconnected';
      sseStatus.style.color = 'var(--error)';
    }
  };
  
  let stepIdToIdx = {};

  // Layout selector change event binding
  const layoutSelector = document.getElementById('dag-layout-selector');
  if (layoutSelector) {
    layoutSelector.value = currentLayoutMode;
    layoutSelector.onchange = (e) => {
      currentLayoutMode = e.target.value;
      if (currentFlowData) {
        renderTelemetryDAG(currentFlowData);
      }
    };
  }

  source.addEventListener('EXECUTION_STARTED', (e) => {
    const event = JSON.parse(e.data);
    stepIdToIdx = {};
    nodeStatuses = {};
    edgeStatuses = {};
    if (liveContainer) {
      liveContainer.style.display = 'block';
    }
    currentFlowData = event.flow;
    renderTelemetryDAG(event.flow);
    addTelemetryLog('⚡ Execução da Intenção Iniciada para "' + (event.intentName || event.name || 'Sem Nome') + '"', 'start');
  });
  
  source.addEventListener('STEP_STARTED', (e) => {
    const event = JSON.parse(e.data);
    const idx = event.stepIndex;
    stepIdToIdx[event.stepId] = idx;
    
    nodeStatuses[idx] = {
      classes: ['running'],
      text: 'EXECUTANDO...',
      color: '#3b82f6'
    };
    edgeStatuses[idx - 1] = 'active';
    
    if (currentFlowData) renderTelemetryDAG(currentFlowData);
    addTelemetryLog('▶️ Iniciando Passo: "' + event.stepId + '" (Index: ' + event.stepIndex + ')', 'step');
  });
  
  source.addEventListener('STEP_COMPLETED', (e) => {
    const event = JSON.parse(e.data);
    const idx = event.stepIndex;
    
    nodeStatuses[idx] = {
      classes: ['completed'],
      text: `CONCLUÍDO (${event.durationMs}ms)`,
      color: 'var(--secondary)'
    };
    edgeStatuses[idx - 1] = 'completed';
    
    if (telemetryChart) {
      telemetryChart.recordStep(event.durationMs);
    }
    
    if (currentFlowData) renderTelemetryDAG(currentFlowData);
    addTelemetryLog('✔️ Passo Concluído: "' + event.stepId + '" em ' + event.durationMs + 'ms', 'success');
  });
  
  source.addEventListener('STEP_FAILED', (e) => {
    const event = JSON.parse(e.data);
    const idx = event.stepIndex;
    
    nodeStatuses[idx] = {
      classes: ['failed'],
      text: `FALHOU (${event.error || 'Erro'})`,
      color: 'var(--error)'
    };
    edgeStatuses[idx - 1] = 'failed';
    
    if (telemetryChart) {
      telemetryChart.recordStep(event.durationMs || 0);
    }
    
    if (currentFlowData) renderTelemetryDAG(currentFlowData);
    addTelemetryLog('❌ Passo Falhou: "' + event.stepId + '" | Erro: ' + (event.error || 'Erro desconhecido'), 'error');
  });
  
  source.addEventListener('SELF_HEAL_ATTEMPTED', (e) => {
    const event = JSON.parse(e.data);
    let targetIdx = -1;
    if (currentFlowData) {
      let tempNodes = [];
      let idxCount = 0;
      function walk(items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const stepIdx = idxCount++;
          tempNodes.push({ index: stepIdx, label: item.action || item.type });
          if (item.steps) walk(item.steps);
        }
      }
      walk(currentFlowData);
      const matchedNode = tempNodes.find(n => n.label.includes(event.action));
      if (matchedNode) targetIdx = matchedNode.index;
    }
    
    if (targetIdx !== -1) {
      if (!nodeStatuses[targetIdx]) {
        nodeStatuses[targetIdx] = { classes: [], text: '', color: '' };
      }
      nodeStatuses[targetIdx].classes.push('self_healed');
      nodeStatuses[targetIdx].text = '🤖 AI AUTO-HEALED';
      nodeStatuses[targetIdx].color = '#8b5cf6';
    }
    
    if (currentFlowData) renderTelemetryDAG(currentFlowData);
    addTelemetryLog('🤖 Auto-Cura da IA: Corrigindo passo "' + event.action + '"...', 'heal');
    addTelemetryLog('💡 Explicação da IA: "' + event.explanation + '"', 'heal-info');
  });
  
  source.addEventListener('SERVICE_RESOLVED', (e) => {
    const event = JSON.parse(e.data);
    const idx = stepIdToIdx[event.stepId];
    if (idx === undefined) return;
    
    if (!nodeStatuses[idx]) {
      nodeStatuses[idx] = { classes: [], text: '', color: '' };
    }
    if (event.isPeer) {
      nodeStatuses[idx].classes.push('peer');
    }
    nodeStatuses[idx].text = `${event.isPeer ? '🔗 ' : ''}${event.serviceName}`;
    
    if (currentFlowData) renderTelemetryDAG(currentFlowData);
    addTelemetryLog('🔌 Serviço Resolvido: "' + event.serviceName + '"' + (event.isPeer ? ' via Peer P2P Gateway' : ''), 'resolve');
  });
  
  source.addEventListener('SAGA_ROLLBACK_STARTED', (e) => {
    const title = document.querySelector('#live-visualizer-container h3');
    if (title) {
      title.innerHTML = `<span class="logo-pulse" style="width: 8px; height: 8px; background-color: var(--warning); box-shadow: 0 0 8px var(--warning);"></span> Rollback Saga em Andamento (Compensação)...`;
      title.style.color = 'var(--warning)';
    }
    for (let key in edgeStatuses) {
      edgeStatuses[key] = 'rollback';
    }
    if (currentFlowData) renderTelemetryDAG(currentFlowData);
    addTelemetryLog('⚠️ Falha crítica detectada! Iniciando compensação (Saga Rollback)...', 'warn');
  });
  
  source.addEventListener('SAGA_COMPENSATION_STEP', (e) => {
    const event = JSON.parse(e.data);
    let targetIdx = -1;
    if (currentFlowData) {
      let tempNodes = [];
      let idxCount = 0;
      function walk(items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const stepIdx = idxCount++;
          tempNodes.push({ index: stepIdx, label: item.action || item.type });
          if (item.steps) walk(item.steps);
        }
      }
      walk(currentFlowData);
      const matchedNode = tempNodes.find(n => n.label.includes(event.capability));
      if (matchedNode) targetIdx = matchedNode.index;
    }
    
    if (targetIdx !== -1) {
      if (!nodeStatuses[targetIdx]) {
        nodeStatuses[targetIdx] = { classes: [], text: '', color: '' };
      }
      nodeStatuses[targetIdx].classes.push('compensating');
      if (event.status === 'RUNNING') {
        nodeStatuses[targetIdx].classes.push('running');
      } else if (event.status === 'COMPLETED') {
        nodeStatuses[targetIdx].classes.push('completed');
      } else if (event.status === 'FAILED') {
        nodeStatuses[targetIdx].classes.push('failed');
      }
      nodeStatuses[targetIdx].text = `REVERTIDO (${event.status})`;
      nodeStatuses[targetIdx].color = event.status === 'COMPLETED' ? 'var(--warning)' : (event.status === 'FAILED' ? 'var(--error)' : 'var(--warning)');
    }
    
    if (currentFlowData) renderTelemetryDAG(currentFlowData);
    addTelemetryLog('🔄 Revertendo Passo: "' + event.capability + '" | Status: ' + event.status, 'warn');
  });

  source.addEventListener('EXECUTION_FINISHED', () => {
    setTimeout(() => {
      const title = document.querySelector('#live-visualizer-container h3');
      if (title) {
        title.innerHTML = `<span class="logo-pulse" style="width: 8px; height: 8px; background-color: var(--secondary); box-shadow: 0 0 8px var(--secondary);"></span> Visualizador de Fluxo em Tempo Real (Live Telemetry DAG)`;
        title.style.color = 'var(--secondary)';
      }
    }, 5000);
    addTelemetryLog('✔️ Orquestração da intenção finalizada.', 'success');
  });
}

function initSubTabSwitching() {
  document.querySelectorAll('[data-sub-tab]').forEach(el => {
    el.addEventListener('click', (e) => {
      const targetSubTab = e.currentTarget.getAttribute('data-sub-tab');
      
      // Update sub-tab buttons state
      e.currentTarget.parentElement.querySelectorAll('[data-sub-tab]').forEach(btn => {
        btn.classList.remove('active');
      });
      e.currentTarget.classList.add('active');
      
      // Hide all sub-tab contents
      document.querySelectorAll('.sub-tab-content').forEach(content => {
        content.style.display = 'none';
      });
      
      // Show target sub-tab content
      const targetEl = document.getElementById(targetSubTab);
      if (targetEl) {
        targetEl.style.display = 'block';
        targetEl.style.animation = 'fadeInContent 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
      }

      // Handle specific sub-tab active triggers
      if (targetSubTab === 'tutorial-builder') {
        updateBuilderLiveDSL();
      } else if (targetSubTab === 'tutorial-lab') {
        updateHackingGutter();
      }
    });
  });
}

// --- EXPLORER DE CONCEITOS DATA & ENGINE ---
const conceptLevels = {
  basico: {
    title: 'Fluxo de Intenção Padrão',
    code: `INTENT "meu_primeiro_fluxo" {
  
  CONTEXT {
    amount: 150,
    user_id: "usr_zk_99"
  }
 
  REQUIRE {
    EXECUTE PAYMENT
  }
 
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
 
  OUTPUT {
    FORMAT "json"
  }
}`,
    tokens: {
      intent: {
        icon: '🔑',
        title: 'Cabeçalho INTENT',
        subtitle: 'Identificador único do fluxo',
        body: 'O bloco <code>INTENT</code> é o ponto de entrada da DSL. Ele define o nome pelo qual o fluxo será registrado no banco de dados e catalogado.<br><br><strong>O que evitar:</strong> Usar caracteres especiais ou espaços no nome. Use apenas letras, números e sublinhados (underlines).<br><strong>Exemplo:</strong> <code>INTENT "meu_fluxo" { ... }</code>'
      },
      context: {
        icon: '💼',
        title: 'Bloco CONTEXT',
        subtitle: 'Variáveis e Mala de Dados',
        body: 'O bloco <code>CONTEXT</code> é onde você declara todas as variáveis e informações que as capacidades do fluxo precisarão consumir.<br><br><strong>O que evitar:</strong> Esquecer de colocar vírgulas <code>,</code> para separar cada linha de dados. A última linha do bloco CONTEXT não deve conter vírgula.<br><strong>Exemplo:</strong> <code>amount: 150, user_id: "usr_1"</code>'
      },
      require: {
        icon: '🛠️',
        title: 'Bloco REQUIRE',
        subtitle: 'Requisitos de Capacidades',
        body: 'O bloco <code>REQUIRE</code> avisa ao gateway do INP quais capacidades (capacidades físicas dos microsserviços) devem estar ativas no sistema para que este fluxo possa rodar.<br><br><strong>O que evitar:</strong> Usar aspas no nome da capacidade ou separar itens com vírgulas. Apenas liste as capacidades separando por linha.<br><strong>Exemplo:</strong> <code>EXECUTE PAYMENT</code>'
      },
      flow: {
        icon: '⚙️',
        title: 'Bloco FLOW',
        subtitle: 'Lógica e Script de Execução',
        body: 'O bloco <code>FLOW</code> descreve a coreografia e o algoritmo do fluxo. É aqui que você decide a ordem de execução das capacidades declaradas no REQUIRE.<br><br><strong>O que evitar:</strong> Chamar capacidades que não foram listadas no bloco REQUIRE. Isso gerará um erro de compilação imediato.'
      },
      output: {
        icon: '📥',
        title: 'Bloco OUTPUT',
        subtitle: 'Configurações de Resposta',
        body: 'O bloco <code>OUTPUT</code> define como o resultado do pipeline deve ser formatado antes de retornar para o cliente.<br><br><strong>O que evitar:</strong> Definir formatos não suportados. O padrão é "json".'
      }
    }
  },
  resiliencia: {
    title: 'Fluxo Resiliente com Retry/Timeout',
    code: `INTENT "fluxo_resiliente" {
  
  CONTEXT {
    amount: 250,
    user_id: "usr_resilient_22"
  }
 
  REQUIRE {
    EXECUTE PAYMENT
  }
 
  FLOW {
    SEQUENCE {
      TIMEOUT 5s {
        RETRY 3 {
          EXECUTE PAYMENT
        }
      }
    }
  }
 
  OUTPUT {
    FORMAT "json"
  }
}`,
    tokens: {
      intent: {
        icon: '🔑',
        title: 'Cabeçalho INTENT',
        subtitle: 'Identificador único do fluxo',
        body: 'O bloco <code>INTENT</code> define o nome do fluxo resiliente para orquestração.<br><br><strong>O que evitar:</strong> Letras minúsculas em termos protegidos.'
      },
      context: {
        icon: '💼',
        title: 'Bloco CONTEXT',
        subtitle: 'Variáveis e Mala de Dados',
        body: 'Declaração de dados que serão consumidos pelo fluxo. Números não precisam de aspas.'
      },
      require: {
        icon: '🛠️',
        title: 'Bloco REQUIRE',
        subtitle: 'Requisitos de Capacidades',
        body: 'Lista capacidades necessárias ativas. Sem vírgulas.'
      },
      flow: {
        icon: '⚙️',
        title: 'Bloco FLOW',
        subtitle: 'Lógica e Script de Execução',
        body: 'Coração da lógica orquestrada. Executa passos lógicos na sequência determinada.'
      },
      timeout: {
        icon: '⏱️',
        title: 'Instrução TIMEOUT',
        subtitle: 'Garantia de Tempo de Resposta',
        body: 'A instrução <code>TIMEOUT 5s { ... }</code> limita o tempo máximo que o bloco interno pode levar para executar. Se o microsserviço demorar mais de 5 segundos, a execução é interrompida com erro, evitando travamento de conexões.<br><br><strong>O que evitar:</strong> Colocar timeouts muito curtos (como <code>1s</code>) em serviços integrados externos lentos.'
      },
      retry: {
        icon: '🔁',
        title: 'Instrução RETRY',
        subtitle: 'Auto-Recuperação de Falhas Temporárias',
        body: 'A instrução <code>RETRY 3 { ... }</code> define que, em caso de instabilidades na rede ou erro do microsserviço, o orquestrador fará até 3 tentativas automáticas antes de desistir e apontar erro físico.'
      },
      output: {
        icon: '📥',
        title: 'Bloco OUTPUT',
        subtitle: 'Configurações de Resposta',
        body: 'O formato final dos dados retornados para o cliente (ex: "json").'
      }
    }
  },
  avancado: {
    title: 'ZK-Intents Criptográficas',
    code: `INTENT "transacao_confidencial" {
  
  CONTEXT {
    amount_commitment: "74895084a3aaf8f8a047c1...",
    amount_proof: { "value": 150, "salt": "confidentialSalt" }
  }
 
  REQUIRE {
    EXECUTE PAYMENT
  }
 
  FLOW {
    CONFIDENTIAL_SCOPE {
      VERIFY amount >= 100
      EXECUTE PAYMENT
    }
  }
 
  OUTPUT {
    FORMAT "json"
  }
}`,
    tokens: {
      intent: {
        icon: '🔑',
        title: 'Cabeçalho INTENT',
        subtitle: 'Identificador único do fluxo',
        body: 'Nome do fluxo para validações criptográficas ZK.'
      },
      context: {
        icon: '💼',
        title: 'Bloco CONTEXT',
        subtitle: 'Variáveis e Mala de Dados',
        body: 'Armazena o Commitment Hash criptografado (amount_commitment) e as provas de valor (amount_proof) para alimentar o provador matemático.'
      },
      require: {
        icon: '🛠️',
        title: 'Bloco REQUIRE',
        subtitle: 'Requisitos de Capacidades',
        body: 'Solicita a capacidade do microsserviço de pagamento seguro cadastrado.'
      },
      flow: {
        icon: '⚙️',
        title: 'Bloco FLOW',
        subtitle: 'Lógica e Script de Execução',
        body: 'Direciona a validação e orquestração do fluxo.'
      },
      confidential_scope: {
        icon: '🔒',
        title: 'Confidential Scope (Enclave)',
        subtitle: 'Execução Criptográfica Isolada',
        body: 'O bloco <code>CONFIDENTIAL_SCOPE { ... }</code> instrui o motor INP a descompactar dados sensíveis do <code>CONTEXT</code> apenas em memória segura (enclave virtual). Nenhuma variável interna é logada ou exposta aos microsserviços comuns.<br><br><strong>Utilidade:</strong> Essencial para proteger dados privados de usuários durante orquestrações.'
      },
      verify: {
        icon: '🛡️',
        title: 'Validação Criptográfica VERIFY',
        subtitle: 'Prova de Conhecimento Zero (ZK)',
        body: 'A instrução <code>VERIFY amount >= 100</code> executa a checagem lógica de condições dentro do Confidential Scope usando hashes SHA-256 e provando matematicamente que o valor atende aos critérios sem expor o montante original.<br><br><strong>O que evitar:</strong> Usar operadores lógicos inválidos como <code>=></code>.'
      },
      output: {
        icon: '📥',
        title: 'Bloco OUTPUT',
        subtitle: 'Configurações de Resposta',
        body: 'Definição de retorno seguro em formato JSON.'
      }
    }
  }
};

function renderConceptCode(levelKey) {
  const level = conceptLevels[levelKey];
  if (!level) return;
  
  const titleEl = document.getElementById('concept-code-title');
  if (titleEl) titleEl.innerText = level.title;
  
  let codeHtml = level.code;
  
  if (levelKey === 'basico') {
    codeHtml = codeHtml
      .replace(/(INTENT\s+"meu_primeiro_fluxo")/g, '<span class="explorer-token" data-token="intent">$1</span>')
      .replace(/(CONTEXT\s*\{[\s\S]*?\})/g, '<span class="explorer-token" data-token="context">$1</span>')
      .replace(/(REQUIRE\s*\{[\s\S]*?\})/g, '<span class="explorer-token" data-token="require">$1</span>')
      .replace(/(FLOW\s*\{[\s\S]*?\n\s*\})/g, '<span class="explorer-token" data-token="flow">$1</span>')
      .replace(/(OUTPUT\s*\{[\s\S]*?\})/g, '<span class="explorer-token" data-token="output">$1</span>');
  } else if (levelKey === 'resiliencia') {
    codeHtml = codeHtml
      .replace(/(INTENT\s+"fluxo_resiliente")/g, '<span class="explorer-token" data-token="intent">$1</span>')
      .replace(/(CONTEXT\s*\{[\s\S]*?\})/g, '<span class="explorer-token" data-token="context">$1</span>')
      .replace(/(REQUIRE\s*\{[\s\S]*?\})/g, '<span class="explorer-token" data-token="require">$1</span>')
      .replace(/(FLOW\s*\{[\s\S]*?\n\s*\})/g, '<span class="explorer-token" data-token="flow">$1</span>')
      .replace(/(TIMEOUT\s+5s\s*\{[\s\S]*?\n\s*\}\s*\n\s*\})/g, '<span class="explorer-token" data-token="timeout">$1</span>')
      .replace(/(RETRY\s+3\s*\{[\s\S]*?\n\s*\}\s*\})/g, '<span class="explorer-token" data-token="retry">$1</span>')
      .replace(/(OUTPUT\s*\{[\s\S]*?\})/g, '<span class="explorer-token" data-token="output">$1</span>');
  } else if (levelKey === 'avancado') {
    codeHtml = codeHtml
      .replace(/(INTENT\s+"transacao_confidencial")/g, '<span class="explorer-token" data-token="intent">$1</span>')
      .replace(/(CONTEXT\s*\{[\s\S]*?\})/g, '<span class="explorer-token" data-token="context">$1</span>')
      .replace(/(REQUIRE\s*\{[\s\S]*?\})/g, '<span class="explorer-token" data-token="require">$1</span>')
      .replace(/(FLOW\s*\{[\s\S]*?\n\s*\})/g, '<span class="explorer-token" data-token="flow">$1</span>')
      .replace(/(CONFIDENTIAL_SCOPE\s*\{[\s\S]*?\n\s*\})/g, '<span class="explorer-token" data-token="confidential_scope">$1</span>')
      .replace(/(VERIFY\s+amount\s+>=\s+100)/g, '<span class="explorer-token" data-token="verify">$1</span>')
      .replace(/(OUTPUT\s*\{[\s\S]*?\})/g, '<span class="explorer-token" data-token="output">$1</span>');
  }
  
  // Syntax coloring
  codeHtml = codeHtml
    .replace(/(INTENT|CONTEXT|REQUIRE|FLOW|SEQUENCE|PARALLEL|OUTPUT|FORMAT|TIMEOUT|RETRY|CONFIDENTIAL_SCOPE|VERIFY)/g, '<span style="color: var(--primary); font-weight: bold;">$1</span>')
    .replace(/("[^"]*")/g, '<span style="color: var(--secondary);">$1</span>')
    .replace(/(\b\d+(\.\d+)?\b)/g, '<span style="color: var(--warning);">$1</span>');

  const displayEl = document.getElementById('concept-code-display');
  if (displayEl) {
    displayEl.innerHTML = codeHtml;
    
    // Attach listeners
    displayEl.querySelectorAll('.explorer-token').forEach(tok => {
      tok.addEventListener('mouseenter', (e) => {
        highlightConceptToken(levelKey, e.currentTarget.getAttribute('data-token'));
      });
      tok.addEventListener('click', (e) => {
        highlightConceptToken(levelKey, e.currentTarget.getAttribute('data-token'), true);
      });
    });
  }
}

function highlightConceptToken(levelKey, tokenKey, isClick = false) {
  const level = conceptLevels[levelKey];
  if (!level) return;
  const tokenData = level.tokens[tokenKey];
  if (!tokenData) return;
  
  const displayEl = document.getElementById('concept-code-display');
  if (displayEl) {
    displayEl.querySelectorAll('.explorer-token').forEach(tok => {
      tok.classList.remove('active-token');
    });
    const activeTok = displayEl.querySelector(`.explorer-token[data-token="${tokenKey}"]`);
    if (activeTok) activeTok.classList.add('active-token');
  }
  
  const iconEl = document.getElementById('concept-detail-icon');
  const titleEl = document.getElementById('concept-detail-title');
  const subtitleEl = document.getElementById('concept-detail-subtitle');
  const bodyEl = document.getElementById('concept-detail-body');
  
  if (iconEl) iconEl.innerText = tokenData.icon;
  if (titleEl) titleEl.innerText = tokenData.title;
  if (subtitleEl) subtitleEl.innerText = tokenData.subtitle;
  if (bodyEl) {
    bodyEl.innerHTML = `<p style="color: var(--text-muted); font-size: 13.5px; line-height: 1.6;">${tokenData.body}</p>`;
  }
}

function initConceptExplorer() {
  document.querySelectorAll('[data-concept-level]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-concept-level]').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const level = e.currentTarget.getAttribute('data-concept-level');
      renderConceptCode(level);
      highlightConceptToken(level, 'intent');
    });
  });
  
  renderConceptCode('basico');
  highlightConceptToken('basico', 'intent');
  
  const btnLoad = document.getElementById('btn-load-concept-to-play');
  if (btnLoad) {
    btnLoad.addEventListener('click', () => {
      const activeBtn = document.querySelector('[data-concept-level].active');
      const levelKey = activeBtn ? activeBtn.getAttribute('data-concept-level') : 'basico';
      const level = conceptLevels[levelKey];
      if (level) {
        const playgroundCode = document.getElementById('playground-code');
        const playgroundType = document.getElementById('playground-type');
        if (playgroundCode) {
          playgroundCode.value = level.code;
          if (playgroundType) {
            playgroundType.value = 'dsl';
            const indicator = document.getElementById('editor-lang-indicator');
            if (indicator) indicator.innerText = 'INP DSL';
          }
          updateLineNumbers();
          updateFlowPreview();
          
          switchTab(null, 'tab-playground');
          const targetSection = document.getElementById('tab-playground');
          if (targetSection) {
            targetSection.scrollIntoView({ behavior: 'smooth' });
          }
        }
      }
    });
  }
}

// --- DYNAMIC BLUEPRINT BUILDER ENGINE ---
function updateBuilderLiveDSL() {
  const nameInput = document.getElementById('builder-intent-name');
  const amountInput = document.getElementById('builder-amount');
  const userIdInput = document.getElementById('builder-user-id');
  const tokenInput = document.getElementById('builder-token');
  const flowType = document.getElementById('builder-flow-type');
  const flowAction = document.getElementById('builder-flow-action');
  
  const zkToggle = document.getElementById('builder-zk-toggle');
  const resilienceToggle = document.getElementById('builder-resilience-toggle');
  const verifyToggle = document.getElementById('builder-verify-toggle');
  const fallbackToggle = document.getElementById('builder-fallback-toggle');
  
  // Toggle displays
  const resOptions = document.getElementById('builder-resilience-options');
  if (resOptions) resOptions.style.display = (resilienceToggle && resilienceToggle.checked) ? 'grid' : 'none';
  const verOptions = document.getElementById('builder-verify-options');
  if (verOptions) verOptions.style.display = (verifyToggle && verifyToggle.checked) ? 'block' : 'none';
  const falOptions = document.getElementById('builder-fallback-options');
  if (falOptions) falOptions.style.display = (fallbackToggle && fallbackToggle.checked) ? 'block' : 'none';

  const name = nameInput ? nameInput.value.trim().replace(/[^a-zA-Z0-9_\-]/g, '') || 'reserva_voo_vip' : 'reserva_voo_vip';
  const amount = amountInput ? Number(amountInput.value) || 350 : 350;
  const userId = userIdInput ? userIdInput.value.trim().replace(/"/g, '') || 'usr_gold_77' : 'usr_gold_77';
  const token = tokenInput ? tokenInput.value.trim().replace(/"/g, '') || 'tok_card_platinum' : 'tok_card_platinum';

  let contextBody = '';
  if (zkToggle && zkToggle.checked) {
    contextBody = `    amount_commitment: "74895084a3aaf8f8a047c1d39ced874075948d72733b02c7c126c243b6b5102f",\n    amount_proof: { "value": ${amount}, "salt": "confidentialSalt" }`;
  } else {
    contextBody = `    amount: ${amount},\n    user_id: "${userId}",\n    card_token: "${token}"`;
  }
  
  let contextStr = `  CONTEXT {\n${contextBody}\n  }`;

  let verb = 'EXECUTE';
  let target = 'PAYMENT';
  if (flowAction && flowAction.value.includes('REWARD')) {
    target = 'REWARD';
  }
  let requireStr = `  REQUIRE {\n    ${verb} ${target}\n  }`;

  const type = flowType ? flowType.value : 'SEQUENCE';
  const action = flowAction ? flowAction.value : 'EXECUTE PAYMENT';
  
  let actionCore = `      ${action}`;
  if (fallbackToggle && fallbackToggle.checked) {
    const fallbackVal = document.getElementById('builder-fallback-val');
    const fallbackStr = fallbackVal ? fallbackVal.value : 'FALLBACK "reverse_payment"';
    actionCore += `\n      ${fallbackStr}`;
  }

  let flowBody = '';
  if (resilienceToggle && resilienceToggle.checked) {
    const timeoutVal = document.getElementById('builder-timeout-val');
    const timeout = timeoutVal ? Number(timeoutVal.value) || 5 : 5;
    const retryVal = document.getElementById('builder-retry-val');
    const retry = retryVal ? Number(retryVal.value) || 3 : 3;
    
    flowBody = `    ${type} {\n      TIMEOUT ${timeout}s {\n        RETRY ${retry} {\n    ${actionCore.trim()}\n        }\n      }\n    }`;
  } else {
    flowBody = `    ${type} {\n${actionCore}\n    }`;
  }

  if (zkToggle && zkToggle.checked) {
    let scopeBody = '';
    if (verifyToggle && verifyToggle.checked) {
      const verifyVal = document.getElementById('builder-verify-val');
      const verifyStr = verifyVal ? verifyVal.value : 'VERIFY amount >= 100';
      scopeBody = `      ${verifyStr}\n  ${flowBody.replace(/\n/g, '\n  ')}`;
    } else {
      scopeBody = `  ${flowBody.replace(/\n/g, '\n  ')}`;
    }
    flowBody = `    CONFIDENTIAL_SCOPE {\n${scopeBody}\n    }`;
  } else {
    if (verifyToggle && verifyToggle.checked) {
      const verifyVal = document.getElementById('builder-verify-val');
      const verifyStr = verifyVal ? verifyVal.value : 'VERIFY amount >= 100';
      flowBody = `    ${type} {\n      ${verifyStr}\n  ${actionCore}\n    }`;
    }
  }

  let flowStr = `  FLOW {\n${flowBody}\n  }`;

  const dsl = `INTENT "${name}" {
${contextStr}
 
${requireStr}
 
${flowStr}
 
  OUTPUT {
    FORMAT "json"
  }
}`;

  const previewEl = document.getElementById('builder-live-dsl-output');
  if (previewEl) {
    let html = dsl
      .replace(/(INTENT|CONTEXT|REQUIRE|FLOW|SEQUENCE|PARALLEL|OUTPUT|FORMAT|TIMEOUT|RETRY|CONFIDENTIAL_SCOPE|VERIFY|FALLBACK)/g, '<span style="color: var(--primary); font-weight: bold;">$1</span>')
      .replace(/("[^"]*")/g, '<span style="color: var(--secondary);">$1</span>')
      .replace(/(\b\d+(\.\d+)?\b)/g, '<span style="color: var(--warning);">$1</span>')
      .replace(/(\/\/.*)/g, '<span style="color: var(--text-muted);">$1</span>');
    previewEl.innerHTML = html;
  }
  
  const sendBtn = document.getElementById('btn-send-builder-to-play');
  if (sendBtn) {
    sendBtn.setAttribute('data-dsl-code', dsl);
  }

  updateBuilderBlueprint({
    name,
    amount,
    userId,
    token,
    type,
    action,
    zkActive: zkToggle && zkToggle.checked,
    resilienceActive: resilienceToggle && resilienceToggle.checked,
    verifyActive: verifyToggle && verifyToggle.checked,
    fallbackActive: fallbackToggle && fallbackToggle.checked
  });
}

function updateBuilderBlueprint(opts) {
  const container = document.getElementById('builder-blueprint-diagram');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Start
  const nodeStart = document.createElement('div');
  nodeStart.className = 'blueprint-node node-start';
  nodeStart.innerHTML = '🏁 INÍCIO';
  container.appendChild(nodeStart);
  
  container.appendChild(createBlueprintArrow());
  
  // Context
  const nodeContext = document.createElement('div');
  if (opts.zkActive) {
    nodeContext.className = 'blueprint-node node-zk';
    nodeContext.innerHTML = '🔒 ZK-ENCLAVE (Private)';
  } else {
    nodeContext.className = 'blueprint-node node-context';
    nodeContext.innerHTML = `💼 CONTEXT (${opts.amount})`;
  }
  container.appendChild(nodeContext);
  
  container.appendChild(createBlueprintArrow());
  
  // Verify
  if (opts.verifyActive) {
    const nodeVerify = document.createElement('div');
    nodeVerify.className = 'blueprint-node node-verify';
    const verifyVal = document.getElementById('builder-verify-val');
    nodeVerify.innerHTML = `🛡️ ${verifyVal ? verifyVal.value : 'VERIFY'}`;
    container.appendChild(nodeVerify);
    container.appendChild(createBlueprintArrow());
  }
  
  // Action Node
  const nodeAction = document.createElement('div');
  nodeAction.className = 'blueprint-node node-action';
  
  let actText = `⚙️ ${opts.action}`;
  if (opts.resilienceActive) {
    const timeoutVal = document.getElementById('builder-timeout-val');
    const retryVal = document.getElementById('builder-retry-val');
    actText += `<br><span style="font-size:9px;color:var(--text-muted);">⏱️ ${timeoutVal ? timeoutVal.value : 5}s | 🔁 ${retryVal ? retryVal.value : 3}x</span>`;
  }
  nodeAction.innerHTML = actText;
  
  if (opts.fallbackActive) {
    const row = document.createElement('div');
    row.className = 'blueprint-parallel-row';
    row.appendChild(nodeAction);
    
    // Fallback Node
    const nodeFallback = document.createElement('div');
    nodeFallback.className = 'blueprint-node node-fallback';
    const fallbackVal = document.getElementById('builder-fallback-val');
    nodeFallback.innerHTML = `🚨 REVERTER:<br>${fallbackVal ? fallbackVal.value.replace(/FALLBACK\s+/i, '') : '"reverse"'}`;
    
    row.appendChild(nodeFallback);
    container.appendChild(row);
  } else {
    container.appendChild(nodeAction);
  }
  
  container.appendChild(createBlueprintArrow());
  
  // Output
  const nodeOutput = document.createElement('div');
  nodeOutput.className = 'blueprint-node node-output';
  nodeOutput.innerHTML = '📥 OUTPUT (JSON)';
  container.appendChild(nodeOutput);
}

function createBlueprintArrow() {
  const arrow = document.createElement('div');
  arrow.className = 'blueprint-arrow';
  arrow.innerHTML = '↓';
  return arrow;
}

// --- GAMIFIED HACKING ARENA DATA & SYSTEM ---
const hackingChallenges = [
  {
    id: 1,
    title: 'Desafio 1: A vírgula perdida',
    difficulty: 'Iniciante',
    desc: 'O bloco <code>CONTEXT</code> possui variáveis declaradas de forma linear, mas o compilador está acusando erro. Localize a variável que precisa de um separador de dados e resolva a pendência para compilar.',
    code: `INTENT "comprar_passagem" {
  CONTEXT {
    preco: 300
    passageiro: "Alice"
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`,
    hint: 'Adicione uma vírgula `,` no final do valor numérico `preco: 300` para separá-lo do próximo dado no bloco CONTEXT.',
    fix: `INTENT "comprar_passagem" {
  CONTEXT {
    preco: 300,
    passageiro: "Alice"
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`,
    validate: (code) => {
      return /preco:\s*300\s*,/.test(code);
    }
  },
  {
    id: 2,
    title: 'Desafio 2: O fecho quebrado',
    difficulty: 'Iniciante',
    desc: 'A orquestração não pode começar se as caixas estruturais (chaves `{}`) estiverem desalinhadas. Este arquivo possui chaves abertas que não estão fechadas corretamente. Resolva a inconsistência estrutural.',
    code: `INTENT "resgate_recompensa" {
  CONTEXT {
    pontos: 50
  }
  REQUIRE {
    EXECUTE REWARD
  }
  FLOW {
    SEQUENCE {
      EXECUTE REWARD
    }
  }
  OUTPUT {
    FORMAT "json"
  }`,
    hint: 'Falta uma chave de fechamento `}` no final do arquivo correspondente à abertura do bloco `INTENT` na linha 1.',
    fix: `INTENT "resgate_recompensa" {
  CONTEXT {
    pontos: 50
  }
  REQUIRE {
    EXECUTE REWARD
  }
  FLOW {
    SEQUENCE {
      EXECUTE REWARD
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`,
    validate: (code) => {
      const opens = (code.match(/\{/g) || []).length;
      const closes = (code.match(/\}/g) || []).length;
      return opens === closes && opens >= 5;
    }
  },
  {
    id: 3,
    title: 'Desafio 3: A revolta da caixa baixa',
    difficulty: 'Intermediário',
    desc: 'O compilador INP DSL é rígido em relação a palavras reservadas: comandos devem ser escritos em CAIXA ALTA (letras maiúsculas). Localize as palavras reservadas em minúscula e converta-as.',
    code: `intent "pagamento_rapido" {
  CONTEXT {
    val: 80
  }
  require {
    EXECUTE PAYMENT
  }
  FLOW {
    sequence {
      EXECUTE PAYMENT
    }
  }
  OUTPUT {
    format "json"
  }
}`,
    hint: 'Converta os comandos `intent`, `require`, `sequence` e `format` para suas versões em caixa alta: `INTENT`, `REQUIRE`, `SEQUENCE` e `FORMAT`.',
    fix: `INTENT "pagamento_rapido" {
  CONTEXT {
    val: 80
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`,
    validate: (code) => {
      const lowerWords = ['intent', 'require', 'sequence', 'format'];
      for (const w of lowerWords) {
        if (new RegExp('\\b' + w + '\\b').test(code)) return false;
      }
      return true;
    }
  },
  {
    id: 4,
    title: 'Desafio 4: O valor desprotegido',
    difficulty: 'Intermediário',
    desc: 'Variáveis contextuais do tipo texto (strings) precisam estar encapsuladas em aspas duplas, ao contrário de números e booleanos. Encontre o valor desprotegido e proteja-o.',
    code: `INTENT "envio_notificacao" {
  CONTEXT {
    usuario: Joao,
    canal: "email"
  }
  REQUIRE {
    SEND NOTIFICATION
  }
  FLOW {
    SEQUENCE {
      SEND NOTIFICATION
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`,
    hint: 'O valor `Joao` é um texto sem aspas. Mude a linha 3 para `usuario: "Joao",`.',
    fix: `INTENT "envio_notificacao" {
  CONTEXT {
    usuario: "Joao",
    canal: "email"
  }
  REQUIRE {
    SEND NOTIFICATION
  }
  FLOW {
    SEQUENCE {
      SEND NOTIFICATION
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`,
    validate: (code) => {
      return /usuario:\s*"Joao"\s*,/.test(code);
    }
  },
  {
    id: 5,
    title: 'Desafio 5: O enigma ZK-Intent',
    difficulty: 'Avançado',
    desc: 'Em orquestrações de privacidade, o Confidential Scope aceita checagens de validação matemática de ZK. Porém, um operador lógico incorreto foi inserido na condicional. Descubra qual é o caractere inválido e corrija.',
    code: `INTENT "zk_pagamento" {
  CONTEXT {
    hash: "zk_77a9",
    secreto: { "amount": 120, "salt": "secret" }
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    CONFIDENTIAL_SCOPE {
      VERIFY amount => 100
      EXECUTE PAYMENT
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`,
    hint: 'O operador de verificação matemática maior-ou-igual é escrito como `>=` e não `=>`. Substitua `=>` por `>=`.',
    fix: `INTENT "zk_pagamento" {
  CONTEXT {
    hash: "zk_77a9",
    secreto: { "amount": 120, "salt": "secret" }
  }
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    CONFIDENTIAL_SCOPE {
      VERIFY amount >= 100
      EXECUTE PAYMENT
    }
  }
  OUTPUT {
    FORMAT "json"
  }
}`,
    validate: (code) => {
      return /VERIFY\s+amount\s+>=\s*100/.test(code);
    }
  }
];

let currentChallengeId = 1;
let completedChallenges = [];
let hackerXP = 0;

function initSyntaxLabChallenges() {
  const savedXP = localStorage.getItem('inp_hacker_xp');
  const savedCompleted = localStorage.getItem('inp_completed_challenges');
  if (savedXP) hackerXP = parseInt(savedXP, 10);
  if (savedCompleted) {
    try {
      completedChallenges = JSON.parse(savedCompleted);
    } catch(e) {
      completedChallenges = [];
    }
  }
  
  updateHackingScoreboard();
  renderHackingSidebar();
  loadHackingChallenge(currentChallengeId);
  
  const btnCompile = document.getElementById('btn-hacking-compile');
  if (btnCompile) {
    btnCompile.addEventListener('click', runHackingCompile);
  }
  
  const btnHint = document.getElementById('btn-hacking-hint');
  if (btnHint) {
    btnHint.addEventListener('click', () => {
      const challenge = hackingChallenges.find(c => c.id === currentChallengeId);
      if (challenge) {
        printHackingLog(`DICA: ${challenge.hint}`, 'warning');
      }
    });
  }
  
  const btnAutofix = document.getElementById('btn-hacking-autofix');
  if (btnAutofix) {
    btnAutofix.addEventListener('click', () => {
      const challenge = hackingChallenges.find(c => c.id === currentChallengeId);
      if (challenge) {
        const textarea = document.getElementById('hacking-editor-textarea');
        if (textarea) {
          textarea.value = challenge.fix;
          updateHackingGutter();
          printHackingLog(`Auto-resolvido! Execute "Compilar e Testar" para confirmar.`, 'info');
        }
      }
    });
  }

  const textarea = document.getElementById('hacking-editor-textarea');
  const gutter = document.getElementById('hacking-line-gutter');
  if (textarea) {
    textarea.addEventListener('input', () => {
      updateHackingGutter();
    });
    textarea.addEventListener('scroll', () => {
      if (gutter) gutter.scrollTop = textarea.scrollTop;
    });
  }
}

function updateHackingGutter() {
  const textarea = document.getElementById('hacking-editor-textarea');
  const gutter = document.getElementById('hacking-line-gutter');
  if (!textarea || !gutter) return;
  
  const linesCount = textarea.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= linesCount; i++) {
    html += `<div style="height:20px; text-align:right; padding-right:8px; color:rgba(255,255,255,0.15); font-family:monospace; font-size:11px;">${i}</div>`;
  }
  gutter.innerHTML = html;
}

function updateHackingScoreboard() {
  const xpDisplay = document.getElementById('hacking-xp-display');
  const progressPercent = document.getElementById('hacking-progress-percent');
  const progressBar = document.getElementById('hacking-progress-bar');
  const rankTitle = document.getElementById('hacking-rank-title');
  const badgeIcon = document.getElementById('hacking-badge-icon');
  
  if (xpDisplay) xpDisplay.innerText = `${hackerXP} / 500 XP`;
  
  const totalChallenges = hackingChallenges.length;
  const completedCount = completedChallenges.length;
  const percent = Math.round((completedCount / totalChallenges) * 100);
  if (progressPercent) progressPercent.innerText = `${percent}%`;
  if (progressBar) progressBar.style.width = `${percent}%`;
  
  let rank = 'Recruta da Rede';
  let badge = '🎖️';
  if (hackerXP >= 500) {
    rank = 'Mestre de Orquestração';
    badge = '👑';
  } else if (hackerXP >= 350) {
    rank = 'Especialista em Compiladores';
    badge = '🔮';
  } else if (hackerXP >= 150) {
    rank = 'Sintatista de DSL';
    badge = '⚡';
  }
  
  if (rankTitle) rankTitle.innerText = rank;
  if (badgeIcon) badgeIcon.innerText = badge;
}

function renderHackingSidebar() {
  const listContainer = document.getElementById('hacking-challenges-list');
  if (!listContainer) return;
  
  listContainer.innerHTML = '';
  
  hackingChallenges.forEach(challenge => {
    const btn = document.createElement('button');
    const isCompleted = completedChallenges.includes(challenge.id);
    const isUnlocked = challenge.id === 1 || completedChallenges.includes(challenge.id - 1) || isCompleted;
    
    btn.className = 'btn-challenge';
    if (challenge.id === currentChallengeId) btn.classList.add('active');
    if (isCompleted) btn.classList.add('completed');
    
    let suffix = '';
    if (isCompleted) {
      suffix = '<span style="color:#10b981;font-weight:bold;">✔</span>';
    } else if (!isUnlocked) {
      btn.classList.add('locked');
      suffix = '<span>🔒</span>';
    } else {
      suffix = '<span style="color:var(--secondary); font-size:10px;">•</span>';
    }
    
    btn.innerHTML = `<span style="font-size:12.5px;">${challenge.title}</span> ${suffix}`;
    
    if (isUnlocked) {
      btn.addEventListener('click', () => {
        currentChallengeId = challenge.id;
        renderHackingSidebar();
        loadHackingChallenge(challenge.id);
      });
    }
    
    listContainer.appendChild(btn);
  });
}

function loadHackingChallenge(id) {
  const challenge = hackingChallenges.find(c => c.id === id);
  if (!challenge) return;
  
  const titleEl = document.getElementById('hacking-challenge-title');
  const descEl = document.getElementById('hacking-challenge-desc');
  const difficultyEl = document.getElementById('hacking-challenge-difficulty');
  const textarea = document.getElementById('hacking-editor-textarea');
  
  if (titleEl) titleEl.innerText = challenge.title;
  if (descEl) descEl.innerHTML = challenge.desc;
  if (difficultyEl) {
    difficultyEl.innerText = challenge.difficulty;
    difficultyEl.className = 'badge';
    if (challenge.difficulty === 'Iniciante') {
      difficultyEl.style.background = 'rgba(0, 245, 255, 0.05)';
      difficultyEl.style.color = 'var(--secondary)';
      difficultyEl.style.borderColor = 'rgba(0, 245, 255, 0.15)';
    } else if (challenge.difficulty === 'Intermediário') {
      difficultyEl.style.background = 'rgba(255, 183, 3, 0.05)';
      difficultyEl.style.color = 'var(--warning)';
      difficultyEl.style.borderColor = 'rgba(255, 183, 3, 0.15)';
    } else {
      difficultyEl.style.background = 'rgba(162, 89, 255, 0.05)';
      difficultyEl.style.color = 'var(--primary-hover)';
      difficultyEl.style.borderColor = 'rgba(162, 89, 255, 0.15)';
    }
  }
  
  if (textarea) {
    textarea.value = challenge.code;
    updateHackingGutter();
  }
  
  clearHackingConsole();
  printHackingLog(`Carregado ${challenge.title}. Modifique o editor para testar.`);
}

function printHackingLog(message, type = 'info') {
  const consoleEl = document.getElementById('hacking-terminal-console');
  if (!consoleEl) return;
  
  let color = '#a5b4fc';
  let prefix = 'guest@inp-compiler:~$ ';
  if (type === 'success') {
    color = '#10b981';
    prefix = '[COMPILE SUCCESS] ';
  } else if (type === 'error') {
    color = 'var(--error)';
    prefix = '[COMPILE ERROR] ';
  } else if (type === 'warning') {
    color = 'var(--warning)';
    prefix = '[HINT] ';
  }
  
  const time = new Date().toLocaleTimeString();
  const line = `<div style="color: ${color}; margin-bottom: 4px;">[${time}] ${prefix}${message}</div>`;
  
  consoleEl.innerHTML += line;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearHackingConsole() {
  const consoleEl = document.getElementById('hacking-terminal-console');
  if (consoleEl) {
    consoleEl.innerHTML = '';
  }
}

function runHackingCompile() {
  const challenge = hackingChallenges.find(c => c.id === currentChallengeId);
  if (!challenge) return;
  
  const textarea = document.getElementById('hacking-editor-textarea');
  if (!textarea) return;
  const code = textarea.value;
  
  const lintResult = runSandboxLinter(code);
  
  if (!lintResult.success) {
    printHackingLog(`Linha ${lintResult.lineNum}: ${lintResult.message}`, 'error');
    if (lintResult.fixTip) {
      printHackingLog(lintResult.fixTip, 'warning');
    }
    highlightSandboxErrorLine(lintResult.lineNum);
    return;
  }
  
  const solutionMatches = challenge.validate(code);
  
  if (!solutionMatches) {
    printHackingLog(`Sintaxe compilada com sucesso, mas o comportamento lógico está incorreto para este desafio.`, 'error');
    printHackingLog(`Dica: ${challenge.hint}`, 'warning');
    return;
  }
  
  printHackingLog(`Sintaxe Compilada com Sucesso!`, 'success');
  
  if (!completedChallenges.includes(challenge.id)) {
    completedChallenges.push(challenge.id);
    hackerXP += 100;
    
    localStorage.setItem('inp_hacker_xp', hackerXP);
    localStorage.setItem('inp_completed_challenges', JSON.stringify(completedChallenges));
    
    updateHackingScoreboard();
    printHackingLog(`Parabéns! +100 XP obtidos.`, 'success');
  }
  
  setTimeout(() => {
    renderHackingSidebar();
    if (currentChallengeId < hackingChallenges.length) {
      currentChallengeId++;
      renderHackingSidebar();
      loadHackingChallenge(currentChallengeId);
    } else {
      printHackingLog(`PARABÉNS! Todos os 5 desafios foram vencidos com sucesso! Ranks Masterclass liberados.`, 'success');
    }
  }, 2000);
}

function runSandboxLinter(code) {
  if (!code || !code.trim()) {
    return { success: false, lineNum: 1, message: 'Arquivo vazio', fixTip: 'Escreva uma DSL válida.' };
  }
  
  let openBraces = 0;
  let closeBraces = 0;
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    openBraces += (line.match(/\{/g) || []).length;
    closeBraces += (line.match(/\}/g) || []).length;
  }

  if (openBraces !== closeBraces) {
    if (openBraces > closeBraces) {
      return { 
        success: false, 
        lineNum: lines.length, 
        message: `Chaves desbalanceadas: Há ${openBraces} abertas '{' e apenas ${closeBraces} fechadas '}'.`, 
        fixTip: `Adicione ${openBraces - closeBraces} chave(s) fechada(s) '}' no final para alinhar os escopos.` 
      };
    } else {
      return { 
        success: false, 
        lineNum: lines.length, 
        message: `Chaves desbalanceadas: Há ${closeBraces} fechadas '}' e apenas ${openBraces} abertas '{'.`, 
        fixTip: `Remova chaves fechadas '}' sobressalentes ou adicione as chaves abertas correspondentes.` 
      };
    }
  }

  const patterns = [
    /^INTENT\s+"[a-zA-Z0-9_\-]+"(\s*\{)?$/,
    /^CONTEXT(\s*\{)?$/,
    /^REQUIRE(\s*\{)?$/,
    /^FLOW(\s*\{)?$/,
    /^OUTPUT(\s*\{)?$/,
    /^SEQUENCE(\s*\{)?$/,
    /^PARALLEL(\s*\{)?$/,
    /^TIMEOUT\s+[0-9]+s(\s*\{)?$/,
    /^RETRY\s+[0-9]+(\s*\{)?$/,
    /^CONDITION\s+"[^"]+"(\s*\{)?$/,
    /^(CONFIDENTIAL_SCOPE|SCOPE)(\s*\{)?$/,
    /^(EXECUTE|VERIFY|SEND)\s+[A-Z0-9_]+(\s+[A-Z0-9_]+)*$/,
    /^VERIFY\s+[a-zA-Z0-9_\-"]+\s*(>=|<=|>|<|==)\s*[0-9.]+$/,
    /^FALLBACK\s+"[a-zA-Z0-9_\-]+"$/,
    /^FORMAT\s+"[a-zA-Z0-9_\-]+"$/,
    /^\}$/
  ];

  const reservedWordsLower = [
    'intent', 'context', 'flow', 'sequence', 'parallel',
    'require', 'execute', 'output', 'fallback',
    'scope', 'confidential_scope', 'verify', 'timeout', 'retry', 'format'
  ];

  let inContext = false;
  let contextNesting = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNum = i + 1;

    let cleanLine = rawLine.split('//')[0].trim();
    if (!cleanLine) continue;

    if (cleanLine.includes('CONTEXT {')) {
      inContext = true;
      contextNesting = 1;
    }

    let netBraces = 0;
    if (inContext && !cleanLine.includes('CONTEXT {')) {
      let openCount = 0;
      let closeCount = 0;
      let inDoubleQuote = false;
      for (let charIdx = 0; charIdx < cleanLine.length; charIdx++) {
        const char = cleanLine[charIdx];
        if (char === '"') inDoubleQuote = !inDoubleQuote;
        if (!inDoubleQuote) {
          if (char === '{' || char === '[') openCount++;
          if (char === '}' || char === ']') closeCount++;
        }
      }
      netBraces = openCount - closeCount;
    }

    let matched = false;
    if (inContext && !cleanLine.includes('CONTEXT {')) {
      const tempNesting = contextNesting + netBraces;
      if (tempNesting === 0 && cleanLine === '}') {
        matched = true;
        inContext = false;
        contextNesting = 0;
      } else {
        if (contextNesting === 1) {
          const simplePattern = /^[a-zA-Z0-9_\-]+:\s*("[^"]*"|[0-9]+(\.[0-9]+)?|true|false)\s*,?$/;
          const nestedStartPattern = /^[a-zA-Z0-9_\-]+:\s*(\{|\[)\s*$/;
          matched = simplePattern.test(cleanLine) || nestedStartPattern.test(cleanLine);
        } else {
          const nestedKeyValuePattern = /^("[a-zA-Z0-9_\-]+"|[a-zA-Z0-9_\-]+):\s*("[^"]*"|[0-9]+(\.[0-9]+)?|true|false|(\{|\[))\s*,?$/;
          const arrayItemPattern = /^("[^"]*"|[0-9]+(\.[0-9]+)?|true|false)\s*,?$/;
          const closingPattern = /^(\{|\[|\}|\]),?$/;
          matched = nestedKeyValuePattern.test(cleanLine) || arrayItemPattern.test(cleanLine) || closingPattern.test(cleanLine);
        }
        contextNesting = tempNesting;
      }
    } else {
      for (const pattern of patterns) {
        if (pattern.test(cleanLine)) {
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      return { 
        success: false, 
        lineNum, 
        message: `Caracteres inválidos ou erro de sintaxe: "${cleanLine}"`, 
        fixTip: `Verifique se há aspas, vírgulas ou chaves mal formadas.` 
      };
    }

    const tokens = cleanLine.split(/[\s"{}()]+/);
    for (const token of tokens) {
      if (reservedWordsLower.includes(token.toLowerCase()) && token !== token.toUpperCase()) {
        return { 
          success: false, 
          lineNum, 
          message: `Comando '${token}' escrito em letras minúsculas ou mistas.`, 
          fixTip: `A DSL diferencia maiúsculas de minúsculas. Use sempre letras maiúsculas: "${token.toUpperCase()}".` 
        };
      }
    }

    if (inContext && !cleanLine.includes('CONTEXT {') && contextNesting >= 1) {
      if (cleanLine.includes(':')) {
        const parts = cleanLine.split(':');
        const key = parts[0].trim();
        const valuePart = parts.slice(1).join(':').trim();
        const valueClean = valuePart.replace(/,$/, '').trim();

        if (contextNesting === 1) {
          let nextLine = '';
          for (let j = i + 1; j < lines.length; j++) {
            const nl = lines[j].split('//')[0].trim();
            if (nl) {
              nextLine = nl;
              break;
            }
          }
          const isLastItem = nextLine === '}';
          if (!valuePart.endsWith(',') && !isLastItem && !valueClean.endsWith('{') && !valueClean.endsWith('[')) {
            return { 
              success: false, 
              lineNum, 
              message: `Falta uma vírgula ',' para separar este dado do próximo no CONTEXT.`, 
              fixTip: `Escreva uma vírgula no final da linha: "${cleanLine},"` 
            };
          }
        }

        if (valueClean && isNaN(Number(valueClean)) && valueClean !== 'true' && valueClean !== 'false' && !valueClean.startsWith('{') && !valueClean.startsWith('[')) {
          if (!valueClean.startsWith('"') || !valueClean.endsWith('"')) {
            return { 
              success: false, 
              lineNum, 
              message: `O valor do texto '${valueClean}' não está cercado por aspas duplas.`, 
              fixTip: `Strings no CONTEXT devem ser envolvidas em aspas: ${key}: "${valueClean}"` 
            };
          }
        }
      }
    }

    if (!inContext && !cleanLine.includes('CONTEXT {')) {
      if (cleanLine.includes(',')) {
        return { 
          success: false, 
          lineNum, 
          message: `Vírgula ',' indevida encontrada fora do bloco CONTEXT.`, 
          fixTip: `Remova a vírgula. Apenas o bloco CONTEXT usa vírgulas separadoras.` 
        };
      }
    }
  }

  return { success: true };
}

function highlightSandboxErrorLine(lineNum) {
  const textarea = document.getElementById('hacking-editor-textarea');
  if (!textarea || !lineNum) return;
  
  const container = textarea.parentElement;
  if (container) {
    container.style.borderColor = 'var(--error)';
    container.style.boxShadow = '0 0 15px rgba(255, 42, 95, 0.2)';
    setTimeout(() => {
      container.style.borderColor = 'rgba(255, 255, 255, 0.03)';
      container.style.boxShadow = 'none';
    }, 1500);
  }
}

window.downloadPostmanCollection = downloadPostmanCollection;
window.downloadNodeSDK = downloadNodeSDK;
window.trySnippet = trySnippet;
window.copySnippet = copySnippet;
window.toggleFaqAccordion = toggleFaqAccordion;
window.runPlaygroundIntent = runPlaygroundIntent;
window.toggleDetails = toggleDetails;

// Theme Toggle Logic
function initTheme() {
  const toggleBtn = document.getElementById('btn-theme-toggle');
  if (!toggleBtn) return;
  
  const savedTheme = localStorage.getItem('theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    toggleBtn.innerHTML = '<span class="theme-icon">☀️</span>';
  } else {
    document.body.classList.remove('light-theme');
    toggleBtn.innerHTML = '<span class="theme-icon">🌙</span>';
  }
  
  toggleBtn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    toggleBtn.innerHTML = isLight ? '<span class="theme-icon">☀️</span>' : '<span class="theme-icon">🌙</span>';
  });
}

/**
 * @description Inicializa as interações da barra de navegação moderna (dropdowns e gaveta mobile).
 */
function initNavbarInteractions() {
  // 1. Menu Mobile Hamburger
  const toggleBtn = document.getElementById('btn-mobile-toggle');
  const drawer = document.getElementById('nav-mobile-drawer');
  if (toggleBtn && drawer) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = drawer.classList.toggle('open');
      toggleBtn.classList.toggle('open', isOpen);
    });

    document.addEventListener('click', (e) => {
      if (!drawer.contains(e.target) && !toggleBtn.contains(e.target) && drawer.classList.contains('open')) {
        drawer.classList.remove('open');
        toggleBtn.classList.remove('open');
      }
    });
  }

  // 2. Dropdowns Interativos no Desktop e Dispositivos Touch
  const dropdowns = document.querySelectorAll('.nav-dropdown');
  dropdowns.forEach(dd => {
    const trigger = dd.querySelector('.nav-dropdown-trigger');
    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = dd.classList.contains('open');
        dropdowns.forEach(d => d.classList.remove('open'));
        if (!wasOpen) dd.classList.add('open');
      });
    }
  });

  document.addEventListener('click', () => {
    dropdowns.forEach(d => d.classList.remove('open'));
  });
}

// Setup Documentation Navigation and Quick Cards
function initMarketingNav() {
  // Setup Document Quick Cards click listener
  document.querySelectorAll('[data-doc-target]').forEach(card => {
    card.addEventListener('click', () => {
      const targetId = card.getAttribute('data-doc-target');
      switchTab(null, 'tab-docs');
      const targetSec = document.getElementById(targetId);
      if (targetSec) {
        setTimeout(() => {
          targetSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    });
  });

  // Setup Footer Document links click listener
  document.querySelectorAll('[data-doc-link]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('data-doc-link');
      switchTab(null, 'tab-docs');
      const targetSec = document.getElementById(targetId);
      if (targetSec) {
        setTimeout(() => {
          targetSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    });
  });
}

// Dictionary terms database
const DICTIONARY_TERMS = {
  SEQUENCE: {
    name: 'SEQUENCE',
    category: 'Estrutura',
    desc: 'Executa um bloco de passos de forma sequencial linear, onde o resultado (output) de cada passo é repassado automaticamente como entrada (contexto) para o passo seguinte.',
    analogy: 'Imagine uma linha de montagem industrial: o operador A monta a peça básica, passa para o operador B que insere a pintura, e por fim para o operador C que a embala. Cada um depende do produto exato finalizado pelo anterior.',
    preset: 'dsl-purchase',
    dsl: `SEQUENCE {
  FETCH INVENTORY
  EXECUTE PAYMENT
}`,
    json: `{
  "type": "SEQUENCE",
  "steps": [
    {
      "type": "STEP",
      "capability": "FETCH INVENTORY"
    },
    {
      "type": "STEP",
      "capability": "EXECUTE PAYMENT"
    }
  ]
}`,
    python: `from inp_sdk import Sequence, Step

# Define o fluxo sequencial
flow = Sequence([
    Step("FETCH INVENTORY"),
    Step("EXECUTE PAYMENT")
])

# Envia para execução
response = client.execute(flow)
print(response.context)`
  },
  PARALLEL: {
    name: 'PARALLEL',
    category: 'Estrutura',
    desc: 'Dispara a execução de múltiplos passos concorrentemente. O motor de execução do INP otimiza o tempo total processando as chamadas em paralelo (Promise.all) e unificando as respostas retornadas.',
    analogy: 'Como pedir comida e bebida de estabelecimentos separados ao mesmo tempo no aplicativo de delivery: ambos os entregadores viajam concorrentemente, fazendo o seu pedido chegar muito mais rápido do que se você esperasse o primeiro voltar para pedir o segundo.',
    preset: 'dsl-resilience',
    dsl: `PARALLEL {
  FETCH INVENTORY
  VALIDATE USER
}`,
    json: `{
  "type": "PARALLEL",
  "steps": [
    {
      "type": "STEP",
      "capability": "FETCH INVENTORY"
    },
    {
      "type": "STEP",
      "capability": "VALIDATE USER"
    }
  ]
}`,
    python: `from inp_sdk import Parallel, Step

# Executa múltiplos microsserviços concorrentemente
flow = Parallel([
    Step("FETCH INVENTORY"),
    Step("VALIDATE USER")
])

response = client.execute(flow)
print(response.results)`
  },
  CONDITION: {
    name: 'CONDITION',
    category: 'Controle',
    desc: 'Avalia uma expressão lógica JavaScript contra o contexto dinâmico da transação. Caso a expressão retorne verdadeiro, o bloco interno de passos é executado; caso contrário, é totalmente ignorado.',
    analogy: 'Como um controle de acesso em baladas: se o cliente for maior de idade (idade >= 18), a entrada é permitida (executa o passo); se for menor, o fluxo é barrado imediatamente.',
    preset: 'dsl-purchase',
    dsl: `CONDITION "context.amount > 100" {
  EXECUTE PAYMENT
}`,
    json: `{
  "type": "CONDITION",
  "expression": "context.amount > 100",
  "steps": [
    {
      "type": "STEP",
      "capability": "EXECUTE PAYMENT"
    }
  ]
}`,
    python: `from inp_sdk import Condition, Step

# Condiciona a cobrança apenas se o valor exceder 100
flow = Condition(
    expression="context.amount > 100",
    steps=[
        Step("EXECUTE PAYMENT")
    ]
)

response = client.execute(flow)`
  },
  RETRY: {
    name: 'RETRY',
    category: 'Resiliência',
    desc: 'Configura uma política de tentativas automáticas imediatas. Caso um passo falhe por erro de rede ou indisponibilidade, o motor de execução do INP repete a chamada até o limite especificado.',
    analogy: 'Como tentar ligar de volta para alguém após o sinal cair: você tenta discar novamente (até 3 vezes) antes de desistir e assumir que o destinatário não pode atender.',
    preset: 'dsl-resilience',
    dsl: `RETRY 3 {
  EXECUTE PAYMENT
}`,
    json: `{
  "type": "RETRY",
  "attempts": 3,
  "steps": [
    {
      "type": "STEP",
      "capability": "EXECUTE PAYMENT"
    }
  ]
}`,
    python: `from inp_sdk import Retry, Step

# Tenta processar o pagamento até 3 vezes em caso de erro
flow = Retry(
    attempts=3,
    steps=[
        Step("EXECUTE PAYMENT")
    ]
)

response = client.execute(flow)`
  },
  TIMEOUT: {
    name: 'TIMEOUT',
    category: 'Resiliência',
    desc: 'Limita o tempo máximo tolerado para a execução de um bloco em milissegundos. Se o tempo for estourado, o motor do INP cancela a operação e executa um failover rápido.',
    analogy: 'Como a campainha cronometrada de uma prova ou de um jogo de basquete: quando o alarme soa, a ação é encerrada imediatamente e os jogadores devem parar no mesmo instante.',
    preset: 'dsl-resilience',
    dsl: `TIMEOUT 2500 {
  EXECUTE PAYMENT
}`,
    json: `{
  "type": "TIMEOUT",
  "milliseconds": 2500,
  "steps": [
    {
      "type": "STEP",
      "capability": "EXECUTE PAYMENT"
    }
  ]
}`,
    python: `from inp_sdk import Timeout, Step

# Define o tempo limite estrito de 2.5 segundos
flow = Timeout(
    milliseconds=2500,
    steps=[
        Step("EXECUTE PAYMENT")
    ]
)

response = client.execute(flow)`
  },
  SCOPE: {
    name: 'SCOPE',
    category: 'Controle',
    desc: 'Isola o estado de execução criando um contexto local clonado. Previne que alterações, escritas ou variáveis temporárias criadas nos passos internos mutem o contexto global.',
    analogy: 'Como um quadro negro ou rascunho de papel em uma reunião de planejamento: todos desenham fórmulas rápidas ali para fazer simulações sem alterar o contrato final assinado.',
    preset: 'dsl-advanced',
    dsl: `SCOPE {
  EXECUTE PAYMENT
}`,
    json: `{
  "type": "SCOPE",
  "steps": [
    {
      "type": "STEP",
      "capability": "EXECUTE PAYMENT"
    }
  ]
}`,
    python: `from inp_sdk import Scope, Step

# Isola variáveis de execução
flow = Scope([
    Step("EXECUTE PAYMENT")
])

response = client.execute(flow)`
  },
  DEPENDENCY: {
    name: 'DEPENDENCY',
    category: 'Controle',
    desc: 'Condiciona a execução de tarefas dependentes ao sucesso obrigatório de capacidades ou passos que deveriam rodar anteriormente no fluxo geral.',
    analogy: 'Como as dependências escolares: você precisa passar na matéria de Algoritmos I (pré-requisito) antes de ter autorização para cursar Algoritmos II.',
    preset: 'dsl-advanced',
    dsl: `DEPENDENCY "EXECUTE PAYMENT" {
  NOTIFY USER
}`,
    json: `{
  "type": "DEPENDENCY",
  "dependsOn": "EXECUTE PAYMENT",
  "steps": [
    {
      "type": "STEP",
      "capability": "NOTIFY USER"
    }
  ]
}`,
    python: `from inp_sdk import Dependency, Step

# Dispara a notificação somente após a aprovação de pagamento
flow = Dependency(
    depends_on="EXECUTE PAYMENT",
    steps=[
        Step("NOTIFY USER")
    ]
)

response = client.execute(flow)`
  },
  ENCRYPT: {
    name: 'ENCRYPT',
    category: 'Segurança',
    desc: 'Criptografa chaves ou valores confidenciais contidos no contexto (armazenados em base64) para garantir que trafeguem de forma invisível a intermediários da rede.',
    analogy: 'Como enviar um documento lacrado dentro de um envelope blindado que apenas o destinatário possui o código numérico secreto para abrir.',
    preset: 'dsl-advanced',
    dsl: `ENCRYPT "secret_key"`,
    json: `{
  "type": "ENCRYPT",
  "key": "secret_key"
}`,
    python: `from inp_sdk import Encrypt

# Criptografa a chave sensível "secret_key"
flow = Encrypt(key="secret_key")

response = client.execute(flow)`
  },
  DECRYPT: {
    name: 'DECRYPT',
    category: 'Segurança',
    desc: 'Desfaz a encriptação de chaves específicas do contexto, decodificando-as de volta a texto plano para que possam ser processadas por serviços autorizados.',
    analogy: 'Como o destinatário digitando a senha numérica no envelope blindado recebido, transformando o pacote trancado no papel original legível.',
    preset: 'dsl-advanced',
    dsl: `DECRYPT "secret_key"`,
    json: `{
  "type": "DECRYPT",
  "key": "secret_key"
}`,
    python: `from inp_sdk import Decrypt

# Descriptografa a chave para leitura dos dados
flow = Decrypt(key="secret_key")

response = client.execute(flow)`
  },
  INTENT: {
    name: 'INTENT',
    category: 'Conceito',
    desc: 'Representa a declaração pura da intenção ou objetivo de negócio expressa pelo usuário (seja por linguagem natural ou estruturada), delegando à rede a responsabilidade de interpretar e compilar o fluxo de execução ótimo.',
    analogy: 'Como entrar em um táxi e dizer o endereço de destino: você declara para onde quer ir (a intenção), e o motorista calcula as ruas, trânsito e o caminho ideal.',
    preset: 'natural-purchase',
    dsl: `// Intenção declarada em linguagem natural
"Quero comprar o produto P10 com o valor de 450 euros e notificar admin@empresa.com"`,
    json: `{
  "type": "INTENT",
  "value": "Quero comprar o produto P10 com o valor de 450 euros e notificar admin@empresa.com",
  "resolved": true
}`,
    python: `# Envio de intenção direta via SDK
response = client.submit_intent(
    "Quero comprar o produto P10 com o valor de 450 euros e notificar admin@empresa.com"
)
print(response.resolved_dsl)`
  },
  CAPABILITY: {
    name: 'CAPABILITY',
    category: 'Conceito',
    desc: 'Mapeia e representa uma função ou serviço atômico cadastrado no catálogo de APIs do gateway do INP. É a unidade básica de execução de hardware/software acionada pela DSL (ex: buscar estoque, processar débito, despachar mercadoria).',
    analogy: 'Como os ingredientes catalogados em uma cozinha profissional. A receita (DSL) dita como combiná-los, mas o tomate ou o queijo (Capability) são as peças brutas e úteis.',
    preset: 'dsl-purchase',
    dsl: `EXECUTE PAYMENT`,
    json: `{
  "type": "STEP",
  "capability": "EXECUTE PAYMENT"
}`,
    python: `from inp_sdk import Step

# Invoca a capacidade diretamente
flow = Step("EXECUTE PAYMENT")

response = client.execute(flow)`
  },
  CREATE: {
    name: 'CREATE',
    category: 'Verbo',
    desc: 'Instancia uma nova entidade durável no domínio de negócio, atribuindo-lhe identidade primária (ID global) e iniciando o seu ciclo de vida. Use para cadastrar utilizadores, novas remessas, pedidos comerciais ou faturas fiscais. Não use para gravação em cache (use STORE).',
    analogy: 'Como lavrar uma nova certidão de nascimento no cartório: o documento oficial passa a existir juridicamente com número único e validade perpétua.',
    preset: 'dsl-purchase',
    dsl: `INTENT "create_shipment" {
  REQUIRE {
    CREATE SHIPMENT
  }
  FLOW {
    SEQUENCE {
      CREATE SHIPMENT
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "CREATE SHIPMENT",
  "verb": "CREATE",
  "target": "SHIPMENT"
}`,
    python: `from inp_sdk import Step

# Cria nova remessa de envio durável
flow = Step("CREATE SHIPMENT")
response = client.execute(flow)`
  },
  READ: {
    name: 'READ',
    category: 'Verbo',
    desc: 'Consulta e recupera os atributos de uma entidade já existente no banco de dados local pelo seu ID. Operação puramente de leitura, segura e idempotente. Não use para chamadas em APIs de terceiros (use FETCH).',
    analogy: 'Como abrir a ficha cadastral arquivada na gaveta da empresa para consultar os dados do cliente sem alterar nada.',
    preset: 'dsl-purchase',
    dsl: `INTENT "read_profile" {
  REQUIRE {
    READ USER_PROFILE
  }
  FLOW {
    SEQUENCE {
      READ USER_PROFILE
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "READ USER_PROFILE",
  "verb": "READ",
  "target": "USER_PROFILE"
}`,
    python: `from inp_sdk import Step

# Consulta perfil de utilizador existente
flow = Step("READ USER_PROFILE")
response = client.execute(flow)`
  },
  UPDATE: {
    name: 'UPDATE',
    category: 'Verbo',
    desc: 'Modifica os atributos, campos ou o estado operacional de um recurso pré-existente. Preserva a identidade histórica enquanto atualiza seus valores no banco.',
    analogy: 'Como averbar um novo endereço na sua certidão: a pessoa jurídica continua a mesma, mas os detalhes de contato são renovados.',
    preset: 'dsl-purchase',
    dsl: `INTENT "update_address" {
  REQUIRE {
    UPDATE SHIPPING_ADDRESS
  }
  FLOW {
    SEQUENCE {
      UPDATE SHIPPING_ADDRESS
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "UPDATE SHIPPING_ADDRESS",
  "verb": "UPDATE",
  "target": "SHIPPING_ADDRESS"
}`,
    python: `from inp_sdk import Step

# Atualiza endereço de entrega do pedido
flow = Step("UPDATE SHIPPING_ADDRESS")
response = client.execute(flow)`
  },
  DELETE: {
    name: 'DELETE',
    category: 'Verbo',
    desc: 'Elimina de forma definitiva ou lógica uma entidade do armazenamento. Usado para expurgo de dados obsoletos, encerramento de sessões ou direito ao esquecimento (LGPD/GDPR).',
    analogy: 'Como triturar um arquivo confidencial expirado na máquina de fragmentação: o registro é eliminado definitivamente do arquivo físico.',
    preset: 'dsl-purchase',
    dsl: `INTENT "delete_session" {
  REQUIRE {
    DELETE USER_SESSION
  }
  FLOW {
    SEQUENCE {
      DELETE USER_SESSION
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "DELETE USER_SESSION",
  "verb": "DELETE",
  "target": "USER_SESSION"
}`,
    python: `from inp_sdk import Step

# Elimina a sessão do utilizador
flow = Step("DELETE USER_SESSION")
response = client.execute(flow)`
  },
  EXECUTE: {
    name: 'EXECUTE',
    category: 'Verbo',
    desc: 'Dispara uma ação transacional atômica e imperativa de alta criticidade no mundo real (ex: pagamentos, contratos). Exige obrigatoriamente a declaração de uma capacidade de compensação (Padrão Saga: REFUND).',
    analogy: 'Como passar o cartão de crédito e digitar a senha: uma transação financeira imediata e atômica é acionada na adquirente.',
    preset: 'dsl-purchase',
    dsl: `INTENT "execute_payment" {
  REQUIRE {
    EXECUTE PAYMENT
  }
  FLOW {
    SEQUENCE {
      EXECUTE PAYMENT
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "EXECUTE PAYMENT",
  "verb": "EXECUTE",
  "target": "PAYMENT"
}`,
    python: `from inp_sdk import Step

# Dispara cobrança monetária imediata
flow = Step("EXECUTE PAYMENT")
response = client.execute(flow)`
  },
  PROCESS: {
    name: 'PROCESS',
    category: 'Verbo',
    desc: 'Submete lotes de registros, fluxos contínuos ou filas assíncronas a uma sequência de computação e tratamento. Usado para faturamento em lote, conversão de arquivos ou drenagem de eventos.',
    analogy: 'Como a linha de montagem industrial: dezenas de itens são processados ordenadamente por múltiplos estágios sucessivos.',
    preset: 'dsl-purchase',
    dsl: `INTENT "process_batch" {
  REQUIRE {
    PROCESS INVOICE_BATCH
  }
  FLOW {
    SEQUENCE {
      PROCESS INVOICE_BATCH
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "PROCESS INVOICE_BATCH",
  "verb": "PROCESS",
  "target": "INVOICE_BATCH"
}`,
    python: `from inp_sdk import Step

# Processa lote de faturas em segundo plano
flow = Step("PROCESS INVOICE_BATCH")
response = client.execute(flow)`
  },
  ANALYZE: {
    name: 'ANALYZE',
    category: 'Verbo',
    desc: 'Aplica algoritmos de inteligência artificial, regras estatísticas ou telemetria para inspecionar um conjunto de dados e extrair scores de risco ou diagnósticos. Somente leitura.',
    analogy: 'Como um laboratório analisando um exame clínico: o laudo diagnóstico é emitido sem alterar a amostra examinada.',
    preset: 'dsl-purchase',
    dsl: `INTENT "analyze_fraud" {
  REQUIRE {
    ANALYZE FRAUD_RISK
  }
  FLOW {
    SEQUENCE {
      ANALYZE FRAUD_RISK
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "ANALYZE FRAUD_RISK",
  "verb": "ANALYZE",
  "target": "FRAUD_RISK"
}`,
    python: `from inp_sdk import Step

# Analisa risco de fraude transacional
flow = Step("ANALYZE FRAUD_RISK")
response = client.execute(flow)`
  },
  GENERATE: {
    name: 'GENERATE',
    category: 'Verbo',
    desc: 'Produz artefatos digitais sintetizados, códigos temporários, documentos derivados ou relatórios a partir de templates ou cálculos (ex: relatórios PDF, tokens JWT, QR Codes).',
    analogy: 'Como uma máquina fotográfica instantânea: recebe a luz e o cenário e sintetiza uma fotografia impressa no mesmo instante.',
    preset: 'dsl-purchase',
    dsl: `INTENT "generate_invoice" {
  REQUIRE {
    GENERATE INVOICE_PDF
  }
  FLOW {
    SEQUENCE {
      GENERATE INVOICE_PDF
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "GENERATE INVOICE_PDF",
  "verb": "GENERATE",
  "target": "INVOICE_PDF"
}`,
    python: `from inp_sdk import Step

# Gera o PDF da fatura para o cliente
flow = Step("GENERATE INVOICE_PDF")
response = client.execute(flow)`
  },
  TRANSFER: {
    name: 'TRANSFER',
    category: 'Verbo',
    desc: 'Transfere fundos monetários, ativos digitais ou inventário de uma entidade de origem para uma de destino de forma balanceada e atômica (débito obrigatório casado com crédito simultâneo).',
    analogy: 'Como uma transferência bancária direta entre contas: os fundos saem de uma conta no exato instante em que entram na outra.',
    preset: 'dsl-purchase',
    dsl: `INTENT "transfer_funds" {
  REQUIRE {
    TRANSFER FUNDS
  }
  FLOW {
    SEQUENCE {
      TRANSFER FUNDS
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "TRANSFER FUNDS",
  "verb": "TRANSFER",
  "target": "FUNDS"
}`,
    python: `from inp_sdk import Step

# Transfere fundos entre carteiras
flow = Step("TRANSFER FUNDS")
response = client.execute(flow)`
  },
  VALIDATE: {
    name: 'VALIDATE',
    category: 'Verbo',
    desc: 'Inspeciona e valida se um payload, documento ou regra atende a contratos formais (JSON Schema) ou restrições de negócio antes de avançar para etapas computacionalmente caras.',
    analogy: 'Como o inspetor de embarque conferindo se o peso da mala está dentro do limite regulamentar permitido antes de despachá-la.',
    preset: 'dsl-purchase',
    dsl: `INTENT "validate_order" {
  REQUIRE {
    VALIDATE ORDER_PAYLOAD
  }
  FLOW {
    SEQUENCE {
      VALIDATE ORDER_PAYLOAD
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "VALIDATE ORDER_PAYLOAD",
  "verb": "VALIDATE",
  "target": "ORDER_PAYLOAD"
}`,
    python: `from inp_sdk import Step

# Valida payload contra o schema contratual
flow = Step("VALIDATE ORDER_PAYLOAD")
response = client.execute(flow)`
  },
  AUTHENTICATE: {
    name: 'AUTHENTICATE',
    category: 'Verbo',
    desc: 'Verifica a identidade declarada de um usuário ou máquina através de credenciais criptográficas (senhas hash Argon2, JWT, certificados). Responde: "Quem é você?".',
    analogy: 'Como apresentar o passaporte na imigração com conferência biométrica para atestar quem você é.',
    preset: 'dsl-advanced',
    dsl: `INTENT "auth_user" {
  REQUIRE {
    AUTHENTICATE USER
  }
  FLOW {
    SEQUENCE {
      AUTHENTICATE USER
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "AUTHENTICATE USER",
  "verb": "AUTHENTICATE",
  "target": "USER"
}`,
    python: `from inp_sdk import Step

# Autentica credenciais de acesso
flow = Step("AUTHENTICATE USER")
response = client.execute(flow)`
  },
  AUTHORIZE: {
    name: 'AUTHORIZE',
    category: 'Verbo',
    desc: 'Inspeciona matrizes de privilégios (RBAC/ABAC) para certificar se um usuário autenticado tem permissão para realizar uma ação sobre um recurso. Responde: "Você pode fazer isso?".',
    analogy: 'Como o segurança do elevador privativo verificando se o seu crachá tem o selo de acesso autorizado à diretoria.',
    preset: 'dsl-advanced',
    dsl: `INTENT "authorize_payment" {
  REQUIRE {
    AUTHORIZE PAYMENT_SCOPE
  }
  FLOW {
    SEQUENCE {
      AUTHORIZE PAYMENT_SCOPE
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "AUTHORIZE PAYMENT_SCOPE",
  "verb": "AUTHORIZE",
  "target": "PAYMENT_SCOPE"
}`,
    python: `from inp_sdk import Step

# Valida privilégio RBAC payments.write
flow = Step("AUTHORIZE PAYMENT_SCOPE")
response = client.execute(flow)`
  },
  NOTIFY: {
    name: 'NOTIFY',
    category: 'Verbo',
    desc: 'Dispara mensagens, alertas em tempo real ou avisos para destinatários humanos ou serviços externos (SMS, Push, Slack, Webhook) de maneira não-bloqueante.',
    analogy: 'Como o painel de senhas de um banco chamando o próximo cliente pelo número com aviso sonoro.',
    preset: 'dsl-purchase',
    dsl: `INTENT "notify_user" {
  REQUIRE {
    NOTIFY USER
  }
  FLOW {
    SEQUENCE {
      NOTIFY USER
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "NOTIFY USER",
  "verb": "NOTIFY",
  "target": "USER"
}`,
    python: `from inp_sdk import Step

# Notifica o cliente sobre o status da compra
flow = Step("NOTIFY USER")
response = client.execute(flow)`
  },
  SYNC: {
    name: 'SYNC',
    category: 'Verbo',
    desc: 'Concilia e alinha dados ou estados entre múltiplos nós, réplicas ou ERPs legados heterogêneos para garantir consistência eventual. Idempotente por natureza.',
    analogy: 'Como acertar todos os relógios de uma estação de trem pelo sinal de rádio central para que marquem a mesma hora.',
    preset: 'dsl-purchase',
    dsl: `INTENT "sync_catalog" {
  REQUIRE {
    SYNC INVENTORY_CATALOG
  }
  FLOW {
    SEQUENCE {
      SYNC INVENTORY_CATALOG
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "SYNC INVENTORY_CATALOG",
  "verb": "SYNC",
  "target": "INVENTORY_CATALOG"
}`,
    python: `from inp_sdk import Step

# Sincroniza catálogo de estoque com ERP
flow = Step("SYNC INVENTORY_CATALOG")
response = client.execute(flow)`
  },
  ROUTE: {
    name: 'ROUTE',
    category: 'Verbo',
    desc: 'Analisa metadados e regras de rede e despacha a requisição para o shard de banco, cluster ou nó federado ideal com base em latência e disponibilidade.',
    analogy: 'Como o controlador de tráfego aéreo indicando qual pista de pouso está livre e com condições ideais de vento.',
    preset: 'dsl-advanced',
    dsl: `INTENT "route_traffic" {
  REQUIRE {
    ROUTE INTENT_NODE
  }
  FLOW {
    SEQUENCE {
      ROUTE INTENT_NODE
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "ROUTE INTENT_NODE",
  "verb": "ROUTE",
  "target": "INTENT_NODE"
}`,
    python: `from inp_sdk import Step

# Roteia requisição para nó federado
flow = Step("ROUTE INTENT_NODE")
response = client.execute(flow)`
  },
  COMPOSE: {
    name: 'COMPOSE',
    category: 'Verbo',
    desc: 'Funde e agrega saídas parciais de múltiplos microsserviços concorrentes, gerando uma resposta final consolidada e estruturada para o cliente.',
    analogy: 'Como um maestro coordenando diferentes instrumentos para compor uma sinfonia musical integrada e harmoniosa.',
    preset: 'dsl-purchase',
    dsl: `INTENT "compose_summary" {
  REQUIRE {
    COMPOSE ORDER_SUMMARY
  }
  FLOW {
    SEQUENCE {
      COMPOSE ORDER_SUMMARY
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "COMPOSE ORDER_SUMMARY",
  "verb": "COMPOSE",
  "target": "ORDER_SUMMARY"
}`,
    python: `from inp_sdk import Step

# Consolida resumo de compra unificando etapas
flow = Step("COMPOSE ORDER_SUMMARY")
response = client.execute(flow)`
  },
  FETCH: {
    name: 'FETCH',
    category: 'Verbo',
    desc: 'Realiza recuperação ativa de dados através de chamadas I/O de rede a APIs de parceiros, gateways remotos ou serviços externos (ex: cotação de câmbio, rastreio de frete).',
    analogy: 'Como um mensageiro indo até a agência de correios buscar um pacote expedido por um fornecedor distante.',
    preset: 'dsl-purchase',
    dsl: `INTENT "fetch_rates" {
  REQUIRE {
    FETCH CURRENCY_RATES
  }
  FLOW {
    SEQUENCE {
      FETCH CURRENCY_RATES
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "FETCH CURRENCY_RATES",
  "verb": "FETCH",
  "target": "CURRENCY_RATES"
}`,
    python: `from inp_sdk import Step

# Recupera taxas de câmbio atualizadas via API
flow = Step("FETCH CURRENCY_RATES")
response = client.execute(flow)`
  },
  STORE: {
    name: 'STORE',
    category: 'Verbo',
    desc: 'Persiste fisicamente payloads brutos, logs de execução, estados transitórios ou cache em bancos de dados relacionais, Redis ou S3.',
    analogy: 'Como guardar caixas de mercadorias no almoxarifado: o foco é armazenar o objeto com segurança para localização rápida futura.',
    preset: 'dsl-purchase',
    dsl: `INTENT "store_order" {
  REQUIRE {
    STORE ORDER_PAYLOAD
  }
  FLOW {
    SEQUENCE {
      STORE ORDER_PAYLOAD
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "STORE ORDER_PAYLOAD",
  "verb": "STORE",
  "target": "ORDER_PAYLOAD"
}`,
    python: `from inp_sdk import Step

# Armazena o payload bruto no PostgreSQL
flow = Step("STORE ORDER_PAYLOAD")
response = client.execute(flow)`
  },
  CALCULATE: {
    name: 'CALCULATE',
    category: 'Verbo',
    desc: 'Executa computação matemática pura, orçamentos, taxas ou regras determinísticas sobre variáveis numéricas sem depender de I/O externo ou gerar mutação de estado.',
    analogy: 'Como uma calculadora financeira aplicando fórmulas de amortização e impostos sobre o valor base inserido.',
    preset: 'dsl-purchase',
    dsl: `INTENT "calc_tax" {
  REQUIRE {
    CALCULATE TAX_TOTAL
  }
  FLOW {
    SEQUENCE {
      CALCULATE TAX_TOTAL
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "CALCULATE TAX_TOTAL",
  "verb": "CALCULATE",
  "target": "TAX_TOTAL"
}`,
    python: `from inp_sdk import Step

# Calcula taxas fiscais de forma determinística
flow = Step("CALCULATE TAX_TOTAL")
response = client.execute(flow)`
  },
  REFUND: {
    name: 'REFUND',
    category: 'Verbo',
    desc: 'Estorna transações financeiras liquidadas anteriormente, devolvendo os valores à origem do pagador. Atua como ação de compensação essencial para o verbo EXECUTE PAYMENT no Padrão Saga.',
    analogy: 'Como o comerciante processando a devolução do dinheiro na fatura do cliente após a anulação da compra.',
    preset: 'dsl-resilience',
    dsl: `INTENT "refund_payment" {
  REQUIRE {
    REFUND PAYMENT
  }
  FLOW {
    SEQUENCE {
      REFUND PAYMENT
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "REFUND PAYMENT",
  "verb": "REFUND",
  "target": "PAYMENT"
}`,
    python: `from inp_sdk import Step

# Estorna o valor cobrado do cartão
flow = Step("REFUND PAYMENT")
response = client.execute(flow)`
  },
  CANCEL: {
    name: 'CANCEL',
    category: 'Verbo',
    desc: 'Interrompe formalmente a continuidade de pedidos, processos ativos ou reservas, mudando seu estado para CANCELADO e liberando recursos. Compensação para CREATE ou RESERVE.',
    analogy: 'Como ligar para a transportadora e cancelar o pedido de coleta antes do despacho do caminhão.',
    preset: 'dsl-resilience',
    dsl: `INTENT "cancel_shipment" {
  REQUIRE {
    CANCEL SHIPMENT
  }
  FLOW {
    SEQUENCE {
      CANCEL SHIPMENT
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "CANCEL SHIPMENT",
  "verb": "CANCEL",
  "target": "SHIPMENT"
}`,
    python: `from inp_sdk import Step

# Cancela a remessa de transporte antes do despacho
flow = Step("CANCEL SHIPMENT")
response = client.execute(flow)`
  },
  APPROVE: {
    name: 'APPROVE',
    category: 'Verbo',
    desc: 'Registra aprovação formal de alçada de negócio, crédito ou parecer administrativo para pedidos sob quarentena ou compliance.',
    analogy: 'Como o comitê de crédito aprovando o financiamento com chancela formal de liberação.',
    preset: 'dsl-purchase',
    dsl: `INTENT "approve_loan" {
  REQUIRE {
    APPROVE LOAN_PROPOSAL
  }
  FLOW {
    SEQUENCE {
      APPROVE LOAN_PROPOSAL
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "APPROVE LOAN_PROPOSAL",
  "verb": "APPROVE",
  "target": "LOAN_PROPOSAL"
}`,
    python: `from inp_sdk import Step

# Aprova formalmente a proposta de crédito
flow = Step("APPROVE LOAN_PROPOSAL")
response = client.execute(flow)`
  },
  REJECT: {
    name: 'REJECT',
    category: 'Verbo',
    desc: 'Recusa formalmente uma proposta ou solicitação que não cumpriu os critérios do negócio, encerrando a intenção em estado terminal de rejeição.',
    analogy: 'Como a seguradora recusando a cobertura de um sinistro por não atender às cláusulas da apólice.',
    preset: 'dsl-purchase',
    dsl: `INTENT "reject_claim" {
  REQUIRE {
    REJECT INSURANCE_CLAIM
  }
  FLOW {
    SEQUENCE {
      REJECT INSURANCE_CLAIM
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "REJECT INSURANCE_CLAIM",
  "verb": "REJECT",
  "target": "INSURANCE_CLAIM"
}`,
    python: `from inp_sdk import Step

# Rejeita formalmente o sinistro
flow = Step("REJECT INSURANCE_CLAIM")
response = client.execute(flow)`
  },
  CHECK: {
    name: 'CHECK',
    category: 'Verbo',
    desc: 'Consulta o estado ou disponibilidade de um recurso de forma atômica e instantânea sem realizar alocações, reservas ou retenções. Use para checar estoque ou saúde do nó.',
    analogy: 'Como olhar rapidamente a vitrine para confirmar se o tênis do seu número está exposto sem pedir para guardar.',
    preset: 'dsl-purchase',
    dsl: `INTENT "check_stock" {
  REQUIRE {
    CHECK STOCK
  }
  FLOW {
    SEQUENCE {
      CHECK STOCK
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "CHECK STOCK",
  "verb": "CHECK",
  "target": "STOCK"
}`,
    python: `from inp_sdk import Step

# Checa disponibilidade de estoque instantânea
flow = Step("CHECK STOCK")
response = client.execute(flow)`
  },
  RESERVE: {
    name: 'RESERVE',
    category: 'Verbo',
    desc: 'Aloca e retém temporariamente recursos (estoque, saldo ou assentos) com tempo de vida limitado (TTL) durante o checkout. Exige compensação com RELEASE se o pagamento falhar.',
    analogy: 'Como pedir ao vendedor da loja para segurar a peça no balcão por 15 minutos enquanto você vai ao caixa pagar.',
    preset: 'dsl-purchase',
    dsl: `INTENT "reserve_stock" {
  REQUIRE {
    RESERVE STOCK
  }
  FLOW {
    SEQUENCE {
      RESERVE STOCK
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "RESERVE STOCK",
  "verb": "RESERVE",
  "target": "STOCK"
}`,
    python: `from inp_sdk import Step

# Reserva unidades de produto com TTL
flow = Step("RESERVE STOCK")
response = client.execute(flow)`
  },
  RELEASE: {
    name: 'RELEASE',
    category: 'Verbo',
    desc: 'Desbloqueia e devolve recursos retidos temporariamente pelo verbo RESERVE à disponibilidade geral. Ação de compensação direta no padrão Saga para reversão de estoque.',
    analogy: 'Como o vendedor devolvendo a peça reservada para a prateleira da loja após o cliente desistir da compra.',
    preset: 'dsl-resilience',
    dsl: `INTENT "release_stock" {
  REQUIRE {
    RELEASE STOCK
  }
  FLOW {
    SEQUENCE {
      RELEASE STOCK
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "RELEASE STOCK",
  "verb": "RELEASE",
  "target": "STOCK"
}`,
    python: `from inp_sdk import Step

# Liberta o estoque reservado de volta à prateleira
flow = Step("RELEASE STOCK")
response = client.execute(flow)`
  },
  SEND: {
    name: 'SEND',
    category: 'Verbo',
    desc: 'Expede documentos, comprovantes ou payloads físicos/digitais diretamente ao destinatário (ex: enviar fatura por e-mail, enviar SMS com código de confirmação).',
    analogy: 'Como postar uma carta registrada no correio destinada a uma pessoa específica.',
    preset: 'dsl-purchase',
    dsl: `INTENT "send_confirmation" {
  REQUIRE {
    SEND CONFIRMATION
  }
  FLOW {
    SEQUENCE {
      SEND CONFIRMATION
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "SEND CONFIRMATION",
  "verb": "SEND",
  "target": "CONFIRMATION"
}`,
    python: `from inp_sdk import Step

# Envia recibo e confirmação ao comprador
flow = Step("SEND CONFIRMATION")
response = client.execute(flow)`
  },
  DISPATCH: {
    name: 'DISPATCH',
    category: 'Verbo',
    desc: 'Aciona a execução de tarefas pesadas em segundo plano para workers assíncronos ou inicia o transporte de remessas físicas na logística.',
    analogy: 'Como despachar a frota de caminhões da fábrica carregados de mercadorias rumo às cidades de entrega.',
    preset: 'dsl-purchase',
    dsl: `INTENT "dispatch_worker" {
  REQUIRE {
    DISPATCH BACKGROUND_WORKER
  }
  FLOW {
    SEQUENCE {
      DISPATCH BACKGROUND_WORKER
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "DISPATCH BACKGROUND_WORKER",
  "verb": "DISPATCH",
  "target": "BACKGROUND_WORKER"
}`,
    python: `from inp_sdk import Step

# Despacha worker para processamento assíncrono
flow = Step("DISPATCH BACKGROUND_WORKER")
response = client.execute(flow)`
  },
  PUBLISH: {
    name: 'PUBLISH',
    category: 'Verbo',
    desc: 'Emite eventos de domínio ou mensagens para barramentos pub/sub distribuídos (Kafka, RabbitMQ, Redis) para consumo por múltiplos microsserviços desacoplados.',
    analogy: 'Como publicar um anúncio no jornal de circulação geral: qualquer leitor interessado pode consumir a notícia.',
    preset: 'dsl-advanced',
    dsl: `INTENT "publish_event" {
  REQUIRE {
    PUBLISH ORDER_EVENT
  }
  FLOW {
    SEQUENCE {
      PUBLISH ORDER_EVENT
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "PUBLISH ORDER_EVENT",
  "verb": "PUBLISH",
  "target": "ORDER_EVENT"
}`,
    python: `from inp_sdk import Step

# Publica evento de conclusão no barramento Kafka
flow = Step("PUBLISH ORDER_EVENT")
response = client.execute(flow)`
  },
  ARCHIVE: {
    name: 'ARCHIVE',
    category: 'Verbo',
    desc: 'Transfere dados inativos de tabelas de produção para armazenamento frio e imutável para cumprimento de retenção legal e auditoria fiscal (SOC2, ISO 27001).',
    analogy: 'Como arquivar caixas de notas fiscais antigas no arquivo morto subterrâneo da empresa para guarda legal obrigatória.',
    preset: 'dsl-advanced',
    dsl: `INTENT "archive_logs" {
  REQUIRE {
    ARCHIVE AUDIT_LOGS
  }
  FLOW {
    SEQUENCE {
      ARCHIVE AUDIT_LOGS
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "ARCHIVE AUDIT_LOGS",
  "verb": "ARCHIVE",
  "target": "AUDIT_LOGS"
}`,
    python: `from inp_sdk import Step

# Arquiva logs históricos de auditoria
flow = Step("ARCHIVE AUDIT_LOGS")
response = client.execute(flow)`
  },
  AUDIT: {
    name: 'AUDIT',
    category: 'Verbo',
    desc: 'Inspeciona e valida a integridade de trilhas de auditoria forense, assinaturas criptográficas e conformidade das transações registradas.',
    analogy: 'Como auditores externos conferindo os livros contábeis e registros de caixa para emitir parecer de conformidade e integridade.',
    preset: 'dsl-advanced',
    dsl: `INTENT "audit_trail" {
  REQUIRE {
    AUDIT TRANSACTION_TRAIL
  }
  FLOW {
    SEQUENCE {
      AUDIT TRANSACTION_TRAIL
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "AUDIT TRANSACTION_TRAIL",
  "verb": "AUDIT",
  "target": "TRANSACTION_TRAIL"
}`,
    python: `from inp_sdk import Step

# Audita a trilha criptográfica de transações
flow = Step("AUDIT TRANSACTION_TRAIL")
response = client.execute(flow)`
  },
  COALESCE: {
    name: 'COALESCE',
    category: 'Verbo',
    desc: 'Single-Flight Pattern: Colapsa requisições concorrentes idênticas em voo numa única execução real, devolvendo o mesmo resultado para todas e mitigando o efeito Thundering Herd.',
    analogy: 'Como 50 pessoas no mesmo prédio chamando o mesmo elevador para o mesmo andar: o elevador faz apenas uma viagem e transporta todos juntos.',
    preset: 'dsl-advanced',
    dsl: `INTENT "coalesce_metrics" {
  REQUIRE {
    COALESCE METRICS_SNAPSHOT
  }
  FLOW {
    SEQUENCE {
      COALESCE METRICS_SNAPSHOT
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "COALESCE METRICS_SNAPSHOT",
  "verb": "COALESCE",
  "target": "METRICS_SNAPSHOT"
}`,
    python: `from inp_sdk import Step

# Single-flight deduplicado
flow = Step("COALESCE METRICS_SNAPSHOT")
response = client.execute(flow)`
  },
  MEMOIZE: {
    name: 'MEMOIZE',
    category: 'Verbo',
    desc: 'Cache-Aside Atómico: Memoiza resultados de computação ou consulta em memória volátil com hashing SHA-256 e TTL configurável, contornando chamadas de rede repetitivas.',
    analogy: 'Como anotar na lousa o resultado de uma conta complexa para não ter de refazê-la toda vez que alguém perguntar.',
    preset: 'dsl-advanced',
    dsl: `INTENT "memo_calc" {
  REQUIRE {
    MEMOIZE TAX_CALCULATION
  }
  FLOW {
    SEQUENCE {
      MEMOIZE TAX_CALCULATION
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "MEMOIZE TAX_CALCULATION",
  "verb": "MEMOIZE",
  "target": "TAX_CALCULATION"
}`,
    python: `from inp_sdk import Step

# Memoização transparente com TTL
flow = Step("MEMOIZE TAX_CALCULATION")
response = client.execute(flow)`
  },
  GUARD: {
    name: 'GUARD',
    category: 'Verbo',
    desc: 'Fail-Fast Invariants: Avalia invariantes críticas e regras de negócio em memória antes de consumir recursos de rede, abortando o fluxo imediatamente se violadas.',
    analogy: 'Como o segurança na porta do banco verificando documento e detector de metal antes de permitir a entrada na agência.',
    preset: 'dsl-advanced',
    dsl: `INTENT "guard_order" {
  REQUIRE {
    GUARD "amount > 0"
  }
  FLOW {
    SEQUENCE {
      GUARD "amount > 0"
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "GUARD amount > 0",
  "verb": "GUARD",
  "target": "amount > 0"
}`,
    python: `from inp_sdk import Step

# Bloqueio preventivo sem overhead de rede
flow = Step("GUARD amount > 0")
response = client.execute(flow)`
  },
  THROTTLE: {
    name: 'THROTTLE',
    category: 'Verbo',
    desc: 'Token Bucket Pacing: Limita e modula a taxa de requisições por segundo contra serviços externos frágeis ou limitados por rate-limits, enfileirando ou contendo picos.',
    analogy: 'Como a catraca de um metrô que controla o fluxo de passageiros para que a plataforma de embarque não transborde.',
    preset: 'dsl-advanced',
    dsl: `INTENT "throttle_legacy" {
  REQUIRE {
    THROTTLE LEGACY_CRM
  }
  FLOW {
    SEQUENCE {
      THROTTLE LEGACY_CRM
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "THROTTLE LEGACY_CRM",
  "verb": "THROTTLE",
  "target": "LEGACY_CRM"
}`,
    python: `from inp_sdk import Step

# Cadência controlada via Token Bucket
flow = Step("THROTTLE LEGACY_CRM")
response = client.execute(flow)`
  },
  BATCH: {
    name: 'BATCH',
    category: 'Verbo',
    desc: 'Chunking Declarativo: Divide automaticamente coleções volumosas em pedaços seguros (chunks) pré-dimensionados, eliminando o problema de sobrecarga N+1.',
    analogy: 'Como empacotar 1.000 caixas de mudança em lotes de 20 por caminhão em vez de levar uma por uma com a mão.',
    preset: 'dsl-advanced',
    dsl: `INTENT "batch_process" {
  REQUIRE {
    BATCH CHUNK_ORDERS
  }
  FLOW {
    SEQUENCE {
      BATCH CHUNK_ORDERS
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "BATCH CHUNK_ORDERS",
  "verb": "BATCH",
  "target": "CHUNK_ORDERS"
}`,
    python: `from inp_sdk import Step

# Processamento fracionado em lotes seguros
flow = Step("BATCH CHUNK_ORDERS")
response = client.execute(flow)`
  },
  DEFER: {
    name: 'DEFER',
    category: 'Verbo',
    desc: 'Transactional Outbox: Desacopla tarefas não-críticas do ciclo síncrono do motor, persistindo a intenção na fila PostgreSQL (queue_jobs) para execução em segundo plano.',
    analogy: 'Como depositar um cheque na caixa de correspondência do banco para compensação noturna, liberando o cliente imediatamente.',
    preset: 'dsl-advanced',
    dsl: `INTENT "defer_email" {
  REQUIRE {
    DEFER EMAIL_NOTIFICATION
  }
  FLOW {
    SEQUENCE {
      DEFER EMAIL_NOTIFICATION
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "DEFER EMAIL_NOTIFICATION",
  "verb": "DEFER",
  "target": "EMAIL_NOTIFICATION"
}`,
    python: `from inp_sdk import Step

# Agendamento assíncrono via Outbox
flow = Step("DEFER EMAIL_NOTIFICATION")
response = client.execute(flow)`
  },
  MERGE: {
    name: 'MERGE',
    category: 'Verbo',
    desc: 'Consolidação Profunda: Combina declarativamente múltiplos fragmentos de dados e saídas de passos anteriores em um único objeto coerente e estruturado.',
    analogy: 'Como montar uma cesta de café da manhã combinando itens de diferentes fornecedores em um pacote único.',
    preset: 'dsl-advanced',
    dsl: `INTENT "merge_profile" {
  REQUIRE {
    MERGE USER_AGGREGATE
  }
  FLOW {
    SEQUENCE {
      MERGE USER_AGGREGATE
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "MERGE USER_AGGREGATE",
  "verb": "MERGE",
  "target": "USER_AGGREGATE"
}`,
    python: `from inp_sdk import Step

# Consolidação profunda de fragmentos
flow = Step("MERGE USER_AGGREGATE")
response = client.execute(flow)`
  },
  AWAIT: {
    name: 'AWAIT',
    category: 'Verbo',
    desc: 'Suspensão Reativa de Saga: Pausa a execução do fluxo e persiste o estado da Saga como SUSPENDED no PostgreSQL, liberando threads e aguardando retoma via webhook ou API.',
    analogy: 'Como colocar um marcador de página num livro e fechar o livro na gaveta até que o correio traga o próximo capítulo.',
    preset: 'dsl-advanced',
    dsl: `INTENT "await_callback" {
  REQUIRE {
    AWAIT PAYMENT_CONFIRMATION
  }
  FLOW {
    SEQUENCE {
      AWAIT PAYMENT_CONFIRMATION
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "AWAIT PAYMENT_CONFIRMATION",
  "verb": "AWAIT",
  "target": "PAYMENT_CONFIRMATION"
}`,
    python: `from inp_sdk import Step

# Suspensão reativa liberando recursos do motor
flow = Step("AWAIT PAYMENT_CONFIRMATION")
response = client.execute(flow)`
  },
  PROBE: {
    name: 'PROBE',
    category: 'Verbo',
    desc: 'Zero-IO Health Check: Consulta em tempo real o status operacional e latência de um microsserviço diretamente da memória do ServiceMetricsCollector (<1ms) sem I/O de disco.',
    analogy: 'Como o médico verificando o pulso do paciente no punho em 2 segundos sem precisar fazer exames laboratoriais demorados.',
    preset: 'dsl-advanced',
    dsl: `INTENT "probe_service" {
  REQUIRE {
    PROBE PAYMENT_GATEWAY
  }
  FLOW {
    SEQUENCE {
      PROBE PAYMENT_GATEWAY
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "PROBE PAYMENT_GATEWAY",
  "verb": "PROBE",
  "target": "PAYMENT_GATEWAY"
}`,
    python: `from inp_sdk import Step

# Inspeção ultrarrápida de saúde em memória
flow = Step("PROBE PAYMENT_GATEWAY")
response = client.execute(flow)`
  },
  SHADOW: {
    name: 'SHADOW',
    category: 'Verbo',
    desc: 'Canary / Dark Launching: Duplica a carga e dispara requisições assíncronas em segundo plano para um novo serviço experimental sem impactar o tempo de resposta do cliente.',
    analogy: 'Como um copiloto novato observando e praticando em simulador espelhado enquanto o piloto oficial conduz o voo de verdade.',
    preset: 'dsl-advanced',
    dsl: `INTENT "shadow_canary" {
  REQUIRE {
    SHADOW CANARY_PAYMENT
  }
  FLOW {
    SEQUENCE {
      SHADOW CANARY_PAYMENT
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "SHADOW CANARY_PAYMENT",
  "verb": "SHADOW",
  "target": "CANARY_PAYMENT"
}`,
    python: `from inp_sdk import Step

# Disparo fire-and-forget para nó sombra
flow = Step("SHADOW CANARY_PAYMENT")
response = client.execute(flow)`
  },
  REDACT: {
    name: 'REDACT',
    category: 'Verbo',
    desc: 'Sanitização de Dados (LGPD/PCI): Substitui campos confidenciais (senhas, cartões, tokens, CPFs) por máscaras irreversíveis antes da persistência em logs ou transmissão.',
    analogy: 'Como usar caneta preta permanente para tarjar dados confidenciais em documentos oficiais antes de torná-los públicos.',
    preset: 'dsl-advanced',
    dsl: `INTENT "redact_secrets" {
  REQUIRE {
    REDACT PASSWORD_TOKEN
  }
  FLOW {
    SEQUENCE {
      REDACT PASSWORD_TOKEN
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "REDACT PASSWORD_TOKEN",
  "verb": "REDACT",
  "target": "PASSWORD_TOKEN"
}`,
    python: `from inp_sdk import Step

# Mascaramento e conformidade LGPD/PCI
flow = Step("REDACT PASSWORD_TOKEN")
response = client.execute(flow)`
  },
  CHECKPOINT: {
    name: 'CHECKPOINT',
    category: 'Verbo',
    desc: 'Savepoint Granular de Saga: Persiste um marco intermediário do estado de execução na base de dados, permitindo recuperação cirúrgica caso falhas ocorram mais adiante.',
    analogy: 'Como salvar o jogo antes de entrar na batalha contra o chefe de fase, para não ter que reiniciar desde a primeira fase.',
    preset: 'dsl-advanced',
    dsl: `INTENT "checkpoint_step" {
  REQUIRE {
    CHECKPOINT STAGE_1_PASSED
  }
  FLOW {
    SEQUENCE {
      CHECKPOINT STAGE_1_PASSED
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "CHECKPOINT STAGE_1_PASSED",
  "verb": "CHECKPOINT",
  "target": "STAGE_1_PASSED"
}`,
    python: `from inp_sdk import Step

# Gravação de savepoint intermediário
flow = Step("CHECKPOINT STAGE_1_PASSED")
response = client.execute(flow)`
  },
  SIMULATE: {
    name: 'SIMULATE',
    category: 'Verbo',
    desc: 'Chaos & Mock Testing: Injeta latência artificial controlada ou falhas programadas para simular degradação de rede e validar a resiliência do sistema em homologação.',
    analogy: 'Como um treino de simulação de incêndio na empresa para garantir que todas as portas e alarmes funcionem sob emergência.',
    preset: 'dsl-advanced',
    dsl: `INTENT "simulate_chaos" {
  REQUIRE {
    SIMULATE LATENCY_200MS
  }
  FLOW {
    SEQUENCE {
      SIMULATE LATENCY_200MS
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "SIMULATE LATENCY_200MS",
  "verb": "SIMULATE",
  "target": "LATENCY_200MS"
}`,
    python: `from inp_sdk import Step

# Injeção de latência controlada e chaos testing
flow = Step("SIMULATE LATENCY_200MS")
response = client.execute(flow)`
  },
  FANOUT: {
    name: 'FANOUT',
    category: 'Verbo',
    desc: 'Bounded Concurrency: Despacha uma carga de trabalho paralela para múltiplos nós com limite estrito de concorrência, impedindo o esgotamento do pool de sockets e da heap.',
    analogy: 'Como abrir 4 guichês de atendimento ao mesmo tempo no banco, garantindo que os clientes sejam atendidos com rapidez sem tumultuar a agência.',
    preset: 'dsl-advanced',
    dsl: `INTENT "fanout_tasks" {
  REQUIRE {
    FANOUT MULTI_NOTIFY
  }
  FLOW {
    SEQUENCE {
      FANOUT MULTI_NOTIFY
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "FANOUT MULTI_NOTIFY",
  "verb": "FANOUT",
  "target": "MULTI_NOTIFY"
}`,
    python: `from inp_sdk import Step

# Paralelismo controlado com contrapressão
flow = Step("FANOUT MULTI_NOTIFY")
response = client.execute(flow)`
  },
  STREAM: {
    name: 'STREAM',
    category: 'Verbo',
    desc: 'Emissão Progressiva em Tempo Real: Despacha deltas, tokens ou chunks de dados através de Server-Sent Events (SSE) ou WebSockets sem travar o motor, viabilizando UIs reativas e IA generativa.',
    analogy: 'Como assistir a um filme por streaming de vídeo em alta resolução enquanto ele é descarregado, em vez de esperar o download de 2 horas antes de dar play.',
    preset: 'dsl-stream',
    dsl: `INTENT "stream_gen_ai" {
  REQUIRE {
    STREAM AI_RESPONSE
  }
  FLOW {
    SEQUENCE {
      STREAM AI_RESPONSE
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "STREAM AI_RESPONSE",
  "verb": "STREAM",
  "target": "AI_RESPONSE"
}`,
    python: `from inp_sdk import Step

# Transmissão de eventos em tempo real via SSE
flow = Step("STREAM AI_RESPONSE")
response = client.execute(flow)`
  },
  ATTEST: {
    name: 'ATTEST',
    category: 'Verbo',
    desc: 'Prova Criptográfica Inviolável: Gera um recibo forense selado com HMAC-SHA256 contendo timestamp, hash dos dados e identificador da execução, garantindo não-repúdio SOC2 e LGPD.',
    analogy: 'Como a chancela em cartório com carimbo em relevo e fita holográfica atestando a autenticidade e inviolabilidade de uma escritura pública.',
    preset: 'dsl-attest',
    dsl: `INTENT "attest_audit" {
  REQUIRE {
    ATTEST EXECUTION_STATE
  }
  FLOW {
    SEQUENCE {
      ATTEST EXECUTION_STATE
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "ATTEST EXECUTION_STATE",
  "verb": "ATTEST",
  "target": "EXECUTION_STATE"
}`,
    python: `from inp_sdk import Step

# Selagem forense com prova HMAC-SHA256
flow = Step("ATTEST EXECUTION_STATE")
response = client.execute(flow)`
  },
  ADAPT: {
    name: 'ADAPT',
    category: 'Verbo',
    desc: 'Roteamento com Multi-Armed Bandit: Algoritmo adaptativo (epsilon-greedy) que seleciona autonomamente o provedor de microsserviço com melhor desempenho real e menor taxa de erros.',
    analogy: 'Como o aplicativo de trânsito (Waze) calculando rotas em tempo real e desviando o motorista de acidentes antes mesmo dele ficar preso no engarrafamento.',
    preset: 'dsl-adapt',
    dsl: `INTENT "adapt_routing" {
  REQUIRE {
    ADAPT PROVIDER_A PROVIDER_B
  }
  FLOW {
    SEQUENCE {
      ADAPT PROVIDER_A PROVIDER_B
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "ADAPT PROVIDER_A PROVIDER_B",
  "verb": "ADAPT",
  "target": "PROVIDER_A PROVIDER_B"
}`,
    python: `from inp_sdk import Step

# Roteamento inteligente adaptativo
flow = Step("ADAPT PROVIDER_A PROVIDER_B")
response = client.execute(flow)`
  },
  ESCALATE: {
    name: 'ESCALATE',
    category: 'Verbo',
    desc: 'Human-in-the-Loop Supervision: Suspende automaticamente a Saga perante transações suspeitas ou de alto valor, gerando um token de aprovação e SLA de tempo para decisão humana.',
    analogy: 'Como o sistema de segurança que bloqueia uma transferência bancária de alto valor e envia notificação imediata para aprovação expressa do gerente de conta.',
    preset: 'dsl-escalate',
    dsl: `INTENT "escalate_transfer" {
  REQUIRE {
    ESCALATE COMPLIANCE_MANAGER
  }
  FLOW {
    SEQUENCE {
      ESCALATE COMPLIANCE_MANAGER
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "ESCALATE COMPLIANCE_MANAGER",
  "verb": "ESCALATE",
  "target": "COMPLIANCE_MANAGER"
}`,
    python: `from inp_sdk import Step

# Suspensão supervisionada com SLA e token
flow = Step("ESCALATE COMPLIANCE_MANAGER")
response = client.execute(flow)`
  },
  REASON: {
    name: 'REASON',
    category: 'Verbo',
    desc: 'Deliberação Racional Estruturada: Executa reflexão agêntica (Chain-of-Thought) avaliando hipóteses, prós e contras e níveis de confiança com fundamentação auditável da decisão.',
    analogy: 'Como um conselho de médicos especialistas deliberando em junta sobre o diagnóstico de um paciente antes de prescrever uma cirurgia.',
    preset: 'dsl-reason',
    dsl: `INTENT "reason_decision" {
  REQUIRE {
    REASON FRAUD_ASSESSMENT
  }
  FLOW {
    SEQUENCE {
      REASON FRAUD_ASSESSMENT
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "REASON FRAUD_ASSESSMENT",
  "verb": "REASON",
  "target": "FRAUD_ASSESSMENT"
}`,
    python: `from inp_sdk import Step

# Deliberação reflexiva estruturada CoT
flow = Step("REASON FRAUD_ASSESSMENT")
response = client.execute(flow)`
  },
  EMBED: {
    name: 'EMBED',
    category: 'Verbo',
    desc: 'Gera representações vetoriais densas normalizadas (L2 = 1.0) de forma 100% determinística e offline a partir de textos e documentos, sem dependência de APIs externas ou tokens pagos.',
    analogy: 'Como extrair as impressões digitais de um texto: converte frases em coordenadas matemáticas precisas em um espaço multidimensional.',
    preset: 'dsl-ai-native',
    dsl: `INTENT "generate_semantic_embedding" {
  REQUIRE {
    EMBED DOCUMENT
  }
  FLOW {
    SEQUENCE {
      EMBED DOCUMENT
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "EMBED DOCUMENT",
  "verb": "EMBED",
  "target": "DOCUMENT"
}`,
    python: `from inp_sdk import Step

# Geração de embedding vetorial denso soberano
flow = Step("EMBED DOCUMENT")
response = client.execute(flow)`
  },
  VECTOR_SEARCH: {
    name: 'VECTOR_SEARCH',
    category: 'Verbo',
    desc: 'Executa busca e ranqueamento semântico por similaridade de cosseno em memória diretamente sobre vetores e candidatos, viabilizando pipelines de RAG instantâneos de baixíssima latência.',
    analogy: 'Como um bibliotecário com memória fotográfica instantânea que localiza os 5 livros com conceitos mais parecidos à sua pergunta em milissegundos.',
    preset: 'dsl-ai-native',
    dsl: `INTENT "semantic_vector_search" {
  REQUIRE {
    VECTOR_SEARCH KNOWLEDGE_BASE
  }
  FLOW {
    SEQUENCE {
      VECTOR_SEARCH KNOWLEDGE_BASE
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "VECTOR_SEARCH KNOWLEDGE_BASE",
  "verb": "VECTOR_SEARCH",
  "target": "KNOWLEDGE_BASE"
}`,
    python: `from inp_sdk import Step

# Busca vetorial semântica instantânea por cosseno
flow = Step("VECTOR_SEARCH KNOWLEDGE_BASE")
response = client.execute(flow)`
  },
  SPLIT: {
    name: 'SPLIT',
    category: 'Verbo',
    desc: 'Distribuição financeira multidirecional e rateio contábil com reconciliação matemática estrita de centavos, assegurando que o somatório de repasses seja rigorosamente idêntico ao total liquidado.',
    analogy: 'Como o garçom fechando a conta de uma mesa dividida entre vários amigos: cada um paga sua parte exata em centavos e a soma bate 100% com a fatura, sem sobrar ou faltar 1 centavo.',
    preset: 'dsl-financial',
    dsl: `INTENT "financial_split_settlement" {
  REQUIRE {
    SPLIT PAYMENT_SETTLEMENT
  }
  FLOW {
    SEQUENCE {
      SPLIT PAYMENT_SETTLEMENT
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "SPLIT PAYMENT_SETTLEMENT",
  "verb": "SPLIT",
  "target": "PAYMENT_SETTLEMENT"
}`,
    python: `from inp_sdk import Step

# Rateio financeiro com reconciliação estrita de centavos
flow = Step("SPLIT PAYMENT_SETTLEMENT")
response = client.execute(flow)`
  },
  ESCROW: {
    name: 'ESCROW',
    category: 'Verbo',
    desc: 'Custódia transacional temporária e segura com selo criptográfico HMAC SHA-256 inviolável, liberação condicional com chave secreta, cancelamento com estorno e expiração temporal controlada (TTL).',
    analogy: 'Como um cofre de custódia notarial: o comprador deposita o dinheiro, o cofre emite um selo lacrado e só abre para o vendedor quando o produto for entregue e verificado.',
    preset: 'dsl-financial',
    dsl: `INTENT "custody_escrow_deposit" {
  REQUIRE {
    ESCROW FUNDS
  }
  FLOW {
    SEQUENCE {
      ESCROW FUNDS
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "ESCROW FUNDS",
  "verb": "ESCROW",
  "target": "FUNDS"
}`,
    python: `from inp_sdk import Step

# Custódia transacional com selo criptográfico HMAC
flow = Step("ESCROW FUNDS")
response = client.execute(flow)`
  },
  POLL: {
    name: 'POLL',
    category: 'Verbo',
    desc: 'Sondagem assíncrona cooperativa não-bloqueante com recuo exponencial (exponential backoff), verificação de predicados e limites máximos de tentativas para reconciliação com sistemas lentos.',
    analogy: 'Como o rastreador de encomenda que verifica o status no centro de distribuição em intervalos crescentes (1s, 2s, 4s) até confirmar que o pacote saiu para entrega.',
    preset: 'dsl-resilience',
    dsl: `INTENT "poll_order_completion" {
  REQUIRE {
    POLL ORDER_STATUS
  }
  FLOW {
    SEQUENCE {
      POLL ORDER_STATUS
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "POLL ORDER_STATUS",
  "verb": "POLL",
  "target": "ORDER_STATUS"
}`,
    python: `from inp_sdk import Step

# Polling assíncrono cooperativo com backoff exponencial
flow = Step("POLL ORDER_STATUS")
response = client.execute(flow)`
  },
  INVALIDATE: {
    name: 'INVALIDATE',
    category: 'Verbo',
    desc: 'Expurgo cirúrgico de entradas de cache por chave direta, padrão com curingas (wildcards) ou tags semânticas transversais, assegurando coerência imediata entre leitura e escrita.',
    analogy: 'Como o administrador de um prédio que apaga imediatamente o quadro de avisos antigo assim que um novo regulamento entra em vigor.',
    preset: 'dsl-cache',
    dsl: `INTENT "cache_eviction" {
  REQUIRE {
    INVALIDATE PRODUCT_CACHE
  }
  FLOW {
    SEQUENCE {
      INVALIDATE PRODUCT_CACHE
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "INVALIDATE PRODUCT_CACHE",
  "verb": "INVALIDATE",
  "target": "PRODUCT_CACHE"
}`,
    python: `from inp_sdk import Step

# Invalidação cirúrgica de cache por tag ou padrão
flow = Step("INVALIDATE PRODUCT_CACHE")
response = client.execute(flow)`
  },
  DRIFT_DETECT: {
    name: 'DRIFT_DETECT',
    category: 'Verbo',
    desc: 'Detecção contínua de desvios estruturais, discrepâncias de tipos e campos inesperados ou faltantes entre cargas úteis dinâmicas e o contrato canônico original.',
    analogy: 'Como um inspetor de qualidade na linha de montagem que compara cada peça com a planta arquitetônica de engenharia e aponta qualquer milímetro fora de especificação.',
    preset: 'dsl-governance',
    dsl: `INTENT "schema_drift_detection" {
  REQUIRE {
    DRIFT_DETECT PAYLOAD_SCHEMA
  }
  FLOW {
    SEQUENCE {
      DRIFT_DETECT PAYLOAD_SCHEMA
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "DRIFT_DETECT PAYLOAD_SCHEMA",
  "verb": "DRIFT_DETECT",
  "target": "PAYLOAD_SCHEMA"
}`,
    python: `from inp_sdk import Step

# Auditoria e detecção contínua de desvio estrutural de schema
flow = Step("DRIFT_DETECT PAYLOAD_SCHEMA")
response = client.execute(flow)`
  },
  CHAOS: {
    name: 'CHAOS',
    category: 'Verbo',
    desc: 'Injeção deliberada e controlada de falhas sintéticas (latência, exceções, interrupções) para auditoria de resiliência e caos contínuo em ambientes de testes e homologação, com salvaguarda estrita contra produção.',
    analogy: 'Como uma simulação de incêndio programada no edifício: dispara alarmes de treino para verificar se os sistemas de emergência e rotas de fuga respondem com perfeição.',
    preset: 'dsl-chaos',
    dsl: `INTENT "chaos_resilience_drill" {
  REQUIRE {
    CHAOS NETWORK_LATENCY
  }
  FLOW {
    SEQUENCE {
      CHAOS NETWORK_LATENCY
    }
  }
}`,
    json: `{
  "type": "STEP",
  "capability": "CHAOS NETWORK_LATENCY",
  "verb": "CHAOS",
  "target": "NETWORK_LATENCY"
}`,
    python: `from inp_sdk import Step

# Injeção controlada de falhas sintéticas e latência
flow = Step("CHAOS NETWORK_LATENCY")
response = client.execute(flow)`
  }
};

// State variables for Dictionary
let dictActiveTerm = 'SEQUENCE';
let dictActiveTab = 'dsl'; // 'dsl', 'json', 'python'
let dictSearchQuery = '';
let dictSelectedCategory = 'all';

// Syntax Highlighter
function highlightCode(code, type) {
  let html = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  if (type === 'dsl') {
    // Comments
    html = html.replace(/(\/\/.*)/g, '<span class="hl-comment">$1</span>');
    // Strings
    html = html.replace(/("[^"]*")/g, '<span class="hl-string">$1</span>');
    // Keywords
    const keywords = ['SEQUENCE', 'PARALLEL', 'CONDITION', 'RETRY', 'TIMEOUT', 'SCOPE', 'DEPENDENCY', 'ENCRYPT', 'DECRYPT', 'INTENT', 'REQUIRE', 'CONTEXT', 'FLOW', 'OUTPUT'];
    keywords.forEach(kw => {
      const regex = new RegExp('\\b(' + kw + ')\\b', 'g');
      html = html.replace(regex, '<span class="hl-keyword">$1</span>');
    });
    // Canonical & Operational Verbs (59 Verbs Highlighted)
    const verbs = [
      'CREATE', 'READ', 'UPDATE', 'DELETE', 'EXECUTE', 'PROCESS',
      'ANALYZE', 'GENERATE', 'TRANSFER', 'VALIDATE', 'AUTHENTICATE', 'AUTHORIZE',
      'NOTIFY', 'SYNC', 'ROUTE', 'COMPOSE', 'FETCH', 'STORE',
      'CALCULATE', 'REFUND', 'CANCEL', 'APPROVE', 'REJECT',
      'CHECK', 'RESERVE', 'RELEASE', 'SEND', 'DISPATCH', 'PUBLISH', 'ARCHIVE', 'AUDIT',
      'COALESCE', 'MEMOIZE', 'GUARD', 'THROTTLE', 'BATCH', 'DEFER', 'MERGE', 'AWAIT',
      'PROBE', 'SHADOW', 'REDACT', 'CHECKPOINT', 'SIMULATE', 'FANOUT',
      'STREAM', 'ATTEST', 'ADAPT', 'ESCALATE', 'REASON',
      'EMBED', 'VECTOR_SEARCH', 'SPLIT', 'ESCROW', 'POLL', 'INVALIDATE', 'DRIFT_DETECT', 'CHAOS'
    ];
    verbs.forEach(vb => {
      const regex = new RegExp('\\b(' + vb + ')\\b', 'g');
      html = html.replace(regex, '<span class="hl-keyword" style="color: var(--secondary); font-weight: 700;">$1</span>');
    });
    // Capabilities
    html = html.replace(/\b(FETCH INVENTORY|EXECUTE PAYMENT|STORE ORDER|NOTIFY USER|VALIDATE USER)\b/g, '<span class="hl-capability">$1</span>');
    // Numbers
    html = html.replace(/\b(\d+)\b/g, '<span class="hl-number">$1</span>');
  } else if (type === 'json') {
    // Keys
    html = html.replace(/(".*?")(\s*:)/g, '<span class="hl-key">$1</span>$2');
    // Strings (values)
    html = html.replace(/(:\s*)(".*?")/g, '$1<span class="hl-string">$2</span>');
    // Numbers
    html = html.replace(/(:\s*)(\d+)/g, '$1<span class="hl-number">$2</span>');
    // Booleans / null
    html = html.replace(/(:\s*)(true|false|null)/g, '$1<span class="hl-bool">$2</span>');
  } else if (type === 'python') {
    // Comments
    html = html.replace(/(#.*)/g, '<span class="hl-comment">$1</span>');
    // Strings
    html = html.replace(/("[^"]*")/g, '<span class="hl-string">$1</span>');
    // Keywords
    const pyKeywords = ['from', 'import', 'print', 'as'];
    pyKeywords.forEach(kw => {
      const regex = new RegExp('\\b(' + kw + ')\\b', 'g');
      html = html.replace(regex, '<span class="hl-keyword">$1</span>');
    });
    // Classes
    const pyClasses = ['Sequence', 'Step', 'Parallel', 'Condition', 'Retry', 'Timeout', 'Scope', 'Dependency', 'Encrypt', 'Decrypt'];
    pyClasses.forEach(cls => {
      const regex = new RegExp('\\b(' + cls + ')\\b', 'g');
      html = html.replace(regex, '<span class="hl-class">$1</span>');
    });
    // Numbers
    html = html.replace(/\b(\d+)\b/g, '<span class="hl-number">$1</span>');
  }
  return html;
}

// Sandbox Translator Data & Engine
const translatorMapping = [
  {
    regex: /(estoque|inventario|inventory|stock|produto|product|item)/i,
    capability: 'FETCH INVENTORY',
    explanation: 'Mapeado para "FETCH INVENTORY": detectou termos relativos a produtos e inventário.'
  },
  {
    regex: /(pagar|pagamento|cobrar|payment|pay|checkout|debito|valor|euro|dollar|preço)/i,
    capability: 'EXECUTE PAYMENT',
    explanation: 'Mapeado para "EXECUTE PAYMENT": detectou intenção de transação financeira ou cobrança.'
  },
  {
    regex: /(salvar|guardar|store|db|banco|pedido|ordem|order|salva)/i,
    capability: 'STORE ORDER',
    explanation: 'Mapeado para "STORE ORDER": identificou gravação ou persistência de pedidos/ordens.'
  },
  {
    regex: /(notificar|email|e-mail|mensagem|sms|avisar|notify|avisa)/i,
    capability: 'NOTIFY USER',
    explanation: 'Mapeado para "NOTIFY USER": detectou o envio de avisos ou mensagens ao usuário.'
  },
  {
    regex: /(validar|checar|verificar usuario|auth|validate|permissao|usuario)/i,
    capability: 'VALIDATE USER',
    explanation: 'Mapeado para "VALIDATE USER": identificou procedimentos de autorização ou autenticação.'
  }
];

function translateNaturalLanguage(text) {
  if (!text || text.trim() === '') {
    return {
      capabilities: [],
      dsl: '// Digite sua intenção ao lado para ver a compilação do fluxo...',
      explanations: ['Aguardando entrada de texto do usuário.']
    };
  }

  const detectedCapabilities = [];
  const explanations = [];

  translatorMapping.forEach(item => {
    if (item.regex.test(text)) {
      detectedCapabilities.push(item.capability);
      explanations.push(item.explanation);
    }
  });

  let dslBody = '';
  if (detectedCapabilities.length === 0) {
    dslBody = '  // Nenhuma capacidade mapeada encontrada. Tente usar termos como "estoque", "pagar", "email".';
  } else {
    dslBody = detectedCapabilities.map(cap => `  ${cap}`).join('\n');
  }

  const hasCondition = /(se\b|caso\b|if\b)/i.test(text);
  let conditionExpr = 'context.inStock';
  if (/(valor|preco|preço|amount)/i.test(text)) {
    conditionExpr = 'context.amount < 500';
  }
  if (hasCondition) {
    dslBody = `  CONDITION "${conditionExpr}" {\n` + 
      detectedCapabilities.map(cap => `    ${cap}`).join('\n') +
      `\n  }`;
    explanations.push(`Inserido bloco "CONDITION \\"${conditionExpr}\\"" devido à condicional ("se").`);
  }

  const retryMatch = text.match(/(tentar|retry|tentativas)\s*(\d+)/i);
  let retryCount = 3;
  if (retryMatch) {
    retryCount = parseInt(retryMatch[2]);
    dslBody = `  RETRY ${retryCount} {\n` + 
      (hasCondition ? `    CONDITION "${conditionExpr}" {\n` + detectedCapabilities.map(cap => `      ${cap}`).join('\n') + `\n    }` : detectedCapabilities.map(cap => `    ${cap}`).join('\n')) +
      `\n  }`;
    explanations.push(`Política de tentativas configurada ("RETRY ${retryCount}") baseada no texto.`);
  } else if (/(tentar|retry|re-executar|novamente)/i.test(text)) {
    dslBody = `  RETRY ${retryCount} {\n` + 
      (hasCondition ? `    CONDITION "${conditionExpr}" {\n` + detectedCapabilities.map(cap => `      ${cap}`).join('\n') + `\n    }` : detectedCapabilities.map(cap => `    ${cap}`).join('\n')) +
      `\n  }`;
    explanations.push(`Inserida política "RETRY ${retryCount}" devido a termos de tentativa/reinicialização.`);
  }

  const timeoutMatch = text.match(/(timeout|limite de tempo|segundos|ms)\s*(\d+)/i);
  let timeoutVal = 3000;
  if (timeoutMatch) {
    const num = parseInt(timeoutMatch[2]);
    timeoutVal = num < 100 ? num * 1000 : num;
    dslBody = `  TIMEOUT ${timeoutVal} {\n` + 
      (retryMatch || /(tentar|retry)/i.test(text) ? `    RETRY ${retryCount} {\n` + (hasCondition ? `      CONDITION "${conditionExpr}" {\n` + detectedCapabilities.map(cap => `        ${cap}`).join('\n') + `\n      }` : `      ` + detectedCapabilities.map(cap => `  ` + cap).join('\n')) + `\n    }` : detectedCapabilities.map(cap => `    ${cap}`).join('\n')) +
      `\n  }`;
    explanations.push(`Envolvido com bloco "TIMEOUT ${timeoutVal}ms" a partir de indicadores de limite de tempo.`);
  }

  let finalDsl = `SEQUENCE {\n${dslBody}\n}`;
  explanations.unshift('Estrutura principal envolvida em "SEQUENCE" sequencial.');

  return {
    capabilities: detectedCapabilities,
    dsl: finalDsl,
    explanations: explanations
  };
}

// Renderers
function renderDictionarySidebar() {
  const sidebar = document.getElementById('dict-sidebar-list');
  if (!sidebar) return;

  sidebar.innerHTML = '';
  
  Object.keys(DICTIONARY_TERMS).forEach(key => {
    const term = DICTIONARY_TERMS[key];
    
    // Search match
    const matchesSearch = term.name.toLowerCase().includes(dictSearchQuery.toLowerCase()) || 
                          term.desc.toLowerCase().includes(dictSearchQuery.toLowerCase());
    
    // Category match
    const matchesCategory = dictSelectedCategory === 'all' || term.category === dictSelectedCategory;

    if (matchesSearch && matchesCategory) {
      const item = document.createElement('div');
      item.className = `dict-sidebar-item${dictActiveTerm === key ? ' active' : ''}`;
      
      const badgeClass = term.category === 'Segurança' ? 'type-security' : (term.category === 'Verbo' ? 'type-verb' : 'type-flow');
      
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
          <span style="font-family: 'Fira Code', monospace; font-size: 13px; font-weight: 700; color: var(--text);">${term.name}</span>
          <span class="dict-type-badge ${badgeClass}">${term.category}</span>
        </div>
        <p style="font-size: 11.5px; color: var(--text-muted); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${term.desc}</p>
      `;

      item.addEventListener('click', () => {
        dictActiveTerm = key;
        renderDictionarySidebar();
        renderDictionaryDetail();
      });

      sidebar.appendChild(item);
    }
  });
}

function renderDictionaryDetail() {
  const detailPanel = document.getElementById('dict-detail-content');
  if (!detailPanel) return;

  const term = DICTIONARY_TERMS[dictActiveTerm];
  if (!term) {
    detailPanel.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 40px;">Selecione um termo para explorar...</div>';
    return;
  }

  const badgeClass = term.category === 'Segurança' ? 'type-security' : (term.category === 'Verbo' ? 'type-verb' : 'type-flow');
  const activeCodeContent = term[dictActiveTab];
  const highlighted = highlightCode(activeCodeContent, dictActiveTab);

  detailPanel.innerHTML = `
    <div class="dict-detail-header">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <h2 style="font-family: 'Fira Code', monospace; font-size: 22px; font-weight: 800; color: var(--text); margin: 0;">${term.name}</h2>
        <span class="dict-type-badge ${badgeClass}" style="font-size: 10px; padding: 3px 8px;">${term.category}</span>
      </div>
      <p style="font-size: 14.5px; color: var(--text-muted); line-height: 1.5; margin-bottom: 20px;">${term.desc}</p>
    </div>

    <div class="dict-analogy-box">
      <div style="display: flex; gap: 10px; align-items: flex-start;">
        <span style="font-size: 20px; line-height: 1;">💡</span>
        <div>
          <h4 style="font-size: 13px; font-weight: 700; color: var(--primary-light); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Analogia com o Mundo Real</h4>
          <p style="font-size: 13px; color: var(--text); line-height: 1.45; margin: 0;">${term.analogy}</p>
        </div>
      </div>
    </div>

    <div class="dict-code-hub">
      <div class="dict-code-header">
        <div class="dict-code-tabs">
          <button class="dict-tab-btn${dictActiveTab === 'dsl' ? ' active' : ''}" data-tab="dsl">DSL Syntax</button>
          <button class="dict-tab-btn${dictActiveTab === 'json' ? ' active' : ''}" data-tab="json">AST Compilado (JSON)</button>
          <button class="dict-tab-btn${dictActiveTab === 'python' ? ' active' : ''}" data-tab="python">Python SDK</button>
        </div>
        <div class="dict-code-actions">
          <button class="dict-code-action-btn" id="dict-copy-btn">
            <svg style="width: 13px; height: 13px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 7V5a2 2 0 012-2h9a2 2 0 012 2v10a2 2 0 01-2 2h-2M8 7H5a2 2 0 00-2 2v10a2 2 0 002 2h9a2 2 0 002-2v-3M8 7v4a2 2 0 002 2h4" stroke-linecap="round" stroke-linejoin="round"></path></svg>
            Copiar
          </button>
          <button class="dict-code-action-btn run-btn" id="dict-try-btn">
            🚀 Testar
          </button>
        </div>
      </div>
      <pre class="dict-pre-explorer"><code class="fira-code">${highlighted}</code></pre>
    </div>
  `;

  // Bind tab toggles
  detailPanel.querySelectorAll('.dict-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      dictActiveTab = btn.getAttribute('data-tab');
      renderDictionaryDetail();
    });
  });

  // Bind copy button
  const copyBtn = detailPanel.querySelector('#dict-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      copySnippet(activeCodeContent);
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = `✓ Copiado`;
      setTimeout(() => { copyBtn.innerHTML = originalText; }, 2000);
    });
  }

  // Bind try button
  const tryBtn = detailPanel.querySelector('#dict-try-btn');
  if (tryBtn) {
    tryBtn.addEventListener('click', () => {
      trySnippet(term.preset);
    });
  }
}

function updateSandboxTranslation() {
  const inputEl = document.getElementById('sandbox-input');
  const capContainer = document.getElementById('sandbox-capabilities');
  const dslOutput = document.getElementById('sandbox-dsl-output');
  const explContainer = document.getElementById('sandbox-explanations');

  if (!inputEl) return;

  const text = inputEl.value;
  const result = translateNaturalLanguage(text);

  // Render capabilities
  if (capContainer) {
    capContainer.innerHTML = '';
    if (result.capabilities.length === 0) {
      capContainer.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">Nenhuma capacidade inferida</span>';
    } else {
      result.capabilities.forEach(cap => {
        const pill = document.createElement('span');
        pill.className = 'cap-pill';
        pill.textContent = cap;
        capContainer.appendChild(pill);
      });
    }
  }

  // Render DSL
  if (dslOutput) {
    dslOutput.innerHTML = highlightCode(result.dsl, 'dsl');
  }

  // Render Explanations
  if (explContainer) {
    explContainer.innerHTML = '';
    result.explanations.forEach(expl => {
      const li = document.createElement('li');
      li.style.fontSize = '12.5px';
      li.style.color = 'var(--text-muted)';
      li.style.marginBottom = '4px';
      li.innerHTML = `• ${expl}`;
      explContainer.appendChild(li);
    });
  }
}

function initDictionary() {
  // Bind search input
  const searchInput = document.getElementById('dict-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      dictSearchQuery = e.target.value;
      renderDictionarySidebar();
    });
  }

  // Bind category filters
  document.querySelectorAll('.dict-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dict-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      dictSelectedCategory = btn.getAttribute('data-category');
      renderDictionarySidebar();
    });
  });

  // Bind Sandbox inputs
  const sandboxInput = document.getElementById('sandbox-input');
  if (sandboxInput) {
    sandboxInput.addEventListener('input', updateSandboxTranslation);
  }

  // Bind Sandbox suggestions
  document.querySelectorAll('.suggestion-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      if (sandboxInput) {
        sandboxInput.value = pill.getAttribute('data-text');
        updateSandboxTranslation();
      }
    });
  });

  // Bind Sandbox copy
  const sandboxCopyBtn = document.getElementById('sandbox-copy-dsl');
  if (sandboxCopyBtn) {
    sandboxCopyBtn.addEventListener('click', () => {
      const dslOutput = document.getElementById('sandbox-dsl-output');
      if (dslOutput) {
        copySnippet(dslOutput.textContent);
        const originalText = sandboxCopyBtn.innerHTML;
        sandboxCopyBtn.innerHTML = `✓ Copiado`;
        setTimeout(() => { sandboxCopyBtn.innerHTML = originalText; }, 2000);
      }
    });
  }

  // Bind Sandbox execute playground
  const sandboxPlayBtn = document.getElementById('sandbox-btn-playground');
  if (sandboxPlayBtn) {
    sandboxPlayBtn.addEventListener('click', () => {
      const dslOutput = document.getElementById('sandbox-dsl-output');
      if (dslOutput) {
        const generatedDsl = dslOutput.textContent;
        // Inject into playground code input
        const playCode = document.getElementById('playground-code');
        const playType = document.getElementById('playground-type');
        if (playCode && playType) {
          playCode.value = generatedDsl;
          playType.value = 'dsl';
          // Trigger change updates
          updateLineNumbers();
          updateFlowPreview();
        }
        // Switch tab
        switchTab(null, 'tab-playground');
      }
    });
  }

  // Initial draw
  renderDictionarySidebar();
  renderDictionaryDetail();
  updateSandboxTranslation();
}

// Integration Codes Database for the Microservices Tab
const INTEGRATION_CODES = {
  python: {
    singleRegister: `from inp_sdk import INPClient, Service

# Inicializa o cliente do gateway INP
client = INPClient("http://localhost:3000")

# Declara o microsserviço de Pagamento
payment_service = Service(
    name="secure-payment-service",
    endpoint="http://localhost:3001/api/pay",
    capabilities=["EXECUTE PAYMENT"]
)

# Registra a capacidade no catálogo do Gateway
client.register_service(payment_service)
print("Microsserviço de Pagamento registrado com sucesso!")`,
    singleClient: `from inp_sdk import INPClient

client = INPClient("http://localhost:3000")

# Executa uma transação de forma declarativa e direta
response = client.execute_capability(
    capability="EXECUTE PAYMENT",
    payload={"amount": 250.75, "currency": "EUR"}
)

print(f"Status da Cobrança: {response['status']}")
# Output: Status da Cobrança: approved`,
    sequence: `from inp_sdk import INPClient, Sequence, Step

client = INPClient("http://localhost:3000")

# Orquestração Linear: Checa o estoque ANTES de processar o pagamento
flow = Sequence([
    Step("FETCH INVENTORY", payload={"product_id": "P10"}),
    Step("EXECUTE PAYMENT", payload={"amount": 450.00})
])

response = client.execute(flow)
print("Fluxo finalizado com sucesso!", response.context)`,
    parallel: `from inp_sdk import INPClient, Parallel, Step

client = INPClient("http://localhost:3000")

# Orquestração Concorrente: Dispara estoque e cadastro em paralelo
flow = Parallel([
    Step("FETCH INVENTORY", payload={"product_id": "A1"}),
    Step("VALIDATE USER", payload={"user_id": "usr_99"})
])

response = client.execute(flow)
print("Resultados consolidados:", response.results)`,
    resilience: `from inp_sdk import INPClient, Retry, Timeout, Step

client = INPClient("http://localhost:3000")

# Orquestração com Garantia de Resiliência nativa
flow = Timeout(
    milliseconds=3000,
    steps=[
        Retry(
            attempts=3,
            steps=[Step("EXECUTE PAYMENT", payload={"amount": 100.00})]
        )
    ]
)

response = client.execute(flow)`
  },
  node: {
    singleRegister: `const { INPClient, Service } = require('inp-sdk');

// Inicializa o cliente do gateway INP
const client = new INPClient("http://localhost:3000");

// Declara o microsserviço de Pagamento
const paymentService = new Service({
  name: "secure-payment-service",
  endpoint: "http://localhost:3001/api/pay",
  capabilities: ["EXECUTE PAYMENT"]
});

// Registra a capacidade no catálogo do Gateway
client.registerService(paymentService)
  .then(() => console.log("Microsserviço registrado!"))
  .catch(err => console.error("Falha no registro:", err));`,
    singleClient: `const { INPClient } = require('inp-sdk');
const client = new INPClient("http://localhost:3000");

// Executa uma transação de forma declarativa e direta
client.executeCapability("EXECUTE PAYMENT", { amount: 250.75, currency: "EUR" })
  .then(response => {
    console.log(\`Status da Cobrança: \${response.status}\`);
    // Output: Status da Cobrança: approved
  });`,
    sequence: `const { INPClient, Sequence, Step } = require('inp-sdk');
const client = new INPClient("http://localhost:3000");

// Orquestração Linear: Checa o estoque ANTES de processar o pagamento
const flow = new Sequence([
  new Step("FETCH INVENTORY", { product_id: "P10" }),
  new Step("EXECUTE PAYMENT", { amount: 450.00 })
]);

client.execute(flow).then(response => {
  console.log("Fluxo finalizado com sucesso!", response.context);
});`,
    parallel: `const { INPClient, Parallel, Step } = require('inp-sdk');
const client = new INPClient("http://localhost:3000");

// Orquestração Concorrente: Dispara estoque e cadastro em paralelo
const flow = new Parallel([
  new Step("FETCH INVENTORY", { product_id: "A1" }),
  new Step("VALIDATE USER", { user_id: "usr_99" })
]);

client.execute(flow).then(response => {
  console.log("Resultados consolidados:", response.results);
});`,
    resilience: `const { INPClient, Retry, Timeout, Step } = require('inp-sdk');
const client = new INPClient("http://localhost:3000");

// Orquestração com Garantia de Resiliência nativa
const flow = new Timeout({
  milliseconds: 3000,
  steps: [
    new Retry({
      attempts: 3,
      steps: [new Step("EXECUTE PAYMENT", { amount: 100.00 })]
    })
  ]
});

client.execute(flow).then(response => {
  console.log("Transação resiliente concluída!");
});`
  },
  curl: {
    singleRegister: `# Registra o Microsserviço de Pagamento no catálogo de APIs do Gateway
curl -X POST http://localhost:3000/api/services/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "secure-payment-service",
    "endpoint": "http://localhost:3001/api/pay",
    "capabilities": ["EXECUTE PAYMENT"]
  }'`,
    singleClient: `# Executa diretamente uma capacidade informando o payload
curl -X POST http://localhost:3000/api/gateway/execute \\
  -H "Content-Type: application/json" \\
  -d '{
    "capability": "EXECUTE PAYMENT",
    "context": { "amount": 250.75, "currency": "EUR" }
  }'`,
    sequence: `# Executa o fluxo de Orquestração Linear enviando a DSL para compilação
curl -X POST http://localhost:3000/api/gateway/intent \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "dsl",
    "code": "SEQUENCE { FETCH INVENTORY EXECUTE PAYMENT }",
    "context": { "product_id": "P10", "amount": 450.00 }
  }'`,
    parallel: `# Executa o fluxo de Orquestração Concorrente via API
curl -X POST http://localhost:3000/api/gateway/intent \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "dsl",
    "code": "PARALLEL { FETCH INVENTORY VALIDATE USER }",
    "context": { "product_id": "A1", "user_id": "usr_99" }
  }'`,
    resilience: `# Executa o fluxo contendo Timeout de 3s e até 3 tentativas automáticas
curl -X POST http://localhost:3000/api/gateway/intent \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "dsl",
    "code": "TIMEOUT 3000 { RETRY 3 { EXECUTE PAYMENT } }",
    "context": { "amount": 100.00 }
  }'`
  }
};

// State variables for Microservices Tab
let microActiveLang = 'python';
let microActiveOrchType = 'sequence'; // 'sequence', 'parallel', 'resilience'
let singleSimTimeoutId = null;
let multiSimTimeoutId = null;

function renderMicroservicesTab() {
  const registerCodeEl = document.getElementById('micro-code-register');
  const clientCodeEl = document.getElementById('micro-code-client');
  const orchCodeEl = document.getElementById('micro-code-orch');

  const langData = INTEGRATION_CODES[microActiveLang];
  if (!langData) return;

  // Render Single Service Codes
  if (registerCodeEl) {
    registerCodeEl.innerHTML = highlightCode(langData.singleRegister, microActiveLang === 'curl' ? 'dsl' : microActiveLang);
  }
  if (clientCodeEl) {
    clientCodeEl.innerHTML = highlightCode(langData.singleClient, microActiveLang === 'curl' ? 'dsl' : microActiveLang);
  }

  // Render Orchestration Code
  if (orchCodeEl) {
    const activeOrchCode = langData[microActiveOrchType];
    orchCodeEl.innerHTML = highlightCode(activeOrchCode, microActiveLang === 'curl' ? 'dsl' : microActiveLang);
  }
}

function runSingleServiceSimulation() {
  const consoleEl = document.getElementById('single-console-logs');
  if (!consoleEl) return;

  // Clear previous timeout and logs
  if (singleSimTimeoutId) clearTimeout(singleSimTimeoutId);
  consoleEl.innerHTML = '';

  const logs = [
    { delay: 0, text: '🕒 [12:00:00.000] [CLIENT] Enviando requisição para capacidade "EXECUTE PAYMENT"...' },
    { delay: 500, text: '⚙️ [12:00:00.500] [GATEWAY] Requisição recebida pelo Gateway Principal (Porta 3000).' },
    { delay: 1000, text: '🔍 [12:00:01.000] [GATEWAY] Buscando microsserviços ativos expondo a capacidade "EXECUTE PAYMENT"...' },
    { delay: 1500, text: '✅ [12:00:01.500] [GATEWAY] Serviço encontrado: "secure-payment-service" atalhado em http://localhost:3001' },
    { delay: 2000, text: '➡️ [12:00:02.000] [GATEWAY] Direcionando payload para http://localhost:3001/api/pay...' },
    { delay: 2500, text: '💰 [12:00:02.500] [MICROSSERVIÇO: PAYMENT] Recebido payload: { amount: 250.75, currency: "EUR" }' },
    { delay: 2900, text: '⚡ [12:00:02.900] [MICROSSERVIÇO: PAYMENT] Transação processada e aprovada. ID: txn_1781352366979' },
    { delay: 3400, text: '↩️ [12:00:03.400] [GATEWAY] Consolidando resposta do microsserviço e retornando ao cliente...' },
    { delay: 3900, text: '🎉 [12:00:03.900] [CLIENT] Resposta recebida com sucesso! { success: true, status: "approved" } (Tempo Total: 3.9s, HTTP 200)' }
  ];

  let currentLogIdx = 0;
  function addNextLog() {
    if (currentLogIdx < logs.length) {
      const log = logs[currentLogIdx];
      const p = document.createElement('p');
      p.className = 'console-log-line';
      p.textContent = log.text;
      
      // Color coding
      if (log.text.includes('[CLIENT]')) p.style.color = '#38bdf8';
      else if (log.text.includes('[GATEWAY]')) p.style.color = '#c084fc';
      else if (log.text.includes('[MICROSSERVIÇO:')) p.style.color = '#4ec9b0';
      
      consoleEl.appendChild(p);
      consoleEl.scrollTop = consoleEl.scrollHeight;

      currentLogIdx++;
      if (currentLogIdx < logs.length) {
        singleSimTimeoutId = setTimeout(addNextLog, logs[currentLogIdx].delay - log.delay);
      }
    }
  }

  addNextLog();
}

function runMultipleServiceSimulation() {
  const consoleEl = document.getElementById('multi-console-logs');
  if (!consoleEl) return;

  // Clear previous timeout and logs
  if (multiSimTimeoutId) clearTimeout(multiSimTimeoutId);
  consoleEl.innerHTML = '';

  let logs = [];

  if (microActiveOrchType === 'sequence') {
    logs = [
      { delay: 0, text: '🕒 [12:00:00.000] [CLIENT] Enviando requisição de fluxo SEQUENCE { FETCH INVENTORY, EXECUTE PAYMENT }...' },
      { delay: 400, text: '⚙️ [12:00:00.400] [GATEWAY] Compilando grafo DSL para orquestração sequencial linear...' },
      { delay: 800, text: '🚀 [12:00:00.800] [GATEWAY] Iniciando execução do Passo 1: "FETCH INVENTORY"...' },
      { delay: 1200, text: '📦 [12:00:01.200] [MICROSSERVIÇO: INVENTORY] Consultando estoque para o ID "P10"...' },
      { delay: 1500, text: '✅ [12:00:01.500] [MICROSSERVIÇO: INVENTORY] Item em estoque (Quantidade disponível: 12 unidades).' },
      { delay: 1900, text: '⚙️ [12:00:01.900] [GATEWAY] Passo 1 concluído. Injetando dados de estoque no contexto transacional.' },
      { delay: 2300, text: '🚀 [12:00:02.300] [GATEWAY] Iniciando execução do Passo 2: "EXECUTE PAYMENT" com valor de 450.00 EUR...' },
      { delay: 2800, text: '💰 [12:00:02.800] [MICROSSERVIÇO: PAYMENT] Processando cobrança segura...' },
      { delay: 3100, text: '✅ [12:00:03.100] [MICROSSERVIÇO: PAYMENT] Cobrança efetuada com sucesso.' },
      { delay: 3500, text: '⚙️ [12:00:03.500] [GATEWAY] Grafo de execução concluído sem erros. Unificando contextos...' },
      { delay: 3900, text: '🎉 [12:00:03.900] [CLIENT] Fluxo finalizado! Resposta: { success: true, stock_checked: true, status: "approved" } (Latência: 3.9s)' }
    ];
  } else if (microActiveOrchType === 'parallel') {
    logs = [
      { delay: 0, text: '🕒 [12:00:00.000] [CLIENT] Enviando requisição de fluxo PARALLEL { FETCH INVENTORY, VALIDATE USER }...' },
      { delay: 400, text: '⚙️ [12:00:00.400] [GATEWAY] Compilando grafo DSL para processamento paralelo concorrente...' },
      { delay: 800, text: '⚡ [12:00:00.800] [GATEWAY] Disparando múltiplas capacidades simultaneamente via Promise.all...' },
      { delay: 1100, text: '➡️ [12:00:01.100] [GATEWAY] -> Iniciando chamada paralela: "FETCH INVENTORY" para InventoryService' },
      { delay: 1200, text: '➡️ [12:00:01.200] [GATEWAY] -> Iniciando chamada paralela: "VALIDATE USER" para UserService' },
      { delay: 1800, text: '👤 [12:00:01.800] [MICROSSERVIÇO: USER] Usuário "usr_99" verificado (Nível: Gold, Sem pendências).' },
      { delay: 2300, text: '📦 [12:00:02.300] [MICROSSERVIÇO: INVENTORY] Produto "A1" disponível em estoque (Quantidade: 84).' },
      { delay: 2700, text: '⚙️ [12:00:02.700] [GATEWAY] Todas as promessas concorrentes foram resolvidas com sucesso.' },
      { delay: 3200, text: '⚙️ [12:00:03.200] [GATEWAY] Consolidando resultados das ramificações paralelas no contexto global...' },
      { delay: 3700, text: '🎉 [12:00:03.700] [CLIENT] Resposta em lote consolidada: [ { inventory: "available" }, { user: "valid" } ] (Tempo total: 3.7s)' }
    ];
  } else {
    logs = [
      { delay: 0, text: '🕒 [12:00:00.000] [CLIENT] Enviando fluxo TIMEOUT 3000 { RETRY 3 { EXECUTE PAYMENT } }...' },
      { delay: 400, text: '🛡️ [12:00:00.400] [GATEWAY] Inicializando guardas de resiliência. Timeout máximo tolerado: 3000ms.' },
      { delay: 800, text: '🚀 [12:00:00.800] [GATEWAY] Tentativa 1/3: Iniciando chamada de "EXECUTE PAYMENT"...' },
      { delay: 1300, text: '⚠️ [12:00:01.300] [GATEWAY] [ERRO] Falha de comunicação na tentativa 1: Connection Timeout (ETIMEDOUT).' },
      { delay: 1700, text: '🔄 [12:00:01.700] [GATEWAY] Aplicando política de Retry. Aguardando recuo de 500ms...' },
      { delay: 2200, text: '🚀 [12:00:02.200] [GATEWAY] Tentativa 2/3: Re-executando chamada de "EXECUTE PAYMENT"...' },
      { delay: 2600, text: '💰 [12:00:02.600] [MICROSSERVIÇO: PAYMENT] Conexão restabelecida. Cobrança de 100.00 EUR efetuada.' },
      { delay: 3000, text: '✅ [12:00:03.000] [GATEWAY] Sucesso na tentativa 2! Cancelando tentativas subsequentes...' },
      { delay: 3400, text: '🎉 [12:00:03.400] [CLIENT] Resposta resiliente concluída dentro dos limites! { success: true, status: "approved" } (Latência: 3.4s)' }
    ];
  }

  let currentLogIdx = 0;
  function addNextLog() {
    if (currentLogIdx < logs.length) {
      const log = logs[currentLogIdx];
      const p = document.createElement('p');
      p.className = 'console-log-line';
      p.textContent = log.text;
      
      // Color coding
      if (log.text.includes('[CLIENT]')) p.style.color = '#38bdf8';
      else if (log.text.includes('[GATEWAY]')) p.style.color = '#c084fc';
      else if (log.text.includes('[MICROSSERVIÇO:')) p.style.color = '#4ec9b0';
      else if (log.text.includes('[ERRO]')) p.style.color = '#f43f5e';
      else if (log.text.includes('Retry')) p.style.color = '#fbbf24';
      
      consoleEl.appendChild(p);
      consoleEl.scrollTop = consoleEl.scrollHeight;

      currentLogIdx++;
      if (currentLogIdx < logs.length) {
        multiSimTimeoutId = setTimeout(addNextLog, logs[currentLogIdx].delay - log.delay);
      }
    }
  }

  addNextLog();
}

function initMicroservicesTab() {
  // Bind Language Selector Buttons
  document.querySelectorAll('.integration-lang-selector .lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.integration-lang-selector .lang-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      microActiveLang = btn.getAttribute('data-lang');
      renderMicroservicesTab();
    });
  });

  // Bind Orchestration Type Buttons
  document.querySelectorAll('.orch-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.orch-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      microActiveOrchType = btn.getAttribute('data-orch');
      renderMicroservicesTab();
    });
  });

  // Bind Simulator buttons
  const runSingleBtn = document.getElementById('btn-run-single-sim');
  if (runSingleBtn) {
    runSingleBtn.addEventListener('click', runSingleServiceSimulation);
  }

  const runMultiBtn = document.getElementById('btn-run-multi-sim');
  if (runMultiBtn) {
    runMultiBtn.addEventListener('click', runMultipleServiceSimulation);
  }

  // Initial render
  renderMicroservicesTab();
}

// Set up DOM interaction and event handling after DOMContentLoaded / readyState check
function init() {
  const playgroundCode = document.getElementById('playground-code');
  const playgroundType = document.getElementById('playground-type');
  
  if (playgroundCode) {
    playgroundCode.addEventListener('input', () => {
      updateLineNumbers();
      updateFlowPreview();
    });
    
    const gutter = document.getElementById('editor-line-numbers');
    playgroundCode.addEventListener('scroll', () => {
      if (gutter) {
        gutter.scrollTop = playgroundCode.scrollTop;
      }
    });
    
    if (gutter) {
      gutter.addEventListener('wheel', (e) => {
        playgroundCode.scrollTop += e.deltaY;
        e.preventDefault();
      });
    }
  }
  
  if (playgroundType) {
    playgroundType.addEventListener('change', (e) => {
      const isDsl = e.target.value === 'dsl';
      const indicator = document.getElementById('editor-lang-indicator');
      if (indicator) {
        indicator.innerText = isDsl ? 'INP DSL' : 'Linguagem Humana';
      }
      updateFlowPreview();
    });
  }

  // Bind navigation tabs and elements
  document.querySelectorAll('[data-tab]').forEach(el => {
    el.addEventListener('click', (e) => {
      const tabId = el.getAttribute('data-tab');
      switchTab(e, tabId);
    });
  });

  // Initialize Theme, Navbar and Marketing Nav Links
  initTheme();
  initNavbarInteractions();
  initMarketingNav();

  // Setup visual builder and syntax lab inside Guia DSL
  initSubTabSwitching();
  initConceptExplorer();
  initSyntaxLabChallenges();
  
  const builderInputs = [
    'builder-intent-name', 'builder-amount', 'builder-user-id',
    'builder-token', 'builder-flow-type', 'builder-flow-action',
    'builder-zk-toggle', 'builder-resilience-toggle', 'builder-verify-toggle', 'builder-fallback-toggle',
    'builder-timeout-val', 'builder-retry-val', 'builder-verify-val', 'builder-fallback-val'
  ];
  builderInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateBuilderLiveDSL);
      el.addEventListener('change', updateBuilderLiveDSL);
    }
  });
  updateBuilderLiveDSL();

  const btnSendBuilder = document.getElementById('btn-send-builder-to-play');
  if (btnSendBuilder) {
    btnSendBuilder.addEventListener('click', () => {
      const code = btnSendBuilder.getAttribute('data-dsl-code');
      const playgroundCode = document.getElementById('playground-code');
      const playgroundType = document.getElementById('playground-type');
      if (playgroundCode && code) {
        playgroundCode.value = code;
        if (playgroundType) {
          playgroundType.value = 'dsl';
          const indicator = document.getElementById('editor-lang-indicator');
          if (indicator) indicator.innerText = 'INP DSL';
        }
        updateLineNumbers();
        updateFlowPreview();
        
        // Switch tab to Playground
        switchTab(null, 'tab-playground');
        
        // Scroll playground into view
        const targetSection = document.getElementById('tab-playground');
        if (targetSection) {
          targetSection.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  }

  // Bind preset changes
  const selectPresets = document.getElementById('playground-presets');
  if (selectPresets) {
    selectPresets.addEventListener('change', loadPlaygroundPreset);
  }

  // Bind execution trigger
  const btnRun = document.getElementById('btn-run-intent');
  if (btnRun) {
    btnRun.addEventListener('click', runPlaygroundIntent);
  }

  // Bind downloads
  const btnPostman = document.getElementById('btn-download-postman');
  if (btnPostman) {
    btnPostman.addEventListener('click', downloadPostmanCollection);
  }
  const btnSdk = document.getElementById('btn-download-sdk');
  if (btnSdk) {
    btnSdk.addEventListener('click', downloadNodeSDK);
  }

  // Bind copy snippet buttons
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const snippet = btn.getAttribute('data-snippet');
      copySnippet(snippet, btn);
    });
  });

  // Bind try snippet buttons
  document.querySelectorAll('.btn-try').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      trySnippet(preset);
    });
  });

  // Bind FAQ accordion click toggles
  document.querySelectorAll('.faq-card').forEach(card => {
    card.addEventListener('click', () => {
      toggleFaqAccordion(card);
    });
  });

  // Bind timeline toggle details via event delegation
  const timeline = document.getElementById('play-timeline');
  if (timeline) {
    timeline.addEventListener('click', (e) => {
      let target = e.target;
      while (target && target !== timeline) {
        if (target.hasAttribute('data-toggle-target')) {
          const stepId = target.getAttribute('data-toggle-target');
          toggleDetails(stepId);
          break;
        }
        target = target.parentElement;
      }
    });
  }

  // Bind toggle service and chaos simulation click delegation (Consola de Governança / Admin)
  document.addEventListener('click', async (e) => {
    // 1. Alternar Ativo/Inativo de Microsserviço
    const toggleBtn = e.target.closest('.btn-toggle-service');
    if (toggleBtn) {
      const serviceId = toggleBtn.getAttribute('data-service-id');
      try {
        const res = await authFetch(`/api/services/${encodeURIComponent(serviceId)}/toggle-active`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast(`Estado do microsserviço "${serviceId}" alternado com sucesso!`, 'success');
          if (typeof loadAdminServiceControls === 'function') loadAdminServiceControls();
          if (typeof loadActiveServices === 'function') loadActiveServices();
          if (typeof loadHomeStats === 'function') loadHomeStats();
        } else {
          showToast(data.error || 'Falha ao alterar estado do serviço.', 'error');
        }
      } catch (err) {
        showToast('Erro de rede ou permissão ao alterar serviço.', 'error');
        console.error('Toggle service failed:', err);
      }
      return;
    }

    // 2. Injeção de Falhas / Engenharia de Caos
    const chaosBtn = e.target.closest('.chaos-btn');
    if (chaosBtn) {
      const serviceId = chaosBtn.getAttribute('data-service-id');
      const state = chaosBtn.getAttribute('data-chaos-state');
      try {
        const res = await authFetch('/api/chaos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceId, state })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`Simulador de Caos: Modo ${state} aplicado a "${serviceId}".`, 'warning');
          if (typeof loadAdminServiceControls === 'function') loadAdminServiceControls();
          if (typeof loadActiveServices === 'function') loadActiveServices();
        } else {
          showToast(data.error || 'Falha ao aplicar injeção de caos.', 'error');
        }
      } catch (err) {
        showToast('Erro de rede ou permissão ao injetar falha.', 'error');
        console.error('Chaos update failed:', err);
      }
      return;
    }
  });

  // Scroll highlights for Sidebar in Docs
  const sections = document.querySelectorAll('.docs-sec');
  const navItems = document.querySelectorAll('.docs-nav-item');

  window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      if (window.pageYOffset >= (sectionTop - 150)) {
        current = section.getAttribute('id');
      }
    });

    navItems.forEach(item => {
      item.classList.remove('active');
      if (item.getAttribute('href') === '#' + current) {
        item.classList.add('active');
      }
    });
  });

  // Initialize preset on load
  loadPlaygroundPreset();
  updateFlowPreview();
  telemetryChart = new TelemetryChart('telemetry-chart');
  setupTelemetryListener();
  initDictionary();
  initMicroservicesTab();

  // Boot functions
  loadHomeStats();
  loadActiveServices();
  loadDatabaseLogs();
  checkDbConnection();

  // Auto refresh every 5s
  setInterval(() => {
    loadHomeStats();
    loadActiveServices();
    checkDbConnection();
  }, 5000);

  // Inicialização do Sistema de Acesso e Governança
  initAuthSystem();
}

// ============================================================================
// SISTEMA DE AUTENTICAÇÃO, CONTROLO DE ACESSO E CONSOLAS (PORTAL.JS)
// ============================================================================

let currentAuthToken = localStorage.getItem('inp_auth_token') || null;
let currentAuthUser = null;

// Intercetor global para injetar automaticamente o cabeçalho Authorization em todos os pedidos do portal
const _nativeFetch = window.fetch;
window.fetch = function(url, options = {}) {
  const opts = options || {};
  opts.headers = opts.headers || {};
  if (currentAuthToken) {
    if (typeof opts.headers.set === 'function') {
      if (!opts.headers.has('Authorization')) opts.headers.set('Authorization', `Bearer ${currentAuthToken}`);
    } else if (Array.isArray(opts.headers)) {
      opts.headers.push(['Authorization', `Bearer ${currentAuthToken}`]);
    } else {
      if (!opts.headers['Authorization']) opts.headers['Authorization'] = `Bearer ${currentAuthToken}`;
    }
  }
  return _nativeFetch.call(this, url, opts);
};

/**
 * @description Realiza pedidos HTTP autenticados com o token Bearer ativo.
 * @param {string} url - Endereço do endpoint.
 * @param {RequestInit} [options={}] - Configuração do fetch.
 * @returns {Promise<Response>} Promessa com a resposta HTTP.
 */
function authFetch(url, options = {}) {
  return window.fetch(url, options);
}

/**
 * @description Abre o modal de autenticação exibindo a aba indicada ('login', 'register' ou 'demo').
 * @param {string} [tabName='login'] - Nome da aba a ativar no modal.
 */
function openAuthModal(tabName = 'login') {
  // Salvaguarda: O separador demo é exclusivo do Administrador Geral
  if (tabName === 'demo' && (!currentAuthUser || currentAuthUser.role !== 'ADMIN')) {
    tabName = 'login';
  }
  toggleAuthModal(true, tabName);
}

/**
 * @description Abre ou fecha o modal de autenticação, login, cadastro e seleção de perfis.
 * @param {boolean} show - Verdadeiro para exibir o modal, falso para fechar.
 * @param {string} [defaultTab='login'] - Aba predefinida a abrir.
 */
function toggleAuthModal(show, defaultTab = 'login') {
  const modal = document.getElementById('auth-switch-modal');
  if (!modal) return;
  modal.style.display = show ? 'flex' : 'none';
  if (show) {
    if (defaultTab === 'demo' && (!currentAuthUser || currentAuthUser.role !== 'ADMIN')) {
      defaultTab = 'login';
    }
    switchAuthTab(defaultTab);
  }
}

/**
 * @description Alterna entre as abas internas do modal de autenticação (Login, Cadastro e Demonstração).
 * O acesso aos perfis demo é estritamente condicionado ao papel de Administrador Geral.
 * @param {string} tabName - Nome da aba ('login', 'register' ou 'demo').
 */
function switchAuthTab(tabName) {
  const isAdmin = currentAuthUser && currentAuthUser.role === 'ADMIN';

  // Salvaguarda: Não-administradores não podem selecionar nem visualizar a aba demo
  if (tabName === 'demo' && !isAdmin) {
    tabName = 'login';
  }

  // Visibilidade estrita do botão da aba demo
  const tabDemoBtn = document.getElementById('tab-btn-demo');
  if (tabDemoBtn) {
    tabDemoBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  }

  const tabs = ['login', 'register', 'demo'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const pane = document.getElementById(`auth-pane-${t}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (pane) pane.classList.toggle('active', t === tabName);
  });

  // Limpa eventuais mensagens de alerta
  const loginAlert = document.getElementById('login-alert');
  const registerAlert = document.getElementById('register-alert');
  if (loginAlert) {
    loginAlert.className = 'auth-alert';
    loginAlert.style.display = 'none';
    loginAlert.innerText = '';
  }
  if (registerAlert) {
    registerAlert.className = 'auth-alert';
    registerAlert.style.display = 'none';
    registerAlert.innerText = '';
  }

  // Atualiza título do modal
  const titleEl = document.getElementById('auth-modal-title');
  if (titleEl) {
    if (tabName === 'login') titleEl.innerText = 'Iniciar Sessão no Protocolo INP';
    else if (tabName === 'register') titleEl.innerText = 'Criar Nova Conta no INP';
    else titleEl.innerText = 'Alternar Perfil de Acesso (RBAC)';
  }
}

/**
 * @description Controla a exibição condicional de campos do formulário de registo consoante o perfil.
 */
function handleRegisterRoleChange() {
  const roleSelect = document.getElementById('reg-role');
  const companyGroup = document.getElementById('reg-company-group');
  const dbaGroup = document.getElementById('reg-dba-group');
  if (!roleSelect) return;

  const role = roleSelect.value;
  if (companyGroup) {
    companyGroup.style.display = (role === 'CLIENT_ENTERPRISE') ? 'block' : 'none';
  }
  if (dbaGroup) {
    dbaGroup.style.display = (role === 'DBA') ? 'block' : 'none';
  }
}

/**
 * @description Trata a submissão do formulário de início de sessão (login).
 * @param {Event} event - Evento de submissão do formulário.
 */
async function handlePortalLogin(event) {
  if (event) event.preventDefault();
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const alertEl = document.getElementById('login-alert');
  const submitBtn = document.getElementById('btn-submit-login');

  if (!emailInput || !passwordInput || !alertEl) return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    alertEl.className = 'auth-alert error';
    alertEl.style.display = 'flex';
    alertEl.innerText = 'Por favor, preencha o email e a palavra-passe.';
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>A autenticar...</span>';
  }

  try {
    const res = await _nativeFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (data.success && data.token) {
      currentAuthToken = data.token;
      currentAuthUser = data.user;
      localStorage.setItem('inp_auth_token', data.token);
      localStorage.setItem('inp_auth_user', JSON.stringify(data.user));

      alertEl.className = 'auth-alert success';
      alertEl.style.display = 'flex';
      alertEl.innerText = 'Sessão iniciada com sucesso!';

      setTimeout(() => {
        toggleAuthModal(false);
        renderCurrentProfile();
        updateNavTabsVisibility();
        emailInput.value = '';
        passwordInput.value = '';
      }, 400);
    } else {
      alertEl.className = 'auth-alert error';
      alertEl.style.display = 'flex';
      alertEl.innerText = data.error || 'Credenciais inválidas. Verifique os dados introduzidos.';
    }
  } catch (err) {
    alertEl.className = 'auth-alert error';
    alertEl.style.display = 'flex';
    alertEl.innerText = 'Erro de rede ou servidor ao tentar iniciar sessão: ' + err.message;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Iniciar Sessão</span> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
    }
  }
}

/**
 * @description Trata a submissão do formulário de registo de novo utilizador (cadastro).
 * @param {Event} event - Evento de submissão do formulário.
 */
async function handlePortalRegister(event) {
  if (event) event.preventDefault();
  const nameInput = document.getElementById('reg-name');
  const emailInput = document.getElementById('reg-email');
  const passwordInput = document.getElementById('reg-password');
  const confirmInput = document.getElementById('reg-password-confirm');
  const roleSelect = document.getElementById('reg-role');
  const companyInput = document.getElementById('reg-company');
  const dbaSelect = document.getElementById('reg-dba-level');
  const alertEl = document.getElementById('register-alert');
  const submitBtn = document.getElementById('btn-submit-register');

  if (!nameInput || !emailInput || !passwordInput || !alertEl) return;

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const confirmPassword = confirmInput ? confirmInput.value : '';
  const role = roleSelect ? roleSelect.value : 'CLIENT_INDIVIDUAL';
  const company = companyInput ? companyInput.value.trim() : '';
  const dbaLevel = dbaSelect ? parseInt(dbaSelect.value, 10) : 1;

  if (!name || !email || !password) {
    alertEl.className = 'auth-alert error';
    alertEl.style.display = 'flex';
    alertEl.innerText = 'Preencha todos os campos obrigatórios.';
    return;
  }

  if (password.length < 6) {
    alertEl.className = 'auth-alert error';
    alertEl.style.display = 'flex';
    alertEl.innerText = 'A palavra-passe deve possuir pelo menos 6 caracteres.';
    return;
  }

  if (password !== confirmPassword) {
    alertEl.className = 'auth-alert error';
    alertEl.style.display = 'flex';
    alertEl.innerText = 'A confirmação da palavra-passe não coincide.';
    return;
  }

  if (role === 'CLIENT_ENTERPRISE' && !company) {
    alertEl.className = 'auth-alert error';
    alertEl.style.display = 'flex';
    alertEl.innerText = 'Por favor, indique o nome da empresa ou organização.';
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>A registar utilizador...</span>';
  }

  try {
    const payload = {
      name,
      email,
      password,
      role,
      company: role === 'CLIENT_ENTERPRISE' ? company : undefined,
      dbaLevel: role === 'DBA' ? dbaLevel : undefined
    };

    const res = await _nativeFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success && data.token) {
      currentAuthToken = data.token;
      currentAuthUser = data.user;
      localStorage.setItem('inp_auth_token', data.token);
      localStorage.setItem('inp_auth_user', JSON.stringify(data.user));

      alertEl.className = 'auth-alert success';
      alertEl.style.display = 'flex';
      alertEl.innerText = 'Conta criada com sucesso! A iniciar sessão...';

      setTimeout(() => {
        toggleAuthModal(false);
        renderCurrentProfile();
        updateNavTabsVisibility();
        nameInput.value = '';
        emailInput.value = '';
        passwordInput.value = '';
        if (confirmInput) confirmInput.value = '';
        if (companyInput) companyInput.value = '';
      }, 500);
    } else {
      alertEl.className = 'auth-alert error';
      alertEl.style.display = 'flex';
      alertEl.innerText = data.error || 'Falha ao criar conta. Tente novamente.';
    }
  } catch (err) {
    alertEl.className = 'auth-alert error';
    alertEl.style.display = 'flex';
    alertEl.innerText = 'Erro de rede ou servidor ao registar: ' + err.message;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Concluir Registo &amp; Iniciar Sessão</span> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>';
    }
  }
}

/**
 * @description Termina a sessão ativa do utilizador, limpando o token e retornando ao estado de visitante.
 */
function handlePortalLogout() {
  currentAuthToken = null;
  currentAuthUser = null;
  localStorage.removeItem('inp_auth_token');
  localStorage.removeItem('inp_auth_user');

  renderCurrentProfile();
  updateNavTabsVisibility();

  // Se o utilizador se encontrava numa aba restrita, redireciona para o Início público
  const activeTab = document.querySelector('.tab-content.active');
  if (activeTab && ['tab-governance', 'tab-audit', 'tab-dba', 'tab-client'].includes(activeTab.id)) {
    switchTab(null, 'tab-home');
  }
  if (typeof showToast === 'function') {
    showToast('Sessão terminada. O portal retornou ao modo visitante seguro.', 'info');
  }
}

/**
 * @description Abre ou fecha o modal de geração de chaves de API.
 * @param {boolean} show - Verdadeiro para exibir.
 */
function toggleApiKeyModal(show) {
  const modal = document.getElementById('apikey-create-modal');
  if (modal) {
    modal.style.display = show ? 'flex' : 'none';
    const secretBox = document.getElementById('apikey-created-secret-box');
    if (secretBox) secretBox.style.display = 'none';
  }
}

/**
 * @description Mostra ou esconde o seletor de nível DBA dependendo do papel escolhido no formulário de utilizador.
 */
function toggleDbaLevelField() {
  const roleSelect = document.getElementById('new-user-role');
  const dbaField = document.getElementById('field-dba-level');
  if (roleSelect && dbaField) {
    dbaField.style.display = roleSelect.value === 'DBA' ? 'block' : 'none';
  }
}

/**
 * @description Inicia sessão como um determinado perfil predefinido de teste.
 * @param {string} email - Email do utilizador.
 * @param {string} password - Palavra-passe.
 */
async function loginAsProfile(email, password) {
  try {
    const res = await _nativeFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.success && data.token) {
      currentAuthToken = data.token;
      currentAuthUser = data.user;
      localStorage.setItem('inp_auth_token', data.token);
      localStorage.setItem('inp_auth_user', JSON.stringify(data.user));
      toggleAuthModal(false);
      renderCurrentProfile();
      updateNavTabsVisibility();
    } else {
      alert('Falha ao autenticar: ' + (data.error || 'Erro desconhecido'));
    }
  } catch (err) {
    alert('Erro de rede ao autenticar: ' + err.message);
  }
}

/**
 * @description Atualiza visualmente o crachá do perfil ativo na barra de navegação.
 */
function renderCurrentProfile() {
  const guestSection = document.getElementById('nav-guest-section');
  const userSection = document.getElementById('nav-user-section');
  const demoBtn = document.getElementById('btn-open-auth-modal');
  const tabDemoBtn = document.getElementById('tab-btn-demo');

  if (!currentAuthUser) {
    if (guestSection) guestSection.style.display = 'flex';
    if (userSection) userSection.style.display = 'none';
    if (demoBtn) demoBtn.style.display = 'none';
    if (tabDemoBtn) tabDemoBtn.style.display = 'none';
    return;
  }

  if (guestSection) guestSection.style.display = 'none';
  if (userSection) userSection.style.display = 'flex';

  const iconEl = document.getElementById('nav-profile-icon');
  const nameEl = document.getElementById('nav-profile-name');
  const tagEl = document.getElementById('nav-profile-tag');
  const chipEl = document.getElementById('current-profile-chip');

  if (!nameEl || !chipEl) return;

  const roleIcons = {
    ADMIN: '👑',
    CLIENT_ENTERPRISE: '🏢',
    CLIENT_INDIVIDUAL: '💻',
    AUDITOR: '🔍',
    DBA: '🗄️',
    DEVELOPER: '🛠️',
    SECOPS: '🛡️'
  };

  const roleClasses = {
    ADMIN: 'role-admin',
    CLIENT_ENTERPRISE: 'role-client-enterprise',
    CLIENT_INDIVIDUAL: 'role-client-individual',
    AUDITOR: 'role-auditor',
    DBA: 'role-dba',
    DEVELOPER: 'role-client-individual',
    SECOPS: 'role-secops'
  };

  if (iconEl) iconEl.innerText = roleIcons[currentAuthUser.role] || '👤';
  nameEl.innerText = currentAuthUser.name.split(' ')[0] + (currentAuthUser.dbaLevel ? ` (N${currentAuthUser.dbaLevel})` : '');
  if (tagEl) tagEl.innerText = currentAuthUser.role === 'DBA' ? `DBA N${currentAuthUser.dbaLevel || 1}` : currentAuthUser.role;

  chipEl.className = 'profile-chip ' + (roleClasses[currentAuthUser.role] || 'role-admin');

  // Perfis Demo: Visibilidade restrita exclusivamente para o Administrador Geral
  const isAdmin = currentAuthUser.role === 'ADMIN';
  if (demoBtn) {
    demoBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  }
  if (tabDemoBtn) {
    tabDemoBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  }
}

/**
 * @description Regula dinamicamente a visibilidade das abas conforme o papel do utilizador.
 */
function updateNavTabsVisibility() {
  const role = currentAuthUser ? currentAuthUser.role : null;
  const dbaLevel = (currentAuthUser && currentAuthUser.dbaLevel) ? currentAuthUser.dbaLevel : 1;

  const adminTabs = document.querySelectorAll('.tab-admin-only');
  const auditorTabs = document.querySelectorAll('.tab-auditor-only');
  const dbaTabs = document.querySelectorAll('.tab-dba-only');
  const clientTabs = document.querySelectorAll('.tab-client-only');

  // Visibilidade de botões na barra, menus suspensos e gaveta mobile
  const setDisplay = (el, show) => {
    if (!show) {
      el.style.display = 'none';
    } else {
      el.style.display = (el.classList.contains('dropdown-item') || el.classList.contains('mobile-nav-item')) ? 'flex' : 'inline-block';
    }
  };

  adminTabs.forEach(el => setDisplay(el, role === 'ADMIN'));
  auditorTabs.forEach(el => setDisplay(el, role === 'ADMIN' || role === 'AUDITOR' || role === 'SECOPS'));
  dbaTabs.forEach(el => setDisplay(el, role === 'ADMIN' || role === 'DBA'));
  clientTabs.forEach(el => setDisplay(el, role === 'ADMIN' || role === 'CLIENT_ENTERPRISE' || role === 'CLIENT_INDIVIDUAL' || role === 'DEVELOPER'));

  // Visibilidade estrita dos controlos de perfis demo (Exclusivo Administrador Geral)
  const demoBtn = document.getElementById('btn-open-auth-modal');
  if (demoBtn) {
    demoBtn.style.display = (role === 'ADMIN') ? 'inline-flex' : 'none';
  }
  const tabDemoBtn = document.getElementById('tab-btn-demo');
  if (tabDemoBtn) {
    tabDemoBtn.style.display = (role === 'ADMIN') ? 'inline-flex' : 'none';
  }

  // Visibilidade do Menu Agrupador de Consolas Privadas
  const hasPrivateAccess = role && ['ADMIN', 'AUDITOR', 'DBA', 'CLIENT_ENTERPRISE', 'CLIENT_INDIVIDUAL', 'SECOPS', 'DEVELOPER'].includes(role);
  const privateWrappers = document.querySelectorAll('.tab-private-wrapper');
  privateWrappers.forEach(el => {
    el.style.display = hasPrivateAccess ? (el.classList.contains('mobile-nav-links') ? 'flex' : 'block') : 'none';
  });

  const privateLabel = document.getElementById('private-hub-label');
  if (privateLabel) {
    if (role === 'ADMIN') privateLabel.innerText = 'Painel Admin';
    else if (role === 'AUDITOR' || role === 'SECOPS') privateLabel.innerText = 'Auditoria';
    else if (role === 'DBA') privateLabel.innerText = `Consola DBA N${dbaLevel}`;
    else if (role === 'CLIENT_ENTERPRISE' || role === 'CLIENT_INDIVIDUAL') privateLabel.innerText = 'Área do Cliente';
    else privateLabel.innerText = 'Consola Segura';
  }

  // Seções internas na aba DBA
  const dbaBadgeView = document.getElementById('dba-level-badge-view');
  if (dbaBadgeView) {
    if (role === 'ADMIN') {
      dbaBadgeView.className = 'dba-tier-badge dba-tier-3';
      dbaBadgeView.innerText = 'Super Administrador (Acesso Pleno)';
    } else {
      dbaBadgeView.className = `dba-tier-badge dba-tier-${dbaLevel}`;
      dbaBadgeView.innerText = `Nível ${dbaLevel} - ${dbaLevel === 1 ? 'Monitorização' : (dbaLevel === 2 ? 'Operacional / DLQ' : 'Manutenção & Sandbox')}`;
    }
  }

  const dbaSectionDlq = document.getElementById('dba-section-dlq');
  const dbaSectionAdv = document.getElementById('dba-section-advanced');

  if (dbaSectionDlq) {
    dbaSectionDlq.style.display = (role === 'ADMIN' || (role === 'DBA' && dbaLevel >= 2)) ? 'block' : 'none';
  }
  if (dbaSectionAdv) {
    dbaSectionAdv.style.display = (role === 'ADMIN' || (role === 'DBA' && dbaLevel >= 3)) ? 'block' : 'none';
  }

  // Validação de acesso à aba ativa e recarregamento de dados seguros
  const activeTab = document.querySelector('.tab-content.active');
  if (activeTab) {
    if (activeTab.id === 'tab-governance') {
      if (role === 'ADMIN') {
        if (typeof loadUsersList === 'function') loadUsersList();
        if (typeof loadAdminServiceControls === 'function') loadAdminServiceControls();
      } else {
        switchTab(null, 'tab-home');
      }
    } else if (activeTab.id === 'tab-audit') {
      if (role === 'ADMIN' || role === 'AUDITOR' || role === 'SECOPS') {
        if (typeof loadAuditData === 'function') loadAuditData();
        if (typeof loadDatabaseLogs === 'function') loadDatabaseLogs();
      } else {
        switchTab(null, 'tab-home');
      }
    } else if (activeTab.id === 'tab-dba') {
      if (role === 'ADMIN' || role === 'DBA') {
        if (typeof loadDbaDashboard === 'function') loadDbaDashboard();
      } else {
        switchTab(null, 'tab-home');
      }
    } else if (activeTab.id === 'tab-client') {
      if (role === 'ADMIN' || role === 'CLIENT_ENTERPRISE' || role === 'CLIENT_INDIVIDUAL' || role === 'DEVELOPER') {
        if (typeof loadClientDashboard === 'function') loadClientDashboard();
        if (typeof loadClientExecutions === 'function') loadClientExecutions();
      } else {
        switchTab(null, 'tab-home');
      }
    }
  }
}

/**
 * @description Carrega os utilizadores cadastrados no sistema (Admin).
 */
async function loadUsersList() {
  try {
    const res = await authFetch('/api/auth/users');
    const data = await res.json();
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;

    if (!data.success || !data.users || data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Nenhum utilizador encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = data.users.map(u => `
      <tr>
        <td><strong>${u.name}</strong>${u.company ? `<br><small style="color: var(--text-muted);">${u.company}</small>` : ''}</td>
        <td><code>${u.email}</code></td>
        <td><span class="badge-tag">${u.role}</span></td>
        <td>${u.dbaLevel ? `<span class="dba-tier-badge dba-tier-${u.dbaLevel}">Nível ${u.dbaLevel}</span>` : '-'}</td>
        <td>${u.quotaUsed} / ${u.quotaLimit}</td>
        <td><span style="color: ${u.active ? 'var(--emerald)' : 'var(--error)'}; font-weight: 700;">${u.active ? '● Ativo' : '○ Inativo'}</span></td>
        <td>
          <button class="btn-outline" style="padding: 3px 8px; font-size: 11px; border-radius: 4px;" onclick="toggleUserStatus('${u.id}')">
            ${u.active ? 'Desativar' : 'Ativar'}
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Erro ao carregar lista de utilizadores:', err);
  }
}

/**
 * @description Alterna o estado ativo de um utilizador.
 * @param {string} userId - Identificador UUID do utilizador.
 */
async function toggleUserStatus(userId) {
  try {
    const res = await authFetch(`/api/auth/users/${userId}/toggle`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      loadUsersList();
    } else {
      alert('Erro: ' + data.error);
    }
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  }
}

/**
 * @description Carrega métricas e registos de auditoria forense (Auditor & Admin).
 */
async function loadAuditData() {
  try {
    const actionFilter = (document.getElementById('audit-filter-action')?.value || '');
    const url = actionFilter ? `/api/audit/logs?action=${encodeURIComponent(actionFilter)}` : '/api/audit/logs';

    const [logsRes, summaryRes] = await Promise.all([
      authFetch(url),
      authFetch('/api/audit/summary')
    ]);

    const logsData = await logsRes.json();
    const summaryData = await summaryRes.json();

    if (summaryData.success && summaryData.summary) {
      const s = summaryData.summary;
      const totalEl = document.getElementById('audit-stat-total');
      const deniedEl = document.getElementById('audit-stat-denied');
      const dbaEl = document.getElementById('audit-stat-dba');
      const scoreEl = document.getElementById('audit-stat-score');

      if (totalEl) totalEl.innerText = s.totalLogs;
      if (deniedEl) deniedEl.innerText = s.deniedEvents;
      if (dbaEl) dbaEl.innerText = s.dbaEvents;
      if (scoreEl) scoreEl.innerText = `${s.complianceScore}%`;
    }

    const tbody = document.getElementById('audit-tbody');
    if (!tbody) return;

    if (!logsData.success || !logsData.logs || logsData.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Nenhum registo de auditoria disponível.</td></tr>';
      return;
    }

    tbody.innerHTML = logsData.logs.map(l => {
      const statusColor = l.status === 'SUCCESS' ? 'var(--emerald)' : (l.status === 'DENIED' ? 'var(--error)' : 'var(--warning)');
      const dateStr = new Date(l.createdAt).toLocaleTimeString() + ' ' + new Date(l.createdAt).toLocaleDateString();
      return `
        <tr>
          <td style="font-size: 11.5px; color: var(--text-muted);">${dateStr}</td>
          <td><strong style="color: #c4b5fd;">${l.action}</strong></td>
          <td>${l.userEmail || 'Sistema'}<br><small class="badge-tag">${l.userRole || 'ANONYMOUS'}</small></td>
          <td><code>${l.resource}</code></td>
          <td><span style="color: ${statusColor}; font-weight: 700;">${l.status}</span></td>
          <td style="font-size: 11px; color: var(--text-muted);">${l.ipAddress || '-'}<br><code>${l.correlationId ? l.correlationId.substring(0, 12) + '...' : '-'}</code></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar dados de auditoria:', err);
  }
}

/**
 * @description Exporta os logs de auditoria carregados em formato JSON.
 */
async function exportAuditReport() {
  try {
    const res = await authFetch('/api/audit/logs?limit=500');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const blob = new Blob([JSON.stringify(data.logs, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `inp-audit-report-${new Date().toISOString().substring(0,10)}.json`;
    link.click();
  } catch (err) {
    alert('Erro ao exportar auditoria: ' + err.message);
  }
}

/**
 * @description Carrega o painel da Consola DBA com métricas e ocupação de tabelas.
 */
async function loadDbaDashboard() {
  try {
    const res = await authFetch('/api/dba/overview');
    const data = await res.json();
    if (!data.success || !data.overview) return;

    const ov = data.overview;
    const connsEl = document.getElementById('dba-stat-conns');
    const cacheEl = document.getElementById('dba-stat-cache');
    const dlqEl = document.getElementById('dba-stat-dlq');
    const pendingEl = document.getElementById('dba-stat-pending');

    if (connsEl) connsEl.innerText = ov.activeConnections;
    if (cacheEl) cacheEl.innerText = `${ov.cacheHitRatio}%`;
    if (dlqEl) dlqEl.innerText = ov.dlqCount;
    if (pendingEl) pendingEl.innerText = ov.pendingJobsCount;

    const tbody = document.getElementById('dba-tables-tbody');
    if (tbody && ov.tables) {
      tbody.innerHTML = ov.tables.map(t => `
        <tr>
          <td><code>${t.tableName}</code></td>
          <td><strong>${t.rowCount.toLocaleString()}</strong></td>
          <td style="color: var(--secondary);">${t.totalSize}</td>
          <td>
            <button class="btn-outline" style="padding: 2px 8px; font-size: 11px;" onclick="document.getElementById('vacuum-target-select').value='${t.tableName}'; switchTab(null, 'tab-dba'); document.getElementById('btn-run-vacuum').scrollIntoView({behavior: 'smooth'});">
              Otimizar (VACUUM)
            </button>
          </td>
        </tr>
      `).join('');
    }

    if (currentAuthUser && (currentAuthUser.role === 'ADMIN' || (currentAuthUser.role === 'DBA' && currentAuthUser.dbaLevel >= 2))) {
      loadDlqItems();
    }
  } catch (err) {
    console.error('Erro ao carregar telemetria DBA:', err);
  }
}

/**
 * @description Lista os itens da Dead Letter Queue na Consola DBA.
 */
async function loadDlqItems() {
  try {
    const res = await authFetch('/api/dba/dlq');
    const data = await res.json();
    const tbody = document.getElementById('dba-dlq-tbody');
    if (!tbody) return;

    if (!data.success || !data.items || data.items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--emerald);">✔ Dead Letter Queue vazia. Nenhuma mensagem retida com falha.</td></tr>';
      return;
    }

    tbody.innerHTML = data.items.map(item => `
      <tr>
        <td><code>${item.id.substring(0, 8)}...</code></td>
        <td style="font-size: 11.5px; color: var(--text-muted);">${new Date(item.failedAt).toLocaleTimeString()}</td>
        <td><span class="badge-tag">${item.taskType}</span></td>
        <td style="color: var(--error); font-size: 12px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.errorMessage}">${item.errorMessage}</td>
        <td>
          <button class="btn-outline" style="border-color: var(--warning); color: #fcd34d; padding: 2px 8px; font-size: 11px;" onclick="retryDlqItem('${item.id}')">
            Reprocessar ↻
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Erro ao carregar DLQ:', err);
  }
}

/**
 * @description Reprocessa um item da Dead Letter Queue.
 * @param {string} id - UUID do item DLQ.
 */
async function retryDlqItem(id) {
  try {
    const res = await authFetch(`/api/dba/dlq/retry/${id}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert('Mensagem reinjetada com sucesso na fila de execução assíncrona.');
      loadDlqItems();
      loadDbaDashboard();
    } else {
      alert('Falha ao reprocessar: ' + data.error);
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

/**
 * @description Purga todos os itens retidos na Dead Letter Queue.
 */
async function purgeDlq() {
  if (!confirm('Deseja realmente purgar todas as mensagens da Dead Letter Queue? Esta ação é irreversível.')) return;
  try {
    const res = await authFetch('/api/dba/dlq/purge', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(`Purgados ${data.result.deletedCount} itens da Dead Letter Queue com sucesso.`);
      loadDlqItems();
      loadDbaDashboard();
    } else {
      alert('Erro: ' + data.error);
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

/**
 * @description Dispara o comando VACUUM ANALYZE na base de dados (DBA Nível 3 / Admin).
 */
async function runVacuum() {
  const targetSelect = document.getElementById('vacuum-target-select');
  const targetTable = targetSelect ? targetSelect.value : '';
  const feedbackEl = document.getElementById('vacuum-feedback');
  if (feedbackEl) feedbackEl.innerText = 'A executar VACUUM ANALYZE... aguarde.';

  try {
    const res = await authFetch('/api/dba/maintenance/vacuum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetTable })
    });
    const data = await res.json();
    if (data.success) {
      if (feedbackEl) feedbackEl.innerHTML = `<span style="color: var(--emerald);">✔ ${data.result.message}</span>`;
      loadDbaDashboard();
    } else {
      if (feedbackEl) feedbackEl.innerHTML = `<span style="color: var(--error);">❌ ${data.error}</span>`;
    }
  } catch (err) {
    if (feedbackEl) feedbackEl.innerHTML = `<span style="color: var(--error);">Erro: ${err.message}</span>`;
  }
}

/**
 * @description Executa uma consulta SQL no Sandbox seguro de diagnóstico (DBA Nível 3 / Admin).
 */
async function runDiagnosticQuery() {
  const inputEl = document.getElementById('sql-sandbox-input');
  const query = inputEl ? inputEl.value.trim() : '';
  const metricsEl = document.getElementById('sql-sandbox-metrics');
  const resultEl = document.getElementById('sql-sandbox-result');

  if (!query) {
    alert('Por favor, digite uma consulta SQL de diagnóstico.');
    return;
  }

  if (metricsEl) metricsEl.innerText = 'A executar consulta...';
  if (resultEl) resultEl.innerHTML = '';

  try {
    const res = await authFetch('/api/dba/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    if (data.success && data.result) {
      const { rows, rowCount, durationMs } = data.result;
      if (metricsEl) metricsEl.innerHTML = `<span style="color: var(--emerald);">✔ ${rowCount} linha(s) retornada(s) em ${durationMs}ms</span>`;
      
      if (rows && rows.length > 0) {
        const cols = Object.keys(rows[0]);
        resultEl.innerHTML = `
          <table class="data-table-modern">
            <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
            <tbody>
              ${rows.map(r => `<tr>${cols.map(c => `<td>${typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c]}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        `;
      } else {
        resultEl.innerHTML = '<span style="color: var(--text-muted);">Nenhum registo devolvido.</span>';
      }
    } else {
      if (metricsEl) metricsEl.innerHTML = `<span style="color: var(--error);">❌ ${data.error}</span>`;
    }
  } catch (err) {
    if (metricsEl) metricsEl.innerHTML = `<span style="color: var(--error);">Erro de conexão: ${err.message}</span>`;
  }
}

/**
 * @description Carrega as métricas de quota e chaves de API da Área do Cliente.
 */
async function loadClientDashboard() {
  try {
    const [meRes, keysRes] = await Promise.all([
      authFetch('/api/auth/me'),
      authFetch('/api/auth/api-keys')
    ]);

    const meData = await meRes.json();
    const keysData = await keysRes.json();

    if (meData.success && meData.user) {
      const u = meData.user;
      currentAuthUser = u;
      const nameEl = document.getElementById('client-view-name');
      const emailEl = document.getElementById('client-view-email');
      const badgeEl = document.getElementById('client-view-role-badge');
      const quotaLabel = document.getElementById('client-quota-label');
      const quotaFill = document.getElementById('client-quota-fill');

      if (nameEl) nameEl.innerText = u.name + (u.company ? ` (${u.company})` : '');
      if (emailEl) emailEl.innerText = u.email;
      if (badgeEl) badgeEl.innerText = u.role === 'CLIENT_ENTERPRISE' ? 'CLIENTE EMPRESA' : 'CLIENTE INDEPENDENTE';
      if (quotaLabel) quotaLabel.innerText = `${u.quotaUsed.toLocaleString()} / ${u.quotaLimit.toLocaleString()} intenções`;

      const pct = Math.min(100, Math.round((u.quotaUsed / (u.quotaLimit || 1)) * 100));
      if (quotaFill) quotaFill.style.width = `${pct}%`;
    }

    const tbody = document.getElementById('client-apikeys-tbody');
    if (!tbody) return;

    if (!keysData.success || !keysData.apiKeys || keysData.apiKeys.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Nenhuma chave de API ativa. Gere uma nova chave para começar.</td></tr>';
      return;
    }

    tbody.innerHTML = keysData.apiKeys.map(k => `
      <tr>
        <td><strong>${k.name}</strong></td>
        <td><code>${k.keyPrefix}</code></td>
        <td><small class="badge-tag">${k.permissions.length} permissões</small></td>
        <td style="font-size: 11.5px; color: var(--text-muted);">${new Date(k.createdAt).toLocaleDateString()}</td>
        <td style="font-size: 11.5px; color: var(--text-muted);">${k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Nunca'}</td>
        <td>
          <button class="btn-outline" style="border-color: var(--error); color: var(--error); padding: 2px 8px; font-size: 11px;" onclick="revokeApiKey('${k.id}')">
            Revogar
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Erro ao carregar Área do Cliente:', err);
  }
}

/**
 * @description Submete a criação de uma nova chave de API para o cliente ativo.
 */
async function submitCreateApiKey() {
  const nameInput = document.getElementById('apikey-input-name');
  const daysInput = document.getElementById('apikey-input-days');
  const name = nameInput ? nameInput.value.trim() : '';
  const days = daysInput ? parseInt(daysInput.value, 10) : 90;

  if (!name) {
    alert('Por favor, forneça um nome para a chave de API.');
    return;
  }

  try {
    const res = await authFetch('/api/auth/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, expiresInDays: days })
    });
    const data = await res.json();
    if (data.success) {
      const secretBox = document.getElementById('apikey-created-secret-box');
      const secretText = document.getElementById('apikey-secret-text');
      if (secretBox && secretText) {
        secretText.innerText = data.secretKey;
        secretBox.style.display = 'block';
      }
      loadClientDashboard();
    } else {
      alert('Falha ao gerar chave: ' + data.error);
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

/**
 * @description Revoga uma chave de API.
 * @param {string} id - Identificador UUID da chave.
 */
async function revokeApiKey(id) {
  if (!confirm('Deseja revogar esta chave de API? Qualquer integração em execução deixará de funcionar imediatamente.')) return;
  try {
    const res = await authFetch(`/api/auth/api-keys/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadClientDashboard();
    } else {
      alert('Falha ao revogar: ' + data.error);
    }
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

/**
 * @description Trata o clique no crachá do perfil do utilizador na barra de navegação.
 * Apenas o Administrador Geral é redirecionado para a seleção e alternância de perfis demo.
 */
function handleProfileChipClick() {
  if (currentAuthUser && currentAuthUser.role === 'ADMIN') {
    openAuthModal('demo');
  } else if (currentAuthUser) {
    if (typeof showToast === 'function') {
      showToast(`Sessão autenticada: ${currentAuthUser.name} (${currentAuthUser.role})`, 'info');
    }
  } else {
    openAuthModal('login');
  }
}
window.handleProfileChipClick = handleProfileChipClick;

/**
 * @description Inicializa o sistema de autenticação no arranque do frontend.
 */
async function initAuthSystem() {
  document.getElementById('btn-open-auth-modal')?.addEventListener('click', () => {
    if (currentAuthUser && currentAuthUser.role === 'ADMIN') {
      toggleAuthModal(true, 'demo');
    }
  });
  document.getElementById('current-profile-chip')?.addEventListener('click', () => handleProfileChipClick());
  document.getElementById('btn-toggle-create-user')?.addEventListener('click', () => {
    const card = document.getElementById('create-user-form-card');
    if (card) card.style.display = card.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('btn-save-new-user')?.addEventListener('click', async () => {
    const name = document.getElementById('new-user-name')?.value.trim();
    const email = document.getElementById('new-user-email')?.value.trim();
    const password = document.getElementById('new-user-pass')?.value;
    const role = document.getElementById('new-user-role')?.value;
    const dbaLevel = parseInt(document.getElementById('new-user-dba-level')?.value || '1', 10);
    const company = document.getElementById('new-user-company')?.value.trim();
    const quotaLimit = parseInt(document.getElementById('new-user-quota')?.value || '1000', 10);

    if (!name || !email || !password) {
      alert('Preencha os campos obrigatórios.');
      return;
    }

    try {
      const res = await authFetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role, dbaLevel, company, quotaLimit })
      });
      const data = await res.json();
      if (data.success) {
        alert('Utilizador registado com sucesso!');
        document.getElementById('create-user-form-card').style.display = 'none';
        loadUsersList();
      } else {
        alert('Erro: ' + data.error);
      }
    } catch (err) {
      alert('Erro ao guardar utilizador: ' + err.message);
    }
  });

  document.getElementById('btn-export-audit')?.addEventListener('click', exportAuditReport);
  document.getElementById('btn-purge-dlq')?.addEventListener('click', purgeDlq);
  document.getElementById('btn-run-vacuum')?.addEventListener('click', runVacuum);
  document.getElementById('btn-run-sql')?.addEventListener('click', runDiagnosticQuery);
  document.getElementById('btn-create-apikey-open')?.addEventListener('click', () => toggleApiKeyModal(true));
  document.getElementById('btn-submit-create-apikey')?.addEventListener('click', submitCreateApiKey);

  // Se já houver token salvo, verificar validade
  if (currentAuthToken) {
    try {
      const res = await authFetch('/api/auth/me');
      const data = await res.json();
      if (data.success && data.user) {
        currentAuthUser = data.user;
      } else {
        // Token expirado ou inválido: limpa credenciais locais
        currentAuthToken = null;
        currentAuthUser = null;
        localStorage.removeItem('inp_auth_token');
        localStorage.removeItem('inp_auth_user');
      }
    } catch {
      currentAuthToken = null;
      currentAuthUser = null;
    }
  }

  renderCurrentProfile();
  updateNavTabsVisibility();
  if (typeof selectLifecycleStep === 'function') {
    selectLifecycleStep(1);
  }
}

/**
 * =========================================================================
 * GUIA DO CICLO DE VIDA DA INTENÇÃO (DO ZERO AO FIM) — DADOS E CONTROLADOR
 * =========================================================================
 */
const LIFECYCLE_STEPS_DATA = {
  1: {
    number: "01",
    phase: "Definição do Problema & Necessidade de Negócio",
    badge: "Fase Conceitual",
    icon: "💡",
    summary: "Identificação formal do objetivo de negócio, modo de execução (síncrono vs assíncrono), SLAs de latência e garantias de idempotência.",
    responsibilities: [
      "Determinar se o resultado precisa ser imediato (<2s) ou pode ser postergado via Transactional Outbox (queue_jobs).",
      "Definir a chave de negócio única para o cabeçalho X-Idempotency-Key para evitar cobranças ou mutações duplicadas.",
      "Identificar quais dados confidenciais (senhas, cartões, dados de saúde) exigem criptografia AES-256-GCM ou ZK-Proofs."
    ],
    codeTitle: "Checklist de Especificação Inicial",
    codeType: "json",
    code: `{
  "businessGoal": "Checkout com Reserva de Estoque e Notificação",
  "slaTargetMs": 1200,
  "executionMode": "SYNCHRONOUS",
  "idempotencyKeyStrategy": "order_uuid + timestamp_window",
  "dataSensitivity": "HIGH (PCI-DSS & LGPD)",
  "failurePolicy": "ROLLBACK"
}`,
    guarantees: "Garante alinhamento estrito com os requisitos de arquitetura antes de despachar qualquer recurso de infraestrutura.",
    proTip: "Se a operação envolver envio de emails pesados ou geração de relatórios, planeje desde já o uso de DEFER para libertar o cliente em milissegundos."
  },
  2: {
    number: "02",
    phase: "Escolha Semântica dos Verbos (Catálogo de 51 Verbos)",
    badge: "Modelagem Semântica",
    icon: "🎯",
    summary: "Mapeamento rigoroso das ações necessárias para os 51 verbos canónicos, estratégicos e revolucionários do protocolo INP.",
    responsibilities: [
      "Selecionar pares semânticos determinísticos: ex. RESERVE LOCK para travar recurso e TRANSFER FUNDS para débito.",
      "Para cada verbo mutável de efeito colateral, definir o par compensatório (ex: RESERVE LOCK -> RELEASE LOCK).",
      "Incorporar verbos anti-estresse se houver tráfego intenso (COALESCE, MEMOIZE, THROTTLE) ou recursos de ponta (STREAM, ATTEST, ADAPT, ESCALATE, REASON)."
    ],
    codeTitle: "Bloco REQUIRE na DSL",
    codeType: "dsl",
    code: `REQUIRE {
  GUARD "amount > 0"
  RESERVE STOCK
  EXECUTE PAYMENT
  STREAM AI_STATUS
  ATTEST TRANSACTION_RECEIPT
  NOTIFY CUSTOMER
}`,
    guarantees: "O motor valida no CapabilityRegistry se todos os requisitos possuem provedores ativos antes de autorizar o início do fluxo.",
    proTip: "Nunca use CREATE quando a intenção real for EXECUTE ou TRANSFER; o verbo orienta as políticas de transação e auditoria do motor."
  },
  3: {
    number: "03",
    phase: "Modelagem de Dados & Invariantes (CONTEXT)",
    badge: "Carga Útil & Estado",
    icon: "📋",
    summary: "Estruturação dos parâmetros de entrada, variáveis operacionais e definição da política de resiliência (failurePolicy).",
    responsibilities: [
      "Construir o objeto JSON estruturado com todos os argumentos requeridos pelos microsserviços da cadeia.",
      "Definir a failurePolicy: ROLLBACK (padrão LIFO para transações financeiras) ou FORWARD_RETRY (para lotes e migrações).",
      "Aplicar REDACT preventivo para higienização de tokens e senhas antes de logs de telemetria."
    ],
    codeTitle: "Bloco CONTEXT na DSL",
    codeType: "dsl",
    code: `CONTEXT {
  orderId: "ord_99482",
  amount: 450.00,
  currency: "EUR",
  customerId: "usr_vip_44",
  cardToken: "tok_visa_live_883",
  failurePolicy: "ROLLBACK"
}`,
    guarantees: "A imutabilidade contextual garante que cada passo recebe uma cópia higienizada e isolada do estado da transação.",
    proTip: "Use failurePolicy: 'FORWARD_RETRY' em rotinas noturnas pesadas para que uma falha de conexão no passo 90 não desfaça os 89 passos bem-sucedidos."
  },
  4: {
    number: "04",
    phase: "Desenho da Topologia do Grafo (FLOW)",
    badge: "Orquestração de Grafos",
    icon: "🔀",
    summary: "Construção do fluxo de execução combinando estruturas sequenciais, paralelas protegidas, condicionais, retries e timeouts.",
    responsibilities: [
      "Usar SEQUENCE para passos com dependência estrita de dados ou causalidade financeira.",
      "Usar PARALLEL para consultas I/O simultâneas protegidas com AbortController em caso de falha concorrente.",
      "Envolver passos de rede com RETRY (backoff exponencial) e TIMEOUT (limite de Promises Race)."
    ],
    codeTitle: "Bloco FLOW com Resiliência Integrada",
    codeType: "dsl",
    code: `FLOW {
  SEQUENCE {
    GUARD "amount > 0"
    PARALLEL {
      FETCH USER_PROFILE
      FETCH INVENTORY_LEVEL
    }
    TIMEOUT 4000 {
      RETRY 3 {
        EXECUTE PAYMENT
      }
    }
    DEFER SEND_CONFIRMATION_EMAIL
  }
}`,
    guarantees: "O SafeEvaluator processa condições lógicas sem uso de eval/new Function, blindando o motor contra vulnerabilidades RCE.",
    proTip: "Evite paralelizar passos que mutam o mesmo registro no banco para não gerar deadlocks no PostgreSQL."
  },
  5: {
    number: "05",
    phase: "Especificação do Formato de Saída (OUTPUT)",
    badge: "Composição de Resposta",
    icon: "📤",
    summary: "Determinação do formato final transformado pelo ResponseComposer para entrega aos clientes e consumidores da API.",
    responsibilities: [
      "json: Ideal para consumo em APIs REST, Single Page Applications e microsserviços modernos.",
      "xml: Para integração com barramentos legados, sistemas bancários SOAP ou plataformas governamentais.",
      "text: Para terminais CLI ou saídas sintetizadas em linguagem natural.",
      "event: Para Server-Sent Events (SSE) e canais streaming em tempo real."
    ],
    codeTitle: "Bloco OUTPUT na DSL",
    codeType: "dsl",
    code: `OUTPUT {
  FORMAT "json"
}`,
    guarantees: "O ResponseComposer valida a estrutura de saída e expurga resíduos internos de depuração antes da entrega final.",
    proTip: "Ao utilizar o verbo STREAM para streaming de IA generativa, configure sempre OUTPUT { FORMAT 'event' }."
  },
  6: {
    number: "06",
    phase: "Submissão ao Gateway HTTP / JSON Nativo / SDK",
    badge: "Gateway & Segurança",
    icon: "🌐",
    summary: "Transmissão da intenção através da API REST com chave de idempotência, autenticação RBAC e proteção de rede.",
    responsibilities: [
      "Submeter para POST /api/intent com o cabeçalho X-Idempotency-Key obrigatório.",
      "Informar o securityContext contendo o token de identidade e permissões do utilizador em trânsito.",
      "A requisição pode ser submetida em DSL declarativa (text) ou em JSON estruturado nativo (intentObject)."
    ],
    codeTitle: "Requisição HTTP cURL",
    codeType: "json",
    code: `curl -X POST https://api.inpprotocol.io/api/intent \\
  -H "Content-Type: application/json" \\
  -H "X-Idempotency-Key: idemp_9918237192" \\
  -d '{
    "intentObject": {
      "id": "intent_checkout_01",
      "requirements": { "capabilities": ["EXECUTE PAYMENT"] },
      "context": { "amount": 250 },
      "flow": [{ "type": "SEQUENCE", "action": "EXECUTE PAYMENT" }],
      "output": { "format": "json" }
    },
    "securityContext": { "userId": "usr_99", "permissions": ["payments.write"] }
  }'`,
    guarantees: "O Gateway previne ataques de replay via cache de idempotência e valida os URLs contra SSRF via NetworkSecurity.",
    proTip: "Utilize o SDK oficial do INP para Node.js ou Python para geração automática de UUIDs e renovação transparente de tokens."
  },
  7: {
    number: "07",
    phase: "Parsing, AST Cache & Validação Sintática",
    badge: "Compilador do Motor",
    icon: "⚙️",
    summary: "O IntentParser analisa a sintaxe formal da DSL, gera a AST em memória e a armazena no IntentPlanCache.",
    responsibilities: [
      "Verificar a conformidade da gramática da DSL ou validar a estrutura do objeto JSON nativo recebido.",
      "Consultar o IntentPlanCache: se a assinatura da intenção já foi compilada, a AST é devolvida instantaneamente (<0.1ms).",
      "Se for uma requisição inédita, o compilador processa a árvore sintática e alimenta a cache LRU com o novo plano."
    ],
    codeTitle: "Estrutura da AST Compilada",
    codeType: "json",
    code: `{
  "id": "intent_checkout_01",
  "name": "checkout_order",
  "requirements": { "capabilities": ["EXECUTE PAYMENT", "NOTIFY CLIENT"] },
  "flow": [
    { "type": "SEQUENCE", "action": "EXECUTE PAYMENT" },
    { "type": "SEQUENCE", "action": "NOTIFY CLIENT" }
  ],
  "context": { "amount": 250 },
  "output": { "format": "json" }
}`,
    guarantees: "Aceleração drástica de performance com zero alocações repetitivas de memória em requisições de alta frequência.",
    proTip: "Mantenha a nomenclatura das intenções padronizada para maximizar a taxa de acertos (cache hit ratio) no IntentPlanCache."
  },
  8: {
    number: "08",
    phase: "Matching Semântico & Dynamic Health Scoring",
    badge: "Resolução Inteligente",
    icon: "🔍",
    summary: "O MatchingEngine resolve cada requisito no CapabilityRegistry, ordenando candidatos com algoritmos preditivos de saúde.",
    responsibilities: [
      "Localizar todos os serviços aptos cadastrados no PostgreSQL ou em memória volátil.",
      "Calcular a pontuação combinando trustScore base, nível de segurança (HIGH ganha +10%) e bónus de correspondência exata (+0.5).",
      "Aplicar o multiplicador de saúde dinâmico do ServiceMetricsCollector (penaliza nós com latência >1s ou taxa de erros elevada).",
      "Quando o verbo ADAPT for especificado, aplica o algoritmo Multi-Armed Bandit (epsilon-greedy) para exploração/explotação ótima."
    ],
    codeTitle: "Algoritmo Ponderado de Correspondência",
    codeType: "json",
    code: `{
  "requirement": "EXECUTE PAYMENT",
  "topMatchedService": {
    "serviceId": "payments-cluster-node-3",
    "trustScore": 80,
    "securityLevel": "HIGH",
    "realtimeLatencyMs": 42,
    "healthMultiplier": 1.0,
    "finalScore": 1.43
  },
  "failoverCandidates": ["payments-cluster-node-1", "payments-cluster-node-2"]
}`,
    guarantees: "Isola automaticamente microsserviços lentos ou degradados sem necessidade de intervenção humana.",
    proTip: "Monitore a aba de Métricas do Portal para identificar nós que estão sofrendo penalização contínua de tráfego."
  },
  9: {
    number: "09",
    phase: "Execução no Motor com Resiliência Extrema",
    badge: "Núcleo de Execução",
    icon: "⚡",
    summary: "O ExecutionEngine orquestra os nós com Circuit Breakers por serviço, Single-Flight e validação AJV pré e pós-passo.",
    responsibilities: [
      "Injetar HTTP Keep-Alive persistente através dos pools httpAgent e httpsAgent configurados.",
      "Consultar o CircuitBreakerRegistry singleton do nó: se o circuito estiver OPEN, dispara failover imediato para o próximo nó.",
      "Validar o contrato inputSchema do microsserviço com SchemaCache pré-compilado; se violado, solicita autocura com AISelfHealer.",
      "Validar o contrato outputSchema após o retorno para impedir a propagação de payloads corrompidos no grafo."
    ],
    codeTitle: "Proteção com Circuit Breaker & Validação",
    codeType: "json",
    code: `{
  "circuitBreaker": "CLOSED (Error rate: 0.0%)",
  "inputSchemaValidation": "PASSED (Cached AJV)",
  "httpConnection": "KEEP_ALIVE (Reused Socket)",
  "outputSchemaValidation": "PASSED",
  "executionDurationMs": 38
}`,
    guarantees: "Total isolamento de falhas. Uma queda temporária de um nó não contamina nem interrompe o motor de orquestração.",
    proTip: "Defina esquemas AJV claros para inputSchema e outputSchema; eles habilitam a autocura automática por IA caso campos venham truncados."
  },
  10: {
    number: "10",
    phase: "Saga Rollback ou Sucesso & Telemetria em Tempo Real",
    badge: "Transacionalidade & Conclusão",
    icon: "🛡️",
    summary: "Conclusão com sucesso ou acionamento atómico da compensação Saga LIFO, com gravação em base de dados e telemetria SSE.",
    responsibilities: [
      "Persistir o estado final da Saga (COMPLETED, FAILED ou SUSPENDED) na tabela saga_states.",
      "Em caso de erro irrecuperável, desempilhar as ações de compensação na ordem inversa (LIFO) garantindo consistência eventual.",
      "Transmitir eventos em tempo real via TelemetryService (SSE/WebSocket) para consolas de auditoria e clientes conectados.",
      "Emitir prova forense auditável com selo criptográfico HMAC-SHA256 se o verbo ATTEST foi invocado."
    ],
    codeTitle: "Registro de Auditoria & Prova Forense",
    codeType: "json",
    code: `{
  "executionId": "e3a89012-44df-41a9-9801-789a012bc456",
  "status": "COMPLETED",
  "durationMs": 142,
  "stepsExecuted": 6,
  "sagaCompensationStack": [],
  "attestationSeal": {
    "algorithm": "HMAC-SHA256",
    "timestamp": 1726450800000,
    "proofHash": "8f3b20c9e2b10a45d048991a03eef5868c2e17..."
  }
}`,
    guarantees: "Zero inconsistências em bancos distribuídos e trilha forense completa para conformidade regulatória (SOC2 / LGPD).",
    proTip: "Use o endpoint POST /api/workflow/:sagaId/approve para aprovar ou rejeitar manualmente fluxos suspensos por ESCALATE."
  }
};

/**
 * @description Atualiza a interface visual do Ciclo de Vida da Intenção ao clicar em qualquer um dos 10 passos.
 * @param {number} stepNumber - Número da etapa (1 a 10).
 */
function selectLifecycleStep(stepNumber) {
  const data = LIFECYCLE_STEPS_DATA[stepNumber];
  if (!data) return;

  // Atualizar botões visuais do stepper
  document.querySelectorAll('.lifecycle-step-card').forEach(card => {
    const cardStep = parseInt(card.getAttribute('data-step'), 10);
    if (cardStep === stepNumber) {
      card.classList.add('active');
      card.style.borderColor = 'var(--secondary)';
      card.style.background = 'rgba(0, 245, 255, 0.08)';
      card.style.boxShadow = '0 0 15px rgba(0, 245, 255, 0.15)';
    } else {
      card.classList.remove('active');
      card.style.borderColor = 'var(--card-border)';
      card.style.background = 'rgba(255, 255, 255, 0.01)';
      card.style.boxShadow = 'none';
    }
  });

  // Atualizar painel de detalhes dinâmico
  const panel = document.getElementById('lifecycle-detail-panel');
  if (!panel) return;

  panel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 15px; margin-bottom: 20px; border-bottom: 1px solid var(--card-border); padding-bottom: 18px;">
      <div style="display: flex; align-items: center; gap: 14px;">
        <div style="font-size: 32px; padding: 10px 14px; background: rgba(0, 245, 255, 0.1); border-radius: 12px; border: 1px solid rgba(0, 245, 255, 0.25); color: var(--secondary);">${data.icon}</div>
        <div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 12px; font-weight: 800; color: var(--secondary); letter-spacing: 1.5px; text-transform: uppercase;">MARCO ${data.number}</span>
            <span class="pill-live-badge" style="background: rgba(162, 89, 255, 0.15); color: #c084fc; border: 1px solid rgba(162, 89, 255, 0.3); font-size: 11px; padding: 2px 10px; border-radius: 12px;">${data.badge}</span>
          </div>
          <h3 style="font-size: 20px; font-weight: 800; color: var(--text); margin-top: 4px;">${data.phase}</h3>
        </div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-outline" style="font-size: 11px; padding: 6px 14px;" onclick="selectLifecycleStep(${stepNumber > 1 ? stepNumber - 1 : 10})">← Anterior</button>
        <button class="btn btn-primary" style="font-size: 11px; padding: 6px 14px;" onclick="selectLifecycleStep(${stepNumber < 10 ? stepNumber + 1 : 1})">Próximo →</button>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 24px; align-items: start;">
      <div>
        <h4 style="font-size: 13.5px; font-weight: 700; color: var(--secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Resumo Arquitetural</h4>
        <p style="font-size: 14px; color: #e2e8f0; line-height: 1.6; margin-bottom: 20px;">${data.summary}</p>

        <h4 style="font-size: 13.5px; font-weight: 700; color: var(--text); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">Responsabilidades &amp; Ações Desta Fase:</h4>
        <ul style="padding-left: 18px; margin-bottom: 20px; color: var(--text-muted); font-size: 13.5px; line-height: 1.7;">
          ${data.responsibilities.map(r => `<li style="margin-bottom: 6px;">${r}</li>`).join('')}
        </ul>

        <div style="padding: 14px; background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 10px; margin-bottom: 12px;">
          <div style="font-size: 12px; font-weight: 700; color: #10b981; margin-bottom: 4px;">🛡️ Garantias do Motor:</div>
          <div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">${data.guarantees}</div>
        </div>

        <div style="padding: 14px; background: rgba(255, 183, 3, 0.05); border: 1px solid rgba(255, 183, 3, 0.2); border-radius: 10px;">
          <div style="font-size: 12px; font-weight: 700; color: #fbbf24; margin-bottom: 4px;">💡 Dica de Ouro de Engenharia:</div>
          <div style="font-size: 13px; color: var(--text-muted); line-height: 1.5;">${data.proTip}</div>
        </div>
      </div>

      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">${data.codeTitle}</span>
          <span style="font-size: 11px; color: var(--secondary); font-family: monospace;">${data.codeType.toUpperCase()}</span>
        </div>
        <div class="editor-wrapper">
          <pre style="background: #020106; border: 1px solid var(--card-border); border-radius: 8px; padding: 16px; font-family: 'Fira Code', monospace; font-size: 12px; color: #e2e8f0; max-height: 380px; overflow-y: auto; line-height: 1.6; margin: 0;"><code>${typeof highlightCode === 'function' ? highlightCode(data.code, data.codeType) : data.code}</code></pre>
        </div>
      </div>
    </div>
  `;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
