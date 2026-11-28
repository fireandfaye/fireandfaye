// Shared across every page: cart, checkout, delivery address, nav.
// Loads after products.js, which defines PRODUCTS.

// Product text comes from the admin page, so it is escaped before it goes into
// innerHTML. Global on purpose: home.js loads after this file and uses it too.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

    // ── Scroll reveal ────────────────────────────
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    // ── Nav "Shop" dropdown ────────────────────────
    // The menu entries are real links to the category pages now, so they are
    // left to navigate on their own — this only opens and closes the menu.
    const shopDropdown = document.getElementById('shop-dropdown');
    const shopDropdownTrigger = document.getElementById('shop-dropdown-trigger');
    shopDropdownTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = shopDropdown.classList.toggle('open');
      shopDropdownTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!shopDropdown.contains(e.target)) {
        shopDropdown.classList.remove('open');
        shopDropdownTrigger.setAttribute('aria-expanded', 'false');
      }
    });

    // ── Mobile menu ────────────────────────────────
    // Below 680px the links collapse behind the burger. The panel is the same
    // <ul> as the desktop nav, so there is only one set of links.
    const navEl = document.querySelector('body > nav');
    const navBurger = document.getElementById('nav-burger');
    if (navEl && navBurger) {
      function setMenu(open) {
        navEl.classList.toggle('menu-open', open);
        navBurger.setAttribute('aria-expanded', open ? 'true' : 'false');
        navBurger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        if (!open) {
          shopDropdown.classList.remove('open');
          shopDropdownTrigger.setAttribute('aria-expanded', 'false');
        }
      }
      navBurger.addEventListener('click', (e) => {
        e.stopPropagation();
        setMenu(!navEl.classList.contains('menu-open'));
      });
      document.addEventListener('click', (e) => {
        if (!navEl.contains(e.target)) setMenu(false);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setMenu(false);
      });
      // Following a link should leave the panel closed behind it.
      document.querySelectorAll('#nav-links a').forEach(a => {
        a.addEventListener('click', () => setMenu(false));
      });
    }

    // ── Supabase session, shared ───────────────────
    // Lives here rather than in account.js because the cart needs it too, to
    // prefill a signed-in customer's details. One session implementation.
    //
    // The publishable key is meant to be in page source; what protects the
    // data is the row-level security policy, not the key.
    const SUPABASE_URL = 'https://wscfombaipghblbudeyp.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_v2UNHfrEEbCL13GhshgQuQ_rmG0Xj9k';
    const SESSION_KEY  = 'ff_session';

    // localStorage throws in private mode and with site data blocked, so every
    // access is guarded — a page must still work, just signed out.
    function loadSession() {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
    }
    function saveSession(s) {
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
    }
    function clearSession() {
      try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    }

    // The user id is in the access token's `sub` claim. Reading it from there
    // rather than from stored state means a session saved by an older version
    // of the site still works.
    function userIdOf(session) {
      if (session && session.user_id) return session.user_id;
      try {
        const payload = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(payload + '==='.slice((payload.length + 3) % 4))).sub || null;
      } catch (e) { return null; }
    }

    async function supaAuth(path, body) {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.msg || data.error_description || data.message || 'Something went wrong.');
      return data;
    }

    // ── Cloudflare Turnstile (security session 11) ──
    // A bot check on the four public forms: checkout, enquiry, and "Email me a
    // code" on /account/ and /admin/. A per-IP rate limit cannot stop a script
    // spread over many addresses; this can. The site key is public. Its secret
    // is in Vercel (TURNSTILE_SECRET_KEY, checked by create-yoco-checkout and
    // enquiry) and in Supabase Auth's CAPTCHA setting (checked on sign-in).
    // A page opts in with <div class="turnstile-box" id="..." data-turnstile="action">.
    // The widget only shows itself if Cloudflare wants the visitor to click.
    const TURNSTILE_SITE_KEY = '__TURNSTILE_SITE_KEY__';
    const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
    const TURNSTILE_WAIT_MS = 20000;
    const TURNSTILE_MISSING = "We couldn't run the security check. Please wait a moment and try again. If you use an ad or script blocker, allow challenges.cloudflare.com for this site.";
    const turnstileWidgets = {};   // box id -> Turnstile widget id
    let turnstileLoading = null;

    function loadTurnstile() {
      if (!turnstileLoading) {
        turnstileLoading = new Promise((resolve, reject) => {
          window.onTurnstileLoad = () => resolve(window.turnstile);
          const s = document.createElement('script');
          s.src = TURNSTILE_SCRIPT;
          s.async = true;
          s.onerror = () => reject(new Error('Turnstile did not load'));
          document.head.appendChild(s);
        });
        turnstileLoading.catch((err) => console.error(err.message));
      }
      return turnstileLoading;
    }

    function mountTurnstile() {
      const boxes = document.querySelectorAll('[data-turnstile]');
      if (!boxes.length) return;
      loadTurnstile().then((ts) => {
        boxes.forEach((box) => {
          turnstileWidgets[box.id] = ts.render(box, {
            sitekey: TURNSTILE_SITE_KEY,
            action: box.dataset.turnstile,
            appearance: 'interaction-only',
            theme: 'light',
            size: 'flexible',
          });
        });
      }).catch(() => {});
    }

    // The token for one box, or '' if there is none in time (script blocked,
    // or a challenge not passed). Each token works once: call resetTurnstile
    // after every attempt that sent it, whatever the answer.
    async function turnstileToken(boxId) {
      try { await loadTurnstile(); } catch (e) { return ''; }
      const id = turnstileWidgets[boxId];
      if (id === undefined) return '';
      for (let waited = 0; waited < TURNSTILE_WAIT_MS; waited += 250) {
        const token = window.turnstile.getResponse(id);
        if (token) return token;
        await new Promise((r) => setTimeout(r, 250));
      }
      return '';
    }

    function resetTurnstile(boxId) {
      const id = turnstileWidgets[boxId];
      if (window.turnstile && id !== undefined) window.turnstile.reset(id);
    }

    mountTurnstile();

    async function refreshSession(s) {
      const d = await supaAuth('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
      const next = { access_token: d.access_token, refresh_token: d.refresh_token,
                     email: s.email, user_id: s.user_id || (d.user && d.user.id) };
      saveSession(next);
      return next;
    }

    // Sign-out ends the session on Supabase too, not only in this browser.
    // Clearing localStorage alone leaves the refresh token working for anyone
    // who copied it. An access token over an hour old is refused, so renew it
    // once and try again. Whatever happens, this browser ends up signed out:
    // offline, or a session already ended, leaves nothing more to do here.
    // scope=local ends only this sign-in: signing out on a phone leaves the
    // same person's laptop signed in.
    async function signOut() {
      const s = loadSession();
      const logout = (token) => fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      });
      try {
        if (s && s.access_token) {
          const r = await logout(s.access_token);
          if ((r.status === 401 || r.status === 403) && s.refresh_token) {
            await logout((await refreshSession(s)).access_token);
          }
        }
      } catch (e) {
        console.warn('Sign-out could not reach Supabase:', e);
      } finally {
        clearSession();
      }
    }

    // One retry after refreshing. The retry cannot itself retry, or a
    // persistently rejecting endpoint would recurse forever.
    async function supaApi(session, path, opts = {}, allowRetry = true) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...opts,
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          ...(opts.headers || {}),
        },
      });
      if (r.status === 401 && allowRetry && session.refresh_token) {
        return supaApi(await refreshSession(session), path, opts, false);
      }
      if (!r.ok) throw new Error(await r.text());
      const text = await r.text();
      return text ? JSON.parse(text) : null;
    }

    // ── Cart ──────────────────────────────────────
    // Prices shown here are for display only. The real total is recalculated
    // server-side in create-yoco-checkout from products.js, so editing these
    // numbers in the browser changes nothing about what gets charged.
    const CHECKOUT_ENDPOINT = 'https://fireandfaye-yoco-backend.vercel.app/api/create-yoco-checkout';
    const CONFIRM_ENDPOINT  = 'https://fireandfaye-yoco-backend.vercel.app/api/confirm-order';
    const PENDING_KEY = 'ff-pending-checkout';
    // When that id was saved. A separate key, so the id's own format is unchanged.
    const PENDING_AT_KEY = 'ff-pending-checkout-at';
    // After this an id still stored is dropped unasked: by then the backend's
    // own pass over unpaid orders has settled it.
    const PENDING_MAX_AGE_MS = 2 * 60 * 60 * 1000;
    // Waits between asking "was it paid?" again: eight tries over two minutes.
    const CONFIRM_RETRY_MS = [2000, 4000, 8000, 15000, 30000, 30000, 30000];
    // Our own reference for a checkout, carried on the return URL from Yoco.
    const CHECKOUT_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // Shipping fee. Keep in step with SHIPPING_CENTS and FREE_SHIPPING_MIN_CENTS
    // in the backend's products.js: these are only what the customer is shown,
    // the backend's values are what gets charged. One flat fee anywhere in SA;
    // the Google address is still required, but only so the courier gets a
    // real address — it no longer changes the price.
    const SHIPPING_CENTS = 8500;
    const FREE_SHIPPING_MIN_CENTS = 49900;
    const shippingCentsFor = (sub) => sub >= FREE_SHIPPING_MIN_CENTS ? 0 : SHIPPING_CENTS;
    const FEE_TEXT = {
      'shipping': SHIPPING_CENTS,
      'free-min': FREE_SHIPPING_MIN_CENTS,
    };
    document.querySelectorAll('[data-fee]').forEach(el => {
      el.textContent = 'R' + FEE_TEXT[el.getAttribute('data-fee')] / 100;
    });
    // Set once an address is picked from Google's suggestions (see the address section).
    let deliveryAddress = null;   // { placeId, formattedAddress, province, hasStreetNumber }
    const CART_KEY = 'ff-cart-v1';
    const MAX_QTY = 20;
    let stockMap = null;      // live stock, see the Stock section; null until loaded

    const rands = (cents) => 'R' + (cents / 100).toFixed(2);
    const productById = (id) => PRODUCTS.find(p => p.id === id);
    const centsOf = (p) => Math.round(parseFloat(p.price.replace(/[^0-9.]/g, '')) * 100);

    function loadCart() {
      // localStorage throws in private mode / with site data blocked.
      try {
        const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
        if (!Array.isArray(raw)) return [];
        return raw
          .filter(l => l && typeof l.id === 'string' && productById(l.id))
          .map(l => ({
            id: l.id,
            qty: Math.min(MAX_QTY, Math.max(1, parseInt(l.qty, 10) || 1)),
          }));
      } catch (e) {
        return [];
      }
    }

    function saveCart() {
      try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
    }

    let cart = loadCart();

    const cartLines     = document.getElementById('cart-lines');
    const cartEmpty     = document.getElementById('cart-empty');
    const cartCheckout  = document.getElementById('cart-checkout');
    const cartFoot      = document.getElementById('cart-foot');
    const cartCountEl   = document.getElementById('cart-count');
    const cartToggle    = document.getElementById('nav-cart-toggle');
    const cartPayBtn    = document.getElementById('cart-pay');
    const cartErrorEl   = document.getElementById('cart-error');

    const cartCount    = () => cart.reduce((n, l) => n + l.qty, 0);
    const subtotalCents = () => cart.reduce((n, l) => n + centsOf(productById(l.id)) * l.qty, 0);
    // Delivery is the only method since collection was removed, so there is
    // nothing to read. Still sent to the backend, which validates it — if
    // collection ever returns, this goes back to reading the chosen option.
    const shippingMethod = () => 'delivery';

    function addToCart(id, qty) {
      const line = cart.find(l => l.id === id);
      if (line) {
        line.qty = Math.min(maxQtyFor(id), line.qty + (qty || 1));
      } else {
        cart.push({ id, qty: Math.min(maxQtyFor(id), qty || 1) });
      }
      saveCart();
      renderCart();
    }

    function setQty(id, qty) {
      const line = cart.find(l => l.id === id);
      if (!line) return;
      if (qty <= 0) return removeFromCart(id);
      line.qty = Math.min(maxQtyFor(id), qty);
      saveCart();
      renderCart();
    }

    function removeFromCart(id) {
      cart = cart.filter(l => l.id !== id);
      saveCart();
      renderCart();
    }

    function renderCart() {
      const count = cartCount();
      cartCountEl.textContent = count;
      cartCountEl.hidden = count === 0;
      cartToggle.setAttribute('aria-label', count ? `Your cart, ${count} item${count === 1 ? '' : 's'}` : 'Your cart, empty');

      // Every page carries the nav badge; only /cart/ has the rest.
      if (!cartLines) return;

      // An empty cart page is not worth looking at — the nav shows a popover
      // instead, and anyone who lands here directly goes back to the shop.
      if (!cart.length) { location.replace('/'); return; }

      const hasItems = cart.length > 0;
      cartEmpty.hidden = hasItems;
      cartCheckout.hidden = !hasItems;
      cartFoot.hidden = !hasItems;

      cartLines.innerHTML = '';
      cart.forEach(line => {
        const p = productById(line.id);
        if (!p) return;
        const row = document.createElement('div');
        row.className = 'cart-line';
        row.innerHTML = `
          <a class="cart-thumb-link" href="/${p.category}/${p.id}/" aria-label="${escapeHtml(p.name)}">
            <img class="cart-thumb" src="${escapeHtml(p.images[0])}" alt="" />
          </a>
          <div>
            <a class="cart-line-name" href="/${p.category}/${p.id}/">${escapeHtml(p.name)}</a>
            <div class="cart-line-price">${p.price} each</div>
            ${cartStockNote(line)}
            <div class="qty">
              <button type="button" data-act="dec" aria-label="Decrease quantity">&minus;</button>
              <span>${line.qty}</span>
              <button type="button" data-act="inc" aria-label="Increase quantity" ${line.qty >= maxQtyFor(line.id) ? 'disabled' : ''}>+</button>
            </div>
          </div>
          <div class="cart-line-right">
            <div class="cart-line-total">${rands(centsOf(p) * line.qty)}</div>
            <button class="cart-remove" type="button" data-act="remove">Remove</button>
          </div>
        `;
        row.querySelectorAll('[data-act]').forEach(btn => {
          btn.addEventListener('click', () => {
            const act = btn.getAttribute('data-act');
            if (act === 'inc') setQty(line.id, line.qty + 1);
            else if (act === 'dec') setQty(line.id, line.qty - 1);
            else removeFromCart(line.id);
          });
        });
        cartLines.appendChild(row);
      });

      updateTotals();
    }

    function updateTotals() {
      if (!cartLines) return;
      const sub = subtotalCents();
      const ship = shippingCentsFor(sub);
      const freeShip = ship === 0;

      document.getElementById('delivery-price').innerHTML = freeShip
        ? `<s>${rands(SHIPPING_CENTS)}</s>Free`
        : rands(SHIPPING_CENTS);

      const freeShipEl = document.getElementById('cart-free-ship');
      freeShipEl.classList.toggle('applied', freeShip);
      if (!freeShip) {
        freeShipEl.textContent = `Add ${rands(FREE_SHIPPING_MIN_CENTS - sub)} more for free shipping`;
      } else {
        freeShipEl.textContent = '\u2726 Free shipping applied to your order';
      }

      document.getElementById('cart-subtotal').textContent = rands(sub);
      document.getElementById('cart-shipping').textContent = freeShip ? 'Free' : rands(ship);
      document.getElementById('cart-total').textContent = rands(sub + ship);

      if (deliveryAddress && cartAddress) {
        cartAddress.setStatus('\u2713 Address found' + (deliveryAddress.hasStreetNumber
          ? '' : '. No street number found \u2014 please add it in the line below.'));
      }
    }

    if (cartLines) document.getElementById('delivery-note').textContent =
      'Courier, 2\u20135 working days, anywhere in South Africa';

    // ── Address autocomplete (Google Places) ──────
    // The customer picks their address from Google's suggestions, so the
    // courier always gets a real, complete address (the fee is flat and does
    // not depend on it). Only the place id is sent to the backend, which looks
    // the address up again itself before creating the order.
    //
    // Built as a factory because two pages need it: the cart, and the details
    // form on /account/. One implementation, so a fix to the address handling
    // cannot land in one place and not the other.
    //
    // Browser key: public by design. In Google Cloud it must be restricted to
    // the site's domains (HTTP referrers) and to the Maps JavaScript API and
    // Places API (New). The backend uses a separate server key.
    const GOOGLE_MAPS_BROWSER_KEY = 'AIzaSyC4WvXz0YYwlJuXWCD1_O7XETTywTDmo9M';
    const LOOKUP_DOWN = 'Address lookup is unavailable right now. Please try again later, or send us an enquiry below.';

    let placesLoading = null;
    const placesFailed = [];          // fields to tell if Google refuses us

    function loadPlaces() {
      if (placesLoading) return placesLoading;
      placesLoading = new Promise((resolve, reject) => {
        if (!GOOGLE_MAPS_BROWSER_KEY) return reject(new Error('GOOGLE_MAPS_BROWSER_KEY is not set'));
        // Google calls this if the key is refused (wrong domain, API not enabled).
        window.gm_authFailure = () => {
          console.error('Google Maps rejected the browser key');
          placesFailed.forEach(fn => fn());
        };
        window.__ffPlacesReady = resolve;
        const script = document.createElement('script');
        script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(GOOGLE_MAPS_BROWSER_KEY)
          + '&loading=async&v=weekly&callback=__ffPlacesReady';
        script.async = true;
        script.onerror = () => reject(new Error('Google Maps script failed to load'));
        document.head.appendChild(script);
      }).then(() => google.maps.importLibrary('places'));
      placesLoading.catch(err => { console.error(err); placesFailed.forEach(fn => fn()); });
      return placesLoading;
    }

    // onChoose(address) fires with a verified South African address.
    // onEdit()           fires when the customer edits after choosing, so the
    //                    caller can treat the previous choice as stale.
    function createAddressField({ input, list, status, onChoose, onEdit }) {
      if (!input || !list || !status) return null;

      let sessionToken = null, timer = null, seq = 0, options = [], active = -1;

      function setStatus(msg, isError) {
        status.textContent = msg;
        status.hidden = !msg;
        status.classList.toggle('error', Boolean(isError));
      }
      placesFailed.push(() => setStatus(LOOKUP_DOWN, true));

      function closeSuggestions() {
        list.hidden = true;
        list.innerHTML = '';
        options = [];
        active = -1;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
      }

      function highlight(i) {
        active = i;
        list.querySelectorAll('li[role="option"]').forEach((li, n) => li.classList.toggle('active', n === i));
        if (i >= 0) input.setAttribute('aria-activedescendant', `${list.id}-opt-${i}`);
        else input.removeAttribute('aria-activedescendant');
      }

      function renderSuggestions(predictions) {
        list.innerHTML = '';
        options = predictions;
        active = -1;
        if (!predictions.length) {
          const li = document.createElement('li');
          li.className = 'addr-empty';
          li.textContent = 'No matching addresses. Try just your street and suburb, or pick the nearest street and add details below.';
          list.appendChild(li);
        }
        predictions.forEach((pred, i) => {
          const li = document.createElement('li');
          li.id = `${list.id}-opt-${i}`;
          li.setAttribute('role', 'option');
          li.textContent = pred.mainText ? pred.mainText.toString() : pred.text.toString();
          if (pred.secondaryText) {
            const small = document.createElement('small');
            small.textContent = pred.secondaryText.toString();
            li.appendChild(small);
          }
          // mousedown, not click: it fires before the input's blur closes the list.
          li.addEventListener('mousedown', (e) => { e.preventDefault(); chooseSuggestion(pred); });
          li.addEventListener('mouseenter', () => highlight(i));
          list.appendChild(li);
        });
        // Required by Google's terms when their results are shown without a map.
        const attribution = document.createElement('li');
        attribution.className = 'addr-attribution';
        attribution.setAttribute('aria-hidden', 'true');
        attribution.textContent = 'Google Maps';
        list.appendChild(attribution);
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      }

      async function fetchSuggestions(query) {
        let places;
        try { places = await loadPlaces(); } catch (e) { return; }
        const mine = ++seq;
        if (!sessionToken) sessionToken = new places.AutocompleteSessionToken();
        try {
          const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            sessionToken,
            includedRegionCodes: ['za'],
            includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'],
            region: 'za',
            language: 'en',
          });
          if (mine !== seq) return;   // a newer keystroke has taken over
          renderSuggestions(suggestions.map(s => s.placePrediction).filter(Boolean));
        } catch (err) {
          console.error('Address suggestions failed:', err);
          if (mine === seq) setStatus('Address lookup failed. Please try again.', true);
        }
      }

      async function chooseSuggestion(prediction) {
        closeSuggestions();
        seq++;
        input.value = prediction.text.toString();
        setStatus('Checking address\u2026');
        const place = prediction.toPlace();
        try {
          // Ends the autocomplete session, so the suggestions above bill as one lookup.
          await place.fetchFields({ fields: ['formattedAddress', 'addressComponents'] });
        } catch (err) {
          console.error('Address details failed:', err);
          return setStatus('We could not check that address. Please choose it again.', true);
        } finally {
          sessionToken = null;
        }
        const parts = place.addressComponents || [];
        const find = (type) => parts.find(c => c.types.includes(type));
        const country = find('country');
        const province = find('administrative_area_level_1');
        if (!country || country.shortText !== 'ZA') return setStatus('We only deliver within South Africa.', true);
        if (!province) return setStatus('Please choose a full street address from the list.', true);

        input.value = place.formattedAddress;
        if (onChoose) onChoose({
          placeId: place.id,
          formattedAddress: place.formattedAddress,
          province: province.longText,
          hasStreetNumber: Boolean(find('street_number')),
        });
      }

      input.addEventListener('focus', () => { loadPlaces().catch(() => {}); });
      input.addEventListener('input', () => {
        if (onEdit) onEdit();
        setStatus('');
        clearTimeout(timer);
        const query = input.value.trim();
        if (query.length < 3) { seq++; return closeSuggestions(); }
        timer = setTimeout(() => fetchSuggestions(query), 250);
      });
      input.addEventListener('keydown', (e) => {
        if (list.hidden || !options.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % options.length); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active <= 0 ? options.length - 1 : active - 1); }
        else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); chooseSuggestion(options[active]); }
        else if (e.key === 'Escape') { e.stopPropagation(); closeSuggestions(); }
      });
      input.addEventListener('blur', () => setTimeout(closeSuggestions, 150));

      return { setStatus, setValue: (v) => { input.value = v || ''; }, close: closeSuggestions };
    }

    // The cart's instance. Choosing an address sets the fee; editing it after
    // clears the choice, because the fee shown would no longer match.
    const cartAddress = createAddressField({
      input:  document.getElementById('c-address'),
      list:   document.getElementById('addr-suggest'),
      status: document.getElementById('addr-status'),
      onChoose: (addr) => { deliveryAddress = addr; updateTotals(); },
      onEdit:   () => { if (deliveryAddress) { deliveryAddress = null; updateTotals(); } },
    });

    // ── Checkout ───────────────────────────────────
    function showCartError(msg) {
      if (!cartErrorEl) return;
      cartErrorEl.textContent = msg;
      cartErrorEl.hidden = !msg;
    }

    function flagInvalid(fieldId) {
      const field = document.getElementById(fieldId);
      field.classList.add('invalid');
      setTimeout(() => field.classList.remove('invalid'), 2500);
    }

    function collectCustomer() {
      const val = (id) => document.getElementById(id).value.trim();
      const name = val('c-name');
      const email = val('c-email');
      const phone = val('c-phone');
      const note = val('c-note');
      if (!name) { flagInvalid('cf-name'); return showCartError('Please enter your name.'), null; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { flagInvalid('cf-email'); return showCartError('Please enter a valid email address.'), null; }
      if (phone.replace(/\D/g, '').length < 9) { flagInvalid('cf-phone'); return showCartError('Please enter a contactable phone number.'), null; }

      if (!deliveryAddress) {
        flagInvalid('cf-address');
        return showCartError('Please choose your shipping address from the suggestions list.'), null;
      }
      const placeId = deliveryAddress.placeId;
      const addressExtra = val('c-address2');

      return { name, email, phone, placeId, addressExtra, note };
    }

    async function payWithYoco() {
      showCartError('');
      if (!cart.length) return;

      if (cart.some(l => maxQtyFor(l.id) <= 0)) {
        return showCartError('Something in your cart has sold out. Please remove it to continue.');
      }

      const customer = collectCustomer();
      if (!customer) return;

      const original = cartPayBtn.textContent;
      cartPayBtn.disabled = true;
      cartPayBtn.textContent = 'Taking you to Yoco…';

      const turnstile = await turnstileToken('ts-checkout');
      if (!turnstile) {
        showCartError(TURNSTILE_MISSING);
        cartPayBtn.disabled = false;
        cartPayBtn.textContent = original;
        return;
      }

      try {
        const res = await fetch(CHECKOUT_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: cart.map(l => ({ productId: l.id, quantity: l.qty })),
            shippingMethod: shippingMethod(),
            customer,
            turnstileToken: turnstile,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.redirectUrl) {
          // Sold out (or fewer left) since the page loaded: show the new count.
          if (data.stock && stockMap) {
            const prev = stockMap[data.stock.productId] || { display: 'quantity' };
            stockMap[data.stock.productId] = { ...prev, available: data.stock.available };
            renderCart();
          }
          showCartError(data.error || 'We could not start the payment. Please try again.');
          resetTurnstile('ts-checkout');
          cartPayBtn.disabled = false;
          cartPayBtn.textContent = original;
          return;
        }

        // The backend recalculates the total from its own price list and wins.
        // The site and the backend deploy separately, so for a short window
        // after a price change one can be ahead of the other — and a customer
        // could be sent to Yoco at a price they were never shown. Compare what
        // the backend worked out against what is on screen, and stop if they
        // disagree rather than letting it through silently.
        const shownSubtotal = subtotalCents();
        const shownShipping = deliveryAddress ? shippingCentsFor(shownSubtotal) : null;
        const shownTotal    = shownSubtotal + (shownShipping || 0);
        const asCents = (rands) => Math.round(Number(rands) * 100);

        if (shownShipping === null ||
            asCents(data.subtotal) !== shownSubtotal ||
            asCents(data.shipping) !== shownShipping ||
            asCents(data.total)    !== shownTotal) {
          console.error('Checkout total did not match what was shown:', {
            shown: { subtotal: shownSubtotal, shipping: shownShipping, total: shownTotal },
            backend: data,
          });
          showCartError('Our prices have just changed. Please review your order and try again.');
          // Close the checkout that was just made, so its pieces are not held.
          cancelCheckout({ checkoutId: data.orderId });
          // Repricing the cart from the data we have would only show the old
          // figures again; a reload picks up whichever version is now live.
          setTimeout(() => window.location.reload(), 2500);
          return;
        }

        // Remember the checkout so the return can be verified with Yoco.
        // Cart is cleared on return, not here: if they abandon the Yoco page
        // their basket should still be waiting for them.
        // Also a cookie on the parent domain: Yoco returns customers to the
        // apex, so an id stored only in localStorage on www.fireandfaye.co.za
        // would be invisible on the way back — different origin, different
        // storage. The cookie is readable from both.
        try {
          localStorage.setItem(PENDING_KEY, data.orderId || '');
          localStorage.setItem(PENDING_AT_KEY, String(Date.now()));
        } catch (e) {}
        try {
          document.cookie = PENDING_KEY + '=' + encodeURIComponent(data.orderId || '') +
            ';path=/;max-age=3600;domain=.fireandfaye.co.za;SameSite=Lax';
        } catch (e) {}
        window.location.href = data.redirectUrl;
      } catch (err) {
        console.error('Checkout failed:', err);
        showCartError('We could not reach the payment service. Check your connection and try again.');
        resetTurnstile('ts-checkout');
        cartPayBtn.disabled = false;
        cartPayBtn.textContent = original;
      }
    }

    if (cartPayBtn) cartPayBtn.addEventListener('click', payWithYoco);

    // ── Returning from Yoco ────────────────────────
    function showPayBanner(message, warn) {
      const banner = document.createElement('div');
      banner.className = 'pay-banner' + (warn ? ' warn' : '');
      banner.innerHTML = `<button class="pay-banner-close" type="button" aria-label="Dismiss">&times;</button>${message}`;
      banner.querySelector('.pay-banner-close').addEventListener('click', () => banner.remove());
      document.body.appendChild(banner);
    }

    (function handlePaymentReturn() {
      const params = new URLSearchParams(window.location.search);
      const status = params.get('payment');

      if (!status) {
        // An ordinary page load. If an earlier return never got an answer
        // (connection dropped, payment still going through), ask once more.
        const checkoutId = readPendingCheckout();
        if (checkoutId) confirmPayment({ checkoutId }, { quiet: true });
        return;
      }

      // Two ways to know which checkout this is. The reference in the URL
      // works in any browser, including one the bank's app opened. The id
      // stored before leaving for Yoco only exists in the browser that
      // started the checkout, and is the fallback.
      const ref = params.get('ref');
      const ids = {
        ref: ref && CHECKOUT_REF.test(ref) ? ref : null,
        checkoutId: readPendingCheckout(),
      };

      if (status === 'success') {
        cart = [];
        saveCart();
        renderCart();
        showPayBanner('Thank you &mdash; your payment went through. A confirmation is on its way, and we&rsquo;ll be in touch about delivery.', false);
        confirmPayment(ids);
      } else if (status === 'cancelled') {
        showPayBanner('Payment cancelled. Your cart has been kept, so you can pick up where you left off.', true);
        cancelCheckout(ids);
      } else if (status === 'failed') {
        showPayBanner('That payment didn&rsquo;t go through. Your cart has been kept &mdash; please try again, or email us if it keeps failing.', true);
        cancelCheckout(ids);
      }

      // Don't leave ?payment= in the URL to be re-triggered on refresh.
      window.history.replaceState({}, '', window.location.pathname);
    })();

    // ── Confirming the payment ─────────────────────
    // The ?payment=success in the URL proves nothing on its own — anyone can
    // type it. This hands the checkout to the backend, which asks Yoco
    // directly whether it was really paid before anything is emailed.
    //
    // The stored checkout id is kept until the backend gives a definite
    // answer (paid, or closed without payment). It used to be removed before
    // asking, so one failed request meant the order was never confirmed.
    // Asking twice is safe: the backend sends the confirmations once only.
    function readPendingCheckout() {
      let checkoutId = null;
      let savedAt = 0;
      try {
        checkoutId = localStorage.getItem(PENDING_KEY);
        savedAt = Number(localStorage.getItem(PENDING_AT_KEY)) || 0;
      } catch (e) {}
      if (checkoutId && savedAt && Date.now() - savedAt > PENDING_MAX_AGE_MS) {
        clearPendingCheckout();
        return null;
      }
      if (!checkoutId) {
        // The cookie expires by itself after an hour.
        const m = document.cookie.match(new RegExp('(?:^|; )' + PENDING_KEY + '=([^;]*)'));
        if (m) checkoutId = decodeURIComponent(m[1]);
      }
      return checkoutId || null;
    }

    function clearPendingCheckout() {
      try {
        localStorage.removeItem(PENDING_KEY);
        localStorage.removeItem(PENDING_AT_KEY);
      } catch (e) {}
      try { document.cookie = PENDING_KEY + '=;path=/;max-age=0;domain=.fireandfaye.co.za'; } catch (e) {}
    }

    // One question to the backend about one checkout. Asks by the reference
    // from the URL when there is one; if the backend cannot place it (the
    // order was never recorded, or the database is down) and this browser
    // holds the Yoco id, asks again with that.
    // Resolves to { ok, status, data }. Rejects only if the network fails.
    async function askBackend(ids, action) {
      const send = async (body) => {
        const r = await fetch(CONFIRM_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action ? { ...body, action } : body),
        });
        const data = await r.json().catch(() => ({}));
        return { ok: r.ok, status: r.status, data };
      };
      if (ids.ref) {
        const byRef = await send({ ref: ids.ref });
        const notPlaced = byRef.status === 503 || (byRef.ok && byRef.data.found === false);
        if (!notPlaced || !ids.checkoutId) return byRef;
      }
      return send({ checkoutId: ids.checkoutId });
    }

    // Not paying after all: the backend closes the Yoco page, gives the held
    // pieces back and marks the order cancelled, rather than leaving them
    // held for the full hour.
    function cancelCheckout(ids) {
      if (!ids || (!ids.ref && !ids.checkoutId)) return;
      askBackend(ids, 'cancel')
        .then((a) => {
          if (!a.ok) return;                       // no answer: keep the id
          if (a.data.reason === 'paid') {
            // Came back as cancelled or failed, but Yoco says it was paid
            // (a second attempt went through). Confirm it instead.
            confirmPayment(ids, { quiet: true });
            return;
          }
          clearPendingCheckout();
        })
        .catch(err => console.error('Could not cancel the checkout:', err));
    }

    // quiet: not on the return from Yoco, so nothing has been shown yet. Asks
    // once, and only if it turns out to be paid says so and empties the cart.
    function confirmPayment(ids, options, attempt) {
      if (!ids || (!ids.ref && !ids.checkoutId)) return;
      const quiet = Boolean(options && options.quiet);
      const n = attempt || 0;

      const again = () => {
        // Out of tries: the id stays stored, so the next page load asks
        // again, and the backend's own pass confirms the order regardless.
        if (quiet || n >= CONFIRM_RETRY_MS.length) return;
        setTimeout(() => confirmPayment(ids, options, n + 1), CONFIRM_RETRY_MS[n]);
      };

      askBackend(ids)
        .then((a) => {
          const d = a.data || {};
          console.log('Payment confirmation:', d);

          if (a.ok && d.paid) {
            clearPendingCheckout();
            // Only when this check is what confirmed the order. If it was
            // confirmed earlier (in another tab or browser, or by the
            // backend's own pass) the customer has their email already: a
            // thank-you on an unrelated page load would be wrong, and the
            // cart may by now hold something new.
            if (quiet && !d.alreadyConfirmed) {
              cart = [];
              saveCart();
              renderCart();
              showPayBanner('Thank you &mdash; your payment went through. A confirmation is on its way, and we&rsquo;ll be in touch about delivery.', false);
            }
            return;
          }
          // Definitely not paid, or not a checkout the backend knows: stop.
          if ((a.ok && (d.status === 'expired' || d.found === false)) || a.status === 400) {
            clearPendingCheckout();
            return;
          }
          // Still in progress at Yoco, or the backend could not check.
          again();
        })
        .catch((err) => {
          console.error('Could not confirm payment:', err);
          again();
        });
    }

    // ── Prefill the cart from a signed-in customer's profile ──
    // Only fills fields the customer has not already typed into, so a stale
    // saved value never overwrites a deliberate change.
    //
    // Setting deliveryAddress here makes the fee appear without retyping the
    // address. Safe, because the backend looks the place id up again before
    // charging — nothing here decides what is actually charged.
    async function prefillFromProfile() {
      if (!cartLines) return;                       // not the cart page
      const session = loadSession();
      if (!session || !session.access_token) return;

      const fill = (id, value) => {
        const el = document.getElementById(id);
        if (el && !el.value.trim() && value) el.value = value;
      };

      fill('c-email', session.email);

      const uid = userIdOf(session);
      if (!uid) return;

      let profile = null;
      try {
        const rows = await supaApi(session, `profiles?id=eq.${uid}&select=*`);
        profile = rows && rows[0];
      } catch (err) {
        // Signed in but the profile could not be read — expired session, or
        // Supabase asleep on the free tier. Checkout still works by hand, so
        // this must never surface as an error to the customer.
        console.error('Could not prefill from your profile:', err);
        return;
      }
      if (!profile) return;

      fill('c-name', [profile.first_name, profile.last_name].filter(Boolean).join(' '));
      fill('c-phone', profile.phone);
      fill('c-address2', profile.address_extra);

      // Don't clobber an address already chosen in this session.
      if (profile.place_id && !deliveryAddress) {
        deliveryAddress = {
          placeId: profile.place_id,
          formattedAddress: profile.address,
          province: profile.province,
          // Not stored on the profile. The street-number nudge is for the
          // moment of choosing; a saved address has been through it already.
          hasStreetNumber: true,
        };
        if (cartAddress) cartAddress.setValue(profile.address);
        updateTotals();
      }
    }
    prefillFromProfile();

    // ── Empty cart: say so under the nav button, don't navigate ──
    const cartPopover = document.getElementById('cart-popover');
    let popoverTimer = null;

    function hideCartPopover() {
      if (cartPopover) cartPopover.classList.remove('show');
    }

    if (cartPopover && cartToggle) {
      cartToggle.addEventListener('click', (e) => {
        if (cart.length) return;           // there is something to show
        e.preventDefault();
        cartPopover.classList.add('show');
        clearTimeout(popoverTimer);
        popoverTimer = setTimeout(hideCartPopover, 3500);
      });
      document.addEventListener('click', (e) => {
        if (!cartToggle.contains(e.target) && !cartPopover.contains(e.target)) hideCartPopover();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideCartPopover();
      });
    }

    // ── Stock ──────────────────────────────────────
    // Read live on every page load, never baked in at publish: a piece sold
    // at 10am must not still look available until Paige next publishes.
    // Only products with stock tracking switched on are listed; anything else
    // sells as before. The checkout enforces the real limit; this is only what
    // the customer is shown.
    const LOW_STOCK = 2;
    const SHIPS_TEXT = 'Ships within 2&ndash;3 working days';

    const stockLoaded = fetch(`${SUPABASE_URL}/rest/v1/rpc/public_stock`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('stock ' + r.status)))
      .then(rows => { stockMap = Object.fromEntries(rows.map(r => [r.id, r])); })
      .catch(err => { console.error('Could not load stock:', err); stockMap = {}; });

    // null means stock is not tracked for this piece.
    function stockOf(id) { return (stockMap && stockMap[id]) || null; }
    function maxQtyFor(id) {
      const s = stockOf(id);
      return s ? Math.min(MAX_QTY, Math.max(0, s.available)) : MAX_QTY;
    }
    function stockLabel(s) {
      if (!s) return '';
      if (s.available <= 0) return 'Sold out';
      if (s.display === 'quantity') return `${s.available} available`;
      if (s.display === 'low' && s.available <= LOW_STOCK) return `Only ${s.available} left`;
      return 'In stock';
    }

    function cartStockNote(line) {
      const s = stockOf(line.id);
      if (!s) return '';
      if (s.available <= 0) return '<div class="cart-line-stock out">Sold out &mdash; please remove</div>';
      if (line.qty >= s.available && s.display !== 'in_stock') {
        return `<div class="cart-line-stock">Only ${s.available} available</div>`;
      }
      return '';
    }

    // Category and homepage cards: a "Sold out" tag on the photo. home.js
    // calls this again after it redraws its grid.
    function applyStockToCards() {
      if (!stockMap) return;
      document.querySelectorAll('a.card[href]').forEach(card => {
        const id = card.getAttribute('href').split('/').filter(Boolean).pop();
        const s = stockOf(id);
        const tag = card.querySelector('.card-soldout');
        if (s && s.available <= 0) {
          if (!tag) {
            const t = document.createElement('span');
            t.className = 'coming-soon-tag card-soldout';
            t.textContent = 'Sold out';
            card.appendChild(t);
          }
        } else if (tag) tag.remove();
      });
    }

    // A cart saved before something sold out is brought down to what is left.
    // Sold-out lines stay, marked, so the customer sees what happened.
    function fitCartToStock() {
      let changed = false;
      cart.forEach(l => {
        const max = maxQtyFor(l.id);
        if (max > 0 && l.qty > max) { l.qty = max; changed = true; }
      });
      if (changed) saveCart();
    }

    stockLoaded.then(() => {
      applyStockToCards();
      fitCartToStock();
      renderCart();
    });

    // ── Add to cart, from a product page ───────────
    // Once a piece is in the cart the button becomes "Go to cart" rather than
    // reverting to "Add to Cart" — otherwise the obvious next click adds a
    // second one, when the customer wants to go and check out. Quantity is
    // adjusted in the cart, which is the only place it is editable.
    let addedTimer = null;
    const pdpAdd = document.getElementById('pdp-add');
    if (pdpAdd) {
      const productId = pdpAdd.getAttribute('data-id');

      function showGoToCart() {
        pdpAdd.textContent = 'Go to cart';
        pdpAdd.classList.remove('added');
        pdpAdd.classList.add('go');
      }

      pdpAdd.addEventListener('click', () => {
        if (pdpAdd.classList.contains('go')) {
          window.location.href = '/cart/';
          return;
        }
        const inCart = (cart.find(l => l.id === productId) || {}).qty || 0;
        if (inCart >= maxQtyFor(productId)) {
          pdpAdd.textContent = 'No more available';
          return;
        }
        addToCart(productId, 1);
        pdpAdd.textContent = 'Added to cart \u2713';
        pdpAdd.classList.add('added');
        clearTimeout(addedTimer);
        addedTimer = setTimeout(showGoToCart, 1400);
      });

      // Returning to a page for something already in the cart should not
      // offer to add it again.
      if (cart.some(line => line.id === productId)) showGoToCart();

      stockLoaded.then(() => {
        const s = stockOf(productId);
        if (!s) return;
        const el = document.createElement('p');
        el.className = 'pdp-stock' + (s.available <= 0 ? ' out' : '');
        el.innerHTML = s.available <= 0 ? 'Sold out' : `${stockLabel(s)} &middot; ${SHIPS_TEXT}`;
        const price = document.querySelector('.pdp-price');
        if (price) price.insertAdjacentElement('afterend', el);
        if (s.available <= 0 && !cart.some(line => line.id === productId)) {
          pdpAdd.disabled = true;
          pdpAdd.textContent = 'Sold out';
          pdpAdd.classList.add('sold-out');
        }
      });
    }

    renderCart();

    // ── Admin link in the nav ─────────────────────
    // Shown only when an admin (Paige) is signed in, so she doesn't have to
    // type /admin. The database decides, through the same is_admin() check the
    // admin page makes. Hiding the link is a convenience, not security: the
    // admin data is protected by row-level security whatever the page shows.
    // The answer is remembered for the browser tab so each page doesn't ask.
    (async function showAdminLink() {
      const actions = document.querySelector('.nav-actions');
      const session = loadSession();
      if (!actions || !session || !session.access_token) return;
      const uid = userIdOf(session);
      const KEY = 'ff_admin_check';
      let isAdmin = null;
      try {
        const c = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (c && c.uid === uid) isAdmin = c.admin;
      } catch (e) {}
      if (isAdmin === null) {
        try {
          isAdmin = (await supaApi(session, 'rpc/is_admin', { method: 'POST', body: '{}' })) === true;
        } catch (e) { return; }   // expired or offline: just no link
        try { sessionStorage.setItem(KEY, JSON.stringify({ uid, admin: isAdmin })); } catch (e) {}
      }
      if (!isAdmin || document.getElementById('nav-admin')) return;
      const link = document.createElement('a');
      link.id = 'nav-admin';
      link.className = 'nav-text-link';
      link.href = '/admin/';
      link.textContent = 'Admin';
      actions.insertBefore(link, actions.firstChild);
    })();
