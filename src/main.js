import './style.css';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import emailjs from '@emailjs/browser';
import { push, ref, set } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, db } from './firebase.js';
import { app as firebaseApp } from './firebase-app.js';
import { openGenAiFlow } from './genai/flow.js';

const functions = getFunctions(firebaseApp);

const EMAILJS_SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID || '';
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID || '';
const EMAILJS_PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || '';

function emailJsConfigured() {
  return !!(EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && EMAILJS_PUBLIC_KEY);
}

function buildOrderEmailParams(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsText = items.map((item) =>
    `• ${item.name} (${item.sku}, ${item.sizeCm}) × ${item.quantity} = ${formatMoney(item.lineTotal)}`
  ).join('\n');
  const fulfillment = order.fulfillment === 'delivery' ? 'Delivery' : 'Store pickup';

  return {
    to_email: order.customerEmail,
    customer_email: order.customerEmail,
    customer_name: order.customerName || 'Walk-in customer',
    order_id: order.id || '',
    fulfillment,
    delivery_notes: order.deliveryNotes || '—',
    items_text: itemsText,
    subtotal: formatMoney(order.subtotal),
    disclaimer: 'Order summary only — not a BIR/official sales invoice.',
    message: [
      'Tile Depot Discount Center — Order summary',
      '(Not an official receipt)',
      '',
      `Reference: ${order.id || '—'}`,
      `Customer: ${order.customerName || 'Walk-in customer'} <${order.customerEmail}>`,
      `Fulfillment: ${fulfillment}`,
      order.deliveryNotes ? `Notes: ${order.deliveryNotes}` : '',
      '',
      itemsText,
      '',
      `Order total: ${formatMoney(order.subtotal)}`,
    ].filter(Boolean).join('\n'),
  };
}

/** Sample catalog until IMS / Realtime DB products are wired.
 * Extra fields feed the server-side Gen AI prompt template.
 */
const CATALOG = [
  {
    id: 'porcelain-10011101',
    name: 'Luxury Black',
    sku: '10011101',
    image: '/tile-sample.jpg',
    price: 700,
    stock: 329,
    kind: 'porcelain',
    material: 'porcelain',
    color: 'luxury black',
    finish: 'polished',
    sizeCm: '40x40',
    pattern: 'straight grid',
    groutColor: 'charcoal',
    imageClass: 'tile-black',
    description: 'A premium polished porcelain tile that adds depth and elegance to living rooms, lobbies, and modern commercial spaces.',
  },
  {
    id: 'ceramic-10011102',
    name: 'Red Marble',
    sku: '10011102',
    image: '/tile-sample.jpg',
    price: 620,
    stock: 184,
    kind: 'ceramic',
    material: 'ceramic',
    color: 'red marble',
    finish: 'glossy',
    sizeCm: '30x60',
    pattern: 'brick / running bond',
    groutColor: 'ivory',
    imageClass: 'tile-red',
    description: 'Warm marble-inspired ceramic tile for statement floors and accent areas.',
  },
  {
    id: 'porcelain-10011103',
    name: 'Luxury White',
    sku: '10011103',
    image: '/tile-sample.jpg',
    price: 680,
    stock: 215,
    kind: 'porcelain',
    material: 'porcelain',
    color: 'white marble',
    finish: 'polished',
    sizeCm: '60x60',
    pattern: 'straight grid',
    groutColor: 'white',
    imageClass: 'tile-white',
    description: 'Bright polished porcelain with subtle marble character for clean, spacious interiors.',
  },
  {
    id: 'ceramic-10011104',
    name: 'Ink Marble',
    sku: '10011104',
    image: '/tile-sample.jpg',
    price: 650,
    stock: 96,
    kind: 'ceramic',
    material: 'ceramic',
    color: 'ink gray',
    finish: 'satin',
    sizeCm: '40x40',
    pattern: 'straight grid',
    groutColor: 'gray',
    imageClass: 'tile-ink',
    description: 'A soft ink-marble surface that suits contemporary homes and retail spaces.',
  },
];

const CART_KEY = 'tddc_walkin_cart';
const ORDERS_KEY = 'tddc_walkin_orders';
const app = document.getElementById('app');
let selectedTile = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(amount) {
  return `₱ ${Number(amount || 0).toLocaleString()}`;
}

function loadLocalOrders() {
  try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); }
  catch { return []; }
}

function saveLocalOrder(order) {
  const next = [order, ...loadLocalOrders()].slice(0, 40);
  localStorage.setItem(ORDERS_KEY, JSON.stringify(next));
  return next;
}

/** Gateway stub: queue order summary for management (RTDB + local backup). */
async function submitOrderSummary(order) {
  const stamped = {
    ...order,
    createdAt: order.createdAt || new Date().toISOString(),
    source: 'walkin-ui',
    kind: 'order_summary', // not a legal receipt
    managementStatus: 'queued',
  };

  try {
    const newRef = push(ref(db, 'walkinOrders'));
    stamped.id = newRef.key;
    stamped.managementStatus = 'synced';
    await set(newRef, stamped);
  } catch (err) {
    console.warn('[walkin] management sync unavailable, keeping local queue', err);
    stamped.id = stamped.id || `local_${Date.now()}`;
    stamped.managementStatus = 'local_only';
    stamped.syncError = err?.message || 'RTDB write failed';
  }

  saveLocalOrder(stamped);
  return stamped;
}

/**
 * Email the order summary to the customer inbox.
 * Prefer EmailJS (works on Spark / no Cloud Functions). Falls back to callable if configured later on Blaze.
 */
async function emailOrderSummaryToCustomer(order) {
  if (emailJsConfigured()) {
    await emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      buildOrderEmailParams(order),
      { publicKey: EMAILJS_PUBLIC_KEY }
    );
    return { ok: true, to: order.customerEmail, provider: 'emailjs' };
  }

  // Blaze-only path (Cloud Functions). Skipped on Spark until the project is upgraded.
  try {
    const send = httpsCallable(functions, 'sendOrderSummaryEmail');
    const result = await send({ order });
    return { ...(result.data || {}), provider: 'functions' };
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (/not.?found|unimplemented|INTERNAL|Blaze|billing/i.test(msg)) {
      throw new Error(
        'Email is not configured. Add EmailJS keys to .env (see .env.example), or upgrade to Blaze and deploy functions.'
      );
    }
    throw err;
  }
}

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}
function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}
function addToCart(tile, quantity = 1, size = tile.sizeCm) {
  const cart = loadCart();
  const existing = cart.find((item) => item.id === tile.id && item.sizeCm === size);
  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.push({
      id: tile.id,
      name: tile.name,
      sku: tile.sku,
      image: tile.image,
      imageClass: tile.imageClass,
      price: tile.price,
      sizeCm: size,
      quantity,
      addedAt: new Date().toISOString(),
    });
  }
  saveCart(cart);
  return cart;
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const icon = (name) => {
  const paths = {
    home: '<path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    cart: '<path d="M4 5h2l2 10h9l2-7H7"/><circle cx="10" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    refresh: '<path d="M20 7V3l-3 3a8 8 0 1 0 2 8"/><path d="M20 3h-4"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
};

function arBadge() {
  return `<span class="badge"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
    <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
    <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M14 16h6M17 13v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg> AR</span>`;
}

function aiBadge() {
  return `<span class="badge"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
    <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
    <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
    <path d="M14 18h6M15.5 15.5l3 5 3-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg> AI</span>`;
}

function showSplashThen(next) {
  app.replaceChildren(el(`
    <div class="splash" role="status" aria-label="Loading Tile Depot">
      <img src="/tile_depot_header.jpg" alt="The Tile Depot Discount Center">
    </div>
  `));
  setTimeout(next, 1100);
}

function renderLogin(errorMessage = '') {
  app.replaceChildren(el(`
    <div class="login-page">
      <form class="login-card" id="loginForm">
        <div class="brand">
          <img src="/tile_depot_header.jpg" alt="The Tile Depot Discount Center">
          <div>
            <h1>In-Store Floor Design</h1>
            <p class="sub">Staff sign-in for the showroom tablet</p>
          </div>
        </div>
        <div class="auth-error ${errorMessage ? 'show' : ''}" id="authError">${errorMessage || ''}</div>
        <div class="field">
          <label for="email">Gmail / Email</label>
          <input id="email" name="email" type="email" autocomplete="username" required placeholder="you@gmail.com">
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="••••••••">
        </div>
        <button class="btn-primary" type="submit" id="loginBtn">Sign in</button>
        <p class="login-hint">Uses Firebase Email/Password. Create the staff account in Firebase Authentication.</p>
      </form>
    </div>
  `));

  const form = document.getElementById('loginForm');
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('authError');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.remove('show');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await signInWithEmailAndPassword(auth, form.email.value.trim(), form.password.value);
    } catch (ex) {
      err.textContent = friendlyAuthError(ex);
      err.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

function friendlyAuthError(ex) {
  const code = ex?.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Wrong email or password. Check Firebase Authentication users.';
  }
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again in a few minutes.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection.';
  if (code === 'auth/operation-not-allowed') {
    return 'Email/Password sign-in is disabled. Enable it in Firebase Console → Authentication → Sign-in method.';
  }
  return ex?.message || 'Sign-in failed.';
}

function bottomNav(active = 'home') {
  return `
    <nav class="bottom-nav" aria-label="Main navigation">
      <button class="nav-item ${active === 'home' ? 'active' : ''}" data-nav="home" type="button">
        ${icon('home')}<span>Home</span>
      </button>
      <button class="nav-item ${active === 'cart' ? 'active' : ''}" data-nav="cart" type="button">
        <span class="nav-icon-wrap">${icon('cart')}<b class="cart-count">${cartQuantity()}</b></span><span>Cart</span>
      </button>
      <button class="nav-item ${active === 'profile' ? 'active' : ''}" data-nav="profile" type="button">
        ${icon('user')}<span>Profile</span>
      </button>
    </nav>
  `;
}

function cartQuantity() {
  return loadCart().reduce((sum, item) => sum + (item.quantity || 1), 0);
}

function bindBottomNav() {
  app.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.nav;
      if (page === 'home') renderHome(auth.currentUser);
      if (page === 'cart') renderCart();
      if (page === 'profile') renderProfile();
    });
  });
}

function productImage(tile, extraClass = '') {
  return `<div class="product-image ${tile.imageClass || ''} ${extraClass}" style="background-image:url('${tile.image}')"></div>`;
}

function filterCatalog(query = '', category = 'all') {
  const normalized = query.trim().toLowerCase();
  return CATALOG.filter((tile) => {
    const matchesSearch = !normalized
      || tile.name.toLowerCase().includes(normalized)
      || tile.sku.includes(normalized);
    const matchesCategory = category === 'all' || tile.kind === category;
    return matchesSearch && matchesCategory;
  });
}

function catalogCardsHtml(products) {
  return products.map((tile) => `
    <article class="product-card" data-id="${tile.id}">
      <button class="product-open" type="button" aria-label="View ${tile.name}">
        ${productImage(tile)}
      </button>
      <div class="product-card-meta">
        <div><strong>${tile.name}</strong><small>${tile.sku}</small></div>
        <button class="quick-cart" type="button" aria-label="Add ${tile.name} to cart">${icon('cart')}</button>
      </div>
    </article>
  `).join('') || '<p class="empty-state">No tiles match your search.</p>';
}

function bindCatalogCards(user, getQuery, getCategory) {
  app.querySelectorAll('.product-card').forEach((card) => {
    const tile = CATALOG.find((item) => item.id === card.dataset.id);
    card.querySelector('.product-open').addEventListener('click', () => openTileModal(tile));
    card.querySelector('.quick-cart').addEventListener('click', () => {
      addToCart(tile);
      // Keep the focused search value; remount only after cart add is fine.
      renderHome(user, getQuery(), getCategory());
    });
  });
}

function updateHomeCatalog(user, query, category) {
  const products = filterCatalog(query, category);
  const countEl = document.getElementById('catalogCount');
  const grid = document.getElementById('productGrid');
  if (countEl) countEl.textContent = `${products.length} products`;
  if (grid) {
    grid.innerHTML = catalogCardsHtml(products);
    bindCatalogCards(user, () => query, () => category);
  }
  app.querySelectorAll('[data-category]').forEach((button) => {
    button.classList.toggle('active', button.dataset.category === category);
  });
}

function renderHome(user, query = '', category = 'all') {
  const products = filterCatalog(query, category);

  app.replaceChildren(el(`
    <div class="mobile-shell">
      <header class="brand-header">
        <div class="brand-title">
          <img src="/tile_depot_header.jpg" alt="">
          <div><strong>TileDepotDC <span>Floor Design</span></strong><small>Try Before You Buy</small></div>
        </div>
        <button class="round-action" id="refreshBtn" type="button" aria-label="Refresh">${icon('refresh')}</button>
      </header>
      <main class="screen-content home-screen">
        <label class="search-bar">
          ${icon('search')}
          <input id="catalogSearch" type="search" value="${query}" placeholder="Search tile style or code name" autocomplete="off" enterkeyhint="search">
        </label>
        <section class="category-section">
          <p class="section-label">Tile Type Available</p>
          <div class="category-row">
            ${[
              ['all', 'All Tiles'],
              ['porcelain', 'Porcelain'],
              ['ceramic', 'Ceramic'],
              ['vinyl', 'Vinyl'],
              ['terracotta', 'Terracotta'],
            ].map(([value, label]) => `
              <button class="category-chip ${category === value ? 'active' : ''}" data-category="${value}" type="button">
                <span class="category-swatch ${value}"></span><span>${label}</span>
              </button>
            `).join('')}
          </div>
        </section>
        <div class="catalog-heading">
          <div><p class="eyebrow">EXPLORE</p><h1>Styles</h1></div>
          <span id="catalogCount">${products.length} products</span>
        </div>
        <section class="product-grid" id="productGrid" aria-label="Tile styles">
          ${catalogCardsHtml(products)}
        </section>
      </main>
      ${bottomNav('home')}
    </div>
  `));

  bindBottomNav();
  document.getElementById('refreshBtn').addEventListener('click', () => renderHome(user));
  const search = document.getElementById('catalogSearch');
  // Update only the product grid — remounting the whole page on every keystroke
  // destroys the input and dismisses the mobile keyboard.
  let activeCategory = category;
  search.addEventListener('input', () => {
    updateHomeCatalog(user, search.value, activeCategory);
  });
  app.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      activeCategory = button.dataset.category;
      updateHomeCatalog(user, search.value, activeCategory);
    });
  });
  bindCatalogCards(user, () => search.value, () => activeCategory);
}

function renderCart() {
  const cart = loadCart();
  const selected = new Set(cart.map((_, index) => index));
  const items = cart.map((item, index) => `
    <article class="order-card" data-index="${index}">
      <label class="order-check">
        <input type="checkbox" class="cart-select" data-index="${index}" checked aria-label="Select ${item.name}">
      </label>
      ${productImage(item, 'order-thumb')}
      <div class="order-info">
        <strong>${item.name}</strong>
        <small>Size: ${item.sizeCm}</small>
        <small>Quantity: ${item.quantity}</small>
        <span>₱ ${Number(item.price * item.quantity).toLocaleString()}</span>
      </div>
      <button class="order-arrow remove-cart" type="button" aria-label="Remove">${icon('arrow')}</button>
    </article>
  `).join('');

  const calcTotal = () => [...selected].reduce((sum, index) => {
    const item = cart[index];
    return item ? sum + item.price * item.quantity : sum;
  }, 0);

  const updateCheckoutBar = () => {
    const totalEl = document.getElementById('cartTotal');
    const checkoutBtn = document.getElementById('checkoutBtn');
    if (totalEl) totalEl.textContent = `₱ ${calcTotal().toLocaleString()}`;
    if (checkoutBtn) checkoutBtn.disabled = selected.size === 0;
  };

  app.replaceChildren(el(`
    <div class="mobile-shell">
      <header class="page-header">
        <div><p class="eyebrow">WALK-IN ORDER</p><h1>My Order</h1></div>
        <button class="round-action" id="cartRefresh" type="button">${icon('refresh')}</button>
      </header>
      <main class="screen-content cart-screen">
        <label class="search-bar">${icon('search')}<input type="search" placeholder="Search tile style or code name"></label>
        <section class="order-list">${items || `
          <div class="empty-cart">
            ${icon('cart')}<h2>Your cart is empty</h2>
            <p>Choose tiles from Home and add them to prepare an order for the cashier.</p>
            <button class="btn-primary" id="shopNow" type="button">Browse tiles</button>
          </div>
        `}</section>
      </main>
      ${cart.length ? `
        <div class="checkout-bar">
          <div><small>Total Amount</small><strong id="cartTotal">₱ ${calcTotal().toLocaleString()}</strong></div>
          <button type="button" id="checkoutBtn">Checkout</button>
        </div>
      ` : ''}
      ${bottomNav('cart')}
    </div>
  `));

  bindBottomNav();
  document.getElementById('cartRefresh').addEventListener('click', renderCart);
  document.getElementById('shopNow')?.addEventListener('click', () => renderHome(auth.currentUser));
  app.querySelectorAll('.cart-select').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const index = Number(checkbox.dataset.index);
      if (checkbox.checked) selected.add(index);
      else selected.delete(index);
      updateCheckoutBar();
    });
  });
  app.querySelectorAll('.remove-cart').forEach((button) => {
    button.addEventListener('click', () => {
      const next = loadCart();
      next.splice(Number(button.closest('.order-card').dataset.index), 1);
      saveCart(next);
      renderCart();
    });
  });
  document.getElementById('checkoutBtn')?.addEventListener('click', () => {
    if (selected.size === 0) {
      alert('Select at least one item to checkout.');
      return;
    }
    const checkoutItems = [...selected]
      .sort((a, b) => a - b)
      .map((index) => cart[index])
      .filter(Boolean);
    renderStaffCheckout(checkoutItems);
  });
}

/**
 * Staff handoff after cart checkout.
 * Payment + official receipt stay on external POS; this is only an order summary
 * that can later feed the management system.
 */
function renderStaffCheckout(items) {
  const lineTotal = (item) => item.price * item.quantity;
  const subtotal = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const lines = items.map((item) => `
    <article class="summary-line">
      ${productImage(item, 'order-thumb')}
      <div class="order-info">
        <strong>${escapeHtml(item.name)}</strong>
        <small>SKU ${escapeHtml(item.sku)} · ${escapeHtml(item.sizeCm)}</small>
        <small>Qty ${item.quantity} × ${formatMoney(item.price)}</small>
      </div>
      <span class="summary-amount">${formatMoney(lineTotal(item))}</span>
    </article>
  `).join('');

  app.replaceChildren(el(`
    <div class="mobile-shell">
      <header class="page-header">
        <div>
          <p class="eyebrow">STAFF CHECKOUT</p>
          <h1>Order summary</h1>
        </div>
        <button class="round-action" id="checkoutBack" type="button" aria-label="Back to cart">${icon('arrow')}</button>
      </header>
      <main class="screen-content checkout-screen">
        <p class="checkout-note">
          Not an official receipt. After POS payment, enter the customer email —
          we’ll email them this summary and queue it for management.
        </p>

        <section class="checkout-card">
          <label class="field" for="customerEmail">
            <span>Customer email</span>
            <input id="customerEmail" name="customerEmail" type="email" autocomplete="email"
              required placeholder="customer@email.com" inputmode="email">
          </label>
          <label class="field" for="customerName">
            <span>Customer name <em>(optional)</em></span>
            <input id="customerName" name="customerName" type="text" autocomplete="name"
              placeholder="Walk-in customer">
          </label>
        </section>

        <section class="checkout-card">
          <p class="section-label">Fulfillment</p>
          <div class="fulfill-row" role="radiogroup" aria-label="Fulfillment">
            <label class="fulfill-pill">
              <input type="radio" name="fulfillment" value="pickup" checked>
              <span>Store pickup</span>
            </label>
            <label class="fulfill-pill">
              <input type="radio" name="fulfillment" value="delivery">
              <span>Delivery</span>
            </label>
          </div>
          <label class="field" for="deliveryNotes">
            <span>Delivery / notes <em>(optional)</em></span>
            <textarea id="deliveryNotes" rows="3"
              placeholder="Address, schedule, or cashier notes"></textarea>
          </label>
        </section>

        <section class="checkout-card">
          <p class="section-label">Items</p>
          <div class="summary-list">${lines}</div>
          <div class="summary-total">
            <span>Order total</span>
            <strong>${formatMoney(subtotal)}</strong>
          </div>
        </section>

        <p class="checkout-hint" id="checkoutError" hidden></p>
      </main>

      <div class="checkout-bar checkout-bar-staff">
        <div>
          <small>After POS payment</small>
          <strong>${formatMoney(subtotal)}</strong>
        </div>
        <button type="button" id="confirmPaymentBtn">Confirm payment</button>
      </div>
    </div>
  `));

  const backBtn = document.getElementById('checkoutBack');
  backBtn.style.transform = 'scaleX(-1)';
  backBtn.addEventListener('click', renderCart);

  const errEl = document.getElementById('checkoutError');
  const confirmBtn = document.getElementById('confirmPaymentBtn');

  confirmBtn.addEventListener('click', async () => {
    const email = document.getElementById('customerEmail').value.trim();
    const name = document.getElementById('customerName').value.trim();
    const notes = document.getElementById('deliveryNotes').value.trim();
    const fulfillment = app.querySelector('input[name="fulfillment"]:checked')?.value || 'pickup';

    errEl.hidden = true;
    errEl.textContent = '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.hidden = false;
      errEl.textContent = 'Enter a valid customer email before confirming.';
      document.getElementById('customerEmail').focus();
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Sending…';

    const order = {
      customerEmail: email,
      customerName: name || null,
      fulfillment,
      deliveryNotes: notes || null,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        sizeCm: item.sizeCm,
        quantity: item.quantity,
        unitPrice: item.price,
        lineTotal: item.price * item.quantity,
      })),
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal,
      currency: 'PHP',
      payment: {
        method: 'external_pos',
        status: 'confirmed_by_staff',
        confirmedAt: new Date().toISOString(),
        confirmedBy: auth.currentUser?.email || null,
      },
      staffUid: auth.currentUser?.uid || null,
      disclaimer: 'Order summary only — not a BIR/official sales invoice.',
    };

    try {
      confirmBtn.textContent = 'Saving…';
      const saved = await submitOrderSummary(order);

      // Email customer (order is kept even if email fails).
      confirmBtn.textContent = 'Emailing…';
      try {
        const mailed = await emailOrderSummaryToCustomer(saved);
        saved.emailStatus = 'sent';
        saved.emailTo = mailed?.to || saved.customerEmail;
      } catch (mailErr) {
        console.warn('[walkin] email failed', mailErr);
        saved.emailStatus = 'failed';
        saved.emailError = mailErr?.message || 'Email could not be sent.';
      }

      // Remove checked-out lines from the walk-in cart.
      const ids = new Set(items.map((item) => `${item.id}|${item.sizeCm}`));
      const remaining = loadCart().filter((item) => !ids.has(`${item.id}|${item.sizeCm}`));
      saveCart(remaining);

      renderOrderConfirmed(saved);
    } catch (err) {
      console.error(err);
      errEl.hidden = false;
      errEl.textContent = 'Could not save the order summary. Try again.';
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm payment';
    }
  });
}

function renderOrderConfirmed(order) {
  const syncLabel = order.managementStatus === 'synced'
    ? 'Queued for management'
    : 'Saved on this device (management sync pending)';
  const emailLabel = order.emailStatus === 'sent'
    ? `Sent to ${order.emailTo || order.customerEmail}`
                : (order.emailError || 'Not sent — add EmailJS keys to .env (see .env.example)');

  app.replaceChildren(el(`
    <div class="mobile-shell">
      <header class="page-header">
        <div>
          <p class="eyebrow">DONE</p>
          <h1>Payment noted</h1>
        </div>
      </header>
      <main class="screen-content checkout-screen confirm-screen">
        <div class="confirm-badge" aria-hidden="true">✓</div>
        <h2>Order summary recorded</h2>
        <p class="checkout-note">
          Official receipt stays on the store POS. This walk-in summary was
          ${order.emailStatus === 'sent' ? 'emailed to the customer' : 'saved'}
          and can feed the management system.
        </p>
        <section class="checkout-card confirm-meta">
          <div><small>Reference</small><strong>${escapeHtml(order.id)}</strong></div>
          <div><small>Customer</small><strong>${escapeHtml(order.customerEmail)}</strong></div>
          <div><small>Email</small><strong>${escapeHtml(emailLabel)}</strong></div>
          <div><small>Fulfillment</small><strong>${escapeHtml(order.fulfillment)}</strong></div>
          <div><small>Total</small><strong>${formatMoney(order.subtotal)}</strong></div>
          <div><small>Management</small><strong>${escapeHtml(syncLabel)}</strong></div>
        </section>
        <button class="btn-primary" id="doneHome" type="button">Back to catalog</button>
        <button class="btn-secondary" id="doneCart" type="button">View cart</button>
      </main>
      ${bottomNav('cart')}
    </div>
  `));

  bindBottomNav();
  document.getElementById('doneHome').addEventListener('click', () => renderHome(auth.currentUser));
  document.getElementById('doneCart').addEventListener('click', renderCart);
}

function renderProfile() {
  const user = auth.currentUser;
  app.replaceChildren(el(`
    <div class="mobile-shell">
      <header class="page-header"><div><p class="eyebrow">SHOWROOM DEVICE</p><h1>Profile</h1></div></header>
      <main class="screen-content profile-screen">
        <div class="profile-avatar">${icon('user')}</div>
        <h2>In-Store Staff</h2>
        <p>${user?.email || 'Signed-in user'}</p>
        <button class="btn-secondary" id="signOutBtn" type="button">Sign out</button>
      </main>
      ${bottomNav('profile')}
    </div>
  `));
  bindBottomNav();
  document.getElementById('signOutBtn').addEventListener('click', () => signOut(auth));
}

function openTileModal(tile) {
  if (!tile) return;
  let quantity = 1;
  let selectedSize = tile.sizeCm;
  const backdrop = el(`
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="${tile.name}">
      <div class="modal product-detail" id="tileModal">
        <div class="modal-head product-modal-head">
          <span class="detail-logo">TD</span>
          <h2>${tile.name}</h2>
          <button class="modal-close" type="button" id="modalClose" aria-label="Close">×</button>
        </div>
        <div class="modal-body" id="modalBody">
          ${productImage(tile, 'detail-hero')}
          <div class="detail-copy">
            <div class="detail-title-row">
              <div><small>Tile Style</small><strong>${tile.name}</strong></div>
              <div><small>Available Stocks</small><strong>${tile.stock} pcs</strong></div>
            </div>
            <div class="detail-facts">
              <div><small>Tile Type</small><strong>${tile.material} Tiles</strong></div>
              <div><small>Price</small><strong>₱ ${tile.price.toLocaleString()} / pc</strong></div>
            </div>
            <h3>Tile Description</h3>
            <p>${tile.description}</p>
            <h3>Tile Size</h3>
            <div class="size-options">
              ${[tile.sizeCm, '20x20', '60x60'].filter((v, i, a) => a.indexOf(v) === i).map((size, index) => `
                <button type="button" class="size-pill ${index === 0 ? 'active' : ''}" data-size="${size}">
                  ${index === 0 ? 'Standard' : index === 1 ? 'Smaller Size' : 'Large Size'} ${size}
                </button>
              `).join('')}
            </div>
            <h3>Quantity</h3>
            <div class="quantity-row">
              <button type="button" id="qtyMinus">${icon('minus')}</button>
              <strong id="qtyValue">1</strong>
              <button type="button" id="qtyPlus">${icon('plus')}</button>
            </div>
          </div>
        </div>
        <div class="product-detail-actions" id="modalActions">
          <div class="visualizer-actions">
            <button class="outline-action" type="button" id="btnAr">${arBadge()}<span>Real-time AR</span></button>
            <button class="outline-action" type="button" id="btnAi">${aiBadge()}<span>Photo AI</span></button>
          </div>
          <button class="add-cart-main" type="button" id="addDetailCart">${icon('cart')} Add to Cart</button>
        </div>
      </div>
    </div>
  `);

  app.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.getElementById('modalClose').addEventListener('click', close);
  const qtyValue = document.getElementById('qtyValue');
  document.getElementById('qtyMinus').addEventListener('click', () => {
    quantity = Math.max(1, quantity - 1);
    qtyValue.textContent = quantity;
  });
  document.getElementById('qtyPlus').addEventListener('click', () => {
    quantity = Math.min(tile.stock, quantity + 1);
    qtyValue.textContent = quantity;
  });
  backdrop.querySelectorAll('.size-pill').forEach((button) => {
    button.addEventListener('click', () => {
      backdrop.querySelectorAll('.size-pill').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      selectedSize = button.dataset.size;
    });
  });
  document.getElementById('addDetailCart').addEventListener('click', () => {
    addToCart(tile, quantity, selectedSize);
    close();
    renderCart();
  });

  document.getElementById('btnAr').addEventListener('click', () => {
    const params = new URLSearchParams({
      sku: tile.sku,
      name: tile.name,
      image: tile.image,
    });
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    window.location.href = isIOS ? `/ios.html?${params}` : `/ar.html?${params}`;
  });

  document.getElementById('btnAi').addEventListener('click', () => {
    const modal = document.getElementById('tileModal');
    const body = document.getElementById('modalBody');
    const actions = document.getElementById('modalActions');
    actions.style.display = 'none';
    modal.classList.remove('product-detail');
    modal.querySelector('.modal-head h2').textContent = 'Visualize in My Space';
    openGenAiFlow({
      host: body,
      tile,
      mode: 'kiosk',
      onClose: close,
      onAddToCart: (t) => {
        addToCart(t, quantity, selectedSize);
      },
      onTryAnother: close,
    });
  });
}

function boot() {
  showSplashThen(() => {
    onAuthStateChanged(auth, (user) => {
      if (user) renderHome(user);
      else renderLogin();
    });
  });
}

boot();
