/* test/methodology.test.js
 *
 * The 13 methodology regression treatments of PRD 11.3, against fixtures cut
 * from real archived records (test/fixtures/cut-fixtures.js). Node 20, no
 * dependencies:
 *
 *   node --test test/
 *   TZ=Europe/Berlin node --test test/
 *   STRICT_PAGES=1 node --test test/      (after the page patches are applied:
 *                                          every plan page must use the canonical set)
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const H = require('./helpers.js');
const P = require('../lib/plan-core.js');
const A = require('../lib/award-core.js');
const C = require('../lib/contract-core.js');
const FLOW = require('../tools/build-flow.js');

const T0 = '2026-11-20T15:30:00Z';
const awards = H.fixture('awards.sample.json');
const plan = H.fixture('plan.sample.json');
const CLAUSE = "starts_with(category_description,'Construction')";
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- 1. City Record construction filter ---------- */
test('1. City Record construction filter', async t => {
  await t.test('only Construction categories pass', () => {
    assert.ok(awards.every(A.isConstruction), 'every archived row is Construction');
    const neg = clone(awards[0]); neg.category_description = 'Goods';          // derived negative
    const neg2 = clone(awards[0]); neg2.category_description = 'Services (other than human services)';
    const pre = clone(awards[0]); pre.category_description = 'Construction/Construction Services';
    assert.equal(A.isConstruction(neg), false);
    assert.equal(A.isConstruction(neg2), false);
    assert.equal(A.isConstruction(pre), true);
    assert.deepEqual([...new Set(awards.map(r => r.category_description))].sort(),
      ['Construction Related Services', 'Construction/Construction Services']);
  });
  await t.test('static scan: every City Record $where carries the clause', () => {
    const SKIP = /reporting_period|budget_submission_date|type_of_procurement|procurement_type/;
    const bad = [];
    for(const f of H.sourceFiles()){
      const s = fs.readFileSync(f, 'utf8');
      if(!/qyyg-4tf5|3khw-qi8f|AWARD_API/.test(s)) continue;
      const lits = [];
      const re = /['"]\$where['"]\s*:\s*(`[^`]*`|'[^']*'|"[^"]*"|[A-Za-z_]\w*)/g; let m;
      while((m = re.exec(s))) lits.push(m[1]);
      const re2 = /--where\s+"([^"]*)"/g; while((m = re2.exec(s))) lits.push(m[1]);
      const re3 = /\\?\$where=([^"\n]*)"/g; while((m = re3.exec(s))) lits.push(m[1]);
      for(const l of lits){
        if(/^[A-Za-z_]\w*$/.test(l)){
          const defs = [...s.matchAll(new RegExp('(?:const|var|let)\\s+' + l + '\\s*=\\s*([^;]+);', 'g'))].map(x => x[1]);
          if(!defs.length || defs.some(d => !SKIP.test(d) && !d.includes(CLAUSE))) bad.push(`${path.relative(H.ROOT, f)}: $where ${l}`);
        }else if(!SKIP.test(l) && !l.includes(CLAUSE) && !/wherePeriod|reporting/.test(l)){
          bad.push(`${path.relative(H.ROOT, f)}: ${l.slice(0, 80)}`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });
});

/* ---------- 2. Renewal/extension flag ---------- */
test('2. renewal/extension flag', () => {
  const flagged = awards.filter(r => A.isContinuation(r.selection_method_description)).map(r => r.request_id).sort();
  const expected = awards.filter(r => /renewal|extension/i.test(r.selection_method_description || '')).map(r => r.request_id).sort();
  assert.ok(flagged.length >= 6);
  assert.deepEqual(flagged, expected);
  for(const m of ['Renewal', 'RENEWAL', 'Contract Extension', 'extension of term']) assert.equal(A.isContinuation(m), true, m);
  for(const m of ['Competitive Sealed Bids', 'Negotiated Acquisition', '', null]) assert.equal(A.isContinuation(m), false, String(m));
  // new-work excludes them, gross keeps them
  const base = awards.find(r => !A.isContinuation(r.selection_method_description) && +r.contract_amount < 5e8);
  const ren = clone(base); ren.pin = 'TEST-REN'; ren.selection_method_description = 'Renewal';
  const rows = [base, ren].map(r => ({ ...r, start_date: '2026-05-01T00:00:00.000' }));
  const g = A.grossTtmFromArchive(rows, T0);
  assert.equal(g.count, 2);
  const newWork = A.dedupeAwardsByPin(rows).filter(r => !(r.amt >= A.MEGA || A.isContinuation(r.method)));
  assert.equal(newWork.length, 1);
});

/* ---------- 3. $500M+ exclusion ---------- */
test('3. $500M+ megaproject exclusion', () => {
  const base = awards.find(r => !A.isContinuation(r.selection_method_description) && r.pin);
  const mk = (pin, amt) => ({ ...clone(base), pin, contract_amount: String(amt), start_date: '2026-06-10T00:00:00.000' });
  const rows = [mk('T-499', 499999999), mk('T-500', 500000000)];
  // new work (Briefing / Analysis rule): amt >= MEGA is dropped
  const nw = A.dedupeAwardsByPin(rows).filter(r => !(r.amt >= A.MEGA || A.isContinuation(r.method)));
  assert.deepEqual(nw.map(r => r.amt), [499999999]);
  // gross keeps both
  assert.equal(A.grossTtmFromArchive(rows, T0).total, 999999999);
  // the archived megas are all at or above the line and are dropped by the index rule
  const megas = awards.filter(r => +r.contract_amount >= 5e8);
  assert.ok(megas.length >= 4);
  const idxRows = megas.filter(r => +r.contract_amount > 0 && +r.contract_amount < A.MEGA);
  assert.equal(idxRows.length, 0);
});

/* ---------- 4. Pin dedupe ---------- */
test('4. pin dedupe', () => {
  const three = awards.filter(r => r.pin === 'CNYG-818MA');
  assert.equal(three.length, 3);
  const d = A.dedupeAwardsByPin(three);
  assert.equal(d.length, 1);
  assert.equal(d[0].amt, Math.max(...three.map(r => +r.contract_amount)));
  const unpinned = awards.filter(r => !r.pin);
  assert.equal(unpinned.length, 9);
  assert.equal(A.dedupeAwardsByPin(unpinned).length, 9, 'unpinned notices stand alone');
  // two unpinned notices share an amount and must still both count
  const same = unpinned.filter(r => r.contract_amount === '8832903');
  assert.equal(same.length, 2);
  assert.equal(A.dedupeAwardsByPin(same).length, 2);
});

/* ---------- 5. OMB dedup ---------- */
test('5. OMB dedup: one record per agency + FMS ID, most advanced phase, budget once', () => {
  const rows = plan.later;
  const m = P.collapseSnapshot(rows);
  const keys = new Set(rows.map(P.projectKey));
  assert.equal(m.size, keys.size);
  const c540 = rows.filter(r => P.projectKey(r) === 'DEP|C540');
  assert.ok(c540.length >= 3);
  assert.equal(m.get('DEP|C540').bucket, 'Construction');
  assert.equal(m.get('NYPD|PO79BMALC').bucket, 'Design');                   // Completed row does not win
  assert.equal(m.get('DDC|HH112PJFC').bucket, 'Procurement');               // Cancelled row does not win
  const budget = +c540[0].total_budget;
  assert.ok(c540.every(r => +r.total_budget === budget), 'budget repeats on every row');
  assert.equal(m.get('DEP|C540').budget, budget, 'collapsed record counts it once');
  const raw = rows.reduce((a, r) => a + (+r.total_budget || 0), 0);
  const col = [...m.values()].reduce((a, r) => a + r.budget, 0);
  const ratio = raw / col;
  assert.ok(ratio > 1);
  console.log(`  raw-to-collapsed budget ratio on the fixture: ${ratio.toFixed(3)}`);
});

/* ---------- 6. Phase normalization ---------- */
function pageExcluded(src){
  const m = /const EXCLUDED = new Set\(\[([\s\S]*?)\]\);/.exec(src);
  if(!m) return null;
  return new Set([...m[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g)].map(x => x[1]));
}
test('6. phase normalization: one canonical exclusion set', async t => {
  await t.test('buckets', () => {
    const cases = { '(Completed)': 'excluded', 'Pre-Design': 'Pre-Design', 'Construction Procurement': 'Procurement',
      'Design Built': 'Construction', 'Closeout': 'Close-out', '(Land Purchase)': 'excluded', 'Land Purchase': 'excluded',
      'Requirements Contract': 'Other active', '': 'Other active', 'On-Hold': 'excluded', 'Initiation': 'Pending' };
    for(const [raw, b] of Object.entries(cases)) assert.equal(P.normPhase(raw), b, raw);
    const lp = plan.later.find(r => P.projectKey(r) === 'CUNY|CA055QB17');
    assert.equal(P.normPhase(lp.current_phase), 'excluded');
    assert.equal(P.normPhase(lp.current_phase, P.EXCLUDED_LEGACY_D1), 'Other active');
  });
  await t.test('archive workflow uses the canonical set', () => {
    const yml = H.readRoot('.github/workflows/archive.yml');
    const m = /EXCLUDED = set\(\[([^\]]*)\]\)/.exec(yml);
    const set = new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
    assert.deepEqual([...set].sort(), [...P.EXCLUDED].sort());
  });
  await t.test('Pipeline page uses the canonical set', () => {
    assert.deepEqual([...pageExcluded(H.readPage('pipeline/index.html'))].sort(), [...P.EXCLUDED].sort());
  });
  await t.test('Funnel, Agency, Analysis, Briefing: canonical, or the legacy set pending the page patch', () => {
    for(const p of ['funnel', 'agency', 'analysis', 'briefing']){
      const f = p + '/index.html';
      if(!fs.existsSync(path.join(H.PAGES_ROOT, f))) continue;
      const set = [...pageExcluded(H.readPage(f))].sort();
      const canon = [...P.EXCLUDED].sort(), legacy = [...P.EXCLUDED_LEGACY_D1].sort();
      if(process.env.STRICT_PAGES) assert.deepEqual(set, canon, f);
      else{
        assert.ok(JSON.stringify(set) === JSON.stringify(canon) || JSON.stringify(set) === JSON.stringify(legacy), f + ' has an unknown set');
        if(JSON.stringify(set) !== JSON.stringify(canon)) t.diagnostic(`${f}: legacy set, apply page-patches.md Patch 1`);
      }
    }
  });
});

/* ---------- 7. Snapshot delta ---------- */
test('7. snapshot delta: matched panel, floored, entrants 0, excluded skipped', () => {
  const a = P.collapseSnapshot(plan.earlier), b = P.collapseSnapshot(plan.later);
  const d = P.spendDelta(a, b);
  let expect = 0, entrants = 0;
  for(const [k, rec] of b){
    if(rec.bucket === 'excluded') continue;
    const w = a.get(k); if(!w){ entrants++; continue; }
    expect += Math.max(rec.spend - w.spend, 0);
  }
  assert.equal(d.total, expect);
  assert.equal(d.entrants, entrants);
  assert.ok(!a.has('ACS|CROSSBH') && b.has('ACS|CROSSBH'), 'fixture has an entrant');
  assert.equal(d.byAgency.get('ACS') || 0, [...b].filter(([k, r]) => r.agency === 'ACS' && a.has(k) && r.bucket !== 'excluded')
    .reduce((s, [k, r]) => s + Math.max(r.spend - a.get(k).spend, 0), 0), 'entrant adds 0');
  // floor: CUNY|ACECUN213 fell between snapshots and adds 0, not a negative
  assert.ok(b.get('CUNY|ACECUN213').spend < a.get('CUNY|ACECUN213').spend);
  // D2: an excluded project's growth is skipped; the legacy Agency loop counted it
  const ex = b.get('CUNY|BX024-011');
  assert.equal(ex.bucket, 'excluded');
  const legacy = P.spendDelta(a, b, { skipExcluded: false });
  assert.ok(legacy.total > d.total);
  assert.ok(legacy.total - d.total >= ex.spend - a.get('CUNY|BX024-011').spend - 1e-6);
});

/* ---------- 8. MTA thousands ---------- */
test('8. MTA values in thousands become dollars x 1000', () => {
  const src = H.readPage('regional/index.html');
  assert.ok(src.includes("budget_submission_date='Current'"), 'MTA pulls filter to the current submission');
  const ag = /D\.mtaAg = mtaAg\.map\((r=>\(\{[^;]+\}\))\);/.exec(src);
  const pl = /D\.mtaPlans = mtaPlans\.map\((r=>\(\{[^;]+\}\))\);/.exec(src);
  assert.ok(ag && pl, 'MTA conversion expressions found');
  const ctx = H.sandbox(`var fa = ${ag[1]}; var fp = ${pl[1]};`);
  // shape of kizb-nxtu aggregate rows (s = sum of current allocation, in thousands)
  assert.equal(ctx.fa({ agency_name: 'New York City Transit', s: '12345.678' }).s, 12345678);
  assert.equal(ctx.fp({ capital_plan: 'Capital Plan 2025 - 2029', s: '1000' }).s, 1000000);
  assert.equal(ctx.fp({ capital_plan: 'Capital Plan 2025 - 2029', s: '1000' }).p, '2025 - 2029');
});

/* ---------- 9. No blended scopes ---------- */
test('9. no blended scopes in flow.json', () => {
  const vendors = H.fixture('checkbook-vendors.sample.json');
  const doc = FLOW.build({ precomputed: JSON.parse(H.readRoot('data/precomputed.json')), planHistory: null, awards: null, vendors, now: T0 });
  const vals = doc.lanes.map(l => l.value).filter(v => v != null);
  const sums = [];
  for(let i = 0; i < vals.length; i++) for(let j = i + 1; j < vals.length; j++) sums.push(vals[i] + vals[j]);
  const walk = (o, at) => {
    if(o && typeof o === 'object'){
      for(const [k, v] of Object.entries(o)){
        assert.ok(!/total|sum|conversion|of_which|lost/i.test(k) || k === 'paid_over_registered', `key ${at}.${k}`);
        walk(v, at + '.' + k);
      }
    }else if(typeof o === 'number') assert.ok(!sums.includes(o), `${at} equals a sum of two ledgers`);
  };
  walk(doc, 'flow');
  for(const l of doc.lanes){
    const named = ['committed', 'awarded', 'registered', 'paid'].filter(n => l.id.includes(n));
    assert.equal(named.length, 1, l.id);
  }
  assert.equal(doc.same_contracts_ratio.label, 'same contracts');
  assert.ok(doc.meta.disclaimer.startsWith('Four separate ledgers, not one flow.'));
});

/* ---------- 10. Checkbook paid to date ---------- */
test('10. Checkbook paid to date: FY label, stale at 49h, dropped at 337h', async t => {
  const vendors = H.fixture('checkbook-vendors.sample.json');
  const funnel = H.readPage('funnel/index.html');
  await t.test('label', () => {
    const ctx = H.sandbox(H.extractFunction(funnel, 'cbkFYLabel'));
    assert.equal(ctx.cbkFYLabel(vendors.meta).short, 'FY21–26 + FY27 YTD');
    assert.equal(FLOW.fyLabel(vendors.meta), 'FY21–26 + FY27 YTD');
    const doc = FLOW.build({ precomputed: null, planHistory: null, awards: null, vendors, now: T0 });
    const paid = doc.lanes.find(l => l.id === 'paid');
    assert.match(paid.qualifier, /paid to date/);
    assert.equal(paid.fy_label, 'FY21–26 + FY27 YTD');
    assert.match(funnel, /paid to date/);
  });
  await t.test('freshness', async () => {
    const code = [H.extractConst(funnel, 'CBK_STALE_H_DEFAULT'), H.extractConst(funnel, 'CBK_DROP_H_DEFAULT'),
      H.extractFunction(funnel, 'fetchCheckbook'), 'var __run = fetchCheckbook;'].join('\n');
    const gen = Date.parse(vendors.meta.generated);
    const run = async hours => {
      const state = { checkbook: { paid: 0, ok: false, meta: null, ageHours: null, stale: false } };
      const ctx = H.sandbox(code, { now: gen + hours * 36e5, globals: { state,
        fetch: async () => ({ ok: true, json: async () => clone(vendors) }) } });
      try{ await ctx.__run(); return { ok: state.checkbook.ok, stale: state.checkbook.stale }; }
      catch(e){ return { dropped: true }; }
    };
    assert.deepEqual(await run(47), { ok: true, stale: false });
    assert.deepEqual(await run(49), { ok: true, stale: true });
    assert.deepEqual(await run(335), { ok: true, stale: true });
    assert.deepEqual(await run(337), { dropped: true });
  });
});

/* ---------- 11. TTM window ---------- */
test('11. TTM window at T0 and its boundary instants', () => {
  assert.deepEqual(A.ttmWindow(T0), { lo: '2025-11-01', hi: '2026-11-01' });
  assert.deepEqual(A.ttmWindow('2026-11-01T00:00:00.000Z'), { lo: '2025-11-01', hi: '2026-11-01' });
  assert.deepEqual(A.ttmWindow('2026-10-31T23:59:59.999Z'), { lo: '2025-10-01', hi: '2026-10-01' });
  assert.deepEqual(A.ttmWindow('2027-01-15T12:00:00Z'), { lo: '2026-01-01', hi: '2027-01-01' });
  // the archived precompute window agrees
  const pre = JSON.parse(H.readRoot('data/precomputed.json'));
  assert.deepEqual(A.ttmWindow(pre.meta.generated), { lo: pre.meta.ttm_start, hi: pre.meta.ttm_end });
  // [lo, hi): first day in, the exclusive end out (rows derived from a real notice)
  const base = awards.find(r => r.pin && +r.contract_amount < 5e8);
  const at = (pin, d) => ({ ...clone(base), pin, start_date: d + 'T00:00:00.000' });
  const g = A.grossTtmFromArchive([at('B1', '2025-11-01'), at('B2', '2026-10-31'), at('B3', '2026-11-01'), at('B4', '2025-10-31')], T0);
  assert.equal(g.count, 2);
  // the page helper (home) gives the same window under a fixed clock
  const home = H.readPage('index.html');
  const ctx = H.sandbox(H.extractFunction(home, 'isoBoundary'), { now: T0 });
  assert.equal(ctx.isoBoundary(12), '2025-11-01');
  assert.equal(ctx.isoBoundary(0), '2026-11-01');
});

/* ---------- 12. Time-zone month boundary ---------- */
test('12. identical index and windows in five time zones', () => {
  const zones = ['America/New_York', 'America/Los_Angeles', 'Europe/Berlin', 'Asia/Tokyo', 'Pacific/Kiritimati'];
  const script = `
    const A = require(${JSON.stringify(path.join(H.ROOT, 'lib/award-core.js'))});
    const H = require(${JSON.stringify(path.join(H.ROOT, 'test/helpers.js'))});
    const rows = require(${JSON.stringify(path.join(H.ROOT, 'data/awards.json'))});
    const home = H.readPage('index.html');
    const ctx = H.sandbox(H.extractFunction(home, 'isoBoundary'), { now: '${T0}' });
    const fun = H.sandbox(H.extractFunction(H.readPage('funnel/index.html'), 'isoCompleteMonthBoundary'), { now: '${T0}' });
    const ix = A.indexFromRows(rows, '${T0}');
    process.stdout.write(JSON.stringify({ w: A.ttmWindow('${T0}'), home: [ctx.isoBoundary(12), ctx.isoBoundary(0)],
      funnel: [fun.isoCompleteMonthBoundary(12), fun.isoCompleteMonthBoundary(0)], ix: ix.value.toFixed(6), m: ix.month }));`;
  const outs = zones.map(tz => {
    const r = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  });
  for(const o of outs) assert.equal(o, outs[0]);
  const j = JSON.parse(outs[0]);
  assert.deepEqual(j.home, ['2025-11-01', '2026-11-01']);
  assert.deepEqual(j.funnel, ['2025-11-01', '2026-11-01']);
  assert.equal(j.m, '2026-10');
  assert.equal(Number(j.ix).toFixed(2), String(JSON.parse(H.readRoot('data/precomputed.json')).index_level));
});

/* ---------- 13. Agency window boundary ---------- */
test('13. an award on the window first day is counted; no strict start_date> anywhere', () => {
  const base = awards.find(r => r.pin && +r.contract_amount < 5e8);
  const first = { ...clone(base), pin: 'FIRSTDAY', start_date: '2025-11-01T00:00:00.000', agency_name: 'Design and Construction' };
  assert.equal(A.grossTtmFromArchive([first], T0).count, 1);
  // the Agency page's own where clause uses >= on the first day
  const ag = H.readPage('agency/index.html');
  assert.match(ag, /start_date>='\$\{since\}' AND start_date<'\$\{until\}'/);
  const hits = [];
  for(const f of H.sourceFiles()){
    const s = fs.readFileSync(f, 'utf8');
    if(/start_date\s*>\s*'/.test(s)) hits.push(path.relative(H.ROOT, f));
  }
  assert.deepEqual(hits, []);
});

/* ---------- contract-core shard routing (supports the Contracts split) ---------- */
test('contract shards route every id to one of 64 files', () => {
  const cs = H.fixture('contract-search.sample.json').contracts;
  for(const c of cs){ const s = C.shardOf(c.contract_id); assert.match(s, /^[0-9a-f]{2}$/); assert.ok(parseInt(s, 16) < 64); }
  assert.equal(C.shardOf('CT185020221402086'), C.shardOf('CT185020221402086'));
});
