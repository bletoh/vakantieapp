// Plekken in de buurt van een pin uit OpenStreetMap (Overpass), met een cache in de database.
// Zo hoeft maar één persoon te wachten; daarna ziet de hele groep de resultaten meteen.
const db = require('./db');

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const TTL_DAYS = 14;

db.exec(`
CREATE TABLE IF NOT EXISTS nearby_cache (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Rechthoek rond de pin; dat is voor Overpass veel lichter dan een cirkel ("around").
function bbox(lat, lng, meters) {
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng].map((n) => n.toFixed(4)).join(',');
}

const QUERIES = {
  airports: (lat, lng) => `[out:json][timeout:25][bbox:${bbox(lat, lng, 200000)}];nwr["aeroway"="aerodrome"]["iata"];out center tags;`,
  hotels: (lat, lng) => `[out:json][timeout:25][bbox:${bbox(lat, lng, 5000)}];nwr["tourism"~"^(hotel|resort|apartment|hostel|guest_house|motel)$"]["name"];out center tags 80;`,
  do: (lat, lng) => `[out:json][timeout:25][bbox:${bbox(lat, lng, 8000)}];(nwr["tourism"~"^(attraction|museum|viewpoint|theme_park|zoo|aquarium|gallery)$"]["name"];nwr["natural"="beach"]["name"];nwr["leisure"="water_park"]["name"];nwr["historic"~"^(castle|ruins|archaeological_site)$"]["name"];);out center tags 120;`,
  eat: (lat, lng) => `[out:json][timeout:25][bbox:${bbox(lat, lng, 2000)}];nwr["amenity"~"^(restaurant|cafe|bar|ice_cream|pub)$"]["name"];out center tags 150;`,
};

// Hooguit twee verzoeken tegelijk naar Overpass (dat staat Overpass per adres toe),
// en dezelfde vraag nooit dubbel.
const MAX_PARALLEL = 2;
let running = 0;
const waiting = [];
const inFlight = new Map();

async function limited(fn) {
  if (running >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally {
    running--;
    if (waiting.length) waiting.shift()();
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOverpass(query) {
  let lastErr;
  // Elke server een kans en de hoofdserver nog een tweede: Overpass is soms even te druk (429/504).
  for (const url of [...MIRRORS, MIRRORS[0]]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'vakantieplanner (prive groepsapp)' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const data = await res.json();
      // Een time-out aan de kant van Overpass komt terug als lege lijst met een opmerking.
      if (data.remark && /timed out|runtime error/i.test(data.remark)) throw new Error(`${url}: ${data.remark}`);
      return data.elements || [];
    } catch (err) {
      lastErr = err;
      await wait(1500);
    }
  }
  throw lastErr;
}

function nearby(kind, lat, lng) {
  if (!QUERIES[kind]) throw Object.assign(new Error('Onbekende soort'), { status: 400 });
  // Afronden op ± 100 m, zodat een iets verschoven pin de cache nog gebruikt.
  const la = (+lat).toFixed(3);
  const ln = (+lng).toFixed(3);
  const key = `${kind}|${la}|${ln}`;
  const row = db.prepare(`SELECT data FROM nearby_cache WHERE key = ? AND fetched_at > datetime('now', '-${TTL_DAYS} days')`).get(key);
  if (row) return Promise.resolve(JSON.parse(row.data));
  if (inFlight.has(key)) return inFlight.get(key);
  const job = limited(() => fetchOverpass(QUERIES[kind](+la, +ln))).then((els) => {
    db.prepare(`INSERT INTO nearby_cache (key, data, fetched_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`).run(key, JSON.stringify(els));
    return els;
  });
  inFlight.set(key, job);
  job.finally(() => inFlight.delete(key)).catch(() => {});
  return job;
}

module.exports = { nearby };
