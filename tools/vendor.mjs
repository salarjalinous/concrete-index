#!/usr/bin/env node
// Copies the pinned third-party files the site self-hosts out of node_modules
// and into /assets, so no page ever loads a script, font, or stylesheet from
// another origin. Run after `npm ci`. Versions are pinned in package.json and
// package-lock.json; this script refuses to run against any other version.
//
//   fonts  -> /assets/fonts/*.woff2 (latin subset) + one OFL license per family,
//             only with --fonts: the committed files are re-subset by
//             tools/subset-fonts.sh to fit the 110 KB budget, and a plain
//             copy would undo that. Run the subset script after --fonts.
//   chart  -> /assets/vendor/chart.umd.min.js (Chart.js 4.4.1 UMD build)

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NM = join(ROOT, 'node_modules');

function pkgVersion(name) {
  return JSON.parse(readFileSync(join(NM, name, 'package.json'), 'utf8')).version;
}
function expect(name, version) {
  const v = pkgVersion(name);
  if (v !== version) throw new Error(`${name} is ${v}, expected ${version}. Run npm ci.`);
}

const FONTS = [
  { pkg: '@fontsource/source-serif-4', slug: 'source-serif-4', weights: [600, 700], license: 'source-serif-4-OFL.txt' },
  { pkg: '@fontsource/public-sans', slug: 'public-sans', weights: [400, 500, 600], license: 'public-sans-OFL.txt' },
  { pkg: '@fontsource/ibm-plex-mono', slug: 'ibm-plex-mono', weights: [500, 600], license: 'ibm-plex-mono-OFL.txt' },
];

expect('chart.js', '4.4.1');

const fontDir = join(ROOT, 'assets', 'fonts');
mkdirSync(fontDir, { recursive: true });
for (const f of process.argv.includes('--fonts') ? FONTS : []) {
  for (const w of f.weights) {
    const file = `${f.slug}-latin-${w}-normal.woff2`;
    copyFileSync(join(NM, f.pkg, 'files', file), join(fontDir, file));
  }
  copyFileSync(join(NM, f.pkg, 'LICENSE'), join(fontDir, f.license));
}

const vendorDir = join(ROOT, 'assets', 'vendor');
mkdirSync(vendorDir, { recursive: true });
// The npm UMD build is already minified. Drop the sourceMappingURL comment so
// browsers do not request a map file the site does not ship.
const chart = readFileSync(join(NM, 'chart.js', 'dist', 'chart.umd.js'), 'utf8')
  .replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
writeFileSync(join(vendorDir, 'chart.umd.min.js'), chart);
copyFileSync(join(NM, 'chart.js', 'LICENSE.md'), join(vendorDir, 'chart.js-LICENSE.md'));

console.log(`vendor: ${process.argv.includes('--fonts') ? 'fonts and ' : ''}Chart.js 4.4.1 copied into /assets`);
