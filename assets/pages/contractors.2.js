'use strict';
/* ===== build marker: competitive-set-wins-v1 ===== */
const AWARD_API = 'https://data.cityofnewyork.us/resource/qyyg-4tf5.json';
const APP_TOKEN = '3TAzQQPiSG2T4WGWfYYUxxqfJ';
const MEGA_FLOOR = 500000000;

const BANDS = [
  { key:'small', name:'Small', range:'under $1M', lo:0,        hi:1000000 },
  { key:'mid',   name:'Mid',   range:'$1M to $10M', lo:1000000, hi:10000000 },
  { key:'large', name:'Large', range:'$10M to $100M', lo:10000000, hi:100000000 },
  { key:'mega',  name:'Mega',  range:'$100M to $500M', lo:100000000, hi:MEGA_FLOOR }
];

const state = {
  rows: [],              // deduped per pin: {amt, day('YYYY-MM-DD'|null), renewal(bool), norm(string)}
  charts: {},
  window: 'ttm',         // 'ttm' | 'all'
  renew: 'excl'          // 'excl' | 'incl'
};

async function getJSON(params){
  const res = await fetch(AWARD_API + '?' + new URLSearchParams(params), {cache:'no-store', headers:{'X-App-Token':'3TAzQQPiSG2T4WGWfYYUxxqfJ'}});
  if(!res.ok) throw new Error('API ' + res.status);
  return res.json();
}

/* deterministic normalization, mirrors the alias-build reference exactly:
   trim, collapse internal whitespace, uppercase, strip periods/commas
   anywhere (so "Co." and "Co", "Inc." and "Inc" fold together, not only at
   the end of the string), then strip trailing punctuation (incl. backslash
   and whitespace). */
function normName(raw){
  return (raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/[;:&/\\'"`\-\s]+$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/* Published day of a City Record timestamp, kept as the raw 'YYYY-MM-DD' prefix
   rather than a Date. Nothing in this section renders the value, it only decides
   windows, and a string keeps that decision independent of the reader's zone. */
// As-of from the data: the latest award day in the market set.
function latestAward(){
  let max = null;
  for(const r of state.rows) if(r.day && (!max || r.day > max)) max = r.day;
  return max ? ' &middot; latest award ' + ci.fmt(max, 'date-utc?') : '';
}
function dayOf(s){
  const t = String(s == null ? '' : s).slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/* Renewal/continuation flag, shared definition with the Awarded and Analysis
   pages: any selection method matching renewal or extension. Today only
   "Renewal" exists in the construction slice, but matching the regex keeps
   the Market universe from diverging if the City adds an extension variant. */
function isContinuation(method){ return /renewal|extension/i.test(method || ''); }

/* per-page fetch with a small bounded retry, so one transient 500/timeout does
   not abort the whole multi-page pull and discard already-fetched pages. */
async function getJSONRetry(params){
  const delays = [400, 900];   // up to 3 attempts total
  let lastErr;
  for(let attempt = 0; attempt <= delays.length; attempt++){
    try{
      return await getJSON(params);
    }catch(e){
      lastErr = e;
      if(attempt === delays.length) break;
      await new Promise(res => setTimeout(res, delays[attempt]));
    }
  }
  throw lastErr;
}

/* paged pull of the full construction-award universe (winners, amount in (0, 500M)).
   The qyyg-4tf5 feed is award notices by nature, so no type-of-notice filter is
   applied; every row in the construction slice is an award. */
async function fetchAll(){
  const where = "starts_with(category_description,'Construction') AND " +
                "contract_amount>0 AND contract_amount<" + MEGA_FLOOR;
  const PAGE = 50000;
  let offset = 0;
  const byPin = new Map();   // pin -> {amt, date, renewal, norm}
  for(;;){
    const batch = await getJSONRetry({
      '$select':'pin,vendor_name,contract_amount,start_date,selection_method_description',
      '$where': where,
      '$order':'pin',
      '$limit': String(PAGE),
      '$offset': String(offset)
    });
    for(let i=0; i<batch.length; i++){
      const r = batch[i];
      const amt = parseFloat(r.contract_amount);
      if(!(amt > 0) || amt >= MEGA_FLOOR) continue;
      // Stable per-row surrogate for missing pin: each such row stands alone
      // (no merge) and the run is byte-reproducible.
      const pin = r.pin || ('_np_' + offset + '_' + i);
      const renewal = isContinuation(r.selection_method_description);
      const rec = { amt, day: dayOf(r.start_date), renewal, norm: normName(r.vendor_name) };
      const prev = byPin.get(pin);
      // dedupe to one record per pin keeping the MAX contract_amount
      if(!prev || rec.amt > prev.amt) byPin.set(pin, rec);
    }
    if(batch.length < PAGE) break;
    offset += PAGE;
    if(offset > 400000) break; // safety stop
  }
  state.rows = [...byPin.values()];
}

/* ===== aggregation for the current window + renewal setting ===== */
/* Canonical trailing twelve months: twelve FULLY-ELAPSED months, so the partial
   current month is never read. Matches the funnel, the Briefing, the Analysis
   index, and the contractor lookup above, which previously ran a rolling
   365-day window here and disagreed with those pages.

   Anchored in UTC and decided on day strings. A local first-of-month formatted
   through toISOString read back a day early east of UTC, and comparing a
   UTC-anchored boundary against a locally-parsed row Date would have gone wrong
   by the reader's offset in the other direction. Raw start_date prefix on one
   side, UTC boundary string on the other, so every reader gets one window. */
function completeMonthBoundary(n){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1))
    .toISOString().slice(0,10);
}
/* Hoisted once per filter pass rather than rebuilt per row: this list runs to
   hundreds of thousands of records. */
function ttmBounds(){ return { lo: completeMonthBoundary(12), hi: completeMonthBoundary(0) }; }
function inTtm(day, b){ return !!day && day >= b.lo && day < b.hi; }

function activeRows(){
  let rows = state.rows;
  if(state.window === 'ttm'){ const b = ttmBounds(); rows = rows.filter(r => inTtm(r.day, b)); }
  if(state.renew === 'excl') rows = rows.filter(r => !r.renewal);
  return rows;
}

function bandOf(amt){
  for(const b of BANDS) if(amt >= b.lo && amt < b.hi) return b.key;
  return null;
}

function hhiLabel(hhi){
  if(hhi < 1500) return { txt:'Fragmented', cls:'frag' };
  if(hhi <= 2500) return { txt:'Moderate', cls:'mod' };
  return { txt:'Concentrated', cls:'conc' };
}

function aggregate(){
  const rows = activeRows();
  const totalCount = rows.length;
  let totalDollars = 0;
  for(const r of rows) totalDollars += r.amt;

  const bandData = {};
  for(const b of BANDS) bandData[b.key] = { count:0, dollars:0, byVendor:new Map() };

  let renewalCount = 0;
  const allVendors = new Set();

  for(const r of rows){
    const k = bandOf(r.amt);
    if(!k) continue;
    const bd = bandData[k];
    bd.count += 1;
    bd.dollars += r.amt;
    bd.byVendor.set(r.norm, (bd.byVendor.get(r.norm) || 0) + r.amt);
    allVendors.add(r.norm);
  }

  // renewal count within the active WINDOW (ignoring the renewal toggle), for the KPI
  let winRows = state.rows;
  if(state.window === 'ttm'){ const wb = ttmBounds(); winRows = winRows.filter(r => inTtm(r.day, wb)); }
  for(const r of winRows) if(r.renewal) renewalCount++;

  // per-band concentration
  const bands = BANDS.map(b => {
    const bd = bandData[b.key];
    // vendor list with dollars and a per-vendor award count (for top-N-by-count selection)
    const vcount = new Map();
    for(const r of rows){
      if(bandOf(r.amt) !== b.key) continue;
      vcount.set(r.norm, (vcount.get(r.norm) || 0) + 1);
    }
    const vendors = [...bd.byVendor.entries()].map(([norm, dollars]) => ({
      dollars, count: vcount.get(norm) || 0
    }));
    // HHI over dollar shares
    let hhi = 0;
    if(bd.dollars > 0){
      for(const v of vendors){ const sh = v.dollars / bd.dollars; hhi += sh * sh; }
      hhi *= 10000;
    }
    // top-N by COUNT, then their dollar share of the band
    const byCount = [...vendors].sort((a,b)=> b.count - a.count || b.dollars - a.dollars);
    const topShare = (n) => {
      if(bd.dollars <= 0) return null;
      let s = 0; for(const v of byCount.slice(0, n)) s += v.dollars;
      return s / bd.dollars;
    };
    return {
      ...b,
      count: bd.count,
      dollars: bd.dollars,
      countShare: totalCount ? bd.count / totalCount : 0,
      dollarShare: totalDollars ? bd.dollars / totalDollars : 0,
      distinct: bd.byVendor.size,
      top3: topShare(3), top5: topShare(5), top10: topShare(10),
      hhi
    };
  });

  return { totalCount, totalDollars, distinct: allVendors.size, renewalCount, bands };
}

/* ===== formatting ===== */
function fmtMoney(v){ return ci.fmt(v, 'money'); }
function fmtInt(v){ return (v||0).toLocaleString('en-US'); }
function fmtPct(v){ return ci.fmt(v, 'pct1-html?'); }
function esc(s){ const d = document.createElement('div'); d.textContent = String(s==null?'':s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); return d.innerHTML; }

/* ===== chart defaults ===== */
const COLOR_A = '#a8462c', COLOR_B = '#243b53', GRID = '#e6ddd5';
Chart.defaults.font.family = "'IBM Plex Mono',monospace";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#6b5e56';
Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor:'#fefbf8', titleColor:'#201611', bodyColor:'#6b5e56',
  borderColor:'#201611', borderWidth:1, cornerRadius:2, padding:10, displayColors:false,
  boxWidth:10, boxHeight:10,
  titleFont:{family:"'Public Sans',sans-serif",weight:'600',size:12}, bodyFont:{family:"'IBM Plex Mono',monospace",size:12},
  caretSize:5
});

function destroyChart(id){ if(state.charts[id]){ state.charts[id].destroy(); delete state.charts[id]; } }

/* ===== rendering ===== */
function renderKpis(a){
  document.getElementById('kpi-count').textContent = fmtInt(a.totalCount);
  document.getElementById('kpi-count-note').textContent =
    (state.window === 'ttm' ? 'trailing 12 months' : 'all time') +
    (state.renew === 'excl' ? ', renewals excluded' : ', renewals included');
  document.getElementById('kpi-dollars').textContent = fmtMoney(a.totalDollars);
  document.getElementById('kpi-awardees').textContent = fmtInt(a.distinct);
  document.getElementById('kpi-renewals').textContent = fmtInt(a.renewalCount);
  document.getElementById('kpi-renewals-note').textContent =
    'renewal notices in window' + (state.renew === 'excl' ? ', held out of the set' : ', folded into the set');
}

function renderBandsChart(a){
  destroyChart('chart-bands');
  const labels = a.bands.map(b => b.name + ' (' + b.range + ')');
  state.charts['chart-bands'] = new Chart(document.getElementById('chart-bands'), {
    type:'bar',
    data:{ labels, datasets:[
      { label:'Count share', data:a.bands.map(b => +(b.countShare*100).toFixed(2)), backgroundColor:COLOR_B, borderRadius:1 },
      { label:'Dollar share', data:a.bands.map(b => +(b.dollarShare*100).toFixed(2)), backgroundColor:COLOR_A, borderRadius:1 }
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top', labels:{boxWidth:12, boxHeight:12, font:{size:12}}},
        tooltip:{callbacks:{label:(c)=> c.dataset.label + ': ' + c.parsed.y.toFixed(1) + '%'}} },
      scales:{
        x:{grid:{display:false}, ticks:{maxRotation:0, autoSkip:false, font:{size:12}}},
        y:{grid:{color:GRID}, border:{display:false}, ticks:{callback:(v)=>v+'%', maxTicksLimit:6}, title:{display:true, text:'Share of set', color:'#766a60', font:{size:12}}}
      }
    }
  });
}

function renderBandsTable(a){
  document.querySelector('#tbl-bands tbody').innerHTML = a.bands.map(b => `<tr>
    <td><span class="t-title">${esc(b.name)}</span><div class="t-sub">${esc(b.range)}</div></td>
    <td class="num">${fmtInt(b.count)}</td>
    <td class="num">${(b.countShare*100).toFixed(1)}%</td>
    <td class="num amt">${fmtMoney(b.dollars)}</td>
    <td class="num">${(b.dollarShare*100).toFixed(1)}%</td>
    <td class="num">${fmtInt(b.distinct)}</td>
  </tr>`).join('');
}

function renderConcentration(a){
  document.getElementById('conc-grid').innerHTML = a.bands.map(b => {
    const lab = hhiLabel(b.hhi);
    return `<div class="conc">
      <div class="c-band">${esc(b.name)}</div>
      <div class="c-range">${esc(b.range)} &middot; ${fmtInt(b.distinct)} distinct awardees</div>
      <div class="c-row"><span class="lab">Top 3 by count · dollar share</span><span class="val">${fmtPct(b.top3)}</span></div>
      <div class="c-row"><span class="lab">Top 5 by count · dollar share</span><span class="val">${fmtPct(b.top5)}</span></div>
      <div class="c-row"><span class="lab">Top 10 by count · dollar share</span><span class="val">${fmtPct(b.top10)}</span></div>
      <div class="c-row"><span class="lab">HHI index</span><span class="val">${b.dollars>0 ? Math.round(b.hhi).toLocaleString('en-US') : '&ndash;'} <span class="pill ${lab.cls}">${lab.txt}</span></span></div>
    </div>`;
  }).join('');
}

function renderReading(a){
  const win = state.window === 'ttm' ? 'Trailing 12 months' : 'All time';
  // band holding the most awards by count, and the most dollars
  const byCount = [...a.bands].sort((x,y)=> y.count - x.count)[0];
  const byDollars = [...a.bands].sort((x,y)=> y.dollars - x.dollars)[0];
  // concentration trend across bands (small -> mega)
  const fragBands = a.bands.filter(b => b.dollars>0 && hhiLabel(b.hhi).txt==='Fragmented').map(b=>b.name);
  const concBands = a.bands.filter(b => b.dollars>0 && hhiLabel(b.hhi).txt==='Concentrated').map(b=>b.name);
  const labelList = (arr) => arr.length===0 ? '' : (arr.length===1 ? arr[0] : arr.slice(0,-1).join(', ') + ' and ' + arr[arr.length-1]);

  let concSentence;
  if(concBands.length && fragBands.length){
    concSentence = 'The ' + labelList(fragBands).toLowerCase() + ' band' + (fragBands.length>1?'s read':' reads') + ' as fragmented, while the ' + labelList(concBands).toLowerCase() + ' band' + (concBands.length>1?'s read':' reads') + ' as concentrated: fewer awardees account for more of the dollars as award size rises.';
  } else if(concBands.length){
    concSentence = 'Concentration is highest in the ' + labelList(concBands).toLowerCase() + ' band' + (concBands.length>1?'s':'') + ', where fewer awardees account for more of the dollars.';
  } else if(fragBands.length){
    concSentence = 'No band crosses into concentrated; the ' + labelList(fragBands).toLowerCase() + ' band' + (fragBands.length>1?'s remain':' remains') + ' fragmented across many awardees.';
  } else {
    concSentence = 'Concentration sits in the moderate range across the bands in this window.';
  }

  const renewClause = state.renew === 'excl'
    ? a.renewalCount.toLocaleString('en-US') + ' renewal notices held out'
    : a.renewalCount.toLocaleString('en-US') + ' renewal notices folded in';

  const p =
    `${win}: ${fmtInt(a.totalCount)} construction award notices, ${fmtMoney(a.totalDollars)}, deduped to one record per procurement, ${renewClause}, and $500M+ megaprojects excluded. ` +
    `The ${byCount.name.toLowerCase()} band holds the most awards by count, while the ${byDollars.name.toLowerCase()} band holds the most dollars: many small awards sit against a few large ones that carry the spend. ` +
    `${concSentence} ` +
    `Awardee names are used only as a deterministic grouping key and are never published, ranked, scored, or presented as a measure of any contractor's standing or creditworthiness.`;
  document.getElementById('ms-reading').textContent = p;
}

function renderAll(){
  const a = aggregate();
  renderKpis(a);
  renderBandsChart(a);
  renderBandsTable(a);
  renderConcentration(a);
  renderReading(a);
}

/* ===== controls ===== */
function wireControls(){
  document.getElementById('seg-window').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    document.querySelectorAll('#seg-window button').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on'); state.window = btn.dataset.w; renderAll();
  });
  document.getElementById('seg-renew').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    document.querySelectorAll('#seg-renew button').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on'); state.renew = btn.dataset.r; renderAll();
  });
}

/* ===== init ===== */
(async function init(){
  try{
    await fetchAll();
  }catch(e){
    document.getElementById('loader').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    return;
  }
  document.getElementById('asof').innerHTML =
    'City Record construction award notices &middot; deduped per procurement' + latestAward();
  document.getElementById('loader').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  wireControls();
  renderAll();
})();
