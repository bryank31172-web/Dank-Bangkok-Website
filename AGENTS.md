# AGENTS.md — start here

Codex reads this file automatically. It is the short version; **`CLAUDE.md` in
this same folder is the full brief** and is kept current. Read that before
changing anything you do not already understand.

Bryan owns this shop and is not a developer. Explain in plain words, show him
the actual button to press, and never paste a command you have not explained.
He is usually on his phone, so long walls of text do not land.

## What this is

A static website plus serverless functions for **DANK BKK**, a cannabis
dispensary in Bangkok. **No build step and no framework.** Vercel serves the
repo root as static files and turns every file in `api/` into a serverless
function. There is nothing to compile, nothing to `npm run`.

- Live: <https://dankbangkok.com> · Repo: `bryank31172-web/dankbkk-site` (private)
- The shop also runs a Shopify storefront at **dankbkk.com**; website orders are
  pushed into its admin. Two shops, one order book.

## Rules that must not be broken

1. **Never commit a secret.** `.env.local` is gitignored; `.env.example` holds
   placeholders only. Everything shipped to a browser reads from an env var.
   Payment details already in the source (KBank, PromptPay, crypto) are public
   on purpose — leave them.
2. **`MASTER_PIN` must never equal the POS pin.** `pos.html` is the compiled POS
   bundle and is published publicly; that pin is readable in page source.
3. **Do not split `index.html` or `staff.html` into modules.** They are single
   files on purpose — that is the deployment model, not an accident.
4. **Anything that lists products to a customer reads `shopData()`, never
   `DATA`.** Four lists once read `DATA` directly and put the bar's tequila on
   the cannabis shelf. See the comment above `SHOP_HIDE_CAT` in `index.html`.
5. **Do not remove the publishable-key check in `api/_store.js`.** Supabase's
   publishable key returns `200 OK` and an empty list forever, so the site looks
   connected and remembers nothing.
6. **Do not add inline `onclick` with interpolated ids to `staff.html`.** It uses
   event delegation on `data-act` as deliberate XSS mitigation. (`index.html`
   still uses the older inline style.)
7. **Write scratch files outside the repo.** A syntax-check helper once dropped
   `idx.js` in the root and `git add -A` committed 5,365 lines of dead code.

## Working on the big HTML files

`index.html` (~645 KB), `staff.html` (~120 KB) and `i18n.js` contain bytes that make
`grep` treat them as binary. Use `grep -a`, or read them in Python with
`errors='surrogateescape'`. Do not let an editor rewrite their encoding.

To syntax-check a page: extract its inline `<script>` blocks (skip any with
`src=`, and skip non-JS types like `application/ld+json`), join them, write a
real `.js` file **outside the repo**, and run `node --check` on it. Process
substitution (`node --check <(...)`) does not work.

## What is actually left

Roughly in the order that matters. `CLAUDE.md` has the detail on each.

**Bryan's, not code:**

1. **Telegram is broken** — `TELEGRAM_CHAT_ID` is wrong; the log says
   `chat not found`. Vercel → Settings → Environment Variables → **Edit** that
   variable (not Add) → Redeploy. Five orders from 20 Aug were saved but never
   announced; they are in `staff.html` → Orders.
2. Delete the duplicate Vercel project `dankbkk-site-4jrn` — it builds the same
   repo on every push and holds no domain.
3. Set `SHOPIFY_STORE` + `SHOPIFY_ADMIN_TOKEN` to
   turn on the Shopify order push. The shop handle is `dankclubbkk`, so the
   store value is most likely `dankclubbkk.myshopify.com` — confirm it in
   Shopify → Settings → Domains rather than assuming; the public domain
   dankbkk.com is not the API host and answers 404. `GEMINI_API_KEY` (free
   tier) turns on the AI budtender. `/api/health` reports both.
4. In the POS: seven bottles are filed under **Exotics with unit "g"**, so the
   site priced a tequila shot per gram. `[bar] Whiskey Sour` is under Edibles.
   Also `Gin tonic` and `vodka` have VAT applied twice, eight bar lines carry
   negative stock, and several products are duplicated.
5. `staff.html#box` — pick a POS product on each of the 7 gift rows, or the
   custom-box free items never decrement.

**Code:**

6. **Product photographs — much smaller than the old notes claim.** Counted off
   the live feed on 21 Aug: of 391 products, **19 fall through to a drawn
   `/api/tile`**, and twelve of those are bar cocktails that belong on the 224
   menu rather than the cannabis shelf. What is genuinely missing: `Kamagra`,
   `MonkeyKing Tip` (out of stock), and the bar list.
   **`PROMPTS.md`, `CODEX-HANDOVER.md`, `CHATGPT-START.md`, `IMAGE-PROMPTS.md`,
   `IMAGE-QUEUE.csv` and `IMAGE-PROMPTS-ALL.csv` all predate this and say 296 or
   271. Recount before trusting any of them** — the method they describe is
   still correct, the size of the job is not.
7. 26 strain cards served from `cdn.shopify.com` have never been checked against
   `strain-db.json`. All twelve local cards in `assets/strains/` agree; the
   remote ones could not be fetched from the sandbox they were checked in.
8. Shop tour: Bryan has an Insta360, nothing shot yet.

Bryan has explicitly declined two things — do not do them unless he asks again:
fixing the Snow Brands Pineapple Express 60% THC figure, and hardening the
edible potency-unit fallback.

## How a picture reaches a product

`product-images.json` → `byName` is keyed on the product name **flattened**:
lowercased, bracketed words removed, everything that is not a letter or digit
deleted. `( weed ) Ztupid` → `ztupid`. A Thai-only name falls back to
`flatNameIntl()` in `api/_menu.js`, which keeps letters in any script.

Photographs go in `assets/products/` (cropped to fill, 1254×1254 is the house
size). Strain cards go in `assets/strains/` (letterboxed, never cropped) and are
marked `card: true` in `strain-db.json`, which makes their THC/type/flavour
override the POS rather than fill a gap.

## Content rules

Product facts may come from leafly.com and weed.com, but **their photographs and
their written descriptions are copyrighted — never copy either.** Write
descriptions in original wording. Unsplash is fine. dankbkk.com is Bryan's own
site, so its copy is fair game.

## Do not "fix" these

They are working and were deliberate: the storefront's ~55 built-in chat
answers, the flower-first shelf order, the aspect-ratio test that letterboxes
strain cards, the cookie bar's wording (it describes anonymous server-side
counting, which is why it no longer asks permission), and the fact that Shopify
orders are created **unpaid** and do not move Shopify's stock.
