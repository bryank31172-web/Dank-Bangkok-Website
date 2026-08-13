# Wiring generated product images into dankbkk-site

Handover for whoever picks this up next (Codex, or a human). Everything here
is about **one job**: a product has no picture of its own, you generate one,
and the site starts showing it.

Repo: `bryank31172-web/dankbkk-site` (private). No build step, no framework —
Vercel serves the repo root as static files and turns `api/*.js` into
serverless functions. There is nothing to compile.

The companion file `PROMPTS.md` lists all 296 products that still need a
picture, each with the `key` you must use and a ready prompt.

---

## The one rule that matters

The site matches a picture to a product by **flattening the product name**:
lowercase it, delete anything in brackets, delete every character that is not
a letter or a digit.

```
"(Weed) Grape Gasolin"   ->  grapegasolin
"( equipment ) Bong XL ( 50 cm )"  ->  bongxl
"chocolate chip joint"   ->  chocolatechipjoint
```

That result is the **key**. `PROMPTS.md` has already computed it for every
product — copy it, never retype it from the product name yourself. Getting one
character wrong means the picture silently never appears, and nothing errors.

The exact function lives in `api/_menu.js` as `flatName()`.

---

## Where files go

| what it is | folder | how it is displayed |
|---|---|---|
| AI-generated or photographed **product photo** | `assets/products/` | fills the frame (cropped to square) |
| **Botanical Legends** strain artwork card | `assets/strains/` | letterboxed, never cropped |

**This distinction is load-bearing.** `index.html` adds a CSS class to any
image whose path contains `assets/strains/`, which switches it from
`object-fit: cover` to `object-fit: contain`. The art cards are finished 3:2
designs with the strain name down the left and a stats strip along the bottom
— cropping them to a square throws both away.

A generated product photo is square and *should* fill the frame, so it goes in
`assets/products/`. **Do not put generated photos in `assets/strains/`.**

Keep files reasonably small — the existing cards are ~250 KB each. JPEG,
quality ~90, is right.

---

## Wiring it in

One file: **`product-images.json`**, the `byName` object.

```jsonc
"byName": {
  "grapegasolin": "assets/strains/grape-gasoline.jpg",
  "teatime":      "assets/products/teatime.jpg",
  "cocochanel":   ["assets/strains/coco-chanel.jpg",
                   "https://cdn.shopify.com/…/CB952B9D….png"]
}
```

A value is **either** one path **or** a list of them. With a list the first is
the main picture and the rest appear as a thumbnail strip in the product
popup — that is how a strain leads with its artwork card and then shows
photographs of the actual jar. Card first, photos after.

Paths are relative to the repo root. Full `https://` URLs also work.

### Adding one image

1. Save the file to `assets/products/<key>.jpg`
2. Add `"<key>": "assets/products/<key>.jpg"` to `byName`
3. Done. No code change, no rebuild.

### If the product already has a picture

Turn the value into a list rather than replacing it. Losing a real photograph
of the actual jar to a generated one is a downgrade.

---

## Things that will bite you

**The till misspells things.** `Grape Gasolin` (no *e*), `Galic Man` and
`White Galic` (no *r*), `Giraff Puzzy`, `Sherb Tang`, `Alien Mintz`. The key
must match **what the POS actually sends**, not the correct spelling. Where
both are plausible, map both keys to the same file — then fixing the till
later cannot silently drop the picture.

**Do not guess that two similar names are the same product.** A fuzzy scan
once suggested mapping `Lime Zooties` to `Zooties`, `Gelato 41` to `Gelato X`,
`Lemon cherry Soap` to `Lemon Cherry Gelato`, and a strawberry milkshake to
the Strawberry Drip flower. All four are wrong. Ask.

**Rolled products inherit automatically.** `api/_menu.js` strips a trailing
`joint` / `blunt` / `preroll` / `cone` and looks the strain up, so
`Zkittles Joint` already gets the Zkittles picture. You usually do **not**
need to add a key for a joint — add the strain and the joint follows.

**Bar items are hidden from the storefront** and are not worth generating for.
`index.html` filters any category matching `bar|cocktail|liquor|whisky|vodka|
gin|rum|tequila|wine|sake|soju`.

---

## Checking your work

There is no test suite for this. Run this from the repo root — it reports any
key you added that does not resolve to a file that exists:

```bash
node --input-type=module -e '
import { fillImages } from "./api/_menu.js";
import fs from "node:fs";
const bn = JSON.parse(fs.readFileSync("product-images.json","utf8")).byName;
let bad = 0;
for (const [k, v] of Object.entries(bn)) {
  for (const p of [].concat(v)) {
    if (/^https?:/.test(p)) continue;
    if (!fs.existsSync(p)) { console.log("MISSING FILE  " + k + " -> " + p); bad++; }
  }
}
// and confirm a product name actually reaches it
const probe = await fillImages([{ name: "(Weed) Grape Gasolin", category: "Weed" }]);
console.log("probe:", probe[0]._imgFrom, probe[0].image);
console.log(bad ? bad + " broken" : "all keys resolve to a real file");
process.exit(bad ? 1 : 0);
'
```

Also confirm the JSON is still valid — a trailing comma breaks the whole
catalogue, and the failure is silent:

```bash
python3 -c "import json; json.load(open('product-images.json')); print('valid')"
```

---

## What good looks like

Every prompt in `PROMPTS.md` shares one recipe — matte charcoal-black surface,
single soft key light from the upper left, faint green rim light, shallow
depth of field, square, no text. That is deliberate: 296 images generated
independently will look like 296 different shops unless the lighting and
background hold still. Keep the recipe even if you rewrite a subject line.

Do the **in-stock** products first. `PROMPTS.md` is sorted by stock, most
first, and marks which are out of stock — a picture for something the shop
cannot sell today is worth very little.

---

## Content rules

- Product facts may be taken from leafly.com and weed.com. **Their
  photographs and their written descriptions must never be copied** — both
  are copyrighted. Write descriptions in original wording.
- Unsplash is fine, its licence permits commercial use.
- `dankbkk.com` is the shop's own site, so its copy is fair game.

---

## Where the code is

| file | what it does |
|---|---|
| `product-images.json` | the key → image map. This is the file you edit. |
| `api/_menu.js` | `flatName()`, `fillImages()`, the rolled-product rule, the keyword and category fallbacks |
| `strain-db.json` | per-strain THC, type, flavours, effects, description |
| `index.html` | `isArtCard()`, the `.art` letterbox class, the popup thumbnail strip |
| `photo-audit.html` | a live page listing which products still lack a picture |

`index.html` is ~540 KB and `grep` treats it as binary — use `grep -a`, or
read it in Python with `errors='surrogateescape'`. Do not let an editor
rewrite its encoding, and do not split it into modules; a single file is the
deployment model.
