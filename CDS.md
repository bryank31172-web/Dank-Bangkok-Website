# CDS — Customer Display System

The second screen at the counter, the one facing the customer. It shows the
strain being weighed with a live gram reading, the order building up line by
line, the total, the member discount, the payment QR, and a thank-you. Between
customers it plays the shop's own promo posters.

- **The screen:** `https://dankbkk-site.vercel.app/customer-display.html`
- **The relay:** `POST /api/cds`

Open the screen URL on whatever faces the customer — a second monitor, an old
iPad, a cheap Android tablet. Press ⛶ for full screen. It holds a screen wake
lock so it will not dim mid-sale.

## Two ways to drive it

**Same machine (preferred).** The till and the customer screen are two windows
of one browser. The POS posts on a `BroadcastChannel` and nothing touches the
network — instant, and it keeps working with the internet down, which is the
case that matters at a counter.

```js
const cds = new BroadcastChannel("dank-cds");
cds.postMessage({ state });            // that is the whole integration
```

**Separate device.** The screen shows a 6-character pairing code. Staff type it
into the POS once. The POS pushes, the tablet polls about once a second.

```js
await fetch("https://dankbkk-site.vercel.app/api/cds", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: POS_SYNC_KEY, code: "Y3VMQ2", state }),
});
```

Send both and the screen takes whichever arrives — they are the same `state`
object. Push on every change: an item added, the scale moving, payment shown.

## The state object

Every field is optional except `mode`. Send only what you have.

```jsonc
{
  "mode": "idle" | "order" | "weigh" | "pay" | "thanks",
  "branch": "Pattanakarn",
  "note": "Happy Hour — buy 3g get 2g free 🔥",   // one line, shown in green

  "member": { "name": "Bryan", "tier": "Gold", "discountPct": 10, "points": 1240 },

  "lines": [                                       // newest last; the screen shows the last 7
    { "name": "Crunch Berrie", "unit": "1g", "qty": 1, "price": 400, "img": "https://…" },
    { "name": "Grape Stank", "unit": "1g · FREE", "qty": 1, "price": 0, "free": true }
  ],
  "subtotal": 2100, "discount": 210, "delivery": 0, "total": 1890,

  "weigh": {                                       // mode:"weigh"
    "name": "OG Kush", "grams": 1.18, "target": 1, "price": 300,
    "thc": "29%", "type": "Hybrid", "stable": false, "img": "https://…"
  },

  "pay": {                                         // mode:"pay"
    "method": "PromptPay", "amount": 1890, "paid": false,
    "qr": "data:image/png;base64,…", "change": 0
  }
}
```

`price` is per unit — the screen multiplies by `qty`. `free: true` draws the
line in gold and prints FREE instead of a price. `stable: false` while the
scale is settling turns the gram reading green; `true` turns it white and
prints STABLE.

A sale usually walks `idle → weigh → order → pay → thanks → idle`, but the
screen has no state machine of its own: it draws whatever arrived last, so the
POS can jump between modes freely and a reload or a power cut mid-sale costs
nothing.

## What the relay will not carry

Writes need `POS_SYNC_KEY`. Reads are authorised by the pairing code alone,
because that code lives in a URL on a screen the public can see over the
counter — a real key would be readable by anyone who picked the tablet up.

So the relay is built to make a guessed code worth very little. It keeps only
the fields listed above and drops everything else, which means a customer's
phone number, email, address, member id or birthday is **never stored there
even if the POS sends it**. Keep it that way: send the name and tier, nothing
else about the person. Same-machine BroadcastChannel never leaves the browser
and has no such exposure.

Image fields must be `https:`, a site-relative path, or a `data:image/…` URI.
Anything else is dropped at the relay and again in the page.

## Setup

1. Set `POS_SYNC_KEY` in Vercel and paste the same value into the POS. (This is
   the key the menu push already uses — one key for both.) The POS's own
   🔑 Generate button calls it `WEBSITE_API_KEY`; the website accepts either
   name, so whichever the POS wrote down will work.
2. Open `customer-display.html` on the customer-facing screen.
3. Type its pairing code into `POS → Settings → Customer display`, or run both
   windows on one machine and skip the code entirely.
