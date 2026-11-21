/* home: the landing page (PRD Section 7).
 *
 * The served HTML is complete without JavaScript (tools/render-flow.mjs stamps
 * the index, the money-flow figure, the tape, and the source dates). This
 * module refreshes those values from the same nightly files, draws the flow's
 * particles, and fills the figures that are read live:
 *
 *   hero index           precomputed.json index_level              (unchanged path)
 *   index vs a year ago  precomputed.json index_year_ago_level/month and
 *   and vs prior month   index_prior_level/month (tools/build-index-points.js: the
 *                        Analysis series from lib/award-core.js, Analysis's yoy
 *                        rule); computeLive() only when those fields are absent
 *   Spent TTM, coverage  data/plan-history.json, last three spend entries (the Funnel
 *                        rule); shown only when the file is present, fresh, and
 *                        agrees with precomputed.json; otherwise an en dash and a
 *                        pointer to Funnel. Home never repeats Funnel's five
 *                        capital-plan snapshot pulls.
 *   open solicitations   precomputed.json glimpse.open_solicitations (unchanged path)
 *   flow lanes           data/flow.json, else precomputed + checkbook-vendors (flow-data.js);
 *                        Awarded refreshed live as before (awardedCompleteMonths)
 *   section 02           Briefing's own award computation (fetchAwardsData, copied),
 *                        open pipeline from precomputed, coverage as above
 *
 * Motion is gated: nothing below runs a tween, a counter, a reveal, or a frame
 * loop under prefers-reduced-motion: reduce.
 */
(function () {
  'use strict';
  var ci = window.ci, fmt = ci.fmt;
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var REDUCED = mq.matches;
  var root = document.documentElement;
  if (!REDUCED) root.classList.add('ci-motion');

  function $(id) { return document.getElementById(id); }
  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function setFigure(el, text, value, asof) {
    if (!el) return;
    setText(el, text);
    if (text && text !== '–') el.removeAttribute('aria-label'); else el.setAttribute('aria-label', 'no data');
    if (value != null) el.setAttribute('data-value', String(value)); else el.removeAttribute('data-value');
    if (asof) el.setAttribute('data-asof', asof);
  }
  function getSame(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }

  /* ================= reveals (cairn pacing, native) =================
     Items below the fold start lowered and transparent and rise once, 400ms,
     60ms apart, at most four per group. Anything already on screen when this
     runs is left alone, so above-the-fold content never waits on a reveal. */
  function reveals() {
    if (REDUCED || !('IntersectionObserver' in window)) return;
    var items = [].slice.call(document.querySelectorAll('[data-reveal]'));
    var vh = window.innerHeight;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        e.target.classList.add('is-in');
      });
    }, { threshold: 0.15 });
    var groups = new Map();
    items.forEach(function (el) {
      if (el.getBoundingClientRect().top < vh) return;
      var g = el.parentElement, k = groups.get(g) || 0;
      groups.set(g, k + 1);
      el.style.setProperty('--rv-delay', Math.min(k, 3) * 60 + 'ms');
      el.classList.add('is-pre');
      io.observe(el);
    });
  }

  /* ================= sticky steps =================
     At 1024px and up, with motion allowed, the four stage drawings sit in one
     sticky frame and the active step crossfades in (240ms). The step changes
     on IntersectionObserver only: no scroll listeners, no scrubbing. Otherwise
     each step keeps its own drawing, stacked. */
  function steps() {
    var frame = document.querySelector('.steps__frame'), list = document.querySelector('.steps__list');
    if (!frame || !list || REDUCED || !('IntersectionObserver' in window)) return;
    var items = [].slice.call(list.querySelectorAll('.step'));
    items.forEach(function (s, i) {
      var art = s.querySelector('.step__art svg');
      if (!art) return;
      var c = art.cloneNode(true);
      c.classList.add('steps__art');
      if (i === 0) c.classList.add('is-on');
      frame.appendChild(c);
    });
    root.classList.add('steps-sticky');
    function set(i) {
      items.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
      [].forEach.call(frame.children, function (c, k) { c.classList.toggle('is-on', k === i); });
    }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) set(items.indexOf(e.target)); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    items.forEach(function (s) { io.observe(s); });
    list.addEventListener('focusin', function (e) { var s = e.target.closest('.step'); if (s) set(items.indexOf(s)); });
  }

  /* ================= counter (toile, corrected) =================
     Ticks once, 800ms, from the prior published month's value to the current
     one, only when the nightly file carries that prior value
     (index_prior_level and index_prior_month); otherwise it does not animate.
     The moving digits are an aria-hidden clone; the real value is in the DOM
     from first render. */
  function counter(el, from, to) {
    if (REDUCED || from == null || !isFinite(from) || !el) return;
    var clone = document.createElement('span');
    clone.className = 'lp-num__tick';
    clone.setAttribute('aria-hidden', 'true');
    el.classList.add('is-ticking');
    el.appendChild(clone);
    var t0 = 0, D = 800;
    var ease = function (k) { return 1 - Math.pow(1 - k, 3); };
    function step(t) {
      if (!t0) t0 = t;
      var k = Math.min((t - t0) / D, 1);
      clone.textContent = fmt(from + (to - from) * ease(k), 'index');
      if (k < 1) requestAnimationFrame(step);
      else { clone.remove(); el.classList.remove('is-ticking'); }
    }
    requestAnimationFrame(step);
  }

  /* ================= live reads (copied from the owning pages) ================= */

  /* First day of the month n complete months back. isoBoundary(0) is the first
     of the current, incomplete month, so [isoBoundary(12), isoBoundary(0)) is
     twelve fully-elapsed months. Same helper the funnel, Briefing, Analysis, and
     Contractors pages use.

     Anchored in UTC end to end. A local midnight formatted through toISOString
     reads back a day early for anyone east of UTC, which moved the whole window
     and made the headline figure depend on where the reader was sitting.
     Date.UTC in, toISOString out, so every reader gets one window. */
  function isoBoundary(n){
    var now=new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-n, 1))
      .toISOString().slice(0,10);
  }

  /* Gross awarded value over the canonical trailing twelve months: every
     construction award notice, renewals and $500M+ megaprojects included,
     deduped to one record per pin at its maximum amount (the same procurement is
     published as several notices, so a raw sum overstates). Twelve months is a
     few hundred rows, so this is a single small request. */
  function awardedCompleteMonths(){
    var API='https://data.cityofnewyork.us/resource/qyyg-4tf5.json', TOKEN='3TAzQQPiSG2T4WGWfYYUxxqfJ', PAGE=50000;
    var lo=isoBoundary(12), hi=isoBoundary(0);
    var where="starts_with(category_description,'Construction') AND contract_amount>0"
      + " AND start_date>='"+lo+"' AND start_date<'"+hi+"'";
    var byPin=new Map(), off=0;
    function page(){
      var u=API+'?'+new URLSearchParams({'$select':'pin,contract_amount','$where':where,'$order':'pin','$limit':String(PAGE),'$offset':String(off)});
      return fetch(u,{headers:{'X-App-Token':TOKEN}}).then(function(r){ if(!r.ok) throw new Error('api'); return r.json(); }).then(function(b){
        for(var i=0;i<b.length;i++){
          var amt=parseFloat(b[i].contract_amount);
          if(!(amt>0)) continue;
          var pin=b[i].pin||('_np_'+off+'_'+i);   // unpinned notices stand alone
          var prev=byPin.get(pin);
          if(prev==null||amt>prev) byPin.set(pin,amt);
        }
        if(b.length>=PAGE && off<400000){ off+=PAGE; return page(); }
      });
    }
    return page().then(function(){
      var total=0;
      byPin.forEach(function(amt){ total+=amt; });
      if(!(total>0)) throw new Error('empty award window');
      return { total: total, lo: lo, hi: hi };
    });
  }

  /* The index computed live from the City Record, identical to the Analysis
     page (buildIndex). value and month are computed exactly as before; the
     series is returned as well so the year-ago change can be read off it with
     the Analysis rule. */
  function computeLive(){
    var API='https://data.cityofnewyork.us/resource/qyyg-4tf5.json', TOKEN='3TAzQQPiSG2T4WGWfYYUxxqfJ', MEGA=500e6;
    var isCont=function(m){ return /renewal|extension/i.test(m||''); };
    var byPin=new Map(), off=0, PAGE=50000;
    var where="starts_with(category_description,'Construction') AND contract_amount>0 AND contract_amount<"+MEGA;
    function page(){
      var u=API+'?'+new URLSearchParams({'$select':'pin,contract_amount,start_date,selection_method_description','$where':where,'$order':'pin','$limit':String(PAGE),'$offset':String(off)});
      return fetch(u,{headers:{'X-App-Token':TOKEN}}).then(function(r){ if(!r.ok) throw new Error('api'); return r.json(); }).then(function(b){
        for(var i=0;i<b.length;i++){ var r=b[i]; var amt=parseFloat(r.contract_amount); if(!(amt>0)||amt>=MEGA) continue; var pin=r.pin||('_np_'+off+'_'+i); var rec={amt:amt,m:r.start_date?r.start_date.slice(0,7):null,cont:isCont(r.selection_method_description)}; var p=byPin.get(pin); if(!p||rec.amt>p.amt) byPin.set(pin,rec); }
        if(b.length>=PAGE && off<400000){ off+=PAGE; return page(); }
      });
    }
    return page().then(function(){
      var byMonth=new Map();
      byPin.forEach(function(rec){ if(rec.cont||!rec.m) return; var c=byMonth.get(rec.m)||{v:0,c:0}; c.v+=rec.amt; c.c+=1; byMonth.set(rec.m,c); });
      /* The month keys have to match the raw start_date prefixes the rows are
         bucketed under, so they are built in UTC. A local first-of-month put
         through toISOString names the PREVIOUS month for any reader east of UTC,
         which slid the whole series one month off its own data and produced a
         different index value abroad than at home. */
      var now=new Date(), lastC=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1), months=[], mi=0;
      for(var t=Date.UTC(2003,0,1); t<lastC; t=Date.UTC(2003,++mi,1)){ months.push(new Date(t).toISOString().slice(0,7)); }
      var v=months.map(function(m){return (byMonth.get(m)||{v:0}).v;}), c=months.map(function(m){return (byMonth.get(m)||{c:0}).c;});
      var tM=[],tV=[],tC=[],sv=0,sc=0;
      for(var i=0;i<months.length;i++){ sv+=v[i]; sc+=c[i]; if(i>=12){sv-=v[i-12];sc-=c[i-12];} if(i>=11){tM.push(months[i]);tV.push(sv);tC.push(sc);} }
      var bi=tM.map(function(m,i){return m.indexOf('2019')===0?i:-1;}).filter(function(i){return i>=0;});
      var mean=function(a){return a.reduce(function(x,y){return x+y;},0)/a.length;};
      var baseV=bi.length?mean(bi.map(function(i){return tV[i];})):tV[0], baseC=bi.length?mean(bi.map(function(i){return tC[i];})):tC[0];
      var last=tM.length-1;
      var values=tM.map(function(m,i){ return 100*Math.sqrt((tV[i]/baseV)*(tC[i]/baseC)); });
      return { value:100*Math.sqrt((tV[last]/baseV)*(tC[last]/baseC)), month:tM[last], months:tM, values:values };
    });
  }

  /* ---- Briefing: fetchAwardsData, copied from /assets/pages/briefing.js ---- */
  var AWARD_API = 'https://data.cityofnewyork.us/resource/qyyg-4tf5.json';
  var MEGA = 500e6;
  function bGetJSON(api, params){
    return fetch(api + '?' + new URLSearchParams(params), { headers: { 'X-App-Token': '3TAzQQPiSG2T4WGWfYYUxxqfJ' } }).then(function (res) {
      if(!res.ok) throw new Error('API ' + res.status);
      return res.json();
    });
  }
  function isoMonthsAgo(n){
    var now = new Date();
    var y = now.getUTCFullYear(), m = now.getUTCMonth();
    var lastDay = new Date(Date.UTC(y, m - n + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - n, Math.min(now.getUTCDate(), lastDay)))
      .toISOString().slice(0,10);
  }
  function isoCompleteMonthBoundary(n){
    var now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1))
      .toISOString().slice(0,10);
  }
  function isContinuation(m){ return /renewal|extension/i.test(m||''); }
  function fetchAwardRows(since){
    var PAGE = 50000, offset = 0, out = [];
    function next(){
      return bGetJSON(AWARD_API, {
        '$select':'pin,contract_amount,start_date,agency_name,category_description,selection_method_description',
        '$where':"starts_with(category_description,'Construction') AND start_date>='" + since + "' AND contract_amount>0",
        '$order':'pin','$limit':String(PAGE),'$offset':String(offset)
      }).then(function (batch) {
        out.push.apply(out, batch);
        if(batch.length < PAGE) return out;
        offset += PAGE;
        if(offset > 400000) return out; // safety stop
        return next();
      });
    }
    return next();
  }
  function dedupeAwardsByPin(rows){
    var byPin = new Map();
    for(var i=0; i<rows.length; i++){
      var r = rows[i];
      var amt = parseFloat(r.contract_amount);
      if(!(amt > 0)) continue;
      var pin = r.pin || ('_np_' + i);
      var rec = { amt: amt, agency: r.agency_name || null,
        cat: r.category_description || '',
        method: r.selection_method_description || '',
        day: r.start_date ? r.start_date.slice(0,10) : null };
      var prev = byPin.get(pin);
      if(!prev || rec.amt > prev.amt) byPin.set(pin, rec);
    }
    return Array.from(byPin.values());
  }
  /* Trailing 12 = [c12, c0); prior 12 = [c24, c12); $500M+ and renewals out. */
  function briefingAwards(){
    var c0 = isoCompleteMonthBoundary(0), c12 = isoCompleteMonthBoundary(12), c24 = isoCompleteMonthBoundary(24);
    return fetchAwardRows(isoMonthsAgo(27)).then(function (awardRows) {
      var deduped = dedupeAwardsByPin(awardRows);
      var ttmS=0, ttmN=0, priorS=0;
      for(var i=0;i<deduped.length;i++){
        var r = deduped[i];
        if(!r.day) continue;
        if(r.amt >= MEGA || isContinuation(r.method)) continue;
        var inTTM = r.day >= c12 && r.day < c0;
        var inPrior = r.day >= c24 && r.day < c12;
        if(inTTM){ ttmS += r.amt; ttmN += 1; }
        else if(inPrior){ priorS += r.amt; }
      }
      return { ttm: ttmS, count: ttmN, prior: priorS, delta: priorS>0 ? (ttmS-priorS)/priorS*100 : null, lo: c12, hi: c0 };
    });
  }

  /* ---- Funnel's Spent TTM and backlog coverage, from plan-history.json ----
     The file is lib/plan-core.js run nightly over every plan period (Funnel's
     own rules); spend[] holds each period's matched-panel growth and
     meta.rules.ttm_spend says the trailing year is the sum of the last three,
     which is Funnel's ttmSpend(). Used only when it is fresh and its latest
     Committed equals precomputed.json to the dollar on the same period. */
  function planHistory(pc){
    return getSame('/data/plan-history.json').then(function (h) {
      var age = (Date.now() - Date.parse(h.meta && h.meta.generated_at)) / 36e5;
      if (!(age <= ((h.meta && +h.meta.stale_after_hours) || 48))) throw new Error('plan-history stale');
      var latest = h.periods[h.periods.length - 1];
      var per = pc && pc.meta && pc.meta.committed_period;
      if (!pc || !pc.glimpse || Math.round(latest.committed.total) !== pc.glimpse.committed || (per && latest.period !== per)) throw new Error('plan-history disagrees');
      if (!h.spend || h.spend.length < 3) throw new Error('fewer than three spend periods');
      var spent = h.spend.slice(-3).reduce(function (a, p) { return a + p.total; }, 0);
      return { spent: spent, committed: latest.committed.total, period: latest.period };
    });
  }

  /* ================= wiring ================= */

  /* The index comparisons as one shape, whichever source supplied them:
     { month, value, prior: {level, month}, yearAgo: {level, month} | null }. */
  function pointsFromNightly(pc) {
    if (!pc || pc.index_level == null || !pc.index_month) return null;
    if (pc.index_prior_level == null || !pc.index_prior_month || pc.index_year_ago_level == null || !pc.index_year_ago_month) return null;
    return { month: pc.index_month, value: +pc.index_level,
      prior: { level: +pc.index_prior_level, month: pc.index_prior_month },
      yearAgo: { level: +pc.index_year_ago_level, month: pc.index_year_ago_month } };
  }
  function pointsFromLive(pc, live) {
    var n = live && live.values ? live.values.length : 0;
    if (n < 2) return null;
    var p = { month: live.month, value: live.value,
      prior: { level: live.values[n - 2], month: live.months[n - 2] },
      yearAgo: n > 12 ? { level: live.values[n - 13], month: live.months[n - 13] } : null };   // analysis.js renderKpis
    // The hero chip sits beside the nightly figure, so it needs the same series:
    // the live last month and value must match the nightly file.
    p.heroOk = !!pc && live.month === pc.index_month && Math.abs(live.value - pc.index_level) < 0.005;
    return p;
  }

  function showHeroDelta(p) {
    var el = $('lp-index-delta');
    if (!el || !p || !p.prior) return;
    var d = p.value - p.prior.level;
    var sign = d > 0 ? '+' : d < 0 ? '−' : '';
    el.className = 'lp-index__delta ci-delta ' + (d >= 0 ? 'ci-delta--pos' : 'ci-delta--neg');
    el.setAttribute('data-figure', 'home.hero.index.mom');
    el.setAttribute('data-value', String(d));
    setText(el, sign + fmt(Math.abs(d), 'index') + ' vs ' + fmt(p.prior.month, 'ym-short'));
  }

  function fillYoy(p) {
    var el = $('kpi-yoy');
    if (!el || !p || !p.yearAgo || !(p.yearAgo.level > 0)) return;
    var yoy = (p.value / p.yearAgo.level - 1) * 100;
    el.className = 'ci-tile__value ' + (yoy >= 0 ? 'is-up' : 'is-down');
    setFigure(el, fmt(yoy, 'pct-signed'), yoy, p.month);
    setText($('kpi-yoy-cap'), 'Concrete Index, ' + fmt(p.month, 'ym-short') + ' against twelve months earlier · Analysis');
  }

  function fillPlan(ph) {
    var cov = ph.spent > 0 ? ph.committed / ph.spent : null;
    setFigure($('kpi-spent'), fmt(ph.spent, 'money'), ph.spent, ph.period);
    setFigure($('kpi-coverage'), cov != null ? fmt(cov, 'index') + ' yrs' : '–', cov, ph.period);
    setFigure($('mo-cover'), cov != null ? fmt(cov, 'index') + ' yrs' : '–', cov, ph.period);
  }
  function planUnavailable() {
    setText($('kpi-spent-cap'), 'Capital-plan outlays between plan snapshots, trailing year; not the same ledger as Paid. Read it on Funnel.');
    setText($('kpi-coverage-cap'), "Market-level: City open pipeline over trailing spend. Not any firm's backlog. Read it on Funnel.");
    setText($('mo-cover-cap'), 'Read it in the Briefing');
  }

  function fillMonth(b) {
    setFigure($('mo-new'), fmt(b.ttm, 'money'), b.ttm, b.lo + '/' + b.hi);
    if (b.delta !== null) setFigure($('mo-delta'), fmt(b.delta, 'pct-signed'), b.delta, b.lo + '/' + b.hi);
  }

  function stampText(pc, cbMeta, model) {
    var vals = window.CIFlowStamp.values(pc, cbMeta, model, fmt);
    document.querySelectorAll('[data-home]').forEach(function (el) {
      var k = el.getAttribute('data-home');
      if (k in vals) {
        setText(el, vals[k]);
        if (vals[k] && vals[k] !== '–' && el.getAttribute('aria-label') === 'no data') el.removeAttribute('aria-label');
      }
    });
  }

  function onVisible(el, fn) {
    if (!el) return;
    if (!('IntersectionObserver' in window)) { fn(); return; }
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fn(); }
    }, { rootMargin: '300px 0px' });
    io.observe(el);
  }

  function init() {
    reveals();
    steps();
    var fig = $('flow');
    var flow = fig && window.CIFlow ? window.CIFlow.mount(fig, { fmt: fmt, reduced: REDUCED }) : null;
    var pcP = getSame('/data/precomputed.json');
    var state = { pc: null, doc: null, model: null, cbMeta: null };

    function draw() {
      state.model = window.CIFlowData.model(state.doc, fmt);
      if (flow) flow.render(state.model);
      stampText(state.pc, state.cbMeta, state.model);
    }

    var flowP = window.CIFlowData ? window.CIFlowData.load(null, pcP) : Promise.reject(new Error('no flow modules'));
    Promise.all([pcP.catch(function () { return null; }), flowP]).then(function (r) {
      var pc = r[0], got = r[1];
      state.pc = pc; state.doc = got.doc;
      state.cbMeta = got.doc.meta && got.doc.meta.checkbook;
      // Keep the split stamped into the page when this lane's total is the same.
      var stamped = {};
      try { stamped = JSON.parse(fig.getAttribute('data-stamp-split') || '{}'); } catch (e) { stamped = {}; }
      got.doc.lanes.forEach(function (l) {
        var s = stamped[l.id];
        if (!(l.split_agency && l.split_agency.length) && s && s.value === l.value) l.split_agency = s.split;
      });
      draw();
      if (flow && !REDUCED) flow.start();
      if (pc && pc.index_prior_level != null && pc.index_level != null) counter($('lp-index'), +pc.index_prior_level, +pc.index_level);
      return pc;
    }).catch(function (e) {
      console.error('home flow', e && e.stack);
      if (flow) { fig.querySelectorAll('.flow__pause').forEach(function (b) { b.hidden = false; }); }
      return null;
    }).then(function (pc) {
      // The nightly file carries the canonical window; the live pull replaces
      // the Awarded lane only together with its own window and date.
      awardedCompleteMonths().then(function (a) {
        if (!state.doc) return;
        var lane = state.doc.lanes[1];
        if (Math.round(lane.value) === Math.round(a.total)) return;   // same figure: keep the nightly window, date, and split
        lane.value = a.total;
        lane.window_start = a.lo; lane.window_end_exclusive = a.hi;
        lane.as_of = new Date().toISOString().slice(0, 10);
        lane.split_agency = null;
        draw();
      }).catch(function () { /* keep the nightly figure */ });

      // The year-ago tile and the month-on-month chip, from the nightly file.
      // Only when it lacks the comparison points (or did not load) does Home
      // pull the award history and compute the series itself.
      var pts = pointsFromNightly(pc);
      if (pts) { fillYoy(pts); showHeroDelta(pts); }
      else computeLive().then(function (live) {
        var p = pointsFromLive(pc, live);
        fillYoy(p);
        if (p && p.heroOk) showHeroDelta(p);
      }).catch(function () { /* tile keeps its en dash */ });

      planHistory(pc).then(fillPlan).catch(planUnavailable);

      onVisible(document.querySelector('.lp-month'), function () {
        briefingAwards().then(fillMonth).catch(function () { setText($('month-cap'), 'Readings from the Briefing; the award record did not load'); });
      });
    });
  }

  // This module is deferred from <head>; the flow modules are deferred from the
  // end of <body> and run after it, before DOMContentLoaded.
  if (document.readyState === 'complete') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
