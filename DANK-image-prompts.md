<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Build Your Joint · DANK Cannabis Club</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#050705; --bg2:#0a0d0a; --panel:#0d110d; --panel2:#101610;
  --line:rgba(86,224,90,.14); --line2:rgba(255,255,255,.07);
  --green:#56E05A; --green2:#7cff80; --green-dim:#2f8a33;
  --txt:#f2f6f2; --muted:#9aa79a; --muted2:#5f6b5f;
  --glow:0 0 60px rgba(86,224,90,.25);
  --radius:16px;
  --disp:'Anton',Impact,'Arial Narrow',sans-serif;
  --sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--txt);font-family:var(--sans);line-height:1.5;
  background-image:radial-gradient(1200px 600px at 80% -10%,rgba(86,224,90,.08),transparent 60%),radial-gradient(900px 500px at 0% 100%,rgba(86,224,90,.05),transparent 55%);
  min-height:100vh;overflow-x:hidden}
::selection{background:rgba(86,224,90,.3)}
img{max-width:100%;display:block}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
a{color:inherit;text-decoration:none}

/* ---------- header ---------- */
.hdr{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:22px;
  padding:14px clamp(16px,4vw,44px);
  background:rgba(5,7,5,.72);backdrop-filter:blur(18px);
  border-bottom:1px solid var(--line)}
.logo{font-family:var(--disp);letter-spacing:.5px;font-size:24px;line-height:.8;color:var(--green);text-shadow:0 0 22px rgba(86,224,90,.5);
  display:block;text-decoration:none;transition:opacity .2s}
.logo:hover{opacity:.82}
.logo small{display:block;font-family:var(--sans);font-weight:700;font-size:8.5px;letter-spacing:3px;color:var(--muted);margin-top:3px}
.nav{display:flex;gap:26px;margin-left:14px;font-weight:600;font-size:13.5px;letter-spacing:.4px}
.nav a{color:var(--muted);padding:6px 0;position:relative;transition:color .2s}
.nav a:hover{color:var(--txt)}
.nav a.on{color:var(--txt)}
.nav a.on::after{content:"";position:absolute;left:0;right:0;bottom:-2px;height:2px;background:var(--green);box-shadow:0 0 12px var(--green);border-radius:2px}
.hdr-r{margin-left:auto;display:flex;align-items:center;gap:18px;color:var(--muted)}
.hdr-r .ic{width:20px;height:20px;transition:color .2s}
/* the search and member glyphs are links now, so they get a finger-sized box
   instead of a bare 20px icon, and the svg inside is sized explicitly */
.hdr-r a.ic{width:28px;height:28px;margin:-4px;border-radius:8px;color:inherit;
  display:flex;align-items:center;justify-content:center}
.hdr-r a.ic svg{width:20px;height:20px}
.hdr-r .ic:hover{color:var(--green)}
.cartbtn{position:relative}
.cartbtn .cnt{position:absolute;top:-8px;right:-9px;background:var(--green);color:#04210a;font-size:10px;font-weight:800;min-width:16px;height:16px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 3px;box-shadow:0 0 10px rgba(86,224,90,.6)}
@media(max-width:820px){.nav{display:none}}

/* ---------- layout ---------- */
.wrap{max-width:1240px;margin:0 auto;padding:clamp(18px,3vw,34px) clamp(14px,4vw,44px) 40px}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:26px}
.title{font-family:var(--disp);font-size:clamp(38px,7vw,68px);line-height:.92;letter-spacing:.5px;text-transform:uppercase;display:flex;align-items:center;gap:14px}
.title .leaf{color:var(--green);filter:drop-shadow(0 0 14px rgba(86,224,90,.5))}
.subtitle{color:var(--muted);font-size:15px;margin-top:12px;max-width:420px}

/* total bar (desktop) */
.totalbar{display:flex;align-items:center;gap:20px;background:linear-gradient(180deg,var(--panel2),var(--panel));
  border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px 14px 22px;min-width:330px;box-shadow:var(--glow)}
.totalbar .lab{font-size:11px;letter-spacing:2px;color:var(--muted);font-weight:700}
.totalbar .amt{font-family:var(--disp);font-size:34px;color:var(--green);line-height:1;margin-top:3px;text-shadow:0 0 20px rgba(86,224,90,.35)}
.btn-cart{margin-left:auto;background:var(--green);color:#04210a;font-weight:800;letter-spacing:1px;font-size:13.5px;
  padding:16px 24px;border-radius:12px;transition:transform .15s,box-shadow .2s,background .2s;white-space:nowrap;text-transform:uppercase}
.btn-cart:hover{transform:translateY(-1px);box-shadow:0 10px 30px rgba(86,224,90,.4);background:var(--green2)}
.btn-cart:active{transform:translateY(0) scale(.98)}
/* secondary "add" + primary "checkout" pairing */
.btn-add{margin-left:auto;background:transparent;color:var(--green);border:1.5px solid rgba(86,224,90,.45);
  font-weight:800;letter-spacing:1px;font-size:13.5px;padding:14.5px 20px;border-radius:12px;
  transition:transform .15s,box-shadow .2s,background .2s,border-color .2s;white-space:nowrap;text-transform:uppercase}
.btn-add:hover{background:rgba(86,224,90,.1);border-color:var(--green)}
.btn-add:active{transform:scale(.98)}
.btn-pay{background:linear-gradient(135deg,#e8c87a,#cfa85a 55%,#b8914a);color:#2a1c05;font-weight:900;letter-spacing:1px;
  font-size:13.5px;padding:16px 26px;border-radius:12px;white-space:nowrap;text-transform:uppercase;
  transition:transform .15s,box-shadow .2s,filter .2s;box-shadow:0 6px 22px rgba(207,168,90,.3)}
.btn-pay:hover{transform:translateY(-1px);box-shadow:0 12px 34px rgba(207,168,90,.5);filter:brightness(1.06)}
.btn-pay:active{transform:translateY(0) scale(.98)}
.btnrow{display:flex;align-items:center;gap:10px;margin-left:auto}
@media(max-width:520px){.btn-add{padding:13px 14px;font-size:12px}.btn-pay{padding:14px 18px;font-size:12.5px}.btnrow{gap:8px}}

.grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(20px,3vw,40px);align-items:start}
@media(max-width:940px){.grid{grid-template-columns:1fr}.top .totalbar{display:none}}

.rightcol{position:sticky;top:86px;display:flex;flex-direction:column;gap:20px}
@media(max-width:940px){.rightcol{position:static}}

/* ---------- steps ---------- */
.step{margin-bottom:30px;animation:rise .5s both}
.step-h{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.step-n{width:26px;height:26px;flex:none;border:1px solid var(--green);color:var(--green);border-radius:7px;
  display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;box-shadow:0 0 14px rgba(86,224,90,.25)}
.step-t{font-weight:800;letter-spacing:1.5px;font-size:13.5px;text-transform:uppercase}

/* selected flower card */
.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line2);border-radius:14px;transition:border-color .25s,transform .2s,box-shadow .25s}
.sel-flower{display:flex;align-items:center;gap:14px;padding:12px 14px;border-color:var(--line)}
.thumb{width:56px;height:56px;border-radius:10px;flex:none;background:#0b0f0b;overflow:hidden;position:relative;border:1px solid var(--line2)}
.bud{position:absolute;inset:0}
.sel-flower .meta{flex:1;min-width:0}
.sel-flower .nm{font-weight:700;font-size:15px}
.sel-flower .sub{color:var(--muted);font-size:12.5px;margin-top:2px}
.sel-flower .pr{color:var(--green);font-weight:800;font-size:14px;margin-top:3px}
.sel-flower .pr small{color:var(--muted);font-weight:500}
.chev{color:var(--muted);width:18px;height:18px;transition:transform .3s}
.chev.open{transform:rotate(180deg)}
.iconbtn{color:var(--muted);padding:4px;border-radius:8px;transition:.2s}
.iconbtn:hover{color:var(--green);background:rgba(86,224,90,.08)}
.browse{width:100%;margin-top:10px;border:1px solid var(--line2);border-radius:12px;padding:13px;font-weight:700;
  letter-spacing:1px;font-size:12.5px;color:var(--muted);text-transform:uppercase;transition:.2s;background:var(--panel)}
.browse:hover{color:var(--txt);border-color:var(--line)}

/* flower list */
.flowerlist{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;overflow:hidden}
@media(max-width:520px){.flowerlist{grid-template-columns:1fr}}
.fcard{display:flex;gap:11px;padding:11px;cursor:pointer;align-items:center;animation:rise .35s both}
.fcard:hover{transform:translateY(-2px);border-color:var(--line);box-shadow:0 10px 26px rgba(0,0,0,.4)}
.fcard.active{border-color:var(--green);box-shadow:0 0 0 1px var(--green),0 8px 26px rgba(86,224,90,.15)}
.fcard .nm{font-weight:700;font-size:13.5px;line-height:1.2}
.fcard .badges{display:flex;gap:6px;margin-top:5px;flex-wrap:wrap}
.tag{font-size:10px;font-weight:700;letter-spacing:.3px;padding:2px 7px;border-radius:20px;background:rgba(86,224,90,.1);color:var(--green);border:1px solid var(--line)}
.tag.type{background:rgba(255,255,255,.05);color:var(--muted);border-color:var(--line2)}
.fcard .pr{color:var(--green);font-weight:800;font-size:13px;margin-top:6px}
.fcard .pr small{color:var(--muted);font-weight:500;font-size:11px}

/* weight pills */
.pills{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.pill{padding:15px 8px;text-align:center;font-weight:800;font-size:15px;border:1px solid var(--line2);border-radius:12px;background:var(--panel);transition:.2s;letter-spacing:.5px}
.pill small{display:block;font-size:10.5px;color:var(--muted);font-weight:600;margin-top:3px;letter-spacing:.3px}
.pill:hover{border-color:var(--line);transform:translateY(-1px)}
.pill.active{border-color:var(--green);color:var(--green);background:rgba(86,224,90,.08);box-shadow:0 0 0 1px var(--green),var(--glow)}

/* option rows (resin/hash/filter) */
.opts{display:flex;flex-direction:column;gap:10px}
.opt{display:flex;align-items:center;gap:13px;padding:12px 14px;cursor:pointer;position:relative}
.opt:hover{transform:translateY(-1px);border-color:var(--line)}
.opt.active{border-color:var(--green);background:linear-gradient(180deg,rgba(86,224,90,.09),rgba(86,224,90,.02));box-shadow:0 0 0 1px rgba(86,224,90,.5)}
.opt .oi{width:44px;height:44px;border-radius:10px;flex:none;overflow:hidden;position:relative;border:1px solid var(--line2);background:#0b0f0b}
.opt .otext{flex:1;min-width:0}
.opt .on{font-weight:700;font-size:14px}
.opt .od{color:var(--muted);font-size:12px;margin-top:1px}
.opt .op{font-weight:800;font-size:13px;color:var(--green);white-space:nowrap}
.opt .op.inc{color:var(--muted);font-weight:600;font-size:12px}
.radio{width:22px;height:22px;border-radius:50%;border:2px solid var(--muted2);flex:none;display:flex;align-items:center;justify-content:center;transition:.2s}
.opt.active .radio{border-color:var(--green);background:var(--green);box-shadow:0 0 12px rgba(86,224,90,.6)}
.opt.active .radio svg{opacity:1;transform:scale(1)}
.radio svg{width:12px;height:12px;color:#04210a;opacity:0;transform:scale(.4);transition:.2s}

/* paper cards */
.papers{display:flex;flex-direction:column;gap:9px}
.paper{display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer}
.paper:hover{transform:translateY(-1px);border-color:var(--line)}
.paper.active{border-color:var(--green);background:linear-gradient(90deg,rgba(86,224,90,.09),transparent);box-shadow:0 0 0 1px rgba(86,224,90,.5)}
.paper .brand{width:60px;height:34px;border-radius:7px;flex:none;display:flex;align-items:center;justify-content:center;
  font-weight:900;font-size:10px;letter-spacing:.5px;overflow:hidden;position:relative;text-align:center;line-height:1}
.paper .pn{flex:1;font-weight:700;font-size:14px}
.paper .pd{color:var(--muted);font-size:11.5px;font-weight:500;display:block;margin-top:1px}
.paper .pp{font-weight:800;font-size:12.5px;color:var(--green)}
.paper .pp.inc{color:var(--muted);font-weight:700;font-size:11px;letter-spacing:.3px}

/* ---------- right: preview ---------- */
.preview{padding:22px;overflow:hidden;position:relative;border-color:var(--line)}
.preview-t{color:var(--green);font-weight:800;letter-spacing:2px;font-size:13px;text-transform:uppercase;text-shadow:0 0 14px rgba(86,224,90,.3)}
/* ---- 3D joint stage (real CSS 3D cylinder, auto-rotating) ---- */
.stage{position:relative;height:252px;margin:6px 0;overflow:hidden;
  perspective:1150px;perspective-origin:50% 46%;
  touch-action:pan-y;cursor:grab;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.stage.dragging{cursor:grabbing}
.stage::before{content:"";position:absolute;width:74%;height:130px;left:13%;top:46%;transform:translateY(-50%);
  background:radial-gradient(ellipse at center,rgba(86,224,90,.26),transparent 70%);filter:blur(16px);pointer-events:none}
.j-shadow{position:absolute;left:50%;top:74%;height:24px;
  background:radial-gradient(ellipse at center,rgba(0,0,0,.8),rgba(0,0,0,0) 72%);
  filter:blur(6px);pointer-events:none;z-index:1}
.j-float{position:absolute;inset:0;transform-style:preserve-3d;pointer-events:none;z-index:2;
  animation:jfloat 7s ease-in-out infinite}
@keyframes jfloat{0%,100%{transform:translate3d(0,-5px,0)}50%{transform:translate3d(0,5px,0)}}
.j-tilt{position:absolute;left:50%;top:50%;transform-style:preserve-3d;transition:opacity .24s ease}
.j-tilt.fade{opacity:0}
.j-spin{position:absolute;left:0;top:0;width:100%;height:100%;transform-style:preserve-3d;will-change:transform}
/* Repeat DOWN the strip, never across it. Y in texture space is the way round the
   tube, and each strip is a hair taller than the slice of texture it samples so
   neighbours overlap instead of gapping — without the vertical repeat the strip
   that samples the last slice runs off the bottom of the image and paints that
   overlap as nothing at all, which shows up as a small hole punched through the
   paper. X is along the joint and must not tile: wrapping there would print the
   crutch gather back over the packed end. */
.j-f{position:absolute;top:50%;transform-origin:left center;backface-visibility:hidden;
  background-repeat:no-repeat repeat;image-rendering:auto}
.j-cap{position:absolute;top:50%;backface-visibility:hidden;border-radius:50%;
  box-shadow:inset 0 0 4px rgba(0,0,0,.65)}
/* the open packed end — ground flower in the strain's own colour */
.j-bud{position:absolute;top:50%;backface-visibility:hidden;border-radius:50%;
  background-repeat:no-repeat;background-position:center;overflow:hidden}
/* Trichomes catch the light as the joint turns. One pseudo-element, no extra
   nodes — the model is already ~330 faces and cannot afford more. */
.j-bud::after{content:"";position:absolute;inset:0;border-radius:50%;
  background:radial-gradient(circle at 36% 32%,rgba(255,255,255,.34),rgba(255,255,255,.06) 42%,transparent 62%);
  animation:budglint 4.2s ease-in-out infinite}
@keyframes budglint{0%,100%{opacity:.30}50%{opacity:.78}}
@media(prefers-reduced-motion:reduce){.j-bud::after{animation:none;opacity:.45}}
.j-light,.j-spec{position:absolute;top:50%;left:0;pointer-events:none}
.j-hint{position:absolute;left:0;right:0;bottom:4px;text-align:center;z-index:4;
  color:var(--muted2);font-size:10.5px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;
  opacity:.75;transition:opacity .4s ease;pointer-events:none}
.j-hint.gone{opacity:0}
.j-hint svg{width:11px;height:11px;vertical-align:-1px;margin-right:4px}
.disclaimer{text-align:center;color:var(--muted2);font-size:11px;font-style:italic}

/* On a phone the columns stack, which used to bury the preview two thirds of the
   way down the page — you were picking papers with no idea what they looked like.
   display:contents lets the preview card out of the right column so it can be
   hoisted above the steps and pinned under the header while you scroll. */
@media(max-width:940px){
  .rightcol{display:contents}
  .rightcol>.preview{order:-1;position:sticky;top:58px;z-index:30;
    background:linear-gradient(180deg,#0f150f 0%,#0b100b 100%);
    box-shadow:0 18px 30px -18px rgba(0,0,0,.9)}
  .rightcol>.card:not(.preview){order:2}
  .preview{padding-bottom:6px}
  .stage{height:158px;margin:2px 0}
  .stage::before{height:96px}
  .preview .disclaimer{display:none}
  .j-hint{bottom:1px;font-size:9.5px}
}

/* order summary */
.summary{padding:20px 22px}
.summary-t{font-weight:800;letter-spacing:1.5px;font-size:13px;text-transform:uppercase;color:var(--txt);margin-bottom:14px}
.sumbox{border:1px solid var(--line2);border-radius:12px;padding:6px 14px}
.line{display:flex;justify-content:space-between;gap:12px;padding:9px 0;font-size:13.5px;border-bottom:1px solid var(--line2)}
.line:last-child{border-bottom:none}
.line .l{color:var(--txt)}
.line .l small{display:block;color:var(--muted);font-size:11.5px;margin-top:1px}
.line .v{color:var(--muted);font-weight:600;white-space:nowrap}
.line .v.inc{color:var(--muted2);font-style:italic;font-weight:500}
.grand{display:flex;justify-content:space-between;align-items:center;margin-top:15px;padding-top:5px}
.grand .gl{font-weight:800;letter-spacing:1.5px;font-size:13px;text-transform:uppercase}
.grand .gv{font-family:var(--disp);font-size:30px;color:var(--green);text-shadow:0 0 20px rgba(86,224,90,.35)}

/* trust badges */
.trust{padding:18px 22px;display:grid;grid-template-columns:1fr 1fr;gap:16px 14px}
.tb{display:flex;gap:11px;align-items:flex-start}
.tb .ti{color:var(--green);width:22px;height:22px;flex:none;margin-top:1px;filter:drop-shadow(0 0 8px rgba(86,224,90,.4))}
.tb .th{font-weight:700;font-size:13px}
.tb .ts{color:var(--muted);font-size:11.5px}

/* info */
.info{padding:20px 22px}
.info-t{font-weight:800;letter-spacing:1.5px;font-size:12.5px;text-transform:uppercase;margin-bottom:9px}
.info p{color:var(--muted);font-size:13px;line-height:1.6}
.info .learn{color:var(--green);font-weight:700;font-size:12.5px;letter-spacing:.5px;text-transform:uppercase;margin-top:10px;display:inline-block}

/* footer strip */
.foot{border-top:1px solid var(--line);margin-top:30px;padding:26px clamp(14px,4vw,44px);
  display:flex;gap:30px;flex-wrap:wrap;justify-content:center;max-width:1240px;margin-left:auto;margin-right:auto}
.fitem{display:flex;gap:11px;align-items:center;color:var(--muted)}
.fitem .fi{color:var(--green);width:22px;height:22px}
.fitem b{color:var(--txt);font-size:13px;font-weight:700;display:block}
.fitem span{font-size:11.5px}

/* mobile sticky cart */
.mcart{position:fixed;left:0;right:0;bottom:0;z-index:70;display:none;align-items:center;gap:14px;
  padding:12px 16px calc(12px + env(safe-area-inset-bottom));
  background:rgba(5,7,5,.9);backdrop-filter:blur(18px);border-top:1px solid var(--line)}
.mcart .amt{font-family:var(--disp);font-size:26px;color:var(--green);line-height:1}
.mcart .amt small{display:block;font-family:var(--sans);font-size:10px;letter-spacing:1.5px;color:var(--muted);font-weight:700}
.mcart .btn-cart{padding:15px 22px;font-size:13px}
@media(max-width:940px){.mcart{display:flex}.wrap{padding-bottom:96px}}

/* toast */
.toast{position:fixed;left:50%;bottom:110px;transform:translateX(-50%) translateY(20px);z-index:90;
  background:var(--green);color:#04210a;font-weight:800;padding:13px 22px;border-radius:12px;font-size:14px;
  box-shadow:0 12px 40px rgba(86,224,90,.4);opacity:0;pointer-events:none;transition:.3s;display:flex;gap:9px;align-items:center}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
@media(max-width:940px){.toast{bottom:96px}}

@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.pop{animation:pop .4s}
@keyframes pop{0%{transform:scale(1)}40%{transform:scale(1.09)}100%{transform:scale(1)}}
</style>
</head>
<body>

<header class="hdr">
  <!-- the logo is the way home from here, the same as on any shop -->
  <a class="logo" href="index.html" title="Back to the DANK BKK home page" aria-label="DANK Cannabis Club — home">DANK<small>CANNABIS CLUB</small></a>
  <!-- Every one of these used to be href="#": they highlighted on hover, took the
       tap, and did nothing. There is no shop on this page to show, so they go back
       to index.html — either to the menu itself or to the matching panel via the
       ?open= handler there. -->
  <nav class="nav">
    <a href="index.html#menu">SHOP</a>
    <a href="build-your-joint.html" class="on">BUILD YOUR JOINT</a>
    <a href="index.html?open=deals#menu">BUNDLES</a>
    <a href="index.html?open=events">EVENTS</a>
    <a href="index.html?open=info">ABOUT</a>
  </nav>
  <div class="hdr-r">
    <a class="ic" href="index.html#menu" title="Search the menu" aria-label="Search the menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg></a>
    <a class="ic" href="index.html?open=member" title="Member login · 10% off" aria-label="Member login"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg></a>
    <button class="cartbtn ic" style="width:22px;height:22px" title="View cart" onclick="openCartPage()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6h15l-1.5 9h-12z"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M6 6L5 3H2"/></svg><span class="cnt" id="cartCnt">0</span></button>
  </div>
</header>

<div class="wrap">
  <div class="top">
    <div>
      <h1 class="title">BUILD YOUR JOINT
        <svg class="leaf" width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-1 3-1 5 0 7 1-2 3-3 5-3-1 2-2 4-4 5 2 0 4 1 5 3-3 0-5-1-6-2v8h-2v-8c-1 1-3 2-6 2 1-2 3-3 5-3-2-1-3-3-4-5 2 0 4 1 5 3 1-2 1-4 0-7z"/></svg>
      </h1>
      <p class="subtitle">Customize your perfect joint, exactly how you like it. Every detail, dialed in.</p>
    </div>
    <div class="totalbar">
      <div>
        <div class="lab">TOTAL</div>
        <div class="amt" id="totalTop">฿0</div>
      </div>
      <div class="btnrow">
        <button class="btn-add" onclick="addToCart()">ADD TO CART</button>
        <button class="btn-pay" onclick="checkoutNow()">CHECKOUT →</button>
      </div>
    </div>
  </div>

  <div class="grid">
    <!-- LEFT -->
    <div class="leftcol">
      <!-- Step 1 -->
      <section class="step">
        <div class="step-h"><span class="step-n">1</span><span class="step-t">Choose Your Weed</span></div>
        <div class="card sel-flower" id="selFlower"></div>
        <button class="browse" id="browseBtn" onclick="toggleBrowse()">BROWSE ALL FLOWERS</button>
        <div class="flowerlist" id="flowerList" style="display:none"></div>
      </section>

      <!-- Step 2 -->
      <section class="step">
        <div class="step-h"><span class="step-n">2</span><span class="step-t">How Much Weed?</span></div>
        <div class="pills" id="weights"></div>
      </section>

      <!-- Step 3 -->
      <section class="step">
        <div class="step-h"><span class="step-n">3</span><span class="step-t">Add Resin?</span></div>
        <div class="opts" id="resin"></div>
      </section>

      <!-- Step 4 -->
      <section class="step">
        <div class="step-h"><span class="step-n">4</span><span class="step-t">Add Hash?</span></div>
        <div class="opts" id="hash"></div>
      </section>

      <!-- Step 5 -->
      <section class="step">
        <div class="step-h"><span class="step-n">5</span><span class="step-t">Filter Options</span></div>
        <div class="opts" id="filter"></div>
      </section>

      <!-- Step 6 -->
      <section class="step">
        <div class="step-h"><span class="step-n">6</span><span class="step-t">Select Paper</span></div>
        <div class="papers" id="paper"></div>
      </section>
    </div>

    <!-- RIGHT -->
    <div class="rightcol">
      <div class="card preview">
        <div class="preview-t">Your Joint Preview</div>
        <div class="stage" id="jStage">
          <i class="j-shadow" id="jShadow"></i>
          <div class="j-float">
            <div class="j-tilt" id="jTilt">
              <div class="j-spin" id="jSpin"></div>
              <i class="j-light" id="jLight"></i>
              <i class="j-spec" id="jSpec"></i>
            </div>
          </div>
          <div class="j-hint" id="jHint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M4 12h16M9 7l-5 5 5 5M15 7l5 5-5 5"/></svg>Drag to spin</div>
        </div>
        <div class="disclaimer">*Preview for illustration only. Actual product may vary.</div>
      </div>

      <div class="card summary">
        <div class="summary-t">Order Summary</div>
        <div class="sumbox" id="sumLines"></div>
        <div class="grand"><span class="gl">Total</span><span class="gv" id="totalGrand">฿0</span></div>
      </div>

      <div class="card trust">
        <div class="tb"><svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 6 6 .9-4.5 4.2 1 6-5.5-3-5.5 3 1-6L3 8.9 9 8z"/></svg><div><div class="th">Hand Rolled</div><div class="ts">By our experts</div></div></div>
        <div class="tb"><svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg><div><div class="th">Custom Made</div><div class="ts">Just for you</div></div></div>
        <div class="tb"><svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C10 6 6 8 6 13a6 6 0 0012 0c0-5-4-7-6-11z"/></svg><div><div class="th">Fresh & Top Shelf</div><div class="ts">Premium flower</div></div></div>
        <div class="tb"><svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 10h18M8 7V5a4 4 0 018 0v2"/></svg><div><div class="th">Discreet Packaging</div><div class="ts">100% discreet</div></div></div>
      </div>

      <div class="card info">
        <div class="info-t">Important Info</div>
        <p>For adults 20+ only. A medical card may be required. Please consume responsibly and keep out of reach of children.</p>
        <a class="learn" href="index.html?open=info">Learn more →</a>
      </div>
    </div>
  </div>
</div>

<footer class="foot">
  <div class="fitem"><svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="6" width="14" height="11" rx="1"/><path d="M15 9h4l3 3v5h-7z"/><circle cx="6" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/></svg><div><b>Free Delivery</b><span>On orders over ฿1,500</span></div></div>
  <div class="fitem"><svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 6 6 .9-4.5 4.2 1 6-5.5-3-5.5 3 1-6L3 8.9 9 8z"/></svg><div><b>Earn Points</b><span>With every purchase</span></div></div>
  <div class="fitem"><svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5a2 2 0 012-2h2l2 5-2 1a11 11 0 005 5l1-2 5 2v2a2 2 0 01-2 2A16 16 0 014 5z"/></svg><div><b>24/7 Support</b><span>We're here for you</span></div></div>
</footer>

<div class="mcart">
  <div class="amt"><small>TOTAL</small><span id="totalMob">฿0</span></div>
  <div class="btnrow">
    <button class="btn-add" onclick="addToCart()">ADD</button>
    <button class="btn-pay" onclick="checkoutNow()">CHECKOUT →</button>
  </div>
</div>

<div class="toast" id="toast"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg><span id="toastMsg">Added to cart</span></div>

<script>
/* =========================================================
   DATA MODEL — fully data-driven so future add-ons (Kief,
   Terpenes, Flavor Infusion, CBD Boost, THC Diamonds, Custom
   Filters/Paper, Packaging, Gift Box, Medical Cert, Delivery)
   can be added by dropping new entries/groups here.
   ========================================================= */
const money = n => "฿" + Math.round(n).toLocaleString();

const FLOWERS = [
  {id:"gelato41", name:"Exotic · Gelato 41", type:"Hybrid", thc:28, cbd:1, price:800, hue:110, tone:"#7d9a52"},
  {id:"wcake",    name:"Wedding Cake",       type:"Hybrid", thc:26, cbd:1, price:700, hue:95,  tone:"#8aa15c"},
  {id:"ppunch",   name:"Purple Punch",       type:"Indica", thc:24, cbd:1, price:650, hue:280, tone:"#7c6a9c"},
  {id:"amnesia",  name:"Amnesia Haze",       type:"Sativa", thc:22, cbd:1, price:600, hue:80,  tone:"#9caf5a"},
  {id:"northern", name:"Northern Lights",    type:"Indica", thc:21, cbd:2, price:550, hue:150, tone:"#6f9a6b"},
  {id:"ssh",      name:"Super Silver Haze",  type:"Sativa", thc:23, cbd:1, price:620, hue:70,  tone:"#a6b062"},
];

const WEIGHTS = [
  {id:"0.5", g:0.5, label:"0.5 G", note:"Solo"},
  {id:"1",   g:1,   label:"1 G",   note:"Classic"},
  {id:"2",   g:2,   label:"2 G",   note:"Share"},
  {id:"3",   g:3,   label:"3 G",   note:"Session"},
];

const RESIN = [
  {id:"none", name:"No Resin",   desc:"Pure flower only",              price:0},
  {id:"live", name:"Live Resin", desc:"Solvent-based · huge flavor",   price:40},
  {id:"rosin",name:"Rosin",      desc:"Solventless press · premium terps", price:60},
];

const HASH = [
  {id:"none",   name:"No Hash",      desc:"Just flower & resin",          price:0},
  {id:"drysift",name:"Dry Sift Hash",desc:"Classic sifted kief hash",     price:50},
  {id:"ice",    name:"Ice Hash",     desc:"Ice-water washed · clean",     price:90},
  {id:"bubble", name:"Bubble Hash",  desc:"Full-melt · top shelf",        price:120},
];

const FILTER = [
  {id:"standard",name:"Standard Filter",     desc:"Included · classic tip",     price:0},
  {id:"raw",     name:"RAW Tip",             desc:"Biodegradable paper tip",    price:20},
  {id:"carbon",  name:"Activated Carbon",    desc:"Smoother · filters tar",     price:30},
  {id:"glass",   name:"Glass Tip",           desc:"Reusable borosilicate glass",price:40},
];

const PAPER = [
  {id:"raw",     name:"RAW Classic",     desc:"Unbleached natural",   price:0,  bg:"#c8a76a", fg:"#4a2f12", brand:"RAW"},
  {id:"rawblack",name:"RAW Black",       desc:"Ultra-thin",           price:10, bg:"#141414", fg:"#e9c07a", brand:"RAW"},
  {id:"raworg",  name:"RAW Organic Hemp",desc:"Organic hemp",         price:10, bg:"#b8ad7d", fg:"#3c3410", brand:"RAW"},
  {id:"elements",name:"Elements",        desc:"Rice paper · clean burn",price:20,bg:"#cfd6dc", fg:"#20408a", brand:"ELEMENTS"},
  {id:"ocb",     name:"OCB Premium",     desc:"Slow-burn classic",    price:10, bg:"#e9e4d6", fg:"#0f2f6b", brand:"OCB"},
  {id:"zigzag",  name:"Zig Zag",         desc:"Iconic since 1879",    price:10, bg:"#e46a1f", fg:"#1a1a1a", brand:"ZIG·ZAG"},
  {id:"smoking", name:"Smoking Deluxe",  desc:"Ultra-fine · gold",    price:10, bg:"#1c1c1c", fg:"#d8b24a", brand:"SMOKING"},
];

/* current selection */
const state = {
  flowerId:"gelato41", weightId:"1",
  resinId:"none", hashId:"none", filterId:"standard", paperId:"raw",
};
const get = (arr,id)=>arr.find(x=>x.id===id);

/* ---------- price ---------- */
function calc(){
  const f=get(FLOWERS,state.flowerId), w=get(WEIGHTS,state.weightId);
  const r=get(RESIN,state.resinId), h=get(HASH,state.hashId),
        fi=get(FILTER,state.filterId), p=get(PAPER,state.paperId);
  const flower=f.price*w.g;
  const subtotal=flower+r.price+h.price+fi.price+p.price;
  return {f,w,r,h,fi,p,flower,addons:r.price+h.price+fi.price+p.price,subtotal,total:subtotal};
}

/* ---------- bud thumbnail (css) ---------- */
function budStyle(hue,tone){
  return `background:
    radial-gradient(circle at 32% 30%, ${tone} 0 14%, transparent 26%),
    radial-gradient(circle at 64% 40%, ${tone} 0 12%, transparent 24%),
    radial-gradient(circle at 46% 66%, ${tone} 0 15%, transparent 28%),
    radial-gradient(circle at 70% 72%, ${tone} 0 10%, transparent 22%),
    radial-gradient(circle at 24% 62%, ${tone} 0 10%, transparent 22%),
    radial-gradient(circle at 50% 45%, hsl(${hue} 30% 30%), hsl(${hue} 28% 14%));
    filter:saturate(.9) brightness(1.02)`;
}

/* =========================================================
   RENDERERS
   ========================================================= */
function renderSelFlower(){
  const f=get(FLOWERS,state.flowerId), w=get(WEIGHTS,state.weightId);
  const open=document.getElementById("flowerList").style.display!=="none";
  document.getElementById("selFlower").innerHTML=`
    <div class="thumb"><div class="bud" style="${budStyle(f.hue,f.tone)}"></div></div>
    <div class="meta">
      <div class="nm">${f.name}</div>
      <div class="sub">THC ${f.thc}% · CBD ${f.cbd}% · ${f.type}</div>
      <div class="pr">${money(f.price)} <small>/gram</small></div>
    </div>
    <button class="iconbtn" title="Change" onclick="toggleBrowse()">
      <svg class="chev ${open?'open':''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>
    </button>`;
}

function renderFlowerList(){
  document.getElementById("flowerList").innerHTML=FLOWERS.map((f,i)=>`
    <div class="card fcard ${f.id===state.flowerId?'active':''}" style="animation-delay:${i*40}ms" onclick="pick('flowerId','${f.id}')">
      <div class="thumb"><div class="bud" style="${budStyle(f.hue,f.tone)}"></div></div>
      <div style="flex:1;min-width:0">
        <div class="nm">${f.name}</div>
        <div class="badges"><span class="tag">THC ${f.thc}%</span><span class="tag type">${f.type}</span></div>
        <div class="pr">${money(f.price)} <small>/g</small></div>
      </div>
    </div>`).join("");
}

function renderWeights(){
  document.getElementById("weights").innerHTML=WEIGHTS.map(w=>`
    <button class="pill ${w.id===state.weightId?'active':''}" onclick="pick('weightId','${w.id}')">
      ${w.label}<small>${w.note}</small></button>`).join("");
}

function optIcon(kind,o){
  // simple stylized icon per addon
  const tones={live:"#c9a24a",rosin:"#e0b64f",drysift:"#b98a4a",ice:"#cdd7de",bubble:"#9a7a3f",
    raw:"#c8a76a",carbon:"#2b2b2b",glass:"#bfe6ef",standard:"#cdbf9a"};
  const c=tones[o.id]||"#7d9a52";
  if(o.id==="none") return `<div class="oi" style="background:radial-gradient(circle at 40% 35%,#7d9a52 0 30%,transparent 55%),radial-gradient(circle at 65% 60%,#6b874a 0 28%,transparent 52%),#12160f"></div>`;
  if(o.id==="glass") return `<div class="oi" style="background:linear-gradient(180deg,rgba(191,230,239,.5),rgba(120,180,200,.15));border-color:rgba(191,230,239,.4)"></div>`;
  return `<div class="oi" style="background:radial-gradient(circle at 35% 30%,${c} 0 26%,transparent 48%),radial-gradient(circle at 68% 62%,${c} 0 22%,transparent 44%),#12160f"></div>`;
}

function renderOpts(elId,arr,key){
  document.getElementById(elId).innerHTML=arr.map(o=>`
    <div class="card opt ${o.id===state[key]?'active':''}" onclick="pick('${key}','${o.id}')">
      ${optIcon(key,o)}
      <div class="otext"><div class="on">${o.name}</div><div class="od">${o.desc}</div></div>
      <div class="op ${o.price===0?'inc':''}">${o.price===0?'Included':'+ '+money(o.price)}</div>
      <div class="radio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><path d="M20 6L9 17l-5-5"/></svg></div>
    </div>`).join("");
}

function renderPaper(){
  document.getElementById("paper").innerHTML=PAPER.map(p=>`
    <div class="card paper ${p.id===state.paperId?'active':''}" onclick="pick('paperId','${p.id}')">
      <div class="brand" style="background:${p.bg};color:${p.fg}">${p.brand}</div>
      <div class="pn">${p.name}<small class="pd">${p.desc}</small></div>
      <div class="pp ${p.price===0?'inc':''}">${p.price===0?'Included':'+ '+money(p.price)}</div>
    </div>`).join("");
}

/* ---------- order summary ---------- */
function renderSummary(){
  const c=calc();
  const rows=[
    {l:c.f.name, s:c.w.label, v:money(c.flower)},
    ...(c.r.price?[{l:c.r.name,v:money(c.r.price)}]:[]),
    ...(c.h.price?[{l:c.h.name,v:money(c.h.price)}]:[]),
    {l:c.fi.name, v:c.fi.price?money(c.fi.price):'Included', inc:!c.fi.price},
    {l:c.p.name+' Paper', v:c.p.price?money(c.p.price):'Included', inc:!c.p.price},
  ];
  document.getElementById("sumLines").innerHTML=rows.map(r=>`
    <div class="line"><span class="l">${r.l}${r.s?`<small>${r.s}</small>`:''}</span>
    <span class="v ${r.inc?'inc':''}">${r.v}</span></div>`).join("");
}

/* =========================================================
   3D JOINT PREVIEW
   A real CSS-3D cylinder — no external libraries, no WebGL,
   works on every phone. The tube is built from N flat faces
   arranged around the long axis; every face samples the SAME
   texture at a different vertical offset, which is exactly a
   cylindrical UV unwrap, so the paper grain, the helical glue
   seam and the printed brand roll around properly as it spins.
   Lighting is a separate plane that does NOT rotate, so the
   highlight stays put while the surface turns underneath it.
   ========================================================= */
const J={N:24, spin:0, vel:.42, auto:.42, drag:false, started:false, reduced:false, sc:1};
const TILT=16;   // degrees the whole joint leans in the frame

/* tiny deterministic RNG so speckles don't jump around on re-render */
function jrnd(seed){ let s=seed>>>0||1; return ()=>{ s=(s*1664525+1013904223)>>>0; return s/4294967296; }; }

/* The actual paper colour of each brand's sheet. The chip colours above are the
   packet — a Zig Zag packet is orange, the paper inside is not. */
/* Measured off real sheets rather than off the packets. Unbleached RAW is a pale
   oat colour, not the orange-brown of the pouch — rendered dark it comes out
   looking like bamboo, which is what the first pass of this model did. */
const SHEET={raw:"#d9bf92", rawblack:"#cbc2b3", raworg:"#cfc39a", elements:"#eaeef1",
             ocb:"#f4f0e6", zigzag:"#ece2ca", smoking:"#f0ede4"};
const THIN={rawblack:1, smoking:1, elements:1};      // you can see the bud through these
function sheetOf(p){ return SHEET[p.id]||p.bg; }

/* ---- the profile of a real pre-roll ----
   narrow rolled crutch, a body that flares gently out to the packed end, and
   there the paper is cut clean so you look straight into the ground flower.
   That open packed end is the whole look of a dispensary pre-roll — it is the
   only part of the joint that shows the customer which strain they picked, so
   the model ends flat and open rather than twisted shut.
   Returns a list of points {x,r} down the axis; every pair becomes a frustum. */
function jointGeom(){
  const c=calc(), g=c.w.g;
  const rT=({0.5:12.5, 1:15.5, 2:18.5, 3:21.5})[g] || 15.5;   // packed end — more grams, fatter
  const rC=rT*0.575;                                          // crutch: a king-size cone is 7.5mm at
                                                              // the mouth and 13mm at the tip — the
                                                              // taper is gentle, not a carrot
  const CL=Math.round(rT*1.9);                                // bare crutch you can actually see
  const OL=Math.round(rT*1.1);                                // ...and the bit the paper covers
  const FL=CL+OL;
  const BL=Math.round(196+(g-1)*26);                          // body
  /* The last few millimetres of paper stand proud of the bud face at a constant
     radius. Without a straight run at the end the mouth is sampled off a sloping
     ring and the opening comes out an ellipse instead of a circle. */
  const RIM=Math.max(5,Math.round(rT*0.30));
  /* The plug of ground flower standing a hair proud of the cut paper. It has to
     stick out past the rim to exist at all: it is narrower than the paper, so
     anything modelled inside the tube is hidden by the tube. Sticking out is
     also what the reference shows — the tip of a packed pre-roll is flower, and
     that band of colour is visible side-on, which the end disc alone is not. */
  const PLUG=Math.max(4,Math.round(rT*0.26));
  const paperEnd=FL+BL+RIM;
  const total=paperEnd+PLUG;

  // crutch: a straight tube, with the paper lapped over its inner end
  const P=[{x:0,r:rC},{x:CL,r:rC},{x:FL,r:rC*1.045}];

  /* Body. A hand-packed cone is never a perfect frustum, but the unevenness is
     long and soft — a few millimetres of swell over the whole length, not a
     lump at every joint. Two sine terms give that, and because every term is
     zero at t=0 and t=1 the crutch and rim joins stay exact. */
  const w=jrnd(77), a1=w()-0.5, a2=w()-0.5;
  const wob=t=>(a1*Math.sin(t*Math.PI)+a2*Math.sin(t*2*Math.PI))*0.030;
  const K=6;
  for(let i=1;i<=K;i++){
    const t=i/K, r=rC+(rT-rC)*Math.pow(t,0.92);
    P.push({x:FL+Math.round(BL*t), r:r*(1+wob(t))});
  }
  P.push({x:paperEnd, r:rT});      // …and stops dead, cut open, packed to the brim

  return {c, rC, rT, CL, OL, FL, BL, RIM, PLUG, paperEnd, total, P};
}
function svgURI(w,h,inner){
  const s='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'">'+inner+'</svg>';
  return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(s);
}

/* How much of the strain's colour the sheet is allowed to pick up.
   Rolling paper is warm and off-white, and an olive cast on it still reads as
   paper with bud behind it — that is what a real pre-roll looks like, so the eye
   forgives it. A violet cast gets no such pass: at the same opacity it stops
   reading as show-through and starts reading as pink paper, which is what
   Purple Punch was doing while the other five stayed oat-coloured. So the
   show-through is scaled down the further the strain sits from the green band
   the sheet can carry. The strain colour is not lost by this — it lives on the
   packed end, which is the surface the customer is actually looking at. */
function thruScale(f){
  const d=Math.abs(((f.hue-105)%360+540)%360-180);   // hue distance from mid-green, 0…180
  return 1-Math.min(0.74, d/150*0.74);
}

/* rolling paper, unwrapped: X = along the joint, Y = around it */
function bodyTex(c,W,H){
  const p=c.p, f=c.f, bg=sheetOf(p);
  const d1=shade(bg,-22), d2=shade(bg,-42), l1=shade(bg,16);
  let s='<rect width="'+W+'" height="'+H+'" fill="'+bg+'"/>';
  /* The thinner the paper, the more of the bud you see through it — and there is
     more of it to see towards the packed end, so the tint ramps that way. It has
     to be a gradient: a hard-edged rect in texture space is a hard-edged RING
     around the finished joint, and a joint banded like a bamboo cane was exactly
     the problem with the first pass of this model. */
  const tint=(THIN[p.id]?0.20:0.10)*thruScale(f);
  s+='<defs><linearGradient id="tn" x1="0" y1="0" x2="1" y2="0">'+
     '<stop offset="0" stop-color="'+f.tone+'" stop-opacity="'+(tint*0.55).toFixed(3)+'"/>'+
     '<stop offset="0.45" stop-color="'+f.tone+'" stop-opacity="'+(tint*1.05).toFixed(3)+'"/>'+
     '<stop offset="1" stop-color="'+f.tone+'" stop-opacity="'+(tint*1.9).toFixed(3)+'"/>'+
     '</linearGradient></defs>';
  s+='<rect width="'+W+'" height="'+H+'" fill="url(#tn)"/>';
  /* Paper grain running the length of the joint. It has to be finer than one strip
     of the mesh — at ~1 band per strip the two beat against each other and the
     model comes out corrugated. It also has to be very faint: full-width bands are
     lengthwise stripes on the finished tube, and at any real contrast they stop
     reading as paper fibre and start reading as wood grain. */
  const g=jrnd(11), NB=Math.max(40,Math.round(H/2));
  for(let i=0;i<NB;i++){
    s+='<rect y="'+(i*H/NB).toFixed(2)+'" width="'+W+'" height="'+(H/NB*0.5).toFixed(2)+'" fill="'+(i%2?d1:l1)+'" opacity="'+(0.004+g()*0.013).toFixed(3)+'"/>';
  }
  /* Ground flower packed inside shows through the paper as a mottle, and it is
     tinted by the strain, so a purple strain shows purple through the sheet the
     way it does in real life. It has to stay faint and fine-grained — big dark
     blobs read as mould, not as bud. */
  const bd=jrnd(41), BP=budPal(f);
  for(let k=-1;k<=1;k++) for(let i=0;i<130;i++){
    /* Round, not elongated. Ellipses stretched along X are stretched along the
       LENGTH of the finished joint, and a page of those is exactly what made this
       look like a length of bamboo instead of a paper tube with bud inside it.
       Small and many, not big and few: what you actually see through a rolling
       paper is the grain of the grind, and a handful of large discs at any
       visible opacity reads as spots of mould on the sheet. */
    const cx=bd()*W, cy=bd()*H+k*H, rx=1.1+bd()*2.6, ry=rx*(0.75+bd()*0.5);
    s+='<ellipse cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" rx="'+rx.toFixed(1)+'" ry="'+ry.toFixed(1)+'" fill="'+BP.deep+'" opacity="'+(0.030+bd()*0.055).toFixed(3)+'"/>';
    s+='<ellipse cx="'+(cx+rx*0.3).toFixed(1)+'" cy="'+(cy+ry*0.34).toFixed(1)+'" rx="'+(rx*0.6).toFixed(1)+'" ry="'+(ry*0.6).toFixed(1)+'" fill="'+BP.mid+'" opacity="'+(0.035+bd()*0.06).toFixed(3)+'"/>';
  }
  /* The packed end is where the flower is densest, so the tint gathers there and
     fades out over the last third — again a gradient, not a rect, so it does not
     draw a hoop round the joint. It makes the eye run down towards the open tip,
     which is exactly where the strain colour lives. */
  s+='<defs><linearGradient id="pk" x1="0" y1="0" x2="1" y2="0">'+
     '<stop offset="0.55" stop-color="'+BP.mid+'" stop-opacity="0"/>'+
     '<stop offset="1" stop-color="'+BP.mid+'" stop-opacity="'+(tint*1.5).toFixed(3)+'"/>'+
     '</linearGradient></defs>';
  s+='<rect width="'+W+'" height="'+H+'" fill="url(#pk)"/>';
  // helical glue seam — drawn three times so it wraps continuously
  for(let k=-1;k<=1;k++){
    const y0=H*0.18+k*H, y1=y0+H*0.62;
    s+='<path d="M0 '+y0.toFixed(1)+' L'+W+' '+y1.toFixed(1)+'" stroke="'+d2+'" stroke-width="1.2" opacity=".22" fill="none"/>';
    s+='<path d="M0 '+(y0+2.2).toFixed(1)+' L'+W+' '+(y1+2.2).toFixed(1)+'" stroke="'+l1+'" stroke-width="1" opacity=".18" fill="none"/>';
  }
  // hash shows as darker speckle packed through the paper
  if(c.h.id!=="none"){
    const n=c.h.id==="bubble"?92:c.h.id==="ice"?68:46, rr=jrnd(3);
    for(let i=0;i<n;i++)
      s+='<circle cx="'+(rr()*W).toFixed(1)+'" cy="'+(rr()*H).toFixed(1)+'" r="'+(0.7+rr()*1.7).toFixed(2)+'" fill="#2a1c0b" opacity="'+(0.16+rr()*0.26).toFixed(2)+'"/>';
  }
  // resin leaves glossy patches
  if(c.r.id!=="none"){
    const rr=jrnd(9), n=c.r.id==="rosin"?15:10;
    for(let i=0;i<n;i++)
      s+='<ellipse cx="'+(rr()*W).toFixed(1)+'" cy="'+(rr()*H).toFixed(1)+'" rx="'+(7+rr()*15).toFixed(1)+'" ry="'+(1.6+rr()*2.6).toFixed(1)+'" fill="#ffe9a8" opacity="'+(0.10+rr()*0.15).toFixed(2)+'"/>';
  }
  /* Hand-rolled creases — soft wrinkles running around the tube, wrapped like the
     seam. A machine-packed pre-roll has very few: the reference photo is almost
     smooth, and every crease past about five reads as damage rather than as a
     hand-rolled joint. */
  const wr=jrnd(21);
  for(let k=-1;k<=1;k++) for(let i=0;i<5;i++){
    const x=W*(0.12+i*0.18+wr()*0.05), y0=H*wr()+k*H, len=H*(0.22+wr()*0.34), dx=(wr()-0.5)*14;
    s+='<path d="M'+x.toFixed(1)+' '+y0.toFixed(1)+' L'+(x+dx).toFixed(1)+' '+(y0+len).toFixed(1)+
       '" stroke="'+d2+'" stroke-width="'+(0.7+wr()*0.7).toFixed(2)+'" opacity="'+(0.045+wr()*0.065).toFixed(3)+'" fill="none"/>';
    s+='<path d="M'+(x+1.6).toFixed(1)+' '+y0.toFixed(1)+' L'+(x+dx+1.6).toFixed(1)+' '+(y0+len).toFixed(1)+
       '" stroke="'+l1+'" stroke-width="0.9" opacity="'+(0.035+wr()*0.05).toFixed(3)+'" fill="none"/>';
  }
  // the paper is gathered where it meets the crutch
  s+='<rect x="0" width="3.5" height="'+H+'" fill="'+d2+'" opacity=".55"/>';
  s+='<rect x="3.5" width="2" height="'+H+'" fill="'+l1+'" opacity=".35"/>';
  /* No brand printed on the tube. Y here is the circumference, so a word set
     large enough to read wraps most of the way round and breaks into dashes, and
     wherever the tube is foreshortened — which is most of it, at any angle — the
     glyphs squash into a dark bar smeared down the middle of the joint. Set it
     small enough to avoid that and it is a grey smudge nobody can read anyway.
     A rolled pre-roll shows almost no print in real life either: the reference
     photo is plain paper. Which sheet was chosen still shows in its colour, and
     it is named in full on the card beside the model. */
  return svgURI(W,H,s);
}

/* ---- ground flower, in the colour of the strain the customer picked ----------
   This is the one surface on the whole model that tells you what you're buying.
   Every strain in the list carries a hue and a tone, and the grind is built out
   of those two numbers, so Purple Punch really does come out purple and Amnesia
   Haze comes out yellow-green — the preview changes the moment they tap a
   different strain.

   Three things are what make ground bud read as ground bud rather than as
   sand: angular flakes at several depths, orange pistil hairs threaded through
   it, and a dusting of pale trichomes catching the light. Miss any one of them
   and it looks like coffee. */
function budPal(f){
  const h=f.hue;
  return {
    /* The gaps between the flakes, NOT the colour of the grind. It still has to
       carry the strain's hue, because at this size the gaps are most of the
       surface — set it near-black and the whole tip reads as a burnt hole no
       matter how bright the flakes on top of it are. */
    dark: 'hsl('+h+' 26% 19%)',
    deep: shade(f.tone,-20),
    mid : f.tone,
    lite: shade(f.tone, 26),
    pale: shade(f.tone, 46),
    hair: (h>200&&h<330) ? "#c07a44" : "#c8701f",   // pistils stay orange on every strain
    dust: 'hsl('+h+' 22% 92%)'
  };
}
function budTex(f,W,H,seed){
  const P=budPal(f), g=jrnd(seed||17);
  let s='<rect width="'+W+'" height="'+H+'" fill="'+P.dark+'"/>';
  /* Flake count scales with area so a 0.5g tip and a 3g tip are ground to the
     same coarseness instead of one looking like dust and the other like gravel.
     It also has to be dense: at low counts the base colour shows through between
     the flakes and the tip reads as a dark hole rather than as packed flower.
     Two passes — a coarse bed, then finer grind sitting in the gaps. */
  const N=Math.max(240,Math.round(W*H/13));
  for(let i=0;i<N;i++){
    const x=g()*W, y=g()*H, w=2.2+g()*5.4, h=1.6+g()*3.6, rot=(g()*180).toFixed(1);
    const t=g(), col = t<0.28?P.deep : t<0.68?P.mid : t<0.92?P.lite : P.pale;
    s+='<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+h.toFixed(1)+
       '" rx="'+(h*0.34).toFixed(1)+'" fill="'+col+'" opacity="'+(0.72+g()*0.28).toFixed(2)+
       '" transform="rotate('+rot+' '+x.toFixed(1)+' '+y.toFixed(1)+')"/>';
  }
  for(let i=0;i<Math.round(N*0.5);i++){                          // fine grind filling the gaps
    const x=g()*W, y=g()*H, w=1.0+g()*2.2, h=0.8+g()*1.6;
    const t=g(), col = t<0.42?P.mid : t<0.82?P.lite : P.pale;
    s+='<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+h.toFixed(1)+
       '" rx="'+(h*0.4).toFixed(1)+'" fill="'+col+'" opacity="'+(0.5+g()*0.5).toFixed(2)+
       '" transform="rotate('+(g()*180).toFixed(1)+' '+x.toFixed(1)+' '+y.toFixed(1)+')"/>';
  }
  for(let i=0;i<Math.max(10,Math.round(N*0.05));i++){            // pistils
    const x=g()*W, y=g()*H, l=3+g()*8.5, a=g()*Math.PI*2;
    s+='<path d="M'+x.toFixed(1)+' '+y.toFixed(1)+' L'+(x+Math.cos(a)*l).toFixed(1)+' '+(y+Math.sin(a)*l).toFixed(1)+
       '" stroke="'+P.hair+'" stroke-width="'+(0.7+g()*0.9).toFixed(2)+'" stroke-linecap="round" opacity="'+
       (0.5+g()*0.45).toFixed(2)+'" fill="none"/>';
  }
  for(let i=0;i<Math.max(20,Math.round(N*0.09));i++){            // trichome dust
    s+='<circle cx="'+(g()*W).toFixed(1)+'" cy="'+(g()*H).toFixed(1)+'" r="'+(0.4+g()*1.0).toFixed(2)+
       '" fill="'+P.dust+'" opacity="'+(0.25+g()*0.5).toFixed(2)+'"/>';
  }
  return svgURI(W,H,s);
}

/* the crutch / tip, unwrapped the same way */
function filterTex(c,W,H){
  const id=c.fi.id;
  const base = id==="raw" ? "#bd8842" : id==="carbon" ? "#2b2b2b" : id==="glass" ? "#cbe7ef" : "#d7c69d";
  let s='<rect width="'+W+'" height="'+H+'" fill="'+base+'"/>';
  if(id==="glass"){
    // borosilicate: bright rings at both ends, cool translucent middle
    s+='<rect width="'+W+'" height="'+H+'" fill="#8fc6d6" opacity=".35"/>';
    s+='<rect x="2" width="7" height="'+H+'" fill="#ffffff" opacity=".55"/>';
    s+='<rect x="'+(W-11)+'" width="8" height="'+H+'" fill="#ffffff" opacity=".45"/>';
    s+='<rect x="'+(W*0.42)+'" width="3" height="'+H+'" fill="#ffffff" opacity=".3"/>';
    for(let i=0;i<10;i++)
      s+='<rect y="'+(i*H/10).toFixed(1)+'" width="'+W+'" height="'+(H/22).toFixed(2)+'" fill="#ffffff" opacity=".12"/>';
  }else if(id==="carbon"){
    s+='<rect x="0" width="9" height="'+H+'" fill="#d7c69d"/>';
    s+='<rect x="'+(W-9)+'" width="9" height="'+H+'" fill="#d7c69d"/>';
    for(let i=0;i<14;i++)
      s+='<rect y="'+(i*H/14).toFixed(1)+'" x="10" width="'+(W-20)+'" height="'+(H/30).toFixed(2)+'" fill="#000" opacity=".35"/>';
  }else{
    // rolled card crutch: lengthwise grain + the edge of the rolled strip
    const g=jrnd(id==="raw"?5:7);
    for(let i=0;i<16;i++)
      s+='<rect y="'+(i*H/16).toFixed(1)+'" width="'+W+'" height="'+(H/16*0.5).toFixed(2)+'" fill="#000" opacity="'+(0.04+g()*0.07).toFixed(3)+'"/>';
    s+='<rect x="'+(W-7)+'" width="2.4" height="'+H+'" fill="#000" opacity=".28"/>';
    s+='<rect x="4" width="2" height="'+H+'" fill="#000" opacity=".2"/>';
    if(id==="raw"){
      const fs=Math.max(7,Math.min(11,H*0.13));
      [H*0.32,H*0.82].forEach(y=>{
        s+='<text x="'+(W*0.30).toFixed(0)+'" y="'+y.toFixed(1)+'" font-family="Arial,Helvetica,sans-serif" font-size="'+fs.toFixed(1)+'" font-weight="bold" letter-spacing="1.6" fill="#5c3a15" opacity=".85">RAW</text>';
      });
    }
  }
  return svgURI(W,H,s);
}

/* the open mouth end — you look straight into the rolled crutch */
function capBg(c){
  const id=c.fi.id;
  if(id==="glass") return "radial-gradient(circle at 38% 32%,rgba(255,255,255,.85) 0 10%,rgba(255,255,255,0) 34%),radial-gradient(circle at 50% 50%,#0a1418 0 32%,#a8d5e2 34%,#eafbff 60%,#7fb2c2 100%)";
  if(id==="carbon") return "radial-gradient(circle at 50% 50%,#050505 0 62%,#1d1d1d 64%,#d7c69d 78%,#b9a476 100%)";
  const c1 = id==="raw" ? "#bd8842" : "#d7c69d";
  const c2 = id==="raw" ? "#8c5f28" : "#a08d63";
  return "repeating-radial-gradient(circle at 50% 50%,"+c1+" 0 2.2px,"+c2+" 2.2px 3.6px),radial-gradient(circle at 50% 50%,#1a1206 0 18%,transparent 30%)";
}

/* ---- texture baking ----
   An SVG background is re-rasterised by the browser for every element that uses
   it, and there are ~300 faces — that drops the page to 1fps. So each texture is
   drawn once into a canvas and handed to the faces as a PNG, which the browser
   decodes a single time and then just blits. A flat colour stands in for the
   few milliseconds the bake takes. */
const TEXBAKE={};
function setTex(el, prop, key, svg, w, h, flat, gen){
  if(TEXBAKE[key]){ el.style.setProperty(prop, TEXBAKE[key]); return; }
  el.style.setProperty(prop, "linear-gradient("+flat+","+flat+")");
  const img=new Image();
  img.onload=function(){
    let css;
    try{
      const dpr=Math.min(2, window.devicePixelRatio||1);
      const cv=document.createElement("canvas");
      cv.width=Math.max(1,Math.round(w*dpr)); cv.height=Math.max(1,Math.round(h*dpr));
      const x=cv.getContext("2d"); x.imageSmoothingQuality="high";
      x.drawImage(img,0,0,cv.width,cv.height);
      css='url("'+cv.toDataURL("image/png")+'")';
      TEXBAKE[key]=css;
    }catch(e){ css='url("'+svg+'")'; }        // canvas blocked — fall back to the SVG
    if(J.gen===gen) el.style.setProperty(prop, css);
  };
  img.onerror=function(){ if(J.gen===gen) el.style.setProperty(prop,'url("'+svg+'")'); };
  img.src=svg;
}

function renderJoint(){
  const spinEl=document.getElementById("jSpin"), tilt=document.getElementById("jTilt");
  if(!spinEl||!tilt) return;
  const gen=J.gen=(J.gen||0)+1;
  const G=jointGeom(), c=G.c, N=J.N, P=G.P;
  const rC=G.rC, rT=G.rT;
  const TH=Math.max(24,Math.round(2*Math.PI*rT));      // body texture height = circumference at the fat end
  const FH=Math.max(20,Math.round(2*Math.PI*rC));      // ...and around the crutch
  /* Paper runs unbroken from the crutch to the cut end. The two spare pixels are
     for the strip overlap: each strip is drawn a shade wider than the section it
     covers so neighbours meet, and along X the texture does not tile, so without
     that margin the last strip's overlap has no image under it. */
  const BW=G.BL+G.RIM+2;
  const FW=G.CL+2;                                     // …same margin around the crutch
  /* The ground-flower face, square, clipped to a circle. Baked at three times the
     radius rather than at it: the tip is the one part of the model the customer
     leans in on, and a texture baked at its on-screen size goes soft the moment
     the stage scales up on a wide viewport. */
  const BD=Math.max(112,Math.round(rT*3.4));

  // textures live on CSS variables so every face shares one copy of each
  const sheet=sheetOf(c.p), fbase=({raw:"#bd8842",carbon:"#2b2b2b",glass:"#cbe7ef"})[c.fi.id]||"#d7c69d";
  setTex(spinEl,"--btex",["b",c.p.id,c.f.id,c.h.id,c.r.id,BW,TH].join("|"),  bodyTex(c,BW,TH),      BW, TH, sheet, gen);
  setTex(spinEl,"--ftex",["f",c.fi.id,FW,FH].join("|"),                       filterTex(c,FW,FH),    FW, FH, fbase, gen);
  setTex(spinEl,"--budtex",["g",c.f.id,BD].join("|"),                         budTex(c.f,BD,BD,17),  BD, BD, budPal(c.f).dark, gen);

  const T=Math.tan(Math.PI/N), DEG=180/Math.PI;
  let html="";
  for(let i=0;i<N;i++){
    const a=(i*360/N).toFixed(3);
    const yF=(-i*FH/N).toFixed(2);
    for(let k=0;k<P.length-1;k++){
      const A=P[k], B=P[k+1], len=B.x-A.x;
      if(len<=0) continue;
      const dr=B.r-A.r, slant=Math.hypot(len,dr), beta=(-Math.atan2(dr,len)*DEG).toFixed(3);
      // Face box is sized for the wide end so neighbouring strips always meet.
      // The strictly-correct shape is a trapezoid, but clipping ~300 elements
      // every frame costs more than it is worth: the overshoot at the narrow
      // end works out well under a pixel, and the strips overlap rather than gap.
      const rr=(A.r+B.r)/2;
      const h=2*Math.max(A.r,B.r)*T+1.8;
      /* This ring is only 2πr around, so the sheet has to be squeezed to that
         height before it is sliced into N strips. Using one height for the whole
         model is what tore the brand print apart: every ring narrower than the
         packed end was showing the wrong slice of paper. */
      const THi=Math.max(6, TH*rr/rT), yB=(-i*THi/N).toFixed(2);
      // which texture this ring belongs to, and where it sits inside it
      let bg;
      if(B.x<=G.CL)      bg="background-image:var(--ftex);background-size:"+FW+"px "+FH+"px;background-position:"+(-A.x)+"px "+yF+"px";
      else if(B.x<=G.FL) bg="background-image:var(--btex);background-size:"+BW+"px "+THi.toFixed(2)+"px;background-position:0 "+yB+"px";   // paper lapped over the crutch
      else               bg="background-image:var(--btex);background-size:"+BW+"px "+THi.toFixed(2)+"px;background-position:"+(-(A.x-G.FL))+"px "+yB+"px";
      html+='<i class="j-f" style="top:50%;margin-top:'+(-h/2).toFixed(2)+'px;height:'+h.toFixed(2)+'px;left:'+A.x+
            'px;width:'+(slant+0.6).toFixed(2)+'px;transform:rotateX('+a+'deg) translateZ('+A.r.toFixed(2)+'px) rotateY('+beta+
            'deg);'+bg+'"></i>';
    }
  }
  // the open mouth end — you look straight into the rolled crutch
  html+='<i class="j-cap" style="left:'+(-rC).toFixed(1)+'px;width:'+(rC*2).toFixed(1)+'px;height:'+(rC*2).toFixed(1)+
        'px;margin-top:'+(-rC).toFixed(1)+'px;transform:rotateY(-90deg);background:'+capBg(c)+'"></i>';
  /* The packed end, in two parts. First the plug: a short band of ground flower
     just proud of the cut paper, so the strain colour is visible from the side —
     the end disc on its own is edge-on for most of every turn and reads as a
     hole. Then the disc itself, for when the tip swings towards the camera. */
  const rB=rT*0.94, BHi=Math.max(6, TH*rB/rT), bh=2*rB*T+1.8;
  for(let i=0;i<N;i++){
    html+='<i class="j-f" style="top:50%;margin-top:'+(-bh/2).toFixed(2)+'px;height:'+bh.toFixed(2)+
          'px;left:'+(G.paperEnd-1).toFixed(1)+'px;width:'+(G.PLUG+1.6).toFixed(2)+
          'px;transform:rotateX('+(i*360/N).toFixed(3)+'deg) translateZ('+rB.toFixed(2)+'px);'+
          'background-image:var(--budtex);background-size:'+BD+'px '+BHi.toFixed(2)+
          'px;background-position:0 '+(-i*BHi/N).toFixed(2)+'px"></i>';
  }
  html+='<i class="j-bud" style="left:'+(G.total-rB).toFixed(1)+'px;width:'+(rB*2).toFixed(1)+'px;height:'+(rB*2).toFixed(1)+
        'px;margin-top:'+(-rB).toFixed(1)+'px;transform:rotateY(90deg);'+
        'background-image:var(--budtex);background-size:100% 100%;'+
        // just enough inner shadow to sit the flower down inside the paper — any
        // more and the face goes black and the strain colour, the whole point of
        // this surface, is lost
        'box-shadow:inset 0 0 '+(rB*0.42).toFixed(1)+'px '+(rB*0.05).toFixed(1)+'px rgba(0,0,0,.42)"></i>';
  // the cut paper edge, standing a little proud of the flower
  html+='<i class="j-cap" style="left:'+(G.paperEnd-rT).toFixed(1)+'px;width:'+(rT*2).toFixed(1)+'px;height:'+(rT*2).toFixed(1)+
        'px;margin-top:'+(-rT).toFixed(1)+'px;transform:rotateY(90deg);background:transparent;'+
        'box-shadow:inset 0 0 0 '+Math.max(1.4,rT*0.075).toFixed(1)+'px '+shade(sheet,-6)+
        ',inset 0 0 '+(rT*0.34).toFixed(1)+'px rgba(0,0,0,.45)"></i>';
  spinEl.innerHTML=html;

  // frame
  const boxH=Math.ceil(rT*2+8);
  tilt.style.width=G.total+"px";
  tilt.style.height=boxH+"px";
  tilt.style.marginLeft=(-G.total/2)+"px";
  tilt.style.marginTop=(-boxH/2)+"px";

  // fixed lighting plane — sits just in front of the tube and never rotates, so the
  // highlight stays put while the paper turns underneath it. Its silhouette is the
  // profile itself, so the shading hugs the real shape of the cone.
  const H2=rT*2+2;
  const top=P.map(q=>(100*q.x/G.total).toFixed(2)+"% "+(50-100*q.r/H2).toFixed(2)+"%");
  const bot=P.slice().reverse().map(q=>(100*q.x/G.total).toFixed(2)+"% "+(50+100*q.r/H2).toFixed(2)+"%");
  const light=document.getElementById("jLight");
  light.style.cssText="position:absolute;left:0;top:50%;pointer-events:none;width:"+G.total+"px;height:"+H2.toFixed(1)+
    "px;margin-top:"+(-H2/2).toFixed(1)+"px;transform:translateZ("+(rT+1.1).toFixed(1)+"px);"+
    "clip-path:polygon("+top.concat(bot).join(",")+");"+
    /* Paper is matte: the falloff has to be wide and soft, and there can only be
       ONE broad highlight. The earlier version stepped light-dark-light-dark down
       the curve, and those bands are read as turned grain — the single thing that
       most made this look like a wooden dowel rather than a rolled paper. */
    "background:linear-gradient(to bottom,rgba(0,0,0,.26) 0%,rgba(0,0,0,.13) 8%,"+
    "rgba(255,255,255,.05) 20%,rgba(255,255,255,.14) 32%,rgba(255,255,255,.08) 44%,"+
    "rgba(0,0,0,0) 56%,rgba(0,0,0,.08) 70%,rgba(0,0,0,.20) 84%,rgba(0,0,0,.30) 100%)";

  // soft sheen — paper is matte, so this stays gentle unless there's resin on board
  const gloss=c.r.id==="rosin"?.22:c.r.id==="live"?.16:.09;
  const spec=document.getElementById("jSpec");
  spec.style.cssText="position:absolute;left:0;top:50%;pointer-events:none;width:"+(G.FL+G.BL)+"px;height:"+(rT*0.40).toFixed(1)+
    "px;margin-top:"+(-rT*0.66).toFixed(1)+"px;transform:translateZ("+(rT+1.6).toFixed(1)+"px);opacity:"+gloss+
    ";border-radius:50%;background:linear-gradient(to right,rgba(255,255,255,0) 0%,rgba(255,255,255,.18) 20%,"+
    "rgba(255,255,255,.44) 52%,rgba(255,255,255,.18) 76%,rgba(255,255,255,0) 96%)";

  const sh=document.getElementById("jShadow");
  if(sh){ sh.style.width=(G.total*0.82)+"px"; sh.style.marginLeft=(-G.total*0.41)+"px"; }

  fitJoint();
  startJoint();

  tilt.classList.add("fade");
  requestAnimationFrame(()=>requestAnimationFrame(()=>tilt.classList.remove("fade")));
}

/* scale the model so it always fits the card, on any screen */
function fitJoint(){
  const st=document.getElementById("jStage"), tilt=document.getElementById("jTilt");
  if(!st||!tilt) return;
  const G=jointGeom();
  const rad=TILT*Math.PI/180, cs=Math.cos(rad), sn=Math.sin(rad);
  const boxW=G.total*cs+G.rT*2*sn;                 // the leaning joint's real footprint
  const boxH=G.total*sn+G.rT*2*cs;
  const avail=Math.max(180,st.clientWidth-16);
  const availH=Math.max(120,st.clientHeight-38);
  J.sc=Math.max(.38,Math.min(1.1, Math.min(avail/boxW, availH/boxH)));
  const s=J.sc.toFixed(3);
  /* Negative yaw swings the packed end towards the camera. It has to be negative:
     +x is the packed end, and a positive rotateY pushes +x away from the viewer,
     which hides the ground-flower face — the one surface that shows the strain. */
  tilt.style.transform="scale3d("+s+","+s+","+s+") rotateZ(-"+TILT+"deg) rotateY(-26deg)";
}

/* auto-rotate + drag to spin */
function startJoint(){
  if(J.started) return;
  J.started=true;
  try{ J.reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(e){}
  if(J.reduced){ J.auto=0; J.vel=0; J.spin=-18; }

  const st=document.getElementById("jStage");
  let lx=0, ly=0, moved=0;
  const stop=()=>{ if(!J.drag)return; J.drag=false; st.classList.remove("dragging"); };
  if(st){
    st.addEventListener("pointerdown",e=>{
      J.drag=true; moved=0; lx=e.clientX; ly=e.clientY;
      st.classList.add("dragging");
      const h=document.getElementById("jHint"); if(h) h.classList.add("gone");
      try{ st.setPointerCapture(e.pointerId); }catch(err){}
    });
    st.addEventListener("pointermove",e=>{
      if(!J.drag) return;
      const dx=e.clientX-lx, dy=e.clientY-ly; lx=e.clientX; ly=e.clientY;
      const d=(dx+dy)*0.55;
      moved+=Math.abs(d);
      J.spin=(J.spin+d)%360; J.vel=d;
    });
    st.addEventListener("pointerup",stop);
    st.addEventListener("pointercancel",stop);
    st.addEventListener("pointerleave",stop);
  }
  window.addEventListener("resize",()=>fitJoint());

  (function tick(){
    requestAnimationFrame(tick);
    const el=document.getElementById("jSpin"); if(!el) return;
    if(!J.drag){
      J.spin=(J.spin+J.vel)%360;
      J.vel+=(J.auto-J.vel)*0.05;           // momentum eases back to cruise speed
    }
    el.style.transform="rotateX("+J.spin.toFixed(2)+"deg)";
  })();

  setTimeout(()=>{ const h=document.getElementById("jHint"); if(h) h.classList.add("gone"); },7000);
}

// lighten/darken a hex color by percent
function shade(hex,pct){
  let h=hex.replace('#',''); if(h.length===3)h=h.split('').map(c=>c+c).join('');
  let r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  const f=t=>Math.max(0,Math.min(255,Math.round(t+(pct/100)*255)));
  return `#${[f(r),f(g),f(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}`;
}

/* ---------- animated price count-up ---------- */
let priceAnim={cur:0};
function animateTotal(to){
  const els=[document.getElementById("totalTop"),document.getElementById("totalGrand"),document.getElementById("totalMob")];
  const from=priceAnim.cur, start=performance.now(), dur=520;
  function tick(now){
    const t=Math.min(1,(now-start)/dur), e=1-Math.pow(1-t,3);
    const v=from+(to-from)*e;
    els.forEach(el=>{if(el)el.textContent=money(v);});
    if(t<1)requestAnimationFrame(tick); else priceAnim.cur=to;
  }
  requestAnimationFrame(tick);
}

/* ---------- interaction ---------- */
function pick(key,id){
  if(state[key]===id && key!=='flowerId') { return; }
  state[key]=id;
  if(key==='flowerId'){ renderSelFlower(); renderFlowerList(); }
  if(key==='weightId') renderWeights();
  if(key==='resinId') renderOpts('resin',RESIN,'resinId');
  if(key==='hashId') renderOpts('hash',HASH,'hashId');
  if(key==='filterId') renderOpts('filter',FILTER,'filterId');
  if(key==='paperId') renderPaper();
  renderSummary(); renderJoint();
  animateTotal(calc().total);
}
function toggleBrowse(){
  const list=document.getElementById("flowerList");
  const show=list.style.display==="none";
  list.style.display=show?"grid":"none";
  document.getElementById("browseBtn").textContent=show?"HIDE FLOWERS":"BROWSE ALL FLOWERS";
  renderSelFlower();
}
/* =========================================================
   REAL CART — shares localStorage with the shop (index.html),
   which stores its basket under "dank_cart". Adding a joint here
   puts a proper line item in that same basket, so Checkout,
   delivery, promos and payment all work exactly as they do for
   any other product.
   ========================================================= */
const CART_KEY="dank_cart";
function readCart(){ try{ const v=localStorage.getItem(CART_KEY); const a=v?JSON.parse(v):[]; return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function writeCart(a){ try{ localStorage.setItem(CART_KEY,JSON.stringify(a)); return true; }catch(e){ return false; } }
function cartCount(){ return readCart().reduce((s,c)=>s+(Number(c.qty)||0),0); }
function refreshCartBadge(){
  const el=document.getElementById("cartCnt"); if(!el) return;
  el.textContent=cartCount();
  el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
}

/* the exact line-item shape index.html expects:
   {key,id,shId,name,tierLabel,price,qty,image,type,category} */
function jointLine(){
  const c=calc();
  const extras=[];
  if(c.r.id!=="none") extras.push(c.r.name);
  if(c.h.id!=="none") extras.push(c.h.name);
  extras.push(c.fi.name, c.p.name+" paper");
  return {
    key:"byj|"+[state.flowerId,state.weightId,state.resinId,state.hashId,state.filterId,state.paperId].join("-"),
    id:"byj-custom", shId:"",
    name:"Custom Joint · "+c.f.name,
    tierLabel:c.w.label+" · "+extras.join(" · "),
    price:Math.round(c.total), qty:1,
    image:"", type:"Pre-roll", category:"Build Your Joint",
    byj:{flower:c.f.name, thc:c.f.thc, type:c.f.type, weight:c.w.label, grams:c.w.g,
         resin:c.r.name, hash:c.h.name, filter:c.fi.name, paper:c.p.name}
  };
}

function addToCart(then){
  const line=jointLine();
  const cart=readCart();
  const found=cart.find(x=>x.key===line.key);
  // Checkout must never quietly add a second joint — if this exact build is
  // already in the basket, just take the customer through to pay for it.
  if(found){ if(!then) found.qty=(Number(found.qty)||0)+1; }
  else cart.push(line);
  if(!writeCart(cart)){ showToast("Couldn't save your cart — check browser settings"); return; }
  refreshCartBadge();
  if(then==="checkout"){ location.href="index.html?checkout=1"; return; }
  if(then==="cart"){ location.href="index.html?cart=1"; return; }
  showToast(`Joint added · ${money(line.price)} — tap Checkout to pay`);
}
function checkoutNow(){ addToCart("checkout"); }
function openCartPage(){ location.href="index.html?cart=1"; }
let toastT;
function showToast(msg){
  const t=document.getElementById("toast");
  document.getElementById("toastMsg").textContent=msg;
  t.classList.add("show"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),2200);
}

/* ---------- init ---------- */
function init(){
  renderSelFlower(); renderFlowerList(); renderWeights();
  renderOpts('resin',RESIN,'resinId'); renderOpts('hash',HASH,'hashId'); renderOpts('filter',FILTER,'filterId');
  renderPaper(); renderSummary(); renderJoint();
  priceAnim.cur=0; animateTotal(calc().total);
  refreshCartBadge();   // show anything already in the shop's basket
}
init();
</script>
<script src="i18n.js"></script>
</body>
</html>
