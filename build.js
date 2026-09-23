// After Vite builds the walk-in app into dist/, copy the standalone AR pages
// and ensure tile assets used by AR are present.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

if (!fs.existsSync(DIST)) {
  fs.mkdirSync(DIST, { recursive: true });
}

const COPIES = [
  { from: path.join(ROOT, 'ar.html'), to: path.join(DIST, 'ar.html') },
  { from: path.join(ROOT, 'ios.html'), to: path.join(DIST, 'ios.html') },
  { from: path.join(PUBLIC, 'tile-sample.jpg'), to: path.join(DIST, 'tile-sample.jpg') },
  { from: path.join(PUBLIC, 'tile_depot_header.jpg'), to: path.join(DIST, 'tile_depot_header.jpg') },
];

for (const { from, to } of COPIES) {
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, to);
    console.log(`Copied ${path.relative(ROOT, from)} -> dist/${path.basename(to)}`);
  } else {
    console.warn(`Skipped (missing): ${from}`);
  }
}

console.log('\nPost-build complete. Walk-in UI + AR pages are in dist/.');
