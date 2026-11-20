'use strict';
/* ================= data layer ================= */
const API = 'https://data.cityofnewyork.us/resource/fb86-vt7u.json';
const state = { stage: 'all', rows: [], period: null, priorTotal: 0, priorPeriod: null };

const FIELDS = 'fms_id,managing_agency,fms_project_name,total_budget,spend_to_date,current_phase,borough,ten_year_plan_category';

/* The dataset publishes one row per sub-project/milestone, repeating the
   project-level budget on every row. Collapse to one row per project,
   keeping the most advanced delivery phase. */
function dedupe(rows){
  const m = new Map();
  for(const r of rows){
    const k = r.agency + '|' + r.fmsId;
    const prev = m.get(k);
    if(!prev || phaseRank(r.bucket) > phaseRank(prev.bucket)) m.set(k, r);
  }
  return [...m.values()];
}
function phaseRank(b){
  const i = PHASE_ORDER.indexOf(b);
  return i === -1 ? -1 : (b === 'Other active' ? -1 : i);
}

async function getJSON(params){
  const res = await fetch(API + '?' + new URLSearchParams(params), { headers: { 'X-App-Token': '3TAzQQPiSG2T4WGWfYYUxxqfJ' } });
  if(!res.ok) throw new Error('API ' + res.status);
  return res.json();
}

async function fetchPlan(){
  const periods = await getJSON({
    '$select':'reporting_period', '$group':'reporting_period',
    '$order':'reporting_period DESC', '$limit':'2'
  });
  state.period = periods[0].reporting_period;
  state.priorPeriod = periods[1] ? periods[1].reporting_period : null;
  const rows = await getJSON({
    '$select': FIELDS,
    '$where': `reporting_period='${state.period}'`,
    '$limit': '20000'
  });
  state.rows = dedupe(rows.map(normalize).filter(r => r.bucket !== 'excluded'));
  if(state.priorPeriod){
    const prior = await getJSON({
      '$select':'fms_id,managing_agency,current_phase,total_budget,spend_to_date',
      '$where': `reporting_period='${state.priorPeriod}'`,
      '$limit': '20000'
    });
    state.priorTotal = dedupe(prior.map(normalize).filter(r => r.bucket !== 'excluded'))
      .filter(r => r.bucket !== 'Close-out')
      .reduce((a,r) => a + r.unspent, 0);
  }
}

/* phase normalization */
const PHASE_MAP = {
  'pending':'Pending', 'initiation':'Pending',
  'pre-design':'Pre-Design', 'predesign':'Pre-Design',
  'design':'Design',
  'construction procurement':'Procurement',
  'construction':'Construction', 'design build':'Construction', 'design built':'Construction',
  'close-out':'Close-out', 'closeout':'Close-out'
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
function agencyLabel(code){
  return AGENCY_NAMES[code] ? `${AGENCY_NAMES[code]} (${code})` : code;
}

const BOROS = new Set(['Brooklyn','Queens','Manhattan','Bronx','Staten Island']);
function normBorough(b){
  const v = (b||'').trim();
  if(BOROS.has(v)) return v;
  if(/citywide/i.test(v)) return 'Citywide';
  return v ? 'Multi-site / Other' : 'Citywide';
}

function titleCase(s){
  return (s||'').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

function normalize(r, i){
  const budget = Math.max(parseFloat(r.total_budget) || 0, 0);
  const spent  = Math.max(parseFloat(r.spend_to_date) || 0, 0);
  return {
    // Stable per-row surrogate for missing fms_id: keeps each such row standing
    // alone (no merge) while making the run byte-reproducible. Math.random() did
    // the same isolation but injected nondeterminism.
    fmsId: r.fms_id || ('_np_' + i),
    agency: r.managing_agency || '–',
    name: r.fms_project_name || '(unnamed project)',
    budget,
    unspent: Math.max(budget - spent, 0),
    bucket: normPhase(r.current_phase),
    borough: normBorough(r.borough),
    cat: titleCase(r.ten_year_plan_category || 'Uncategorized')
  };
}

/* ================= filtering & aggregation ================= */
function inStage(r){
  if(state.stage === 'pre') return PRE_CON.has(r.bucket);
  if(state.stage === 'con') return r.bucket === 'Construction';
  return r.bucket !== 'Close-out'; // 'all active' headline excludes close-out
}
function filtered(){ return state.rows.filter(inStage); }

function sumUnspent(rows){ return rows.reduce((a,r) => a + r.unspent, 0); }

function median(vals){
  if(!vals.length) return 0;
  const v = [...vals].sort((a,b) => a-b);
  const m = Math.floor(v.length/2);
  return v.length % 2 ? v[m] : (v[m-1]+v[m])/2;
}

function groupUnspent(rows, keyFn){
  const m = new Map();
  for(const r of rows){
    const k = keyFn(r);
    const g = m.get(k) || { total:0, count:0 };
    g.total += r.unspent; g.count++;
    m.set(k, g);
  }
  return m;
}

/* ================= formatting ================= */
function fmtMoney(v){
  if(v >= 1e9) return '$' + (v/1e9).toFixed(v >= 10e9 ? 1 : 2) + 'B';
  if(v >= 1e6) return '$' + (v/1e6).toFixed(v >= 100e6 ? 0 : 1) + 'M';
  if(v >= 1e3) return '$' + Math.round(v/1e3) + 'K';
  return '$' + Math.round(v);
}
function fmtInt(v){ return v.toLocaleString('en-US'); }
function fmtPeriod(p){
  if(!p) return '';
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return names[+p.slice(4,6)-1] + ' ' + p.slice(0,4);
}
function esc(s){ const d = document.createElement('div'); d.textContent = String(s==null?'':s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); return d.innerHTML; }
const STAGE_LABEL = { all:'all active phases', pre:'pre-construction phases', con:'construction phase' };
// Two project counts live on this page and they are not the same number: the
// plan's full active set (every project not completed, cancelled, or otherwise
// dead) and the narrower set the KPIs above are computed on, which drops
// close-out. Both are defensible; leaving the reader to discover the gap is not.
// So each is labelled for what it is and the gap is reconciled in one line,
// entirely from live values.
const COUNT_NOTE = {
  all: 'active projects, excluding close-out',
  pre: 'projects in pre-construction phases',
  con: 'projects in the construction phase'
};
function renderReconcile(rows){
  const el = document.getElementById('kpi-recon');
  if(!el) return;
  const active = state.rows.length;   // every active project in the plan snapshot
  const shown  = rows.length;         // the set the figures above are computed on
  const gap    = active - shown;
  if(gap <= 0){
    el.innerHTML = `All <strong>${fmtInt(active)}</strong> active projects in the ${esc(fmtPeriod(state.period))} plan are counted in the figures above.`;
    return;
  }
  const why = state.stage === 'all'
    ? `the other <strong>${fmtInt(gap)}</strong> are in close-out, set aside because their construction work is substantially done`
    : `the other <strong>${fmtInt(gap)}</strong> sit in phases outside this filter`;
  el.innerHTML = `The ${esc(fmtPeriod(state.period))} plan carries <strong>${fmtInt(active)}</strong> active projects. ` +
    `The figures above are computed on the <strong>${fmtInt(shown)}</strong> in scope for ${esc(STAGE_LABEL[state.stage] || STAGE_LABEL.all)}, and ${why}.`;
}

/* ================= rendering ================= */
const COLOR_A = '#a8462c', COLOR_B = '#243b53', GRID = '#e6ddd5';
let charts = {};
Chart.defaults.font.family = "'IBM Plex Mono',monospace";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#6b5e56';
Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor:'#fefbf8', titleColor:'#201611', bodyColor:'#6b5e56',
  borderColor:'#201611', borderWidth:1, cornerRadius:2, padding:10, displayColors:false,
  titleFont:{family:"'Public Sans',sans-serif",weight:'600',size:12}, bodyFont:{family:"'IBM Plex Mono',monospace",size:12},
  caretSize:5
});
function destroyChart(k){ if(charts[k]){ charts[k].destroy(); delete charts[k]; } }
function moneyTicks(v){ return fmtMoney(v); }

function hBar(key, canvasId, entries, color){
  destroyChart(key);
  charts[key] = new Chart(document.getElementById(canvasId), {
    type:'bar',
    data:{
      labels: entries.map(e=>e[0]),
      datasets:[{ data: entries.map(e=>e[1].total), backgroundColor: color, borderRadius:1, barThickness:18 }]
    },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:(c)=> fmtMoney(c.parsed.x) + ' across ' + fmtInt(entries[c.dataIndex][1].count) + ' projects'}}
      },
      scales:{
        x:{grid:{color:GRID}, border:{display:false}, ticks:{callback:moneyTicks, maxTicksLimit:5}},
        y:{grid:{display:false}, ticks:{autoSkip:false, font:{family:"'Public Sans',sans-serif",size:12.5}}}
      }
    }
  });
}

function renderPhases(){
  // phase chart always shows all active rows incl. close-out, independent of stage filter
  const g = groupUnspent(state.rows, r=>r.bucket);
  const entries = PHASE_ORDER.filter(p=>g.has(p)).map(p=>[p, g.get(p)]);
  hBar('phase','chart-phase', entries, COLOR_A);
}

function renderAgencies(rows){
  const entries = [...groupUnspent(rows, r=>agencyLabel(r.agency)).entries()]
    .sort((a,b)=>b[1].total-a[1].total).slice(0,8);
  hBar('agency','chart-agency', entries, COLOR_A);
}

const BORO_ORDER = ['Brooklyn','Queens','Manhattan','Bronx','Staten Island','Citywide','Multi-site / Other'];
function renderBoroughs(rows){
  const g = groupUnspent(rows, r=>r.borough);
  const entries = BORO_ORDER.filter(b=>g.has(b)).map(b=>[b,g.get(b)]);
  hBar('boro','chart-boro', entries, COLOR_B);
}

function renderCats(rows){
  const entries = [...groupUnspent(rows, r=>r.cat).entries()]
    .sort((a,b)=>b[1].total-a[1].total).slice(0,8);
  hBar('cat','chart-cat', entries, COLOR_B);
}

function renderProjects(rows){
  const top = [...rows].sort((a,b)=>b.unspent-a.unspent).slice(0,15);
  const tb = document.querySelector('#tbl-projects tbody');
  tb.innerHTML = top.map((r,i)=>`<tr>
    <td class="rank">${i+1}</td>
    <td>
      <div class="t-title">${esc(r.name)}</div>
      <div class="t-sub">${esc(agencyLabel(r.agency))} · ${esc(r.borough)} · ${esc(r.cat)}</div>
    </td>
    <td><span class="pill ${r.bucket==='Construction'?'c':''}">${esc(r.bucket)}</span></td>
    <td class="num amt">${fmtMoney(r.budget)}</td>
    <td class="num amt">${fmtMoney(r.unspent)}</td>
  </tr>`).join('');
}

function renderKpis(rows){
  const unspent = sumUnspent(rows);
  document.getElementById('kpi-unspent').textContent = fmtMoney(unspent);
  document.getElementById('kpi-unspent-note').textContent = STAGE_LABEL[state.stage] + ', ' + fmtPeriod(state.period) + ' plan';
  document.getElementById('kpi-count').textContent = fmtInt(rows.length);
  document.getElementById('kpi-count-note').textContent = COUNT_NOTE[state.stage] || COUNT_NOTE.all;
  renderReconcile(rows);
  document.getElementById('kpi-median').textContent = fmtMoney(median(rows.map(r=>r.budget)));
  const curAll = sumUnspent(state.rows.filter(r=>r.bucket!=='Close-out'));
  if(state.priorTotal > 0){
    const d = (curAll - state.priorTotal) / state.priorTotal * 100;
    document.getElementById('kpi-growth').innerHTML =
      `<span class="${d>=0?'up':'down'}">${d>=0?'+':'−'}${Math.abs(d).toFixed(1)}%</span>`;
    document.getElementById('kpi-growth-note').textContent =
      'unspent pipeline vs ' + fmtPeriod(state.priorPeriod) + ' plan';
  }else{
    document.getElementById('kpi-growth').textContent = '–';
  }
}

function renderAll(){
  const rows = filtered();
  renderKpis(rows);
  renderPhases();
  renderAgencies(rows);
  renderBoroughs(rows);
  renderCats(rows);
  renderProjects(rows);
}

/* ================= controls & init ================= */
function wireSeg(id, attr, initial, onChange){
  const seg = document.getElementById(id);
  const btns = [...seg.querySelectorAll('button')];
  function set(val){
    btns.forEach(b => b.classList.toggle('on', b.dataset[attr] === String(val)));
    onChange(val);
  }
  btns.forEach(b => b.addEventListener('click', ()=> set(b.dataset[attr])));
  set(initial);
}

(async function init(){
  try{
    await fetchPlan();
  }catch(e){
    document.getElementById('loader').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    return;
  }
  document.getElementById('asof').innerHTML =
    `<strong>${fmtPeriod(state.period)}</strong> capital plan snapshot · ${fmtInt(state.rows.length)} projects active in the plan · published by OMB three times a year`;
  document.getElementById('series-asof').textContent = fmtPeriod(state.period).toUpperCase();
  document.getElementById('loader').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  let ready = false;
  wireSeg('seg-stage','g','all', v => { state.stage = v; if(ready) renderAll(); });
  ready = true;
  renderAll();
})();
