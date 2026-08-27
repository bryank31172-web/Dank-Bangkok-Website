import { getMenu } from "./_menu.js";
import {
  renderCategoryPage,
  renderLocationPage,
  renderLocationsPage,
  renderNotFound,
  renderProductPage,
  renderProductsPage,
  renderSitemap,
  renderStaticPage,
} from "./_seo.js";

function queryValue(value) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function handler(req, res) {
  const view = queryValue(req.query?.view);
  const sitemapType = queryValue(req.query?.sitemap);

  if (sitemapType) {
    let menu = [];
    let changedAt = 0;
    if (sitemapType === "products" || sitemapType === "product-categories") {
      const current = await getMenu();
      menu = current.data;
      changedAt = current.changedAt;
    }
    const xml = renderSitemap(sitemapType, menu, changedAt);
    if (!xml) return res.status(404).setHeader("X-Robots-Tag", "noindex, follow").send("Not found");
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");
    return res.status(200).send(xml);
  }

  let html = null;
  if (view === "products") {
    const current = await getMenu();
    html = renderProductsPage(current.data);
  } else if (view === "category") {
    const current = await getMenu();
    html = renderCategoryPage(current.data, queryValue(req.query?.category));
  } else if (view === "product") {
    const current = await getMenu();
    html = renderProductPage(current.data, queryValue(req.query?.category), queryValue(req.query?.product));
  } else if (view === "locations") {
    html = renderLocationsPage();
  } else if (view === "location") {
    html = renderLocationPage(queryValue(req.query?.location));
  } else if (["about", "contact", "faq", "blog"].includes(view)) {
    html = renderStaticPage(view);
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  if (!html) {
    res.setHeader("X-Robots-Tag", "noindex, follow");
    return res.status(404).send(renderNotFound());
  }
  res.setHeader("X-Robots-Tag", view === "blog" ? "noindex, follow" : "index, follow, max-image-preview:large");
  return res.status(200).send(html);
}
