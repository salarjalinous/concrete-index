/* test/builders.test.js
 *
 * (A) The pages' own plan code, run in a sandbox on the fixtures, equals
 *     lib/plan-core.js (so the builders do not re-implement the pages).
 * (B) The nightly builders, run on the archived data/*.json, reproduce the
 *     figures already published in precomputed.json and the Checkbook files,
 *     and stay inside their byte budgets.
 *
 *   node --test test/
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers.js');
const P = require('../lib/plan-core.js');
const A = require('../lib/award-core.js');
const C = require('../lib/contract-core.js');
const PH = require('../tools/build-plan-history.js');
const FLOW = require('../tools/build-flow.js');
const CS = require('../tools/build-contract-splits.js');

const plan = H.fixture('plan.sample.json');
const data = f => JSON.parse(H.readRoot('data/' + f));
const SNAP = { R20260622: plan.earlier, R20260716: plan.later };

function planStub(){
  return async (api, params) => {
    if(params['$group']) return Object.keys(SNAP).sort().reverse().map(p => ({ reporting_period: p }));
    const p = /reporting_period='([^']+)'/.exec(params['$where'])[1];
    return JSON.parse(JSON.stringify(SNAP[p]));
  };
}
function pageConsts(src, names){ return names.map(n => H.extractConst(src, n).replace(/^const /, 'var ')).join('\n'); }

test('A1. Funnel fetchPlan (page code) equals lib/plan-core on the fixtures', async () => {
  const src = H.readPage('funnel/index.html');
  const code = [pageConsts(src, ['PLAN_API', 'SNAPSHOTS', 'PHASE_MAP', 'EXCLUDED', 'PHASE_ORDER', 'MONTHS']),
    ...['normPhase', 'phaseRank', 'collapseSnapshot', 'shortPeriod', 'periodLabel', 'fetchPlan'].map(f => H.extractFunction(src, f)),
    'var __run = fetchPlan;'].join('\n');
  const state = { periods: [], snap: {}, spendPeriods: [], pipeline: { total: 0, byAgency: new Map() } };
  const ctx = H.sandbox(code, { globals: { state, getJSON: planStub() } });
  await ctx.__run();
  const pageSet = [...ctx.EXCLUDED].sort();
  const excl = pageSet.includes('land purchase') ? P.EXCLUDED : P.EXCLUDED_LEGACY_D1;
  const a = P.collapseSnapshot(plan.earlier, excl), b = P.collapseSnapshot(plan.later, excl);
  assert.equal(state.spendPeriods.length, 1);
  assert.equal(state.spendPeriods[0].total, P.spendDelta(a, b).total);
  assert.equal(state.pipeline.total, P.committedTotal(b).total);
});

test('A2. Agency fetchVelocityPlan (page code): legacy loop until Patch 2, Funnel rule after', async () => {
  const src = H.readPage('agency/index.html');
  const code = [pageConsts(src, ['PLAN_API', 'VEL_SNAPSHOTS', 'PHASE_MAP', 'EXCLUDED', 'PHASE_ORDER']),
    ...['normPhase', 'phaseRank', 'collapseSnapVel', 'fetchVelocityPlan'].map(f => H.extractFunction(src, f)),
    'var __run = fetchVelocityPlan;'].join('\n');
  const velState = { periods: [], snap: {}, spendPeriods: [], pipeline: { total: 0, byAgency: new Map() } };
  const ctx = H.sandbox(code, { globals: { velState, getJSON: planStub() } });
  await ctx.__run();
  const pageSet = [...ctx.EXCLUDED];
  const excl = pageSet.includes('land purchase') ? P.EXCLUDED : P.EXCLUDED_LEGACY_D1;
  const a = P.collapseSnapshot(plan.earlier, excl), b = P.collapseSnapshot(plan.later, excl);
  const aligned = P.spendDelta(a, b).total, legacy = P.spendDelta(a, b, { skipExcluded: false }).total;
  assert.notEqual(aligned, legacy, 'fixture separates the two rules');
  const got = velState.spendPeriods[0].total;
  const patched = /if\(rec\.bucket === 'excluded'\) continue;\s*const was = prev\.get\(key\);/.test(H.extractFunction(src, 'fetchVelocityPlan'));
  assert.equal(got, patched ? aligned : legacy);
  if(process.env.STRICT_PAGES) assert.ok(patched, 'Patch 2 not applied');
});

test('B1. plan-history reproduces precomputed Committed on the archived plan file', () => {
  const doc = PH.build([{ period: '202609', rows: data('plan-latest.json') }], { now: new Date('2026-11-20T15:30:00Z') });
  const l = doc.periods[0];
  const pre = data('precomputed.json');
  assert.equal(Math.round(l.committed.total), pre.glimpse.committed);
  assert.equal(Math.round(l.stages.all.unspent), pre.glimpse.committed, 'Pipeline "all active" headline is the same figure');
  assert.equal(Math.round(l.check_filter_first_total), pre.glimpse.committed, 'filter-first and collapse-first agree');
  // D1 measured: the legacy rule reads exactly one project and its unspent higher
  assert.equal(l.legacy_d1.committed_count - l.committed.count, 1);
  assert.equal(Math.round((l.legacy_d1.committed_total - l.committed.total) * 100), 161992666);
  // groups sum to the headline
  const sum = o => Object.values(o).reduce((a, v) => a + v[0], 0);
  for(const g of ['by_agency', 'by_borough', 'by_category']) assert.ok(Math.abs(sum(l[g]) - l.committed.total) < 0.01, g);
  assert.ok(Math.abs(Object.values(doc.latest.agency_detail).reduce((a, x) => a + x.total, 0) - l.committed.total) < 0.01);
  assert.equal(l.rows, 5801);
  assert.ok(doc.latest.dedup_check.raw_to_collapsed_ratio > 1.2);
  for(const k of ['generated_at', 'stale_after_hours', 'source_as_of']) assert.ok(doc.meta[k] != null, k);
});

test('B2. plan-history stays under 150 KB at ten periods', () => {
  const rows = data('plan-latest.json');
  const ten = Array.from({ length: 10 }, (_, i) => ({ period: String(202301 + i), rows }));
  const s = JSON.stringify(PH.build(ten));
  assert.ok(s.length < 150000, `${s.length} bytes`);
});

test('B3. flow.json reproduces each owning figure and splits sum to the dollar', () => {
  const pre = data('precomputed.json'), vendors = data('checkbook-vendors.json'), cs = data('contract-search.json');
  const ph = PH.build([{ period: '202609', rows: data('plan-latest.json') }]);
  const doc = FLOW.build({ precomputed: pre, planHistory: ph, awards: data('awards.json'), vendors, now: new Date('2026-11-20T20:00:00Z') });
  const lane = id => doc.lanes.find(l => l.id === id);
  assert.equal(lane('committed').value, pre.glimpse.committed);
  assert.equal(lane('awarded').value, pre.awarded_ttm.total);
  assert.equal(lane('awarded').qualifier, 'gross');
  assert.equal(lane('paid').value, cs.meta.total_paid_to_date, 'Paid equals the contract file to the dollar');
  let reg = 0; for(const k in vendors.vendors) reg += vendors.vendors[k].registered;
  assert.equal(lane('registered').value, reg);
  for(const id of ['committed', 'awarded']){
    const s = lane(id).split_agency;
    assert.equal(s.length, 6); assert.equal(s[5].name, 'All other');
    assert.equal(s.reduce((a, x) => a + x.value, 0), lane(id).value, id);
  }
  assert.equal(lane('committed').split_borough.reduce((a, x) => a + x.value, 0), lane('committed').value);
  assert.equal(lane('registered').split_agency, null);
  assert.equal(lane('registered').split_note, 'No agency split is published for this ledger.');
  assert.deepEqual(doc.meta.notes, []);
  assert.ok(JSON.stringify(doc).length < 20000);
  for(const k of ['generated_at', 'stale_after_hours', 'source_as_of']) assert.ok(doc.meta[k] != null, k);
});

test('B4. contract splits: lossless index, shards hold every curve, aggregates match the pages', () => {
  const src = data('contract-search.json'), vendors = data('checkbook-vendors.json');
  const now = new Date('2026-11-20T20:00:00Z');
  const idx = CS.buildIndex(src.contracts, src.meta, now);
  const s = JSON.stringify(idx);
  assert.ok(s.length < 1200000, `${s.length} bytes`);
  const dec = C.decodeIndex(JSON.parse(s));
  assert.equal(dec.length, src.contracts.length);
  for(let i = 0; i < dec.length; i++){
    const { monthly_cumulative, first_payment_date, last_payment_date, ...rest } = src.contracts[i];
    const { has_curve, ...got } = dec[i];
    assert.deepEqual(got, rest);
    assert.equal(has_curve, Array.isArray(monthly_cumulative) && monthly_cumulative.length ? 1 : 0);
  }
  const shards = CS.buildShards(src.contracts);
  assert.equal(Object.keys(shards).length, 64);
  const curves = src.contracts.filter(c => Array.isArray(c.monthly_cumulative) && c.monthly_cumulative.length);
  for(const c of curves) assert.deepEqual(shards[C.shardOf(c.contract_id)][c.contract_id].monthly_cumulative, c.monthly_cumulative);
  const agg = CS.buildAggregates(src.contracts, vendors, src.meta, now);
  // Contracts page KPI = payments.yml meta totals
  assert.equal(agg.contracts_page.registered, src.meta.total_registered);
  assert.equal(agg.contracts_page.paid, src.meta.total_paid_to_date);
  assert.equal(agg.contracts_page.with_dated, src.meta.contracts_with_dated_payments);
  // Agency TILE 1 and Analysis S-curve are the page functions on the full file
  assert.deepEqual(agg.agency_velocity, C.agencyVelocity(src.contracts));
  assert.equal(agg.scurve.sweptTotal, src.contracts.filter(c => c.payments_swept === true).length);
  // D6 measured
  const r = agg.reconciliation_d6;
  assert.equal(r.paid_gap, 0);
  assert.equal(r.registered_current_amount_only, r.registered_canonical);
  assert.equal(r.registered_gap_contracts_page_vs_canonical, r.original_amount_fallback.dollars);
  assert.equal(r.fallback_explains_gap, true);
});

test('B5. award-core reproduces the archived precompute', () => {
  const pre = data('precomputed.json'), rows = data('awards.json');
  const g = A.grossTtmFromArchive(rows, pre.meta.generated);
  assert.equal(g.total, pre.awarded_ttm.total);
  assert.equal(g.count, pre.awarded_ttm.count);
  const ix = A.indexFromRows(rows, pre.meta.generated);
  assert.equal(Math.round(ix.value * 100) / 100, pre.index_level);
  assert.equal(ix.month, pre.index_month);
});

test('B6. socrata pager: refuses a short pull and an over-cap count, keeps order rules', async () => {
  const S = require('../lib/socrata.js');
  const rows = Array.from({ length: 25 }, (_, i) => ({ ':id': 'row-' + String(i).padStart(3, '0'), d: String(i % 3), r: String(100 - i) }));
  const fake = (served, count) => async url => {
    const u = new URL(url);
    if(u.searchParams.get('$select').startsWith('count(')) return { ok: true, json: async () => [{ n: String(count) }] };
    assert.equal(u.searchParams.get('$order'), ':id');
    const off = +u.searchParams.get('$offset'), lim = +u.searchParams.get('$limit');
    return { ok: true, json: async () => served.slice(off, off + lim).map(x => ({ ...x })) };
  };
  const ok = await S.pagedPull({ dataset: 'x', select: 'd,r', cap: 100, pageSize: 10, fetchImpl: fake(rows, 25), sort: 'd DESC,r', attempts: 1 });
  assert.equal(ok.rows.length, 25);
  assert.ok(ok.rows.every(r => !(':id' in r)));
  assert.equal(ok.rows[0].d, '2');
  await assert.rejects(S.pagedPull({ dataset: 'x', select: 'd', cap: 100, pageSize: 10, fetchImpl: fake(rows.slice(0, 20), 25), attempts: 1 }), /refusing to write a partial file/);
  await assert.rejects(S.pagedPull({ dataset: 'x', select: 'd', cap: 24, pageSize: 10, fetchImpl: fake(rows, 25), attempts: 1 }), /exceeds the cap/);
  await assert.rejects(S.pagedPull({ dataset: 'x', select: 'd', cap: 100, pageSize: 10, fetchImpl: fake([...rows.slice(0, 10), ...rows.slice(0, 15)], 25), attempts: 1 }), /refusing/);
});

test('B7. awards.json re-sorted from :id order is byte-identical to the archived file', () => {
  const S = require('../lib/socrata.js');
  const { socrataStyle } = require('../tools/socrata-pull.js');
  const raw = H.readRoot('data/awards.json');
  const rows = JSON.parse(raw).map((r, i) => ({ ...r, ':id': 'row-' + String((i * 7919) % 100003).padStart(6, '0') }));
  rows.sort((a, b) => a[':id'] < b[':id'] ? -1 : 1);
  rows.sort(S.makeComparator('start_date DESC,request_id'));
  for(const r of rows) delete r[':id'];
  assert.equal(socrataStyle(rows), raw);
});
