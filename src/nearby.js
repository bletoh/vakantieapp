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

async function fetchOverpass(query, urls = [...MIRRORS, MIRRORS[0]]) {
  let lastErr;
  // Elke server een kans en de hoofdserver nog een tweede: Overpass is soms even te druk (429/504).
  for (const url of urls) {
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

// Vliegvelden met lijnvluchten komen uit een vaste lijst (OurAirports, publiek domein),
// zodat vluchtsuggesties meteen verschijnen, ook als Overpass druk is.
// Bijwerken: zie scripts/vliegvelden.js.
const AIRPORTS = require('./airports.json');

function airportsNear(lat, lng, meters = 200000) {
  const [s, w, n, e] = bbox(lat, lng, meters).split(',').map(Number);
  return AIRPORTS
    .filter(([, , la, ln]) => la >= s && la <= n && ln >= w && ln <= e)
    .map(([iata, name, la, ln, large]) => ({
      type: 'node', lat: la, lon: ln,
      tags: { iata, name, 'aerodrome:type': large ? 'international' : 'regional' },
    }));
}

// Photon (komoot) geeft in één snelle vraag de dichtstbijzijnde plekken met een bepaalde OSM-tag.
// Minder details dan Overpass (geen sterren of website), maar binnen een paar seconden en zelden druk.
const PHOTON = {
  hotels: { radius: 6, limit: 80, tags: ['tourism:hotel', 'tourism:guest_house', 'tourism:apartment', 'tourism:hostel', 'tourism:motel', 'leisure:resort'] },
  eat: { radius: 2, limit: 60, tags: ['amenity:restaurant', 'amenity:cafe', 'amenity:bar', 'amenity:ice_cream', 'amenity:pub'] },
  do: { radius: 8, limit: 60, tags: ['tourism:attraction', 'tourism:museum', 'tourism:viewpoint', 'tourism:theme_park', 'tourism:zoo',
    'tourism:aquarium', 'tourism:gallery', 'natural:beach', 'leisure:water_park', 'historic:castle', 'historic:ruins', 'historic:archaeological_site'] },
};
const OSM_TYPES = { N: 'node', W: 'way', R: 'relation' };

async function fetchPhoton(kind, lat, lng) {
  const cfg = PHOTON[kind];
  const qs = new URLSearchParams({ lat, lon: lng, radius: cfg.radius, limit: cfg.limit });
  for (const t of cfg.tags) qs.append('osm_tag', t);
  const res = await fetch(`https://photon.komoot.io/reverse?${qs}`, {
    headers: { 'User-Agent': 'vakantieplanner (prive groepsapp)' },
    // Photon is meestal binnen een paar seconden klaar, maar soms veel trager; niet te vroeg opgeven.
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`photon: HTTP ${res.status}`);
  const data = await res.json();
  // Omzetten naar dezelfde vorm als Overpass, zodat de app er niets van merkt.
  return (data.features || []).filter((f) => f.properties && f.properties.name).map((f) => {
    const p = f.properties;
    const [lon, la] = f.geometry.coordinates;
    const tags = { name: p.name, [p.osm_key]: p.osm_value };
    if (p.street) tags['addr:street'] = p.street;
    if (p.housenumber) tags['addr:housenumber'] = p.housenumber;
    if (p.locality || p.city) tags['addr:city'] = p.locality || p.city;
    return { type: OSM_TYPES[p.osm_type] || 'node', id: p.osm_id, lat: la, lon, tags, photon: true };
  });
}

// Hotels en eten: eerst Photon (snel; dichtbij is wat je wilt). Activiteiten: eerst Overpass,
// want dat kent bekende plekken (Wikipedia); lukt dat niet snel, dan Photon.
async function fetchNearby(kind, lat, lng) {
  const overpass = (urls) => limited(() => fetchOverpass(QUERIES[kind](lat, lng), urls));
  if (kind === 'hotels' || kind === 'eat') {
    try {
      const els = await fetchPhoton(kind, lat, lng);
      if (els.length) return els;
    } catch (err) { console.error('nearby', err.message); }
    return overpass();
  }
  if (kind === 'do') {
    try { return await overpass(MIRRORS.slice(0, 2)); } catch (err) {
      console.error('nearby', err.message);
      return fetchPhoton(kind, lat, lng);
    }
  }
  return overpass();
}

function saveCache(key, els) {
  db.prepare(`INSERT INTO nearby_cache (key, data, fetched_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`).run(key, JSON.stringify(els));
}

// Hotels van Photon hebben geen sterren of website. Daarom vragen we daarna op de achtergrond
// Overpass en voegen we beide samen in de cache: de eerste keer snel, daarna meer hotels mét sterren.
const enriching = new Set();
const nameKey = (el) => String((el.tags && el.tags.name) || '').trim().toLowerCase();
function enrichHotels(key, lat, lng, photonEls) {
  if (enriching.has(key)) return;
  enriching.add(key);
  limited(() => fetchOverpass(QUERIES.hotels(lat, lng), MIRRORS.slice(0, 2)))
    .then((overpassEls) => {
      const rich = new Map(overpassEls.filter((el) => nameKey(el)).map((el) => [nameKey(el), el]));
      const merged = photonEls.map((el) => rich.get(nameKey(el)) || el);
      const seen = new Set(merged.map(nameKey));
      for (const el of overpassEls) if (nameKey(el) && !seen.has(nameKey(el))) { merged.push(el); seen.add(nameKey(el)); }
      saveCache(key, merged.map((el) => ({ ...el, photon: undefined })));
    })
    .catch((err) => console.error('hotels aanvullen', err.message))
    .finally(() => enriching.delete(key));
}

function nearby(kind, lat, lng) {
  if (!QUERIES[kind]) throw Object.assign(new Error('Onbekende soort'), { status: 400 });
  if (kind === 'airports') return Promise.resolve(airportsNear(+lat, +lng));
  // Afronden op ± 100 m, zodat een iets verschoven pin de cache nog gebruikt.
  const la = (+lat).toFixed(3);
  const ln = (+lng).toFixed(3);
  const key = `${kind}|${la}|${ln}`;
  const row = db.prepare(`SELECT data FROM nearby_cache WHERE key = ? AND fetched_at > datetime('now', '-${TTL_DAYS} days')`).get(key);
  if (row) return Promise.resolve(JSON.parse(row.data));
  if (inFlight.has(key)) return inFlight.get(key);
  const job = fetchNearby(kind, +la, +ln).then((els) => {
    saveCache(key, els);
    if (kind === 'hotels' && els.some((el) => el.photon)) enrichHotels(key, +la, +ln, els);
    return els;
  });
  inFlight.set(key, job);
  job.finally(() => inFlight.delete(key)).catch(() => {});
  return job;
}

// Is er een verse cache voor deze plek?
function isCached(kind, lat, lng) {
  const key = `${kind}|${(+lat).toFixed(3)}|${(+lng).toFixed(3)}`;
  return !!db.prepare(`SELECT 1 FROM nearby_cache WHERE key = ? AND fetched_at > datetime('now', '-${TTL_DAYS - 1} days')`).get(key);
}

// Hotels voor alle bestemmingen in de ideeën-tab alvast ophalen, rustig één voor één,
// zodat de tab meteen pakketten met verblijven laat zien. Draait bij het opstarten en daarna dagelijks.
function prewarmHotels(places) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    let n = 0;
    try {
      for (const { lat, lng } of places) {
        if (isCached('hotels', lat, lng)) {
          // Wel in de cache, maar nog alleen de snelle Photon-lijst: Overpass opnieuw proberen voor sterren.
          const la = (+lat).toFixed(3);
          const ln = (+lng).toFixed(3);
          const key = `hotels|${la}|${ln}`;
          const row = db.prepare('SELECT data FROM nearby_cache WHERE key = ?').get(key);
          const els = row ? JSON.parse(row.data) : [];
          if (els.some((el) => el.photon)) { enrichHotels(key, +la, +ln, els); await wait(3000); }
          continue;
        }
        try { await nearby('hotels', lat, lng); n++; } catch (err) { console.error('vooraf ophalen', err.message); }
        await wait(3000);
      }
    } finally { busy = false; }
    if (n) console.log(`Hotels vooraf opgehaald voor ${n} bestemmingen`);
  };
  setTimeout(run, 15000);
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}

module.exports = { nearby, prewarmHotels };
