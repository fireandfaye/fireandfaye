// Account page only: sign in with a one-time code, then see your orders.
//
// No passwords. Receiving the code IS the proof of identity, which is why
// there is no separate signup, no reset flow and nothing to leak.
//
// The publishable key below is meant to be here — it is designed to sit in
// page source. What protects the data is the row-level security policy in
// Supabase: a signed-in customer can read orders whose user_id is theirs, or
// whose email matches their verified address. Everyone else gets nothing.

const SUPABASE_URL = 'https://wscfombaipghblbudeyp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_v2UNHfrEEbCL13GhshgQuQ_rmG0Xj9k';
const SESSION_KEY  = 'ff_session';

const accountRoot = document.getElementById('account');
if (accountRoot) {
  const stepEmail  = document.getElementById('acc-step-email');
  const stepCode   = document.getElementById('acc-step-code');
  const stepOrders = document.getElementById('acc-step-orders');
  const emailInput = document.getElementById('acc-email');
  const codeInput  = document.getElementById('acc-code');
  const sentToEl   = document.getElementById('acc-sent-to');
  const whoEl      = document.getElementById('acc-who');
  const ordersEl   = document.getElementById('acc-orders');
  const errorEl    = document.getElementById('acc-error');
  const sendBtn    = document.getElementById('acc-send');
  const verifyBtn  = document.getElementById('acc-verify');
  const backBtn    = document.getElementById('acc-back');
  const signOutBtn = document.getElementById('acc-signout');

  let pendingEmail = '';

  // ── session ────────────────────────────────────
  // localStorage throws in private mode and with site data blocked, so every
  // access is guarded — the page must still render, just signed out.
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function saveSession(s) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  // ── talking to Supabase ────────────────────────
  async function auth(path, body) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.msg || data.error_description || data.message || 'Something went wrong.');
    return data;
  }

  async function refreshSession(session) {
    const data = await auth('token?grant_type=refresh_token', {
      refresh_token: session.refresh_token,
    });
    const next = { access_token: data.access_token, refresh_token: data.refresh_token, email: session.email };
    saveSession(next);
    return next;
  }

  // Fetches the customer's own orders, with their line items in one request.
  // Retries once after refreshing, because an access token lasts an hour and
  // people come back to this page days later.
  async function fetchOrders(session, allowRetry = true) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?select=*,order_items(*)&order=created_at.desc`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` } }
    );
    if (r.status === 401 && allowRetry && session.refresh_token) {
      const fresh = await refreshSession(session);
      return fetchOrders(fresh, false);
    }
    if (!r.ok) throw new Error('Could not load your orders.');
    return r.json();
  }

  // ── rendering ──────────────────────────────────
  function showError(msg) {
    errorEl.textContent = msg || '';
    errorEl.hidden = !msg;
  }

  function show(step) {
    stepEmail.hidden  = step !== 'email';
    stepCode.hidden   = step !== 'code';
    stepOrders.hidden = step !== 'orders';
  }

  const rands = (cents) => 'R' + (cents / 100).toFixed(2);

  function orderHtml(order) {
    const when = new Date(order.created_at).toLocaleDateString('en-ZA', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const items = (order.order_items || []).map((i) =>
      `<li>${i.quantity} &times; ${escapeHtml(i.name)}<span>${rands(i.unit_cents * i.quantity)}</span></li>`
    ).join('');

    return `
      <article class="order">
        <div class="order-head">
          <div>
            <p class="order-date">${when}</p>
            <p class="order-total">${rands(order.total_cents)}</p>
          </div>
          <span class="order-status order-status-${order.status}">${order.status}</span>
        </div>
        <ul class="order-items">${items}</ul>
        <p class="order-address">${escapeHtml(order.address || '').replace(/\n/g, '<br />')}</p>
      </article>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  async function showOrders(session) {
    show('orders');
    whoEl.textContent = session.email || '';
    ordersEl.innerHTML = '<p class="account-muted">Loading your orders&hellip;</p>';
    try {
      const orders = await fetchOrders(session);
      ordersEl.innerHTML = orders.length
        ? orders.map(orderHtml).join('')
        : '<p class="account-muted">No orders yet. Anything you buy will appear here.</p>';
    } catch (err) {
      // An expired session that could not be refreshed lands here.
      clearSession();
      show('email');
      showError('Your sign-in has expired. Please sign in again.');
    }
  }

  // ── actions ────────────────────────────────────
  async function sendCode() {
    const email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('Please enter a valid email address.');
      return;
    }
    showError('');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    try {
      await auth('otp', { email, create_user: true });
      pendingEmail = email;
      sentToEl.textContent = email;
      show('code');
      codeInput.focus();
    } catch (err) {
      showError(err.message);
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Email me a code';
    }
  }

  async function verifyCode() {
    // Supabase's OTP length is configurable (6-10). Accepting a range rather
    // than hardcoding one means changing that setting cannot break sign-in.
    const token = codeInput.value.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) {
      showError('Please enter the code from your email.');
      return;
    }
    showError('');
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Checking…';
    try {
      const data = await auth('verify', { type: 'email', email: pendingEmail, token });
      const session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        email: (data.user && data.user.email) || pendingEmail,
      };
      saveSession(session);
      codeInput.value = '';
      await showOrders(session);
    } catch (err) {
      showError('That code was not right, or it has expired. Try again.');
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Sign in';
    }
  }

  sendBtn.addEventListener('click', sendCode);
  verifyBtn.addEventListener('click', verifyCode);
  backBtn.addEventListener('click', () => { showError(''); show('email'); });
  signOutBtn.addEventListener('click', () => {
    clearSession();
    showError('');
    show('email');
  });

  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCode(); });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyCode(); });

  // ── on load ────────────────────────────────────
  const existing = loadSession();
  if (existing && existing.access_token) showOrders(existing);
  else show('email');
}
