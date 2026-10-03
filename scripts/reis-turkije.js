// Zet een complete all-inclusive reis naar Turkije in de database:
// een locatie, een vlucht, een overnachting en een reis die ze bundelt.
//
// Gebruik (op de server):
//   docker compose exec vakantieplanner node scripts/reis-turkije.js
// of lokaal:
//   node scripts/reis-turkije.js
//
// Het script kan veilig vaker gedraaid worden: bestaat de reis al, dan doet het niets.
// Prijzen opgezocht op 3 oktober 2026; ze veranderen per datum, controleer ze via de link.

const db = require('../src/db');

const TRIP_TITLE = 'All inclusive Turkije – Side';

const SUGGESTIONS = {
  Locatie: {
    title: 'Side, Turkije',
    subtitle: 'Turkse Rivièra · provincie Antalya',
    body: 'Badplaats aan de Turkse Rivièra met lange zandstranden en veel all-inclusive resorts. '
      + 'Het oude centrum ligt op een schiereiland met Romeinse ruïnes, zoals de Tempel van Apollo aan het water. '
      + 'Vanaf Antalya Airport ongeveer een uur met de transfer.',
    pros: 'Veel all-inclusive hotels aan het strand\nZon en warme zee in het seizoen\nDirecte vluchten vanaf Amsterdam',
    cons: 'Transfer van ongeveer een uur vanaf het vliegveld\nIn de zomer druk en heet',
    rating: 4,
  },
  Vlucht: {
    title: 'Corendon · Amsterdam → Antalya',
    subtitle: 'AMS → AYT · direct · ± 4 uur',
    price: 'vanaf €118 p.p.',
    body: 'Corendon vliegt direct van Schiphol naar Antalya; de gemiddelde vliegtijd is 3 uur en 57 minuten. '
      + 'Laagste tarief volgens Corendon: €118 in november en €142 in december 2026. '
      + 'Welke bagage inbegrepen is hangt af van het gekozen tarief. '
      + 'Ook Pegasus, SunExpress, TUI en Transavia vliegen deze route.',
    pros: 'Directe vlucht\nIn het seizoen dagelijks\nScherpe prijzen buiten het hoogseizoen',
    cons: 'Ruimbagage niet altijd inbegrepen',
    link: 'https://www.corendon.com/nl/vliegtickets-antalya',
    rating: 4,
  },
  Overnachting: {
    title: 'Side Crown Palace',
    subtitle: '5★ · Ultra all inclusive · Side',
    price: '± $72–80 per nacht',
    body: 'Groot resort met 270 kamers, op ongeveer 400 meter van het strand en 57 km van Antalya Airport. '
      + 'Ultra all inclusive, met verwarmd zwembad, waterglijbanen, spa, sauna en Turks stoombad. '
      + 'Gasten geven het gemiddeld een 7,8 (ruim 18.000 beoordelingen). '
      + 'Als pakketreis (8 dagen, vlucht en transfer inbegrepen) aangeboden vanaf ongeveer €281 tot €478 p.p., afhankelijk van de datum.',
    pros: 'Ultra all inclusive\nAquapark en spa\nPrivéstrand',
    cons: 'Ongeveer 400 m lopen naar het strand\nGroot en druk resort',
    link: 'https://www.vakanty.nl/turkije/antalya/side/hotel-side-crown-palace/',
    rating: 4,
  },
};

const TRIP_NOTE = 'Een week ultra all inclusive in Side: direct vliegen met Corendon en verblijven in Side Crown Palace. '
  + 'Boek je het als pakketreis (vlucht, transfer en hotel), dan begint het rond €281–€478 p.p. voor 8 dagen. '
  + 'Prijzen opgezocht op 3 oktober 2026.';

function run() {
  if (db.prepare('SELECT 1 FROM trips WHERE title = ?').get(TRIP_TITLE)) {
    console.log(`"${TRIP_TITLE}" bestaat al, er is niets toegevoegd.`);
    return;
  }

  const findSection = db.prepare('SELECT id FROM sections WHERE title = ?');
  const nextPos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM items WHERE section_id = ?');
  const insertItem = db.prepare(`
    INSERT INTO items (section_id, title, subtitle, body, price, rating, pros, cons, link, position)
    VALUES (@section_id, @title, @subtitle, @body, @price, @rating, @pros, @cons, @link, @position)
  `);

  db.transaction(() => {
    const itemIds = [];
    for (const [sectionTitle, s] of Object.entries(SUGGESTIONS)) {
      const section = findSection.get(sectionTitle);
      if (!section) {
        console.log(`Tab "${sectionTitle}" niet gevonden, deze suggestie is overgeslagen.`);
        continue;
      }
      const { lastInsertRowid } = insertItem.run({
        section_id: section.id,
        title: s.title,
        subtitle: s.subtitle || '',
        body: s.body || '',
        price: s.price || '',
        rating: s.rating || null,
        pros: s.pros || '',
        cons: s.cons || '',
        link: s.link || '',
        position: nextPos.get(section.id).p,
      });
      itemIds.push(lastInsertRowid);
      console.log(`Toegevoegd aan ${sectionTitle}: ${s.title}`);
    }

    const tripId = db.prepare('INSERT INTO trips (title, note) VALUES (?, ?)').run(TRIP_TITLE, TRIP_NOTE).lastInsertRowid;
    const pick = db.prepare('INSERT INTO trip_picks (trip_id, item_id) VALUES (?, ?)');
    for (const id of itemIds) pick.run(tripId, id);
    console.log(`Reis toegevoegd: ${TRIP_TITLE}`);
  })();
}

run();
