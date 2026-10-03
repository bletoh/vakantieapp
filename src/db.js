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
`);

// Eerste keer opstarten: alleen lege tabs aanmaken, alle tekst vul je zelf in.
// Kolommen die later zijn toegevoegd aan bestaande databases.
const itemCols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
if (!itemCols.includes('added_by')) db.exec('ALTER TABLE items ADD COLUMN added_by TEXT');

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
  const insert = db.prepare('INSERT INTO sections (title, icon, intro, position) VALUES (?, ?, \'\', ?)');
  db.transaction(() => tabs.forEach(([title, icon], i) => insert.run(title, icon, i)))();
}

seed();

module.exports = db;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
