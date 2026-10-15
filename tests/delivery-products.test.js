import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogHandler } from '../api/delivery-products.js';
import { configuredProductIds, catalogProducts, eligible, PRODUCTS_CONFIG_KEY } from '../api/_delivery.js';
const menu=[{shId:'food',name:'Sandwich',category:'Food',price:120},{name:'Shirt',category:'Merchandise',priceTiers:[{shId:'shirt-m',label:'M',price:300}]},{shId:'restricted',name:'THC snack',category:'Food'}];
function fixture(){
 let config=null,source='pos',ready=true;const writes=[];
 const handler=createCatalogHandler({ready:()=>ready,menu:async()=>({source,data:menu}),get:async()=>config,write:async(k,v)=>{writes.push(k);config=v},permission:(req,res,p)=>{if(req.headers.authorization==='manager'&&p==='products')return true;res.status(403).json({error:'forbidden'});return false}});
 async function call(method='GET',ids,credential='manager'){const res={code:200,setHeader(){},status(c){this.code=c;return this},json(j){this.data=j;return this}};await handler({method,headers:{authorization:credential},body:{ids}},res);return res}
 return{call,writes,setSource:s=>source=s,setReady:v=>ready=v};
}
test('live database catalog lists every product with names and SKU tiers',async()=>{
 const f=fixture(),r=await f.call();assert.equal(r.code,200);assert.deepEqual(r.data.products.map(p=>p.id).sort(),['food','restricted','shirt-m']);assert.equal(r.data.all,false);assert.equal(r.data.source,'pos');assert.equal(r.data.products.find(p=>p.id==='shirt-m').option,'M');
});
test('selection persists in database and controls checkout eligibility',async()=>{
 const f=fixture();assert.equal((await f.call('POST',['food','food'])).code,200);assert.deepEqual(f.writes,[PRODUCTS_CONFIG_KEY]);const r=await f.call();assert.deepEqual(r.data.ids,['food']);assert.equal(eligible({fulfilment:'delivery',items:[{shId:'food'}]},menu,r.data.ids),true);assert.equal(eligible({fulfilment:'delivery',items:[{shId:'shirt-m'}]},menu,r.data.ids),false);
});
test('unknown and removed IDs cannot be saved; orders permission alone cannot configure',async()=>{
 const f=fixture();for(const ids of [['unknown'],'food'])assert.equal((await f.call('POST',ids)).code,400);assert.equal((await f.call('POST',['food'],'driver')).code,403);assert.deepEqual(f.writes,[]);
});
test('bundled fallback and database outage fail closed',async()=>{
 const f=fixture();f.setSource('bundled');assert.equal((await f.call()).code,503);assert.equal((await f.call('POST',['food'])).code,503);f.setSource('pos');f.setReady(false);assert.equal((await f.call()).code,503);assert.deepEqual(f.writes,[]);
});
test('saved empty selection overrides legacy env configuration',async()=>{
 assert.deepEqual(configuredProductIds(null,'food'),['food']);assert.deepEqual(configuredProductIds({ids:[]},'food'),[]);assert.deepEqual(configuredProductIds({ids:['shirt-m']},'food'),['shirt-m']);assert.deepEqual(configuredProductIds({ids:'food'},'food'),[]);
});
test('a changed live product or removed SKU no longer qualifies',()=>{
 const order={fulfilment:'delivery',items:[{shId:'food'}]};assert.equal(eligible(order,[],['food']),false);assert.deepEqual(catalogProducts([{shId:'hidden',name:'Hidden',category:'Other',_hidden:true}]),[]);
});

test('Track every product: saved switch makes every delivery order eligible, including new POS products',async()=>{
 const f=fixture();const res={code:200,setHeader(){},status(c){this.code=c;return this},json(j){this.data=j;return this}};
 const h=createCatalogHandler({ready:()=>true,menu:async()=>({source:'pos',data:menu}),get:async()=>null,write:async()=>{},permission:()=>true});
 await h({method:'POST',headers:{},body:{ids:[],all:true}},res);assert.equal(res.code,200);assert.equal(res.data.all,true);
 const order={fulfilment:'delivery',items:[{shId:'added-later'}]};
 assert.equal(eligible(order,menu,[],true),true);assert.equal(eligible(order,menu,[],false),false);
 assert.equal(eligible({...order,fulfilment:'pickup'},menu,[],true),false);assert.equal(eligible({fulfilment:'delivery',items:[]},menu,[],true),false);
});
