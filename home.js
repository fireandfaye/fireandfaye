// Homepage only: hero sparkle, the product grid and its filters,
// and the enquiry form. Loads after app.js.

// ── Constellation sparkle (gold / blush / white) ─────
    const starsEl = document.getElementById('stars');
    const SPARKLE_COLORS = ['#D4B483', '#E7CEC8', '#FFFFFF'];
    for (let i = 0; i < 60; i++) {
      const s = document.createElement('div');
      s.className = 'star';
      const size = Math.random() * 2.5 + 0.5;
      const color = SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
      s.style.cssText = `
        width:${size}px; height:${size}px;
        top:${Math.random() * 100}%;
        left:${Math.random() * 100}%;
        background:${color};
        color:${color};
        --dur:${(Math.random() * 5 + 3).toFixed(1)}s;
        --delay:${(Math.random() * 6).toFixed(1)}s;
        --opacity:${(Math.random() * 0.6 + 0.15).toFixed(2)};
      `;
      starsEl.appendChild(s);
    }

    // ── Render product cards ──────────────────────
    const grid = document.getElementById('product-grid');
    let currentFilter = 'all';

    const COMING_SOON_CATEGORIES = ['bracelets', 'rings', 'sale'];

    function renderCards(filter) {
      grid.innerHTML = '';
      const matches = PRODUCTS.filter(p => filter === 'all' || p.category === filter);

      if (matches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'grid-empty';
        if (COMING_SOON_CATEGORIES.includes(filter)) {
          empty.innerHTML = `<h3>Coming Soon</h3><p>This collection is being handcrafted — follow @fireandfaye to be the first to know when it drops.</p>`;
        } else {
          empty.innerHTML = `<h3>Coming Soon</h3><p>New pieces are on the way.</p>`;
        }
        grid.appendChild(empty);
        return;
      }

      matches.forEach(p => {
        const card = document.createElement('a');
        card.className = 'card card-product';
        card.href = `/${p.category}/${p.id}/`;
        card.setAttribute('data-category', p.category);
        card.innerHTML = `
          <div class="card-corner"></div>
          <div class="card-photo-wrap">
            <img class="card-photo" src="${p.images[0]}" alt="${p.name}" width="700" height="933" loading="lazy" decoding="async" />
          </div>
          <div class="card-info">
            <div class="card-name">${p.name}</div>
            <div class="card-price">${p.price}</div>
            <div class="card-view-hint">View Details</div>
          </div>
        `;
        grid.appendChild(card);
      });
    }

    function updateGrid() {
      renderCards(currentFilter);
    }
    renderCards('all');

    // ── Category filter tabs ──────────────────────
    const filterTabs = document.querySelectorAll('.filter-tab');
    function setActiveFilter(filter) {
      currentFilter = filter;
      filterTabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-filter') === filter));
      updateGrid();
    }
    filterTabs.forEach(tab => {
      tab.addEventListener('click', () => setActiveFilter(tab.getAttribute('data-filter')));
    });

    // ── Notify Me handler — temporarily disabled with its markup above ──
    /*
    function handleNotify() {
      const input = document.getElementById('notify-email');
      const confirm = document.getElementById('notify-confirm');
      if (!input.value || !input.value.includes('@')) {
        input.style.color = 'var(--gold-deep)';
        input.placeholder = 'Please enter a valid email';
        setTimeout(() => {
          input.style.color = 'var(--espresso)';
          input.placeholder = 'your@email.com';
        }, 2200);
        return;
      }
      confirm.style.display = 'block';
      input.value = '';
      input.placeholder = 'your@email.com';
    }
    */

    // ── Enquiry form ─────────────────────────────
    const ENQUIRY_ENDPOINT = 'https://fireandfaye-yoco-backend.vercel.app/api/enquiry';

    async function handleSubmit(e) {
      e.preventDefault();
      const form = e.target;
      const btn = form.querySelector('.form-submit');
      const note = form.querySelector('.form-note');
      const original = 'Send Enquiry';

      const name = document.getElementById('f-name').value.trim();
      const email = document.getElementById('f-email').value.trim();
      const message = document.getElementById('f-msg').value.trim();
      const website = document.getElementById('f-website').value.trim();

      const fail = (msg) => {
        btn.textContent = original;
        btn.disabled = false;
        btn.style.background = 'var(--gold)';
        btn.style.color = 'var(--espresso)';
        note.textContent = msg;
        note.style.color = 'var(--gold-deep)';
      };

      if (!name) return fail('Please enter your name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Please enter a valid email address.');
      if (message.length < 5) return fail('Please enter a message.');

      btn.disabled = true;
      btn.textContent = 'Sending…';
      note.textContent = '';

      try {
        const res = await fetch(ENQUIRY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, message, website }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) return fail(data.error || 'We could not send that. Please try again.');

        // Only now is it safe to say the message was sent.
        btn.textContent = 'Message sent ✦';
        btn.style.background = 'var(--sage-deep)';
        btn.style.color = 'var(--white)';
        note.textContent = "Thank you — I'll reply within 48 hours.";
        note.style.color = 'var(--sage-deep)';
        form.reset();

        setTimeout(() => {
          btn.textContent = original;
          btn.disabled = false;
          btn.style.background = 'var(--gold)';
          btn.style.color = 'var(--espresso)';
          note.textContent = "I'll reply within 48 hours. Follow @fireandfaye for new drops.";
          note.style.color = '';
        }, 6000);
      } catch (err) {
        console.error('Enquiry failed:', err);
        fail('We could not reach the server. Please check your connection, or email us directly.');
      }
    }
    // Logo returns to the top without leaving a '#' in the address bar.
    document.getElementById('nav-logo-link').addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    renderCart();
