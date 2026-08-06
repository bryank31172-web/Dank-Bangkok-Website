# DANK — image prompts for the SKUs that need a real picture

Every one of the 53 SKUs on the shop already shows something, so no card is ever blank.
These five are the ones showing something that isn't quite theirs: four strains are wearing
another strain's photograph, and the beer is on a stock lager photo rather than a DANK one.

Generate each at **1:1 square**, then upload it to that product in Shopify (or the POS) and
the website picks it up on the next menu refresh.

---

## House style — already baked into each prompt below

Palette is locked to the brand: matte black `#0F0F0F`, deep emerald `#2E7D32`, antique gold
`#C9A227`, dark walnut wood. Cinematic low-key studio product photography, one soft key light
from upper left, a subtle gold rim light, shallow depth of field, 8K, ultra photorealistic 3D
product render, square composition with generous negative space. No bright colours, no neon,
no cartoon elements, no text, no logos, no discount badges, no watermarks.

---

## 1 · Ztupid — Topshelf · Hybrid · 26% THC

Currently sharing a photograph with **Zkittles**, so one of the two cards is lying to the customer.

> Extreme macro hero shot of a single premium cannabis flower bud of the strain "Ztupid", resting on dark walnut wood. Dense frosted trichomes catching the light like crushed glass, deep forest-green calyxes with a faint violet blush, bright amber-orange pistils curling out, sticky resin detail on every sugar leaf, a light dusting of kief on the wood beside it. Cinematic low-key studio product photography, single soft key light from upper left, subtle gold rim light, shallow depth of field, 8K, ultra photorealistic 3D product render, square 1:1 composition, bud centred with generous negative space. Colour palette strictly: matte black #0F0F0F background, deep emerald green #2E7D32 and antique gold #C9A227 accents, dark walnut wood. No bright colours, no neon, no cartoon elements, no text, no logos, no discount badges, no watermarks.

## 2 · Zkittles — Topshelf · Hybrid · 30% THC

The other half of that pair. Tropical / berry / candy terps — give it visibly more colour than Ztupid so the two cards read as different products at a glance.

> Extreme macro hero shot of a single premium cannabis flower bud of the strain "Zkittles", resting on dark walnut wood. Dense trichome frost, rich deep-purple and magenta leaf tones bleeding into emerald green, vivid orange pistils, glassy resin heads, a scatter of tiny candy-like crystal glints. Cinematic low-key studio product photography, single soft key light from upper left, subtle gold rim light, shallow depth of field, 8K, ultra photorealistic 3D product render, square 1:1 composition, bud centred with generous negative space. Colour palette strictly: matte black #0F0F0F background, deep emerald green #2E7D32 and antique gold #C9A227 accents, dark walnut wood. Purple tones must stay deep and muted, never bright or neon. No cartoon elements, no text, no logos, no discount badges, no watermarks.

## 3 · Sherb Tank — Topshelf · Hybrid · 25% THC

Currently sharing a photograph with **Baby Cake**.

> Extreme macro hero shot of a single premium cannabis flower bud of the strain "Sherb Tank", resting on dark walnut wood. A dense, chunky, tank-like bud, pale mint-green and cream-toned calyxes under a thick sugar-white trichome coat, rusty orange pistils, glossy oily resin sheen suggesting gassy sherbet terps. Cinematic low-key studio product photography, single soft key light from upper left, subtle gold rim light, shallow depth of field, 8K, ultra photorealistic 3D product render, square 1:1 composition, bud centred with generous negative space. Colour palette strictly: matte black #0F0F0F background, deep emerald green #2E7D32 and antique gold #C9A227 accents, dark walnut wood. No bright colours, no neon, no cartoon elements, no text, no logos, no discount badges, no watermarks.

## 4 · Baby Cake — Topshelf · Hybrid · 24–28% THC

The other half of that pair. Cake-batter / vanilla terps — softer and rounder than Sherb Tank.

> Extreme macro hero shot of a single premium cannabis flower bud of the strain "Baby Cake", resting on dark walnut wood. A soft, rounded, tightly packed bud, warm sage-green with buttery cream-coloured sugar leaves, heavy vanilla-white trichome frost, delicate copper pistils, a fine snow of kief on the wood. Cinematic low-key studio product photography, single soft key light from upper left, subtle gold rim light, shallow depth of field, 8K, ultra photorealistic 3D product render, square 1:1 composition, bud centred with generous negative space. Colour palette strictly: matte black #0F0F0F background, deep emerald green #2E7D32 and antique gold #C9A227 accents, dark walnut wood. No bright colours, no neon, no cartoon elements, no text, no logos, no discount badges, no watermarks.

## 5 · Crispy Boy Lager Can — Beer

The only SKU on a generic stock photo. Keep the can unbranded so nothing implies a partnership the shop doesn't have.

> A chilled unbranded matte-black aluminium beer can standing upright on dark walnut wood, heavy condensation beading down the side, one droplet running to the base, ice-cold crisp lager mood, a thin antique-gold band catching the rim light. Cinematic low-key studio product photography, single soft key light from upper left, subtle gold rim light, shallow depth of field, 8K, ultra photorealistic 3D product render, square 1:1 composition, can centred with generous negative space. Colour palette strictly: matte black #0F0F0F background, deep emerald green #2E7D32 and antique gold #C9A227 accents, dark walnut wood. No bright colours, no neon, no cartoon elements, no readable text, no brand logos, no discount badges, no watermarks.

---

## The matching rules were putting some wrong pictures on products — fixed

When a product arrives from the POS without a photo of its own, the menu finds one by looking
for keywords in the name. It was doing that against the name with every space taken out, which
is how it found **"rig"** inside *Original* Glazed Donut and hung a dab rig on a donut. The same
flaw put a can of cola on *Choc**ola**t Mousse*, a plate of ham on *C**ham**omile Tea*, a cup of
tea on *S**tea**m Bun*, a baseball cap on *P**hat** Panda* and on *__Cap__sule Storage Jar*, a
Leo beer on *Napo**leo**n Cake*, and rolling tips on *Mul**tip**le Filter Pack*.

Two changes fix it, and 25 tests hold them in place:

Short keywords — five letters or fewer — now have to match a whole word rather than any run of
letters inside the name. Longer ones like "brownie" or "cartridge" can still match anywhere,
because at that length a coincidence isn't plausible any more.

And any product whose name is a strain the site knows is now treated as flower no matter what
category the POS filed it under. That matters because the POS often files things under
"Specials" — which is why **Thai Orange Tea** was at risk of being served a photo of Thai food.
Flower can only ever wear one of your own Shopify photos or an exact-name match; it can never
fall through to a stock photo.

## The last mile is yours — open photo-audit.html

Whether a photograph is *of the right product* is the one thing that can't be checked from my
side: your shop's photo CDN isn't reachable from here, so only your browser can load the actual
pixels. The audit page now does that for you.

Tap **Run the audit**, then **Check each picture →**. It shows one product at a time, full
screen, with the photo, the name, the THC and flavours, and a line explaining *why* that product
has that photo — whether you uploaded it yourself, whether it was matched by name, or whether it
was guessed from a word in the name (that last group is where wrong pictures come from). Tap
**✓ That's right** or **✕ Wrong picture**, or use the arrow keys and Y / N on a keyboard.

It puts the riskiest ones first: placeholders, then category stock photos, then keyword guesses,
then name matches, and photos you uploaded yourself last. So the ones most likely to be wrong
are the first ten you see, and you can stop whenever you've had enough. Everything you mark wrong
gets a generated prompt in the same house style at the bottom of the page, ready to copy or
download.
