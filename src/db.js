const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

-- Stemronde: de groep kiest tussen bestemmingen (pinnen); te delen via een eigen link.
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  closes_at TEXT,
  participants TEXT,
  created_by TEXT,
  closed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS poll_options (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (poll_id, item_id)
);

-- Eén stem per persoon per ronde; opnieuw stemmen vervangt de oude stem.
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  voted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (poll_id, name)
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

// Soort tab: 'map' toont een kaart met pinnen; 'flight', 'stay', 'do' en 'eat' kun je aan een pin koppelen.
const TAB_KINDS = {
  Kaart: 'map', Locatie: 'map', Vlucht: 'flight', Overnachting: 'stay', Activiteiten: 'do', 'Eten & drinken': 'eat',
};

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

// Elke reis heeft een onraadbare code voor de alleen-lezen deellink (/reis/<code>).
const shareSlug = () => crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10);
if (!tripCols.includes('share_slug')) db.exec('ALTER TABLE trips ADD COLUMN share_slug TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS trips_share_slug ON trips (share_slug)');
for (const { id } of db.prepare('SELECT id FROM trips WHERE share_slug IS NULL').all()) {
  db.prepare('UPDATE trips SET share_slug = ? WHERE id = ?').run(shareSlug(), id);
}

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

// Activiteiten en Eten & drinken kun je sinds de kaartplanner ook aan een pin koppelen.
const setLooseKind = db.prepare("UPDATE sections SET kind = ? WHERE title = ? AND kind = ''");
setLooseKind.run('do', 'Activiteiten');
setLooseKind.run('eat', 'Eten & drinken');

// De kaart is de centrale plek van de app; de oude naam "Locatie" wordt "Kaart".
db.prepare("UPDATE sections SET title = 'Kaart', icon = '🗺️' WHERE kind = 'map' AND title = 'Locatie'").run();

/* ---------- groepen en accounts ---------- */

// Elke groep is een eigen omgeving met eigen tabs, pinnen, reizen, stemrondes, datumprikker en chat.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lid van een groep, met eigen voorkeuren (categorieën uit de ideeën) voor die groep.
CREATE TABLE IF NOT EXISTS team_members (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  likes TEXT NOT NULL DEFAULT '[]',
  dislikes TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  last_read INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, user_id)
);

-- Duim omhoog of omlaag per bestemming uit de ideeën (op naam, want die lijst is voor iedereen hetzelfde).
CREATE TABLE IF NOT EXISTS dest_reactions (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dest TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id, dest)
);

-- Chat. ref_type/ref_id wijzen naar een gedeelde reis, pin of stemronde; kind 'event' is een automatische melding.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL DEFAULT '',
  ref_type TEXT,
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_team ON messages (team_id, id);

CREATE TABLE IF NOT EXISTS team_settings (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (team_id, key)
);
`);

const inviteCode = () => crypto.randomBytes(12).toString('base64url').replace(/[-_]/g, 'x').slice(0, 12);

for (const table of ['sections', 'trips', 'polls']) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes('team_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE`);
  db.exec(`CREATE INDEX IF NOT EXISTS ${table}_team ON ${table} (team_id)`);
}

// Alles van vóór de groepen wordt de eerste groep. Wie als eerste via de uitnodigingslink binnenkomt, wordt beheerder.
db.transaction(() => {
  const hasTeams = db.prepare('SELECT COUNT(*) AS n FROM teams').get().n > 0;
  const hasData = db.prepare('SELECT COUNT(*) AS n FROM sections').get().n > 0;
  if (hasTeams || !hasData) return;
  const title = (db.prepare("SELECT value FROM settings WHERE key = 'site_title'").get() || {}).value || 'Onze vakantie';
  const id = db.prepare('INSERT INTO teams (name, invite_code) VALUES (?, ?)').run(title, inviteCode()).lastInsertRowid;
  for (const table of ['sections', 'trips', 'polls']) db.prepare(`UPDATE ${table} SET team_id = ? WHERE team_id IS NULL`).run(id);
  db.prepare('INSERT OR IGNORE INTO team_settings (team_id, key, value) SELECT ?, key, value FROM settings').run(id);
})();

// De datumprikker hoort ook bij een groep; de tabel krijgt daarvoor een nieuwe sleutel.
const availCols = db.prepare('PRAGMA table_info(available_days)').all().map((c) => c.name);
if (!availCols.includes('team_id')) {
  const first = db.prepare('SELECT MIN(id) AS id FROM teams').get().id;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE available_days_new (
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        date TEXT NOT NULL,
        PRIMARY KEY (team_id, name, date)
      )`);
    if (first) db.prepare('INSERT INTO available_days_new (team_id, name, date) SELECT ?, name, date FROM available_days').run(first);
    db.exec('DROP TABLE available_days; ALTER TABLE available_days_new RENAME TO available_days;');
  })();
}

// Een nieuwe groep begint met lege tabs; alle tekst vul je zelf in.
function seedTeam(teamId) {
  const tabs = [
    ['Kaart', '🗺️'],
    ['Vlucht', '✈️'],
    ['Overnachting', '🏨'],
    ['Activiteiten', '🎉'],
    ['Eten & drinken', '🍽️'],
    ['Budget', '💶'],
  ];
  const insert = db.prepare(`
    INSERT INTO sections (team_id, title, icon, intro, position, show_price, kind) VALUES (?, ?, ?, '', ?, ?, ?)
  `);
  tabs.forEach(([title, icon], i) => insert.run(teamId, title, icon, i, PRICED_TABS.includes(title) ? 1 : 0, TAB_KINDS[title] || ''));
}

function createTeam(name, userId) {
  return db.transaction(() => {
    const id = db.prepare('INSERT INTO teams (name, invite_code, created_by) VALUES (?, ?, ?)').run(name, inviteCode(), userId).lastInsertRowid;
    db.prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'admin')").run(id, userId);
    db.prepare("INSERT INTO team_settings (team_id, key, value) VALUES (?, 'site_title', ?)").run(id, name);
    seedTeam(id);
    return id;
  })();
}

// Automatische melding in de chat, bijv. "Sam stelt een reis voor".
function postEvent(teamId, userId, body, refType = null, refId = null) {
  db.prepare("INSERT INTO messages (team_id, user_id, kind, body, ref_type, ref_id) VALUES (?, ?, 'event', ?, ?, ?)")
    .run(teamId, userId, body, refType, refId);
}

// Stemrondes met opties, stemmen en of ze (ook door de sluitdatum) gesloten zijn.
function getPolls(teamId) {
  const today = new Date().toISOString().slice(0, 10);
  const polls = teamId == null ? db.prepare('SELECT * FROM polls ORDER BY id DESC').all()
    : db.prepare('SELECT * FROM polls WHERE team_id = ? ORDER BY id DESC').all(teamId);
  const ids = new Set(polls.map((p) => p.id));
  const options = db.prepare('SELECT poll_id, item_id FROM poll_options').all().filter((o) => ids.has(o.poll_id));
  const votes = db.prepare('SELECT poll_id, name, item_id, voted_at FROM poll_votes ORDER BY voted_at').all().filter((v) => ids.has(v.poll_id));
  for (const p of polls) {
    p.item_ids = options.filter((o) => o.poll_id === p.id).map((o) => o.item_id);
    p.votes = votes.filter((v) => v.poll_id === p.id).map(({ name, item_id, voted_at }) => ({ name, item_id, voted_at }));
    p.participants = String(p.participants || '').split('\n').filter(Boolean);
    p.is_closed = !!p.closed || !!(p.closes_at && p.closes_at < today);
  }
  return polls;
}

const teamSetting = (teamId, key) => (db.prepare('SELECT value FROM team_settings WHERE team_id = ? AND key = ?').get(teamId, key) || {}).value || '';

// Wanneer de pin, reis of stemronde van een bericht verwijderd is (daarna gaat het bericht weg).
if (!db.prepare('PRAGMA table_info(messages)').all().some((c) => c.name === 'gone_at')) db.exec('ALTER TABLE messages ADD COLUMN gone_at TEXT');

module.exports = db;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
module.exports.DATA_DIR = DATA_DIR;
module.exports.getPolls = getPolls;
module.exports.shareSlug = shareSlug;
module.exports.inviteCode = inviteCode;
module.exports.createTeam = createTeam;
module.exports.postEvent = postEvent;
module.exports.teamSetting = teamSetting;
