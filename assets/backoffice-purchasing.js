const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={draft:'แบบร่าง',ordered:'สั่งซื้อแล้ว',receiving:'รับบางส่วน',completed:'รับครบ',cancelled:'ยกเลิก',closed:'ปิดก่อนรับครบ'};
const num=v=>Number(v||0).toLocaleString('en-US',{maximumFractionDigits:3});
const when=v=>v?new Date(v).toLocaleString('th-TH-u-ca-gregory',{timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const day=v=>String(v||'').slice(0,10);
const identity=i=>i.item_type+':'+i.item_key;
const options=(items,value)=>items.map(i=>`<option value="${esc(i.id)}" ${i.id===value?'selected':''}>${esc(i.name)}</option>`).join('');
let S;
const requests=new Map();
const active=()=>S?.element?.isConnected;
const supplier=id=>S.data.suppliers.find(s=>s.id===id)?.name||id;
const store=id=>S.data.stores.find(s=>s.id===id)?.name||id;
const item=l=>S.data.items.find(i=>identity(i)===identity(l));
const name=l=>l.item_name||item(l)?.name||l.item_key;
const unit=l=>l.unit||item(l)?.unit||'รอยืนยันหน่วย';
export async function mount(root,opts){
 if(!document.querySelector('[data-purchasing-css]')){const css=document.createElement('link');css.rel='stylesheet';css.href='assets/backoffice-purchasing.css';css.dataset.purchasingCss='1';document.head.append(css);}
 const old=S?.root===root?S:null;
 S={root,opts,filters:old?.filters||{store:opts.store==='all'?'':opts.store||'',supplier:'',status:'',search:''},data:null,rows:[],offset:0,next:null,selected:new Set(),focus:opts.focus||null,loading:0};
 root.innerHTML=`<div data-purchasing-root>${opts.breadcrumb('ใบสั่งซื้อ',[['inventory','การจัดการสต็อก']])}<div id="poWorkspace">กำลังโหลดใบสั่งซื้อ…</div></div>`;
 S.element=root.querySelector('[data-purchasing-root]');
 S.element.addEventListener('click',click);S.element.addEventListener('change',change);
 await load();if(S.focus){const focus=S.focus;S.focus=null;await open(focus);}
}
async function send(action,payload,method='POST'){
 const body={action,...payload},key=method+JSON.stringify(body);if(!requests.has(key))requests.set(key,crypto.randomUUID());
 const result=await S.opts.send('/api/backoffice/purchase-orders',method,{...body,request_id:requests.get(key)});requests.delete(key);return result;
}
async function load(more=false){
 const current=S,token=++S.loading;
 try{
  const data=await S.opts.get('/api/backoffice/purchase-orders?'+new URLSearchParams({...S.filters,view:'workspace',offset:more?S.next||0:0}));
  if(S!==current||!active()||token!==S.loading)return;
  S.rows=more?[...S.rows,...data.rows]:data.rows;S.data=data;S.next=data.nextOffset;S.selected.clear();render();
 }catch(error){if(S===current&&active()){S.element.querySelector('#poWorkspace').innerHTML=`<div class="card"><h2>ใบสั่งซื้อ</h2><p role="alert">${esc(error.message)}</p><button class="btn ghost" data-po="refresh">ลองอีกครั้ง</button><button class="btn ghost" data-po="inventory">กลับสต็อก</button></div>`;}}
}
function render(){
 const can=S.data.permissions.purchasing;
 S.element.querySelector('#poWorkspace').innerHTML=`<div class="po-heading"><div><h2>ใบสั่งซื้อ</h2><p class="muted">ติดตามตั้งแต่สั่งซื้อจนรับจริง · รับเฉพาะจำนวนที่มาถึงในแต่ละรอบ</p></div><div class="row"><button class="btn ghost" data-po="inventory">สต็อกทั้งหมด</button><button class="btn ghost" data-po="suppliers">ซัพพลายเออร์</button><button class="btn" data-po="create" ${can?'':'disabled'}>+ สร้างใบสั่งซื้อ</button></div></div>
 <form class="po-filters"><input name="search" value="${esc(S.filters.search)}" placeholder="ค้นหาเลขที่ใบสั่งซื้อ" aria-label="เลขที่ใบสั่งซื้อ"><select name="store" aria-label="สาขา"><option value="">ทุกสาขา</option>${options(S.data.stores,S.filters.store)}</select><select name="supplier" aria-label="ซัพพลายเออร์"><option value="">ทุกซัพพลายเออร์</option>${options(S.data.suppliers,S.filters.supplier)}</select><select name="status" aria-label="สถานะ"><option value="">ทุกสถานะ</option>${Object.entries(labels).map(([key,label])=>`<option value="${key}" ${S.filters.status===key?'selected':''}>${label}</option>`).join('')}</select><button class="btn ghost" type="submit">ค้นหา</button><button class="btn ghost" type="button" data-po="refresh">รีเฟรช</button></form>
 <p class="muted">แสดง ${S.rows.length} เอกสาร${S.next!==null?' · ยังมีรายการก่อนหน้า':''} · ไม่รวมจำนวนต่างหน่วยเข้าด้วยกัน</p>
 <div class="card po-list">${S.rows.map(po=>`<button class="po-document" data-po="open" data-id="${esc(po.id)}"><span><strong>${esc(po.po_number)}</strong><small>${esc(supplier(po.supplier_id))} · ${esc(store(po.store_id))}</small></span><span><span class="badge ${po.status==='completed'?'ok':''}">${labels[po.status]||esc(po.status)}</span><small>กำหนดรับ ${esc(day(po.expected_date)||'ยังไม่ระบุ')}</small></span><span>${po.lines.length} รายการ<small>${po.lines.filter(l=>Number(l.qty_received)+Number(l.qty_cancelled||0)<Number(l.qty_ordered)).length} รายการยังรับไม่ครบ</small></span><span>เปิดรายละเอียด →</span></button>`).join('')||'<p class="muted">ไม่พบใบสั่งซื้อที่ตรงกับตัวกรอง</p>'}</div>${S.next!==null?'<button class="btn ghost" data-po="more">โหลดรายการก่อนหน้า</button>':''}`;
 S.element.querySelector('.po-filters').addEventListener('submit',e=>{e.preventDefault();S.filters=Object.fromEntries(new FormData(e.target));load();});
}
function dialog(title,html,submit){
 document.querySelector('#poDialog')?.remove();const d=document.createElement('dialog');d.id='poDialog';d.className='po-dialog';
 d.setAttribute('aria-labelledby','poDialogTitle');d.innerHTML=`<h3 id="poDialogTitle" tabindex="-1" autofocus>${esc(title)}</h3><form class="po-form">${html}<p class="po-error" role="alert"></p><div class="row po-footer"><button type="button" class="btn ghost" data-close>ปิด</button>${submit?'<button type="submit" class="btn">ยืนยันและบันทึก</button>':''}</div></form>`;document.body.append(d);
 d.querySelector('[data-close]').addEventListener('click',()=>{if(!d.dataset.busy)d.close();});d.addEventListener('cancel',e=>{if(d.dataset.busy)e.preventDefault();});
 if(submit)d.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();if(d.dataset.busy)return;d.dataset.busy='1';const button=e.submitter||d.querySelector('[type=submit]');button.disabled=true;try{await submit(new FormData(e.target),d);}catch(error){d.querySelector('[role=alert]').textContent=error.message;}finally{delete d.dataset.busy;button.disabled=false;}});
 for(const table of d.querySelectorAll('table')){const headings=[...table.querySelectorAll('thead th')].map(th=>th.textContent);for(const row of table.querySelectorAll('tbody tr'))[...row.children].forEach((td,i)=>td.dataset.label=headings[i]||'');}
 d.showModal();d.scrollTop=0;return d;
}
function edit(po=null){
 const chosen=(po?.lines||[]).map(l=>({...l}));
 const d=dialog(po?'แก้ไข '+po.po_number:'สร้างใบสั่งซื้อ',`<div class="po-fields"><label>ซัพพลายเออร์<select name="supplier_id" required><option value="">เลือกซัพพลายเออร์</option>${options(S.data.suppliers.filter(s=>s.active!==false),po?.supplier_id)}</select></label><label>สาขารับสินค้า<select name="store_id" required><option value="">เลือกสาขา</option>${options(S.data.stores.filter(s=>s.active!==false),po?.store_id||S.filters.store)}</select></label><label>วันที่คาดว่าจะรับ<input type="date" name="expected_date" value="${esc(day(po?.expected_date))}"></label></div><label>ค้นหาและเพิ่มสินค้า<input id="poItemSearch" placeholder="ชื่อ / SKU / บาร์โค้ด" autocomplete="off"></label><div id="poItemResults" class="po-picker"></div><div id="poChosen"></div><label>หมายเหตุ<textarea name="note" maxlength="500">${esc(po?.note||'')}</textarea></label><p class="muted">เลือกได้เฉพาะสินค้าที่ยืนยันหน่วยแล้วในหน้าสต็อก · สร้างแบบร่างยังไม่เพิ่มสต็อก</p>`,async(f,d)=>{
  if(!chosen.length)throw Error('เลือกสินค้าอย่างน้อยหนึ่งรายการ');
  const result=await send(po?'edit':'create',{...(po?{id:po.id,expected_revision:po.revision}:{}),supplier_id:f.get('supplier_id'),store_id:f.get('store_id'),expected_date:f.get('expected_date'),note:f.get('note'),lines:chosen.map((l,i)=>({item_type:l.item_type,item_key:l.item_key,qty_ordered:Number(f.get('qty-'+i)),unit_cost:Number(f.get('cost-'+i))}))},po?'PATCH':'POST');d.close();await load();await open(result.id);
 });
 function preserve(){chosen.forEach((l,i)=>{const q=d.querySelector(`[name="qty-${i}"]`),c=d.querySelector(`[name="cost-${i}"]`);if(q)l.qty_ordered=q.value;if(c)l.unit_cost=c.value;});}
 function draw(){d.querySelector('#poChosen').innerHTML=`<div class="po-scroll"><table><thead><tr><th>สินค้า / หน่วย</th><th>จำนวนสั่ง</th><th>ต้นทุน/หน่วย (THB)</th><th></th></tr></thead><tbody>${chosen.map((l,i)=>`<tr><td data-label="สินค้า / หน่วย">${esc(name(l))}<small>${esc(unit(l))}</small></td><td data-label="จำนวนสั่ง"><input type="number" name="qty-${i}" min="${10**-(item(l)?.precision??3)}" step="${10**-(item(l)?.precision??3)}" max="999999999" value="${esc(l.qty_ordered)}" required></td><td data-label="ต้นทุน/หน่วย (THB)"><input type="number" name="cost-${i}" min="0" step="0.01" max="999999999" value="${esc(l.unit_cost)}" required></td><td data-label="ลบรายการ"><button type="button" class="btn ghost" data-remove="${i}" aria-label="ลบ ${esc(name(l))}">×</button></td></tr>`).join('')}</tbody></table></div>`;}
 function results(){const q=d.querySelector('#poItemSearch').value.trim().toLowerCase(),matches=S.data.items.filter(i=>![...chosen].some(l=>identity(l)===identity(i))&&[i.name,i.sku,i.barcode,i.item_key].some(v=>String(v||'').toLowerCase().includes(q))).slice(0,15);d.querySelector('#poItemResults').innerHTML=matches.map(i=>`<button type="button" data-item="${esc(identity(i))}"><strong>${esc(i.name)}</strong><small>${esc(i.sku||i.item_key)} · ${esc(i.unit)}</small><span>+ เพิ่ม</span></button>`).join('')||'<p class="muted">ไม่พบสินค้า · ยืนยันหน่วยสินค้าที่หน้าสต็อกก่อน</p>';}
 d.addEventListener('click',e=>{const add=e.target.closest('[data-item]'),remove=e.target.closest('[data-remove]');if(add){preserve();const i=S.data.items.find(i=>identity(i)===add.dataset.item);chosen.push({...i,item_name:i.name,qty_ordered:1,unit_cost:0});draw();results();}if(remove){preserve();chosen.splice(Number(remove.dataset.remove),1);draw();results();}});
 d.querySelector('#poItemSearch').addEventListener('input',results);draw();results();
}
async function open(id){
 const current=S,response=await S.opts.get('/api/backoffice/purchase-orders?id='+encodeURIComponent(id));if(S!==current||!active())return;
 const po=response.rows[0];if(!po)throw Error('ไม่พบใบสั่งซื้อ');const can=response.permissions.purchasing;
 const d=dialog(po.po_number,`<div class="po-summary"><span class="badge">${labels[po.status]}</span><p>${esc(supplier(po.supplier_id))} → ${esc(store(po.store_id))}</p><p class="muted">กำหนดรับ ${esc(day(po.expected_date)||'ยังไม่ระบุ')} · ผู้สร้าง ${esc(po.created_by)}</p><p>${esc(po.note||'')}</p></div><div class="po-scroll"><table><thead><tr><th>สินค้า / หน่วย</th><th>สั่ง</th><th>รับแล้ว</th><th>ค้างรับ</th><th>ยุติการรับ</th>${can?'<th>ต้นทุน/หน่วย</th>':''}</tr></thead><tbody>${po.lines.map(l=>`<tr><td>${esc(name(l))}<small>${esc(unit(l))}</small></td><td>${num(l.qty_ordered)}</td><td>${num(l.qty_received)}</td><td>${num(Number(l.qty_ordered)-Number(l.qty_received)-Number(l.qty_cancelled||0))}</td><td>${num(l.qty_cancelled)}</td>${can?`<td>THB ${num(l.unit_cost)}</td>`:''}</tr>`).join('')}</tbody></table></div><div class="row po-actions">${can&&po.status==='draft'?'<button class="btn ghost" type="button" data-edit>แก้ไขแบบร่าง</button><button class="btn" type="button" data-send>ยืนยันสั่งซื้อ</button>':''}${can&&['ordered','receiving'].includes(po.status)?'<button class="btn" type="button" data-receive>บันทึกรับสินค้า</button><button class="btn ghost" type="button" data-close-order>ยุติการรับส่วนที่เหลือ</button>':''}${can&&['draft','ordered'].includes(po.status)?'<button class="btn ghost" type="button" data-cancel>ยกเลิกใบสั่งซื้อ</button>':''}</div><h4>ประวัติเอกสารและการรับแต่ละรอบ</h4>${response.events.map(event=>`<div class="po-event"><strong>${esc({po_create:'สร้างแบบร่าง',po_edit:'แก้ไขแบบร่าง',po_send:'ยืนยันสั่งซื้อ',po_cancel:'ยกเลิก',po_receive:'รับสินค้า',po_close:'ปิดก่อนรับครบ'}[event.action]||event.action)}</strong> · ${when(event.created_at)} · ${esc(event.actor)}<p>${esc(event.data.note||'')}</p>${event.data.lines.map(l=>`<small>${esc(name(l))} ${event.action==='po_close'?'ยุติการรับ '+num(l.qty_cancelled):'+'+num(l.qty)} ${esc(l.unit||unit(l))}</small>`).join('')}</div>`).join('')||'<p class="muted">เอกสารเดิมยังไม่มีประวัติรับแยกรอบ</p>'}`,null);
 d.querySelector('[data-edit]')?.addEventListener('click',()=>{d.close();edit(po);});
 d.querySelector('[data-send]')?.addEventListener('click',()=>confirm(po,'send'));
 d.querySelector('[data-cancel]')?.addEventListener('click',()=>confirm(po,'cancel'));
 d.querySelector('[data-close-order]')?.addEventListener('click',()=>closeOrder(po));
 d.querySelector('[data-receive]')?.addEventListener('click',()=>receive(po));
}
function confirm(po,action){dialog(action==='send'?'ยืนยันสั่งซื้อ':'ยกเลิกใบสั่งซื้อ',`<p>${esc(po.po_number)} · ${esc(supplier(po.supplier_id))}</p><p>${action==='send'?'หลังยืนยันจะล็อกรายการสินค้า พร้อมบันทึกรับสินค้าเมื่อของมาถึง ยังไม่เพิ่มสต็อก':'ยกเลิกเอกสารนี้โดยไม่เปลี่ยนสต็อก'}</p><label>หมายเหตุ / เหตุผล<textarea name="note" maxlength="500" ${action==='cancel'?'required minlength="3"':''}></textarea></label><label class="po-check"><input type="checkbox" required> ตรวจสอบแล้ว ยืนยันทำรายการ</label>`,async(f,d)=>{await send(action,{id:po.id,expected_revision:po.revision,note:f.get('note')});d.close();await load();open(po.id);});}
function closeOrder(po){dialog('ยุติการรับส่วนที่เหลือ',`<p>${esc(po.po_number)} · จำนวนที่รับแล้วคงเดิม ส่วนที่เหลือจะบันทึกเป็นยุติการรับ ไม่เพิ่มหรือลดสต็อก</p><label>เหตุผล<textarea name="note" required minlength="3" maxlength="500"></textarea></label><label class="po-check"><input type="checkbox" required> ตรวจสอบแล้ว และยืนยันปิดส่วนค้างรับ</label>`,async(f,d)=>{await send('close',{id:po.id,expected_revision:po.revision,note:f.get('note')});d.close();await load();await open(po.id);});}
function receive(po){
 const pending=po.lines.filter(l=>Number(l.qty_received)+Number(l.qty_cancelled||0)<Number(l.qty_ordered));
 const d=dialog('รับสินค้า · '+po.po_number,`<p>กรอกเฉพาะจำนวนที่รับจริงในรอบนี้ · เว้นว่างหรือ 0 = ยังไม่รับ</p><div class="po-scroll"><table><thead><tr><th>สินค้า / หน่วย</th><th>สั่ง / รับแล้ว</th><th>ค้างรับ</th><th>รับรอบนี้</th><th>เหลือหลังรับ</th></tr></thead><tbody>${pending.map((l,i)=>`<tr><td>${esc(name(l))}<small>${esc(unit(l))}</small></td><td>${num(l.qty_ordered)} / ${num(l.qty_received)}</td><td>${num(Number(l.qty_ordered)-Number(l.qty_received)-Number(l.qty_cancelled||0))}</td><td><input data-receipt="${i}" name="receive-${i}" type="number" min="0" max="${Number(l.qty_ordered)-Number(l.qty_received)-Number(l.qty_cancelled||0)}" step="${10**-(item(l)?.precision??3)}" placeholder="0"></td><td data-remaining="${i}">${num(Number(l.qty_ordered)-Number(l.qty_received)-Number(l.qty_cancelled||0))}</td></tr>`).join('')}</tbody></table></div><label>เลขที่ใบส่งของ / หมายเหตุ<textarea name="note" maxlength="500"></textarea></label><label class="po-check"><input type="checkbox" required> ตรวจจำนวนจริงแล้ว เพิ่มสต็อกเฉพาะจำนวนที่รับรอบนี้</label>`,async(f,d)=>{
  const lines=pending.map((l,i)=>({line_id:l.id,qty_received:Number(f.get('receive-'+i))})).filter(l=>l.qty_received>0);if(!lines.length)throw Error('กรอกจำนวนรับอย่างน้อยหนึ่งรายการ');
  await send('receive',{id:po.id,expected_revision:po.revision,note:f.get('note'),lines});d.close();await load();await open(po.id);S.opts.restock?.(po.po_number);
 });
 d.addEventListener('input',e=>{if(e.target.dataset.receipt===undefined)return;const i=Number(e.target.dataset.receipt),l=pending[i];d.querySelector(`[data-remaining="${i}"]`).textContent=num(Number(l.qty_ordered)-Number(l.qty_received)-Number(l.qty_cancelled||0)-Number(e.target.value));});
}
async function click(e){const b=e.target.closest('[data-po]');if(!b)return;try{switch(b.dataset.po){case'create':edit();break;case'open':await open(b.dataset.id);break;case'refresh':await load();break;case'more':await load(true);break;case'inventory':S.opts.navigate('inventory');break;case'suppliers':S.opts.navigate('suppliers');break;}}catch(error){S.opts.toast(error.message,true);}}
function change(e){if(e.target.closest('.po-filters')&&e.target.tagName==='SELECT'){S.filters=Object.fromEntries(new FormData(e.target.form));load();}}
