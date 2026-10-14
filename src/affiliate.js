// Partnerlinks: uitgaande links naar boekingssites gaan via /go. Daar komt de partnercode uit .env
// in de link (als die is ingevuld) en tellen we de klik per dag en per site, zonder iets over de
// persoon. Alleen sites uit PARTNERS worden doorgestuurd, zodat /go geen open redirect is.
// Zonder codes in .env gaat iedereen gewoon naar dezelfde link als voorheen.
const express = require('express');
const db = require('./db');

// host (zonder www.) → naam, en optioneel de querystring-parameter + .env-variabele voor de code.
const PARTNERS = [
  { name: 'booking', host: /(^|\.)booking\.com$/, param: 'aid', env: 'BOOKING_AID' },
  { name: 'aviasales', host: /(^|\.)aviasales\.[a-z.]+$/, param: 'marker', env: 'TRAVELPAYOUTS_MARKER' },
  { name: 'discovercars', host: /(^|\.)discovercars\.com$/, param: 'a_aid', env: 'DISCOVERCARS_AID' },
  { name: 'getyourguide', host: /(^|\.)getyourguide\.[a-z.]+$/, param: 'partner_id', env: 'GETYOURGUIDE_PARTNER_ID' },
  { name: 'skyscanner', host: /(^|\.)skyscanner\.[a-z.]+$/ },
  { name: 'airbnb', host: /(^|\.)airbnb\.[a-z.]+$/ },
  { name: 'kayak', host: /(^|\.)kayak\.[a-z.]+$/ },
  { name: 'rentalcars', host: /(^|\.)rentalcars\.com$/ },
  { name: 'sunnycars', host: /(^|\.)sunnycars\.[a-z.]+$/ },
  { name: 'googleflights', host: /^www\.google\.com$/, path: /^\/travel\/flights/ },
];

db.exec(`
CREATE TABLE IF NOT EXISTS outbound_clicks (
  day TEXT NOT NULL,
  partner TEXT NOT NULL,
  tagged INTEGER NOT NULL DEFAULT 0,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, partner, tagged)
);
`);
const countClick = db.prepare(`INSERT INTO outbound_clicks (day, partner, tagged, n) VALUES (date('now'), ?, ?, 1)
  ON CONFLICT (day, partner, tagged) DO UPDATE SET n = n + 1`);

function partnerOf(url) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return PARTNERS.find((p) => p.host.test(url.hostname) && (!p.path || p.path.test(url.pathname))) || null;
}

// De link zoals de bezoeker hem krijgt: met partnercode als die er is. null = geen partner-site.
function withCode(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  const p = partnerOf(url);
  if (!p) return null;
  const code = p.env && (process.env[p.env] || '').trim();
  if (code) url.searchParams.set(p.param, code);
  return { partner: p.name, tagged: !!code, url: url.href };
}

// Voor pagina's die de server zelf maakt (/reis/…, /reizen/…): partner-links via /go laten lopen.
function goHref(raw) {
  return withCode(raw) ? `/go?u=${encodeURIComponent(raw)}` : raw;
}
function rewriteLinks(html) {
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (m, u) => {
    const raw = u.replace(/&amp;/g, '&');
    return withCode(raw) ? `href="${goHref(raw).replace(/&/g, '&amp;')}"` : m;
  });
}

const router = express.Router();
router.get('/go', (req, res) => {
  const hit = typeof req.query.u === 'string' && withCode(req.query.u);
  if (!hit) return res.status(400).type('text').send('Onbekende link');
  try { countClick.run(hit.partner, hit.tagged ? 1 : 0); } catch { /* tellen mag de link nooit tegenhouden */ }
  res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').redirect(302, hit.url);
});

module.exports = { router, withCode, goHref, rewriteLinks, PARTNERS };
