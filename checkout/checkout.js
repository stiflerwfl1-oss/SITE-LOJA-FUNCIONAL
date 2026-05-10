const API = "/api";
const LS_KEY = "t7_cart_id";

function moneyBRL(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function api(path, opts) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts?.headers || {}) }
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
  const params = new URLSearchParams(window.location.search || "");
  const fromQuery = params.get("cart");
  if (fromQuery) return fromQuery;
  return localStorage.getItem(LS_KEY) || "";
}

function renderCart(cart) {
  const items = cart?.items || [];
  const itemsEl = document.getElementById("items");
  const emptyEl = document.getElementById("empty");
  const payBtn = document.getElementById("payBtn");
  itemsEl.innerHTML = "";

  if (!items.length) {
    emptyEl.style.display = "";
    payBtn.disabled = true;
    document.getElementById("subtotal").textContent = moneyBRL(0);
    document.getElementById("total").textContent = moneyBRL(0);
    return;
  }

  emptyEl.style.display = "none";
  payBtn.disabled = false;
  let subtotal = 0;

  for (const it of items) {
    const line = Number(it.price_cents || 0) * Number(it.qty || 0);
    subtotal += line;
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="thumb">${it.image_url ? `<img src="${it.image_url}" alt="">` : ""}</div>
      <div>
        <div class="name">${it.name || "Produto"}</div>
        <div class="meta">${it.slug || ""}</div>
      </div>
      <div>
        <div class="price">${moneyBRL(line / 100)}</div>
        <div class="qty">Qtd: ${it.qty}</div>
      </div>
    `;
    itemsEl.appendChild(row);
  }

  document.getElementById("subtotal").textContent = moneyBRL(subtotal / 100);
  document.getElementById("total").textContent = moneyBRL(subtotal / 100);
}

function showAlert(message) {
  const el = document.getElementById("alert");
  el.textContent = message;
  el.style.display = "";
}

async function loadCart() {
  const cartId = getCartId();
  if (!cartId) {
    showAlert("Carrinho nao encontrado.");
    renderCart({ items: [] });
    return null;
  }
  const cart = await api(`/cart/${encodeURIComponent(cartId)}`);
  renderCart(cart);
  return cartId;
}

async function payNow(cartId) {
  const order = await api("/orders", { method: "POST", body: JSON.stringify({ cartId }) });
  const pay = await api("/payments/mercadopago", { method: "POST", body: JSON.stringify({ orderId: order.id }) });
  const url = pay.initPoint || pay.sandboxInitPoint;
  if (!url) throw new Error("missing_checkout_url");
  window.location.href = url;
}

let currentCartId = "";
loadCart()
  .then((id) => {
    currentCartId = id || "";
  })
  .catch((e) => {
    showAlert(`Erro ao carregar checkout: ${e.message}`);
    renderCart({ items: [] });
  });

document.getElementById("payBtn").addEventListener("click", async () => {
  try {
    if (!currentCartId) throw new Error("cart_not_found");
    await payNow(currentCartId);
  } catch (e) {
    showAlert(`Erro no pagamento: ${e.message}`);
  }
});
