'use strict';
/* ================= data layer ================= */
const TOKEN = '3TAzQQPiSG2T4WGWfYYUxxqfJ';
const PLAN_API  = 'https://data.cityofnewyork.us/resource/fb86-vt7u.json';
const AWARD_API = 'https://data.cityofnewyork.us/resource/qyyg-4tf5.json';
// City Record award category that means hard construction (bondable work); the
// other Construction-prefixed category is design/CM professional services. Same
// split the Briefing uses, so recipients read the same across the site.
const HARD_CAT = 'Construction/Construction Services';
const COLOR_A = '#a8462c', COLOR_B = '#243b53', GRID = '#e6ddd5';

async function getJSON(api, params){
  const res = await fetch(api + '?' + new URLSearchParams(params), { headers: { 'X-App-Token': '3TAzQQPiSG2T4WGWfYYUxxqfJ' } });
  if(!res.ok) throw new Error('API ' + res.status);
  return res.json();
}

/* ---------- phase normalization (same rules as Pipeline/Velocity) ---------- */
const PHASE_MAP = {
  'pending':'Pending','initiation':'Pending','pre-design':'Pre-Design','predesign':'Pre-Design',
  'design':'Design','construction procurement':'Procurement','construction':'Construction',
  'design build':'Construction','design built':'Construction','close-out':'Close-out','closeout':'Close-out'
};
const EXCLUDED = new Set([
  'completed','cancelled','inactive','on-hold','on hold','transferred',
  'withdrawn','terminated','defaulted','capitally ineligible','expense',
  'defunded','funding withdrawn','rescinded','fmsid changed','project renamed','n/a',
  'land acquisition','property acquisition','land purchase','real estate transaction','fundraising',
  'it project','non capital fund','equipment','consultant services']);
const PHASE_ORDER = ['Pending','Pre-Design','Design','Procurement','Construction','Close-out','Other active'];
function normPhase(raw){
  const p = (raw||'').replace(/[()]/g,'').trim().toLowerCase();
  if(EXCLUDED.has(p)) return 'excluded';
  return PHASE_MAP[p] || 'Other active';
}
function phaseRank(b){
  const i = PHASE_ORDER.indexOf(b);
  return i === -1 ? -1 : (b === 'Other active' ? -1 : i);
}

/* ---------- borough buckets ---------- */
const BOROS = ['Manhattan','Brooklyn','Queens','Bronx','Staten Island'];
const MULTI = 'Citywide / multi-borough / unspecified';

/* Capital-plan borough is a structured field: map onto the five canonical
   boroughs, route Citywide / blank / unrecognized to the explicit bucket. */
function normBorough(raw){
  const s = (raw||'').trim();
  if(BOROS.includes(s)) return s;
  return MULTI;
}

/* Award borough is DERIVED FROM NOTICE TEXT (softest figure). Prefer a CB cue
   in the description, then an explicit borough word in the title; zero, several,
   or a citywide marker route to the explicit bucket. Never splits one award. */
const CB_ABBR = { mn:'Manhattan', man:'Manhattan', bk:'Brooklyn', bklyn:'Brooklyn',
  bx:'Bronx', brx:'Bronx', q:'Queens', qns:'Queens', si:'Staten Island', r:'Staten Island' };
function boroughsInText(t){
  const found = new Set(); const low = (t||'').toLowerCase();
  if(/\bmanhattan\b/.test(low)) found.add('Manhattan');
  if(/\bbrooklyn\b/.test(low)) found.add('Brooklyn');
  if(/\bqueens\b/.test(low)) found.add('Queens');
  if(/\bbronx\b/.test(low)) found.add('Bronx');
  if(/\bstaten island\b/.test(low)) found.add('Staten Island');
  return found;
}
function deriveAwardBorough(shortTitle, descHtml){
  const desc = (descHtml||'').replace(/<[^>]+>/g,' ');
  const both = (shortTitle||'') + ' ' + desc;
  if(/\b(citywide|various locations|all (?:cbs|boroughs|locations)|multiple (?:boroughs|locations))\b/i.test(both)) return MULTI;
  const cbFound = new Set();
  const cbCtx = desc.toLowerCase();
  if(/community board[^a-z]*#?:?\s*|(?:^|[^a-z])cb[^a-z]*:?\s*/.test(cbCtx)){
    boroughsInText(desc).forEach(b=>cbFound.add(b));
    let m; const re = /\bcb[^a-z]*:?\s*([a-z]{1,5})\s*\d/gi;
    while((m = re.exec(desc))){ const ab = CB_ABBR[m[1].toLowerCase()]; if(ab) cbFound.add(ab); }
  }
  if(cbFound.size === 1) return [...cbFound][0];
  if(cbFound.size > 1) return MULTI;
  const titleFound = boroughsInText(shortTitle);
  if(titleFound.size === 1) return [...titleFound][0];
  return MULTI;
}

/* ---------- capital-plan: collapse + per-agency committed ---------- */
function collapsePlan(rows){
  const m = new Map();
  for(const r of rows){
    const key = (r.managing_agency||'') + '|' + (r.fms_id||r.fms_project_name||'');
    const bucket = normPhase(r.current_phase);
    const rec = {
      agency: r.managing_agency || '–',
      spend: Math.max(parseFloat(r.spend_to_date)||0, 0),
      budget: Math.max(parseFloat(r.total_budget)||0, 0),
      borough: normBorough(r.borough),
      category: (r.ten_year_plan_category||'').trim() || 'Uncategorized',
      bucket
    };
    const prev = m.get(key);
    if(!prev || phaseRank(bucket) > phaseRank(prev.bucket)) m.set(key, rec);
  }
  return m;
}
function committedForAgency(planMap, code){
  let total = 0, largest = 0; const byBorough = new Map(), byCategory = new Map(), largestBoro = new Map();
  for(const rec of planMap.values()){
    if(rec.agency !== code) continue;
    if(rec.bucket === 'excluded' || rec.bucket === 'Close-out') continue;
    const unspent = Math.max(rec.budget - rec.spend, 0);
    if(unspent <= 0) continue;
    total += unspent;
    byBorough.set(rec.borough, (byBorough.get(rec.borough)||0) + unspent);
    byCategory.set(rec.category, (byCategory.get(rec.category)||0) + unspent);
    if(unspent > (largestBoro.get(rec.borough)||0)) largestBoro.set(rec.borough, unspent);
    if(unspent > largest) largest = unspent;
  }
  return { total, byBorough, byCategory, largestBoro, largest };
}

/* ---------- award: dedupe + per-agency awarded ---------- */
function dedupeAwards(rows){
  const byPin = new Map();
  for(let i=0;i<rows.length;i++){
    const r = rows[i];
    const amt = parseFloat(r.contract_amount);
    if(!(amt > 0)) continue;
    const pin = r.pin || ('_np_'+i);
    const rec = { amt, vendor: (r.vendor_name||'').trim() || '–',
      hard: (r.category_description||'') === HARD_CAT,
      borough: deriveAwardBorough(r.short_title, r.additional_description_1) };
    const prev = byPin.get(pin);
    if(!prev || rec.amt > prev.amt) byPin.set(pin, rec);
  }
  return [...byPin.values()];
}
function awardedAgg(awards){
  let total = 0, hardTotal = 0, softTotal = 0;
  const byBorough = new Map(), byVendor = new Map(), largestBoro = new Map();
  const byVendorHard = new Map(), byVendorSoft = new Map();
  for(const a of awards){
    total += a.amt;
    byBorough.set(a.borough, (byBorough.get(a.borough)||0) + a.amt);
    byVendor.set(a.vendor, (byVendor.get(a.vendor)||0) + a.amt);
    if(a.hard){ hardTotal += a.amt; byVendorHard.set(a.vendor, (byVendorHard.get(a.vendor)||0) + a.amt); }
    else { softTotal += a.amt; byVendorSoft.set(a.vendor, (byVendorSoft.get(a.vendor)||0) + a.amt); }
    if(a.amt > (largestBoro.get(a.borough)||0)) largestBoro.set(a.borough, a.amt);
  }
  return { total, count: awards.length, byBorough, byVendor, largestBoro,
    byVendorHard, byVendorSoft, hardTotal, softTotal };
}

/* order a byBorough map into five boroughs + explicit bucket last */
function boroughRows(byBorough, largestBoro){
  return BOROS.concat([MULTI]).map(b=>{
    const dollars = byBorough.get(b) || 0;
    const largest = largestBoro ? (largestBoro.get(b)||0) : 0;
    return { borough:b, dollars, concentration: dollars>0 ? largest/dollars : 0 };
  });
}

/* ---------- agency-name reconciliation ---------- */
/* capital-plan code -> City Record agency_name (verified against live distinct
   values on both datasets). Codes absent here have no clean award-side name. */
const CODE_TO_AWARD = {
  DDC:'Design and Construction', DOT:'Transportation', DEP:'Environmental Protection',
  DPR:'Parks and Recreation', DCAS:'Citywide Administrative Services', DSNY:'Sanitation',
  NYPD:'Police Department', HPD:'Housing Preservation and Development', FDNY:'Fire Department',
  DOC:'Correction', DOHMH:'Health and Mental Hygiene', DHS:'Homeless Services',
  ACS:"Administration for Children's Services"
};
const AGENCY_NAMES = {
  DPR:'Parks & Recreation', DDC:'Design & Construction', DOT:'Transportation',
  EDC:'Economic Development', DEP:'Environmental Protection', HHC:'NYC Health + Hospitals',
  DCAS:'Citywide Admin Services', CUNY:'CUNY', NYPD:'Police', FDNY:'Fire',
  DCLA:'Cultural Affairs', DHS:'Homeless Services', DSNY:'Sanitation',
  QPL:'Queens Public Library', DOC:'Correction', DOHMH:'Health & Mental Hygiene',
  BPL:'Brooklyn Public Library', NYPL:'New York Public Library', HRA:'Human Resources Admin',
  DFTA:'Aging', ACS:"Children's Services", DOE:'Education',
  HPD:'Housing Preservation & Dev', OTI:'Technology & Innovation', NYRL:'NY Research Library'
};
/* Agencies whose code carries a small or absent capital-plan footprint because
   another managing agency (chiefly DDC) builds for them: their committed side is
   noted as delivered elsewhere rather than read as a true zero. */
const DELIVERED_VIA_DDC = new Set(['HPD','ACS','DFTA','DOHMH']);
function agencyLabel(code){ return AGENCY_NAMES[code] ? AGENCY_NAMES[code] + ' (' + code + ')' : code; }
/* Display name only (no code), for the selected-agency banner. */
function agencyName(code){ return AGENCY_NAMES[code] || code; }

/* ================= formatting ================= */
function fmtMoney(v){ return ci.fmt(v, 'money'); }
function fmtInt(v){ return v.toLocaleString('en-US'); }
function fmtPct(v){ return ci.fmt(v, 'pct'); }
function esc(s){ const d = document.createElement('div'); d.textContent = String(s==null?'':s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); return d.innerHTML; }
/* First-of-month boundary n complete months before the current (incomplete)
   month. Every award window on the site is twelve FULLY-ELAPSED months: the
   current partial month is excluded so a few days of the month in progress do
   not understate the total. Same rule as the "Funnel" page, the Analysis index
   and the Briefing, which keeps the pages on one window and one number.

   Anchored in UTC end to end. Building the boundary as a local midnight and
   then formatting it with toISOString shifted the date back a full day for any
   reader east of UTC, so the same page served the same instant returned a
   different twelve-month window in Berlin than in New York. Date.UTC in,
   toISOString out, no local field ever touched: every reader gets one window. */
function isoCompleteMonthBoundary(n){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1))
    .toISOString().slice(0,10);
}
const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
function fmtPeriodLong(p){ return ci.fmt(p, 'period-long'); }

/* ================= app state ================= */
const state = {
  latestPeriod: null,
  planMap: null,             // collapsed latest-snapshot plan
  agencyCodes: [],           // capital-plan codes present, ranked by committed
  committedCache: new Map(), // code -> committed agg
  awardCache: new Map(),     // code -> {ok, agg} for awarded side (lazy)
  boroScope: 'committed',
  selected: null
};

/* ================= data fetch ================= */
async function fetchPlan(){
  const ps = await getJSON(PLAN_API, {
    '$select':'reporting_period','$group':'reporting_period','$order':'reporting_period DESC','$limit':'1'
  });
  state.latestPeriod = ps[0].reporting_period;
  const rows = await getJSON(PLAN_API, {
    '$select':'managing_agency,fms_id,fms_project_name,spend_to_date,total_budget,current_phase,borough,ten_year_plan_category',
    '$where':`reporting_period='${state.latestPeriod}'`, '$limit':'40000'
  });
  state.planMap = collapsePlan(rows);
  // rank agency codes by committed size so the default lands on a high-volume one
  const totals = new Map();
  for(const rec of state.planMap.values()){
    if(rec.bucket === 'excluded' || rec.bucket === 'Close-out') continue;
    const u = Math.max(rec.budget - rec.spend, 0);
    if(u > 0) totals.set(rec.agency, (totals.get(rec.agency)||0) + u);
  }
  state.agencyCodes = [...totals.entries()].sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
}

/* Awarded side is fetched lazily per agency on selection and cached. Returns
   {ok, agg}. ok=false where the agency has no City Record name to query. */
async function fetchAwardsFor(code){
  if(state.awardCache.has(code)) return state.awardCache.get(code);
  const name = CODE_TO_AWARD[code];
  if(!name){ const r = {ok:false, agg:null}; state.awardCache.set(code, r); return r; }
  // Half-open window [since, until): the lower bound is inclusive and the upper
  // bound exclusive, matching Home and the "Funnel" page. `since` is a
  // first-of-month midnight and awards stamped exactly on it belong inside the
  // window; a strict > dropped every notice landing on the window's first day
  // and put this page below the Funnel on the same agency.
  const since = isoCompleteMonthBoundary(12); // first day, twelve complete months back
  const until = isoCompleteMonthBoundary(0);  // first day of the current (incomplete) month
  const PAGE = 50000; let offset = 0; const out = [];
  for(;;){
    const batch = await getJSON(AWARD_API, {
      '$select':'pin,contract_amount,vendor_name,short_title,additional_description_1,category_description',
      '$where':`agency_name='${name.replace(/'/g,"''")}' AND starts_with(category_description,'Construction') AND start_date>='${since}' AND start_date<'${until}' AND contract_amount>0`,
      '$order':'pin','$limit':String(PAGE),'$offset':String(offset)
    });
    out.push(...batch);
    if(batch.length < PAGE) break;
    offset += PAGE;
    if(offset > 200000) break;
  }
  const agg = awardedAgg(dedupeAwards(out));
  const r = {ok:true, agg};
  state.awardCache.set(code, r);
  return r;
}

/* ================= velocity data layer =================
   Ported verbatim from the retired Velocity page so the per-agency velocity
   tape and the cross-agency backlog ranking reproduce the same numbers. The
   capital plan (OMB) and the award record (City Record) are settled separately
   so one being unavailable does not blank the other. */
const VEL_SNAPSHOTS = 5; // latest 5 plan snapshots -> 4 spend periods; last 3 = TTM
const VEL_MIN_SPEND = 10e6; // floor on trailing self-delivered spend for a ratio
/* Floor on what is printable as a trailing-year outlay at all. An agency whose
   whole year of self-delivered spending lands in the thousands is not spending
   slowly, it is not the builder: the outlay sits under another managing agency.
   Printing the residue beside a pipeline in the hundreds of millions reads as a
   broken figure, so the cell is suppressed the way the ratio already is. */
const VEL_MIN_SHOWN_SPEND = 1e6;
function fmtSpendCell(sp){ return sp >= VEL_MIN_SHOWN_SPEND ? fmtMoney(sp) : '<span class="na">–</span>'; }
/* capital-plan code -> City Record agency_name, the Velocity page's own map,
   kept verbatim so its award-by-agency join matches the old page exactly. */
const VEL_CODE_TO_AWARD = {
  DDC:'Design and Construction', DOT:'Transportation', DEP:'Environmental Protection',
  DPR:'Parks and Recreation', DCAS:'Citywide Administrative Services', DSNY:'Sanitation',
  NYPD:'Police Department', HPD:'Housing Preservation and Development', FDNY:'Fire Department',
  DOC:'Correction', DOHMH:'Health and Mental Hygiene', DHS:'Homeless Services',
  ACS:'Children’s Services', DFTA:'Aging'
};
const velState = {
  periods: [],           // ascending plan reporting periods
  snap: {},              // period -> Map(key -> {spend,budget,bucket,agency})
  spendPeriods: [],      // [{total, byAgency:Map}]
  pipeline: { total:0, byAgency:new Map() },
  awards: { byAgency:new Map() },
  ok: false, awardsOk: false,
  rows: [],              // computed velocity rows, ranked by pipeline
  byCode: new Map(),     // code -> {pipe, sp, aw, yrs}
  medianYrs: 0
};

/* one record per project per snapshot; keep most advanced phase. Identical to the
   Velocity page's collapseSnapshot (and to collapsePlan minus borough/category). */
function collapseSnapVel(rows){
  const m = new Map();
  for(const r of rows){
    const key = (r.managing_agency||'') + '|' + (r.fms_id||r.fms_project_name||'');
    const bucket = normPhase(r.current_phase);
    const rec = {
      agency: r.managing_agency || '–',
      spend: Math.max(parseFloat(r.spend_to_date)||0, 0),
      budget: Math.max(parseFloat(r.total_budget)||0, 0),
      bucket
    };
    const prev = m.get(key);
    if(!prev || phaseRank(bucket) > phaseRank(prev.bucket)) m.set(key, rec);
  }
  return m;
}

async function fetchVelocityPlan(){
  // 1. snapshot periods (latest N)
  const ps = await getJSON(PLAN_API, {
    '$select':'reporting_period','$group':'reporting_period',
    '$order':'reporting_period DESC','$limit': String(VEL_SNAPSHOTS)
  });
  velState.periods = ps.map(p=>p.reporting_period).sort();
  // 2. rows per snapshot in parallel
  const snaps = await Promise.all(velState.periods.map(p => getJSON(PLAN_API, {
    '$select':'fms_id,fms_project_name,managing_agency,spend_to_date,total_budget,current_phase',
    '$where': `reporting_period='${p}'`, '$limit':'20000'
  })));
  velState.periods.forEach((p,i) => { velState.snap[p] = collapseSnapVel(snaps[i]); });
  // 3. spend deltas between consecutive snapshots, on a MATCHED PANEL.
  //    Only projects present in BOTH snapshots contribute. spend_to_date is a
  //    lifetime cumulative figure, so a project seen for the first time carries
  //    its whole back-history; counting it from zero would book years of prior
  //    spending into the single period it first appears. Same rule as the
  //    "Funnel" page, so the two read the same number.
  velState.spendPeriods = [];
  for(let i=1; i<velState.periods.length; i++){
    const prev = velState.snap[velState.periods[i-1]], cur = velState.snap[velState.periods[i]];
    let total = 0; const byAgency = new Map();
    for(const [key, rec] of cur){
      // Same scope as the "Funnel" page (aligned Nov 20, 2026): excluded lines are
      // not construction demand and must not inflate trailing spend under a
      // pipeline that already drops them. Close-out is kept.
      if(rec.bucket === 'excluded') continue;
      const was = prev.get(key);
      if(!was) continue; // new entrant: no prior reading, so no measurable period spend
      const d = Math.max(rec.spend - was.spend, 0);
      total += d;
      byAgency.set(rec.agency, (byAgency.get(rec.agency)||0) + d);
    }
    velState.spendPeriods.push({ total, byAgency });
  }
  // 4. pipeline from latest snapshot (active, excluding Close-out)
  velState.pipeline = { total:0, byAgency:new Map() };
  const latest = velState.snap[velState.periods[velState.periods.length-1]];
  for(const rec of latest.values()){
    if(rec.bucket === 'excluded' || rec.bucket === 'Close-out') continue;
    const unspent = Math.max(rec.budget - rec.spend, 0);
    velState.pipeline.total += unspent;
    velState.pipeline.byAgency.set(rec.agency, (velState.pipeline.byAgency.get(rec.agency)||0) + unspent);
  }
}

/* Velocity awards: TTM total by agency, deduped to one row per pin (max amount),
   exactly as the Velocity page computed its Awarded column. */
async function fetchVelocityAwards(){
  // Same half-open [since, until) window as the per-agency pull above: inclusive
  // lower bound, exclusive upper bound, one convention across the site.
  const since = isoCompleteMonthBoundary(12);
  const until = isoCompleteMonthBoundary(0);
  const PAGE = 50000; let offset = 0; const out = [];
  for(;;){
    const batch = await getJSON(AWARD_API, {
      '$select':'pin,contract_amount,start_date,agency_name',
      '$where':`starts_with(category_description,'Construction') AND start_date>='${since}' AND start_date<'${until}' AND contract_amount>0`,
      '$order':'pin','$limit':String(PAGE),'$offset':String(offset)
    });
    out.push(...batch);
    if(batch.length < PAGE) break;
    offset += PAGE;
    if(offset > 400000) break;
  }
  const byPin = new Map();
  for(let i=0;i<out.length;i++){
    const r = out[i];
    const amt = parseFloat(r.contract_amount);
    if(!(amt>0)) continue;
    const pin = r.pin || ('_np_'+i);
    const rec = { amt, agency: r.agency_name || null };
    const prev = byPin.get(pin);
    if(!prev || rec.amt > prev.amt) byPin.set(pin, rec);
  }
  const byAgency = new Map();
  for(const r of byPin.values()){ if(r.agency) byAgency.set(r.agency, (byAgency.get(r.agency)||0) + r.amt); }
  velState.awards.byAgency = byAgency;
}

/* TTM spend by agency = last 3 inter-snapshot periods (~12 months). */
function velTtmSpendByAgency(){
  const m = new Map();
  for(const p of velState.spendPeriods.slice(-3))
    for(const [a,v] of p.byAgency) m.set(a, (m.get(a)||0)+v);
  return m;
}

/* Build the ranked velocity rows + per-code lookup, the Velocity page's renderVelocity
   logic without the DOM. Median is over codes with a computable ratio. */
function computeVelocity(){
  const spend = velTtmSpendByAgency();
  const rows = [...velState.pipeline.byAgency.entries()]
    .sort((a,b)=>b[1]-a[1])
    .map(([code, pipe]) => {
      const sp = spend.get(code) || 0;
      const awardName = VEL_CODE_TO_AWARD[code];
      const aw = (velState.awardsOk && awardName) ? velState.awards.byAgency.get(awardName) : undefined;
      const yrs = sp >= VEL_MIN_SPEND ? pipe/sp : null;
      return { code, pipe, sp, aw, yrs };
    })
    .filter(r => r.pipe > 0);
  const v = rows.filter(r=>r.yrs!==null).map(r=>r.yrs).sort((a,b)=>a-b);
  velState.medianYrs = v.length ? v[Math.floor(v.length/2)] : 0;
  velState.rows = rows;
  velState.byCode = new Map(rows.map(r=>[r.code, r]));
}

/* ================= Chart.js defaults ================= */
Chart.defaults.font.family = "'IBM Plex Mono',monospace";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#6b5e56';
Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor:'#fefbf8', titleColor:'#201611', bodyColor:'#6b5e56',
  borderColor:'#201611', borderWidth:1, cornerRadius:2, padding:10, displayColors:false,
  titleFont:{family:"'Public Sans',sans-serif",weight:'600',size:12}, bodyFont:{family:"'IBM Plex Mono',monospace",size:12},
  caretSize:5
});
const charts = {};
function destroy(k){ if(charts[k]){ charts[k].destroy(); delete charts[k]; } }

/* ================= rendering ================= */
function shortCat(s){
  return (s||'').toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
}
/* Capital-plan category names run long ("Replacement Or Augmentation Of Existing
   Systems"). The y axis clips them mid-word, which reads as broken data. Truncate
   the tick with an ellipsis and keep the full string in the tooltip. */
const CAT_TICK_MAX = 34;
function truncTick(s){
  s = String(s || '');
  return s.length > CAT_TICK_MAX ? s.slice(0, CAT_TICK_MAX - 1).trimEnd() + '…' : s;
}

function renderTrades(committed){
  const cats = [...committed.byCategory.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
  destroy('trades');
  if(!cats.length){ return; }
  const labels = cats.map(c=>shortCat(c[0]));
  charts.trades = new Chart(document.getElementById('chart-trades'), {
    type:'bar',
    data:{ labels, datasets:[{ data: cats.map(c=>c[1]),
      backgroundColor: COLOR_A, borderRadius:1, barThickness:16 }]},
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{
        title: items => (items.length ? labels[items[0].dataIndex] : ''),
        label: c => fmtMoney(c.parsed.x)+' committed' }} },
      scales:{ x:{grid:{color:GRID}, border:{display:false}, ticks:{callback:v=>fmtMoney(v), maxTicksLimit:5}},
               y:{grid:{display:false}, ticks:{autoSkip:false, font:{family:"'Public Sans',sans-serif",size:12},
                    callback: function(v){ return truncTick(this.getLabelForValue(v)); }}} } }
  });
}

function renderVendors(award){
  const tb = document.querySelector('#tbl-vendors tbody');
  if(!award || !award.ok){
    tb.innerHTML = '<tr><td colspan="3" class="u-muted u-py-4 u-px-2">No City Record award name maps to this agency, so its recipients cannot be read from the award ledger. See the methodology note on agency matching.</td></tr>';
    return;
  }
  const agg = award.agg;
  if(!agg.byVendor.size){ tb.innerHTML = '<tr><td colspan="3" class="u-muted u-py-4 u-px-2">No construction awards from this agency in the trailing twelve months.</td></tr>'; return; }
  // Split recipients the way the Briefing does: hard construction (bondable work)
  // versus design and construction-management (soft professional services), each
  // ranked on its own dollars so a CM firm is not read as a construction winner.
  function groupRows(map, groupTotal){
    const vs = [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
    return vs.map(v=>`<tr>
      <td><span class="t-title">${esc(v[0])}</span></td>
      <td class="num amt">${fmtMoney(v[1])}</td>
      <td class="num">${groupTotal>0 ? fmtPct(v[1]/groupTotal) : '–'}</td></tr>`).join('');
  }
  const sections = [];
  if(agg.byVendorHard.size){
    sections.push(`<tr class="grp-row"><td colspan="3">Hard construction · ${fmtMoney(agg.hardTotal)}</td></tr>`
      + groupRows(agg.byVendorHard, agg.hardTotal));
  }
  if(agg.byVendorSoft.size){
    sections.push(`<tr class="grp-row${agg.byVendorHard.size?' second':''}"><td colspan="3">Design &amp; CM (professional services) · ${fmtMoney(agg.softTotal)}</td></tr>`
      + groupRows(agg.byVendorSoft, agg.softTotal));
  }
  tb.innerHTML = sections.join('');
}

/* per-agency velocity tape for the selected code, off the ported velState. */
function renderAgencyVelocity(code){
  const cap = document.getElementById('vel-cap');
  const sec = document.getElementById('velocity-sec');
  if(!velState.ok){ if(sec) sec.style.display = 'none'; return; }
  if(sec) sec.style.display = '';
  cap.textContent = code + ' · PACE';
  const hsub = document.getElementById('vel-hsub');
  if(hsub) hsub.innerHTML = 'How fast ' + esc(agencyName(code)) + ' converts funded work to cash. Backlog coverage is its open pipeline divided by its own trailing-year outlays, the demand-side analog of a contractor’s backlog-to-revenue ratio. A higher number means more funded work stacked behind the same delivery capacity.';
  const row = velState.byCode.get(code) || { pipe:0, sp:0, aw:undefined, yrs:null };
  document.getElementById('vel-committed').textContent = row.pipe>0 ? fmtMoney(row.pipe) : '–';
  document.getElementById('vel-spent').innerHTML       = fmtSpendCell(row.sp);
  document.getElementById('vel-awarded').textContent  = (velState.awardsOk && row.aw!==undefined) ? fmtMoney(row.aw) : '–';
  document.getElementById('vel-coverage').textContent = row.yrs!==null ? row.yrs.toFixed(1) + ' yrs' : '–';

  const label = agencyLabel(code);
  const rd = document.getElementById('vel-reading-agency');
  if(row.yrs!==null){
    const med = velState.medianYrs;
    const rel = med>0 ? (row.yrs > med*1.5 ? 'a deeper backlog than the typical agency' : (row.yrs < med*0.67 ? 'a shallower backlog than the typical agency' : 'a backlog close to the typical agency')) : 'a measurable backlog';
    rd.innerHTML = `<strong>Reading:</strong> ${esc(label)} carries <strong>${row.yrs.toFixed(1)} years</strong> of funded work at its current pace of spending, ${rel} (median <strong>${med.toFixed(1)} years</strong> across agencies with a computable ratio). A deep backlog is funded work waiting on delivery capacity, not a problem in itself; it is where future awards and bonding demand are most concentrated.`;
  } else if(row.pipe>0){
    rd.innerHTML = `<strong>Reading:</strong> ${esc(label)} holds <strong>${fmtMoney(row.pipe)}</strong> of open pipeline, but its own trailing self-delivered outlay is below the floor for a stable ratio. Its capital work is largely built under another managing agency, chiefly the Department of Design and Construction, so a backlog-coverage figure under this code would be noise rather than a velocity signal.`;
  } else {
    rd.innerHTML = `<strong>Reading:</strong> ${esc(label)} shows little open construction pipeline under its own code in the latest plan snapshot.`;
  }
}

/* cross-agency backlog ranking chart + the full velocity table (rendered once). */
function renderVelocityRanking(){
  const sec = document.getElementById('vel-rank-sec');
  const tsec = document.getElementById('vel-table-sec');
  if(!velState.ok){ if(sec) sec.style.display='none'; if(tsec) tsec.style.display='none'; return; }
  const rows = velState.rows, med = velState.medianYrs;

  // full table
  document.querySelector('#tbl-velocity tbody').innerHTML = rows.map(r=>`<tr>
    <td><span class="t-title">${esc(agencyLabel(r.code))}</span></td>
    <td class="num amt">${fmtMoney(r.pipe)}</td>
    <td class="num amt">${fmtSpendCell(r.sp)}</td>
    <td class="num amt">${(velState.awardsOk && r.aw!==undefined) ? fmtMoney(r.aw) : '–'}</td>
    <td class="num"><span class="yrs ${r.yrs===null?'':(r.yrs>med*1.5?'slow':(r.yrs<med*.67?'fast':''))}">${r.yrs===null?'–':r.yrs.toFixed(1)}</span></td>
    <td class="num payvel-cell" data-code="${esc(r.code)}">–</td>
  </tr>`).join('');
  // The dated-payment column is filled asynchronously by the payment module once
  // the contract file loads; default to an en dash so the row reads cleanly meanwhile.

  // backlog-coverage chart: agencies with a computable ratio, top 10 by pipeline
  const charted = rows.filter(r=>r.yrs!==null).slice(0,10);
  destroy('velrank');
  charts.velrank = new Chart(document.getElementById('chart-vel-rank'), {
    type:'bar',
    data:{ labels: charted.map(r=>agencyLabel(r.code)),
      datasets:[{ data: charted.map(r=>r.yrs), borderRadius:1, barThickness:18,
        backgroundColor: charted.map(r=> r.yrs>med*1.5 ? '#9e362f' : (r.yrs<med*0.67 ? '#276b45' : '#a8462c')) }]},
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>c.parsed.x.toFixed(1)+' years of funded work'}} },
      scales:{ x:{grid:{color:GRID}, border:{display:false}, ticks:{callback:v=>v+' yr', maxTicksLimit:6}},
               y:{grid:{display:false}, ticks:{autoSkip:false, font:{family:"'Public Sans',sans-serif",size:12.5}}} } }
  });

  const fast = rows.filter(r=>r.yrs!==null).reduce((a,r)=> r.yrs<a.yrs?r:a, {yrs:Infinity});
  const slow = charted.reduce((a,r)=> r.yrs>a.yrs?r:a, {yrs:0});
  document.getElementById('vel-rank-reading').innerHTML =
    `<strong>Reading:</strong> across agencies with a computable ratio, the median is <strong>${med.toFixed(1)} years</strong> of funded work at the current pace. ${slow.code ? esc(agencyLabel(slow.code))+' carries the deepest backlog at '+slow.yrs.toFixed(1)+' years, ' : ''}${fast.code ? esc(agencyLabel(fast.code))+' the shallowest at '+fast.yrs.toFixed(1)+'.' : ''} A deep backlog is funded work waiting on delivery capacity, not a problem in itself; it is where future awards and bonding demand are most concentrated.`;
}

/* paint the borough map + table for the active scope */
function activeBoroData(){
  const committed = state.committedCache.get(state.selected);
  const award = state.awardCache.get(state.selected);
  if(state.boroScope === 'committed'){
    return { rows: boroughRows(committed.byBorough, committed.largestBoro),
             total: committed.total,
             provenance: 'STRUCTURED', ok: committed.total > 0 };
  }
  if(!award || !award.ok || !award.agg){ return { rows: [], total: 0, provenance:'DERIVED', ok:false }; }
  return { rows: boroughRows(award.agg.byBorough, award.agg.largestBoro),
           total: award.agg.total, provenance:'DERIVED', ok: award.agg.total > 0 };
}

function svgId(boro){ return 'b-' + boro.replace(/\s+/g,''); }

function renderBorough(focusBoro){
  const data = activeBoroData();
  const map = document.getElementById('boro-map');
  const prov = document.getElementById('boro-provenance');
  const tb = document.querySelector('#tbl-boro tbody');
  // five-borough max for the colour ramp (the explicit bucket is not on the map)
  const fiveMax = Math.max(1, ...data.rows.filter(r=>r.borough!==MULTI).map(r=>r.dollars));

  BOROS.forEach(b=>{
    const el = document.getElementById(svgId(b));
    const row = data.rows.find(r=>r.borough===b);
    const v = row ? row.dollars : 0;
    const t = data.ok ? Math.min(1, v/fiveMax) : 0;
    el.setAttribute('fill', rampColor(t));
    el.setAttribute('aria-label', b + ' ' + fmtMoney(v));
  });

  // table: five boroughs then the explicit bucket
  const barMax = Math.max(1, ...data.rows.map(r=>r.dollars));
  tb.innerHTML = data.rows.map(r=>{
    const isMulti = r.borough === MULTI;
    const w = (r.dollars/barMax*100).toFixed(1);
    return `<tr class="boro-row${isMulti?' multi':''}" data-boro="${esc(r.borough)}">
      <td><span class="t-title">${esc(r.borough)}</span></td>
      <td class="num bg-cell"><span class="bg-bar" data-ci-style="width:${w}%"></span><span class="amt">${r.dollars>0?fmtMoney(r.dollars):'–'}</span></td>
      <td class="num">${r.dollars>0 ? fmtPct(r.concentration) : '–'}</td></tr>`;
  }).join('');

  prov.innerHTML = data.provenance === 'STRUCTURED'
    ? '<b>Provenance:</b> committed borough is a <b>structured field</b> on the capital plan, the harder source. The citywide / multi-borough / unspecified slice is reported on its own and is not on the map.'
    : '<b>Provenance:</b> awarded borough is <b>derived from notice text</b> (the softest figure): a community board cue in the description, then a borough name in the title. Anything citywide, multi-borough, or unnamed is its own slice and not on the map.';

  // readout: focused borough, else the leading mapped borough
  let focus = focusBoro;
  if(!focus){
    const lead = data.rows.filter(r=>r.borough!==MULTI).sort((a,b)=>b.dollars-a.dollars)[0];
    focus = lead && lead.dollars>0 ? lead.borough : MULTI;
  }
  paintReadout(focus, data);

  // hover/click wiring
  BOROS.forEach(b=>{
    const el = document.getElementById(svgId(b));
    el.onmouseenter = ()=>paintReadout(b, activeBoroData());
    el.onclick = ()=>{ markActive(b); paintReadout(b, activeBoroData()); };
  });
  document.querySelectorAll('#tbl-boro .boro-row').forEach(tr=>{
    tr.style.cursor = 'pointer';
    tr.onmouseenter = ()=>{ const b = tr.getAttribute('data-boro'); paintReadout(b, activeBoroData()); markActive(b); };
  });
  markActive(focus);
}

function markActive(boro){
  BOROS.forEach(b=>{ const el = document.getElementById(svgId(b)); el.classList.toggle('on', b===boro); });
}

function paintReadout(boro, data){
  const ro = document.getElementById('boro-readout');
  const row = data.rows.find(r=>r.borough===boro) || {borough:boro, dollars:0, concentration:0};
  const share = data.total>0 ? row.dollars/data.total : 0;
  const scopeWord = state.boroScope === 'committed' ? 'committed' : 'awarded';
  ro.innerHTML = `<div class="ro-head">${esc(boro)}</div>
    <dl class="ro-grid">
      <dt>${scopeWord==='committed'?'Committed here':'Awarded here'}</dt><dd>${row.dollars>0?fmtMoney(row.dollars):'–'}</dd>
      <dt>Share of agency ${scopeWord}</dt><dd>${row.dollars>0?fmtPct(share):'–'}</dd>
      <dt>Largest single project</dt><dd>${row.dollars>0?fmtPct(row.concentration):'–'}</dd>
    </dl>`;
}

/* warm ramp accent-soft -> accent */
function rampColor(t){
  t = Math.max(0, Math.min(1, t));
  // accent-soft eadbd4 (234,219,212) -> accent ae4e34 (174,78,52)
  const r = Math.round(234 + (174-234)*t);
  const g = Math.round(219 + (78-219)*t);
  const b = Math.round(212 + (52-212)*t);
  return `rgb(${r},${g},${b})`;
}

/* ================= per-agency repaint ================= */
async function selectAgency(code){
  state.selected = code;
  const label = agencyLabel(code);
  const name = agencyName(code);

  // selected-agency banner: full name in serif, code + plan snapshot in mono
  document.getElementById('ab-full').textContent = name;
  document.getElementById('ab-code').textContent = code;
  document.getElementById('ab-asof').innerHTML =
    'CODE <b>' + esc(code) + '</b> &nbsp;·&nbsp; AS OF <b>' + esc(fmtPeriodLong(state.latestPeriod).toUpperCase()) + '</b> PLAN';

  // per-tile caps, each stamped with the selected agency's short code
  document.getElementById('funnel-cap').textContent = code + ' · COMMITTED vs AWARDED';
  document.getElementById('trades-cap').textContent = code + ' · CAPITAL PLAN · DOLLAR-WEIGHTED';
  document.getElementById('recipients-cap').textContent = code + ' · CITY RECORD · TRAILING YEAR';
  document.getElementById('boro-cap').textContent = code + ' · DOLLAR-WEIGHTED · 5 BOROUGHS';

  // generic-phrasing swaps: name the live agency where it reads naturally
  document.getElementById('boro-hsub').innerHTML =
    'Where ' + esc(name) + "'s work lands across the five boroughs, weighted by dollars rather than project count. The citywide and multi-borough share is its own slice, never spread across the map. Click a borough to read its detail.";

  // committed (already loaded, cache it)
  let committed = state.committedCache.get(code);
  if(!committed){ committed = committedForAgency(state.planMap, code); state.committedCache.set(code, committed); }

  // KPI + funnel committed
  document.getElementById('kpi-committed').textContent = committed.total>0 ? fmtMoney(committed.total) : '–';
  document.getElementById('kpi-committed-note').textContent = committed.total>0
    ? 'unspent budget, ' + fmtPeriodLong(state.latestPeriod) + ' plan'
    : (DELIVERED_VIA_DDC.has(code) ? 'work mostly delivered via DDC in the plan' : 'no committed construction budget under this code');
  document.getElementById('f-committed').textContent = committed.total>0 ? fmtMoney(committed.total) : '–';

  renderTrades(committed);

  // awarded (lazy, async). show pending state.
  document.getElementById('kpi-awarded').textContent = '…';
  document.getElementById('f-awarded').textContent = '…';
  document.getElementById('match-note').textContent = CODE_TO_AWARD[code]
    ? 'maps to City Record · ' + CODE_TO_AWARD[code]
    : 'no City Record award name maps to this code';

  let award;
  try { award = await fetchAwardsFor(code); }
  catch(e){ award = {ok:true, agg:{total:0,count:0,byBorough:new Map(),byVendor:new Map(),largestBoro:new Map()}, errored:true}; }
  // ignore a stale async return if the user moved on
  if(state.selected !== code) return;
  // A failed award query is disclosed, not passed off as a quiet zero.
  ci.banner(document.getElementById('agency-alert'), award.errored ? { alert: true,
    title: 'Couldn’t reach NYC Open Data.',
    text: 'The award record for this agency did not load, so its awarded figures below read as zero. Committed figures from the capital plan are unaffected.',
    retry: () => selectAgency(code) } : null);

  const awarded = award.ok && award.agg ? award.agg.total : 0;
  document.getElementById('kpi-awarded').textContent = award.ok ? (awarded>0?fmtMoney(awarded):'$0') : '–';
  document.getElementById('kpi-awarded-note').textContent = award.ok
    ? 'construction awards, trailing 12 months'
    : 'no award-ledger name for this agency';
  document.getElementById('f-awarded').textContent = award.ok ? (awarded>0?fmtMoney(awarded):'$0') : '–';
  document.getElementById('kpi-count').textContent = award.ok ? fmtInt(award.agg.count) : '–';

  // top recipient share KPI
  if(award.ok && award.agg.total>0){
    const top = [...award.agg.byVendor.entries()].sort((a,b)=>b[1]-a[1])[0];
    document.getElementById('kpi-share').textContent = fmtPct(top[1]/award.agg.total);
    document.getElementById('kpi-share-note').textContent = 'won by ' + (top[0].length>26 ? top[0].slice(0,26)+'…' : top[0]);
  } else {
    document.getElementById('kpi-share').textContent = '–';
    document.getElementById('kpi-share-note').textContent = 'no awards to rank';
  }

  renderVendors(award);

  // funnel reading
  const fr = document.getElementById('funnel-reading');
  if(committed.total>0 && award.ok && award.agg.total>0){
    const ratio = committed.total/award.agg.total;
    fr.innerHTML = `<strong>Reading:</strong> ${esc(label)} holds <strong>${fmtMoney(committed.total)}</strong> of unspent committed budget against <strong>${fmtMoney(award.agg.total)}</strong> of construction awards in the last year, roughly ${ratio.toFixed(1)}× as much funded work as it has put on the street over twelve months. That gap is the runway of work yet to reach bid.`;
  } else if(committed.total>0 && (!award.ok || award.agg.total===0)){
    fr.innerHTML = `<strong>Reading:</strong> ${esc(label)} holds <strong>${fmtMoney(committed.total)}</strong> of unspent committed budget in the plan. ${award.ok ? 'No construction awards landed under this agency in the last twelve months; its construction may be procured through another managing agency.' : 'The City Record carries no award name for this agency, so its awarded side reads as unavailable rather than zero.'}`;
  } else if(award.ok && award.agg.total>0){
    fr.innerHTML = `<strong>Reading:</strong> ${esc(label)} awarded <strong>${fmtMoney(award.agg.total)}</strong> of construction in the last year. Its committed line is small under this code because ${DELIVERED_VIA_DDC.has(code)?'its capital work is filed under the building agency in the plan':'most of its budget sits in non-construction categories'}.`;
  } else {
    fr.innerHTML = `<strong>Reading:</strong> ${esc(label)} shows little construction activity on either ledger in this window.`;
  }

  // borough
  renderBorough(null);

  // velocity (per-agency tape, off the ported velState)
  renderAgencyVelocity(code);
}

/* ================= controls ================= */
function wireControls(){
  const sel = document.getElementById('agency');
  sel.innerHTML = state.agencyCodes.map(c=>`<option value="${esc(c)}">${esc(agencyLabel(c))}</option>`).join('');
  sel.addEventListener('change', ()=>selectAgency(sel.value));

  document.querySelectorAll('#boro-seg .seg-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state.boroScope = btn.getAttribute('data-scope');
      document.querySelectorAll('#boro-seg .seg-btn').forEach(b=>b.classList.toggle('on', b===btn));
      renderBorough(null);
    });
  });
}

/* ================= init ================= */
(async function init(){
  // The agency profile anchors on its own latest-snapshot plan; the velocity
  // layer is a heavier multi-snapshot pull settled in parallel so a slow or
  // failed velocity fetch never blanks the profile.
  let planR;
  const velPlanP = fetchVelocityPlan();
  const velAwardP = fetchVelocityAwards();
  try { await fetchPlan(); planR = true; }
  catch(e){
    document.getElementById('loader').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    return;
  }
  // settle velocity before the first paint so the page renders once
  const [vp, va] = await Promise.allSettled([velPlanP, velAwardP]);
  velState.ok = vp.status === 'fulfilled';
  velState.awardsOk = va.status === 'fulfilled';
  if(velState.ok) computeVelocity();

  // default to a high-volume agency: prefer DEP if present, else the largest committed
  const def = state.agencyCodes.includes('DEP') ? 'DEP' : state.agencyCodes[0];
  document.getElementById('asof').innerHTML =
    `Capital plan through <strong>${fmtPeriodLong(state.latestPeriod)}</strong> · awards through today · select an agency to repaint the page`;
  document.getElementById('series-asof').textContent = fmtPeriodLong(state.latestPeriod).toUpperCase();
  document.getElementById('loader').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  wireControls();
  // seed the segmented control active state
  document.querySelector('#boro-seg .seg-btn[data-scope="committed"]').classList.add('on');
  document.getElementById('agency').value = def;
  renderVelocityRanking();
  await selectAgency(def);
})();

/* ===========================================================================
   Dated-payment tiles on the Agency page:
   TILE 1  cross-agency payment-velocity section (chart + table)
   TILE 4  a "days to 50% paid" column on the full velocity table
   Self-contained: reads the same same-origin file the Contracts page uses
   (/data/contract-search.json, sample fallback), independent of the plan and
   award fetches above so it never blocks or blanks the profile.
   =========================================================================== */
(function(){
  'use strict';
  var LIVE_URL = '/data/contract-search.json';
  var SAMPLE_URL = '/data/contract-search.sample.json';
  var MIN_AGENCY_N = 8;
  var PV_A = '#a8462c', PV_GRID = '#e6ddd5';
  var pvCharts = {};
  function pvDestroy(k){ if(pvCharts[k]){ pvCharts[k].destroy(); delete pvCharts[k]; } }
  function escv(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

  /* capital-plan code -> contract-file agency NAME (the full "Department of ..."
     form the contract JSON uses), for the TILE 4 column join. Codes absent here
     have no clean dated-payment name and read as a dash. */
  var CODE_TO_CONTRACT_NAME = {
    DDC: 'Department of Design and Construction',
    DEP: 'Department of Environmental Protection',
    DOT: 'Department of Transportation',
    DPR: 'Department of Parks and Recreation',
    DSNY: 'Department of Sanitation',
    DCAS: 'Department of Citywide Administrative Services',
    NYPD: 'Police Department',
    FDNY: 'Fire Department',
    DOC: 'Department of Correction',
    DOHMH: 'Department of Health and Mental Hygiene',
    HPD: 'Department of Housing Preservation and Development'
  };

  function sweptContracts(cs){ return (cs || []).filter(function(c){ return c && c.payments_swept === true; }); }
  function median(arr){
    var a = (arr || []).filter(function(v){ return v != null && !isNaN(v); }).sort(function(x,y){ return x - y; });
    if(!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
  }
  function groupBy(arr, keyFn){
    var m = new Map();
    (arr || []).forEach(function(x){ var k = keyFn(x); if(!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return m;
  }
  /* TILE 1: per-agency median first-payment lag + median days-to-50%, n>=floor */
  function agencyVelocity(cs){
    var swept = sweptContracts(cs);
    var rows = [];
    groupBy(swept, function(c){ return c.agency || '–'; }).forEach(function(list, agency){
      if(list.length < MIN_AGENCY_N) return;
      rows.push({ agency: agency, n: list.length,
        medLag: median(list.map(function(c){ return c.first_payment_lag_days; })),
        med50: median(list.map(function(c){ return c.days_to_50pct_paid; })) });
    });
    rows.sort(function(a,b){
      if(a.med50 == null && b.med50 == null) return 0;
      if(a.med50 == null) return 1;
      if(b.med50 == null) return -1;
      return a.med50 - b.med50;
    });
    return rows;
  }
  /* TILE 4: agency NAME -> median days-to-50% (null below floor) */
  function med50ByName(cs){
    var swept = sweptContracts(cs);
    var out = new Map();
    groupBy(swept, function(c){ return c.agency || '–'; }).forEach(function(list, agency){
      out.set(agency, list.length >= MIN_AGENCY_N ? median(list.map(function(c){ return c.days_to_50pct_paid; })) : null);
    });
    return out;
  }
  function shortAgency(name){ return String(name || '').replace(/^Department of /, '').replace(/^New York City /, ''); }

  /* ----- TILE 1 render ----- */
  function renderPayVel(cs){
    var card = document.getElementById('payvel-sec');
    var rows = agencyVelocity(cs);
    if(!rows.length){
      pvDestroy('payvel');
      var cb = document.getElementById('payvel-chartbox'); if(cb) cb.style.display = 'none';
      var tbl = document.getElementById('tbl-payvel'); if(tbl) tbl.style.display = 'none';
      var rd0 = document.getElementById('payvel-reading'); if(rd0) rd0.style.display = 'none';
      var un = document.getElementById('payvel-unavail');
      if(un) un.innerHTML = '<div class="unavail">No agency has at least ' + MIN_AGENCY_N
        + ' dated contracts (those with confirmed Checkbook NYC disbursements) yet, so the cross-agency payment-velocity view is held until the dated set fills in.</div>';
      return;
    }
    // chart: median days to 50% paid, fastest first, agencies with a value
    var charted = rows.filter(function(r){ return r.med50 != null; });
    pvDestroy('payvel');
    pvCharts.payvel = new Chart(document.getElementById('chart-payvel'), {
      type: 'bar',
      data: { labels: charted.map(function(r){ return shortAgency(r.agency); }),
        datasets: [{ data: charted.map(function(r){ return r.med50; }), backgroundColor: PV_A, borderRadius: 1, barThickness: 18 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: function(c){ return Math.round(c.parsed.x) + ' days to 50% paid'; } } } },
        scales: { x: { grid: { color: PV_GRID }, border: { display: false },
            title: { display: true, text: 'median days to 50% paid', color: '#766a60', font: { family: "'IBM Plex Mono',monospace", size: 12 } },
            ticks: { maxTicksLimit: 6, callback: function(v){ return v + 'd'; } } },
          y: { grid: { display: false }, ticks: { autoSkip: false, font: { family: "'Public Sans',sans-serif", size: 12.5 } } } } }
    });
    // table
    document.querySelector('#tbl-payvel tbody').innerHTML = rows.map(function(r){
      return '<tr><td><span class="t-title">' + escv(r.agency) + '</span></td>'
        + '<td class="num">' + r.n + '</td>'
        + '<td class="num">' + (r.medLag != null ? Math.round(r.medLag) : '–') + '</td>'
        + '<td class="num amt">' + (r.med50 != null ? Math.round(r.med50) : '–') + '</td></tr>';
    }).join('');
    document.getElementById('payvel-cap').textContent = 'DATED SET · ' + rows.length + ' AGENCIES';
    var fastest = charted[0], slowest = charted[charted.length - 1];
    var rd = document.getElementById('payvel-reading');
    if(rd && fastest) rd.innerHTML = '<strong>Reading:</strong> among agencies with enough dated contracts, '
      + '<strong>' + escv(shortAgency(fastest.agency)) + '</strong> reaches half paid fastest at about <strong>'
      + Math.round(fastest.med50) + ' days</strong>' + (slowest && slowest !== fastest
        ? ', and <strong>' + escv(shortAgency(slowest.agency)) + '</strong> slowest at about <strong>' + Math.round(slowest.med50) + ' days</strong>'
        : '') + '. A longer wait to half-paid is working capital a contractor carries on that agency’s jobs; it is a cash-flow read on the agency, not a judgment of the work.';
  }

  /* ----- TILE 4: fill the velocity table column ----- */
  function fillVelocityColumn(cs){
    var byName = med50ByName(cs);
    document.querySelectorAll('#tbl-velocity .payvel-cell').forEach(function(td){
      var code = td.getAttribute('data-code');
      var name = CODE_TO_CONTRACT_NAME[code];
      var v = name ? byName.get(name) : null;
      td.textContent = (v != null) ? Math.round(v) : '–';
    });
  }

  function loadJSON(url){
    return fetch(url, { cache: 'no-store' }).then(function(res){
      if(!res.ok) throw new Error('HTTP ' + res.status); return res.json();
    });
  }
  /* The sample file carries synthetic contracts for local work. It must never
     paint as if it were the record (same guard as the Contracts page). */
  function isLocalCheckout(){
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
  }
  function refusedFixture(payload){
    if(!(payload && payload.meta && payload.meta.fixture)) return false;
    if(isLocalCheckout()){ if(window.console) console.warn('contract-search: rendering the synthetic sample fixture, not the nightly file'); return false; }
    if(window.console) console.error('contract-search: fixture payload refused outside a local checkout');
    return true;
  }
  function paintAll(payload){
    if(refusedFixture(payload)){ hideTile1(); return; }
    var cs = (payload && Array.isArray(payload.contracts)) ? payload.contracts : [];
    try { renderPayVel(cs); } catch(e){ if(window.console) console.error('payvel render', e); var s = document.getElementById('payvel-sec'); if(s) s.style.display = 'none'; }
    try { fillVelocityColumn(cs); } catch(e){ if(window.console) console.error('payvel column', e); }
  }
  function hideTile1(){ var el = document.getElementById('payvel-sec'); if(el) el.style.display = 'none'; }
  function start(){
    if(typeof Chart === 'undefined'){ hideTile1(); return; }
    var payloadP = loadJSON(LIVE_URL).catch(function(){ return loadJSON(SAMPLE_URL); });
    var tries = 0;
    (function whenReady(){
      // wait for #app reveal (charts need layout) AND for the velocity table to
      // have rendered its rows, so the TILE 4 column has cells to fill.
      var app = document.getElementById('app');
      var hasRows = document.querySelector('#tbl-velocity .payvel-cell');
      if(app && app.offsetParent !== null && hasRows){
        payloadP.then(paintAll).catch(function(err){
          if(window.console) console.error('contract-search load failed (agency tiles)', err); hideTile1();
        });
        return;
      }
      // app revealed but velocity table never rendered (velocity source failed):
      // still paint TILE 1, which does not depend on the table.
      if(app && app.offsetParent !== null && tries > 60){
        payloadP.then(paintAll).catch(function(err){
          if(window.console) console.error('contract-search load failed (agency tiles)', err); hideTile1();
        });
        return;
      }
      if(tries++ < 200) setTimeout(whenReady, 80);
      else hideTile1();
    })();
  }
  if(document.readyState !== 'loading') start(); else document.addEventListener('DOMContentLoaded', start);
})();
