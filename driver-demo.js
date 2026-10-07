// Only sample state is shared. Real GPS and uploaded photos never leave this page.
async function demoCall(session,role,action){const r=await fetch('/api/delivery-demo'+(action?'':'?id='+session.id+'&role='+role),{method:action?'POST':'GET',headers:{'Content-Type':'application/json','X-Demo-Token':session.token},body:action?JSON.stringify({id:session.id,role,action}):undefined,cache:'no-store',signal:AbortSignal.timeout(10000)});const j=await r.json();if(!r.ok)throw Error(j.error||'Demo unavailable');return j;}
function demoView(state,data){
 const full=data.route?.polyline?decodeDeliveryRoute(data.route.polyline):[],index=state.index||0,destination=data.destination||{lat:13.7463,lng:100.5346};
 const offset=index*(full.length-1)/19,a=Math.max(0,Math.floor(offset)),b=Math.min(full.length-1,a+1),t=offset-a;
 const position=full.length>1?{lat:full[a].lat+(full[b].lat-full[a].lat)*t,lng:full[a].lng+(full[b].lng-full[a].lng)*t}:{lat:13.7108+(destination.lat-13.7108)*index/19,lng:100.5375+(destination.lng-100.5375)*index/19};
 const route=full.length>1?{...data.route,minutes:Math.max(1,Math.round(data.route.minutes*(1-index/20))),km:Math.round(data.route.km*(1-index/20)*10)/10}:null;
 const ended=state.status==='completed',moving=state.status==='on_the_way'&&!state.paused;
 return {customer:ended?null:{name:'Demo customer',phone:''},orderId:'DEMO-RIDER',status:state.status,demo:true,address:'Siam Paragon · sample delivery only',destinationLabel:'Siam Paragon',destination:ended?null:destination,location:moving?{...position,accuracy:5,capturedAt:state.updatedAt,route}:null,stale:!moving||Date.now()-state.updatedAt>210000,departurePhoto:!ended&&state.photo?'/assets/delivery-demo-photo.svg':null,departurePhotoRequired:true,driver:ended?null:{name:'Simulated rider',phone:'',photo:''},items:[{name:'Sample sandwich (test only)',qty:1}],total:100};
}
function createRiderDemo(){
 const hash=new URLSearchParams(location.hash.slice(1));let session={id:hash.get('session'),token:hash.get('token')},data={},state={index:0,status:'preparing',photo:false,updatedAt:Date.now()};
 const ready=(async()=>{
   if(!session.id){const r=await fetch('/api/delivery-demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create'}),signal:AbortSignal.timeout(10000)});const j=await r.json();if(!r.ok)throw Error(j.error||'Could not create demo');session={id:j.id,token:j.riderToken};history.replaceState(null,'','?demo=1#'+new URLSearchParams({session:j.id,token:j.riderToken}));
     const link=document.createElement('a');link.className='hidden';link.href='/delivery.html?demo=1#'+new URLSearchParams({session:j.id,token:j.customerToken});link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open linked customer demo';document.querySelector('.rider-sheet-body').prepend(link);
   }
   try{const r=await fetch('/api/delivery?action=demo-route',{signal:AbortSignal.timeout(10000)});if(r.ok)data=await r.json();}catch{}
 })();ready.catch(()=>{});
 return {next(){return demoView(state,data).location||{lat:13.7108,lng:100.5375,accuracy:5,capturedAt:Date.now()};},async request(action){await ready;const mapped={'departure-photo':'photo',location:'move'};state=await demoCall(session,'rider',mapped[action]||action);return action?{ok:true}:demoView(state,data);}};
}
async function startLinkedDeliveryDemo(){
 const h=new URLSearchParams(location.hash.slice(1)),session={id:h.get('session'),token:h.get('token')};let data={},poll;
 const banner=document.createElement('section');banner.className='error demo-panel';banner.textContent='Linked customer demo · sample order only. Rider actions update this page every 5 seconds. No real GPS or LINE messages.';document.querySelector('main').prepend(banner);
 try{const r=await fetch('/api/delivery?action=demo-route',{signal:AbortSignal.timeout(10000)});if(r.ok)data=await r.json();}catch{}
 async function refresh(){try{const state=await demoCall(session,'customer');el('error').classList.add('hidden');render(demoView(state,data));if(state.status==='completed')clearInterval(poll);}catch(e){showError(e.message);}}
 poll=setInterval(refresh,5000);await refresh();
}
