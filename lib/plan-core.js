/* lib/plan-core.js
 *
 * The capital-plan (OMB fb86-vt7u) rules of The Concrete Index, extracted from
 * the pages so the nightly builders and the pages run ONE implementation.
 * Every function below is copied from a page's inline script; the source is
 * named on each. The only changes are the 2026-11-20 methodology alignment
 * (D1: 'land purchase' joins EXCLUDED everywhere; D2: spend deltas skip
 * excluded projects everywhere; D3: a missing fms_id falls back to the project
 * name everywhere) and optional arguments that let Node pass what the page
 * read from the DOM or the clock.
 *
 * UMD: require('lib/plan-core.js') in Node; window.CIPlan in a browser.
 * No dependencies, no DOM, no clock.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CIPlan = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- phase normalization (funnel/index.html, identical on all plan pages) ---- */
  const PHASE_MAP = {
    'pending':'Pending','initiation':'Pending','pre-design':'Pre-Design','predesign':'Pre-Design',
    'design':'Design','construction procurement':'Procurement','construction':'Construction',
    'design build':'Construction','design built':'Construction','close-out':'Close-out','closeout':'Close-out'
  };
  /* Canonical exclusion set (aligned 2026-11-20). This is the Pipeline page's
     and the nightly archive's set: the Funnel/Agency/Analysis/Briefing set plus
     'land purchase', which belongs to the "not construction work" group beside
     'land acquisition' and 'property acquisition'. */
  const EXCLUDED_LIST = [
    // inactive / finished states
    'completed','cancelled','inactive','on-hold','on hold','transferred',
    'withdrawn','terminated','defaulted','capitally ineligible','expense',
    // dead phases: the project is gone, not waiting to be built
    'defunded','funding withdrawn','rescinded','fmsid changed','project renamed','n/a',
    // not construction work: these do not belong in the construction-demand pipeline
    'land acquisition','property acquisition','land purchase','real estate transaction','fundraising',
    'it project','non capital fund','equipment','consultant services'];
  const EXCLUDED = new Set(EXCLUDED_LIST);
  /* The set four pages used before the alignment (no 'land purchase'). Kept
     only so the builders can emit the legacy reading for the parity harness. */
  const EXCLUDED_LEGACY_D1 = new Set(EXCLUDED_LIST.filter(p => p !== 'land purchase'));

  const PHASE_ORDER = ['Pending','Pre-Design','Design','Procurement','Construction','Close-out','Other active'];
  const PRE_CON = new Set(['Pending','Pre-Design','Design','Procurement']);

  function normPhase(raw, excluded){
    const ex = excluded || EXCLUDED;
    const p = (raw||'').replace(/[()]/g,'').trim().toLowerCase();
    if(ex.has(p)) return 'excluded';
    return PHASE_MAP[p] || 'Other active';
  }
  function phaseRank(b){
    const i = PHASE_ORDER.indexOf(b);
    return i === -1 ? -1 : (b === 'Other active' ? -1 : i);
  }

  /* One key per project. D3: a missing fms_id falls back to the project name,
     the rule Funnel, Agency, Analysis and Briefing already used. */
  function projectKey(r){
    return (r.managing_agency||'') + '|' + (r.fms_id||r.fms_project_name||'');
  }

  /* agencies page (assets/pages/agencies.js) collapsePlan (a superset of funnel collapseSnapshot: it
     also carries borough and category). One record per project per snapshot,
     most advanced phase kept; first row seen wins a tie. ALL rows are collapsed,
     including excluded ones, so spend deltas can see a project's prior reading;
     consumers skip 'excluded' themselves. Raw borough/category/name are kept so
     each page's own bucket rule can be applied downstream. */
  function collapseSnapshot(rows, excluded){
    const m = new Map();
    for(const r of rows){
      const key = projectKey(r);
      const bucket = normPhase(r.current_phase, excluded);
      const rec = {
        agency: r.managing_agency || '–',
        spend: Math.max(parseFloat(r.spend_to_date)||0, 0),
        budget: Math.max(parseFloat(r.total_budget)||0, 0),
        boroughRaw: r.borough,
        categoryRaw: r.ten_year_plan_category,
        name: r.fms_project_name || '(unnamed project)',
        bucket
      };
      const prev = m.get(key);
      if(!prev || phaseRank(bucket) > phaseRank(prev.bucket)) m.set(key, rec);
    }
    return m;
  }

  /* ---- borough and category buckets ---- */
  /* pipeline/index.html normBorough: five boroughs, Citywide, Multi-site / Other */
  const BOROS = new Set(['Brooklyn','Queens','Manhattan','Bronx','Staten Island']);
  function normBoroughPipeline(b){
    const v = (b||'').trim();
    if(BOROS.has(v)) return v;
    if(/citywide/i.test(v)) return 'Citywide';
    return v ? 'Multi-site / Other' : 'Citywide';
  }
  /* agencies page (assets/pages/agencies.js) normBorough: five boroughs, everything else one bucket */
  const AGENCY_MULTI = 'Citywide / multi-borough / unspecified';
  function normBoroughAgency(raw){
    const s = (raw||'').trim();
    if(BOROS.has(s)) return s;
    return AGENCY_MULTI;
  }
  /* pipeline/index.html titleCase(r.ten_year_plan_category || 'Uncategorized') */
  function titleCase(s){ return (s||'').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }
  function catPipeline(raw){ return titleCase(raw || 'Uncategorized'); }
  /* agencies page (assets/pages/agencies.js): (r.ten_year_plan_category||'').trim() || 'Uncategorized' */
  function catAgency(raw){ return (raw||'').trim() || 'Uncategorized'; }

  /* pipeline/index.html median (mean of the middle two on an even count) */
  function median(vals){
    if(!vals.length) return 0;
    const v = [...vals].sort((a,b) => a-b);
    const m = Math.floor(v.length/2);
    return v.length % 2 ? v[m] : (v[m-1]+v[m])/2;
  }

  /* Pipeline page inStage(): all = active excluding Close-out; pre; con */
  function inStage(bucket, stage){
    if(bucket === 'excluded') return false;
    if(stage === 'pre') return PRE_CON.has(bucket);
    if(stage === 'con') return bucket === 'Construction';
    return bucket !== 'Close-out';
  }

  /* Committed: unspent budget of active projects, Close-out excluded
     (funnel step 4, agency committedForAgency, briefing, archive glimpse). */
  function committedTotal(map){
    let total = 0, count = 0;
    const byAgency = new Map();
    for(const rec of map.values()){
      if(rec.bucket === 'excluded' || rec.bucket === 'Close-out') continue;
      const unspent = Math.max(rec.budget - rec.spend, 0);
      total += unspent; count++;
      byAgency.set(rec.agency, (byAgency.get(rec.agency)||0) + unspent);
    }
    return { total, count, byAgency };
  }

  /* funnel/index.html step 3: spend between two snapshots on a MATCHED PANEL,
     floored at zero, excluded projects skipped (D2: Agency now does the same).
     opts.skipExcluded=false reproduces the pre-alignment Agency loop. */
  function spendDelta(prev, cur, opts){
    const skipExcluded = !opts || opts.skipExcluded !== false;
    let total = 0, matched = 0, entrants = 0; const byAgency = new Map();
    for(const [key, rec] of cur){
      if(skipExcluded && rec.bucket === 'excluded') continue;
      const was = prev.get(key);
      if(!was){ entrants++; continue; } // new entrant: no prior reading, so no measurable period spend
      matched++;
      const d = Math.max(rec.spend - was.spend, 0);
      total += d;
      byAgency.set(rec.agency, (byAgency.get(rec.agency)||0) + d);
    }
    return { total, byAgency, matched, entrants };
  }

  /* analysis/index.html buildConversion, one transition a -> b */
  const CONV_PHASES = ['Pending','Pre-Design','Design','Procurement'];
  function analysisRank(b){ return ['Pending','Pre-Design','Design','Procurement','Construction','Close-out'].indexOf(b); }
  function conversion(a, b){
    const stats = {};
    for(const ph of CONV_PHASES) stats[ph] = {n:0, adv:0, held:0};
    for(const [key, ra] of a){
      if(!(ra.bucket in stats)) continue;
      const rb = b.get(key);
      if(!rb || rb.bucket==='excluded') continue;
      stats[ra.bucket].n++;
      if(analysisRank(rb.bucket) > analysisRank(ra.bucket)) stats[ra.bucket].adv++;
      else if(rb.bucket === ra.bucket) stats[ra.bucket].held++;
    }
    return stats;
  }

  /* analysis/index.html buildEscalation, earliest a -> latest b.
     Its median is the upper middle element (growths[floor(n/2)]), kept verbatim. */
  function escalation(a, b){
    const growths = [];
    let added = 0;
    for(const [key, ra] of a){
      const rb = b.get(key);
      if(!rb || ra.budget < 1e6 || rb.budget < 1e6) continue;
      growths.push({ key, g: rb.budget/ra.budget - 1 });
      added += rb.budget - ra.budget;
    }
    growths.sort((x,y)=>x.g-y.g);
    const med = growths.length ? growths[Math.floor(growths.length/2)].g : 0;
    const grew = growths.filter(x=>x.g>0.05).length;
    const byAg = new Map();
    for(const x of growths){
      const ag = x.key.split('|')[0];
      (byAg.get(ag) || byAg.set(ag, []).get(ag)).push(x.g);
    }
    const agRows = [...byAg.entries()].filter(([,v])=>v.length>=30)
      .map(([ag,v])=>{ v.sort((x,y)=>x-y); return [ag, v[Math.floor(v.length/2)], v.length]; })
      .sort((x,y)=>y[1]-x[1]).slice(0,8);
    return { n: growths.length, median: med, grewShare: growths.length? grew/growths.length : 0, added, agRows };
  }

  return {
    PHASE_MAP, EXCLUDED, EXCLUDED_LIST, EXCLUDED_LEGACY_D1, PHASE_ORDER, PRE_CON,
    normPhase, phaseRank, projectKey, collapseSnapshot,
    BOROS, normBoroughPipeline, normBoroughAgency, AGENCY_MULTI, titleCase, catPipeline, catAgency,
    median, inStage, committedTotal, spendDelta, conversion, escalation
  };
}));
