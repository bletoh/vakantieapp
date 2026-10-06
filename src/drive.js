// Rijtijd over de weg (OSRM, OpenStreetMap) van een bestemming naar vliegvelden in de buurt.
// Zo vallen vliegvelden af die je alleen per boot bereikt (Ibiza vanuit Valencia) of die te ver rijden zijn.
// Uitkomsten worden 60 dagen bewaard: wegen en vliegvelden veranderen zelden.
const db = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS drive_cache (
  key TEXT PRIMARY KEY,
  minutes INTEGER,
  fetched_at INTEGER NOT NULL
);
`);
const TTL = 60 * 24 * 3600e3;
const getRow = db.prepare('SELECT minutes, fetched_at FROM drive_cache WHERE key = ?');
const putRow = db.prepare('INSERT OR REPLACE INTO drive_cache (key, minutes, fetched_at) VALUES (?, ?, ?)');

const pt = (p) => `${(+p[0]).toFixed(3)},${(+p[1]).toFixed(3)}`;
const keyOf = (from, to) => `${pt(from)}>${pt(to)}`;

// De openbare OSRM-server vraagt om rustig gebruik: één verzoek tegelijk, minstens 1 s ertussen.
let queue = Promise.resolve();
let last = 0;
function throttled(fn) {
  const run = queue.then(async () => {
    const wait = last + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

// Minuten rijden van `from` naar elk punt in `tos` ([lat, lng]); null = geen route over land/veer gevonden.
async function driveMinutes(from, tos) {
  const out = new Array(tos.length).fill(undefined);
  const missing = [];
  tos.forEach((to, i) => {
    const row = getRow.get(keyOf(from, to));
    if (row && Date.now() - row.fetched_at < TTL) out[i] = row.minutes;
    else missing.push(i);
  });
  if (missing.length) {
    const coords = [from, ...missing.map((i) => tos[i])].map((p) => `${(+p[1]).toFixed(5)},${(+p[0]).toFixed(5)}`).join(';');
    const data = await throttled(async () => {
      const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration`, {
        headers: { 'User-Agent': 'vakantieplanner (github.com/bletoh/vakantieapp)' }, signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`osrm: HTTP ${res.status}`);
      return res.json();
    });
    if (data.code !== 'Ok' || !data.durations) throw new Error(`osrm: ${data.code}`);
    missing.forEach((i, j) => {
      const sec = data.durations[0][j + 1];
      const min = sec == null ? null : Math.round(sec / 60);
      out[i] = min;
      putRow.run(keyOf(from, tos[i]), min, Date.now());
    });
  }
  return out;
}

module.exports = { driveMinutes };
