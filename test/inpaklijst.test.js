const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.stop(); });

async function groepMetReis(naam) {
  const c = client(srv.base);
  await c.req('POST', '/api/auth/register', { name: naam, password: 'geheim1234' });
  c.team = (await c.req('POST', '/api/teams', { name: `Groep ${naam}` })).data.id;
  const trip = (await c.req('POST', '/api/trips', { title: 'Barcelona' })).data.id;
  return { c, trip };
}
const todosVan = async (c, trip) => (await c.req('GET', '/api/content')).data.trips.find((t) => t.id === trip).todos;

test('inpaklijst: toevoegen, standaardlijst zonder dubbele, afvinken, regelen en verwijderen', async () => {
  const { c, trip } = await groepMetReis('Pakker');
  assert.equal((await c.req('POST', `/api/trips/${trip}/todos`, { text: '   ' })).status, 400);
  assert.equal((await c.req('POST', `/api/trips/${trip}/todos`, { text: 'Zonnebrand' })).status, 200);
  const r = await c.req('POST', `/api/trips/${trip}/todos`, { texts: ['zonnebrand', 'Paspoort', 'Paspoort'] });
  assert.equal(r.data.added, 1);
  let list = await todosVan(c, trip);
  assert.deepEqual(list.map((d) => d.text), ['Zonnebrand', 'Paspoort']);
  assert.equal(list[0].added_by, 'Pakker');

  await c.req('PUT', `/api/todos/${list[0].id}`, { done: true });
  await c.req('PUT', `/api/todos/${list[1].id}`, { who: 'Pakker' });
  list = await todosVan(c, trip);
  // afgevinkte dingen zakken naar onderen
  assert.deepEqual(list.map((d) => [d.text, d.done, d.done_by, d.who]), [['Paspoort', 0, null, 'Pakker'], ['Zonnebrand', 1, 'Pakker', null]]);

  await c.req('DELETE', `/api/todos/${list[0].id}`);
  assert.equal((await todosVan(c, trip)).length, 1);
  // reis weg = lijst weg
  await c.req('DELETE', `/api/trips/${trip}`);
  assert.equal((await c.req('GET', '/api/content')).data.trips.length, 0);
});

test('inpaklijst: een andere groep kan er niet bij', async () => {
  const a = await groepMetReis('Eigenaar');
  const b = await groepMetReis('Indringer');
  await a.c.req('POST', `/api/trips/${a.trip}/todos`, { text: 'Geheim' });
  const [todo] = await todosVan(a.c, a.trip);
  assert.equal((await b.c.req('POST', `/api/trips/${a.trip}/todos`, { text: 'Hack' })).status, 404);
  assert.equal((await b.c.req('PUT', `/api/todos/${todo.id}`, { done: true })).status, 404);
  await b.c.req('DELETE', `/api/todos/${todo.id}`);
  const [na] = await todosVan(a.c, a.trip);
  assert.equal(na.done, 0);
  assert.equal(na.text, 'Geheim');
});

test('kosten delen: bedrag, wie betaalde en voor wie worden gecontroleerd; andere groep kan niet verwijderen', async () => {
  const { c, trip } = await groepMetReis('Betaler');
  const add = (body) => c.req('POST', `/api/trips/${trip}/expenses`, { title: 'Huis', amount: '600', paid_by: 'Betaler', split: ['Betaler'], ...body });
  assert.equal((await add({ amount: 'veel' })).status, 400);
  assert.equal((await add({ amount: '0' })).status, 400);
  assert.equal((await add({ paid_by: 'Vreemde' })).status, 400);
  assert.equal((await add({ split: ['Vreemde'] })).status, 400);
  assert.equal((await add({ title: '' })).status, 400);
  assert.equal((await add({ amount: '1.250,50', split: ['Betaler', 'Vreemde'] })).status, 200);
  const [e] = (await c.req('GET', '/api/content')).data.trips[0].expenses;
  assert.equal(e.cents, 125050);
  assert.deepEqual(e.split, ['Betaler']); // onbekende namen vallen eruit
  const other = await groepMetReis('Ander');
  await other.c.req('DELETE', `/api/expenses/${e.id}`);
  assert.equal((await c.req('GET', '/api/content')).data.trips[0].expenses.length, 1);
  await c.req('DELETE', `/api/expenses/${e.id}`);
  assert.equal((await c.req('GET', '/api/content')).data.trips[0].expenses.length, 0);
});

test('wie gaat er mee: ja/misschien/nee, wissen, en een chatbericht bij ja', async () => {
  const { c, trip } = await groepMetReis('Reiziger');
  assert.equal((await c.req('PUT', `/api/trips/${trip}/rsvp`, { value: 'altijd' })).status, 400);
  await c.req('PUT', `/api/trips/${trip}/rsvp`, { value: 'ja' });
  await c.req('PUT', `/api/trips/${trip}/rsvp`, { value: 'ja' }); // twee keer ja = één chatbericht
  let t = (await c.req('GET', '/api/content')).data.trips[0];
  assert.deepEqual(t.rsvp, [{ name: 'Reiziger', value: 'ja' }]);
  const msgs = (await c.req('GET', '/api/messages')).data;
  const list = Array.isArray(msgs) ? msgs : msgs.messages;
  assert.equal(list.filter((m) => /gaat mee naar Barcelona/.test(m.body)).length, 1);
  await c.req('PUT', `/api/trips/${trip}/rsvp`, { value: '' });
  t = (await c.req('GET', '/api/content')).data.trips[0];
  assert.deepEqual(t.rsvp, []);
  const other = await groepMetReis('Buitenstaander');
  assert.equal((await other.c.req('PUT', `/api/trips/${trip}/rsvp`, { value: 'ja' })).status, 404);
});
