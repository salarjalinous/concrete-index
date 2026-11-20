'use strict';
/* ================= data layer ================= */
const PLAN_API = 'https://data.cityofnewyork.us/resource/fb86-vt7u.json';
const AWARD_API = 'https://data.cityofnewyork.us/resource/qyyg-4tf5.json';
const SNAPSHOTS = 5; // latest 5 plan snapshots → 4 spend periods; last 3 ≈ TTM

const state = {
  periods: [],          // ascending, e.g. ['202409','202501','202505','202509','202601']
  snap: {},             // period -> Map(key -> {spend,budget,bucket,agency})
  spendPeriods: [],     // [{label, total, byAgency:Map}]
  pipeline: { total:0, byAgency:new Map() },
  awards: { ttm:0, count:0, byAgency:new Map(), byQuarter:[] },
  checkbook: { paid:0, ok:false, meta:null, ageHours:null, stale:false }
};

async function getJSON(api, params){
  const res = await fetch(api + '?' + new URLSearchParams(params), { headers: { 'X-App-Token': '3TAzQQPiSG2T4WGWfYYUxxqfJ' } });
  if(!res.ok) throw new Error('API ' + res.status);
  return res.json();
}

/* ---- phase normalization (same rules as the Pipeline page) ---- */
const PHASE_MAP = {
  'pending':'Pending','initiation':'Pending','pre-design':'Pre-Design','predesign':'Pre-Design',
  'design':'Design','construction procurement':'Procurement','construction':'Construction',
  'design build':'Construction','design built':'Construction','close-out':'Close-out','closeout':'Close-out'
};
const EXCLUDED = new Set([
  // inactive / finished states
  'completed','cancelled','inactive','on-hold','on hold','transferred',
  'withdrawn','terminated','defaulted','capitally ineligible','expense',
  // dead phases: the project is gone, not waiting to be built
  'defunded','funding withdrawn','rescinded','fmsid changed','project renamed','n/a',
  // not construction work: these do not belong in the construction-demand pipeline
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

/* one record per project per snapshot; keep most advanced phase.
   Spending deltas use ALL projects (including completed) so final payments count;
   pipeline uses active phases excluding Close-out. */
function collapseSnapshot(rows){
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

/* The capital plan (OMB) and the award record (City Record) are independent
   sources. Settle them separately so one being unavailable does not blank the
   sections that depend on the other. */
async function fetchPlan(){
  // 1. snapshot periods
  const ps = await getJSON(PLAN_API, {
    '$select':'reporting_period','$group':'reporting_period',
    '$order':'reporting_period DESC','$limit': String(SNAPSHOTS)
  });
  state.periods = ps.map(p=>p.reporting_period).sort();

  // 2. rows per snapshot (in parallel)
  const snaps = await Promise.all(state.periods.map(p => getJSON(PLAN_API, {
    '$select':'fms_id,fms_project_name,managing_agency,spend_to_date,total_budget,current_phase',
    '$where': `reporting_period='${p}'`, '$limit':'20000'
  })));
  state.periods.forEach((p,i) => { state.snap[p] = collapseSnapshot(snaps[i]); });

  // 3. spend deltas between consecutive snapshots, on a MATCHED PANEL.
  //    Only projects present in BOTH snapshots contribute. spend_to_date is a
  //    lifetime cumulative figure, so a project seen for the first time carries
  //    its whole back-history; counting it from zero would book years of prior
  //    spending into the single period it first appears. The matched panel
  //    measures growth where a prior reading exists and nowhere else.
  for(let i=1; i<state.periods.length; i++){
    const prev = state.snap[state.periods[i-1]], cur = state.snap[state.periods[i]];
    let total = 0; const byAgency = new Map();
    for(const [key, rec] of cur){
      // Match the pipeline sum's scope: completed/cancelled/land-acquisition/
      // IT/equipment/consultant-services lines are not construction demand and
      // must not inflate this denominator under a numerator that already drops
      // them. Close-out IS kept here (unlike the pipeline sum): spend booked
      // while a project winds down is real construction cash paid out, even
      // though its remaining unspent balance no longer counts as pipeline.
      if(rec.bucket === 'excluded') continue;
      const was = prev.get(key);
      if(!was) continue; // new entrant: no prior reading, so no measurable period spend
      const d = Math.max(rec.spend - was.spend, 0);
      total += d;
      byAgency.set(rec.agency, (byAgency.get(rec.agency)||0) + d);
    }
    state.spendPeriods.push({ label: periodLabel(state.periods[i-1], state.periods[i]), total, byAgency });
  }

  // 4. pipeline from latest snapshot (active, excluding Close-out)
  const latest = state.snap[state.periods[state.periods.length-1]];
  for(const rec of latest.values()){
    if(rec.bucket === 'excluded' || rec.bucket === 'Close-out') continue;
    const unspent = Math.max(rec.budget - rec.spend, 0);
    state.pipeline.total += unspent;
    state.pipeline.byAgency.set(rec.agency, (state.pipeline.byAgency.get(rec.agency)||0) + unspent);
  }
}

async function fetchAwards(){
  // awards: TTM total + by agency + by quarter, deduped to one row per pin
  // (max contract_amount). Pull rows rather than a server-side sum so the
  // canonical pin-dedupe applies; the same award is published as several
  // near-duplicate notices, so a raw sum overstates the total.
  // Trailing twelve FULLY-ELAPSED months, matching the Analysis index and the
  // Briefing: the current partial month is excluded so a few days of the month
  // in progress do not understate the awarded total or the pages disagree.
  const c0 = isoCompleteMonthBoundary(0);     // first day of the current (incomplete) month
  const since = isoCompleteMonthBoundary(12); // first day, twelve complete months back
  const rows = (await fetchAwardRows(since)).filter(r => (r.start_date || '') < c0);
  const deduped = dedupeAwardsByPin(rows);
  let ttm = 0; const byAgency = new Map(); const byMonth = new Map();
  for(const r of deduped){
    ttm += r.amt;
    if(r.agency) byAgency.set(r.agency, (byAgency.get(r.agency)||0) + r.amt);
    if(r.month) byMonth.set(r.month, (byMonth.get(r.month)||0) + r.amt);
  }
  state.awards.ttm = ttm;
  state.awards.count = deduped.length;
  state.awards.byAgency = byAgency;
  const monthRows = [...byMonth.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(([m,s])=>({m, s}));
  state.awards.byQuarter = toQuarters(monthRows);
}

/* Paid to date from Checkbook NYC: a static file built nightly server-side
   (the Comptroller's API blocks browsers). Same-origin, so a plain fetch, no
   app token. Sums the paid figure across every construction vendor group. This
   is a DIFFERENT ledger and scope from the OMB Spent gauge and is never summed
   with it. Failure is quiet: the Paid figure is simply omitted.

   FRESHNESS. Every other figure on this page is fetched live on load; Paid is
   the one number served from a file, so it is the one number that can silently
   go stale if the nightly job stops committing (it did: the job failed 12 of 13
   nights on a push race and the file sat four days old behind a live figure).
   The file therefore declares its own refresh contract in meta -- generated,
   cadence_hours, stale_after_hours, drop_after_hours -- and the page enforces
   it rather than trusting the file:
     age <= stale_after (48h)  -> show the gauge, dated
     age >  stale_after        -> show the gauge, dated, and DISCLOSE that the
                                  refresh has not run since that date
     age >  drop_after (14d)   -> do NOT show the figure at all; the page falls
                                  back to three gauges. A number that old is not
                                  "refreshed daily" and will not be presented as
                                  if it were.
   A file with no generated stamp is treated as undatable and dropped. */
const CBK_STALE_H_DEFAULT = 48;
const CBK_DROP_H_DEFAULT  = 336;   // 14 days

async function fetchCheckbook(){
  const res = await fetch('/data/checkbook-vendors.json');
  if(!res.ok) throw new Error('checkbook ' + res.status);
  const d = await res.json();
  const meta = d.meta || null;
  state.checkbook.meta = meta;

  // Age the file against its own declared cadence. No stamp -> undatable -> drop.
  const gen = meta && meta.generated ? Date.parse(meta.generated) : NaN;
  if(!isFinite(gen)) throw new Error('checkbook file carries no generated stamp');
  const ageHours = (Date.now() - gen) / 36e5;
  const dropAfter = (meta && +meta.drop_after_hours) || CBK_DROP_H_DEFAULT;
  state.checkbook.ageHours = ageHours;
  state.checkbook.stale = ageHours > ((meta && +meta.stale_after_hours) || CBK_STALE_H_DEFAULT);
  if(ageHours > dropAfter){
    throw new Error('checkbook file is ' + Math.round(ageHours/24) + ' days old (drop threshold '
      + Math.round(dropAfter/24) + ' days)');
  }

  const vendors = d.vendors || {};
  let paid = 0;
  for(const k in vendors){ paid += (parseFloat(vendors[k].paid) || 0); }
  state.checkbook.paid = paid;
  state.checkbook.ok = true;
}

/* "Jul 9, 2026" from the file's generated stamp, for dating the Paid gauge.
   Byte-for-byte the same helper /contractors/ already uses to date this same
   file, so one file is never dated two ways on two pages. */
function cbkAsOf(){
  const g = state.checkbook.meta && state.checkbook.meta.generated
    ? state.checkbook.meta.generated : null;
  if(!g) return '';
  const d = new Date(g);
  if(isNaN(d)) return '';
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

/* Paged pull of construction award rows in the window, only the fields used.
   The lower bound is inclusive (>=), matching the Home page: `since` is a
   first-of-month midnight, and awards stamped exactly on that midnight belong
   to the window. A strict > silently dropped them and put the funnel below the
   Home total. The caller applies the exclusive upper bound. */
async function fetchAwardRows(since){
  const PAGE = 50000;
  let offset = 0; const out = [];
  for(;;){
    const batch = await getJSON(AWARD_API, {
      '$select':'pin,contract_amount,start_date,agency_name',
      '$where':`starts_with(category_description,'Construction') AND start_date>='${since}' AND contract_amount>0`,
      '$order':'pin','$limit':String(PAGE),'$offset':String(offset)
    });
    out.push(...batch);
    if(batch.length < PAGE) break;
    offset += PAGE;
    if(offset > 400000) break; // safety stop
  }
  return out;
}

/* Dedupe construction-award rows to one record per pin keeping the max amount.
   Rows with no pin stand alone under a stable per-row surrogate key. */
function dedupeAwardsByPin(rows){
  const byPin = new Map();
  for(let i=0; i<rows.length; i++){
    const r = rows[i];
    const amt = parseFloat(r.contract_amount);
    if(!(amt > 0)) continue;
    const pin = r.pin || ('_np_' + i);
    const rec = { amt, agency: r.agency_name || null,
      month: r.start_date ? r.start_date.slice(0,7) : null };
    const prev = byPin.get(pin);
    if(!prev || rec.amt > prev.amt) byPin.set(pin, rec);
  }
  return [...byPin.values()];
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
/* First-of-month boundary n complete months before the current (incomplete)
   month, so the award window aligns to fully-elapsed months. Mirrors the
   Analysis index and the Briefing, keeping the three pages on one window.

   Anchored in UTC end to end. A local midnight formatted through toISOString
   reads back a day early for anyone east of UTC, which moved the whole trailing
   window and made the same page report different totals in Berlin than in New
   York. Date.UTC in, toISOString out, so every reader gets one window. */
function isoCompleteMonthBoundary(n){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1))
    .toISOString().slice(0,10);
}
function toQuarters(byMonth){
  const qs = new Map();
  for(const r of byMonth){
    const ym = r.m.slice(0,7), y = ym.slice(0,4), q = 'Q' + (Math.floor((+ym.slice(5,7)-1)/3)+1);
    const k = q + ' ’' + y.slice(2);
    qs.set(k, (qs.get(k)||0) + (parseFloat(r.s)||0));
  }
  return [...qs.entries()];
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function shortPeriod(p){ return MONTHS[+p.slice(4,6)-1] + ' ’' + p.slice(2,4); }
function periodLabel(a,b){ return shortPeriod(a) + ' → ' + shortPeriod(b); }
function fmtPeriodLong(p){ return ci.fmt(p, 'period-long'); }

/* TTM spend = last 3 inter-snapshot periods (≈12 months) */
function ttmSpend(){ return state.spendPeriods.slice(-3).reduce((a,p)=>a+p.total,0); }
function ttmSpendByAgency(){
  const m = new Map();
  for(const p of state.spendPeriods.slice(-3))
    for(const [a,v] of p.byAgency) m.set(a, (m.get(a)||0)+v);
  return m;
}

/* agency code (capital plan) -> City Record agency_name */
const CODE_TO_AWARD = {
  DDC:'Design and Construction', DOT:'Transportation', DEP:'Environmental Protection',
  DPR:'Parks and Recreation', DCAS:'Citywide Administrative Services', DSNY:'Sanitation',
  NYPD:'Police Department', HPD:'Housing Preservation and Development', FDNY:'Fire Department',
  DOC:'Correction', DOHMH:'Health and Mental Hygiene', DHS:'Homeless Services',
  ACS:'Children’s Services', DFTA:'Aging'
};
const AGENCY_NAMES = {
  DPR:'Parks & Recreation', DDC:'Design & Construction', DOT:'Transportation',
  EDC:'Economic Development', DEP:'Environmental Protection', HHC:'NYC Health + Hospitals',
  DCAS:'Citywide Admin Services', CUNY:'CUNY', NYPD:'Police', FDNY:'Fire',
  DCLA:'Cultural Affairs', DHS:'Homeless Services', DSNY:'Sanitation',
  QPL:'Queens Public Library', DOC:'Correction', DOHMH:'Health & Mental Hygiene',
  BPL:'Brooklyn Public Library', NYPL:'New York Public Library', HRA:'Human Resources Admin',
  DFTA:'Aging', ACS:'Children’s Services', DOE:'Education',
  HPD:'Housing Preservation & Dev', OTI:'Technology & Innovation'
};
function agencyLabel(code){ return AGENCY_NAMES[code] ? `${AGENCY_NAMES[code]} (${code})` : code; }

/* ================= formatting ================= */
function fmtMoney(v){ return ci.fmt(v, 'money'); }
function fmtInt(v){ return v.toLocaleString('en-US'); }
function esc(s){ const d = document.createElement('div'); d.textContent = String(s==null?'':s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); return d.innerHTML; }

/* ================= rendering ================= */
const COLOR_A = '#a8462c', COLOR_B = '#243b53', COLOR_C = '#276b45', GRID = '#e6ddd5';
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

function renderKpis(){
  const committed = state.pipeline.total, spent = ttmSpend();
  const latest = state.periods[state.periods.length-1];
  document.getElementById('kpi-committed').textContent = fmtMoney(committed);
  document.getElementById('kpi-committed-note').textContent = 'open pipeline, ' + fmtPeriodLong(latest) + ' plan';
  document.getElementById('kpi-awarded').textContent = state.awardsOk ? fmtMoney(state.awards.ttm) : '–';
  document.getElementById('kpi-awarded-note').textContent = state.awardsOk
    ? fmtInt(state.awards.count) + ' construction awards, trailing 12 months'
    : 'award record temporarily unavailable';
  document.getElementById('kpi-spent').textContent = fmtMoney(spent);
  document.getElementById('kpi-spent-note').textContent = 'capital outlays, trailing year of plan snapshots';
  document.getElementById('kpi-coverage').textContent = spent > 0 ? (committed/spent).toFixed(1) + ' yrs' : '–';
}

/* Fiscal-year window label for Paid, read only from the Checkbook file's meta.
   fiscal_years is the ascending list the numbers cover; fiscal_year_ytd names
   the in-progress year inside it (NYC FY N = Jul 1 N-1 to Jun 30 N), which is
   labeled year to date. Files written before fiscal_year_ytd existed carry only
   closed years and read as before. No years are hardcoded here or in the prose. */
function cbkFYLabel(meta){
  var ys=(meta&&Array.isArray(meta.fiscal_years))?meta.fiscal_years.filter(function(y){return isFinite(+y);}).map(Number):[];
  if(!ys.length) return { short:'Checkbook FYs', long:'the fiscal years Checkbook publishes' };
  var ytd=(meta&&meta.fiscal_year_ytd!=null&&ys.indexOf(+meta.fiscal_year_ytd)!==-1)?+meta.fiscal_year_ytd:null;
  var closed=ys.filter(function(y){return y!==ytd;});
  var yy=function(y){return String(y).slice(2);};
  var cs='', cl='';
  if(closed.length===1){ cs='FY'+yy(closed[0]); cl='fiscal year '+closed[0]; }
  else if(closed.length>1){ var a=closed[0], b=closed[closed.length-1];
    cs='FY'+yy(a)+'–'+yy(b); cl='fiscal years '+a+' to '+b; }
  if(ytd===null) return { short:cs, long:cl };
  var ys_='FY'+yy(ytd)+' YTD', yl='fiscal year '+ytd+' to date';
  if(!closed.length) return { short:ys_, long:yl };
  return { short:cs+' + '+ys_, long:cl+' plus '+yl };
}
function cbkFY(){ return cbkFYLabel(state.checkbook.meta); }
function renderStages(){
  const stages = [
    { t:'Committed', s:'stock · full capital plan, unspent', v: state.pipeline.total, c: COLOR_B },
    { t:'Awarded', s:'flow · construction awards, TTM', v: state.awards.ttm, c: COLOR_A },
    { t:'Spent', s:'flow · capital outlays, trailing year', v: ttmSpend(), c: COLOR_C }
  ];
  // Paid (Checkbook): a fourth, separate ledger. Disbursements on registered
  // construction contracts to named vendors, City scope, over the FY window in
  // the file's meta (cbkFY). Shown
  // only when the static Checkbook file loaded; never summed with Spent.
  if(state.checkbookOk){
    // The Paid gauge is the one figure on this page served from a nightly file
    // rather than fetched live, so it always carries the date of the file it came
    // from. Everything else here is as of load.
    const asOf = cbkAsOf();
    stages.push({ t:'Paid (Checkbook)',
      s:'disbursed · registered contracts, '+cbkFY().short + (asOf ? ' · as of '+asOf : ''),
      v: state.checkbook.paid, c: COLOR_B });
  }
  if(state.checkbookOk){
    const fyLong = cbkFY().long;
    document.querySelectorAll('.cbk-fy-long').forEach(function(el){ el.textContent = fyLong; });
  }
  document.getElementById('stages-title').textContent =
    state.checkbookOk ? 'Four gauges, not one flow' : 'Three gauges, not one flow';
  const max = Math.max(...stages.map(s=>s.v));
  document.getElementById('stage-rows').innerHTML = stages.map(s=>`
    <div class="stage-row">
      <div class="stage-name"><div class="s-t">${esc(s.t)}</div><div class="s-s">${esc(s.s)}</div></div>
      <div class="stage-bar-track"><div class="stage-bar" data-ci-style="width:${(s.v/max*100).toFixed(1)}%;background:${s.c}"></div></div>
      <div class="stage-val">${fmtMoney(s.v)}</div>
    </div>`).join('');
  const base = 'Each stage is a separate reading drawn from a different ledger. '
    + 'Committed is a stock from the full capital plan; Awarded covers two City Record procurement categories; '
    + 'Spent is full-plan outlays measured between plan snapshots. The scopes differ, so the bars do not net against each other. '
    + 'Each bar is scaled against the largest only to size it on screen; the gauges sit on different ledgers and time windows, so their lengths are not a like-for-like comparison.';
  const cbkNote = state.checkbookOk
    ? ' Paid (Checkbook) is a different ledger again: disbursements on registered construction contracts to named vendors, '
      + 'NYC City scope, ' + cbkFY().long + ', from the Comptroller’s Checkbook NYC. '
      + 'It is not the same number as Spent, which is capital-plan outlays across all construction between plan snapshots, '
      + 'and the two are not added together.'
    : '';
  // Checkbook cannot be called from a browser, so Paid is read from a file rebuilt
  // nightly. When that rebuild has not landed on time, say so on the figure rather
  // than let it pass as current.
  const asOf = cbkAsOf();
  const staleNote = (state.checkbookOk && state.checkbook.stale && asOf)
    ? ' The Checkbook file behind Paid has not refreshed since ' + asOf
      + '; that figure is ' + Math.floor(state.checkbook.ageHours / 24)
      + ' days old, while every other figure on this page is read live on load.'
    : '';
  document.getElementById('stages-sub').textContent = base + cbkNote + staleNote;

  /* Footer attribution follows the same rule as the figures. Plan and award are
     read live from Socrata on load, so they say "on load"; Paid is the one figure
     served from a nightly file, so it names Checkbook NYC and carries that
     file's date. When the Checkbook file is missing or too old to publish, the
     Paid gauge is not drawn and its clause disappears with it, rather than
     claiming a nightly refresh behind a figure the page is not showing. */
  const fsrc = document.getElementById('f-paid-src');
  if(fsrc){
    const fAsOf = cbkAsOf();
    fsrc.textContent = state.checkbookOk
      ? '; Paid from Checkbook NYC' + (fAsOf ? ', as of ' + fAsOf : '')
      : '';
  }
}

function vBar(canvasId, labels, data, color){
  destroy(canvasId);
  charts[canvasId] = new Chart(document.getElementById(canvasId), {
    type:'bar',
    data:{ labels, datasets:[{ data, backgroundColor: color, borderRadius:1 }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{callbacks:{label:(c)=> fmtMoney(c.parsed.y)}} },
      scales:{
        x:{grid:{display:false}, ticks:{maxRotation:0}},
        y:{grid:{color:GRID}, border:{display:false}, ticks:{callback:(v)=>fmtMoney(v), maxTicksLimit:5}}
      }
    }
  });
}

function renderTrends(){
  vBar('chart-spend', state.spendPeriods.map(p=>p.label), state.spendPeriods.map(p=>p.total), COLOR_C);
  if(state.awardsOk){
    vBar('chart-award', state.awards.byQuarter.map(q=>q[0]), state.awards.byQuarter.map(q=>q[1]), COLOR_A);
  }
}

function renderVelocity(){
  const spend = ttmSpendByAgency();
  // Same $10M trailing-spend floor the Agency Velocity page uses: below it, the
  // agency's own outlay line is too small to anchor a backlog ratio (its capital
  // work is mostly delivered under another managing agency), so the ratio is a
  // dash rather than a noise figure. Keeps the two pages identical.
  const MIN_SPEND = 10e6;
  // Floor on what is printable as a trailing-year outlay at all. An agency whose
  // whole year of self-delivered spending lands in the thousands is not spending
  // slowly, it is not the builder: the outlay sits under another managing agency.
  // Printing the residue next to a pipeline in the hundreds of millions reads as
  // a broken figure, so it is suppressed the same way the ratio is.
  const MIN_SHOWN_SPEND = 1e6;
  const rows = [...state.pipeline.byAgency.entries()]
    .sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([code, pipe]) => {
      const sp = spend.get(code) || 0;
      const awardName = CODE_TO_AWARD[code];
      const aw = awardName ? state.awards.byAgency.get(awardName) : undefined;
      const yrs = sp >= MIN_SPEND ? pipe/sp : null;
      return { code, pipe, sp, aw, yrs };
    });
  const medianYrs = (()=>{ const v = rows.filter(r=>r.yrs!==null).map(r=>r.yrs).sort((a,b)=>a-b);
    return v.length ? v[Math.floor(v.length/2)] : 0; })();
  document.querySelector('#tbl-velocity tbody').innerHTML = rows.map(r=>`<tr>
    <td><span class="t-title">${esc(agencyLabel(r.code))}</span></td>
    <td class="num amt">${fmtMoney(r.pipe)}</td>
    <td class="num amt">${r.sp >= MIN_SHOWN_SPEND ? fmtMoney(r.sp) : '<span class="na">–</span>'}</td>
    <td class="num amt">${r.aw!==undefined ? fmtMoney(r.aw) : '–'}</td>
    <td class="num"><span class="yrs ${r.yrs===null?'':(r.yrs>medianYrs*1.5?'slow':(r.yrs<medianYrs*.67?'fast':''))}">${r.yrs===null?'–':r.yrs.toFixed(1)}</span></td>
  </tr>`).join('');
}

/* ================= init ================= */
function unavailNote(host){
  return `<div class="unavail"><span>This dataset (${host}) is temporarily unavailable. The rest of the page reflects what loaded.</span><button type="button" class="ci-btn" data-action="reload">Retry</button></div>`;
}

(async function init(){
  const [planR, awardsR, cbkR] = await Promise.allSettled([fetchPlan(), fetchAwards(), fetchCheckbook()]);
  state.planOk = planR.status === 'fulfilled';
  state.awardsOk = awardsR.status === 'fulfilled';
  state.checkbookOk = cbkR.status === 'fulfilled' && state.checkbook.ok;

  // The capital plan anchors the page (committed, spent, velocity, the as-of
  // line). If it is unavailable there is nothing to scaffold, so show the error.
  if(!state.planOk){
    document.getElementById('loader').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    return;
  }
  const latest = state.periods[state.periods.length-1];
  document.getElementById('asof').innerHTML =
    `Capital plan through <strong>${fmtPeriodLong(latest)}</strong> · awards through today · spending measured across ${state.spendPeriods.length} plan-to-plan periods`;
  document.getElementById('series-asof').textContent = fmtPeriodLong(latest).toUpperCase();
  document.getElementById('loader').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  if(!state.awardsOk){
    document.getElementById('award-trend').insertAdjacentHTML('beforebegin', unavailNote('City Record awards'));
  }
  renderKpis();
  renderStages();
  renderTrends();
  renderVelocity();
})();
