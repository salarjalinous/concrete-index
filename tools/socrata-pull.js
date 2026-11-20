#!/usr/bin/env node
/* tools/socrata-pull.js  (Node 20)
 *
 * Paged, count-checked Socrata pull for the nightly workflows (D4). Writes the
 * output atomically (temp file, then rename) and ONLY after the pulled rows
 * equal the server's count(*) under the same $where. On any failure it exits 1
 * and leaves the existing file untouched, so the repo keeps the last good copy.
 *
 *   node tools/socrata-pull.js --dataset qyyg-4tf5 \
 *     --select "pin,request_id,..." --where "starts_with(category_description,'Construction')" \
 *     --cap 50000 --sort "start_date DESC,request_id" --min 5000 --out data/awards.json
 *
 *   --verify   print count(*) and the pulled length, write nothing
 *   --domain   default data.cityofnewyork.us (data.ny.gov also works)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pagedPull, countRows } = require('../lib/socrata.js');

function args(argv){
  const o = {};
  for(let i = 2; i < argv.length; i++){
    const a = argv[i];
    if(!a.startsWith('--')) continue;
    const k = a.slice(2);
    if(k === 'verify'){ o.verify = true; continue; }
    o[k] = argv[++i];
  }
  return o;
}

function socrataStyle(rows){
  return '[' + rows.map(r => JSON.stringify(r)).join('\n,') + ']\n';
}

async function main(){
  const a = args(process.argv);
  const domain = a.domain || 'data.cityofnewyork.us';
  const cap = Number(a.cap);
  if(!a.dataset || !a.select || !cap) throw new Error('need --dataset, --select, --cap');
  const log = m => console.log(m);
  if(a.verify){
    const n = await countRows({ domain, dataset: a.dataset, where: a.where });
    console.log(`VERIFY ${a.dataset} where=${a.where || '(none)'} count(*)=${n} cap=${cap} headroom=${cap - n}`);
  }
  const { rows, expected } = await pagedPull({ domain, dataset: a.dataset, select: a.select,
    where: a.where, cap, pageSize: Number(a.page || 10000), sort: a.sort || null, log });
  const min = Number(a.min || 0);
  if(rows.length < min) throw new Error(`${a.dataset}: only ${rows.length} rows, expected at least ${min}`);
  if(a.verify){ console.log(`VERIFY ${a.dataset} pulled=${rows.length} expected=${expected} OK`); return; }
  if(!a.out) throw new Error('need --out');
  const tmp = a.out + '.tmp-' + process.pid;
  fs.mkdirSync(path.dirname(a.out), { recursive: true });
  fs.writeFileSync(tmp, socrataStyle(rows));
  fs.renameSync(tmp, a.out);
  console.log(`${a.out}: ${rows.length} rows (count(*) ${expected}, cap ${cap})`);
}

if(require.main === module){
  main().catch(e => { console.error('socrata-pull FAILED: ' + (e && e.message || e)); process.exit(1); });
}
module.exports = { socrataStyle };
