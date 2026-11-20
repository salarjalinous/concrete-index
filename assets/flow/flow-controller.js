/* The Concrete Index · money-flow controller (PRD 7.2, 12.3).
 *
 *   var flow = CIFlow.mount(figureEl, { fmt: ci.fmt, reduced: bool })
 *   flow.render(model)    lay out for this viewport and update the markup only
 *                         where it differs from what is in the page
 *
 * Wires the pause button (aria-pressed, first in the figure's tab order), the
 * agency split (hover or focus on fine pointers, the toggle everywhere), Esc on
 * open definitions, and the particle loop: DPR capped at 2, stopped when the
 * figure is under 10 percent visible or the tab is hidden, 30 fps and a cap of
 * 90 dots below 600px or on 4 cores or fewer. Under prefers-reduced-motion the
 * canvas is never created and no frame runs. ?bench=1 logs p50/p95/max of
 * update+draw over 600 frames.
 */
(function (root) {
  'use strict';
  var L = root.CIFlowLayout, S = root.CIFlowSVG, P = root.CIFlowParticles;

  function isMobile() {
    var cores = navigator.hardwareConcurrency || 8;
    return window.innerWidth < 600 || cores <= 4;
  }

  function mount(fig, opts) {
    var fmt = opts.fmt, reduced = !!opts.reduced;
    var model = null, lay = null, canvas = null, parts = null, raf = 0, last = 0;
    var paused = false, visible = true, shown = !document.hidden, bench = null;
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (/[?&]bench=1\b/.test(location.search)) bench = { t: [], n: 600 };

    function q(sel) { return fig.querySelector(sel); }

    /* ---------------- markup ---------------- */
    function geometry(m) {
      var mobile = isMobile();
      return L.layout(m.lanes.map(function (l) { return { id: l.id, value: l.missing ? null : l.value }; }),
        { viewportW: window.innerWidth, mobile: mobile });
    }

    function render(m) {
      model = m;
      var next = geometry(m), html = S.figure(m, next, fmt);
      lay = next;
      if (fig.getAttribute('data-sig') !== sig(html)) {
        var active = document.activeElement, keep = active && fig.contains(active) ? selectorOf(active) : null;
        var tableOpen = q('.flow__table') && q('.flow__table').open;
        fig.innerHTML = html;
        fig.setAttribute('data-sig', sig(html));
        if (tableOpen) q('.flow__table').open = true;
        if (keep) { var el = fig.querySelector(keep); if (el) el.focus(); }
      }
      wire();
      if (canvas) placeParticles();
    }

    var sig = S.sig;
    function selectorOf(el) {
      if (el.id) return '#' + el.id;
      var lane = el.closest('.flow-lane');
      var cls = el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase();
      if (el.tagName === 'SUMMARY') cls = (el.parentElement.className ? '.' + el.parentElement.className.split(' ')[0] : 'details') + ' > summary';
      return lane ? '#' + lane.id + ' ' + cls : cls;
    }

    /* ---------------- controls ---------------- */
    function wire() {
      var btn = q('.flow__pause');
      if (btn) {
        btn.hidden = false;
        if (reduced) {
          btn.setAttribute('aria-pressed', 'true');
          btn.setAttribute('aria-disabled', 'true');
          btn.setAttribute('aria-describedby', 'flow-rm');
          btn.querySelector('.flow__pause-label').textContent = 'Play animation';
          if (!q('#flow-rm')) btn.insertAdjacentHTML('afterend', '<span class="ci-vh" id="flow-rm">Animation is off because your device asks for reduced motion.</span>');
        } else {
          setPausedUI(btn);
        }
      }
      fig.querySelectorAll('.flow-lane__split').forEach(function (b) { b.hidden = false; });
    }

    function setPausedUI(btn) {
      btn = btn || q('.flow__pause');
      if (!btn) return;
      btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
      btn.classList.toggle('is-paused', paused);
      btn.querySelector('.flow__pause-label').textContent = paused ? 'Play animation' : 'Pause animation';
    }

    fig.addEventListener('click', function (e) {
      var btn = e.target.closest('.flow__pause');
      if (btn) {
        if (reduced) return;
        paused = !paused;
        setPausedUI(btn);
        schedule();
        return;
      }
      var sp = e.target.closest('.flow-lane__split');
      if (sp) {
        var on = sp.getAttribute('aria-pressed') !== 'true';
        sp.setAttribute('aria-pressed', on ? 'true' : 'false');
        showSplit(sp.closest('.flow-lane'), on, true);
      }
    });

    /* Split in place on hover (fine pointers) or keyboard focus within the
       lane; the toggle keeps it open on touch. */
    function showSplit(lane, on, pinned) {
      if (!lane) return;
      var panel = lane.querySelector('.flow-split');
      if (!panel) return;
      var btn = lane.querySelector('.flow-lane__split');
      var isPinned = btn && btn.getAttribute('aria-pressed') === 'true';
      if (!on && isPinned && !pinned) return;
      lane.classList.toggle('is-split', on);
      panel.hidden = !on;
    }
    var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (fine) {
      fig.addEventListener('mouseover', function (e) { var l = e.target.closest('.flow-lane'); if (l && !l.contains(e.relatedTarget)) showSplit(l, true); });
      fig.addEventListener('mouseout', function (e) { var l = e.target.closest('.flow-lane'); if (l && !l.contains(e.relatedTarget)) showSplit(l, false); });
    }
    fig.addEventListener('focusin', function (e) { var l = e.target.closest('.flow-lane'); if (l && e.target.matches(':focus-visible')) showSplit(l, true); });
    fig.addEventListener('focusout', function (e) { var l = e.target.closest('.flow-lane'); if (l && !l.contains(e.relatedTarget)) showSplit(l, false); });

    /* Esc closes an open definition (or a pinned split) and returns focus. */
    fig.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var d = e.target.closest('details.flow-def[open]');
      if (d) { d.open = false; d.querySelector('summary').focus(); e.preventDefault(); return; }
      var lane = e.target.closest('.flow-lane.is-split');
      if (lane) {
        var b = lane.querySelector('.flow-lane__split');
        if (b) b.setAttribute('aria-pressed', 'false');
        showSplit(lane, false, true);
      }
    });
    /* One definition open at a time. */
    fig.addEventListener('toggle', function (e) {
      if (!e.target.matches || !e.target.matches('details.flow-def') || !e.target.open) return;
      fig.querySelectorAll('details.flow-def[open]').forEach(function (d) { if (d !== e.target) d.open = false; });
    }, true);

    /* ---------------- particles ---------------- */
    function css(name, dflt) { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || dflt; }

    function startMotion() {
      if (reduced || canvas || !P) return;
      var lanesEl = q('.flow__lanes');
      if (!lanesEl) return;
      canvas = document.createElement('canvas');
      canvas.className = 'flow__canvas';
      canvas.setAttribute('aria-hidden', 'true');
      parts = P.create(canvas, { speed: isMobile() ? 30 : 36, ink: css('--ink', '#201611'), paper: css('--paper', '#f7f3ef') });
      placeParticles();
      fig.classList.add('is-animating');
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) { visible = es[0].intersectionRatio >= 0.1; schedule(); }, { threshold: [0, 0.1, 0.5, 1] }).observe(fig);
      }
      document.addEventListener('visibilitychange', function () { shown = !document.hidden; schedule(); });
      schedule();
    }

    function stopMotion() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (canvas) { canvas.remove(); canvas = null; parts = null; }
      fig.classList.remove('is-animating');
    }

    function placeParticles() {
      var lanesEl = q('.flow__lanes');
      if (!lanesEl || !parts) return;
      if (canvas.parentNode !== lanesEl) lanesEl.appendChild(canvas);
      var box = lanesEl.getBoundingClientRect();
      var geo = [];
      lay.lanes.forEach(function (g, i) {
        var svg = fig.querySelector('#lane-' + g.id + ' .flow-band');
        if (!svg || g.missing) return;
        var r = svg.getBoundingClientRect(), seeds = L.dotSeeds(i, g.dots);
        geo.push({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: g.h, n: g.dots, fx: seeds.fx, fy: seeds.fy, thin: g.h < 8 });
      });
      parts.size(box.width, box.height);
      parts.setLanes(geo);
      parts.draw();
      fig.setAttribute('data-dots-drawn', String(parts.drawn()));
    }

    function schedule() {
      var run = canvas && !paused && visible && shown;
      if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    var minGap = function () { return isMobile() ? 1000 / 30 - 2 : 0; };
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (last && t - last < minGap()) return;
      var dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
      last = t;
      var t0 = performance.now();
      parts.step(dt);
      parts.draw();
      if (bench) {
        bench.t.push(performance.now() - t0);
        if (bench.t.length === bench.n) {
          var a = bench.t.slice().sort(function (x, y) { return x - y; });
          var pick = function (p) { return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
          root.__flowBench = { frames: a.length, p50: pick(0.5), p95: pick(0.95), max: a[a.length - 1], dots: parts.drawn() };
          console.log('flow bench', JSON.stringify(root.__flowBench));
          bench = null;
        }
      }
    }

    if (mq && mq.addEventListener) {
      mq.addEventListener('change', function () {
        reduced = mq.matches;
        if (reduced) { stopMotion(); wire(); }
      });
    }

    var rt = 0, lastW = window.innerWidth;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (window.innerWidth === lastW) { if (canvas) placeParticles(); return; }
        lastW = window.innerWidth;
        if (model) render(model);
      }, 150);
    });

    return { render: render, start: startMotion, stop: stopMotion, layout: function () { return lay; },
      state: function () { return { paused: paused, visible: visible, shown: shown, running: !!raf, canvas: !!canvas }; } };
  }

  root.CIFlow = { mount: mount };
})(typeof window !== 'undefined' ? window : this);
