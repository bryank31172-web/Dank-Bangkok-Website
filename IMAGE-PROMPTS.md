> ⚠️ **OUT OF DATE — read `AGENTS.md` first.**
> This file was written when 296 products had no photograph. Counted off the
> live feed on 21 Aug 2026 it is **19**, and twelve of those are bar cocktails
> that belong on the 224 menu rather than the cannabis shelf. The method below
> is still correct; the size of the job is not. Recount before starting.

# Product photo prompts — `IMAGE-PROMPTS.csv`

**เหลือ 26 ตัว ไม่ใช่ 296.** The catalogue is almost photographed already: 270
of the 296 products have their own picture in `assets/products/`, wired to the
product and showing on the site. Only what is genuinely missing is listed here.

`IMAGE-PROMPTS-ALL.csv` keeps all 296 rows for reference. Nothing needs to be
run from it.

---

## เหลืออะไรบ้าง / What is actually left

| | จำนวน | |
|---|---|---|
| **`A-missing`** | **1** | Kamagra — ไม่มีรูปเลย และ**ขายอยู่** 👈 ทำอันนี้ก่อน |
| `B-replace-card` | 25 | ดอกที่ตอนนี้ใช้การ์ด Botanical Legends — **ไม่รีบ** |

การ์ด 25 ใบยังใช้งานได้ปกติและแสดงเต็มใบสวยแล้ว จะเปลี่ยนเป็นรูปถ่ายหรือไม่เปลี่ยนก็ได้
ถ้าชอบการ์ดมากกว่า **ข้ามทั้ง 25 ตัวได้เลย เหลืองานจริงแค่ตัวเดียว**

---

## รูปแบบที่ต้องการ / The look

ภาพถ่ายจริงพื้นดำ แบบรูป **Permanent Bx1** — ไม่ใช่การ์ดโปสเตอร์

A real photograph on matte charcoal-black, one soft light from the upper left,
a faint green rim light, deep shadows, shallow depth of field, square 1:1.
Photorealistic, and no text, logos, hands or people anywhere in the frame.

**อย่าเปลี่ยนสไตล์ระหว่างทาง** — ถ้าแสงกับพื้นหลังไม่นิ่ง รูปจะดูเหมือนมาจากคนละร้าน
ซึ่งเป็นเหตุผลทั้งหมดที่ต้องมีสูตรตายตัว.

---

## ไฟล์มีอะไรบ้าง / Columns

| Column | คือ |
|---|---|
| `no` | ลำดับ |
| `filename` | **ชื่อไฟล์ที่ต้องใช้ ห้ามเปลี่ยน** — เว็บหารูปจากชื่อนี้ |
| `product` | ชื่อสินค้าใน POS |
| `category` · `kind` | หมวด และชนิด |
| `in_stock` | `YES` = มีของขายอยู่ตอนนี้ |
| `group` | `A-missing` = ไม่มีรูปเลย · `B-replace-card` = มีการ์ดอยู่แล้ว |
| `prompt` | **prompt เต็ม พร้อมวาง** |

---

## วิธีใช้ใน Codex / Running it

ชื่อไฟล์สำคัญที่สุด — รูปที่ชื่อผิดคือรูปที่ไม่มีวันขึ้นเว็บ

```
สำหรับแต่ละแถวใน IMAGE-PROMPTS.csv:
  สร้างรูปจากคอลัมน์ prompt
  เซฟเป็นชื่อในคอลัมน์ filename  (jpg, สี่เหลี่ยมจัตุรัส)
  วางไว้ที่  assets/products/
```

**สี่เหลี่ยมจัตุรัสเท่านั้น** — เว็บใช้สัดส่วนรูปแยกว่าอะไรเป็นรูปถ่าย อะไรเป็นการ์ด
รูปจัตุรัสจะเต็มกรอบสวย รูปไม่จัตุรัสจะถูกแสดงเป็นการ์ดแทน

---

## เอารูปขึ้นเว็บ / Wiring the results in

รูปที่วางใน `assets/products/` ยังไม่ขึ้นเว็บทันที ต้องผูกชื่อสินค้าเข้ากับไฟล์ใน
`product-images.json` ก่อน — `CODEX-HANDOVER.md` อธิบายวิธีไว้แล้ว

**หรือส่งรูปมาให้ผมผูกให้ก็ได้ครับ**

---

## กติกาที่ห้ามข้าม / Hard rules

- ห้ามลอกรูปจาก **leafly.com** และ **weed.com** — มีลิขสิทธิ์ทั้งคู่ ต้องสร้างใหม่เท่านั้น
- ห้ามมีตัวหนังสือ โลโก้ หรือแบรนด์ในรูป
- ห้ามมีคน มือ หรือส่วนของร่างกาย
- ดอกกัญชาถ่ายเองสวยกว่าเจน — ถ้ามีเวลาถ่ายเอง ให้ใช้ AI กับของใช้แทน

---

## ถ้าอยากสร้างลิสต์ใหม่ / Rebuilding

เมื่อสินค้าใน POS เปลี่ยน สร้างใหม่ได้ด้วย `python3 tools-make-image-prompts.py`
แล้วตัดตัวที่มีรูปแล้วออกเหมือนเดิม
