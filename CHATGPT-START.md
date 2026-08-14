# Paste this into ChatGPT

Upload **`IMAGE-QUEUE.csv`** alongside it. That is the whole setup — everything
ChatGPT needs is in this message and that one file.

---

## ⬇️ COPY EVERYTHING BELOW THIS LINE ⬇️

You are generating product photographs for DANK BKK, a licensed cannabis
dispensary in Bangkok. The attached `IMAGE-QUEUE.csv` lists 271 products whose
website listing currently shows a borrowed stand-in image. I need a real image
for each one.

**Columns:** `no`, `filename`, `key`, `product`, `category`, `kind`,
`in_stock`, `stock`, `price_thb`, `subject`.

### The house style — never change it

Every image is built as: **the row's `subject`**, then this fixed recipe:

> Shoot it like a premium dispensary product photo: one subject centred on a
> matte charcoal-black surface, a single soft light from the upper left, a
> faint green rim light along the edge, deep shadows, shallow depth of field.
> Square 1:1, the subject filling the frame. Photorealistic. No text, no
> logos, no packaging branding, no hands, no people, no watermark.

Do not restyle, "improve" or vary the recipe between items. Images generated
independently will look like they came from as many different shops unless
the lighting and background hold still. That consistency is the entire point.

### How to work

1. Work **in the CSV's row order**. Rows 1–171 are in stock and matter most;
   172–271 are out of stock and can wait.
2. Do **10 rows at a time**. After each batch of 10, stop and wait for me to
   say continue.
3. For each image, print the **exact filename** from the `filename` column
   directly above it, on its own line, like `onionring.jpg`. I download the
   images and the filename is how the website finds them — an image with the
   wrong name is an image that never appears.
4. If a subject is genuinely ambiguous, ask instead of guessing.
5. At the end of each batch, list the filenames you produced so I can check
   nothing was skipped.

### Rules

- **Never** copy or imitate photographs from leafly.com or weed.com. Both are
  copyrighted. Generate original images only.
- No text, brand marks or lettering rendered inside the image.
- No people, hands, or body parts.
- Square, and the product fills the frame — these are cropped to a square on
  the site.

Start with rows 1–10.

## ⬆️ COPY EVERYTHING ABOVE THIS LINE ⬆️

---

# After ChatGPT gives you images

1. Download each one and **rename it to the filename ChatGPT printed above
   it** — `onionring.jpg`, `stashproyukilighters.jpg` and so on.
2. Put them all in one folder.
3. Send them back here, or hand the folder plus `CODEX-HANDOVER.md` to Codex.

The website side is one line per image in `product-images.json`:

```json
"onionring": "assets/products/onionring.jpg"
```

`CODEX-HANDOVER.md` in the repository explains that part, including the trap
that matters: the key must match what the POS actually sends, misspellings
included, and a single wrong character means the image silently never shows
and nothing errors.

---

## Two things already handled, so you do not have to

The till holds the same drink several times over — Cappuccino three times,
Latte three times, and so on. The website matches images on the product name,
so every copy wears the same picture anyway; the queue keeps one row per
name, the busiest one. That is why it is 271 rows and not 296.

One product, a Thai-named ginger powder, is left out entirely. The key is
built from letters and digits only, so a Thai-only name flattens to nothing
and there is no key to hang an image on. It is out of stock and worth
renaming in the POS rather than working around.

## Realistic expectations

271 images is a lot to sit through. Two suggestions:

- **Do the 171 in-stock rows and stop.** A picture for something the shop
  cannot sell today is worth very little, and the queue is already sorted so
  those come first.
- **Photograph the flower yourself.** A real photo of the actual jar beats a
  generated one every time, and customers buying cannabis want to see the bud
  they are getting. Generated images earn their keep on the things that look
  the same everywhere — pre-rolls, lighters, papers, cartridges, soft drinks.

The Botanical Legends cards are already on the site and are not in this
queue. Nothing here will overwrite them.
