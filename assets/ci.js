/* The Concrete Index · shared script (classic script, loaded with defer
 * before every page module).
 *
 *   ci.esc(s)            HTML-escape text or an attribute value
 *   ci.fmt(v, kind)      the one number and date formatter; every kind
 *                        reproduces a format a page shows today
 *                        (proved by tools/test-fmt.mjs)
 *   ci.getJSON(u, p)     Socrata GET with the app token
 *   ci.on(name, fn)      register a handler for [data-action="name"]
 *   ci.toast(msg)        confirmation toast (role="status")
 *   ci.banner(slot, o)   inline error or stale banner
 *
 * On load it also: applies [data-ci-hide] and [data-ci-style] through the
 * CSSOM (no style attributes, so the CSP needs no 'unsafe-inline'), wires
 * the disclosure menu, fills the copyright year, and attaches the chart and
 * table export controls on pages that opt in with <meta name="ci:export">.
 */
(function (root) {
  'use strict';
  var ci = root.ci || (root.ci = {});

  /* ================= text ================= */
  var CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
  ci.esc = function (s) {
    return String(s == null ? '' : s).replace(CTRL, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  // Same output as the pages' esc(): & < > only (quotes are left as typed).
  function escText(s) {
    return String(s == null ? '' : s).replace(CTRL, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ================= number and date formatting =================
   * Each kind is named for what it prints. Kinds ending in "?" return an en
   * dash for null, undefined, or NaN. The page that introduced each format is
   * noted so the parity harness can trace it. */
  var EN = '–';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function blank(v) { return v === null || v === undefined || (typeof v === 'number' && isNaN(v)); }
  function money(v) {               // $2.84B, $107.9B, $3.0M, $998M, $412K, $87
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 10e9 ? 1 : 2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 100e6 ? 0 : 1) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }
  var KINDS = {
    'money': money,
    'money?': function (v) { return blank(v) ? EN : money(v); },                       // Contracts
    'money-b2': function (v) {                                                          // Contractors lookup
      if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
      return money(v);
    },
    'money-k': function (v) {                                                           // Analysis
      if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 10e9 ? 1 : 2) + 'B';
      if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 100e6 ? 0 : 1) + 'M';
      return '$' + Math.round(v / 1e3) + 'K';
    },
    'money-compact': function (n) {                                                     // Home
      n = +n; if (!isFinite(n)) return EN;
      if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
      if (n >= 1e6) return '$' + Math.round(n / 1e6) + 'M';
      if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
      return '$' + Math.round(n);
    },
    'money-full?': function (v) { return blank(v) ? EN : '$' + Math.round(v).toLocaleString('en-US'); }, // Contracts
    'int': function (v) { return v.toLocaleString('en-US'); },
    'int0': function (v) { return (v || 0).toLocaleString('en-US'); },                  // Contractors
    'int?': function (v) { return blank(v) ? EN : Math.round(v).toLocaleString('en-US'); }, // Contracts
    'int-compact': function (n) { n = +n; if (!isFinite(n)) return EN; return Math.round(n).toLocaleString('en-US'); }, // Home
    'index': function (v) { return Number(v).toFixed(1); },                            // 80.3
    'pct': function (v) { return (v * 100).toFixed(v * 100 >= 10 ? 0 : 1) + '%'; },   // Agencies
    'pct?': function (v) { if (blank(v)) return EN; var p = v * 100; return p.toFixed(p >= 10 ? 0 : 1) + '%'; }, // Contracts
    'pct0': function (v) { return (v * 100).toFixed(0) + '%'; },                       // Analysis
    'pct1-html?': function (v) { return v === null ? '&ndash;' : (v * 100).toFixed(1) + '%'; }, // Contractors market
    'pct-abs': function (v) { return Math.abs(v).toFixed(0) + '%'; },                  // Briefing
    'pct-signed': function (v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(0) + '%'; }, // Analysis
    'days?': function (v) { return blank(v) ? EN : Math.round(v).toLocaleString('en-US') + ' days'; }, // Contracts
    'date': function (d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); },
    'date-utc?': function (s) {                                                         // Contracts
      if (!s) return EN;
      var d = new Date(s + (s.length === 10 ? 'T00:00:00Z' : ''));
      if (isNaN(d.getTime())) return escText(s);
      return MON[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
    },
    'month-tick': function (p) {                                                        // Contracts: Mar '24
      if (!p || p.length < 7) return p || '';
      return MON[(+p.slice(5, 7)) - 1] + " '" + p.slice(2, 4);
    },
    'month-label': function (m) { var a = m.split('-'); return MON[+a[1] - 1] + ' ’' + a[0].slice(2); }, // Awarded: Mar ’24
    'ym-short': function (m) { return MON[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4); },  // 2024-03 -> Mar 2024
    'period-long': function (p) { return MONTHS[+p.slice(4, 6) - 1] + ' ' + p.slice(0, 4); }, // 202409 -> September 2024
    'period-long?': function (p) { if (!p) return ''; return MONTHS[+p.slice(4, 6) - 1] + ' ' + p.slice(0, 4); }, // Pipeline
    'month-long': function (ym) {                                                       // Home: 2026-10 -> October 2026
      if (!ym) return ''; var p = String(ym).split('-'); var mo = MONTHS[(+p[1]) - 1]; return mo ? (mo + ' ' + p[0]) : '';
    }
  };
  ci.fmt = function (v, kind) {
    var f = KINDS[kind || 'money'];
    if (!f) throw new Error('ci.fmt: unknown kind ' + kind);
    return f(v);
  };
  ci.fmt.kinds = Object.keys(KINDS);

  /* ================= data ================= */
  ci.APP_TOKEN = '3TAzQQPiSG2T4WGWfYYUxxqfJ';
  ci.getJSON = function (url, params, opts) {
    var u = params ? url + (url.indexOf('?') < 0 ? '?' : '&') + new URLSearchParams(params) : url;
    var headers = (opts && opts.headers) || {};
    if (/^https:\/\/data\.(cityofnewyork\.us|ny\.gov)\//.test(u)) headers['X-App-Token'] = ci.APP_TOKEN;
    return fetch(u, { headers: headers, cache: opts && opts.cache }).then(function (r) {
      if (!r.ok) throw new Error('API ' + r.status);
      return r.json();
    });
  };

  if (typeof document === 'undefined') return; // Node (tests): formatter only

  /* ================= CSSOM style application ================= */
  function applyHides(rootEl) {
    var list = (rootEl || document).querySelectorAll('[data-ci-hide]');
    for (var i = 0; i < list.length; i++) {
      list[i].style.display = 'none';
      list[i].removeAttribute('data-ci-hide');
    }
  }
  function applyStyle(el) {
    var decl = el.getAttribute('data-ci-style') || '';
    decl.split(';').forEach(function (d) {
      var i = d.indexOf(':');
      if (i < 1) return;
      el.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim());
    });
    el.removeAttribute('data-ci-style');
  }
  ci.applyStyles = function (rootEl) {
    var r = rootEl || document;
    if (r.nodeType === 1 && r.hasAttribute('data-ci-style')) applyStyle(r);
    if (r.querySelectorAll) {
      var list = r.querySelectorAll('[data-ci-style]');
      for (var i = 0; i < list.length; i++) applyStyle(list[i]);
    }
  };
  applyHides(document);
  ci.applyStyles(document);
  // Page modules build markup with innerHTML. Geometry they compute (bar
  // widths, swatch colors) travels in data-ci-style and is applied here,
  // as a microtask after insertion and before the next paint.
  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var added = records[i].addedNodes;
      for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) ci.applyStyles(added[j]);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* ================= delegated actions ================= */
  var actions = { reload: function () { location.reload(); } };
  ci.on = function (name, fn) { actions[name] = fn; };
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-action]');
    if (!el) return;
    var fn = actions[el.getAttribute('data-action')];
    if (fn) fn(el, e);
  });

  /* ================= disclosure menu ================= */
  (function () {
    var head = document.querySelector('.ci-masthead');
    var btn = head && head.querySelector('.ci-menu-btn');
    var panel = btn && document.getElementById(btn.getAttribute('aria-controls'));
    if (!panel) return;
    var label = btn.querySelector('.ci-menu-btn__label');
    var wide = window.matchMedia('(min-width:1024px)');
    function isOpen() { return btn.getAttribute('aria-expanded') === 'true'; }
    function set(open, restoreFocus) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.classList.toggle('is-open', open);
      if (label) label.textContent = open ? 'Close' : 'Menu';
      if (open) {
        var first = panel.querySelector('a');
        if (first) first.focus();
      } else if (restoreFocus) {
        btn.focus();
      }
    }
    btn.addEventListener('click', function () { set(!isOpen(), false); });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) { e.preventDefault(); set(false, true); }
    });
    head.addEventListener('focusout', function (e) {
      if (isOpen() && e.relatedTarget && !head.contains(e.relatedTarget)) set(false, false);
    });
    document.addEventListener('click', function (e) {
      if (isOpen() && !head.contains(e.target)) set(false, false);
    });
    panel.addEventListener('click', function (e) {
      if (e.target.closest('a') && isOpen()) set(false, false);
    });
    var onWide = function () { if (wide.matches && isOpen()) set(false, false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide); else wide.addListener(onWide);
    window.addEventListener('pageshow', function () { if (isOpen()) set(false, false); });
  })();

  /* ================= copyright year ================= */
  (function () {
    var y = document.querySelectorAll('[data-ci-year]');
    var now = new Date().getUTCFullYear();
    for (var i = 0; i < y.length; i++) {
      var first = +y[i].getAttribute('data-ci-year');
      if (now > first) y[i].textContent = first + '–' + now;
    }
  })();

  /* ================= toast ================= */
  var region = null;
  ci.toast = function (msg) {
    if (!region) {
      region = document.createElement('div');
      region.className = 'ci-toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    var t = document.createElement('div');
    t.className = 'ci-toast';
    t.textContent = msg;
    region.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    var left = 6000, started = Date.now(), timer = null, paused = false;
    function arm() { started = Date.now(); timer = setTimeout(close, left); }
    function close() { t.classList.remove('is-in'); setTimeout(function () { t.remove(); }, 300); }
    function pause() { if (paused) return; paused = true; clearTimeout(timer); left -= Date.now() - started; }
    function resume() { if (!paused) return; paused = false; arm(); }
    t.addEventListener('mouseenter', pause); t.addEventListener('mouseleave', resume);
    t.addEventListener('focusin', pause); t.addEventListener('focusout', resume);
    arm();
    return t;
  };

  /* ================= error and stale banner ================= */
  ci.banner = function (slot, o) {
    if (!slot) return null;
    o = o || {};
    var b = document.createElement('div');
    b.className = 'ci-banner' + (o.stale ? ' ci-banner--stale' : '');
    if (o.alert) b.setAttribute('role', 'alert');
    var title = document.createElement('span');
    title.className = 'ci-banner__title';
    title.textContent = o.title || '';
    var text = document.createElement('span');
    text.textContent = o.text || '';
    b.appendChild(title); b.appendChild(text);
    if (o.retry) {
      var r = document.createElement('button');
      r.type = 'button'; r.className = 'ci-btn'; r.textContent = 'Retry';
      r.addEventListener('click', o.retry);
      b.appendChild(r);
    }
    slot.replaceChildren(b);
    return b;
  };

  /* ================= export: page PDF, chart PNG and CSV, table CSV =================
   * Moved verbatim from the per-page export module; the only changes are the
   * opt-in meta tag and the container selector ([data-ci-main] is what each
   * page's own <main> became when the shared <main id="content"> wrapped it). */
  (function () {
    if (!document.querySelector('meta[name="ci:export"]')) return;
    if (window.__ciExport) return; window.__ciExport = 1;
    function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
    var pageSlug = slug(location.pathname.replace(/\/index\.html?$/i, '').replace(/\/+$/, '')) || 'home';
    function getChart(cv) { return (cv && window.Chart && Chart.getChart) ? (Chart.getChart(cv) || null) : null; }
    function fnameFor(el, ext) {
      var card = el.closest('.card') || el.closest('section') || el.parentElement;
      var h = card && card.querySelector('.sec-head h2,h2,h3');
      if (!h) { var s = el.previousElementSibling; while (s) { if (s.tagName === 'H2' || s.tagName === 'H3') { h = s; break; } s = s.previousElementSibling; } }
      return ('concrete-index-' + pageSlug + '-' + slug(h ? h.textContent : 'export')).replace(/-+/g, '-') + '.' + ext;
    }
    function dl(href, name, revoke) {
      var a = document.createElement('a'); a.href = href; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      if (revoke) setTimeout(function () { URL.revokeObjectURL(href); }, 2000);
    }
    function csvCell(v) { v = (v == null ? '' : String(v)); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    function csv(rows, name) {
      var t = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
      dl(URL.createObjectURL(new Blob([t], { type: 'text/csv;charset=utf-8' })), name, true);
      ci.toast('CSV downloaded · ' + Math.max(rows.length - 1, 0) + ' rows');
    }
    function pngFromChart(ch, name) {
      var src = ch.canvas, out = document.createElement('canvas');
      out.width = src.width; out.height = src.height;
      var x = out.getContext('2d');
      x.fillStyle = '#fefbf8'; x.fillRect(0, 0, out.width, out.height);
      x.drawImage(src, 0, 0);
      dl(out.toDataURL('image/png'), name, false);
    }
    function csvFromChart(ch, name) {
      var labels = ch.data.labels || [], ds = ch.data.datasets || [];
      var rows = [['Label'].concat(ds.map(function (d, i) { return d.label || ('Series ' + (i + 1)); }))];
      var n = labels.length || ((ds[0] && ds[0].data) ? ds[0].data.length : 0);
      for (var r = 0; r < n; r++) {
        var row = [labels[r] != null ? labels[r] : r];
        ds.forEach(function (d) {
          var v = d.data ? d.data[r] : '';
          if (v && typeof v === 'object') v = (v.y != null ? v.y : (v.v != null ? v.v : JSON.stringify(v)));
          row.push(v == null ? '' : v);
        });
        rows.push(row);
      }
      csv(rows, name);
    }
    function csvFromTable(tbl, name) {
      var rows = [];
      tbl.querySelectorAll('tr').forEach(function (tr) {
        var cells = [];
        tr.querySelectorAll('th,td').forEach(function (c) { cells.push(c.textContent.replace(/\s+/g, ' ').trim()); });
        if (cells.some(function (x) { return x !== ''; })) rows.push(cells);
      });
      if (rows.length) csv(rows, name);
    }
    function mkBtn(label, title, fn) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title;
      b.addEventListener('click', fn); return b;
    }
    function placeAfter(el, bar) {
      var t = el, nx = el.nextElementSibling;
      if (nx && nx.classList && nx.classList.contains('tnote')) t = nx;
      t.insertAdjacentElement('afterend', bar);
    }
    function attachChart(box) {
      if (!box || box.getAttribute('data-exp')) return;
      var cv = box.querySelector('canvas'); if (!cv) return;
      box.setAttribute('data-exp', '1');
      var bar = document.createElement('div'); bar.className = 'exp';
      bar.appendChild(mkBtn('PNG', 'Download this chart as a PNG image', function () { var ch = getChart(cv); if (ch) pngFromChart(ch, fnameFor(box, 'png')); }));
      bar.appendChild(mkBtn('CSV', 'Download this chart’s data as a CSV file', function () { var ch = getChart(cv); if (ch) csvFromChart(ch, fnameFor(box, 'csv')); }));
      placeAfter(box, bar);
    }
    function attachTable(tbl) {
      if (!tbl || tbl.getAttribute('data-exp')) return;
      if (!tbl.querySelector('th')) return;
      if (tbl.closest('header') || tbl.closest('footer') || tbl.closest('nav')) return;
      tbl.setAttribute('data-exp', '1');
      var bar = document.createElement('div'); bar.className = 'exp';
      bar.appendChild(mkBtn('CSV', 'Download this table as a CSV file', function () { csvFromTable(tbl, fnameFor(tbl, 'csv')); }));
      placeAfter(tbl, bar);
    }
    function scan() {
      document.querySelectorAll('.chart-box').forEach(attachChart);
      document.querySelectorAll('[data-ci-main] canvas,#app canvas').forEach(function (cv) { if (!cv.closest('.chart-box')) attachChart(cv.parentElement); });
      document.querySelectorAll('[data-ci-main] table,#app table,.card table').forEach(attachTable);
    }
    function addPdfBtn() {
      if (document.querySelector('.pdf-btn')) return;
      var b = mkBtn('Save PDF', 'Save or print this page as a PDF', function () { window.print(); });
      b.className = 'pdf-btn';
      var inner = document.querySelector('.series-bar .inner');
      if (inner) { inner.appendChild(b); return; }
      var header = document.querySelector('.ci-masthead');
      if (header) { var bar = document.createElement('div'); bar.className = 'pdf-bar'; bar.appendChild(b); header.insertAdjacentElement('afterend', bar); }
    }
    var pending = null;
    function start() {
      addPdfBtn(); scan();
      try {
        var mo = new MutationObserver(function () { if (pending) return; pending = setTimeout(function () { pending = null; scan(); }, 300); });
        mo.observe(document.body, { childList: true, subtree: true });
      } catch (e) { /* no observer: the timed scans below still run */ }
      [400, 1200, 3000].forEach(function (t) { setTimeout(scan, t); });
    }
    if (document.readyState !== 'loading') start(); else document.addEventListener('DOMContentLoaded', start);
  })();
})(typeof window !== 'undefined' ? window : globalThis);
