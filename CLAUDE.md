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
| `POS_SYNC_KEY` | **needs setting** | generate in BRYAN POS → Settings → 🌐 Website / E-commerce connection |
| `UPSTASH_REDIS_REST_URL` | **needs setting** | without it, storage is in-memory only |
| `UPSTASH_REDIS_REST_TOKEN` | **needs setting** | Upstash has a free tier |

After adding any variable: Vercel → Deployments → top one → `···` → Redeploy.
Environment variables are not picked up until a redeploy.

Without the two Upstash values, every order, member record and wallet balance
lives in one server instance's memory and vanishes whenever Vercel restarts or
scales. That is the single most valuable thing left to fix.

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

## Open work, roughly in priority order

1. Set the two Upstash variables so data survives restarts.
2. Set `MASTER_PIN` to a new 6-digit number (see the security note above).
3. Set `POS_SYNC_KEY` so BRYAN POS and the website can talk.
4. Buy `dankbangkok.com` and point it at the `dankbkk-site` Vercel project.
5. Delete the duplicate Vercel project `dankbkk-site-4jrn` (it has a failed
   build and confuses which deployment is live).
6. `staff.html#box` — Bryan needs to pick a POS product on each of the 7 gift
   rows and enter stock numbers, or the custom-box free items never decrement.
7. Food menu: chrome and category names are translated into th/zh/ru/ja/es, but
   the 40 items, 6 bundles and their prices are still placeholder text.
8. Four SKUs share two photographs (`ztupid`+`zkittles`,
   `sherb-tank`+`baby-cake`) and `crispyboy` is on a stock lager photo.
9. Add an `ai: { brain: Boolean(process.env.XAI_API_KEY), model: ... }` block to
   `api/health.js` — booleans only, never the key itself.
10. Investigate a ÷1.07 VAT artifact in some prices (e.g. onion rings at
    ฿140.187).

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
