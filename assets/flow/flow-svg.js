/* The Concrete Index · money-flow markup (PRD 7.2). Pure string rendering:
 * no DOM, no clock. tools/render-flow.mjs runs it at authoring time so the
 * served HTML carries the complete static figure (bands, dots, labels,
 * disclaimer, scale bar, table); the page runs it again only when the data or
 * the viewport mode differs from what was stamped.
 *
 *   CIFlowSVG.figure(model, lay, fmt)   whole <figure> inner markup
 *   CIFlowSVG.band(lane, geo, idx, lay) one lane's <svg>
 *
 * model: from CIFlowData.model(); lay: from CIFlowLayout.layout(); fmt: ci.fmt.
 * No style attributes (CSP): colors and states are classes in home.css.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./flow-layout.js'));
  else root.CIFlowSVG = factory(root.CIFlowLayout);
}(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function r2(n) { return Math.round(n * 100) / 100; }
  /* Legend amounts are ladder steps and round scale amounts: $250M, $1B, $50B. */
  function round$(v) { return v >= 1e9 ? '$' + (v / 1e9) + 'B' : '$' + (v / 1e6) + 'M'; }
  function pct(n) { return r2(n * 100) + '%'; }

  var ICON = function (id) {
    return '<svg class="flow-i" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><use href="/assets/icons.svg#' + id + '"/></svg>';
  };

  /* One lane's band. The svg is as wide as its column (x in percent) and as
     tall as the band, so thickness is in CSS px exactly. Dots sit at their
     seeded positions; the canvas takes over from these positions. */
  function band(lane, geo, idx, lay, fmt) {
    if (lane.missing || geo.missing) return '';
    var h = r2(geo.h), out = [];
    var label = lane.name + ' band, ' + fmt(lane.value, 'money') + ' on the shared scale' + (geo.hatched ? ', drawn at the 2px minimum' : '');
    out.push('<svg class="flow-band' + (geo.hatched ? ' is-hatched' : '') + (geo.h < 8 ? ' is-thin' : '') +
      '" width="100%" height="' + h + '" role="img" aria-label="' + esc(label) + '" aria-describedby="flow-table" data-h="' + r2(geo.exact) + '">');
    if (geo.hatched) {
      out.push('<defs><pattern id="flow-hatch-' + lane.id + '" patternUnits="userSpaceOnUse" width="4" height="4"><path class="flow-hatch" d="M-1 1L1 -1M0 4L4 0M3 5L5 3"/></pattern></defs>');
      out.push('<rect class="flow-band__fill" x="0" y="0" width="100%" height="' + h + '" fill="url(#flow-hatch-' + lane.id + ')"/>');
      out.push('<rect class="flow-band__edge" x="0" y="0" width="100%" height="' + h + '"/>');
    } else {
      out.push('<rect class="flow-band__fill" x="0" y="0" width="100%" height="' + h + '"/>');
    }
    if (lane.split && lane.split.length && !geo.hatched) {
      var parts = L.splitBands(lane.split, lay.s);
      out.push('<g class="flow-band__split">');
      parts.forEach(function (p, i) {
        out.push('<rect class="flow-sw-' + (i === parts.length - 1 ? 'o' : i % 2) + '" x="0" y="' + r2(p.y) + '" width="100%" height="' + r2(p.h) + '"/>');
        if (i) out.push('<rect class="flow-split-gap" x="0" y="' + r2(p.y - 0.5) + '" width="100%" height="1"/>');
      });
      out.push('</g>');
    }
    var seeds = L.dotSeeds(idx, geo.dots), rad = geo.h < 8 ? 2 : 1.75;
    out.push('<g class="flow-band__dots">');
    for (var i = 0; i < geo.dots; i++) {
      var cy = geo.h < 8 ? geo.h / 2 : rad + seeds.fy[i] * (geo.h - 2 * rad);
      out.push('<circle cx="' + pct(seeds.fx[i]) + '" cy="' + r2(cy) + '" r="' + rad + '"/>');
    }
    out.push('</g></svg>');
    return out.join('');
  }

  function splitPanel(lane, fmt) {
    if (!lane.split || !lane.split.length) return '';
    var rows = lane.split.map(function (p, i) {
      var sw = i === lane.split.length - 1 ? 'o' : i % 2;
      return '<li><span class="flow-split__sw flow-sw-' + sw + '" aria-hidden="true"></span><span class="flow-split__name">' + esc(p.name) +
        '</span><span class="flow-split__v">' + esc(fmt(p.value, 'money')) + '</span></li>';
    }).join('');
    return '<div class="flow-split" id="split-' + lane.id + '" hidden><p class="flow-split__h">' + esc(lane.name) + ' by agency, top five and All other</p><ol>' + rows + '</ol></div>';
  }

  function laneItem(lane, geo, idx, lay, fmt) {
    var value = lane.missing ? '–' : fmt(lane.value, 'money');
    var o = [];
    o.push('<li class="flow-lane' + (lane.missing ? ' is-missing' : '') + '" id="lane-' + lane.id + '" data-lane="' + lane.id + '">');
    o.push('<div class="flow-lane__label"><span class="flow-lane__n">' + lane.n + '</span> <span class="flow-lane__name">' + esc(lane.name) + '</span>' +
      '</div>');
    o.push('<div class="flow-lane__band">' + band(lane, geo, idx, lay, fmt) + '</div>');
    o.push('<div class="flow-lane__value"><span class="flow-lane__v" data-figure="home.flow.' + lane.id + '" data-figure-ref="' + esc(lane.figureRef) + '"' +
      (lane.missing ? ' aria-label="no data"' : ' data-value="' + lane.value + '"') + ' data-asof="' + esc(lane.asOfISO || '') + '">' + value + '</span></div>');
    var meta = lane.missing ? 'Not available, as of ' + esc(lane.missingAsOf || 'this build') :
      [lane.qualifier, lane.scopeLine, lane.windowLine, 'as of ' + lane.asOfLabel].filter(Boolean).map(esc).join(' · ');
    if (lane.ratio && !lane.missing) meta += '<br><span class="flow-lane__ratio">' + esc(lane.ratio) + '</span>';
    o.push('<p class="flow-lane__meta">' + meta + '</p>');
    o.push('<div class="flow-lane__tools">');
    o.push('<details class="flow-def"><summary><span>Definition</span></summary><div class="flow-def__panel"><p>' + esc(lane.defText) +
      '</p><p class="flow-def__src">' + esc(lane.defSource) + ' · <a href="' + esc(lane.defHref) + '">Methodology</a></p></div></details>');
    if (lane.split && lane.split.length) {
      o.push('<button class="flow-lane__split" type="button" aria-pressed="false" aria-controls="split-' + lane.id + '" aria-label="Split ' + esc(lane.name) + ' by agency" hidden>Split</button>');
    }
    o.push('</div>');
    o.push('<a class="flow-lane__go" href="' + esc(lane.page) + '">' + esc(lane.pageLabel) + '</a>');
    o.push(splitPanel(lane, fmt));
    o.push('</li>');
    return o.join('');
  }

  function table(model, fmt) {
    var t = [];
    t.push('<table class="ci-table flow-table" id="flow-table"><caption class="ci-vh">The four ledgers of the money-flow drawing: value, scope, window, and as-of date, then each split lane by agency.</caption>');
    t.push('<thead><tr><th scope="col">Ledger</th><th scope="col" class="num">Value</th><th scope="col">Scope</th><th scope="col">Window</th><th scope="col">As of</th></tr></thead><tbody>');
    model.lanes.forEach(function (l) {
      t.push('<tr><th scope="row">' + l.n + ' ' + esc(l.name) + (l.qualifier ? ', ' + esc(l.qualifier.toLowerCase()) : '') + '</th><td class="num">' +
        (l.missing ? '<span aria-label="no data">–</span>' : esc(fmt(l.value, 'money'))) + '</td><td>' + esc(l.scopeFull) + '</td><td>' +
        esc(l.missing ? 'Not available' : l.windowLine) + '</td><td>' + esc(l.missing ? (l.missingAsOf || '–') : l.asOfLabel) + '</td></tr>');
    });
    t.push('</tbody>');
    model.lanes.forEach(function (l) {
      if (l.missing) return;
      t.push('<tbody><tr><th scope="rowgroup" colspan="5" class="flow-table__group">' + esc(l.name) + ' by agency</th></tr>');
      if (l.split && l.split.length) {
        l.split.forEach(function (p) {
          t.push('<tr><th scope="row">' + esc(p.name) + '</th><td class="num">' + esc(fmt(p.value, 'money')) + '</td><td colspan="3">' +
            esc(l.name) + ', ' + esc(l.windowLine) + '</td></tr>');
        });
      } else {
        t.push('<tr><td colspan="5">' + esc(l.splitNote) + '</td></tr>');
      }
      t.push('</tbody>');
    });
    t.push('</table>');
    return t.join('');
  }

  /* The scale key is a slice of band exactly amount * s thick. */
  function scaleSvg(lay) {
    var px = r2(lay.scale.px);
    return '<svg class="flow__scale-bar" width="24" height="' + Math.max(px, 1) + '" aria-hidden="true" focusable="false"><rect x="0" y="0" width="24" height="' + px + '"/></svg>';
  }

  function figure(model, lay, fmt) {
    var anyHatch = lay.lanes.some(function (g) { return g.hatched; });
    var anyMinDot = lay.lanes.some(function (g) { return g.dotMin; });
    var o = [];
    o.push('<div class="flow__bar">');
    o.push('<button class="ci-pause flow__pause" type="button" aria-pressed="false" hidden>' + ICON('pause') + ICON('play') + '<span class="flow__pause-label">Pause animation</span></button>');
    o.push('<p class="flow__dot"><span class="flow__dot-mark" aria-hidden="true"></span>Each dot = <span class="flow__unit" data-figure="home.flow.unit" data-value="' + lay.U + '">' + esc(round$(lay.U)) +
      '</span>. Dots move at one speed, which encodes nothing.' + (anyMinDot ? ' A nonzero lane shows at least one dot.' : '') + '</p>');
    o.push('</div>');
    o.push('<ol class="flow__lanes" id="flow-lanes" data-mode="' + lay.mode + '" data-unit="' + lay.U + '" data-scale="' + lay.s + '">');
    model.lanes.forEach(function (l, i) { o.push(laneItem(l, lay.lanes[i], i, lay, fmt)); });
    o.push('</ol>');
    o.push('<figcaption class="flow__note" id="flow-cap">' + esc(model.disclaimer) + '</figcaption>');
    o.push('<div class="flow__scale">');
    if (lay.scale.amount) {
      o.push('<p class="flow__scale-item">' + scaleSvg(lay) + '<span><span class="flow__scale-amt">' + esc(round$(lay.scale.amount)) +
        '</span> at this thickness. Band thickness: dollars, one scale for all four.</span></p>');
    }
    if (anyHatch) o.push('<p class="flow__scale-item"><span class="flow__hatch-key" aria-hidden="true"></span><span>Hatched: under 2px on this scale, drawn at 2px; its value is unchanged.</span></p>');
    if (model.notice) o.push('<p class="flow__notice">' + esc(model.notice) + '</p>');
    o.push('<details class="flow__table" id="flow-table-box"><summary>' + ICON('table') + '<span>View as table</span></summary>' +
      '<div class="ci-table-wrap" role="region" tabindex="0" aria-label="Money-flow values as a table">' + table(model, fmt) + '</div></details>');
    o.push('</div>');
    return o.join('');
  }

  /* djb2 over the markup: the page compares it with data-sig on the figure
     and leaves the served markup alone when they match. */
  function sig(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); }

  return { figure: figure, band: band, table: table, esc: esc, sig: sig, round$: round$ };
}));
