#!/usr/bin/env node
/* tools/build-flow.js  (Node 20)
 *
 * Writes data/flow.json: the four ledgers of the landing money-flow figure
 * (PRD 7.2). Each lane is read from the file its owning page already reads, so
 * no figure is recomputed differently:
 *   01 Committed   precomputed.json glimpse.committed  (split: plan-history.json latest)
 *   02 Awarded     precomputed.json awarded_ttm.total, gross (split: awards.json, same rule)
 *   03 Registered  checkbook-vendors.json, sum of vendors[].registered  (canonical, D6)
 *   04 Paid        checkbook-vendors.json, sum of vendors[].paid        (= Funnel "Paid")
 * Splits are the top five agencies plus "All other" and sum to the lane value to
 * the dollar. The four values are never added together; this file carries no total.
 *
 *   node tools/build-flow.js --data data --out data/flow.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('../lib/award-core.js');

const STALE_AFTER_HOURS = 48;
const DISCLAIMER = 'Four separate ledgers, not one flow. Each band is sized to its own dollar total on one shared scale. The ledgers cover different scopes and time windows, so no band is a share of the one above it, and the four are never added together.';

/* Top k entries by value, each rounded to the dollar, plus "All other" set to
   the remainder, so the split sums to `total` exactly. */
function topSplit(entries, total, k = 5){
  const sorted = [...entries].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const top = sorted.slice(0, k).map(([name, v]) => ({ name, value: Math.round(v) }));
  const used = top.reduce((a, t) => a + t.value, 0);
  const other = total - used;
  if(other < 0) throw new Error(`split exceeds lane total by ${-other}`);
  return [...top, { name: 'All other', value: other }];
}

/* Every entry, rounded by largest remainder so the parts sum to `total` exactly.
   Used where the full list is short (boroughs), so no "All other" is needed. */
function exactSplit(entries, total){
  const pos = [...entries].filter(([, v]) => v > 0);
  const floors = pos.map(([name, v]) => ({ name, value: Math.floor(v), frac: v - Math.floor(v) }));
  let rest = total - floors.reduce((a, f) => a + f.value, 0);
  if(rest < 0 || rest > floors.length) throw new Error(`exact split residual ${rest} out of range`);
  [...floors].sort((a, b) => b.frac - a.frac || (a.name < b.name ? -1 : 1)).slice(0, rest).forEach(f => { f.value += 1; });
  return floors.sort((a, b) => b.value - a.value).map(({ name, value }) => ({ name, value }));
}

function fyLabel(meta){
  const closed = (meta.fiscal_years_closed || []).slice().sort((a, b) => a - b);
  const yy = n => String(n % 100).padStart(2, '0');
  const parts = [];
  if(closed.length) parts.push(closed.length > 1 ? `FY${yy(closed[0])}–${yy(closed[closed.length - 1])}` : `FY${yy(closed[0])}`);
  if(meta.fiscal_year_ytd) parts.push(`FY${yy(meta.fiscal_year_ytd)} YTD`);
  return parts.join(' + ');
}

function readJSON(p){ return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }

function build({ precomputed, planHistory, awards, vendors, now = new Date() }){
  const lanes = [];
  const notes = [];
  const iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

  // 01 Committed
  const committed = precomputed && precomputed.glimpse ? precomputed.glimpse.committed : null;
  let cSplit = null, cBoro = null, cPeriod = (precomputed && precomputed.meta && precomputed.meta.committed_period) || null;
  if(committed != null && planHistory){
    const latest = planHistory.periods[planHistory.periods.length - 1];
    cPeriod = cPeriod || latest.period;
    if(Math.round(latest.committed.total) !== committed || latest.period !== cPeriod){
      notes.push(`committed split withheld: plan-history ${latest.period} reads ${Math.round(latest.committed.total)}, precomputed ${cPeriod} reads ${committed}`);
    }else{
      cSplit = topSplit(Object.entries(latest.by_agency).map(([k, v]) => [k, v[0]]), committed);
      cBoro = exactSplit(Object.entries(latest.by_borough).map(([k, v]) => [k, v[0]]), committed);
    }
  }
  lanes.push({ id: 'committed', n: '01', name: 'Committed', value: committed,
    scope: 'Full City capital plan: unspent budget of active projects, one record per agency and FMS ID, close-out excluded',
    window: cPeriod ? `stock at the ${cPeriod} capital plan period` : null,
    as_of: cPeriod, source: 'NYC OMB fb86-vt7u via data/precomputed.json', page: '/pipeline/',
    split_agency: cSplit, split_borough: cBoro,
    split_note: cSplit ? null : 'No agency split available for this build.' });

  // 02 Awarded (gross)
  const aw = precomputed && precomputed.awarded_ttm ? precomputed.awarded_ttm.total : null;
  let aSplit = null;
  const lo = precomputed && precomputed.meta && precomputed.meta.ttm_start, hi = precomputed && precomputed.meta && precomputed.meta.ttm_end;
  if(aw != null && awards){
    // the precompute's own clock decided the window; replay it at that instant
    const g = A.grossTtmFromArchive(awards, precomputed.meta.generated);
    if(g.total !== aw || g.lo !== lo || g.hi !== hi) notes.push(`awarded split withheld: recompute ${g.total} [${g.lo}, ${g.hi}) vs precomputed ${aw} [${lo}, ${hi})`);
    else aSplit = topSplit([...g.byAgency.entries()], aw);
  }
  lanes.push({ id: 'awarded', n: '02', name: 'Awarded', qualifier: 'gross', value: aw,
    count: precomputed && precomputed.awarded_ttm ? precomputed.awarded_ttm.count : null,
    scope: 'City Record construction award notices, one record per PIN at its largest amount; renewals, extensions and $500M+ awards included',
    window: lo && hi ? `twelve fully-elapsed months [${lo}, ${hi})` : null,
    window_start: lo, window_end_exclusive: hi,
    as_of: precomputed && precomputed.meta ? precomputed.meta.generated : null,
    source: 'NYC City Record qyyg-4tf5 via data/precomputed.json', page: '/awarded/',
    split_agency: aSplit, split_note: aSplit ? null : 'No agency split available for this build.' });

  // 03 Registered, 04 Paid (canonical: checkbook-vendors.json, D6)
  let reg = null, paid = null, fy = null, cbAsOf = null, cbGen = null;
  if(vendors && vendors.vendors){
    reg = 0; paid = 0;
    for(const k in vendors.vendors){ reg += (parseFloat(vendors.vendors[k].registered) || 0); paid += (parseFloat(vendors.vendors[k].paid) || 0); }
    fy = fyLabel(vendors.meta || {}); cbAsOf = vendors.meta && vendors.meta.as_of; cbGen = vendors.meta && vendors.meta.generated;
  }
  const NO_SPLIT = 'No agency split is published for this ledger.';
  lanes.push({ id: 'registered', n: '03', name: 'Registered', value: reg,
    scope: 'Sum of current registered amounts, registered construction expense contracts to named vendors, City scope',
    window: fy ? `contracts Checkbook lists under ${fy}` : null, fy_label: fy,
    as_of: cbAsOf, source: 'Checkbook NYC via data/checkbook-vendors.json', page: '/contracts/',
    split_agency: null, split_note: NO_SPLIT });
  lanes.push({ id: 'paid', n: '04', name: 'Paid', qualifier: 'cumulative paid to date', value: paid,
    scope: 'Cumulative paid to date on the same registered contracts',
    window: fy ? `lifetime of the contracts listed under ${fy}, as of the file date` : null, fy_label: fy,
    as_of: cbAsOf, source: 'Checkbook NYC via data/checkbook-vendors.json', page: '/funnel/',
    split_agency: null, split_note: NO_SPLIT });

  const sources = [precomputed && precomputed.meta && precomputed.meta.generated, cbGen].filter(Boolean).sort();
  return {
    meta: {
      generated_at: iso(now),
      stale_after_hours: STALE_AFTER_HOURS,
      source_as_of: { committed: cPeriod, awarded: precomputed && precomputed.meta ? precomputed.meta.generated : null, registered: cbGen, paid: cbGen },
      oldest_source: sources[0] || null,
      disclaimer: DISCLAIMER,
      units: 'dollars, nominal, rounded to the dollar where the owning file rounds',
      notes
    },
    lanes,
    same_contracts_ratio: reg > 0 && paid != null ? { paid_over_registered: paid / reg, label: 'same contracts' } : null
  };
}

function main(){
  const a = {}; for(let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i+1];
  const dir = a.data || 'data', out = a.out || path.join(dir, 'flow.json');
  const doc = build({
    precomputed: readJSON(path.join(dir, 'precomputed.json')),
    planHistory: readJSON(path.join(dir, 'plan-history.json')),
    awards: readJSON(path.join(dir, 'awards.json')),
    vendors: readJSON(path.join(dir, 'checkbook-vendors.json')),
    now: a.now ? new Date(a.now) : new Date()
  });
  const s = JSON.stringify(doc);
  if(s.length > 20000) throw new Error(`flow.json is ${s.length} bytes, over the 20 KB budget`);
  const tmp = out + '.tmp-' + process.pid; fs.writeFileSync(tmp, s); fs.renameSync(tmp, out);
  console.log(`${out}: ${s.length} bytes; ` + doc.lanes.map(l => `${l.id}=${l.value}`).join(' ') + (doc.meta.notes.length ? ' NOTES: ' + doc.meta.notes.join(' | ') : ''));
}

if(require.main === module){ try{ main(); }catch(e){ console.error('build-flow FAILED: ' + (e && e.message || e)); process.exit(1); } }
module.exports = { build, topSplit, exactSplit, fyLabel, DISCLAIMER };
