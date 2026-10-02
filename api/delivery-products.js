/* Staff-only picker: the existing shared catalog is backed by the POS/database.
   Selections are stored in the same durable site_kv/Redis store as orders. */
import { requirePermission } from './_auth.js';
import { getJSON } from './_store.js';
import { getMenu } from './_menu.js';
import { ready, write, catalogProducts, configuredProductIds, PRODUCTS_CONFIG_KEY, LIVE_MENU_SOURCES } from './_delivery.js';

export function createCatalogHandler(deps = {}) {
  const d = { permission: requirePermission, get: getJSON, menu: getMenu, ready, write, ...deps };
  return async function handler(req,res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'GET or POST only' });
    if (!d.permission(req,res,'products')) return;
    try {
      if (!d.ready()) return res.status(503).json({ error: 'Product settings require the connected database' });
      const menu = await d.menu();
      if (!d.ready() || !LIVE_MENU_SOURCES.has(menu.source))
        return res.status(503).json({ error: 'Live product connection unavailable. Retry after the POS/database sync recovers.' });
      const products = catalogProducts(menu.data), allowed = new Set(products.map(p=>p.id));
      if (req.method === 'POST') {
        const ids = req.body?.ids;
        if (!Array.isArray(ids) || ids.length > 2000 || ids.some(id=>typeof id!=='string'||!allowed.has(id)))
          return res.status(400).json({ error: 'Select supported products from the current database catalog' });
        const config = { ids: [...new Set(ids)], updatedAt: Date.now() };
        await d.write(PRODUCTS_CONFIG_KEY, config, 365 * 86400);
        return res.status(200).json({ ok: true, ids: config.ids, updatedAt: config.updatedAt });
      }
      const config = await d.get(PRODUCTS_CONFIG_KEY);
      if (!d.ready()) return res.status(503).json({ error: 'Product database unavailable' });
      return res.status(200).json({ products, ids: configuredProductIds(config).filter(id=>allowed.has(id)),
        source: menu.source, updatedAt: config?.updatedAt || null });
    } catch { return res.status(503).json({ error: 'Product database unavailable. Please retry.' }); }
  };
}
export default createCatalogHandler();
