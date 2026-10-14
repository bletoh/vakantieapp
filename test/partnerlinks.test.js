const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

test('partnerlinks: code uit .env erin, onbekende sites geweigerd, kliks geteld', async () => {
  const srv = await startServer({ BOOKING_AID: '123456', TRAVELPAYOUTS_MARKER: '' });
  try {
    const go = (u) => fetch(`${srv.base}/go?u=${encodeURIComponent(u)}`, { redirect: 'manual' });

    let r = await go('https://www.booking.com/searchresults.nl.html?ss=Malaga&aid=999');
    assert.equal(r.status, 302);
    const to = new URL(r.headers.get('location'));
    assert.equal(to.hostname, 'www.booking.com');
    assert.equal(to.searchParams.get('aid'), '123456');
    assert.equal(to.searchParams.get('ss'), 'Malaga');

    // Zonder code: dezelfde link, ongewijzigd.
    r = await go('https://www.aviasales.com/search/AMS0110BCN1');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'https://www.aviasales.com/search/AMS0110BCN1');

    // Geen open redirect.
    for (const bad of ['https://evil.example/', 'https://booking.com.evil.example/', 'javascript:alert(1)', 'https://www.google.com/search?q=x', '']) {
      assert.equal((await go(bad)).status, 400, bad);
    }

    const Database = require('better-sqlite3');
    const rows = new Database(require('path').join(srv.dataDir, 'reismannetje.db'), { readonly: true })
      .prepare('SELECT partner, tagged, n FROM outbound_clicks ORDER BY partner').all();
    assert.deepEqual(rows.map((x) => ({ ...x })), [{ partner: 'aviasales', tagged: 0, n: 1 }, { partner: 'booking', tagged: 1, n: 1 }]);
  } finally { await srv.stop(); }
});
