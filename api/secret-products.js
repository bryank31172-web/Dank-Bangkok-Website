/* GET /api/secret-products — staff-only inventory hidden from the storefront.
   The full POS record is preserved so staff can inspect price, stock, SKU,
   description and any other product metadata without exposing it publicly. */
import { getMenu, secretProducts } from "./_menu.js";
import { requireStaff } from "./_auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  if (!requireStaff(req, res)) return;

  try {
    const menu = await getMenu();
    res.setHeader("X-Menu-Rev", menu.rev);
    res.setHeader("X-Menu-Source", menu.source);
    return res.status(200).json(secretProducts(menu.data));
  } catch (error) {
    return res.status(500).json({ error: "no menu available" });
  }
}
