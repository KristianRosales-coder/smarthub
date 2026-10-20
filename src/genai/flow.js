import {
  compressImageFile,
  fetchTileImageAsBase64,
  generateTilePreview,
  getAiCredits,
} from './api.js';

const DISCLAIMER =
  '⚠️ This image is AI-generated for visualization purposes only. Actual tile color, size, texture, pattern, and lighting may look different in person. Please visit our store or consult our staff to confirm your selection before purchasing.';

const CONSENT =
  'Your photo is used only to generate this preview and is deleted after processing (not stored).';

/**
 * Full Gen AI Tile Visualizer flow inside a modal host element.
 * @param {object} opts
 * @param {HTMLElement} opts.host - modal body/actions container parent
 * @param {object} opts.tile - catalog tile with metadata for prompt
 * @param {'kiosk'|'public'} opts.mode
 * @param {() => void} opts.onClose
 * @param {(tile) => void} [opts.onAddToCart]
 * @param {() => void} [opts.onTryAnother]
 */
export async function openGenAiFlow({ host, tile, mode = 'kiosk', onClose, onAddToCart, onTryAnother }) {
  let roomPreviewUrl = null;
  let roomPayload = null;
  let credits = null;

  try {
    credits = await getAiCredits(mode);
  } catch {
    credits = { remaining: mode === 'kiosk' ? '—' : 5, mode };
  }

  const root = document.createElement('div');
  root.className = 'genai-flow';
  host.replaceChildren(root);

  function renderGuide() {
    root.innerHTML = `
      <div class="genai-panel">
        <div class="genai-hero" style="background-image:url('${tile.image}')"></div>
        <div class="genai-content">
          <h3>Visualize in My Space</h3>
          <p class="genai-credits">AI credits left: <strong>${credits?.remaining ?? '—'}</strong></p>
          <ol class="genai-guide">
            <li>Stand at a <strong>corner</strong> so walls and floor meet clearly.</li>
            <li>Keep the <strong>floor visible</strong> and mostly unobstructed.</li>
            <li>Use <strong>good lighting</strong> — avoid dark or harsh glare.</li>
            <li>Hold steady — <strong>avoid blurry</strong> photos.</li>
          </ol>
          <p class="genai-consent">${CONSENT}</p>
          <label class="genai-check">
            <input type="checkbox" id="genaiConsent" />
            <span>I understand this is a preview and my photo won’t be stored.</span>
          </label>
          <div class="genai-actions">
            <button type="button" class="btn-primary" id="genaiCamera" disabled>Take Photo</button>
            <button type="button" class="btn-secondary" id="genaiUpload" disabled>Upload Photo</button>
          </div>
          <input type="file" id="genaiFile" accept="image/*" hidden />
          <input type="file" id="genaiCapture" accept="image/*" capture="environment" hidden />
        </div>
      </div>
    `;

    const consent = root.querySelector('#genaiConsent');
    const camBtn = root.querySelector('#genaiCamera');
    const upBtn = root.querySelector('#genaiUpload');
    const fileInput = root.querySelector('#genaiFile');
    const captureInput = root.querySelector('#genaiCapture');

    const sync = () => {
      camBtn.disabled = !consent.checked;
      upBtn.disabled = !consent.checked;
    };
    consent.addEventListener('change', sync);

    upBtn.addEventListener('click', () => fileInput.click());
    camBtn.addEventListener('click', () => captureInput.click());

    const onFile = async (file) => {
      if (!file) return;
      try {
        roomPayload = await compressImageFile(file);
        if (roomPreviewUrl) URL.revokeObjectURL(roomPreviewUrl);
        roomPreviewUrl = URL.createObjectURL(file);
        renderConfirm();
      } catch (err) {
        alert(err.message || 'Could not read that photo.');
      }
    };

    fileInput.addEventListener('change', () => onFile(fileInput.files?.[0]));
    captureInput.addEventListener('change', () => onFile(captureInput.files?.[0]));
  }

  function renderConfirm() {
    root.innerHTML = `
      <div class="genai-panel">
        <div class="genai-preview-wrap">
          <img class="genai-preview" src="${roomPreviewUrl}" alt="Your room photo" />
        </div>
        <div class="genai-content">
          <h3>Ready to preview ${escapeHtml(tile.name)}?</h3>
          <p class="genai-note">Better photos = better results. AR is more accurate for true size; AI is a quick preview.</p>
          <div class="genai-actions">
            <button type="button" class="btn-secondary" id="genaiRetake">Choose another photo</button>
            <button type="button" class="btn-primary" id="genaiGenerate">Generate preview</button>
          </div>
        </div>
      </div>
    `;
    root.querySelector('#genaiRetake').addEventListener('click', renderGuide);
    root.querySelector('#genaiGenerate').addEventListener('click', runGenerate);
  }

  async function runGenerate() {
    root.innerHTML = `
      <div class="genai-panel genai-loading">
        <div class="genai-spinner" aria-hidden="true"></div>
        <h3>Creating your floor preview…</h3>
        <p>This can take up to a minute. Please keep this screen open.</p>
      </div>
    `;

    try {
      let tileImageBase64;
      let tileMimeType;
      try {
        const t = await fetchTileImageAsBase64(tile.image);
        tileImageBase64 = t.base64;
        tileMimeType = t.mimeType;
      } catch {
        /* server may still fetch absolute URL if hosted */
      }

      const absTileUrl = new URL(tile.image, window.location.origin).href;

      const result = await generateTilePreview({
        mode,
        tile: {
          id: tile.id,
          name: tile.name,
          sku: tile.sku,
          color: tile.color,
          finish: tile.finish,
          material: tile.material || tile.kind,
          sizeCm: tile.sizeCm,
          pattern: tile.pattern,
          groutColor: tile.groutColor,
        },
        roomImageBase64: roomPayload.base64,
        roomMimeType: roomPayload.mimeType,
        tileImageBase64,
        tileMimeType,
        tileImageUrl: absTileUrl,
      });

      credits = { remaining: result.creditsRemaining, mode };
      const outUrl = `data:${result.mimeType};base64,${result.imageBase64}`;
      renderResult(outUrl, result.disclaimer || DISCLAIMER);
    } catch (err) {
      const msg = err?.message || err?.code || 'Generation failed.';
      root.innerHTML = `
        <div class="genai-panel genai-content">
          <h3>Couldn’t generate preview</h3>
          <p class="genai-error">${escapeHtml(friendlyError(msg))}</p>
          <p class="genai-note">No credit was deducted for this failed attempt (if the server rejected before success).</p>
          <div class="genai-actions">
            <button type="button" class="btn-secondary" id="genaiBack">Back</button>
            <button type="button" class="btn-primary" id="genaiRetry">Try again</button>
          </div>
        </div>
      `;
      // Note: if failure happens after model success but before client receives, credit may already be deducted server-side — that's correct.
      root.querySelector('#genaiBack').addEventListener('click', renderConfirm);
      root.querySelector('#genaiRetry').addEventListener('click', runGenerate);
    }
  }

  function renderResult(resultUrl, disclaimer) {
    root.innerHTML = `
      <div class="genai-panel">
        <div class="genai-compare" id="genaiCompare">
          <img class="genai-compare-after" src="${resultUrl}" alt="AI preview with selected tile" />
          <div class="genai-compare-before-wrap" id="genaiBeforeWrap">
            <img class="genai-compare-before" src="${roomPreviewUrl}" alt="Original room photo" />
          </div>
          <input class="genai-compare-range" id="genaiRange" type="range" min="0" max="100" value="50" aria-label="Before and after slider" />
          <div class="genai-watermark">AI-generated preview · not exact</div>
        </div>
        <div class="genai-content">
          <p class="genai-disclaimer">${escapeHtml(disclaimer)}</p>
          <p class="genai-credits">Credits remaining: <strong>${credits?.remaining ?? '—'}</strong></p>
          <div class="genai-actions genai-actions-3">
            <button type="button" class="btn-primary" id="genaiCart">Add to Cart</button>
            <button type="button" class="btn-secondary" id="genaiAnother">Try another tile</button>
            <button type="button" class="btn-secondary" id="genaiDownload">Download</button>
          </div>
        </div>
      </div>
    `;

    const wrap = root.querySelector('#genaiBeforeWrap');
    const range = root.querySelector('#genaiRange');
    const setSplit = (v) => { wrap.style.width = `${v}%`; };
    setSplit(range.value);
    range.addEventListener('input', () => setSplit(range.value));

    root.querySelector('#genaiCart').addEventListener('click', () => {
      onAddToCart?.(tile);
      alert(`${tile.name} added to cart. Checkout when ready — staff will capture the order summary after POS payment.`);
    });
    root.querySelector('#genaiAnother').addEventListener('click', () => {
      onTryAnother?.();
      onClose?.();
    });
    root.querySelector('#genaiDownload').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = resultUrl;
      a.download = `tiledepot-preview-${tile.sku || 'tile'}.jpg`;
      a.click();
    });
  }

  renderGuide();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function friendlyError(msg) {
  const m = String(msg);
  if (/resource-exhausted|credit/i.test(m)) return m;
  if (/unauthenticated|permission/i.test(m)) return 'Please sign in again to use in-store AI visualization.';
  if (/invalid-argument/i.test(m)) return m;
  if (/not-found|UNAVAILABLE|internal/i.test(m)) {
    return 'AI service is not available yet. Deploy Cloud Functions and set GEMINI_API_KEY, then try again.';
  }
  return m;
}
