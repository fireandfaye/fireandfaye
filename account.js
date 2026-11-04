// Account page only: sign in with a one-time code, then your details and orders.
//
// No passwords. Receiving the code IS the proof of identity, which is why
// there is no separate signup, no reset flow and nothing to leak.
//
// The publishable key below is meant to be here — it is designed to sit in
// page source. What protects the data is the row-level security policy in
// Supabase: a customer reads only their own profile, and orders whose user_id
// is theirs or whose email matches their verified address.
//
// The address field is createAddressField() from app.js — the same one the
// cart uses, so a fix to address handling cannot land in one and not the other.

// SUPABASE_URL, the session helpers and supaApi() live in app.js, which
// loads first — the cart needs them too, for the checkout prefill.

const accountRoot = document.getElementById('account');
if (accountRoot) {
  const stepEmail  = document.getElementById('acc-step-email');
  const stepCode   = document.getElementById('acc-step-code');
  const stepIn     = document.getElementById('acc-step-in');
  const emailInput = document.getElementById('acc-email');
  const codeInput  = document.getElementById('acc-code');
  const sentToEl   = document.getElementById('acc-sent-to');
  const whoEl      = document.getElementById('acc-who');
  const ordersEl   = document.getElementById('acc-orders');
  const errorEl    = document.getElementById('acc-error');
  const noticeEl   = document.getElementById('acc-notice');
  const sendBtn    = document.getElementById('acc-send');
  const verifyBtn  = document.getElementById('acc-verify');
  const backBtn    = document.getElementById('acc-back');
  const signOutBtn = document.getElementById('acc-signout');
  const saveBtn    = document.getElementById('acc-save');
  const tabs       = Array.from(document.querySelectorAll('.account-tab'));
  const panels     = { details: document.getElementById('acc-panel-details'),
                       orders:  document.getElementById('acc-panel-orders') };

  let pendingEmail = '';
  let chosenAddress = null;   // set by the autocomplete, cleared on edit

  // session + API helpers come from app.js
  const load = loadSession, save = saveSession, clear = clearSession;
  const auth = supaAuth;
  const api  = supaApi;

  // ── rendering ──────────────────────────────────
  const showError  = (m) => { errorEl.textContent = m || ''; errorEl.hidden = !m; };
  const showNotice = (m) => { noticeEl.textContent = m || ''; noticeEl.hidden = !m; };
  const rands = (c) => 'R' + (c / 100).toFixed(2);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function show(step) {
    stepEmail.hidden = step !== 'email';
    stepCode.hidden  = step !== 'code';
    stepIn.hidden    = step !== 'in';
  }

  function showTab(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    Object.entries(panels).forEach(([k, el]) => { el.hidden = k !== name; });
  }
  tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

  function orderHtml(o) {
    const when = new Date(o.created_at).toLocaleDateString('en-ZA',
      { day: 'numeric', month: 'long', year: 'numeric' });
    const items = (o.order_items || []).map(i =>
      `<li>${i.quantity} &times; ${esc(i.name)}<span>${rands(i.unit_cents * i.quantity)}</span></li>`).join('');
    return `<article class="order">
        <div class="order-head">
          <div><p class="order-date">${when}</p><p class="order-total">${rands(o.total_cents)}</p></div>
          <span class="order-status order-status-${o.status}">${o.status}</span>
        </div>
        <ul class="order-items">${items}</ul>
        <p class="order-address">${esc(o.address || '').replace(/\n/g, '<br />')}</p>
      </article>`;
  }

  // ── signed in ──────────────────────────────────
  async function enter(session) {
    show('in');
    whoEl.textContent = session.email || '';
    showTab('details');

    // Bind guest orders to this account, so the link survives an email change.
    // Failing is not worth bothering the customer about — the email match still
    // shows the orders either way.
    api(session, 'rpc/claim_my_orders', { method: 'POST', body: '{}' })
      .catch(err => console.error('Could not claim guest orders:', err));

    loadProfile(session);
    loadOrders(session);
  }

  async function loadOrders(session) {
    ordersEl.innerHTML = '<p class="account-muted">Loading your orders&hellip;</p>';
    try {
      const orders = await api(session, 'orders?select=*,order_items(*)&order=created_at.desc');
      ordersEl.innerHTML = orders.length ? orders.map(orderHtml).join('')
        : '<p class="account-muted">No orders yet. Anything you buy will appear here.</p>';
    } catch (err) {
      clear(); show('email');
      showError('Your sign-in has expired. Please sign in again.');
    }
  }

  async function loadProfile(session) {
    try {
      const uid = userIdOf(session);
      if (!uid) return;
      const rows = await api(session, `profiles?id=eq.${uid}&select=*`);
      const p = (rows && rows[0]) || {};
      document.getElementById('acc-first').value = p.first_name || '';
      document.getElementById('acc-last').value  = p.last_name || '';
      document.getElementById('acc-phone').value = p.phone || '';
      document.getElementById('acc-extra').value = p.address_extra || '';
      if (p.place_id) {
        chosenAddress = { placeId: p.place_id, formattedAddress: p.address, province: p.province };
        if (addressField) {
          addressField.setValue(p.address);
          addressField.setStatus(`✓ ${p.province} address`);
        }
      }
    } catch (err) {
      console.error('Could not load your details:', err);
    }
  }

  async function saveProfile(session) {
    const first = document.getElementById('acc-first').value.trim();
    if (!first) { showError('Please enter your name.'); return; }
    showError(''); showNotice('');
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    const uid = userIdOf(session);
    if (!uid) {
      showError('Your sign-in has expired. Please sign out and in again.');
      saveBtn.disabled = false; saveBtn.textContent = 'Save details';
      return;
    }
    const body = {
      id: uid,
      first_name: first,
      last_name: document.getElementById('acc-last').value.trim() || null,
      phone: document.getElementById('acc-phone').value.trim() || null,
      address_extra: document.getElementById('acc-extra').value.trim() || null,
      place_id: chosenAddress ? chosenAddress.placeId : null,
      address: chosenAddress ? chosenAddress.formattedAddress : null,
      province: chosenAddress ? chosenAddress.province : null,
    };
    try {
      await api(session, 'profiles', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(body),
      });
      showNotice('Your details are saved.');
    } catch (err) {
      console.error('Saving the profile failed:', err);
      // PostgREST puts the reason in the body; show it rather than a blanket
      // message, so a policy or constraint problem is diagnosable.
      let detail = '';
      try { detail = (JSON.parse(String(err.message)).message || '').trim(); } catch (e) {}
      showError(detail ? `Could not save your details: ${detail}` : 'Could not save your details. Please try again.');
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = 'Save details';
    }
  }

  // ── the address field, shared with the cart ────
  const addressField = typeof createAddressField === 'function' ? createAddressField({
    input:  document.getElementById('acc-address'),
    list:   document.getElementById('acc-addr-suggest'),
    status: document.getElementById('acc-addr-status'),
    onChoose: (addr) => { chosenAddress = addr; },
    onEdit:   () => { chosenAddress = null; },
  }) : null;

  // ── sign in ────────────────────────────────────
  async function sendCode() {
    const email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('Please enter a valid email address.'); return; }
    showError('');
    sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
    try {
      await auth('otp', { email, create_user: true });
      pendingEmail = email;
      sentToEl.textContent = email;
      show('code');
      codeInput.focus();
    } catch (err) { showError(err.message); }
    finally { sendBtn.disabled = false; sendBtn.textContent = 'Email me a code'; }
  }

  async function verifyCode() {
    // Supabase's OTP length is a dashboard setting, so accept a range rather
    // than hardcoding one — a field that refuses the last digits of a valid
    // code is a miserable bug to diagnose.
    const token = codeInput.value.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) { showError('Please enter the code from your email.'); return; }
    showError('');
    verifyBtn.disabled = true; verifyBtn.textContent = 'Checking…';
    try {
      const d = await auth('verify', { type: 'email', email: pendingEmail, token });
      const session = { access_token: d.access_token, refresh_token: d.refresh_token,
                        email: (d.user && d.user.email) || pendingEmail,
                        user_id: d.user && d.user.id };
      save(session);
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
    clear();
    showError('');
    // Confirm before leaving, so it is clear something happened rather than
    // the page simply changing underneath them.
    showNotice('You\u2019ve been signed out.');
    setTimeout(() => { window.location.href = '/'; }, 1200);
  });
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCode(); });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyCode(); });

  const existing = load();
  if (existing && existing.access_token) {
    saveBtn.addEventListener('click', () => saveProfile(existing));
    enter(existing);
  } else {
    show('email');
    saveBtn.addEventListener('click', () => {
      const s = load();
      if (s) saveProfile(s);
    });
  }
}
