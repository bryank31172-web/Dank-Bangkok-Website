#!/usr/bin/env python3
"""Write one ready-to-paste image prompt per product.

The queue already carries a short `subject` per row and CHATGPT-START.md keeps
the house recipe in a separate message. That works when a person drives the
generator by hand; it does not survive being handed to a tool row by row, where
each prompt has to stand on its own. So this expands every row into a single
complete prompt, and enriches the flower with what the strain database knows
about it, since "Papaya Fuel, cannabis flower" and "a golden-green bud with
amber pistils, tropical papaya and diesel" are not the same picture.
"""
import csv, io, json, re, sys

ROOT = '/home/user/dankbkk-site'

# The look Bryan picked: the Permanent Bx1 photograph, not the poster cards.
HOUSE = ("Shoot it like a premium dispensary product photograph: the subject centred on a "
         "matte charcoal-black surface, a single soft light from the upper left, a faint "
         "green rim light along one edge, deep shadows, shallow depth of field, the subject "
         "filling the frame. Square 1:1. Photorealistic. No text, no lettering, no logos, no "
         "packaging branding, no hands, no people, no watermark.")

# Flavour and type steer what a bud actually looks like, which is the whole
# difference between 271 pictures of "some weed" and 271 pictures of the shop's
# own jars. First match wins, so the more specific notes are listed first.
LOOK = [
 (r'grape|berry|blueberry|purple|blackberry',
  'deep purple and violet leaves shot through with dark green, bright orange pistils, heavy white trichome frost'),
 (r'lemon|lime|citrus|orange|pineapple|tropical|papaya|mango',
  'golden-green and lime leaves, vivid amber-orange pistils, a bright sugary coat of trichomes'),
 (r'diesel|gas|fuel|skunk|pungent',
  'dense dark forest-green leaves, rust-orange pistils, a thick greasy layer of trichomes'),
 (r'cream|cookie|vanilla|dough|cake|gelato|sweet',
  'pale sage and mint-green leaves, soft cream-coloured pistils, a dusty even frost'),
 (r'mint|menthol|pine|earthy|herbal|wood',
  'cool deep green leaves with silver edges, muted copper pistils, fine crystalline frost'),
 (r'candy|fruity|strawberry|cherry|watermelon|melon',
  'bright green leaves flushed with magenta, hot orange pistils, a glittering candy-like coat of trichomes'),
]
DEFAULT_LOOK = ('dense mid-green leaves with a few purple edges, warm orange pistils, '
                'a generous white coat of trichomes')

def flat(name):
    """Same flattening api/_menu.js uses, so keys line up with the databases."""
    s = re.sub(r'\([^)]*\)', ' ', str(name or '')).lower()
    return re.sub(r'[^a-z0-9]', '', s)

def look_for(text):
    t = (text or '').lower()
    for pat, desc in LOOK:
        if re.search(pat, t):
            return desc
    return DEFAULT_LOOK

def load(path, **kw):
    return io.open(ROOT + '/' + path, encoding='utf-8-sig', errors='surrogateescape', **kw)

strain_db = json.loads(io.open(ROOT + '/strain-db.json', encoding='utf-8').read())
STRAINS, ALIAS = strain_db['strains'], strain_db.get('alias', {})

def strain_for(key):
    k = ALIAS.get(key, key)
    return STRAINS.get(k)

def flower_prompt(product, s):
    """A single cured bud, described from the strain's own record."""
    bits = []
    if s:
        flavour = ', '.join(s.get('flavors') or [])
        look = look_for(flavour + ' ' + (s.get('desc') or '') + ' ' + product)
        typ = s.get('type') or 'Hybrid'
        sub = (f"One premium cured cannabis flower bud of the strain {s.get('name') or product}, "
               f"a {typ.lower()} — {look}.")
        if flavour:
            bits.append(f"The flower reads as {flavour.lower()}.")
        if s.get('thc'):
            bits.append(f"Dense and top-shelf, the sort of bud sold at {s['thc']} THC.")
    else:
        look = look_for(product)
        sub = (f"One premium cured cannabis flower bud, single nugget, {look}.")
    bits.append("Macro product shot, the trichomes and pistils sharp in the centre of the bud, "
                "the back of the nugget falling gently out of focus. Nothing else in the frame — "
                "no jar, no tray, no scattered leaf.")
    return ' '.join([sub] + bits)

def generic_prompt(subject):
    """Everything that is not flower keeps the queue's own subject line."""
    s = (subject or '').strip().rstrip('.')
    return s + '.' if s else ''

rows_out = []
seen_files = set()

# ---- Group A: the 271 products with no photograph of their own -------------
with load('IMAGE-QUEUE.csv') as fh:
    for r in csv.DictReader(fh):
        fn = (r.get('filename') or '').strip()
        if not fn or fn in seen_files:
            continue
        seen_files.add(fn)
        kind = (r.get('kind') or '').strip()
        product = (r.get('product') or '').strip()
        if kind == 'flower':
            body = flower_prompt(product, strain_for(flat(product)))
        else:
            body = generic_prompt(r.get('subject'))
        rows_out.append({
            'no': len(rows_out) + 1,
            'filename': fn,
            'product': product,
            'category': (r.get('category') or '').strip(),
            'kind': kind or 'other',
            'in_stock': (r.get('in_stock') or '').strip(),
            'group': 'A-missing',
            'prompt': (body + ' ' + HOUSE).strip(),
        })

# ---- Group B: products already showing a poster card ------------------------
# These have an image, so they are not in the queue - but the image is one of
# Bryan's Botanical Legends posters, which is what he asked to replace with a
# photograph. Kept as a separate group so the missing ones stay the priority.
imgs = json.loads(io.open(ROOT + '/product-images.json', encoding='utf-8').read())
by_url = {}
for key, url in (imgs.get('byName') or {}).items():
    if 'cdn.shopify' not in url:
        continue
    by_url.setdefault(url, []).append(key)

for url, keys in by_url.items():
    key = min(keys, key=len)             # the plainest spelling reads best as a name
    s = strain_for(key)
    if not s:
        continue                         # only the flower carries poster cards
    fn = key + '.jpg'
    if fn in seen_files:
        continue
    seen_files.add(fn)
    name = s.get('name') or key
    rows_out.append({
        'no': len(rows_out) + 1,
        'filename': fn,
        'product': name,
        'category': 'Flower',
        'kind': 'flower',
        'in_stock': '',
        'group': 'B-replace-card',
        'prompt': (flower_prompt(name, s) + ' ' + HOUSE).strip(),
    })

out = ROOT + '/IMAGE-PROMPTS.csv'
with io.open(out, 'w', encoding='utf-8', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=['no', 'filename', 'product', 'category',
                                       'kind', 'in_stock', 'group', 'prompt'])
    w.writeheader()
    w.writerows(rows_out)

a = sum(1 for r in rows_out if r['group'] == 'A-missing')
b = len(rows_out) - a
stock = sum(1 for r in rows_out if str(r['in_stock']).strip().lower() in ('1', 'true', 'yes'))
print(f"เขียน {out}")
print(f"  รวม {len(rows_out)} prompt  ·  ยังไม่มีรูป {a}  ·  แทนการ์ดโปสเตอร์ {b}")
print(f"  มีของขายอยู่ {stock}")
kinds = {}
for r in rows_out:
    kinds[r['kind']] = kinds.get(r['kind'], 0) + 1
print("  แยกตามชนิด: " + ', '.join(f"{k} {v}" for k, v in sorted(kinds.items(), key=lambda x: -x[1])))
print("\nตัวอย่างดอก:\n  " + next(r['prompt'] for r in rows_out if r['kind'] == 'flower')[:400])
