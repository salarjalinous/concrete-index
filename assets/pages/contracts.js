'use strict';
/* ================= config ================= */
var LIVE_URL   = '/data/contract-search.json';
var SAMPLE_URL = '/data/contract-search.sample.json';
var ROW_CAP    = 20;             // max rows painted per result set (preview)
var COLOR_A = '#a8462c', COLOR_B = '#243b53', GRID = '#e6ddd5';

/* ================= helpers ================= */
function esc(s){ var d = document.createElement('div'); d.textContent = ((s === null || s === undefined) ? '' : String(s)).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''); return d.innerHTML; }
var EN = '–'; // en dash for empty cells

function fmtMoney(v){
  if(v === null || v === undefined || isNaN(v)) return EN;
  if(v >= 1e9) return '$' + (v/1e9).toFixed(v >= 10e9 ? 1 : 2) + 'B';
  if(v >= 1e6) return '$' + (v/1e6).toFixed(v >= 100e6 ? 0 : 1) + 'M';
  if(v >= 1e3) return '$' + Math.round(v/1e3) + 'K';
  return '$' + Math.round(v);
}
function fmtMoneyFull(v){
  if(v === null || v === undefined || isNaN(v)) return EN;
  return '$' + Math.round(v).toLocaleString('en-US');
}
function fmtInt(v){ return (v === null || v === undefined || isNaN(v)) ? EN : Math.round(v).toLocaleString('en-US'); }
function fmtPct(v){
  if(v === null || v === undefined || isNaN(v)) return EN;
  var p = v * 100;
  return p.toFixed(p >= 10 ? 0 : 1) + '%';
}
function fmtDays(v){ return (v === null || v === undefined || isNaN(v)) ? EN : Math.round(v).toLocaleString('en-US') + ' days'; }
function fmtDate(s){
  if(!s) return EN;
  var d = new Date(s + (s.length === 10 ? 'T00:00:00Z' : ''));
  if(isNaN(d.getTime())) return esc(s);
  var MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return MN[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}
/* "2021-06" -> "Jun '21" for compact chart ticks */
function fmtMonthTick(p){
  if(!p || p.length < 7) return p || '';
  var MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return MN[(+p.slice(5,7)) - 1] + " '" + p.slice(2,4);
}
function median(nums){
  var a = nums.filter(function(n){ return n !== null && n !== undefined && !isNaN(n); }).sort(function(x,y){ return x - y; });
  if(!a.length) return null;
  var m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}
/* current amount with original fallback, used as velocity/percent denominator */
function denom(c){
  var cur = +c.current_amount;
  if(cur > 0) return cur;
  var orig = +c.original_amount;
  return orig > 0 ? orig : 0;
}
function pctClass(v){
  if(v === null || v === undefined || isNaN(v)) return 'lo';
  if(v >= 0.9) return 'hi';
  if(v >= 0.5) return 'mid';
  return 'lo';
}

/* ================= pure data ops (exercised by the test harness) ================= */
/* substring match across the four searchable fields, case-insensitive */
function matchesQuery(c, q){
  if(!q) return true;
  var s = (
    (c.contract_id || '') + ' ' +
    (c.vendor || '') + ' ' +
    (c.agency || '') + ' ' +
    (c.category || '') + ' ' +
    (c.purpose || '') + ' ' +
    (c.pin || '')
  ).toLowerCase();
  return s.indexOf(q.toLowerCase()) !== -1;
}
function filterContracts(contracts, opts){
  var q = (opts.q || '').trim();
  var ag = opts.agency || '';
  var cat = opts.category || '';
  return contracts.filter(function(c){
    if(ag && c.agency !== ag) return false;
    if(cat && c.category !== cat) return false;
    return matchesQuery(c, q);
  });
}
function sortContracts(list, key){
  var arr = list.slice();
  if(key === 'registration_date'){
    arr.sort(function(a,b){ return String(b.registration_date||'').localeCompare(String(a.registration_date||'')); });
  } else if(key === 'first_payment_lag_days'){
    // slow to fast; nulls (no payment yet) sort to the bottom
    arr.sort(function(a,b){
      var av = a.first_payment_lag_days, bv = b.first_payment_lag_days;
      if(av === null || av === undefined) return 1;
      if(bv === null || bv === undefined) return -1;
      return bv - av;
    });
  } else {
    // numeric, high to low (current_amount, pct_paid_to_date)
    arr.sort(function(a,b){ return (+b[key] || 0) - (+a[key] || 0); });
  }
  return arr;
}
function aggregate(contracts){
  var registered = 0, paid = 0, lags = [];
  for(var i=0;i<contracts.length;i++){
    var c = contracts[i];
    registered += denom(c);
    // Paid to date uses the contract-record figure (paid_to_date), available for
    // every contract, so the KPI and the table column agree.
    paid += (+c.paid_to_date || 0);
    if(c.first_payment_lag_days !== null && c.first_payment_lag_days !== undefined) lags.push(+c.first_payment_lag_days);
  }
  return {
    count: contracts.length,
    registered: registered,
    paid: paid,
    medianLag: median(lags),
    // contracts that carry a dated payment stream (swept contracts with checks)
    withDated: contracts.filter(function(c){ return c.payments_swept && (+c.payment_count || 0) > 0; }).length
  };
}
function distinctSorted(contracts, field){
  var set = {};
  for(var i=0;i<contracts.length;i++){ var v = contracts[i][field]; if(v) set[v] = true; }
  return Object.keys(set).sort(function(a,b){ return a.localeCompare(b); });
}

/* ================= state ================= */
var state = { all: [], meta: null, view: [], openId: null, chart: null };

/* ================= rendering ================= */
function setText(id, txt){ var el = document.getElementById(id); if(el) el.textContent = txt; }

function paintKpis(agg){
  setText('kpi-count', fmtInt(agg.count));
  setText('kpi-count-note', fmtInt(agg.withDated) + ' of ' + fmtInt(agg.count) + ' carry a dated spend curve');
  setText('kpi-registered', fmtMoney(agg.registered));
  setText('kpi-paid', fmtMoney(agg.paid));
  var ratio = agg.registered > 0 ? (agg.paid / agg.registered) : null;
  setText('kpi-paid-note', ratio !== null ? (fmtPct(ratio) + ' of registered value') : 'across the indexed set');
  setText('kpi-lag', agg.medianLag === null ? EN : Math.round(agg.medianLag).toLocaleString('en-US'));
}

function rowHtml(c){
  var d = denom(c);
  var pp = c.pct_paid_to_date;
  var pcls = pctClass(pp);
  return '<tr class="crow" data-id="' + esc(c.contract_id) + '" tabindex="0" role="button" aria-expanded="false">' +
    '<td><span class="cid">' + esc(c.contract_id) + '</span><span class="open-cue">open &rarr;</span></td>' +
    '<td><span class="t-title">' + esc(c.vendor || EN) + '</span></td>' +
    '<td>' + esc(c.agency || EN) + '</td>' +
    '<td class="col-cat">' + esc(c.category || EN) + '</td>' +
    '<td class="num">' + (d > 0 ? fmtMoney(d) : '<span class="en">' + EN + '</span>') + '</td>' +
    '<td class="num amt">' + (c.current_amount > 0 ? fmtMoney(+c.current_amount) : '<span class="en">' + EN + '</span>') + '</td>' +
    '<td class="num">' + (c.paid_to_date > 0 ? fmtMoney(+c.paid_to_date) : '<span class="en">' + EN + '</span>') + '</td>' +
    '<td class="num"><span class="pill ' + pcls + '">' + fmtPct(pp) + '</span></td>' +
  '</tr>';
}

function detailHtml(c){
  var d = denom(c);
  var hasCurve = Array.isArray(c.monthly_cumulative) && c.monthly_cumulative.length > 0;
  var velRows =
    '<dt>First-payment lag</dt><dd' + (c.first_payment_lag_days === null ? ' class="en"' : '') + '>' + fmtDays(c.first_payment_lag_days) + '</dd>' +
    '<dt>Days to 50% paid</dt><dd' + (c.days_to_50pct_paid === null ? ' class="en"' : '') + '>' + fmtDays(c.days_to_50pct_paid) + '</dd>' +
    '<dt>Days to 90% paid</dt><dd' + (c.days_to_90pct_paid === null ? ' class="en"' : '') + '>' + fmtDays(c.days_to_90pct_paid) + '</dd>' +
    '<dt>Payments found</dt><dd>' + fmtInt(c.payment_count) + '</dd>';
  var noCurveMsg = c.payments_swept
    ? 'No dated disbursements were found for this contract, so there is no spend curve to draw.'
    : 'Dated timing covers contracts of $500,000 or more registered since 2019 that are open or closed within the past year, with closure judged by the registered end date. This contract is outside that scope or drew no Checkbook disbursement, so its spend curve and payment velocity read as a dash. Its paid-to-date and percent paid above come from the City contract record.';
  var chartBlock = hasCurve
    ? '<div class="detail-chart"><div class="dc-head">Cumulative spend &middot; Checkbook disbursements</div><div class="chart-box"><canvas id="dchart"></canvas></div></div>'
    : '<div class="detail-chart"><div class="dc-head">Cumulative spend</div><div class="detail-none">' + noCurveMsg + '</div></div>';
  return '<tr class="detail"><td colspan="8"><div class="detail-inner">' +
    '<div class="detail-head">' +
      '<div><div class="dh-name">' + esc(c.vendor || EN) + '</div>' +
      '<div class="detail-meta">' + esc(c.agency || EN) + ' &middot; ' + esc(c.category || EN) + ' &middot; awarded by ' + esc(c.award_method || EN) + (c.pin ? ' &middot; PIN ' + esc(c.pin) : '') + '</div>' +
      (c.purpose ? '<div class="detail-purpose"><span class="dp-label">Scope</span>' + esc(c.purpose) + '</div>' : '') +
      '</div>' +
      '<div class="dh-id">' + esc(c.contract_id) + '</div>' +
    '</div>' +
    '<div class="detail-grid">' +
      '<div class="dblock"><div class="db-head">Dates</div><dl class="dl">' +
        '<dt>Bid due</dt><dd' + (!c.bid_due_date ? ' class="en"' : '') + '>' + fmtDate(c.bid_due_date) + '</dd>' +
        '<dt>Registered</dt><dd>' + fmtDate(c.registration_date) + '</dd>' +
        '<dt>Start</dt><dd>' + fmtDate(c.start_date) + '</dd>' +
        '<dt>Scheduled end</dt><dd>' + fmtDate(c.end_date) + '</dd>' +
      '</dl></div>' +
      '<div class="dblock hl"><div class="db-head">Amounts</div><dl class="dl">' +
        '<dt>Original</dt><dd>' + fmtMoneyFull(+c.original_amount) + '</dd>' +
        '<dt>Current</dt><dd>' + fmtMoneyFull(d) + '</dd>' +
        '<dt>Paid to date</dt><dd' + (!(c.paid_to_date > 0) ? ' class="en"' : '') + '>' + fmtMoneyFull(+c.paid_to_date) + '</dd>' +
        '<dt>Percent paid</dt><dd>' + fmtPct(c.pct_paid_to_date) + '</dd>' +
        '<dt>Confirmed dated disbursements</dt><dd' + (!(c.total_paid > 0) ? ' class="en"' : '') + '>' + (c.total_paid > 0 ? fmtMoneyFull(+c.total_paid) : EN) + '</dd>' +
      '</dl></div>' +
      '<div class="dblock"><div class="db-head">Payment velocity</div><dl class="dl">' + velRows + '</dl></div>' +
    '</div>' +
    chartBlock +
    '<div class="detail-foot">Paid to date and percent paid come from the City\'s registered contract record and cover every contract: paid to date is spent-to-date against the contract, and percent paid divides it by the current amount, falling back to original. Confirmed dated disbursements, the spend curve, and payment velocity are drawn from Checkbook NYC checks for every contract of $500,000 or more registered since 2019 that is open or closed within the past year; outside that scope, or where a contract drew none, they read as a dash. Scheduled end is the planned end date as registered, not a record of actual completion.</div>' +
  '</div></td></tr>';
}

function drawDetailChart(c){
  var canvas = document.getElementById('dchart');
  if(!canvas || typeof Chart === 'undefined') return;
  if(state.chart){ state.chart.destroy(); state.chart = null; }
  var labels = c.monthly_cumulative.map(function(p){ return fmtMonthTick(p[0]); });
  var data = c.monthly_cumulative.map(function(p){ return +p[1]; });
  state.chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: labels, datasets: [{
      label: 'Cumulative paid',
      data: data,
      borderColor: COLOR_A,
      backgroundColor: 'rgba(174,78,52,.08)',
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: COLOR_A,
      tension: 0.15,
      fill: true
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#fefbf8', titleColor: '#201611', bodyColor: '#6b5e56',
          borderColor: COLOR_A, borderWidth: 1, padding: 10, displayColors: false,
          titleFont: { family: 'IBM Plex Mono', size: 11 },
          bodyFont: { family: 'IBM Plex Mono', size: 12 },
          callbacks: { label: function(ctx){ return fmtMoneyFull(ctx.parsed.y); } }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'IBM Plex Mono', size: 12 }, color: '#766a60' } },
        y: { grid: { color: GRID }, ticks: { font: { family: 'IBM Plex Mono', size: 12 }, color: '#766a60', callback: function(v){ return fmtMoney(v); } } }
      }
    }
  });
}

function render(){
  var opts = {
    q: document.getElementById('q').value,
    agency: document.getElementById('f-agency').value,
    category: document.getElementById('f-cat').value
  };
  var sortKey = document.getElementById('f-sort').value;
  var matched = filterContracts(state.all, opts);
  var sorted = sortContracts(matched, sortKey);
  state.view = sorted;

  // KPIs reflect the matched set (live aggregates)
  paintKpis(aggregate(matched));

  var capped = sorted.slice(0, ROW_CAP);
  var tbody = document.getElementById('rows');
  if(capped.length === 0){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No contracts match this search. Clear the box or widen the filters.</td></tr>';
    state.openId = null;
  } else {
    var html = '';
    for(var i=0;i<capped.length;i++){
      html += rowHtml(capped[i]);
      if(capped[i].contract_id === state.openId){ html += detailHtml(capped[i]); }
    }
    tbody.innerHTML = html;
  }

  // match note + table note
  var mn = document.getElementById('match-note');
  if(matched.length > capped.length){
    mn.innerHTML = 'Showing <b>' + capped.length + '</b> of <b>' + fmtInt(matched.length) + '</b> matching contracts. Narrow the search to see the rest.';
  } else {
    mn.innerHTML = '<b>' + fmtInt(matched.length) + '</b> ' + (matched.length === 1 ? 'matching contract' : 'matching contracts') + '.';
  }
  document.getElementById('clear-q').hidden = !document.getElementById('q').value;

  // (re)draw an open detail chart after the DOM is in place
  if(state.openId){
    var openC = capped.filter(function(c){ return c.contract_id === state.openId; })[0];
    if(openC && Array.isArray(openC.monthly_cumulative) && openC.monthly_cumulative.length) drawDetailChart(openC);
    var openTr = tbody.querySelector('tr.crow[data-id="' + cssEscape(state.openId) + '"]');
    if(openTr){ openTr.classList.add('open'); openTr.setAttribute('aria-expanded', 'true'); }
  }
}

/* minimal attribute-selector escape for contract ids (alnum only in practice) */
function cssEscape(s){ return String(s).replace(/["\\]/g, '\\$&'); }

function toggleDetail(id){
  if(state.chart){ state.chart.destroy(); state.chart = null; }
  state.openId = (state.openId === id) ? null : id;
  render();
}

/* ================= wiring ================= */
function fillSelect(sel, values, label){
  var html = '<option value="">All ' + label + '</option>';
  for(var i=0;i<values.length;i++){ html += '<option value="' + esc(values[i]) + '">' + esc(values[i]) + '</option>'; }
  sel.innerHTML = html;
}

/* Fiscal-year window label, read only from the file's meta. fiscal_years is the
   ascending list the build covers; fiscal_year_ytd, when present, names the
   in-progress year inside it (NYC FY N = Jul 1 N-1 to Jun 30 N) and is labeled
   year to date. Same rule as the Funnel page's Paid label; no years hardcoded. */
function fyWindowLabel(meta){
  var ys = (meta && Array.isArray(meta.fiscal_years)) ? meta.fiscal_years.filter(function(y){ return isFinite(+y); }).map(Number) : [];
  if(!ys.length) return { short: '', long: '' };
  var ytd = (meta.fiscal_year_ytd != null && ys.indexOf(+meta.fiscal_year_ytd) !== -1) ? +meta.fiscal_year_ytd : null;
  var closed = ys.filter(function(y){ return y !== ytd; });
  var cs = '', cl = '';
  if(closed.length === 1){ cs = 'FY' + closed[0]; cl = 'fiscal year ' + closed[0]; }
  else if(closed.length > 1){ cs = 'FY' + closed[0] + '–' + closed[closed.length-1]; cl = 'fiscal years ' + closed[0] + ' to ' + closed[closed.length-1]; }
  if(ytd === null) return { short: cs, long: cl };
  var ysh = 'FY' + ytd + ' YTD', yl = 'fiscal year ' + ytd + ' to date';
  if(!closed.length) return { short: ysh, long: yl };
  return { short: cs + ' + ' + ysh, long: cl + ' plus ' + yl };
}

function init(payload){
  state.all = Array.isArray(payload.contracts) ? payload.contracts : [];
  state.meta = payload.meta || {};

  // hero + series bar
  var gen = state.meta.generated ? fmtDate(state.meta.generated.slice(0,10)) : EN;
  var fyl = fyWindowLabel(state.meta);
  var fys = fyl.short || EN;
  if(fyl.long) setText('universe-fy', fyl.long);
  setText('series-updated', gen);
  setText('series-asof', fys);
  setText('search-cap', fys);
  document.getElementById('asof').innerHTML = 'Indexed <strong>' + fmtInt(state.all.length) + '</strong> registered construction contracts &middot; ' + esc(fys) + ' &middot; rebuilt ' + esc(gen);

  // filter selects
  fillSelect(document.getElementById('f-agency'), distinctSorted(state.all, 'agency'), 'agencies');
  fillSelect(document.getElementById('f-cat'), distinctSorted(state.all, 'category'), 'categories');

  // coverage notes
  var cov = document.getElementById('cov-list');
  var notes = Array.isArray(state.meta.coverage_notes) ? state.meta.coverage_notes : [];
  cov.innerHTML = notes.length ? notes.map(function(n){ return '<li>' + esc(n) + '</li>'; }).join('') : '<li>No coverage notes were published with this build.</li>';

  // table footnote
  document.getElementById('tbl-note').innerHTML = 'Each row is one registered contract. Registered is the current amount with original as a fallback; paid to date and percent paid are the City\'s contract-record figures and cover every row; ' + EN + ' marks a field with no published value. Click a row to open its dates and amounts; contracts of $500,000 or more registered since 2019 that are open or closed within the past year also carry a dated payment velocity and spend curve. Up to ' + ROW_CAP + ' rows are painted at once; narrow the search to reach the rest.';

  // events
  var q = document.getElementById('q');
  q.addEventListener('input', function(){ state.openId = null; render(); });
  document.getElementById('clear-q').addEventListener('click', function(){ q.value = ''; state.openId = null; render(); q.focus(); });
  document.getElementById('f-agency').addEventListener('change', function(){ state.openId = null; render(); });
  document.getElementById('f-cat').addEventListener('change', function(){ state.openId = null; render(); });
  document.getElementById('f-sort').addEventListener('change', function(){ render(); });

  var tbody = document.getElementById('rows');
  tbody.addEventListener('click', function(e){
    var tr = e.target.closest ? e.target.closest('tr.crow') : null;
    if(tr && tr.dataset.id) toggleDetail(tr.dataset.id);
  });
  tbody.addEventListener('keydown', function(e){
    if(e.key !== 'Enter' && e.key !== ' ') return;
    var tr = e.target.closest ? e.target.closest('tr.crow') : null;
    if(tr && tr.dataset.id){ e.preventDefault(); toggleDetail(tr.dataset.id); }
  });

  render();

  document.getElementById('loader').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

/* ================= load (live, fall back to sample on a local checkout only) ================= */
function loadJSON(url){
  return fetch(url, { cache: 'no-store' }).then(function(res){
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}
/* The sample file carries synthetic contracts for local work. It must never paint
   as if it were the record, so a fixture payload renders the unavailable state
   anywhere other than a local checkout. */
function isLocalCheckout(){
  var h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
}
function boot(){
  loadJSON(LIVE_URL)
    .catch(function(){ return loadJSON(SAMPLE_URL); })
    .then(function(payload){
      if(payload && payload.meta && payload.meta.fixture){
        if(!isLocalCheckout()) throw new Error('fixture payload refused outside a local checkout');
        if(window.console) console.warn('contract-search: rendering the synthetic sample fixture, not the nightly file');
      }
      init(payload);
    })
    .catch(function(err){
      document.getElementById('loader').style.display = 'none';
      document.getElementById('error').style.display = 'block';
      if(window.console) console.error('contract-search load failed', err);
    });
}

/* expose pure ops for the Node test harness (no effect in the browser) */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { matchesQuery: matchesQuery, filterContracts: filterContracts, sortContracts: sortContracts, aggregate: aggregate, distinctSorted: distinctSorted, denom: denom, median: median, fmtMoney: fmtMoney, fmtPct: fmtPct, pctClass: pctClass };
}
if(typeof document !== 'undefined'){
  if(document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', boot); } else { boot(); }
}
