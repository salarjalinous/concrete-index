#!/usr/bin/env node
/* tools/build-index-points.js  (Node 20)
 *
 * Adds the Home page's two index comparisons to data/precomputed.json, read off
 * the index series lib/award-core.js computes from the archived awards.json
 * (the Analysis buildIndex rule, the same code test B5 proves against the
 * nightly precompute):
 *
 *   index_prior_level, index_prior_month        the month before index_month
 *   index_year_ago_level, index_year_ago_month  twelve months before index_month
 *
 * The series is computed at the precompute's own instant (meta.generated). Its
 * last point must equal index_level and index_month as published; if it does
 * not, the four fields are written as null and Home falls back to its live
 * read. Levels carry two decimals, like index_level.
 *
 *   node tools/build-index-points.js --data data
 */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('../lib/award-core.js');

const FIELDS = ['index_prior_level', 'index_prior_month', 'index_year_ago_level', 'index_year_ago_month'];

function points(pre, rows){
  const now = pre && pre.meta && pre.meta.generated;
  if(!now) return { ok: false, why: 'precomputed.json has no meta.generated' };
  const p = A.indexPoints(rows, now);
  if(p.current.month !== pre.index_month || p.current.level !== pre.index_level)
    return { ok: false, why: `series ends ${p.current.month} ${p.current.level}, precomputed says ${pre.index_month} ${pre.index_level}` };
  return { ok: true, fields: {
    index_prior_level: p.prior.level, index_prior_month: p.prior.month,
    index_year_ago_level: p.yearAgo.level, index_year_ago_month: p.yearAgo.month } };
}

/* precomputed.json with the four fields placed right after index_month. */
function apply(pre, fields){
  const out = {};
  for(const [k, v] of Object.entries(pre)){
    if(FIELDS.includes(k)) continue;
    out[k] = v;
    if(k === 'index_month') for(const f of FIELDS) out[f] = fields ? fields[f] : null;
  }
  return out;
}

if(require.main === module){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const dir = arg('--data', 'data');
  const file = path.join(dir, 'precomputed.json');
  const pre = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'awards.json'), 'utf8'));
  const r = points(pre, rows);
  if(!r.ok) console.log(`::warning::index points withheld: ${r.why}`);
  const out = apply(pre, r.ok ? r.fields : null);
  fs.writeFileSync(file + '.tmp', JSON.stringify(out));
  fs.renameSync(file + '.tmp', file);
  console.log('index points', r.ok ? JSON.stringify(r.fields) : 'null');
}

module.exports = { points, apply, FIELDS };
