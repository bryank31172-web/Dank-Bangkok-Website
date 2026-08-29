(function(){
  "use strict";

  var deferredPrompt = null;
  var isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isMobile = window.matchMedia("(max-width: 820px)").matches || /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  var DISMISS_KEY = "dank_pwa_install_dismissed";
  var SHOW_DELAY = 10000;
  var pollTimer = null;

  document.documentElement.classList.toggle("pwa-standalone", isStandalone);

  function dismissed(){
    try{return localStorage.getItem(DISMISS_KEY) === "1";}catch(e){return false;}
  }

  function dismissForever(){
    try{localStorage.setItem(DISMISS_KEY,"1");}catch(e){}
    removeInstallBanner();
  }

  function cartHasItems(){
    var keys = ["cart","dank_cart"];
    for(var i=0;i<keys.length;i++){
      try{
        var raw = localStorage.getItem(keys[i]);
        if(!raw) continue;
        var data = JSON.parse(raw);
        if(Array.isArray(data) && data.length) return true;
      }catch(e){}
    }
    return false;
  }

  function makeToast(message, actionLabel, action){
    var old = document.getElementById("pwa-toast");
    if(old) old.remove();
    var box = document.createElement("div");
    box.id = "pwa-toast";
    box.setAttribute("role","status");
    box.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:10001;width:min(92vw,520px);display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:14px;background:#101a12;color:#e8f5ec;border:1px solid #294634;box-shadow:0 16px 40px rgba(0,0,0,.45);font:600 14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif";
    var text = document.createElement("span");
    text.textContent = message;
    text.style.flex = "1";
    box.appendChild(text);
    if(actionLabel && action){
      var actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.textContent = actionLabel;
      actionBtn.style.cssText = "border:0;border-radius:10px;padding:9px 12px;background:#88b997;color:#102318;font-weight:800;cursor:pointer";
      actionBtn.addEventListener("click",function(){action();box.remove();});
      box.appendChild(actionBtn);
    }
    document.body.appendChild(box);
    setTimeout(function(){if(box.isConnected) box.remove();},9000);
  }

  function showIOSInstructions(){
    var existing = document.getElementById("pwa-ios-sheet");
    if(existing){existing.remove();return;}
    var sheet = document.createElement("div");
    sheet.id = "pwa-ios-sheet";
    sheet.setAttribute("role","dialog");
    sheet.setAttribute("aria-modal","true");
    sheet.setAttribute("aria-label","Install DANK App");
    sheet.style.cssText = "position:fixed;inset:0;z-index:10002;display:flex;align-items:flex-end;justify-content:center;background:rgba(2,5,3,.68);padding:14px";
    sheet.innerHTML = '<div style="width:min(100%,520px);border-radius:22px;background:#101a12;color:#e8f5ec;border:1px solid #294634;box-shadow:0 24px 70px rgba(0,0,0,.55);padding:20px;font:500 15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px"><strong style="font-size:20px">Install DANK App</strong><button id="pwa-ios-close" type="button" aria-label="Close" style="width:44px;height:44px;border:1px solid #294634;border-radius:12px;background:#16241a;color:#e8f5ec;font-size:20px">×</button></div><p style="margin:0 0 14px;color:#b7c9bc">On iPhone or iPad:</p><ol style="margin:0;padding-left:22px;color:#e8f5ec"><li style="margin-bottom:8px">Tap the <strong>Share</strong> button in Safari.</li><li style="margin-bottom:8px">Tap <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>.</li></ol><p style="margin:14px 0 0;color:#8fae9a;font-size:13px">The app will open full-screen from your Home Screen.</p></div>';
    sheet.addEventListener("click",function(event){if(event.target===sheet)sheet.remove();});
    document.body.appendChild(sheet);
    document.getElementById("pwa-ios-close").addEventListener("click",function(){sheet.remove();});
  }

  function installApp(){
    if(isStandalone) return;
    if(deferredPrompt){
      deferredPrompt.prompt();
      deferredPrompt.userChoice.catch(function(){}).finally(function(){
        deferredPrompt = null;
        removeInstallBanner();
      });
      return;
    }
    if(isIOS){showIOSInstructions();return;}
    makeToast("Install is not ready yet. Open this site in Chrome or Safari and try again.");
  }

  function injectStyles(){
    if(document.getElementById("pwa-install-styles")) return;
    var style = document.createElement("style");
    style.id = "pwa-install-styles";
    style.textContent = "@keyframes dankPwaSlide{from{opacity:0;transform:translate(-50%,28px)}to{opacity:1;transform:translate(-50%,0)}}@keyframes dankPwaBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}#pwa-install-banner{animation:dankPwaSlide .38s cubic-bezier(.2,.8,.3,1) both}#pwa-install-banner .pwa-install-icon{animation:dankPwaBounce 1.7s ease-in-out infinite}@media(prefers-reduced-motion:reduce){#pwa-install-banner,#pwa-install-banner .pwa-install-icon{animation:none!important}}";
    document.head.appendChild(style);
  }

  function removeInstallBanner(){
    var banner = document.getElementById("pwa-install-banner");
    if(banner) banner.remove();
  }

  function showInstallBanner(){
    if(!isMobile || isStandalone || dismissed() || document.getElementById("pwa-install-banner")) return;
    injectStyles();
    var banner = document.createElement("div");
    banner.id = "pwa-install-banner";
    banner.style.cssText = "position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9998;width:min(92vw,430px);display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:11px 12px 11px 14px;border:1px solid rgba(123,227,137,.35);border-radius:999px;background:linear-gradient(135deg,#14321f,#0e2116);color:#e8f5ec;box-shadow:0 18px 42px rgba(0,0,0,.45);font-family:system-ui,-apple-system,Segoe UI,sans-serif";
    banner.innerHTML = '<button type="button" id="pwa-install-main" aria-label="Install DANK App" style="display:contents"><span class="pwa-install-icon" aria-hidden="true" style="width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:#7be389;color:#0b2414;font-size:20px;font-weight:900">↓</span><span style="min-width:0;text-align:left"><strong style="display:block;font-size:14px;line-height:1.2">Install DANK App</strong><small style="display:block;margin-top:3px;color:#a9c4b0;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Faster access, saved cart, offline browsing</small></span></button><button id="pwa-install-close" type="button" aria-label="Dismiss install prompt" style="width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.07);color:#c5d6ca;font-size:20px;cursor:pointer">×</button>';
    document.body.appendChild(banner);
    document.getElementById("pwa-install-main").addEventListener("click",installApp);
    document.getElementById("pwa-install-close").addEventListener("click",dismissForever);
  }

  function scheduleInstallBanner(){
    if(!isMobile || isStandalone || dismissed()) return;
    if(cartHasItems()){
      showInstallBanner();
      return;
    }
    setTimeout(showInstallBanner,SHOW_DELAY);
    pollTimer = setInterval(function(){
      if(cartHasItems()){
        showInstallBanner();
        clearInterval(pollTimer);
      }
    },1000);
  }

  window.addEventListener("beforeinstallprompt",function(event){
    event.preventDefault();
    deferredPrompt = event;
  });

  window.addEventListener("appinstalled",function(){
    deferredPrompt = null;
    removeInstallBanner();
    makeToast("DANK App installed successfully.");
  });

  window.addEventListener("storage",function(event){
    if((event.key === "cart" || event.key === "dank_cart") && cartHasItems()) showInstallBanner();
  });

  window.addEventListener("offline",function(){document.documentElement.classList.add("is-offline");makeToast("You are offline. Cached pages and your saved cart are still available.");});
  window.addEventListener("online",function(){document.documentElement.classList.remove("is-offline");makeToast("Back online.");});
  if(!navigator.onLine) document.documentElement.classList.add("is-offline");

  window.addEventListener("load",scheduleInstallBanner);

  if("serviceWorker" in navigator){
    window.addEventListener("load",function(){
      navigator.serviceWorker.register("/service-worker.js",{scope:"/"}).then(function(registration){
        registration.update().catch(function(){});
        if(registration.waiting){makeToast("A new DANK App version is ready.","Update",function(){registration.waiting.postMessage({type:"SKIP_WAITING"});});}
        registration.addEventListener("updatefound",function(){
          var worker = registration.installing;
          if(!worker) return;
          worker.addEventListener("statechange",function(){
            if(worker.state === "installed" && navigator.serviceWorker.controller){makeToast("A new DANK App version is ready.","Update",function(){worker.postMessage({type:"SKIP_WAITING"});});}
          });
        });
      }).catch(function(error){console.warn("PWA service worker registration failed",error);});
      var refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange",function(){if(refreshing)return;refreshing=true;window.location.reload();});
    });
  }
})();
