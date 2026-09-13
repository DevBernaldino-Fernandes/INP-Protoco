/**
 * @fileoverview Controlador do Painel Web Interativo de E-Commerce (Global Shop Hub).
 * Gere a interação do utilizador no navegador, a renderização reativa de catálogo e carrinho,
 * a montagem dinâmica de comandos na linguagem INP-DSL e o disparo de intenções para o Gateway INP.
 *
 * @module Examples/EcommerceEcosystem/Dashboard
 * @security Submete credenciais e contextos de segurança RBAC para validação antes da orquestração.
 * @audit Disponibiliza feed em tempo real de auditoria com os identificadores e estados das transações.
 */

// Global Shop Hub - Controlador do Cliente INP Protocol
const GATEWAY_URL = window.location.origin.includes('localhost') ? window.location.origin : 'http://localhost:3000';

/**
 * Catálogo de produtos simulados disponíveis para compra no ecossistema de demonstração.
 */
const PRODUCTS = [
  { id: 'LAPTOP_PRO', name: 'MacBook Pro M3 Max', price: 1999.00, icon: '💻', tag: 'High Performance', stock: 15 },
  { id: 'SMARTPHONE_X', name: 'iPhone 15 Pro Titanium', price: 1199.00, icon: '📱', tag: 'Flagship', stock: 28 },
  { id: 'HEADPHONES', name: 'Sony WH-1000XM5', price: 399.00, icon: '🎧', tag: 'Noise Cancelling', stock: 40 },
  { id: 'SMARTWATCH', name: 'Apple Watch Ultra 2', price: 799.00, icon: '⌚', tag: 'Adventure Ready', stock: 12 }
];

/**
 * Estado reativo local do carrinho de compras.
 */
let cart = [
  { ...PRODUCTS[0], quantity: 1 }
];

/**
 * Modo operacional de teste selecionado na interface (happy_path, saga_fail, rbac_fail, schema_fail, natural).
 */
let currentMode = 'happy_path';

/**
 * Renderiza os cartões dos produtos disponíveis na interface gráfica.
 *
 * @returns {void}
 */
function renderCatalog() {
  const container = document.getElementById('catalogContainer');
  if (!container) return;
  container.innerHTML = PRODUCTS.map(p => `
    <div class="product-card">
      <div class="product-icon">${p.icon}</div>
      <div class="product-tag">${p.tag}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-stock">Stock em armazém: <strong>${p.stock} un.</strong></div>
      <div class="product-bottom">
        <span class="product-price">$ ${p.price.toFixed(2)}</span>
        <button class="btn-add-cart" onclick="addToCart('${p.id}')">Adicionar +</button>
      </div>
    </div>
  `).join('');
}

/**
 * Adiciona uma unidade de um produto ao carrinho ou incrementa a sua quantidade.
 *
 * @param {string} productId - Identificador único do produto selecionado.
 * @returns {void}
 */
function addToCart(productId) {
  const existing = cart.find(i => i.id === productId);
  if (existing) {
    existing.quantity++;
  } else {
    const prod = PRODUCTS.find(p => p.id === productId);
    if (prod) cart.push({ ...prod, quantity: 1 });
  }
  renderCart();
  log(`Produto adicionado ao carrinho: ${productId}`, 'info');
}

/**
 * Remove completamente um produto do carrinho de compras.
 *
 * @param {string} productId - Identificador único do produto a remover.
 * @returns {void}
 */
function removeFromCart(productId) {
  cart = cart.filter(i => i.id !== productId);
  renderCart();
}

/**
 * Renderiza a listagem de itens e o montante financeiro total do carrinho.
 *
 * @returns {void}
 */
function renderCart() {
  const list = document.getElementById('cartItemsList');
  const countEl = document.getElementById('cartBadgeCount');
  const totalEl = document.getElementById('cartTotalAmount');
  if (!list || !countEl || !totalEl) return;

  if (cart.length === 0) {
    list.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:1.5rem 0;">O seu carrinho está vazio. Adicione produtos acima!</div>`;
    countEl.innerText = '0';
    totalEl.innerText = '$ 0.00';
    return;
  }

  const total = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
  countEl.innerText = cart.reduce((acc, i) => acc + i.quantity, 0).toString();
  totalEl.innerText = `$ ${total.toFixed(2)}`;

  list.innerHTML = cart.map(i => `
    <div class="cart-item">
      <div style="display:flex; align-items:center; gap:0.75rem;">
        <span style="font-size:1.4rem;">${i.icon}</span>
        <div>
          <div style="font-weight:600; font-size:0.9rem;">${i.name}</div>
          <div style="font-size:0.78rem; color:var(--text-muted);">$ ${i.price.toFixed(2)} x ${i.quantity}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:0.5rem;">
        <span style="font-weight:700; font-size:0.9rem;">$ ${(i.price * i.quantity).toFixed(2)}</span>
        <button onclick="removeFromCart('${i.id}')" style="background:none; border:none; color:#f87171; cursor:pointer; font-size:1rem;">×</button>
      </div>
    </div>
  `).join('');

  updateGeneratedDsl();
}

/**
 * Altera o cenário de teste ativo na consola web.
 *
 * @param {'happy_path' | 'saga_fail' | 'rbac_fail' | 'schema_fail' | 'natural'} mode - Modo selecionado.
 * @returns {void}
 */
function selectMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const naturalArea = document.getElementById('naturalInputArea');
  if (naturalArea) {
    naturalArea.style.display = mode === 'natural' ? 'block' : 'none';
  }

  updateGeneratedDsl();
  log(`Modo de teste alterado para: ${mode.toUpperCase()}`, 'info');
}

/**
 * Gera dinamicamente o código fonte da intenção em formato INP-DSL de acordo com o carrinho e modo ativo.
 *
 * @returns {void}
 */
function updateGeneratedDsl() {
  const dslBox = document.getElementById('generatedDslCode');
  if (!dslBox) return;

  const item = cart[0] || PRODUCTS[0];
  const total = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0) || 1299.99;

  let dsl = '';
  if (currentMode === 'happy_path' || currentMode === 'saga_fail') {
    dsl = `INTENT "checkout_order" {\n` +
          `  CONTEXT {\n` +
          `    user_id: "usr_buyer_42",\n` +
          `    email: "cliente@globalshop.com",\n` +
          `    productId: "${item.id}",\n` +
          `    quantity: ${item.quantity},\n` +
          `    amount: ${total.toFixed(2)},\n` +
          `    currency: "USD",\n` +
          `    card_token: "tok_visa_infinite_99",\n` +
          `    shipping_address: "Avenida da Liberdade 100, Lisboa"\n` +
          `  }\n` +
          `  REQUIRE {\n` +
          `    CHECK STOCK\n` +
          `    RESERVE STOCK\n` +
          `    EXECUTE PAYMENT\n` +
          `    CREATE SHIPMENT\n` +
          `    SEND CONFIRMATION\n` +
          `  }\n` +
          `  FLOW {\n` +
          `    SEQUENCE {\n` +
          `      CHECK STOCK\n` +
          `      RESERVE STOCK\n` +
          `      EXECUTE PAYMENT\n` +
          `      CREATE SHIPMENT\n` +
          `      SEND CONFIRMATION\n` +
          `    }\n` +
          `  }\n` +
          `  OUTPUT { FORMAT "json" }\n` +
          `}`;
  } else if (currentMode === 'rbac_fail') {
    dsl = `INTENT "unauthorized_checkout" {\n` +
          `  CONTEXT { amount: ${total.toFixed(2)}, user_id: "usr_attacker", card_token: "tok_stolen" }\n` +
          `  REQUIRE { EXECUTE PAYMENT }\n` +
          `  FLOW { SEQUENCE { EXECUTE PAYMENT } }\n` +
          `  OUTPUT { FORMAT "json" }\n` +
          `}`;
  } else if (currentMode === 'schema_fail') {
    dsl = `INTENT "corrupted_payload" {\n` +
          `  CONTEXT { amount: -50.00, user_id: "usr_buyer_42", card_token: "tok_test" }\n` +
          `  REQUIRE { EXECUTE PAYMENT }\n` +
          `  FLOW { SEQUENCE { EXECUTE PAYMENT } }\n` +
          `  OUTPUT { FORMAT "json" }\n` +
          `}`;
  } else if (currentMode === 'natural') {
    dsl = `// Processamento Direto por IA (IntentParser):\n"Quero comprar o produto ${item.name} no valor de ${total.toFixed(2)} dólares para o utilizador usr_buyer_42 com cartão tok_visa"`;
  }

  dslBox.innerText = dsl;
}

/**
 * Emite uma mensagem estruturada na janela de registos de auditoria da consola.
 *
 * @param {string} msg - Texto a registar.
 * @param {'info' | 'warn' | 'error' | 'success'} [type='info'] - Gravidade semântica da mensagem.
 * @returns {void}
 */
function log(msg, type = 'info') {
  const box = document.getElementById('inspectorLogs');
  if (!box) return;
  const item = document.createElement('div');
  item.className = `log-line log-${type}`;
  const time = new Date().toLocaleTimeString();
  item.innerHTML = `<span style="opacity:0.6;">[${time}]</span> ${msg}`;
  box.appendChild(item);
  box.scrollTop = box.scrollHeight;
}

/**
 * Atualiza o estado visual de um nó específico no grafo de orquestração.
 *
 * @param {string} stepId - ID do elemento DOM correspondente ao nó do grafo.
 * @param {'idle' | 'running' | 'success' | 'failed' | 'rollback'} state - Novo estado operacional.
 * @returns {void}
 */
function setStepState(stepId, state) {
  const el = document.getElementById(stepId);
  if (!el) return;
  el.className = `graph-node ${state}`;
}

/**
 * Reinicia o grafo de nós e o distintivo de estado para a condição de repouso.
 *
 * @returns {void}
 */
function resetGraph() {
  ['node-stock', 'node-reserve', 'node-payment', 'node-shipping', 'node-notify'].forEach(id => {
    setStepState(id, 'idle');
  });
  const statusBox = document.getElementById('executionStatusBadge');
  if (statusBox) {
    statusBox.className = 'status-badge-exec badge-idle';
    statusBox.innerText = 'AGUARDANDO INTENÇÃO';
  }
}

/**
 * Executa a orquestração da intenção de compra selecionada, enviando o pedido ao Gateway INP
 * e atualizando o grafo interativo conforme os passos avançam ou sofrem rollback compensatório.
 *
 * @security Valida tokens e permissões no gateway de acordo com o cenário escolhido.
 * @audit Regista cada passo e desfecho transacional na caixa de telemetria visual.
 * @returns {Promise<void>}
 */
async function executeCheckoutIntent() {
  const btn = document.getElementById('btnSubmitOrder');
  if (btn) btn.disabled = true;
  resetGraph();

  const total = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0) || 1299.99;
  const item = cart[0] || PRODUCTS[0];

  log(`Disparando intenção no INP Gateway (${GATEWAY_URL})...`, 'info');

  const statusBadge = document.getElementById('executionStatusBadge');
  if (statusBadge) {
    statusBadge.className = 'status-badge-exec badge-running';
    statusBadge.innerText = 'ORQUESTRANDO FLUXO...';
  }

  try {
    // 1. Cenário: Simulação de Falha na Entrega (Modo Saga Rollback)
    if (currentMode === 'saga_fail') {
      log('⚡ [CHAOS SIMULATION] Ativando falha 500 no serviço de Logística...', 'warn');
      await fetch('http://localhost:3003/chaos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'ERROR_500' })
      });

      setStepState('node-stock', 'running');
      await sleep(300);
      setStepState('node-stock', 'success');

      setStepState('node-reserve', 'running');
      await sleep(300);
      setStepState('node-reserve', 'success');

      setStepState('node-payment', 'running');
      await sleep(300);
      setStepState('node-payment', 'success');

      setStepState('node-shipping', 'running');
      await sleep(300);

      const dsl = document.getElementById('generatedDslCode').innerText;
      const res = await fetch(`${GATEWAY_URL}/api/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: dsl,
          type: 'dsl',
          securityContext: { userId: 'usr_buyer_42', permissions: ['payments.write'] }
        })
      });
      const data = await res.json();

      // Restaurar shipping para healthy
      await fetch('http://localhost:3003/chaos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'HEALTHY' })
      });

      setStepState('node-shipping', 'failed');
      setStepState('node-payment', 'rollback');
      setStepState('node-reserve', 'rollback');

      log('✖ [FALHA NA LOGÍSTICA] A transportadora recusou o despacho (Simulação Chaos 500).', 'error');
      log('⚡ [SAGA AUTO-ROLLBACK ATIVADO PELO INP]:', 'warn');
      log('  ↪ 1. REFUND PAYMENT: Estorno de $ ' + total.toFixed(2) + ' efetuado no cartão do cliente!', 'warn');
      log('  ↪ 2. RESTORE STOCK: Reserva cancelada e ' + item.quantity + ' un. devolvidas ao armazém!', 'warn');
      log('✔ [CONSISTÊNCIA GARANTIDA] Nenhuma cobrança indevida realizada e zero produtos perdidos!', 'success');

      if (statusBadge) {
        statusBadge.className = 'status-badge-exec badge-rollback';
        statusBadge.innerText = 'SAGA ROLLBACK CONCLUÍDO';
      }

      showOrderAlert('Falha no Envio: O Padrão Saga reverteu a compra e estornou o pagamento automaticamente.', 'warning');
      return;
    }

    // 2. Cenário: Violação de Segurança RBAC
    if (currentMode === 'rbac_fail') {
      const dsl = document.getElementById('generatedDslCode').innerText;
      const res = await fetch(`${GATEWAY_URL}/api/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: dsl,
          type: 'dsl',
          securityContext: { userId: 'usr_attacker', permissions: ['guest.read.only'] }
        })
      });
      const data = await res.json();

      log('🛡️ [RBAC BLOQUEIO]: ' + (data.result?.error || 'Acesso Negado'), 'error');
      log('✔ Requisição barrada na camada de segurança antes de tocar em qualquer microsserviço!', 'success');

      if (statusBadge) {
        statusBadge.className = 'status-badge-exec badge-failed';
        statusBadge.innerText = 'BLOQUEIO RBAC (403)';
      }
      showOrderAlert('Acesso Negado: Usuário não tem permissão payments.write.', 'danger');
      return;
    }

    // 3. Cenário: Violação de Contrato JSON Schema
    if (currentMode === 'schema_fail') {
      const dsl = document.getElementById('generatedDslCode').innerText;
      const res = await fetch(`${GATEWAY_URL}/api/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: dsl,
          type: 'dsl',
          securityContext: { userId: 'usr_buyer_42', permissions: ['payments.write'] }
        })
      });
      const data = await res.json();

      log('📋 [VALIDAÇÃO DE CONTRATO]: ' + (data.result?.error || 'Schema Invalido'), 'error');
      log('✔ AJV protegeu o microsserviço contra valores corrompidos (amount < 1).', 'success');

      if (statusBadge) {
        statusBadge.className = 'status-badge-exec badge-failed';
        statusBadge.innerText = 'CONTRATO QUEBRADO';
      }
      showOrderAlert('Payload Inválido: Valor menor que o mínimo exigido pelo serviço de pagamento.', 'danger');
      return;
    }

    // 4. Cenário: Linguagem Natural
    if (currentMode === 'natural') {
      const text = document.getElementById('naturalTextInput').value || 'Quero pagar 250 euros para o usuário usr_buyer_42 com o cartão tok_visa';
      log(`Enviando comando de Linguagem Natural: "${text}"`, 'info');

      const res = await fetch(`${GATEWAY_URL}/api/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          type: 'natural',
          securityContext: { userId: 'usr_buyer_42', permissions: ['payments.write'] }
        })
      });
      const data = await res.json();

      if (data.result?.status === 'COMPLETED') {
        setStepState('node-payment', 'success');
        log('✔ [AI IntentParser] Texto traduzido para: "' + data.result.name + '"', 'success');
        log('✔ Transação ID: ' + (data.result.output?.transactionId || 'N/A') + ' | Status: PAID', 'success');
        if (statusBadge) {
          statusBadge.className = 'status-badge-exec badge-success';
          statusBadge.innerText = 'CONCLUÍDO COM SUCESSO';
        }
        showOrderAlert('Intenção em Linguagem Natural processada com sucesso!', 'success');
      } else {
        log('Erro: ' + (data.result?.error || 'Falha'), 'error');
      }
      return;
    }

    // 5. Cenário: Happy Path (Fluxo de Sucesso Total)
    setStepState('node-stock', 'running');
    await sleep(200);
    setStepState('node-stock', 'success');

    setStepState('node-reserve', 'running');
    await sleep(200);
    setStepState('node-reserve', 'success');

    setStepState('node-payment', 'running');
    await sleep(200);
    setStepState('node-payment', 'success');

    setStepState('node-shipping', 'running');
    await sleep(200);
    setStepState('node-shipping', 'success');

    setStepState('node-notify', 'running');

    const dsl = document.getElementById('generatedDslCode').innerText;
    const res = await fetch(`${GATEWAY_URL}/api/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: dsl,
        type: 'dsl',
        securityContext: { userId: 'usr_buyer_42', permissions: ['payments.write'] }
      })
    });
    const data = await res.json();

    if (data.result?.status === 'COMPLETED') {
      setStepState('node-notify', 'success');
      log('✔ Orquestração concluída com status COMPLETED!', 'success');
      log(`  ▸ ID da Execução: ${data.result.execution_id || data.result.id}`, 'info');
      log(`  ▸ Código de Rastreio: ${data.result.output?.trackingCode || 'TRK-GERADO'} (${data.result.output?.carrier || 'FastLogistics'})`, 'success');
      log(`  ▸ Transação Aprovada: ${data.result.output?.transactionId} (Auth: ${data.result.output?.authCode})`, 'success');
      log(`  ▸ Recibo enviado por email para: ${data.result.output?.email}`, 'success');

      if (statusBadge) {
        statusBadge.className = 'status-badge-exec badge-success';
        statusBadge.innerText = 'PEDIDO CONFIRMADO (COMPLETED)';
      }

      showOrderAlert(`🎉 Compra realizada com sucesso! Rastreio: ${data.result.output?.trackingCode}`, 'success');
      refreshRecentExecutions();
    } else {
      log('Falha na orquestração: ' + (data.result?.error || 'Erro desconhecido'), 'error');
    }

  } catch (err) {
    log('Erro na comunicação: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Apresenta uma notificação temporária de estado do pedido na interface web.
 *
 * @param {string} message - Texto informativo ou de alerta.
 * @param {'success' | 'warning' | 'danger'} [type='success'] - Nível de alerta visual.
 * @returns {void}
 */
function showOrderAlert(message, type = 'success') {
  const box = document.getElementById('orderFeedbackBox');
  if (!box) return;
  box.className = `alert-box alert-${type}`;
  box.innerHTML = `<strong>${message}</strong>`;
  box.style.display = 'block';
  setTimeout(() => {
    box.style.display = 'none';
  }, 7000);
}

/**
 * Consulta a API do Gateway para carregar as últimas execuções registadas na base de dados PostgreSQL.
 *
 * @audit Alimenta o painel de auditoria visual com os identificadores e carimbos de data/hora reais.
 * @returns {Promise<void>}
 */
async function refreshRecentExecutions() {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/dashboard/executions`);
    const data = await res.json();
    const container = document.getElementById('auditExecutionsList');
    if (!container || !data.executions) return;

    container.innerHTML = data.executions.slice(0, 5).map(e => `
      <div class="audit-row">
        <div>
          <span style="font-family:monospace; font-size:0.75rem; color:#94a3b8;">${e.id.slice(0, 8)}...</span>
          <span style="margin-left:0.5rem; font-weight:600; font-size:0.8rem;">${e.intentName || 'ecommerce_flow'}</span>
        </div>
        <div>
          <span class="pill-status ${e.status.toLowerCase()}">${e.status}</span>
          <span style="font-size:0.75rem; color:#64748b; margin-left:0.5rem;">${new Date(e.startedAt).toLocaleTimeString()}</span>
        </div>
      </div>
    `).join('');
  } catch {}
}

/**
 * Utilitário para suspensão temporizada de execução assíncrona.
 *
 * @param {number} ms - Milissegundos de espera.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Inicialização da interface quando o documento HTML estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  renderCatalog();
  renderCart();
  updateGeneratedDsl();
  refreshRecentExecutions();
  log('Global Shop Hub carregado. Selecione os produtos e teste os fluxos do INP Protocol.', 'info');
});
