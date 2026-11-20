/* lib/award-core.js
 *
 * City Record (qyyg-4tf5) rules of The Concrete Index, extracted from the
 * pages so the builders and tests run the pages' own logic. Sources:
 *   isoCompleteMonthBoundary  funnel/index.html (identical on home, agency, briefing)
 *   dedupeAwardsByPin         funnel/index.html
 *   isContinuation, MEGA      analysis/index.html (identical on awarded, briefing, contractors)
 *   indexFromRows             index.html computeLive (= Analysis buildIndex)
 *   grossTtmFromArchive       archive.yml "Precompute home headline aggregates", ported
 * The only change is an optional `now` argument where the page read the clock.
 *
 * UMD: require() in Node; window.CIAward in a browser. No DOM, no clock unless
 * `now` is omitted.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CIAward = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONSTRUCTION_WHERE = "starts_with(category_description,'Construction')";
  const MEGA = 500e6;
  function isConstruction(r){ return String((r && r.category_description) || '').startsWith('Construction'); }
  function isContinuation(m){ return /renewal|extension/i.test(m||''); }

  /* First-of-month boundary n complete months before the current (incomplete)
     month, anchored in UTC end to end (funnel/index.html). */
  function isoCompleteMonthBoundary(n, now){
    const t = now ? new Date(now) : new Date();
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - n, 1))
      .toISOString().slice(0,10);
  }
  function ttmWindow(now){
    return { lo: isoCompleteMonthBoundary(12, now), hi: isoCompleteMonthBoundary(0, now) };
  }

  /* Dedupe construction-award rows to one record per pin keeping the max amount.
     Rows with no pin stand alone under a stable per-row surrogate key. */
  function dedupeAwardsByPin(rows){
    const byPin = new Map();
    for(let i=0; i<rows.length; i++){
      const r = rows[i];
      const amt = parseFloat(r.contract_amount);
      if(!(amt > 0)) continue;
      const pin = r.pin || ('_np_' + i);
      const rec = { amt, agency: r.agency_name || null,
        month: r.start_date ? r.start_date.slice(0,7) : null,
        day: r.start_date ? r.start_date.slice(0,10) : null,
        method: r.selection_method_description || '' };
      const prev = byPin.get(pin);
      if(!prev || rec.amt > prev.amt) byPin.set(pin, rec);
    }
    return [...byPin.values()];
  }

  /* Gross awarded TTM exactly as the nightly precompute computes it from the
     archived awards.json: window FIRST ([lo, hi) on start_date[:10]), then one
     row per pin (pin, else request_id, else row surrogate) at max amount, first
     row seen wins a tie. Also returns the agency of the winning notice so the
     flow lane can split by agency and still sum to the same total. */
  function grossTtmFromArchive(rows, now){
    const { lo, hi } = ttmWindow(now);
    const byPin = new Map();
    for(let i=0; i<rows.length; i++){
      const r = rows[i];
      const d = (r.start_date || '').slice(0,10);
      if(!d || !(lo <= d && d < hi)) continue;
      const amt = parseFloat(r.contract_amount || 0);
      if(!(amt > 0)) continue;
      const pin = r.pin || r.request_id || ('_np_' + i);
      const prev = byPin.get(pin);
      if(!prev || amt > prev.amt) byPin.set(pin, { amt, agency: r.agency_name || '(no agency)' });
    }
    let sum = 0; const byAgency = new Map();
    for(const v of byPin.values()){ sum += v.amt; byAgency.set(v.agency, (byAgency.get(v.agency)||0) + v.amt); }
    return { lo, hi, total: Math.round(sum), rawSum: sum, count: byPin.size, byAgency };
  }

  /* The Concrete Index from award rows (index.html computeLive): megas and
     non-positive rows dropped, one record per pin at max, renewals/extensions
     dropped after dedupe, TTM value and count, 2019 average = 100, geometric. */
  function indexFromRows(rows, now){
    const byPin = new Map();
    for(let i=0;i<rows.length;i++){
      const r = rows[i]; const amt = parseFloat(r.contract_amount);
      if(!(amt>0) || amt>=MEGA) continue;
      const pin = r.pin || ('_np_0_' + i);
      const rec = { amt, m: r.start_date ? r.start_date.slice(0,7) : null, cont: isContinuation(r.selection_method_description) };
      const p = byPin.get(pin); if(!p || rec.amt > p.amt) byPin.set(pin, rec);
    }
    const byMonth = new Map();
    byPin.forEach(rec => { if(rec.cont || !rec.m) return; const c = byMonth.get(rec.m) || {v:0,c:0}; c.v += rec.amt; c.c += 1; byMonth.set(rec.m, c); });
    const t = now ? new Date(now) : new Date();
    const lastC = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1); const months = []; let mi = 0;
    for(let x = Date.UTC(2003,0,1); x < lastC; x = Date.UTC(2003, ++mi, 1)) months.push(new Date(x).toISOString().slice(0,7));
    const v = months.map(m => (byMonth.get(m)||{v:0}).v), c = months.map(m => (byMonth.get(m)||{c:0}).c);
    const tM=[], tV=[], tC=[]; let sv=0, sc=0;
    for(let i=0;i<months.length;i++){ sv+=v[i]; sc+=c[i]; if(i>=12){ sv-=v[i-12]; sc-=c[i-12]; } if(i>=11){ tM.push(months[i]); tV.push(sv); tC.push(sc); } }
    const bi = tM.map((m,i) => m.indexOf('2019')===0 ? i : -1).filter(i => i>=0);
    const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
    const baseV = bi.length ? mean(bi.map(i=>tV[i])) : tV[0], baseC = bi.length ? mean(bi.map(i=>tC[i])) : tC[0];
    const last = tM.length-1;
    return { value: 100*Math.sqrt((tV[last]/baseV)*(tC[last]/baseC)), month: tM[last] };
  }

  return { CONSTRUCTION_WHERE, MEGA, isConstruction, isContinuation,
    isoCompleteMonthBoundary, ttmWindow, dedupeAwardsByPin, grossTtmFromArchive, indexFromRows };
}));
