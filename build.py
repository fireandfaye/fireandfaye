#!/usr/bin/env python3
"""
build.py — generates the static product and category pages.

    python3 build.py

`products.json` is the source of truth for product data. The shared chrome —
nav, footer, cart drawer — is lifted straight out of `index.html` so there is
only ever one copy of it: edit the nav on the homepage and every generated page
picks the change up on the next build.

Writes:
    products.js                     the product data, for the browser
    <category>/index.html           one per category
    <category>/<slug>/index.html    one per product
    sitemap.xml

Nothing runs at request time. GitHub Pages serves the output as plain files.
"""

import html
import json
import os
import re
import shutil
from datetime import date

SITE = "https://fireandfaye.co.za"
BRAND = "fire&amp;faye"

# Categories with no products yet. They still get a page so the nav never 404s,
# but they are noindex'd — a thin "coming soon" page in the index helps nobody.
EMPTY_CATEGORIES = {
    "rings": ("Rings", "Rings are being handcrafted — follow @fireandfaye to be the first to know when they drop."),
    # Unused for now — uncomment to bring the sale page back.
    # "sale":  ("Last Season Sale", "Nothing in the sale right now. Follow @fireandfaye to hear when pieces go in."),
}

CATEGORY_LABELS = {
    "necklaces": "Necklaces",
    "earrings":  "Earrings",
    "bracelets": "Bracelets",
    **{k: v[0] for k, v in EMPTY_CATEGORIES.items()},
}

CATEGORY_BLURB = {
    "necklaces": "Handmade gemstone necklaces on 18K gold-plated stainless steel, made one piece at a time in South Africa.",
    "earrings":  "Handmade gemstone earrings on 18K gold-plated stainless steel, made one piece at a time in South Africa.",
    "bracelets": "Handmade gemstone bracelets on 18K gold-plated stainless steel, made one piece at a time in South Africa.",
}


# ── reading the shared chrome out of index.html ──────────────────────────────

def block(src, start, end, name):
    """The text from `start` up to and including `end`."""
    i = src.index(start)
    j = src.index(end, i) + len(end)
    return src[i:j]


def load_chrome():
    src = open("index.html", encoding="utf-8").read()
    nav = block(src, "  <nav>", "</nav>", "nav")
    footer = block(src, "  <footer>", "</footer>", "footer")
    return nav, footer


# ── page assembly ────────────────────────────────────────────────────────────

def head(title, description, canonical, og_image, extra="", noindex=False):
    robots = '\n  <meta name="robots" content="noindex, follow" />' if noindex else ""
    return f"""<!DOCTYPE html>
<html lang="en-ZA">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>{title}</title>
  <meta name="description" content="{description}" />
  <link rel="canonical" href="{canonical}" />
  <meta name="theme-color" content="#F7F4EF" />{robots}

  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="{BRAND}." />
  <meta property="og:locale" content="en_ZA" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{description}" />
  <meta property="og:image" content="{og_image}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{description}" />
  <meta name="twitter:image" content="{og_image}" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400;1,500&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet" />
{extra}
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
"""


def crumbs(trail):
    """trail: [(label, href or None)] — the last entry is the current page."""
    items = []
    for i, (label, href) in enumerate(trail):
        if href:
            items.append(f'<a href="{href}">{html.escape(label)}</a>')
        else:
            items.append(f'<span aria-current="page">{html.escape(label)}</span>')
    inner = '<span class="crumb-sep">/</span>'.join(items)
    ld = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": label,
             **({"item": SITE + href} if href else {})}
            for i, (label, href) in enumerate(trail)
        ],
    }
    return (f'  <nav class="breadcrumb" aria-label="Breadcrumb">{inner}</nav>\n'
            f'  <script type="application/ld+json">{json.dumps(ld)}</script>\n')


def jpeg_size(path):
    """(width, height) from a JPEG's SOF marker. Returns None if it can't tell."""
    try:
        with open(path, "rb") as f:
            if f.read(2) != b"\xff\xd8":
                return None
            while True:
                b = f.read(1)
                while b and b != b"\xff":
                    b = f.read(1)
                while b == b"\xff":
                    b = f.read(1)
                if not b:
                    return None
                marker = b[0]
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    f.read(3)
                    h = int.from_bytes(f.read(2), "big")
                    w = int.from_bytes(f.read(2), "big")
                    return w, h
                length = int.from_bytes(f.read(2), "big")
                f.seek(length - 2, 1)
    except Exception:
        return None


def dims(src):
    """The width/height attributes for an image path like /images/foo.jpg."""
    wh = jpeg_size(src.lstrip("/"))
    return f' width="{wh[0]}" height="{wh[1]}"' if wh else ""


def card(p):
    """A product card — a real anchor, so crawlers follow it and it can be shared."""
    href = f"/{p['category']}/{p['id']}/"
    return f"""        <a class="card" href="{href}">
          <div class="card-corner"></div>
          <div class="card-photo-wrap">
            <img class="card-photo" src="{p['images'][0]}" alt="{html.escape(p['name'])}"{dims(p['images'][0])} loading="lazy" decoding="async" />
          </div>
          <div class="card-info">
            <div class="card-name">{html.escape(p['name'])}</div>
            <div class="card-price">{p['price']}</div>
            <div class="card-view-hint">View Details</div>
          </div>
        </a>"""


def product_page(p, nav, footer):
    label = CATEGORY_LABELS[p["category"]]
    url = f"{SITE}/{p['category']}/{p['id']}/"
    desc_short = re.sub(r"\s+", " ", p["desc"]).strip()
    meta_desc = html.escape(desc_short[:155].rsplit(" ", 1)[0] + "…")
    cents = round(float(re.sub(r"[^0-9.]", "", p["price"])) * 100)

    ld = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": p["name"],
        "image": [SITE + i for i in p["images"]],
        "description": desc_short,
        "sku": p["id"],
        "brand": {"@type": "Brand", "name": "fire&faye"},
        "offers": {
            "@type": "Offer",
            "url": url,
            "priceCurrency": "ZAR",
            "price": f"{cents / 100:.2f}",
            "availability": "https://schema.org/InStock",
            "itemCondition": "https://schema.org/NewCondition",
            "shippingDetails": {
                "@type": "OfferShippingDetails",
                "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "ZA"},
            },
        },
    }
    extra = f'  <script type="application/ld+json">\n{json.dumps(ld, indent=2, ensure_ascii=False)}\n  </script>\n'

    arrows = ""
    if len(p["images"]) > 1:
        arrows = (
            '        <button class="pdp-nav pdp-nav-prev" id="pdp-prev" type="button" aria-label="Previous image">&#8249;</button>\n'
            '        <button class="pdp-nav pdp-nav-next" id="pdp-next" type="button" aria-label="Next image">&#8250;</button>\n'
        )

    thumbs = ""
    if len(p["images"]) > 1:
        buttons = "\n".join(
            f'        <button class="pdp-thumb{" active" if i == 0 else ""}" type="button" data-index="{i}" aria-label="View image {i + 1}">'
            f'<img src="{src}" alt=""{dims(src)} loading="lazy" decoding="async" /></button>'
            for i, src in enumerate(p["images"])
        )
        thumbs = f'      <div class="pdp-thumbs">\n{buttons}\n      </div>\n'

    gallery_json = html.escape(json.dumps(p["images"]), quote=True)

    return (
        head(f"{html.escape(p['name'])} | {BRAND}", meta_desc, url,
             SITE + p["images"][0], extra)
        + nav + "\n\n"
        + '  <main class="pdp">\n'
        + crumbs([("Home", "/"), (label, f"/{p['category']}/"), (p["name"], None)])
        + f"""
    <div class="pdp-grid" data-gallery="{gallery_json}">
      <div class="pdp-media">
        <div class="pdp-photo-wrap">
          <img class="pdp-photo" id="pdp-photo" src="{p['images'][0]}" alt="{html.escape(p['name'])}"{dims(p['images'][0])} decoding="async" />
{arrows}        </div>
{thumbs}      </div>

      <div class="pdp-detail">
        <p class="pdp-eyebrow"><a href="/{p['category']}/">{label}</a></p>
        <h1 class="pdp-name">{html.escape(p['name'])}</h1>
        <p class="pdp-price">{p['price']}</p>
        <p class="pdp-desc">{html.escape(desc_short)}</p>
        <button class="btn-primary pdp-add" id="pdp-add" type="button" data-id="{p['id']}">Add to Cart</button>
        <p class="pdp-note">Free delivery on orders over <span data-fee="free-min">R399</span> · Courier, 2&ndash;5 working days</p>
      </div>
    </div>
  </main>

"""
        + footer + "\n\n"
        + '  <script src="/products.js"></script>\n'
        + '  <script src="/app.js"></script>\n'
        + '  <script src="/product.js"></script>\n\n'
        + "</body>\n</html>\n"
    )


def category_page(slug, products, nav, footer):
    label = CATEGORY_LABELS[slug]
    url = f"{SITE}/{slug}/"
    empty = slug in EMPTY_CATEGORIES

    if empty:
        desc = EMPTY_CATEGORIES[slug][1]
        body = f'      <div class="grid-empty"><h3>Coming Soon</h3><p>{html.escape(desc)}</p></div>'
        extra = ""
    else:
        desc = CATEGORY_BLURB[slug]
        body = "\n".join(card(p) for p in products)
        ld = {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": f"{label} | fire&faye",
            "url": url,
            "mainEntity": {
                "@type": "ItemList",
                "itemListElement": [
                    {"@type": "ListItem", "position": i + 1,
                     "url": f"{SITE}/{p['category']}/{p['id']}/", "name": p["name"]}
                    for i, p in enumerate(products)
                ],
            },
        }
        extra = f'  <script type="application/ld+json">\n{json.dumps(ld, indent=2, ensure_ascii=False)}\n  </script>\n'

    og = SITE + (products[0]["images"][0] if products else "/og-image.jpg")

    return (
        head(f"{label} | {BRAND}", html.escape(desc), url, og, extra, noindex=empty)
        + nav + "\n\n"
        + '  <main class="category">\n'
        + crumbs([("Home", "/"), (label, None)])
        + f"""
    <div class="collection-header">
      <h1>{label}</h1>
      <p>{html.escape(desc)}</p>
    </div>

    <div class="grid">
{body}
    </div>
  </main>

"""
        + footer + "\n\n"
        + '  <script src="/products.js"></script>\n'
        + '  <script src="/app.js"></script>\n\n'
        + "</body>\n</html>\n"
    )


def cart_page(nav, footer):
    """The cart is a page now, not a drawer. The element ids match what app.js
    already looks for, so the cart and checkout logic is unchanged."""
    return (
        head("Your Cart | " + BRAND,
             "Your fire&amp;faye cart.", SITE + "/cart/", SITE + "/og-image.jpg",
             noindex=True)
        + nav + """

  <main class="cart-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span class="crumb-sep">/</span><span aria-current="page">Your Cart</span></nav>

    <h1 class="cart-page-title">Your Cart</h1>

    <div class="cart-empty" id="cart-empty">
      <p>Your cart is empty.<br />Browse the collection to add a piece.</p>
      <a class="btn-primary" href="/#collection">Browse the collection</a>
    </div>

    <div class="cart-page-grid">
      <div class="cart-page-main" id="cart-checkout" hidden>
        <div id="cart-lines"></div>

        <div class="cart-section-label">Delivery</div>
        <p class="cart-free-ship" id="cart-free-ship" aria-live="polite"></p>
        <label class="ship-opt">
          <input type="radio" name="shipping" value="delivery" checked />
          <span class="ship-opt-text">
            <span class="ship-opt-name">Delivery</span>
            <span class="ship-opt-note" id="delivery-note">Courier, 2&ndash;5 working days</span>
          </span>
          <span class="ship-opt-price" id="delivery-price"></span>
        </label>

        <div class="cart-section-label">Your details</div>
        <div class="cart-field" id="cf-name">
          <label for="c-name">Full name</label>
          <input type="text" id="c-name" autocomplete="name" placeholder="e.g. Naledi Mokoena" />
        </div>
        <div class="cart-field" id="cf-email">
          <label for="c-email">Email</label>
          <input type="email" id="c-email" autocomplete="email" placeholder="you@email.com" />
        </div>
        <div class="cart-field" id="cf-phone">
          <label for="c-phone">Phone</label>
          <input type="tel" id="c-phone" autocomplete="tel" placeholder="082 000 0000" />
        </div>
        <div id="cf-address-group">
          <div class="cart-field" id="cf-address">
            <label for="c-address">Delivery address</label>
            <input type="text" id="c-address" autocomplete="off" placeholder="Start typing your street address"
                   role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="addr-suggest" />
            <ul class="addr-suggest" id="addr-suggest" role="listbox" hidden></ul>
            <p class="addr-status" id="addr-status" aria-live="polite" hidden></p>
          </div>
          <div class="cart-field" id="cf-address2">
            <label for="c-address2">Unit, complex or extra details <span class="cart-label-opt">(optional)</span></label>
            <input type="text" id="c-address2" autocomplete="address-line2" placeholder="Unit 4B, Acorn Heights" />
          </div>
        </div>
        <div class="cart-field" id="cf-note">
          <label for="c-note">Order note (optional)</label>
          <textarea id="c-note" placeholder="Gift wrapping, a message, anything we should know"></textarea>
        </div>
      </div>

      <aside class="cart-foot" id="cart-foot" hidden>
        <div class="cart-total-row"><span>Subtotal</span><span id="cart-subtotal">R0.00</span></div>
        <div class="cart-total-row"><span>Shipping</span><span id="cart-shipping">R0.00</span></div>
        <div class="cart-total-row grand"><span>Total</span><span id="cart-total">R0.00</span></div>
        <button class="cart-pay" id="cart-pay" type="button">Pay with Yoco</button>
        <p class="cart-error" id="cart-error" hidden></p>
        <p class="cart-secure-note">Card details are entered on Yoco&rsquo;s secure payment page, never on this site.</p>
      </aside>
    </div>
  </main>

"""
        + footer + "\n\n"
        + '  <script src="/products.js"></script>\n'
        + '  <script src="/app.js"></script>\n\n'
        + "</body>\n</html>\n"
    )


def sitemap(products):
    today = date.today().isoformat()
    urls = [(SITE + "/", "1.0")]
    urls += [(f"{SITE}/{c}/", "0.8") for c in ("necklaces", "earrings", "bracelets")]
    urls += [(f"{SITE}/{p['category']}/{p['id']}/", "0.7") for p in products]
    body = "\n".join(
        f"  <url>\n    <loc>{u}</loc>\n    <lastmod>{today}</lastmod>\n"
        f"    <priority>{pri}</priority>\n  </url>"
        for u, pri in urls
    )
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{body}\n</urlset>\n'


def main():
    products = json.load(open("products.json", encoding="utf-8"))
    nav, footer = load_chrome()

    # the browser's copy of the data
    with open("products.js", "w", encoding="utf-8") as f:
        f.write("// Generated by build.py from products.json — do not edit by hand.\n")
        f.write("const PRODUCTS = " + json.dumps(products, indent=2, ensure_ascii=False) + ";\n")

    written = []
    by_cat = {}
    for p in products:
        by_cat.setdefault(p["category"], []).append(p)

    for slug in list(by_cat) + list(EMPTY_CATEGORIES):
        items = by_cat.get(slug, [])
        os.makedirs(slug, exist_ok=True)
        path = f"{slug}/index.html"
        open(path, "w", encoding="utf-8").write(category_page(slug, items, nav, footer))
        written.append(path)

        for p in items:
            os.makedirs(f"{slug}/{p['id']}", exist_ok=True)
            path = f"{slug}/{p['id']}/index.html"
            open(path, "w", encoding="utf-8").write(product_page(p, nav, footer))
            written.append(path)

    os.makedirs("cart", exist_ok=True)
    open("cart/index.html", "w", encoding="utf-8").write(cart_page(nav, footer))
    written.append("cart/index.html")

    open("sitemap.xml", "w", encoding="utf-8").write(sitemap(products))
    written.append("sitemap.xml")

    print(f"products.js   {len(products)} products")
    for path in written:
        print(f"  {os.path.getsize(path):>7,} B  {path}")
    print(f"\n{len(written)} files written.")


if __name__ == "__main__":
    main()
