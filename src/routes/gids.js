// Openbare bestemmingsgids: /bestemmingen (ook de landingspagina voor nieuwe bezoekers),
// /bestemmingen/<categorie> en /bestemming/<plaats>, plus sitemap.xml en robots.txt.
// Alles komt uit public/data/bestemmingen.json (dezelfde lijst als Ideeën in de app). Links naar
// vluchten, verblijf en tours lopen via /go, zodat de partnercodes erin komen (zie src/affiliate.js).
const express = require('express');
const path = require('path');
const { rewriteLinks } = require('../affiliate');
const { PAGE_CSS, icon, esc } = require('./share');

const router = express.Router();
const DESTS = require(path.join(__dirname, '..', '..', 'public', 'data', 'bestemmingen.json'));
const AIRPORTS = require('../airports.json');
const HOME = [52.3105, 4.7683]; // Schiphol

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const slugify = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function distanceKm(a, b) {
  const rad = (d) => d * Math.PI / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
// Zelfde grove schatting als in de app: ± 800 km/u plus een half uur voor opstijgen en landen.
const flightMin = (km) => Math.round(km / 800 * 60 + 30);
const flightText = (min) => `${Math.floor(min / 60)}u ${String(min % 60).padStart(2, '0')}m`;

// Het vliegveld voor de zoeklinks: het dichtstbijzijnde grote, anders het dichtstbijzijnde (max. 200 km).
function airportFor(d) {
  const near = AIRPORTS.map(([iata, name, lat, lng, large]) => ({ iata, name, large, km: distanceKm([d.lat, d.lng], [lat, lng]) }))
    .filter((a) => a.km < 200 && a.iata !== 'AMS').sort((a, b) => a.km - b.km);
  return near.find((a) => a.large && a.km < 150) || near[0] || null;
}

// Beste maanden: dicht bij een prettige temperatuur voor het soort reis en niet in het regenseizoen.
function bestMonths(d) {
  const rainy = (m) => Array.isArray(d.r) && d.r.includes(m);
  // Skiën: koude maanden. Een stad met skigebied in de buurt (Vancouver, Granada) heeft stadstemperaturen
  // en valt terug op de gewone berekening.
  const ski = d.t.includes('wintersport') ? d.temp.map((t, m) => (t <= 3 ? m : -1)).filter((m) => m >= 0) : [];
  if (ski.length) return ski;
  const ideal = d.t.some((t) => ['strand', 'zon', 'eiland', 'watersport', 'allin', 'duiken'].includes(t)) ? 28 : 23;
  const good = d.temp.map((t, m) => (Math.abs(t - ideal) <= 4 && !rainy(m) ? m : -1)).filter((m) => m >= 0);
  if (good.length) return good;
  // Nooit precies goed (altijd heet of altijd koel): de drie droge maanden die er het dichtst bij komen.
  return d.temp.map((t, m) => ({ m, off: Math.abs(t - ideal) + (rainy(m) ? 100 : 0) }))
    .sort((a, b) => a.off - b.off).slice(0, 3).map((x) => x.m).sort((a, b) => a - b);
}
// "mei t/m september", of meerdere reeksen; een reeks mag over de jaarwisseling lopen (november t/m februari).
function monthsText(ms) {
  if (!ms.length) return '';
  if (ms.length === 12) return 'het hele jaar';
  const set = new Set(ms);
  const runs = [];
  for (const start of ms) {
    if (set.has((start + 11) % 12)) continue; // zit midden in een reeks
    let end = start;
    while (set.has((end + 1) % 12)) end = (end + 1) % 12;
    runs.push([start, end]);
  }
  return runs.map(([a, b]) => (a === b ? MONTHS[a] : `${MONTHS[a]} t/m ${MONTHS[b]}`)).join(', ');
}

// Categorieën met een eigen pagina (zoekwoorden waar groepen op zoeken).
const CATS = [
  { slug: 'feesten', label: 'Feesten & clubs', title: 'Feestbestemmingen voor een vriendengroep', test: (d) => d.t.includes('nachtleven') },
  { slug: 'strand', label: 'Strand & beachclubs', title: 'Strandvakanties met vrienden', test: (d) => d.t.includes('strand') },
  { slug: 'stedentrip', label: 'Stedentrips', title: 'Stedentrips met vrienden', test: (d) => d.t.includes('stad') },
  { slug: 'goedkoop', label: 'Goedkoop', title: 'Goedkope bestemmingen voor een groep', test: (d) => d.h <= 50 },
  { slug: 'eiland', label: 'Eilanden', title: 'Eilanden voor een vakantie met vrienden', test: (d) => d.t.includes('eiland') },
  { slug: 'avontuur', label: 'Actie & avontuur', title: 'Avontuurlijke reizen met vrienden', test: (d) => d.t.includes('avontuur') },
  { slug: 'watersport', label: 'Watersport & surfen', title: 'Surf- en watersportbestemmingen', test: (d) => d.t.includes('watersport') },
  { slug: 'natuur', label: 'Natuur & hiken', title: 'Natuur en hiken met een groep', test: (d) => d.t.includes('natuur') || d.t.includes('wandelen') },
  { slug: 'wintersport', label: 'Wintersport', title: 'Wintersport en après-ski met vrienden', test: (d) => d.t.includes('wintersport') },
  { slug: 'all-inclusive', label: 'All-inclusive', title: 'All-inclusive bestemmingen voor een groep', test: (d) => d.t.includes('allin') },
  { slug: 'casino', label: "Casino's", title: "Bestemmingen met casino's", test: (d) => !!d.cas || d.t.includes('casino') },
  { slug: 'korte-vlucht', label: 'Korte vlucht', title: 'Bestemmingen binnen 3 uur vliegen', test: (d) => d.min < 180 },
  { slug: 'verre-reizen', label: 'Verre reizen', title: 'Verre reizen met vrienden', test: (d) => d.min >= 360 },
];
const TAG_LABEL = { nachtleven: 'Feesten', strand: 'Strand', zon: 'Zon', stad: 'Stad', eten: 'Lekker eten', cultuur: 'Cultuur', eiland: 'Eiland',
  natuur: 'Natuur', watersport: 'Watersport', avontuur: 'Avontuur', romantisch: 'Romantisch', allin: 'All-inclusive', wandelen: 'Hiken',
  familie: 'Familie', rust: 'Rust', wintersport: 'Wintersport', duiken: 'Duiken', casino: 'Casino' };

// Eén keer bij het starten: slug, vliegtijd, vliegveld en beste maanden per bestemming.
const seen = new Set();
const LIST = DESTS.map((d) => {
  let slug = slugify(d.n.replace(/\s*\((.*)\)$/, ' $1'));
  if (seen.has(slug)) slug = `${slug}-${slugify(d.c)}`;
  seen.add(slug);
  const min = flightMin(distanceKm(HOME, [d.lat, d.lng]));
  const x = { ...d, slug, min, airport: airportFor(d), best: bestMonths(d), place: d.n.replace(/\s*\(.*\)$/, '') };
  x.cats = CATS.filter((c) => c.test(x)).map((c) => c.slug);
  return x;
});
const BY_SLUG = new Map(LIST.map((d) => [d.slug, d]));

const origin = (req) => `${req.protocol}://${req.get('host')}`;
const euro = (n) => `€${Math.round(n / 5) * 5}`;
const big = (img) => (img || '').replace('/500px-', '/960px-');
// Groep van 4, een week (6 nachten), middenklasse, appartement delen (zoals Ideeën rekent).
const groupCost = (d) => d.f + d.h * 0.9 * 6;

function flightLinks(d) {
  const a = d.airport;
  const google = `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from AMS to ${a ? a.iata : d.place}`)}`;
  return [
    a && { href: `https://www.skyscanner.nl/transport/vluchten/ams/${a.iata.toLowerCase()}/?adultsv2=4`, text: `Vluchten naar ${a.iata} op Skyscanner` },
    { href: google, text: 'Google Flights' },
  ].filter(Boolean);
}
const stayLink = (d) => `https://www.booking.com/searchresults.nl.html?${new URLSearchParams({ ss: `${d.place}, ${d.c}`, group_adults: 4, no_rooms: 2, group_children: 0 })}`;
const toursLink = (d) => `https://www.getyourguide.nl/s/?${new URLSearchParams({ q: d.place })}`;

const GIDS_CSS = `
    main.wide { max-width: 1080px; margin-top: 0; border-radius: 0; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 1080px; margin: 0 auto; padding: 14px 16px; }
    .logo { font-weight: 700; letter-spacing: -.02em; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; }
    .logo .ic { color: var(--brand); }
    .top nav { display: flex; gap: 16px; font-weight: 600; font-size: .9375rem; }
    .top nav a { text-decoration: none; }
    .hero { padding: 28px 0 8px; }
    .hero h1 { font-size: clamp(2rem, 8vw, 3rem); max-width: 16ch; }
    .lead { margin: 8px 0 0; font-size: 1.125rem; color: var(--muted); max-width: 52ch; }
    .cta { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0 0; }
    .btn2 { display: inline-flex; align-items: center; min-height: 44px; padding: 10px 18px; border-radius: 10px; border: 1px solid var(--line); font-weight: 600; text-decoration: none; }
    .go-btn { margin-top: 0; }
    .feats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 28px 0 0; padding: 0; list-style: none; }
    .feats li { display: flex; gap: 10px; padding: 14px 16px; border-radius: 14px; background: var(--surface-2); }
    .feats .ic { color: var(--brand); margin-top: 2px; }
    .feats strong { display: block; }
    .feats span { color: var(--muted); font-size: .9375rem; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; padding: 0; list-style: none; }
    .chips a, .chips span { display: inline-block; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); text-decoration: none; font-size: .875rem; font-weight: 600; }
    .chips a[aria-current] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; margin: 16px 0 0; }
    .card { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 16px; overflow: hidden; text-decoration: none; background: var(--surface); }
    @media (max-width: 600px) {
      .grid { grid-template-columns: 1fr 1fr; gap: 10px; }
      .card div { padding: 8px 10px 10px; }
      .card strong { font-size: .9375rem; }
      .card small, .card .from { font-size: .75rem; }
    }
    .book { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
    .book li { display: flex; align-items: center; gap: 10px; min-height: 44px; border-bottom: 1px solid var(--line); font-weight: 600; }
    .book li:last-child { border-bottom: none; }
    .book .ic { color: var(--muted); }
    .book a { text-decoration: none; flex: 1; padding: 10px 0; }
    .card img { width: 100%; height: auto; aspect-ratio: 3 / 2; object-fit: cover; display: block; background: var(--surface-2); }
    .card div { padding: 12px 14px 14px; display: grid; gap: 2px; }
    .card strong { font-size: 1.0625rem; }
    .card small { color: var(--muted); }
    .card .from { font-weight: 600; font-size: .875rem; margin-top: 4px; }
    .temps { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; align-items: end; height: 120px; margin: 8px 0 0; padding: 0; list-style: none; }
    .temps li { display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; font-size: .6875rem; color: var(--muted); gap: 3px; }
    .temps i { display: block; width: 100%; border-radius: 4px 4px 0 0; background: var(--line); }
    .temps li.best i { background: var(--brand); }
    .temps li.rain i { background: repeating-linear-gradient(45deg, var(--line), var(--line) 3px, transparent 3px, transparent 6px); }
    .temps b { color: var(--ink); font-weight: 600; }
    .box { margin: 16px 0 0; padding: 16px; border-radius: 14px; background: var(--surface-2); }
    .box p { margin: 4px 0 0; }
    .muted { color: var(--muted); }
    .links a { text-decoration: underline; text-underline-offset: 3px; }
    .fine { margin: 10px 0 0; font-size: .8125rem; color: var(--muted); }
    footer { flex-wrap: wrap; }
    footer a { color: inherit; }
`;

function shell(req, { title, description, canonical, image, body, jsonld, wide }) {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#121212" media="(prefers-color-scheme: dark)">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Vakantieplanner">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  ${image ? `<meta property="og:image" content="${esc(image)}">\n  <meta name="twitter:card" content="summary_large_image">` : ''}
  <link rel="stylesheet" href="/vendor/inter/index.css">
  <style>${PAGE_CSS}${GIDS_CSS}</style>
  ${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
  <header class="top">
    <a class="logo" href="/bestemmingen">${icon('pin')}Vakantieplanner</a>
    <nav><a href="/bestemmingen">Bestemmingen</a><a href="/">Inloggen</a></nav>
  </header>
  ${body}
  <footer>Prijzen en vliegtijden zijn een indicatie. Sommige links zijn partnerlinks: boek je daar, dan krijgen wij soms een kleine vergoeding, zonder extra kosten voor jou. · <a href="/privacy">Privacy</a></footer>
</body>
</html>`;
}

function cardHtml(d) {
  return `<a class="card" href="/bestemming/${d.slug}">
      <img src="${esc(d.img)}" alt="" loading="lazy" width="500" height="333">
      <div><strong>${esc(d.n)}</strong><small>${esc(d.c)} · ± ${flightText(d.min)} vliegen</small>
      <span class="from">Vlucht vanaf ± ${euro(d.f)} p.p.</span></div>
    </a>`;
}
const catChips = (current, only) => `<ul class="chips">${CATS.filter((c) => !only || only.includes(c.slug)).map((c) => `<li><a href="/bestemmingen/${c.slug}"${c.slug === current ? ' aria-current="page"' : ''}>${esc(c.label)}</a></li>`).join('')}</ul>`;

function send(res, html) {
  res.set('Cache-Control', 'public, max-age=3600').type('html').send(rewriteLinks(html));
}

router.get('/bestemmingen', (req, res) => {
  const body = `<main class="wide">
    <section class="hero">
      <h1>Vakantie plannen met je vrienden</h1>
      <p class="lead">Kies samen waar je heen gaat, prik datums die voor iedereen werken, vergelijk vluchten en verblijf en laat de groep stemmen. Gratis, in één gedeelde app.</p>
      <p class="cta"><a class="go-btn" href="/?nieuw=1">Gratis beginnen</a><a class="btn2" href="#alle">Bekijk bestemmingen</a></p>
      <ul class="feats">
        <li>${icon('pin')}<div><strong>Samen op de kaart</strong><span>Iedereen prikt bestemmingen en ziet meteen vluchten en verblijf.</span></div></li>
        <li>${icon('calendar')}<div><strong>Datumprikker</strong><span>Vink aan wanneer je kunt; de beste periode staat bovenaan.</span></div></li>
        <li>${icon('users')}<div><strong>Stemmen en chat</strong><span>Laat de groep kiezen en deel de uitslag in WhatsApp.</span></div></li>
        <li>${icon('plane')}<div><strong>Echte prijzen</strong><span>Vluchten en appartementen voor jullie groep en datums.</span></div></li>
      </ul>
    </section>
    <h2 id="alle">${LIST.length} bestemmingen vanaf Schiphol</h2>
    ${catChips('')}
    <div class="grid">${LIST.map(cardHtml).join('')}</div>
  </main>`;
  send(res, shell(req, {
    title: 'Vakantie plannen met vrienden · Vakantieplanner',
    description: `Plan samen een vakantie: ${LIST.length} bestemmingen vanaf Schiphol met vliegtijd, beste reistijd en kosten voor een groep. Prik datums, vergelijk en stem in één app.`,
    canonical: `${origin(req)}/bestemmingen`, image: big(LIST[0].img), body, wide: true,
  }));
});

router.get('/bestemmingen/:cat', (req, res, next) => {
  const cat = CATS.find((c) => c.slug === req.params.cat);
  if (!cat) return next();
  const list = LIST.filter((d) => d.cats.includes(cat.slug));
  const body = `<main class="wide">
    <section class="hero">
      <p class="kicker">${list.length} bestemmingen</p>
      <h1>${esc(cat.title)}</h1>
      <p class="lead">Vliegtijd vanaf Schiphol, beste reistijd en wat het ongeveer kost met een groep. Plan het daarna samen in de app.</p>
    </section>
    ${catChips(cat.slug)}
    <div class="grid">${list.map(cardHtml).join('')}</div>
    <p class="cta"><a class="go-btn" href="/?nieuw=1">Plan met je vrienden</a></p>
  </main>`;
  send(res, shell(req, {
    title: `${cat.title} · Vakantieplanner`,
    description: `${list.length} ${cat.label.toLowerCase()}-bestemmingen vanaf Schiphol: ${list.slice(0, 5).map((d) => d.place).join(', ')} en meer, met vliegtijd en kosten voor een groep.`,
    canonical: `${origin(req)}/bestemmingen/${cat.slug}`, image: list[0] && big(list[0].img), body, wide: true,
  }));
});

router.get('/bestemming/:slug', (req, res, next) => {
  const d = BY_SLUG.get(req.params.slug);
  if (!d) return next();
  const best = monthsText(d.best);
  const rainy = Array.isArray(d.r) && d.r.length ? d.r.map((m) => MONTHS[m]).join(', ') : '';
  const maxT = Math.max(...d.temp, 30);
  const similar = LIST.filter((x) => x !== d && x.t.filter((t) => d.t.includes(t)).length >= 2)
    .sort((a, b) => Math.abs(a.min - d.min) - Math.abs(b.min - d.min)).slice(0, 4);
  const description = `${d.place} met vrienden: ± ${flightText(d.min)} vliegen vanaf Schiphol${best ? `, beste reistijd ${best}` : ''}, vlucht vanaf ± ${euro(d.f)} p.p. Bekijk kosten voor een groep en plan het samen.`;
  const body = `<img class="hero-img" src="${esc(big(d.img))}" alt="${esc(d.n)}">
  <main>
    <p class="kicker">${esc(d.c)}</p>
    <h1>${esc(d.n)} met vrienden</h1>
    <ul class="facts">
      <li>${icon('plane')}± ${flightText(d.min)} vliegen vanaf Schiphol${d.airport ? ` <span class="muted">(${esc(d.airport.iata)})</span>` : ''}</li>
      ${best ? `<li>${icon('calendar')}Beste tijd: ${esc(best)}</li>` : ''}
    </ul>
    <ul class="chips">${d.t.filter((t) => TAG_LABEL[t]).map((t) => `<li><span>${esc(TAG_LABEL[t])}</span></li>`).join('')}</ul>
    ${d.cas ? `<p class="note">${esc(d.cas[1])}</p>` : ''}

    <h2>${icon('users')}Wat kost het met een groep?</h2>
    <div class="box">
      <strong>± ${euro(groupCost(d))} p.p.</strong> <span class="muted">voor een week met 4 vrienden</span>
      <p class="muted">Vlucht vanaf ± ${euro(d.f)} p.p. plus een gedeeld appartement (middenklasse) van ± ${euro(d.h * 0.9)} p.p. per nacht. Met meer mensen wordt het verblijf per persoon goedkoper.</p>
    </div>

    <h2>${icon('calendar')}Temperatuur per maand</h2>
    <ul class="temps" aria-label="Gemiddelde maximumtemperatuur per maand">
      ${d.temp.map((t, m) => `<li class="${d.best.includes(m) ? 'best' : ''}${d.r && d.r.includes(m) ? ' rain' : ''}" title="${MONTHS[m]}: ${t}°C"><b>${t}°</b><i style="height:${Math.max(4, Math.round(Math.max(t, 0) / maxT * 80))}px"></i>${MONTHS[m].slice(0, 3)}</li>`).join('')}
    </ul>
    <p class="fine">Roze = beste maanden voor dit soort reis.${rainy ? ` Gestreept = regenseizoen (${esc(rainy)}).` : ''}</p>

    <h2>${icon('list')}Zoeken en boeken</h2>
    <ul class="book">
      ${flightLinks(d).map((l) => `<li>${icon('plane')}<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.text)} ↗</a></li>`).join('')}
      <li>${icon('bed')}<a href="${esc(stayLink(d))}" target="_blank" rel="noopener">Verblijf voor 4 personen op Booking ↗</a></li>
      <li>${icon('sparkles')}<a href="${esc(toursLink(d))}" target="_blank" rel="noopener">Tours en tickets in ${esc(d.place)} ↗</a></li>
    </ul>

    <div class="box">
      <strong>Plan ${esc(d.place)} samen</strong>
      <p class="muted">Maak een groep, deel de link in WhatsApp, prik datums en stem tussen ${esc(d.place)} en andere plekken.</p>
      <p class="cta"><a class="go-btn" href="/?nieuw=1">Gratis beginnen</a></p>
    </div>

    ${similar.length ? `<h2>Vergelijkbare bestemmingen</h2><div class="grid">${similar.map(cardHtml).join('')}</div>` : ''}
    ${d.cats.length ? `<h2>Meer van dit soort</h2>${catChips('', d.cats)}` : ''}
  </main>`;
  send(res, shell(req, {
    title: `${d.place} met vrienden: vliegtijd, beste reistijd en kosten · Vakantieplanner`,
    description, canonical: `${origin(req)}/bestemming/${d.slug}`, image: big(d.img), body,
    jsonld: {
      '@context': 'https://schema.org', '@type': 'TouristDestination', name: d.place, description, image: big(d.img),
      geo: { '@type': 'GeoCoordinates', latitude: d.lat, longitude: d.lng },
      containedInPlace: { '@type': 'Country', name: d.c },
    },
  }));
});

router.get('/robots.txt', (req, res) => {
  res.type('text').send(`User-agent: *\nDisallow: /api/\nDisallow: /go\nDisallow: /reis/\nDisallow: /reizen/\nDisallow: /stem/\nDisallow: /join/\nSitemap: ${origin(req)}/sitemap.xml\n`);
});
router.get('/sitemap.xml', (req, res) => {
  const o = origin(req);
  const urls = ['/bestemmingen', ...CATS.map((c) => `/bestemmingen/${c.slug}`), ...LIST.map((d) => `/bestemming/${d.slug}`)];
  res.type('application/xml').set('Cache-Control', 'public, max-age=86400')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${o}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
});

module.exports = router;
module.exports.LIST = LIST;
module.exports.monthsText = monthsText;
