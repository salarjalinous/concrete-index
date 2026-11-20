'use strict';
/* ================= data layer ================= */
const API = 'https://data.cityofnewyork.us/resource/qyyg-4tf5.json';
const HARD = 'Construction/Construction Services';
const REL  = 'Construction Related Services';

const state = { windowMonths: 12, scope: 'all', type: 'all', size: 'all', worktype: 'all', rows: [], truncated: false };
const WT_LEXICON={
  paving_roadway:{label:"Paving & Roadway",include:[/\basphalt\b/,/\bpaving\b/,/\bpavement\b/,/\brepaving\b/,/\bresurfac/,/\broadway\b/,/\bparkway\b/,/\broad repair/,/\bmilling\b/,/\bstreetscape/,/\bcrosstown/,/\bselect bus service\b|\bSBS\b/,/\btouring route/,/pavement marking/,/reconstruction of .*\b(street|avenue|ave|road|boulevard|blvd)\b/,/\bkill road\b/,/\broad repair agreement/,/street name sign/]},
  sidewalk_curb_ramp:{label:"Sidewalk, Curb & Pedestrian Ramp",include:[/\bsidewalk/,/\bpedestrian ramp/,/\bcurb/,/\bstep street/,/\bprior notice sidewalk/,/\broadway restoration/],exclude:[/sidewalk (?:shed|protection)/]},
  water_sewer:{label:"Water & Sewer",include:[/\bsewer/,/\bwater main/,/\bwatermain/,/\bdistribution water/,/\btrunk water/,/\blead service line/,/\bLSLR/,/\bsewer lin(?:e|ing)/,/\bcombined sewer/,/\binterceptor/,/\bdrainage/,/\bcatch basin/,/\bwastewater/,/\bWRRF\b/,/\bwater resource recovery/,/\bsludge/,/\bCSO\b/,/\bjet flusher/,/\bvactor/,/\bcloudburst/,/\bgreen infrastructure\b|\bGI Construction\b|\bGKOH/,/\bbioswale/,/\bnitrogen removal/,/\bdeammonification/,/\bactivated sludge/,/\bdewatering/,/\bsettling tank/,/\bflood mitigation/,/\bstorm sewer/,/\bsanitary/,/\breservoir\b/,/landfill gas/,/\bwater main\b/]},
  schools_education:{label:"Schools & Education",include:[/\bschool\b/,/\bP\.?S\.?\s?\d/,/\bI\.?S\.?\s?\d/,/\bclassroom/,/safe routes to school/]},
  library:{label:"Library",include:[/\blibrary\b/]},
  electrical:{label:"Electrical",include:[/\belectric/,/\belect\b/,/\belec\b/,/\btraffic signal/,/\bpedestrian signal/,/\bstreet ?light/,/\bsports lighting/,/\blight fixture/,/\bballast/,/\bgenerator/,/\bstandby power\b|emergency power/,/\bsolar pv\b|solar equipment/,/\bpower distribution/,/\belectrical infrastructure/,/\bcable infrastructure/,/\bfire alarm/]},
  demolition:{label:"Demolition",include:[/\bdemolition/,/\bdemo\b/,/\bIED\b/,/\bbrace (?:&|and) shore/,/\bshoring\b/]},
  hvac_mechanical:{label:"HVAC & Mechanical",include:[/\bHVAC\b/,/\bboiler/,/\bheating/,/\bchiller/,/\bair handling/,/\bmechanical/,/\bdehumidif/,/\bsteam tunnel/,/\bventilation/,/\boil-?fired/,/\bcommissioning/,/\bBMS\b/,/\bchimney/]},
  plumbing:{label:"Plumbing & Fire Suppression",include:[/\bplumbing/,/\bfire suppression/,/\bsprinkler/,/\bstandpipe/]},
  roofing:{label:"Roofing",include:[/\broof/]},
  facade_masonry:{label:"Facade, Masonry & Envelope",include:[/\bfacade|façade/,/\bmasonry/,/\bparapet/,/\benvelope/,/exterior (?:renovation|envelope|restoration)/,/local law 11\b/,/\bLL11\b/,/building seal-?up|sealup/,/\brepointing|\bpointing\b/,/\bbrick/,/steel and concrete rehab/,/\bretaining wall/,/\barch reconstruction/,/\bpainting\b/]},
  parks_landscape:{label:"Parks & Landscape",include:[/\bplayground/,/\btree planting/,/\btree removal/,/\btree replacement/,/\btree-?damaged/,/\bemerald ash borer\b|\bEAB\b/,/\blandscape/,/synthetic turf|turf field/,/\bballfield/,/\bball ?field/,/\besplanade/,/\bgreenway|green ?street/,/\bcomfort station/,/recreation center|rec ctr|rec center/,/\bbasketball|handball|tennis court/,/forest restoration/,/\bwetland/,/sports court|sports field/,/adult fitness/,/play equipment|play area/,/\bbleacher/,/\bflagpole/,/safety netting/,/spray shower/,/\bdog run/,/\bpathway/,/\bstaircase/,/\bstadium\b/,/\bgreen\b reconstruction/],ambiguousInclude:[/\bpark\b/],ambiguousExclude:[/park avenue|\bparking\b/]},
  bridges_marine:{label:"Bridges & Marine",include:[/\bbridge/,/protective coating/,/\bmarine\b/,/\bmarina\b/,/\bpier\b/,/\bpiling/,/\bbulkhead/,/\bwaterfront/,/\bferry/,/\bdock\b/,/\bskiff|barge|tugboat/,/\bseawall|sea wall/,/\bunderpass|overpass/,/\bdam\b/,/coastal resilien/]},
  abatement_environmental:{label:"Abatement & Environmental",include:[/\babatement/,/\basbestos\b/,/\bACM\b/,/lead (?:abatement|based paint|paint hazard|service)/,/\bmold\b/,/air monitoring|air sampling/,/\bremediat/,/\bhazardous|hazmat/,/environmental services/,/environmental engineering/]},
  buildings_general:{label:"Buildings & General Construction",include:[/general construction|general contracting/,/\bGC\b/,/job order contract|\bJOC\b/,/\brenovation/,/\brehabilitation\b/,/\brehab\b/,/building upgrade/,/construction of (?:new )?(?:offices|building)/,/garage (?:rehab|reconstruction)/,/fire station|firehouse|engine co|ladder co/,/family court|supreme court|courthouse/,/\bshelter\b/,/\bresidence\b/,/public restroom|restroom building/,/\bdetention|\bjail/,/\bhandyperson/,/on-?call general/]},
  doors_windows_security:{label:"Doors, Windows & Security",include:[/\bdoor\b|doors\b/,/window guard/,/\bwindow\b/,/\bgate\b/,/\bfenc(?:e|ing)/,/security barrier/,/razor wire/,/\belevator/,/\bhinge/,/overhead door|roll-?up door/,/revolving|swing door/,/\bbarrier/]},
  scaffolding_shed:{label:"Scaffolding & Sheds",include:[/\bscaffold/,/sidewalk shed|sidewalk protection shed|sidewalk sheds/,/\bshed\b/,/temporary shoring/]},
};
function wtClassify(title){const t=title||'';const tags=[];for(const k in WT_LEXICON){const d=WT_LEXICON[k];let hit=(d.include||[]).some(function(rx){return new RegExp(rx.source,'i').test(t);});if(!hit&&d.ambiguousInclude){const amb=d.ambiguousInclude.some(function(rx){return new RegExp(rx.source,'i').test(t);});const blk=(d.ambiguousExclude||[]).some(function(rx){return new RegExp(rx.source,'i').test(t);});if(amb&&!blk)hit=true;}if(!hit)continue;if((d.exclude||[]).some(function(rx){return new RegExp(rx.source,'i').test(t);}))continue;tags.push(k);}return tags;}
const MEGA = 500e6;
function isContinuation(method){ return /renewal|extension/i.test(method || ''); }

/* First of the month n complete months back, as a 'YYYY-MM-DD' string.
   monthBoundary(0) is the first of the current, incomplete month, so
   [monthBoundary(n), monthBoundary(0)) is n fully-elapsed months. This is the
   same rule as isoBoundary on the Home page and isoCompleteMonthBoundary on the
   Funnel, the Briefing and the Agencies page.

   Anchored in UTC end to end. The window used to be built as local midnight
   Date objects, which made the boundary an absolute instant that moved with the
   reader: formatted through toISOString it named the previous day for anyone
   east of UTC, and at the turn of a month it advanced the whole window hours
   before New York got there. Date.UTC in, toISOString out.

   The boundary is a string because the rows are strings. Socrata returns
   start_date as a floating timestamp with no zone, and a lexicographic compare
   on ISO-8601 is a chronological compare, so string-against-string needs no
   parsing and cannot pick up a local offset on either side. */
function monthBoundary(n){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1))
    .toISOString().slice(0,10);
}

/* Canonical construction-awards dedupe: one row per procurement (pin), keeping
   the maximum contract_amount seen for that pin. The same award can be published
   as several near-duplicate notices; summing raw rows overstates the total by the
   duplicate share. Rows with no pin stand alone under a stable per-row surrogate. */
function dedupeByPin(raw){
  const byPin = new Map();
  for(let i=0; i<raw.length; i++){
    const r = raw[i];
    const amt = parseFloat(r.contract_amount);
    if(!(amt > 0)) continue;
    const pin = r.pin || ('_np_' + i);
    const prev = byPin.get(pin);
    if(!prev || amt > (parseFloat(prev.contract_amount)||0)) byPin.set(pin, r);
  }
  return [...byPin.values()];
}

const AWARD_LIMIT = 20000;
/* The widest window the control offers, in complete months. The pull must reach
   back at least this far or the 5-year view would silently understate. */
const MAX_WINDOW = 60;
async function fetchAwards(){
  const params = new URLSearchParams({
    '$select': 'pin,request_id,start_date,agency_name,category_description,short_title,selection_method_description,vendor_name,contract_amount,additional_description_1',
    '$where': `starts_with(category_description,'Construction') AND start_date>='${monthBoundary(MAX_WINDOW)}' AND contract_amount>0`,
    '$order': 'start_date DESC',
    '$limit': String(AWARD_LIMIT)
  });
  const res = await fetch(`${API}?${params}`, { headers: { 'X-App-Token': '3TAzQQPiSG2T4WGWfYYUxxqfJ' } });
  if(!res.ok) throw new Error('API ' + res.status);
  const raw = await res.json();
  // Truncation guard: if the returned row count equals the cap, the single-page
  // pull may be clipping the universe. The 5-year construction slice is well
  // under 20k today (all-time is ~8,200 rows), so this never fires now, but it
  // keeps a future data-growth truncation from silently understating KPIs.
  state.truncated = raw.length >= AWARD_LIMIT;
  if(state.truncated){
    console.warn('Award pull hit the ' + AWARD_LIMIT + '-row cap; the view may be capped and totals may be understated.');
  }
  return dedupeByPin(raw).map(normalize);
}

const BORO_PATTERNS = [
  ['Manhattan', /\bmanhattan\b|\bnew york county\b/i],
  ['Brooklyn',  /\bbrooklyn\b|\bkings county\b|\bbklyn\b/i],
  ['Queens',    /\bqueens\b/i],
  ['Bronx',     /\bbronx\b/i],
  ['Staten Island', /\bstaten island\b|\brichmond county\b/i]
];

function stripHtml(s){ return (s||'').replace(/<[^>]*>/g,' '); }

function deriveBorough(title, desc){
  const text = (title + ' ' + stripHtml(desc)).toLowerCase();
  const hits = BORO_PATTERNS.filter(([,re]) => re.test(text)).map(([name]) => name);
  if(hits.length === 1) return hits[0];
  if(hits.length > 1) return 'Multi-borough';
  return 'Citywide / Unspecified';
}

function normalize(r){
  return {
    id: r.request_id,
    // `date` is for display only, parsed and formatted locally so the two sides
    // agree. `day` is the raw ISO date and is what every window test compares.
    date: new Date(r.start_date),
    day: r.start_date.slice(0,10),
    month: r.start_date.slice(0,7),
    agency: r.agency_name || 'Unspecified',
    cat: r.category_description === HARD ? 'hard' : 'rel',
    title: r.short_title || '(untitled)',
    method: r.selection_method_description || '',
    kind: isContinuation(r.selection_method_description) ? 'cont' : 'new',
    tags: wtClassify(r.short_title || ''),
    vendor: (r.vendor_name || 'Unspecified').trim(),
    amount: parseFloat(r.contract_amount) || 0,
    borough: deriveBorough(r.short_title || '', r.additional_description_1 || '')
  };
}

/* ================= aggregation ================= */
function inScope(row){
  if(state.scope !== 'all' && row.cat !== state.scope) return false;
  if(state.type === 'new' && row.kind !== 'new') return false;
  if(state.type === 'cont' && row.kind !== 'cont') return false;
  if(state.size === 'exmega' && row.amount >= MEGA) return false;
  if(state.worktype === 'uncat' && row.tags.length) return false;
  if(state.worktype !== 'all' && state.worktype !== 'uncat' && !row.tags.includes(state.worktype)) return false;
  return true;
}

/* Every window on this page is twelve (or 36, or 60) FULLY-ELAPSED months, the
   sitewide rule: the current partial month is excluded so a few days of the
   month in progress cannot understate a total or put this page at odds with
   Home, the Funnel, the Briefing, and Analysis. */
function filtered(){
  const start = monthBoundary(state.windowMonths);
  const end = monthBoundary(0);
  return state.rows.filter(r => r.day >= start && r.day < end && inScope(r));
}

function priorPeriod(){
  const start = monthBoundary(state.windowMonths * 2);
  const end = monthBoundary(state.windowMonths);
  return state.rows.filter(r => r.day >= start && r.day < end && inScope(r));
}

function sum(rows){ return rows.reduce((a,r) => a + r.amount, 0); }

function median(rows){
  if(!rows.length) return 0;
  const v = rows.map(r => r.amount).sort((a,b) => a-b);
  const m = Math.floor(v.length/2);
  return v.length % 2 ? v[m] : (v[m-1]+v[m])/2;
}

function groupSum(rows, keyFn){
  const m = new Map();
  for(const r of rows){
    const k = keyFn(r);
    const g = m.get(k) || { total:0, count:0 };
    g.total += r.amount; g.count++;
    m.set(k, g);
  }
  return m;
}

function monthSeries(rows){
  // Ordered list of months in the window with hard/rel sums. The bounds are
  // already first-of-month, so the series runs [boundary(n) .. boundary(0)) and
  // yields exactly n bars, with no partial current month trailing off the end.
  // Keys are sliced from the same UTC boundary the window uses, so they line up
  // with r.month, which is sliced from the raw start_date.
  const months = [];
  for(let i = state.windowMonths; i > 0; i--) months.push(monthBoundary(i).slice(0,7));
  const hard = Object.fromEntries(months.map(m => [m,0]));
  const rel  = Object.fromEntries(months.map(m => [m,0]));
  for(const r of rows){
    if(r.month in hard){
      if(r.cat === 'hard') hard[r.month] += r.amount; else rel[r.month] += r.amount;
    }
  }
  return { months, hard: months.map(m=>hard[m]), rel: months.map(m=>rel[m]) };
}

/* ================= formatting ================= */
function fmtMoney(v){
  if(v >= 1e9) return '$' + (v/1e9).toFixed(v >= 10e9 ? 1 : 2) + 'B';
  if(v >= 1e6) return '$' + (v/1e6).toFixed(v >= 100e6 ? 0 : 1) + 'M';
  if(v >= 1e3) return '$' + Math.round(v/1e3) + 'K';
  return '$' + Math.round(v);
}
function fmtInt(v){ return v.toLocaleString('en-US'); }
function fmtDate(d){ return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function fmtMonthLabel(m){
  const [y,mo] = m.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return names[+mo-1] + ' ’' + y.slice(2);
}
function esc(s){ const d = document.createElement('div'); d.textContent = String(s==null?'':s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); return d.innerHTML; }
const WINDOW_LABEL = { 12:'trailing 12 months', 36:'trailing 3 years', 60:'trailing 5 years' };

/* ================= rendering ================= */
const COLOR_HARD = '#a8462c', COLOR_REL = '#243b53', GRID = '#e6ddd5';
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

function renderTrend(rows){
  const s = monthSeries(rows);
  destroyChart('trend');
  const datasets = [];
  if(state.scope !== 'rel') datasets.push({label:'Construction', data:s.hard, backgroundColor:COLOR_HARD, borderRadius:1, stack:'a'});
  if(state.scope !== 'hard') datasets.push({label:'Related services', data:s.rel, backgroundColor:COLOR_REL, borderRadius:1, stack:'a'});
  charts.trend = new Chart(document.getElementById('chart-trend'), {
    type:'bar',
    data:{ labels:s.months.map(fmtMonthLabel), datasets },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{position:'top', align:'end', labels:{boxWidth:9, boxHeight:9, usePointStyle:true, pointStyle:'rect', font:{family:"'Public Sans',sans-serif",size:12}}},
        tooltip:{callbacks:{label:(c)=> c.dataset.label + ': ' + fmtMoney(c.parsed.y)}}
      },
      scales:{
        x:{stacked:true, grid:{display:false}, ticks:{maxRotation:0, autoSkip:true, maxTicksLimit:12}},
        y:{stacked:true, grid:{color:GRID}, border:{display:false}, ticks:{callback:moneyTicks, maxTicksLimit:6}}
      }
    }
  });
  document.getElementById('trend-sub').textContent =
    'Published award value by month, ' + WINDOW_LABEL[state.windowMonths];
}

const AGENCY_SHORT = {
  'Design and Construction':'Design & Construction (DDC)',
  'Environmental Protection':'Environmental Protection (DEP)',
  'Parks and Recreation':'Parks & Recreation',
  'Housing Preservation and Development':'Housing Preservation & Dev (HPD)',
  'Citywide Administrative Services':'Citywide Admin Services (DCAS)',
  'School Construction Authority':'School Construction Authority (SCA)',
  'Health and Mental Hygiene':'Health & Mental Hygiene (DOHMH)',
  'Homeless Services':'Homeless Services (DHS)',
  'Administration for Children’s Services':'Children’s Services (ACS)'
};
function agencyLabel(a){ return AGENCY_SHORT[a] || a; }

function renderBarChart(key, canvasId, entries, color){
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
        tooltip:{callbacks:{label:(c)=> fmtMoney(c.parsed.x) + ' across ' + fmtInt(entries[c.dataIndex][1].count) + ' awards'}}
      },
      scales:{
        x:{grid:{color:GRID}, border:{display:false}, ticks:{callback:moneyTicks, maxTicksLimit:5}},
        y:{grid:{display:false}, ticks:{autoSkip:false, font:{family:"'Public Sans',sans-serif",size:12.5}}}
      }
    }
  });
}

function renderAgencies(rows){
  const entries = [...groupSum(rows, r=>agencyLabel(r.agency)).entries()]
    .sort((a,b)=>b[1].total-a[1].total).slice(0,8);
  renderBarChart('agency','chart-agency', entries, COLOR_HARD);
}

const BORO_ORDER = ['Brooklyn','Queens','Manhattan','Bronx','Staten Island','Multi-borough','Citywide / Unspecified'];
function renderBoroughs(rows){
  const g = groupSum(rows, r=>r.borough);
  const entries = BORO_ORDER.filter(b=>g.has(b)).map(b=>[b,g.get(b)]);
  renderBarChart('boro','chart-boro', entries, COLOR_REL);
}

function renderVendors(rows){
  const entries = [...groupSum(rows, r=>r.vendor).entries()]
    .sort((a,b)=>b[1].total-a[1].total).slice(0,10);
  const tb = document.querySelector('#tbl-vendors tbody');
  tb.innerHTML = entries.map((e,i)=>`<tr>
    <td class="rank">${i+1}</td>
    <td><a class="t-title" href="/contractors/?q=${encodeURIComponent(e[0])}" title="See this contractor's full award history">${esc(e[0])}</a></td>
    <td class="num">${fmtInt(e[1].count)}</td>
    <td class="num amt">${fmtMoney(e[1].total)}</td>
  </tr>`).join('');
}

function renderRecent(rows){
  const tb = document.querySelector('#tbl-recent tbody');
  tb.innerHTML = rows.slice(0,15).map(r=>`<tr>
    <td class="mono u-nowrap">${fmtDate(r.date)}</td>
    <td>
      <div class="t-title">${esc(r.title)}</div>
      <div class="t-sub">${esc(r.vendor)} · ${esc(r.method)} · <span class="pill ${r.cat}">${r.cat==='hard'?'Construction':'Related services'}</span></div>
    </td>
    <td>${esc(agencyLabel(r.agency))}</td>
    <td class="num amt">${fmtMoney(r.amount)}</td>
  </tr>`).join('');
}

function renderKpis(rows){
  const total = sum(rows);
  const priorRows = priorPeriod();
  const prior = sum(priorRows);
  const delta = prior > 0 ? (total - prior) / prior * 100 : null;
  document.getElementById('kpi-total').textContent = fmtMoney(total);
  document.getElementById('kpi-total-note').innerHTML = delta === null ? WINDOW_LABEL[state.windowMonths] :
    `<span class="${delta>=0?'up':'down'}">${delta>=0?'+':'−'}${Math.abs(delta).toFixed(0)}%</span> in dollars vs prior period, same filters`;
  // Gross-swing caveat. The headline total is gross: it counts renewals and
  // one-off large awards, so a period-over-period change can move on a single
  // lumpy contract and is not by itself a read on the underlying market. This
  // note therefore rides with any change figure shown, not only when a $500M-plus
  // megaproject happens to sit in a compared window; when one does, the note
  // sharpens to name it. Either way it points to the index, which sets renewals
  // and megaprojects aside to track the cycle.
  const megaNote = document.getElementById('kpi-mega-note');
  if(megaNote){
    const megaIn = state.size !== 'exmega' &&
      (rows.some(r => r.amount >= MEGA) || priorRows.some(r => r.amount >= MEGA));
    if(delta === null){
      megaNote.innerHTML = '';
      megaNote.style.display = 'none';
    } else {
      megaNote.innerHTML = megaIn
        ? `A single award of $500M or more sits in one of the compared periods, so this change can turn on one contract: read it as the gross swing, not a market trend. The <a href="/analysis/">Concrete Index</a> sets renewals and awards of $500M or more aside to track the underlying cycle.`
        : `This is a gross change: it counts renewals and one-off large awards, so a single lumpy contract can move it on its own. The <a href="/analysis/">Concrete Index</a> sets renewals and awards of $500M or more aside to track the underlying cycle.`;
      megaNote.style.display = '';
    }
  }
  document.getElementById('kpi-count').textContent = fmtInt(rows.length);
  document.getElementById('kpi-count-note').textContent = 'award notices, ' + WINDOW_LABEL[state.windowMonths];
  document.getElementById('kpi-median').textContent = fmtMoney(median(rows));
  const top = rows.reduce((a,r)=> r.amount > (a?a.amount:0) ? r : a, null);
  document.getElementById('kpi-max').textContent = top ? fmtMoney(top.amount) : '–';
  document.getElementById('kpi-max-note').textContent = top ? agencyLabel(top.agency) : '';
}

function renderAll(){
  const rows = filtered();
  renderKpis(rows);
  renderTrend(rows);
  renderAgencies(rows);
  renderBoroughs(rows);
  renderVendors(rows);
  renderRecent(rows);
  renderUncatShare();
}

/* Share of awards whose title carries no work-type keyword. Computed over the
   current window, scope, type, and size, but with the work-type control itself
   held out: filtering to a tag would force this to 0% and filtering to
   Uncategorized would force it to 100%, so the figure would report the control
   rather than the data. */
function renderUncatShare(){
  const el = document.getElementById('wt-uncat-share');
  if(!el) return;
  const saved = state.worktype;
  state.worktype = 'all';
  const rows = filtered();
  state.worktype = saved;
  el.textContent = rows.length
    ? Math.round(rows.filter(r => !r.tags.length).length / rows.length * 100) + '%'
    : '–';
}

/* ================= controls ================= */
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

/* The commitment-to-cash span strip that used to live here was removed. Its
   markup (#ss-awarded, #ss-paid and their detail cells) is not in this page, so
   both writers were null-guarded no-ops while the Paid half still downloaded the
   whole nightly Checkbook vendor file on every visit. The awarded-to-paid bridge
   is the "Funnel" page's job, where committed, awarded and spent sit side by
   side against their own sources; this page's scope is the award notice itself.
   Rebuilding the strip here would duplicate the Funnel and give the two pages a
   way to drift, so the fetch went rather than the markup coming back. */

/* Resilience fallback: when the live City API can't be reached, show the last
   archived Awarded figure (nightly data/precomputed.json, computed with the same
   pin-dedup rule) in the error panel instead of a bare failure message. Live path
   is untouched; this runs only in the init catch. Returns true if it rendered a
   fallback. It writes only into #error, the one element on the page that
   actually shows it. */
async function showArchivedFallback(){
  try{
    const res = await fetch('/data/precomputed.json', {cache:'no-store'});
    if(!res.ok) return false;
    const d = await res.json();
    const a = (d && d.awarded_ttm) || {};
    if(typeof a.total !== 'number') return false;
    const when = d.meta && d.meta.generated ? new Date(d.meta.generated) : null;
    const asof = (when && !isNaN(when)) ? fmtDate(when) : 'recently';
    const err = document.getElementById('error');
    err.innerHTML = '<p><strong>Live NYC Open Data is temporarily unavailable.</strong></p>'
      + '<p>The last archived trailing-twelve-month awarded total was ' + fmtMoney(a.total) + ', as of ' + asof
      + '. The full charts and filters return automatically when the live source is back.</p>'
      + '<button type="button" class="ci-btn u-mt-3" data-action="reload">Retry</button>';
    err.style.display = 'block';
    return true;
  }catch(_){ return false; }
}

/* ================= init ================= */
(async function init(){
  try{
    state.rows = await fetchAwards();
  }catch(e){
    document.getElementById('loader').style.display = 'none';
    const shown = await showArchivedFallback();
    if(!shown) document.getElementById('error').style.display = 'block';
    return;
  }
  const latest = state.rows.length ? state.rows[0].date : null;
  document.getElementById('asof').innerHTML = latest ?
    `Latest award published <strong>${fmtDate(latest)}</strong> · ${fmtInt(state.rows.length)} construction awards in the trailing five years · source refreshed daily` : '';
  if(latest){
    document.getElementById('series-asof').textContent = fmtDate(latest).toUpperCase();
  }
  document.getElementById('loader').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  if(state.truncated){
    const tn = document.getElementById('trunc-note');
    if(tn) tn.style.display = '';
  }
  let ready = false;
  wireSeg('seg-window','w', '12', v => { state.windowMonths = +v; if(ready) renderAll(); });
  wireSeg('seg-scope','s', 'all', v => { state.scope = v; if(ready) renderAll(); });
  wireSeg('seg-type','t', 'all', v => { state.type = v; if(ready) renderAll(); });
  wireSeg('seg-size','z', 'all', v => { state.size = v; if(ready) renderAll(); });
  const sel = document.getElementById('sel-worktype');
  const opts = Object.keys(WT_LEXICON).map(k => `<option value="${k}">${WT_LEXICON[k].label}</option>`).join('');
  sel.innerHTML = '<option value="all">All work types</option>' + opts + '<option value="uncat">Uncategorized</option>';
  sel.addEventListener('change', e => { state.worktype = e.target.value; if(ready) renderAll(); });
  ready = true;
  renderAll();
})();
