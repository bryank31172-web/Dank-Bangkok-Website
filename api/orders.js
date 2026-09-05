/* /api/orders — staff-only order list for the console (key = STAFF_KEY).
     GET  ?key=...                                  → {orders:[...]} newest first
     GET  ?key=...&limit=200&offset=200&archive=1   → page further back
     POST {orderId, status:"done"|"new", key}       → update order status  */
import { getJSON, setJSON, indexList } from "./_store.js";
import { requirePermission, staffIdentity } from "./_auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      if (!requirePermission(req, res, "orders")) return;
      /* The console asks for the default 60 and nothing else, which is why this
         reply keeps its {orders:[…]} shape. ?archive=1 also walks the overflow
         index that _store.js now keeps, and ?offset= steps through it — an
         archive nobody can read back is only a slower version of deleting the
         orders. The cap on `limit` is there because each id costs one store
         read; `total` and `nextOffset` tell the caller whether to ask again. */
      const limit = Math.min(Math.max(Number(req.query?.limit) || 60, 1), 300);
      const offset = Math.max(Number(req.query?.offset) || 0, 0);
      const ids = await indexList("orders:index", { includeArchive: Boolean(req.query?.archive) });
      const page = ids.slice(offset, offset + limit);
      const orders = [];
      for (const id of page) {
        const o = await getJSON("order:" + id);
        if (o) orders.push(o);
      }
      const nextOffset = offset + page.length;
      return res.status(200).json({
        orders, total: ids.length, offset,
        nextOffset: nextOffset < ids.length ? nextOffset : null,
      });
    }
    if (req.method === "POST") {
      if (!requirePermission(req, res, "orders")) return;
      const b = req.body || {};
      const o = await getJSON("order:" + b.orderId);
      if (!o) return res.status(404).json({ error: "not found" });
      const nextStatus=b.status==="done"?"done":"new";
      const actor=staffIdentity(req);
      if(nextStatus==="done"){
        const items=Array.isArray(o.items)?o.items:[];
        const isFlower=item=>{const category=String(item?.category||"").trim().toLowerCase().replace(/[\s_-]+/g,""),type=String(item?.type||item?.productType||"").trim().toLowerCase(),n=Number(item?.totalGrams??item?.grams);return ["flower","flowers","exotic","exotics","topshelf","midgrade","premium"].includes(category)||type.includes("flower")||(Number.isFinite(n)&&n>0)||/(\d+(?:\.\d+)?)\s*g\b/i.test(String(item?.option||item?.size||""));};
        const required=items.map((item,index)=>({item,index})).filter(x=>isFlower(x.item));
        const supplied=Array.isArray(b.weights)?b.weights:[], byIndex=new Map(supplied.map(x=>[Number(x?.index),Number(x?.grams)]));
        const invalid=required.filter(x=>!Number.isFinite(byIndex.get(x.index))||byIndex.get(x.index)<=0||byIndex.get(x.index)>1000);
        if(invalid.length)return res.status(400).json({error:"Enter the actual flower weight in grams before completing this order",flowerItems:invalid.map(x=>({index:x.index,name:String(x.item?.name||"Flower")}))});
        for(const {item,index} of required)item.actualGrams=Math.round(byIndex.get(index)*100)/100;
        o.flowerWeights={recordedAt:Date.now(),recordedBy:actor?.name||"Staff",items:required.map(x=>({index:x.index,name:String(x.item?.name||"Flower"),grams:x.item.actualGrams}))};
        o.completedBy={id:String(actor?.id||""),name:String(actor?.name||"Staff"),at:Date.now()};
      }else{
        delete o.completedBy;
      }
      o.status=nextStatus;
      await setJSON("order:" + b.orderId, o);
      return res.status(200).json({ ok: true, completedBy:o.completedBy||null });
    }
    return res.status(405).json({ error: "method" });
  } catch (e) {
    console.error("orders error:", e.message);
    return res.status(500).json({ error: "server" });
  }
}
