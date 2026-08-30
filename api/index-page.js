import fs from "node:fs";
import path from "node:path";

let cached = "";

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Storefront cart migration failed: ${label}`);
  return source.replace(search, replacement);
}

function replaceRegexRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Storefront cart migration failed: ${label}`);
  return source.replace(pattern, replacement);
}

function storefrontHtml() {
  if (cached) return cached;

  const file = path.join(process.cwd(), "index.html");
  let html = fs.readFileSync(file, "utf8");

  html = replaceRequired(
    html,
    `<script>\n/* ============================================================\n   1) CONFIG`,
    `<script src="/cart-service.js?v=5"></script>\n<script src="/cart-ui.js?v=2"></script>\n<script>\n/* ============================================================\n   1) CONFIG`,
    "shared cart scripts"
  );

  html = replaceRequired(
    html,
    `let cart=[], pdCurrent=null, pdTierIdx=0, coFulfill="delivery", coPay="Cash";`,
    `let cart=window.Cart?Cart.getItems():[], pdCurrent=null, pdTierIdx=0, coFulfill="delivery", coPay="Cash";`,
    "cart initialization"
  );

  html = replaceRequired(
    html,
    `function saveCart(){ LS.set("cart",cart); }`,
    `function saveCart(){ cart=window.Cart?Cart.save(cart):cart; }`,
    "saveCart"
  );

  html = html.replaceAll(
    `cart=LS.get("cart",[])||[];`,
    `cart=window.Cart?Cart.getItems():(LS.get("cart",[])||[]);`
  );

  html = replaceRequired(
    html,
    `function updateCartCount(){ const n=cart.reduce((s,c)=>s+c.qty,0); const el=$("#cartCount"); el.textContent=n; el.classList.toggle("hidden",n===0); }\nfunction cartSubtotal(){ return cart.reduce((s,c)=>s+c.price*c.qty,0); }`,
    `function updateCartCount(){ const n=window.Cart?Cart.count(cart):cart.reduce((s,c)=>s+c.qty,0); const el=$("#cartCount"); el.textContent=n; el.classList.toggle("hidden",n===0); }\nfunction cartSubtotal(){ return sharedCartSummary().subtotal; }`,
    "cart totals"
  );

  html = replaceRequired(
    html,
    `  const found=cart.find(c=>c.key===key);\n  if(found){ found.qty++; }\n  else cart.push({key,id:p.id,shId:(tier&&tier.shId)||p.shId||"",name:p.name,tierLabel:tier?tier.label:(p.unit||"each"),price,qty:1,image:p.image,type:p.type,category:p.category});\n  updateCartCount(); saveCart();`,
    `  const retailPrice=Number(tier?tier.price:p.price)||0;\n  const memberPrice=Number(tier?(tier.member||tier.price):(p.member!=null?p.member:p.price))||retailPrice;\n  const line={key,id:p.id,shId:(tier&&tier.shId)||p.shId||"",name:p.name,tierLabel:tier?tier.label:(p.unit||"each"),price,retailPrice,memberPrice,appliedPrice:price,priceType:memberMode?"member":"retail",qty:1,image:p.image,type:p.type,category:p.category};\n  if(window.Cart) cart=Cart.add(line,1);\n  else { const found=cart.find(c=>c.key===key); if(found) found.qty++; else cart.push(line); }\n  updateCartCount(); saveCart();`,
    "addToCart mutation"
  );

  html = replaceRequired(
    html,
    `function changeQty(key,d){ const it=cart.find(c=>c.key===key); if(!it)return; it.qty+=d; if(it.qty<=0) cart=cart.filter(c=>c.key!==key); updateCartCount(); saveCart(); renderCart(); }\nfunction removeLine(key){ cart=cart.filter(c=>c.key!==key); updateCartCount(); saveCart(); renderCart(); }`,
    `function changeQty(key,d){\n  if(window.CartUI){ const summary=CartUI.changeQty(key,d); cart=summary.items; }\n  else { const it=cart.find(c=>c.key===key); if(!it)return; it.qty+=d; if(it.qty<=0) cart=cart.filter(c=>c.key!==key); }\n  updateCartCount(); renderCart();\n}\nfunction removeLine(key){\n  if(window.CartUI){ const summary=CartUI.remove(key); cart=summary.items; }\n  else cart=cart.filter(c=>c.key!==key);\n  updateCartCount(); renderCart();\n}`,
    "quantity and removal mutations"
  );

  html = replaceRequired(
    html,
    `function clearCartAfterOrder(){ if(cart.some(c=>c.bonus1st)) LS.set("first_free_used",1); cart=[]; appliedPromo=null; coFulfill="delivery"; boxMode=false; LS.set("boxmode",0); saveCart(); updateCartCount(); }`,
    `function clearCartAfterOrder(){ if(cart.some(c=>c.bonus1st)) LS.set("first_free_used",1); cart=window.Cart?Cart.clear():[]; appliedPromo=null; coFulfill="delivery"; boxMode=false; LS.set("boxmode",0); updateCartCount(); }`,
    "clear cart"
  );

  html = replaceRegexRequired(
    html,
    /function cartSubtotal\(\)\{[\s\S]*?(?=function applyPromo\(\))/,
    `function memberCodeStacks(p){
  if(window.CartUI) return CartUI.memberCodeStacks(p,{membership:memberMode?{active:true}:null,memberCode:String((CONFIG.crm&&CONFIG.crm.code)||"")});
  const cc=String((CONFIG.crm&&CONFIG.crm.code)||"").toUpperCase();
  return !!(memberMode&&cc&&p&&String(p.code||"").toUpperCase()===cc);
}
function dropStackedMemberCode(){ if(memberCodeStacks(appliedPromo)) appliedPromo=null; }
function sharedCartSummary(){
  if(!window.CartUI){
    const subtotal=cart.reduce((sum,item)=>sum+(Number(item.price)||0)*(Number(item.qty)||1),0);
    return {items:cart,subtotal,discount:0,deliveryFee:0,total:subtotal,shortfall:Math.max(0,(Number(CONFIG.minOrder)||0)-subtotal)};
  }
  return CartUI.calculate({
    items:cart,
    membership:memberMode?{active:true,source:"storefront"}:null,
    fulfilment:coFulfill||"delivery",
    minimumOrder:Number(CONFIG.minOrder)||0,
    deliveryFee:Number(CONFIG.deliveryFee)||0,
    freeDeliveryOver:Number(CONFIG.freeDeliveryOver)||0,
    memberCode:String((CONFIG.crm&&CONFIG.crm.code)||""),
    promo:appliedPromo||null,
    pricingConfig:{
      minimumOrder:Number(CONFIG.minOrder)||0,
      deliveryFee:Number(CONFIG.deliveryFee)||0,
      freeDeliveryOver:Number(CONFIG.freeDeliveryOver)||0,
      memberCode:String((CONFIG.crm&&CONFIG.crm.code)||"")
    },
    source:"storefront"
  });
}
`,
    "shared pricing engine"
  );

  html = replaceRequired(
    html,
    `  const box=boxesInCart();\n  body.innerHTML=cart.map(cartLineHTML).join("")+(box.boxes>=1?boxGiftsHTML(box.boxes):"");\n  const sub=cartSubtotal(), disc=discountAmt(), fee=deliveryFeeAmt(), tot=cartTotal();`,
    `  const summary=sharedCartSummary();\n  cart=summary.items;\n  const box=boxesInCart();\n  body.innerHTML=summary.items.map(cartLineHTML).join("")+(box.boxes>=1?boxGiftsHTML(box.boxes):"");\n  const {subtotal:sub,discount:disc,deliveryFee:fee,total:tot}=summary;`,
    "cart drawer summary"
  );

  html = html.replaceAll("cartSubtotal()", "sharedCartSummary().subtotal");
  html = html.replaceAll("discountAmt()", "sharedCartSummary().discount");
  html = html.replaceAll("deliveryFeeAmt()", "sharedCartSummary().deliveryFee");
  html = html.replaceAll("cartTotal()", "sharedCartSummary().total");

  const declaration = "function openCheckout(skipCRM){";
  if (!html.includes(declaration)) throw new Error("Storefront checkout function was not found");
  html = html.replace(declaration, "function openCheckoutModal(skipCRM){");

  const redirectCheckout = `
<script>
function syncCheckoutPricing(){
  const summary=sharedCartSummary();
  if(window.Cart) cart=Cart.save(summary.items);
  return window.CartUI?CartUI.calculate():summary;
}

function openCheckout(skipCRM){
  stat("checkouts");
  ensureBonus();
  const summary=sharedCartSummary();
  cart=summary.items;
  if(!cart.length){ toast("Your cart is empty"); closeAI(); return; }
  if(summary.shortfall>0){
    toast("Minimum order "+money(CONFIG.minOrder)+" — add "+money(summary.shortfall)+" more");
    closeAI(); openCart(); return;
  }
  if(!skipCRM&&!isMember()&&!crmSeen("checkout")){
    markCRMSeen("checkout");
    crmResumeCheckout=true;
    closeDrawerOnly(); closeAI(); openCRM("join"); return;
  }
  syncCheckoutPricing();
  if(window.Cart) Cart.handoff();
  location.assign("/checkout");
}

if(window.Cart){
  Cart.subscribe(function(items){
    cart=items;
    updateCartCount();
    const drawer=document.getElementById("cartDrawer");
    if(drawer&&drawer.classList.contains("show")) renderCart();
  });
}
</script>`;

  html = html.replace("</body>", redirectCheckout + "\n</body>");
  cached = html;
  return html;
}

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const html = storefrontHtml();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=0, must-revalidate");
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(html);
  } catch (error) {
    console.error("storefront page error", error);
    return res.status(500).send("Storefront unavailable");
  }
}
