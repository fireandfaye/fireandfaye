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
    const shippingMethod = () => {
      const picked = document.querySelector('input[name="shipping"]:checked');
      return picked ? picked.value : 'delivery';
    };

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
          <img class="cart-thumb" src="${p.images[0]}" alt="" />
          <div>
            <div class="cart-line-name">${p.name}</div>
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

      if (deliveryAddress) {
        const fee = freeShip ? 'free delivery' : `${rands(addrFee)} delivery`;
        setAddrStatus(`\u2713 ${deliveryAddress.province} address \u00b7 ${fee}` + (deliveryAddress.hasStreetNumber
          ? '' : '. No street number found \u2014 please add it in the line below.'));
      }
    }

    if (cartLines) document.getElementById('delivery-note').textContent =
      `Courier, 2\u20135 working days \u00b7 Gauteng R${DELIVERY_CENTS.gauteng / 100}, elsewhere R${DELIVERY_CENTS.elsewhere / 100}`;

    document.querySelectorAll('input[name="shipping"]').forEach(radio => {
      radio.addEventListener('change', () => { showCartError(''); updateTotals(); });
    });

    // ── Delivery address (Google Places) ──────────
    // The customer picks their address from Google's suggestions; its province
    // sets the delivery fee. Only the place id is sent to the backend, which
    // looks the address up again itself before charging, so nothing typed or
    // edited here can change the fee.
    //
    // Browser key: public by design. In Google Cloud it must be restricted to
    // the site's domains (HTTP referrers) and to the Maps JavaScript API and
    // Places API (New). The backend uses a separate server key.
    const GOOGLE_MAPS_BROWSER_KEY = 'AIzaSyC4WvXz0YYwlJuXWCD1_O7XETTywTDmo9M';

    const addrInput   = document.getElementById('c-address');
    const addrList    = document.getElementById('addr-suggest');
    const addrStatus  = document.getElementById('addr-status');
    let placesLoading = null;
    let sessionToken = null;
    let addrTimer = null;
    let addrSeq = 0;
    let addrOptions = [];
    let addrActive = -1;

    function setAddrStatus(msg, isError) {
      addrStatus.textContent = msg;
      addrStatus.hidden = !msg;
      addrStatus.classList.toggle('error', Boolean(isError));
    }

    const LOOKUP_DOWN = 'Address lookup is unavailable right now. Please try again later, or send us an enquiry below.';

    function loadPlaces() {
      if (placesLoading) return placesLoading;
      placesLoading = new Promise((resolve, reject) => {
        if (!GOOGLE_MAPS_BROWSER_KEY) return reject(new Error('GOOGLE_MAPS_BROWSER_KEY is not set'));
        // Google calls this if the key is refused (wrong domain, API not enabled).
        window.gm_authFailure = () => { console.error('Google Maps rejected the browser key'); setAddrStatus(LOOKUP_DOWN, true); };
        window.__ffPlacesReady = resolve;
        const script = document.createElement('script');
        script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(GOOGLE_MAPS_BROWSER_KEY)
          + '&loading=async&v=weekly&callback=__ffPlacesReady';
        script.async = true;
        script.onerror = () => reject(new Error('Google Maps script failed to load'));
        document.head.appendChild(script);
      }).then(() => google.maps.importLibrary('places'));
      placesLoading.catch(err => { console.error(err); setAddrStatus(LOOKUP_DOWN, true); });
      return placesLoading;
    }

    function closeSuggestions() {
      addrList.hidden = true;
      addrList.innerHTML = '';
      addrOptions = [];
      addrActive = -1;
      addrInput.setAttribute('aria-expanded', 'false');
      addrInput.removeAttribute('aria-activedescendant');
    }

    function highlight(i) {
      addrActive = i;
      addrList.querySelectorAll('li[role="option"]').forEach((li, n) => li.classList.toggle('active', n === i));
      if (i >= 0) addrInput.setAttribute('aria-activedescendant', `addr-opt-${i}`);
      else addrInput.removeAttribute('aria-activedescendant');
    }

    function renderSuggestions(predictions) {
      addrList.innerHTML = '';
      addrOptions = predictions;
      addrActive = -1;
      if (!predictions.length) {
        const li = document.createElement('li');
        li.className = 'addr-empty';
        li.textContent = 'No matching addresses. Try just your street and suburb, or pick the nearest street and add details below.';
        addrList.appendChild(li);
      }
      predictions.forEach((pred, i) => {
        const li = document.createElement('li');
        li.id = `addr-opt-${i}`;
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
        addrList.appendChild(li);
      });
      // Required by Google's terms when their results are shown without a map.
      const attribution = document.createElement('li');
      attribution.className = 'addr-attribution';
      attribution.setAttribute('aria-hidden', 'true');
      attribution.textContent = 'Google Maps';
      addrList.appendChild(attribution);
      addrList.hidden = false;
      addrInput.setAttribute('aria-expanded', 'true');
    }

    async function fetchSuggestions(query) {
      let places;
      try { places = await loadPlaces(); } catch (e) { return; }
      const seq = ++addrSeq;
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
        if (seq !== addrSeq) return;   // a newer keystroke has taken over
        renderSuggestions(suggestions.map(s => s.placePrediction).filter(Boolean));
      } catch (err) {
        console.error('Address suggestions failed:', err);
        if (seq === addrSeq) setAddrStatus('Address lookup failed. Please try again.', true);
      }
    }

    async function chooseSuggestion(prediction) {
      closeSuggestions();
      addrSeq++;
      addrInput.value = prediction.text.toString();
      setAddrStatus('Checking address\u2026');
      const place = prediction.toPlace();
      try {
        // Ends the autocomplete session, so the suggestions above bill as one lookup.
        await place.fetchFields({ fields: ['formattedAddress', 'addressComponents'] });
      } catch (err) {
        console.error('Address details failed:', err);
        return setAddrStatus('We could not check that address. Please choose it again.', true);
      } finally {
        sessionToken = null;
      }
      const parts = place.addressComponents || [];
      const find = (type) => parts.find(c => c.types.includes(type));
      const country = find('country');
      const province = find('administrative_area_level_1');
      if (!country || country.shortText !== 'ZA') return setAddrStatus('We only deliver within South Africa.', true);
      if (!province) return setAddrStatus('Please choose a full street address from the list.', true);

      deliveryAddress = {
        placeId: place.id,
        formattedAddress: place.formattedAddress,
        province: province.longText,
        hasStreetNumber: Boolean(find('street_number')),
      };
      addrInput.value = place.formattedAddress;
      updateTotals();
    }

    if (addrInput) {
    addrInput.addEventListener('focus', () => { loadPlaces().catch(() => {}); });
    addrInput.addEventListener('input', () => {
      // Any edit after choosing means the fee no longer matches what is shown.
      if (deliveryAddress) { deliveryAddress = null; updateTotals(); }
      setAddrStatus('');
      clearTimeout(addrTimer);
      const query = addrInput.value.trim();
      if (query.length < 3) { addrSeq++; return closeSuggestions(); }
      addrTimer = setTimeout(() => fetchSuggestions(query), 250);
    });
    addrInput.addEventListener('keydown', (e) => {
      if (addrList.hidden || !addrOptions.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight((addrActive + 1) % addrOptions.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(addrActive <= 0 ? addrOptions.length - 1 : addrActive - 1); }
      else if (e.key === 'Enter' && addrActive >= 0) { e.preventDefault(); chooseSuggestion(addrOptions[addrActive]); }
      else if (e.key === 'Escape') { e.stopPropagation(); closeSuggestions(); }
    });
    addrInput.addEventListener('blur', () => setTimeout(closeSuggestions, 150));
    }

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
    let addedTimer = null;
    const pdpAdd = document.getElementById('pdp-add');
    if (pdpAdd) {
      pdpAdd.addEventListener('click', () => {
        addToCart(pdpAdd.getAttribute('data-id'), 1);
        pdpAdd.textContent = 'Added to cart \u2713';
        pdpAdd.classList.add('added');
        clearTimeout(addedTimer);
        addedTimer = setTimeout(() => {
          pdpAdd.textContent = 'Add to Cart';
          pdpAdd.classList.remove('added');
        }, 2000);
      });
    }

    renderCart();
