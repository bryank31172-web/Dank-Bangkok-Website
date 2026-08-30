import fs from "node:fs";
import path from "node:path";

let cached = "";

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Storefront cart migration failed: ${label}`);
  }
  return source.replace(search, replacement);
}

function storefrontHtml() {
  if (cached) return cached;

  const file = path.join(process.cwd(), "index.html");
  let html = fs.readFileSync(file, "utf8");

  /* Load the shared cart service before the storefront application script. */
  html = replaceRequired(
    html,
    `<script>\n/* ============================================================\n   1) CONFIG`,
    `<script src="/cart-service.js?v=2"></script>\n<script>\n/* ============================================================\n   1) CONFIG`,
    "cart service injection"
  );

  /* Storefront cart state now starts from the shared service. */
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

  html = html.replaceAll(`cart=LS.get("cart",[])||[];`, `cart=window.Cart?Cart.getItems():(LS.get("cart",[])||[]);`);

  html = replaceRequired(
    html,
    `function updateCartCount(){ const n=cart.reduce((s,c)=>s+c.qty,0); const el=$("#cartCount"); el.textContent=n; el.classList.toggle("hidden",n===0); }\nfunction cartSubtotal(){ return cart.reduce((s,c)=>s+c.price*c.qty,0); }`,
    `function updateCartCount(){ const n=window.Cart?Cart.count(cart):cart.reduce((s,c)=>s+c.qty,0); const el=$("#cartCount"); el.textContent=n; el.classList.toggle("hidden",n===0); }\nfunction cartSubtotal(){ return window.Cart?Cart.subtotal(cart):cart.reduce((s,c)=>s+c.price*c.qty,0); }`,
    "cart totals"
  );

  html = replaceRequired(
    html,
    `  const found=cart.find(c=>c.key===key);\n  if(found){ found.qty++; }\n  else cart.push({key,id:p.id,shId:(tier&&tier.shId)||p.shId||"",name:p.name,tierLabel:tier?tier.label:(p.unit||"each"),price,qty:1,image:p.image,type:p.type,category:p.category});\n  updateCartCount(); saveCart();`,
    `  const line={key,id:p.id,shId:(tier&&tier.shId)||p.shId||"",name:p.name,tierLabel:tier?tier.label:(p.unit||"each"),price,qty:1,image:p.image,type:p.type,category:p.category};\n  if(window.Cart) cart=Cart.add(line,1);\n  else { const found=cart.find(c=>c.key===key); if(found) found.qty++; else cart.push(line); }\n  updateCartCount(); saveCart();`,
    "addToCart mutation"
  );

  html = replaceRequired(
    html,
    `function changeQty(key,d){ const it=cart.find(c=>c.key===key); if(!it)return; it.qty+=d; if(it.qty<=0) cart=cart.filter(c=>c.key!==key); updateCartCount(); saveCart(); renderCart(); }\nfunction removeLine(key){ cart=cart.filter(c=>c.key!==key); updateCartCount(); saveCart(); renderCart(); }`,
    `function changeQty(key,d){\n  if(window.Cart) cart=Cart.updateQty(key,d,{mode:"delta",minimum:1,removeBelowMinimum:true});\n  else { const it=cart.find(c=>c.key===key); if(!it)return; it.qty+=d; if(it.qty<=0) cart=cart.filter(c=>c.key!==key); }\n  updateCartCount(); saveCart(); renderCart();\n}\nfunction removeLine(key){\n  cart=window.Cart?Cart.remove(key):cart.filter(c=>c.key!==key);\n  updateCartCount(); saveCart(); renderCart();\n}`,
    "quantity and removal mutations"
  );

  html = replaceRequired(
    html,
    `function clearCartAfterOrder(){ if(cart.some(c=>c.bonus1st)) LS.set("first_free_used",1); cart=[]; appliedPromo=null; coFulfill="delivery"; boxMode=false; LS.set("boxmode",0); saveCart(); updateCartCount(); }`,
    `function clearCartAfterOrder(){ if(cart.some(c=>c.bonus1st)) LS.set("first_free_used",1); cart=window.Cart?Cart.clear():[]; appliedPromo=null; coFulfill="delivery"; boxMode=false; LS.set("boxmode",0); updateCartCount(); }`,
    "clear cart"
  );

  const declaration = "function openCheckout(skipCRM){";
  if (!html.includes(declaration)) {
    throw new Error("Storefront checkout function was not found");
  }
  html = html.replace(declaration, "function openCheckoutModal(skipCRM){");

  const redirectCheckout = `
<script>
/* Full-page checkout entry point backed by the shared Cart service. */
function openCheckout(skipCRM){
  stat("checkouts");
  ensureBonus();
  if(!cart.length){ toast("Your cart is empty"); closeAI(); return; }
  const short=CONFIG.minOrder-cartSubtotal();
  if(short>0){
    toast("Minimum order "+money(CONFIG.minOrder)+" — add "+money(short)+" more");
    closeAI(); openCart(); return;
  }
  if(!skipCRM&&!isMember()&&!crmSeen("checkout")){
    markCRMSeen("checkout");
    crmResumeCheckout=true;
    closeDrawerOnly(); closeAI(); openCRM("join"); return;
  }
  saveCart();
  if(window.Cart){
    cart=Cart.save(cart);
    Cart.handoff();
  }
  location.assign("/checkout");
}

/* Keep the storefront mirror synchronized when another tab or the checkout
   changes the shared cart. Do not re-render the drawer unless it is open. */
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
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(html);
  } catch (error) {
    console.error("storefront page error", error);
    return res.status(500).send("Storefront unavailable");
  }
}
