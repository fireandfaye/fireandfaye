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
    "rings":     "Handmade gemstone rings on 18K gold-plated stainless steel, made one piece at a time in South Africa.",
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
        <p class="pdp-desc">{html.escape(p["desc"])}</p>
        <button class="btn-primary pdp-add" id="pdp-add" type="button" data-id="{p['id']}">Add to Cart</button>
        <p class="pdp-note">Free shipping on orders over <span data-fee="free-min">R499</span> · Courier, 2&ndash;5 working days</p>
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
    # Empty is a fact about the data, not a name on a list. A category listed in
    # EMPTY_CATEGORIES that has since gained a product must stop saying "coming
    # soon" and stop being noindex'd, or the product is invisible to Google.
    empty = not products

    if empty:
        desc = EMPTY_CATEGORIES.get(slug, (label, f"{label} are on their way."))[1]
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

        <div class="ship-opt ship-opt-only">
          <span class="ship-opt-text">
            <span class="ship-opt-name">Shipping</span>
            <span class="ship-opt-note" id="delivery-note">Courier, 2&ndash;5 working days</span>
          </span>
          <span class="ship-opt-price" id="delivery-price"></span>
        </div>
        <p class="cart-free-ship" id="cart-free-ship" aria-live="polite"></p>

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
            <label for="c-address">Shipping address</label>
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


def account_page(nav, footer):
    """Sign in with a one-time code, then your orders. noindex — a logged-out
    visitor sees only a form, and there is nothing here to rank for."""
    return (
        head("Your Account | " + BRAND,
             "Sign in to see your fire&amp;faye orders.",
             SITE + "/account/", SITE + "/og-image.jpg", noindex=True)
        + nav + """

  <main class="account" id="account">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span class="crumb-sep">/</span><span aria-current="page">Your Account</span></nav>

    <h1 class="account-title">Your Account</h1>
    <p class="account-error" id="acc-error" hidden></p>
    <p class="account-notice" id="acc-notice" hidden></p>

    <section class="account-card" id="acc-step-email">
      <h2 class="account-heading">Sign in or create an account</h2>
      <p class="account-lead">They&rsquo;re the same thing here &mdash; enter your email and we&rsquo;ll send you a six-digit code. If you haven&rsquo;t ordered before, this creates your account. There&rsquo;s no password to remember.</p>
      <div class="cart-field">
        <label for="acc-email">Email</label>
        <input type="email" id="acc-email" autocomplete="email" placeholder="you@email.com" />
      </div>
      <button class="btn-primary account-btn" id="acc-send" type="button">Email me a code</button>
      <p class="account-muted">Orders you placed as a guest will appear here too, as long as you use the same email address.</p>
    </section>

    <section class="account-card" id="acc-step-code" hidden>
      <h2 class="account-heading">Check your email</h2>
      <p class="account-lead">We&rsquo;ve sent a six-digit code to <strong id="acc-sent-to"></strong>. It expires in 60 minutes.</p>
      <div class="cart-field">
        <label for="acc-code">Six-digit code</label>
        <input type="text" id="acc-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="000000" />
      </div>
      <button class="btn-primary account-btn" id="acc-verify" type="button">Sign in</button>
      <button class="account-link" id="acc-back" type="button">Use a different email</button>
    </section>

    <section id="acc-step-in" hidden>
      <div class="account-bar">
        <p class="account-muted">Signed in as <strong id="acc-who"></strong></p>
        <button class="account-link" id="acc-signout" type="button">Sign out</button>
      </div>

      <div class="account-tabs" role="tablist">
        <button class="account-tab active" data-tab="details" type="button" role="tab">Your details</button>
        <button class="account-tab" data-tab="orders" type="button" role="tab">Orders</button>
      </div>

      <div id="acc-panel-details">
        <section class="account-card">
          <p class="account-lead">Saved here so you don&rsquo;t retype it at checkout. Only your name is required.</p>

          <div class="cart-field">
            <label for="acc-first">First name</label>
            <input type="text" id="acc-first" autocomplete="given-name" placeholder="e.g. Naledi" />
          </div>
          <div class="cart-field">
            <label for="acc-last">Surname <span class="cart-label-opt">(optional)</span></label>
            <input type="text" id="acc-last" autocomplete="family-name" placeholder="e.g. Mokoena" />
          </div>
          <div class="cart-field">
            <label for="acc-phone">Phone <span class="cart-label-opt">(optional)</span></label>
            <input type="tel" id="acc-phone" autocomplete="tel" placeholder="082 000 0000" />
          </div>
          <div class="cart-field" id="acc-cf-address">
            <label for="acc-address">Shipping address <span class="cart-label-opt">(optional)</span></label>
            <input type="text" id="acc-address" autocomplete="off" placeholder="Start typing your street address"
                   role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="acc-addr-suggest" />
            <ul class="addr-suggest" id="acc-addr-suggest" role="listbox" hidden></ul>
            <p class="addr-status" id="acc-addr-status" aria-live="polite" hidden></p>
          </div>
          <div class="cart-field">
            <label for="acc-extra">Unit, complex or extra details <span class="cart-label-opt">(optional)</span></label>
            <input type="text" id="acc-extra" autocomplete="address-line2" placeholder="Unit 4B, Acorn Heights" />
          </div>

          <button class="btn-primary account-btn" id="acc-save" type="button">Save details</button>
          <p class="account-muted">Your email is how you sign in, so it can&rsquo;t be changed here yet.</p>
        </section>
      </div>

      <div id="acc-panel-orders" hidden>
        <div id="acc-orders"></div>
      </div>
    </section>
  </main>

"""
        + footer + "\n\n"
        + '  <script src="/products.js"></script>\n'
        + '  <script src="/app.js"></script>\n'
        + '  <script src="/account.js"></script>\n\n'
        + "</body>\n</html>\n"
    )


def admin_page(nav, footer):
    """Paige's admin: every order, every member. noindex, and deliberately not
    linked from the nav — but what actually keeps it shut is the row-level
    security policy in supabase-admin.sql, not its absence from the menu."""
    return (
        head("Admin | " + BRAND,
             "fire&amp;faye admin.",
             SITE + "/admin/", SITE + "/og-image.jpg", noindex=True)
        + nav + """

  <main class="admin" id="admin">
    <h1 class="account-title">Admin</h1>
    <p class="account-error" id="adm-error" hidden></p>
    <p class="account-notice" id="adm-notice" hidden></p>

    <section class="account-card" id="adm-step-email">
      <h2 class="account-heading">Sign in</h2>
      <p class="account-lead">Enter your email and we&rsquo;ll send you a six-digit code &mdash; the same way you sign in to your account.</p>
      <div class="cart-field">
        <label for="adm-email">Email address</label>
        <input type="email" id="adm-email" autocomplete="email" placeholder="you@example.com" />
      </div>
      <button class="btn-primary account-btn" id="adm-send" type="button">Email me a code</button>
    </section>

    <section class="account-card" id="adm-step-code" hidden>
      <h2 class="account-heading">Check your email</h2>
      <p class="account-lead">We&rsquo;ve sent a six-digit code to <strong id="adm-sent-to"></strong>. It expires in 60 minutes.</p>
      <div class="cart-field">
        <label for="adm-code">Six-digit code</label>
        <input type="text" id="adm-code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" />
      </div>
      <button class="btn-primary account-btn" id="adm-verify" type="button">Sign in</button>
      <button class="account-link" id="adm-back" type="button">Use a different email</button>
    </section>

    <section class="account-card" id="adm-denied" hidden>
      <h2 class="account-heading">No admin access</h2>
      <p class="account-lead">This account isn&rsquo;t an admin. If that&rsquo;s wrong, the account has to be added in Supabase &mdash; it can&rsquo;t be granted from this page.</p>
      <p class="account-muted"><a class="account-link" href="/account/">Go to your account</a></p>
    </section>

    <section id="adm-step-in" hidden>
      <div class="account-bar">
        <p class="account-muted">Signed in as <strong id="adm-who"></strong></p>
        <button class="account-link" id="adm-signout" type="button">Sign out</button>
      </div>

      <div class="account-tabs" role="tablist">
        <button class="account-tab admin-tab active" data-tab="products" type="button">Products</button>
        <button class="account-tab admin-tab" data-tab="orders" type="button">Orders</button>
        <button class="account-tab admin-tab" data-tab="members" type="button">Members</button>
      </div>

      <div id="adm-panel-products">
        <div class="admin-filters">
          <select id="adm-prod-cat" aria-label="Filter by category">
            <option value="all">All categories</option>
            <option value="necklaces">Necklaces</option>
            <option value="earrings">Earrings</option>
            <option value="bracelets">Bracelets</option>
            <option value="rings">Rings</option>
          </select>
          <input type="search" id="adm-prod-search" placeholder="Search products" aria-label="Search products" />
        </div>
        <p class="admin-summary" id="adm-prod-summary"></p>
        <div id="adm-products"></div>

        <!-- The editor replaces the list rather than sitting beside it: on a
             phone there is no room for both, and Paige edits one at a time. -->
        <div id="adm-editor" hidden>
          <button class="account-link" id="adm-edit-back" type="button">&larr; All products</button>
          <h2 class="account-heading" id="adm-edit-title"></h2>

          <div class="cart-field">
            <label for="adm-f-name">Product name</label>
            <input type="text" id="adm-f-name" />
          </div>
          <div class="admin-field-row">
            <div class="cart-field">
              <label for="adm-f-cat">Category</label>
              <select id="adm-f-cat">
                <option value="necklaces">Necklaces</option>
                <option value="earrings">Earrings</option>
                <option value="bracelets">Bracelets</option>
                <option value="rings">Rings</option>
              </select>
            </div>
            <div class="cart-field">
              <label for="adm-f-price">Price (R)</label>
              <input type="text" id="adm-f-price" inputmode="decimal" placeholder="259.00" />
            </div>
            <div class="cart-field">
              <label for="adm-f-qty">Quantity you can make <span class="cart-label-opt">(optional)</span></label>
              <input type="text" id="adm-f-qty" inputmode="numeric" placeholder="3" />
            </div>
          </div>
          <div class="cart-field">
            <label for="adm-f-desc">Description</label>
            <textarea id="adm-f-desc" rows="10"></textarea>
            <p class="account-muted">First line: the stones and what they mean, separated by &bull;. Then a blank line, the description, another blank line, and a line starting <strong>Details:</strong> with the materials.</p>
          </div>

          <h3 class="admin-subheading">Photos</h3>
          <p class="account-muted">The first photo is the one shown on the category page. Drag is not supported yet &mdash; use the arrows.</p>
          <div id="adm-photos" class="admin-photos"></div>
          <label class="account-link admin-upload" for="adm-f-photo">+ Add photos</label>
          <input type="file" id="adm-f-photo" accept="image/*" multiple hidden />
          <p class="admin-summary" id="adm-photo-status"></p>

          <label class="admin-check">
            <input type="checkbox" id="adm-f-listed" /> Show this product on the site
          </label>

          <button class="btn-primary account-btn" id="adm-save" type="button">Save and publish</button>
          <p class="account-muted" id="adm-save-status"></p>
        </div>
      </div>

      <div id="adm-panel-orders">
        <div class="admin-filters">
          <select id="adm-status" aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input type="search" id="adm-search" placeholder="Search name, email or item" aria-label="Search orders" />
        </div>
        <p class="admin-summary" id="adm-orders-summary"></p>
        <div id="adm-orders"></div>
      </div>

      <div id="adm-panel-members" hidden>
        <p class="admin-summary" id="adm-members-summary"></p>
        <div id="adm-members"></div>
      </div>
    </section>
  </main>

"""
        + footer + "\n\n"
        + '  <script src="/products.js"></script>\n'
        + '  <script src="/app.js"></script>\n'
        + '  <script src="/admin.js"></script>\n\n'
        + "</body>\n</html>\n"
    )


def sitemap(products):
    today = date.today().isoformat()
    urls = [(SITE + "/", "1.0")]
    # Driven by the products, so a newly populated category is never left out.
    # Empty categories stay out: they are noindex'd, and a sitemap entry for a
    # noindex page is a contradiction Search Console reports as an error.
    cats = dict.fromkeys(p["category"] for p in products)
    urls += [(f"{SITE}/{c}/", "0.8") for c in cats]
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

    # dict.fromkeys, not a list concat: a category that is both populated and
    # listed as empty would otherwise be built twice, the placeholder landing
    # second and overwriting the real page.
    for slug in dict.fromkeys(list(by_cat) + list(EMPTY_CATEGORIES)):
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

    os.makedirs("account", exist_ok=True)
    open("account/index.html", "w", encoding="utf-8").write(account_page(nav, footer))
    written.append("account/index.html")

    # Not in the sitemap and noindex'd: it is Paige's, not a page to rank.
    os.makedirs("admin", exist_ok=True)
    open("admin/index.html", "w", encoding="utf-8").write(admin_page(nav, footer))
    written.append("admin/index.html")

    open("sitemap.xml", "w", encoding="utf-8").write(sitemap(products))
    written.append("sitemap.xml")

    print(f"products.js   {len(products)} products")
    for path in written:
        print(f"  {os.path.getsize(path):>7,} B  {path}")
    print(f"\n{len(written)} files written.")


if __name__ == "__main__":
    main()
