/* The Concrete Index · money-flow data (PRD 7.2). Loads data/flow.json and
 * validates it; when the file is absent, unreadable, or past its own
 * stale_after_hours, it builds the four lanes from the files the site already
 * reads, with the same sums the owning pages use:
 *   01 Committed   precomputed.json glimpse.committed            (Home, Pipeline)
 *   02 Awarded     precomputed.json awarded_ttm.total, gross     (Home, Awarded)
 *   03 Registered  checkbook-vendors.json, sum of registered     (tools/build-flow.js, D6)
 *   04 Paid        checkbook-vendors.json, sum of paid           (Funnel "Paid", same loop)
 * The Checkbook file is aged against its own declared contract exactly as the
 * Funnel page ages it: past drop_after_hours (default 14 days) Registered and
 * Paid are not shown. No lane is ever added to another.
 *
 *   CIFlowData.model(src, fmt, now)   pure: { lanes, disclaimer, notice }
 *   CIFlowData.fromSources(pc, cb)    pure: a flow.json-shaped doc from the two files
 *   CIFlowData.load(now)              browser: Promise of { doc, origin }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CIFlowData = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DISCLAIMER = 'Four separate ledgers, not one flow. Each band is sized to its own dollar total on one shared scale. The ledgers cover different scopes and time windows, so no band is a share of the one above it, and the four are never added together.';
  var NO_SPLIT = 'No agency split is published for this ledger.';
  var CBK_STALE_H_DEFAULT = 48, CBK_DROP_H_DEFAULT = 336;   // funnel.js

  /* Verbatim from /methodology/ (the owning page's section). */
  var DEF = {
    committed: { text: "For each project, funded, unspent dollars are its total budget (city plus non-city funds) minus spending to date: money the City has funded in the capital plan but not yet spent. This is the page's headline measure of forward demand, the work still ahead on funded projects. It is a planning measure, not encumbered or bondable backlog: budgets shift between plan releases, and a place in the plan is no guarantee of timing.",
      src: 'Pipeline methodology', href: '/methodology/#pipeline' },
    awarded: { text: 'Awarded is trailing-twelve-month construction award value from the City Record (dataset qyyg-4tf5), as on the “Awarded” page. This figure is gross: deduplicated to one record per procurement but still inclusive of renewals, extensions, and awards of $500M and above.',
      src: 'Funnel methodology', href: '/methodology/#funnel' },
    registered: { text: "The index covers construction contracts registered with the City, drawn from the Comptroller's Checkbook NYC registered-contract record (expense contracts in registered status) that Checkbook lists under the fiscal years in the current build. Original is the contract value at registration; current reflects registered modifications.",
      src: 'Contracts methodology', href: '/methodology/#contracts' },
    paid: { text: "Paid (Checkbook) is a separate reading drawn from the Comptroller's Checkbook NYC: paid to date, as of the file date, on registered construction contracts to named vendors, City scope, for the contracts Checkbook lists under the fiscal years Checkbook publishes. It is a cumulative figure, not a sum of payments made within those years, and the in-progress fiscal year is still adding contracts.",
      src: 'Funnel methodology', href: '/methodology/#funnel' }
  };
  var COPY = {
    committed: { n: '01', name: 'Committed', scope: 'Full capital plan', scopeFull: 'Full City capital plan: unspent budget of active projects, one record per agency and FMS ID, close-out excluded', page: '/pipeline/', pageLabel: 'Pipeline', ref: 'pipeline.kpi.unspent' },
    awarded: { n: '02', name: 'Awarded', qualifier: 'Gross', scope: 'City Record', scopeFull: 'City Record construction award notices, one record per PIN at its largest amount; renewals, extensions, and $500M+ awards included', page: '/awarded/', pageLabel: 'Awarded', ref: 'awarded.kpi.total' },
    registered: { n: '03', name: 'Registered', scope: 'Registered contracts', scopeFull: 'Current registered amounts of construction expense contracts to named vendors, City scope', page: '/contracts/', pageLabel: 'Contracts', ref: 'contracts.kpi.registered' },
    paid: { n: '04', name: 'Paid', qualifier: 'Cumulative paid', scope: '', scopeFull: 'Cumulative paid to date on the same registered contracts', page: '/funnel/', pageLabel: 'Funnel', ref: 'funnel.kpi.paid' }
  };
  var ORDER = ['committed', 'awarded', 'registered', 'paid'];

  /* Same label as tools/build-flow.js fyLabel and funnel.js cbkFYLabel. */
  function fyLabel(meta) {
    var closed = ((meta && meta.fiscal_years_closed) || []).slice().sort(function (a, b) { return a - b; });
    var yy = function (n) { return String(n % 100).padStart(2, '0'); };
    var parts = [];
    if (closed.length) parts.push(closed.length > 1 ? 'FY' + yy(closed[0]) + '–' + yy(closed[closed.length - 1]) : 'FY' + yy(closed[0]));
    if (meta && meta.fiscal_year_ytd) parts.push('FY' + yy(meta.fiscal_year_ytd) + ' YTD');
    return parts.join(' + ');
  }

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function hours(a, b) { var t = Date.parse(a); return isFinite(t) ? (b - t) / 36e5 : Infinity; }

  /* A flow.json-shaped document from precomputed.json and checkbook-vendors.json.
     The sums are the Funnel loop: parseFloat(...) || 0 over every vendor group. */
  function fromSources(pc, cb) {
    var g = (pc && pc.glimpse) || {}, meta = (pc && pc.meta) || {};
    var reg = null, paid = null, cbMeta = (cb && cb.meta) || {};
    if (cb && cb.vendors) {
      reg = 0; paid = 0;
      for (var k in cb.vendors) {
        reg += (parseFloat(cb.vendors[k].registered) || 0);
        paid += (parseFloat(cb.vendors[k].paid) || 0);
      }
    }
    var fy = cb ? fyLabel(cbMeta) : null;
    return {
      meta: { generated_at: null, origin: 'sources', disclaimer: DISCLAIMER,
        source_as_of: { committed: meta.committed_period || null, awarded: meta.generated || null, registered: cbMeta.generated || null, paid: cbMeta.generated || null },
        checkbook: { generated: cbMeta.generated || null, as_of: cbMeta.as_of || null, stale_after_hours: cbMeta.stale_after_hours, drop_after_hours: cbMeta.drop_after_hours } },
      lanes: [
        { id: 'committed', value: g.committed != null ? g.committed : null, as_of: meta.committed_period || null, file_date: meta.generated || null, split_agency: null },
        { id: 'awarded', value: pc && pc.awarded_ttm && pc.awarded_ttm.total != null ? pc.awarded_ttm.total : null,
          window_start: meta.ttm_start || null, window_end_exclusive: meta.ttm_end || null, as_of: meta.generated || null, split_agency: null },
        { id: 'registered', value: reg, fy_label: fy, as_of: cbMeta.as_of || null, split_agency: null },
        { id: 'paid', value: paid, fy_label: fy, as_of: cbMeta.as_of || null, split_agency: null }
      ],
      same_contracts_ratio: reg > 0 && paid != null ? { paid_over_registered: paid / reg, label: 'same contracts' } : null
    };
  }

  function prevMonth(iso) {   // '2026-11-01' -> '2026-10'
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1;
    if (m === 0) { y -= 1; m = 12; }
    return y + '-' + String(m).padStart(2, '0');
  }

  /* The display model: every string the figure and its table show. */
  function model(doc, fmt, now) {
    now = now == null ? Date.now() : +now;
    var byId = {};
    (doc.lanes || []).forEach(function (l) { byId[l.id] = l; });
    var cbk = (doc.meta && doc.meta.checkbook) || {};
    var cbGen = cbk.generated || (doc.meta && doc.meta.source_as_of && doc.meta.source_as_of.registered) || null;
    var cbDrop = hours(cbGen, now) > ((+cbk.drop_after_hours) || CBK_DROP_H_DEFAULT);
    var date = function (s) { return s ? fmt(String(s).slice(0, 10), 'date-utc?') : ''; };
    var lanes = ORDER.map(function (id) {
      var src = byId[id] || {}, c = COPY[id], d = DEF[id];
      var v = num(src.value);
      var lane = { id: id, n: c.n, name: c.name, qualifier: c.qualifier || '', scopeLine: c.scope, page: c.page, pageLabel: c.pageLabel,
        figureRef: c.ref, scopeFull: c.scopeFull, defText: d.text, defSource: d.src, defHref: d.href, value: v, missing: v == null || !(v > 0),
        split: null, splitNote: id === 'committed' || id === 'awarded' ? 'No agency split available for this build.' : NO_SPLIT };
      if (id === 'committed') {
        lane.windowLine = 'stock, latest plan';
        lane.asOfLabel = src.as_of ? fmt(String(src.as_of), 'period-long?') + ' plan' : date(src.file_date || (doc.meta && doc.meta.source_as_of && doc.meta.source_as_of.awarded));
        lane.asOfISO = src.as_of || src.file_date || '';
      } else if (id === 'awarded') {
        var lo = src.window_start, hi = src.window_end_exclusive;
        lane.windowLine = lo && hi ? fmt(lo.slice(0, 7), 'ym-short') + '–' + fmt(prevMonth(hi), 'ym-short') : 'twelve full months';
        lane.asOfLabel = date(src.as_of);
        lane.asOfISO = src.as_of || '';
        lane.windowISO = lo && hi ? lo + '/' + hi : '';
      } else {
        lane.windowLine = src.fy_label || 'fiscal years in the current build';
        lane.asOfLabel = date(src.as_of);
        lane.asOfISO = src.as_of || '';
        if (cbDrop) { lane.missing = true; lane.missingAsOf = date(cbGen); }
      }
      if (lane.missing && !lane.missingAsOf) lane.missingAsOf = lane.asOfLabel || date(doc.meta && doc.meta.generated_at);
      if (!lane.missing && src.split_agency && src.split_agency.length) {
        var sum = src.split_agency.reduce(function (a, p) { return a + p.value; }, 0);
        if (Math.round(sum) === Math.round(v)) { lane.split = src.split_agency.map(function (p) { return { name: p.name, value: p.value }; }); lane.splitNote = null; }
      }
      return lane;
    });
    var ratio = doc.same_contracts_ratio;
    if (ratio && !lanes[2].missing && !lanes[3].missing) lanes[3].ratio = fmt(ratio.paid_over_registered, 'pct') + ' of Registered, same contracts';
    return { lanes: lanes, disclaimer: DISCLAIMER, notice: null };
  }

  function getJSON(u) {
    return fetch(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
  }

  function valid(doc) {
    if (!doc || !doc.meta || !Array.isArray(doc.lanes) || doc.lanes.length !== 4) return false;
    for (var i = 0; i < 4; i++) if (doc.lanes[i].id !== ORDER[i]) return false;
    return true;
  }

  /* flow.json when fresh and well formed; otherwise the two source files. */
  function load(now, pcPromise) {
    now = now == null ? Date.now() : +now;
    return getJSON('/data/flow.json').then(function (doc) {
      if (!valid(doc)) throw new Error('flow.json malformed');
      var stale = (+doc.meta.stale_after_hours) || 48;
      if (hours(doc.meta.generated_at, now) > stale) throw new Error('flow.json stale');
      doc.meta.origin = 'flow';
      // the Checkbook age rule needs the file's own contract
      doc.meta.checkbook = doc.meta.checkbook || { generated: doc.meta.source_as_of && doc.meta.source_as_of.registered, as_of: doc.lanes[2].as_of };
      return { doc: doc, origin: 'flow' };
    }).catch(function () {
      return Promise.all([(pcPromise || getJSON('/data/precomputed.json')).catch(function () { return null; }),
        getJSON('/data/checkbook-vendors.json').catch(function () { return null; })]).then(function (r) {
        return { doc: fromSources(r[0], r[1]), origin: 'sources', precomputed: r[0] };
      });
    });
  }

  return { DISCLAIMER: DISCLAIMER, NO_SPLIT: NO_SPLIT, ORDER: ORDER, fyLabel: fyLabel, fromSources: fromSources, model: model, load: load, valid: valid };
}));
