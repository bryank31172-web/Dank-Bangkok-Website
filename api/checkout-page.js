import fs from "node:fs";
import path from "node:path";

let cached = "";

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Checkout cart migration failed: ${label}`);
  return source.replace(search, replacement);
}

function checkoutHtml() {
  if (cached) return cached;

  const file = path.join(process.cwd(), "checkout.html");
  let html = fs.readFileSync(file, "utf8");

  html = replaceRequired(
    html,
    "<script>\nconst STORE='dank_cart';",
    "<script src=\"/cart-service.js?v=5\"></script>\n<script src=\"/cart-ui.js?v=2\"></script>\n<script>\nconst STORE='dank_cart';",
    "shared cart scripts"
  );

  html = replaceRequired(
    html,
    "const state={step:1,payment:'RevolutTransfer',discount:0,promo:'',deliveryFee:100};",
    "const state={step:1,payment:'RevolutTransfer'};",
    "checkout state"
  );

  html = replaceRequired(
    html,
    "function loadCart(){try{return JSON.parse(localStorage.getItem(STORE)||'[]')||[]}catch(e){return[]}}\nlet cart=loadCart();\nfunction subtotal(){return cart.reduce((s,x)=>s+(Number(x.price)||0)*(Number(x.qty)||1),0)}\nfunction total(){return Math.max(0,subtotal()-state.discount+state.deliveryFee)}",
    "let summary=window.CartUI?CartUI.calculate():(window.Cart?Cart.calculate():{items:[],subtotal:0,discount:0,promo:'',deliveryFee:0,total:0});\nlet cart=summary.items;\nfunction refreshCart(){summary=window.CartUI?CartUI.calculate():(window.Cart?Cart.calculate():summary);cart=summary.items;}\nfunction subtotal(){return summary.subtotal}\nfunction total(){return summary.total}",
    "cart initialization"
  );

  html = html
    .replace("document.getElementById('itemCount').textContent=cart.reduce((sum,x)=>sum+(Number(x.qty)||1),0)+' items';", "document.getElementById('itemCount').textContent=(window.Cart?Cart.count(summary.items):summary.items.reduce((sum,x)=>sum+(Number(x.qty)||1),0))+' items';")
    .replace("document.getElementById('cartItems').innerHTML=cart.length?cart.map((x,index)=>", "document.getElementById('cartItems').innerHTML=summary.items.length?summary.items.map((x,index)=>")
    .replace("document.getElementById('subtotal').textContent=money(subtotal());", "document.getElementById('subtotal').textContent=money(summary.subtotal);")
    .replace("document.getElementById('deliveryFee').textContent=state.deliveryFee===0?'FREE':money(state.deliveryFee);", "document.getElementById('deliveryFee').textContent=summary.deliveryFee===0?'FREE':money(summary.deliveryFee);")
    .replace("document.getElementById('deliveryFee').classList.toggle('cart-free',state.deliveryFee===0);", "document.getElementById('deliveryFee').classList.toggle('cart-free',summary.deliveryFee===0);")
    .replace("document.getElementById('discountRow').style.display=state.discount?'flex':'none';", "document.getElementById('discountRow').style.display=summary.discount?'flex':'none';")
    .replace("document.getElementById('discount').textContent='−'+money(state.discount);", "document.getElementById('discount').textContent='−'+money(summary.discount);")
    .replace("document.getElementById('total').textContent=money(total());", "document.getElementById('total').textContent=money(summary.total);")
    .replace("document.getElementById('placeBtn').textContent='Place order · '+money(total());", "document.getElementById('placeBtn').textContent='Place order · '+money(summary.total);")
    .replace("${x.bonus?'FREE':money((Number(x.price)||0)*(Number(x.qty)||1))}", "${x.bonus?'FREE':money((Number(x.appliedPrice??x.price)||0)*(Number(x.qty)||1))}");

  html = replaceRequired(
    html,
    "function persistCart(){localStorage.setItem(STORE,JSON.stringify(cart));renderSummary()}\nfunction changeQty(index,delta){const item=cart[index];if(!item)return;item.qty=Math.max(1,(Number(item.qty)||1)+delta);persistCart()}\nfunction removeCartItem(index){cart.splice(index,1);persistCart()}",
    "function persistCart(){if(window.Cart)Cart.save(summary.items);refreshCart();renderSummary()}\nfunction changeQty(index,delta){const item=summary.items[index];if(!item)return;if(window.CartUI)summary=CartUI.changeQty(item.key,delta);else if(window.Cart)Cart.updateQty(item.key,delta,{mode:'delta',minimum:1,removeBelowMinimum:true});refreshCart();renderSummary()}\nfunction removeCartItem(index){const item=summary.items[index];if(!item)return;if(window.CartUI)summary=CartUI.remove(item.key);else if(window.Cart)Cart.remove(item.key);refreshCart();renderSummary()}",
    "cart mutations"
  );

  html = replaceRequired(
    html,
    "function applyPromo(){const code=document.getElementById('promo').value.trim().toUpperCase();state.promo=code;state.discount=code==='DANK10'?Math.round(subtotal()*.10):0;if(code&&!state.discount)alert('Promo code not recognised');renderSummary()}",
    "function applyPromo(){const code=document.getElementById('promo').value.trim().toUpperCase();if(!window.CartUI)return;const result=CartUI.setPromo(code,{promos:{DANK10:{type:'pct',value:10}}});if(!result.ok){alert(result.reason==='minimum'?'Minimum order '+money(result.minimum)+' required':'Promo code not recognised');return;}summary=result.summary;cart=summary.items;renderSummary()}",
    "promo handling"
  );

  html = html.replace(
    "items:cart.map(x=>({shId:x.shId||'',name:x.name,option:x.tierLabel||'',qty:Number(x.qty)||1,unitPrice:Number(x.price)||0,lineTotal:(Number(x.price)||0)*(Number(x.qty)||1})),",
    "items:summary.items.map(x=>({shId:x.shId||'',name:x.name,option:x.tierLabel||'',qty:Number(x.qty)||1,unitPrice:Number(x.appliedPrice??x.price)||0,lineTotal:(Number(x.appliedPrice??x.price)||0)*(Number(x.qty)||1)})),"
  );

  html = html.replace(
    "subtotal:subtotal(),discount:state.discount,promo:state.promo,deliveryFee:state.deliveryFee,total:total()",
    "subtotal:summary.subtotal,discount:summary.discount,promo:summary.promo,deliveryFee:summary.deliveryFee,total:summary.total"
  );

  html = html.replace(
    "localStorage.removeItem(STORE);cart=[];",
    "if(window.Cart)Cart.clear();summary={items:[],subtotal:0,discount:0,promo:'',deliveryFee:0,total:0};cart=[];"
  );

  html = replaceRequired(
    html,
    "renderSummary();renderPayments();initPlaces();updateCartAction();",
    "if(window.Cart){Cart.subscribe(function(){refreshCart();renderSummary();});}\nrefreshCart();renderSummary();renderPayments();initPlaces();updateCartAction();",
    "checkout initialization"
  );

  cached = html;
  return html;
}

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const html = checkoutHtml();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=0, must-revalidate");
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(html);
  } catch (error) {
    console.error("checkout page error", error);
    return res.status(500).send("Checkout unavailable");
  }
}
