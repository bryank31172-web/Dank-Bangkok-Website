(function(){
  "use strict";

  var BEST_NAMES=/\b(toad venom|granddaddy purple|grape gasolin(?:e)?|papaya fuel|pineapple express|mac ?1|og kush|king cherry|baby cake|grape stank|coco chanel|alien mintz?)\b/i;
  var BUD_STEPS=[
    {key:"feel",title:"How do you want to feel?",options:[
      {value:"relax",label:"Relax",icon:"ri-moon-clear-line"},
      {value:"sleep",label:"Sleep",icon:"ri-hotel-bed-line"},
      {value:"social",label:"Social",icon:"ri-group-line"},
      {value:"energy",label:"Energy",icon:"ri-flashlight-line"},
      {value:"creative",label:"Creative",icon:"ri-palette-line"}
    ]},
    {key:"experience",title:"What is your experience level?",options:[
      {value:"new",label:"New to flower",icon:"ri-seedling-line"},
      {value:"regular",label:"Regular",icon:"ri-leaf-line"},
      {value:"experienced",label:"Experienced",icon:"ri-fire-line"}
    ]},
    {key:"tier",title:"Choose your flower tier",options:[
      {value:"Midgrade",label:"Midgrade · value",icon:"ri-heart-3-line"},
      {value:"Topshelf",label:"Topshelf · premium",icon:"ri-star-line"},
      {value:"Exotics",label:"Exotics · strongest",icon:"ri-rocket-line"},
      {value:"any",label:"Surprise me",icon:"ri-sparkling-2-line"}
    ]}
  ];
  var budState={step:0,answers:{}};

  function flowerProducts(){
    if(typeof shopData!=="function" || typeof FLOWER_CATS==="undefined") return [];
    return shopData().filter(function(p){
      var stock=Number(p.stock);
      return FLOWER_CATS.indexOf(p.category)>=0 && !p._hidden && (!Number.isFinite(stock) || stock>0);
    });
  }

  function flowerPrice(p){
    try{
      if(p.priceTiers&&p.priceTiers.length){
        var tier=p.priceTiers[0]||{};
        return memberMode?(tier.member||tier.price):(tier.price||tier.member);
      }
      return memberMode?(p.member||p.price):(p.price||p.member);
    }catch(e){ return 0; }
  }

  function effectText(p){
    var effects=Array.isArray(p.effects)?p.effects.filter(Boolean):[];
    return effects.slice(0,2).join(" · ") || p.type || "Flower";
  }

  function isNewOrBest(p){
    return !!p.isNew || !!p.featured || BEST_NAMES.test(String(p.name||""));
  }

  function rankedBest(){
    return flowerProducts().sort(function(a,b){
      function rank(p){
        var real=!!p.image && String(p.image).indexOf("/api/tile")<0;
        return (p.isNew?120:0)+(p.featured?90:0)+(BEST_NAMES.test(String(p.name||""))?75:0)+(real?20:0)+(Number(p.thc)||0)/10;
      }
      return rank(b)-rank(a);
    });
  }

  function bestCard(p){
    var id=esc(String(p.id||""));
    var tier=esc(String(p.category||"Flower"));
    var thc=typeof thcTxt==="function"?thcTxt(p):esc(String(p.thcLabel||p.thc||""));
    var price=typeof money==="function"?money(flowerPrice(p)):"฿"+flowerPrice(p);
    return '<article class="lux-product">'+
      '<div class="lux-product-media" onclick="openPD(\''+id+'\')">'+
        '<span class="lux-tier">'+tier+'</span>'+(p.isNew?'<span class="lux-new">New</span>':'')+
        imgTag(p,true,true)+
      '</div>'+
      '<div class="lux-product-body">'+
        '<h3 onclick="openPD(\''+id+'\')">'+esc(p.name||"Flower")+'</h3>'+
        '<div class="lux-meta"><span>THC <b>'+thc+'</b></span><span class="lux-effect">'+esc(effectText(p))+'</span></div>'+
        '<div class="lux-product-foot"><div class="lux-price"><small>from</small>'+price+'</div>'+
        '<button class="lux-add" type="button" onclick="quickAdd(\''+id+'\')">Add <i class="ri-add-line" aria-hidden="true"></i></button></div>'+
      '</div></article>';
  }

  window.renderLuxuryBest=function(){
    var root=document.getElementById("luxBestGrid");
    if(!root) return;
    var all=rankedBest();
    var picks=all.filter(isNewOrBest);
    if(picks.length<4){
      all.forEach(function(p){ if(picks.indexOf(p)<0) picks.push(p); });
    }
    picks=picks.slice(0,4);
    root.innerHTML=picks.length?picks.map(bestCard).join(""):'<div class="lux-best-empty">Fresh flower drops are being updated. Browse the live flower menu below.</div>';
  };

  window.showFlowerShop=function(){
    try{
      activeCat="Flower";
      var search=document.getElementById("searchInput"); if(search) search.value="";
      var type=document.getElementById("typeFilter"); if(type) type.value="";
      buildChips(); render();
    }catch(e){}
    var target=document.getElementById("featuredFlowers")||document.getElementById("menu");
    if(target) target.scrollIntoView({behavior:"smooth",block:"start"});
  };

  window.focusFlowerSearch=function(){
    var search=document.getElementById("searchInput");
    if(!search) return;
    window.scrollTo({top:0,behavior:"smooth"});
    setTimeout(function(){ search.focus(); search.select(); },320);
  };

  function modal(){ return document.getElementById("infoCard"); }

  window.openBudtender=function(){
    budState={step:0,answers:{}};
    showModal("#infoModal");
    renderBudStep();
  };

  function progressHTML(step){
    return '<div class="bud-progress" aria-label="Step '+(step+1)+' of 3">'+[0,1,2].map(function(i){ return '<i class="'+(i<=step?'on':'')+'"></i>'; }).join("")+'</div>';
  }

  function renderBudStep(){
    var root=modal(); if(!root) return;
    var step=BUD_STEPS[budState.step];
    var selected=budState.answers[step.key];
    root.innerHTML='<div class="bud-shell">'+
      '<div class="bud-head"><div><div class="bud-kicker">Digital Budtender · '+(budState.step+1)+' of 3</div><h2>Find your flower</h2><p>Three quick choices. Flower recommendations only.</p></div><button class="bud-close" type="button" aria-label="Close" onclick="closeAll()"><i class="ri-close-line" aria-hidden="true"></i></button></div>'+
      progressHTML(budState.step)+'<div class="bud-question">'+step.title+'</div>'+
      '<div class="bud-options">'+step.options.map(function(o){ return '<button type="button" class="bud-option '+(selected===o.value?'selected':'')+'" onclick="budPick(\''+o.value+'\')"><i class="'+o.icon+'" aria-hidden="true"></i><span>'+o.label+'</span></button>'; }).join("")+'</div>'+
      '<div class="bud-actions"><button class="bud-skip" type="button" onclick="skipBudtender()">Skip and browse</button><button class="bud-next" type="button" onclick="budNext()" '+(selected?'':'disabled')+'>'+(budState.step===2?'See my matches':'Continue')+' <i class="ri-arrow-right-line" aria-hidden="true"></i></button></div>'+
    '</div>';
  }

  window.budPick=function(value){
    var step=BUD_STEPS[budState.step];
    budState.answers[step.key]=value;
    renderBudStep();
  };

  window.budNext=function(){
    var step=BUD_STEPS[budState.step];
    if(!budState.answers[step.key]) return;
    if(budState.step<2){ budState.step+=1; renderBudStep(); }
    else renderBudResults();
  };

  function matchScore(p){
    var a=budState.answers;
    var text=((p.effects||[]).join(" ")+" "+(p.flavors||[]).join(" ")+" "+(p.type||"")+" "+(p.description||"")).toLowerCase();
    var maps={
      relax:["relax","calm","indica","body"],
      sleep:["sleep","sleepy","sedat","indica","night"],
      social:["happy","social","uplift","talkative","hybrid"],
      energy:["energy","energetic","focus","sativa","day"],
      creative:["creative","focus","uplift","sativa"]
    };
    var score=0;
    (maps[a.feel]||[]).forEach(function(word){ if(text.indexOf(word)>=0) score+=18; });
    if(a.tier&&a.tier!=="any"&&p.category===a.tier) score+=45;
    var thc=Number(p.thc)||parseFloat(String(p.thcLabel||""))||0;
    if(a.experience==="new") score+=thc&&thc<=24?35:-15;
    if(a.experience==="regular") score+=thc>=22&&thc<=29?28:0;
    if(a.experience==="experienced") score+=thc>=28?35:0;
    if(isNewOrBest(p)) score+=14;
    if(p.image) score+=4;
    return score;
  }

  function resultCard(p){
    var id=esc(String(p.id||""));
    var thc=typeof thcTxt==="function"?thcTxt(p):esc(String(p.thcLabel||p.thc||""));
    var price=typeof money==="function"?money(flowerPrice(p)):"฿"+flowerPrice(p);
    return '<article class="bud-result"><div class="bud-result-media" onclick="closeAll();openPD(\''+id+'\')">'+imgTag(p,true,true)+'</div><div>'+ 
      '<div class="bud-kicker">'+esc(p.category||"Flower")+'</div><h3 onclick="closeAll();openPD(\''+id+'\')">'+esc(p.name||"Flower")+'</h3>'+ 
      '<div class="bud-result-meta">THC '+thc+' · '+esc(effectText(p))+'</div>'+ 
      '<div class="bud-result-foot"><span class="bud-result-price">from '+price+'</span><button class="bud-result-add" type="button" onclick="quickAdd(\''+id+'\')">Add <i class="ri-add-line" aria-hidden="true"></i></button></div></div></article>';
  }

  function renderBudResults(){
    var root=modal(); if(!root) return;
    var picks=flowerProducts().sort(function(a,b){ return matchScore(b)-matchScore(a); }).slice(0,3);
    root.innerHTML='<div class="bud-shell">'+
      '<div class="bud-head"><div><div class="bud-kicker">Your flower matches</div><h2>Picked for you</h2><p>Based on how you want to feel, your experience and preferred tier.</p></div><button class="bud-close" type="button" aria-label="Close" onclick="closeAll()"><i class="ri-close-line" aria-hidden="true"></i></button></div>'+ 
      '<div class="bud-results">'+(picks.length?picks.map(resultCard).join(""):'<div class="lux-best-empty">No in-stock flower matches right now. Browse the live flower shelf instead.</div>')+'</div>'+ 
      '<div class="bud-actions"><button class="bud-skip" type="button" onclick="openBudtender()"><i class="ri-refresh-line" aria-hidden="true"></i> Start again</button><button class="bud-next" type="button" onclick="skipBudtender()">Browse all flower <i class="ri-arrow-right-line" aria-hidden="true"></i></button></div>'+ 
    '</div>';
  }

  window.skipBudtender=function(){ closeAll(); setTimeout(window.showFlowerShop,80); };

  function syncMemberStrip(){
    var strip=document.getElementById("luxMemberStrip");
    if(!strip) return;
    if(typeof isMember==="function"&&isMember()){
      strip.innerHTML='<span><i class="ri-vip-crown-line" aria-hidden="true"></i> Member pricing is active</span><b>View card <i class="ri-arrow-right-line" aria-hidden="true"></i></b>';
    }
  }

  function initLuxury(){
    window.renderLuxuryBest();
    syncMemberStrip();
    setTimeout(window.renderLuxuryBest,900);
    setTimeout(window.renderLuxuryBest,2200);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",initLuxury);
  else initLuxury();
})();
