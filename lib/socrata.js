/* lib/socrata.js  (Node 20, server side only)
 *
 * D4: every capped Socrata pull is paged on a unique, stable order ($order=:id)
 * and checked against a server-side count(*) taken with the same $where. If the
 * pulled rows do not equal the count, or the count exceeds the declared cap, the
 * pull throws and the caller writes nothing, so the last good file stays in the
 * repo. A count that moves between the count query and the last page (the
 * dataset is refreshed daily) is retried from scratch, up to `attempts` times.
 *
 * Row order of the returned array is :id ascending unless `sort` is given;
 * `sort` reorders locally (stable, with :id as the final tiebreak) so a file can
 * keep the order it was published in before paging was added.
 */
'use strict';

const DEFAULT_TOKEN = process.env.SOCRATA_APP_TOKEN || '3TAzQQPiSG2T4WGWfYYUxxqfJ';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildUrl(domain, dataset, params){
  const u = new URL(`https://${domain}/resource/${dataset}.json`);
  for(const [k, v] of Object.entries(params)) if(v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}

async function getJSON(url, { token = DEFAULT_TOKEN, retries = 4, fetchImpl = globalThis.fetch } = {}){
  let last;
  for(let a = 0; a <= retries; a++){
    try{
      const res = await fetchImpl(url, { headers: { 'X-App-Token': token, 'Accept': 'application/json' } });
      if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    }catch(e){ last = e; if(a < retries) await sleep(2000 * (a + 1)); }
  }
  throw last;
}

/* count(*) under the same $where */
async function countRows({ domain, dataset, where, token, fetchImpl }){
  const url = buildUrl(domain, dataset, { '$select': 'count(*) AS n', '$where': where });
  const j = await getJSON(url, { token, fetchImpl });
  const n = j && j[0] ? Number(j[0].n ?? j[0].count ?? j[0].count_1) : NaN;
  if(!Number.isFinite(n)) throw new Error(`count(*) returned no number for ${dataset}: ${JSON.stringify(j).slice(0,200)}`);
  return n;
}

/* Compare two Socrata text/number values the way the SoQL $order the file used
   to carry would: ISO dates and text compare as strings. */
function makeComparator(sort){
  const keys = sort.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [field, dir] = s.split(/\s+/);
    return { field, desc: /^desc$/i.test(dir || '') };
  });
  return (a, b) => {
    for(const { field, desc } of keys){
      const x = a[field] == null ? '' : String(a[field]);
      const y = b[field] == null ? '' : String(b[field]);
      if(x < y) return desc ? 1 : -1;
      if(x > y) return desc ? -1 : 1;
    }
    const ia = String(a[':id'] || ''), ib = String(b[':id'] || '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };
}

async function pagedPull({ domain = 'data.cityofnewyork.us', dataset, select, where, cap,
  pageSize = 10000, sort = null, attempts = 3, token, fetchImpl, log = () => {} }){
  if(!dataset || !select || !cap) throw new Error('pagedPull needs dataset, select and cap');
  for(let attempt = 1; attempt <= attempts; attempt++){
    const expected = await countRows({ domain, dataset, where, token, fetchImpl });
    if(expected > cap) throw new Error(`${dataset}: ${expected} rows exceeds the cap of ${cap}; raise the cap deliberately, never truncate`);
    const rows = [];
    for(let offset = 0; ; offset += pageSize){
      const url = buildUrl(domain, dataset, { '$select': ':id,' + select, '$where': where,
        '$order': ':id', '$limit': pageSize, '$offset': offset });
      const batch = await getJSON(url, { token, fetchImpl });
      if(!Array.isArray(batch)) throw new Error(`${dataset}: page at offset ${offset} is not an array`);
      rows.push(...batch);
      if(batch.length < pageSize) break;
      if(rows.length > cap) break;
    }
    const ids = new Set(rows.map(r => r[':id']));
    const okCount = rows.length === expected;
    const okUnique = ids.size === rows.length;
    log(`${dataset}: count(*)=${expected} pulled=${rows.length} unique=${ids.size} attempt=${attempt}`);
    if(okCount && okUnique){
      if(sort) rows.sort(makeComparator(sort));
      for(const r of rows) delete r[':id'];
      return { rows, expected };
    }
    if(attempt === attempts){
      throw new Error(`${dataset}: pulled ${rows.length} rows (${ids.size} unique) but count(*) says ${expected}; refusing to write a partial file`);
    }
    await sleep(5000 * attempt);
  }
}

module.exports = { buildUrl, getJSON, countRows, pagedPull, makeComparator, DEFAULT_TOKEN };
