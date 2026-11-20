/* The Concrete Index · old-route forwarder.
 * Loaded synchronously by the stub pages at retired routes (/solicitations/,
 * /competitive/, /agency/, /vendors/, /velocity/). Sends the visitor to the
 * target in <meta name="ci:redirect">, keeping the ?query and #hash of the
 * old address so deep links survive. Same origin only. If this script does
 * not run, the page's meta refresh and its visible link do the same job
 * without the query and hash. */
(function () {
  'use strict';
  var m = document.querySelector('meta[name="ci:redirect"]');
  if (!m) return;
  var to;
  try { to = new URL(m.getAttribute('content'), location.href); } catch (e) { return; }
  if (to.origin !== location.origin) return;
  if (location.search) to.search = location.search;
  if (location.hash) to.hash = location.hash;
  location.replace(to.href);
})();
