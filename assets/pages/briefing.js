'use strict';
/* ================= data ================= */
const PLAN_API = 'https://data.cityofnewyork.us/resource/fb86-vt7u.json';
const AWARD_API = 'https://data.cityofnewyork.us/resource/qyyg-4tf5.json';
const MEGA = 500e6; // $500M+ megaprojects are excluded from the trend, same as the Analysis index

async function getJSON(api, params){
  const res = await fetch(api + '?' + new URLSearchParams(params), { headers: { 'X-App-Token': '3TAzQQPiSG2T4WGWfYYUxxqfJ' } });
  if(!res.ok) throw new Error('API ' + res.status);
  return res.json();
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
/* First-of-month boundary n months before the current (incomplete) month, so the
   trend windows align to fully-elapsed months. Mirrors the Analysis index, which
   ends on the last complete month and never reads the partial current month.

   Anchored in UTC end to end. A local midnight formatted through toISOString
   reads back a day early for anyone east of UTC, which moved both the trailing
   and the prior window and made the briefing report different figures depending
   on where it was opened. Date.UTC in, toISOString out, one window per reader. */
function isoCompleteMonthBoundary(n){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1))
    .toISOString().slice(0,10);
}
/* A renewal or extension is a continuation of existing work, not new demand. The
   selection method carries 'Renewal'/'Extension'; same test the Analysis index uses. */
function isContinuation(m){ return /renewal|extension/i.test(m||''); }

/* Paged pull of construction award rows since a date, only the fields used.
   The lower bound is inclusive (>=), the one convention across the site. Here it
   is only the fetch margin, several months wider than either reported window, so
   the caller's own [c12, c0) and [c24, c12) tests still decide what counts. */
async function fetchAwardRows(since){
  const PAGE = 50000;
  let offset = 0; const out = [];
  for(;;){
    const batch = await getJSON(AWARD_API, {
      '$select':'pin,contract_amount,start_date,agency_name,category_description,selection_method_description',
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
      cat: r.category_description || '',
      method: r.selection_method_description || '',
      day: r.start_date ? r.start_date.slice(0,10) : null };
    const prev = byPin.get(pin);
    if(!prev || rec.amt > prev.amt) byPin.set(pin, rec);
  }
  return [...byPin.values()];
}

/* plan normalization, same rules as Pipeline/Funnel pages */
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
const PRE_CON = new Set(['Pending','Pre-Design','Design','Procurement']);
function normPhase(raw){
  const p = (raw||'').replace(/[()]/g,'').trim().toLowerCase();
  if(EXCLUDED.has(p)) return 'excluded';
  return PHASE_MAP[p] || 'Other active';
}
function phaseRank(b){ const i = PHASE_ORDER.indexOf(b); return i===-1?-1:(b==='Other active'?-1:i); }
function collapseSnapshot(rows){
  const m = new Map();
  for(const r of rows){
    const key = (r.managing_agency||'') + '|' + (r.fms_id||r.fms_project_name||'');
    const bucket = normPhase(r.current_phase);
    const rec = { agency:r.managing_agency||'–',
      spend:Math.max(parseFloat(r.spend_to_date)||0,0),
      budget:Math.max(parseFloat(r.total_budget)||0,0), bucket };
    const prev = m.get(key);
    if(!prev || phaseRank(bucket) > phaseRank(prev.bucket)) m.set(key, rec);
  }
  return m;
}

const AGENCY_FULL = {
  DPR:'Parks & Recreation', DDC:'the Department of Design & Construction', DOT:'the Department of Transportation',
  EDC:'the Economic Development Corporation', DEP:'the Department of Environmental Protection',
  HHC:'NYC Health + Hospitals', DCAS:'Citywide Administrative Services', CUNY:'CUNY', NYPD:'the NYPD',
  FDNY:'the FDNY', DCLA:'Cultural Affairs', DHS:'Homeless Services', DSNY:'Sanitation',
  DOC:'Correction', DOHMH:'Health & Mental Hygiene', HPD:'Housing Preservation & Development'
};
const AWARD_AGENCY_SHORT = {
  'Design and Construction':'the Department of Design & Construction',
  'Environmental Protection':'the Department of Environmental Protection',
  'Parks and Recreation':'Parks & Recreation', 'Transportation':'the Department of Transportation',
  'Citywide Administrative Services':'Citywide Administrative Services', 'Sanitation':'Sanitation',
  'Police Department':'the NYPD', 'Fire Department':'the FDNY',
  'Housing Preservation and Development':'Housing Preservation & Development'
};

const D = {}; // computed facts

/* The award record (City Record) and the capital plan (OMB) are independent
   sources, settled separately so one being down does not blank the other's
   section of the briefing. */
async function fetchAwardsData(){
  // Windows align to complete months, mirroring the Analysis index: the partial
  // current month is excluded from BOTH the trailing-12 and prior-12 windows, so
  // City Record back-fill lag (recent months are under-reported) cannot drag the
  // year-over-year comparison down. Trailing 12 = [c12, c0); prior 12 = [c24, c12).
  const c0 = isoCompleteMonthBoundary(0);   // first of the current incomplete month
  const c12 = isoCompleteMonthBoundary(12);
  const c24 = isoCompleteMonthBoundary(24);
  // Pull a margin past the prior window so dedupe sees every notice for those pins.
  const awardRows = await fetchAwardRows(isoMonthsAgo(27));
  const deduped = dedupeAwardsByPin(awardRows);
  let ttmS=0, ttmN=0, priorS=0, hardS=0;
  const awByAg = new Map();
  for(const r of deduped){
    if(!r.day) continue;
    // Exclude $500M+ megaprojects and renewals/extensions from the trend, same as
    // the Analysis index, so neither window is distorted by one-off giants or by
    // continuations that are not new market demand.
    if(r.amt >= MEGA || isContinuation(r.method)) continue;
    const inTTM = r.day >= c12 && r.day < c0;
    const inPrior = r.day >= c24 && r.day < c12;
    if(inTTM){
      ttmS += r.amt; ttmN += 1;
      if(r.agency) awByAg.set(r.agency, (awByAg.get(r.agency)||0) + r.amt);
      if(r.cat === 'Construction/Construction Services') hardS += r.amt;
    } else if(inPrior){
      priorS += r.amt;
    }
  }
  D.awardTTM = ttmS;
  D.awardCount = ttmN;
  D.awardPrior = priorS;
  D.awardDelta = D.awardPrior>0 ? (D.awardTTM-D.awardPrior)/D.awardPrior*100 : null;
  const topAg = [...awByAg.entries()].sort((a,b)=>b[1]-a[1])[0];
  D.topAwardAgency = { agency_name: topAg ? topAg[0] : '', s: topAg ? topAg[1] : 0 };
  D.topAwardShare = D.awardTTM>0 && topAg ? topAg[1]/D.awardTTM*100 : 0;
  D.hardShare = D.awardTTM>0 ? hardS/D.awardTTM*100 : 0;

  // latest award date
  const last = await getJSON(AWARD_API, {'$select':'start_date',
    '$where':`starts_with(category_description,'Construction')`,'$order':'start_date DESC','$limit':'1'});
  D.latestAward = last[0] ? new Date(last[0].start_date) : null;
}

async function fetchPlanData(){
  const periods = await getJSON(PLAN_API, {'$select':'reporting_period','$group':'reporting_period','$order':'reporting_period DESC','$limit':'4'});
  const ps = periods.map(p=>p.reporting_period).sort();
  D.periods = ps;
  const snaps = await Promise.all(ps.map(p => getJSON(PLAN_API, {
    '$select':'fms_id,fms_project_name,managing_agency,spend_to_date,total_budget,current_phase',
    '$where': `reporting_period='${p}'`, '$limit':'20000'
  })));
  const maps = ps.map((p,i)=>collapseSnapshot(snaps[i]));

  // pipeline (latest snapshot)
  const latest = maps[maps.length-1];
  let pipe=0, pre=0, count=0; const byAg = new Map();
  for(const rec of latest.values()){
    if(rec.bucket==='excluded'||rec.bucket==='Close-out') continue;
    const u = Math.max(rec.budget-rec.spend,0);
    pipe+=u; count++;
    if(PRE_CON.has(rec.bucket)) pre+=u;
    byAg.set(rec.agency,(byAg.get(rec.agency)||0)+u);
  }
  D.pipe=pipe; D.pipePre=pre; D.pipeCount=count;
  D.topPipeAgency = [...byAg.entries()].sort((a,b)=>b[1]-a[1])[0];

  // spend TTM = 3 deltas across 4 snapshots, on a MATCHED PANEL, the same rule
  // the Pipeline and Funnel pages use. Only projects present in BOTH snapshots
  // contribute. spend_to_date is a lifetime cumulative figure, so a project seen
  // for the first time carries its whole back-history; counting it from zero
  // would book years of prior spending into the single period it first appears.
  // The matched panel measures growth where a prior reading exists, nowhere else.
  D.spendTTM = 0;
  for(let i=1;i<maps.length;i++){
    for(const [key,rec] of maps[i]){
      // Match the pipeline loop's scope: completed/cancelled/land-acquisition/
      // IT/equipment/consultant-services lines are not construction demand and
      // must not inflate the denominator under a numerator that already drops
      // them. Close-out IS kept here (unlike the pipeline sum): spend booked
      // while a project winds down is real construction cash paid out, even
      // though its remaining unspent balance no longer counts as pipeline.
      if(rec.bucket==='excluded') continue;
      const was = maps[i-1].get(key);
      if(!was) continue; // new entrant: no prior reading, so no measurable period spend
      D.spendTTM += Math.max(rec.spend - was.spend, 0);
    }
  }
  D.coverage = D.spendTTM>0 ? D.pipe/D.spendTTM : null;
}

/* ================= language ================= */
function fmtMoney(v){ return ci.fmt(v, 'money'); }
function fmtInt(v){ return v.toLocaleString('en-US'); }
function fmtPct(v){ return ci.fmt(v, 'pct-abs'); }
function fmtPeriodLong(p){ return ci.fmt(p, 'period-long'); }
function trendWord(d){
  if(d===null) return 'shifted';
  if(d<=-15) return 'contracted';
  if(d<0) return 'edged lower';
  if(d<5) return 'held roughly steady';
  if(d<15) return 'firmed';
  return 'expanded';
}
function num(s){ return `<span class="num">${s}</span>`; }
function capFirst(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
function esc(s){ var d=document.createElement('div'); d.textContent=String(s==null?'':s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); return d.innerHTML; }

/* ================= composition ================= */
function unavailNote(host){
  return `<div class="brief-unavail"><span>This dataset (${host}) is temporarily unavailable. The rest of the briefing reflects what loaded.</span><button type="button" class="ci-btn" data-action="reload">Retry</button></div>`;
}

function compose(){
  const dateStr = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const latestPlan = D.planOk ? fmtPeriodLong(D.periods[D.periods.length-1]) : null;
  const latestAwardStr = (D.awardsOk && D.latestAward) ? D.latestAward.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : null;

  document.getElementById('asof').innerHTML =
    `Generated <strong>${dateStr}</strong> from the live public record` +
    (latestAwardStr ? ` · latest award ${latestAwardStr}` : '') +
    (latestPlan ? ` · ${latestPlan} capital plan` : '');

  document.getElementById('stats').innerHTML = [
    ['Awarded, TTM · new work', D.awardsOk ? fmtMoney(D.awardTTM) : '–', ''],
    ['New work vs prior year', D.awardsOk && D.awardDelta!==null ? (D.awardDelta>=0?'+':'−') + fmtPct(D.awardDelta) : '–',
      'Dollars awarded, both years on the same new-work basis; the year-over-year on the “Analysis” page is a composite of value and count.'],
    ['Open pipeline', D.planOk ? fmtMoney(D.pipe) : '–', ''],
    ['Backlog coverage', D.planOk && D.coverage ? D.coverage.toFixed(1)+' yrs' : '–', '']
  ].map(([l,v,n],i)=>`<div class="kpi${i===0?' hl':''}"><div class="k-label">${l}</div><div class="k-value">${v}</div>${n?`<div class="k-note">${n}</div>`:''}</div>`).join('');

  const market = D.awardDelta!==null && D.awardDelta<=-15 ?
    `For contractors, the near-term market is thinner: fewer and smaller opportunities are reaching bid. For the City, the same numbers read as a widening gap between what is funded and what is getting built.` :
    D.awardDelta!==null && D.awardDelta>=15 ?
    `For contractors, the near-term market is expanding: more work is reaching bid, and capacity will be the binding constraint.` :
    `For contractors, the near-term market is steady, with opportunity concentrated in the agencies driving the current award flow.`;

  const blocks = [];
  if(D.awardsOk){
    blocks.push(`<h2>The award market</h2><p>New York City agencies awarded ${num(fmtMoney(D.awardTTM))} of new construction and construction-services work over the trailing twelve months, across ${num(fmtInt(D.awardCount))} contract awards. That is a new-work total: renewals and extensions of existing contracts are held out, as are single awards of $500M and up. Award volume has ${trendWord(D.awardDelta)}, ${D.awardDelta!==null ? num((D.awardDelta>=0?'+':'−')+fmtPct(D.awardDelta)) + ' versus the preceding twelve months' : 'with no prior-year comparison available'}. Hard construction makes up ${num(fmtPct(D.hardShare))} of awarded value; design, engineering, and construction management make up the rest. ${D.topAwardAgency.agency_name ? esc(capFirst(AWARD_AGENCY_SHORT[D.topAwardAgency.agency_name]||D.topAwardAgency.agency_name))+' is the busiest buyer, accounting for '+num(fmtPct(D.topAwardShare))+' of trailing-year award value.' : ''}</p>`);
  } else {
    blocks.push(`<h2>The award market</h2>${unavailNote('City Record awards')}`);
  }
  if(D.planOk){
    blocks.push(`<h2>The pipeline behind it</h2><p>Behind the award market sits a funded pipeline of ${num(fmtMoney(D.pipe))}, budgets committed to ${num(fmtInt(D.pipeCount))} open capital projects in the City's ${latestPlan} plan that have not yet been spent. ${num(fmtPct(D.pipe>0?D.pipePre/D.pipe*100:0))} of that money is attached to projects still in pre-construction (pending, pre-design, design, or procurement): demand that has not yet reached the market. ${D.topPipeAgency ? esc(capFirst(AGENCY_FULL[D.topPipeAgency[0]]||D.topPipeAgency[0]))+' holds the largest share of the pipeline at '+num(fmtMoney(D.topPipeAgency[1]))+'.' : ''}</p>`);
    blocks.push(`<h2>The pace of conversion</h2><p>The City paid out ${num(fmtMoney(D.spendTTM))} on capital projects over the trailing year of plan snapshots. ${D.coverage!=null ? `At that pace, the current funded pipeline represents ${num(D.coverage.toFixed(1)+' years')} of work, the demand-side equivalent of a contractor's backlog ratio. ` : `Trailing-year spend is not yet measurable from the plan snapshots, so a backlog-coverage ratio is not shown. `}${D.awardsOk ? market : ''}</p>`);
  } else {
    blocks.push(`<h2>The pipeline behind it</h2>${unavailNote('OMB capital plan')}`);
  }
  document.getElementById('brief-body').innerHTML = blocks.join('');
}

(async function init(){
  const [awardsR, planR] = await Promise.allSettled([fetchAwardsData(), fetchPlanData()]);
  D.awardsOk = awardsR.status === 'fulfilled';
  D.planOk = planR.status === 'fulfilled';
  if(!D.awardsOk && !D.planOk){
    document.getElementById('loader').style.display='none';
    document.getElementById('error').style.display='block';
    return;
  }
  document.getElementById('loader').style.display='none';
  document.getElementById('app').style.display='block';
  compose();
})();
