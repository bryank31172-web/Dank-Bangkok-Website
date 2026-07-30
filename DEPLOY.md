# DANK BKK — one project, shop + POS together

This folder is the **whole thing**: the shop, the staff console, the Build Your
Joint page, the BRYAN POS app, and the `api/` folder that connects them.

Everything runs from one GitHub repo and one Vercel project.

| Address | What it is |
|---|---|
| `/` | The DANK BKK shop (customers) |
| `/pos.html` | BRYAN POS (staff, PIN protected) |
| `/staff.html` | Staff console — chats, orders, free gram, stock count |
| `/build-your-joint.html` | Build Your Joint |
| `/api/…` | The 38 files that make orders, menu sync, members and payments work |

---

## 1 · Upload every file to GitHub

Repo: **bryank31172-web/DANK-MEDICAL-POS-APP**

1. Unzip this folder somewhere you can see it.
2. Open the repo on github.com → **Add file** → **Upload files**.
3. Open the unzipped folder, press **Ctrl+A** (Windows) or **Cmd+A** (Mac) to
   select everything — the loose files **and** the `api` and `assets` folders —
   and drag the whole selection onto the upload page in one go.
4. Wait until the list on screen shows `api/` with files inside it. **If you
   don't see the `api` folder listed, stop and drag it in again** — that folder
   is the part that makes orders reach the POS, and it is the piece that went
   missing last time.
5. Commit.

Anything already in the repo with the same name is replaced automatically. If
there is an old `dank medical pos.zip` sitting in the repo, delete it — a zip
file does nothing on Vercel, only the unzipped files count.

## 2 · Set the required variables in Vercel

Vercel → your project → **Settings** → **Environment Variables**.

Always needed:

| Name | Value |
|---|---|
| `STAFF_KEY` | your staff key — the one I sent you in chat (already set in Vercel) |
| `UPSTASH_REDIS_REST_URL` | from your Upstash database |
| `UPSTASH_REDIS_REST_TOKEN` | from your Upstash database |
| `POS_APP_URL` | `https://dank-medical-pos-app.vercel.app` |

Needed by the feature next to it — leave one blank and **only that feature**
stops, with a clear `503 {"error":"not configured"}` rather than a silent hole:

| Name | Without it |
|---|---|
| `ADMIN_EMAIL` | owner edit-mode login is off |
| `ADMIN_PASSWORD` | owner edit-mode login is off |
| `ADMIN_SECRET` | owner edit-mode login is off (this signs the session token) |
| `POS_SYNC_KEY` | the POS can't push its menu to the website |
| `WEBHOOK_SECRET` | `/api/gbp-webhook` and `/api/storehub-webhook` reject everything |
| `LINE_CHANNEL_SECRET` | LINE webhooks can't be verified, so they're refused |

These six used to have working values written into the `api/` files, which is
why the site ran with no setup at all. It also meant the admin password, the
POS link key and the fallback staff key were sitting in every copy of the source
— including the GitHub repo. They have been removed. Nothing falls back to a
default any more, and no endpoint accepts a request it can't check.

**The Upstash pair is not optional.** Without it an order can be taken by one
server and then asked for by a different one, and it disappears. Upstash has a
free plan: upstash.com → create a Redis database → copy the REST URL and REST
token. It also backs the per-address rate limits on the public endpoints; on
memory alone each Vercel instance counts separately and the limits are looser.

Optional extras (`STOREHUB_TOKEN`, `LINE_CHANNEL_ACCESS_TOKEN`,
`GOOGLE_MAPS_API_KEY`, payment keys…) are listed with explanations in
`.env.example`. The shop works without them.

After saving, go to **Deployments** and redeploy, otherwise the new variables
aren't picked up.

### Wallet orders now wait for staff

A web order paid from the customer's wallet arrives as **wallet pending**: the
site checks the balance, refuses the order if it isn't enough, and holds the
amount against the order — but no money moves until someone on staff settles it
from the console. The reason is simple: `/api/order` takes a phone number and no
password, so before this, typing somebody else's number into checkout spent
their balance. An endpoint that can't tell who is calling must never move money.
Settling is idempotent, so pressing it twice can't debit twice. Once phone
numbers are verified at login with a one-time code, this can go straight back to
debiting at checkout — the order record already carries everything needed
(`walletReserved`, `walletAmount`, `walletBalance`).

## 3 · Put the staff key into the POS, once

Open `/pos.html` → Settings → **API / Website Integration**.

Under *Website URL* there is a **Staff Key** box. Paste your staff key into it
— the same value as `STAFF_KEY` in Vercel — and save. That is the only setting
you need; the POS now finds the website by itself, because they live at the
same address.

(The key itself is deliberately not written down in this file. These notes get
committed to GitHub, and anyone who reads the key can read your customers'
orders. Copy it from Vercel → Settings → Environment Variables.)

(The *API KEY* box below it is a different thing and you can leave it empty.)

## 4 · Point the domain

Vercel → Settings → **Domains** → **Add Domain** → `dankbangkok.com`. Vercel
then offers to add `www.dankbangkok.com` too — say yes, and set the redirect so
one of the two is the real address and the other bounces to it.

At your registrar, add the two records Vercel shows you:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | **the value on your Vercel screen** |

The A record is Vercel's general-purpose address and is the same for everyone.
The CNAME is **not** — every project now gets its own, something along the
lines of `d1d4fc829fe7bc7c.vercel-dns-017.com`. Copy it off the Domains page
rather than out of any guide, including this one.

DNS takes a few minutes to a few hours to spread. Vercel issues the HTTPS
certificate by itself once it can see the records — nothing to buy, nothing to
install. When the domain goes green the shop is at dankbangkok.com and the POS
is at dankbangkok.com/pos.html.

---

## Check it's alive

- `/api/health` → shows `{"ok":true …}`
- `/api/menu-version` → after the POS has been open ~1 minute, `"source":"pos"`
- Place a test order on the shop, wait 30 seconds, look at the POS Orders tab.

## If orders still don't arrive

1. Open `/api/orders?key=YOUR_STAFF_KEY` in a browser (paste your real staff key
   in place of `YOUR_STAFF_KEY`).
   - `{"orders":[…]}` → the website has them, the problem is in the POS.
   - `401` → `STAFF_KEY` in Vercel doesn't match the key you typed.
   - `503 {"error":"not configured"}` → `STAFF_KEY` isn't set in Vercel at all.
   - `404` → the `api/` folder didn't upload. Back to step 1.
2. In the POS, check the Staff Key box actually has the key saved in it.
3. Check the Upstash variables are set and you redeployed after setting them.

The orders list shows the most recent 60 by default; `?limit=` goes up to 300,
`?archive=1` reaches back past the live window, and `?offset=` pages through it
(the reply carries `total` and `nextOffset`). Older orders used to be dropped
outright once 200 had gone by — they're kept now, just not on the first page.

## Settling a wallet order by hand

If the console doesn't offer a button yet, a wallet-pending order is settled
with one call, which is safe to repeat:

```
POST /api/wallet   {"action":"settle","orderId":"DK…","key":"YOUR_STAFF_KEY"}
```

It answers `{ok:true, balance, amount}`, or `402` with the customer's balance if
they've spent it elsewhere since, or `{alreadySettled:true}` if it was done
already. Do it when the customer is in front of you, or after you've confirmed
by phone that the order is really theirs.
