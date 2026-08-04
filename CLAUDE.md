# D.T.S Industry Website

Bilingual note: the owner (Bryan) communicates in Thai. Reply in Thai or simple English.

## What this is
Marketing + quotation website for D.T.S Industry Co., Ltd. — steel & wire manufacturer in Bang Phli, Samut Prakan, Thailand. Single-page static site (`index.html`) + one Vercel serverless function (`api/chat.js`).

## Stack & structure
- `index.html` — the entire site: HTML + CSS + JS in one file (intentional; keep it that way unless asked).
- `assets/` — videos (hero.mp4 = AI-generated hero loop, factory-tile.mp4 = real footage), photos, product thumbnails.
- `api/chat.js` — proxy for the AI sales chatbot → Anthropic API. Requires `ANTHROPIC_API_KEY` env var on Vercel.

## Key systems inside index.html (search these markers)
- `const T =` — i18n dictionary, 4 languages: th (default), en, zh, ja. Every UI string has a key.
- `const PRODUCTS =` — 19 products with per-language descriptions.
- `const PRICE =` — ★ PLACEHOLDER unit prices in THB. Owner must supply real prices.
- `let WEIGHT =` — approx kg/unit used by truck calculator.
- `let TRUCKS =` — 4 truck types with capacity kg (pickup 1000, 6w 5000, 10w 16000, trailer 30000).
- `let SHIP =` — shipping charter rates (base + THB/km), referenced from Deliveree/CaptainMove 2026.
- `const PROV =` — 77 Thai provinces with approx road km from the Bang Phli factory.
- Admin panel: gear icon in footer, master PIN `1210` (client-side only — not real security). Edits PRICE/WEIGHT/TRUCKS/SHIP. Uses `window.storage` when running inside Claude.ai preview; on Vercel it currently falls back to session-only. TODO if asked: persist via a small KV store or JSON + serverless.
- Quote builder: multi-item, auto totals, delivery vs factory pickup (Google Maps pin), truck trips, shipping estimate, grand total, mailto submit to d.t.s.industry@gmail.com.
- Fail-safe: `.js .reveal` pattern — if JS crashes, content still displays.

## Brand
Maroon #8E2130, ink #1C1815, paper #F2EEE6, amber #D9962E. Fonts: Anton + Archivo + IBM Plex Mono + Noto Sans Thai/SC/JP. Modern-industrial, warm, bold. Thai is the primary language.

## Facts (do not invent others)
- Phones: sales 082-829-8995, office 02-750-5379. Email d.t.s.industry@gmail.com. Site www.dtsindustry.net.
- Address: 67/1 Moo 11, Thepharak Rd KM.14, Bang Pla, Bang Phli, Samut Prakan 10540.
- Certifications: มอก. 2432-2555, มอก. 747/943, Made in Thailand (MIT).
- Facebook URL: still placeholder `#` — ask owner for the real page link.

## Pending tasks
1. Replace placeholder PRICE values with the real price list (owner will provide).
2. Real Facebook page URL.
3. Set ANTHROPIC_API_KEY on Vercel so the chatbot works in production.
4. Optional: persist admin edits on production (KV/JSON), custom domain (dtsindustry.com / .co.th).

## Deploy
Static + api/ works on Vercel out of the box: `vercel` or connect the GitHub repo. No build step.
