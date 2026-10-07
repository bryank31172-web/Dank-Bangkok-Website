function createRiderSheet(sheetId,handleId){
  const sheet=document.getElementById(sheetId),handle=document.getElementById(handleId);
  let height,drag,wasActive=false,dragged=false;
  const viewport=()=>window.visualViewport?.height||window.innerHeight;
  function resize(value){height=Math.max(156,Math.min(viewport()*0.78,viewport()-200,value));document.documentElement.style.setProperty('--rider-sheet-height',height+'px');const expanded=height>viewport()*0.5;handle.setAttribute('aria-expanded',String(expanded));handle.setAttribute('aria-label',expanded?'Collapse delivery details':'Expand delivery details');window.dispatchEvent(new Event('rider-sheet-resize'));}
  handle.addEventListener('pointerdown',e=>{drag={id:e.pointerId,y:e.clientY,height:sheet.getBoundingClientRect().height};dragged=false;handle.setPointerCapture(e.pointerId);});
  handle.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;if(Math.abs(e.clientY-drag.y)>4)dragged=true;resize(drag.height+drag.y-e.clientY);});
  handle.addEventListener('pointerup',()=>{drag=null;});
  handle.addEventListener('pointercancel',()=>{drag=null;});
  handle.addEventListener('click',()=>{if(dragged){dragged=false;return;}resize((height||sheet.getBoundingClientRect().height)>viewport()*0.5?240:viewport()*0.7);});
  window.addEventListener('resize',()=>{if(height)resize(height);});
  return {setActive(active){if(active&&!wasActive)resize(240);wasActive=active;}};
}
