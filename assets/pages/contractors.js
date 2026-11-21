(function(){
'use strict';
const API = 'https://data.cityofnewyork.us/resource/qyyg-4tf5.json';
const TOKEN = '3TAzQQPiSG2T4WGWfYYUxxqfJ';
const HARD = 'Construction/Construction Services';
const COLOR_A = '#a8462c', COLOR_B = '#243b53', GRID = '#e6ddd5';
// NY State open data (data.ny.gov), already in the page CSP connect-src. These
// carry the awarded CONTRACTOR NAME on MTA and State construction work, which the
// City datasets cannot. MTA Procurements (twsw-2mqa) and the SUNY Construction
// Fund contracts (cfjm-ii27) both filter to the same construction procurement type.
const NY_API = 'https://data.ny.gov/resource';
const MTA_DS = 'twsw-2mqa', SUCF_DS = 'cfjm-ii27';
const NY_CONSTR = 'Design and Construction/Maintenance';

Chart.defaults.font.family = "'IBM Plex Mono',monospace";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#6b5e56';
Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor:'#fefbf8', titleColor:'#201611', bodyColor:'#6b5e56',
  borderColor:'#201611', borderWidth:1, cornerRadius:2, padding:10, displayColors:false,
  titleFont:{family:"'Public Sans',sans-serif",weight:'600',size:12}, bodyFont:{family:"'IBM Plex Mono',monospace",size:12},
  caretSize:5
});
let charts = {};
function destroy(k){ if(charts[k]){ charts[k].destroy(); delete charts[k]; } }

async function getJSON(params){
  const res = await fetch(API + '?' + new URLSearchParams(params), { headers: { 'X-App-Token': '3TAzQQPiSG2T4WGWfYYUxxqfJ' } });
  if(!res.ok) throw new Error('API ' + res.status);
  return res.json();
}
// data.ny.gov fetch (same Socrata app token works on both portals).
async function getNY(ds, params){
  const res = await fetch(NY_API + '/' + ds + '.json?' + new URLSearchParams(params), { headers: { 'X-App-Token': '3TAzQQPiSG2T4WGWfYYUxxqfJ' } });
  if(!res.ok) throw new Error('NY ' + res.status);
  return res.json();
}
// PARIS re-reporting dedup: the State data re-reports every active contract each
// fiscal year (cumulative spend grows) and sometimes duplicates a contract within
// a year. Collapse to ONE record per contract: keep the latest fiscal year, then
// tie-break by max paid, then max amount. Summing raw rows would multi-count.
function dedupContracts(rows, getKey, getFy, getAmt, getPaid){
  const best = new Map(); let u = 0;
  for(const r of rows){
    const ck = (getKey(r) || '').trim() || ('__' + (u++));
    const fy = getFy(r) || '';
    const amt = parseFloat(getAmt(r)) || 0;
    const paid = parseFloat(getPaid(r)) || 0;
    const cur = best.get(ck);
    if(!cur || fy > cur.fy ||
       (fy === cur.fy && (paid > cur.paid || (paid === cur.paid && amt > cur.amt)))){
      best.set(ck, { fy, amt, paid });
    }
  }
  let registered = 0, paid = 0;
  for(const e of best.values()){ registered += e.amt; paid += e.paid; }
  return { contracts: best.size, registered, paid };
}
// Fetch MTA + SUNY-CF construction rows matching the same vendor clause as the
// City search, attribute each row to its parent group exactly via groupKeyFor(),
// dedupe per contract, and return a Map of groupKey -> {mta, sucf} aggregates.
async function buildNYWork(vendorClause){
  const out = new Map();
  const [mta, sucf] = await Promise.all([
    getNY(MTA_DS, {
      '$select':'vendor_name,transaction_number,fiscal_year_end_date,contract_amount,amount_expended_to_date',
      '$where':`type_of_procurement='${NY_CONSTR}' AND ${vendorClause}`, '$limit':'10000'
    }).catch(()=>[]),
    getNY(SUCF_DS, {
      '$select':'vendor_name,contract_number,contract_amount,expended_amount_ltd',
      '$where':`procurement_type='${NY_CONSTR}' AND ${vendorClause}`, '$limit':'10000'
    }).catch(()=>[])
  ]);
  const bucket = (rows) => { const m = new Map(); for(const r of rows){ const g = groupKeyFor(r.vendor_name); if(!m.has(g)) m.set(g, []); m.get(g).push(r); } return m; };
  const mtaByG = bucket(mta), sucfByG = bucket(sucf);
  const keys = new Set([...mtaByG.keys(), ...sucfByG.keys()]);
  for(const g of keys){
    const m = dedupContracts(mtaByG.get(g)||[], r=>r.transaction_number, r=>r.fiscal_year_end_date, r=>r.contract_amount, r=>r.amount_expended_to_date);
    const s = dedupContracts(sucfByG.get(g)||[], r=>r.contract_number, r=>'', r=>r.contract_amount, r=>r.expended_amount_ltd);
    out.set(g, { mta:m, sucf:s });
  }
  return out;
}
function fmtMoney(v){ return ci.fmt(v, 'money-b2'); }
/* Null-guarded, matching the market block's own copy of this helper. Every
   current caller passes a count, so the guard changes nothing today; it exists
   so a future caller with a missing count renders 0 instead of throwing and
   taking the whole profile render down with it. */
function fmtInt(v){ return ci.fmt(v, 'int0'); }
function fmtDate(d){ return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function esc(s){ const d=document.createElement('div'); d.textContent=String(s==null?'':s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); return d.innerHTML; }
function cleanName(s){ return String(s==null?'':s).replace(/\s*[\?�]\s*/g,' / ').replace(/\s{2,}/g,' ').trim(); }
function escName(s){ return esc(cleanName(s)); }
function csvCell(v){ const s=(v==null?'':String(v)); return '"'+s.replace(/"/g,'""')+'"'; }
function slugify(s){ return (s||'vendor').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'vendor'; }
function downloadCSV(text, filename){
  const blob = new Blob([text], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 0);
}
function exportVendorCSV(){
  const grp = state.groups.get(state.active);
  if(!grp) return;
  const rows = grp.rows;
  const all = rows.reduce((a,r)=>a+r.amount,0);
  const cbk = checkbook.loaded ? checkbook.vendors[normName(grp.key)] : null;
  const lines = [];
  lines.push(['Vendor group', grp.key].map(csvCell).join(','));
  lines.push(['Measure','Value (USD)'].map(csvCell).join(','));
  lines.push(['Award-notice value (City Record)', Math.round(all)].map(csvCell).join(','));
  lines.push(['Registered (Checkbook)', cbk ? Math.round(cbk.registered) : 'no match'].map(csvCell).join(','));
  lines.push(['Paid to date (Checkbook)', cbk ? Math.round(cbk.paid) : 'no match'].map(csvCell).join(','));
  lines.push('');
  lines.push(['Date','Award','Agency','Vendor (as published)','Category','Selection method','Amount (USD)'].map(csvCell).join(','));
  rows.forEach(r => {
    lines.push([
      r.day, r.title, r.agency, r.vendor,
      r.cat==='hard'?'Construction':'Related services',
      r.method, Math.round(r.amount)
    ].map(csvCell).join(','));
  });
  downloadCSV(lines.join('\r\n'), 'concrete-index-' + slugify(grp.key) + '.csv');
}
/* Same calendar day n months back, UTC-anchored, with the day clamped to the
   length of the target month so the end of a long month does not roll forward
   into the next one. Used only as a widened fetch margin, never as a window. */
function isoMonthsAgo(n){
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m - n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - n, Math.min(now.getUTCDate(), lastDay)))
    .toISOString().slice(0,10);
}
/* Lower bound of a rolling window of n calendar days ending on, and including,
   the current UTC day: isoWindowStart(365) is today plus the 364 days before it.
   It replaces a threshold instant of Date.now() - n*864e5, which landed mid-day
   on the oldest day and so admitted exactly this same set of day-stamped rows,
   but landed at a different instant for every reader. */
function isoWindowStart(days){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)))
    .toISOString().slice(0,10);
}
/* Canonical trailing twelve months for the whole site: twelve FULLY-ELAPSED
   months. isoCompleteMonthBoundary(0) is the first day of the current,
   incomplete month, so [isoCompleteMonthBoundary(12), isoCompleteMonthBoundary(0))
   never reads the partial month in progress. Same rule the funnel, the Briefing,
   and the Analysis index use, so the pages cannot disagree on one window.

   Anchored in UTC end to end. A local midnight formatted through toISOString
   reads back a day early for anyone east of UTC, which moved the whole trailing
   window and made the same page report different totals in Berlin than in New
   York. Date.UTC in, toISOString out, so every reader gets one window.

   It returns a day STRING, and the row side of every comparison is the raw
   start_date prefix, so the window is decided string-on-string and never by
   comparing a UTC-anchored boundary against a locally-parsed row date. */
function isoCompleteMonthBoundary(n){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1))
    .toISOString().slice(0,10);
}
/* Same $500M megaproject floor the market-structure section below uses. */
const MEGA_FLOOR = 500000000;
function isContinuation(m){ return /renewal|extension/i.test(m||''); }
function median(a){ if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
/* Whole months between a published day ('YYYY-MM-DD') and the current month,
   both read in UTC so the answer does not depend on the reader's location. */
function monthsSince(day){
  const n = new Date();
  return (n.getUTCFullYear() - +String(day).slice(0,4)) * 12
       + (n.getUTCMonth() + 1 - +String(day).slice(5,7));
}

function normName(s){
  return (s||'')
    .trim()
    .replace(/\s+/g,' ')
    .toUpperCase()
    .replace(/[.,]/g,'')
    .replace(/[;:&/\\'"`\-\s]+$/,'')
    .trim()
    .replace(/\s+/g,' ');
}

const alias = {
  loaded: false,
  variantToParent: new Map(),
  parentVariants: new Map(),
  groups: []
};

async function loadAliases(){
  try{
    const res = await fetch('/data/vendor-aliases.json');
    if(!res.ok) throw new Error('aliases ' + res.status);
    const raw = await res.json();
    raw.forEach(g => {
      const seen = new Set();
      const norm = [];
      g.variants.forEach(v => {
        const nv = normName(v);
        if(!nv || seen.has(nv)) return;
        seen.add(nv);
        norm.push(nv);
        alias.variantToParent.set(nv, g.parent);
      });
      alias.parentVariants.set(g.parent, norm);
      alias.groups.push({ parent: g.parent, variants: norm });
    });
    alias.loaded = true;
  }catch(e){ /* page still works ungrouped if aliases fail to load */ }
}

const checkbook = { loaded: false, meta: null, vendors: {} };
async function loadCheckbook(){
  try{
    const res = await fetch('/data/checkbook-vendors.json');
    if(!res.ok) throw new Error('checkbook ' + res.status);
    const d = await res.json();
    checkbook.meta = d.meta || null;
    checkbook.vendors = d.vendors || {};
    checkbook.loaded = true;
  }catch(e){ /* page still works without the Checkbook block */ }
}

function groupKeyFor(vendorName){
  const p = alias.variantToParent.get(normName(vendorName));
  return p || (vendorName||'').trim();
}

const state = { rows: [], groups: new Map(), active: '' };

/* Top twelve awardees, on exactly the universe the market-structure section
   below reads: twelve fully-elapsed months, one record per pin (max amount),
   renewal and extension notices held out, and single awards of $500M or more
   excluded. The old server-side sum did none of that, so the list was led by a
   megaproject the analysis underneath it never counts, and it double-counted
   procurements published as several notices. Twelve months of construction
   awards is a few hundred rows, so the rows come back in one request and are
   deduped in the browser with the site's canonical rule. */
async function loadStarter(){
  const lo = isoCompleteMonthBoundary(12);
  const hi = isoCompleteMonthBoundary(0);
  const rows = await getJSON({
    '$select':'pin,vendor_name,contract_amount,start_date,selection_method_description',
    '$where':`starts_with(category_description,'Construction') AND contract_amount>0 AND contract_amount<${MEGA_FLOOR} AND start_date>='${lo}' AND start_date<'${hi}'`,
    '$order':'pin','$limit':'50000'
  });
  const byPin = new Map();
  rows.forEach((r, i) => {
    const amt = parseFloat(r.contract_amount);
    if(!(amt > 0) || amt >= MEGA_FLOOR) return;
    if(isContinuation(r.selection_method_description)) return;
    const pin = r.pin || ('_np_' + i);   // stable surrogate: an unpinned notice stands alone
    const prev = byPin.get(pin);
    if(!prev || amt > prev.amt) byPin.set(pin, { amt, name: (r.vendor_name || '').trim() });
  });
  const byVendor = new Map();
  byPin.forEach(rec => {
    if(!rec.name) return;
    const v = byVendor.get(rec.name) || { s: 0, n: 0 };
    v.s += rec.amt; v.n += 1;
    byVendor.set(rec.name, v);
  });
  const top = [...byVendor.entries()]
    .sort((a, b) => (b[1].s - a[1].s) || a[0].localeCompare(b[0]))   // deterministic on ties
    .slice(0, 12);
  document.getElementById('starter-list').innerHTML = top.map(([name, v]) =>
    `<button data-action="run-search" data-q="${ci.esc(name)}">${escName(name)}<span class="v-amt">${fmtMoney(v.s)} · ${fmtInt(v.n)} award${v.n===1?'':'s'}, TTM</span></button>`
  ).join('');
}

function soqlLit(s){ return (s||'').replace(/'/g, "''").replace(/[%_]/g, ''); }

async function runSearch(q){
  q = (q||'').trim();
  ci.banner(document.getElementById('lookup-banner'), null);
  if(q.length < 3){
    // Invalid input: say so at the field; nothing is sent.
    ci.invalid(document.getElementById('q'), 'Enter at least 3 characters of the contractor name.');
    return;
  }
  document.getElementById('q').value = q;
  document.getElementById('starter').style.display = 'none';
  document.getElementById('profile').style.display = 'none';
  document.getElementById('noresults').style.display = 'none';
  document.getElementById('vloader').style.display = 'block';

  const ql = q.toLowerCase();
  const safe = soqlLit(q);

  const matchedVariants = new Set();
  alias.groups.forEach(g => {
    const hit = g.parent.toLowerCase().includes(ql) ||
                g.variants.some(v => v.toLowerCase().includes(ql));
    if(hit) g.variants.forEach(v => matchedVariants.add(v));
  });

  const likeOf = v => v.replace(/'/g,"''").replace(/\s+/g,'%') + '%';
  const clauses = [`upper(vendor_name) like upper('%${safe}%')`];
  for(const v of matchedVariants){
    clauses.push(`upper(vendor_name) like upper('${likeOf(v)}')`);
  }
  const vendorClause = `(${clauses.join(' OR ')})`;
  const where = `starts_with(category_description,'Construction') AND contract_amount>0 AND ${vendorClause}`;

  let rows = [], failed = false;
  try{
    rows = await getJSON({
      '$select':'start_date,agency_name,category_description,selection_method_description,short_title,vendor_name,contract_amount',
      '$where':where,
      '$order':'start_date DESC','$limit':'5000'
    });
  }catch(e){ rows = []; failed = true; }

  state.rows = rows.map(r => ({
    // date is for display only, through fmtDate. Every window decision and the
    // CSV export read `day`, the raw published prefix, so neither depends on how
    // the browser chose to parse the timestamp or on where the reader is.
    date: new Date(r.start_date),
    day: (r.start_date || '').slice(0,10),
    year: r.start_date.slice(0,4),
    agency: r.agency_name || '(unspecified)',
    cat: r.category_description === HARD ? 'hard' : 'rel',
    method: r.selection_method_description || '',
    title: r.short_title || '(untitled)',
    vendor: (r.vendor_name || '').trim(),
    amount: parseFloat(r.contract_amount) || 0,
    gkey: groupKeyFor(r.vendor_name)
  }));

  state.groups = new Map();
  for(const r of state.rows){
    let g = state.groups.get(r.gkey);
    if(!g){
      g = { key:r.gkey, isParent:alias.parentVariants.has(r.gkey), total:0, n:0, rows:[] };
      state.groups.set(r.gkey, g);
    }
    g.total += r.amount; g.n += 1; g.rows.push(r);
  }

  let nyMap = new Map();
  try{ nyMap = await buildNYWork(vendorClause); }catch(e){ nyMap = new Map(); }
  for(const [g, ny] of nyMap){
    if(!(ny.mta.contracts || ny.sucf.contracts)) continue;
    let grp = state.groups.get(g);
    if(!grp){ grp = { key:g, isParent:alias.parentVariants.has(g), total:0, n:0, rows:[], nyOnly:true }; state.groups.set(g, grp); }
    grp.ny = ny;
  }

  document.getElementById('vloader').style.display = 'none';
  if(!state.groups.size){
    if(failed){
      // The award query itself failed: that is not the same as no awards.
      ci.banner(document.getElementById('lookup-banner'), { alert: true,
        title: 'Couldn’t reach NYC Open Data.',
        text: 'The award search for “' + q + '” did not run, so no award record is shown. The market view below is unaffected.',
        retry: () => runSearch(q) });
      return;
    }
    document.getElementById('noresults').style.display = 'block';
    ci.alert(document.getElementById('noresults').textContent);
    return;
  }

  const sorted = [...state.groups.values()].sort((a,b)=>groupRank(b)-groupRank(a));
  state.active = sorted[0].key;

  renderGroupPicker();
  // Unhide #profile BEFORE building its charts. Chart.js measures the canvas
  // at construction time; building the charts while the container is still
  // display:none gives them a 0x0 box that a later .resize() does not
  // recover from, so the profile's two charts rendered permanently blank on
  // every cold deep link and in-page search. Reveal first, then draw.
  document.getElementById('profile').style.display = 'block';
  renderProfile();
}
function groupRank(g){
  if(g.total > 0) return g.total;
  if(g.ny) return (g.ny.mta.registered || 0) + (g.ny.sucf.registered || 0);
  return 0;
}

function renderGroupPicker(){
  const el = document.getElementById('chips');
  const groups = [...state.groups.values()].sort((a,b)=>groupRank(b)-groupRank(a));
  if(groups.length <= 1){ el.innerHTML = ''; return; }
  el.innerHTML = groups.map(g =>
    `<button class="chip ${g.key===state.active?'on':''}" data-action="select-group" data-key="${ci.esc(g.key)}">${escName(g.key)} · ${fmtMoney(groupRank(g))}${g.total<=0&&g.ny?' MTA/State':''}</button>`
  ).join('');
}
function selectGroup(key){
  if(!state.groups.has(key)) return;
  state.active = key;
  renderGroupPicker();
  renderProfile();
}

function cbkWindowPhrase(){
  const m = checkbook.meta || {};
  const ys = Array.isArray(m.fiscal_years) ? m.fiscal_years.map(Number).filter(isFinite) : [];
  if(!ys.length) return 'Checkbook’s published coverage window';
  const ytd = (m.fiscal_year_ytd != null && ys.indexOf(+m.fiscal_year_ytd) !== -1) ? +m.fiscal_year_ytd : null;
  const closed = ys.filter(y => y !== ytd);
  let p = closed.length === 1 ? ('fiscal year ' + closed[0])
        : closed.length > 1 ? ('fiscal years ' + closed[0] + ' to ' + closed[closed.length-1]) : '';
  if(ytd !== null) p = p ? (p + ' plus fiscal year ' + ytd + ' to date') : ('fiscal year ' + ytd + ' to date');
  return 'Checkbook’s published coverage window (currently ' + p + ')';
}
/* Short fiscal-year label for the Checkbook window, e.g. "FY21–26 + FY27 YTD",
   built from the vendor file's meta the same way tools/build-flow.js labels it. */
function cbkFYShort(){
  const m = checkbook.meta || {};
  const ys = Array.isArray(m.fiscal_years) ? m.fiscal_years.map(Number).filter(isFinite).sort((a,b)=>a-b) : [];
  if(!ys.length) return '';
  const ytd = (m.fiscal_year_ytd != null && ys.indexOf(+m.fiscal_year_ytd) !== -1) ? +m.fiscal_year_ytd : null;
  const closed = ys.filter(y => y !== ytd);
  const yy = n => String(n % 100).padStart(2, '0');
  const parts = [];
  if(closed.length) parts.push(closed.length > 1 ? ('FY' + yy(closed[0]) + '–' + yy(closed[closed.length-1])) : ('FY' + yy(closed[0])));
  if(ytd !== null) parts.push('FY' + yy(ytd) + ' YTD');
  return parts.join(' + ');
}
function cbkAsOf(){
  const g = checkbook.meta && checkbook.meta.generated ? checkbook.meta.generated : null;
  if(!g) return '';
  const d = new Date(g);
  if(isNaN(d)) return '';
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

function renderCheckbook(grp, awardNotice){
  const strip = document.getElementById('cbk-strip');
  const note = document.getElementById('cbk-note');
  const asof = document.getElementById('cbk-asof');
  const cbk = checkbook.loaded ? checkbook.vendors[normName(grp.key)] : null;

  if(asof){
    const a = cbkAsOf();
    asof.textContent = a ? ('Checkbook figures as of ' + a) : '';
    asof.style.display = a ? '' : 'none';
  }

  const disclosure = 'Registered, paid to date, and the award-notice value are '
    + 'three different measures and are never added together. Checkbook coverage '
    + 'is New York City entities only, so work let by the MTA, the Port Authority, '
    + 'or New York State is out of scope here. Names are matched to the award '
    + 'record exactly after normalization, so a firm with no exact match shows no '
    + 'Checkbook figure rather than a guess. Checkbook figures refresh nightly.';

  if(!cbk){
    strip.innerHTML = `<div class="rd"><div class="rd-label">Award-notice value</div>`
      + `<div class="rd-value">${fmtMoney(awardNotice)}</div>`
      + `<div class="rd-note">Total of the amounts stated in this group's award notices in the City Record. This is the award-side measure already shown above.</div></div>`
      + `<div class="rd"><div class="rd-label">Registered (Checkbook)</div>`
      + `<div class="rd-value">–</div>`
      + `<div class="rd-note">No Checkbook match for this group. Either there is no exact name match after normalization, or this firm's City-registered construction work falls outside ${esc(cbkWindowPhrase())}.</div></div>`
      + `<div class="rd"><div class="rd-label">Paid to date (Checkbook)</div>`
      + `<div class="rd-value">–</div>`
      + `<div class="rd-note">Shown only when a Checkbook match exists.</div></div>`;
    note.textContent = disclosure;
    return;
  }

  const span = (cbk.fy_first && cbk.fy_last)
    ? (cbk.fy_first === cbk.fy_last ? ('FY' + cbk.fy_first) : ('FY' + cbk.fy_first + '–FY' + cbk.fy_last))
    : '';
  const agencyTxt = (typeof cbk.agencies === 'number' && cbk.agencies > 0)
    ? (cbk.agencies + ' City ' + (cbk.agencies === 1 ? 'agency' : 'agencies')) : '';

  strip.innerHTML =
      `<div class="rd"><div class="rd-label">Award-notice value</div>`
    + `<div class="rd-value">${fmtMoney(awardNotice)}</div>`
    + `<div class="rd-note">Total of the amounts stated in this group's award notices in the City Record. The award-side measure shown above.</div></div>`
    + `<div class="rd flag"><div class="rd-label">Registered (Checkbook)</div>`
    + `<div class="rd-value">${fmtMoney(cbk.registered)}</div>`
    + `<div class="rd-note">Value of this group's contracts registered with the Comptroller${span?(', '+span):''}${agencyTxt?(', across '+agencyTxt):''}. A separate measure from the award notice, not a sum of it.</div></div>`
    + `<div class="rd flag"><div class="rd-label">Paid to date (Checkbook)</div>`
    + `<div class="rd-value">${fmtMoney(cbk.paid)}</div>`
    + `<div class="rd-note">Amount the City has disbursed against those registered contracts so far. Lower than registered while work is in progress.</div>`
    + `<p class="vendor-note">Cumulative City payments${cbkFYShort() ? (' ' + esc(cbkFYShort())) : ''}. Not percent complete, not a financial statement.</p></div>`;
  note.textContent = disclosure;
}

function renderReadStrip(rows, agSorted, all){
  const el = document.getElementById('readstrip');
  const cells = [];

  const newRows = rows.filter(r => !isContinuation(r.method));
  // UTC year against the raw start_date prefix, so "this year" does not flip a
  // day early or a day late depending on where the page is open.
  const thisYear = String(new Date().getUTCFullYear());
  const since3 = isoMonthsAgo(36);
  const amtsAll = newRows.map(r=>r.amount);
  const largestAll = amtsAll.length ? Math.max(...amtsAll) : 0;
  const largestYr = Math.max(0, ...newRows.filter(r=>r.year===thisYear).map(r=>r.amount));
  const med3arr = newRows.filter(r=>r.day>=since3).map(r=>r.amount);
  let creepCell;
  if(med3arr.length >= 5 && largestYr > 0){
    const med3 = median(med3arr);
    const ratio = med3 > 0 ? largestYr/med3 : 0;
    const flag = ratio >= 2;
    creepCell = `<div class="rd ${flag?'flag':''}"><div class="rd-label">Job-size step-up</div>
      <div class="rd-value">${ratio.toFixed(1)}×</div>
      <div class="rd-note">Largest new award this year (${fmtMoney(largestYr)}) versus the trailing-3-year median new award (${fmtMoney(med3)}). A ratio above 2 means this year's largest job is more than double the recent median. That is a change in job size, not a judgment about the firm.</div></div>`;
  } else {
    creepCell = `<div class="rd"><div class="rd-label">Job-size step-up</div>
      <div class="rd-value">${largestAll? fmtMoney(largestAll):'–'}</div>
      <div class="rd-note">Largest single new award on record. Trailing-3-year sample is under 5 awards, so a step-up ratio is not shown.</div></div>`;
  }
  cells.push(creepCell);

  const top1 = all>0 ? agSorted[0][1]/all : 0;
  const top3 = all>0 ? agSorted.slice(0,3).reduce((a,x)=>a+x[1],0)/all : 0;
  const conc = top1 > 0.6 || top3 > 0.85;
  cells.push(`<div class="rd ${conc?'flag':''}"><div class="rd-label">Agency concentration</div>
    <div class="rd-value">${(top1*100).toFixed(0)}% · ${(top3*100).toFixed(0)}%</div>
    <div class="rd-note">Top agency and top-3 share of awarded value. Concentrated demand sits behind one payment cycle and one funding stream, a structural feature of the agency, not a judgment about the vendor.</div></div>`);

  const w12 = isoWindowStart(365), w24 = isoWindowStart(730);
  const t12 = newRows.filter(r=>r.day>=w12).length;
  const t24 = newRows.filter(r=>r.day>=w24).length;
  const last = rows.reduce((a,r)=> r.day>a?r.day:a, rows[0].day);
  const ms = monthsSince(last);
  const stale = ms >= 18;
  cells.push(`<div class="rd ${stale?'flag':''}"><div class="rd-label">Award cadence</div>
    <div class="rd-value">${t12} · ${t24}</div>
    <div class="rd-note">New award notices in the trailing 12 and 24 months, renewals and extensions excluded. Last appeared in the City Record as a winner, on either basis, ${ms===0?'this month':ms+' month'+(ms===1?'':'s')+' ago'}. Tracks award notices, not work in progress or firm status.</div></div>`);

  el.innerHTML = cells.join('');
}

function renderProfile(){
  const grp = state.groups.get(state.active);
  if(!grp) return;
  const rows = grp.rows;
  const hasCity = rows.length > 0;

  const show = (id, on) => { const e = document.getElementById(id); if(e) e.style.display = on ? '' : 'none'; };
  show('city-kpis', hasCity);
  show('city-readcard', hasCity);
  show('cbk-section', hasCity);
  show('city-charts', hasCity);
  show('city-recent', hasCity);
  const cityEmpty = document.getElementById('city-empty');
  if(cityEmpty){
    cityEmpty.style.display = hasCity ? 'none' : '';
    if(!hasCity) cityEmpty.textContent = 'No NYC City Record construction awards under this name. The public construction work below was let by the MTA or New York State, which is reported on a separate ledger.';
  }

  const gh = document.getElementById('grouphead');
  if(grp.isParent && hasCity){
    const distinct = new Set(rows.map(r=>normName(r.vendor))).size;
    gh.innerHTML = `<h2>${escName(grp.key)}</h2><span class="gp">Grouped</span>`
      + `<span class="gn">${distinct} name${distinct===1?'':'s'} rolled up</span>`;
  } else if(!hasCity){
    gh.innerHTML = `<h2>${escName(grp.key)}</h2><span class="gp">MTA / State</span>`;
  } else {
    gh.innerHTML = `<h2>${escName(grp.key)}</h2>`;
  }

  if(hasCity){
    // Canonical trailing twelve: twelve fully-elapsed months, partial month
    // excluded. Decided on day strings, the same bounds the starter query sends
    // to Socrata, so the browser filter and the server filter cannot diverge.
    const ttmStart = isoCompleteMonthBoundary(12), ttmEnd = isoCompleteMonthBoundary(0);
    const all = rows.reduce((a,r)=>a+r.amount,0);
    const ttm = rows.filter(r=>r.day>=ttmStart && r.day<ttmEnd).reduce((a,r)=>a+r.amount,0);
    document.getElementById('kpi-all').textContent = fmtMoney(all);
    document.getElementById('kpi-ttm').textContent = fmtMoney(ttm);
    document.getElementById('kpi-n').textContent = fmtInt(rows.length);
    document.getElementById('kpi-n-note').textContent = 'award notices in the record';
    const byAg = new Map();
    for(const r of rows) byAg.set(r.agency, (byAg.get(r.agency)||0)+r.amount);
    const agSorted = [...byAg.entries()].sort((a,b)=>b[1]-a[1]);
    document.getElementById('kpi-ag').textContent = agSorted[0][0];
    document.getElementById('kpi-ag-note').textContent = all>0 ? (agSorted[0][1]/all*100).toFixed(0)+'% of awarded value' : '';

    renderReadStrip(rows, agSorted, all);
    renderCheckbook(grp, all);

    const byYear = new Map();
    for(const r of rows) byYear.set(r.year, (byYear.get(r.year)||0)+r.amount);
    const years = [...byYear.keys()].sort();
    destroy('year');
    charts.year = new Chart(document.getElementById('chart-year'), {
      type:'bar',
      data:{ labels: years, datasets:[{ data: years.map(y=>byYear.get(y)), backgroundColor: COLOR_A, borderRadius:1 }]},
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>fmtMoney(c.parsed.y)}} },
        scales:{ x:{grid:{display:false}, ticks:{maxRotation:0, autoSkip:true, maxTicksLimit:10}},
                 y:{grid:{color:GRID}, border:{display:false}, ticks:{callback:v=>fmtMoney(v), maxTicksLimit:5}} } }
    });
    destroy('agency');
    const agTop = agSorted.slice(0,6);
    charts.agency = new Chart(document.getElementById('chart-agency'), {
      type:'bar',
      data:{ labels: agTop.map(a=>a[0]), datasets:[{ data: agTop.map(a=>a[1]), backgroundColor: COLOR_B, borderRadius:1, barThickness:18 }]},
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>fmtMoney(c.parsed.x)}} },
        scales:{ x:{grid:{color:GRID}, border:{display:false}, ticks:{callback:v=>fmtMoney(v), maxTicksLimit:5}},
                 y:{grid:{display:false}, ticks:{autoSkip:false, font:{family:"'Public Sans',sans-serif",size:12.5}}} } }
    });
    document.getElementById('recent-sub').textContent = 'Latest ' + Math.min(15, rows.length) + ' of ' + fmtInt(rows.length) + ' award notices';
    document.querySelector('#tbl-recent tbody').innerHTML = rows.slice(0,15).map(r=>`<tr>
      <td class="mono u-nowrap">${fmtDate(r.date)}</td>
      <td><div class="t-title">${esc(r.title)}</div>
          <div class="t-sub">${escName(r.vendor)} · ${esc(r.method)} · <span class="pill ${r.cat}">${r.cat==='hard'?'Construction':'Related services'}</span></div></td>
      <td>${esc(r.agency)}</td>
      <td class="num amt">${fmtMoney(r.amount)}</td>
    </tr>`).join('');

    renderMembers(grp, rows);
  } else {
    destroy('year'); destroy('agency');
  }

  renderNYWork(grp);
}

function renderNYWork(grp){
  const sec = document.getElementById('ny-section');
  const ny = grp.ny;
  if(!ny || !(ny.mta.contracts || ny.sucf.contracts)){ if(sec) sec.style.display='none'; return; }
  sec.style.display = '';
  const m = ny.mta, s = ny.sucf;
  const cardHTML = (label, val, sub) =>
    `<div class="rd flag"><div class="rd-label">${label}</div><div class="rd-value">${val}</div><div class="rd-note">${sub}</div></div>`;
  const cards = [];
  cards.push(cardHTML('MTA registered',
    m.contracts ? fmtMoney(m.registered) : '–',
    m.contracts ? `Across ${fmtInt(m.contracts)} MTA construction contract${m.contracts===1?'':'s'} (data.ny.gov twsw-2mqa), deduped to one record per contract at its latest fiscal-year report.` : 'No MTA construction contracts under this name.'));
  cards.push(cardHTML('MTA paid to date',
    m.contracts ? fmtMoney(m.paid) : '–',
    'Cumulative amount the MTA has expended against those contracts. A separate measure, not summed with the City figures.'));
  if(s.contracts){
    cards.push(cardHTML('State (SUNY CF) paid', fmtMoney(s.paid),
      `Across ${fmtInt(s.contracts)} SUNY Construction Fund contract${s.contracts===1?'':'s'} (cfjm-ii27); registered ${fmtMoney(s.registered)}.`));
  } else {
    cards.push(cardHTML('State (SUNY CF)', '–', 'No SUNY Construction Fund construction contracts under this name.'));
  }
  document.getElementById('ny-strip').innerHTML = cards.join('');
  document.getElementById('ny-note').textContent =
    'MTA and State figures come from New York State open data (data.ny.gov) and are a separate ledger from the City and Checkbook figures above; they are never added to them. Each active contract is re-reported every fiscal year in the State data, so figures are deduped to one record per contract at its latest report. Names are matched to the award record after the same normalization used elsewhere, so a firm with no exact match shows nothing here rather than a guess.';
  const body = document.getElementById('ny-members-body');
  body.innerHTML = [
    m.contracts ? `<tr><td class="mname">MTA Procurements (twsw-2mqa)</td><td class="num">${fmtInt(m.contracts)}</td><td class="num amt">${fmtMoney(m.registered)}</td><td class="num amt">${fmtMoney(m.paid)}</td></tr>` : '',
    s.contracts ? `<tr><td class="mname">SUNY Construction Fund (cfjm-ii27)</td><td class="num">${fmtInt(s.contracts)}</td><td class="num amt">${fmtMoney(s.registered)}</td><td class="num amt">${fmtMoney(s.paid)}</td></tr>` : ''
  ].join('');
  document.getElementById('ny-members-cap').textContent = fmtInt(m.contracts + s.contracts) + ' contract' + ((m.contracts+s.contracts)===1?'':'s');
  document.getElementById('ny-members').style.display = '';
}

function renderMembers(grp, rows){
  const panel = document.getElementById('members');
  const byNorm = new Map();
  for(const r of rows){
    const nk = normName(r.vendor);
    let e = byNorm.get(nk);
    if(!e){ e = { n:0, total:0, spellings:new Map() }; byNorm.set(nk, e); }
    e.n += 1; e.total += r.amount;
    e.spellings.set(r.vendor, (e.spellings.get(r.vendor)||0)+1);
  }
  for(const e of byNorm.values()){
    e.label = [...e.spellings.entries()].sort((a,b)=>b[1]-a[1])[0][0];
  }
  const lines = [...byNorm.values()].sort((a,b)=>b.total-a.total);

  if(!grp.isParent && lines.length <= 1){ panel.style.display='none'; return; }
  panel.style.display = '';
  document.getElementById('members-label').textContent =
    grp.isParent ? 'Names rolled up into this total' : 'Name spellings in this total';
  document.getElementById('members-cap').textContent =
    lines.length + ' name' + (lines.length===1?'':'s') + ' · ' + fmtMoney(grp.total) + ' total';
  document.getElementById('members-body').innerHTML = lines.map(e=>`<tr>
    <td class="mname">${escName(e.label)}</td>
    <td class="num">${fmtInt(e.n)}</td>
    <td class="num amt">${fmtMoney(e.total)}</td>
  </tr>`).join('');
}

document.getElementById('go').addEventListener('click', ()=>runSearch(document.getElementById('q').value));
document.getElementById('q').addEventListener('keydown', e=>{ if(e.key==='Enter') runSearch(e.target.value); });
document.getElementById('csv-link').addEventListener('click', e=>{ e.preventDefault(); exportVendorCSV(); });
(function(){
  let prevOpen = null;
  function before(){ const m=document.getElementById('members'); if(m){ prevOpen=m.open; m.open=true; } }
  function after(){ const m=document.getElementById('members'); if(m && prevOpen!==null){ m.open=prevOpen; } }
  window.addEventListener('beforeprint', before);
  window.addEventListener('afterprint', after);
  if(window.matchMedia){ const mq=window.matchMedia('print'); if(mq.addEventListener) mq.addEventListener('change', e=>{ e.matches?before():after(); }); }
})();

// Expose the two functions the inline onclick handlers call.
window.runSearch = runSearch;
window.selectGroup = selectGroup;
// Buttons built from data carry their argument in a data-* attribute written
// through ci.esc(), never as code; one delegated listener in ci.js calls these.
ci.on('run-search', function(el){ runSearch(el.getAttribute('data-q')); });
ci.on('select-group', function(el){ selectGroup(el.getAttribute('data-key')); });

// Search box as a combobox. Suggestions come from names already on the page
// (the hand-confirmed alias groups and the starter list); nothing is sent
// while typing. Choosing one runs the same search as typing it and pressing
// Enter, so a query returns the same result set either way.
function nameSuggestions(t){
  const ql = t.toLowerCase(), seen = new Set(), out = [];
  const add = (name, hint) => {
    const k = name.toLowerCase();
    if(seen.has(k) || !k.includes(ql)) return;
    seen.add(k); out.push({ label: name, value: name, hint, starts: k.startsWith(ql) });
  };
  alias.groups.forEach(g => add(g.parent, g.variants.length + ' published name' + (g.variants.length===1?'':'s')));
  document.querySelectorAll('#starter-list button[data-q]').forEach(b => add(b.getAttribute('data-q'), 'most awarded, TTM'));
  return out.sort((a, b) => (b.starts - a.starts) || a.label.localeCompare(b.label));
}
ci.combobox(document.getElementById('q'), {
  minChars: 2,
  source: nameSuggestions,
  onSelect: x => runSearch(x.value)
});

(async function init(){
  loadStarter().catch(()=>{});
  await Promise.all([ loadAliases(), loadCheckbook() ]);
  const q = new URLSearchParams(location.search).get('q');
  if(q) runSearch(q);
})();
})();
