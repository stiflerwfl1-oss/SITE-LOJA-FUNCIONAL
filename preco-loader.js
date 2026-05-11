(function() {
  var API = '/api';
  var LS_KEY = 't7_cart_id';
  var LOCAL_CART_KEY = 't7_cart';
  var CART_KEYS = ['t7_cart', 'tech7_cart', 'cart'];

  function safeJson(res) {
    return res.text().then(function(text) {
      try { return JSON.parse(text); } catch (_) { return { raw: text }; }
    });
  }

  function api(path, opts) {
    return fetch(API + path, Object.assign({
      headers: { 'content-type': 'application/json' }
    }, opts || {})).then(function(res) {
      return safeJson(res).then(function(json) {
        if (!res.ok) {
          var err = new Error((json && json.error) || ('http_' + res.status));
          err.details = json;
          throw err;
        }
        return json;
      });
    });
  }

  function ensureCart() {
    var existing = localStorage.getItem(LS_KEY);
    if (existing) return Promise.resolve(existing);
    return Promise.reject(new Error('local_cart_mode'));
  }

  function onlyNumber(value) {
    var n = Number(String(value || '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function moneyBRL(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function getLocalCartKey() {
    for (var i = 0; i < CART_KEYS.length; i++) {
      try {
        var parsed = JSON.parse(localStorage.getItem(CART_KEYS[i]) || '[]');
        if (Array.isArray(parsed)) return CART_KEYS[i];
      } catch (_) {}
    }
    return LOCAL_CART_KEY;
  }

  function readLocalCart() {
    try {
      var parsed = JSON.parse(localStorage.getItem(getLocalCartKey()) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeLocalCart(items) {
    localStorage.setItem(getLocalCartKey(), JSON.stringify(items));
    syncCartUi(items);
  }

  function normalizePath(src) {
    if (!src) return '';
    if (/^https?:\/\//i.test(src) || src.indexOf('data:') === 0) return src;
    try {
      return new URL(src, window.location.href).pathname;
    } catch (_) {
      return src;
    }
  }

  function extractSelectedVariation(form) {
    var selects = form ? form.querySelectorAll('select') : [];
    var values = [];
    selects.forEach(function(select) {
      if (select.value) values.push(select.value);
    });
    return values.join(' / ');
  }

  function extractVariantPrice(form, fallbackPrice) {
    var variation = extractSelectedVariation(form);
    var raw = form && form.getAttribute('data-variants');
    if (!raw || !variation) return fallbackPrice;
    try {
      var variants = JSON.parse(raw);
      var found = variants.find(function(item) { return String(item.option || '') === variation; });
      if (found && found.price && Number.isFinite(Number(found.price.price))) return Number(found.price.price);
    } catch (_) {}
    return fallbackPrice;
  }

  function parseVisiblePrice(root) {
    var inputPrice = document.getElementById('preco_atual');
    if (inputPrice && inputPrice.value) return onlyNumber(inputPrice.value);
    var visible = root && root.querySelector('.price-off, .current-price, .woocommerce-Price-amount, #variacaoPreco');
    return visible ? onlyNumber(visible.textContent || visible.innerText) : 0;
  }

  function extractProductFromForm(form, href) {
    var product = form.closest('.product') || document;
    var nameEl = product.querySelector('.product-name, h1.product-name, h1, [itemprop="name"]');
    var imgEl = product.querySelector('img[data-src], img[src]');
    var fallbackPrice = parseVisiblePrice(product);
    var variation = extractSelectedVariation(form);
    var id = form.getAttribute('data-id') || href || window.location.pathname;

    return {
      id: String(id) + (variation ? ':' + variation : ''),
      nome: (nameEl && (nameEl.textContent || nameEl.innerText) || document.title || 'Produto').trim(),
      preco: extractVariantPrice(form, fallbackPrice),
      qty: 1,
      img: normalizePath((imgEl && (imgEl.getAttribute('data-src') || imgEl.getAttribute('src'))) || ''),
      variacao: variation || ((parseProductRouteFromPath(href) || {}).slug) || ''
    };
  }

  function addLocalCartItem(item, qty) {
    var items = readLocalCart();
    var existing = items.find(function(it) { return String(it.id) === String(item.id); });
    if (existing) {
      existing.qty = Math.max(1, Math.min(99, Number(existing.qty || 0) + qty));
      existing.nome = existing.nome || item.nome;
      existing.preco = Number(existing.preco || item.preco || 0);
      existing.img = existing.img || item.img;
      existing.variacao = existing.variacao || item.variacao;
    } else {
      items.push(Object.assign({}, item, { qty: qty }));
    }
    writeLocalCart(items);
    return items;
  }

  function getCartCount(items) {
    return (items || readLocalCart()).reduce(function(total, item) {
      return total + Number(item.qty || item.quantidade || 0);
    }, 0);
  }

  function getCartTotal(items) {
    return (items || readLocalCart()).reduce(function(total, item) {
      return total + Number(item.preco || item.price || 0) * Number(item.qty || item.quantidade || 0);
    }, 0);
  }

  function syncCartUi(items) {
    var count = getCartCount(items);
    var total = getCartTotal(items);
    document.querySelectorAll('[data-cart="amount"], .cart-header .number, #headerCartCount').forEach(function(el) {
      el.textContent = String(count);
      el.style.display = count ? '' : '';
    });
    document.querySelectorAll('.cart-sidebar .total .value, #subtotal, #total').forEach(function(el) {
      el.textContent = moneyBRL(total);
    });
    window.dispatchEvent(new CustomEvent('t7:cart-updated', { detail: { items: items || readLocalCart(), count: count, total: total } }));
  }

  function setButtonFeedback(button, text) {
    if (!button) return;
    var old = button.textContent;
    button.textContent = text;
    button.disabled = true;
    setTimeout(function() {
      button.textContent = old;
      button.disabled = false;
    }, 900);
  }

  function parseProductRouteFromPath(rawPath) {
    var clean = String(rawPath || '').replace(/^https?:\/\/[^/]+/i, '');
    var parts = clean.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts[parts.length - 1] === 'index.html' || parts[parts.length - 1] === 'index.htm') parts.pop();
    if (parts.length < 3) return null;
    return {
      section: parts[parts.length - 3],
      brand: parts[parts.length - 2],
      slug: parts[parts.length - 1]
    };
  }

  function resolveByHref(href) {
    var info = parseProductRouteFromPath(href);
    if (!info) return Promise.reject(new Error('invalid_product_route'));
    var q = '?section=' + encodeURIComponent(info.section) + '&brand=' + encodeURIComponent(info.brand) + '&slug=' + encodeURIComponent(info.slug);
    return api('/products/resolve' + q);
  }

  function redirectLegacyCartLinks() {
    var links = document.querySelectorAll('a[href*="redirect_cart_service.php"]');
    links.forEach(function(link) {
      link.setAttribute('href', '/carrinho/index.html');
    });
  }

  function bindProductForms() {
    var forms = document.querySelectorAll('form[data-api-cart="1"]');
    if (!forms.length) return;

    forms.forEach(function(form) {
      if (form.dataset.t7CartBound === '1') return;
      form.dataset.t7CartBound = '1';

      form.addEventListener('submit', function(ev) {
        ev.preventDefault();

        var qtyInput = form.querySelector('input[type="number"]');
        var qty = Number((qtyInput && qtyInput.value) || 1);
        if (!Number.isFinite(qty) || qty < 1) qty = 1;
        if (qty > 99) qty = 99;

        var nearestProduct = form.closest('.product');
        var href = '';
        if (nearestProduct) {
          var productLink = nearestProduct.querySelector('a.info-product, a.space-image, a.space-image.second');
          href = productLink ? productLink.getAttribute('href') : '';
        }

        if (!href) href = window.location.pathname;

        var localItem = extractProductFromForm(form, href);
        form.classList.add('is-loading');
        addLocalCartItem(localItem, qty);
        form.classList.remove('is-loading');
        setButtonFeedback(form.querySelector('button.action, button[type="submit"]'), 'Adicionado');
      });
    });
  }

  function injectMenuFixCss() {
    if (document.getElementById('t7-menu-cart-fix')) return;
    var style = document.createElement('style');
    style.id = 't7-menu-cart-fix';
    style.textContent = [
      '.nav-mobile{position:fixed!important;top:0!important;left:0!important;bottom:0!important;width:min(86vw,360px)!important;max-width:360px!important;z-index:9999!important;overflow:auto!important;transform:translateX(-105%)!important;visibility:hidden!important;pointer-events:none!important;transition:transform 200ms ease,visibility 200ms ease!important;}',
      'body.t7-mobile-menu-open .nav-mobile{transform:translateX(0)!important;visibility:visible!important;pointer-events:auto!important;}',
      '.t7-menu-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:9998;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 200ms ease,visibility 200ms ease;}',
      'body.t7-mobile-menu-open .t7-menu-backdrop{opacity:1;visibility:visible;pointer-events:auto;}',
      'body.t7-mobile-menu-open{overflow:hidden;}',
      '.header .menu{cursor:pointer;}',
      'form[data-api-cart=\"1\"].is-loading .action{opacity:.72;pointer-events:none;}'
    ].join('');
    document.head.appendChild(style);
  }

  function closeMobileMenu() {
    document.body.classList.remove('t7-mobile-menu-open');
    document.querySelectorAll('.nav-mobile, .header .menu').forEach(function(el) {
      el.classList.remove('active', 'open', 'show', 'is-open');
      el.setAttribute('aria-expanded', 'false');
      if (el.style.display === 'block') el.style.display = '';
      if (el.classList.contains('nav-mobile')) {
        el.style.setProperty('transform', 'translateX(-105%)', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    });
  }

  function openMobileMenu() {
    document.body.classList.add('t7-mobile-menu-open');
    var menuButton = document.querySelector('.header .menu');
    var nav = document.querySelector('.nav-mobile');
    if (menuButton) menuButton.setAttribute('aria-expanded', 'true');
    if (nav) {
      nav.style.setProperty('transform', 'translateX(0)', 'important');
      nav.style.setProperty('visibility', 'visible', 'important');
      nav.style.setProperty('pointer-events', 'auto', 'important');
    }
  }

  function bindMobileMenu() {
    injectMenuFixCss();
    var nav = document.querySelector('.nav-mobile');
    var menuButton = document.querySelector('.header .menu');
    if (!nav || !menuButton || menuButton.dataset.t7MenuBound === '1') {
      closeMobileMenu();
      return;
    }

    menuButton.dataset.t7MenuBound = '1';
    menuButton.setAttribute('role', 'button');
    menuButton.setAttribute('tabindex', '0');
    menuButton.setAttribute('aria-label', 'Abrir menu');
    menuButton.setAttribute('aria-expanded', 'false');

    var backdrop = document.createElement('div');
    backdrop.className = 't7-menu-backdrop';
    document.body.appendChild(backdrop);

    closeMobileMenu();

    function toggleMenu(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (document.body.classList.contains('t7-mobile-menu-open')) closeMobileMenu();
      else openMobileMenu();
    }

    menuButton.addEventListener('click', toggleMenu);
    menuButton.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter' || ev.key === ' ') toggleMenu(ev);
    });
    backdrop.addEventListener('click', closeMobileMenu);
    document.querySelectorAll('.nav-mobile .close-nav, .nav-mobile a').forEach(function(el) {
      el.addEventListener('click', closeMobileMenu);
    });
    document.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape') closeMobileMenu();
    });
    document.addEventListener('click', function(ev) {
      if (!document.body.classList.contains('t7-mobile-menu-open')) return;
      if (nav.contains(ev.target) || menuButton.contains(ev.target)) return;
      closeMobileMenu();
    });
  }

  function bootCartBridge() {
    redirectLegacyCartLinks();
    bindMobileMenu();
    bindProductForms();
    syncCartUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootCartBridge);
  } else {
    bootCartBridge();
  }

  var path = window.location.pathname;
  var parts = path.replace(/\/+$/, '').split('/').filter(Boolean);

  if (parts[parts.length - 1] === 'index.html' || parts[parts.length - 1] === 'index.htm') {
    parts.pop();
  }

  if (parts.length < 3) return;

  var slug  = parts.pop();
  var marca = parts.pop();
  var secao = parts.pop();

  var targetStr = '/' + secao + '/' + marca + '/' + slug;
  var idx = path.lastIndexOf(targetStr);
  var basePath = idx !== -1 ? path.substring(0, idx) + '/' : '/';

  var jsonUrl = basePath + 'precos.json?nocache=' + Date.now();

  fetch(jsonUrl, { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data || !data[secao] || !data[secao][marca]) return;
      var preco = data[secao][marca][slug];
      if (typeof preco === 'undefined') return;

      var formatado = Number(preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      // #preco_atual pode ser input[hidden] — usa .value; outros elementos usam innerText
      var elPrecoAtual = document.getElementById('preco_atual');
      if (elPrecoAtual) {
        if (elPrecoAtual.tagName === 'INPUT') {
          elPrecoAtual.value = preco;
        } else {
          elPrecoAtual.innerText = formatado;
        }
      }

      // .price-off tem spans aninhados — substitui todo innerHTML pelo preco formatado
      var elsPriceOff = document.querySelectorAll('.price-off');
      elsPriceOff.forEach(function(el) {
        el.innerHTML = formatado;
      });

      // Outros elementos de preço visível
      var outrosEls = document.querySelectorAll('.current-price, .woocommerce-Price-amount');
      outrosEls.forEach(function(el) {
        el.innerText = formatado;
      });

      // #variacaoPreco - preço principal visível na página do produto
      var elVariacao = document.getElementById('variacaoPreco');
      if (elVariacao) {
        elVariacao.innerText = Number(preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      // Atualiza dataLayer se existir
      if (typeof dataLayer !== 'undefined') {
        for (var i = 0; i < dataLayer.length; i++) {
          if (dataLayer[i].priceSell) dataLayer[i].priceSell = String(preco);
          if (dataLayer[i].price)     dataLayer[i].price     = String(preco);
        }
      }
    })
    .catch(function(err) { console.error('preco-loader: erro ao carregar precos.json', err); });

})();
