# งานสำหรับ Grok — DANK BKK

**วิธีใช้:** เปิด Grok แล้ววางไฟล์นี้ทั้งไฟล์ลงไป · ทำได้ทีละงาน ไม่ต้องทำหมดรอบเดียว
ทำเสร็จงานไหน ส่งคำตอบกลับมาให้ Claude ใส่ให้ในเว็บครับ

สร้างเมื่อ **25 สิงหาคม 2026** จากข้อมูลจริงบนเว็บ ณ วันนั้น

---

## อ่านก่อนเริ่ม (สำคัญ)

**DANK BKK** เป็นร้านกัญชาที่กรุงเทพฯ · เว็บ <https://www.dankbangkok.com>

งาน 3 อย่างในไฟล์นี้ คือของที่ **Claude ทำเองไม่ได้** เพราะ sandbox ที่ Claude
ทำงานอยู่บล็อกเว็บพวกนี้: `cdn.shopify.com` · `maxme.co.th` ·
`maxenterpriseconnect.com` · `linktr.ee` — และ Claude สร้างรูปไม่ได้
Grok เปิดเว็บพวกนี้ได้และสร้างรูปได้ เลยเป็นงานที่เหมาะกับ Grok พอดี

### กติกาที่ห้ามผิด

1. **ห้ามคัดลอกข้อความหรือรูปจาก Leafly / weed.com** — มีลิขสิทธิ์ทั้งคู่
   เอา*ข้อเท็จจริง*มาได้ (เช่น สายพันธุ์นี้เป็น Indica) แต่ต้องเขียนใหม่ด้วย
   คำของตัวเอง ห้ามลอกประโยค
2. **ห้ามเดา** ถ้าอ่านตัวเลขบนการ์ดไม่ชัด ให้ตอบว่า "อ่านไม่ออก" ไม่ต้องเดา
   ตัวเลข THC ที่ผิดคือลูกค้าซื้อของผิดแรง
3. **ห้ามแตะไฟล์อื่นในเว็บ** งานนี้แค่ตอบกลับมาเป็นข้อความ Claude จะเป็นคนแก้โค้ดเอง

---

# งานที่ 1 — ตรวจการ์ดสายพันธุ์ 27 ใบ ⭐ สำคัญสุด

## ปัญหา

เว็บแสดงข้อมูลสายพันธุ์ (TYPE / THC / กลิ่น / ฤทธิ์) จากฐานข้อมูลของเว็บเอง
แต่ร้านมี **การ์ดสายพันธุ์จริง** ที่ทำไว้แล้ว เก็บอยู่บน Shopify CDN

**ไม่เคยมีใครเทียบ 2 อันนี้ว่าตรงกันมั้ย** เพราะ Claude เปิด `cdn.shopify.com` ไม่ได้

เคยเจอมาแล้ว 3 เคสที่ไม่ตรง:
- **King Cherry** เว็บขึ้น 19% การ์ดเขียน 28% (แก้แล้ว)
- **Ztupid** ตัวเลขไม่ตรง (แก้แล้ว)
- **Gelato 41** การ์ดเขียนข้อความของ Granddaddy Purple ทั้งบรรทัด (แก้แล้ว)

3 เคสนี้เจอโดยบังเอิญ **ที่เหลือ 27 ใบยังไม่มีใครดู**

## สิ่งที่ต้องทำ

เปิดลิงก์การ์ดแต่ละใบ อ่านตัวเลขและข้อความบนการ์ด แล้วเทียบกับ "เว็บบอกว่า"

**การ์ดคือความจริง** — การ์ดคือสิ่งที่ลูกค้าเห็นในร้านจริงๆ ถ้าไม่ตรง เว็บผิด

## รูปแบบคำตอบที่ต้องการ

ตอบเป็นตารางเดียว **เฉพาะตัวที่ไม่ตรง** (ตรงแล้วไม่ต้องเขียน แค่บอกจำนวนรวม):

```
| ชื่อ | key | ช่องที่ผิด | เว็บบอก | การ์ดเขียน |
|---|---|---|---|---|
| King Cherry | kingcherry | THC | 19% | 28% |
```

แล้วปิดท้ายด้วย: `ตรวจแล้ว 27 ใบ · ตรง XX · ไม่ตรง YY · เปิดไม่ได้/อ่านไม่ออก ZZ`

ถ้าการ์ดใบไหนเปิดไม่ได้ (404 / โหลดไม่ขึ้น) บอกมาด้วย อย่าข้ามเงียบๆ

## 2 เรื่องที่รู้อยู่แล้ว ไม่ต้องรายงานซ้ำ

1. **Gem Snow Pineapple Express** กับ **Pineapple Express** ชี้ไปที่การ์ด
   **ใบเดียวกัน** แต่เว็บให้ THC คนละค่า (18-26% กับ 20%) — รู้แล้ว
   ช่วยดูให้หน่อยว่าการ์ดใบนั้นเขียนถึงตัวไหน แล้วบอกมา แต่ไม่ต้องตกใจ
2. **ตัวเลข 60% THC ของ Snow Brands Pineapple Express** — เจ้าของร้านรู้แล้ว
   และ **ตัดสินใจไม่แก้** อย่าเสนอให้แก้

## รายการทั้ง 27 ใบ

### 1. Alien Mint
- **key**: `alienmint`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6888.png?v=1782731863
- เว็บบอกว่า: TYPE **Hybrid** · THC **26-30%** · CBD <1% · Terpene —
- Effects: Relaxed / Euphoric / Happy / Uplifted
- Flavors: Mint / Chocolate / Nutty
- Lineage: Alien OG x Girl Scout Cookies

### 2. Black Cherry
- **key**: `blackcherry`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6879.jpg?v=1782729302
- เว็บบอกว่า: TYPE **Hybrid** · THC **19-23%** · CBD <1% · Terpene Pinene
- Effects: Relaxed / Hungry / Aroused
- Flavors: Berry / Apricot / Pear
- Lineage: Acai Berry Gelato x Black Cherry Funk

### 3. Blue Nerdz
- **key**: `bluenerdz`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6875.jpg?v=1782723699
- เว็บบอกว่า: TYPE **Hybrid** · THC **22-26%** · CBD <1% · Terpene —
- Effects: Focused / Relaxed / Euphoric / Happy
- Flavors: Blueberry / Apple / Apricot
- Lineage: Forbidden Fruit x Watermelon Z

### 4. CoCo Chanel
- **key**: `cocochanel`  ⚠️ card:true — การ์ดคือความจริง ตัวเลขบนการ์ดต้องชนะเสมอ
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/CB952B9D-5F70-4968-B268-A766D1893BCE.png?v=1780143593
- เว็บบอกว่า: TYPE **Hybrid - Sativa 70%** · THC **29.4%** · CBD <1% · Terpene Limonene
- Effects: Euphoric / Social / Balanced / Talkative
- Flavors: Coconut / Vanilla / Citrus
- Lineage: —

### 5. Cookie Monster
- **key**: `cookiemonster`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6884.jpg?v=1782730860
- เว็บบอกว่า: TYPE **Indica** · THC **15-19%** · CBD <1% · Terpene Myrcene
- Effects: Relaxed / Sleepy / Hungry
- Flavors: Sweet / Butter / Pine
- Lineage: Girl Scout Cookies x OG Kush

### 6. Crunch Berries
- **key**: `crunchberries`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6890.png?v=1782732640
- เว็บบอกว่า: TYPE **Hybrid** · THC **18-22%** · CBD <1% · Terpene Pinene
- Effects: Talkative / Relaxed / Happy
- Flavors: Berry / Apricot / Blueberry
- Lineage: Blueberry x Triple OG

### 7. D-Lish
- **key**: `dlish`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6883.png?v=1782730523
- เว็บบอกว่า: TYPE **Hybrid** · THC **24-30%** · CBD <1% · Terpene —
- Effects: Energetic / Creative / Uplifted / Euphoric
- Flavors: Diesel / Tropical / Earthy
- Lineage: Zkittlez x Sweet Retreat

### 8. Gelato X
- **key**: `gelatox`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/5BC567FD-D2D3-40DD-9E61-C184268D134C.png?v=1780151537
- เว็บบอกว่า: TYPE **Indica-dominant Hybrid** · THC **25-27%** · CBD <1% · Terpene —
- Effects: Happy / Euphoric / Creative / Uplifted
- Flavors: Vanilla / Mint / Nutty
- Lineage: Runtz x Thin Mint GSC

### 9. Gem Snow Pineapple Express
- **key**: `gemsnowpineappleexpress`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/F8CDE9E5-64B9-4526-B65C-9E13833140ED.jpg?v=1776872037
- เว็บบอกว่า: TYPE **Sativa-dominant Hybrid** · THC **18-26%** · CBD <1% · Terpene Caryophyllene
- Effects: Happy / Energetic / Creative
- Flavors: Pineapple / Citrus / Pine
- Lineage: Trainwreck x Hawaiian

### 10. Giraffe Puzzy
- **key**: `giraffepuzzy`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6876.jpg?v=1782725629
- เว็บบอกว่า: TYPE **Hybrid** · THC **30%** · CBD <1% · Terpene —
- Effects: Giggly / Creative / Energetic
- Flavors: Butter / Apricot / Diesel
- Lineage: Zkittlez x Animal Mints

### 11. King Cherry
- **key**: `kingcherry`  ⚠️ card:true — การ์ดคือความจริง ตัวเลขบนการ์ดต้องชนะเสมอ
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/6A808D23-ABAB-45D5-B098-B58A737A0113.png?v=1780144616
- เว็บบอกว่า: TYPE **Indica-dominant Hybrid** · THC **28%** · CBD <1% · Terpene —
- Effects: Relaxed / Happy / Sleepy / Focused
- Flavors: Cherry / Deep berry / Gassy finish / Floral
- Lineage: Royal cherry cross

### 12. LCG RX11
- **key**: `lcgrx11`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-5253.png?v=1779642559
- เว็บบอกว่า: TYPE **Hybrid** · THC **20-24%** · CBD <1% · Terpene Caryophyllene
- Effects: Relaxed / Giggly / Focused
- Flavors: Citrus / Berry / Peach
- Lineage: Lemon Cherry Gelato x RS11

### 13. Lemon Cherry Gelato
- **key**: `lemoncherrygelato`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/48E8E325-A1F7-43F4-8777-6520094BA6C9.png?v=1780151539
- เว็บบอกว่า: TYPE **Hybrid** · THC **20%** · CBD <1% · Terpene Caryophyllene
- Effects: Tingly / Relaxed / Giggly
- Flavors: Lemon / Citrus / Berry
- Lineage: GSC x Sunset Sherbet

### 14. Mac 1
- **key**: `mac1`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6886.png?v=1782731272
- เว็บบอกว่า: TYPE **Hybrid** · THC **22%** · CBD <1% · Terpene Limonene
- Effects: Uplifted / Euphoric / Relaxed
- Flavors: Butter / Citrus / Ammonia
- Lineage: Alien Cookies F2 x Miracle 15

### 15. Mellowz
- **key**: `mellowz`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/D8AB80ED-9C47-4045-AAB2-3F197CAA0A05.png?v=1780143506
- เว็บบอกว่า: TYPE **Indica-dominant Hybrid** · THC **25-29%** · CBD <1% · Terpene Caryophyllene
- Effects: Focused / Euphoric / Energetic
- Flavors: Butter / Vanilla / Sweet
- Lineage: Spritzer x Grape Gas

### 16. OG Kush x Zkittlez
- **key**: `ogkushxzkittlez`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6880.jpg?v=1782729487
- เว็บบอกว่า: TYPE **Hybrid** · THC **18-22%** · CBD <1% · Terpene Caryophyllene
- Effects: Euphoric / Happy / Energetic
- Flavors: Berry / Blueberry / Pineapple
- Lineage: OG Kush x Zkittlez

### 17. Orange Z
- **key**: `orangez`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6878.jpg?v=1782729032
- เว็บบอกว่า: TYPE **Hybrid** · THC **18-22%** · CBD <1% · Terpene Caryophyllene
- Effects: Uplifted / Energetic / Happy
- Flavors: Orange / Citrus / Tropical
- Lineage: Zkittlez x Agent Orange

### 18. Pineapple Express
- **key**: `pineappleexpress`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/F8CDE9E5-64B9-4526-B65C-9E13833140ED.jpg?v=1776872037
- เว็บบอกว่า: TYPE **Sativa-dominant Hybrid** · THC **20%** · CBD <1% · Terpene Myrcene
- Effects: Happy / Giggly / Energetic
- Flavors: Pineapple / Tropical / Citrus
- Lineage: Trainwreck x Hawaiian

### 19. Pink Zugar
- **key**: `pinkzugar`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-5581.png?v=1780144311
- เว็บบอกว่า: TYPE **Indica-dominant Hybrid** · THC **25-26%** · CBD <1% · Terpene —
- Effects: Happy / Euphoric / Relaxed / Creative
- Flavors: Blueberry / Strawberry / Apple
- Lineage: Pink Pellegrino x Zuchi

### 20. Sherb Tang
- **key**: `sherbtang`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-5575.png?v=1780144807
- เว็บบอกว่า: TYPE **Indica-dominant Hybrid** · THC **25-27%** · CBD <1% · Terpene Myrcene
- Effects: Relaxed / Euphoric / Happy / Creative
- Flavors: Vanilla / Citrus / Berry
- Lineage: Sherb Cream Pie x Super Boof

### 21. Super Boof
- **key**: `superboof`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-5258.png?v=1779643656
- เว็บบอกว่า: TYPE **Hybrid** · THC **26-28%** · CBD <1% · Terpene Myrcene
- Effects: Giggly / Focused / Euphoric
- Flavors: Grapefruit / Citrus / Orange
- Lineage: Black Cherry Punch x Tropicana Cookies

### 22. Thai Orange Tea
- **key**: `thaiorangetea`  ⚠️ card:true — การ์ดคือความจริง ตัวเลขบนการ์ดต้องชนะเสมอ
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6873.jpg?v=1782722872
- เว็บบอกว่า: TYPE **Sativa** · THC **29-30%** · CBD <1% · Terpene —
- Effects: Uplifted / Focused / Social / Creative
- Flavors: Thai tea / Orange / Creamy
- Lineage: —

### 23. Thailand Durian
- **key**: `thailanddurian`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/83C2F813-6C1F-4A98-BCBB-B53C99E3634D.jpg?v=1779643290
- เว็บบอกว่า: TYPE **Hybrid** · THC **—** · CBD — · Terpene —
- Effects: Euphoric / Relaxed / Creative
- Flavors: Sweet / Tropical / Earthy
- Lineage: —

### 24. Toad Venom
- **key**: `toadvenom`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-5254.png?v=1779642336
- เว็บบอกว่า: TYPE **Hybrid** · THC **24%** · CBD <1% · Terpene —
- Effects: Energetic / Uplifted / Creative
- Flavors: Chemical / Cheese / Diesel
- Lineage: Venom OG x All Gas OG

### 25. White Lotus
- **key**: `whitelotus`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-6877.jpg?v=1782726867
- เว็บบอกว่า: TYPE **Hybrid** · THC **20%** · CBD <1% · Terpene Myrcene
- Effects: Relaxed / Euphoric / Happy / Creative
- Flavors: Citrus / Pineapple / Earthy
- Lineage: The White x Snow Lotus

### 26. Zooties
- **key**: `zooties`
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/18974187-610E-4BB3-8149-5F9240AEBA54.png?v=1692912822
- เว็บบอกว่า: TYPE **Hybrid** · THC **24-30%** · CBD <1% · Terpene Limonene
- Effects: Euphoric / Relaxed / Happy / Sleepy
- Flavors: Berry / Grape / Citrus
- Lineage: Grape Ape x Grapefruit x The Original Z x Gelato

### 27. Ztupid
- **key**: `ztupid`  ⚠️ card:true — การ์ดคือความจริง ตัวเลขบนการ์ดต้องชนะเสมอ
- **การ์ด**: https://cdn.shopify.com/s/files/1/0812/7053/8528/files/IMG-5582.png?v=1780144103
- เว็บบอกว่า: TYPE **Hybrid** · THC **26%** · CBD <1% · Terpene —
- Effects: Balanced / Calm / Happy / Creative / Relaxed / Euphoric
- Flavors: Candy gas / Fruity / Doughy funk
- Lineage: —


---

# งานที่ 2 — สร้างรูปสินค้า 2 รูป

## ปัญหา

สินค้าในร้าน 395 ตัว มีรูปเกือบครบหมดแล้ว เหลือ **2 ตัวที่ลูกค้าเห็นบนหน้าเว็บ
และมีของขายอยู่จริง** แต่ยังไม่มีรูป — ตอนนี้ขึ้นเป็นกล่องสีวาดๆ แทน

## สร้าง 2 รูปนี้ (จัตุรัส 1:1)

### รูปที่ 1 — `Frezzer Jam` (ดอกกัญชา · เหลือ 60 กรัม)

> Extreme macro hero shot of a single premium cannabis flower bud, resting on
> dark walnut wood. Dense trichome frost catching the light like crushed glass,
> vivid orange pistils, deep green and purple leaf tones, crisp resin detail.
> Moody low-key studio lighting, single soft key light from the upper left,
> deep shadows, black background. Luxury product photography, shallow depth of
> field, 1:1 square crop. No text, no logos, no watermarks, no hands.

### รูปที่ 2 — `Kamagra` (สินค้าประเภท Edibles · เหลือ 66 ชิ้น)

> A small sealed foil blister pack of generic tablets presented as a luxury
> product on dark walnut wood, moody low-key studio lighting, single soft key
> light from the upper left, deep shadows, black background. Clean, clinical,
> premium. 1:1 square crop. **No brand names, no readable text, no logos, no
> pills spilled loose, no medical claims.**

## ข้อกำหนด

- **จัตุรัส 1:1** ขนาดที่ร้านใช้คือ 1254×1254 px (เล็กกว่านี้ได้ แต่ต้องจัตุรัส)
- **พื้นหลังมืด** ให้เข้ากับรูปอื่นในเว็บ (ธีมเว็บเป็นสีเข้ม เขียว-ทอง)
- **ห้ามมีตัวหนังสือหรือโลโก้ในรูป**
- ส่งไฟล์กลับมาให้ Bryan → Bryan ส่งต่อให้ Claude ใส่ในเว็บ

## ⚠️ ห้ามทำ

**ห้ามเอารูปเดิมของสินค้าตัวอื่นมาใช้แทน** เคยมีปัญหานี้แล้ว: 4 สินค้าใช้รูป
ร่วมกัน 2 รูป ซึ่งเท่ากับบอกลูกค้าว่ากำลังซื้อสายพันธุ์หนึ่ง แต่ได้อีกสายพันธุ์
ถือเป็นบั๊กที่แก้ไปแล้ว อย่าทำซ้ำ

---

# งานที่ 3 — หาเอกสาร API ของ MaxMe Wallet

## ปัญหา

ร้านจะรับเงินผ่าน **MaxMe Wallet** (แอปของกลุ่ม PTG — ปั๊ม PT)

ตอนนี้ทำได้แค่แบบ **แสดง QR ร้าน แล้วให้ลูกค้าอัปสลิป** พนักงานเช็คเอง
ซึ่งใช้งานได้จริง แต่ถ้ามี API จะดีกว่ามาก เพราะระบบจะรู้เองว่าจ่ายแล้ว
ไม่ต้องให้พนักงานมานั่งเช็คสลิปทีละใบ

Claude หาเอกสาร API ไม่เจอเลย และเปิด `maxme.co.th` /
`maxenterpriseconnect.com` ไม่ได้ (โดนบล็อก)

## สิ่งที่ต้องหา

เปิดเว็บพวกนี้แล้วหาว่ามี API ให้เว็บขายของออนไลน์เชื่อมต่อมั้ย:

- <https://www.maxme.co.th/Merchant.html>
- <https://www.maxme.co.th/Merchant/PointPay.html>
- <https://maxenterpriseconnect.com/>
- ค้นเพิ่ม: `MaxMe API`, `Max Connect API`, `MaxMe developer`, `PTG payment API`

**ต้องตอบให้ได้ 5 ข้อ:**

1. มีเอกสาร API สาธารณะมั้ย? ถ้ามี **ลิงก์**
2. **Base URL** ของ API คืออะไร (เช่น `https://api.xxx.co.th`)
3. **ยืนยันตัวตนยังไง** — API key ใส่ตรงไหน (header ไหน / Basic auth / อื่นๆ)
4. มี **webhook** มั้ย (เวลาลูกค้าจ่ายเสร็จ ยิงกลับมาบอกเว็บเราได้มั้ย)
5. มี **sandbox / test mode** มั้ย

**ถ้าหาไม่เจอ ให้ตอบว่าหาไม่เจอ** อย่าแต่งขึ้นมา — โค้ดตรงนี้คือโค้ดที่ตัดเงิน
ลูกค้าจริง เดาผิดทีเดียวคือเงินหาย

ถ้าเจอแค่ช่องทางติดต่อ (เบอร์โทร / อีเมล / แบบฟอร์มสมัครร้านค้า) ก็มีประโยชน์
ส่งมาได้เลย Bryan จะได้โทรไปถามเอง

---

# ส่งคำตอบกลับยังไง

ทำเสร็จงานไหน ส่งกลับมาให้ Claude แบบนี้ก็พอ:

- **งาน 1** → ก็อปตารางที่ Grok ตอบมา วางให้ Claude
- **งาน 2** → ส่งไฟล์รูป 2 รูป
- **งาน 3** → ก็อปคำตอบ 5 ข้อ

Claude จะแก้ `strain-db.json` · ใส่รูปใน `assets/products/` · เขียน
`api/paymaxme.js` ให้ตามคำตอบที่ได้ครับ
