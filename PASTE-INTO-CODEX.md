> ⚠️ **OUT OF DATE — read `AGENTS.md` first.**
> This file was written when 296 products had no photograph. Counted off the
> live feed on 21 Aug 2026 it is **19**, and twelve of those are bar cocktails
> that belong on the 224 menu rather than the cannabis shelf. The method below
> is still correct; the size of the job is not. Recount before starting.

# ข้อความที่ต้องพิมพ์ตอนอัปโหลดไฟล์

มี 2 อัน ใช้คนละที่ **อันที่ 1 ก่อน** แล้วค่อยอันที่ 2

---

## 1️⃣ ตอนสร้างรูป — ใช้ใน ChatGPT

แนบไฟล์ **`IMAGE-PROMPTS.csv`** แล้ววางข้อความนี้

> ⚠️ Codex เป็นตัวช่วยเขียนโค้ด สร้างรูปไม่ได้ — ต้องสร้างรูปใน ChatGPT ก่อน

### ⬇️ ก๊อปตั้งแต่บรรทัดนี้ลงไป ⬇️

```
I'm uploading IMAGE-PROMPTS.csv — product photos I need for my cannabis
dispensary website in Bangkok.

Each row is one product. The `prompt` column is already a complete, finished
image prompt. Use it exactly as written — do not rewrite it, do not "improve"
it, do not add to it.

For each row:
1. Generate the image from the `prompt` column
2. Print the exact value of the `filename` column on its own line above the
   image, like `ztupid.jpg`
3. Square 1:1, JPG

Rules that matter:
- The filename must match the CSV exactly. My website finds images by
  filename — a wrong name is an image that never appears on the site.
- Square only. My site uses the shape of a picture to tell a photograph from
  a poster card, so a non-square image gets displayed as a card by mistake.
- Keep the lighting, background and framing identical across every image.
  Images generated independently look like they came from as many different
  shops unless the recipe holds still. That consistency is the entire point.
- No text, no lettering, no logos, no hands, no people, no watermark.
- Never copy or imitate photographs from leafly.com or weed.com. Both are
  copyrighted. Original images only.

Work in row order. Do 5 rows at a time, then stop and list the filenames you
produced so I can check nothing was skipped before you continue.

Start with rows 1–5.
```

### ⬆️ ก๊อปถึงบรรทัดนี้ ⬆️

---

## 2️⃣ ตอนเอารูปขึ้นเว็บ — ใช้ใน Codex

โหลดรูปจาก ChatGPT มาแล้ว เอาไปวางใน `assets/products/` แล้วสั่ง Codex แบบนี้

### ⬇️ ก๊อปตั้งแต่บรรทัดนี้ลงไป ⬇️

```
I've added new product photos to assets/products/ in this repo.

Wire them into the site:

1. For each new .jpg in assets/products/ that is not yet referenced in
   product-images.json, add an entry under `byName`.
2. The key is the product name flattened the same way api/_menu.js flatName()
   does it: lowercase, (bracketed) words removed, then every character that is
   not a letter or digit stripped. IMAGE-PROMPTS.csv has the product name in
   the `product` column and the file in the `filename` column.
3. The value is the path, e.g. "assets/products/ztupid.jpg".
4. If a key already exists and holds a Shopify CDN URL, replace it with the
   local path — those are the poster cards being swapped for photographs.
5. Do not touch assets/strains/ or any entry pointing there.

Then check your work: every file you added should be reachable, and
product-images.json must still be valid JSON. Report which products you wired
and which files you skipped, with the reason.
```

### ⬆️ ก๊อปถึงบรรทัดนี้ ⬆️

---

## หรือส่งรูปมาให้ผมทำให้

ไม่อยากยุ่งกับขั้นที่ 2 ก็ได้ครับ — **เจนรูปเสร็จแล้วส่งไฟล์มา เดี๋ยวผมผูกเข้าเว็บให้**
ทำทีละ 5-10 ตัวก็ได้ ไม่ต้องรอครบ
