// Maakt src/airports.json opnieuw uit de OurAirports-database (publiek domein).
// Alleen middelgrote en grote vliegvelden met lijnvluchten en een IATA-code.
//   node scripts/vliegvelden.js
const fs = require('fs');
const path = require('path');

const URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

function parseLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

(async () => {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Download mislukt: HTTP ${res.status}`);
  const [head, ...lines] = (await res.text()).split('\n');
  const h = parseLine(head);
  const col = (r, name) => r[h.indexOf(name)];
  const rows = lines.filter(Boolean).map(parseLine)
    .filter((r) => /^[A-Z]{3}$/.test(col(r, 'iata_code')) && col(r, 'scheduled_service') === 'yes'
      && ['large_airport', 'medium_airport'].includes(col(r, 'type')))
    .map((r) => [col(r, 'iata_code'), col(r, 'name'), +(+col(r, 'latitude_deg')).toFixed(4),
      +(+col(r, 'longitude_deg')).toFixed(4), col(r, 'type') === 'large_airport' ? 1 : 0]);
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'airports.json'), JSON.stringify(rows));
  console.log(`${rows.length} vliegvelden opgeslagen`);
})().catch((err) => { console.error(err.message); process.exit(1); });
