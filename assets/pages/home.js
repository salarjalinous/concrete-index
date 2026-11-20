(function(){
  var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function fmtMonth(ym){ if(!ym) return ''; var p=String(ym).split('-'); var mo=MONTHS[(+p[1])-1]; return mo?(mo+' '+p[0]):''; }
  function fmtMoney(n){ n=+n; if(!isFinite(n)) return '–'; if(n>=1e9) return '$'+(n/1e9).toFixed(1)+'B'; if(n>=1e6) return '$'+Math.round(n/1e6)+'M'; if(n>=1e3) return '$'+Math.round(n/1e3)+'K'; return '$'+Math.round(n); }
  function fmtInt(n){ n=+n; if(!isFinite(n)) return '–'; return Math.round(n).toLocaleString('en-US'); }
  function setText(id,t){ var el=document.getElementById(id); if(el) el.textContent=t; }
  function showIndex(val, asof){
    setText('lp-index', Number(val).toFixed(1));
    setText('lp-index-cap','A single number for how much new construction work the City is putting out, measured against its 2019 pace. Renewals and $500M megaprojects are stripped out so the reading tracks fresh demand.'+(asof?(' As of '+asof+'.'):''));
    var sb=document.getElementById('series-asof'); if(sb&&asof) sb.textContent=asof.toUpperCase();
  }
  function indexNeutral(){ setText('lp-index-cap','A single number for how much new construction work the City is putting out, measured against its 2019 pace. Renewals and $500M megaprojects are stripped out so the reading tracks fresh demand.'); }
  function fillAdjust(pc){
    var nom = pc.index_level, adj = pc.adjusted_index_level;
    if(nom==null || adj==null) return;
    nom = Number(nom); adj = Number(adj);
    if(!isFinite(nom) || !isFinite(adj)) return;
    setText('adj-v-nom', nom.toFixed(1));
    setText('adj-v-adj', adj.toFixed(1));
    // bar widths scaled to the larger value so the wedge is legible
    var max = Math.max(nom, adj, 1);
    var bn = document.getElementById('adj-bar-nom');
    var ba = document.getElementById('adj-bar-adj');
    if(bn) bn.style.width = (nom/max*100).toFixed(1) + '%';
    if(ba) ba.style.width = (adj/max*100).toFixed(1) + '%';
    var gap = nom - adj;
    var gl = document.getElementById('adj-gap-line');
    if(gl) gl.innerHTML = 'Cost-adjusted Concrete Index, 2019 = 100. Cost accounts for <b>' + gap.toFixed(1) + '</b> index points of the headline.';
  }
  function fillStats(g){
    if(!g) return;
    if(g.committed!=null) setText('st-committed', fmtMoney(g.committed));
    if(g.awarded!=null) setText('st-awarded', fmtMoney(g.awarded));
    if(g.open_solicitations!=null) setText('st-sol', fmtInt(g.open_solicitations));
    if(g.contractors!=null) setText('st-vendors', fmtInt(g.contractors));
  }
  // One small same-origin read drives the whole front door.
  fetch('/data/precomputed.json',{cache:'no-store'}).then(function(r){return r.json();}).then(function(pc){
    var asof = fmtMonth(pc.index_month) || (pc.meta&&pc.meta.generated?pc.meta.generated.slice(0,10):'');
    var g = pc.glimpse || {};
    if(g.awarded==null && pc.awarded_ttm && pc.awarded_ttm.total!=null) g.awarded=pc.awarded_ttm.total;
    fillStats(g);
    fillAdjust(pc);
    if(pc.index_level!=null){ showIndex(pc.index_level, asof); return; }
    throw new Error('no index_level');
  }).catch(function(){
    var gl=document.getElementById('adj-gap-line');
    if(gl) gl.textContent='Cost-adjusted Concrete Index, 2019 = 100. See the full comparison on the “Analysis” page.';
    computeLive().then(function(o){ showIndex(o.value, fmtMonth(o.month)); }).catch(indexNeutral);
  });

  // The nightly file carries a rolling-365-day award total. The site's trailing
  // twelve months is twelve FULLY-ELAPSED months, so the awarded stat is
  // recomputed live on that window and overwrites the precomputed value once it
  // lands. The precomputed number paints first and stands if this pull fails, so
  // first paint is unaffected and one slow API call cannot blank the stat.
  awardedCompleteMonths().then(function(total){
    setText('st-awarded', fmtMoney(total));
  }).catch(function(){ /* keep the precomputed figure */ });

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
      return total;
    });
  }

  // Fallback: compute the index live from the City Record, identical to the Analysis page.
  function computeLive(){
    var API='https://data.cityofnewyork.us/resource/qyyg-4tf5.json', TOKEN='3TAzQQPiSG2T4WGWfYYUxxqfJ', MEGA=500e6;
    var isCont=function(m){ return /renewal|extension/i.test(m||''); };
    var byPin=new Map(), off=0, PAGE=50000;
    var where="starts_with(category_description,'Construction') AND contract_amount>0 AND contract_amount<"+MEGA;
    function page(){
      var u=API+'?'+new URLSearchParams({'$select':'pin,contract_amount,start_date,selection_method_description','$where':where,'$order':'pin','$limit':String(PAGE),'$offset':String(off)});
      return fetch(u,{headers:{'X-App-Token':'3TAzQQPiSG2T4WGWfYYUxxqfJ'}}).then(function(r){ if(!r.ok) throw new Error('api'); return r.json(); }).then(function(b){
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
      return { value:100*Math.sqrt((tV[last]/baseV)*(tC[last]/baseC)), month:tM[last] };
    });
  }
})();
