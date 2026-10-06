const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, isPrivateIp } = require('../src/linkinfo');

test('Airbnb-pagina: naam, details, score, foto en ligging', () => {
  const html = `<html><head>
    <meta property="og:title" content="Huurcomplex · Catania · ★5,0 · 3 slaapkamers · 4 bedden"/>
    <meta property="og:description" content="Casa degli Artisti"/>
    <meta property="og:image" content="https://a0.muscache.com/im/pictures/x.jpeg?im_w=720&amp;width=720"/>
    <script type="application/ld+json">{"@type":"VacationRental","name":"Casa degli Artisti","latitude":37.5,"longitude":15.09,
      "aggregateRating":{"ratingValue":4.8,"ratingCount":"12"},"image":["https://a0.muscache.com/im/pictures/x.jpeg"]}</script>
    </head><body>"personCapacity":6</body></html>`;
  const r = parse(new URL('https://www.airbnb.nl/rooms/123?check_in=2027-08-01&source_impression_id=abc'), html);
  assert.equal(r.site, 'Airbnb');
  assert.equal(r.title, 'Casa degli Artisti');
  assert.equal(r.subtitle, 'Huurcomplex · Catania · 3 slaapkamers · 4 bedden');
  assert.equal(r.rating, 5);
  assert.equal(r.guests, 6);
  assert.equal(r.lat, 37.5);
  assert.equal(r.link, 'https://www.airbnb.nl/rooms/123?check_in=2027-08-01');
  assert.match(r.image, /im_w=1200/);
});

test('gewone site: og-tags en een 10-puntsscore', () => {
  const html = `<title>Hotel Sol | Boek nu</title><meta name="description" content="Aan zee">
    <script type="application/ld+json">{"@graph":[{"@type":"Hotel","name":"Hotel Sol","aggregateRating":{"ratingValue":"8,6","bestRating":10},
    "address":{"addressLocality":"Málaga","addressCountry":"ES"}}]}</script>`;
  const r = parse(new URL('https://hotelsol.example/'), html);
  assert.equal(r.title, 'Hotel Sol');
  assert.equal(r.rating, 4);
  assert.equal(r.subtitle, 'Málaga, ES');
  assert.equal(r.body, 'Aan zee');
});

test('interne IP-adressen worden herkend', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.109.21.192', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.ok(isPrivateIp(ip), ip);
  }
  for (const ip of ['8.8.8.8', '65.109.112.52', '2a01:4f8::1']) assert.ok(!isPrivateIp(ip), ip);
});

test('Airbnb-zoekpagina: prijzen voor de groep uitlezen', () => {
  const { parseAirbnb } = require('../src/prices');
  const state = { niobeClientData: [[0, { data: { presentation: { staysSearch: { results: { searchResults: [{
    structuredDisplayPrice: { primaryLine: { price: '€ 1.354', qualifier: 'in totaal' } },
    nameLocalized: { localizedStringWithTranslationPreference: 'Penthouse van het kasteel' },
    avgRatingLocalized: '4,89 (44)',
    demandStayListing: { id: Buffer.from('DemandStayListing:1584883988494282602').toString('base64'), location: { coordinate: { latitude: 37.5, longitude: 15.08 } } },
    structuredContent: { primaryLine: [{ body: '3 slaapkamers', type: 'BEDINFO' }, { body: 'Particuliere host', type: 'HOSTINFO' }] },
    contextualPictures: [{ picture: 'https://a0.muscache.com/im/pictures/x.jpeg?foo=1' }],
  }] } } } } }]] };
  const html = `<script id="data-deferred-state-0" type="application/json">${JSON.stringify(state)}</script>`;
  const [x] = parseAirbnb(html, 4);
  assert.equal(x.id, '1584883988494282602');
  assert.equal(x.total, 1354);
  assert.equal(x.perPerson, 339);
  assert.equal(x.rating, 4.89);
  assert.equal(x.reviews, 44);
  assert.equal(x.rooms, '3 slaapkamers');
  assert.equal(x.link, 'https://www.airbnb.nl/rooms/1584883988494282602');
  assert.equal(x.image, 'https://a0.muscache.com/im/pictures/x.jpeg?im_w=720');
});
