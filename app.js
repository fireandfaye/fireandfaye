// Shared across every page: cart, checkout, delivery address, nav.
// Loads after products.js, which defines PRODUCTS.

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

    async function refreshSession(s) {
      const d = await supaAuth('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
      const next = { access_token: d.access_token, refresh_token: d.refresh_token,
                     email: s.email, user_id: s.user_id || (d.user && d.user.id) };
      saveSession(next);
      return next;
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
    // Delivery fees. Keep in step with DELIVERY_CENTS and FREE_SHIPPING_MIN_CENTS
    // in the backend's products.js: these are only what the customer is shown,
    // the backend's values are what gets charged. The rate is decided by the
    // province of the address picked from Google's suggestions, never chosen.
    const DELIVERY_CENTS = { gauteng: 7500, elsewhere: 9500 };
    const FREE_SHIPPING_MIN_CENTS = 39900;
    const deliveryCentsFor = (province) => province === 'Gauteng' ? DELIVERY_CENTS.gauteng : DELIVERY_CENTS.elsewhere;
    const FEE_TEXT = {
      'gauteng': DELIVERY_CENTS.gauteng,
      'elsewhere': DELIVERY_CENTS.elsewhere,
      'free-min': FREE_SHIPPING_MIN_CENTS,
    };
    document.querySelectorAll('[data-fee]').forEach(el => {
      el.textContent = 'R' + FEE_TEXT[el.getAttribute('data-fee')] / 100;
    });
    // Set once an address is picked from Google's suggestions (see the address section).
    let deliveryAddress = null;   // { placeId, formattedAddress, province, hasStreetNumber }
    const CART_KEY = 'ff-cart-v1';
    const MAX_QTY = 20;

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
        line.qty = Math.min(MAX_QTY, line.qty + (qty || 1));
      } else {
        cart.push({ id, qty: Math.min(MAX_QTY, qty || 1) });
      }
      saveCart();
      renderCart();
    }

    function setQty(id, qty) {
      const line = cart.find(l => l.id === id);
      if (!line) return;
      if (qty <= 0) return removeFromCart(id);
      line.qty = Math.min(MAX_QTY, qty);
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
          <a class="cart-thumb-link" href="/${p.category}/${p.id}/" aria-label="${p.name}">
            <img class="cart-thumb" src="${p.images[0]}" alt="" />
          </a>
          <div>
            <a class="cart-line-name" href="/${p.category}/${p.id}/">${p.name}</a>
            <div class="cart-line-price">${p.price} each</div>
            <div class="qty">
              <button type="button" data-act="dec" aria-label="Decrease quantity">&minus;</button>
              <span>${line.qty}</span>
              <button type="button" data-act="inc" aria-label="Increase quantity" ${line.qty >= MAX_QTY ? 'disabled' : ''}>+</button>
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
      const freeShip = sub >= FREE_SHIPPING_MIN_CENTS;
      const addrFee = deliveryAddress ? deliveryCentsFor(deliveryAddress.province) : null;
      // null means there is no address yet to price the delivery from.
      const ship = freeShip ? 0 : addrFee;

      const range = `R${DELIVERY_CENTS.gauteng / 100}\u2013R${DELIVERY_CENTS.elsewhere / 100}`;
      document.getElementById('delivery-price').innerHTML = freeShip
        ? `<s>${addrFee != null ? rands(addrFee) : range}</s>Free`
        : (addrFee != null ? rands(addrFee) : range);

      const freeShipEl = document.getElementById('cart-free-ship');
      freeShipEl.classList.toggle('applied', freeShip);
      if (!freeShip) {
        freeShipEl.textContent = `Add ${rands(FREE_SHIPPING_MIN_CENTS - sub)} more for free delivery`;
      } else {
        freeShipEl.textContent = '\u2726 Free delivery applied to your order';
      }

      document.getElementById('cart-subtotal').textContent = rands(sub);
      document.getElementById('cart-shipping').textContent =
        ship === null ? 'Add your address' : ship === 0 ? 'Free' : rands(ship);
      document.getElementById('cart-total').textContent =
        ship === null ? `${rands(sub)} + delivery` : rands(sub + ship);

      if (deliveryAddress && cartAddress) {
        const fee = freeShip ? 'free delivery' : `${rands(addrFee)} delivery`;
        cartAddress.setStatus(`\u2713 ${deliveryAddress.province} address \u00b7 ${fee}` + (deliveryAddress.hasStreetNumber
          ? '' : '. No street number found \u2014 please add it in the line below.'));
      }
    }

    if (cartLines) document.getElementById('delivery-note').textContent =
      `Courier, 2\u20135 working days \u00b7 Gauteng R${DELIVERY_CENTS.gauteng / 100}, elsewhere R${DELIVERY_CENTS.elsewhere / 100}`;

    // ── Address autocomplete (Google Places) ──────
    // The customer picks their address from Google's suggestions; its province
    // sets the delivery fee. Only the place id is sent to the backend, which
    // looks the address up again itself before charging, so nothing typed or
    // edited here can change the fee.
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
        return showCartError('Please choose your delivery address from the suggestions list.'), null;
      }
      const placeId = deliveryAddress.placeId;
      const addressExtra = val('c-address2');

      return { name, email, phone, placeId, addressExtra, note };
    }

    async function payWithYoco() {
      showCartError('');
      if (!cart.length) return;

      const customer = collectCustomer();
      if (!customer) return;

      const original = cartPayBtn.textContent;
      cartPayBtn.disabled = true;
      cartPayBtn.textContent = 'Taking you to Yoco…';

      try {
        const res = await fetch(CHECKOUT_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: cart.map(l => ({ productId: l.id, quantity: l.qty })),
            shippingMethod: shippingMethod(),
            customer,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.redirectUrl) {
          showCartError(data.error || 'We could not start the payment. Please try again.');
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
        const freeShipping  = shownSubtotal >= FREE_SHIPPING_MIN_CENTS;
        const shownShipping = freeShipping ? 0
          : (deliveryAddress ? deliveryCentsFor(deliveryAddress.province) : null);
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
        try { localStorage.setItem(PENDING_KEY, data.orderId || ''); } catch (e) {}
        try {
          document.cookie = PENDING_KEY + '=' + encodeURIComponent(data.orderId || '') +
            ';path=/;max-age=3600;domain=.fireandfaye.co.za;SameSite=Lax';
        } catch (e) {}
        window.location.href = data.redirectUrl;
      } catch (err) {
        console.error('Checkout failed:', err);
        showCartError('We could not reach the payment service. Check your connection and try again.');
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
      const status = new URLSearchParams(window.location.search).get('payment');
      if (!status) return;

      if (status === 'success') {
        cart = [];
        saveCart();
        renderCart();
        showPayBanner('Thank you &mdash; your payment went through. A confirmation is on its way, and we&rsquo;ll be in touch about delivery.', false);
        confirmPayment();
      } else if (status === 'cancelled') {
        showPayBanner('Payment cancelled. Your cart has been kept, so you can pick up where you left off.', true);
      } else if (status === 'failed') {
        showPayBanner('That payment didn&rsquo;t go through. Your cart has been kept &mdash; please try again, or email us if it keeps failing.', true);
      }

      // Don't leave ?payment= in the URL to be re-triggered on refresh.
      window.history.replaceState({}, '', window.location.pathname);
    })();

    // ── Confirming the payment ─────────────────────
    // The ?payment=success in the URL proves nothing on its own — anyone can
    // type it. This hands the checkout id to the backend, which asks Yoco
    // directly whether it was really paid before anything is emailed.
    function confirmPayment() {
      let checkoutId = null;
      try { checkoutId = localStorage.getItem(PENDING_KEY); } catch (e) {}
      if (!checkoutId) {
        const m = document.cookie.match(new RegExp('(?:^|; )' + PENDING_KEY + '=([^;]*)'));
        if (m) checkoutId = decodeURIComponent(m[1]);
      }
      if (!checkoutId) return;

      // Clear first: a refresh of the success page must not send a second
      // set of confirmation emails.
      try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
      try { document.cookie = PENDING_KEY + '=;path=/;max-age=0;domain=.fireandfaye.co.za'; } catch (e) {}

      fetch(CONFIRM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkoutId }),
      })
        .then(r => r.json())
        .then(d => console.log('Payment confirmation:', d))
        .catch(err => console.error('Could not confirm payment:', err));
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
      if (!session || !session.access_token) {
        console.debug('[prefill] not signed in — nothing to fill');
        return;
      }
      console.debug('[prefill] signed in as', session.email);

      const fill = (id, value) => {
        const el = document.getElementById(id);
        if (el && !el.value.trim() && value) el.value = value;
      };

      fill('c-email', session.email);

      const uid = userIdOf(session);
      if (!uid) {
        console.warn('[prefill] no user id in the session token');
        return;
      }

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
      if (!profile) {
        console.warn('[prefill] signed in, but no profile row for', uid);
        return;
      }
      console.debug('[prefill] profile loaded', profile);

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
        addToCart(productId, 1);
        pdpAdd.textContent = 'Added to cart \u2713';
        pdpAdd.classList.add('added');
        clearTimeout(addedTimer);
        addedTimer = setTimeout(showGoToCart, 1400);
      });

      // Returning to a page for something already in the cart should not
      // offer to add it again.
      if (cart.some(line => line.id === productId)) showGoToCart();
    }

    renderCart();
