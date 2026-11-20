/* The Concrete Index: live figure capture for parity checks.
 *
 * Paste into the browser console on any page after it has finished loading
 * (or run it with page.evaluate). It returns a JSON string:
 *
 *   { url, captured_at, figures: { "<selector path>": "<visible text>" },
 *     charts: { "<canvas path>": { labels, datasets:[{label,data}] } } }
 *
 * figures holds every visible text node that contains a digit, outside the
 * shared masthead, rail, menu, and footer. The key is anchored on the nearest
 * ancestor with an id ("#kpi-awarded > span:nth-of-type(2)"), so it survives
 * markup changes around that ancestor; elements with no id ancestor fall back
 * to a path from <body>. A node index is appended when one element holds
 * several numeric text nodes. charts holds the data behind every Chart.js
 * canvas, so values drawn on a canvas are compared too.
 *
 * Run it on the old and the new build at the same moment and diff the two
 * outputs: any key whose text differs is a parity failure.
 */
(function () {
  'use strict';
  var SKIP = 'script,style,noscript,template,header,footer,nav,.ci-masthead,.ci-rail,.ci-menu,.ci-footer,.ci-skip';

  function visible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function step(el) {
    var tag = el.tagName.toLowerCase();
    var parent = el.parentElement;
    if (!parent) return tag;
    var same = 0, idx = 0;
    for (var c = parent.firstElementChild; c; c = c.nextElementSibling) {
      if (c.tagName === el.tagName) { same++; if (c === el) idx = same; }
    }
    return same > 1 ? tag + ':nth-of-type(' + idx + ')' : tag;
  }
  function path(el) {
    var parts = [];
    for (var e = el; e && e !== document.body; e = e.parentElement) {
      if (e.id) { parts.unshift('#' + e.id); return parts.join(' > '); }
      parts.unshift(step(e));
    }
    parts.unshift('body');
    return parts.join(' > ');
  }

  var figures = {};
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      if (!/\d/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      var p = n.parentElement;
      if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      return visible(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  var perEl = new Map();
  for (var n = walker.nextNode(); n; n = walker.nextNode()) {
    var p = n.parentElement;
    var k = path(p);
    var i = (perEl.get(p) || 0) + 1;
    perEl.set(p, i);
    if (i > 1) k += ' #text' + i;
    figures[k] = n.nodeValue.replace(/\s+/g, ' ').trim();
  }

  var charts = {};
  if (window.Chart && Chart.getChart) {
    document.querySelectorAll('canvas').forEach(function (cv) {
      var ch = Chart.getChart(cv);
      if (!ch) return;
      charts[path(cv)] = {
        type: ch.config.type,
        labels: (ch.data.labels || []).map(String),
        datasets: (ch.data.datasets || []).map(function (d) {
          return { label: d.label == null ? null : String(d.label), data: d.data };
        })
      };
    });
  }

  return JSON.stringify({
    url: location.pathname + location.search + location.hash,
    captured_at: new Date().toISOString(),
    figures: figures,
    charts: charts
  }, null, 1);
})();
