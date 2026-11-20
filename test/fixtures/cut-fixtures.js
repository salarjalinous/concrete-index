#!/usr/bin/env node
/* test/fixtures/cut-fixtures.js
 *
 * Cuts the frozen test fixtures from REAL archived records (data/*.json at
 * main b2bb90d, Nov 20 2026, and the earlier revision 3a4a959 of
 * data/plan-latest.json for the prior snapshot). Re-run only to re-cut; the
 * fixtures are committed so the tests never depend on tonight's data.
 *
 *   node test/fixtures/cut-fixtures.js
 *
 * Every record is copied unchanged. Where a test needs a value the archive does
 * not hold (an award dated exactly on a window boundary, an amount of exactly
 * $500,000,000), the test derives it from one of these real rows in the test
 * body and says so.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const P = require(path.join(ROOT, 'lib/plan-core.js'));
const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const out = (f, v) => fs.writeFileSync(path.join(__dirname, f), JSON.stringify(v, null, 1) + '\n');

// ---- awards ----
const awards = rd('data/awards.json');
const pick = new Set();
const keep = r => pick.add(awards.indexOf(r));
['CNYG-818MA', 'M104-219M', 'B124-119M'].forEach(p => awards.filter(r => r.pin === p).forEach(keep));   // pins with 3 notices
awards.filter(r => !r.pin).forEach(keep);                                                             // all 9 unpinned
awards.filter(r => /renewal|extension/i.test(r.selection_method_description || '')).slice(0, 6).forEach(keep);
awards.filter(r => +r.contract_amount >= 5e8).slice(0, 4).forEach(keep);                               // megaprojects
awards.filter(r => (r.start_date || '') >= '2025-10-01' && (r.start_date || '') < '2025-11-05').slice(0, 6).forEach(keep);
awards.filter(r => (r.start_date || '') >= '2026-10-25' && (r.start_date || '') < '2026-11-05').slice(0, 6).forEach(keep);
awards.filter(r => (r.start_date || '').startsWith('2019-')).slice(0, 6).forEach(keep);
out('awards.sample.json', [...pick].sort((a, b) => a - b).map(i => awards[i]));

// ---- plan: two snapshots of the same projects ----
const KEYS = new Set([
  'CUNY|ACECUN211', 'CUNY|ACECUN212',   // spend grew between snapshots
  'CUNY|ACECUN213',                     // spend fell (floored at zero)
  'ACS|CROSSBH',                        // new entrant in the later snapshot
  'CUNY|BX024-011',                     // excluded in the later snapshot, spend grew (D2)
  'CUNY|CA055QB17',                     // the one 'land purchase' project (D1)
  'DEP|C540', 'DEP|CS-GC-SFS', 'NYPD|PO79BMALC',   // three phases on one project
  'DDC|HH112PJFC'                       // cancelled row + active row
]);
const cur = rd('data/plan-latest.json').filter(r => KEYS.has(P.projectKey(r)));
const prevAll = JSON.parse(execSync('git show 3a4a959:data/plan-latest.json', { cwd: ROOT, maxBuffer: 64 << 20 }).toString());
const prev = prevAll.filter(r => KEYS.has(P.projectKey(r)));
out('plan.sample.json', { note: 'real rows; later = data/plan-latest.json at b2bb90d, earlier = revision 3a4a959 of the same file', earlier: prev, later: cur });

// ---- checkbook meta + three vendor groups ----
const v = rd('data/checkbook-vendors.json');
const vk = Object.keys(v.vendors).slice(0, 3);
out('checkbook-vendors.sample.json', { meta: v.meta, vendors: Object.fromEntries(vk.map(k => [k, v.vendors[k]])) });

// ---- contracts: three with curves, two without ----
const cs = rd('data/contract-search.json');
const withC = cs.contracts.filter(c => Array.isArray(c.monthly_cumulative) && c.monthly_cumulative.length).slice(0, 3);
const noC = cs.contracts.filter(c => !c.monthly_cumulative || !c.monthly_cumulative.length).slice(0, 2);
const fallback = cs.contracts.filter(c => !(+c.current_amount > 0) && +c.original_amount > 0).slice(0, 1);
out('contract-search.sample.json', { meta: { generated: cs.meta.generated, as_of: cs.meta.as_of,
  fiscal_years: cs.meta.fiscal_years, fiscal_year_ytd: cs.meta.fiscal_year_ytd, fiscal_years_closed: cs.meta.fiscal_years_closed },
  contracts: [...withC, ...noC, ...fallback] });

console.log('fixtures cut:', pick.size, 'award rows;', prev.length, '+', cur.length, 'plan rows;', vk.length, 'vendors');
