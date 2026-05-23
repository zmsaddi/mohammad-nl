// Generate the PWA icon set from a single square-ish source image.
//   node scripts/gen-pwa-icons.mjs [sourceImage]
// Default source is public/stamp.png (temporary). Re-run with the real logo:
//   node scripts/gen-pwa-icons.mjs public/logo.png
//
// Outputs into public/: icon-192.png, icon-512.png, icon-maskable-512.png,
// apple-touch-icon.png. The maskable icon centres the logo on a white canvas
// inside the ~80% safe zone so Android's mask (circle/squircle) never clips it.
import sharp from 'sharp';

const src = process.argv[2] || 'public/stamp.png';
const BG = { r: 255, g: 255, b: 255, alpha: 1 };

async function contain(size, file) {
  await sharp(src).resize(size, size, { fit: 'contain', background: BG }).png().toFile(`public/${file}`);
  console.log(`  public/${file}  (${size}x${size})`);
}

async function maskable(size, file) {
  const inner = Math.round(size * 0.66); // logo fills ~66% → inside the safe zone
  const logo = await sharp(src).resize(inner, inner, { fit: 'contain', background: BG }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(`public/${file}`);
  console.log(`  public/${file}  (${size}x${size}, maskable)`);
}

console.log(`Generating PWA icons from ${src} …`);
await contain(192, 'icon-192.png');
await contain(512, 'icon-512.png');
await contain(180, 'apple-touch-icon.png');
await maskable(512, 'icon-maskable-512.png');
console.log('Done.');
