const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { GoogleGenAI } = require('@google/genai');
const { buildFloorReplacePrompt } = require('./prompt');
const { prepareRoomImage, prepareTileReference } = require('./validate');
const { assertCanGenerate, deductCredit, PUBLIC_START_CREDITS, KIOSK_START_CREDITS } = require('./credits');
const { isValidEmail, buildOrderSummaryEmail } = require('./email');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const geminiApiKey = defineSecret('GEMINI_API_KEY');
/**
 * Store Gmail for order-summary mail (Spark-friendly — no Secret Manager / Blaze).
 * Set in functions/.env (see .env.example), then deploy functions.
 */
const gmailUser = defineString('GMAIL_USER', { default: '' });
const gmailAppPassword = defineString('GMAIL_APP_PASSWORD', { default: '' });
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

function asHttpsError(err) {
  const code = err.code || 'internal';
  const map = {
    'invalid-argument': 'invalid-argument',
    'failed-precondition': 'failed-precondition',
    'resource-exhausted': 'resource-exhausted',
    'permission-denied': 'permission-denied',
  };
  return new HttpsError(map[code] || 'internal', err.message || 'Generation failed.');
}

function extractImage(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) return null;
  return {
    data: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || 'image/png',
  };
}

/**
 * Callable: generateTilePreview
 * Photos are NOT stored — only processed in memory.
 */
exports.generateTilePreview = onCall(
  {
    region: 'us-central1',
    secrets: [geminiApiKey],
    timeoutSeconds: 120,
    memory: '1GiB',
    cors: true,
  },
  async (request) => {
    try {
      const data = request.data || {};
      const uid = request.auth?.uid || null;
      const mode = data.mode === 'kiosk' && uid ? 'kiosk' : 'public';
      const sessionId = String(data.sessionId || '').slice(0, 128);

      const creditState = await assertCanGenerate(db, { uid, sessionId, mode });

      const tile = data.tile || {};
      if (!tile.name) {
        throw Object.assign(new Error('Select a tile first.'), { code: 'invalid-argument' });
      }

      const room = await prepareRoomImage({
        base64: data.roomImageBase64,
        mimeType: data.roomMimeType,
      });

      const tileRef = await prepareTileReference({
        base64: data.tileImageBase64,
        mimeType: data.tileMimeType,
        url: data.tileImageUrl,
      });

      const prompt = buildFloorReplacePrompt(tile);
      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

      const response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: room.mimeType, data: room.base64 } },
              { inlineData: { mimeType: tileRef.mimeType, data: tileRef.base64 } },
            ],
          },
        ],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      });

      const image = extractImage(response);
      if (!image) {
        throw Object.assign(
          new Error('AI could not generate a preview. Try another photo with a clearer floor view.'),
          { code: 'internal' }
        );
      }

      const creditsRemaining = await deductCredit(creditState.ref);

      await db.collection('aiGenerations').add({
        mode,
        uid: uid || null,
        sessionId,
        tileId: tile.id || null,
        tileName: tile.name,
        model: IMAGE_MODEL,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        success: true,
      });

      return {
        imageBase64: image.data,
        mimeType: image.mimeType,
        creditsRemaining,
        disclaimer:
          'This image is AI-generated for visualization purposes only. Actual tile color, size, texture, pattern, and lighting may look different in person. Please visit our store or consult our staff to confirm your selection before purchasing.',
      };
    } catch (err) {
      console.error('generateTilePreview', err);
      if (err instanceof HttpsError) throw err;
      throw asHttpsError(err);
    }
  }
);

exports.getAiCredits = onCall({ region: 'us-central1', cors: true }, async (request) => {
  try {
    const uid = request.auth?.uid || null;
    const mode = request.data?.mode === 'kiosk' && uid ? 'kiosk' : 'public';
    const sessionId = String(request.data?.sessionId || '').slice(0, 128);
    const key = mode === 'kiosk' && uid ? `kiosk_${uid}` : `pub_${sessionId}`;
    const snap = await db.collection('aiCredits').doc(key).get();
    if (!snap.exists) {
      return {
        remaining: mode === 'kiosk' ? KIOSK_START_CREDITS : PUBLIC_START_CREDITS,
        mode,
      };
    }
    return { remaining: snap.data().remaining ?? 0, mode };
  } catch (err) {
    throw asHttpsError(err);
  }
});

/**
 * Callable: sendOrderSummaryEmail
 * Staff-only. Emails the walk-in order summary to the customer (not a legal receipt).
 *
 * Configure without Blaze — create functions/.env:
 *   GMAIL_USER=yourstore@gmail.com
 *   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
 * Then: firebase deploy --only functions
 */
exports.sendOrderSummaryEmail = onCall(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    cors: true,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Staff sign-in required to email the customer.');
    }

    const order = request.data?.order || {};
    const to = String(order.customerEmail || '').trim();
    if (!isValidEmail(to)) {
      throw new HttpsError('invalid-argument', 'A valid customer email is required.');
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
      throw new HttpsError('invalid-argument', 'Order has no items to email.');
    }

    const user = gmailUser.value().trim();
    const pass = gmailAppPassword.value().replace(/\s+/g, '');
    if (!user || !pass) {
      throw new HttpsError(
        'failed-precondition',
        'Email is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to functions/.env, then redeploy functions.'
      );
    }

    const { subject, html, text } = buildOrderSummaryEmail(order);
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });

    try {
      const info = await transporter.sendMail({
        from: `"Tile Depot Discount Center" <${user}>`,
        to,
        replyTo: user,
        subject,
        text,
        html,
      });

      return {
        ok: true,
        to,
        messageId: info.messageId || null,
      };
    } catch (err) {
      console.error('sendOrderSummaryEmail', err);
      throw new HttpsError(
        'internal',
        err?.message || 'Could not send the order summary email. Check Gmail App Password settings.'
      );
    }
  }
);
