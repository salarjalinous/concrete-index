// The page images (headshot, photo band) load after parse, so the browser's
// initial #methodology jump lands short; and scroll-behavior:smooth makes the
// programmatic jump async and miss after the reflow. Force an instant jump once
// everything is loaded (and on hashchange), respecting the sticky-header offset.
(function(){
  function go(){
    if(location.hash !== '#methodology') return;
    var e = document.getElementById('methodology');
    if(!e) return;
    var html = document.documentElement, prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    e.scrollIntoView();
    setTimeout(function(){ html.style.scrollBehavior = prev; }, 60);
  }
  window.addEventListener('load', go);
  window.addEventListener('hashchange', go);
})();
