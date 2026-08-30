import fs from "node:fs";
import path from "node:path";

let cached = "";

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Checkout cart migration failed: ${label}`);
  }
  return source.replace(search, replacement);
}

function checkoutHtml() {
  if (cached) return cached;

  const file = path.join(process.cwd(), "checkout.html");
  let html = fs.readFileSync(file, "utf8");

  html = replaceRequired(
    html,
    "<script>\nconst STORE='dank_cart';",
    "<script src=\"/cart-service.js?v=2\"></script>\n<script>\nconst STORE='dank_cart';",
    "cart service injection"
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
    "let cart=window.Cart?Cart.getItems():[];\nlet summary=window.Cart?Cart.calculate():{items:cart,subtotal:0,discount:0,promo:'',deliveryFee:100,total:100};\nfunction refreshCart(){cart=window.Cart?Cart.getItems():cart;summary=window.Cart?Cart.calculate():summary;}\nfunction subtotal(){return summary.subtotal}\nfunction total(){return summary.total}",
    "cart initialization"
  );

  html = html
    .replace("document.getElementById('itemCount').textContent=cart.reduce((sum,x)=>sum+(Number(x.qty)||1),0)+' items';", "document.getElementById('itemCount').textContent=(window.Cart?Cart.count(cart):cart.reduce((sum,x)=>sum+(Number(x.qty)||1),0))+' items';")
    .replace("document.getElementById('subtotal').textContent=money(subtotal());", "document.getElementById('subtotal').textContent=money(summary.subtotal);")
    .replace("document.getElementById('deliveryFee').textContent=state.deliveryFee===0?'FREE':money(state.deliveryFee);", "document.getElementById('deliveryFee').textContent=summary.deliveryFee===0?'FREE':money(summary.deliveryFee);")
    .replace("document.getElementById('deliveryFee').classList.toggle('cart-free',state.deliveryFee===0);", "document.getElementById('deliveryFee').classList.toggle('cart-free',summary.deliveryFee===0);")
    .replace("document.getElementById('discountRow').style.display=state.discount?'flex':'none';", "document.getElementById('discountRow').style.display=summary.discount?'flex':'none';")
    .replace("document.getElementById('discount').textContent='−'+money(state.discount);", "document.getElementById('discount').textContent='−'+money(summary.discount);")
    .replace("document.getElementById('total').textContent=money(total());", "document.getElementById('total').textContent=money(summary.total);")
    .replace("document.getElementById('placeBtn').textContent='Place order · '+money(total());", "document.getElementById('placeBtn').textContent='Place order · '+money(summary.total);");

  html = replaceRequired(
    html,
    "function persistCart(){localStorage.setItem(STORE,JSON.stringify(cart));renderSummary()}\nfunction changeQty(index,delta){const item=cart[index];if(!item)return;item.qty=Math.max(1,(Number(item.qty)||1)+delta);persistCart()}\nfunction removeCartItem(index){cart.splice(index,1);persistCart()}",
    "function persistCart(){if(window.Cart)cart=Cart.save(cart);refreshCart();renderSummary()}\nfunction changeQty(index,delta){const item=cart[index];if(!item)return;if(window.Cart)cart=Cart.updateQty(item.key,delta,{mode:'delta',minimum:1,removeBelowMinimum:true});refreshCart();renderSummary()}\nfunction removeCartItem(index){const item=cart[index];if(!item)return;if(window.Cart)cart=Cart.remove(item.key);refreshCart();renderSummary()}",
    "cart mutations"
  );

  html = replaceRequired(
    html,
    "function applyPromo(){const code=document.getElementById('promo').value.trim().toUpperCase();state.promo=code;state.discount=code==='DANK10'?Math.round(subtotal()*.10):0;if(code&&!state.discount)alert('Promo code not recognised');renderSummary()}",
    "function applyPromo(){const code=document.getElementById('promo').value.trim().toUpperCase();if(!window.Cart)return;summary=Cart.applyPromo(code);if(code&&!summary.discount)alert('Promo code not recognised');refreshCart();renderSummary()}",
    "promo handling"
  );

  html = html.replace(
    "subtotal:subtotal(),discount:state.discount,promo:state.promo,deliveryFee:state.deliveryFee,total:total()",
    "subtotal:summary.subtotal,discount:summary.discount,promo:summary.promo,deliveryFee:summary.deliveryFee,total:summary.total"
  );

  html = html.replace(
    "localStorage.removeItem(STORE);cart=[];",
    "if(window.Cart)Cart.clear();cart=[];summary=window.Cart?Cart.calculate():summary;"
  );

  html = replaceRequired(
    html,
    "renderSummary();renderPayments();initPlaces();updateCartAction();",
    "if(window.Cart){Cart.subscribe(function(items){cart=items;summary=Cart.calculate();renderSummary();});}\nrefreshCart();renderSummary();renderPayments();initPlaces();updateCartAction();",
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
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(html);
  } catch (error) {
    console.error("checkout page error", error);
    return res.status(500).send("Checkout unavailable");
  }
}
