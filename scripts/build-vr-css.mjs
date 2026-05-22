// Compiles app/globals.css into a standalone stylesheet for the visual-
// regression gallery (tests/vr/app.css), using the same Tailwind v4 engine the
// app builds with. Fast (~100ms) and deterministic — no Next build required.
//
// Run via `npm run test:vr` / `test:vr:update` (wired in package.json), or:
//   node scripts/build-vr-css.mjs
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'app', 'globals.css');
const output = path.join(root, 'tests', 'vr', 'app.css');

// execSync runs through the platform shell, so `npx` resolves to npx.cmd on
// Windows (Node 24 blocks spawning .cmd directly without a shell).
execSync(`npx --yes @tailwindcss/cli@4 -i "${input}" -o "${output}"`, {
  stdio: 'inherit',
  cwd: root,
});
console.log(`✓ VR CSS written to ${path.relative(root, output)}`);
