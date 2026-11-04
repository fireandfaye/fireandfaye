// Admin page only: Paige signs in the same way customers do, and then sees
// every order and every member.
//
// Phase 1 of §19, read-only. Editing products comes next, on top of this.
//
// What keeps this page shut is NOT that it is unlisted and NOT the check
// below. It is the row-level security policies in supabase-admin.sql: without
// a row in `admins`, the same queries this page runs return nothing at all.
// The check exists to show an honest message instead of an empty table.
//
// SUPABASE_URL, the session helpers and supaApi() live in app.js, which loads
// first. Nothing here may redeclare them — two `const SUPABASE_URL` in one
// scope is a SyntaxError that silently kills the whole file.

const adminRoot = document.getElementById('admin');
if (adminRoot) {
  const stepEmail  = document.getElementById('adm-step-email');
  const stepCode   = document.getElementById('adm-step-code');
  const stepIn     = document.getElementById('adm-step-in');
  const stepDenied = document.getElementById('adm-denied');
  const emailInput = document.getElementById('adm-email');
  const codeInput  = document.getElementById('adm-code');
  const sentToEl   = document.getElementById('adm-sent-to');
  const whoEl      = document.getElementById('adm-who');
  const errorEl    = document.getElementById('adm-error');
  const noticeEl   = document.getElementById('adm-notice');
  const sendBtn    = document.getElementById('adm-send');
  const verifyBtn  = document.getElementById('adm-verify');
  const backBtn    = document.getElementById('adm-back');
  const signOutBtn = document.getElementById('adm-signout');
  const ordersEl   = document.getElementById('adm-orders');
  const membersEl  = document.getElementById('adm-members');
  const statusSel  = document.getElementById('adm-status');
  const searchBox  = document.getElementById('adm-search');
  const ordersSum  = document.getElementById('adm-orders-summary');
  const membersSum = document.getElementById('adm-members-summary');
  const tabs       = Array.from(document.querySelectorAll('.admin-tab'));
  const panels     = { products: document.getElementById('adm-panel-products'),
                       orders:   document.getElementById('adm-panel-orders'),
                       members:  document.getElementById('adm-panel-members') };

  // Same Vercel project as checkout; it already holds the secrets this needs.
  const PUBLISH_ENDPOINT = 'https://fireandfaye-yoco-backend.vercel.app/api/publish';

  let adminSession = null;
  let pendingEmail = '';
  let allOrders = [];
  let allProducts = [];
  let editing = null;      // the product open in the editor
  let editImages = [];     // its photos, in display order, unsaved

  const showError  = (m) => { errorEl.textContent = m || ''; errorEl.hidden = !m; };
  const showNotice = (m) => { noticeEl.textContent = m || ''; noticeEl.hidden = !m; };
  const rands = (c) => 'R' + ((c || 0) / 100).toFixed(2);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (d) => d ? new Date(d).toLocaleDateString('en-ZA',
    { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  function show(step) {
    stepEmail.hidden  = step !== 'email';
    stepCode.hidden   = step !== 'code';
    stepIn.hidden     = step !== 'in';
    stepDenied.hidden = step !== 'denied';
  }

  function showTab(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    Object.entries(panels).forEach(([k, el]) => { el.hidden = k !== name; });
  }
  tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ── signed in ──────────────────────────────────
  async function enter(session) {
    whoEl.textContent = session.email || '';

    // Ask the database, not the page. is_admin() reads a table the browser
    // cannot, so this answer cannot be faked by editing anything client-side.
    let admin = false;
    try {
      admin = await supaApi(session, 'rpc/is_admin', { method: 'POST', body: '{}' });
    } catch (err) {
      console.error('Could not check admin access:', err);
      clearSession(); show('email');
      showError('Your sign-in has expired. Please sign in again.');
      return;
    }
    if (!admin) { show('denied'); return; }

    show('in');
    showTab('products');
    adminSession = session;
    loadProducts(session);
    loadOrders(session);
    loadMembers(session);
  }

  // ── orders ─────────────────────────────────────
  async function loadOrders(session) {
    ordersEl.innerHTML = '<p class="admin-muted">Loading orders&hellip;</p>';
    try {
      allOrders = await supaApi(session,
        'orders?select=*,order_items(*)&order=created_at.desc');
      renderOrders();
    } catch (err) {
      console.error('Could not load orders:', err);
      ordersEl.innerHTML = '<p class="admin-muted">Could not load orders. Reload the page to try again.</p>';
    }
  }

  function matchesFilters(o) {
    const status = statusSel.value;
    if (status !== 'all' && o.status !== status) return false;
    const q = searchBox.value.trim().toLowerCase();
    if (!q) return true;
    const hay = [o.name, o.email, o.phone, o.address, o.province,
                 ...(o.order_items || []).map(i => i.name)].join(' ').toLowerCase();
    return hay.includes(q);
  }

  function orderHtml(o) {
    const items = (o.order_items || []).map(i =>
      `<li>${i.quantity} &times; ${esc(i.name)}<span>${rands(i.unit_cents * i.quantity)}</span></li>`).join('');
    const addr = [o.address, o.address_extra].filter(Boolean).join('\n');
    return `<article class="admin-order">
        <div class="admin-order-head">
          <div>
            <p class="admin-order-who">${esc(o.name)}</p>
            <p class="admin-order-meta">${when(o.created_at)} &middot; ${esc(o.email)} &middot; ${esc(o.phone)}</p>
          </div>
          <div class="admin-order-right">
            <p class="admin-order-total">${rands(o.total_cents)}</p>
            <span class="order-status order-status-${esc(o.status)}">${esc(o.status)}</span>
          </div>
        </div>
        <ul class="order-items">${items}</ul>
        <p class="admin-order-addr">${esc(addr).replace(/\n/g, '<br />')}${
          o.province ? ', ' + esc(o.province) : ''}</p>
        ${o.note ? `<p class="admin-order-note">Note: ${esc(o.note)}</p>` : ''}
      </article>`;
  }

  function renderOrders() {
    const rows = allOrders.filter(matchesFilters);
    const paid = rows.filter(o => o.status === 'paid');
    const cents = paid.reduce((n, o) => n + (o.total_cents || 0), 0);
    ordersSum.textContent = rows.length
      ? `${rows.length} order${rows.length === 1 ? '' : 's'} · ${paid.length} paid · ${rands(cents)} taken`
      : '';
    ordersEl.innerHTML = rows.length ? rows.map(orderHtml).join('')
      : '<p class="admin-muted">No orders match that filter.</p>';
  }

  statusSel.addEventListener('change', renderOrders);
  searchBox.addEventListener('input', renderOrders);

  // ── members ────────────────────────────────────
  async function loadMembers(session) {
    membersEl.innerHTML = '<p class="admin-muted">Loading members&hellip;</p>';
    try {
      const rows = await supaApi(session, 'rpc/admin_members', { method: 'POST', body: '{}' });
      membersSum.textContent = rows.length
        ? `${rows.length} member${rows.length === 1 ? '' : 's'}` : '';
      membersEl.innerHTML = rows.length ? rows.map(m => {
        const name = [m.first_name, m.last_name].filter(Boolean).join(' ') || '—';
        const addr = [m.address, m.address_extra, m.province].filter(Boolean).join(', ');
        return `<article class="admin-member">
            <div class="admin-member-head">
              <div>
                <p class="admin-order-who">${esc(name)}</p>
                <p class="admin-order-meta">${esc(m.email)}${
                  m.phone ? ' &middot; ' + esc(m.phone) : ''}</p>
              </div>
              <div class="admin-order-right">
                <p class="admin-order-total">${rands(m.paid_cents)}</p>
                <p class="admin-order-meta">${m.orders_count} order${m.orders_count === 1 ? '' : 's'}</p>
              </div>
            </div>
            <p class="admin-order-addr">${addr ? esc(addr) : 'No address saved'}</p>
            <p class="admin-order-meta">Joined ${when(m.joined_at)}${
              m.last_order_at ? ' &middot; last ordered ' + when(m.last_order_at) : ''}</p>
          </article>`;
      }).join('') : '<p class="admin-muted">No members yet.</p>';
    } catch (err) {
      console.error('Could not load members:', err);
      membersEl.innerHTML = '<p class="admin-muted">Could not load members. Reload the page to try again.</p>';
    }
  }

  // ── products ───────────────────────────────────
  const prodCat    = document.getElementById('adm-prod-cat');
  const prodSearch = document.getElementById('adm-prod-search');
  const prodSum    = document.getElementById('adm-prod-summary');
  const prodList   = document.getElementById('adm-products');
  const editor     = document.getElementById('adm-editor');
  const editTitle  = document.getElementById('adm-edit-title');
  const photosEl   = document.getElementById('adm-photos');
  const photoInput = document.getElementById('adm-f-photo');
  const photoStat  = document.getElementById('adm-photo-status');
  const saveBtn    = document.getElementById('adm-save');
  const saveStat   = document.getElementById('adm-save-status');
  const f = (id) => document.getElementById('adm-f-' + id);

  async function loadProducts(session) {
    prodList.innerHTML = '<p class="admin-muted">Loading products&hellip;</p>';
    try {
      allProducts = await supaApi(session,
        'products?select=*,product_images(*)&order=category.asc,name.asc');
      allProducts.forEach(p => (p.product_images || []).sort((a, b) => a.position - b.position));
      renderProducts();
    } catch (err) {
      console.error('Could not load products:', err);
      prodList.innerHTML = '<p class="admin-muted">Could not load products. If the product tables have not been created yet, that is expected.</p>';
    }
  }

  function renderProducts() {
    const cat = prodCat.value, q = prodSearch.value.trim().toLowerCase();
    const rows = allProducts.filter(p =>
      (cat === 'all' || p.category === cat) &&
      (!q || (p.name + ' ' + p.description).toLowerCase().includes(q)));
    prodSum.textContent = rows.length
      ? `${rows.length} product${rows.length === 1 ? '' : 's'}` : '';
    prodList.innerHTML = rows.length ? rows.map(p => {
      const imgs = p.product_images || [];
      return `<button class="admin-prod" type="button" data-id="${esc(p.id)}">
          <span class="admin-prod-main">
            <span class="admin-prod-name">${esc(p.name)}</span>
            <span class="admin-order-meta">${esc(p.category)} &middot; ${imgs.length} photo${imgs.length === 1 ? '' : 's'}${
              p.is_listed ? '' : ' &middot; hidden'}</span>
          </span>
          <span class="admin-prod-price">${rands(p.price_cents)}</span>
        </button>`;
    }).join('') : '<p class="admin-muted">No products match that filter.</p>';
    prodList.querySelectorAll('.admin-prod').forEach(b =>
      b.addEventListener('click', () => openEditor(b.dataset.id)));
  }

  prodCat.addEventListener('change', renderProducts);
  prodSearch.addEventListener('input', renderProducts);

  function openEditor(id) {
    editing = allProducts.find(p => p.id === id);
    if (!editing) return;
    editImages = (editing.product_images || []).map(i => ({ ...i }));
    editTitle.textContent = editing.name;
    f('name').value  = editing.name;
    f('cat').value   = editing.category;
    f('price').value = (editing.price_cents / 100).toFixed(2);
    f('qty').value   = editing.qty_available == null ? '' : editing.qty_available;
    f('desc').value  = editing.description || '';
    f('listed').checked = !!editing.is_listed;
    saveStat.textContent = ''; photoStat.textContent = '';
    renderPhotos();
    prodList.hidden = true;
    document.querySelector('#adm-panel-products .admin-filters').hidden = true;
    prodSum.hidden = true;
    editor.hidden = false;
    window.scrollTo(0, 0);
  }

  function closeEditor() {
    editor.hidden = true;
    prodList.hidden = false;
    document.querySelector('#adm-panel-products .admin-filters').hidden = false;
    prodSum.hidden = false;
    editing = null;
  }
  document.getElementById('adm-edit-back').addEventListener('click', closeEditor);

  // A published photo is already a file on the site, so its path works as-is.
  // One still in the bucket needs a signed URL — the bucket is private.
  async function photoSrc(img) {
    if (img.published_path) return img.published_path;
    if (img.objectUrl) return img.objectUrl;
    try {
      const r = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/product-photos/${img.storage_path}`,
        { method: 'POST',
          headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json',
                     Authorization: 'Bearer ' + adminSession.access_token },
          body: JSON.stringify({ expiresIn: 3600 }) });
      if (!r.ok) return '';
      const d = await r.json();
      return SUPABASE_URL + '/storage/v1' + d.signedURL;
    } catch (e) { return ''; }
  }

  async function renderPhotos() {
    photosEl.innerHTML = editImages.length
      ? '' : '<p class="admin-muted">No photos yet.</p>';
    for (let n = 0; n < editImages.length; n++) {
      const img = editImages[n];
      const src = await photoSrc(img);
      const el = document.createElement('div');
      el.className = 'admin-photo';
      el.innerHTML = `
        <img src="${esc(src)}" alt="" loading="lazy" />
        <div class="admin-photo-bar">
          <span>${n === 0 ? 'Main' : n + 1}</span>
          <button type="button" data-act="up"   data-n="${n}" aria-label="Move earlier"${n === 0 ? ' disabled' : ''}>&uarr;</button>
          <button type="button" data-act="down" data-n="${n}" aria-label="Move later"${n === editImages.length - 1 ? ' disabled' : ''}>&darr;</button>
          <button type="button" data-act="del"  data-n="${n}" aria-label="Remove">&times;</button>
        </div>`;
      photosEl.appendChild(el);
    }
    photosEl.querySelectorAll('button[data-act]').forEach(b =>
      b.addEventListener('click', () => {
        const n = +b.dataset.n;
        if (b.dataset.act === 'del') editImages.splice(n, 1);
        if (b.dataset.act === 'up')   [editImages[n - 1], editImages[n]] = [editImages[n], editImages[n - 1]];
        if (b.dataset.act === 'down') [editImages[n + 1], editImages[n]] = [editImages[n], editImages[n + 1]];
        renderPhotos();
      }));
  }

  // Resize here, in the browser, rather than in the publish job: the build
  // runs on a GitHub runner with no image library installed, and uploading a
  // 4 MB phone photo to resize later wastes her data for no gain.
  const TARGET_W = 900, TARGET_H = 1200, JPEG_Q = 0.82;

  function resize(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        const scale = Math.max(TARGET_W / im.width, TARGET_H / im.height);
        const w = Math.round(im.width * scale), h = Math.round(im.height * scale);
        const c = document.createElement('canvas');
        c.width = TARGET_W; c.height = TARGET_H;
        // Cover-crop, centred — the same crop sips does in import-products.py.
        c.getContext('2d').drawImage(im, (TARGET_W - w) / 2, (TARGET_H - h) / 2, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? resolve(b) : reject(new Error('Could not read that image')),
                 'image/jpeg', JPEG_Q);
      };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      im.src = url;
    });
  }

  photoInput.addEventListener('change', async () => {
    const files = Array.from(photoInput.files || []);
    photoInput.value = '';
    if (!files.length || !editing) return;
    photoStat.textContent = `Uploading 0 of ${files.length}…`;
    for (let i = 0; i < files.length; i++) {
      try {
        const blob = await resize(files[i]);
        const path = `${editing.id}/${Date.now()}-${i}.jpg`;
        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/product-photos/${path}`, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, 'Content-Type': 'image/jpeg',
                     Authorization: 'Bearer ' + adminSession.access_token },
          body: blob });
        if (!r.ok) throw new Error(await r.text());
        editImages.push({ storage_path: path, published_path: null,
                          width: TARGET_W, height: TARGET_H,
                          objectUrl: URL.createObjectURL(blob) });
        photoStat.textContent = `Uploading ${i + 1} of ${files.length}…`;
      } catch (err) {
        console.error('Upload failed:', err);
        photoStat.textContent = 'That photo could not be uploaded. Try again.';
        return;
      }
    }
    photoStat.textContent = `${files.length} photo${files.length === 1 ? '' : 's'} added. Save to publish.`;
    renderPhotos();
  });

  async function saveProduct() {
    if (!editing) return;
    const price = parseFloat(String(f('price').value).replace(/[^0-9.]/g, ''));
    if (!f('name').value.trim()) { saveStat.textContent = 'The product needs a name.'; return; }
    if (!isFinite(price) || price < 0) { saveStat.textContent = 'That price does not look right.'; return; }
    if (!editImages.length && f('listed').checked) {
      saveStat.textContent = 'A product shown on the site needs at least one photo.'; return;
    }
    const qtyRaw = String(f('qty').value).replace(/[^0-9]/g, '');

    saveBtn.disabled = true; saveStat.textContent = 'Saving…';
    try {
      await supaApi(adminSession, 'rpc/admin_save_product', {
        method: 'POST',
        body: JSON.stringify({
          p_id: editing.id,
          p_name: f('name').value.trim(),
          p_category: f('cat').value,
          p_description: f('desc').value.trim(),
          p_price_cents: Math.round(price * 100),
          p_qty: qtyRaw === '' ? null : parseInt(qtyRaw, 10),
          p_is_listed: f('listed').checked,
          p_images: editImages.map(i => ({
            id: i.id, storage_path: i.storage_path || null,
            published_path: i.published_path || null,
            width: i.width, height: i.height })),
        }),
      });
      saveStat.textContent = 'Saved. Publishing to the site…';
      await publish();
      await loadProducts(adminSession);
      closeEditor();
    } catch (err) {
      console.error('Save failed:', err);
      let detail = '';
      try { detail = (JSON.parse(String(err.message)).message || '').trim(); } catch (e) {}
      saveStat.textContent = detail ? `Could not save: ${detail}` : 'Could not save. Please try again.';
    } finally { saveBtn.disabled = false; }
  }
  saveBtn.addEventListener('click', saveProduct);

  // ── publishing ─────────────────────────────────
  async function publish() {
    try {
      await supaApi(adminSession, 'publish_runs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ requested_by: userIdOf(adminSession) }),
      });
    } catch (err) {
      console.error('Could not record the publish request:', err);
    }
    try {
      const r = await fetch(PUBLISH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   Authorization: 'Bearer ' + adminSession.access_token },
      });
      if (!r.ok) throw new Error(await r.text());
      saveStat.textContent = 'Saved. The site updates in a few minutes.';
    } catch (err) {
      console.error('Publish request failed:', err);
      saveStat.textContent = 'Saved, but the publish did not start. Try saving again.';
    }
  }

  // ── sign in ────────────────────────────────────
  async function sendCode() {
    const email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('Please enter a valid email address.'); return; }
    showError('');
    sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
    try {
      // create_user false: the admin page is not a place to make new accounts.
      await supaAuth('otp', { email, create_user: false });
      pendingEmail = email;
      sentToEl.textContent = email;
      show('code');
      codeInput.focus();
    } catch (err) { showError(err.message); }
    finally { sendBtn.disabled = false; sendBtn.textContent = 'Email me a code'; }
  }

  async function verifyCode() {
    const token = codeInput.value.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) { showError('Please enter the code from your email.'); return; }
    showError('');
    verifyBtn.disabled = true; verifyBtn.textContent = 'Checking…';
    try {
      const d = await supaAuth('verify', { type: 'email', email: pendingEmail, token });
      const session = { access_token: d.access_token, refresh_token: d.refresh_token,
                        email: (d.user && d.user.email) || pendingEmail,
                        user_id: d.user && d.user.id };
      saveSession(session);
      codeInput.value = '';
      await enter(session);
    } catch (err) {
      showError('That code was not right, or it has expired. Try again.');
    } finally { verifyBtn.disabled = false; verifyBtn.textContent = 'Sign in'; }
  }

  sendBtn.addEventListener('click', sendCode);
  verifyBtn.addEventListener('click', verifyCode);
  backBtn.addEventListener('click', () => { showError(''); show('email'); });
  signOutBtn.addEventListener('click', () => {
    clearSession();
    showError('');
    showNotice('You’ve been signed out.');
    setTimeout(() => { window.location.href = '/'; }, 1200);
  });
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCode(); });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyCode(); });

  const existing = loadSession();
  if (existing && existing.access_token) enter(existing); else show('email');
}
