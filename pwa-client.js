(function(){
  "use strict";

  var deferredPrompt = null;
  var isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isMobile = window.matchMedia("(max-width: 820px)").matches || /android|iphone|ipad|ipod/i.test(navigator.userAgent);

  document.documentElement.classList.toggle("pwa-standalone", isStandalone);

  function makeToast(message, actionLabel, action){
    var old = document.getElementById("pwa-toast");
    if(old) old.remove();

    var box = document.createElement("div");
    box.id = "pwa-toast";
    box.setAttribute("role", "status");
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
      actionBtn.addEventListener("click", function(){
        action();
        box.remove();
      });
      box.appendChild(actionBtn);
    }

    document.body.appendChild(box);
    setTimeout(function(){
      if(box.isConnected) box.remove();
    }, 9000);
  }

  function showIOSInstructions(){
    var existing = document.getElementById("pwa-ios-sheet");
    if(existing){
      existing.remove();
      return;
    }

    var sheet = document.createElement("div");
    sheet.id = "pwa-ios-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Install DANK App");
    sheet.style.cssText = "position:fixed;inset:0;z-index:10002;display:flex;align-items:flex-end;justify-content:center;background:rgba(2,5,3,.68);padding:14px";
    sheet.innerHTML = '<div style="width:min(100%,520px);border-radius:22px;background:#101a12;color:#e8f5ec;border:1px solid #294634;box-shadow:0 24px 70px rgba(0,0,0,.55);padding:20px;font:500 15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px"><strong style="font-size:20px">Install DANK App</strong><button id="pwa-ios-close" type="button" aria-label="Close" style="width:44px;height:44px;border:1px solid #294634;border-radius:12px;background:#16241a;color:#e8f5ec;font-size:20px">×</button></div>' +
      '<p style="margin:0 0 14px;color:#b7c9bc">On iPhone or iPad:</p>' +
      '<ol style="margin:0;padding-left:22px;color:#e8f5ec"><li style="margin-bottom:8px">Tap the <strong>Share</strong> button in Safari.</li><li style="margin-bottom:8px">Scroll down and tap <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>.</li></ol>' +
      '<p style="margin:14px 0 0;color:#8fae9a;font-size:13px">The app will open full-screen from your Home Screen.</p>' +
      '</div>';

    sheet.addEventListener("click", function(event){
      if(event.target === sheet) sheet.remove();
    });

    document.body.appendChild(sheet);
    document.getElementById("pwa-ios-close").addEventListener("click", function(){
      sheet.remove();
    });
  }

  function installApp(){
    if(isStandalone) return;

    if(deferredPrompt){
      deferredPrompt.prompt();
      deferredPrompt.userChoice.catch(function(){}).finally(function(){
        deferredPrompt = null;
        var btn = document.getElementById("pwa-install-btn");
        if(btn) btn.hidden = true;
      });
      return;
    }

    if(isIOS){
      showIOSInstructions();
      return;
    }

    makeToast("Install is not ready yet. Open this site in Chrome or Safari and try again.");
  }

  function addInstallButton(){
    if(isStandalone || !isMobile || document.getElementById("pwa-install-btn")) return;

    var btn = document.createElement("button");
    btn.id = "pwa-install-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Install DANK App");
    btn.innerHTML = '<span aria-hidden="true">⬇</span><span>Install App</span>';
    btn.style.cssText = "position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9998;display:flex;align-items:center;justify-content:center;gap:8px;min-width:150px;min-height:48px;border:1px solid #4f7f5d;border-radius:999px;padding:12px 18px;background:#101a12;color:#7be389;font:800 14px system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 14px 36px rgba(0,0,0,.42);cursor:pointer;-webkit-tap-highlight-color:transparent";
    btn.addEventListener("click", installApp);
    document.body.appendChild(btn);
  }

  function refreshInstallButton(){
    if(isStandalone){
      var existing = document.getElementById("pwa-install-btn");
      if(existing) existing.remove();
      return;
    }

    addInstallButton();

    var btn = document.getElementById("pwa-install-btn");
    if(!btn) return;

    if(isIOS || deferredPrompt){
      btn.hidden = false;
    }else{
      btn.hidden = false;
    }
  }

  window.addEventListener("beforeinstallprompt", function(event){
    event.preventDefault();
    deferredPrompt = event;
    refreshInstallButton();
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

  window.addEventListener("load", function(){
    refreshInstallButton();
  });

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
