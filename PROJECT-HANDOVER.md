# DANK BKK — project handover

Everything a developer (or an AI you are pasting this into) needs to pick up
work on this site. Self-contained: you should not need to read the source to
understand the shape of it.

**Live:** <https://dankbangkok.com> · also `dankbkk-site.vercel.app`
**Repo:** `bryank31172-web/dankbkk-site` (private)
**Owner:** Bryan — not a developer. Explain in plain words, show the actual
button to press, keep it short. He is usually on a phone.

---

## What this is

A cannabis dispensary's storefront in Bangkok. Static HTML plus serverless
functions. **No build step and no framework** — HTML, CSS and JavaScript are
written directly into the `.html` files. Vercel serves the repo root as static
files and turns every file in `api/` into a serverless function. There is
nothing to compile, no `npm run build`, no bundler.

The shop runs its own till, **BRYAN POS**, which pushes its live catalogue to
the website. The website is downstream of the till for products, prices and
stock — it does not own any of that.

### The pages

| file | what it is |
|---|---|
| `index.html` | the storefront. ~545 KB, single file **on purpose** |
| `build-your-joint.html` | custom joint builder — flower, weight, resin, hash, filter, paper |
| `food.html` | kitchen and drinks menu, built from the POS's own categories |
| `staff.html` | staff console: Chats, Orders, Sales, Free gram, Count, Box gifts, Lab, Member |
| `customer-display.html` | the second screen facing the customer at the counter |
| `photo-audit.html` | live report of which products still lack a photograph |
| `pos.html` | the compiled BRYAN POS bundle, published publicly |
| `table-qr.html`, `sku-margins.html` | small internal tools |

### The API

Everything in `api/`. Files starting with `_` are shared helpers and are
ignored by Vercel's function count.

| file | role |
|---|---|
| `_menu.js` | **the important one.** Fetches and normalises the catalogue, attaches images and strain data |
| `_store.js` | storage adapter — Supabase, else Redis, else memory |
| `_auth.js` | shared key/token helpers |
| `_ratelimit.js`, `_phone.js`, `_wallet.js` | as named |
| `health.js` | one call that says whether everything is wired |
| `pos-feed.js` | where BRYAN POS pushes its catalogue |
| `products.js` | the catalogue the storefront reads |
| `admin.js` | owner login and the promotions PIN |
| `cds.js` | relay for the customer display |
| `order.js`, `orders.js`, `sales.js`, `member.js`, `wallet.js` … | the rest |

---

## Where the catalogue comes from

`api/_menu.js` → `fetchUpstream()`, in order, first hit wins:

1. **POS push feed** — BRYAN POS posts to `/api/pos-feed`, cached in storage
2. `MENU_FEED_URL` — a generic feed, if set
3. **POS pull** — the website asks the POS directly
4. **StoreHub** — the old POS
5. `products.json` — bundled fallback catalogue

Today it runs on **1**, about 385 products.

Then two passes run over whatever came back:

- **`fillImages()`** attaches a picture
- **`fillStrainInfo()`** attaches THC, type, flavours, effects, description

---

## How a product gets its picture

This is the part that most often goes wrong, so it is worth understanding
before touching anything.

The lookup key is the **product name flattened**: lowercased, bracketed words
removed, everything that is not a letter or digit removed.

```
"(Weed) Grape Gasolin"  ->  grapegasolin
"( equipment ) Bong XL ( 50 cm )"  ->  bongxl
```

`product-images.json` maps that key to an image. A value is **either** one
path **or** a list — with a list the first is the main picture and the rest
become a thumbnail strip in the product popup.

```jsonc
"grapegasolin": "assets/strains/grape-gasoline.jpg",
"cocochanel":   ["assets/strains/coco-chanel.jpg", "https://cdn.shopify.com/…"]
```

`fillImages()` tries, in order:

1. exact key match
2. **rolled products** — a trailing `joint`/`blunt`/`preroll`/`cone` is
   stripped and the strain looked up, so "Zkittles Joint" wears the Zkittles
   picture without anyone listing it
3. keyword match — for flower and rolled products this scans only the shop's
   own photographs first, so `chocolate chip joint` cannot be served a
   photograph of chocolate
4. a generic photo for the category — never for flower
5. a leaf placeholder

### Two asset folders, and the difference matters

| folder | contents | displayed |
|---|---|---|
| `assets/strains/` | Botanical Legends artwork cards, 3:2 | **letterboxed**, never cropped |
| `assets/products/` | photographs, square | cropped to fill |

`index.html` adds a CSS class to any image whose path contains
`assets/strains/`. The cards carry the strain name down the left and a stats
strip along the bottom; cropping them to a square throws both away. A square
product photo should fill the frame, so it goes in the other folder.

---

## Strain data

`strain-db.json`: `strains` keyed by the same flattened name, plus an `alias`
map for the till's spellings. Each record carries `type`, `thc`, `cbd`,
`terpene`, `effects`, `flavors`, `lineage`, `desc`.

A record marked **`card: true`** comes off one of the shop's own printed
Botanical Legends cards. Those override whatever the POS says, because the
card is what hangs on the wall and what the budtender reads out — the site
must not disagree with the counter. Every other record only fills gaps and
never overwrites the shop's own copy.

---

## Storage

`api/_store.js`. Three backends, in order: **Supabase → Redis → memory.**
Live today on Supabase, in `public.site_kv` (key / value jsonb / expires_at),
Tokyo region. That table is deliberately separate from `kv_state` and
`audit_log`, which belong to BRYAN POS.

RLS is on with **no policies**, so only the service role key can reach it, and
`site_kv_bump()` — the atomic counter behind the rate limiters and the gift
ledger — is `SECURITY DEFINER` with execute revoked from `anon`.

**A failing backend is treated as an absent one.** The request falls through
to memory and still serves the customer; the fault is remembered and retried
every 30s, so fixing a credential heals the site without a redeploy. This
matters: on 13 Aug 2026 a Redis 401 made every `getJSON` throw and
`/api/products` answer 500 — the shop showed an empty page. A wrong
credential must never take the shop down again.

---

## Environment variables

All set in Vercel. Never in files — `.env` and `.env.local` are gitignored,
and **nothing in this project reads a `.env` file**; there is no dotenv, so a
committed one would do nothing at all.

| variable | for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | storage. The **secret** key, not the publishable one |
| `POS_SYNC_KEY` | BRYAN POS ↔ website. `WEBSITE_API_KEY` also accepted |
| `STAFF_KEY` | staff console |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_SECRET` | owner login |
| `MASTER_PIN` | promotions PIN — 6 digits, **must differ from the POS's pin** |

`pos.html` is the compiled POS bundle and is published publicly, so the POS's
own pin is readable in page source. Using the same number would let anyone
viewing source unlock website promotions.

Variables are read **at deploy time**. Changing one and not redeploying leaves
the running site on the old value — this cost an hour once.

`/api/health` reports every one as a boolean, plus a `warnings` list, plus a
check that names any variable whose spelling is within two characters of one
the code reads but which is not itself read (`MATER_PIN` → did you mean
`MASTER_PIN`). It has already caught two real typos.

---

## Conventions and traps

- `index.html`, `staff.html` and `i18n.js` contain bytes that make `grep`
  treat them as binary. Use `grep -a`, or read them in Python with
  `errors='surrogateescape'`. Do not let an editor rewrite their encoding.
- **Do not split the big files into modules.** A single file is the
  deployment model.
- To syntax-check a page: extract its inline `<script>` blocks (those without
  `src=`), join them into a real `.js`, run `node --check`. Process
  substitution does not work.
- `staff.html` uses **event delegation** — one click listener reading
  `data-act` into a `switch`. That is deliberate XSS mitigation; do not add
  inline `onclick` handlers with interpolated ids to it. `index.html` still
  uses the older inline-onclick style.
- In `index.html`, `DATA`, `cart`, `activeCat`, `adminMode`, `adminTok` and
  friends are top-level `let` — lexical globals, not properties of `window`.
- Money is rounded to the baht at every boundary. The POS stores
  **tax-inclusive** prices, so **never add VAT** — the numbers already
  include it. Stock is deliberately *not* rounded: flower stock is
  legitimately fractional grams.
- Bar items are hidden from the storefront by category regex.
- Ledger lines the till emits — Delivery, Pay In Advance, TF to Cash, Visa —
  are filtered out by whole-word matching, because a naive filter deletes
  Papaya Fuel, Payload OG and Cash Crop.

---

## Testing

There is no test runner. What has been used, and works:

**Node, for the API layer** — import the module and assert:

```bash
node --input-type=module -e '
import { fillImages, fillStrainInfo } from "./api/_menu.js";
const r = await fillStrainInfo(await fillImages([{name:"(Weed) Papaya Fuel",category:"Weed"}]));
console.log(r[0].image, r[0].thcLabel, r[0].type);
'
```

**Playwright, for the pages** — Chromium is at `/opt/pw-browsers/chromium`,
use `playwright-core`. Serve the folder with a tiny `http.createServer` and
stub `/api/products` so the test controls the catalogue. Drive the real page:
click through the age gate, push a product into `DATA`, call `openPD(id)`,
assert on the DOM.

**Take screenshots.** Two real bugs this session were invisible to assertions
and obvious in a picture: artwork being cropped in the popup because a longer
CSS selector won the cascade, and the joint builder opening on 1 G when the
button that led there advertised half a gram.

---

## Content rules

- Product facts may be taken from leafly.com and weed.com. **Their
  photographs and their written descriptions must never be copied** — both
  are copyrighted. Write descriptions in original wording.
- Unsplash is fine; its licence permits commercial use.
- `dankbkk.com` is Bryan's own site (a separate Shopify store, still trading),
  so its copy is fair game. Do not repoint that domain.

---

## What is open

See the "Open work" section of `CLAUDE.md`, which is kept current. The short
version: 271 products still need photographs, one artwork card has the wrong
text on it, and there are a handful of data problems in the POS that only
Bryan can fix.
