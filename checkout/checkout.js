const API = "/api";
const CART_ID_KEY = "t7_cart_id";
const CART_ITEMS_KEYS = ["t7_cart", "tech7_cart", "cart"];
const PIX_KEY = "contato@loja.com.br";
const PIX_SECONDS = 15 * 60;

let carrinho = [];
let etapaAtual = 1;
let timerHandle = null;
let timerRestante = PIX_SECONDS;
let dadosPedido = null;

function moneyBRL(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function centsFromItem(item) {
  if (Number.isFinite(Number(item.price_cents))) return Number(item.price_cents);
  if (Number.isFinite(Number(item.preco))) return Math.round(Number(item.preco) * 100);
  if (Number.isFinite(Number(item.price))) return Math.round(Number(item.price) * 100);
  return 0;
}

function normalizeItem(item) {
  return {
    id: item.product_id || item.id || item.slug || crypto.randomUUID(),
    nome: item.name || item.nome || "Produto",
    preco: centsFromItem(item) / 100,
    qty: Math.max(1, Number(item.qty || item.quantidade || 1)),
    img: item.image_url || item.img || item.image || "",
    variacao: item.slug || item.variacao || item.variation || ""
  };
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) }
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(json?.error || `http_${res.status}`);
    err.details = json;
    throw err;
  }
  return json;
}

function getCartId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("cart") || localStorage.getItem(CART_ID_KEY) || "";
}

function getLocalCartKey() {
  return CART_ITEMS_KEYS.find((key) => {
    try {
      return Array.isArray(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch {
      return false;
    }
  }) || CART_ITEMS_KEYS[0];
}

function readLocalCart() {
  const key = getLocalCartKey();
  try {
    return JSON.parse(localStorage.getItem(key) || "[]").map(normalizeItem);
  } catch {
    return [];
  }
}

async function loadCart() {
  const cartId = getCartId();
  if (cartId) {
    try {
      const cart = await api(`/cart/${encodeURIComponent(cartId)}`);
      carrinho = (cart.items || []).map(normalizeItem);
      return;
    } catch {
      carrinho = readLocalCart();
      return;
    }
  }
  carrinho = readLocalCart();
}

function subtotal() {
  return carrinho.reduce((sum, item) => sum + Number(item.preco || 0) * Number(item.qty || 0), 0);
}

function renderSummary() {
  const itemsEl = document.getElementById("summary-items");
  itemsEl.innerHTML = "";

  if (!carrinho.length) {
    itemsEl.innerHTML = `<p style="color:var(--tech-text-muted);margin:0">Nenhum item no carrinho.</p>`;
  }

  carrinho.forEach((item) => {
    const row = document.createElement("div");
    row.className = "summary-item";
    row.innerHTML = `
      ${item.img ? `<img src="${item.img}" alt="${item.nome}" width="48" height="48" loading="lazy">` : `<span class="summary-thumb"><i data-lucide="package" aria-hidden="true"></i></span>`}
      <div>
        <strong>${item.nome}</strong>
        <span>Qtd: ${item.qty}</span>
      </div>
      <strong>${moneyBRL(item.preco * item.qty)}</strong>
    `;
    itemsEl.appendChild(row);
  });

  const total = subtotal();
  document.getElementById("summary-subtotal").textContent = moneyBRL(total);
  document.getElementById("summary-total").textContent = moneyBRL(total);
  if (window.lucide) window.lucide.createIcons();
}

function updateStepper() {
  document.querySelectorAll("[data-step-indicator]").forEach((step) => {
    const number = Number(step.dataset.stepIndicator);
    step.classList.toggle("is-active", number === etapaAtual);
    step.classList.toggle("is-done", number < etapaAtual);
    const circle = step.querySelector(".step__circle");
    circle.innerHTML = number < etapaAtual ? `<i data-lucide="check" aria-hidden="true"></i>` : String(number);
  });

  document.querySelectorAll("[data-step-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", Number(panel.dataset.stepPanel) === etapaAtual);
  });

  document.getElementById("summary-payment-row").style.display = etapaAtual >= 2 ? "flex" : "none";
  if (window.lucide) window.lucide.createIcons();
}

function goToStep(step) {
  etapaAtual = step;
  updateStepper();
  if (step === 2) startPixTimer();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function maskPhone(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function maskCep(value) {
  const digits = onlyDigits(value).slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function setFieldError(input, message) {
  const errorEl = document.querySelector(`[data-error-for="${input.id}"]`);
  if (errorEl) errorEl.textContent = message || "";
  input.setAttribute("aria-invalid", message ? "true" : "false");
}

function validateDelivery() {
  const form = document.getElementById("form-entrega");
  const fields = [...form.querySelectorAll("input[required]")];
  let valid = true;

  fields.forEach((input) => {
    let message = "";
    if (!input.value.trim()) message = "Campo obrigatório.";
    if (!message && input.type === "email" && !input.validity.valid) message = "E-mail inválido.";
    if (!message && input.id === "campo-telefone" && onlyDigits(input.value).length < 10) message = "Telefone inválido.";
    if (!message && input.id === "campo-cep" && onlyDigits(input.value).length !== 8) message = "CEP inválido.";
    setFieldError(input, message);
    if (message) valid = false;
  });

  return valid;
}

async function buscarCep() {
  const cepInput = document.getElementById("campo-cep");
  const cep = onlyDigits(cepInput.value);
  if (cep.length !== 8) return;

  setFieldError(cepInput, "");
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await res.json();
    if (data.erro) {
      setFieldError(cepInput, "CEP não encontrado.");
      return;
    }
    document.getElementById("campo-logradouro").value = data.logradouro || "";
    document.getElementById("campo-bairro").value = data.bairro || "";
    document.getElementById("campo-cidade").value = data.localidade || "";
    document.getElementById("campo-estado").value = data.uf || "";
    ["campo-logradouro", "campo-bairro", "campo-cidade", "campo-estado"].forEach((id) => {
      setFieldError(document.getElementById(id), "");
    });
  } catch {
    setFieldError(cepInput, "Não foi possível buscar o CEP agora.");
  }
}

function montarDadosPedido(metodoPagamento = "pix") {
  dadosPedido = {
    itens: carrinho,
    subtotal: subtotal(),
    frete: 0,
    total: subtotal(),
    cliente: {
      nome: document.getElementById("campo-nome").value.trim(),
      email: document.getElementById("campo-email").value.trim(),
      cpf: "",
      telefone: document.getElementById("campo-telefone").value.trim()
    },
    entrega: {
      cep: document.getElementById("campo-cep").value.trim(),
      logradouro: document.getElementById("campo-logradouro").value.trim(),
      numero: document.getElementById("campo-numero").value.trim(),
      complemento: document.getElementById("campo-complemento").value.trim(),
      bairro: document.getElementById("campo-bairro").value.trim(),
      cidade: document.getElementById("campo-cidade").value.trim(),
      estado: document.getElementById("campo-estado").value.trim(),
      metodo: "uber",
      prazo: "A combinar"
    },
    metodoPagamento,
    criadoEm: new Date().toISOString()
  };
  return dadosPedido;
}

function renderPixQrCode() {
  const img = document.getElementById("pix-qrcode");
  const total = moneyBRL(subtotal());
  const data = encodeURIComponent(`PIX ${PIX_KEY} TECH 7 ${total}`);
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${data}`;
}

function startPixTimer() {
  if (timerHandle) return;
  timerRestante = PIX_SECONDS;
  renderPixQrCode();
  updateTimer();
  timerHandle = window.setInterval(() => {
    timerRestante = Math.max(0, timerRestante - 1);
    updateTimer();
    if (timerRestante <= 0) window.clearInterval(timerHandle);
  }, 1000);
}

function updateTimer() {
  const minutes = String(Math.floor(timerRestante / 60)).padStart(2, "0");
  const seconds = String(timerRestante % 60).padStart(2, "0");
  document.getElementById("timer-text").textContent = `${minutes}:${seconds}`;
  document.getElementById("timer-bar").style.width = `${(timerRestante / PIX_SECONDS) * 100}%`;
}

async function copyPixKey() {
  const btn = document.getElementById("btn-copiar-pix");
  const input = document.getElementById("pix-codigo");
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand("copy");
  }
  btn.innerHTML = `<i data-lucide="check-circle" aria-hidden="true"></i> Copiado!`;
  if (window.lucide) window.lucide.createIcons();
  window.setTimeout(() => {
    btn.innerHTML = `<i data-lucide="copy" aria-hidden="true"></i> Copiar chave`;
    if (window.lucide) window.lucide.createIcons();
  }, 2000);
}

async function processarPIX(pedido) {
  // TODO: integrar API de pagamento PIX aqui.
  // Enviar dadosPedido para o endpoint da API.
  // Receber: { qrCodeUrl, codigoPix, expiresIn }.
  // Preencher #pix-qrcode-container com a imagem do QR Code.
  // Preencher #pix-codigo com o código copia-e-cola.
  // Iniciar webhook/polling para confirmar pagamento.
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  return { status: "aguardando_confirmacao", pedido };
}

function finalizarPedido() {
  const pedido = montarDadosPedido("pix");
  processarPIX(pedido).then(() => {
    const numero = `#${new Date().getFullYear()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    document.getElementById("numero-pedido").textContent = numero;
    document.getElementById("confirmacao-cliente").textContent = `${pedido.cliente.nome} - ${pedido.cliente.telefone}`;
    document.getElementById("confirmacao-endereco").textContent =
      `${pedido.entrega.logradouro}, ${pedido.entrega.numero}` +
      `${pedido.entrega.complemento ? ` - ${pedido.entrega.complemento}` : ""}` +
      ` - ${pedido.entrega.bairro}, ${pedido.entrega.cidade}/${pedido.entrega.estado}`;
    localStorage.removeItem(CART_ID_KEY);
    CART_ITEMS_KEYS.forEach((key) => localStorage.removeItem(key));
    goToStep(3);
  });
}

function handleDeliverySubmit(event) {
  event.preventDefault();
  if (!validateDelivery()) return;
  montarDadosPedido("pix");
  goToStep(2);
}

function initMasks() {
  const phone = document.getElementById("campo-telefone");
  const cep = document.getElementById("campo-cep");
  phone.addEventListener("input", () => {
    phone.value = maskPhone(phone.value);
  });
  cep.addEventListener("input", () => {
    cep.value = maskCep(cep.value);
  });
  cep.addEventListener("blur", buscarCep);
}

function bindEvents() {
  document.getElementById("form-entrega").addEventListener("submit", handleDeliverySubmit);
  document.getElementById("btn-voltar-entrega").addEventListener("click", () => goToStep(1));
  document.getElementById("btn-copiar-pix").addEventListener("click", copyPixKey);
  document.getElementById("btn-confirmar-pix").addEventListener("click", finalizarPedido);
}

async function init() {
  await loadCart();
  renderSummary();
  initMasks();
  bindEvents();
  document.getElementById("pix-codigo").value = PIX_KEY;

  if (!carrinho.length) {
    document.querySelectorAll("[data-step-panel]").forEach((panel) => {
      panel.classList.remove("is-active");
    });
    document.getElementById("empty-checkout").style.display = "block";
  }

  if (window.lucide) window.lucide.createIcons();
}

init();
