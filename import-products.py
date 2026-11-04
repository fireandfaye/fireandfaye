#!/usr/bin/env python3
"""
import-products.py — turn Paige's spreadsheet and photo folders into the site.

    python3 import-products.py            show what would change, write nothing
    python3 import-products.py --write    actually do it

Reads  ../product-import/fireandfaye-products.csv
       ../product-import/photos/<slug>/*        originals, any size, any count

Writes products.json                            the site's data
       images/products/<slug>-N.jpg             resized, web-sized
       ../fireandfaye-yoco-backend/products.js  the server-side price list

Then run `python3 build.py` to regenerate the pages.

Two rules this script will not break:

  It never deletes a product. A product on the site but missing from the CSV
  is left exactly as it is. Removing one breaks a URL that Google has indexed,
  so it has to be a deliberate act, not a side effect of an import.

  It writes the backend price list in the same pass. Those two files drifting
  apart is the oldest trap in this project: an id on the site but not in the
  backend is rejected at checkout, and a price that differs means the customer
  is charged something other than what they were shown.
"""

import csv
import json
import os
import re
import subprocess
import sys

HERE      = os.path.dirname(os.path.abspath(__file__))
IMPORT    = os.path.join(HERE, '..', 'product-import')
CSV_PATH  = os.path.join(IMPORT, 'fireandfaye-products.csv')
PHOTOS    = os.path.join(IMPORT, 'photos')
IMAGES    = os.path.join(HERE, 'images', 'products')
BACKEND   = os.path.join(HERE, '..', 'fireandfaye-yoco-backend', 'products.js')

# Web size for product photos. 3:4, comfortably sharp on a phone without
# shipping camera originals. One number to change if that ever needs revisiting.
TARGET_W, TARGET_H = 900, 1200
JPEG_QUALITY = 82

SKIP_STATUSES = ('NEEDS PHOTO',)          # rows that are not ready yet


# ── images ──────────────────────────────────────────────────────────────────

def dimensions(path):
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path],
                         capture_output=True, text=True).stdout
    w = re.search(r'pixelWidth:\s*(\d+)', out)
    h = re.search(r'pixelHeight:\s*(\d+)', out)
    return (int(w.group(1)), int(h.group(1))) if w and h else (None, None)


def to_web_jpeg(src, dest):
    """Cover-crop to TARGET_W x TARGET_H and save as JPEG. sips only — there is
    no image library on this machine and no npm to add one."""
    w, h = dimensions(src)
    if not w:
        return False
    scale = max(TARGET_W / w, TARGET_H / h)
    rw, rh = max(TARGET_W, round(w * scale)), max(TARGET_H, round(h * scale))
    subprocess.run(['sips', '-s', 'format', 'jpeg',
                    '-s', 'formatOptions', str(JPEG_QUALITY),
                    '-z', str(rh), str(rw),
                    '-c', str(TARGET_H), str(TARGET_W),
                    src, '--out', dest],
                   capture_output=True)
    return os.path.exists(dest)


def photos_for(slug):
    """Originals for a product, in filename order — which is display order, so
    the main shot wants a 1- prefix."""
    folder = os.path.join(PHOTOS, slug)
    if not os.path.isdir(folder):
        return []
    return [os.path.join(folder, f) for f in sorted(os.listdir(folder))
            if not f.startswith('.') and
            os.path.splitext(f)[1].lower() in ('.jpg', '.jpeg', '.png', '.heic', '.tif', '.tiff')]


# ── the spreadsheet ─────────────────────────────────────────────────────────

def read_csv():
    with open(CSV_PATH, encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    # Tolerate renamed or reordered columns: match on a normalised header.
    def key(name):
        return re.sub(r'[^a-z]', '', name.lower())
    out = []
    for r in rows:
        m = {key(k): (v or '').strip() for k, v in r.items() if k}
        out.append(m)
    return out


def compose_desc(stones, desc, materials):
    """Matches the newer products: a stones line, a blank line, then the prose."""
    parts = []
    if stones:
        parts.append(stones)
    body = desc
    if materials and materials.lower() not in body.lower():
        body = (body + ' ' if body else '') + materials
    if body:
        parts.append(body.strip())
    return '\n\n'.join(parts)


def main():
    write = '--write' in sys.argv
    rows = read_csv()
    existing = {p['id']: p for p in json.load(open(os.path.join(HERE, 'products.json'), encoding='utf-8'))}

    products, added, updated, skipped, missing_photos = [], [], [], [], []

    for r in rows:
        slug = r.get('slugdonotedit') or r.get('slug') or ''
        name = r.get('productname') or ''
        status = r.get('status', '')
        if not slug or not name:
            continue
        if any(s in status.upper() for s in SKIP_STATUSES):
            skipped.append((name, 'marked as needing a photo'))
            continue

        originals = photos_for(slug)
        if not originals:
            missing_photos.append(name)
            skipped.append((name, 'no photos in its folder'))
            continue

        price_raw = re.sub(r'[^0-9.]', '', r.get('pricer', '') or '')
        if not price_raw:
            skipped.append((name, 'no price'))
            continue
        price = f"R{float(price_raw):.2f}"

        images = []
        for i, src in enumerate(originals, start=1):
            rel = f"/images/products/{slug}-{i}.jpg"
            images.append(rel)
            if write:
                os.makedirs(IMAGES, exist_ok=True)
                if not to_web_jpeg(src, os.path.join(HERE, rel.lstrip('/'))):
                    print(f"  ! could not convert {src}")

        product = {
            'id': slug,
            'name': name,
            'price': price,
            'category': (r.get('category') or '').strip().lower(),
            'desc': compose_desc(r.get('stonestagline', ''), r.get('description', ''),
                                 r.get('materials', '')),
            'images': images,
        }
        products.append(product)

        before = existing.get(slug)
        if not before:
            added.append(f"{name}  {price}  ({len(images)} photo{'s' if len(images) != 1 else ''})")
        else:
            diffs = [k for k in ('name', 'price', 'category', 'desc')
                     if before.get(k) != product[k]]
            if len(before.get('images', [])) != len(images):
                diffs.append('images')
            if diffs:
                updated.append(f"{name}  [{', '.join(diffs)}]"
                               + (f"  {before['price']} -> {price}" if 'price' in diffs else ''))

    # Products on the site but absent from the CSV are kept, untouched.
    kept = [p for pid, p in existing.items() if pid not in {x['id'] for x in products}]
    final = products + kept

    print(f"\n{'WRITING' if write else 'DRY RUN — nothing written'}\n")
    print(f"  in the spreadsheet : {len(rows)}")
    print(f"  will be on the site: {len(final)}  ({len(products)} from the CSV, {len(kept)} kept as-is)\n")
    for label, items in (('NEW', added), ('CHANGED', updated),
                         ('SKIPPED', [f"{n} — {why}" for n, why in skipped]),
                         ('KEPT, not in the CSV', [p['name'] for p in kept])):
        if items:
            print(f"  {label} ({len(items)})")
            for i in items:
                print(f"    {i}")
            print()

    if not write:
        print("  Run again with --write to apply, then: python3 build.py")
        return

    final.sort(key=lambda p: (p['category'], p['name']))
    with open(os.path.join(HERE, 'products.json'), 'w', encoding='utf-8') as f:
        json.dump(final, f, indent=2, ensure_ascii=False)
        f.write('\n')

    # The backend's price list, rewritten in place so the two cannot drift.
    src = open(BACKEND, encoding='utf-8').read()
    lines = '\n'.join(
        f"  '{p['id']}':{' ' * max(1, 28 - len(p['id']))}"
        f"{{ name: {json.dumps(p['name'], ensure_ascii=False)}, "
        f"priceCents: {round(float(p['price'][1:]) * 100)} }},"
        for p in final)
    # Assert on the pattern, not on whether the text changed. An import that
    # only touches descriptions regenerates a byte-identical price list, and
    # `new != src` would call that a failure — after products.json had already
    # been written, which is the one state this script must never leave behind.
    pattern = r'const PRODUCTS = \{.*?\n\};'
    assert re.search(pattern, src, flags=re.S), \
        "could not find the PRODUCTS block in the backend"
    new = re.sub(pattern, 'const PRODUCTS = {\n' + lines + '\n};', src, flags=re.S)
    open(BACKEND, 'w', encoding='utf-8').write(new)

    print(f"  wrote products.json ({len(final)} products)")
    print(f"  wrote {len(sum([p['images'] for p in products], []))} images")
    print(f"  wrote {os.path.relpath(BACKEND, HERE)}")
    print("\n  Next: python3 build.py   — then check the preview before pushing.")


if __name__ == '__main__':
    main()
