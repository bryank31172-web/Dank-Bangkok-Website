# 🚀 Publishing dankbkk.com — step by step

This guide takes the `dankbkk-site` folder live on **www.dankbkk.com** using
**Vercel** (free tier is fine to start). Two things are true and worth knowing
before you begin:

- **The site works with zero payment keys.** PromptPay QR, backup QR, bank
  transfer, all 8 crypto wallets, and Cash/COD all run out of the box with just the
  files in this folder. Payment *gateways* (Omise, 2C2P, GB Prime Pay) and the live
  StoreHub menu are optional add-ons you switch on with environment variables.
- **Secrets go in Vercel, never in the code.** The `.env.local` file in this folder
  is for local testing only and is git-ignored. You'll paste the same values into
  Vercel's dashboard instead.

---

## Option A — GitHub + Vercel dashboard (recommended, no terminal)

### 1. Put the folder on GitHub
1. Create a new **private** repository at github.com (e.g. `dankbkk-site`).
2. Upload the **contents** of this `dankbkk-site` folder to it (drag-and-drop works
   on github.com → "uploading an existing file"). Make sure `index.html`, the `api/`
   folder, and `assets/` are at the repo root.
3. Do **not** upload `.env.local` — it's already excluded by `.gitignore`.

### 2. Import into Vercel
1. Go to vercel.com, sign in with GitHub, click **Add New → Project**.
2. Pick the `dankbkk-site` repo → **Import**.
3. Framework preset: **Other**. Root directory: leave as `./`. Build command:
   leave **empty**. Output directory: leave **empty**. (This is a static site + API
   functions, no build step.)
4. Before clicking Deploy, open **Environment Variables** and add the ones you want
   (see the table below). At minimum add `STAFF_KEY`. You can also add them later.
5. Click **Deploy**. In ~1 minute you'll get a live URL like
   `dankbkk-site.vercel.app`. Open it and check the shop loads.

### 3. Connect your domain
1. In the project → **Settings → Domains**, add `www.dankbkk.com` (and `dankbkk.com`).
2. Vercel shows you a CNAME/A record. Add it at your domain registrar (wherever you
   bought dankbkk.com). If you want `dankbkk.com` to redirect to `www`, Vercel offers
   a one-click toggle.
3. DNS usually propagates in minutes (can take up to a few hours). Once the domain
   shows "Valid", you're live on www.dankbkk.com. HTTPS is automatic.

---

## Option B — Vercel CLI (from your computer)

```bash
npm i -g vercel          # one-time install
cd dankbkk-site
vercel                   # first run: links/creates the project, deploys a preview
vercel env add STAFF_KEY # repeat for each variable you want
vercel --prod            # promotes to production
vercel domains add www.dankbkk.com
```

---

## Environment variables

Add these in **Vercel → Settings → Environment Variables** (scope: Production, and
Preview if you like). None are needed for the manual payment methods to work.

### Recommended for launch
| Variable | What it does | Where to get it |
|----------|--------------|-----------------|
| `STAFF_KEY` | Password for the staff console (`/staff.html`) and admin endpoints. | Pick any strong secret. |
| `STOREHUB_STORE` | Your StoreHub store subdomain, e.g. `dankclub`. | StoreHub account. |
| `STOREHUB_TOKEN` | StoreHub API token (Basic auth password). | StoreHub → API access. |
| `UPSTASH_REDIS_REST_URL` | Persist orders, chats, slips, wallet balances. | Free DB at upstash.com. |
| `UPSTASH_REDIS_REST_TOKEN` | Token for the same Upstash DB. | Upstash dashboard. |
| `TELEGRAM_BOT_TOKEN` | Sends you a ping on every new order / slip / handoff. | @BotFather on Telegram. |
| `TELEGRAM_CHAT_ID` | Which chat the pings go to. | @userinfobot or your group id. |

> Without Upstash the site still runs, but orders/chats live in memory and reset when
> the serverless function goes cold. For a real shop, set Upstash.
>
> Without StoreHub keys the shop shows the built-in catalog baked into `index.html`.

### Optional — AI chatbot brain
| Variable | What it does |
|----------|--------------|
| `XAI_API_KEY` | Powers Nong Dank with Grok (xAI). Without it she still answers using the built-in rule-based replies. |
| `GROK_MODEL` | Override the model name (defaults are set in `api/chat.js`). |

### Optional — payment gateways (manual methods work without these)
| Variable | Gateway |
|----------|---------|
| `OMISE_PUBLIC_KEY`, `OMISE_SECRET_KEY` | Omise / Opn — online PromptPay QR + cards with auto paid-detection. |
| `TWOC2P_MERCHANT_ID`, `TWOC2P_SECRET`, `TWOC2P_ENV` | 2C2P redirect checkout (`sandbox` or `production`). |
| `GBP_PUBLIC_KEY`, `GBP_SECRET_KEY` | GB Prime Pay QR / cards. |

### Optional — LINE (staff alerts + LINE OA becomes น้องแดงค์)
| Variable | What it does |
|----------|--------------|
| `LINE_CHANNEL_ACCESS_TOKEN` | Your Messaging API channel access token (LINE Developers Console). Enables LINE. |
| `LINE_CHANNEL_SECRET` | Channel secret — verifies incoming webhooks from LINE. |
| `LINE_TO` | Where staff alerts go: Bryan's LINE `userId`, or a staff **group id** (the OA must be in that group). |

With these set: every **order, payment slip, chat handoff and shift-count** is also pushed to
LINE, and your **LINE Official Account answers customers as น้องแดงค์** (same AI + menu as the
website) with staff handoff. After deploy, in LINE Developers Console → Messaging API →
**Webhook URL**, set: `https://www.dankbkk.com/api/line-webhook?k=YOUR_STAFF_KEY` and press
Verify. (Uses `XAI_API_KEY` for the AI replies — without it, LINE still sends the alerts and a
friendly fallback.)

**Daily group summary (the Bryan AI monitor, folded in).** The same webhook also **logs your
LINE group chats** and sends a **daily Thai summary** to `LINE_TO` (or `SUMMARY_TO`). Anyone can
also type **`สรุป`** (or `สรุป 6` for the last 6h) in a group to get an instant summary. It runs
on **Vercel Cron** (`vercel.json`, 22:00 Asia/Bangkok) — set a `CRON_SECRET` env var so Vercel
can authorize the run. Optional extra vars:

| Variable | What it does |
|----------|--------------|
| `MONITORED_GROUP_IDS` | Comma-separated group ids to log. Blank = log every group the OA is in. |
| `SUMMARY_TO` | Where the daily summary goes (defaults to `LINE_TO`). |
| `CRON_SECRET` | Any secret — lets Vercel Cron trigger `/api/line-summary` daily. |

**Delivery ETA with nearest-branch routing.** When a customer shares their **location pin** in
the OA chat, the bot checks drive time from **every branch** (via **Google Routes API**) and
replies the ETA from the **closest shop** (e.g. "จากสาขา DANK Sathorn ~25 นาที"); travel + a prep
buffer. If they ask "ส่งกี่โมง / how long", it prompts them to drop a pin. Set
`GOOGLE_MAPS_API_KEY` (Routes API enabled). Your shops are in **`branches.json`** (all four DANK
locations ship as geocodable addresses) — **for best accuracy, edit each branch's `origin` to
exact `"lat,lng"`** (open the shop in Google Maps, long-press the pin, copy the coordinates).
Options: `DELIVERY_MODE` (`TWO_WHEELER` motorbike default / `DRIVE`), `DELIVERY_PREP_MIN`
(default 15), `SHOP_BRANCHES` (env JSON override), or `ROUTE_API_URL` (your own endpoint). Staff/
tools can push an ETA via `POST /api/eta {to, destLat, destLng, key}`.

> **Getting group ids:** leave `MONITORED_GROUP_IDS` blank at first, add the OA to your groups,
> let a few messages flow, then hit `POST /api/line-summary` with `{"key":"YOUR_STAFF_KEY"}` — the
> response lists each `sourceId` it summarized. Copy the group ids you want into
> `MONITORED_GROUP_IDS`. (Messages are stored in Upstash, not a local file, so keep `UPSTASH_*` set.)

### Optional — email notifications
| Variable | What it does |
|----------|--------------|
| `RESEND_API_KEY` | Sends order emails via Resend. |
| `ORDER_EMAIL_TO`, `ORDER_EMAIL_FROM` | Destination + verified sender address. |
| `ORDER_FORWARD_URL`, `HANDOFF_FORWARD_URL`, `HANDOFF_EMAIL_TO` | Extra webhooks / handoff routing if you use them. |

### Optional — advanced toggles
`STOREHUB_PUSH_ORDERS` (push placed orders back into StoreHub), `STOREHUB_STORE_ID`,
`STOREHUB_USER`, `STOREHUB_API_BASE`, `TOPUP_BONUS_PCT` (wallet top-up bonus %,
defaults to 10), `MENU_TTL_SECONDS`, `WEBHOOK_SECRET` (verify StoreHub/gateway
webhooks). Leave them unset unless you need them.

---

## After it's live — 3 quick checks

1. **Shop loads + order flows.** Open www.dankbkk.com, add an item, place a test
   order with PromptPay/bank/COD, and confirm it appears in `/staff.html` (log in
   with your `STAFF_KEY`).
1b. **Confirm the backend connection.** Open `https://<your-url>/status.html` —
   it shows a big **green "CONNECTED"** with your live product count when StoreHub is
   linked, or **"NOT CONNECTED"** (demo catalog) with the exact fix if the keys are
   missing. Raw JSON version: `/api/health`.
2. **Calibrate the real catalog.** Once StoreHub keys are set, open
   `https://www.dankbkk.com/api/storehub-raw?key=YOUR_STAFF_KEY` and send me the
   output — I'll map your live products (names, prices, weights, THC) cleanly onto
   the storefront so it matches your real menu exactly.
3. **Point payment webhooks (only if you use gateways).** In Omise/2C2P/GBP
   dashboards set the webhook URL to
   `https://www.dankbkk.com/api/omise-webhook` (and `/api/2c2p-webhook`,
   `/api/gbp-webhook`) so paid orders auto-confirm.

---

## Inventory / QR / shift-count (already included)

`labels.html`, `api/count.js`, `product-codes.json` and `inventory-codes.csv` ship
in this folder and deploy automatically with everything else — **no new environment
variables**. After deploy: print labels from `https://www.dankbkk.com/labels.html`,
and staff close shifts from the **📦 Count** tab in `/staff.html`. The scale button
needs Chrome/Edge on desktop or Android (Web Serial). Keep `UPSTASH_REDIS_*` set so
count sessions and proof photos persist.

## Updating the site later
Push a change to the GitHub repo (or run `vercel --prod`) and Vercel redeploys
automatically. Swapping a crypto QR, editing prices in the built-in catalog, or
changing text is just an edit to `index.html` or a file in `assets/`.

## Security reminders
- Keep `STAFF_KEY` and every `*_SECRET`/`*_TOKEN` private — they live only in Vercel.
- Your StoreHub API password should be rotated if it was ever shared in plain text.
- The crypto wallet addresses and PromptPay/bank details are meant to be public
  (customers pay into them) — those are fine to display.
