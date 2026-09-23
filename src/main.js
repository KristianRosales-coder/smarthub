import './style.css';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth } from './firebase.js';

/** Sample catalog until IMS / Realtime DB products are wired. */
const CATALOG = [
  {
    id: 'porcelain-10011101',
    name: 'Porcelain Tiles',
    sku: '10011101',
    image: '/tile-sample.jpg',
    kind: 'porcelain',
  },
  {
    id: 'ceramic-10011102',
    name: 'Ceramic Tiles',
    sku: '10011102',
    image: '/tile-sample.jpg',
    kind: 'ceramic',
  },
];

const app = document.getElementById('app');
let selectedTile = null;
let authReady = false;

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
    const email = form.email.value.trim();
    const password = form.password.value;
    try {
      await signInWithEmailAndPassword(auth, email, password);
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
  app.querySelectorAll('.tile-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedTile = CATALOG.find((t) => t.id === card.dataset.id);
      openTileModal(selectedTile);
    });
  });
}

function openTileModal(tile) {
  if (!tile) return;
  const backdrop = el(`
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="${tile.name}">
      <div class="modal">
        <div class="modal-head">
          <h2>${tile.name}</h2>
          <button class="modal-close" type="button" id="modalClose" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="hero" style="background-image:url('${tile.image}')"></div>
        </div>
        <div class="modal-actions">
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
    // Android WebXR / desktop → ar.html; iPhone → ios.html
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    window.location.href = isIOS ? `/ios.html?${params}` : `/ar.html?${params}`;
  });

  document.getElementById('btnAi').addEventListener('click', () => {
    const body = backdrop.querySelector('.modal-body');
    body.innerHTML = `
      <div class="hero" style="background-image:url('${tile.image}')"></div>
      <div class="ai-placeholder">
        <strong>AI Visualize</strong> is next — upload a photo of the customer’s space
        and preview this tile with Generative AI. Coming in a follow-up build.
      </div>
    `;
  });
}

function boot() {
  showSplashThen(() => {
    onAuthStateChanged(auth, (user) => {
      authReady = true;
      if (user) renderHome(user);
      else renderLogin();
    });
  });
}

boot();
