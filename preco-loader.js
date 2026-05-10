(function() {
  var API = '/api';
  var LS_KEY = 't7_cart_id';

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
    return api('/cart', { method: 'POST', body: '{}' }).then(function(cart) {
      localStorage.setItem(LS_KEY, cart.id);
      return cart.id;
    });
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

        form.classList.add('is-loading');
        resolveByHref(href)
          .then(function(product) {
            return ensureCart().then(function(cartId) {
              return api('/cart/' + encodeURIComponent(cartId) + '/items', {
                method: 'PUT',
                body: JSON.stringify({ productId: product.id, qty: qty })
              });
            });
          })
          .then(function() {
            form.classList.remove('is-loading');
            var button = form.querySelector('button.action, button[type="submit"]');
            if (button) {
              var old = button.textContent;
              button.textContent = 'Adicionado';
              setTimeout(function() { button.textContent = old; }, 900);
            }
          })
          .catch(function(err) {
            form.classList.remove('is-loading');
            alert('Erro ao adicionar no carrinho: ' + err.message);
          });
      });
    });
  }

  function bootCartBridge() {
    redirectLegacyCartLinks();
    bindProductForms();
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
