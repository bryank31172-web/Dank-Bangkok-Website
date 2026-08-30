import fs from "node:fs";
import path from "node:path";

let cached = "";

function storefrontHtml() {
  if (cached) return cached;

  const file = path.join(process.cwd(), "index.html");
  let html = fs.readFileSync(file, "utf8");

  const declaration = "function openCheckout(skipCRM){";
  if (!html.includes(declaration)) {
    throw new Error("Storefront checkout function was not found");
  }

  html = html.replace(declaration, "function openCheckoutModal(skipCRM){");

  const redirectCheckout = `
<script>
/* Checkout now lives on its own clean, mobile-friendly page. Keep the same
   safety checks and one-time CRM prompt before leaving the storefront. */
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

  /* Use both localStorage and sessionStorage. The checkout reads the session
     handoff first, then the canonical dank_cart key. This prevents stale or
     differently shaped cart data from appearing after navigation. */
  saveCart();
  try{
    localStorage.setItem("dank_cart",JSON.stringify(cart));
    sessionStorage.setItem("dank_checkout_cart",JSON.stringify(cart));
  }catch(error){
    console.warn("Could not prepare checkout cart",error);
  }
  location.assign("/checkout");
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
