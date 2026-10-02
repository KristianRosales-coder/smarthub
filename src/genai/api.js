/**
 * Client helpers for Gen AI Tile Visualizer.
 * Prompt & API key stay on the server (Cloud Function).
 */
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { app } from '../firebase-app.js';

const functions = getFunctions(app); // default region us-central1 — match functions/index.js

// Uncomment when using local emulator:
// if (location.hostname === 'localhost') connectFunctionsEmulator(functions, '127.0.0.1', 5001);

const SESSION_KEY = 'tddc_ai_session';

export function getOrCreateSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || `s_${Date.now()}_${Math.random().toString(36).slice(2)}`) + '';
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `tmp_${Date.now()}`;
  }
}

export async function fileToBase64(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const [meta, data] = String(dataUrl).split(',');
  const mime = /data:([^;]+)/.exec(meta)?.[1] || file.type || 'image/jpeg';
  return { base64: data, mimeType: mime };
}

/** Compress on-device before upload (faster + cheaper). */
export async function compressImageFile(file, maxEdge = 1536, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not process photo.');
  return fileToBase64(new File([blob], 'room.jpg', { type: 'image/jpeg' }));
}

export async function fetchTileImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load tile image.');
  const blob = await res.blob();
  return fileToBase64(new File([blob], 'tile.jpg', { type: blob.type || 'image/jpeg' }));
}

export async function generateTilePreview({ mode, tile, roomImageBase64, roomMimeType, tileImageBase64, tileMimeType, tileImageUrl }) {
  const callable = httpsCallable(functions, 'generateTilePreview', { timeout: 120_000 });
  const result = await callable({
    sessionId: getOrCreateSessionId(),
    mode,
    tile,
    roomImageBase64,
    roomMimeType,
    tileImageBase64,
    tileMimeType,
    tileImageUrl,
  });
  return result.data;
}

export async function getAiCredits(mode) {
  const callable = httpsCallable(functions, 'getAiCredits');
  const result = await callable({
    sessionId: getOrCreateSessionId(),
    mode,
  });
  return result.data;
}

export { functions };
