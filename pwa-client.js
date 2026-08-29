(function(){
  "use strict";

  var deferredPrompt = null;
  var isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  document.documentElement.classList.toggle("pwa-standalone", isStandalone);

  function makeToast(message, actionLabel, action){
    var old = document.getElementById("pwa-toast");
    if(old) old.remove();
    var box = document.createElement("div");
    box.id = "pwa-toast";
    box.setAttribute("role","status");
    box.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;max-width:min(92vw,520px);display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:14px;background:#101a12;color:#e8f5ec;border:1px solid #294634;box-shadow:0 16px 40px rgba(0,0,0,.45);font:600 14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif";
    var text = document.createElement("span");
    text.textContent = message;
    text.style.flex = "1";
    box.appendChild(text);
    if(actionLabel && action){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = actionLabel;
      btn.style.cssText = "border:0;border-radius:10px;padding:9px 12px;background:#88b997;color:#102318;font-weight:800;cursor:pointer";
      btn.addEventListener("click", function(){ action(); box.remove(); });
      box.appendChild(btn);
    }
    document.body.appendChild(box);
    setTimeout(function(){ if(box.isConnected) box.remove(); }, 9000);
  }

  function addInstallButton(){
    if(isStandalone || document.getElementById("pwa-install-btn")) return;
    var btn = document.createElement("button");
    btn.id = "pwa-install-btn";
    btn.type = "button";
    btn.textContent = "Install DANK App";
    btn.hidden = true;
    btn.style.cssText = "position:fixed;right:18px;bottom:92px;z-index:9998;border:1px solid #294634;border-radius:999px;padding:11px 16px;background:#101a12;color:#7be389;font:800 13px system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 12px 28px rgba(0,0,0,.35);cursor:pointer";
    btn.addEventListener("click", async function(){
      if(!deferredPrompt) return;
      deferredPrompt.prompt();
      try{ await deferredPrompt.userChoice; }catch(e){}
      deferredPrompt = null;
      btn.hidden = true;
    });
    document.body.appendChild(btn);
  }

  window.addEventListener("beforeinstallprompt", function(event){
    event.preventDefault();
    deferredPrompt = event;
    addInstallButton();
    var btn = document.getElementById("pwa-install-btn");
    if(btn) btn.hidden = false;
  });

  window.addEventListener("appinstalled", function(){
    deferredPrompt = null;
    var btn = document.getElementById("pwa-install-btn");
    if(btn) btn.remove();
    makeToast("DANK App installed successfully.");
  });

  window.addEventListener("offline", function(){
    document.documentElement.classList.add("is-offline");
    makeToast("You are offline. Cached pages and your saved cart are still available.");
  });

  window.addEventListener("online", function(){
    document.documentElement.classList.remove("is-offline");
    makeToast("Back online.");
  });

  if(!navigator.onLine) document.documentElement.classList.add("is-offline");

  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("/service-worker.js", {scope:"/"}).then(function(registration){
        registration.update().catch(function(){});

        if(registration.waiting){
          makeToast("A new DANK App version is ready.", "Update", function(){
            registration.waiting.postMessage({type:"SKIP_WAITING"});
          });
        }

        registration.addEventListener("updatefound", function(){
          var worker = registration.installing;
          if(!worker) return;
          worker.addEventListener("statechange", function(){
            if(worker.state === "installed" && navigator.serviceWorker.controller){
              makeToast("A new DANK App version is ready.", "Update", function(){
                worker.postMessage({type:"SKIP_WAITING"});
              });
            }
          });
        });
      }).catch(function(error){
        console.warn("PWA service worker registration failed", error);
      });

      var refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", function(){
        if(refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }
})();
