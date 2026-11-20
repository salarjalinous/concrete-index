'use strict';
/* ================= data ================= */
const AWARD_API = 'https://data.cityofnewyork.us/resource/qyyg-4tf5.json';
const PLAN_API = 'https://data.cityofnewyork.us/resource/fb86-vt7u.json';
const MEGA = 500e6;

async function getJSON(api, params){
  const res = await fetch(api + '?' + new URLSearchParams(params), { headers: { 'X-App-Token': '3TAzQQPiSG2T4WGWfYYUxxqfJ' } });
  if(!res.ok) throw new Error('API ' + res.status);
  return res.json();
}
function isContinuation(m){ return /renewal|extension/i.test(m||''); }

/* plan normalization, same rules as the rest of the site */
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
const PHASE_ORDER = ['Pending','Pre-Design','Design','Procurement','Construction','Close-out'];
function normPhase(raw){
  const p = (raw||'').replace(/[()]/g,'').trim().toLowerCase();
  if(EXCLUDED.has(p)) return 'excluded';
  return PHASE_MAP[p] || 'Other active';
}
function rank(b){ return PHASE_ORDER.indexOf(b); } // -1 for Other active/excluded
function collapseSnapshot(rows){
  const m = new Map();
  for(const r of rows){
    const key = (r.managing_agency||'') + '|' + (r.fms_id||r.fms_project_name||'');
    const bucket = normPhase(r.current_phase);
    const rec = { spend:Math.max(parseFloat(r.spend_to_date)||0,0),
      budget:Math.max(parseFloat(r.total_budget)||0,0), bucket };
    const prev = m.get(key);
    if(!prev || (rank(bucket) > rank(prev.bucket))) m.set(key, rec);
  }
  return m;
}

const D = {};

/* The award record (City Record) feeds the index and seasonality; the capital
   plan (OMB) feeds conversion, escalation, and the procurement-supply KPI. They
   are independent sources, settled separately so one being down does not blank
   the sections that depend on the other. */
async function fetchAwardsData(){
  // full award history (megas excluded), pulled as rows and deduped to one
  // record per pin (max contract_amount), then re-aggregated to the monthly
  // {m, sm, s, n} shape buildIndex consumes. Pulling rows lets the canonical
  // pin-dedupe apply; a raw server-side sum overstates by the duplicate share.
  D.monthly = await fetchMonthlyAwards();
}

async function fetchCostData(){
  // Same-origin read of the BLS-derived construction-cost series written by the
  // nightly archive. The browser cannot reach api.bls.gov (locked connect-src),
  // so the cost series is pre-fetched server-side into /data/cost-index.json.
  const res = await fetch('/data/cost-index.json', { cache:'no-store' });
  if(!res.ok) throw new Error('cost ' + res.status);
  D.cost = await res.json();
}

async function fetchPlanData(){
  // plan snapshots: earliest, prior two, latest
  const periods = (await getJSON(PLAN_API, {
    '$select':'reporting_period','$group':'reporting_period','$order':'reporting_period','$limit':'60'
  })).map(p=>p.reporting_period);
  const need = [periods[0], ...periods.slice(-3)]; // earliest + last three
  const FIELDS = 'fms_id,fms_project_name,managing_agency,spend_to_date,total_budget,current_phase';
  const snapRows = await Promise.all(need.map(p => getJSON(PLAN_API, {
    '$select': FIELDS, '$where': `reporting_period='${p}'`, '$limit':'20000'
  })));
  D.periods = need;
  D.snaps = snapRows.map(collapseSnapshot);
}

/* Paged pull of mega-capped construction award rows, deduped to one record per
   pin (max contract_amount), then aggregated to one row per (month, type) in the
   {m, sm, s, n} shape buildIndex expects. sm is 'Renewal' for continuations and
   '' for new awards, so the existing isContinuation(r.sm) filter still works. */
async function fetchMonthlyAwards(){
  const PAGE = 50000;
  let offset = 0;
  const byPin = new Map();
  const where = `starts_with(category_description,'Construction') AND contract_amount>0 AND contract_amount<${MEGA}`;
  for(;;){
    const batch = await getJSON(AWARD_API, {
      '$select':'pin,contract_amount,start_date,selection_method_description',
      '$where': where, '$order':'pin', '$limit':String(PAGE), '$offset':String(offset)
    });
    for(let i=0; i<batch.length; i++){
      const r = batch[i];
      const amt = parseFloat(r.contract_amount);
      if(!(amt > 0) || amt >= MEGA) continue;
      const pin = r.pin || ('_np_' + offset + '_' + i);
      const rec = { amt, m: r.start_date ? r.start_date.slice(0,7) : null,
        cont: isContinuation(r.selection_method_description) };
      const prev = byPin.get(pin);
      if(!prev || rec.amt > prev.amt) byPin.set(pin, rec);
    }
    if(batch.length < PAGE) break;
    offset += PAGE;
    if(offset > 400000) break; // safety stop
  }
  // aggregate to {m, sm, s, n}
  const agg = new Map();   // m|cont -> {m, sm, s, n}
  for(const rec of byPin.values()){
    if(!rec.m) continue;
    const key = rec.m + '|' + (rec.cont ? 1 : 0);
    let e = agg.get(key);
    if(!e){ e = { m: rec.m, sm: rec.cont ? 'Renewal' : '', s: 0, n: 0 }; agg.set(key, e); }
    e.s += rec.amt; e.n += 1;
  }
  return [...agg.values()].sort((a,b)=> a.m<b.m?-1:(a.m>b.m?1:0));
}

/* ================= the index ================= */
function buildIndex(){
  // monthly new-award value/count
  const byMonth = new Map();
  for(const r of D.monthly){
    if(isContinuation(r.sm)) continue;
    const m = r.m.slice(0,7);
    const cur = byMonth.get(m) || {v:0,c:0};
    cur.v += parseFloat(r.s)||0; cur.c += parseInt(r.n)||0;
    byMonth.set(m, cur);
  }
  /* Continuous month list from 2003-01 through the last COMPLETE month.
     The keys have to match the raw start_date prefixes the rows are bucketed
     under above, so they are built in UTC. A local first-of-month put through
     toISOString names the PREVIOUS month for any reader east of UTC, which slid
     the whole series one month off its own data and gave the index a different
     value abroad than at home. Date.UTC in, toISOString out. */
  const now = new Date();
  const lastComplete = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1); // exclude current month
  const months = [];
  for(let mi = 0, t = Date.UTC(2003, 0, 1); t < lastComplete; t = Date.UTC(2003, ++mi, 1)){
    months.push(new Date(t).toISOString().slice(0,7));
  }
  const v = months.map(m => (byMonth.get(m)||{v:0}).v);
  const c = months.map(m => (byMonth.get(m)||{c:0}).c);
  // trailing-12 sums
  const ttmMonths = [], ttmV = [], ttmC = [];
  let sv=0, sc=0;
  for(let i=0;i<months.length;i++){
    sv+=v[i]; sc+=c[i];
    if(i>=12){ sv-=v[i-12]; sc-=c[i-12]; }
    if(i>=11){ ttmMonths.push(months[i]); ttmV.push(sv); ttmC.push(sc); }
  }
  // base = 2019 average
  const baseIdx = ttmMonths.map((m,i)=>m.startsWith('2019')?i:-1).filter(i=>i>=0);
  const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
  const baseV = baseIdx.length ? mean(baseIdx.map(i=>ttmV[i])) : ttmV[0];
  const baseC = baseIdx.length ? mean(baseIdx.map(i=>ttmC[i])) : ttmC[0];
  const idx = ttmMonths.map((m,i)=> 100*Math.sqrt((ttmV[i]/baseV)*(ttmC[i]/baseC)));
  D.idx = { months: ttmMonths, values: idx };
  D.monthlyNew = { months, v };
  // monthly new-award value AND count, kept for the cost-adjusted build below
  D.monthlyVC = { months, v, c };
}

/* ================= cost-adjusted index ================= */
/* Deflate each award month's nominal value by THAT month's construction-cost
   deflator (60% materials, 40% labor, 2019 = 100), sum to trailing-twelve real
   value, then apply the same geometric blend with the unchanged award count.
   The nominal index is left untouched; this runs alongside it. */
function buildAdjusted(){
  const cost = D.cost;
  if(!cost || !Array.isArray(cost.series) || !cost.series.length) return false;
  const deflByMonth = new Map();
  for(const s of cost.series){ if(s && s.month != null && s.deflator != null) deflByMonth.set(s.month, +s.deflator); }
  if(!deflByMonth.size) return false;
  const firstDefl = +cost.series[0].deflator;
  const lastDeflMonth = cost.series[cost.series.length-1].month;
  const lastDefl = +cost.series[cost.series.length-1].deflator;
  const { months, v, c } = D.monthlyVC;
  // real (deflated) monthly value. Award months past the last published cost
  // month are forward-filled at the latest deflator (BLS posts a month or two
  // behind, so the most recent award month has no own-month figure yet); award
  // months before the series begins fall back to the earliest deflator.
  const realV = months.map((m,i)=>{
    const d = deflByMonth.has(m) ? deflByMonth.get(m)
              : (m > lastDeflMonth ? lastDefl : firstDefl);
    return (d>0) ? v[i] / (d/100) : v[i];
  });
  // trailing-twelve nominal value, real value, count
  const tM=[], tNom=[], tReal=[], tC=[];
  let sn=0, sr=0, sc=0;
  for(let i=0;i<months.length;i++){
    sn+=v[i]; sr+=realV[i]; sc+=c[i];
    if(i>=12){ sn-=v[i-12]; sr-=realV[i-12]; sc-=c[i-12]; }
    if(i>=11){ tM.push(months[i]); tNom.push(sn); tReal.push(sr); tC.push(sc); }
  }
  const bi = tM.map((m,i)=>m.startsWith('2019')?i:-1).filter(i=>i>=0);
  const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
  const bNom = bi.length ? mean(bi.map(i=>tNom[i])) : tNom[0];
  const bReal = bi.length ? mean(bi.map(i=>tReal[i])) : tReal[0];
  const bC = bi.length ? mean(bi.map(i=>tC[i])) : tC[0];
  const nominal = tM.map((m,i)=> 100*Math.sqrt((tNom[i]/bNom)*(tC[i]/bC)));
  const adjusted = tM.map((m,i)=> 100*Math.sqrt((tReal[i]/bReal)*(tC[i]/bC)));
  // cumulative cost inflation since 2019 from the latest deflator-bearing series points
  const ser = cost.series;
  const lastCost = ser[ser.length-1];
  D.adj = {
    months: tM, nominal, adjusted,
    matCum: lastCost ? (lastCost.materials - 100) : null,
    labCum: lastCost ? (lastCost.labor - 100) : null,
    deflLatest: lastCost ? lastCost.deflator : null,
    costMonth: lastCost ? lastCost.month : null,
    ff: lastCost ? !!lastCost.ff : false
  };
  return true;
}

/* ================= seasonality ================= */
function buildSeasonality(){
  const { months, v } = D.monthlyNew;
  const years = {};
  months.forEach((m,i)=>{
    const y = m.slice(0,4);
    (years[y] = years[y] || Array(12).fill(0))[+m.slice(5,7)-1] += v[i];
  });
  // UTC year, so the seasonal panel does not gain or lose a year over New Year
  // depending on which side of the date line the reader is sitting on.
  const lastFullYear = new Date().getUTCFullYear()-1;
  const shares = Array.from({length:12}, ()=>[]);
  for(const y of Object.keys(years)){
    if(+y < 2004 || +y > lastFullYear) continue;
    const tot = years[y].reduce((a,b)=>a+b,0);
    if(tot<=0) continue;
    years[y].forEach((mv,mi)=> shares[mi].push(mv/tot*12));
  }
  const median = a => { const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
  D.season = shares.map(median);
}

/* ================= conversion ================= */
function buildConversion(){
  // pooled over last two transitions: snaps[1]→snaps[2], snaps[2]→snaps[3]
  const stats = {};
  for(const ph of ['Pending','Pre-Design','Design','Procurement']) stats[ph] = {n:0, adv:0, held:0};
  for(let t=1; t<3; t++){
    const a = D.snaps[t], b = D.snaps[t+1];
    for(const [key, ra] of a){
      if(!(ra.bucket in stats)) continue;
      const rb = b.get(key);
      if(!rb || rb.bucket==='excluded') continue;
      stats[ra.bucket].n++;
      if(rank(rb.bucket) > rank(ra.bucket)) stats[ra.bucket].adv++;
      else if(rb.bucket === ra.bucket) stats[ra.bucket].held++;
    }
  }
  D.conv = stats;
  // nearest-term award supply: unspent in Procurement, latest snapshot
  let proc = 0;
  for(const rec of D.snaps[3].values())
    if(rec.bucket==='Procurement') proc += Math.max(rec.budget-rec.spend,0);
  D.procUnspent = proc;
}

/* ================= escalation ================= */
function buildEscalation(){
  const a = D.snaps[0], b = D.snaps[3];
  const growths = [];
  let added = 0;
  for(const [key, ra] of a){
    const rb = b.get(key);
    if(!rb || ra.budget < 1e6 || rb.budget < 1e6) continue;
    growths.push({ key, g: rb.budget/ra.budget - 1 });
    added += rb.budget - ra.budget;
  }
  growths.sort((x,y)=>x.g-y.g);
  const median = growths.length ? growths[Math.floor(growths.length/2)].g : 0;
  const grew = growths.filter(x=>x.g>0.05).length;
  // per-agency medians (agency = key prefix), min 30 matched projects
  const byAg = new Map();
  for(const x of growths){
    const ag = x.key.split('|')[0];
    (byAg.get(ag) || byAg.set(ag, []).get(ag)).push(x.g);
  }
  const agRows = [...byAg.entries()].filter(([,v])=>v.length>=30)
    .map(([ag,v])=>{ v.sort((x,y)=>x-y); return [ag, v[Math.floor(v.length/2)], v.length]; })
    .sort((x,y)=>y[1]-x[1]).slice(0,8);
  D.esc = { n: growths.length, median, grewShare: growths.length? grew/growths.length : 0, added, agRows };
}

/* ================= formatting ================= */
const AGENCY_NAMES = {
  DPR:'Parks & Recreation', DDC:'Design & Construction', DOT:'Transportation',
  EDC:'Economic Development', DEP:'Environmental Protection', HHC:'NYC Health + Hospitals',
  DCAS:'Citywide Admin Services', CUNY:'CUNY', NYPD:'Police', FDNY:'Fire',
  DCLA:'Cultural Affairs', DHS:'Homeless Services', DSNY:'Sanitation',
  QPL:'Queens Public Library', DOC:'Correction', DOHMH:'Health & Mental Hygiene',
  BPL:'Brooklyn Public Library', NYPL:'New York Public Library', HRA:'Human Resources Admin',
  DFTA:'Aging', ACS:'Children’s Services', HPD:'Housing Preservation & Dev'
};
function agencyLabel(c){ return AGENCY_NAMES[c] ? `${AGENCY_NAMES[c]} (${c})` : c; }
function fmtMoney(v){
  if(v >= 1e9) return '$' + (v/1e9).toFixed(v >= 10e9 ? 1 : 2) + 'B';
  if(v >= 1e6) return '$' + (v/1e6).toFixed(v >= 100e6 ? 0 : 1) + 'M';
  return '$' + Math.round(v/1e3) + 'K';
}
function fmtInt(v){ return v.toLocaleString('en-US'); }
function fmtPct(v){ return (v*100).toFixed(0) + '%'; }
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtYM(m){ return MONTH_SHORT[+m.slice(5,7)-1] + ' ' + m.slice(0,4); }
function fmtPeriodLong(p){ return MONTH_NAMES[+p.slice(4,6)-1] + ' ' + p.slice(0,4); }

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
  // Award-sourced KPIs (the index and its year-on-year change).
  if(D.awardsOk){
    const { months, values } = D.idx;
    const last = values[values.length-1];
    const yoy = values.length>12 ? (last/values[values.length-13]-1)*100 : null;
    document.getElementById('kpi-idx').textContent = last.toFixed(1);
    document.getElementById('kpi-idx-note').textContent = fmtYM(months[months.length-1]) + ' · 2019 = 100';
    document.getElementById('kpi-yoy').innerHTML = yoy===null ? '–' :
      `<span class="${yoy>=0?'up':'down'}">${yoy>=0?'+':'−'}${Math.abs(yoy).toFixed(0)}%</span>`;
  } else {
    document.getElementById('kpi-idx').textContent = '–';
    document.getElementById('kpi-yoy').textContent = '–';
  }
  // Plan-sourced KPIs (nearest-term supply and budget escalation).
  if(D.planOk){
    document.getElementById('kpi-proc').textContent = fmtMoney(D.procUnspent);
    document.getElementById('kpi-esc').textContent = '+' + fmtPct(D.esc.median);
    document.getElementById('kpi-esc-note').textContent =
      `median project, ${fmtPeriodLong(D.periods[0])} → ${fmtPeriodLong(D.periods[3])}`;
  } else {
    document.getElementById('kpi-proc').textContent = '–';
    document.getElementById('kpi-esc').textContent = '–';
  }
}

function renderIndexChart(){
  const { months, values } = D.idx;
  destroy('idx');
  charts.idx = new Chart(document.getElementById('chart-idx'), {
    type:'line',
    data:{ labels: months.map(fmtYM), datasets:[{
      data: values, borderColor: COLOR_A, borderWidth: 2.2, pointRadius: 0,
      fill: {target:'origin'}, backgroundColor: 'rgba(174,78,52,0.07)', tension: .25
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{callbacks:{label:(c)=>'Index: '+c.parsed.y.toFixed(1)}} },
      scales:{
        x:{grid:{display:false}, ticks:{maxRotation:0, autoSkip:true, maxTicksLimit:12}},
        y:{grid:{color:GRID}, border:{display:false}, ticks:{maxTicksLimit:6}}
      }
    }
  });
  const { values: v, months: m } = D.idx;
  const last = v[v.length-1];
  const peak = v.reduce((a,x,i)=> x>v[a]?i:a, 0);
  document.getElementById('idx-reading').innerHTML =
    `<strong>Reading:</strong> the index stands at <strong>${last.toFixed(1)}</strong>, ` +
    (last<90 ? 'below its 2019 baseline' : last>110 ? 'above its 2019 baseline' : 'near its 2019 baseline') +
    `. The series peaked at <strong>${v[peak].toFixed(1)}</strong> in ${fmtYM(m[peak])}. ` +
    `Because megaprojects and renewals are excluded, this line tracks the breadth-and-volume cycle of new work reaching the market, not one-off awards.`;
}

/* ================= cost-adjusted rendering ================= */
const COLOR_MAT = '#a8462c', COLOR_LAB = '#243b53';
function fmtSignedPct(v){ return (v>=0?'+':'−') + Math.abs(v).toFixed(0) + '%'; }

function renderAdjKpis(){
  const a = D.adj;
  const lastAdj = a.adjusted[a.adjusted.length-1];
  const lastNom = a.nominal[a.nominal.length-1];
  const gap = lastNom - lastAdj;
  document.getElementById('kpi-adj').textContent = lastAdj.toFixed(1);
  document.getElementById('kpi-adj-note').textContent = fmtYM(a.months[a.months.length-1]) + ' · 2019 = 100';
  document.getElementById('kpi-gap').innerHTML = `<span class="down">−${gap.toFixed(1)}</span>`;
  document.getElementById('kpi-gap-note').textContent = 'index points below the nominal ' + lastNom.toFixed(1);
  if(a.matCum != null){
    document.getElementById('kpi-mat').innerHTML = `<span class="${a.matCum>=0?'up':'down'}">${fmtSignedPct(a.matCum)}</span>`;
  }
  if(a.labCum != null){
    document.getElementById('kpi-lab').innerHTML = `<span class="${a.labCum>=0?'up':'down'}">${fmtSignedPct(a.labCum)}</span>`;
  }
  document.getElementById('adj-cap').textContent =
    'MATERIALS +' + Math.round(a.matCum) + '% · LABOR +' + Math.round(a.labCum) + '% SINCE 2019';
}

function renderCostChart(){
  const ser = D.cost.series;
  const labels = ser.map(s=>fmtYM(s.month));
  destroy('cost');
  charts.cost = new Chart(document.getElementById('chart-cost'), {
    type:'line',
    data:{ labels, datasets:[
      { label:'Materials (national)', data: ser.map(s=>s.materials), borderColor: COLOR_MAT, borderWidth: 2, pointRadius: 0, tension:.25 },
      { label:'Labor (NY State)', data: ser.map(s=>s.labor), borderColor: COLOR_LAB, borderWidth: 2, pointRadius: 0, tension:.25 }
    ]},
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true, position:'top', align:'end', labels:{boxWidth:9,boxHeight:9,font:{family:"'Public Sans',sans-serif",size:12},color:'#201611'}},
        tooltip:{callbacks:{label:(c)=> c.dataset.label + ': ' + c.parsed.y.toFixed(0)}}
      },
      scales:{
        x:{grid:{display:false}, ticks:{maxRotation:0, autoSkip:true, maxTicksLimit:10}},
        y:{grid:{color:GRID}, border:{display:false}, ticks:{maxTicksLimit:6}}
      }
    }
  });
  const latest = ser[ser.length-1];
  const matCum = latest.materials - 100, labCum = latest.labor - 100;
  document.getElementById('cost-reading').innerHTML =
    `<strong>Reading:</strong> since 2019, national construction materials prices are up <strong>${fmtSignedPct(matCum)}</strong> and New York State construction wages <strong>${fmtSignedPct(labCum)}</strong>. ` +
    `Materials ran first and hardest through the 2021 to 2022 spike, then plateaued; labor has climbed more steadily and is still rising. The 60/40 blend of the two sets the deflator that discounts every award.`;
}

function renderAdjChart(){
  const a = D.adj;
  const labels = a.months.map(fmtYM);
  destroy('adj');
  charts.adj = new Chart(document.getElementById('chart-adj'), {
    type:'line',
    data:{ labels, datasets:[
      // adjusted drawn first as the lower bound; nominal fills down to it to shade the wedge
      { label:'Cost-adjusted', data: a.adjusted, borderColor: COLOR_MAT, borderWidth: 2.2, pointRadius: 0, tension:.25, fill:false, order:1 },
      { label:'Nominal', data: a.nominal, borderColor: COLOR_LAB, borderWidth: 2, pointRadius: 0, tension:.25,
        fill:'-1', backgroundColor:'rgba(174,78,52,0.10)', order:2 }
    ]},
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true, position:'top', align:'end', labels:{boxWidth:9,boxHeight:9,font:{family:"'Public Sans',sans-serif",size:12},color:'#201611'}},
        tooltip:{callbacks:{label:(c)=> c.dataset.label + ': ' + c.parsed.y.toFixed(1)}}
      },
      scales:{
        x:{grid:{display:false}, ticks:{maxRotation:0, autoSkip:true, maxTicksLimit:10}},
        y:{grid:{color:GRID}, border:{display:false}, ticks:{maxTicksLimit:6}}
      }
    }
  });
  const lastAdj = a.adjusted[a.adjusted.length-1];
  const lastNom = a.nominal[a.nominal.length-1];
  const gap = lastNom - lastAdj;
  document.getElementById('adj-reading').innerHTML =
    `<strong>Reading:</strong> the nominal index reads <strong>${lastNom.toFixed(1)}</strong>, but once each award is discounted by the construction-cost level of the month it was let, the adjusted index sits at <strong>${lastAdj.toFixed(1)}</strong>, a gap of <strong>${gap.toFixed(1)}</strong> points. ` +
    `That gap is the share of the headline that is price, not work. The two lines tracked together through 2019, then split as costs climbed: the City is buying less real construction than the nominal dollars suggest.`;
}

function renderSeasonality(){
  destroy('season');
  charts.season = new Chart(document.getElementById('chart-season'), {
    type:'bar',
    data:{ labels: MONTH_SHORT, datasets:[{
      data: D.season, backgroundColor: D.season.map(s=> s===Math.max(...D.season) ? COLOR_A : COLOR_B), borderRadius:1
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{callbacks:{label:(c)=> c.parsed.y.toFixed(2)+'× an average month'}} },
      scales:{
        x:{grid:{display:false}},
        y:{grid:{color:GRID}, border:{display:false}, ticks:{callback:v=>v.toFixed(1)+'×', maxTicksLimit:5}}
      }
    }
  });
  const hi = D.season.indexOf(Math.max(...D.season));
  const lo = D.season.indexOf(Math.min(...D.season));
  document.getElementById('season-reading').innerHTML =
    `<strong>Reading:</strong> ${MONTH_NAMES[hi]} is the City's heaviest awarding month (${D.season[hi].toFixed(2)}× average) and ${MONTH_NAMES[lo]} the lightest (${D.season[lo].toFixed(2)}×). The fiscal-year rhythm matters: a slow ${MONTH_NAMES[lo]} isn't a slowdown, and a strong ${MONTH_NAMES[hi]} isn't a boom.`;
}

function renderConversion(){
  document.getElementById('conv-sub').textContent =
    `Phase advancement across the last two plan-to-plan transitions (${fmtPeriodLong(D.periods[1])} → ${fmtPeriodLong(D.periods[3])})`;
  const tb = document.querySelector('#tbl-conv tbody');
  tb.innerHTML = ['Pending','Pre-Design','Design','Procurement'].map(ph=>{
    const s = D.conv[ph];
    return `<tr><td><span class="u-fw-600">${ph}</span></td>
      <td class="num">${fmtInt(s.n)}</td>
      <td class="num"><span class="pct">${s.n? fmtPct(s.adv/s.n) : '–'}</span></td>
      <td class="num">${s.n? fmtPct(s.held/s.n) : '–'}</td></tr>`;
  }).join('');
  const p = D.conv['Procurement'];
  const rate = p.n ? p.adv/p.n : 0;
  document.getElementById('conv-reading').innerHTML =
    `<strong>Reading:</strong> ${fmtPct(rate)} of procurement-phase projects reach construction within ~4 months, the fastest gate in the sequence. Applied to the <strong>${fmtMoney(D.procUnspent)}</strong> currently sitting in procurement, that is the nearest-term supply of new awards.`;
}

function renderEscalation(){
  document.getElementById('esc-sub').textContent =
    `Median total-budget growth for projects tracked from ${fmtPeriodLong(D.periods[0])} to ${fmtPeriodLong(D.periods[3])}, agencies with 30+ matched projects`;
  destroy('esc');
  charts.esc = new Chart(document.getElementById('chart-esc'), {
    type:'bar',
    data:{ labels: D.esc.agRows.map(r=>agencyLabel(r[0])), datasets:[{
      data: D.esc.agRows.map(r=>r[1]*100), backgroundColor: COLOR_A, borderRadius:1, barThickness:18
    }]},
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{callbacks:{label:(c)=> '+'+c.parsed.x.toFixed(1)+'% median · '+fmtInt(D.esc.agRows[c.dataIndex][2])+' projects'}} },
      scales:{
        x:{grid:{color:GRID}, border:{display:false}, ticks:{callback:v=>'+'+v+'%', maxTicksLimit:6}},
        y:{grid:{display:false}, ticks:{autoSkip:false, font:{size:12.5}}}
      }
    }
  });
  document.getElementById('esc-reading').innerHTML =
    `<strong>Reading:</strong> across <strong>${fmtInt(D.esc.n)}</strong> projects tracked over the span, the median budget grew <strong>+${fmtPct(D.esc.median)}</strong> and ${fmtPct(D.esc.grewShare)} of projects grew more than 5%. In aggregate the City added <strong>${fmtMoney(Math.abs(D.esc.added))}</strong> ${D.esc.added>=0?'to':'(net reduction) from'} the budgets of already-planned projects, demand growth that never appears as a new project announcement.`;
}

function unavailNote(host){
  return `<div class="unavail">This dataset (${host}) is temporarily unavailable. The rest of the page reflects what loaded; refresh to retry.</div>`;
}

(async function init(){
  const [awardsR, planR, costR] = await Promise.allSettled([fetchAwardsData(), fetchPlanData(), fetchCostData()]);
  D.awardsOk = awardsR.status === 'fulfilled';
  D.planOk = planR.status === 'fulfilled';
  D.costOk = costR.status === 'fulfilled';

  // Build only the computations whose source loaded; a failure in one must not
  // stop the other. Each build is itself wrapped so a data-shape surprise
  // degrades that one section rather than the whole page.
  if(D.awardsOk){ try{ buildIndex(); buildSeasonality(); }catch(e){ D.awardsOk = false; } }
  if(D.planOk){ try{ buildConversion(); buildEscalation(); }catch(e){ D.planOk = false; } }
  // The cost-adjusted index needs both the monthly award series and the cost series.
  D.adjOk = false;
  if(D.awardsOk && D.costOk){ try{ D.adjOk = buildAdjusted(); }catch(e){ D.adjOk = false; } }

  if(!D.awardsOk && !D.planOk){
    document.getElementById('loader').style.display='none';
    document.getElementById('error').style.display='block';
    return;
  }

  const planSpan = D.planOk ? `capital plan snapshots ${fmtPeriodLong(D.periods[0])} → ${fmtPeriodLong(D.periods[3])}` : 'capital plan temporarily unavailable';
  document.getElementById('asof').innerHTML =
    `Award history since 2003 · ${planSpan} · awards refreshed on load, cost series nightly`;
  document.getElementById('loader').style.display='none';
  document.getElementById('app').style.display='block';

  if(!D.awardsOk) document.getElementById('index').insertAdjacentHTML('beforebegin', unavailNote('City Record awards'));
  if(!D.planOk) document.getElementById('escalation').insertAdjacentHTML('beforebegin', unavailNote('OMB capital plan'));

  renderKpis();
  if(D.awardsOk){ renderIndexChart(); renderSeasonality(); }
  if(D.planOk){ renderConversion(); renderEscalation(); }

  if(D.adjOk){
    renderAdjKpis(); renderCostChart(); renderAdjChart();
  } else {
    // Leave the section visible but explain the gap rather than half-render it.
    const host = !D.awardsOk ? 'City Record awards' : 'BLS construction cost';
    document.getElementById('adj-unavail').innerHTML = unavailNote(host);
    ['cost-card','adj-card'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
    document.querySelector('#cost-adjusted .adj-kpis').style.display='none';
  }

  // The app starts hidden until data loads, so a hash present at page load cannot
  // scroll to its target (the element is inside a display:none container, and its
  // final position is not settled until the charts above it render). Re-apply the
  // jump once everything is laid out, honoring the section's scroll-margin-top.
  if(location.hash){
    // The app starts hidden until data loads, so the browser's anchor jump at load
    // fails and a fixed timeout can fire while the target is still display:none.
    // Poll until the target is actually laid out (offsetParent set = app revealed),
    // then force one instant jump (scroll-behavior:smooth otherwise suppresses a
    // programmatic jump from the top), with a rAF correction for any late reflow.
    var hashId=decodeURIComponent(location.hash.slice(1)), userScrolled=false, jumpTries=0;
    window.addEventListener('wheel', function(){ userScrolled=true; }, {passive:true, once:true});
    window.addEventListener('touchmove', function(){ userScrolled=true; }, {passive:true, once:true});
    (function tryJump(){
      if(userScrolled) return;
      var t=document.getElementById(hashId);
      if(t && t.offsetParent!==null){
        var de=document.documentElement, prev=de.style.scrollBehavior;
        de.style.scrollBehavior='auto';
        t.scrollIntoView({block:'start'});
        requestAnimationFrame(function(){ if(!userScrolled) t.scrollIntoView({block:'start'}); de.style.scrollBehavior=prev; });
        return;
      }
      if(jumpTries++ < 150) setTimeout(tryJump, 80);   // wait up to ~12s for data + reveal
    })();
  }
})();

/* ===========================================================================
   Dated-payment tiles (payment S-curve + schedule-pace scatter).
   Self-contained: reads the same same-origin file the Contracts page uses
   (/data/contract-search.json, sample fallback), independent of the award and
   plan fetches above so a slow or failed contract file never blanks the page.
   =========================================================================== */
(function(){
  'use strict';
  var LIVE_URL = '/data/contract-search.json';
  var SAMPLE_URL = '/data/contract-search.sample.json';
  var MIN_AGENCY_N = 8;          // min dated contracts for an agency to be shown
  var SCURVE_HORIZON = 60;       // x-axis cap, months since registration
  var SCURVE_OVERLAY_AGENCIES = 3;
  var PC_A = '#a8462c', PC_B = '#243b53', PC_C = '#2f5d8f', PC_GRID = '#e6ddd5';
  var pcCharts = {};
  function pcDestroy(k){ if(pcCharts[k]){ pcCharts[k].destroy(); delete pcCharts[k]; } }
  function escp(s){ var d = document.createElement('div'); d.textContent = String(s == null ? '' : s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); return d.innerHTML; }

  /* ----- pure aggregations (mirror site/test/payment-tiles.test.js) ----- */
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
  function monthIndex(reg, ym){
    if(!reg || !ym) return null;
    var ry = +reg.slice(0,4), rm = +reg.slice(5,7), py = +ym.slice(0,4), pm = +ym.slice(5,7);
    if(!ry || !rm || !py || !pm) return null;
    return (py - ry) * 12 + (pm - rm);
  }
  function contractCurvePoints(c){
    var denom = (c.current_amount > 0) ? c.current_amount : (c.original_amount > 0) ? c.original_amount : 0;
    if(!denom || !Array.isArray(c.monthly_cumulative)) return [];
    var out = [];
    c.monthly_cumulative.forEach(function(pair){
      if(!Array.isArray(pair) || pair.length < 2) return;
      var idx = monthIndex(c.registration_date, pair[0]); var cum = +pair[1];
      if(idx == null || idx < 0 || isNaN(cum)) return;
      out.push({ idx: idx, pct: cum / denom * 100 });
    });
    return out;
  }
  function sCurve(list){
    var sums = [], counts = [];
    for(var i = 0; i <= SCURVE_HORIZON; i++){ sums[i] = 0; counts[i] = 0; }
    list.forEach(function(c){
      contractCurvePoints(c).forEach(function(p){
        if(p.idx > SCURVE_HORIZON) return;
        sums[p.idx] += p.pct; counts[p.idx] += 1;
      });
    });
    var pts = [];
    for(var j = 0; j <= SCURVE_HORIZON; j++) if(counts[j] > 0) pts.push({ x: j, y: sums[j] / counts[j], n: counts[j] });
    return pts;
  }
  function sCurveBundle(cs){
    var swept = sweptContracts(cs);
    var citywide = sCurve(swept);
    var ranked = [];
    groupBy(swept, function(c){ return c.agency || '–'; }).forEach(function(list, agency){ ranked.push({ agency: agency, n: list.length, list: list }); });
    ranked.sort(function(a,b){ return b.n - a.n; });
    var overlays = ranked.slice(0, SCURVE_OVERLAY_AGENCIES)
      .filter(function(r){ return r.n >= MIN_AGENCY_N; })
      .map(function(r){ return { agency: r.agency, n: r.n, points: sCurve(r.list) }; });
    return { citywide: citywide, overlays: overlays, sweptTotal: swept.length };
  }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  /* Day-granular dates read in UTC. A bare 'YYYY-MM-DDTHH:MM:SS.000' is parsed
     as LOCAL time, so measuring elapsed schedule against an absolute now shifted
     the numerator by the reader's UTC offset and moved the scatter slightly
     between New York and Tokyo. Contract start and end are day-granular anyway. */
  function utcDayMs(s){
    var t = String(s||'');
    if(t.length < 10) return NaN;
    return Date.UTC(+t.slice(0,4), +t.slice(5,7)-1, +t.slice(8,10));
  }
  function scheduleElapsedPct(c, today){
    if(!c.start_date || !c.end_date) return null;
    var s = utcDayMs(c.start_date), e = utcDayMs(c.end_date);
    if(isNaN(s) || isNaN(e) || e <= s) return null;
    return clamp((today - s) / (e - s) * 100, 0, 150);
  }
  function scatterAgencyMeans(cs){
    var n = new Date();
    var today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
    var swept = sweptContracts(cs);
    var rows = [];
    groupBy(swept, function(c){ return c.agency || '–'; }).forEach(function(list, agency){
      if(list.length < MIN_AGENCY_N) return;
      var sch = [], paid = [];
      list.forEach(function(c){
        var se = scheduleElapsedPct(c, today);
        if(se == null) return;
        if(c.pct_paid_to_date == null || isNaN(c.pct_paid_to_date)) return;
        sch.push(se); paid.push(c.pct_paid_to_date * 100);
      });
      if(!sch.length) return;
      var mean = function(a){ return a.reduce(function(x,y){ return x + y; }, 0) / a.length; };
      rows.push({ agency: agency, n: list.length, used: sch.length, schedElapsed: mean(sch), paidPct: mean(paid) });
    });
    return rows;
  }
  function shortAgency(name){
    return String(name || '').replace(/^Department of /, '').replace(/^New York City /, '');
  }

  /* ----- render: S-curve ----- */
  function renderSCurve(cs){
    var card = document.getElementById('scurve');
    var bundle = sCurveBundle(cs);
    if(!bundle.citywide.length){
      if(card) card.style.display = 'none';
      return;
    }
    var maxX = bundle.citywide.reduce(function(a,p){ return Math.max(a, p.x); },
      bundle.overlays.reduce(function(a,o){ return o.points.reduce(function(b,p){ return Math.max(b,p.x); }, a); }, 0));
    var xCap = Math.min(SCURVE_HORIZON, Math.max(12, maxX));
    var overlayColors = [PC_B, PC_C, '#776b5e'];
    var datasets = [{
      label: 'Citywide average', data: bundle.citywide.map(function(p){ return { x: p.x, y: p.y }; }),
      borderColor: PC_A, borderWidth: 2.4, pointRadius: 0, tension: 0.25, fill: false, order: 1
    }];
    bundle.overlays.forEach(function(o, i){
      datasets.push({
        label: shortAgency(o.agency) + ' (n ' + o.n + ')',
        data: o.points.map(function(p){ return { x: p.x, y: p.y }; }),
        borderColor: overlayColors[i % overlayColors.length], borderWidth: 1.6,
        pointRadius: 0, tension: 0.25, fill: false, borderDash: [4, 3], order: 2 + i
      });
    });
    pcDestroy('scurve');
    pcCharts.scurve = new Chart(document.getElementById('chart-scurve'), {
      type: 'line',
      data: { datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, parsing: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 9, boxHeight: 9, font: { family: "'Public Sans',sans-serif", size: 12 }, color: '#201611' } },
          tooltip: { callbacks: { title: function(items){ return 'Month ' + items[0].parsed.x; },
            label: function(c){ return c.dataset.label + ': ' + c.parsed.y.toFixed(0) + '% paid'; } } }
        },
        scales: {
          x: { type: 'linear', min: 0, max: xCap, grid: { display: false },
               title: { display: true, text: 'months since registration', color: '#766a60', font: { family: "'IBM Plex Mono',monospace", size: 12 } },
               ticks: { maxTicksLimit: 10, stepSize: 6, callback: function(v){ return v; } } },
          y: { min: 0, suggestedMax: 100, grid: { color: PC_GRID }, border: { display: false },
               ticks: { maxTicksLimit: 6, callback: function(v){ return v + '%'; } } }
        }
      }
    });
    var cap = document.getElementById('scurve-cap');
    if(cap) cap.textContent = 'DATED SET · ' + bundle.sweptTotal + ' CONTRACTS';
    var last = bundle.citywide[bundle.citywide.length - 1];
    var reach50 = bundle.citywide.find(function(p){ return p.y >= 50; });
    var rd = document.getElementById('scurve-reading');
    if(rd) rd.innerHTML = '<strong>Reading:</strong> across the dated set, the average contract crosses '
      + (reach50 ? '<strong>50% paid</strong> around month <strong>' + reach50.x + '</strong>' : 'its midpoint late in the window')
      + ', and by month <strong>' + last.x + '</strong> stands near <strong>' + last.y.toFixed(0)
      + '%</strong> of value paid. Because the contract set behind each month changes as work enters and finishes, the line reads the population, not any one contract; the overlays show where the busiest agencies pay faster or slower than that average.';
  }

  /* ----- render: schedule-pace scatter ----- */
  function renderSchedPace(cs){
    var card = document.getElementById('schedpace');
    var rows = scatterAgencyMeans(cs);
    var unavail = document.getElementById('schedpace-unavail');
    if(!rows.length){
      pcDestroy('schedpace');
      var box = document.querySelector('#schedpace .chart-box'); if(box) box.style.display = 'none';
      var rd0 = document.getElementById('schedpace-reading'); if(rd0) rd0.style.display = 'none';
      if(unavail) unavail.innerHTML = '<div class="unavail">No agency has at least ' + MIN_AGENCY_N
        + ' dated contracts with usable start and end dates yet, so the schedule-pace view is held until the dated set fills in.</div>';
      return;
    }
    var pts = rows.map(function(r){ return { x: r.schedElapsed, y: r.paidPct, agency: shortAgency(r.agency), n: r.n }; });
    pcDestroy('schedpace');
    var diagonalLine = {
      id: 'diag',
      beforeDatasetsDraw: function(chart){
        var sc = chart.scales; if(!sc.x || !sc.y) return;
        var ctx = chart.ctx;
        var lo = Math.max(sc.x.min, sc.y.min), hi = Math.min(sc.x.max, sc.y.max);
        ctx.save(); ctx.strokeStyle = '#766a60'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(sc.x.getPixelForValue(lo), sc.y.getPixelForValue(lo));
        ctx.lineTo(sc.x.getPixelForValue(hi), sc.y.getPixelForValue(hi)); ctx.stroke(); ctx.restore();
      }
    };
    var labelPoints = {
      id: 'plabels',
      afterDatasetsDraw: function(chart){
        var ctx = chart.ctx, meta = chart.getDatasetMeta(0);
        ctx.save(); ctx.fillStyle = '#201611';
        ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        meta.data.forEach(function(el, i){ if(el) ctx.fillText(pts[i].agency, el.x + 7, el.y); });
        ctx.restore();
      }
    };
    pcCharts.schedpace = new Chart(document.getElementById('chart-schedpace'), {
      type: 'scatter',
      data: { datasets: [{ label: 'Agency mean', data: pts, backgroundColor: PC_A,
        borderColor: PC_A, pointRadius: 5, pointHoverRadius: 7 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function(c){ var p = pts[c.dataIndex];
            return [p.agency + ' (n ' + p.n + ')', 'schedule elapsed: ' + p.x.toFixed(0) + '%', 'paid to date: ' + p.y.toFixed(0) + '%']; } } }
        },
        scales: {
          x: { min: 0, suggestedMax: 150, grid: { color: PC_GRID }, border: { display: false },
               title: { display: true, text: 'schedule elapsed (%)', color: '#766a60', font: { family: "'IBM Plex Mono',monospace", size: 12 } },
               ticks: { maxTicksLimit: 7, callback: function(v){ return v + '%'; } } },
          // suggestedMax, not a hard max: a fixed ceiling silently clipped a real
          // point (Small Business Services, paid 132.95%) off the top of the
          // chart while the caption still counted it as "above the line," so the
          // one point the reader could not see was the one the prose promised.
          // suggestedMax keeps the same look for the common case and lets the
          // axis grow when a real value runs past it.
          y: { min: 0, suggestedMax: 120, grid: { color: PC_GRID }, border: { display: false },
               title: { display: true, text: 'paid to date (%)', color: '#766a60', font: { family: "'IBM Plex Mono',monospace", size: 12 } },
               ticks: { maxTicksLimit: 7, callback: function(v){ return v + '%'; } } }
        }
      },
      plugins: [diagonalLine, labelPoints]
    });
    var ahead = rows.filter(function(r){ return r.paidPct > r.schedElapsed; }).length;
    var behind = rows.length - ahead;
    var cap = document.getElementById('schedpace-cap');
    // The dated set can hold a single agency, so every noun and verb in the
    // generated sentence agrees with the live count rather than assuming plural.
    if(cap) cap.textContent = 'DATED SET · ' + rows.length + ' AGENC' + (rows.length === 1 ? 'Y' : 'IES');
    var body;
    if(ahead === 0){
      body = (rows.length === 1 ? 'it sits' : 'all of them sit')
        + ' below the pay-keeping-pace diagonal, paying behind where the planned calendar would put '
        + (rows.length === 1 ? 'it' : 'them');
    } else {
      body = '<strong>' + ahead + '</strong> sit' + (ahead === 1 ? 's' : '')
        + ' above the pay-keeping-pace diagonal, paying ahead of where the planned calendar would put '
        + (ahead === 1 ? 'it' : 'them')
        + (behind === 0 ? '; none sit below'
          : (behind === 1 ? '; the other one sits below' : '; the rest sit below'));
    }
    var rd = document.getElementById('schedpace-reading');
    if(rd) rd.innerHTML = '<strong>Reading:</strong> of the <strong>' + rows.length
      + '</strong> agenc' + (rows.length === 1 ? 'y' : 'ies') + ' with enough dated contracts, ' + body
      + '. The end date is the planned end, not actual completion, so a point below the line can mean contracts running long rather than an agency holding back payment. Read the pattern, not any single point.';
  }

  function loadJSON(url){
    return fetch(url, { cache: 'no-store' }).then(function(res){
      if(!res.ok) throw new Error('HTTP ' + res.status); return res.json();
    });
  }
  function paintAll(payload){
    var cs = (payload && Array.isArray(payload.contracts)) ? payload.contracts : [];
    try { renderSCurve(cs); } catch(e){ if(window.console) console.error('scurve render', e); var s = document.getElementById('scurve'); if(s) s.style.display = 'none'; }
    try { renderSchedPace(cs); } catch(e){ if(window.console) console.error('schedpace render', e); var p = document.getElementById('schedpace'); if(p) p.style.display = 'none'; }
  }
  function hideTiles(){
    ['scurve','schedpace'].forEach(function(id){ var el = document.getElementById(id); if(el) el.style.display = 'none'; });
  }
  function fetchOnce(){
    return loadJSON(LIVE_URL).catch(function(){ return loadJSON(SAMPLE_URL); });
  }
  function start(){
    if(typeof Chart === 'undefined'){ hideTiles(); return; }
    // The tiles live inside #app, which the main init() reveals only after its
    // own fetches settle. Fetch the contract file now, but defer painting until
    // #app is visible so the canvases lay out at full size, then paint once.
    var payloadP = fetchOnce();
    var tries = 0;
    (function whenVisible(){
      var app = document.getElementById('app');
      if(app && app.offsetParent !== null){
        payloadP.then(paintAll).catch(function(err){
          if(window.console) console.error('contract-search load failed (analysis tiles)', err); hideTiles();
        });
        return;
      }
      if(tries++ < 200) setTimeout(whenVisible, 80); // wait up to ~16s for reveal
      else { // app never revealed (both upstream sources failed); leave tiles hidden
        hideTiles();
      }
    })();
  }
  if(document.readyState !== 'loading') start(); else document.addEventListener('DOMContentLoaded', start);
})();
