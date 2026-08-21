# DANK BKK — project brief for Claude Code

Read this first. It is the complete handover. Bryan is not a developer — explain
things in plain words, and never paste a command you have not explained.

## What this is

A static website plus serverless functions for **DANK BKK**, a cannabis
dispensary in Bangkok. There is no build step and no framework. HTML, CSS and
JavaScript are written directly into the `.html` files. Vercel serves the root
folder as static files and turns every file in `api/` into a serverless
function.

- Live: <https://dankbkk-site.vercel.app>
- Repo: `bryank31172-web/dankbkk-site` (**private**)
- Domain Bryan wants: `dankbangkok.com` (not yet bought/pointed)

## The job in front of you

Bryan came here from a chat session to get this folder published. Two routes:

**Route A — publish straight from this folder (recommended).**

```bash
npx vercel login          # first time only
npx vercel --prod
```

Answer: `Y` → his own scope → `Y` (link to existing project) → project name
`dankbkk-site`. That deploys this exact folder over the live site and fixes all
three known defects in one go.

**Route B — push to GitHub and let Vercel build.** Only if he prefers it. The
repo currently has junk in it (see below), so this needs cleanup first.

Ask him which he wants before deploying anything. Deploying is not reversible
from his side without another deploy.

## Three known defects on the live site

Verified live on 4 August 2026. Everything else was green.

1. **`/photo-audit.html` returns 404.** A past upload stripped the hyphens, so
   the repo has `photoaudit.html`. The correct file is here in this folder.
2. **`/product-images.json` serves the wrong contents** — it is returning what
   is actually `product-codes.json`. The correct file is here.
3. **~48 loose copies of the `api/*.js` files sit in the repo root**, plus
   `photoaudit.html`, `productimages.json`, `skumargins.html`, and two images
   from an unrelated steel-company site (`rebar.jpg`, `squaretube.jpg`).
   They are dead weight. `DELETE-FROM-REPO.txt` (sent separately in chat) lists
   them. Deploying from this folder makes them irrelevant; deleting them only
   matters for Route B.

**Do not delete `qr.js` or `i18n.js` from the root.** They genuinely belong
there, and they share names with things inside `api/`.

## What is already working

Homepage, `/api/health`, `/api/products` (231 products), `/api/sales` (correctly
401s without a staff key), `/api/lab`, `/api/boxgifts`, `/api/tile`,
`/api/strain-info`, `staff.html` with all 8 tabs, `food.html`,
`sku-margins.html`, `table-qr.html`. Do not "fix" these.

## Environment variables (set in Vercel, never in files)

Every one of these is a hard requirement — there are no literal fallbacks left
in the code. Any unset variable makes its endpoint answer `503 not configured`.

| Variable | Status | Notes |
|---|---|---|
| `STAFF_KEY` | already set | **do not delete it** — staff console breaks |
| `ADMIN_EMAIL` | already set | owner login |
| `ADMIN_PASSWORD` | already set | stored as a SHA-256 hash in source |
| `ADMIN_SECRET` | already set | signs the admin session tokens |
| `MASTER_PIN` | **needs setting** | see security note below |
| `POS_SYNC_KEY` | **needs setting** | press 🔑 Generate in BRYAN POS → Settings → 🌐 Website / E-commerce, copy the `dank_…` value. The POS's own toast tells you to save it as `WEBSITE_API_KEY`, so the website accepts **either** name |
| `SUPABASE_URL` | **needs setting** | `https://xqxdnarcrdocssjfvuvw.supabase.co` — Bryan's project, Tokyo region |
| `SUPABASE_SERVICE_ROLE_KEY` | **needs setting** | the **secret** key, not the publishable one — see below |

After adding any variable: Vercel → Deployments → top one → `···` → Redeploy.
Environment variables are not picked up until a redeploy.

Without these two, every order, member record and wallet balance lives in one
server instance's memory and vanishes whenever Vercel restarts or scales.

## Storage — Supabase

Bryan chose Supabase over Upstash Redis in Aug 2026. Both still work;
`api/_store.js` prefers Supabase and falls back to Redis, then to memory.
`/api/health` → `wired.storageOn` says which one is actually live.

The website's data lives in `public.site_kv` (key / value jsonb / expires_at),
created by the `site_kv_store_for_website` migration. It is deliberately
separate from `kv_state` and `audit_log`, which belong to BRYAN POS — do not
merge them.

`site_kv` has RLS **on with no policies**, so only the service role key can
reach it, and `site_kv_bump()` (the atomic counter behind the rate limiters and
the gift ledger) is `SECURITY DEFINER` with execute revoked from `anon` and
`authenticated`. Keep both that way; orders and member records are in there.

**The one trap:** the publishable/anon key and the secret key sit side by side
on the API settings page. Because RLS denies rather than errors, the
publishable key returns `200 OK` and an empty list forever — the site looks
connected and remembers nothing. `_store.js` detects a publishable key by its
`sb_publishable_` prefix or its JWT `role` claim, refuses to use it, and
`/api/health` names it. Do not "fix" that check by removing it.

Nothing throws when the database is unreachable: a failing backend is treated
as an absent one, the request falls through to memory, and the fault is
retried every 30s. A wrong credential must never take the shop down again —
it did on 13 Aug 2026, when a Redis 401 made `/api/products` answer 500.

## Security rules — non-negotiable

- **Never commit `.env.local`.** It is gitignored. `.env.example` holds
  placeholders only and is safe.
- **`MASTER_PIN` must not be the same pin Bryan uses in his POS.** `pos.html` is
  the compiled BRYAN POS bundle, it is published publicly on the site, and that
  pin is readable in plain text inside it. Anyone viewing page source could
  unlock website promotions with it. Set a different 6-digit number in Vercel.
  The POS keeps its own pin unchanged. Never write either pin into a file.
- **Never bake any secret into client-side source.** Anything shipped reads from
  an env var.
- Merchant payment details in the source (KBank account, PromptPay, crypto
  wallets) are public on purpose. Leave them.
- Bryan pasted a GitHub personal access token into a chat once. It should be
  revoked: GitHub → Settings → Developer settings → Personal access tokens →
  delete it. Do not go looking for it in this folder; it is not here.

## Code conventions — read before editing

- `index.html`, `staff.html` and `i18n.js` contain characters that make `grep`
  treat them as binary. Use `grep -a`, or read them with Python using
  `errors='surrogateescape'`. Do not let an editor rewrite their encoding.
- `index.html` is ~539 KB and `staff.html` ~119 KB. They are single files on
  purpose. Do not split them into modules; that is not the deployment model.
- To syntax-check a page, extract its inline `<script>` blocks (those without a
  `src=`), join them, write a real `.js` file and run `node --check` on it.
  Process substitution (`node --check <(...)`) does not work.
- `staff.html` uses **event delegation** — one click listener reading
  `data-act` attributes into a `switch`. That is deliberate XSS mitigation.
  Do not add inline `onclick` handlers with interpolated ids to it.
  `index.html` still uses the older inline-onclick style.
- In `index.html`, `DATA`, `cart`, `activeCat`, `boxMode`, `adminMode`,
  `adminTok`, `ADMIN_OV` and friends are top-level `let` — lexical globals, not
  properties of `window`.
- Vercel ignores files in `api/` whose names start with `_`, so they do not
  count against the Hobby plan's function limit. `_store.js`, `_auth.js`,
  `_wallet.js`, `_phone.js` and `_ratelimit.js` are shared helpers.

## Storage model (`api/_store.js`)

Upstash Redis when the two env vars are set, otherwise an in-memory object.
Keys in use: `crm:members`, `pos:customers`, `wallet:<phone>`, `order:<id>`,
`orders:index` (+`:archive`), `orders:by:<phone>`, `mcode:<CODE>`,
`admin:overrides`, `topup:<chargeId>`, `tab:<phone>`, `tabs:phones`.
Phone numbers are normalised by `api/_phone.js`: digits only, a leading `66`
folded to `0`.

## Where things are in the UI

- **Owner login and promotions PIN**: homepage → scroll to the very bottom →
  the small grey copyright line has two links, **Owner** and **Promo**.
- **Staff console**: `staff.html`, tabs are Chats, Orders, Sales, Free gram,
  Count, Box gifts, Lab, Member.
- **Monthly sales report**: staff.html → Sales tab → Month view. It opens on
  last month by default and offers the last six months as chips, with a CSV
  button.
- **Customer display (CDS)**: `customer-display.html` — the screen that faces
  the customer at the counter. Live scale reading, the order as it is rung up,
  totals, payment QR, and the promo posters between customers. Driven by the
  POS over a `BroadcastChannel` (same machine) or `POST /api/cds` with a
  pairing code (separate tablet). The contract the POS has to send is in
  `CDS.md`; it needs `POS_SYNC_KEY` for the network path only.
- **Homepage editor**: Owner mode → `🎬 Homepage` on the green bar. Edits the
  hero text, all promo slides and the shop-tour links; publishes with
  `💾 Save changes`. Stored in `admin:overrides` under `site`.

## Open work, roughly in priority order

As of 14 Aug 2026, `/api/health` reports every wired flag true and an empty
`warnings` list. Nothing below is breaking the shop.

1. **Product photographs — nearly done, and the old count was wrong.** "271
   products still show a borrowed stand-in" was true when it was written and
   is not true now. Counted off the live feed on 21 Aug 2026: of 391 products,
   280 match a photograph by name, 56 carry one straight from the POS, 15 get
   a keyword or category photo, and **19 still fall through to a drawn
   `/api/tile`** — 12 of those in stock. Twelve of the nineteen are bar
   cocktails that belong on the 224 menu rather than the cannabis shelf. What
   is actually left: `Kamagra`, `MonkeyKing Tip` (out of stock), and the bar
   list. `IMAGE-QUEUE.csv` and `IMAGE-PROMPTS-ALL.csv` predate this and
   overstate the work; recount before trusting either.
2. Delete the duplicate Vercel project `dankbkk-site-4jrn` (failed build,
   confuses which deployment is live), and the now-unused `KV_*`, `KV_URL`,
   `REDIS_URL` variables left over from Upstash.
3. `staff.html#box` — Bryan needs to pick a POS product on each of the 7 gift
   rows and enter stock numbers, or the custom-box free items never decrement.
4. Shop tour: Bryan has an Insta360 and wanted both a video tour and a 360°
   one. Nothing has been shot yet.
5. Not set, so their features are dark: an AI key (AI chat and the LINE
   budtender — `api/_ai.js` accepts `GEMINI_API_KEY`, `GROQ_API_KEY`,
   `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY` or
   `XAI_API_KEY`, first one found wins, free tiers first; `/api/health` →
   `ai.provider` names the one actually live),
   `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` and `RESEND_API_KEY` (order
   notifications), `OMISE_*`/`TWOC2P_*`/`GBP_SECRET_KEY` (card payments).
   The storefront answers ~55 common questions on its own with no key at
   all, so a key only buys the long, unusual sentences.

Things for Bryan to fix in the POS rather than in code:

- `Gin tonic` 321 and `vodka` 214 are 300 and 200 with 7% applied a second
  time. Both are bar items, which the storefront hides, so customers never
  see them — but the till's totals are wrong.
- Eight bar lines carry negative stock.
- Three `onion ring` products, one holding 4999. Cappuccino, Latte, Mocha and
  Strawberry are each in there three times.
- `(cbd product) ขิงผง โชคดี เขาค้อ` still has no photograph, but it no longer
  "can never" have one: `flatNameIntl()` in `api/_menu.js` gives a Thai-only
  name a real key (`ขิงผงโชคดีเขาค้อ`) when the ASCII one comes out empty, so a
  `byName` entry now works. Renaming it in the POS is optional.
- Two spellings worth correcting, though both are mapped either way:
  "Grape Gasolin" (no e), "Galic Man" and "White Galic" (no r).

Done, kept here so nobody redoes them:

- **The Gelato 41 card** — its TASTE / FEELING / BEST FOR were word for word
  the Granddaddy Purple card. The three wrong lines were painted out of
  `assets/strains/gelato-41.jpg` and rewritten in place (creamy · sweet ·
  citrus / bright euphoria, easy body calm / daytime lift & good company);
  TYPE Hybrid was already right and was left alone. `strain-db.json` now
  carries the same words plus effects, terpene and lineage. It still prints
  no THC figure, because nobody has one — the card never had it either.
  All twelve local cards in `assets/strains/` were checked against
  `strain-db.json` after this; every one agrees. The strain cards served from
  `cdn.shopify.com` cannot be checked from a sandbox — the network policy
  refuses that host — so those remain Bryan's to eyeball.
- **Storage** — Supabase, Aug 2026. See the section above.
- **`MASTER_PIN`, `POS_SYNC_KEY`, domain** — all set. `dankbangkok.com` is
  live, bought through Vercel, with `.co` and `.shop` also owned.
- **The HYBRID badge on everything** — the POS sends `type` for every product
  and the site filled an empty one with "Hybrid", so onion rings and lighters
  wore a strain badge. `strainType()` in `api/_menu.js` now only defaults for
  flower-shaped categories; the badge falls back to the category.
- **Member prices looked like list prices** — with member mode on, the popup
  printed the discounted number bare. It now shows the list price struck
  through and a ⭐ label.
- **Botanical Legends cards** — 12 of them in `assets/strains/`, wired in
  `product-images.json` and `strain-db.json`. Cards are marked `card: true`,
  which makes their THC/type/flavour override the POS rather than fill a gap.
  Anything under `assets/strains/` letterboxes instead of cropping; generated
  photographs belong in `assets/products/`, which crops to fill.
- **Roll it into a joint** — every in-stock flower links to
  `build-your-joint.html?strain=<key>` and opens on 0.5 g. That builder used
  to offer six invented strains hard-coded in the page; it loads the till's
  own flower now, with the six kept only as an offline fallback.

- **Food menu placeholder data** — `food.html` now reads `/api/products` first
  and builds its tabs from the POS's own category names, so the menu matches
  the till by construction. `food-menu.json` is only the fallback.
- **The ÷1.07 VAT artifact** (onion rings at ฿140.187) — a POS that stores a
  net price and adds VAT arithmetically was handing over `131 * 1.07`, and
  nothing on the way in rounded it. `api/pos-feed.js`, `api/_menu.js` and
  `food.html` all round money to the baht at the boundary now. Stock is
  deliberately not rounded: flower stock is legitimately fractional grams.
- **`ai` block in `api/health.js`** — plus a `wired` block (booleans for every
  key the site needs) and a `warnings` list that says out loud when Upstash is
  missing, since nothing else about the site looks broken when it is.
- **Four SKUs sharing two photographs** — stale as of Aug 2026: `ztupid`,
  `zkittles`, `sherb-tank` and `baby-cake` each have their own photo. The
  remaining shared URLs in `product-images.json` are alias groups pointing one
  product's several spellings at one picture, which is what that file is for.

Bryan has explicitly declined two items — do not do them unless he asks again:
fixing the Snow Brands Pineapple Express 60% THC figure, and hardening the
edible potency-unit fallback.

## Content sourcing rules

Product facts may be taken from leafly.com and weed.com, but **their photographs
and their written descriptions must never be copied** — both are copyrighted.
Write descriptions in original wording. Unsplash images are fine, its licence
permits commercial use. dankbkk.com is Bryan's own site, so its copy is fair
game.

## How Bryan likes to work

Short, plain answers. Show him the actual button or link to press, not a
description of it. If something is broken, say so directly and say what you are
doing about it. He is usually on his phone, so long walls of text do not land.
