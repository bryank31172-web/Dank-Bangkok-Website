import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryLineHandler, createRidersHandler, deliveryOrderCard, RIDERS_KEY} from '../api/_delivery-line.js';
import {key, terminalKey} from '../api/_delivery.js';
const managerId = 'U' + 'a'.repeat(32), riderId = 'U' + 'b'.repeat(32), group = 'C' + 'c'.repeat(32);
function fixture() {
  const db = new Map(), messages = [], counts = new Map(); let ready = true, pushOK = true;
  const accounts = [{id:'manager',name:'Manager',phone:'+66811111111',role:'manager'}, {id:'rider',name:'Rider',phone:'+66822222222',role:'parttime'}];
  db.set(RIDERS_KEY, [{accountId:'manager',lineUserId:managerId,onShift:false},{accountId:'rider',lineUserId:riderId,onShift:true}]);
  db.set(key('DR-TEST'), {orderId:'DR-TEST',customerToken:'customer',expiresAt:Date.now()+60000,destination:{lat:13.7,lng:100.5},driver:null});
  db.set('order:DR-TEST', {status:'new',delivery:{address:'Sample address'}});
  const deps = {get:async k=>structuredClone(db.get(k)||null), accounts:async()=>accounts, ready:()=>ready,
    write:async(k,v)=>db.set(k,structuredClone(v)), token:()=> 'driver-token', uuid:()=> 'e6d9aefd-7cab-4c16-b9f2-fae4d6ac908f', group:()=>group,
    claim:async k=>{const n=(counts.get(k)||0)+1;counts.set(k,n);return n;},
    send:async(to,content,options={})=>{messages.push({to,content,options});return {ok:options.reply||pushOK};},
    permission:(req,res,p)=>{if(req.headers?.authorization==='manager'&&p==='staff_manage')return true;res.status(403).json({error:'forbidden'});return false;}};
  const handle = createDeliveryLineHandler(deps);
  const ev = (action='choose', extras={}) => ({type:'postback',replyToken:'reply',source:{type:'group',groupId:group,userId:managerId},postback:{data:new URLSearchParams({delivery:action,id:'DR-TEST',rider:'rider'}).toString()},...extras});
  return {db,messages,accounts,deps,handle,ev,counts,setReady:v=>ready=v,setPush:v=>pushOK=v};
}
test('order card has customer tracking and group rider selection, no driver credential',()=>{
  const card = deliveryOrderCard({orderId:'DR-TEST',items:[{name:'Sandwich',qty:1}],total:100},'/delivery.html#id=DR-TEST&token=customer');
  const buttons=card.contents.footer.contents;
  assert.equal(buttons[0].action.uri,'https://www.dankbangkok.com/delivery.html#id=DR-TEST&token=customer');
  assert.equal(buttons[1].action.type,'postback');
  assert.doesNotMatch(JSON.stringify(card),/driver-delivery|driver-token/);
});
test('group selection shows only on-shift registered riders and pushes private controls directly',async()=>{
  const f=fixture();await f.handle(f.ev());const picker=f.messages[0];assert.equal(picker.content[0].quickReply.items.length,1);
  assert.equal(picker.content[0].quickReply.items[0].action.label,'Rider');
  await f.handle(f.ev('assign'));const push=f.messages.find(m=>m.to===riderId);
  assert.match(push.content[0].text,/driver-delivery.html#id=DR-TEST&token=driver-token/);
  assert.equal(push.options.retryKey,f.db.get(key('DR-TEST')).driver.retryKey);
  assert.equal(f.db.get(key('DR-TEST')).driver.accountId,'rider');
  assert.ok(f.messages.filter(m=>m.options.reply).every(m=>!JSON.stringify(m.content).includes('driver-token')));
});
test('unknown actor, wrong group and private-chat postbacks cannot assign',async()=>{
  for(const source of [{type:'group',groupId:group,userId:'unknown'},{type:'group',groupId:'wrong',userId:managerId},{type:'user',userId:managerId}]){
    const f=fixture();await f.handle(f.ev('assign',{source}));assert.equal(f.db.get(key('DR-TEST')).driver,null);assert.equal(f.messages.some(m=>m.to===riderId),false);
  }
});
test('off-shift, inactive, invalid-phone, expired and terminal orders cannot assign',async()=>{
  const edits=[f=>f.db.get(RIDERS_KEY)[1].onShift=false,f=>f.accounts[1].active=false,f=>f.accounts[1].phone='',f=>f.db.get(key('DR-TEST')).expiresAt=0,f=>f.db.set(terminalKey('DR-TEST'),{status:'completed'}),f=>f.db.get('order:DR-TEST').status='cancelled',f=>f.db.get(key('DR-TEST')).destination=null];
  for(const edit of edits){const f=fixture();edit(f);await f.handle(f.ev('assign'));assert.equal(f.db.get(key('DR-TEST')).driver,null);assert.equal(f.messages.some(m=>m.to===riderId),false);}
});
test('twenty simultaneous selections create just one assignment',async()=>{
  const f=fixture();await Promise.all(Array.from({length:20},()=>f.handle(f.ev('assign'))));
  assert.equal(f.messages.filter(m=>m.to===riderId).length,1);assert.equal(f.db.get(key('DR-TEST')).driver.accountId,'rider');
});
test('failed direct push can retry with the same token and LINE retry key',async()=>{
  const f=fixture();f.setPush(false);await f.handle(f.ev('assign'));assert.match(f.messages.at(-1).content[0].text,/could not accept/);
  const first=f.messages.find(m=>m.to===riderId);f.setPush(true);await f.handle(f.ev('assign'));
  const pushes=f.messages.filter(m=>m.to===riderId);assert.equal(pushes[1].options.retryKey,first.options.retryKey);assert.equal(pushes[1].content[0].text,first.content[0].text);
});
test('storage failure refuses dispatch even if counter falls back to memory',async()=>{
  const f=fixture();f.deps.claim=async()=>{f.setReady(false);return 1;};const handle=createDeliveryLineHandler(f.deps);await handle(f.ev('assign'));
  assert.equal(f.db.get(key('DR-TEST')).driver,null);assert.equal(f.messages.some(m=>m.to===riderId),false);
});
test('private rider id command replies only to the requesting chat',async()=>{
  const f=fixture();assert.equal(await f.handle({type:'message',source:{type:'user',userId:riderId},message:{text:'rider id'},replyToken:'own-reply'}),true);
  assert.equal(f.messages[0].to,'own-reply');assert.equal(f.messages[0].options.reply,true);assert.match(f.messages[0].content[0].text,new RegExp(riderId));
});
test('only staff managers can save validated unique LINE rider configuration',async()=>{
  const f=fixture(),handler=createRidersHandler(f.deps);
  async function call(riders,authorization='manager') {const res={code:200,status(c){this.code=c;return this;},json(j){this.data=j;return this;}};await handler({method:'POST',headers:{authorization},body:{riders}},res);return res;}
  assert.equal((await call([{accountId:'rider',lineUserId:riderId,onShift:true}])).code,200);
  for(const rows of [[{accountId:'invented',lineUserId:riderId,onShift:true}],[{accountId:'rider',lineUserId:'my-line-name',onShift:true}],[{accountId:'rider',lineUserId:riderId,onShift:'yes'}],[{accountId:'rider',lineUserId:riderId,onShift:true},{accountId:'manager',lineUserId:riderId,onShift:false}]])assert.equal((await call(rows)).code,400);
  assert.equal((await call([],'rider')).code,403);
});
