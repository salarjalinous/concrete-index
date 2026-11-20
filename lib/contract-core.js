/* lib/contract-core.js
 *
 * Contract-file (data/contract-search.json) rules of The Concrete Index,
 * extracted verbatim from the pages so the nightly builder and the pages share
 * one implementation. Sources:
 *   denom, aggregate                        contracts/index.html
 *   sweptContracts, median, groupBy,
 *   agencyVelocity, med50ByName             agency/index.html (TILE 1, TILE 4)
 *   monthIndex, contractCurvePoints, sCurve,
 *   sCurveBundle, utcDayMs, scheduleElapsedPct,
 *   scatterAgencyMeans                      analysis/index.html
 * Changes: scatterAgencyMeans takes `today` (UTC midnight ms) instead of reading
 * the clock. New: shardOf (detail-shard routing) and decodeIndex.
 *
 * UMD: require() in Node; window.CIContract in a browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CIContract = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MIN_AGENCY_N = 8;
  var SCURVE_HORIZON = 60;
  var SCURVE_OVERLAY_AGENCIES = 3;
  var SHARDS = 64;

  /* FNV-1a 32-bit over the contract id, modulo 64, as two hex digits. */
  function shardOf(contractId){
    var h = 0x811c9dc5, s = String(contractId || '');
    for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    var n = h % SHARDS;
    return (n < 16 ? '0' : '') + n.toString(16);
  }

  /* contract-index.json -> array of contract objects (without monthly_cumulative) */
  function decodeIndex(idx){
    var f = idx.fields, d = idx.dicts || {}, out = new Array(idx.rows.length);
    for(var i = 0; i < idx.rows.length; i++){
      var row = idx.rows[i], o = {};
      for(var j = 0; j < f.length; j++){
        var v = row[j];
        o[f[j]] = (d[f[j]] && v != null) ? d[f[j]][v] : v;
      }
      out[i] = o;
    }
    return out;
  }

  /* ---- contracts/index.html ---- */
  function denom(c){
    var cur = +c.current_amount;
    if(cur > 0) return cur;
    var orig = +c.original_amount;
    return orig > 0 ? orig : 0;
  }
  function median(arr){
    var a = (arr || []).filter(function(v){ return v != null && !isNaN(v); }).sort(function(x,y){ return x - y; });
    if(!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
  }
  function aggregate(contracts){
    var registered = 0, paid = 0, lags = [];
    for(var i=0;i<contracts.length;i++){
      var c = contracts[i];
      registered += denom(c);
      paid += (+c.paid_to_date || 0);
      if(c.first_payment_lag_days !== null && c.first_payment_lag_days !== undefined) lags.push(+c.first_payment_lag_days);
    }
    return {
      count: contracts.length,
      registered: registered,
      paid: paid,
      medianLag: median(lags),
      withDated: contracts.filter(function(c){ return c.payments_swept && (+c.payment_count || 0) > 0; }).length
    };
  }

  /* ---- agency/index.html ---- */
  function sweptContracts(cs){ return (cs || []).filter(function(c){ return c && c.payments_swept === true; }); }
  function groupBy(arr, keyFn){
    var m = new Map();
    (arr || []).forEach(function(x){ var k = keyFn(x); if(!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return m;
  }
  function agencyVelocity(cs){
    var swept = sweptContracts(cs);
    var rows = [];
    groupBy(swept, function(c){ return c.agency || '–'; }).forEach(function(list, agency){
      if(list.length < MIN_AGENCY_N) return;
      rows.push({ agency: agency, n: list.length,
        medLag: median(list.map(function(c){ return c.first_payment_lag_days; })),
        med50: median(list.map(function(c){ return c.days_to_50pct_paid; })) });
    });
    rows.sort(function(a,b){
      if(a.med50 == null && b.med50 == null) return 0;
      if(a.med50 == null) return 1;
      if(b.med50 == null) return -1;
      return a.med50 - b.med50;
    });
    return rows;
  }
  function med50ByName(cs){
    var swept = sweptContracts(cs);
    var out = new Map();
    groupBy(swept, function(c){ return c.agency || '–'; }).forEach(function(list, agency){
      out.set(agency, list.length >= MIN_AGENCY_N ? median(list.map(function(c){ return c.days_to_50pct_paid; })) : null);
    });
    return out;
  }

  /* ---- analysis/index.html ---- */
  function monthIndex(reg, ym){
    if(!reg || !ym) return null;
    var ry = +reg.slice(0,4), rm = +reg.slice(5,7), py = +ym.slice(0,4), pm = +ym.slice(5,7);
    if(!ry || !rm || !py || !pm) return null;
    return (py - ry) * 12 + (pm - rm);
  }
  function contractCurvePoints(c){
    var dn = (c.current_amount > 0) ? c.current_amount : (c.original_amount > 0) ? c.original_amount : 0;
    if(!dn || !Array.isArray(c.monthly_cumulative)) return [];
    var out = [];
    c.monthly_cumulative.forEach(function(pair){
      if(!Array.isArray(pair) || pair.length < 2) return;
      var idx = monthIndex(c.registration_date, pair[0]); var cum = +pair[1];
      if(idx == null || idx < 0 || isNaN(cum)) return;
      out.push({ idx: idx, pct: cum / dn * 100 });
    });
    return out;
  }
  function sCurve(list){
    var sums = [], counts = [];
    for(var i = 0; i <= SCURVE_HORIZON; i++){ sums[i] = 0; counts[i] = 0; }
    list.forEach(function(c){
      contractCurvePoints(c).forEach(function(p){
        if(p.idx > SCURVE_HORIZON) return;
        sums[p.idx] += p.pct; counts[p.idx] += 1;
      });
    });
    var pts = [];
    for(var j = 0; j <= SCURVE_HORIZON; j++) if(counts[j] > 0) pts.push({ x: j, y: sums[j] / counts[j], n: counts[j] });
    return pts;
  }
  function sCurveBundle(cs){
    var swept = sweptContracts(cs);
    var citywide = sCurve(swept);
    var ranked = [];
    groupBy(swept, function(c){ return c.agency || '–'; }).forEach(function(list, agency){ ranked.push({ agency: agency, n: list.length, list: list }); });
    ranked.sort(function(a,b){ return b.n - a.n; });
    var overlays = ranked.slice(0, SCURVE_OVERLAY_AGENCIES)
      .filter(function(r){ return r.n >= MIN_AGENCY_N; })
      .map(function(r){ return { agency: r.agency, n: r.n, points: sCurve(r.list) }; });
    return { citywide: citywide, overlays: overlays, sweptTotal: swept.length };
  }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function utcDayMs(s){
    var t = String(s||'');
    if(t.length < 10) return NaN;
    return Date.UTC(+t.slice(0,4), +t.slice(5,7)-1, +t.slice(8,10));
  }
  function scheduleElapsedPct(c, today){
    if(!c.start_date || !c.end_date) return null;
    var s = utcDayMs(c.start_date), e = utcDayMs(c.end_date);
    if(isNaN(s) || isNaN(e) || e <= s) return null;
    return clamp((today - s) / (e - s) * 100, 0, 150);
  }
  function scatterAgencyMeans(cs, today){
    var swept = sweptContracts(cs);
    var rows = [];
    groupBy(swept, function(c){ return c.agency || '–'; }).forEach(function(list, agency){
      if(list.length < MIN_AGENCY_N) return;
      var sch = [], paid = [];
      list.forEach(function(c){
        var se = scheduleElapsedPct(c, today);
        if(se == null) return;
        if(c.pct_paid_to_date == null || isNaN(c.pct_paid_to_date)) return;
        sch.push(se); paid.push(c.pct_paid_to_date * 100);
      });
      if(!sch.length) return;
      var mean = function(a){ return a.reduce(function(x,y){ return x + y; }, 0) / a.length; };
      rows.push({ agency: agency, n: list.length, used: sch.length, schedElapsed: mean(sch), paidPct: mean(paid) });
    });
    return rows;
  }

  return { MIN_AGENCY_N: MIN_AGENCY_N, SCURVE_HORIZON: SCURVE_HORIZON, SHARDS: SHARDS,
    shardOf: shardOf, decodeIndex: decodeIndex, denom: denom, median: median, aggregate: aggregate,
    sweptContracts: sweptContracts, groupBy: groupBy, agencyVelocity: agencyVelocity, med50ByName: med50ByName,
    monthIndex: monthIndex, contractCurvePoints: contractCurvePoints, sCurve: sCurve, sCurveBundle: sCurveBundle,
    utcDayMs: utcDayMs, scheduleElapsedPct: scheduleElapsedPct, scatterAgencyMeans: scatterAgencyMeans };
}));
