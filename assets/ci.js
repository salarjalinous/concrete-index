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
    if (!o) { slot.replaceChildren(); return null; }   // clear the slot
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

  /* ---- alerts after a user action (role=alert) ----
   * The visible state (a banner, an empty table, a field message) is always
   * shown by the page; this region only makes sure it is announced. */
  var alertRegion = null;
  ci.alert = function (msg) {
    if (!alertRegion) {
      alertRegion = document.createElement('div');
      alertRegion.className = 'ci-vh'; alertRegion.setAttribute('role', 'alert');
      document.body.appendChild(alertRegion);
    }
    alertRegion.textContent = '';
    setTimeout(function () { alertRegion.textContent = msg; }, 50);
  };
  // Invalid input: a message tied to the field, cleared on the next edit.
  ci.invalid = function (input, msg) {
    if (!input) return;
    var id = (input.id || uid('in')) + '-error';
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('p'); el.id = id; el.className = 'ci-field-error'; el.setAttribute('role', 'alert');
      (input.closest('.ci-combo,.searchbar,.search-box') || input).insertAdjacentElement('afterend', el);
      input.addEventListener('input', function () { el.textContent = ''; el.hidden = true; input.removeAttribute('aria-invalid'); });
    }
    el.hidden = false; el.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    var d = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (d.indexOf(id) < 0) { d.push(id); input.setAttribute('aria-describedby', d.join(' ')); }
  };
  // Stale archive: a nightly file older than its own stale_after_hours.
  // fallbackHours applies only when the file does not publish the field.
  ci.stale = function (meta, o) {
    o = o || {};
    if (!meta) return false;
    var gen = new Date(meta.generated_at || meta.generated || '');
    if (isNaN(gen.getTime())) return false;
    var limit = +meta.stale_after_hours || o.fallbackHours || 48;
    var age = (Date.now() - gen.getTime()) / 3600000;
    if (age <= limit) return false;
    ci.banner(o.slot, { stale: true, title: 'Showing the snapshot of ' + KINDS['date-utc?'](gen.toISOString().slice(0, 10)) + '.',
      text: (o.what ? o.what + ' ' : '') + 'The latest scheduled refresh did not complete; every figure below is as of that date.' });
    return true;
  };

  /* ================= app chrome (PRD 6.5, 8.2) =================
   * Everything here enhances markup the page already has. None of it reads
   * or changes a figure: tables built from a chart hold the strings the
   * chart's own tooltip prints for each value. */
  var seq = 0;
  function uid(p) { return 'ci-' + p + '-' + (++seq); }
  function headingFor(el) {
    var card = el.closest('.card') || el.closest('section') || el.parentElement;
    var h = card && card.querySelector('.sec-head h2,h2,h3,.dc-head');
    if (!h) { var s = el.previousElementSibling; while (s) { if (/^H[23]$/.test(s.tagName)) { h = s; break; } s = s.previousElementSibling; } }
    return h || null;
  }
  function textOf(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function stickyH() {
    var v = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
    return isNaN(v) ? 0 : v;
  }

  /* ---- segmented controls: pressed state and group label ----
   * Pages mark the selected button with class "on". aria-pressed follows
   * that class, so the page logic stays as it is. */
  function syncSegBtn(b) {
    if (b.tagName !== 'BUTTON' || !b.closest('.seg')) return;
    if (!b.hasAttribute('type')) b.setAttribute('type', 'button');
    var on = b.classList.contains('on') ? 'true' : 'false';
    if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on);
  }
  function labelSeg(seg) {
    if (seg.hasAttribute('role')) return;
    seg.setAttribute('role', 'group');
    if (seg.hasAttribute('aria-label') || seg.hasAttribute('aria-labelledby')) return;
    var lab = seg.previousElementSibling;
    if (!(lab && lab.classList.contains('ctl-label'))) {
      var box = seg.closest('.ctl,.ctl-group');
      lab = box && box.querySelector('.ctl-label,label');
    }
    if (lab) { if (!lab.id) lab.id = uid('lbl'); seg.setAttribute('aria-labelledby', lab.id); }
  }
  function enhanceSegs(rootEl) {
    var r = rootEl && rootEl.querySelectorAll ? rootEl : document;
    if (r.matches && r.matches('.seg')) labelSeg(r);
    r.querySelectorAll('.seg').forEach(labelSeg);
    if (r.matches && r.matches('.seg button')) syncSegBtn(r);
    r.querySelectorAll('.seg button').forEach(syncSegBtn);
  }
  ci.enhanceSegs = enhanceSegs;

  /* ---- rule tables: labelled, focusable overflow region ---- */
  function wrapTable(tbl) {
    if (tbl.closest('.ci-table-wrap') || tbl.closest('header,footer,nav')) return;
    var w = document.createElement('div');
    w.className = 'ci-table-wrap';
    var first = tbl.querySelector('tr > :first-child');
    if (tbl.querySelector('td.rank') || (first && first.tagName === 'TH' && !textOf(first))) w.classList.add('ci-table-wrap--rank');
    var h = headingFor(tbl);
    w.setAttribute('data-label', (tbl.getAttribute('data-ci-label') || textOf(tbl.querySelector('caption')) || textOf(h) || 'Data') + ', table');
    tbl.parentNode.insertBefore(w, tbl);
    w.appendChild(tbl);
    watchOverflow(w);
  }
  // The region role, label, and tab stop are added only while the table
  // actually overflows its box, so short tables add no landmark noise.
  var ro = window.ResizeObserver ? new ResizeObserver(function (es) { es.forEach(function (e) { overflowState(e.target.closest('.ci-table-wrap') || e.target); }); }) : null;
  function overflowState(w) {
    if (!w || !w.classList || !w.classList.contains('ci-table-wrap')) return;
    var over = w.scrollWidth > w.clientWidth + 1 || w.scrollHeight > w.clientHeight + 1;
    if (over) {
      w.setAttribute('role', 'region'); w.setAttribute('tabindex', '0'); w.setAttribute('aria-label', w.getAttribute('data-label'));
    } else if (w.hasAttribute('role')) {
      w.removeAttribute('role'); w.removeAttribute('tabindex'); w.removeAttribute('aria-label');
    }
  }
  function watchOverflow(w) {
    overflowState(w);
    if (ro) { ro.observe(w); var t = w.querySelector('table'); if (t) ro.observe(t); }
  }
  ci.wrapTables = function (rootEl) {
    var r = rootEl || document;
    r.querySelectorAll('main table').forEach(wrapTable);
    document.querySelectorAll('.ci-table-wrap').forEach(overflowState);
  };

  /* ---- sort buttons in table headers ----
   * <th data-ci-sort="<select id>" data-ci-sort-value="<option>"
   *     data-ci-sort-dir="ascending|descending"> drives the page's existing
   * sort control: the header button sets that control and fires its change
   * event, and aria-sort mirrors whatever the control holds. */
  function syncSort(selId) {
    var sel = document.getElementById(selId);
    if (!sel) return;
    document.querySelectorAll('th[data-ci-sort="' + selId + '"]').forEach(function (th) {
      th.setAttribute('aria-sort', th.getAttribute('data-ci-sort-value') === sel.value ? th.getAttribute('data-ci-sort-dir') : 'none');
    });
  }
  function enhanceSort() {
    var seen = {};
    document.querySelectorAll('th[data-ci-sort]').forEach(function (th) {
      var selId = th.getAttribute('data-ci-sort');
      if (!th.querySelector('.ci-sort')) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'ci-sort';
        while (th.firstChild) b.appendChild(th.firstChild);
        th.appendChild(b);
        b.addEventListener('click', function () {
          var sel = document.getElementById(selId);
          if (!sel || sel.value === th.getAttribute('data-ci-sort-value')) return;
          sel.value = th.getAttribute('data-ci-sort-value');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
      if (!seen[selId]) {
        seen[selId] = 1;
        var sel = document.getElementById(selId);
        if (sel) sel.addEventListener('change', function () { syncSort(selId); });
        syncSort(selId);
      }
    });
  }

  /* ---- search combobox (ARIA 1.2 combobox with listbox) ----
   * ci.combobox(input, {
   *   source(text) -> [{ label, value, hint }]   local suggestions only,
   *   onSelect(option)                            the page's own action,
   *   status(text, options) -> string             announced in a polite region
   * })
   * Suggestions never touch the network. Enter on a highlighted option
   * selects it; Enter with none highlighted falls through to the page's own
   * handler, so a typed query runs exactly as before. */
  ci.combobox = function (input, o) {
    if (!input || input.hasAttribute('role')) return null;
    o = o || {};
    var min = o.minChars || 2, max = o.max || 8;
    var lb = document.createElement('ul');
    lb.id = (input.id || uid('in')) + '-listbox';
    lb.className = 'ci-listbox'; lb.setAttribute('role', 'listbox');
    lb.setAttribute('aria-label', (input.getAttribute('aria-label') || input.placeholder || 'Search') + ', suggestions');
    lb.hidden = true;
    var st = document.createElement('p');
    st.className = 'ci-vh'; st.setAttribute('role', 'status'); st.setAttribute('aria-live', 'polite');
    var host = input.parentElement;
    host.classList.add('ci-combo');
    input.insertAdjacentElement('afterend', lb);
    lb.insertAdjacentElement('afterend', st);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', lb.id);
    input.setAttribute('autocomplete', 'off');
    var opts = [], active = -1, statusTimer = null;
    function say(t) { clearTimeout(statusTimer); statusTimer = setTimeout(function () { st.textContent = t; }, 400); }
    function close() {
      lb.hidden = true; input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant'); active = -1;
    }
    function highlight(i) {
      var items = lb.children;
      if (active >= 0 && items[active]) items[active].setAttribute('aria-selected', 'false');
      active = i;
      if (i < 0 || !items[i]) { input.removeAttribute('aria-activedescendant'); return; }
      items[i].setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', items[i].id);
      var top = items[i].offsetTop, bot = top + items[i].offsetHeight;
      if (top < lb.scrollTop) lb.scrollTop = top; else if (bot > lb.scrollTop + lb.clientHeight) lb.scrollTop = bot - lb.clientHeight;
    }
    var muted = false;
    function update() {
      if (muted) { muted = false; close(); return; }
      var t = input.value.trim();
      opts = t.length >= min && o.source ? (o.source(t) || []).slice(0, max) : [];
      lb.innerHTML = opts.map(function (x, i) {
        return '<li role="option" id="' + lb.id + '-' + i + '" aria-selected="false" class="ci-option">' + ci.esc(x.label) +
          (x.hint ? '<span class="ci-option__hint">' + ci.esc(x.hint) + '</span>' : '') + '</li>';
      }).join('');
      active = -1; input.removeAttribute('aria-activedescendant');
      var open = opts.length > 0 && document.activeElement === input;
      lb.hidden = !open; input.setAttribute('aria-expanded', open ? 'true' : 'false');
      var s = o.status ? o.status(t, opts) : '';
      if (s == null || s === '') s = t.length >= min ? (opts.length ? opts.length + (opts.length === 1 ? ' suggestion' : ' suggestions') + '. Use the arrow keys to choose one.' : 'No suggestions.') : '';
      say(s);
    }
    function choose(i) {
      var x = opts[i];
      if (!x) return;
      input.value = x.value;
      close();
      muted = true;
      if (o.onSelect) o.onSelect(x);
      muted = false;
    }
    input.addEventListener('input', update);
    input.addEventListener('focus', function () { if (opts.length && input.value.trim().length >= min) { lb.hidden = false; input.setAttribute('aria-expanded', 'true'); } });
    input.addEventListener('keydown', function (e) {
      var open = !lb.hidden;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) { update(); if (!opts.length) return; lb.hidden = false; input.setAttribute('aria-expanded', 'true'); }
        highlight(active + 1 >= opts.length ? 0 : active + 1);
      } else if (e.key === 'ArrowUp') {
        if (!open) return;
        e.preventDefault();
        highlight(active <= 0 ? opts.length - 1 : active - 1);
      } else if (e.key === 'Enter') {
        if (open && active >= 0) { e.preventDefault(); e.stopImmediatePropagation(); choose(active); }
        else close();
      } else if (e.key === 'Escape' || e.key === 'Esc') {
        if (open) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      } else if (e.key === 'Tab') {
        close();
      }
    }, true);
    lb.addEventListener('mousedown', function (e) { e.preventDefault(); });
    lb.addEventListener('click', function (e) {
      var li = e.target.closest('[role="option"]');
      if (li) choose([].indexOf.call(lb.children, li));
    });
    input.addEventListener('blur', function () { setTimeout(close, 0); });
    return { update: update, close: close, say: say };
  };

  /* ---- sub-nav: aria-current="location" follows the reader ---- */
  function subnav() {
    var nav = document.querySelector('.ci-subnav');
    if (!nav) return;
    var links = [].slice.call(nav.querySelectorAll('a[href^="#"]'));
    var targets = [];
    links.forEach(function (a) {
      var ids = [a.getAttribute('href').slice(1)].concat((a.getAttribute('data-also') || '').split(/\s+/).filter(Boolean));
      ids.forEach(function (id) { var t = document.getElementById(id); if (t) targets.push({ el: t, a: a }); });
    });
    if (!targets.length) return;
    var current = null, raf = 0;
    function set(a) {
      if (a === current) return;
      if (current) current.removeAttribute('aria-current');
      current = a;
      if (!a) return;
      a.setAttribute('aria-current', 'location');
      var list = a.closest('.ci-subnav__list');
      if (list && list.scrollWidth > list.clientWidth) {
        var l = a.offsetLeft - list.offsetLeft, r = l + a.offsetWidth;
        if (l < list.scrollLeft) list.scrollLeft = l;
        else if (r > list.scrollLeft + list.clientWidth) list.scrollLeft = r - list.clientWidth;
      }
    }
    function pick() {
      raf = 0;
      var line = stickyH() + Math.min(160, window.innerHeight * 0.25), best = null;
      targets.forEach(function (t) {
        if (!t.el.getClientRects().length) return;
        var top = t.el.getBoundingClientRect().top;
        if (top <= line && (!best || top > best.top)) best = { a: t.a, top: top };
      });
      // At the very bottom the last section may never reach the line.
      if ((window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 2) {
        var last = targets.filter(function (t) { return t.el.getClientRects().length; }).pop();
        if (last) best = { a: last.a };
      }
      set(best ? best.a : null);
    }
    function soon() { if (!raf) raf = requestAnimationFrame(pick); }
    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(soon, { threshold: [0, 0.25, 0.5, 1], rootMargin: '0px 0px -50% 0px' });
      targets.forEach(function (t) { io.observe(t.el); });
    }
    window.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('resize', soon);
    nav.addEventListener('click', function (e) { var a = e.target.closest('a'); if (a) set(a); });
    soon();
  }

  /* ---- chart frame: Chart/Table toggle, data table, CSV and PNG ---- */
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
  var pageSlug = slug(location.pathname.replace(/\/index\.html?$/i, '').replace(/\/+$/, '')) || 'home';
  function getChart(cv) { return (cv && window.Chart && Chart.getChart) ? (Chart.getChart(cv) || null) : null; }
  function fnameFor(el, ext) {
    var h = headingFor(el);
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
    var n = Math.max(rows.length - 1, 0);
    ci.toast('CSV downloaded · ' + n + (n === 1 ? ' row' : ' rows'));
  }
  function pngFromChart(ch, name) {
    var src = ch.canvas, out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    var x = out.getContext('2d');
    x.fillStyle = '#fefbf8'; x.fillRect(0, 0, out.width, out.height);
    x.drawImage(src, 0, 0);
    dl(out.toDataURL('image/png'), name, false);
    ci.toast('PNG downloaded');
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
  function mkBtn(label, title, fn, cls) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title;
    if (cls) b.className = cls;
    b.addEventListener('click', fn); return b;
  }

  // The strings a chart's tooltip prints for one point: the same callback,
  // the same item object Chart.js builds, so the table cannot drift from the
  // chart. Datasets the tooltip filters out are left out here too.
  function tipItem(ch, di, i) {
    var meta = ch.getDatasetMeta(di), lv = meta.controller.getLabelAndValue(i);
    return { chart: ch, label: lv.label, parsed: meta.controller.getParsed(i), raw: ch.data.datasets[di].data[i],
      formattedValue: lv.value, dataset: ch.data.datasets[di], dataIndex: i, datasetIndex: di, element: meta.data[i] };
  }
  function strOf(t) { return Array.isArray(t) ? t.join(' · ') : (t == null ? '' : String(t)); }
  function chartRows(ch) {
    var tt = (ch.options.plugins && ch.options.plugins.tooltip) || {}, cb = tt.callbacks || {};
    var stub = { chart: ch, options: tt };
    var labels = ch.data.labels || [], sets = ch.data.datasets || [];
    var cols = [], rowKeys = [], rowIdx = {}, cells = {}, parts = null;
    sets.forEach(function (d, di) {
      if (d.hidden || !ch.isDatasetVisible(di)) return;
      var col = { label: d.label || '', di: di };
      for (var i = 0; i < (d.data || []).length; i++) {
        var it;
        try { it = tipItem(ch, di, i); } catch (e) { continue; }
        if (tt.filter) { try { if (!tt.filter.call(stub, it, [it], [it])) continue; } catch (e) { /* keep */ } }
        var lab, title;
        try { lab = cb.label ? cb.label.call(stub, it) : it.formattedValue; } catch (e) { lab = it.formattedValue; }
        try { title = cb.title ? strOf(cb.title.call(stub, [it])) : ''; } catch (e) { title = ''; }
        if (lab == null || lab === '') continue;
        var key = labels.length && (it.raw == null || typeof it.raw !== 'object') ? strOf(labels[i]) : title;
        if (Array.isArray(lab) && !key) { (parts || (parts = [])).push(lab.map(String)); continue; }
        if (labels.length && title && cb.title) key = title;
        if (!key) key = strOf(it.label) || String(i + 1);
        if (!(key in rowIdx)) { rowIdx[key] = rowKeys.length; rowKeys.push(key); }
        (cells[di] || (cells[di] = {}))[key] = strOf(lab);
      }
      if (cells[di]) cols.push(col);
    });
    // A point chart whose tooltip prints a list ("name", "k: v", ...).
    if (parts && !cols.length) {
      var head = parts[0].map(function (p, k) { var m = k ? p.match(/^([^:]{1,60}):\s/) : null; return m ? m[1] : (k ? '' : null); });
      return { head: head, rows: parts.map(function (p) { return p.map(function (x, k) { return head[k] ? x.slice(head[k].length).replace(/^:\s*/, '') : x; }); }) };
    }
    // Strip a shared "Series: " prefix into the column head.
    cols.forEach(function (c) {
      var vals = rowKeys.map(function (k) { return cells[c.di][k]; }).filter(function (v) { return v != null; });
      var m = vals.length && vals[0].match(/^([^:]{1,80}):\s/);
      if (m && vals.every(function (v) { return v.indexOf(m[0]) === 0; }) && (!c.label || c.label === m[1])) {
        c.label = m[1];
        rowKeys.forEach(function (k) { if (cells[c.di][k] != null) cells[c.di][k] = cells[c.di][k].slice(m[0].length); });
      }
    });
    return {
      head: [null].concat(cols.map(function (c) { return c.label; })),
      rows: rowKeys.map(function (k) { return [k].concat(cols.map(function (c) { var v = cells[c.di][k]; return v == null ? '–' : v; })); })
    };
  }
  function fillChartTable(cv) {
    var tbl = document.getElementById(cv.id + '-table');
    var ch = getChart(cv);
    if (!tbl || !ch) return;
    var t = chartRows(ch);
    var first = cv.getAttribute('data-ci-col') || 'Label';
    var val = cv.getAttribute('data-ci-val') || 'Value';
    var h = '<caption class="ci-vh">' + ci.esc(tbl.getAttribute('data-title') || '') + '</caption><thead><tr>' +
      t.head.map(function (x, k) { return '<th scope="col"' + (k ? ' class="num"' : '') + '>' + ci.esc(k ? (x || val) : (x || first)) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      t.rows.map(function (r) {
        return '<tr>' + r.map(function (x, k) { return k ? '<td class="num">' + ci.esc(x) + '</td>' : '<th scope="row">' + ci.esc(x) + '</th>'; }).join('') + '</tr>';
      }).join('') + '</tbody>';
    if (!t.rows.length) h = '<caption class="ci-vh">' + ci.esc(tbl.getAttribute('data-title') || '') + '</caption><tbody><tr><td>No data to show.</td></tr></tbody>';
    tbl.innerHTML = h;
    overflowState(tbl.parentElement);
  }
  var pendingTables = {};
  ci.chartUpdated = function (ch) {
    var cv = ch && ch.canvas;
    if (!cv || !document.querySelector('meta[name="ci:chrome"]')) return;
    if (!cv.hasAttribute('data-ci-framed')) frameChart(cv);
    if (!cv.id || pendingTables[cv.id]) return;
    pendingTables[cv.id] = setTimeout(function () { delete pendingTables[cv.id]; fillChartTable(cv); }, 0);
  };
  function asofMirror(cv, h) {
    var src = document.getElementById(cv.getAttribute('data-ci-asof') || '');
    var card = cv.closest('.card');
    var cap = card && card.querySelector('.sec-head .cap');
    if (!src || !cap) return;
    var span = document.createElement('span');
    span.className = 'cap ci-chart__asof'; span.id = 'asof-' + cv.id;
    // A sibling, not a child: some pages rewrite their caption's text.
    cap.insertAdjacentElement('afterend', span);
    function copy() {
      var v = textOf(src);
      span.textContent = (v && v !== '–') ? ' · AS OF ' + v : '';
    }
    copy();
    new MutationObserver(copy).observe(src, { childList: true, characterData: true, subtree: true });
  }
  function frameChart(cv) {
    if (!cv || cv.hasAttribute('data-ci-framed')) return;
    var box = cv.closest('.chart-box') || cv.parentElement;
    if (!box || box.closest('header,footer,nav')) return;
    cv.setAttribute('data-ci-framed', '1');
    box.setAttribute('data-exp', '1');
    if (!cv.id) cv.id = uid('chart');
    var h = headingFor(box);
    var title = textOf(h) || 'Chart';
    var card = box.closest('.card');
    if (h && !h.id) h.id = cv.id + '-h';
    if (card && h && h.closest('.sec-head') && card.contains(h) && card.querySelectorAll('canvas').length === 1 && !card.hasAttribute('role')) {
      card.setAttribute('role', 'figure'); card.setAttribute('aria-labelledby', h.id);
    }
    var wrap = document.createElement('div');
    wrap.className = 'ci-table-wrap ci-chart__table';
    wrap.setAttribute('data-label', title + ', data table');
    wrap.hidden = true;
    var tbl = document.createElement('table');
    tbl.id = cv.id + '-table'; tbl.setAttribute('data-exp', '1'); tbl.setAttribute('data-title', title);
    wrap.appendChild(tbl);
    box.insertAdjacentElement('afterend', wrap);
    watchOverflow(wrap);
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', title + '. The data table that follows holds every value.');
    cv.setAttribute('aria-describedby', tbl.id);
    asofMirror(cv, h);

    var bar = document.createElement('div'); bar.className = 'exp ci-chart__tools';
    var seg = document.createElement('div'); seg.className = 'ci-viewseg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Show ' + title + ' as');
    var bChart = mkBtn('Chart', 'Show the chart', function () { view(false); });
    var bTable = mkBtn('Table', 'Show the values as a table', function () { view(true); });
    bChart.setAttribute('aria-pressed', 'true'); bTable.setAttribute('aria-pressed', 'false');
    seg.appendChild(bChart); seg.appendChild(bTable);
    bar.appendChild(seg);
    var tools = document.createElement('div'); tools.className = 'ci-chart__dl';
    tools.appendChild(mkBtn('PNG', 'Download this chart as a PNG image', function () { var ch = getChart(cv); if (ch) pngFromChart(ch, fnameFor(box, 'png')); }));
    tools.appendChild(mkBtn('CSV', 'Download this chart’s data as a CSV file', function () { var ch = getChart(cv); if (ch) csvFromChart(ch, fnameFor(box, 'csv')); }));
    bar.appendChild(tools);
    box.insertAdjacentElement('beforebegin', bar);
    function view(asTable) {
      bChart.setAttribute('aria-pressed', asTable ? 'false' : 'true');
      bTable.setAttribute('aria-pressed', asTable ? 'true' : 'false');
      box.classList.toggle('ci-off', asTable);
      wrap.hidden = !asTable;
      if (asTable) { fillChartTable(cv); }
      else { var ch = getChart(cv); if (ch) ch.resize(); }
    }
    if (getChart(cv)) fillChartTable(cv);
  }
  ci.frameCharts = function (rootEl) {
    (rootEl || document).querySelectorAll('main .chart-box canvas').forEach(frameChart);
  };

  /* ---- filter result count: toast when rows remain, alert when none ----
   * <... class="ci-filterbar" data-ci-count="#el"> reads the page's own
   * count line; data-ci-count-of="<selector>" counts rendered rows. */
  function filterCounts() {
    document.querySelectorAll('.ci-filterbar[data-ci-count],.ci-filterbar[data-ci-count-of]').forEach(function (bar) {
      var timer = null;
      function report() {
        clearTimeout(timer);
        timer = setTimeout(function () {
          var n = null, msg = '';
          if (bar.hasAttribute('data-ci-count-of')) {
            n = document.querySelectorAll(bar.getAttribute('data-ci-count-of')).length;
            var forms = (bar.getAttribute('data-ci-count-label') || 'result|results').split('|');
            msg = KINDS.int(n) + ' ' + (n === 1 ? forms[0] : forms[1]) + ' shown';
          } else {
            var el = document.querySelector(bar.getAttribute('data-ci-count'));
            msg = textOf(el);
            n = /^0\b|^No\b/i.test(msg) ? 0 : 1;
          }
          if (!msg) return;
          if (n === 0) ci.alert(msg || 'No results match these filters.'); else ci.toast(msg);
        }, 450);
      }
      bar.addEventListener('click', function (e) { if (e.target.closest('.seg button')) report(); });
      bar.addEventListener('change', function (e) { if (e.target.tagName === 'SELECT') report(); });
    });
  }

  function chrome() {
    if (!document.querySelector('meta[name="ci:chrome"]')) return;
    enhanceSegs(document);
    ci.frameCharts();
    ci.wrapTables();
    enhanceSort();
    subnav();
    filterCounts();
    new MutationObserver(function (records) {
      var tables = false;
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'attributes') { syncSegBtn(r.target); continue; }
        for (var j = 0; j < r.addedNodes.length; j++) {
          var n = r.addedNodes[j];
          if (n.nodeType !== 1) continue;
          enhanceSegs(n);
          if (n.tagName === 'TABLE' || n.querySelector('table')) tables = true;
          if (n.tagName === 'CANVAS' || n.querySelector('canvas')) ci.frameCharts(n.tagName === 'CANVAS' ? n.parentElement : n);
        }
      }
      if (tables) ci.wrapTables();
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState !== 'loading') chrome(); else document.addEventListener('DOMContentLoaded', chrome);

  /* ================= export: page PDF and table CSV =================
   * On pages that opt in with <meta name="ci:export">. Chart PNG and CSV
   * now live in the chart frame above, on every chart. */
  (function () {
    if (!document.querySelector('meta[name="ci:export"]')) return;
    if (window.__ciExport) return; window.__ciExport = 1;
    function placeAfter(el, bar) {
      var t = el.parentElement && el.parentElement.classList.contains('ci-table-wrap') ? el.parentElement : el;
      var nx = t.nextElementSibling;
      if (nx && nx.classList && nx.classList.contains('tnote')) t = nx;
      t.insertAdjacentElement('afterend', bar);
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
      ci.wrapTables();
      document.querySelectorAll('[data-ci-main] table,#app table,.card table').forEach(attachTable);
    }
    var printing = false;
    function addPdfBtn() {
      if (document.querySelector('.pdf-btn')) return;
      var b = mkBtn('Save PDF', 'Save or print this page as a PDF', function () { printing = true; window.print(); });
      b.className = 'pdf-btn';
      var cp = mkBtn('Copy link', 'Copy the address of this view', function () {
        var done = function () { ci.toast('Link copied'); };
        var fail = function () { ci.alert('The link could not be copied. Copy it from the address bar.'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done, fail); else fail();
      });
      cp.className = 'pdf-btn ci-copy';
      var inner = document.querySelector('.series-bar .inner');
      if (inner) { inner.appendChild(cp); inner.appendChild(b); return; }
      var header = document.querySelector('.ci-masthead');
      if (header) { var bar = document.createElement('div'); bar.className = 'pdf-bar'; bar.appendChild(b); header.insertAdjacentElement('afterend', bar); }
    }
    // The browser does not say whether the dialog saved a file, so the toast
    // confirms only what is known: the print or PDF dialog has closed.
    window.addEventListener('afterprint', function () {
      if (!printing) return;
      printing = false;
      ci.toast('Print or PDF dialog closed');
    });
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
