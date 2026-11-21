'use strict';
const TOKEN = '3TAzQQPiSG2T4WGWfYYUxxqfJ';
const SCA_API = 'https://data.cityofnewyork.us/resource/8586-3zfm.json';
const SCA_META = 'https://data.cityofnewyork.us/api/views/8586-3zfm.json';
const MTA_API = 'https://data.ny.gov/resource/kizb-nxtu.json';
const COLOR_A = '#a8462c', COLOR_B = '#243b53', GRID = '#e6ddd5';

async function getJSON(api, params){
  const res = await fetch(api + '?' + new URLSearchParams(params), { headers: { 'X-App-Token': '3TAzQQPiSG2T4WGWfYYUxxqfJ' } });
  if(!res.ok) throw new Error('API ' + res.status);
  return res.json();
}
function fmtMoney(v){ return ci.fmt(v, 'money'); }
function fmtInt(v){ return v.toLocaleString('en-US'); }
function esc(s){ const d=document.createElement('div'); d.textContent=String(s==null?'':s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); return d.innerHTML; }
function titleCase(s){ return (s||'').toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase()); }
function fmtDay(d){ return ci.fmt(d, 'date'); }

// The SCA borough breakdown is keyed on the structured single-letter borough
// code, not the free-text `borough` column. The text column is blank on a small
// number of records while the code is populated on every one, and a grouped
// query silently drops the blanks: those records fell out of a headline labelled
// "awarded value in active construction", understating it. The headline is now
// taken from an ungrouped aggregate over the whole dataset, and the breakdown
// groups on the code so it reconciles back to that headline.
const BORO_CODES = { K:'Brooklyn', M:'Manhattan', Q:'Queens', R:'Staten Island', X:'Bronx' };
// One name for a project row, from the code first, the free-text column second.
function boroName(r){
  const code = String((r && r.boro) || '').trim().toUpperCase();
  if(BORO_CODES[code]) return BORO_CODES[code];
  const text = String((r && r.borough) || '').trim();
  return text ? titleCase(text) : 'Not assigned';
}

const D = {};
async function fetchAll(){
  // SCA lives on data.cityofnewyork.us, MTA on data.ny.gov. Settle each
  // independently so one host being down does not blank the other's sections.
  const results = await Promise.allSettled([
    getJSON(SCA_API, {'$select':'count(*) as n,sum(award) as s'}),
    getJSON(SCA_API, {'$select':'boro,count(*) as n,sum(award) as s','$group':'boro','$order':'s DESC'}),
    getJSON(SCA_API, {'$select':'consttype,count(*) as n,sum(award) as s','$group':'consttype'}),
    getJSON(SCA_API, {'$select':'name,projdesc,borough,boro,award','$order':'award DESC','$limit':'10'}),
    getJSON(MTA_API, {'$select':'agency_name,sum(total_allocation) as s',
      '$where':"budget_submission_date='Current' AND capital_plan='Capital Plan 2025 - 2029'",
      '$group':'agency_name','$order':'s DESC'}),
    getJSON(MTA_API, {'$select':'capital_plan,sum(total_allocation) as s',
      '$where':"budget_submission_date='Current'",'$group':'capital_plan','$order':'capital_plan'}),
    // Snapshot date for the SCA extract. Metadata only, so a failure here costs
    // the "as of" line and nothing else.
    fetch(SCA_META).then(r => r.ok ? r.json() : Promise.reject(new Error('meta ' + r.status)))
  ]);
  const val = i => results[i].status === 'fulfilled' ? results[i].value : null;
  const tot = val(0), boro = val(1), type = val(2), top = val(3), mtaAg = val(4), mtaPlans = val(5), meta = val(6);

  D.scaOk = tot !== null && boro !== null && type !== null && top !== null;
  D.mtaOk = mtaAg !== null && mtaPlans !== null;

  if(D.scaOk){
    // Headline: every active project, no grouping, nothing dropped.
    D.scaTotal = parseFloat(tot[0] && tot[0].s) || 0;
    D.scaCount = parseInt(tot[0] && tot[0].n, 10) || 0;
    D.type = type;
    D.top = top;

    // Breakdown: group the codes into named boroughs, folding any unknown or
    // missing code into one honest "Not assigned" bucket.
    const byName = new Map();
    boro.forEach(r => {
      const name = BORO_CODES[String(r.boro || '').trim().toUpperCase()] || 'Not assigned';
      const cur = byName.get(name) || { name, n:0, s:0 };
      cur.n += parseInt(r.n, 10) || 0;
      cur.s += parseFloat(r.s) || 0;
      byName.set(name, cur);
    });
    // Reconcile the breakdown back to the headline. If the two ever diverge (a
    // future record with no code at all), the gap is shown as "Not assigned"
    // rather than quietly leaving the chart short of its own headline.
    const gapS = D.scaTotal - [...byName.values()].reduce((a,r)=>a+r.s, 0);
    const gapN = D.scaCount - [...byName.values()].reduce((a,r)=>a+r.n, 0);
    if(gapN > 0 || gapS > 1){
      const cur = byName.get('Not assigned') || { name:'Not assigned', n:0, s:0 };
      cur.n += Math.max(gapN, 0);
      cur.s += Math.max(gapS, 0);
      byName.set('Not assigned', cur);
    }
    D.boro = [...byName.values()].sort((a,b)=>b.s-a.s);
    D.boroUnassigned = byName.get('Not assigned') || null;
  }
  if(D.mtaOk){
    D.mtaAg = mtaAg.map(r=>({a:r.agency_name, s:(parseFloat(r.s)||0)*1000}));
    D.mtaPlans = mtaPlans.map(r=>({p:(r.capital_plan||'').replace('Capital Plan ',''), s:(parseFloat(r.s)||0)*1000}));
  }
  // rowsUpdatedAt is epoch seconds: the last time the SCA extract itself changed.
  const stamp = meta && (meta.rowsUpdatedAt || meta.viewLastModified);
  D.scaAsOf = stamp ? new Date(stamp * 1000) : null;
}

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
function destroyChart(k){ if(charts[k]){ charts[k].destroy(); delete charts[k]; } }

// Category labels on the y axis get whatever width Chart.js will give them, and
// a long agency name ("Metropolitan Transportation Authority") was being cut off
// mid-word with no ellipsis, reading as "tropolitan Transportation Authority".
// Truncate the tick to a fixed width; the tooltip still carries the full name.
const TICK_MAX = 24;
function truncTick(s){
  s = String(s == null ? '' : s);
  return s.length > TICK_MAX ? s.slice(0, TICK_MAX - 1).trimEnd() + '…' : s;
}

function hBar(canvasId, labels, data, color, countFor){
  destroyChart(canvasId);
  charts[canvasId] = new Chart(document.getElementById(canvasId), {
    type:'bar',
    data:{ labels, datasets:[{ data, backgroundColor: color, borderRadius:1, barThickness:18 }]},
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{callbacks:{
          title:(items)=> items.length ? String(labels[items[0].dataIndex]) : '',
          label:(c)=> fmtMoney(c.parsed.x) + (countFor ? ' · ' + countFor[c.dataIndex] : '')}} },
      scales:{
        x:{grid:{color:GRID}, border:{display:false}, ticks:{callback:v=>fmtMoney(v), maxTicksLimit:5}},
        y:{grid:{display:false}, ticks:{autoSkip:false, font:{size:12.5},
          callback:function(v){ return truncTick(this.getLabelForValue(v)); }}}
      }
    }
  });
}

// Inline note shown in place of a section whose source did not load.
function unavail(host){
  return `<div class="unavail"><span>This dataset (${host}) is temporarily unavailable. The rest of the page reflects what loaded.</span><button type="button" class="ci-btn" data-action="reload">Retry</button></div>`;
}

function renderSCA(){
  if(!D.scaOk){
    document.getElementById('kpi-sca').textContent = '–';
    document.getElementById('kpi-sca-n').textContent = '–';
    document.getElementById('sca').insertAdjacentHTML('beforebegin', unavail('NYC Open Data, SCA'));
    return;
  }
  document.getElementById('kpi-sca').textContent = fmtMoney(D.scaTotal);
  document.getElementById('kpi-sca-note').textContent = 'awarded value in active construction';
  document.getElementById('kpi-sca-n').textContent = fmtInt(D.scaCount);

  hBar('chart-sca-boro', D.boro.map(r=>r.name), D.boro.map(r=>r.s), COLOR_B,
    D.boro.map(r=>fmtInt(r.n)+' projects'));
  // The bars sum to the headline. Say so, and name the exception if one exists.
  const un = D.boroUnassigned;
  document.getElementById('sca-boro-note').textContent = un
    ? 'The bars sum to the headline. ' + fmtInt(un.n) + ' project' + (un.n===1?'':'s') +
      ' carrying no borough code appear as Not assigned.'
    : 'The bars sum to the headline: every active project carries a borough.';

  const cip = D.type.find(t=>t.consttype==='CIP'), cap = D.type.find(t=>t.consttype==='Capacity');
  document.getElementById('sca-reading').innerHTML =
    `<strong>Reading:</strong> ${cip&&cap ? `capital improvements (roofs, masonry, systems) make up ${fmtMoney(parseFloat(cip.s))} of the active program; new capacity (new schools and additions) accounts for ${fmtMoney(parseFloat(cap.s))}.` : ''} School construction runs steady and spreads across all five boroughs, a base layer of demand under the city's construction market.`;

  document.querySelector('#tbl-sca tbody').innerHTML = D.top.map((r,i)=>`<tr>
    <td class="rank">${i+1}</td>
    <td><div class="t-title">${esc(r.name)}</div><div class="t-sub">${esc(boroName(r))} · ${esc((r.projdesc||'').slice(0,60).toLowerCase())}</div></td>
    <td class="num amt">${fmtMoney(parseFloat(r.award)||0)}</td></tr>`).join('');
}

function renderMTA(){
  if(!D.mtaOk){
    document.getElementById('kpi-mta').textContent = '–';
    document.getElementById('kpi-mta-g').textContent = '–';
    document.getElementById('mta').insertAdjacentHTML('beforebegin', unavail('data.ny.gov, MTA'));
    return;
  }
  // Guard the plan lookups: a label shift should degrade the KPI to a dash,
  // not throw the page. plan29 = the 2025-29 plan, plan24 = the 2020-24 plan.
  const plan29 = D.mtaPlans.find(p=>p.p.includes('2025'));
  const plan24 = D.mtaPlans.find(p=>p.p.includes('2020'));
  if(plan29){
    document.getElementById('kpi-mta').textContent = fmtMoney(plan29.s);
    document.getElementById('kpi-mta-note').textContent = 'current allocations, all agencies';
  } else {
    document.getElementById('kpi-mta').textContent = '–';
  }
  if(plan29 && plan24 && plan24.s > 0){
    const g = (plan29.s/plan24.s-1)*100;
    document.getElementById('kpi-mta-g').textContent = (g>=0?'+':'') + g.toFixed(0) + '%';
  } else {
    document.getElementById('kpi-mta-g').textContent = '–';
  }

  hBar('chart-mta-agency', D.mtaAg.map(r=>r.a), D.mtaAg.map(r=>r.s), COLOR_A);
  destroyChart('chart-mta-plans');
  charts['chart-mta-plans'] = new Chart(document.getElementById('chart-mta-plans'), {
    type:'bar',
    data:{ labels: D.mtaPlans.map(p=>p.p), datasets:[{ data: D.mtaPlans.map(p=>p.s), backgroundColor: COLOR_B, borderRadius:1 }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>fmtMoney(c.parsed.y)}} },
      scales:{ x:{grid:{display:false}}, y:{grid:{color:GRID}, border:{display:false}, ticks:{callback:v=>fmtMoney(v), maxTicksLimit:5}} }
    }
  });
  if(plan29 && plan24 && plan24.s > 0){
    document.getElementById('mta-reading').innerHTML =
      `<strong>Reading:</strong> the MTA's plan has grown every cycle in nominal dollars. The 2025–29 program, at <strong>${fmtMoney(plan29.s)}</strong>, runs ${(plan29.s/plan24.s).toFixed(1)}× the current allocation of the 2020–24 plan. That comparison is not adjusted for construction cost; see the “<a href="/analysis/">Analysis</a>” page's cost-adjusted index for how much of any nominal gain over the same span is price rather than added work.`;
  } else {
    document.getElementById('mta-reading').innerHTML =
      `<strong>Reading:</strong> the MTA's capital program is a separate pool of public work from the City's, on its own ledger.`;
  }
}

function render(){ renderSCA(); renderMTA(); }

(async function init(){
  await fetchAll();
  // Only the hard error state if BOTH sources failed; otherwise render what loaded.
  if(!D.scaOk && !D.mtaOk){
    document.getElementById('loader').style.display='none';
    document.getElementById('error').style.display='block';
    return;
  }
  // The SCA extract is a snapshot, not a live feed: say when it was last
  // republished, so nobody reads today's page as today's site conditions.
  const asOf = D.scaAsOf ? `SCA snapshot as of <strong>${esc(fmtDay(D.scaAsOf))}</strong> · ` : '';
  document.getElementById('series-asof').textContent = D.scaAsOf ? fmtDay(D.scaAsOf).toUpperCase() : '–';
  document.getElementById('asof').innerHTML = D.scaOk
    ? `${asOf}SCA active construction and MTA capital dashboard · <strong>${fmtInt(D.scaCount)}</strong> school projects · five MTA plans`
    : `MTA capital dashboard · SCA data temporarily unavailable`;
  document.getElementById('loader').style.display='none';
  document.getElementById('app').style.display='block';
  render();
})();
