import {filterStock,identity,qty} from './inventory-model.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATUS={available:'มีสินค้า',low:'ใกล้หมด',out:'หมด',negative:'ติดลบ — ตรวจสอบ',unknown:'ยังไม่มีข้อมูล'};
const REASONS={manual_adjust:'ปรับจำนวน',waste:'ของเสีย',damage:'เสียหาย',receive_po:'รับจากใบสั่งซื้อ',stocktake:'ตรวจนับ',transfer_in:'รับโอน',transfer_out:'ส่งโอน',kitchen_consumption:'ใช้วัตถุดิบ'};
let S=null;const requests=new Map();
const number=(value,digits=3)=>value==null?'ยังไม่มีข้อมูล':Number(value).toLocaleString('en-US',{maximumFractionDigits:digits});
const date=value=>value?new Date(value).toLocaleString('th-TH-u-ca-gregory',{timeZone:'Asia/Bangkok',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'ยังไม่มีข้อมูล';
const itemName=(type,key)=>S.data?.items.find(i=>i.item_type===type&&i.item_key===key)?.name||key;
const storeName=id=>S.data?.stores.find(s=>s.id===id)?.name||id;
const selectOptions=(list,value)=>list.map(([id,label])=>`<option value="${esc(id)}" ${String(id)===String(value)?'selected':''}>${esc(label)}</option>`).join('');
const itemId=item=>identity(item.item_type,item.item_key);
const allowed=()=>S.data?.available&&S.data.permissions.adjust&&!S.stale;
export async function mount(root,opts={}){
  if(!document.querySelector('[data-inventory-css]')){const link=document.createElement('link');link.rel='stylesheet';link.href='assets/backoffice-inventory.css';link.dataset.inventoryCss='1';document.head.append(link);}
  const old=S?.root===root?S:null;
  S={root,opts,tab:old?.tab||'stock',filters:old?.filters||{search:'',store:opts.store||'all',category:'',status:''},sort:old?.sort||'name',direction:old?.direction||1,page:old?.page||1,size:20,data:old?.data||null,local:[],selected:new Set(),detail:null,history:[],cursor:null,stale:false,token:0};
  if(opts.focus)S.filters.search=opts.focus;
  root.innerHTML=`<div class="inv-workspace" data-inventory-root>${opts.breadcrumb?.('การจัดการสต็อก')||''}<div id="invContent"><p class="muted">กำลังโหลดข้อมูลสต็อก…</p></div></div>`;
  S.element=root.querySelector('[data-inventory-root]');
  if(!root.dataset.inventoryBound){root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',input);root.dataset.inventoryBound='1';}
  await refresh();
}
function active(){return S?.element?.isConnected&&S.root.querySelector('[data-inventory-root]')===S.element;}
async function refresh(){
  const session=S,token=++S.token;
  try{
    const [data,local]=await Promise.all([S.opts.get('/api/backoffice/inventory?view=overview'),Promise.resolve(S.opts.catalog?.()||[]).catch(()=>[])]);
    if(S!==session||token!==S.token||!active())return;
    S.data=data;S.local=local;S.stale=false;if(S.detail){S.history=[];S.cursor=null;}render();if(S.detail)await history();
  }catch(error){
    if(S!==session||!active())return;S.stale=true;
    if(S.data)render();else S.element.querySelector('#invContent').innerHTML=`<div class="inv-notice error">โหลดข้อมูลสต็อกไม่สำเร็จ: ${esc(error.message)}</div><button class="btn ghost" data-inv="refresh">ลองใหม่</button>`;
    S.opts.toast?.(error.message,true);
  }
}
function filtered(){
  const rows=filterStock(S.data.rows,S.filters);
  return rows.sort((a,b)=>{
    const key=S.sort;const av=a[key],bv=b[key];
    if(key==='quantity'&&(av==null||bv==null))return av==null?(bv==null?0:1):-1;
    return S.direction*(key==='quantity'?av-bv:String(av??'').localeCompare(String(bv??''),'th'));
  });
}
function sourceNotice(){return `<div class="inv-source"><span>แหล่งข้อมูล: สมุดสต็อก DANK แยกสาขา · POS แสดงแยกเมื่อไม่ทราบสาขา</span><span>โหลดสำเร็จล่าสุด: ${date(S.data.refreshedAt)} (เวลาไทย)</span></div>
  ${S.data.error?`<div class="inv-notice error">${esc(S.data.error)} · ยังไม่แสดงจำนวนที่ไม่ทราบเป็นศูนย์</div>`:''}
  ${S.stale?'<div class="inv-notice error">อัปเดตไม่สำเร็จ กำลังแสดงข้อมูลครั้งก่อน กรุณารีเฟรชก่อนบันทึก</div>':''}
  <div class="inv-notice">ยอดขาย POS ยังไม่ได้ตัดสมุดสต็อกนี้อัตโนมัติ จำนวน POS ไม่ถูกนำมาบวกกับจำนวนแยกสาขา ${S.data.posAt?'· POS ส่งข้อมูลล่าสุด '+date(S.data.posAt):''}</div>`;}
function render(){
  if(!active()||!S.data)return;
  if(S.detail)return renderDetail();
  const root=S.element.querySelector('#invContent');
  root.innerHTML=`<div class="workspace-heading"><div><h2>การจัดการสต็อก</h2><p class="muted">ตรวจยอดแยกสาขาและเปิดประวัติก่อนทำรายการ</p></div><div class="row"><button class="btn ghost" data-inv="purchasing">ใบสั่งซื้อ</button><button class="btn ghost" data-inv="refresh">รีเฟรช</button></div></div>
    <div class="inv-tabs" role="tablist" aria-label="งานสต็อก">${[['stock','สต็อกทั้งหมด'],['movements','ประวัติความเคลื่อนไหว'],['counts','ตรวจนับสต็อก'],['transfers','โอนระหว่างสาขา']].map(([key,label])=>`<button id="invTab-${key}" role="tab" aria-controls="invPanel" aria-selected="${S.tab===key}" data-inv="tab" data-tab="${key}">${label}</button>`).join('')}</div>
    ${sourceNotice()}<div id="invPanel" role="tabpanel" aria-labelledby="invTab-${S.tab}"></div>`;
  if(S.tab==='stock')renderStock();else if(S.tab==='movements')renderMovements();else if(S.tab==='counts')renderCounts();else renderTransfers();
}
function renderStock(){
  const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/S.size));S.page=Math.min(pages,S.page);
  const page=rows.slice((S.page-1)*S.size,S.page*S.size);
  const registered=new Set(S.data.items.filter(i=>i.registered).map(itemId));
  const localOnly=S.local.filter(i=>!registered.has(identity('product',String(i.id))));
  S.element.querySelector('#invPanel').innerHTML=`<div class="inv-toolbar"><div class="inv-toolbar-group"><details class="inv-filter"><summary>ตัวกรอง ▾</summary><div>
      <label>สาขา<select data-inv-filter="store">${selectOptions([['all','ทุกสาขา'],...S.data.stores.map(s=>[s.id,s.name]),['__pos__','POS — ไม่ระบุสาขา']],S.filters.store)}</select></label>
      <label>หมวดหมู่<select data-inv-filter="category">${selectOptions([['','ทั้งหมด'],...[...new Set(S.data.rows.map(r=>r.category).filter(Boolean))].sort().map(v=>[v,v])],S.filters.category)}</select></label>
      <label>สถานะ<select data-inv-filter="status">${selectOptions([['','ทั้งหมด'],...Object.entries(STATUS)],S.filters.status)}</select></label><button class="btn ghost" data-inv="clear">ล้างตัวกรอง</button></div></details>
      <input class="inv-search" id="invSearch" type="search" value="${esc(S.filters.search)}" placeholder="ชื่อสินค้า / SKU / บาร์โค้ด" aria-label="ค้นหาสต็อก"></div>
      <div class="inv-toolbar-group"><button class="btn ghost" data-inv="start-count" ${allowed()?'':'disabled'}>เริ่มตรวจนับ</button><button class="btn ghost" data-inv="start-transfer" ${allowed()?'':'disabled'}>สร้างรายการโอน</button><button class="btn inv-export" data-inv="csv">ส่งออก CSV</button></div></div>
    ${localOnly.length?`<div class="inv-notice inv-import-row"><span>มี ${localOnly.length} สินค้าในหน้าสินค้าที่ยังไม่ได้ยืนยันหน่วยในระบบสต็อก · จำนวนที่นำเข้าเดิมยังไม่ถือเป็นยอดแยกสาขา</span>${S.data.available&&S.data.permissions.settings?'<button class="btn ghost" data-inv="register-local">เลือกสินค้ามายืนยันหน่วย</button>':''}</div>`:''}
    ${S.data.warnings.length?`<details class="inv-notice"><summary>พบ ${S.data.warnings.length} จุดที่ต้องตรวจสอบการจับคู่รหัส</summary>${S.data.warnings.map(w=>`<div>${esc(w)}</div>`).join('')}</details>`:''}
    <div class="inv-chips"><span>${rows.length} แถวสินค้า–สาขา</span><span>ไม่รวมจำนวนต่างหน่วยเข้าด้วยกัน</span><span>เลือกแล้ว ${S.selected.size} แถว</span></div>
    <div class="card"><div class="inv-mobile-list">${page.map(row=>`<div class="inv-mobile-stock-row"><div class="inv-mobile-stock-head"><button class="inv-link" data-inv="detail" data-row="${esc(row.id)}">${esc(row.name)}<small>${esc(row.sku||row.item_key)}</small></button><div class="inv-mobile-quantity">${number(row.quantity)}<small>${esc(row.unit||'รอยืนยันหน่วย')}</small></div></div><div class="inv-mobile-stock-foot"><span>${esc(row.store_name)}<small><span class="inv-status ${row.status}">${STATUS[row.status]}</span>${row.in_transit?' · ระหว่างโอน '+number(row.in_transit):''}</small></span>${row.read_only?'<span class="muted">อ่านอย่างเดียว</span>':`<label class="inv-mobile-select"><input type="checkbox" data-inv-select="${esc(row.id)}" aria-label="เลือก ${esc(row.name)} ${esc(row.store_name)}" ${S.selected.has(row.id)?'checked':''}></label>`}</div></div>`).join('')||'<p class="inv-empty">ไม่พบสินค้าตามตัวกรอง</p>'}</div><div class="orders-table-scroll inv-stock-table"><table class="inv-overview-table"><thead><tr><th aria-label="เลือก"></th>${[['name','สินค้า / SKU'],['store_name','สาขา'],['unit','หน่วย'],['quantity','จำนวนคงเหลือ']].map(([key,label])=>`<th><button data-inv="sort" data-key="${key}">${label} ↕</button></th>`).join('')}<th>ระหว่างโอนเข้า</th><th>เกณฑ์เตือน</th><th>สถานะ</th>${S.data.permissions.costs?'<th>ต้นทุน/หน่วย</th><th>มูลค่าสต็อก</th>':''}</tr></thead><tbody>
      ${page.map(row=>`<tr><td>${!row.read_only?`<input type="checkbox" data-inv-select="${esc(row.id)}" aria-label="เลือก ${esc(row.name)} ${esc(row.store_name)}" ${S.selected.has(row.id)?'checked':''}>`:''}</td><td class="inv-name"><button class="inv-link" data-inv="detail" data-row="${esc(row.id)}">${esc(row.name)}</button><small>${esc(row.sku||row.item_key)}${row.item_type==='ingredient'?' · วัตถุดิบ':''}</small></td><td>${esc(row.store_name)}</td><td>${row.unit?esc(row.unit):'<span class="muted">รอยืนยันหน่วย</span>'}</td><td>${number(row.quantity)}</td><td>${number(row.in_transit||0)}</td><td>${row.threshold==null?'ยังไม่ตั้ง':number(row.threshold)}</td><td><span class="inv-status ${row.status}">${STATUS[row.status]}</span>${row.source==='pos'?'<small class="muted"> · อ่านอย่างเดียว</small>':''}</td>${S.data.permissions.costs?`<td>${row.cost==null?'—':number(row.cost,2)}</td><td>${row.value==null?'—':number(row.value,2)}</td>`:''}</tr>`).join('')||`<tr><td colspan="10" class="inv-empty">ไม่พบสินค้าตามตัวกรอง${!S.data.stores.length?' · ยังไม่มีข้อมูลสาขาที่เชื่อมกับสมุดสต็อก':''}</td></tr>`}
    </tbody></table></div><div class="inv-pagination"><span>แสดง ${rows.length?(S.page-1)*S.size+1:0}–${Math.min(rows.length,S.page*S.size)} จาก ${rows.length}</span><div><button class="btn ghost" data-inv="page" data-page="${S.page-1}" ${S.page===1?'disabled':''}>ก่อนหน้า</button> ${S.page}/${pages} <button class="btn ghost" data-inv="page" data-page="${S.page+1}" ${S.page===pages?'disabled':''}>ถัดไป</button></div></div></div>`;
}
function renderCounts(){
  const rows=S.data.counts;
  S.element.querySelector('#invPanel').innerHTML=`<div class="inv-toolbar"><p class="muted">ล่าสุด 100 รอบ · เว้นว่าง = ยังไม่นับ ไม่ถือเป็นศูนย์</p><button class="btn" data-inv="start-count" ${allowed()?'':'disabled'}>เริ่มตรวจนับ</button></div><div class="card orders-table-scroll"><table class="inv-doc-table"><thead><tr><th>สาขา</th><th>เริ่มนับ</th><th>ผู้เริ่มนับ</th><th>สถานะ</th><th>นับแล้ว</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td>${esc(storeName(s.store_id))}</td><td>${date(s.started_at)}</td><td>${esc(s.started_by)}</td><td>${esc(({in_progress:'กำลังนับ',completed:'เสร็จแล้ว',cancelled:'ยกเลิก'})[s.status]||s.status)}</td><td>${s.lines.filter(l=>l.counted_qty!=null).length}/${s.lines.length}</td><td><button class="inv-link" data-inv="count-open" data-id="${esc(s.id)}">เปิดรอบตรวจนับ</button></td></tr>`).join('')||'<tr><td colspan="6" class="inv-empty">ยังไม่มีรอบตรวจนับ</td></tr>'}</tbody></table></div>`;
}
function renderTransfers(){
  S.element.querySelector('#invPanel').innerHTML=`<div class="inv-toolbar"><p class="muted">รอส่ง → ระหว่างโอน → ยืนยันรับ · ระหว่างโอนไม่ถือเป็นของพร้อมขายที่ปลายทาง</p><button class="btn" data-inv="start-transfer" ${allowed()?'':'disabled'}>สร้างรายการโอน</button></div><div class="card orders-table-scroll"><table class="inv-doc-table"><thead><tr><th>เลขอ้างอิง</th><th>ต้นทาง</th><th>ปลายทาง</th><th>สถานะ</th><th>สินค้า</th><th></th></tr></thead><tbody>${S.data.transfers.map(t=>`<tr><td>${esc(t.id.slice(0,8))}</td><td>${esc(storeName(t.from_store_id))}</td><td>${esc(storeName(t.to_store_id))}</td><td>${esc(t.lines.some(l=>Number(l.qty_missing)>0)?'ปิดแล้ว · มีของขาด':t.status==='dispatched'&&t.lines.some(l=>Number(l.qty_received)>0)?'รับบางส่วน · ค้างรับ':({pending:'รอส่ง',dispatched:'ระหว่างโอน',completed:'รับครบ',cancelled:'ยกเลิก'})[t.status]||t.status)}</td><td>${t.lines.length} รายการ</td><td><button class="inv-link" data-inv="transfer-open" data-id="${esc(t.id)}">รายละเอียด</button></td></tr>`).join('')||'<tr><td colspan="6" class="inv-empty">ยังไม่มีรายการโอน</td></tr>'}</tbody></table></div>`;
}
async function openDetail(id){S.detail=id;S.history=[];S.cursor=null;renderDetail();await history();}
function renderDetail(){
  const row=S.data.rows.find(r=>r.id===S.detail);if(!row){S.detail=null;return render();}
  const branches=S.data.rows.filter(r=>r.item_type===row.item_type&&r.item_key===row.item_key&&r.source===row.source);
  S.element.querySelector('#invContent').innerHTML=`<button class="inv-link" data-inv="back">← กลับสต็อกทั้งหมด</button><div class="inv-detail-head"><div><h2>${esc(row.name)}</h2><p class="muted">${esc(row.sku||row.item_key)} · ${row.unit?esc(row.unit):'ยังไม่ได้ยืนยันหน่วย'}</p></div><div class="row">${row.read_only?'':`${S.data.permissions.settings?'<button class="btn ghost" data-inv="register">ยืนยัน / ตั้งค่าหน่วย</button>':''}<button class="btn ghost" data-inv="adjust" ${allowed()&&row.registered&&row.quantity!=null&&row.store_active?'':'disabled'}>ปรับสต็อก</button><button class="btn ghost" data-inv="start-count" ${allowed()&&row.registered?'':'disabled'}>ตรวจนับ</button><button class="btn ghost" data-inv="start-transfer" ${allowed()&&row.registered?'':'disabled'}>โอนสาขา</button>`}</div></div>${sourceNotice()}
    ${!row.registered&&!row.read_only?'<div class="inv-notice">ยืนยันหน่วยก่อนทำรายการ และตรวจนับครั้งแรกเพื่อเริ่มยอดสาขา จำนวนเดิมที่นำเข้าไม่ถูกยกมาเป็นยอดสาขาโดยอัตโนมัติ</div>':''}
    <div class="inv-detail-grid">${branches.map(r=>`<div class="card"><small>${esc(r.store_name)}</small><strong>${number(r.quantity)} ${esc(r.unit||'')}</strong><small>${STATUS[r.status]}${r.in_transit?' · ระหว่างโอนเข้า '+number(r.in_transit):''}</small><div class="row"><button class="inv-link" data-inv="detail" data-row="${esc(r.id)}">เลือกสาขานี้</button>${r.item_type==='product'&&S.data.permissions.adjust&&!r.read_only&&S.data.available?`<button class="inv-link" data-inv="threshold" data-row="${esc(r.id)}">เกณฑ์เตือน ${r.threshold==null?'ยังไม่ตั้ง':number(r.threshold)}</button>`:''}</div></div>`).join('')}</div>
    <div class="card"><h3>ประวัติความเคลื่อนไหว · ${esc(row.store_name)}</h3><p class="muted">ผู้ดำเนินการ เวลา เหตุผล และเอกสารต้นทาง</p><div id="invHistory">${row.read_only?'<p class="muted">POS ส่งเฉพาะภาพรวมจำนวน ไม่ได้ส่งประวัติความเคลื่อนไหวแยกสาขา</p>':'<p class="muted">กำลังโหลดประวัติ…</p>'}</div></div>`;
  if(S.history.length)renderHistory();
}
async function history(more=false){
  const id=S.detail,row=S.data.rows.find(r=>r.id===id);if(!row||row.read_only||!S.data.available)return;
  try{
    const response=await S.opts.get('/api/backoffice/inventory?'+new URLSearchParams({item_type:row.item_type,item_key:row.item_key,store:row.store_id,limit:'50',...(more&&S.cursor?{before_id:S.cursor}:{})}));
    if(!active()||S.detail!==id)return;S.history=more?[...S.history,...response.rows]:response.rows;S.cursor=response.nextCursor;renderHistory();
  }catch(error){if(active()&&S.detail===id)S.element.querySelector('#invHistory').innerHTML=`<p class="inv-dialog-error">โหลดประวัติไม่สำเร็จ: ${esc(error.message)}</p>`;}
}
function renderHistory(box=S.element.querySelector('#invHistory'),rows=S.history,cursor=S.cursor,all=false){
  if(!box)return;
  box.innerHTML=`<div class="orders-table-scroll"><table class="inv-doc-table"><thead><tr>${all?'<th>สินค้า / สาขา</th>':''}<th>วันที่ / เวลา</th><th>ก่อน</th><th>เปลี่ยน</th><th>หลัง</th><th>เหตุผล</th><th>ผู้ดำเนินการ / ผู้ยืนยัน</th><th>เอกสาร / หมายเหตุ</th></tr></thead><tbody>${rows.map(r=>`<tr>${all?`<td>${esc(itemName(r.item_type,r.item_key))}<small class="muted"> · ${esc(storeName(r.store_id))}</small></td>`:''}<td>${date(r.created_at)}</td><td>${number(Number(r.balance_after)-Number(r.qty_delta))}</td><td>${r.qty_delta>0?'+':''}${number(r.qty_delta)}</td><td>${number(r.balance_after)}</td><td>${esc(REASONS[r.reason]||r.reason)}</td><td>${esc(r.staff_id)}${r.approved_by?' / '+esc(r.approved_by):''}</td><td>${['stocktake','transfer'].includes(r.ref_type)?`<button class="inv-link" data-inv="${r.ref_type==='stocktake'?'count-open':'transfer-open'}" data-id="${esc(r.ref_id)}">${esc(r.ref_type==='stocktake'?'ตรวจนับ':'โอน')} ${esc(r.ref_id.slice(0,8))}</button>`:r.ref_type==='purchase_order'?`<button class="inv-link" data-inv="purchase-open" data-id="${esc(r.ref_id)}">ใบสั่งซื้อ ${esc(r.ref_id.slice(0,8))}</button>`:esc(r.ref_id||'—')}<small class="muted"> ${esc(r.note||'')}</small></td></tr>`).join('')||'<tr><td colspan="8" class="inv-empty">ยังไม่มีรายการความเคลื่อนไหว</td></tr>'}</tbody></table></div>${cursor?`<button class="btn ghost" data-inv="${all?'movements-more':'history-more'}">โหลดรายการก่อนหน้า</button>`:''}`;
}
function renderMovements(){
  S.element.querySelector('#invPanel').innerHTML=`<div class="inv-toolbar"><label>สาขา <select data-inv-movement-store>${selectOptions([['all','ทุกสาขา'],...S.data.stores.map(s=>[s.id,s.name])],S.filters.store==='__pos__'?'all':S.filters.store)}</select></label><button class="btn ghost" data-inv="movements-refresh">โหลดประวัติล่าสุด</button></div><div class="card" id="invMovements">กำลังโหลดประวัติ…</div>`;
  loadMovements().catch(()=>{});
}
async function loadMovements(more=false){
  const token=(S.movementToken||0)+1;S.movementToken=token;const current=S;
  const query={limit:'50'};if(S.filters.store!=='all'&&S.filters.store!=='__pos__')query.store=S.filters.store;
  if(more&&S.movementCursor)query.before_id=S.movementCursor;
  let result;
  try{result=await S.opts.get('/api/backoffice/inventory?'+new URLSearchParams(query));}
  catch(error){if(active()&&S===current&&S.tab==='movements'&&S.movementToken===token)S.element.querySelector('#invMovements').innerHTML=`<p class="inv-dialog-error">โหลดประวัติไม่สำเร็จ: ${esc(error.message)}</p>`;throw error;}
  if(!active()||S!==current||S.tab!=='movements'||S.movementToken!==token)return;
  S.movements=more?[...S.movements,...result.rows]:result.rows;S.movementCursor=result.nextCursor;
  renderHistory(S.element.querySelector('#invMovements'),S.movements,S.movementCursor,true);
}
function dialog(title,content,onSubmit){
  document.querySelector('#invDialog')?.remove();const d=document.createElement('dialog');d.id='invDialog';d.className='inv-dialog';
  d.setAttribute('aria-labelledby','invDialogTitle');d.innerHTML=`<h3 id="invDialogTitle" tabindex="-1" autofocus>${esc(title)}</h3><form class="inv-form">${content}<p class="inv-dialog-error" role="alert"></p><div class="row"><button class="btn ghost" type="button" data-inv-close>ปิด</button>${onSubmit?'<button class="btn" type="submit">ตรวจสอบและบันทึก</button>':''}</div></form>`;
  document.body.append(d);d.querySelector('[data-inv-close]').addEventListener('click',()=>{if(!d.dataset.busy)d.close();});
  d.addEventListener('cancel',e=>{if(d.dataset.busy)e.preventDefault();});
  if(onSubmit)d.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.submitter||event.target.querySelector('[type=submit]');button.disabled=true;d.dataset.busy='1';
    try{await onSubmit(new FormData(event.target),d);}
    catch(error){d.querySelector('[role=alert]').textContent=error.message;}
    finally{button.disabled=false;delete d.dataset.busy;}
  });for(const table of d.querySelectorAll('table')){const headings=[...table.querySelectorAll('thead th')].map(th=>th.textContent);for(const row of table.querySelectorAll('tbody tr'))[...row.children].forEach((td,i)=>td.dataset.label=headings[i]||'');}d.showModal();return d;
}
async function send(path,method,payload){
  const key=path+'|'+method+'|'+JSON.stringify(payload);if(!requests.has(key))requests.set(key,crypto.randomUUID());
  const result=await S.opts.send(path,method,{...payload,request_id:requests.get(key)});requests.delete(key);return result;
}
const detail=()=>S.data.rows.find(r=>r.id===S.detail);
const activeStores=()=>S.data.stores.filter(s=>s.active!==false).map(s=>[s.id,s.name]);
function chosenItems(){
  const rows=S.detail?[detail()]:S.data.rows.filter(r=>S.selected.has(r.id));
  const keys=new Set(rows.map(itemId));return S.data.items.filter(i=>i.registered&&(!keys.size||keys.has(itemId(i))));
}
function register(local=false){
  const choices=local?S.local.map(i=>({...i,item_type:'product',item_key:String(i.id),name:i.name,unit:i.unit||'',precision:i.unit==='g'?3:0})): [detail()];
  if(!choices.length)return;
  const selected=choices[0];
  const d=dialog('ยืนยันหน่วยสินค้า',`<p class="muted">หน่วยนี้ใช้เหมือนกันทุกสาขา เมื่อมีความเคลื่อนไหวแล้วจะไม่เปลี่ยนหน่วยโดยไม่มีการแปลงที่ตรวจสอบ</p>${local?`<label>สินค้า<select name="choice">${choices.map((p,i)=>`<option value="${i}">${esc(p.name)} · ${esc(p.sku||p.item_key)}</option>`).join('')}</select></label>`:`<p>${esc(selected.name)} · ${esc(selected.item_key)}</p>`}
    <div class="inv-form-grid"><label>หน่วยพื้นฐาน<input name="unit" required maxlength="30" value="${esc(selected.unit||selected.suggested_unit||'')}" placeholder="เช่น กรัม / ขวด / ชิ้น"></label><label>จำนวนทศนิยม<select name="precision">${selectOptions([[0,'จำนวนเต็ม เช่น ขวด/ชิ้น'],[1,'1 ตำแหน่ง'],[2,'2 ตำแหน่ง'],[3,'3 ตำแหน่ง เช่น กรัม']],selected.precision??0)}</select></label></div><label class="inv-check"><input type="checkbox" required> ตรวจสอบหน่วยกับสินค้าจริงแล้ว</label>`,async(f,d)=>{
      const item=choices[Number(f.get('choice')||0)];await send('/api/backoffice/inventory','POST',{action:'register',item_type:item.item_type,item_key:item.item_key,name:item.name,sku:item.sku||'',barcode:item.barcode||'',category:item.category||'',unit:f.get('unit'),precision:Number(f.get('precision'))});d.close();await refresh();
    });
  d.querySelector('[name=choice]')?.addEventListener('change',event=>{const item=choices[Number(event.target.value)];d.querySelector('[name=unit]').value=item.unit||'';});
}
function adjust(){
  const row=detail();if(!allowed()||!row?.registered||row.quantity==null||row.read_only)return;
  const d=dialog('ปรับสต็อก · '+row.name,`<p>${esc(row.store_name)} · คงเหลือ ${number(row.quantity)} ${esc(row.unit)}</p><label>จำนวนที่เพิ่มหรือลด<input type="number" name="delta" step="${10**-row.precision}" required placeholder="เช่น -3.5 หรือ 5"></label><label>เหตุผล<select name="reason">${selectOptions([['manual_adjust','ปรับจำนวน'],['waste','ของเสีย'],['damage','เสียหาย']],'manual_adjust')}</select></label><label>คำอธิบาย<textarea name="note" minlength="3" maxlength="500" required></textarea></label><div class="inv-preview" id="invAdjustPreview">กรอกจำนวนเพื่อดูผลก่อนบันทึก</div><label class="inv-check"><input type="checkbox" required> ตรวจสอบจำนวนก่อนและหลังแล้ว</label>`,async(f,d)=>{
    const delta=Number(f.get('delta'));if(!delta||row.quantity+delta<0)throw Error('จำนวนหลังปรับต้องไม่ติดลบ และต้องเปลี่ยนจากเดิม');
    await send('/api/backoffice/inventory','POST',{item_type:row.item_type,item_key:row.item_key,store_id:row.store_id,qty_delta:delta,reason:f.get('reason'),note:f.get('note'),expected_ledger_id:row.ledger_id});d.close();await refresh();
  });d.querySelector('[name=delta]').addEventListener('input',event=>{d.querySelector('#invAdjustPreview').textContent=`ก่อน ${number(row.quantity)} → เปลี่ยน ${event.target.value||'—'} → หลัง ${number(row.quantity+Number(event.target.value))} ${row.unit}`;});
}
function threshold(row){
  if(!allowed()||row.read_only||row.item_type!=='product')return;
  dialog('เกณฑ์แจ้งเตือน · '+row.name,`<p>${esc(row.store_name)} · หน่วย ${esc(row.unit||'ยังไม่ยืนยัน')}</p><label>เตือนเมื่อต่ำกว่า (เว้นว่างเพื่อยกเลิกเกณฑ์)<input name="threshold" type="number" min="0" step="0.001" value="${row.threshold??''}"></label>`,async(f,d)=>{
    await S.opts.send('/api/backoffice/product-settings','POST',{product_key:row.item_key,store_id:row.store_id,low_stock_threshold:f.get('threshold')===''?null:Number(f.get('threshold'))});d.close();await refresh();
  });
}
function startCount(){
  if(!allowed())return;const items=chosenItems();if(!items.length)return S.opts.toast('ยืนยันหน่วยสินค้าก่อนเริ่มตรวจนับ',true);
  const pre=detail()?.store_id||(S.filters.store!=='all'&&S.filters.store!=='__pos__'?S.filters.store:'');
  dialog('เริ่มตรวจนับสต็อก',`<label>สาขา<select name="store" required>${selectOptions([['','เลือกสาขา'],...activeStores()],pre)}</select></label><div class="inv-item-options">${items.map((item,i)=>`<label><input name="item" type="checkbox" value="${i}" ${items.length<=20?'checked':''}> ${esc(item.name)} · ${esc(item.unit)}</label>`).join('')}</div><p class="muted">เลือกไม่เกิน 200 รายการ จำนวนที่ยังไม่มีประวัติจะแสดงว่าไม่ทราบ และเริ่มยอดเมื่อยืนยันผลนับจริง</p>`,async(f,d)=>{
    const selected=f.getAll('item').map(i=>items[Number(i)]);if(!selected.length)throw Error('เลือกอย่างน้อยหนึ่งสินค้า');
    const result=await send('/api/backoffice/stocktakes','POST',{store_id:f.get('store'),items:selected.map(i=>({item_type:i.item_type,item_key:i.item_key}))});d.close();await refresh();openCount(result.id);
  });
}
async function openCount(id){
  let session=S.data.counts.find(s=>s.id===id);
  if(!session){const response=await S.opts.get('/api/backoffice/stocktakes?id='+encodeURIComponent(id));session=response.rows[0];if(session)S.data.counts.push(session);}
  if(!session)return S.opts.toast('ไม่พบรอบตรวจนับนี้',true);
  const editable=allowed()&&session.status==='in_progress';
  const d=dialog('ตรวจนับ · '+storeName(session.store_id),`<p class="muted">รอบ ${esc(session.id)} · เริ่ม ${date(session.started_at)}</p><div class="orders-table-scroll"><table><thead><tr><th>สินค้า</th><th>ตามระบบ</th><th>นับจริง</th><th>ผลต่าง</th></tr></thead><tbody>${session.lines.map((line,i)=>`<tr><td>${esc(itemName(line.item_type,line.item_key))}</td><td>${line.expected_known===false?'ยังไม่มีข้อมูล':number(line.expected_qty)}</td><td>${editable?`<input class="inv-count-input" name="count-${i}" data-count-index="${i}" type="number" min="0" step="${10**-(S.data.items.find(x=>itemId(x)===itemId(line))?.precision??3)}" value="${line.counted_qty??''}">`:line.counted_qty==null?'ยังไม่นับ':number(line.counted_qty)}</td><td data-count-delta="${i}">${line.counted_qty==null?'—':number(Number(line.counted_qty)-Number(line.expected_qty))}</td></tr>`).join('')}</tbody></table></div>${editable?'<p class="muted">เว้นว่าง = ยังไม่นับ ไม่เปลี่ยนสินค้านั้น · ถ้ามีความเคลื่อนไหวหลังเริ่มนับ ระบบจะให้ทบทวนก่อน</p><label>การบันทึก<select name="action"><option value="save">บันทึกจำนวน ยังไม่ปรับสต็อก</option><option value="complete">ยืนยันผลและจบรอบ — ปรับสต็อกตามผลต่าง</option></select></label><label class="inv-check"><input type="checkbox" name="reviewed"> ตรวจสอบจำนวนและผลต่างแล้ว (จำเป็นเมื่อจบรอบ)</label>':''}`,editable?async(f,d)=>{
    if(f.get('action')==='complete'&&!f.get('reviewed'))throw Error('กรุณายืนยันว่าตรวจสอบผลต่างแล้ว');
    const lines=session.lines.map((line,i)=>({item_type:line.item_type,item_key:line.item_key,counted_qty:f.get('count-'+i)===''?null:Number(f.get('count-'+i))}));
    await send('/api/backoffice/stocktakes','PATCH',{id:session.id,lines});
    if(f.get('action')==='complete')await send('/api/backoffice/stocktakes','POST',{id:session.id,action:'complete'});
    d.close();await refresh();openCount(session.id);
  }:null);
  d.addEventListener('input',event=>{if(event.target.dataset.countIndex===undefined)return;const i=Number(event.target.dataset.countIndex);d.querySelector(`[data-count-delta="${i}"]`).textContent=event.target.value===''?'—':number(Number(event.target.value)-Number(session.lines[i].expected_qty));});
}
function startTransfer(){
  if(!allowed())return;const items=chosenItems();if(!items.length)return S.opts.toast('ยืนยันหน่วยสินค้าก่อนโอน',true);
  const pre=detail()?.store_id||(S.filters.store!=='all'&&S.filters.store!=='__pos__'?S.filters.store:'');
  const d=dialog('สร้างรายการโอน',`<div class="inv-form-grid"><label>ต้นทาง<select name="from" required>${selectOptions([['','เลือกสาขา'],...activeStores()],pre)}</select></label><label>ปลายทาง<select name="to" required>${selectOptions([['','เลือกสาขา'],...activeStores()],'')}</select></label></div><label>ค้นหาสินค้า<input name="transfer_search" placeholder="ชื่อ / SKU / บาร์โค้ด"></label><div class="inv-item-options">${items.map((item,i)=>`<label data-transfer-index="${i}">${esc(item.name)} · ${esc(item.unit)} <input type="number" name="qty-${i}" min="0" step="${10**-item.precision}" placeholder="จำนวนที่จะโอน" style="width:110px"></label>`).join('')}</div><p class="muted">การสร้างรายการยังไม่หักของ ต้องกดส่งสินค้า แล้วให้ปลายทางยืนยันรับแยกกัน</p>`,async(f,d)=>{
    if(f.get('from')===f.get('to'))throw Error('ต้นทางและปลายทางต้องต่างกัน');
    const lines=items.map((item,i)=>({...item,qty:Number(f.get('qty-'+i))})).filter(i=>i.qty>0).map(i=>({item_type:i.item_type,item_key:i.item_key,qty:i.qty}));if(!lines.length)throw Error('กรอกจำนวนอย่างน้อยหนึ่งรายการ');
    const result=await send('/api/backoffice/transfers','POST',{from_store_id:f.get('from'),to_store_id:f.get('to'),lines});d.close();await refresh();openTransfer(result.id);
  });
  d.querySelector('[name=transfer_search]').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();for(const label of d.querySelectorAll('[data-transfer-index]')){const i=items[Number(label.dataset.transferIndex)];label.hidden=![i.name,i.sku,i.barcode,i.item_key].some(v=>String(v||'').toLowerCase().includes(q));}});
}
async function openTransfer(id){
  const current=S,response=await S.opts.get('/api/backoffice/transfers?id='+encodeURIComponent(id));if(S!==current||!active())return;
  const transfer=response.rows[0];
  if(!transfer)return S.opts.toast('ไม่พบรายการโอน',true);
  const action=transfer.status==='pending'?'dispatch':transfer.status==='dispatched'?'receive':null;
  const d=dialog('โอน '+transfer.id.slice(0,8),`<p>${esc(storeName(transfer.from_store_id))} → ${esc(storeName(transfer.to_store_id))}</p><p class="muted">ผู้สร้าง ${esc(transfer.created_by)} · ผู้ส่ง ${esc(transfer.dispatched_by||'—')} · ผู้รับ ${esc(transfer.received_by||'—')}</p><div class="orders-table-scroll"><table><thead><tr><th>สินค้า / หน่วย</th><th>ส่ง</th><th>รับแล้ว</th><th>ค้างรับ</th><th>ขาดเมื่อปิด</th>${action==='receive'&&allowed()?'<th>รับรอบนี้</th>':''}</tr></thead><tbody>${transfer.lines.map((line,i)=>`<tr><td>${esc(itemName(line.item_type,line.item_key))}<small> ${esc(S.data.items.find(j=>itemId(j)===itemId(line))?.unit||'—')}</small></td><td>${number(line.qty)}</td><td>${number(line.qty_received||0)}</td><td>${number(Number(line.qty)-Number(line.qty_received||0)-Number(line.qty_missing||0))}</td><td>${number(line.qty_missing||0)}</td>${action==='receive'&&allowed()?`<td><input name="receive-${i}" type="number" min="0" max="${Number(line.qty)-Number(line.qty_received||0)}" step="${10**-(S.data.items.find(j=>itemId(j)===itemId(line))?.precision??3)}" placeholder="0" style="width:100px"></td>`:''}</tr>`).join('')}</tbody></table></div>${action?`<div class="inv-notice">${action==='dispatch'?'เมื่อส่ง จะหักสต็อกต้นทางและแสดงเป็นระหว่างโอน ปลายทางยังใช้ขายไม่ได้':'กรอกจำนวนที่รับจริงในรอบนี้ · ช่องว่างหรือ 0 = ยังไม่รับ · ส่วนที่เหลือจะคงอยู่ระหว่างโอน'}</div>${action==='receive'?'<label>หมายเหตุ / เลขที่ใบส่งของ<textarea name="note" maxlength="500"></textarea></label>':''}<label class="inv-check"><input type="checkbox" required> ${action==='dispatch'?'ตรวจสอบสินค้าและพร้อมส่งแล้ว':'ตรวจจำนวนจริงแล้ว เพิ่มเฉพาะจำนวนที่รับรอบนี้'}</label>`:'<p class="muted">รายการปิดแล้ว · ตรวจจำนวนรับจริงและผลต่างข้างต้น</p>'}${allowed()&&transfer.status==='pending'?'<button type="button" class="btn ghost" data-cancel-transfer>ยกเลิกก่อนส่ง</button>':''}${allowed()&&action==='receive'?'<button type="button" class="btn ghost" data-close-short>ปิดรายการที่รับไม่ครบ / ของขาด</button>':''}<h4>ประวัติรับสินค้า</h4>${(response.events||[]).map(e=>`<p>${date(e.created_at)} · ${esc(e.actor)} · ${e.action==='transfer_close'?'ปิดผลต่าง':'รับสินค้า'}<br>${esc(e.data.note||'')}${e.data.lines.map(l=>`<br>${esc(itemName(l.item_type,l.item_key))}: ${e.action==='transfer_close'?'ขาด '+number(l.qty_missing):'รับ '+number(l.qty)}`).join('')}</p>`).join('')||'<p class="muted">ยังไม่มีประวัติรับแยกรอบ</p>'}`,action&&allowed()?async(f,d)=>{
    const payload={id,action};if(action==='receive'){const lines=transfer.lines.map((l,i)=>({item_type:l.item_type,item_key:l.item_key,qty_received:Number(f.get('receive-'+i))})).filter(l=>l.qty_received>0);if(!lines.length)throw Error('กรอกจำนวนรับจริงอย่างน้อยหนึ่งรายการ');Object.assign(payload,{lines,note:f.get('note'),expected_revision:transfer.receipt_version});}
    await send('/api/backoffice/transfers','POST',payload);d.close();await refresh();await openTransfer(id);
  }:null);
  d.querySelector('[data-cancel-transfer]')?.addEventListener('click',()=>dialog('ยกเลิกรายการโอน',`<p>รายการนี้ยังไม่ส่งสินค้า จึงยกเลิกได้โดยไม่เปลี่ยนสต็อก</p><label class="inv-check"><input type="checkbox" required> ยืนยันยกเลิก</label>`,async(f,d)=>{await send('/api/backoffice/transfers','POST',{id,action:'cancel'});d.close();await refresh();openTransfer(id);}));
  d.querySelector('[data-close-short]')?.addEventListener('click',()=>dialog('ปิดผลต่างที่รับไม่ครบ',`<p>ส่วนค้างรับจะบันทึกเป็นของขาดและออกจากระหว่างโอน โดยไม่เพิ่มยอดปลายทางหรือคืนยอดต้นทาง หากพบของภายหลัง ให้ตรวจสอบและบันทึกปรับยอดพร้อมอ้างอิงเอกสารนี้</p><label>เหตุผล<textarea name="note" required minlength="3" maxlength="500"></textarea></label><label class="inv-check"><input type="checkbox" required> ตรวจสอบแล้ว และยืนยันปิดส่วนที่ขาด</label>`,async(f,d)=>{await send('/api/backoffice/transfers','POST',{id,action:'close',expected_revision:transfer.receipt_version,note:f.get('note')});d.close();await refresh();openTransfer(id);}));
}
function csv(){
  const columns=[['name','สินค้า'],['sku','SKU'],['barcode','บาร์โค้ด'],['store_name','สาขา'],['unit','หน่วย'],['quantity','จำนวน'],['in_transit','ระหว่างโอนเข้า'],['threshold','เกณฑ์เตือน'],['source','แหล่งข้อมูล'],['updated_at','อัปเดตล่าสุด']];
  if(S.data.permissions.costs)columns.push(['cost','ต้นทุนต่อหน่วย'],['value','มูลค่าสต็อก']);
  const cell=value=>{let text=value==null?'ยังไม่มีข้อมูล':String(value);if(typeof value==='string'&&/^[\s]*[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const output='\uFEFF'+[columns.map(([,label])=>label),...filtered().map(row=>columns.map(([key])=>row[key]))].map(row=>row.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([output],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='dank-stock-'+new Date().toISOString().slice(0,10)+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function click(event){
  if(!active())return;const button=event.target.closest('[data-inv]');if(!button)return;
  try{switch(button.dataset.inv){
    case 'refresh':await refresh();break;
    case 'tab':S.tab=button.dataset.tab;S.detail=null;render();break;
    case 'detail':await openDetail(button.dataset.row);break;
    case 'back':S.detail=null;render();break;
    case 'page':S.page=Math.max(1,Number(button.dataset.page));renderStock();break;
    case 'sort':S.direction=S.sort===button.dataset.key?-S.direction:1;S.sort=button.dataset.key;renderStock();break;
    case 'clear':S.filters={search:'',store:'all',category:'',status:''};S.page=1;renderStock();break;
    case 'csv':csv();break;
    case 'register':if(S.data.permissions.settings)register();break;
    case 'register-local':if(S.data.permissions.settings)register(true);break;
    case 'adjust':adjust();break;
    case 'threshold':threshold(S.data.rows.find(r=>r.id===button.dataset.row));break;
    case 'start-count':startCount();break;
    case 'start-transfer':startTransfer();break;
    case 'count-open':await openCount(button.dataset.id);break;
    case 'transfer-open':await openTransfer(button.dataset.id);break;
    case 'history-more':await history(true);break;
    case 'movements-more':await loadMovements(true);break;
    case 'movements-refresh':await loadMovements();break;
    case 'purchase-open':{
      if(S.opts.openPurchasing){await S.opts.openPurchasing(button.dataset.id);break;}
      const response=await S.opts.get('/api/backoffice/purchase-orders?id='+encodeURIComponent(button.dataset.id));const po=response.rows[0];
      if(!po)throw Error('ไม่พบใบสั่งซื้อที่อ้างอิง');
      dialog('ใบสั่งซื้อ '+po.po_number,`<p>${esc(storeName(po.store_id))} · ${esc(po.status)}</p><div class="orders-table-scroll"><table><thead><tr><th>สินค้า</th><th>สั่ง</th><th>รับแล้ว</th></tr></thead><tbody>${(po.lines||[]).map(line=>`<tr><td>${esc(itemName(line.item_type,line.item_key))}</td><td>${number(line.qty_ordered)}</td><td>${number(line.qty_received)}</td></tr>`).join('')}</tbody></table></div>`,null);break;
    }
    case 'purchasing':S.opts.navigate('purchasing');break;
  }}catch(error){S.opts.toast?.(error.message,true);}
}
function change(event){
  if(!active())return;
  if(event.target.hasAttribute('data-inv-movement-store')){S.filters.store=event.target.value;loadMovements().catch(error=>S.opts.toast?.(error.message,true));return;}
  if(event.target.dataset.invFilter){S.filters[event.target.dataset.invFilter]=event.target.value;S.page=1;renderStock();}
  if(event.target.dataset.invSelect){if(event.target.checked)S.selected.add(event.target.dataset.invSelect);else S.selected.delete(event.target.dataset.invSelect);const label=S.element.querySelector('.inv-chips span:last-child');if(label)label.textContent='เลือกแล้ว '+S.selected.size+' แถว';}
}
function input(event){if(!active()||event.target.id!=='invSearch')return;const value=event.target.value,start=event.target.selectionStart;S.filters.search=value;S.page=1;renderStock();const next=S.element.querySelector('#invSearch');next.focus();next.setSelectionRange(start,start);}
