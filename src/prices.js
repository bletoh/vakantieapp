// Echte prijzen in plaats van schattingen.
// - Verblijf: de zoekpagina van Airbnb (hele woningen, jullie datums en groepsgrootte, totaalprijs incl. kosten).
// - Vluchten: de Aviasales Data API van Travelpayouts (gratis token, zet TRAVELPAYOUTS_TOKEN in .env).
// Alles wordt bewaard (verblijf 12 uur, vluchten 6 uur) en er gaat steeds één verzoek tegelijk naar Airbnb,
// zodat de groep snel antwoord krijgt en we die sites niet belasten.
const db = require('./db');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

db.exec(`
CREATE TABLE IF NOT EXISTS price_cache (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`);
const getCache = db.prepare('SELECT data, fetched_at FROM price_cache WHERE key = ?');
const putCache = db.prepare('INSERT OR REPLACE INTO price_cache (key, data, fetched_at) VALUES (?, ?, ?)');
// Oude prijzen opruimen (ouder dan een week).
const purge = () => db.prepare('DELETE FROM price_cache WHERE fetched_at < ?').run(Date.now() - 7 * 24 * 3600e3);
purge();
setInterval(purge, 24 * 3600e3).unref();

const inFlight = new Map();
async function cached(key, ttlMs, fn) {
  const row = getCache.get(key);
  if (row && Date.now() - row.fetched_at < ttlMs) return JSON.parse(row.data);
  if (inFlight.has(key)) return inFlight.get(key);
  const p = (async () => {
    try {
      const data = await fn();
      putCache.run(key, JSON.stringify(data), Date.now());
      return data;
    } catch (err) {
      // Lukt het nu niet, dan liever een oudere prijs dan niets.
      if (row) return { ...JSON.parse(row.data), stale: true };
      throw err;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

// Hooguit twee verzoeken tegelijk naar Airbnb, en minstens 1 s tussen het starten ervan.
const MAX_PARALLEL = 2;
let running = 0;
let lastStart = 0;
const waiting = [];
function next() {
  if (running >= MAX_PARALLEL || !waiting.length) return;
  const wait = lastStart + 1000 - Date.now();
  if (wait > 0) { setTimeout(next, wait); return; }
  const { fn, resolve, reject } = waiting.shift();
  running++;
  lastStart = Date.now();
  fn().then(resolve, reject).finally(() => { running--; next(); });
  next();
}
function throttled(fn) {
  return new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); next(); });
}

const euroNum = (s) => {
  const n = parseFloat(String(s || '').replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return Math.round(sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo));
}

function airbnbSearchUrl({ lat, lng, checkin, checkout, adults }) {
  const d = 0.06; // ± 6 km rond de plek
  const qs = new URLSearchParams({
    checkin, checkout, adults: String(adults),
    ne_lat: (lat + d).toFixed(4), ne_lng: (lng + d / Math.cos((lat * Math.PI) / 180)).toFixed(4),
    sw_lat: (lat - d).toFixed(4), sw_lng: (lng - d / Math.cos((lat * Math.PI) / 180)).toFixed(4),
    search_by_map: 'true', search_type: 'user_map_move', zoom_level: '12',
  });
  qs.append('room_types[]', 'Entire home/apt');
  return `https://www.airbnb.nl/s/homes?${qs}`;
}

function parseAirbnb(html, adults) {
  const m = /<script id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  let results = null;
  const walk = (o) => {
    if (results || !o || typeof o !== 'object') return;
    if (Array.isArray(o.searchResults) && o.searchResults.some((r) => r && r.structuredDisplayPrice)) { results = o.searchResults; return; }
    for (const v of Object.values(o)) walk(v);
  };
  walk(data);
  if (!results) return null;
  return results.map((r) => {
    const line = (r.structuredDisplayPrice && r.structuredDisplayPrice.primaryLine) || {};
    const total = euroNum(line.discountedPrice || line.price);
    const dsl = r.demandStayListing || {};
    let id = null;
    try { id = Buffer.from(String(dsl.id || ''), 'base64').toString().split(':')[1] || null; } catch { /* geen id */ }
    const c = (dsl.location && dsl.location.coordinate) || {};
    const sc = r.structuredContent || {};
    const lines = [...new Set([...(sc.primaryLine || []), ...(sc.mapPrimaryLine || [])]
      .filter((x) => /BEDINFO|BATHROOMINFO|ROOM/.test(x.type || '')).map((x) => x.body).filter(Boolean))];
    const name = (r.nameLocalized && r.nameLocalized.localizedStringWithTranslationPreference)
      || (dsl.description && dsl.description.name && dsl.description.name.localizedStringWithTranslationPreference) || r.subtitle || r.title || 'Airbnb';
    const rating = /^([\d,]+)(?:\s*\((\d+)\))?/.exec(r.avgRatingLocalized || '');
    const pic = (r.contextualPictures || [])[0];
    return {
      id, name, type: r.title && r.title !== 'Prijsopbouw' ? r.title : '',
      total, perPerson: total ? Math.round(total / adults) : null,
      rating: rating ? parseFloat(rating[1].replace(',', '.')) : null, reviews: rating && rating[2] ? +rating[2] : 0,
      rooms: lines.join(' · '),
      image: pic ? `${pic.picture.split('?')[0]}?im_w=720` : '',
      lat: c.latitude ?? null, lng: c.longitude ?? null,
      link: id ? `https://www.airbnb.nl/rooms/${id}` : '',
    };
  }).filter((x) => x.total && x.id);
}

// Echte Airbnb-prijzen rond een plek, voor de hele groep.
async function stayPrices({ lat, lng, checkin, checkout, adults }) {
  lat = +lat; lng = +lng; adults = Math.min(16, Math.max(1, parseInt(adults, 10) || 2));
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180) || !isoDate(checkin) || !isoDate(checkout) || checkout <= checkin) {
    throw Object.assign(new Error('Ongeldige plek of datums'), { status: 400 });
  }
  const key = `airbnb|${lat.toFixed(2)}|${lng.toFixed(2)}|${checkin}|${checkout}|${adults}`;
  const url = airbnbSearchUrl({ lat, lng, checkin, checkout, adults });
  return cached(key, 12 * 3600e3, () => throttled(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'nl-NL,nl;q=0.9' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`airbnb: HTTP ${res.status}`);
    const listings = parseAirbnb(await res.text(), adults);
    if (!listings) throw new Error('airbnb: pagina niet te lezen');
    const totals = listings.map((x) => x.total).sort((a, b) => a - b);
    const nights = Math.round((new Date(checkout) - new Date(checkin)) / 864e5);
    return {
      source: 'Airbnb', checkin, checkout, nights, adults, url,
      count: listings.length,
      // Prijs voor de hele groep, per niveau: voordelig (goedkoopste kwart), midden, luxe (duurste kwart).
      levels: totals.length ? { budget: quantile(totals, 0.15), mid: quantile(totals, 0.5), luxe: quantile(totals, 0.85), min: totals[0] } : null,
      listings: listings.sort((a, b) => a.total - b.total).slice(0, 12),
      fetchedAt: new Date().toISOString(),
    };
  }));
}

// Echte vluchtprijzen (retour, per persoon) via Travelpayouts. Zonder token: null.
const flightsEnabled = () => !!process.env.TRAVELPAYOUTS_TOKEN;
async function flightPrices({ origin = 'AMS', destination, depart, ret }) {
  if (!flightsEnabled()) return null;
  destination = String(destination || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(destination) || !/^\d{4}-\d{2}(-\d{2})?$/.test(String(depart || ''))) {
    throw Object.assign(new Error('Ongeldige bestemming of datum'), { status: 400 });
  }
  const key = `flight|${origin}|${destination}|${depart}|${ret || ''}`;
  return cached(key, 6 * 3600e3, async () => {
    const qs = new URLSearchParams({
      origin, destination, departure_at: depart, currency: 'eur', sorting: 'price', unique: 'false', limit: '5',
      one_way: ret ? 'false' : 'true', token: process.env.TRAVELPAYOUTS_TOKEN,
    });
    if (ret) qs.set('return_at', ret);
    const res = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${qs}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`travelpayouts: HTTP ${res.status}`);
    const json = await res.json();
    const list = (json.data || []).filter((f) => f.price).map((f) => ({
      price: f.price, airline: f.airline || '', departAt: f.departure_at || '', returnAt: f.return_at || '',
      transfers: f.transfers ?? null, link: f.link ? `https://www.aviasales.com${f.link}` : '',
    }));
    return { source: 'Aviasales', origin, destination, depart, ret: ret || null, cheapest: list[0] || null, list, fetchedAt: new Date().toISOString() };
  });
}

module.exports = { stayPrices, flightPrices, flightsEnabled, parseAirbnb, airbnbSearchUrl };
