# ✅ PUBLISH NOW — dankbkk.com

Follow these in order. ~15 minutes. Your real secret values are already in
**`.env.local`** in this folder — copy each one into Vercel when asked.

> ⚠️ **Never upload `.env.local` to GitHub.** It holds your secrets. If you use
> `git`, it's ignored automatically. If you drag-and-drop files to GitHub, skip it.

---

## STEP 1 — Put the code on GitHub
1. Go to **github.com** → **New repository** → name it `dankbkk-site` → **Private** → Create.
2. Upload the **contents** of this `dankbkk-site` folder (so `index.html`, `api/`, `assets/`
   are at the repo root). **Skip `.env.local`.**

## STEP 2 — Import into Vercel
1. Go to **vercel.com** → sign in with GitHub → **Add New → Project**.
2. Select `dankbkk-site` → **Import**.
3. Framework Preset: **Other**. Build Command: **empty**. Output Directory: **empty**.

## STEP 3 — Add Environment Variables (Vercel → the project → Settings → Environment Variables)

**Required to go live properly** — copy each value from your `.env.local`:

| Variable | Value (from `.env.local`) | Purpose |
|---|---|---|
| `STOREHUB_STORE` | `dankclub` | Live menu from your POS backend |
| `STOREHUB_TOKEN` | *(your StoreHub token)* | ” |
| `STAFF_KEY` | *(pick a strong password)* | Staff console + admin login |
| `UPSTASH_REDIS_REST_URL` | *(from upstash.com)* | Saves orders, chats, counts, wallet |
| `UPSTASH_REDIS_REST_TOKEN` | *(from upstash.com)* | ” |
| `GOOGLE_MAPS_API_KEY` | *(your AIza… key)* | Delivery ETA (nearest branch) |

**Turn on the extras you want:**

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Staff alerts on Telegram |
| `XAI_API_KEY` | น้องแดงค์ AI (website + LINE). Without it, a friendly fallback |
| `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_TO` | LINE: staff alerts + AI OA + group summary + delivery ETA |
| `CRON_SECRET` | Any secret — lets the daily LINE summary run |
| `OMISE_PUBLIC_KEY`, `OMISE_SECRET_KEY` | Online PromptPay + card (auto paid) |

> Manual payments (PromptPay QR, bank, all crypto, COD) need **no keys** — they work already.

## STEP 4 — Deploy
Click **Deploy**. ~1 minute → you get a URL like `dankbkk-site.vercel.app`.

## STEP 5 — Confirm it's connected
Open **`https://<your-url>/status.html`** → should show green **CONNECTED** with your live
product count. (Raw JSON: `/api/health`.)

## STEP 6 — Point your domain
Project → **Settings → Domains** → add `www.dankbkk.com` (and `dankbkk.com`). Add the DNS
record Vercel shows at your registrar. Live in minutes, HTTPS automatic.

## STEP 7 — Wire the LINE Official Account (if using LINE)
LINE Developers Console → your Messaging API channel → **Webhook URL**:
`https://www.dankbkk.com/api/line-webhook?k=YOUR_STAFF_KEY` → **Verify** → turn **Use webhook** ON.

---

## After it's live — send me
1. `https://www.dankbkk.com/api/storehub-raw?key=YOUR_STAFF_KEY` output → I calibrate the real
   catalog + regenerate the QR labels to your true SKUs.
2. Exact **lat,lng of each branch** → I lock in precise delivery ETAs (edit `branches.json`).

## What you can do right after launch
- Print QR labels: `https://www.dankbkk.com/labels.html`
- Staff console (orders · chat · 📦 count): `https://www.dankbkk.com/staff.html`
- Build Your Joint: `https://www.dankbkk.com/build-your-joint.html`

## Payment webhooks (only if you use gateways)
Set these callback URLs in each dashboard so paid orders auto-confirm:
`/api/omise-webhook`, `/api/gbp-webhook?secret=YOUR_WEBHOOK_SECRET`, `/api/2c2p-webhook`.
