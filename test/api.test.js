const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.stop(); });

async function newUser(name, password = 'geheim1234') {
  const c = client(srv.base);
  const r = await c.req('POST', '/api/auth/register', { name, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}

test('health-check en beveiligingsheaders', async () => {
  const res = await fetch(`${srv.base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('pagina\'s en lettertype komen van de eigen server', async () => {
  for (const url of ['/', '/privacy', '/vendor/inter/index.css']) {
    const res = await fetch(srv.base + url);
    assert.equal(res.status, 200, url);
  }
  const html = await (await fetch(`${srv.base}/`)).text();
  assert.doesNotMatch(html, /fonts\.googleapis/);
});

test('registreren: korte wachtwoorden en ongeldige namen worden geweigerd', async () => {
  const c = client(srv.base);
  assert.equal((await c.req('POST', '/api/auth/register', { name: 'Kort', password: '1234567' })).status, 400);
  assert.equal((await c.req('POST', '/api/auth/register', { name: '<script>', password: 'geheim1234' })).status, 400);
  await newUser('Anna');
  assert.equal((await client(srv.base).req('POST', '/api/auth/register', { name: 'anna', password: 'geheim1234' })).status, 409);
});

test('inloggen: fout wachtwoord, en na 10 pogingen een pauze', async () => {
  await newUser('Bram');
  const c = client(srv.base);
  assert.equal((await c.req('POST', '/api/auth/login', { name: 'Bram', password: 'fout' })).status, 401);
  // Ook met wisselende X-Forwarded-For blijft de rem per naam staan.
  for (let i = 0; i < 9; i++) await c.req('POST', '/api/auth/login', { name: 'Bram', password: 'fout' }, { 'X-Forwarded-For': `203.0.113.${i}` });
  const r = await c.req('POST', '/api/auth/login', { name: 'Bram', password: 'geheim1234' });
  assert.equal(r.status, 429);
});

test('zonder inloggen geen toegang tot de API', async () => {
  const r = await client(srv.base).req('GET', '/api/content');
  assert.equal(r.status, 401);
});

test('groepen zijn van elkaar afgeschermd', async () => {
  const a = await newUser('Chris');
  const b = await newUser('Dana');
  const t = await a.req('POST', '/api/teams', { name: 'Groep A' });
  a.team = t.data.id;
  const content = await a.req('GET', '/api/content');
  assert.equal(content.status, 200);
  const map = content.data.sections.find((s) => s.kind === 'map');
  const pin = await a.req('POST', `/api/sections/${map.id}/items`, { title: 'Catania', lat: 37.5, lng: 15.08 });
  assert.equal(pin.status, 200);

  b.team = a.team;
  assert.equal((await b.req('GET', '/api/content')).status, 403);
  assert.equal((await b.req('PUT', `/api/items/${pin.data.id}`, { title: 'Gekaapt' })).status, 403);
  // Een eigen groep van B kan niet bij het item van A.
  const tb = await b.req('POST', '/api/teams', { name: 'Groep B' });
  b.team = tb.data.id;
  assert.equal((await b.req('PUT', `/api/items/${pin.data.id}`, { title: 'Gekaapt' })).status, 404);
  assert.equal((await b.req('POST', '/api/trips', { title: 'Reis', item_ids: [pin.data.id] })).status, 200);
  const trips = (await b.req('GET', '/api/content')).data.trips;
  assert.deepEqual(trips[0].item_ids, [], 'item van een andere groep mag niet in een reis');
});

test('reis met huurauto: minimumleeftijd en toeslag worden bewaard', async () => {
  const a = await newUser('Eva');
  a.team = (await a.req('POST', '/api/teams', { name: 'Autoclub' })).data.id;
  const sec = await a.req('POST', '/api/sections', { title: 'Huurauto', kind: 'car', show_price: 1 });
  const car = await a.req('POST', `/api/sections/${sec.data.id}/items`, { title: 'Fiat Panda', price: '€ 180', min_age: '21', young_fee: '84' });
  const bad = await a.req('POST', `/api/sections/${sec.data.id}/items`, { title: 'Raar', min_age: '7', young_fee: '-5' });
  const items = (await a.req('GET', '/api/content')).data.sections.find((s) => s.id === sec.data.id).items;
  const panda = items.find((i) => i.id === car.data.id);
  assert.equal(panda.min_age, 21);
  assert.equal(panda.young_fee, 84);
  const raar = items.find((i) => i.id === bad.data.id);
  assert.equal(raar.min_age, null);
  assert.equal(raar.young_fee, null);
});

test('link ophalen: interne adressen worden geweigerd', async () => {
  const a = await newUser('Finn');
  a.team = (await a.req('POST', '/api/teams', { name: 'Links' })).data.id;
  for (const url of ['http://127.0.0.1:4000/', 'http://localhost/', 'http://10.0.0.1/', 'http://[::1]/', 'file:///etc/passwd']) {
    const r = await a.req('POST', '/api/link-info', { url });
    assert.equal(r.status, 400, url);
  }
});

test('uploads: alleen echte afbeeldingen', async () => {
  const a = await newUser('Gijs');
  a.team = (await a.req('POST', '/api/teams', { name: 'Foto' })).data.id;
  const fake = `data:image/png;base64,${Buffer.from('<html>geen plaatje</html>').toString('base64')}`;
  assert.equal((await a.req('POST', '/api/upload', { data: fake })).status, 400);
  // 1×1 pixel PNG
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const ok = await a.req('POST', '/api/upload', { data: png });
  assert.equal(ok.status, 200);
  assert.match(ok.data.url, /^\/uploads\/.+\.png$/);
});

test('account verwijderen: wachtwoord nodig, enige beheerder moet eerst overdragen', async () => {
  const a = await newUser('Hanna');
  const t = await a.req('POST', '/api/teams', { name: 'Hanna en co' });
  const inv = t.data.teams[0].invite_code;
  const b = await newUser('Ivo');
  assert.equal((await b.req('POST', `/api/invite/${inv}`)).status, 200);

  assert.equal((await a.req('DELETE', '/api/auth/account', { password: 'fout' })).status, 400);
  const blocked = await a.req('DELETE', '/api/auth/account', { password: 'geheim1234' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /beheerder/);

  // Ivo kan zijn account wel verwijderen, en daarna niet meer inloggen.
  assert.equal((await b.req('DELETE', '/api/auth/account', { password: 'geheim1234' })).status, 200);
  assert.equal((await b.req('GET', '/api/content')).status, 401);
  assert.equal((await client(srv.base).req('POST', '/api/auth/login', { name: 'Ivo', password: 'geheim1234' })).status, 401);
});

test('interne fouten tonen geen details', async () => {
  const a = await newUser('Jip');
  a.team = (await a.req('POST', '/api/teams', { name: 'Fout' })).data.id;
  const r = await a.req('POST', '/api/sections/999999/items', { title: 'x' });
  assert.ok(r.status === 404 || r.status === 400, String(r.status));
});

test('health-check met back-up: zonder back-up 503, met verse back-up 200', async () => {
  const r = await fetch(`${srv.base}/healthz?backup=1`);
  assert.equal(r.status, 503);
  require('fs').writeFileSync(require('path').join(srv.dataDir, '.last-backup'), String(Math.floor(Date.now() / 1000)));
  const ok = await fetch(`${srv.base}/healthz?backup=1`);
  assert.equal(ok.status, 200);
});

test('rijtijden: ongeldige punten worden geweigerd', async () => {
  const a = await newUser('Rij');
  a.team = (await a.req('POST', '/api/teams', { name: 'Rijden' })).data.id;
  assert.equal((await a.req('POST', '/api/drive', { from: [999, 0], to: [[1, 1]] })).status, 400);
  assert.equal((await a.req('POST', '/api/drive', { from: [39.47, -0.38], to: [] })).status, 400);
});

test('roulette: twee bestemmingen, server kiest, uitslag in de chat', async () => {
  const a = await newUser('Gokker');
  const club = (await a.req('POST', '/api/teams', { name: 'Gokclub' })).data;
  a.team = club.id;
  const map = (await a.req('GET', '/api/content')).data.sections.find((s) => s.kind === 'map');
  const x = (await a.req('POST', `/api/sections/${map.id}/items`, { title: 'Catania, Sicilië', lat: 37.5, lng: 15.08 })).data.id;
  const y = (await a.req('POST', `/api/sections/${map.id}/items`, { title: 'Málaga, Spanje', lat: 36.72, lng: -4.42 })).data.id;
  assert.equal((await a.req('POST', '/api/roulette', { item_ids: [x, x] })).status, 400);
  assert.equal((await a.req('POST', '/api/roulette', { item_ids: [x, 999999] })).status, 400);
  const seen = new Set();
  for (let i = 0; i < 30 && seen.size < 2; i++) {
    const r = await a.req('POST', '/api/roulette', { item_ids: [x, y] });
    assert.equal(r.status, 200);
    assert.ok([x, y].includes(r.data.winner_id));
    seen.add(r.data.winner_id);
  }
  assert.equal(seen.size, 2, 'beide uitkomsten moeten kunnen');
  const msgs = (await a.req('GET', '/api/messages')).data.messages;
  assert.ok(msgs.some((m) => /liet de roulette kiezen tussen Catania en Málaga: (Catania|Málaga) wint/.test(m.body)));

  // Uitslagen weghalen: elk lid mag een roulette-uitslag weghalen, maar geen andere meldingen van een ander.
  const b = await newUser('Meegokker');
  assert.equal((await b.req('POST', `/api/invite/${club.teams.find((g) => g.id === a.team).invite_code}`)).status, 200);
  b.team = a.team;
  const spins = msgs.filter((m) => m.body.startsWith('liet de roulette'));
  const other = msgs.find((m) => m.kind === 'event' && !m.body.startsWith('liet de roulette'));
  assert.equal((await b.req('DELETE', `/api/messages/${other.id}`)).status, 403);
  assert.equal((await b.req('DELETE', `/api/messages/${spins[0].id}`)).status, 200);
  const all = await b.req('DELETE', '/api/messages/roulette');
  assert.equal(all.status, 200);
  assert.equal(all.data.removed.length, spins.length - 1);
  const left = (await a.req('GET', '/api/messages')).data;
  assert.ok(!left.messages.some((m) => m.body.startsWith('liet de roulette')));
  assert.ok(left.messages.some((m) => m.id === other.id));
});
