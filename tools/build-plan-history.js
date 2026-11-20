#!/usr/bin/env node
/* tools/build-plan-history.js  (Node 20)
 *
 * Writes data/plan-history.json: per capital-plan period (OMB fb86-vt7u), the
 * figures the Pipeline, Funnel, Agency, Analysis and Briefing pages compute
 * from their snapshot pulls, using lib/plan-core.js (the pages' own rules,
 * aligned 2026-11-20). Every period is fully paged and count-checked (D4).
 *
 *   node tools/build-plan-history.js --out data/plan-history.json          (live)
 *   node tools/build-plan-history.js --from-dir DIR --out FILE             (offline:
 *        DIR holds <period>.json files, each the raw rows of one period)
 *
 * Nothing is written unless every period is complete.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../lib/plan-core.js');

const DATASET = 'fb86-vt7u';
const FIELDS = 'fms_id,managing_agency,fms_project_name,total_budget,spend_to_date,current_phase,borough,ten_year_plan_category';
const PERIOD_CAP = 20000;
const STALE_AFTER_HOURS = 48;

function mapObj(m){ const o = {}; for(const [k, v] of [...m.entries()].sort((a,b)=>b[1]-a[1])) o[k] = v; return o; }
function addTo(m, k, u){ const g = m.get(k) || [0, 0]; g[0] += u; g[1]++; m.set(k, g); }
function groupObj(m, order){
  const keys = order ? order.filter(k => m.has(k)) : [...m.keys()].sort((a,b) => m.get(b)[0] - m.get(a)[0]);
  const o = {}; for(const k of keys) o[k] = [m.get(k)[0], m.get(k)[1]]; return o;   // [unspent, count]
}
const BORO_ORDER = ['Brooklyn','Queens','Manhattan','Bronx','Staten Island','Citywide','Multi-site / Other'];

/* Pipeline-page variant: filter excluded rows, THEN collapse. Computed only as
   a check that it equals the collapse-then-skip rule the other pages use. */
function filterFirstCommitted(rows){
  const m = new Map();
  for(const r of rows){
    const bucket = P.normPhase(r.current_phase);
    if(bucket === 'excluded') continue;
    const k = P.projectKey(r);
    const rec = { bucket, u: Math.max((Math.max(parseFloat(r.total_budget)||0,0)) - Math.max(parseFloat(r.spend_to_date)||0,0), 0) };
    const prev = m.get(k);
    if(!prev || P.phaseRank(bucket) > P.phaseRank(prev.bucket)) m.set(k, rec);
  }
  let t = 0; for(const r of m.values()) if(r.bucket !== 'Close-out') t += r.u;
  return t;
}

function periodSummary(period, rows, map, isLatest){
  const stages = {};
  for(const st of ['all','pre','con']){
    let unspent = 0; const budgets = [];
    for(const rec of map.values()){
      if(!P.inStage(rec.bucket, st)) continue;
      unspent += Math.max(rec.budget - rec.spend, 0); budgets.push(rec.budget);
    }
    stages[st] = { unspent, count: budgets.length, median_budget: P.median(budgets) };
  }
  const byPhase = new Map(), byAgency = new Map(), byBoro = new Map(), byCat = new Map();
  let activeInclCloseout = 0;
  for(const rec of map.values()){
    if(rec.bucket === 'excluded') continue;
    activeInclCloseout++;
    const u = Math.max(rec.budget - rec.spend, 0);
    addTo(byPhase, rec.bucket, u);
    if(rec.bucket === 'Close-out') continue;
    addTo(byAgency, rec.agency, u);
    addTo(byBoro, P.normBoroughPipeline(rec.boroughRaw), u);
    addTo(byCat, P.catPipeline(rec.categoryRaw), u);
  }
  const ct = P.committedTotal(map);
  const legacy = P.committedTotal(P.collapseSnapshot(rows, P.EXCLUDED_LEGACY_D1));
  return {
    period,
    rows: rows.length,
    projects: map.size,
    active_projects_incl_closeout: activeInclCloseout,
    committed: { total: ct.total, count: ct.count },
    stages,
    by_phase: groupObj(byPhase, P.PHASE_ORDER),
    by_agency: groupObj(byAgency),
    by_borough: groupObj(byBoro, BORO_ORDER),
    // the full category list (115 lines) only for the latest period, the one any page charts
    by_category: isLatest ? groupObj(byCat) : undefined,
    legacy_d1: { committed_total: legacy.total, committed_count: legacy.count,
      note: "pre-alignment rule on Funnel, Agency, Analysis, Briefing: 'land purchase' not excluded" },
    check_filter_first_total: filterFirstCommitted(rows)
  };
}

function agencyDetail(map){
  const out = {};
  for(const rec of map.values()){
    if(rec.bucket === 'excluded' || rec.bucket === 'Close-out') continue;
    const u = Math.max(rec.budget - rec.spend, 0);
    if(u <= 0) continue;
    const a = out[rec.agency] || (out[rec.agency] = { total: 0, largest: 0, by_borough: {}, largest_by_borough: {}, by_category: {} });
    const b = P.normBoroughAgency(rec.boroughRaw), c = P.catAgency(rec.categoryRaw);
    a.total += u;
    a.by_borough[b] = (a.by_borough[b] || 0) + u;
    a.by_category[c] = (a.by_category[c] || 0) + u;
    if(u > (a.largest_by_borough[b] || 0)) a.largest_by_borough[b] = u;
    if(u > a.largest) a.largest = u;
  }
  return out;
}

function build(periodRows, { now = new Date() } = {}){
  const ps = [...periodRows].sort((a,b) => a.period < b.period ? -1 : 1);
  if(!ps.length) throw new Error('no periods');
  const maps = ps.map(p => P.collapseSnapshot(p.rows));
  const periods = ps.map((p, i) => periodSummary(p.period, p.rows, maps[i], i === ps.length - 1));
  const spend = [], conversion = [];
  for(let i = 1; i < ps.length; i++){
    const d = P.spendDelta(maps[i-1], maps[i]);
    const legacy = P.spendDelta(maps[i-1], maps[i], { skipExcluded: false });
    spend.push({ from: ps[i-1].period, to: ps[i].period, total: d.total, matched: d.matched,
      entrants: d.entrants, by_agency: mapObj(d.byAgency),
      legacy_d2: { total: legacy.total, by_agency: mapObj(legacy.byAgency),
        note: 'pre-alignment Agency velocity loop: excluded projects not skipped' } });
    conversion.push({ from: ps[i-1].period, to: ps[i].period, stats: P.conversion(maps[i-1], maps[i]) });
  }
  const latestMap = maps[maps.length - 1];
  const esc = ps.length > 1 ? P.escalation(maps[0], latestMap) : null;
  let proc = 0;
  for(const rec of latestMap.values()) if(rec.bucket === 'Procurement') proc += Math.max(rec.budget - rec.spend, 0);
  const top = [...latestMap.values()].filter(r => P.inStage(r.bucket, 'all'))
    .map(r => ({ r, u: Math.max(r.budget - r.spend, 0) })).sort((a,b) => b.u - a.u).slice(0, 15)
    .map(({ r, u }) => ({ name: r.name, agency: r.agency, borough: P.normBoroughPipeline(r.boroughRaw),
      category: P.catPipeline(r.categoryRaw), phase: r.bucket, budget: r.budget, unspent: u }));
  const latest = ps[ps.length - 1].period;
  const rawBudget = ps[ps.length - 1].rows.reduce((a, r) => a + Math.max(parseFloat(r.total_budget)||0, 0), 0);
  const collapsedBudget = [...latestMap.values()].reduce((a, r) => a + r.budget, 0);
  return {
    meta: {
      generated_at: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      stale_after_hours: STALE_AFTER_HOURS,
      source_as_of: latest,
      source: 'NYC OMB Capital Projects Dashboard, Citywide Budget and Schedule (data.cityofnewyork.us fb86-vt7u), every reporting period, fully paged',
      method_release: '2026-11-20',
      rules: {
        project_key: 'managing_agency + | + (fms_id, else fms_project_name)',
        collapse: 'one record per project per period, most advanced phase kept, first row wins a tie',
        excluded_phases: P.EXCLUDED_LIST,
        committed: 'sum of max(total_budget - spend_to_date, 0) over projects not excluded and not Close-out',
        spend: 'growth in spend_to_date between consecutive periods on the matched panel (projects present in both), floored at zero per project, excluded projects skipped; Close-out kept',
        ttm_spend: 'sum of the last three spend entries'
      },
      units: 'dollars, nominal; unrounded',
      group_format: 'by_phase, by_agency, by_borough, by_category values are [unspent, project_count]; by_phase includes Close-out, the others exclude it'
    },
    periods,
    spend,
    conversion,
    escalation: esc ? { from: ps[0].period, to: latest, n: esc.n, median: esc.median, grew_share: esc.grewShare, added: esc.added, by_agency: esc.agRows } : null,
    latest: {
      period: latest,
      procurement_unspent: proc,
      agency_detail: agencyDetail(latestMap),
      top_projects: top,
      dedup_check: { raw_rows: ps[ps.length-1].rows.length, projects: latestMap.size,
        raw_budget_sum: rawBudget, collapsed_budget_sum: collapsedBudget,
        raw_to_collapsed_ratio: collapsedBudget > 0 ? rawBudget / collapsedBudget : null }
    }
  };
}

async function fetchAll(log){
  const { getJSON, buildUrl, pagedPull } = require('../lib/socrata.js');
  const url = buildUrl('data.cityofnewyork.us', DATASET, { '$select': 'reporting_period,count(*) AS n',
    '$group': 'reporting_period', '$order': 'reporting_period', '$limit': 1000 });
  const list = await getJSON(url);
  if(!Array.isArray(list) || !list.length) throw new Error('no reporting periods');
  const out = [];
  for(const { reporting_period: period, n } of list){
    if(Number(n) > PERIOD_CAP) throw new Error(`period ${period}: ${n} rows exceeds cap ${PERIOD_CAP}`);
    const { rows } = await pagedPull({ dataset: DATASET, select: FIELDS, cap: PERIOD_CAP,
      where: `reporting_period='${period}'`, log });
    if(rows.length !== Number(n)) throw new Error(`period ${period}: pulled ${rows.length}, grouped count ${n}`);
    out.push({ period, rows });
  }
  return out;
}

function readDir(dir){
  return fs.readdirSync(dir).filter(f => /^\d{6}\.json$/.test(f)).map(f => ({
    period: f.slice(0, 6), rows: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

async function main(){
  const a = {}; for(let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i+1];
  const out = a.out || 'data/plan-history.json';
  const periodRows = a['from-dir'] ? readDir(a['from-dir']) : await fetchAll(m => console.log(m));
  const doc = build(periodRows, { now: a.now ? new Date(a.now) : new Date() });
  for(const p of doc.periods){
    if(Math.abs(p.check_filter_first_total - p.committed.total) > 0.5)
      console.log(`NOTE ${p.period}: filter-first committed ${p.check_filter_first_total} differs from collapse-first ${p.committed.total}`);
  }
  const s = JSON.stringify(doc);
  const tmp = out + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, s); fs.renameSync(tmp, out);
  console.log(`${out}: ${doc.periods.length} periods, latest ${doc.meta.source_as_of}, committed ${Math.round(doc.periods[doc.periods.length-1].committed.total)}, ${s.length} bytes`);
}

if(require.main === module) main().catch(e => { console.error('build-plan-history FAILED: ' + (e && e.message || e)); process.exit(1); });
module.exports = { build, FIELDS, PERIOD_CAP };
