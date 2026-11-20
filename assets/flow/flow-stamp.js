/* The Concrete Index · Home text values from the nightly files. Pure. The
 * authoring script (tools/render-flow.mjs) writes these into the served HTML
 * so the hero, the tape, and the source dates are complete without
 * JavaScript; home.js computes the same map at load from the same files and
 * replaces a value only when it differs.
 *
 *   CIFlowStamp.values(pc, cbMeta, model, fmt) -> { key: text }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CIFlowStamp = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CAP = 'A single number for how much new construction work the City is putting out, measured against its 2019 pace. Renewals and $500M megaprojects are stripped out so the reading tracks fresh demand.';

  function addMonths(ym, n) {   // '2026-10', -11 -> '2025-11'
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + String(m + 1).padStart(2, '0');
  }

  function values(pc, cbMeta, model, fmt) {
    var v = {}, meta = (pc && pc.meta) || {}, g = (pc && pc.glimpse) || {};
    var day = function (s) { return s ? fmt(String(s).slice(0, 10), 'date-utc?') : ''; };
    var month = pc && pc.index_month ? fmt(pc.index_month, 'month-long') : '';
    if (pc && pc.index_level != null) v.index = fmt(pc.index_level, 'index');
    v['index-cap'] = CAP + (month ? ' As of ' + month + '.' : '');
    v['index-window'] = pc && pc.index_month ? 'Trailing twelve months, ' + fmt(addMonths(pc.index_month, -11), 'ym-short') + '–' + fmt(pc.index_month, 'ym-short') : '';
    if (month) v['series-asof'] = month.toUpperCase();
    if (meta.generated) v['series-updated'] = day(meta.generated).toUpperCase();
    if (g.open_solicitations != null) v.sol = fmt(g.open_solicitations, 'int-compact');
    v['sol-cap'] = 'Construction notices still open for bids · Bidding';
    if (g.committed != null) v['month-pipe'] = fmt(g.committed, 'money');
    v['month-pipe-cap'] = 'Committed, unspent, ' + (meta.committed_period ? fmt(String(meta.committed_period), 'period-long?') + ' plan' : 'latest plan');
    (model ? model.lanes : []).forEach(function (l) { v['flow-' + l.id] = l.missing ? '–' : fmt(l.value, 'money'); });
    v['src-awards'] = meta.generated ? 'as of ' + day(meta.generated) : '–';
    v['src-plan'] = meta.committed_period ? fmt(String(meta.committed_period), 'period-long?') + ' plan' : (meta.generated ? 'file of ' + day(meta.generated) : '–');
    v['src-sol'] = meta.generated ? 'file of ' + day(meta.generated) : '–';
    v['src-cbk'] = cbMeta && cbMeta.as_of ? 'as of ' + day(cbMeta.as_of) : '–';
    return v;
  }

  return { values: values, CAP: CAP, addMonths: addMonths };
}));
