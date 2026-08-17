# Product photo prompts — `IMAGE-PROMPTS.csv`

**คู่มือสั้นๆ / short guide.** One finished, ready-to-paste image prompt per
product. 296 of them. Nothing else is needed — each prompt stands on its own,
so it can be handed to Codex, ChatGPT or any image tool one row at a time.

This replaces nothing: `IMAGE-QUEUE.csv` and `CHATGPT-START.md` still work if
you would rather drive the generator by hand. This file is the same work with
the house recipe already written into every row.

---

## รูปแบบที่ต้องการ / The look

ภาพถ่ายจริงพื้นดำ แบบรูป **Permanent Bx1** — ไม่ใช่การ์ดโปสเตอร์

A real photograph on matte charcoal-black, one soft light from the upper left,
a faint green rim light, deep shadows, shallow depth of field, square 1:1.
Photorealistic, and no text, logos, hands or people anywhere in the frame.

**อย่าเปลี่ยนสไตล์ระหว่างทาง** — ถ้าแสงกับพื้นหลังไม่นิ่ง รูป 296 ใบจะดูเหมือนมาจาก
296 ร้าน ซึ่งเป็นเหตุผลทั้งหมดที่ต้องมีสูตรตายตัว.

---

## ไฟล์มีอะไรบ้าง / Columns

| Column | คือ |
|---|---|
| `no` | ลำดับ |
| `filename` | **ชื่อไฟล์ที่ต้องใช้ ห้ามเปลี่ยน** — เว็บหารูปจากชื่อนี้ |
| `product` | ชื่อสินค้าใน POS |
| `category` · `kind` | หมวด และชนิด (flower, gear, drink, …) |
| `in_stock` | `YES` = มีของขายอยู่ตอนนี้ · `no` = หมดสต็อก · ว่าง = กลุ่ม B |
| `group` | `A-missing` = ยังไม่มีรูปเลย · `B-replace-card` = มีการ์ดโปสเตอร์อยู่ อยากเปลี่ยนเป็นรูปถ่าย |
| `prompt` | **prompt เต็ม พร้อมวาง** |

### ทำอันไหนก่อน / Order of work

1. **`in_stock = YES`** — 171 ตัว ของที่ขายอยู่จริง ลูกค้าเห็นทุกวัน
2. `group = A-missing` ที่เหลือ — ของหมดสต็อก รอได้
3. `group = B-replace-card` — 25 ตัว ตอนนี้เป็นการ์ดโปสเตอร์ ยังใช้ได้อยู่ ไม่รีบ

---

## วิธีใช้ใน Codex / Running it

ชื่อไฟล์สำคัญที่สุด — รูปที่ชื่อผิดคือรูปที่ไม่มีวันขึ้นเว็บ

```
สำหรับแต่ละแถวใน IMAGE-PROMPTS.csv:
  สร้างรูปจากคอลัมน์ prompt
  เซฟเป็นชื่อในคอลัมน์ filename  (jpg, สี่เหลี่ยมจัตุรัส)
  วางไว้ที่  assets/products/
```

ทำทีละ 10 แถวแล้วเช็คก่อนไปต่อ จะคุมคุณภาพง่ายกว่าปล่อยยาว

**สี่เหลี่ยมจัตุรัสเท่านั้น** — เว็บใช้สัดส่วนรูปแยกว่าอะไรเป็นรูปถ่าย อะไรเป็นการ์ด
รูปจัตุรัสจะเต็มกรอบสวย รูปไม่จัตุรัสจะถูกแสดงเป็นการ์ดแทน

---

## เอารูปขึ้นเว็บ / Wiring the results in

รูปที่วางใน `assets/products/` ยังไม่ขึ้นเว็บทันที ต้องผูกชื่อสินค้าเข้ากับไฟล์ใน
`product-images.json` ก่อน — `CODEX-HANDOVER.md` อธิบายวิธีไว้แล้ว

**หรือส่งรูปมาให้ผมผูกให้ก็ได้ครับ** บอกมาว่าเจนเสร็จกี่ตัว เดี๋ยวจัดการต่อให้

---

## กติกาที่ห้ามข้าม / Hard rules

- ห้ามลอกรูปจาก **leafly.com** และ **weed.com** — มีลิขสิทธิ์ทั้งคู่ ต้องสร้างใหม่เท่านั้น
- ห้ามมีตัวหนังสือ โลโก้ หรือแบรนด์ในรูป
- ห้ามมีคน มือ หรือส่วนของร่างกาย
- ดอกกัญชาถ่ายเองสวยกว่าเจน — ถ้ามีเวลาถ่ายเอง ให้ใช้ AI กับไฟแช็ก กระดาษ น้ำอัดลม จะคุ้มกว่า
