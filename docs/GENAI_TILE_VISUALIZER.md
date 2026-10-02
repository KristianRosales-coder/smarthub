# Gen AI Tile Visualizer

## What it does
Walk-in customers pick a tile → follow a photo guide → upload/take a room photo →
server builds a **fixed prompt** (customer never sees it) → Gemini edits only the floor
using the tile product image as reference → before/after slider + disclaimer →
Add to Cart / Try another / Download.

## Privacy
- Room photos are processed in memory and **not stored** in Firestore/Storage.
- Only a small audit doc is written (`tile name`, mode, timestamp) — no image bytes.
- Consent checkbox is required before upload.

## Credits
| Mode | Key | Default credits |
|------|-----|-----------------|
| Kiosk (signed-in staff) | `kiosk_{uid}` | 200 |
| Public (later) | `pub_{sessionId}` | 5 |

Credits are tracked in Firestore via Cloud Functions (not only `localStorage`).
Credit is deducted **only after a successful** image is returned.
Rate limit: 6 attempts / minute / session.

## Deploy (required before AI works)

1. Upgrade Firebase project to **Blaze** (pay-as-you-go) for Functions + Gemini image models.
2. Enable **Firestore** in the console.
3. Create a Gemini API key (Google AI Studio) and set the secret:

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

4. Install & deploy:

```bash
cd functions && npm install && cd ..
firebase deploy --only functions,firestore:rules
npm run build
firebase deploy --only hosting
```

5. Optional model override (default `gemini-2.5-flash-image`):

```bash
firebase functions:config:set # or set env GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
```

## Local UI
```bash
npm run dev
```
Sign in → open a tile → **AI VISUALIZE TILE**.

## Capstone notes
- AR = accurate scale / live floor lock.
- Gen AI = quick “see it in my photo” preview; scale/grout may be approximate (document as limitation).
