const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'vakantieplanner.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  icon TEXT,
  intro TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT,
  body TEXT,
  image TEXT,
  link TEXT,
  price TEXT,
  rating INTEGER,
  pros TEXT,
  cons TEXT,
  is_best INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Een reis bundelt suggesties uit verschillende tabs (locatie, vlucht, overnachting, ...).
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  note TEXT,
  added_by TEXT,
  likes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trip_picks (
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (trip_id, item_id)
);

-- Datumprikker: per persoon de dagen waarop diegene kan (datum als JJJJ-MM-DD).
CREATE TABLE IF NOT EXISTS available_days (
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (name, date)
);
`);

// Prijs tonen we alleen bij tabs met dingen die je koopt.
const PRICED_TABS = ['Vlucht', 'Overnachting'];

// Soort tab: 'map' toont een kaart met pinnen, 'flight' en 'stay' kun je aan een pin koppelen.
const TAB_KINDS = { Locatie: 'map', Vlucht: 'flight', Overnachting: 'stay' };

// Kolommen die later zijn toegevoegd aan bestaande databases.
const itemCols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
if (!itemCols.includes('added_by')) db.exec('ALTER TABLE items ADD COLUMN added_by TEXT');
if (!itemCols.includes('lat')) db.exec('ALTER TABLE items ADD COLUMN lat REAL');
if (!itemCols.includes('lng')) db.exec('ALTER TABLE items ADD COLUMN lng REAL');
if (!itemCols.includes('location_id')) {
  db.exec('ALTER TABLE items ADD COLUMN location_id INTEGER REFERENCES items(id) ON DELETE SET NULL');
}

const tripCols = db.prepare('PRAGMA table_info(trips)').all().map((c) => c.name);
if (!tripCols.includes('start_date')) db.exec('ALTER TABLE trips ADD COLUMN start_date TEXT');
if (!tripCols.includes('end_date')) db.exec('ALTER TABLE trips ADD COLUMN end_date TEXT');

const sectionCols = db.prepare('PRAGMA table_info(sections)').all().map((c) => c.name);
if (!sectionCols.includes('show_price')) {
  db.exec('ALTER TABLE sections ADD COLUMN show_price INTEGER NOT NULL DEFAULT 0');
  db.prepare(`UPDATE sections SET show_price = 1 WHERE title IN (${PRICED_TABS.map(() => '?').join(', ')})`)
    .run(...PRICED_TABS);
}
if (!sectionCols.includes('kind')) {
  db.exec("ALTER TABLE sections ADD COLUMN kind TEXT NOT NULL DEFAULT ''");
  const setKind = db.prepare('UPDATE sections SET kind = ? WHERE title = ?');
  for (const [title, kind] of Object.entries(TAB_KINDS)) setKind.run(kind, title);
}

// Eerste keer opstarten: alleen lege tabs aanmaken, alle tekst vul je zelf in.
function seed() {
  const hasSections = db.prepare('SELECT COUNT(*) AS n FROM sections').get().n > 0;
  if (hasSections) return;

  const tabs = [
    ['Locatie', '📍'],
    ['Vlucht', '✈️'],
    ['Overnachting', '🏨'],
    ['Activiteiten', '🎉'],
    ['Eten & drinken', '🍽️'],
    ['Budget', '💶'],
  ];
  const insert = db.prepare(`
    INSERT INTO sections (title, icon, intro, position, show_price, kind) VALUES (?, ?, '', ?, ?, ?)
  `);
  db.transaction(() => tabs.forEach(([title, icon], i) => (
    insert.run(title, icon, i, PRICED_TABS.includes(title) ? 1 : 0, TAB_KINDS[title] || '')
  )))();
}

seed();

module.exports = db;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
