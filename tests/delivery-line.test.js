import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryLineHandler, createRidersHandler, deliveryOrderCard, createLinkCard, customerLinkCard, whatsappNumber, RIDERS_KEY} from '../api/_delivery-line.js';
import {key, terminalKey} from '../api/_delivery.js';
const managerId = 'U' + 'a'.repeat(32), riderId = 'U' + 'b'.repeat(32), group = 'C' + 'c'.repeat(32);
function fixture() {
  const db = new Map(), messages = [], counts = new Map(); let ready = true, pushOK = true;
  const accounts = [{id:'manager',name:'Manager',phone:'+66811111111',role:'manager'}, {id:'rider',name:'Rider',phone:'+66822222222',role:'parttime'}];
  db.set(RIDERS_KEY, [{accountId:'manager',lineUserId:managerId,onShift:false},{accountId:'rider',lineUserId:riderId,onShift:true}]);
  db.set(key('DR-TEST'), {orderId:'DR-TEST',customerToken:null,expiresAt:Date.now()+60000,destination:{lat:13.7,lng:100.5},driver:null});
  db.set('order:DR-TEST', {orderId:'DR-TEST',status:'new',customer:{name:'Ann',phone:'+66 81-234-5678'},delivery:{address:'Sample address'}});
  const deps = {get:async k=>structuredClone(db.get(k)||null), accounts:async()=>accounts, ready:()=>ready,
    write:async(k,v)=>db.set(k,structuredClone(v)), token:(()=>{let n=0;return()=>++n===1?'driver-token':'customer-token-'+n})(), uuid:()=> 'e6d9aefd-7cab-4c16-b9f2-fae4d6ac908f', group:()=>group,
    claim:async k=>{const n=(counts.get(k)||0)+1;counts.set(k,n);return n;},
    send:async(to,content,options={})=>{messages.push({to,content,options});return {ok:options.reply||pushOK};},
    permission:(req,res,p)=>{if(req.headers?.authorization==='manager'&&p==='staff_manage')return true;res.status(403).json({error:'forbidden'});return false;}};
  const handle = createDeliveryLineHandler(deps);
  const ev = (action='choose', extras={}) => ({type:'postback',replyToken:'reply',source:{type:'group',groupId:group,userId:managerId},postback:{data:new URLSearchParams({delivery:action,id:'DR-TEST',rider:'rider'}).toString()},...extras});
  return {db,messages,accounts,deps,handle,ev,counts,setReady:v=>ready=v,setPush:v=>pushOK=v};
}
test('new order card offers rider selection only: no customer or rider link yet',()=>{
  const card = deliveryOrderCard({orderId:'DR-TEST',items:[{name:'Sandwich',qty:1}],total:100});
  const buttons=card.contents.footer.contents;
  assert.equal(buttons[0].action.type,'postback');
  assert.equal(buttons[0].action.label,'Choose rider');
  assert.doesNotMatch(JSON.stringify(card),/delivery\.html|driver-delivery|token/);
});
test('choosing a rider makes the rider link first, then the customer link, posted in the group',async()=>{
  const f=fixture();
  await f.handle(f.ev());
  assert.equal(f.db.get(key('DR-TEST')).customerToken,null,'showing the rider list must not make a customer link');
  await f.handle(f.ev('assign'));
  const record=f.db.get(key('DR-TEST'));
  assert.equal(record.driver.token,'driver-token');
  assert.match(record.customerToken,/^customer-token-/);
  const group=f.messages.at(-1);
  assert.equal(group.to,'reply');
  assert.match(group.content[0].text,/Rider delivery link:/);
  const card=group.content[1];
  assert.equal(card.contents.body.contents[0].text,'CUSTOMER TRACKING LINK');
  const [wa,open]=card.contents.footer.contents;
  assert.equal(open.action.uri,'https://www.dankbangkok.com/delivery.html#id=DR-TEST&token='+record.customerToken);
  assert.match(wa.action.uri,/^https:\/\/wa\.me\/66812345678\?text=/);
  assert.match(decodeURIComponent(wa.action.uri),new RegExp('Hi Ann, your DANK order DR-TEST is on its way with Rider[\\s\\S]*token='+record.customerToken));
  assert.doesNotMatch(JSON.stringify(card),/driver-token/,'the customer card must never carry the rider credential');
  const rider=f.messages.find(m=>m.to===riderId);
  assert.doesNotMatch(JSON.stringify(rider.content),/customer-token/);
});
test('tapping the rider again resends the same rider and customer links',async()=>{
  const f=fixture();await f.handle(f.ev('assign'));const first=f.db.get(key('DR-TEST')).customerToken;
  await f.handle(f.ev('assign'));
  assert.equal(f.db.get(key('DR-TEST')).customerToken,first);
  assert.match(f.messages.at(-1).content[1].contents.footer.contents[1].action.uri,new RegExp('token='+first+'$'));
});
test('WhatsApp numbers: international kept, Thai local gets 66, junk is dropped',()=>{
  assert.equal(whatsappNumber('+66 81-234-5678'),'66812345678');
  assert.equal(whatsappNumber('081 234 5678'),'66812345678');
  assert.equal(whatsappNumber('+44 7700 900123'),'447700900123');
  assert.equal(whatsappNumber('TABLE-C3'),'');
  assert.equal(whatsappNumber(''),'');
  const noPhone=customerLinkCard({orderId:'DR-1',customer:{name:'Bo'}},'https://x/delivery.html#t');
  assert.equal(noPhone.contents.footer.contents.length,1);
  assert.equal(noPhone.contents.footer.contents[0].action.label,'Open customer link');
});
test('group selection assigns an on-shift rider and shares the same link privately and in the staff group',async()=>{
  const f=fixture();await f.handle(f.ev());const picker=f.messages[0];assert.equal(picker.content[0].quickReply.items.length,1);
  assert.equal(picker.content[0].quickReply.items[0].action.label,'Rider');
  await f.handle(f.ev('assign'));const push=f.messages.find(m=>m.to===riderId);
  assert.match(push.content[0].text,/driver-delivery.html#id=DR-TEST&token=driver-token/);
  assert.equal(push.options.retryKey,f.db.get(key('DR-TEST')).driver.retryKey);
  assert.equal(f.db.get(key('DR-TEST')).driver.accountId,'rider');
  assert.doesNotMatch(JSON.stringify(picker.content),/driver-token/);
  assert.match(f.messages.at(-1).content[0].text,/Rider delivery link:\nhttps:\/\/www.dankbangkok.com\/driver-delivery.html#id=DR-TEST&token=driver-token/);
  assert.match(f.messages.at(-1).content[0].text,/LINE accepted/);
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
  assert.match(f.messages.at(-1).content[0].text,/Rider delivery link:/);
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
test('LINE form: "delivery" in the staff group opens the form; card gets a form button only when configured',async()=>{
  const f=fixture(),msg=(text,source={type:'group',groupId:group,userId:managerId})=>({type:'message',replyToken:'r',source,message:{type:'text',text}});
  assert.equal(await f.handle(msg('delivery')),false);
  const plain=deliveryOrderCard({orderId:'DR-TEST',items:[]});assert.equal(plain.contents.footer.contents.length,1);
  process.env.LINE_LIFF_ID='1234567890-AbCdEfGh';
  try{
    assert.equal(await f.handle(msg('Delivery')),true);
    assert.equal(f.messages[0].content[0].contents.footer.contents[0].action.uri,'https://liff.line.me/1234567890-AbCdEfGh');
    assert.equal(await f.handle(msg('delivery',{type:'group',groupId:'C'+'z'.repeat(32),userId:managerId})),false);
    assert.equal(await f.handle(msg('delivery',{type:'user',userId:managerId})),false);
    const card=deliveryOrderCard({orderId:'DR-TEST',items:[]});
    assert.equal(card.contents.footer.contents[1].action.uri,'https://liff.line.me/1234567890-AbCdEfGh?order=DR-TEST');
    assert.doesNotMatch(JSON.stringify(card),/driver-delivery/);
  }finally{delete process.env.LINE_LIFF_ID}
});

test('untracked delivery order card opens the LINE form for that order, only when the form is set up',()=>{
  assert.equal(createLinkCard({orderId:'DR-TEST'}),null);
  process.env.LINE_LIFF_ID='1234567890-AbCdEfGh';
  try{const c=createLinkCard({orderId:'DR-TEST'});assert.equal(c.contents.footer.contents[0].action.uri,'https://liff.line.me/1234567890-AbCdEfGh?order=DR-TEST');}
  finally{delete process.env.LINE_LIFF_ID}
});
