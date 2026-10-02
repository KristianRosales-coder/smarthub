const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');
const { buildFloorReplacePrompt } = require('./prompt');
const { prepareRoomImage, prepareTileReference } = require('./validate');
const { assertCanGenerate, deductCredit, PUBLIC_START_CREDITS, KIOSK_START_CREDITS } = require('./credits');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const geminiApiKey = defineSecret('GEMINI_API_KEY');
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
