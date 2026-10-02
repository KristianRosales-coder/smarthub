import './style.css';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth } from './firebase.js';
import { openGenAiFlow } from './genai/flow.js';

/** Sample catalog until IMS / Realtime DB products are wired.
 * Extra fields feed the server-side Gen AI prompt template.
 */
const CATALOG = [
  {
    id: 'porcelain-10011101',
    name: 'Porcelain Tiles',
    sku: '10011101',
    image: '/tile-sample.jpg',
    kind: 'porcelain',
    material: 'porcelain',
    color: 'neutral stone-gray',
    finish: 'matte',
    sizeCm: '60x60',
    pattern: 'straight grid',
    groutColor: 'light gray',
  },
  {
    id: 'ceramic-10011102',
    name: 'Ceramic Tiles',
    sku: '10011102',
    image: '/tile-sample.jpg',
    kind: 'ceramic',
    material: 'ceramic',
    color: 'warm beige',
    finish: 'glossy',
    sizeCm: '30x60',
    pattern: 'brick / running bond',
    groutColor: 'ivory',
  },
];

const CART_KEY = 'tddc_walkin_cart';
const app = document.getElementById('app');
let selectedTile = null;

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}
function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}
function addToCart(tile) {
  const cart = loadCart();
  cart.push({
    id: tile.id,
    name: tile.name,
    sku: tile.sku,
    addedAt: new Date().toISOString(),
  });
  saveCart(cart);
  return cart;
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function searchIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
    <path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

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

function renderHome(user) {
  const cartCount = loadCart().length;
  const cards = CATALOG.map((tile) => `
    <button class="tile-card" type="button" data-id="${tile.id}">
      <div class="preview" style="background-image:url('${tile.image}')"></div>
      <div class="meta">
        <div>
          <h2>${tile.name}</h2>
          <p>${tile.sku}</p>
        </div>
        <div class="icon-search">${searchIcon()}</div>
      </div>
    </button>
  `).join('');

  app.replaceChildren(el(`
    <div class="app-shell">
      <header class="topbar">
        <img class="logo" src="/tile_depot_header.jpg" alt="Tile Depot Discount Center">
        <div class="user">
          <button class="cart-chip" type="button" id="cartBtn">Cart (${cartCount})</button>
          <span>${user.email || 'Staff'}</span>
          <button class="btn-ghost" type="button" id="signOutBtn">Sign out</button>
        </div>
      </header>

      <main class="home">
        <div class="home-hero">
          <h1>TileDepotDC <span>Floor Design</span></h1>
          <p class="tagline">Try Before You Buy</p>
        </div>
        <section class="catalog" aria-label="Tile catalog">
          ${cards}
        </section>
      </main>

      <footer class="site-footer">
        <div>© ${new Date().getFullYear()} Tile Depot Discount Center, Paco, Manila. All Rights Reserved.</div>
        <img src="/tile_depot_header.jpg" alt="">
      </footer>
    </div>
  `));

  document.getElementById('signOutBtn').addEventListener('click', () => signOut(auth));
  document.getElementById('cartBtn').addEventListener('click', showCart);
  app.querySelectorAll('.tile-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedTile = CATALOG.find((t) => t.id === card.dataset.id);
      openTileModal(selectedTile);
    });
  });
}

function showCart() {
  const cart = loadCart();
  const lines = cart.length
    ? cart.map((c, i) => `<li><strong>${c.name}</strong> · SKU ${c.sku}</li>`).join('')
    : '<li>Cart is empty. Add tiles from AI or catalog preview.</li>';
  const backdrop = el(`
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal" style="grid-template-rows:auto 1fr auto">
        <div class="modal-head">
          <h2>Walk-in Cart</h2>
          <button class="modal-close" type="button" id="cartClose">×</button>
        </div>
        <div class="modal-body" style="padding:16px">
          <p style="margin:0 0 12px;color:var(--muted);font-size:.9rem">Present this list to the cashier. Payment stays on your existing POS.</p>
          <ol style="margin:0;padding-left:1.2rem;line-height:1.6">${lines}</ol>
        </div>
        <div class="modal-actions" style="grid-template-columns:1fr">
          <button class="btn-secondary" type="button" id="cartClear">Clear cart</button>
        </div>
      </div>
    </div>
  `);
  app.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#cartClose').addEventListener('click', close);
  backdrop.querySelector('#cartClear').addEventListener('click', () => {
    saveCart([]);
    close();
    const user = auth.currentUser;
    if (user) renderHome(user);
  });
}

function openTileModal(tile) {
  if (!tile) return;
  const backdrop = el(`
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="${tile.name}">
      <div class="modal" id="tileModal">
        <div class="modal-head">
          <h2>${tile.name}</h2>
          <button class="modal-close" type="button" id="modalClose" aria-label="Close">×</button>
        </div>
        <div class="modal-body" id="modalBody">
          <div class="hero" style="background-image:url('${tile.image}')"></div>
        </div>
        <div class="modal-actions" id="modalActions">
          <button class="viz-btn" type="button" id="btnAr">
            ${arBadge()}
            <span class="label">VISUALIZE TILE</span>
            <span class="hint">Real Time View</span>
          </button>
          <button class="viz-btn secondary" type="button" id="btnAi">
            ${aiBadge()}
            <span class="label">VISUALIZE TILE</span>
            <span class="hint">Take A Photo / Upload a Photo</span>
          </button>
        </div>
      </div>
    </div>
  `);

  app.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.getElementById('modalClose').addEventListener('click', close);

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
    modal.querySelector('.modal-head h2').textContent = 'Visualize in My Space';
    openGenAiFlow({
      host: body,
      tile,
      mode: 'kiosk',
      onClose: close,
      onAddToCart: (t) => {
        addToCart(t);
        const user = auth.currentUser;
        if (user) {
          // refresh cart chip if still on home behind modal
        }
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
