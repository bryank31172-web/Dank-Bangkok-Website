import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryFeeForKm, deliveryQuote } from '../api/_delivery-fee.js';
import etaHandler from '../api/eta.js';
import orderHandler from '../api/order.js';
process.env.GOOGLE_MAPS_API_KEY='test-key';
process.env.SHOP_BRANCHES=JSON.stringify([{id:'test',name:'Test branch',origin:'13.7,100.5'}]);

const routeOf=meters=>async(url)=>{
 assert.match(String(url),/routes\.googleapis\.com/);
 return {ok:true,json:async()=>({routes:[{duration:'600s',distanceMeters:meters}]})};
};
async function withFetch(fake,fn){const original=globalThis.fetch;globalThis.fetch=fake;try{return await fn()}finally{globalThis.fetch=original}}
let ip=0;
async function call(handler,body){
 const res={code:200,setHeader(){},status(c){this.code=c;return this},json(j){this.data=j;return this},end(){return this}};
 await handler({method:'POST',headers:{'x-forwarded-for':'fee-tests-'+(++ip)},body},res);return res;
}
const order=(extra={})=>({items:[{name:'Test item',option:'1g',qty:2,price:300,lineTotal:600}],customer:{name:'Test',phone:'+66 81-234-5678'},fulfilment:'delivery',payment:'Cash',deliveryFee:0,delivery:{coordinates:{lat:13.75,lng:100.55},zone:'Somewhere in Bangkok',address:'Lobby'},...extra});

test('first 3 km are free, the 4th costs 60 and each km after adds 15',()=>{
 assert.equal(deliveryFeeForKm(0),0);
 assert.equal(deliveryFeeForKm(2.4),0);
 assert.equal(deliveryFeeForKm(3),0);
 assert.equal(deliveryFeeForKm(3.1),60);
 assert.equal(deliveryFeeForKm(4),60);
 assert.equal(deliveryFeeForKm(5),75);
 assert.equal(deliveryFeeForKm(6),90);
 assert.equal(deliveryFeeForKm(10),150);
 assert.equal(deliveryFeeForKm(4.0000001),60,'float noise must not add a km');
 assert.equal(deliveryFeeForKm(null),null);
 assert.equal(deliveryFeeForKm(-1),null);
 assert.equal(deliveryFeeForKm('abc'),null);
});

test('a missing distance falls back to the flat 100 and says so',()=>{
 assert.deepEqual(deliveryQuote(null),{ok:false,fee:100,km:null,fallback:true});
 assert.deepEqual(deliveryQuote({ok:true,km:null}),{ok:false,fee:100,km:null,fallback:true});
 assert.equal(deliveryQuote({ok:true,km:5.2}).fee,90);
});

test('/api/eta returns the delivery quote with the ETA',async()=>{
 const res=await withFetch(routeOf(5200),()=>call(etaHandler,{destLat:13.75,destLng:100.55}));
 assert.equal(res.code,200);
 assert.equal(res.data.km,5.2);
 assert.deepEqual({fee:res.data.delivery.fee,billedKm:res.data.delivery.billedKm,fallback:res.data.delivery.fallback},{fee:90,billedKm:6,fallback:false});
});

test('the order charges the distance fee worked out on the server, not the one the browser sent',async()=>{
 const res=await withFetch(routeOf(7000),()=>call(orderHandler,order()));
 assert.equal(res.code,200,JSON.stringify(res.data));
 const {getJSON}=await import('../api/_store.js');
 const saved=await getJSON('order:'+res.data.orderId);
 assert.equal(saved.deliveryFee,105);
 assert.equal(saved.total,600+105);
 assert.equal(saved.delivery.km,7);
 assert.equal(saved.delivery.feeFallback,false);
});

test('within 3 km the order is delivered free',async()=>{
 const res=await withFetch(routeOf(2500),()=>call(orderHandler,order({deliveryFee:999})));
 const {getJSON}=await import('../api/_store.js');
 const saved=await getJSON('order:'+res.data.orderId);
 assert.equal(saved.deliveryFee,0);
 assert.equal(saved.total,600);
});

test('when routing fails the order still goes through at the flat 100, flagged for staff',async()=>{
 const res=await withFetch(async()=>{throw new Error('offline')},()=>call(orderHandler,order()));
 assert.equal(res.code,200);
 const {getJSON}=await import('../api/_store.js');
 const saved=await getJSON('order:'+res.data.orderId);
 assert.equal(saved.deliveryFee,100);
 assert.equal(saved.delivery.feeFallback,true);
});

test('table orders never pay delivery and make no route call',async()=>{
 let routed=0;
 const res=await withFetch(async()=>{routed++;throw new Error('should not route')},()=>call(orderHandler,order({fulfilment:'table',table:'C3',delivery:{}})));
 assert.equal(res.code,200);
 const {getJSON}=await import('../api/_store.js');
 const saved=await getJSON('order:'+res.data.orderId);
 assert.equal(saved.deliveryFee,0);
 assert.equal(routed,0);
});
