#!/usr/bin/env node
/* tools/build-contract-splits.js  (Node 20)
 *
 * Splits data/contract-search.json (kept published as is) into:
 *   data/contract-index.json          every contract, every field the pages read,
 *                                     minus monthly_cumulative and the two payment
 *                                     dates no page reads; columnar, with string
 *                                     dictionaries for agency, category, award_method
 *   data/contract-detail/<xx>.json    64 shards (xx = lib/contract-core.js shardOf),
 *                                     { contract_id: { monthly_cumulative } }; all 64
 *                                     written every run so no stale shard survives
 *   data/contract-aggregates.json     the cross-agency figures Agency and Analysis
 *                                     compute from the full file, plus the
 *                                     Registered/Paid reconciliation (D6)
 * The functions are lib/contract-core.js, the pages' own code.
 *
 *   node tools/build-contract-splits.js --data data
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../lib/contract-core.js');

const DROP = new Set(['monthly_cumulative', 'first_payment_date', 'last_payment_date']);
const DICT = ['agency', 'category', 'award_method'];
const STALE_AFTER_HOURS = 48;
const INDEX_BUDGET = 1200000;

function iso(t){ return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

function buildIndex(contracts, meta, now){
  const fields = [];
  for(const c of contracts) for(const k of Object.keys(c)) if(!DROP.has(k) && !fields.includes(k)) fields.push(k);
  fields.push('has_curve');
  const dicts = {}, lookup = {};
  for(const f of DICT){ dicts[f] = []; lookup[f] = new Map(); }
  const rows = contracts.map(c => fields.map(f => {
    if(f === 'has_curve') return Array.isArray(c.monthly_cumulative) && c.monthly_cumulative.length > 0 ? 1 : 0;
    const v = c[f] === undefined ? null : c[f];
    if(lookup[f] && v != null){
      if(!lookup[f].has(v)){ lookup[f].set(v, dicts[f].length); dicts[f].push(v); }
      return lookup[f].get(v);
    }
    return v;
  }));
  return {
    meta: { generated_at: iso(now), stale_after_hours: STALE_AFTER_HOURS,
      source_as_of: meta.generated || null, source: 'data/contract-search.json (Checkbook NYC), split nightly',
      contracts: contracts.length, fiscal_years: meta.fiscal_years, fiscal_year_ytd: meta.fiscal_year_ytd,
      fiscal_years_closed: meta.fiscal_years_closed, as_of: meta.as_of,
      format: 'rows are arrays in `fields` order; agency, category, award_method hold an index into `dicts`; decode with lib/contract-core.js decodeIndex; has_curve=1 means the detail shard carries monthly_cumulative',
      dropped_fields: [...DROP], shards: C.SHARDS, shard_rule: 'FNV-1a 32-bit of contract_id, mod 64, two hex digits: data/contract-detail/<xx>.json' },
    fields, dicts, rows
  };
}

function buildShards(contracts){
  const shards = {};
  for(let i = 0; i < C.SHARDS; i++) shards[(i < 16 ? '0' : '') + i.toString(16)] = {};
  for(const c of contracts){
    if(!Array.isArray(c.monthly_cumulative) || !c.monthly_cumulative.length) continue;
    const s = shards[C.shardOf(c.contract_id)];
    if(s[c.contract_id]) throw new Error(`duplicate contract_id with a curve: ${c.contract_id}`);
    s[c.contract_id] = { monthly_cumulative: c.monthly_cumulative };
  }
  return shards;
}

function buildAggregates(contracts, vendors, meta, now){
  const agg = C.aggregate(contracts);
  const vel = C.agencyVelocity(contracts);
  const m50 = {}; for(const [k, v] of C.med50ByName(contracts)) m50[k] = v;
  const bundle = C.sCurveBundle(contracts);
  // Analysis reads "today" from the clock; the aggregate is fixed to the file's own date
  const basis = (meta.as_of || String(meta.generated || '').slice(0, 10));
  const today = C.utcDayMs(basis);
  const sched = C.scatterAgencyMeans(contracts, today);
  let curOnly = 0, fallbackN = 0, fallbackSum = 0;
  for(const c of contracts){
    const cur = +c.current_amount;
    if(cur > 0) curOnly += cur;
    else { const o = +c.original_amount; if(o > 0){ fallbackN++; fallbackSum += o; } }
  }
  let vReg = null, vPaid = null;
  if(vendors && vendors.vendors){ vReg = 0; vPaid = 0; for(const k in vendors.vendors){ vReg += +vendors.vendors[k].registered || 0; vPaid += +vendors.vendors[k].paid || 0; } }
  return {
    meta: { generated_at: iso(now), stale_after_hours: STALE_AFTER_HOURS, source_as_of: meta.generated || null,
      source: 'data/contract-search.json (Checkbook NYC); functions from lib/contract-core.js',
      min_agency_n: C.MIN_AGENCY_N, scurve_horizon_months: C.SCURVE_HORIZON,
      schedule_basis_date: basis,
      schedule_basis_note: 'The Analysis page measures elapsed schedule against the reader\'s current UTC day; this file fixes it to the contract file\'s as_of day so the figure is dated by the data.' },
    contracts_page: { count: agg.count, registered: agg.registered, paid: agg.paid, median_first_payment_lag_days: agg.medianLag, with_dated: agg.withDated },
    agency_velocity: vel,
    med50_by_agency: m50,
    scurve: bundle,
    schedule_pace: sched,
    reconciliation_d6: {
      canonical_source: 'data/checkbook-vendors.json',
      registered_canonical: vReg, paid_canonical: vPaid,
      registered_current_amount_only: curOnly,
      registered_contracts_page_rule: agg.registered,
      registered_with_original_fallback: curOnly + fallbackSum,
      original_amount_fallback: { contracts: fallbackN, dollars: fallbackSum },
      paid_contracts_file: agg.paid,
      paid_gap: vPaid == null ? null : agg.paid - vPaid,
      registered_gap_contracts_page_vs_canonical: vReg == null ? null : agg.registered - vReg,
      contracts_page_matches_canonical: vReg != null && agg.registered === vReg,
      note: 'Registered and Paid have one canonical source, checkbook-vendors.json. Since Nov 20, 2026 the Contracts page KPI sums current amounts only (D6), so it matches the canonical figure; registered_with_original_fallback is the earlier rule, which counted a contract with no current amount at its original amount.'
    }
  };
}

function writeAtomic(p, s){ const t = p + '.tmp-' + process.pid; fs.writeFileSync(t, s); fs.renameSync(t, p); }

function main(){
  const a = {}; for(let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i+1];
  const dir = a.data || 'data', outDir = a.out || dir;
  const now = a.now ? new Date(a.now) : new Date();
  const src = JSON.parse(fs.readFileSync(path.join(dir, 'contract-search.json'), 'utf8'));
  const vp = path.join(dir, 'checkbook-vendors.json');
  const vendors = fs.existsSync(vp) ? JSON.parse(fs.readFileSync(vp, 'utf8')) : null;
  const contracts = src.contracts || [];
  if(!contracts.length) throw new Error('contract-search.json carries no contracts');
  const ids = new Set(contracts.map(c => c.contract_id));
  if(ids.size !== contracts.length) console.log(`NOTE: ${contracts.length - ids.size} repeated contract_id values`);

  const idx = buildIndex(contracts, src.meta || {}, now);
  const idxS = JSON.stringify(idx);
  if(idxS.length > INDEX_BUDGET) throw new Error(`contract-index.json is ${idxS.length} bytes, over the ${INDEX_BUDGET} budget`);
  const shards = buildShards(contracts);
  const aggS = JSON.stringify(buildAggregates(contracts, vendors, src.meta || {}, now));

  const sdir = path.join(outDir, 'contract-detail');
  fs.mkdirSync(sdir, { recursive: true });
  for(const f of fs.readdirSync(sdir)) if(!/^[0-9a-f]{2}\.json$/.test(f) || !(f.slice(0, 2) in shards)) fs.unlinkSync(path.join(sdir, f));
  let maxShard = 0;
  for(const [k, v] of Object.entries(shards)){ const s = JSON.stringify(v); maxShard = Math.max(maxShard, s.length); writeAtomic(path.join(sdir, k + '.json'), s); }
  writeAtomic(path.join(outDir, 'contract-index.json'), idxS);
  writeAtomic(path.join(outDir, 'contract-aggregates.json'), aggS);
  console.log(`contract-index.json ${idxS.length} bytes (${contracts.length} contracts); 64 shards, largest ${maxShard} bytes; contract-aggregates.json ${aggS.length} bytes`);
}

if(require.main === module){ try{ main(); }catch(e){ console.error('build-contract-splits FAILED: ' + (e && e.message || e)); process.exit(1); } }
module.exports = { buildIndex, buildShards, buildAggregates };
