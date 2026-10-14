const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { monthsText } = require('../src/routes/gids');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.stop(); });

test('bestemmingsgids: pagina\'s, partnerlinks via /go, sitemap', async () => {
  let r = await fetch(`${srv.base}/bestemmingen`);
  assert.equal(r.status, 200);
  let html = await r.text();
  assert.match(html, /href="\/bestemming\/barcelona"/);
  assert.match(html, /href="\/\?nieuw=1"/);

  r = await fetch(`${srv.base}/bestemming/barcelona`);
  assert.equal(r.status, 200);
  html = await r.text();
  assert.match(html, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/bestemming\/barcelona">/);
  assert.match(html, /"@type":"TouristDestination"/);
  assert.match(html, /href="\/go\?u=https%3A%2F%2Fwww\.booking\.com/);
  assert.doesNotMatch(html, /href="https:\/\/www\.booking\.com/);

  assert.equal((await fetch(`${srv.base}/bestemmingen/feesten`)).status, 200);
  assert.equal((await fetch(`${srv.base}/bestemmingen/bestaat-niet`)).status, 404);
  assert.equal((await fetch(`${srv.base}/bestemming/bestaat-niet`)).status, 404);

  const map = await (await fetch(`${srv.base}/sitemap.xml`)).text();
  assert.match(map, /\/bestemming\/novalja-zrce</);
  assert.match(await (await fetch(`${srv.base}/robots.txt`)).text(), /Disallow: \/api\//);
});

test('beste maanden als tekst, ook over de jaarwisseling', () => {
  assert.equal(monthsText([4, 5, 6, 7, 8]), 'mei t/m september');
  assert.equal(monthsText([0, 1, 10, 11]), 'november t/m februari');
  assert.equal(monthsText([3, 9]), 'april, oktober');
  assert.equal(monthsText([...Array(12).keys()]), 'het hele jaar');
});
