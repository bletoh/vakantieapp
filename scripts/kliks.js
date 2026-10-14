// Hoe vaak er per site op een partnerlink is geklikt (zie src/affiliate.js).
// Gebruik: node scripts/kliks.js [dagen]   (in Docker: docker exec reismannetje node scripts/kliks.js 30)
const db = require('../src/db');
require('../src/affiliate'); // maakt de tabel aan als die er nog niet is
const days = Math.max(1, parseInt(process.argv[2], 10) || 30);
const rows = db.prepare(`SELECT partner, SUM(n) AS kliks, SUM(CASE WHEN tagged THEN n ELSE 0 END) AS met_code
  FROM outbound_clicks WHERE day >= date('now', ?) GROUP BY partner ORDER BY kliks DESC`).all(`-${days - 1} days`);
console.log(`Kliks op partnerlinks, laatste ${days} dagen:`);
if (!rows.length) console.log('  (nog geen)');
for (const r of rows) console.log(`  ${r.partner.padEnd(14)} ${String(r.kliks).padStart(5)}   waarvan met partnercode: ${r.met_code}`);
