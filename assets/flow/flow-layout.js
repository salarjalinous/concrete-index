/* The Concrete Index · money-flow geometry (PRD 7.2, Concept A). Pure: no DOM,
 * no clock. Runs in the browser (window.CIFlowLayout) and in Node at authoring
 * time (tools/render-flow.mjs), so the static SVG and the live one agree.
 *
 * Encoding, as specified and tested (test/flow.test.js):
 *   thickness  h = D * s, s = H / max(D), one scale for all four lanes
 *   minimum    a nonzero lane under 2px draws at 2px, hatched; label unchanged
 *   dots       each dot = U, the smallest ladder step for which the dots of all
 *              lanes fit the cap; dots per lane = round(D / U), at least one on
 *              a nonzero lane (flagged like the hatch)
 *   scale bar  a round amount drawn at exactly amount * s
 * Nothing here adds the lanes together for display: max(D) sets the scale and
 * the dot count is checked against the cap, nothing else.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CIFlowLayout = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LADDER = [100e6, 250e6, 500e6, 1e9, 2e9, 5e9, 10e9];
  var SCALE_STEPS = [1e9, 2e9, 5e9, 10e9, 20e9, 25e9, 50e9, 100e9, 200e9, 500e9];
  var MIN_PX = 2;
  var CAP = { desktop: 240, mobile: 90 };

  /* Maximum band thickness: 120px at 720px wide and up, 72px at 390 and
     below, linear in between. */
  function bandMax(viewportW) {
    if (!(viewportW < 720)) return 120;
    if (viewportW <= 390) return 72;
    return Math.round(72 + (viewportW - 390) * (48 / 330));
  }

  function usable(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

  function dotCount(D, U) { return usable(D) ? Math.max(1, Math.round(D / U)) : 0; }

  /* Smallest ladder step whose total dot count is at or under the cap. */
  function pickUnit(values, cap) {
    for (var i = 0; i < LADDER.length; i++) {
      var U = LADDER[i], n = 0;
      for (var j = 0; j < values.length; j++) n += dotCount(values[j], U);
      if (n <= cap) return U;
    }
    return LADDER[LADDER.length - 1];
  }

  /* Largest round amount at or under a tenth of the largest lane, so the bar
     stays a short reference mark next to its caption. */
  function pickScale(maxD) {
    var best = SCALE_STEPS[0];
    for (var i = 0; i < SCALE_STEPS.length; i++) if (SCALE_STEPS[i] <= maxD / 10) best = SCALE_STEPS[i];
    return best;
  }

  /* Seeded PRNG (mulberry32), so dot positions are reproducible: the static
     SVG drawn at authoring time and the first canvas frame put every dot in
     the same place. */
  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* n dots per lane: fx in [0,1) along the lane, evenly spaced with jitter;
     fy in [0,1] across the band's thickness. */
  function dotSeeds(laneIndex, n) {
    var r = prng(0x51CA + laneIndex * 7919), fx = [], fy = [];
    for (var i = 0; i < n; i++) {
      fx.push((i + 0.15 + 0.7 * r()) / n);
      fy.push(r());
    }
    return { fx: fx, fy: fy };
  }

  /* lanes: [{ id, value }] in display order. opts: { viewportW, mobile }.
     Returns the geometry the SVG, the canvas, and the tests read. */
  function layout(lanes, opts) {
    opts = opts || {};
    var mode = opts.mobile ? 'mobile' : 'desktop';
    var H = typeof opts.H === 'number' ? opts.H : bandMax(opts.viewportW);
    var vals = lanes.map(function (l) { return usable(l.value) ? l.value : null; });
    var maxD = 0;
    vals.forEach(function (v) { if (v != null && v > maxD) maxD = v; });
    var s = maxD > 0 ? H / maxD : 0;
    var cap = CAP[mode];
    var U = pickUnit(vals, cap);
    var out = lanes.map(function (l, i) {
      var D = vals[i];
      if (D == null) return { id: l.id, value: null, h: 0, exact: 0, hatched: false, dots: 0, dotMin: false, missing: true };
      var exact = D * s;
      var n = dotCount(D, U);
      return {
        id: l.id, value: D, exact: exact,
        h: exact < MIN_PX ? MIN_PX : exact,
        hatched: exact < MIN_PX,
        dots: n, dotMin: Math.round(D / U) === 0,
        missing: false
      };
    });
    var dots = out.reduce(function (a, l) { return a + l.dots; }, 0);
    var scaleAmount = maxD > 0 ? pickScale(maxD) : 0;
    return {
      mode: mode, H: H, s: s, maxD: maxD, U: U, cap: cap, dotsTotal: dots,
      minPx: MIN_PX, gapPx: 16,
      scale: { amount: scaleAmount, px: scaleAmount * s },
      lanes: out
    };
  }

  /* Split a lane in place: sub-bands of d * s stacked top to bottom, in the
     order given. With exact values the sub-bands tile the lane's exact
     thickness (sum d = D). */
  function splitBands(parts, s) {
    var y = 0;
    return parts.map(function (p) {
      var h = p.value * s, band = { name: p.name, value: p.value, y: y, h: h };
      y += h;
      return band;
    });
  }

  return { LADDER: LADDER, CAP: CAP, MIN_PX: MIN_PX, bandMax: bandMax, pickUnit: pickUnit,
    pickScale: pickScale, dotCount: dotCount, prng: prng, dotSeeds: dotSeeds,
    layout: layout, splitBands: splitBands };
}));
