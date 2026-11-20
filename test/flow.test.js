'use strict';
/* Money-flow sign-off checklist (PRD 7.2), on today's data files. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'assets', 'ci.js'));
const fmt = globalThis.ci.fmt;
const L = require(path.join(ROOT, 'assets', 'flow', 'flow-layout.js'));
const S = require(path.join(ROOT, 'assets', 'flow', 'flow-svg.js'));
const D = require(path.join(ROOT, 'assets', 'flow', 'flow-data.js'));
const B = require(path.join(ROOT, 'tools', 'build-flow.js'));
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const pc = rd('precomputed.json'), cb = rd('checkbook-vendors.json');
const NOW = Date.parse(cb.meta.generated);

function setup(opts) {
  const doc = D.fromSources(pc, cb);
  const model = D.model(doc, fmt, NOW);
  const lay = L.layout(model.lanes.map((l) => ({ id: l.id, value: l.value })), opts);
  return { doc, model, lay };
}

test('fallback lanes equal the nightly builder and the owning sums', () => {
  const { doc } = setup({ viewportW: 1280 });
  const built = B.build({ precomputed: pc, planHistory: null, awards: rd('awards.json'), vendors: cb });
  built.lanes.forEach((l, i) => assert.strictEqual(doc.lanes[i].value, l.value, l.id));
  assert.strictEqual(doc.lanes[0].value, pc.glimpse.committed);
  assert.strictEqual(doc.lanes[1].value, pc.awarded_ttm.total);
});

for (const [w, mobile] of [[1280, false], [390, true]]) {
  test(`encoding at ${w}px`, () => {
    const { lay, model } = setup({ viewportW: w, mobile });
    assert.strictEqual(lay.H, w >= 720 ? 120 : 72);
    // thickness ratio = dollar ratio within 0.5px, except hatched lanes
    const ok = lay.lanes.filter((g) => !g.hatched && !g.missing);
    for (const a of ok) for (const b of ok) assert.ok(Math.abs(a.h / b.h - a.value / b.value) * b.h < 0.5);
    lay.lanes.forEach((g) => { if (g.hatched) assert.strictEqual(g.h, 2); });
    // scale bar = amount * s
    assert.ok(Math.abs(lay.scale.px - lay.scale.amount * lay.s) < 1e-9);
    // dots = round(D/U) (min 1), within the cap, smallest ladder step
    const n = lay.lanes.reduce((a, g) => a + g.dots, 0);
    lay.lanes.forEach((g) => assert.strictEqual(g.dots, Math.max(1, Math.round(g.value / lay.U))));
    assert.ok(n <= lay.cap);
    const i = L.LADDER.indexOf(lay.U);
    if (i > 0) assert.ok(model.lanes.reduce((a, l) => a + L.dotCount(l.value, L.LADDER[i - 1]), 0) > lay.cap);
    // dots drawn in the static SVG = dots encoded
    const html = S.figure(model, lay, fmt);
    assert.strictEqual((html.match(/<circle /g) || []).length, n);
  });
}

test('splits sum to the lane to the dollar; lanes without a split carry the notice', () => {
  const built = B.build({ precomputed: pc, planHistory: null, awards: rd('awards.json'), vendors: cb });
  for (const l of built.lanes) if (l.split_agency) assert.strictEqual(l.split_agency.reduce((a, p) => a + p.value, 0), l.value);
  const doc = D.fromSources(pc, cb);
  doc.lanes[1].split_agency = built.lanes[1].split_agency;
  const m = D.model(doc, fmt, NOW);
  assert.ok(m.lanes[1].split);
  assert.strictEqual(m.lanes[2].splitNote, D.NO_SPLIT);
  assert.strictEqual(m.lanes[3].splitNote, D.NO_SPLIT);
});

test('copy rules on the drawing', () => {
  const { model, lay } = setup({ viewportW: 1280 });
  const html = S.figure(model, lay, fmt);
  // definition panels quote the methodology verbatim and are checked there
  const text = html.replace(/<div class="flow-def__panel">[\s\S]*?<\/div>/g, ' ').replace(/<[^>]+>/g, ' ');
  assert.ok(text.includes(D.DISCLAIMER));
  assert.ok(/Gross ·/.test(text) && /Cumulative paid/.test(text));
  assert.ok(!/\b(total|sum|conversion|of which|lost)\b/i.test(text.replace(D.DISCLAIMER, '')), 'no total or conversion wording');
  assert.ok(!/—/.test(html));
  assert.ok(!/\sstyle=/.test(html));
});

test('a dropped Checkbook file shows an en dash and no band', () => {
  const doc = D.fromSources(pc, cb);
  const m = D.model(doc, fmt, NOW + 15 * 864e5);
  assert.ok(m.lanes[2].missing && m.lanes[3].missing);
  const lay = L.layout(m.lanes.map((l) => ({ id: l.id, value: l.missing ? null : l.value })), { viewportW: 1280 });
  const html = S.figure(m, lay, fmt);
  assert.ok(/Not available, as of/.test(html));
  assert.ok(!html.split('id="lane-paid"')[1].split('</li>')[0].includes('class="flow-band'));
});
