/* Sales over time. Uses the same receipt snapshot and calculations as orders. */
const SALES_COLUMNS=[
  ['orders','จำนวนรายการ'],['gross','ยอดขายก่อนส่วนลด'],['discount','ส่วนลด'],['returns','คืนสินค้า'],
  ['net','ยอดขายสุทธิ'],['tax','ภาษี'],['total','ยอดขายรวม'],['cost','ต้นทุน'],['profit','กำไรขั้นต้น'],
  ['margin','อัตรากำไร %'],['average','ยอดสุทธิเฉลี่ยต่อรายการ'],['customers','ลูกค้าที่ระบุตัวตน'],['newCustomers','ลูกค้าใหม่'],['returningCustomers','ลูกค้าเดิม']
];
let SALES_REPORT={preset:'month',group:'day',metric:'total',compare:false,filters:{},columns:['orders','gross','discount','returns','net','tax','total'],page:1,sort:'start',direction:1};
let SALES_REPORT_DATA=null,SALES_REPORT_SCOPE=null,SALES_REPORT_TOKEN=0,SALES_REPORT_INITIALIZED=false;
let SALES_REPORT_OPTIONS={};
let SALES_REPORT_PRINTING=false;
const REPORT_BREAKDOWNS=[['product','สินค้า'],['category','หมวดหมู่'],['sku','SKU']];
function reportIsBreakdown(){return REPORT_BREAKDOWNS.some(([key])=>key===SALES_REPORT.group);}
function reportColumns(){return reportIsBreakdown()?[['qty','จำนวนสินค้าสุทธิ'],...SALES_COLUMNS]:SALES_COLUMNS;}
function reportGroupLabel(){return REPORT_BREAKDOWNS.find(([key])=>key===SALES_REPORT.group)?.[1]||'วันที่ / เวลา';}
function salesLocalDate(iso){const [y,m,d]=SALES.dateKey(iso).split('-').map(Number);return new Date(y,m-1,d);}
function salesSavedFilters(){try{const value=JSON.parse(localStorage.getItem('dankSalesSavedFilters')||'[]');return Array.isArray(value)?value:[];}catch{return [];}}
function salesMoney(value,key){
  if(value===null||value===undefined)return '—';
  if(['orders','customers','newCustomers','returningCustomers'].includes(key))return Number(value).toLocaleString('en-US');
  return Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+(key==='margin'?'%':'');
}
function reportWindow(){
  if(SALES_REPORT.preset==='custom'&&SALES_REPORT.datePreset&&SALES_REPORT.datePreset!=='custom'){
    const range=orderPresetRange(SALES_REPORT.datePreset,salesLocalDate(Date.now()),SALES_REPORT.months||3);
    const window=SALES.dateBounds(orderDateKey(range.start),orderDateKey(range.end));
    if(['today','thisWeek','thisMonth','thisYear'].includes(SALES_REPORT.datePreset))window.end=new Date().toISOString();
    return window;
  }
  if(SALES_REPORT.preset==='custom')return SALES.dateBounds(SALES_REPORT.from,SALES_REPORT.to);
  return SALES.presetWindow(SALES_REPORT.preset);
}
function reportAddCustomerMetrics(report,scope=SALES_REPORT_SCOPE){
  const add=(row,orders)=>{
    const customers=new Set(),fresh=new Set();
    for(const order of orders){
      if(order.cancelledAt||order.kind==='return'||!order.customerId)continue;
      customers.add(order.customerId);
      if(order.firstPurchaseAt>=+new Date(row.start)&&order.firstPurchaseAt<+new Date(row.end))fresh.add(order.customerId);
    }
    row.newCustomers=fresh.size;row.returningCustomers=customers.size-fresh.size;
  };
  for(const row of report.rows){
    const selected=row.orderIds?report.orders.filter(order=>row.orderIds.includes(order.id)):report.orders.filter(o=>o.at>=+new Date(row.start)&&o.at<+new Date(row.end));
    add(row.orderIds?{start:scope.start,end:scope.end}:row,selected);
  }
  report.totals.start=scope.start;report.totals.end=scope.end;
  add(report.totals,report.orders);
  return report;
}
function reportSelect(id,label,options,value){
  return `<label>${label}<select id="${id}">${options.map(([key,text])=>`<option value="${esc(key)}" ${String(value)===String(key)?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
}
async function viewSalesReport(){
  await SALES_READY;
  if(!SALES_REPORT_INITIALIZED){SALES_REPORT.preset=OV_RANGE;SALES_REPORT_INITIALIZED=true;}
  const window=reportWindow();
  ORDERS_DATE_RANGE={start:salesLocalDate(window.start),end:salesLocalDate(+new Date(window.end)-1),preset:SALES_REPORT.datePreset||({today:'today',yesterday:'yesterday',week:'thisWeek',month:'thisMonth',year:'thisYear'}[SALES_REPORT.preset])||'custom'};
  ORDERS_PAST_MONTHS=SALES_REPORT.months||3;
  ORDERS_BRANCHES=SALES_REPORT.filters.branches?new Set(JSON.parse(SALES_REPORT.filters.branches)):null;
  ORDERS_TYPE_FILTER=SALES_REPORT.filters.orderType||'';
  const controls=`
    ${reportSelect('salesGroup','จัดกลุ่มตาม',[['hour','รายชั่วโมง'],['day','รายวัน'],['week','รายสัปดาห์'],['month','รายเดือน'],['year','รายปี'],...REPORT_BREAKDOWNS],SALES_REPORT.group)}
    <button class="btn" data-sales-act="apply">แสดงรายงาน</button>`;
  $('#main').innerHTML=`${workspaceBreadcrumb('ยอดขายตามช่วงเวลา',[['reports','รายงาน']])}
    <div class="workspace-heading"><div><h2>ยอดขายตามช่วงเวลา</h2><p class="muted">วิเคราะห์ยอดขายและเปิดดูใบเสร็จที่นำมาคำนวณ</p></div><div class="row report-header-actions">
      <button class="btn ghost" data-sales-act="save">บันทึกตัวกรอง</button><button class="btn ghost" data-sales-act="pdf">ส่งออก PDF</button><button class="btn ghost" data-sales-act="delivery">ตั้งเวลาส่งรายงาน</button></div></div>
    ${ordersToolbarMarkup(SALES_REPORT.filters.receipt||'',ORDERS_DATE_RANGE,true)}
    <div class="sales-report-mode"><label><input type="checkbox" id="salesDemo" ${OV_DEMO?'checked':''}> ข้อมูลตัวอย่าง</label><button class="product-order-link" data-sales-act="legacy">รายงานประเภทอื่น →</button></div>
    <section class="card sales-report-controls"><div class="sales-report-fields">${controls}</div>
      <div class="sales-report-saved"><label>ตัวกรองที่บันทึกไว้ <select id="salesSaved"><option value="">เลือกชุดตัวกรอง</option>${salesSavedFilters().map((saved,i)=>`<option value="${i}">${esc(saved.name)}</option>`).join('')}</select></label><button class="btn ghost" data-sales-act="delete-saved">ลบชุดที่เลือก</button><small class="muted">บันทึกในเบราว์เซอร์นี้</small></div>
      <div id="salesFilters" class="sales-report-fields"></div><div id="salesChips" class="sales-chips"></div>
    </section><div id="salesReportBody" aria-live="polite"></div>`;
  await loadSalesReport();
}
function reportRenderFilters(){
  const labels={store:'สาขา',branches:'สาขา',receipt:'หมายเลขใบเสร็จ',channel:'ช่องทางขาย',orderType:'ประเภทคำสั่งซื้อ',employee:'พนักงาน',payment:'วิธีชำระเงิน'};
  $('#salesFilters').innerHTML=['channel','employee','payment'].map(key=>{
    const label=labels[key];
    const values=SALES_REPORT_OPTIONS[key==='store'?'branch':key]||[];
    if(SALES_REPORT.filters[key]&&!values.includes(SALES_REPORT.filters[key]))values.push(SALES_REPORT.filters[key]);
    return reportSelect('salesFilter-'+key,label,[['','ทั้งหมด'],...values.map(v=>[v,v])],SALES_REPORT.filters[key]||'');
  }).join('')+'<button class="btn ghost" data-sales-act="clear">ล้างทั้งหมด</button>';
  $('#salesChips').innerHTML=Object.entries(SALES_REPORT.filters).filter(([,v])=>v).map(([key,value])=>`<button type="button" data-sales-act="remove-filter" data-key="${key}">${labels[key]||key}: ${esc(key==='branches'?JSON.parse(value).join(', '):value)} ×</button>`).join('');
  ORDERS_BRANCHES=SALES_REPORT.filters.branches?new Set(JSON.parse(SALES_REPORT.filters.branches)):null;
  ORDERS_TYPE_FILTER=SALES_REPORT.filters.orderType||'';
  const search=$('#salesReceiptSearch');if(search&&search.value!==(SALES_REPORT.filters.receipt||''))search.value=SALES_REPORT.filters.receipt||'';
}
async function loadSalesReport(){
  const body=$('#salesReportBody');if(!body)return;
  const token=++SALES_REPORT_TOKEN,mode=OV_DEMO;
  SALES_REPORT_DATA=null;
  const loading=beginDataLoad(body,'dashboard');
  try{
    await SALES_READY;
    const window=reportWindow();
    SALES_REPORT_SCOPE={...window,...SALES_REPORT.filters};
    if(!SALES_REPORT_SCOPE.store&&CURRENT_STORE!=='all')SALES_REPORT_SCOPE.store=CURRENT_STORE;
    let data;
    if(mode){
      const sample=currentDemoSalesData();
      const all=sample.mockOrders.map(raw=>SALES.normalizeOrder(raw));
      const first=new Map();
      for(const order of all){if(order.customerId)first.set(order.customerId,Math.min(first.get(order.customerId)??Infinity,order.at));}
      for(const order of all)order.firstPurchaseAt=first.get(order.customerId)??null;
      data=SALES.buildReport(all,SALES_REPORT_SCOPE,SALES_REPORT.group);
      data.options={};
      for(const key of ['branch','employee','channel','orderType'])data.options[key]=[...new Set(all.map(o=>o[key]))];
      data.options.payment=[...new Set(all.flatMap(o=>o.payments.map(p=>p.method)))];
      data.note='ข้อมูลตัวอย่างชุดเดียวกับภาพรวมธุรกิจและรายการทั้งหมด ขอบเขตตัวอย่าง: '+overviewPeriodText(sample.reportingPeriod);
      if(SALES_REPORT.compare){
        const prior=SALES.previousWindow(window,SALES_REPORT.preset);
        data.previous=SALES.buildReport(all,{...SALES_REPORT_SCOPE,...prior},SALES_REPORT.group);
      }
    }else{
      data=await boGet('/api/backoffice/sales?'+new URLSearchParams({...SALES_REPORT_SCOPE,group:SALES_REPORT.group}));
      if(SALES_REPORT.compare){
        const prior=SALES.previousWindow(window,SALES_REPORT.preset);
        data.previous=await boGet('/api/backoffice/sales?'+new URLSearchParams({...SALES_REPORT_SCOPE,...prior,group:SALES_REPORT.group}));
      }
    }
    if(token!==SALES_REPORT_TOKEN||TAB!=='reports'||mode!==OV_DEMO||body!==$('#salesReportBody'))return;
    SALES_REPORT_DATA=reportAddCustomerMetrics(data);SALES_REPORT_OPTIONS=data.options||{};
    if(data.previous)reportAddCustomerMetrics(data.previous,SALES.previousWindow(window,SALES_REPORT.preset));
    SALES_REPORT.page=1;reportRenderFilters();loading.reveal(renderSalesReportBody);
  }catch(error){
    if(token===SALES_REPORT_TOKEN&&body===$('#salesReportBody'))loading.reveal(()=>{body.innerHTML=`<p class="data-notice">${esc(error.message)}</p><button class="btn ghost" data-sales-act="apply">ลองใหม่</button>`;});
  }
}
function reportChart(data){
  if(reportIsBreakdown())return reportBreakdownChart(data);
  const rows=data.rows,metric=SALES_REPORT.metric;
  if(!rows.length)return '<p class="empty-table">ไม่มีช่วงเวลาให้แสดง</p>';
  if(rows.every(r=>r[metric]===null))return '<p class="empty-table">ไม่มีข้อมูลที่บันทึกไว้สำหรับตัวชี้วัดนี้</p>';
  const prior=data.previous?.rows||[],values=[...rows,...prior].map(r=>r[metric]).filter(v=>v!==null&&v!==undefined);
  const max=Math.max(1,...values),min=Math.min(0,...values),x=i=>60+i*780/Math.max(1,Math.max(rows.length,prior.length)-1),y=v=>220-(v-min)/(max-min)*170;
  const lines=list=>list.map((r,i)=>r[metric]===null||r[metric]===undefined?'':`${i&&list[i-1][metric]!=null?'L':'M'}${x(i)},${y(r[metric])}`).join(' ');
  const labels=rows.filter((r,i)=>i===0||i===rows.length-1||i%Math.max(1,Math.ceil(rows.length/6))===0);
  return `<div class="sales-chart-scroll"><svg class="sales-report-chart" viewBox="0 0 900 275" role="img" aria-label="กราฟยอดขายตามช่วงเวลา">
    ${[0,.5,1].map(n=>`<line x1="60" y1="${50+n*170}" x2="845" y2="${50+n*170}" stroke="var(--line)"/><text x="50" y="${54+n*170}" text-anchor="end" fill="var(--muted)" font-size="11">${salesMoney(max-n*(max-min),metric)}</text>`).join('')}
    ${prior.length?`<path d="${lines(prior)}" fill="none" stroke="#8ca5c9" stroke-width="2" stroke-dasharray="5 4"/>`:''}
    <path d="${lines(rows)}" fill="none" stroke="#ff8a05" stroke-width="2"/>
    ${rows.map((r,i)=>r[metric]===null?'':`<a href="#" data-sales-act="drill" data-index="${i}" aria-label="${esc(reportBucketLabel(r))}: ${salesMoney(r[metric],metric)}"><circle cx="${x(i)}" cy="${y(r[metric])}" r="5" fill="#ff8a05"><title>${esc(reportBucketLabel(r))}: ${salesMoney(r[metric],metric)}</title></circle></a>`).join('')}
    ${labels.map(r=>`<text x="${x(rows.indexOf(r))}" y="250" text-anchor="middle" fill="var(--muted)" font-size="11">${esc(BOI18n.formatDate(r.start,'toLocaleDateString',{day:'numeric',month:'short',timeZone:'Asia/Bangkok'}))}${SALES_REPORT.group==='hour'?' '+BOI18n.formatDate(r.start,'toLocaleTimeString',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Bangkok'}):''}</text>`).join('')}
    </svg></div>${prior.length?'<p class="muted sales-chart-legend">● ช่วงที่เลือก &nbsp; ┄ ช่วงก่อนหน้า (จัดตามลำดับกลุ่มเวลา)</p>':''}`;
}
function reportBreakdownChart(data){
  const metric=SALES_REPORT.metric;
  const rows=data.rows.slice(0,12);
  if(!rows.length)return '<p class="empty-table">ไม่พบรายการ</p>';
  const previous=new Map((data.previous?.rows||[]).map(row=>[row.key,row]));
  const values=rows.flatMap(row=>[row[metric],previous.get(row.key)?.[metric]]).filter(value=>value!==null&&value!==undefined);
  if(!values.length)return '<p class="empty-table">ไม่มีข้อมูลที่บันทึกไว้สำหรับตัวชี้วัดนี้</p>';
  const max=Math.max(1,...values.map(Math.abs));
  return `<div class="sales-breakdown-chart">${rows.map((row,index)=>{
    const prior=previous.get(row.key);
    return `<button type="button" data-sales-act="drill" data-index="${index}" class="sales-breakdown-row">
      <span class="sales-breakdown-label">${esc(reportBucketLabel(row))}</span>
      <span class="sales-breakdown-bars">
        <span class="sales-breakdown-bar" style="width:${Math.abs(row[metric]??0)/max*100}%"></span>
        ${data.previous?`<span class="sales-breakdown-bar previous" style="width:${Math.abs(prior?.[metric]??0)/max*100}%"></span>`:''}
      </span><span>${salesMoney(row[metric],metric)}${data.previous?`<small class="muted">${salesMoney(prior?prior[metric]:0,metric)}</small>`:''}</span></button>`;
  }).join('')}</div><p class="muted sales-report-note">กราฟแสดง 12 กลุ่มแรกของช่วงที่เลือก ตารางและ CSV แสดงทุกกลุ่ม</p>`;
}
function reportBucketLabel(row){return row.label!==undefined?(row.missing?BOI18n.t(row.label):row.label):BOI18n.formatDate(row.start,'toLocaleString',{timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'numeric',...(SALES_REPORT.group==='hour'?{hour:'2-digit',minute:'2-digit'}:{})});}
function renderSalesReportBody(){
  const data=SALES_REPORT_DATA;if(!data||!$('#salesReportBody'))return;
  const columns=reportColumns(),visible=columns.filter(([key])=>SALES_REPORT.columns.includes(key));
  const indexed=data.rows.map((row,index)=>({...row,index}));
  indexed.sort((a,b)=>SALES_REPORT.direction*(['start','label'].includes(SALES_REPORT.sort)?String(a[SALES_REPORT.sort]??a.label??'').localeCompare(String(b[SALES_REPORT.sort]??b.label??'')):(a[SALES_REPORT.sort]??-Infinity)-(b[SALES_REPORT.sort]??-Infinity)));
  const pages=Math.max(1,Math.ceil(indexed.length/20));SALES_REPORT.page=Math.min(pages,SALES_REPORT.page);
  const rows=SALES_REPORT_PRINTING?indexed:indexed.slice((SALES_REPORT.page-1)*20,SALES_REPORT.page*20);
  $('#salesReportBody').innerHTML=`<div class="sales-report-scope"><span>${esc(overviewPeriodText(SALES_REPORT_SCOPE))} · เวลาไทย (UTC+7) · THB</span><span>${OV_DEMO?'ข้อมูลตัวอย่าง':'ข้อมูลที่บันทึกใน DANK'} · ${data.totals.orders} รายการขาย</span></div>
    <p class="muted sales-report-note">${esc(data.note||'')}${data.coverage?.missing?' · ⚠ มีรายการที่อ่านไม่ได้ '+data.coverage.missing+' รายการ':''}</p>
    <div class="sales-report-summary">${[['total','ยอดขายรวม'],['orders','รายการขาย'],['net','ยอดขายสุทธิ'],['profit','กำไรขั้นต้น']].map(([key,label])=>`<button class="card" data-sales-act="drill-all"><span class="muted">${label}</span><strong>${salesMoney(data.totals[key],key)}</strong></button>`).join('')}</div>
    ${reportIsBreakdown()?'<p class="muted sales-report-note">ส่วนลด ภาษี และต้นทุนระดับใบเสร็จจะจัดสรรตามมูลค่ารายการ โดยใช้จำนวนเงินตอนขาย ไม่ใช้ราคาปัจจุบัน · จำนวนรายการและลูกค้าอาจซ้ำระหว่างกลุ่ม</p>':''}
    <section class="card"><div class="sales-report-chart-controls">${reportSelect('salesMetric','แสดงกราฟ',columns,SALES_REPORT.metric)}<label><input id="salesCompare" type="checkbox" ${SALES_REPORT.compare?'checked':''}> เปรียบเทียบช่วงก่อนหน้า</label></div>${reportChart(data)}</section>
    <section class="card"><div class="section-heading"><h3>รายละเอียดรายงาน</h3><details class="sales-column-picker"><summary>เลือกคอลัมน์</summary><div>${columns.map(([key,label])=>`<label><input type="checkbox" data-sales-column="${key}" ${SALES_REPORT.columns.includes(key)?'checked':''}> ${label}</label>`).join('')}</div></details></div>
      <div class="orders-table-scroll"><table class="sales-report-table"><thead><tr><th><button data-sales-act="sort" data-key="${reportIsBreakdown()?'label':'start'}">${reportGroupLabel()} ↕</button></th>${visible.map(([key,label])=>`<th><button data-sales-act="sort" data-key="${key}">${label} ↕</button></th>`).join('')}</tr></thead><tbody>
        ${rows.map(row=>`<tr><td><button class="product-order-link" data-sales-act="drill" data-index="${row.index}">${esc(reportBucketLabel(row))}</button></td>${visible.map(([key])=>`<td><button data-sales-act="drill" data-index="${row.index}" class="sales-cell-link">${salesMoney(row[key],key)}</button></td>`).join('')}</tr>`).join('')||`<tr><td colspan="${visible.length+1}" class="empty-table">ไม่พบรายการ</td></tr>`}
        </tbody><tfoot><tr><th>รวมช่วงที่เลือก</th>${visible.map(([key])=>`<td>${salesMoney(data.totals[key],key)}</td>`).join('')}</tr></tfoot></table></div>
      <div class="orders-pagination"><span>แสดง ${rows.length?((SALES_REPORT.page-1)*20+1):0}-${Math.min(SALES_REPORT.page*20,indexed.length)} จาก ${indexed.length} กลุ่ม</span><div><button class="btn ghost" data-sales-act="page" data-page="${SALES_REPORT.page-1}" ${SALES_REPORT.page===1?'disabled':''}>ก่อนหน้า</button> ${SALES_REPORT.page} / ${pages} <button class="btn ghost" data-sales-act="page" data-page="${SALES_REPORT.page+1}" ${SALES_REPORT.page===pages?'disabled':''}>ถัดไป</button></div></div>
      <p class="muted sales-report-note">ยอดขายสุทธิ = ยอดขายก่อนส่วนลด − ส่วนลด − ยอดคืนสินค้าก่อนภาษี · กำไร = ยอดสุทธิ − ต้นทุนตอนขาย · — หมายถึงข้อมูลไม่ครบ · ลูกค้าใหม่อิงประวัติที่มีในระบบ · รายการยกเลิกไม่ถือเป็นการคืนสินค้า</p>
    </section>`;
}
function reportReadControls(){
  const previous=SALES_REPORT.group;
  SALES_REPORT.group=$('#salesGroup').value;
  if(previous!==SALES_REPORT.group){
    SALES_REPORT.sort=reportIsBreakdown()?'total':'start';SALES_REPORT.direction=reportIsBreakdown()?-1:1;
    if(reportIsBreakdown()&&!SALES_REPORT.columns.includes('qty'))SALES_REPORT.columns.unshift('qty');
    if(!reportIsBreakdown()&&SALES_REPORT.metric==='qty')SALES_REPORT.metric='total';
  }
  for(const key of ['channel','employee','payment'])SALES_REPORT.filters[key]=$('#salesFilter-'+key)?.value||'';
  SALES_REPORT.filters.receipt=$('#salesReceiptSearch')?.value.trim()||'';
}
async function applySalesReportDates(start,end,preset,months){
  SALES_REPORT.preset='custom';SALES_REPORT.datePreset=preset;SALES_REPORT.months=months;
  SALES_REPORT.from=orderDateKey(start);SALES_REPORT.to=orderDateKey(end);
  closeOrdersDatePicker();await viewSalesReport();$('#ordersDateButton')?.focus();
}
async function applySalesReportBranches(branches,type){
  delete SALES_REPORT.filters.store;
  SALES_REPORT.filters.branches=branches.length===ordersBranches().length?'':JSON.stringify(branches);
  SALES_REPORT.filters.orderType=type;
  closeOrdersBranches();await loadSalesReport();$('#ordersBranchButton')?.focus();
}
let SALES_RECEIPT_TIMER;
document.addEventListener('input',event=>{
  if(event.target.id!=='salesReceiptSearch')return;
  SALES_REPORT.filters.receipt=event.target.value.trim();
  clearTimeout(SALES_RECEIPT_TIMER);
  SALES_RECEIPT_TIMER=setTimeout(()=>{if(onSalesReport())loadSalesReport();},250);
});
async function reportDrill(index){
  const data=SALES_REPORT_DATA;if(!data)return;
  const row=index===null?SALES_REPORT_SCOPE:data.rows[index];if(!row)return;
  const scope={...SALES_REPORT_SCOPE,...(row.key?{itemGroup:SALES_REPORT.group,itemKey:row.key}:{start:row.start,end:row.end})};
  ORDERS_SOURCE_DATA={mockOrders:data.orders.filter(o=>SALES.matches(o,scope)),sampleData:OV_DEMO,coverage:data.coverage};
  ORDERS_SOURCE_PERIOD=OV_RANGE;ORDERS_EXACT_SCOPE=scope;
  ORDERS_DATE_RANGE={start:salesLocalDate(scope.start),end:salesLocalDate(+new Date(scope.end)-1),preset:'custom'};
  ORDERS_SEARCH='';ORDERS_PRODUCT_FILTER='';ORDERS_BRANCHES=null;ORDERS_TYPE_FILTER='';ORDERS_PAGE=1;SALES_RETURN_TO_REPORT=true;
  setTab('orders');
}
function exportSalesReport(){
  const data=SALES_REPORT_DATA;if(!data)return toast('กรุณาโหลดรายงานก่อน',true);
  const columns=reportColumns().filter(([key])=>SALES_REPORT.columns.includes(key));
  const grouped=reportIsBreakdown();
  const rows=[['รายงานยอดขาย'],['เริ่ม',SALES_REPORT_SCOPE.start,'สิ้นสุด (ไม่รวม)',SALES_REPORT_SCOPE.end],['จัดกลุ่มตาม',reportGroupLabel()],['ตัวกรอง',JSON.stringify(SALES_REPORT_SCOPE)],['แหล่งข้อมูล',OV_DEMO?'ข้อมูลตัวอย่าง':'รายการที่บันทึกใน DANK'],[],[...(grouped?[reportGroupLabel()]:['เริ่มกลุ่ม','สิ้นสุดกลุ่ม']),...columns.map(([,label])=>label)],
    ...data.rows.map(row=>[...(grouped?[row.label]:[row.start,row.end]),...columns.map(([key])=>row[key]??'—')]),['รวม',...(grouped?[]:['']),...columns.map(([key])=>data.totals[key]??'—')]];
  downloadCSV(buildCSV([],rows),'dank-sales-'+SALES_REPORT.group+'-'+SALES.dateKey(SALES_REPORT_SCOPE.start)+'.csv');
}
async function openOverviewOrders(product=''){
  await SALES_READY;ensureOrdersData();
  const data=OV_LAST_MODE===OV_DEMO&&OV_LAST_RANGE===OV_RANGE?OV_LAST_DATA:null;
  const scope=data?.reportingPeriod||SALES.presetWindow(OV_RANGE);
  ORDERS_EXACT_SCOPE={...scope,store:CURRENT_STORE};
  ORDERS_DATE_RANGE={start:salesLocalDate(scope.start),end:salesLocalDate(+new Date(scope.end)-1),preset:'custom'};
  ORDERS_PRODUCT_FILTER=product;ORDERS_SEARCH='';ORDERS_PAGE=1;ORDERS_BRANCHES=null;ORDERS_TYPE_FILTER='';SALES_RETURN_TO_REPORT=false;
  setTab('orders');
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-sales-act]');if(!button)return;
  event.preventDefault();
  try{
    switch(button.dataset.salesAct){
      case 'apply':reportReadControls();await loadSalesReport();break;
      case 'clear':SALES_REPORT.filters={};await loadSalesReport();break;
      case 'remove-filter':delete SALES_REPORT.filters[button.dataset.key];await loadSalesReport();break;
      case 'sort':SALES_REPORT.direction=SALES_REPORT.sort===button.dataset.key?-SALES_REPORT.direction:1;SALES_REPORT.sort=button.dataset.key;renderSalesReportBody();break;
      case 'page':SALES_REPORT.page=Math.max(1,Number(button.dataset.page));renderSalesReportBody();break;
      case 'drill':await reportDrill(Number(button.dataset.index));break;
      case 'drill-all':await reportDrill(null);break;
      case 'csv':exportSalesReport();break;
      case 'pdf':if(SALES_REPORT_DATA){try{SALES_REPORT_PRINTING=true;renderSalesReportBody();printSection('ยอดขายตามช่วงเวลา');}finally{SALES_REPORT_PRINTING=false;renderSalesReportBody();}}break;
      case 'legacy':viewLegacyReports();break;
      case 'save':{
        reportReadControls();reportWindow();
        const name=prompt('ตั้งชื่อชุดตัวกรอง');if(!name?.trim())break;
        const saved=salesSavedFilters().filter(s=>s.name!==name.trim());saved.push({name:name.trim(),state:JSON.parse(JSON.stringify(SALES_REPORT))});
        localStorage.setItem('dankSalesSavedFilters',JSON.stringify(saved));await viewSalesReport();break;
      }
      case 'delete-saved':{
        const value=$('#salesSaved').value;if(value==='')break;
        const saved=salesSavedFilters();saved.splice(Number(value),1);localStorage.setItem('dankSalesSavedFilters',JSON.stringify(saved));await viewSalesReport();break;
      }
      case 'delivery':await openSalesReportDelivery();break;
    }
  }catch(error){toast(error.message,true);}
});
document.addEventListener('change',async event=>{
  const el=event.target;
  try{
    if(el.id==='salesPreset'){reportReadControls();await viewSalesReport();}
    else if(el.id==='salesDemo'){reportReadControls();OV_DEMO=el.checked;OV_LAST_DATA=null;ORDERS_SOURCE_DATA=null;await loadSalesReport();}
    else if(el.id==='salesGroup'){reportReadControls();await loadSalesReport();}
    else if(el.id==='salesMetric'){SALES_REPORT.metric=el.value;renderSalesReportBody();}
    else if(el.id==='salesCompare'){SALES_REPORT.compare=el.checked;await loadSalesReport();}
    else if(el.id==='salesSaved'&&el.value!==''){const saved=salesSavedFilters()[Number(el.value)];if(saved){SALES_REPORT={...SALES_REPORT,...saved.state,page:1};await viewSalesReport();}}
    else if(el.dataset.salesColumn){const key=el.dataset.salesColumn;SALES_REPORT.columns=el.checked?[...new Set([...SALES_REPORT.columns,key])]:SALES_REPORT.columns.filter(c=>c!==key);renderSalesReportBody();}
    else if(el.id?.startsWith('salesFilter-')){reportReadControls();await loadSalesReport();}
  }catch(error){toast(error.message,true);}
});

async function openSalesReportDelivery(){
  if(OV_DEMO)return toast('การส่งรายงานใช้ได้กับข้อมูลจริงเท่านั้น กรุณาปิดข้อมูลตัวอย่างก่อน',true);
  let response;
  try{response=await boGet('/api/backoffice/report-delivery');}catch(error){return toast(error.message,true);}
  document.querySelector('#salesDeliveryDialog')?.remove();
  const dialog=document.createElement('dialog');dialog.id='salesDeliveryDialog';
  const ready=response.configuration.ready;
  dialog.innerHTML=`<form class="sales-delivery-form"><h3>ตั้งเวลาส่งรายงาน</h3>
    <p class="muted sales-report-note">ส่งข้อมูลจริงของวันก่อนหน้า / สัปดาห์ก่อนหน้า (จันทร์–อาทิตย์) / เดือนก่อนหน้า พร้อม CSV ทุกแถว ใช้ตัวกรองปัจจุบันและเวลาไทย (UTC+7)</p>
    ${ready?'':`<p class="data-notice">ยังไม่พร้อมใช้งาน: ${esc(response.configuration.missing.join(', '))} · ต้องเปิดตัวเรียกงานรายชั่วโมงบนเซิร์ฟเวอร์ด้วย</p>`}
    <label>ชื่อรายงาน<input name="name" required maxlength="100" value="ยอดขายตามช่วงเวลา"></label>
    <label>อีเมลผู้รับ<input name="recipients" required placeholder="owner@example.com, manager@example.com"></label>
    <label>ความถี่<select name="frequency"><option value="daily">รายวัน</option><option value="weekly">รายสัปดาห์ — วันจันทร์</option><option value="monthly">รายเดือน — วันที่ 1</option></select></label>
    <label>เวลาส่ง (เวลาไทย)<select name="hour">${Array.from({length:24},(_,hour)=>`<option value="${hour}" ${hour===8?'selected':''}>${String(hour).padStart(2,'0')}:00</option>`).join('')}</select></label>
    <div class="row"><button type="button" id="salesDeliveryClose" class="btn ghost">ปิด</button><button type="submit" class="btn" ${ready?'':'disabled'}>บันทึกตารางส่ง</button></div>
    <div class="sales-delivery-list">${response.rows.map(row=>`<p><strong>${esc(row.name)}</strong><br>${esc(row.recipients.join(', '))}<br>${esc(({daily:'รายวัน',weekly:'รายสัปดาห์',monthly:'รายเดือน'})[row.frequency])} ${String(row.hour).padStart(2,'0')}:00 · ${row.lastSentAt?'ผู้ให้บริการรับอีเมลล่าสุด '+esc(BOI18n.formatDate(row.lastSentAt,'toLocaleString',{timeZone:'Asia/Bangkok'})):'ยังไม่เคยส่ง'}${row.lastError?'<br>ส่งไม่สำเร็จ: '+esc(row.lastError):''} <button type="button" class="product-order-link" data-delete-delivery="${esc(row.id)}">หยุดส่งและลบ</button></p>`).join('')||'<p class="muted">ยังไม่มีตารางส่งรายงาน</p>'}</div>
  </form>`;
  document.body.append(dialog);
  dialog.querySelector('#salesDeliveryClose').addEventListener('click',()=>dialog.close());
  dialog.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.submitter;button.disabled=true;
    try{
      await boSend('/api/backoffice/report-delivery','POST',{...Object.fromEntries(new FormData(event.target)),group:SALES_REPORT.group,filters:{store:CURRENT_STORE,...SALES_REPORT.filters}});
      dialog.close();toast('บันทึกตารางส่งรายงานแล้ว');await openSalesReportDelivery();
    }catch(error){toast(error.message,true);button.disabled=false;}
  });
  dialog.addEventListener('click',async event=>{
    const button=event.target.closest('[data-delete-delivery]');if(!button)return;
    button.disabled=true;
    try{await boSend('/api/backoffice/report-delivery','POST',{action:'delete',id:button.dataset.deleteDelivery});dialog.close();await openSalesReportDelivery();}
    catch(error){toast(error.message,true);button.disabled=false;}
  });
  dialog.showModal();
}
