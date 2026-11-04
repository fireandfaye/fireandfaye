#!/usr/bin/env python3
"""
publish-from-db.py — turn the Supabase products tables back into the site.

Runs in CI, not here. The GitHub Action calls it, then build.py, then commits.

    SUPABASE_URL=...  SUPABASE_SERVICE_KEY=...  python3 publish-from-db.py

Reads   public.products, public.product_images
        the `product-photos` storage bucket, for anything newly uploaded

Writes  products.json                              the site's data
        images/products/<slug>-N.jpg               photos, as committed files
        ../fireandfaye-yoco-backend/products.js    the server-side price list
        (and marks each uploaded photo published, so it is fetched once)

This is the mirror image of import-products.py. That one went CSV -> site and
was how the 47 products got here; this one goes database -> site and is how
every change from here on reaches the live page.

Two rules carried over, for the same reasons:

  It writes the backend price list in the same pass. A price on the site but
  not in the backend is rejected at checkout; a price that differs means the
  customer is charged something other than what they were shown.

  It never deletes a product. Unlisting hides it from the category pages but
  keeps the page and the URL, because a 404 on an indexed URL is a real cost.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE    = os.path.dirname(os.path.abspath(__file__))
IMAGES  = os.path.join(HERE, 'images', 'products')
# Locally the backend repo is a sibling folder. In CI both repos are checked
# out into the runner's workspace, so the path is passed in instead.
BACKEND = os.environ.get(
    'BACKEND_PRODUCTS_JS',
    os.path.join(HERE, '..', 'fireandfaye-yoco-backend', 'products.js'))
BUCKET  = 'product-photos'

URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
if not URL or not KEY:
    sys.exit('SUPABASE_URL and SUPABASE_SERVICE_KEY must both be set')


def api(path, method='GET', body=None, headers=None):
    req = urllib.request.Request(
        f'{URL}/rest/v1/{path}', method=method,
        data=json.dumps(body).encode() if body is not None else None)
    req.add_header('apikey', KEY)
    req.add_header('Authorization', 'Bearer ' + KEY)
    req.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def fetch_object(storage_path):
    """Download one photo from the private bucket, as the service role."""
    req = urllib.request.Request(f'{URL}/storage/v1/object/{BUCKET}/{storage_path}')
    req.add_header('apikey', KEY)
    req.add_header('Authorization', 'Bearer ' + KEY)
    with urllib.request.urlopen(req) as r:
        return r.read()


def main():
    products = api('products?select=*,product_images(*)&order=category.asc,name.asc')
    listed = [p for p in products if p.get('is_listed')]
    print(f'{len(products)} products in the database, {len(listed)} listed')

    os.makedirs(IMAGES, exist_ok=True)
    out, fetched, published = [], 0, []

    for p in listed:
        imgs = sorted(p.get('product_images') or [], key=lambda i: i['position'])
        if not imgs:
            # A listed product with no photo would render an empty card. The
            # admin page refuses to save that, so reaching here means the data
            # was changed another way — skip rather than publish a broken card.
            print(f'  ! {p["name"]} is listed but has no photos — skipping')
            continue

        # Read every photo's bytes BEFORE writing any of them. Reordering is a
        # swap: photo 1 moves to 2 while 2 moves to 1. Writing as we go would
        # overwrite -1.jpg before the old -1.jpg had been read for position 2,
        # and both positions would end up holding the same picture.
        rels, payloads = [], []
        for n, img in enumerate(imgs, start=1):
            rel = f'/images/products/{p["id"]}-{n}.jpg'
            rels.append(rel)
            if img.get('storage_path'):
                # Newly uploaded: pull the bytes down. Already resized to
                # 900x1200 in the browser, so nothing to do here.
                payloads.append((img['id'], rel, fetch_object(img['storage_path'])))
                fetched += 1
            elif img.get('published_path') and img['published_path'] != rel:
                src = os.path.join(HERE, img['published_path'].lstrip('/'))
                payloads.append((img['id'], rel,
                                 open(src, 'rb').read() if os.path.exists(src) else None))
            else:
                payloads.append(None)          # already in the right place

        for item in payloads:
            if not item:
                continue
            image_id, rel, data = item
            if data is None:
                print(f'  ! {p["name"]}: {rel} had no source file — left as it was')
                continue
            open(os.path.join(HERE, rel.lstrip('/')), 'wb').write(data)
            published.append((image_id, rel))

        # Photos removed in the admin leave files behind at positions that no
        # longer exist. Drop them so the repo does not grow forever.
        n = len(rels) + 1
        while os.path.exists(os.path.join(IMAGES, f'{p["id"]}-{n}.jpg')):
            os.remove(os.path.join(IMAGES, f'{p["id"]}-{n}.jpg'))
            print(f'  removed stale {p["id"]}-{n}.jpg')
            n += 1

        out.append({
            'id': p['id'],
            'name': p['name'],
            'price': f'R{p["price_cents"] / 100:.2f}',
            'category': p['category'],
            'desc': p.get('description') or '',
            'images': rels,
        })

    out.sort(key=lambda x: (x['category'], x['name']))
    with open(os.path.join(HERE, 'products.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
        fh.write('\n')

    # The backend price list, from the SAME data in the SAME pass, so the two
    # cannot drift. Unlisted products stay in it deliberately: an order placed
    # seconds before something was hidden must still be payable.
    src = open(BACKEND, encoding='utf-8').read()
    lines = '\n'.join(
        f"  '{p['id']}':{' ' * max(1, 28 - len(p['id']))}"
        f"{{ name: {json.dumps(p['name'], ensure_ascii=False)}, "
        f"priceCents: {p['price_cents']} }},"
        for p in sorted(products, key=lambda x: (x['category'], x['name'])))
    pattern = r'const PRODUCTS = \{.*?\n\};'
    if not re.search(pattern, src, flags=re.S):
        sys.exit('could not find the PRODUCTS block in the backend')
    open(BACKEND, 'w', encoding='utf-8').write(
        re.sub(pattern, 'const PRODUCTS = {\n' + lines + '\n};', src, flags=re.S))

    # Mark the fetched photos published, last — if anything above failed, the
    # rows still say "in the bucket" and the next run picks them up again.
    for image_id, rel in published:
        api(f'product_images?id=eq.{image_id}', method='PATCH',
            body={'published_path': rel, 'storage_path': None},
            headers={'Prefer': 'return=minimal'})

    print(f'wrote products.json ({len(out)} products)')
    print(f'fetched {fetched} new photo(s) from storage')
    print(f'wrote {os.path.relpath(BACKEND, HERE)} ({len(products)} products)')


if __name__ == '__main__':
    main()
