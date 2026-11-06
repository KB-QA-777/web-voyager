'use strict';
/**
 * Minimal ticket app used as the system-under-test.
 *
 * - Cookie sessions, two fixed TEST accounts (no real data).
 * - Tickets live in memory; every run starts a fresh process, so state never leaks between runs.
 * - Saves are last-write-wins: the server applies updates in arrival order and records the winner.
 * - Server-Sent Events push "updated" / "deleted" to every open ticket page (live sync).
 * - Saving a deleted ticket is rejected with 410 so the UI can show "Record no longer exists".
 */
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

const USERS = {
  'usera.test': { password: 'test-password-a', display: 'User A' },
  'userb.test': { password: 'test-password-b', display: 'User B' },
};

const sessions = new Map(); // sid -> username
const tickets = new Map(); // id -> ticket
const subscribers = new Map(); // ticketId -> Set<res>

function log(...args) {
  process.stdout.write(`[app ${new Date().toISOString()}] ${args.join(' ')}\n`);
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

function currentUser(req) {
  const sid = parseCookies(req).sid;
  return sid && sessions.get(sid) ? sessions.get(sid) : null;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string';
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function broadcast(ticketId, event, payload) {
  const subs = subscribers.get(ticketId);
  if (!subs) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of subs) res.write(frame);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const loginPage = (error = '') => `<!doctype html><html><head><title>Login</title></head><body>
<h1>Ticket Tracker (test instance)</h1>
<form method="post" action="/login">
  <label>Username <input name="username" autocomplete="off"></label>
  <label>Password <input name="password" type="password"></label>
  <button type="submit">Sign in</button>
</form>
${error ? `<p role="alert" data-testid="login-error">${esc(error)}</p>` : ''}
</body></html>`;

const ticketPage = (t, user) => `<!doctype html><html><head><title>${esc(t.id)}</title>
<style>body{font-family:sans-serif;max-width:640px;margin:2rem auto} label{display:block;margin:.5rem 0} .msg{padding:.5rem;border:1px solid} .error{border-color:#c00;color:#c00} .ok{border-color:#080;color:#080}</style>
</head><body>
<header>Signed in as <strong data-testid="current-user">${esc(user)}</strong></header>
<h1 data-testid="ticket-id">${esc(t.id)}</h1>
<form id="ticket-form">
  <label>Title <input name="title" data-testid="title" value="${esc(t.title)}"></label>
  <label>Status
    <select name="status" data-testid="status">
      ${['Open', 'In Progress', 'In Review', 'Done'].map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
  </label>
  <label>Priority
    <select name="priority" data-testid="priority">
      ${['Low', 'Medium', 'High'].map((s) => `<option ${s === t.priority ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
  </label>
  <button type="submit" data-testid="save">Save</button>
  <button type="button" data-testid="delete">Delete</button>
</form>
<p>Version <span data-testid="version">${t.version}</span> · last edited by <span data-testid="last-editor">${esc(t.updatedBy)}</span></p>
<p><a href="/tickets/${esc(t.id)}/print" target="_blank" data-testid="print-preview">Print preview</a></p>
<div data-testid="message" class="msg" hidden></div>
<script>
(function () {
  const id = ${JSON.stringify(t.id)};
  const form = document.getElementById('ticket-form');
  const msg = document.querySelector('[data-testid=message]');
  function show(text, cls) { msg.textContent = text; msg.className = 'msg ' + cls; msg.hidden = false; }
  let seenVersion = Number(document.querySelector('[data-testid=version]').textContent);
  // Fields the user changed since the last successful save. Live updates must never clobber them.
  const dirty = new Set();
  form.addEventListener('input', (e) => dirty.add(e.target.name));
  form.addEventListener('change', (e) => dirty.add(e.target.name));
  function apply(t, { keepDirty = true } = {}) {
    // Ignore anything older than what is already on screen: a save response and a live
    // event for a later save can arrive in either order.
    if (t.version < seenVersion) return; seenVersion = t.version;
    for (const f of ['title', 'status', 'priority']) {
      if (keepDirty && dirty.has(f)) continue;
      form[f].value = t[f];
    }
    document.querySelector('[data-testid=version]').textContent = t.version;
    document.querySelector('[data-testid=last-editor]').textContent = t.updatedBy;
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { title: form.title.value, status: form.status.value, priority: form.priority.value };
    const r = await fetch('/api/tickets/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 410 || r.status === 404) { show('Record no longer exists', 'error'); return; }
    if (!r.ok) { show('Save failed (' + r.status + ')', 'error'); return; }
    const t = await r.json(); dirty.clear(); apply(t, { keepDirty: false }); show('Saved', 'ok');
  });
  document.querySelector('[data-testid=delete]').addEventListener('click', async () => {
    const r = await fetch('/api/tickets/' + id, { method: 'DELETE' });
    if (r.ok) { show('Ticket deleted', 'ok'); form.querySelector('[data-testid=save]').disabled = true; }
  });
  // Live sync: the server pushes updates made by other sessions. Only the form fields that
  // the current user is NOT editing are refreshed, so unsaved edits are kept.
  const es = new EventSource('/api/tickets/' + id + '/events');
  es.addEventListener('updated', (ev) => {
    apply(JSON.parse(ev.data)); // dirty (unsaved) fields are preserved inside apply()
    const t = JSON.parse(ev.data);
    document.body.dataset.lastEvent = 'updated:' + t.version;
  });
  es.addEventListener('deleted', () => { document.body.dataset.lastEvent = 'deleted'; });
  es.addEventListener('open', () => { document.body.dataset.live = 'connected'; });
})();
</script>
</body></html>`;

const printPage = (t) => `<!doctype html><html><head><title>Print ${esc(t.id)}</title></head><body>
<h1 data-testid="print-ticket-id">${esc(t.id)}</h1>
<dl><dt>Title</dt><dd data-testid="print-title">${esc(t.title)}</dd>
<dt>Status</dt><dd data-testid="print-status">${esc(t.status)}</dd>
<dt>Priority</dt><dd data-testid="print-priority">${esc(t.priority)}</dd></dl>
</body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const user = currentUser(req);

  if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, tickets: tickets.size });

  if (path === '/login') {
    if (req.method === 'GET') return send(res, 200, loginPage());
    const params = new URLSearchParams(await readBody(req));
    const u = params.get('username');
    if (USERS[u] && USERS[u].password === params.get('password')) {
      const sid = crypto.randomBytes(16).toString('hex');
      sessions.set(sid, u);
      log(`login ok user=${u}`);
      return send(res, 302, '', { Location: '/', 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly` });
    }
    return send(res, 401, loginPage('Invalid credentials'));
  }

  // Everything below needs a session.
  if (!user) {
    if (path.startsWith('/api/')) return send(res, 401, { error: 'unauthenticated' });
    return send(res, 302, '', { Location: '/login' });
  }

  if (req.method === 'GET' && path === '/') {
    return send(res, 200, `<!doctype html><html><body><h1>Tickets</h1><ul>${[...tickets.keys()].map((id) => `<li><a href="/tickets/${esc(id)}">${esc(id)}</a></li>`).join('')}</ul></body></html>`);
  }

  // --- JSON API ---
  let m;
  if ((m = path.match(/^\/api\/tickets\/([\w-]+)\/events$/)) && req.method === 'GET') {
    const id = m[1];
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    if (!subscribers.has(id)) subscribers.set(id, new Set());
    subscribers.get(id).add(res);
    req.on('close', () => subscribers.get(id)?.delete(res));
    return;
  }
  if ((m = path.match(/^\/api\/tickets\/([\w-]+)$/))) {
    const id = m[1];
    if (req.method === 'GET') {
      return tickets.has(id) ? send(res, 200, tickets.get(id)) : send(res, 404, { error: 'not found' });
    }
    if (req.method === 'PUT') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!tickets.has(id)) {
        log(`save rejected id=${id} user=${user} reason=deleted`);
        return send(res, 410, { error: 'Record no longer exists' });
      }
      const t = tickets.get(id);
      Object.assign(t, { title: body.title ?? t.title, status: body.status ?? t.status, priority: body.priority ?? t.priority });
      t.version += 1;
      t.updatedBy = user;
      t.updatedAt = Date.now();
      log(`save applied id=${id} user=${user} version=${t.version} priority=${t.priority} status=${t.status}`);
      broadcast(id, 'updated', t);
      return send(res, 200, t);
    }
    if (req.method === 'DELETE') {
      if (!tickets.has(id)) return send(res, 404, { error: 'not found' });
      tickets.delete(id);
      log(`deleted id=${id} user=${user}`);
      broadcast(id, 'deleted', { id });
      return send(res, 204, '');
    }
  }
  if (path === '/api/tickets' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (!body.id) return send(res, 400, { error: 'id required' });
    if (tickets.has(body.id)) return send(res, 409, { error: 'already exists' });
    const t = { id: body.id, title: body.title || '', status: body.status || 'Open', priority: body.priority || 'Medium', version: 1, updatedBy: user, updatedAt: Date.now() };
    tickets.set(t.id, t);
    log(`created id=${t.id} user=${user}`);
    return send(res, 201, t);
  }

  // --- HTML pages ---
  if ((m = path.match(/^\/tickets\/([\w-]+)\/print$/)) && req.method === 'GET') {
    const t = tickets.get(m[1]);
    return t ? send(res, 200, printPage(t)) : send(res, 404, '<h1>Not found</h1>');
  }
  if ((m = path.match(/^\/tickets\/([\w-]+)$/)) && req.method === 'GET') {
    const t = tickets.get(m[1]);
    return t ? send(res, 200, ticketPage(t, user)) : send(res, 404, '<h1>Not found</h1>');
  }
  send(res, 404, { error: 'not found' });
});

const port = Number(process.env.APP_PORT || 0);
server.listen(port, '127.0.0.1', () => {
  log(`listening on http://127.0.0.1:${server.address().port}`);
});
