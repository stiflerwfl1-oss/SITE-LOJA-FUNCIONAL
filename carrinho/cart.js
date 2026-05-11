const API = "/api";
const CART_ID_KEY = "t7_cart_id";
const CART_ITEMS_KEYS = ["t7_cart", "tech7_cart", "cart"];

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
  const id = item.product_id || item.id || item.slug || crypto.randomUUID();
  return {
    product_id: id,
    id,
    name: item.name || item.nome || "Produto",
    slug: item.slug || item.variacao || item.variation || "",
    image_url: item.image_url || item.img || item.image || "",
    price_cents: centsFromItem(item),
    qty: Math.max(1, Number(item.qty || item.quantidade || 1))
  };
}

function getLocalCartKey() {
  return CART_ITEMS_KEYS.find((key) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value);
    } catch {
      return false;
    }
  }) || CART_ITEMS_KEYS[0];
}

function readLocalCart() {
  const key = getLocalCartKey();
  try {
    return {
      id: "local",
      source: "local",
      items: JSON.parse(localStorage.getItem(key) || "[]").map(normalizeItem)
    };
  } catch {
    return { id: "local", source: "local", items: [] };
  }
}

function writeLocalCart(items) {
  const key = getLocalCartKey();
  const payload = items.map((item) => ({
    id: item.product_id,
    nome: item.name,
    preco: item.price_cents / 100,
    qty: item.qty,
    img: item.image_url,
    variacao: item.slug
  }));
  localStorage.setItem(key, JSON.stringify(payload));
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

async function ensureCart() {
  const existing = localStorage.getItem(CART_ID_KEY);
  if (existing) return existing;
  return "";
}

function showError(message) {
  const el = document.getElementById("cartError");
  if (!el) return;
  el.textContent = message;
  el.style.display = message ? "block" : "none";
}

function setLoading(isLoading) {
  const skeleton = document.getElementById("cartSkeleton");
  if (skeleton) skeleton.style.display = isLoading ? "grid" : "none";
}

function updateHeaderCount(items) {
  const count = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const badge = document.getElementById("headerCartCount");
  const label = document.getElementById("cartCountLabel");
  if (badge) badge.textContent = String(count);
  if (label) label.textContent = count === 1 ? "1 item" : `${count} itens`;
}

function render(cart) {
  const itemsEl = document.getElementById("items");
  const emptyEl = document.getElementById("empty");
  const cartIdLabel = document.getElementById("cartIdLabel");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const items = (cart?.items || []).map(normalizeItem);

  cartIdLabel.textContent = cart?.id && cart.id !== "local" ? `ID: ${cart.id}` : "";
  itemsEl.innerHTML = "";
  emptyEl.style.display = items.length ? "none" : "grid";
  checkoutBtn.disabled = items.length === 0;
  updateHeaderCount(items);

  let subtotal = 0;
  for (const item of items) {
    const line = item.price_cents * item.qty;
    subtotal += line;

    const row = document.createElement("article");
    row.className = "cart-item";
    row.dataset.productId = item.product_id;
    row.innerHTML = `
      <div class="cart-thumb">
        ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" width="80" height="80" loading="lazy">` : `<i data-lucide="package" aria-hidden="true"></i>`}
      </div>
      <div class="cart-item__body">
        <div class="cart-item__main">
          <div class="cart-item__name">${item.name}</div>
          <div class="cart-item__variation">${item.slug || "Variação padrão"}</div>
          <div class="cart-item__price">${moneyBRL(item.price_cents / 100)} un.</div>
        </div>
        <div class="cart-item__actions">
          <div class="qty-control" aria-label="Quantidade">
            <button type="button" data-dec aria-label="Diminuir quantidade">-</button>
            <input type="number" min="0" max="99" inputmode="numeric" value="${item.qty}" data-qty aria-label="Quantidade de ${item.name}">
            <button type="button" data-inc aria-label="Aumentar quantidade">+</button>
          </div>
          <button class="remove-btn" type="button" data-remove aria-label="Remover ${item.name}">
            <i data-lucide="trash-2" aria-hidden="true"></i>
            Remover
          </button>
        </div>
      </div>
    `;

    const qtyInput = row.querySelector("[data-qty]");
    row.querySelector("[data-dec]").addEventListener("click", () => setQty(cart, item.product_id, Number(qtyInput.value) - 1, row));
    row.querySelector("[data-inc]").addEventListener("click", () => setQty(cart, item.product_id, Number(qtyInput.value) + 1, row));
    row.querySelector("[data-remove]").addEventListener("click", () => setQty(cart, item.product_id, 0, row));
    qtyInput.addEventListener("change", () => setQty(cart, item.product_id, Number(qtyInput.value), row));
    itemsEl.appendChild(row);
  }

  document.getElementById("subtotal").textContent = moneyBRL(subtotal / 100);
  document.getElementById("total").textContent = moneyBRL(subtotal / 100);
  if (window.lucide) window.lucide.createIcons();
}

let activeCart = null;
let inflight = null;

async function loadApiCart() {
  const cartId = await ensureCart();
  if (!cartId) throw new Error("cart_id_not_found");
  const cart = await api(`/cart/${encodeURIComponent(cartId)}`);
  return { ...cart, source: "api" };
}

async function refresh() {
  setLoading(true);
  showError("");
  try {
    activeCart = await loadApiCart();
  } catch {
    activeCart = readLocalCart();
  } finally {
    setLoading(false);
  }
  render(activeCart);
  return activeCart;
}

async function setQty(cart, productId, qty, row) {
  const nextQty = Math.max(0, Math.min(99, Number(qty || 0)));
  if (nextQty === 0 && row) row.classList.add("is-removing");

  if (cart?.source === "api" && cart.id) {
    inflight = api(`/cart/${encodeURIComponent(cart.id)}/items`, {
      method: "PUT",
      body: JSON.stringify({ productId, qty: nextQty })
    })
      .then((nextCart) => {
        activeCart = { ...nextCart, source: "api" };
        render(activeCart);
      })
      .catch((error) => {
        showError(`Erro ao atualizar carrinho: ${error.message}`);
        render(activeCart);
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  const items = (activeCart?.items || []).map(normalizeItem);
  const nextItems = items
    .map((item) => item.product_id === productId ? { ...item, qty: nextQty } : item)
    .filter((item) => item.qty > 0);
  writeLocalCart(nextItems);
  activeCart = { id: "local", source: "local", items: nextItems };
  window.setTimeout(() => render(activeCart), nextQty === 0 ? 180 : 0);
}

async function checkout() {
  if (activeCart?.source === "api" && activeCart.id) {
    window.location.href = `../checkout/index.html?cart=${encodeURIComponent(activeCart.id)}`;
    return;
  }
  window.location.href = "../checkout/index.html";
}

async function addDemo() {
  try {
    const existingCartId = localStorage.getItem(CART_ID_KEY);
    if (!existingCartId) throw new Error("local_mode");
    const prod = await api("/products?limit=1&offset=0");
    const p = prod.items?.[0];
    if (!p) throw new Error("catalogo_vazio");
    await api(`/cart/${encodeURIComponent(existingCartId)}/items`, {
      method: "PUT",
      body: JSON.stringify({ productId: p.id, qty: 1 })
    });
    await refresh();
  } catch {
    const cart = readLocalCart();
    const items = cart.items;
    items.push(normalizeItem({
      id: "demo-display",
      nome: "Display frontal compatível",
      preco: 189.9,
      qty: 1,
      img: "../logo.png",
      variacao: "Compatível com modelos selecionados"
    }));
    writeLocalCart(items);
    activeCart = { id: "local", source: "local", items };
    render(activeCart);
  }
}

document.getElementById("checkoutBtn").addEventListener("click", async () => {
  if (inflight) await inflight;
  await checkout();
});

document.getElementById("addDemoBtn").addEventListener("click", addDemo);

window.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) window.lucide.createIcons();
});

refresh().catch((error) => {
  setLoading(false);
  showError(`Erro ao carregar carrinho: ${error.message}`);
  activeCart = readLocalCart();
  render(activeCart);
});
