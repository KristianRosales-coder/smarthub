const sharp = require('sharp');

const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024; // 8MB raw upload
const MAX_EDGE = 1536;

/**
 * Validate + resize/compress room photo. Rejects oversized / wrong types.
 * Basic moderation is delegated to Gemini safety filters on generation.
 */
async function prepareRoomImage({ base64, mimeType }) {
  if (!base64 || typeof base64 !== 'string') {
    const err = new Error('Missing room photo.');
    err.code = 'invalid-argument';
    throw err;
  }
  const cleanMime = (mimeType || 'image/jpeg').toLowerCase();
  if (!ALLOWED.has(cleanMime)) {
    const err = new Error('Please upload a JPG, PNG, or WebP photo.');
    err.code = 'invalid-argument';
    throw err;
  }

  const buf = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (buf.length < 1024) {
    const err = new Error('Photo looks empty or corrupted. Try another shot.');
    err.code = 'invalid-argument';
    throw err;
  }
  if (buf.length > MAX_BYTES) {
    const err = new Error('Photo is too large (max 8MB). Try a smaller image.');
    err.code = 'invalid-argument';
    throw err;
  }

  const out = await sharp(buf)
    .rotate()
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return {
    mimeType: 'image/jpeg',
    base64: out.toString('base64'),
    byteLength: out.length,
  };
}

async function prepareTileReference({ base64, mimeType, url }) {
  if (base64) {
    const buf = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    const out = await sharp(buf)
      .resize({ width: 768, height: 768, fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { mimeType: 'image/jpeg', base64: out.toString('base64') };
  }
  if (url && /^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) {
      const err = new Error('Could not load tile reference image.');
      err.code = 'failed-precondition';
      throw err;
    }
    const arr = Buffer.from(await res.arrayBuffer());
    const out = await sharp(arr)
      .resize({ width: 768, height: 768, fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { mimeType: 'image/jpeg', base64: out.toString('base64') };
  }
  const err = new Error('Tile reference image is required.');
  err.code = 'invalid-argument';
  throw err;
}

module.exports = { prepareRoomImage, prepareTileReference, ALLOWED, MAX_BYTES };
