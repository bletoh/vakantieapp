const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Database = require('better-sqlite3');
const { startServer, client } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.stop(); });

test('service worker, manifest en iconen worden geserveerd', async () => {
  let r = await fetch(`${srv.base}/sw.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.equal(r.headers.get('service-worker-allowed'), '/');
  const code = await r.text();
  assert.match(code, /const VERSION = '[0-9a-f]{12}'/);
  r = await fetch(`${srv.base}/manifest.webmanifest`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).name, 'Reismannetje');
  for (const f of ['/img/logo.svg', '/img/icon-192.png', '/img/apple-touch-icon.png']) assert.equal((await fetch(srv.base + f)).status, 200, f);
});

test('pushmeldingen: alleen bekende pushdiensten, aan- en afmelden per account', async () => {
  const c = client(srv.base);
  assert.equal((await c.req('POST', '/api/push/subscribe', { subscription: {} })).status, 401);
  await c.req('POST', '/api/auth/register', { name: 'Melder', password: 'geheim1234' });
  const key = (await c.req('GET', '/api/push/key')).data.key;
  assert.match(key, /^[A-Za-z0-9_-]{80,}$/);

  const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
  for (const endpoint of ['http://fcm.googleapis.com/fcm/send/x', 'https://evil.example/push', 'https://127.0.0.1/x', 'https://googleapis.com.evil.example/x']) {
    assert.equal((await c.req('POST', '/api/push/subscribe', { subscription: { endpoint, keys } })).status, 400, endpoint);
  }
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
  assert.equal((await c.req('POST', '/api/push/subscribe', { subscription: { endpoint, keys } })).status, 200);
  assert.equal((await c.req('POST', '/api/push/subscribe', { subscription: { endpoint, keys } })).status, 200); // tweede keer: geen dubbele
  const count = () => new Database(path.join(srv.dataDir, 'reismannetje.db'), { readonly: true }).prepare('SELECT COUNT(*) AS n FROM push_subs').get().n;
  assert.equal(count(), 1);
  await c.req('POST', '/api/push/unsubscribe', { endpoint });
  assert.equal(count(), 0);
});

test('pushmeldingen: nieuw bericht gaat naar de andere leden, niet naar de afzender', async () => {
  // In dit proces (zonder server) met een nagebootste pushdienst.
  const fs = require('fs');
  const os = require('os');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-push-'));
  const webpush = require('web-push');
  const sent = [];
  webpush.sendNotification = async (sub, payload) => { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); return { statusCode: 201 }; };
  const db = require('../src/db');
  const push = require('../src/push');
  const anna = db.prepare("INSERT INTO users (name, pass_hash) VALUES ('Anna', 'x')").run().lastInsertRowid;
  const bas = db.prepare("INSERT INTO users (name, pass_hash) VALUES ('Bas', 'x')").run().lastInsertRowid;
  const team = db.createTeam('Zomer', anna);
  db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')").run(team, bas);
  for (const [u, ep] of [[anna, 'https://fcm.googleapis.com/a'], [bas, 'https://web.push.apple.com/b']]) {
    db.prepare("INSERT INTO push_subs (user_id, endpoint, p256dh, auth) VALUES (?, ?, 'k', 'a')").run(u, ep);
  }
  db.postEvent(team, anna, 'is een stemronde begonnen: Waarheen?', 'poll', 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].endpoint, 'https://web.push.apple.com/b');
  assert.deepEqual(sent[0].payload, { title: 'Zomer', body: 'Anna is een stemronde begonnen: Waarheen?', url: `/?team=${team}#chat`, tag: `team-${team}` });
  assert.ok(push.validSub({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'a', auth: 'b' } }));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
