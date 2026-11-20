/* The Concrete Index · chart grammar (PRD 6.10), loaded after the vendored
 * Chart.js and before the page module on chart pages only.
 *
 * Adjacent series colors do not reach 3:1 against each other, so series must
 * be told apart without hue. This plugin adds the non-hue cues to whatever a
 * page draws, and changes nothing about the data:
 *   - line series 2, 3, 4 get dash patterns [6,4], [2,3], dash-dot, unless
 *     the page already set borderDash;
 *   - bars get a 1px surface-colored edge, so adjacent bars and stacked
 *     segments are separated by a 2px gap, unless the page set a border.
 * Tooltip defaults: surface ground with an ink hairline, values in the
 * page's own formatter. Page modules may still override any of this.
 */
(function () {
  'use strict';
  if (!window.Chart) return;
  var INK = '#201611', SURFACE = '#fefbf8', MUTED = '#6b5e56';
  var DASH = [null, [6, 4], [2, 3], [8, 3, 2, 3]];

  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: SURFACE, titleColor: INK, bodyColor: MUTED,
    borderColor: INK, borderWidth: 1, cornerRadius: 0
  });
  Chart.defaults.font.family = "'IBM Plex Mono',monospace";
  Chart.defaults.font.size = 12;

  // Ticks are 12px minimum (6.2). Where a page fixed maxTicksLimit for the
  // old 10px ticks, Chart.js uses that limit instead of its own fit test, so
  // the larger labels can collide. Cap the limit at what fits the width.
  function capTicks(chart) {
    var scales = chart.config.options && chart.config.options.scales;
    var labels = chart.config.data && chart.config.data.labels;
    if (!scales || !labels || !labels.length || !chart.ctx || !chart.width) return;
    Object.keys(scales).forEach(function (id) {
      var s = scales[id];
      if (!s || !s.ticks || (s.axis || id.charAt(0)) !== 'x') return;
      if (s._ciMaxTicks === undefined) s._ciMaxTicks = s.ticks.maxTicksLimit;
      var limit = s._ciMaxTicks;
      if (!limit || s.ticks.autoSkip === false || s.ticks.maxRotation !== 0) return;
      var f = Chart.helpers.toFont(Object.assign({}, Chart.defaults.font, s.ticks.font || {}));
      chart.ctx.save(); chart.ctx.font = f.string;
      var w = 0;
      for (var i = 0; i < labels.length; i++) w = Math.max(w, chart.ctx.measureText(String(labels[i])).width);
      chart.ctx.restore();
      var fit = Math.max(2, Math.floor((chart.width - 48) / (w + 12)));
      s.ticks.maxTicksLimit = Math.min(limit, fit);
    });
  }

  Chart.register({
    id: 'ciGrammar',
    beforeUpdate: function (chart) {
      capTicks(chart);
      var base = chart.config.type;
      var sets = (chart.config.data && chart.config.data.datasets) || [];
      var lineIdx = 0;
      for (var i = 0; i < sets.length; i++) {
        var d = sets[i], t = d.type || base;
        if (t === 'line') {
          if (d.borderDash === undefined && lineIdx > 0 && lineIdx < DASH.length) d.borderDash = DASH[lineIdx];
          lineIdx++;
        } else if (t === 'bar') {
          if (d.borderWidth === undefined && d.borderColor === undefined) {
            d.borderColor = SURFACE;
            d.borderWidth = 1;
          }
        }
      }
    }
  });

  // Charts drawn before IBM Plex Mono finished loading measured their tick
  // labels in the fallback face, so auto-skip let wider labels collide.
  // Re-run layout once the fonts are in. Layout only: data is untouched.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      Object.values(Chart.instances || {}).forEach(function (ch) { ch.update('none'); });
    });
  }
})();
