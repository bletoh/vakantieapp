const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, client } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer({ MAIL_TRANSPORT: 'file', PUBLIC_URL: 'https://vakantie.example' }); });
test.after(async () => { await srv.stop(); });

const lastMail = () => JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'last-mail.json'), 'utf8'));

test('wachtwoord vergeten: mail met link, nieuw wachtwoord, link maar één keer geldig', async () => {
  const a = client(srv.base);
  const reg = await a.req('POST', '/api/auth/register', { name: 'Mila', password: 'oudwachtwoord', email: 'mila@example.com' });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.user.email, 'mila@example.com');

  const me = await client(srv.base).req('GET', '/api/auth/me');
  assert.equal(me.data.mail, true);

  const f = await client(srv.base).req('POST', '/api/auth/forgot', { who: 'mila@example.com' }, { Host: 'evil.example' });
  assert.equal(f.status, 200);
  const mail = lastMail();
  assert.equal(mail.to, 'mila@example.com');
  const link = /https:\/\/vakantie\.example\/reset\/([\w-]+)/.exec(mail.text);
  assert.ok(link, 'link gebruikt PUBLIC_URL, niet de Host-header');

  const b = client(srv.base);
  assert.equal((await b.req('POST', '/api/auth/reset', { token: link[1], password: 'kort' })).status, 400);
  const ok = await b.req('POST', '/api/auth/reset', { token: link[1], password: 'nieuwwachtwoord' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.name, 'Mila');
  // Oude sessie is uitgelogd, oude wachtwoord werkt niet meer, de link ook niet.
  assert.equal((await a.req('GET', '/api/auth/me')).data.user, null);
  assert.equal((await client(srv.base).req('POST', '/api/auth/login', { name: 'Mila', password: 'oudwachtwoord' })).status, 401);
  assert.equal((await client(srv.base).req('POST', '/api/auth/login', { name: 'Mila', password: 'nieuwwachtwoord' })).status, 200);
  assert.equal((await b.req('POST', '/api/auth/reset', { token: link[1], password: 'nogeenkeer123' })).status, 400);
});

test('wachtwoord vergeten: onbekende naam geeft hetzelfde antwoord (verraadt niets)', async () => {
  const r = await client(srv.base).req('POST', '/api/auth/forgot', { who: 'bestaatniet' });
  assert.equal(r.status, 200);
  assert.match(r.data.message, /Als er een e-mailadres/);
});

test('e-mailadres instellen vraagt het wachtwoord en moet uniek zijn', async () => {
  const c = client(srv.base);
  await c.req('POST', '/api/auth/register', { name: 'Noor', password: 'geheim1234' });
  assert.equal((await c.req('PUT', '/api/auth/email', { email: 'noor@example.com', password: 'fout' })).status, 400);
  assert.equal((await c.req('PUT', '/api/auth/email', { email: 'geen-mail', password: 'geheim1234' })).status, 400);
  assert.equal((await c.req('PUT', '/api/auth/email', { email: 'MILA@example.com', password: 'geheim1234' })).status, 409);
  const ok = await c.req('PUT', '/api/auth/email', { email: 'noor@example.com', password: 'geheim1234' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.email, 'noor@example.com');
});

test('zonder mailinstellingen staat herstellen via e-mail uit', async () => {
  const s2 = await startServer();
  try {
    const r = await client(s2.base).req('POST', '/api/auth/forgot', { who: 'iemand' });
    assert.equal(r.status, 400);
    assert.equal((await client(s2.base).req('GET', '/api/auth/me')).data.mail, false);
  } finally { await s2.stop(); }
});
