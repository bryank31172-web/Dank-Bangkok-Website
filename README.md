# DANK BKK — deploy-ready site + backend

**✅ StoreHub is wired up.** The connector calls `api.storehubhq.com` with your
Basic-auth credentials (username `dankclub`) to pull the live menu, stock and
prices — the same StoreHub backend behind your POS app
(`dank-medical-pos-app.vercel.app`), so the website and POS stay in sync.
Because StoreHub products have no photos or THC, the site parses THC/type/weight
from product names and auto-draws a branded photo when there's no image.
Credentials live in `.env.local` (local) and Vercel env vars (production) — keep
them private; rotate the token if it leaks.

---

## 🚀 GO LIVE — publish in ~10 minutes

1. **Create a Vercel account** at vercel.com (free), verify email.
2. **Upload the project:** New → Project → drag this whole folder in (or push to
   GitHub and Import). Vercel auto-detects the `api/` functions.
3. **Add environment variables** (Project → Settings → Environment Variables).
   Minimum to go live with the real menu:
   - `STOREHUB_STORE` = `dankclub`
   - `STOREHUB_TOKEN` = `7e19734882c844c4bfa87906cf3a94c5`
   - `STAFF_KEY` = *(pick your own staff password)*
   Then add the rest as you get them (Omise, xAI/Grok, Resend, Telegram, Upstash — table below).
4. **Deploy.** Open the preview URL; confirm the menu loads. Check
   `your-url/api/storehub-raw?key=YOUR_STAFF_KEY` to see the raw StoreHub data
   (send me that output and I'll fine-tune the product mapping to your catalogue).
5. **Point your domain:** Settings → Domains → add `dankbkk.com` and
   `www.dankbkk.com`, then at your registrar set the DNS record Vercel shows.
   Live in minutes.
6. **Staff:** open `dankbkk.com/staff.html`, log in with `STAFF_KEY`. Keep it open
   on the shop tablet for orders + chats. Pick the free-gram SKUs in the 🎁 tab.

> Prefer no-code hosting? Netlify and Cloudflare Pages work the same way (drag
> the folder, set the same env vars).

---

## Environment variables

| Key | What it does | Where to get it |
|---|---|---|
| `STOREHUB_STORE` | Your StoreHub subdomain (e.g. `dankbkk` from `dankbkk.storehubhq.com`) | You already have this |
| `STOREHUB_TOKEN` | StoreHub API token → turns on the **live menu + photos + stock** | Ask StoreHub Care to enable API access for your account; they issue the token |
| `XAI_API_KEY` | Grok key → DANK AI answers **any** open-ended question | console.x.ai → API keys |
| `GROK_MODEL` | Optional, default `grok-4` | — |
| `RESEND_API_KEY` | Emails each order to you | resend.com (free) → API key; verify your domain or use their test sender |
| `ORDER_EMAIL_TO` | Where orders go. Default `dankclubbkk@gmail.com` | — |
| `ORDER_FORWARD_URL` | Optional: also POST each order into BRYAN POS's own order-intake endpoint (Orders tab) | From your POS developer |
| `TELEGRAM_BOT_TOKEN` | **Staff handoff pings** — instant push to your staff Telegram group when DANK AI transfers a chat | Message @BotFather on Telegram → /newbot → copy token |
| `TELEGRAM_CHAT_ID` | The staff group's chat id | Add the bot to your staff group, send a message, open `api.telegram.org/bot<TOKEN>/getUpdates`, copy `chat.id` (negative number) |
| `HANDOFF_EMAIL_TO` | Optional: handoff emails go here (default = ORDER_EMAIL_TO) | — |
| `HANDOFF_FORWARD_URL` | Optional: also POST handoffs into BRYAN POS (Alerts) | From your POS developer |
| `STAFF_KEY` | Password for the staff console (`/staff.html`). Default is `dankstaff` — **change it before going live** | Pick any secret |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Chat + order storage. Without it, things work but may reset between serverless instances — set this before going live | upstash.com → create free Redis DB → REST API tab (2 min) |
| `OMISE_PUBLIC_KEY` | Omise (Opn Payments) public key `pkey_...` — enables **online payment** (PromptPay QR + cards) at checkout | Omise dashboard → Keys |
| `OMISE_SECRET_KEY` | Omise secret key `skey_...` — used server-side only to create charges | Omise dashboard → Keys |
| `MENU_FEED_URL` | Optional: a URL from your **BackStore / BackOffice web app** that returns the product JSON array. Takes priority over StoreHub — point it at any backend that can output the menu | Your backend |
| `MENU_TTL_SECONDS` | How fresh the menu is (default `30`). Lower = closer to real-time, more upstream calls | — |
| `WEBHOOK_SECRET` | Optional shared secret for `/api/storehub-webhook` | Pick any secret |

## How each piece works

**Near-real-time menu (`/api/products` + `/api/menu-version` + `/api/storehub-webhook`).**
All menu reads go through one shared cache (`api/_menu.js`). Data source
priority: `MENU_FEED_URL` (your BackStore/BackOffice web-app feed) → StoreHub
API → bundled `products.json`. The response header `X-Menu-Source` tells you
which is live (`feed` / `storehub` / `bundled`).

How the storefront stays live: on load it reads the menu plus a change-`rev`.
Every ~30s (and whenever the tab regains focus, and again right before an
order is placed) it polls the tiny `/api/menu-version` endpoint; if the `rev`
changed — because stock sold or a price moved in your BackOffice — it pulls a
fresh menu and re-renders **without losing the customer's cart or scroll
position**, showing a "🔄 Menu updated" toast and a pulsing **LIVE** badge.
Because every visitor shares the server cache, your BackOffice/StoreHub is
queried at most about once per `MENU_TTL_SECONDS` no matter how many people
are browsing.

Want it *instant* instead of ~30s? Have your BackOffice (or a middleware like
Zapier/Make/storehub.io) POST to `/api/storehub-webhook` on any stock/price
change — it clears the cache so the next poll picks up the change immediately.
An **oversell guard** also re-checks stock at the moment an order is placed,
so a customer can't buy something that just went out of stock.
All StoreHub-specific field mapping lives in `api/_storehub.js` — send me one
sample product JSON from StoreHub and I'll match it exactly.

**`/api/order`** — checkout posts orders here. Every order is **always saved
and shown in the staff console's 🛒 Orders tab** (with a badge, sound ping,
customer phone tap-to-call, and a Mark-done button). On top of that it can
notify through: **Telegram** group ping with the full order + a console link
(same bot as chat handoffs — phones buzz instantly), **email** via Resend,
and/or `ORDER_FORWARD_URL` into BRYAN POS. The storefront also keeps its
LINE/WhatsApp path as backup so no sale is ever lost.

**`/api/chat`** — DANK AI's open-ended brain. The built-in engine answers
common questions instantly (price, effects, delivery, hours, Thai/English);
anything else goes to Grok with your live menu injected as context, so answers
quote real products and real ฿ prices. No `XAI_API_KEY` yet? It quietly falls
back to the polite built-in reply.

**`/api/handoff`** — human takeover. DANK AI transfers the chat when the
customer asks for staff (any phrasing, Thai or English, or the "Talk to a
human" chip) or after it fails to answer twice in a row. It collects the
customer's phone/LINE ID, then pushes the **full conversation + cart +
contact** to staff instantly: Telegram group ping (best — phones buzz),
email, and/or your POS. The customer gets a ticket number and a one-tap
"Continue on LINE" button, so staff answer on LINE/phone within minutes.
With no channels configured yet, handoffs are logged in Vercel → Logs and
the customer is routed straight to LINE.

**`/api/orders`** — powers the console's Orders tab (staff key required).

**`/api/pay` + `/api/omise-webhook`** — online payment via Omise (Opn).
With both Omise keys set, checkout offers **PromptPay** (customer gets a QR,
the page detects payment automatically, order flips to **PAID ✅** in the
console) and **Card** (tokenized in the browser by Omise.js — card numbers
never touch your server; 3-D Secure supported via redirect). Charge amounts
are always read from the saved order on the server, never from the client.
Also add the webhook in your Omise dashboard → Webhooks:
`https://dankbkk.com/api/omise-webhook` — it marks orders paid even if the
customer closes the page right after scanning. Without Omise keys, checkout
simply behaves as before (pay on delivery/pickup).
Start with Omise **test keys** (`pkey_test_...`/`skey_test_...`) and card
4242 4242 4242 4242 to try it safely, then switch to live keys.
⚠️ Note: cannabis is a restricted business category for many acquirers —
make sure your Omise account is approved for your business type.

**`/api/thread` + `staff.html`** — live two-way staff chat, in the widget.
When DANK AI transfers a chat, it opens a live thread: the customer keeps
typing in the same widget (header shows **● LIVE — connected to our team**),
and your staff answer from the **staff console** at `dankbkk.com/staff.html`
(log in with `STAFF_KEY`). The console shows every conversation with unread
dots, the customer's cart + the AI transcript for instant context, quick-reply
buttons (EN/TH), a sound ping on new messages, and a Close-ticket button.
The Telegram handoff ping includes a direct link that opens the exact
conversation. Staff replies appear in the customer's widget within ~3 seconds;
if the customer closed the page, you still have their phone/LINE as backup.

## Updating the menu without StoreHub

Edit `products.json` and redeploy (or edit the `PRODUCTS` list inside
`index.html` for the offline copy). Photo fields accept any image URL.

## Testing locally

`npx vercel dev` in this folder runs the site + all three functions locally.
Opening `index.html` directly as a file also works — it just uses the built-in
menu and engine.

## Full storefront feature set (front-end)

The customer site is a complete shop, not just a menu:
- **Browse**: grade categories (Exotics/Topshelf/Midgrade/Premium), Joints,
  Edibles, Vapes, Beer, Accessories, Merch; search; filter by type; sort by
  price/THC/name; NEW badges; near-real-time stock (see above).
- **Product pages**: THC, effects, flavours, weight tiers, quantity stepper,
  and a "You may also like" upsell row.
- **Favorites** (❤) saved on the device, with a Saved filter.
- **Cart**: persists across refreshes; promo codes (`DANK10`, `WELCOME50`,
  `FREEDEL` — edit in `CONFIG.promos`); delivery fee with free-over-฿1,500 and
  a minimum-order guard.
- **Checkout**: delivery or pickup/reserve; PromptPay + card (Omise) or
  cash/transfer/crypto; discount + delivery + total shown; oversell guard.
- **My Orders / Track**: `📦` in the header — customers see live status
  (Placed → Confirmed → Preparing → Completed) and PAID state, on this device
  or by typing an order number. Backed by `/api/track`.
- **Help & Info** modal (delivery, payment, promos, age, contact) + SEO/Open-
  Graph tags for nice link previews.
All of it works standalone; the backend keys just make menu, payment, chat and
notifications live.

## First-order promo — Register: Buy 1G get 1G FREE

New visitors see a banner and a one-time register popup. After they register
(name + phone + 20+), the deal auto-applies on their **first order only**:
add any 1g flower and a matching **free 1g** drops into the cart at ฿0 (shown
as a "FREE 🎁 On the house" line). The free gram appears in the order sent to
staff, so they know to include it. Enforced once per device via localStorage;
DANK AI can also trigger the sign-up ("register", "first order", "free gram",
Thai included). Edit or disable in `CONFIG.firstOrder`.

## Wallet — top up with +10% bonus

Registered customers get a **wallet** (balance chip in the header). They top up
by PromptPay (Omise) and instantly receive **+10% bonus credit** — e.g. pay
฿1,000, get ฿1,100 — then choose **Wallet** as the payment method at checkout
to pay from balance (verified & deducted server-side). Bonus % is set by
`TOPUP_BONUS_PCT` (default 10) and amounts/toggle in `CONFIG.wallet`. Balances
are keyed by phone in shared storage; `/api/wallet` handles top-ups and the
omise-webhook credits them even if the customer closes the page. DANK AI can
pitch and open top-up too. Needs Omise keys for online top-up; staff can also
credit manually.

## Free gram — manager picks the SKU(s) + auto-generated photos

The first-order "Buy 1G get 1G FREE" gift now lets the **manager choose which
SKUs** are given free: in the staff console's **🎁 Free gram** tab, tick the 1g
flowers to offer. The storefront reads that list from `/api/freegifts`; on a
qualifying first order the customer taps **Choose your free 1G** and picks one
of the manager's SKUs (auto-added at ฿0). If the manager picks exactly one, it's
auto-applied; if none, it falls back to the same strain. Defaults come from
products flagged `freeGift` (a StoreHub `freegift` tag or products.json).

**Auto-generated SKU photos:** if a StoreHub image is missing or fails to load,
the storefront draws a branded product image on the fly (leaf motif, strain
name, THC, DANK BKK) via `genPhoto()` — so cards, detail, cart and AI never show
a broken image. Real photos always win when present.

## 💳 Payment gateways — how to connect each

The checkout shows exactly the methods you've configured. All are optional; with
none set, customers pay by PromptPay QR / bank transfer / cash on arrival.

### 1) Omise / Opn  (built-in — recommended)
Turns on **PromptPay QR + cards** with automatic paid-detection.
1. dashboard.omise.co → Keys. Copy the **public** (`pkey_...`) and **secret** (`skey_...`).
2. Vercel → Env Vars: `OMISE_PUBLIC_KEY`, `OMISE_SECRET_KEY`.
3. Omise dashboard → Webhooks → add `https://dankbkk.com/api/omise-webhook`.
4. Test with `pkey_test_/skey_test_` and card 4242 4242 4242 4242, then switch to live keys.

### 2) 2C2P
Cards, PromptPay, e-wallets — redirect flow.
1. Get a 2C2P merchant account → **Merchant ID** + **Secret Key**.
2. Vercel → Env Vars: `TWOC2P_MERCHANT_ID`, `TWOC2P_SECRET`, `TWOC2P_ENV=sandbox` (then `production`).
3. In the 2C2P portal set the backend/notification URL to `https://dankbkk.com/api/2c2p-webhook`.
   The app builds the JWT-signed paymentToken and redirects the customer to 2C2P's page (`api/pay2c2p.js`).
   *Send me your sandbox creds and I'll run a live test to confirm the field mapping.*

### 3) GB Prime Pay
PromptPay QR + cards; easy approval for smaller Thai merchants.
1. Get GB Prime Pay → **Secret key** (and public key for cards).
2. Vercel → Env Vars: `GBP_SECRET_KEY` (and `GBP_PUBLIC_KEY`).
3. Confirmation posts to `https://dankbkk.com/api/gbp-webhook` (set automatically as backgroundUrl).
   `api/paygbp.js` creates a PromptPay QR (and can charge cards). *Sandbox creds → I'll verify live.*

### 4) PromptPay QR + bank transfer + COD  (no gateway, never declined)
Best fallback for cannabis. Edit in `CONFIG`:
- `promptpay:{ id:"08xxxxxxxx" }` — your PromptPay phone or 13-digit tax id. The site
  generates a **dynamic PromptPay QR for the exact amount** at checkout (renders via a small
  QR library from cdnjs).
- `bank:{ name, accName, accNo }` — shown on the transfer screen with a copy button.
- `cod:true` — Cash on delivery / pickup.
Customer pays, sends the slip on LINE, staff confirm & mark the order.

> ⚠️ Cannabis is "high-risk" for most card processors — Omise/2C2P/GBP may or may not approve
> your account for this business type. PromptPay + bank + COD always work; lead with those.

## ₿ Manual crypto transfer + slip upload

Checkout now has a **Crypto** option. It shows your wallet QR code(s) for the
customer to scan and pay, the order's THB amount (to send the crypto equivalent),
and a **slip-upload box** where they attach a screenshot of the transfer. The slip
is stored server-side and flagged on the order; staff open it from the Orders tab
via **🧾 View payment slip** (and get a Telegram ping when one arrives). The same
slip box also appears on the bank-transfer screen.

**Five wallets are configured** in `CONFIG.crypto.wallets`, each with its QR
(`assets/crypto-<coin>.png`), coin label, network, and address (with a Copy button):

| Coin | Network | Address |
|------|---------|---------|
| BTC  | Bitcoin | `bc1q5wq73ll5jymmw7ptr7ev59sanj7mu7rhg68e2x` |
| ETH  | Ethereum (ERC20) | `0x1C936eAc6dCF2B0E797c38110267C35F38D3753c` |
| SOL  | Solana (no memo) | `Ugtx4nMg84tnXBQiyeHj3eLvvZ4Ak1RpbShsnrjbUQ4` |
| TWT  | BNB Smart Chain (BEP20) | `0x1C936eAc6dCF2B0E797c38110267C35F38D3753c` |
| BNB  | BNB Smart Chain (BEP20) | `0x1C936eAc6dCF2B0E797c38110267C35F38D3753c` |
| USDT | Ethereum (ERC20) | `0x1C936eAc6dCF2B0E797c38110267C35F38D3753c` |
| USDC | Ethereum (ERC20) | `0x1C936eAc6dCF2B0E797c38110267C35F38D3753c` |
| USDT | Tron (TRC20, no memo) | `TXpBQgExSDYdvrCd1ggz6ptDTQqvqMxzPo` |

At checkout the customer taps a coin chip (BTC / ETH / SOL / TWT / BNB / USDT-ERC20 /
USDC / USDT-TRC20), scans that QR or copies the address, sends the crypto equivalent
of the THB total, and uploads the slip. All the EVM coins (ETH, TWT, BNB, USDT-ERC20,
USDC) share one `0x…` address — that's normal; the network label tells the customer
which chain to send on, and the note reminds them to **use the matching network
only**. The USDT-TRC20 and SOL wallets are separate addresses.

**Request another coin.** The crypto screen has a **"🪙 Request another coin · chat
with us"** button. It opens the Nong Dank chat pre-filled with the customer's request,
so the AI can answer or hand off to staff who then send a wallet for the coin they
want. Edit the prompt/labels in `CONFIG.crypto` (`requestNote`) and the
`requestOtherCoin()` helper.

To swap a wallet later, replace the PNG in `assets/` or edit the entry in
`CONFIG.crypto.wallets`. `/api/slip` stores slips; keep `UPSTASH_REDIS_*` set so they
persist in production.

## 📱 Manual PromptPay (your bank QR) + slip

The **PromptPay** checkout option shows your real KBank/Thai-QR-Payment QR, the
account name, the order amount to enter, and a **slip-upload box**. There are now
**two QR codes** — a primary (`assets/promptpay.png`, KBank ···1146) and a
**backup** (`assets/promptpay-2.png`, KBank ···7256). If the first QR won't scan or
gets flagged, the customer taps **"Backup QR"** to switch to the second one (a Thai +
English hint tells them to do this). Edit the list in `CONFIG.promptpay.accounts` to
add/rename/reorder QRs. Customer scans with any banking app, pays, uploads the slip →
staff confirm from the Orders tab (🧾 View slip) and get a Telegram ping. If you ever
want an amount-embedded dynamic QR instead, drop `image` from an account and set
`CONFIG.promptpay.id` to your PromptPay phone/tax-id.

**Bank transfer** now shows your real account — **Kasikorn (KBank) 664-2-17256-3,
Mr. Arkaporn Kongtoranin** (`CONFIG.bank`) — with a copy button and its own slip box.

**Proof-of-payment everywhere.** Every payment path — PromptPay QR, backup QR, bank
transfer, crypto, and the order-placed / Cash-COD success screen — now carries a
slip-upload box, so a customer can always attach proof. Staff can *also* attach proof
against any order from the **staff console**: each order card has a **📎 Upload
proof** button (for slips a customer sent over LINE/WhatsApp), alongside **🧾 View
slip**. Both routes post to `/api/slip`; keep `UPSTASH_REDIS_*` set so slips persist.


## 📦 Inventory: product codes, QR labels & shift count

**Every product now has a unique code** (e.g. `EXO-01`, `EDB-03`) generated
automatically from its category. The full mapping is in `product-codes.json`
(machine-readable) and `inventory-codes.csv` (open in Excel/Sheets).

**QR labels — `labels.html`.** Open it and every product shows a printable label
with its code, a scannable QR (the QR encodes the code), name, THC and price.
Filter by category, pick 2/3/4 columns, then **Print / Save PDF** onto sticker
sheets. The QR is read by any USB QR/barcode scanner *and* by the staff app's Count
tab. The product data is embedded, so the sheet also opens standalone.

**Shift count — staff console `📦 Count` tab.** To close a shift the staff:

1. Open `/staff.html` → **Count**. Every product loads with its expected quantity
   (pulled live from `/api/products` when available, else the built-in stock).
2. **Scan** each product — either with a USB scanner or phone (the scan box accepts
   a scanner's keyboard input; **📷 Camera scan** uses the phone camera via jsQR).
   Scanning a code jumps to that product and focuses its count field.
3. Enter the counted quantity, or press **⚖️** on a row to drop in a live reading
   from a connected scale (see below). Variances (counted − expected) show per row.
4. **Proof of existence:** the **📎 Add proof photo(s)** box is required — staff
   photograph the counted stock (up to 12 photos) before the shift can be closed.
5. **Submit & Close shift** → posts to `/api/count`, which stores the session +
   photos and sends a Telegram summary with all variances. Past counts (with photos
   and variances) are viewable under **Recent counts**.

**Scale integration (pull from scale).** The **⚖️ Connect scale** button uses the
**Web Serial API** to read a USB/serial bench scale. Click it, pick the scale's
serial port, and live weights stream into `scale: … g`; the per-row **⚖️** button
applies the latest reading as that product's count. Works in **Chrome/Edge on
desktop or Android** (browsers without Web Serial — e.g. iOS Safari — fall back to
manual entry; a Bluetooth scale can be added the same way with Web Bluetooth).

Files: `api/count.js` (storage + Telegram + history), `labels.html`,
`product-codes.json`, `inventory-codes.csv`. No new env vars — it reuses
`STAFF_KEY`, `UPSTASH_REDIS_*` and the Telegram vars you already set.
