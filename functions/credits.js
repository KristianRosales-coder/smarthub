const admin = require('firebase-admin');

const PUBLIC_START_CREDITS = 5;
const KIOSK_START_CREDITS = 200; // high limit for in-store authenticated staff
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 6; // generations per minute per session

/**
 * Server-side credits keyed by sessionId (public) or uid (kiosk).
 * Deduct only after caller confirms success via markSuccess path
 * (we deduct inside generate after model returns OK).
 */
async function getCreditDocRef(db, { uid, sessionId, mode }) {
  const key = mode === 'kiosk' && uid ? `kiosk_${uid}` : `pub_${sessionId}`;
  return db.collection('aiCredits').doc(key);
}

async function ensureCredits(db, ctx) {
  const ref = await getCreditDocRef(db, ctx);
  const snap = await ref.get();
  const now = Date.now();
  const start = ctx.mode === 'kiosk' ? KIOSK_START_CREDITS : PUBLIC_START_CREDITS;

  if (!snap.exists) {
    const data = {
      remaining: start,
      mode: ctx.mode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUsedAt: null,
      rateWindowStart: now,
      rateCount: 0,
    };
    await ref.set(data);
    return { ref, remaining: start, rateWindowStart: now, rateCount: 0 };
  }

  const d = snap.data();
  return {
    ref,
    remaining: typeof d.remaining === 'number' ? d.remaining : start,
    rateWindowStart: d.rateWindowStart || now,
    rateCount: d.rateCount || 0,
  };
}

async function assertCanGenerate(db, ctx) {
  if (!ctx.sessionId || typeof ctx.sessionId !== 'string' || ctx.sessionId.length < 8) {
    const err = new Error('Missing session. Refresh and try again.');
    err.code = 'failed-precondition';
    throw err;
  }

  const state = await ensureCredits(db, ctx);
  const now = Date.now();
  let { rateWindowStart, rateCount, remaining, ref } = state;

  if (now - rateWindowStart > RATE_WINDOW_MS) {
    rateWindowStart = now;
    rateCount = 0;
  }
  if (rateCount >= RATE_MAX) {
    const err = new Error('Too many requests. Please wait a minute and try again.');
    err.code = 'resource-exhausted';
    throw err;
  }
  if (remaining <= 0) {
    const err = new Error(
      ctx.mode === 'kiosk'
        ? 'Kiosk AI credit limit reached. Ask an admin to reset credits.'
        : 'No AI credits left (public preview allows a few free tries). Visit our store for unlimited in-store visualization.'
    );
    err.code = 'resource-exhausted';
    throw err;
  }

  // Reserve rate slot before calling the model (credit deducted only on success).
  await ref.set(
    {
      rateWindowStart,
      rateCount: rateCount + 1,
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ref, remaining };
}

async function deductCredit(ref) {
  await ref.set(
    {
      remaining: admin.firestore.FieldValue.increment(-1),
      lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  const snap = await ref.get();
  return snap.data()?.remaining ?? 0;
}

module.exports = {
  assertCanGenerate,
  deductCredit,
  PUBLIC_START_CREDITS,
  KIOSK_START_CREDITS,
};
