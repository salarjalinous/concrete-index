'use strict';
const API = 'https://data.cityofnewyork.us/resource/3khw-qi8f.json';
const HARD = 'Construction/Construction Services';
const state = { scope:'all', q:'', sort:'due', rows:[], dropped:0 };

function stripHtml(s){ const d=document.createElement('div'); d.innerHTML=s||''; return (d.textContent||'').replace(/\s+/g,' ').trim(); }
function esc(s){ const d=document.createElement('div'); d.textContent=String(s==null?'':s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); return d.innerHTML; }
const DASH = '–';
// Trim a raw field; treat blanks and literal null/undefined strings as empty.
function cleanField(v){
  const s = (v==null ? '' : String(v)).trim();
  if(!s || /^(null|undefined|n\/?a)$/i.test(s)) return '';
  return s;
}
// Phone cleaner: drops placeholder numbers like (000) 000-0000 (no real digits).
function cleanPhone(v){
  const s = cleanField(v);
  if(!s) return '';
  if(!/[1-9]/.test(s.replace(/\D/g,''))) return '';
  return s;
}
// Placeholder due dates (year 2040, 2099, 2106, 9999, and the like) are not real
// deadlines. Real construction bids close within months, so any due date more
// than five years out is a placeholder. A horizon test, not an enumerated set,
// so no new placeholder year can leak through as a live countdown.
const SENTINEL_HORIZON_MS = 5 * 365.25 * 86400000; // ~5 years
function isSentinelDate(d){
  if(!(d instanceof Date) || isNaN(d)) return false;
  return (d.getTime() - Date.now()) > SENTINEL_HORIZON_MS;
}
// A placeholder date is not by itself evidence of a standing list. The City puts
// one on two different things, and only the selection method tells them apart:
//
//   Request for Qualifications / a Pre-Qualified List method: an application
//   window the agency really does hold open indefinitely. Standing.
//
//   Competitive Sealed Bids and every other one-time method: a single bid that
//   closed on a real date the notice never recorded. The far-future date is a
//   data-entry artifact, not an invitation.
//
// Reading the date alone put a Competitive Sealed Bid posted in 2016 on the list
// as an always-open opportunity. So the method is the discriminator, and the
// date only decides whether a deadline is quotable.
const PQL_METHOD = /request for qualifications|pre-?qualified list/i;
function isStandingList(method, due){
  return isSentinelDate(due) && PQL_METHOD.test(method || '');
}
// A one-time bid carrying a placeholder date has no usable deadline. Recent ones
// may still be live and are shown with the deadline called missing rather than
// invented. Past a year no construction bid is still open, so those are dropped:
// the page promises notices whose due date hasn't passed, and a bid with no real
// due date at all cannot meet that promise.
const STALE_NOTICE_MS = 365 * 86400000;
function isDeadNotice(posted, standing, due){
  if(standing || !isSentinelDate(due)) return false;
  if(!(posted instanceof Date) || isNaN(posted)) return false;
  return (Date.now() - posted.getTime()) > STALE_NOTICE_MS;
}

// Work-type lexicon and classifier, reused verbatim from the Awarded page so a
// contractor can scan open solicitations by trade. Applied to the title text.
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

// Borough derivation, reused from the Awarded page: scan title + description text.
const BORO_PATTERNS = [
  ['Manhattan', /\bmanhattan\b|\bnew york county\b/i],
  ['Brooklyn',  /\bbrooklyn\b|\bkings county\b|\bbklyn\b/i],
  ['Queens',    /\bqueens\b/i],
  ['Bronx',     /\bbronx\b/i],
  ['Staten Island', /\bstaten island\b|\brichmond county\b/i]
];
function deriveBorough(title, desc){
  const text = ((title||'') + ' ' + (desc||'')).toLowerCase();
  const hits = BORO_PATTERNS.filter(([,re]) => re.test(text)).map(([name]) => name);
  if(hits.length === 1) return hits[0];
  if(hits.length > 1) return 'Multi-borough';
  return 'Citywide / Unspecified';
}

async function fetchSolicitations(){
  // Already UTC-anchored, and deliberately so: this formats the current INSTANT,
  // not a constructed local midnight, so every reader loading the page at the
  // same moment sends the same lower bound and gets the same list back. Do not
  // rewrite it against local date fields.
  const today = new Date().toISOString().slice(0,10);
  const params = new URLSearchParams({
    '$select':'request_id,start_date,agency_name,category_description,selection_method_description,short_title,pin,due_date,contact_name,contact_phone,email,additional_description_1',
    '$where':`starts_with(category_description,'Construction') AND due_date>='${today}'`,
    '$order':'due_date',
    '$limit':'2000'
  });
  const res = await fetch(`${API}?${params}`, { headers: { 'X-App-Token': '3TAzQQPiSG2T4WGWfYYUxxqfJ' } });
  if(!res.ok) throw new Error('API '+res.status);
  const raw = await res.json();
  const seen = new Set();
  const mapped = raw.filter(r => {
    const k = r.pin || r.request_id;
    if(seen.has(k)) return false;
    seen.add(k); return true;
  }).map(r => {
    const title = r.short_title || '(untitled)';
    const fullDesc = stripHtml(r.additional_description_1);
    const due = new Date(r.due_date);
    const method = r.selection_method_description || '';
    const posted = new Date(r.start_date);
    const standing = isStandingList(method, due);
    return {
      title: title,
      agency: r.agency_name || '–',
      cat: r.category_description === HARD ? 'hard' : 'rel',
      method: method,
      pin: cleanField(r.pin),
      // due/posted are Dates, used for the countdown and for display. dueDay and
      // postedDay are the raw published prefixes and are what the CSV exports, so
      // an exported date never depends on how the browser parsed the timestamp
      // or on which side of UTC the reader is sitting.
      due: due,
      dueDay: (r.due_date || '').slice(0,10),
      postedDay: (r.start_date || '').slice(0,10),
      standing: standing,
      // a one-time bid whose only deadline is a placeholder: no date to quote
      noDeadline: !standing && isSentinelDate(due),
      dead: isDeadNotice(posted, standing, due),
      posted: posted,
      contact: cleanField(r.contact_name),
      phone: cleanPhone(r.contact_phone),
      email: cleanField(r.email),
      tags: wtClassify(title),
      borough: deriveBorough(title, fullDesc),
      desc: fullDesc.slice(0, 280)
    };
  });
  // Dropped, not hidden: the count is reported under the list so the total
  // reconciles against the raw dataset.
  state.dropped = mapped.filter(r => r.dead).length;
  return mapped.filter(r => !r.dead);
}

// Countdown in CALENDAR days, not elapsed hours. Due timestamps carry a clock
// time (11:00, 14:00, or midnight), so diffing them against the current instant
// made two notices closing on the same date read as different counts, and
// rounded a two-day gap up to three. Floor both sides to local midnight first,
// so the answer depends only on the date. Round, not floor, so a DST-shortened
// or lengthened day (23h or 25h) cannot slip the count by one.
function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function daysUntil(d){ return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000); }
// The API filter keeps only notices whose due date is today or later, but a
// notice can pass that filter and still have closed earlier today, and the list
// stays open in a tab past midnight. So the negative case is spelled out rather
// than folded into "due today".
function countdown(days){
  if(days < 0) return 'closed';
  if(days === 0) return 'due today';
  return days + ' day' + (days === 1 ? '' : 's') + ' left';
}
function fmtDate(d){ return ci.fmt(d, 'date'); }

// CSV export of the currently shown open-solicitations list. Client-side Blob
// only, no library, no network. Cells are quote-wrapped and quote-doubled.
function csvCell(v){ const s=(v==null?'':String(v)); return '"'+s.replace(/"/g,'""')+'"'; }
function exportCSV(){
  const rows = filtered();
  const lines = [['Due date','Posted','Agency','Title','Borough','Work types','Category','Selection method','PIN','Contact','Phone','Email'].map(csvCell).join(',')];
  rows.forEach(r => {
    lines.push([
      r.standing ? 'Standing pre-qualified list' : r.noDeadline ? 'No closing date published' : r.dueDay,
      r.postedDay, r.agency, r.title, r.borough,
      r.tags.map(t=>WT_LEXICON[t].label).join('; '),
      r.cat==='hard'?'Construction':'Related services',
      r.method, r.pin, r.contact, r.phone, r.email
    ].map(csvCell).join(','));
  });
  const blob = new Blob([lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'concrete-index-open-solicitations.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 0);
}

function wtLabel(r){ return r.tags.length ? WT_LEXICON[r.tags[0]].label : ''; }
function filtered(){
  const q = state.q.toLowerCase();
  const rows = state.rows.filter(r =>
    (state.scope==='all' || r.cat===state.scope) &&
    (!q || (r.title+' '+r.agency+' '+r.desc+' '+r.method).toLowerCase().includes(q))
  );
  // Sort by due date (rows already arrive due-ordered), agency, or first work-type
  // label; ties and untagged rows fall back to due date so ordering stays stable.
  // Any row without a quotable deadline, whether a standing list or a bid whose
  // date is a placeholder, sinks to the bottom so it never poses as the next real
  // deadline. Both carry sentinel dates, so this cannot be left to the date sort:
  // it would rank a placeholder 2106 date as the furthest-off real deadline.
  const undated = r => (r.standing || r.noDeadline) ? 1 : 0;
  const byStanding = (a,b)=> undated(a) - undated(b);
  const byDue = (a,b)=> byStanding(a,b) || (a.due - b.due);
  if(state.sort==='agency'){
    rows.sort((a,b)=> byStanding(a,b) || a.agency.localeCompare(b.agency) || (a.due - b.due));
  } else if(state.sort==='worktype'){
    rows.sort((a,b)=>{
      const s = byStanding(a,b); if(s) return s;
      const la=wtLabel(a), lb=wtLabel(b);
      if(la && !lb) return -1;
      if(!la && lb) return 1;
      return la.localeCompare(lb) || (a.due - b.due);
    });
  } else {
    rows.sort(byDue);
  }
  return rows;
}

const SORT_CAP = { due:'SORTED BY DUE DATE', agency:'SORTED BY AGENCY', worktype:'SORTED BY WORK TYPE' };
function render(){
  const rows = filtered();
  const cap = document.getElementById('sort-cap');
  if(cap) cap.textContent = SORT_CAP[state.sort] || SORT_CAP.due;
  const el = document.getElementById('list');
  if(!rows.length){ el.innerHTML = '<div class="empty">No open solicitations match.</div>'; return; }
  el.innerHTML = rows.map(r => {
    const days = daysUntil(r.due);
    const wtPills = r.tags.map(t=>`<span class="pill wt">${esc(WT_LEXICON[t].label)}</span>`).join('');
    const boroPill = r.borough==='Citywide / Unspecified'
      ? '' : `<span class="pill boro">${esc(r.borough)}</span>`;
    const tagRow = (wtPills || boroPill) ? `<div class="s-tags">${boroPill}${wtPills}</div>` : '';
    const pinTxt = r.pin ? esc(r.pin) : DASH;
    const contactTxt = r.contact ? esc(r.contact) : DASH;
    const sideHtml = r.standing
      ? `<div class="due ok txt">Standing pre-qualified list</div>
        <div class="due-sub">open year-round · posted ${fmtDate(r.posted)}</div>`
      : r.noDeadline
      ? `<div class="due none txt">No closing date published</div>
        <div class="due-sub">posted ${fmtDate(r.posted)}</div>`
      : `<div class="due ${days<=7?'soon':'ok'}">Due ${fmtDate(r.due)}</div>
        <div class="due-sub">${countdown(days)} · posted ${fmtDate(r.posted)}</div>`;
    return `<div class="sol">
      <div class="s-main">
        <div class="s-title">${esc(r.title)}</div>
        <div class="s-meta">${esc(r.agency)} · ${esc(r.method)} · PIN ${pinTxt} · <span class="pill ${r.cat}">${r.cat==='hard'?'Construction':'Related services'}</span></div>
        ${tagRow}
        ${r.desc ? `<div class="s-desc">${esc(r.desc)}${r.desc.length>=280?'…':''}</div>` : ''}
        <div class="contact">${contactTxt}${r.phone?' · '+esc(r.phone):''}${r.email?' · <a href="mailto:'+esc(r.email)+'">'+esc(r.email)+'</a>':''}</div>
      </div>
      <div class="s-side">
        ${sideHtml}
      </div>
    </div>`;
  }).join('');
}

function wireSeg(id, attr, initial, onChange){
  const btns = [...document.getElementById(id).querySelectorAll('button')];
  function set(val){ btns.forEach(b=>b.classList.toggle('on', b.dataset[attr]===String(val))); onChange(val); }
  btns.forEach(b=>b.addEventListener('click',()=>set(b.dataset[attr])));
  set(initial);
}

(async function init(){
  try{ state.rows = await fetchSolicitations(); }
  catch(e){
    document.getElementById('loader').style.display='none';
    document.getElementById('error').style.display='block';
    return;
  }
  document.getElementById('asof').innerHTML =
    `<strong>${state.rows.length}</strong> open construction solicitations · sorted by due date`;
  document.getElementById('series-asof').textContent = state.rows.length + ' NOTICES';
  if(state.dropped){
    const n = state.dropped;
    document.getElementById('dropped-note').textContent =
      ` ${n} one-time ${n===1?'bid':'bids'} carrying a placeholder due date and posted over a year ago ${n===1?'is':'are'} excluded; see the note on placeholder due dates above.`;
  }
  document.getElementById('loader').style.display='none';
  document.getElementById('app').style.display='block';
  let ready=false;
  wireSeg('seg-scope','s','all', v=>{ state.scope=v; if(ready) render(); });
  wireSeg('seg-sort','o','due', v=>{ state.sort=v; if(ready) render(); });
  document.getElementById('q').addEventListener('input', e=>{ state.q=e.target.value; render(); });
  document.getElementById('csv-link').addEventListener('click', e=>{ e.preventDefault(); exportCSV(); });
  ready=true;
  render();
})();
