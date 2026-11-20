#!/usr/bin/env node
// Stamps the Home page's data-bearing markup at authoring time (PRD 7.5): the
// static money-flow figure between <!-- home:flow --> markers, and the text of
// every element carrying data-home="<key>" (index value, as-of dates, tape and
// section values). The page then works without JavaScript; home.js replaces a
// value at load only when the data has moved on.
//
// Same modules as the browser: assets/flow/*.js and assets/ci.js (ci.fmt).
// The Awarded agency split comes from tools/build-flow.js, which recomputes it
// from awards.json at the precompute's own instant and withholds it unless it
// sums to the published total.
//
//   node tools/render-flow.mjs          rewrite index.html
//   node tools/render-flow.mjs --check  exit 1 if index.html is out of date
//
// Run after any change to data/precomputed.json or data/checkbook-vendors.json.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require(join(ROOT, 'assets', 'ci.js'));          // sets globalThis.ci (formatter only under Node)
const fmt = globalThis.ci.fmt;
const Lay = require(join(ROOT, 'assets', 'flow', 'flow-layout.js'));
const Svg = require(join(ROOT, 'assets', 'flow', 'flow-svg.js'));
const Data = require(join(ROOT, 'assets', 'flow', 'flow-data.js'));
const Stamp = require(join(ROOT, 'assets', 'flow', 'flow-stamp.js'));
const BuildFlow = require(join(ROOT, 'tools', 'build-flow.js'));

const rd = (f) => { const p = join(ROOT, 'data', f); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const pc = rd('precomputed.json');
const cb = rd('checkbook-vendors.json');
const awards = rd('awards.json');
const planHistory = rd('plan-history.json');

// The figure as the page draws it when data/flow.json is not there yet (the
// path every reader takes on day one), plus the nightly builder's split.
const doc = Data.fromSources(pc, cb);
const built = BuildFlow.build({ precomputed: pc, planHistory, awards, vendors: cb });
const stampSplit = {};
for (const l of built.lanes) {
  if (l.split_agency && l.split_agency.length) stampSplit[l.id] = { value: l.value, split: l.split_agency };
}
for (const l of doc.lanes) {
  const s = stampSplit[l.id];
  if (s && s.value === l.value) l.split_agency = s.split;
}
// Age the Checkbook file at its own generated stamp, so an authoring run
// never drops a lane the page would show.
const now = cb && cb.meta && cb.meta.generated ? Date.parse(cb.meta.generated) : Date.now();
const model = Data.model(doc, fmt, now);
const lay = Lay.layout(model.lanes.map((l) => ({ id: l.id, value: l.missing ? null : l.value })), { viewportW: 1280, mobile: false });
const inner = Svg.figure(model, lay, fmt);
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const fig = `<figure class="flow" id="flow" aria-labelledby="flow-cap" data-sig="${Svg.sig(inner)}" data-stamp-split="${attr(JSON.stringify(stampSplit))}">${inner}</figure>`;

const file = join(ROOT, 'index.html');
const before = readFileSync(file, 'utf8');
let html = before.replace(/<!-- home:flow -->[\s\S]*?<!-- \/home:flow -->/, () => `<!-- home:flow -->\n  ${fig}\n  <!-- /home:flow -->`);
if (html === before && !/<!-- home:flow -->/.test(before)) throw new Error('index.html: missing <!-- home:flow --> markers');

const vals = Stamp.values(pc, cb && cb.meta, model, fmt);
const seen = new Set();
html = html.replace(/(<([a-z0-9]+)\b[^>]*\sdata-home="([a-z0-9-]+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, key, text, close) => {
  seen.add(key);
  if (!(key in vals)) return m;
  const t = Svg.esc(vals[key]);
  // a stamped value is no longer "no data"
  const o = t && t !== '–' ? open.replace(/\saria-label="no data"/, '') : open;
  return o + t + close;
});
for (const k of Object.keys(vals)) if (!seen.has(k)) throw new Error(`index.html: no element carries data-home="${k}"`);

if (process.argv.includes('--check')) {
  if (html !== before) { console.error('render-flow: index.html is out of date; run node tools/render-flow.mjs'); process.exit(1); }
  console.log('render-flow: index.html current');
} else {
  if (html !== before) writeFileSync(file, html);
  console.log(`render-flow: ${html === before ? 'unchanged' : 'index.html stamped'}; U=${fmt(lay.U, 'money')} dots=${lay.dotsTotal} scale=${fmt(lay.scale.amount, 'money')}@${lay.scale.px.toFixed(1)}px lanes=` +
    model.lanes.map((l) => `${l.id}:${l.missing ? 'missing' : fmt(l.value, 'money')}`).join(' '));
}
