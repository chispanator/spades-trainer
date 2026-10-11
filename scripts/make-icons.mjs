/**
 * Draws the app icon and writes every size the phone and browser ask for.
 *   node scripts/make-icons.mjs [outDir]
 *
 * The icon is one spade on felt. Three things are deliberate:
 *   - the maskable version keeps the spade inside the middle 80%, because
 *     Android crops to a circle, a squircle or whatever the launcher fancies;
 *   - the home-screen versions are full bleed, since iOS composites anything
 *     transparent onto black and rounds the corners itself;
 *   - only the browser icon gets rounded corners drawn in.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const BODY =
  'M50,12 C42,26 18,40 18,56 C18,68 27,76 37,76 C44,76 48,72 50,68 C52,72 56,76 63,76 C73,76 82,68 82,56 C82,40 58,26 50,12 Z';
const STEM = 'M50,64 C50,77 47,86 39,91 L61,91 C53,86 50,77 50,64 Z';

const IVORY = '#fdfcf7';
const GOLD = '#f0c14b';

/**
 * @param {object} o
 * @param {number} o.scale  how much of the canvas the spade fills
 * @param {number} o.round  corner radius in user units (0 = full bleed)
 */
function svg({ scale = 3.6, round = 0 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="felt" cx="0.5" cy="0.38" r="0.8">
      <stop offset="0" stop-color="#235340"/>
      <stop offset="1" stop-color="#07160d"/>
    </radialGradient>
    <filter id="drop" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="${round}" fill="url(#felt)"/>
  <g filter="url(#drop)" transform="translate(256,250) scale(${scale}) translate(-50,-52)">
    <path fill="${IVORY}" d="${BODY}"/>
    <path fill="${GOLD}" d="${STEM}"/>
  </g>
</svg>`;
}

const out = process.argv[2] ?? '.';
const targets = [
  // browser tab and bookmarks: rounded, scalable
  { file: 'app/icon.svg', raw: svg({ scale: 3.4, round: 96 }) },
  // iOS home screen; iOS rounds it for us
  { file: 'app/apple-icon.png', png: 180, raw: svg({ scale: 3.4, round: 0 }) },
  { file: 'public/icon-192.png', png: 192, raw: svg({ scale: 3.4, round: 0 }) },
  { file: 'public/icon-512.png', png: 512, raw: svg({ scale: 3.4, round: 0 }) },
  // Android may crop this to any shape, so the spade sits well inside
  { file: 'public/icon-maskable-512.png', png: 512, raw: svg({ scale: 2.7, round: 0 }) },
];

for (const t of targets) {
  const path = join(out, t.file);
  await mkdir(dirname(path), { recursive: true });
  if (t.png) {
    await sharp(Buffer.from(t.raw)).resize(t.png, t.png).png().toFile(path);
  } else {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, t.raw, 'utf8');
  }
  console.log('wrote', t.file);
}
