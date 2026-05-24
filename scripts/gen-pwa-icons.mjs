// Generate the PWA icon set from a single square-ish source image.
//   node scripts/gen-pwa-icons.mjs [sourceImage] [--bg <hex|auto>]
// Default source is public/logo.png. Re-run after replacing the logo.
//
// Background defaults to "auto": the script samples the source's top-left
// pixel, so a logo that already carries its own (e.g. dark) background tiles
// seamlessly and the maskable padding matches it. A fully transparent corner
// falls back to white. Force a colour with: --bg "#0e2a2a".
//
// Outputs into public/: icon-192.png, icon-512.png, icon-maskable-512.png,
// apple-touch-icon.png. The maskable icon centres the logo inside the ~80%
// safe zone (padded with the background colour) so Android's mask never clips.
import sharp from 'sharp';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const src = positional[0] || 'public/logo.png';

function flagValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

// Detect the background colour to pad with: an explicit --bg hex, otherwise the
// source's top-left pixel (transparent corner → white).
async function detectBg() {
  const flag = flagValue('--bg');
  if (flag && flag !== 'auto') return hexToRgb(flag);
  const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
  const alpha = info.channels >= 4 ? data[3] : 255;
  if (alpha < 16) return { r: 255, g: 255, b: 255, alpha: 1 };
  return { r: data[0], g: data[1], b: data[2], alpha: 1 };
}

const BG = await detectBg();

// Flatten composites any transparency onto BG so the icon is fully opaque.
async function contain(size, file) {
  await sharp(src)
    .resize(size, size, { fit: 'contain', background: BG })
    .flatten({ background: BG })
    .png()
    .toFile(`public/${file}`);
  console.log(`  public/${file}  (${size}x${size})`);
}

async function maskable(size, file) {
  const inner = Math.round(size * 0.8); // crisp logo fills the ~80% maskable safe zone
  // Backdrop: the logo itself cropped to fill the square and heavily blurred.
  // This carries the brand's textured dark background edge-to-edge so there is
  // no flat-colour seam around the centred logo, and the mask only ever clips
  // blurred background (never the antlers).
  const backdrop = await sharp(src)
    .resize(size, size, { fit: 'cover' })
    .blur(28)
    .modulate({ brightness: 0.85 }) // darken slightly so the crisp logo pops
    .flatten({ background: BG })
    .png()
    .toBuffer();
  const logo = await sharp(src)
    .resize(inner, inner, { fit: 'contain', background: BG })
    .flatten({ background: BG })
    .png()
    .toBuffer();
  await sharp(backdrop)
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(`public/${file}`);
  console.log(`  public/${file}  (${size}x${size}, maskable)`);
}

console.log(`Generating PWA icons from ${src} …`);
console.log(`Background: rgb(${BG.r}, ${BG.g}, ${BG.b})`);
await contain(192, 'icon-192.png');
await contain(512, 'icon-512.png');
await contain(180, 'apple-touch-icon.png');
await maskable(512, 'icon-maskable-512.png');
console.log('Done.');
