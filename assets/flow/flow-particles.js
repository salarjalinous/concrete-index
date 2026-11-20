/* The Concrete Index · money-flow particles (PRD 7.2, 12.3). One canvas over
 * the static drawing draws only the dots. Every dot moves left to right at one
 * constant speed in CSS px per second (speed encodes nothing) and wraps
 * inside its own lane. State lives in one preallocated Float32Array; the frame
 * loop allocates nothing.
 *
 *   var p = CIFlowParticles.create(canvas)
 *   p.setLanes([{ x, y, w, h, n, fx, fy, thin }])   geometry in CSS px
 *   p.step(dtSeconds); p.draw()
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CIFlowParticles = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var STRIDE = 3;            // x (CSS px from lane start), lane index, y (CSS px from lane top)
  var MAX = 256;             // above the 240 desktop cap

  function create(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d', { alpha: true });
    var buf = new Float32Array(MAX * STRIDE);
    var lanes = [], count = 0, dpr = 1, cw = 0, ch = 0;
    var speed = opts.speed || 36;                         // CSS px per second, every lane
    var colInk = opts.ink || '#201611', colPaper = opts.paper || '#f7f3ef';

    function size(w, h) {
      dpr = Math.min(window.devicePixelRatio || 1, 2);   // backing store capped at 2x
      cw = w; ch = h;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.setProperty('width', w + 'px');
      canvas.style.setProperty('height', h + 'px');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function setLanes(ls) {
      lanes = ls; count = 0;
      for (var i = 0; i < ls.length; i++) {
        var L = ls[i], r = L.thin ? 2 : 1.75;
        L.r = r;
        for (var j = 0; j < L.n && count < MAX; j++) {
          var o = count * STRIDE;
          buf[o] = L.fx[j] * L.w;
          buf[o + 1] = i;
          buf[o + 2] = L.thin ? L.h / 2 : r + L.fy[j] * (L.h - 2 * r);
          count++;
        }
      }
    }

    function step(dt) {
      var d = speed * dt;
      for (var k = 0; k < count; k++) {
        var o = k * STRIDE, L = lanes[buf[o + 1]];
        var x = buf[o] + d;
        if (x >= L.w) x -= L.w;
        buf[o] = x;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, cw, ch);
      var cur = -1;
      for (var k = 0; k < count; k++) {
        var o = k * STRIDE, li = buf[o + 1];
        if (li !== cur) {
          if (cur >= 0) ctx.fill();
          cur = li;
          ctx.fillStyle = lanes[li].thin ? colInk : colPaper;
          ctx.beginPath();
        }
        var L = lanes[li], x = L.x + buf[o], y = L.y + buf[o + 2];
        ctx.moveTo(x + L.r, y);
        ctx.arc(x, y, L.r, 0, 6.2832);
      }
      if (cur >= 0) ctx.fill();
    }

    function drawn() { return count; }
    return { size: size, setLanes: setLanes, step: step, draw: draw, drawn: drawn, speed: speed };
  }

  return { create: create, MAX: MAX };
}));
