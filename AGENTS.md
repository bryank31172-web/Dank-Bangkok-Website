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

1. Delete the duplicate Vercel project `dankbkk-site-4jrn` — it builds the same
   repo on every push and holds no domain.
2. Set `SHOPIFY_STORE` + `SHOPIFY_ADMIN_TOKEN` to
   turn on the Shopify order push. The shop handle is `dankclubbkk`, so the
   store value is most likely `dankclubbkk.myshopify.com` — confirm it in
   Shopify → Settings → Domains rather than assuming; the public domain
   dankbkk.com is not the API host and answers 404. `GEMINI_API_KEY` (free
   tier) turns on the AI budtender. `/api/health` reports both.
3. In the POS, checked against the live feed on 25 Aug 2026:
   - `Gin tonic` is ฿321 and `vodka` ฿214 — 300 and 200 with 7% applied a
     second time. Both are bar items the storefront hides, so no customer sees
     the number, but the till's own totals are wrong.
   - `Onion Ring` exists three times at the same ฿150, one holding **4999**.
     `Backwood pack`, `stash pro lighter` and `Lemon cherry gelato` are each in
     twice at one price. Those four are true duplicates.
   - Another 18 names appear two or three times at *different* prices —
     Cappuccino at 60/80/120, Latte, Mocha, Americano, Espresso and the fruit
     sodas. Those are almost certainly sizes, and want the size in the name
     rather than deleting.
   - Two spellings, both mapped either way so no picture is lost: "Grape
     Gasolin" (no e), "Galic Man" / "White Galic" (no r).
4. `staff.html#box` — pick a POS product on each of the 7 gift rows, or the
   custom-box free items never decrement.

**Code:**

5. **Product photographs — far smaller than any older note claims.** Recounted
   off the live feed on **25 Aug 2026**: of **395** products, **17** fall
   through to a drawn `/api/tile`. Thirteen of those are the bar's, which the
   storefront hides. On the shelf a customer actually sees there are **4**, and
   only **2 are in stock**: **`Kamagra`** (66) and **`Frezzer Jam`** (60, a
   flower — probably "Freezer Jam" misspelt in the POS). The other two,
   `MonkeyKing Tip` and `ขิงผง โชคดี เขาค้อ`, are out of stock.
   Do not alias either to an existing photo — four SKUs once shared two
   pictures and that was logged as a defect, not a shortcut.
   `/photo-audit.html` now works this out itself and leads with the shop's own
   shelf, so **run that page rather than trusting a number written down here**.
   **`PROMPTS.md`, `CODEX-HANDOVER.md`, `CHATGPT-START.md`, `IMAGE-PROMPTS.md`,
   `IMAGE-QUEUE.csv` and `IMAGE-PROMPTS-ALL.csv` all predate this and say 296,
   271 or 19.** The method they describe is still correct; the size of the job
   is not.
6. 26 strain cards served from `cdn.shopify.com` have never been checked against
   `strain-db.json`. All twelve local cards in `assets/strains/` agree; the
   remote ones could not be fetched from the sandbox they were checked in.
   Re-checked 25 Aug 2026: `cdn.shopify.com`, `images.unsplash.com` and
   `linktr.ee` are all still refused by the network policy, so this still needs
   a browser outside the sandbox.
7. Shop tour: Bryan has an Insta360, nothing shot yet.

Fixed since the last handover, kept here so nobody re-reports them:

- **Telegram.** `TELEGRAM_CHAT_ID` was wrong and the log said `chat not found`.
  Bryan corrected it; `/api/health` → `wired.notify.telegram` is now `true` and
  `warnings` is empty.
- **Negative stock.** Eight bar lines used to carry it. The live feed has none.
- **`[bar] Whiskey Sour` filed under Edibles** is not a leak: the storefront
  catches it on `BAR_NAME` even though its category says otherwise. Verified
  against the live feed — 335 of 395 products reach the shelf and not one
  bottle is among them.

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

## Printable pages

Three pages exist only to be printed, and share their conventions — dark on
screen, white on paper, `.noprint` on the controls, `break-inside:avoid` on each
card:

- `table-qr.html` — table ordering cards, T1–T6 and the two bars.
- `labels.html` — product QR labels.
- `follow-qr.html` — "scan to follow" posters and stickers, in three sizes.
- `member-qr.html` — the new-member poster (free joint + 10%), A4 or two-up A5.
  Its terms are written to match `CONFIG.crm`; change one and change the other,
  or the sign on the wall and the cart disagree in front of the customer. Its
  left code is `/?open=member`, not the home page — the storefront honours that
  deep link and opens the sign-up form, where Bryan's own artwork had both
  codes pointing at the home page and the "JOIN MEMBERS" label was a lie the
  scanner could not see.
- `review-qr.html` — one "please review us" poster per branch, three sizes.
  Branch names and links are typed into the page and kept in `localStorage`,
  not written into the file: the links Bryan supplied are `maps.app.goo.gl`
  short links that cannot be resolved from a sandbox, so guessing which was
  Sathorn and which was Pattanakarn would have put the wrong code on the wrong
  wall. The page says so itself, and warns while any branch is still unnamed.
  Its wording is a switch with three presets, defaulting to **both** (a
  five-star ask and a review ask) because that is what Bryan chose after being
  told the trade: Google forbids soliciting a specific rating and can remove
  reviews collected that way, so the page says so and the "ขอรีวิว" preset
  reverts to the safe wording in one tap. Keep the poster a separate sign from
  the free-joint offer either way — an incentive attached to a review ask is
  the part that gets a business profile suspended.

The first two **draw** their codes with `qr.js` locally: a card that phones a QR
web service prints blank the day that service is slow or gone, and it hands
every link to a third party. `follow-qr.html` is the exception — it uses
`assets/linktree-qr.png`, the code Linktree itself issued, because it points at
`linktr.ee/qr/<uuid>` rather than `linktr.ee/dankbkk` and that is what makes the
scans show up in Bryan's Linktree stats. Redrawing it would reach the same page
and lose the numbers.

Anything printed must be scan-tested after a layout change, not just looked at.

## What a member gets

Two things, and the terms live in `CONFIG.crm` in `index.html`:

- **a free joint on the first order of ฿500 or more** — `jointMin:500`, once
  per member. The bar is a spend, not a weight, measured on `cartSubtotal()`:
  member prices count toward it, the delivery fee does not.
- **10% off every order, for as long as they stay logged in** —
  `discountPct:10`, code `CRM10`

The pop-up used to say 10% only, so the sign on the wall and the site
disagreed in front of the customer. If the offer changes, change `CONFIG.crm`
— the title, the sub and the badge all read from there.

The joint is wired, not just written: `memberJointDue()` in `index.html` grants
it when a member with an unspent claim has a cart subtotal of at least
`CONFIG.crm.jointMin` (฿500). Below that the cart shows an "add ฿X more" nudge
instead. It shows as a ฿0 totals row, the
order posts `memberJoint:true`, and `api/order.js` puts
`🚬 NEW MEMBER — ADD ONE FREE JOINT` in every staff channel and the owner's
email. `clearCartAfterOrder()` spends the claim only when the order actually
goes out.

It is deliberately **not** `appliedPromo`. That holds one coupon at a time, so
putting the joint there would silently cancel a discount code the customer
typed — or be cancelled by one. It stacks with both, and with the wheel prize.

A **free second gram on a first 1g+ order** used to run alongside this. Bryan
retired it on 25 Aug 2026 — one first-order gift, not two — so `ensureBonus()`
no longer grants it and `first_free_used` is no longer written. Do not put it
back without him asking. The volume ladder is a different thing and is
untouched: 3g→1g, 5g→2g, 7g→3g, 10g→4g free on **every** order, member or not.

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
