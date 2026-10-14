const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { nearby } = require('../nearby');
const { linkInfo, saveImage } = require('../linkinfo');
const prices = require('../prices');
const { driveMinutes } = require('../drive');

const router = express.Router();

const SETTING_KEYS = [
  'site_title', 'site_subtitle', 'destination', 'date_text',
  'hero_image', 'footer_text',
  'poll_start', 'poll_end', 'trip_days',
];
const SECTION_FIELDS = ['title', 'icon', 'intro', 'show_price', 'kind'];
const SECTION_KINDS = ['', 'map', 'flight', 'stay', 'do', 'eat', 'car'];
const ITEM_FIELDS = ['title', 'subtitle', 'body', 'image', 'link', 'price', 'rating', 'pros', 'cons', 'added_by', 'lat', 'lng', 'location_id', 'min_age', 'young_fee'];

function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

function normalizeItem(data, teamId) {
  if ('rating' in data) {
    const r = parseInt(data.rating, 10);
    data.rating = r >= 1 && r <= 5 ? r : null;
  }
  if ('min_age' in data) {
    const a = parseInt(data.min_age, 10);
    data.min_age = a >= 16 && a <= 99 ? a : null;
  }
  if ('young_fee' in data) {
    const f = parseFloat(String(data.young_fee ?? '').replace(',', '.'));
    data.young_fee = Number.isFinite(f) && f >= 0 ? Math.round(f * 100) / 100 : null;
  }
  for (const k of ['lat', 'lng']) {
    if (k in data) {
      const n = parseFloat(data[k]);
      data[k] = Number.isFinite(n) ? n : null;
    }
  }
  if ('location_id' in data) {
    const id = parseInt(data.location_id, 10);
    data.location_id = id && itemOfTeam(teamId, id) ? id : null;
  }
  for (const k of Object.keys(data)) {
    if (typeof data[k] === 'string') data[k] = data[k].trim();
  }
  return data;
}

// Alles hieronder werkt binnen de actieve groep (req.team, gezet door requireTeam).
const sectionOfTeam = (teamId, id) => db.prepare('SELECT * FROM sections WHERE id = ? AND team_id = ?').get(id, teamId);
const itemOfTeam = (teamId, id) => db.prepare('SELECT i.* FROM items i JOIN sections s ON s.id = i.section_id WHERE i.id = ? AND s.team_id = ?').get(id, teamId);
const tripOfTeam = (teamId, id) => db.prepare('SELECT * FROM trips WHERE id = ? AND team_id = ?').get(id, teamId);
const pollOfTeam = (teamId, id) => db.getPolls(teamId).find((p) => p.id === +id);

function notFound(what) {
  const err = new Error(`${what} niet gevonden`);
  err.status = 404;
  return err;
}

function updateRow(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`;
  db.prepare(sql).run({ ...data, id });
}

function getContent(team, user) {
  const settings = {};
  for (const r of db.prepare('SELECT key, value FROM team_settings WHERE team_id = ?').all(team.id)) settings[r.key] = r.value;
  settings.site_title = team.name;
  const sections = db.prepare('SELECT * FROM sections WHERE team_id = ? ORDER BY position, id').all(team.id);
  const items = db.prepare('SELECT i.* FROM items i JOIN sections s ON s.id = i.section_id WHERE s.team_id = ? ORDER BY i.position, i.id').all(team.id);
  for (const s of sections) s.items = items.filter((i) => i.section_id === s.id);
  const trips = db.prepare('SELECT * FROM trips WHERE team_id = ? ORDER BY id').all(team.id);
  const picks = db.prepare('SELECT p.trip_id, p.item_id FROM trip_picks p JOIN trips t ON t.id = p.trip_id WHERE t.team_id = ?').all(team.id);
  for (const t of trips) t.item_ids = picks.filter((p) => p.trip_id === t.id).map((p) => p.item_id);
  const availability = db.prepare('SELECT name, date FROM available_days WHERE team_id = ? ORDER BY name, date').all(team.id);
  const members = db.prepare(`
    SELECT u.id, u.name, m.role, m.likes, m.dislikes, m.note, m.joined_at FROM team_members m JOIN users u ON u.id = m.user_id
    WHERE m.team_id = ? ORDER BY u.name COLLATE NOCASE`).all(team.id)
    .map((m) => ({ ...m, likes: JSON.parse(m.likes || '[]'), dislikes: JSON.parse(m.dislikes || '[]') }));
  const reactions = db.prepare('SELECT user_id, dest, value FROM dest_reactions WHERE team_id = ?').all(team.id);
  return {
    team: { id: team.id, name: team.name, invite_code: team.invite_code, role: team.role },
    me: user, settings, sections, trips, availability, polls: db.getPolls(team.id), members, reactions,
  };
}

router.get('/content', (req, res) => {
  res.json(getContent(req.team, req.user));
});

/* ---------- settings ---------- */

router.put('/settings', (req, res) => {
  const upsert = db.prepare(`
    INSERT INTO team_settings (team_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(team_id, key) DO UPDATE SET value = excluded.value
  `);
  for (const key of SETTING_KEYS) {
    if (req.body[key] !== undefined) upsert.run(req.team.id, key, String(req.body[key]).trim());
  }
  // De titel is de naam van de groep.
  const title = String(req.body.site_title || '').trim().slice(0, 60);
  if (title) db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(title, req.team.id);
  res.json({ ok: true });
});

/* ---------- sections ---------- */

router.post('/sections', (req, res) => {
  const { title = 'Nieuwe tab', icon = '⭐', intro = '' } = req.body;
  const showPrice = req.body.show_price ? 1 : 0;
  const kind = SECTION_KINDS.includes(req.body.kind) ? req.body.kind : '';
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sections WHERE team_id = ?').get(req.team.id).p;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO sections (team_id, title, icon, intro, position, show_price, kind) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.team.id, String(title).trim() || 'Nieuwe tab', icon, intro, pos, showPrice, kind);
  res.json({ id: lastInsertRowid });
});

router.put('/sections/reorder', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const stmt = db.prepare('UPDATE sections SET position = ? WHERE id = ? AND team_id = ?');
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, id, req.team.id)))();
  res.json({ ok: true });
});

router.put('/sections/:id', (req, res) => {
  if (!sectionOfTeam(req.team.id, req.params.id)) throw notFound('Tab');
  const data = pick(req.body, SECTION_FIELDS);
  if ('show_price' in data) data.show_price = data.show_price ? 1 : 0;
  if ('kind' in data && !SECTION_KINDS.includes(data.kind)) data.kind = '';
  if (data.title !== undefined && !String(data.title).trim()) {
    return res.status(400).json({ error: 'Titel mag niet leeg zijn' });
  }
  updateRow('sections', req.params.id, data);
  res.json({ ok: true });
});

router.delete('/sections/:id', (req, res) => {
  db.prepare('DELETE FROM sections WHERE id = ? AND team_id = ?').run(req.params.id, req.team.id);
  res.json({ ok: true });
});

/* ---------- items ---------- */

router.post('/sections/:id/items', (req, res) => {
  const section = sectionOfTeam(req.team.id, req.params.id);
  if (!section) return res.status(404).json({ error: 'Tab niet gevonden' });
  const data = normalizeItem(pick(req.body, ITEM_FIELDS), req.team.id);
  if (!data.title) data.title = 'Nieuwe optie';
  // Wie iets toevoegt, staat er automatisch bij.
  data.added_by = req.user.name;
  const pos = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM items WHERE section_id = ?')
    .get(section.id).p;
  const cols = ['section_id', 'position', ...Object.keys(data)];
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO items (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`)
    .run({ ...data, section_id: section.id, position: pos });
  if (section.kind === 'map') db.postEvent(req.team.id, req.user.id, `heeft ${data.title} op de kaart gezet`, 'item', lastInsertRowid);
  res.json({ id: lastInsertRowid });
});

router.put('/sections/:id/items/reorder', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!sectionOfTeam(req.team.id, req.params.id)) throw notFound('Tab');
  const stmt = db.prepare('UPDATE items SET position = ? WHERE id = ? AND section_id = ?');
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, id, req.params.id)))();
  res.json({ ok: true });
});

router.put('/items/:id', (req, res) => {
  if (!itemOfTeam(req.team.id, req.params.id)) throw notFound('Optie');
  const data = normalizeItem(pick(req.body, ITEM_FIELDS), req.team.id);
  delete data.added_by;
  if (data.title !== undefined && !data.title) {
    return res.status(400).json({ error: 'Titel mag niet leeg zijn' });
  }
  updateRow('items', req.params.id, data);
  res.json({ ok: true });
});

router.put('/items/:id/best', (req, res) => {
  const item = itemOfTeam(req.team.id, req.params.id);
  if (!item) return res.status(404).json({ error: 'Niet gevonden' });
  db.transaction(() => {
    db.prepare('UPDATE items SET is_best = 0 WHERE section_id = ?').run(item.section_id);
    if (!item.is_best) db.prepare('UPDATE items SET is_best = 1 WHERE id = ?').run(item.id);
  })();
  res.json({ ok: true });
});

router.post('/items/:id/like', (req, res) => {
  if (!itemOfTeam(req.team.id, req.params.id)) throw notFound('Optie');
  const delta = req.body.delta === -1 ? -1 : 1;
  db.prepare('UPDATE items SET likes = MAX(0, likes + ?) WHERE id = ?').run(delta, req.params.id);
  const row = db.prepare('SELECT likes FROM items WHERE id = ?').get(req.params.id);
  res.json({ likes: row ? row.likes : 0 });
});

router.delete('/items/:id', (req, res) => {
  if (!itemOfTeam(req.team.id, req.params.id)) throw notFound('Optie');
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- trips ---------- */

function saveTrip(teamId, id, body, user) {
  const title = String(body.title || '').trim();
  if (!title) {
    const err = new Error('Geef de reis een naam');
    err.status = 400;
    throw err;
  }
  const note = String(body.note || '').trim();
  let start = /^\d{4}-\d{2}-\d{2}$/.test(body.start_date || '') ? body.start_date : null;
  let end = /^\d{4}-\d{2}-\d{2}$/.test(body.end_date || '') ? body.end_date : null;
  if (start && !end) end = start;
  if (end && !start) start = end;
  if (start && end && end < start) [start, end] = [end, start];
  const itemIds = (Array.isArray(body.item_ids) ? body.item_ids : [])
    .map((n) => parseInt(n, 10))
    .filter((n) => itemOfTeam(teamId, n));

  return db.transaction(() => {
    if (id) {
      const res = db.prepare('UPDATE trips SET title = ?, note = ?, start_date = ?, end_date = ? WHERE id = ? AND team_id = ?')
        .run(title, note, start, end, id, teamId);
      if (!res.changes) {
        const err = new Error('Reis niet gevonden');
        err.status = 404;
        throw err;
      }
    } else {
      id = db.prepare('INSERT INTO trips (team_id, title, note, added_by, start_date, end_date, share_slug) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(teamId, title, note, user.name, start, end, db.shareSlug()).lastInsertRowid;
      db.postEvent(teamId, user.id, `stelt een reis voor: ${title}`, 'trip', id);
    }
    db.prepare('DELETE FROM trip_picks WHERE trip_id = ?').run(id);
    const insert = db.prepare('INSERT OR IGNORE INTO trip_picks (trip_id, item_id) VALUES (?, ?)');
    for (const itemId of itemIds) insert.run(id, itemId);
    return id;
  })();
}

router.post('/trips', (req, res) => {
  res.json({ id: saveTrip(req.team.id, null, req.body, req.user) });
});

router.put('/trips/:id', (req, res) => {
  saveTrip(req.team.id, parseInt(req.params.id, 10), req.body, req.user);
  res.json({ ok: true });
});

router.post('/trips/:id/like', (req, res) => {
  if (!tripOfTeam(req.team.id, req.params.id)) throw notFound('Reis');
  const delta = req.body.delta === -1 ? -1 : 1;
  db.prepare('UPDATE trips SET likes = MAX(0, likes + ?) WHERE id = ?').run(delta, req.params.id);
  const row = db.prepare('SELECT likes FROM trips WHERE id = ?').get(req.params.id);
  res.json({ likes: row ? row.likes : 0 });
});

router.delete('/trips/:id', (req, res) => {
  db.prepare('DELETE FROM trips WHERE id = ? AND team_id = ?').run(req.params.id, req.team.id);
  res.json({ ok: true });
});

// Eén deellink voor meerdere reizen. Dezelfde selectie geeft dezelfde link terug.
router.post('/trip-bundles', (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.trip_ids) ? req.body.trip_ids : []).map((n) => parseInt(n, 10)))]
    .filter((n) => tripOfTeam(req.team.id, n));
  if (ids.length < 2) {
    const err = new Error('Kies minstens twee reizen');
    err.status = 400;
    throw err;
  }
  if (ids.length > 20) {
    const err = new Error('Kies maximaal 20 reizen');
    err.status = 400;
    throw err;
  }
  const key = [...ids].sort((a, b) => a - b).join(',');
  const found = db.prepare(`
    SELECT b.slug FROM trip_bundles b WHERE b.team_id = ? AND b.trip_key = ?
      AND (SELECT COUNT(*) FROM trip_bundle_trips x WHERE x.bundle_id = b.id) = ?`).get(req.team.id, key, ids.length);
  if (found) return res.json({ slug: found.slug });
  const slug = db.transaction(() => {
    const s = db.shareSlug();
    const id = db.prepare('INSERT INTO trip_bundles (team_id, slug, trip_key, created_by) VALUES (?, ?, ?, ?)')
      .run(req.team.id, s, key, req.user.name).lastInsertRowid;
    const add = db.prepare('INSERT INTO trip_bundle_trips (bundle_id, trip_id, position) VALUES (?, ?, ?)');
    ids.forEach((tripId, i) => add.run(id, tripId, i));
    return s;
  })();
  res.json({ slug });
});

/* ---------- datumprikker ---------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Zet één of meer dagen aan of uit voor een persoon.
router.put('/availability', (req, res) => {
  const { name } = req.user;
  const dates = (Array.isArray(req.body.dates) ? req.body.dates : [req.body.date])
    .filter((d) => ISO_DATE.test(String(d)));
  const add = db.prepare('INSERT OR IGNORE INTO available_days (team_id, name, date) VALUES (?, ?, ?)');
  const remove = db.prepare('DELETE FROM available_days WHERE team_id = ? AND name = ? AND date = ?');
  db.transaction(() => {
    for (const d of dates) (req.body.available ? add : remove).run(req.team.id, name, d);
  })();
  res.json({ ok: true });
});

// Je eigen dagen wissen mag altijd; die van een ander alleen als beheerder of als het geen lid (meer) is.
router.delete('/availability/:name', (req, res) => {
  const name = req.params.name;
  const isMember = db.prepare('SELECT 1 FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND u.name = ?').get(req.team.id, name);
  if (name.toLowerCase() !== req.user.name.toLowerCase() && isMember && req.team.role !== 'admin') {
    return res.status(403).json({ error: 'Alleen een beheerder kan de dagen van een ander wissen' });
  }
  db.prepare('DELETE FROM available_days WHERE team_id = ? AND name = ?').run(req.team.id, name);
  res.json({ ok: true });
});

/* ---------- stemronde ---------- */

function pollBody(teamId, body) {
  const title = String(body.title || '').trim().slice(0, 80) || 'Waar gaan we heen?';
  const closesAt = ISO_DATE.test(body.closes_at || '') ? body.closes_at : null;
  const participants = (Array.isArray(body.participants) ? body.participants : String(body.participants || '').split(/[\n,]/))
    .map((n) => String(n).trim().slice(0, 40)).filter(Boolean);
  const itemIds = (Array.isArray(body.item_ids) ? body.item_ids : [])
    .map((n) => parseInt(n, 10))
    .filter((n) => db.prepare("SELECT 1 FROM items i JOIN sections s ON s.id = i.section_id WHERE i.id = ? AND s.kind = 'map' AND s.team_id = ?").get(n, teamId));
  return { title, closesAt, participants: [...new Set(participants)].join('\n'), itemIds };
}

function setPollOptions(id, itemIds) {
  db.prepare('DELETE FROM poll_options WHERE poll_id = ?').run(id);
  // Stemmen op een bestemming die niet meer meedoet, vervallen.
  db.prepare(`DELETE FROM poll_votes WHERE poll_id = ? AND item_id NOT IN (${itemIds.map(() => '?').join(', ') || 'NULL'})`).run(id, ...itemIds);
  const insert = db.prepare('INSERT OR IGNORE INTO poll_options (poll_id, item_id) VALUES (?, ?)');
  for (const itemId of itemIds) insert.run(id, itemId);
}

router.post('/polls', (req, res) => {
  const p = pollBody(req.team.id, req.body);
  if (p.itemIds.length < 2) return res.status(400).json({ error: 'Kies minstens twee bestemmingen' });
  const slug = crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').slice(0, 7);
  const id = db.transaction(() => {
    const newId = db.prepare('INSERT INTO polls (team_id, slug, title, closes_at, participants, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.team.id, slug, p.title, p.closesAt, p.participants, req.user.name).lastInsertRowid;
    setPollOptions(newId, p.itemIds);
    db.postEvent(req.team.id, req.user.id, `is een stemronde begonnen: ${p.title}`, 'poll', newId);
    return newId;
  })();
  res.json({ id, slug });
});

router.put('/polls/:id', (req, res) => {
  const poll = db.prepare('SELECT * FROM polls WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!poll) return res.status(404).json({ error: 'Stemronde niet gevonden' });
  db.transaction(() => {
    if ('closed' in req.body) db.prepare('UPDATE polls SET closed = ? WHERE id = ?').run(req.body.closed ? 1 : 0, poll.id);
    if ('title' in req.body || 'item_ids' in req.body || 'closes_at' in req.body || 'participants' in req.body) {
      const p = pollBody(req.team.id, { title: poll.title, closes_at: poll.closes_at, participants: poll.participants, ...req.body });
      db.prepare('UPDATE polls SET title = ?, closes_at = ?, participants = ? WHERE id = ?').run(p.title, p.closesAt, p.participants, poll.id);
      if ('item_ids' in req.body) {
        if (p.itemIds.length < 2) {
          const err = new Error('Kies minstens twee bestemmingen');
          err.status = 400;
          throw err;
        }
        setPollOptions(poll.id, p.itemIds);
      }
    }
  })();
  res.json({ ok: true });
});

router.delete('/polls/:id', (req, res) => {
  db.prepare('DELETE FROM polls WHERE id = ? AND team_id = ?').run(req.params.id, req.team.id);
  res.json({ ok: true });
});

router.put('/polls/:id/vote', (req, res) => {
  const poll = pollOfTeam(req.team.id, req.params.id);
  if (!poll) return res.status(404).json({ error: 'Stemronde niet gevonden' });
  if (poll.is_closed) return res.status(400).json({ error: 'Deze stemronde is gesloten' });
  const { name } = req.user;
  const itemId = parseInt(req.body.item_id, 10);
  if (!itemId) {
    db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND name = ?').run(poll.id, name);
  } else {
    if (!poll.item_ids.includes(itemId)) return res.status(400).json({ error: 'Deze bestemming doet niet mee' });
    db.prepare(`INSERT INTO poll_votes (poll_id, name, item_id) VALUES (?, ?, ?)
      ON CONFLICT(poll_id, name) DO UPDATE SET item_id = excluded.item_id, voted_at = datetime('now')`).run(poll.id, name, itemId);
  }
  res.json({ ok: true });
});

/* ---------- in de buurt (OpenStreetMap, met cache) ---------- */

router.get('/nearby/:kind', async (req, res, next) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return res.status(400).json({ error: 'Ongeldige plek' });
  try {
    res.json(await nearby(req.params.kind, lat, lng));
  } catch (err) {
    console.error('nearby', err.message);
    res.status(err.status || 502).json({ error: 'OpenStreetMap is even niet bereikbaar' });
  }
});

/* ---------- roulette: het lot laten kiezen tussen twee bestemmingen ---------- */

// De server trekt de winnaar (niet de telefoon), en de uitslag komt in de groepschat,
// zodat niemand kan blijven draaien tot zijn favoriet wint zonder dat de groep het ziet.
router.post('/roulette', (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.item_ids) ? req.body.item_ids : []).map((n) => parseInt(n, 10)))];
  if (ids.length !== 2) return res.status(400).json({ error: 'Kies twee verschillende bestemmingen' });
  const items = ids.map((id) => db.prepare(`SELECT i.id, i.title FROM items i JOIN sections s ON s.id = i.section_id
    WHERE i.id = ? AND s.team_id = ? AND s.kind = 'map'`).get(id, req.team.id));
  if (items.some((x) => !x)) return res.status(400).json({ error: 'Kies twee bestemmingen op de kaart' });
  const index = crypto.randomInt(2);
  const short = (t) => String(t).split(',')[0].trim();
  const win = items[index];
  db.postEvent(req.team.id, req.user.id, `liet de roulette kiezen tussen ${short(items[0].title)} en ${short(items[1].title)}: ${short(win.title)} wint! 🎰`, 'item', win.id);
  res.json({ index, winner_id: win.id });
});

/* ---------- echte prijzen ---------- */

// Welke echte prijzen zijn er? (vluchten alleen met een Travelpayouts-token)
router.get('/prices/status', (req, res) => res.json({ stays: true, flights: prices.flightsEnabled() }));

router.get('/prices/stay', async (req, res, next) => {
  try { res.json(await prices.stayPrices(req.query)); } catch (err) {
    if (err.status) return next(err);
    console.error('prijzen verblijf', err.message);
    res.status(502).json({ error: 'Airbnb is nu even niet bereikbaar' });
  }
});

router.get('/prices/flight', async (req, res, next) => {
  try { res.json(await prices.flightPrices({ destination: req.query.destination, depart: req.query.depart, ret: req.query.ret })); } catch (err) {
    if (err.status) return next(err);
    console.error('prijzen vlucht', err.message);
    res.status(502).json({ error: 'Vluchtprijzen zijn nu even niet bereikbaar' });
  }
});

// Rijtijden van een plek naar een paar punten (vliegvelden), in minuten; null = niet over de weg bereikbaar.
router.post('/drive', async (req, res) => {
  const ok = (p) => Array.isArray(p) && Math.abs(+p[0]) <= 90 && Math.abs(+p[1]) <= 180;
  const from = req.body.from;
  const to = Array.isArray(req.body.to) ? req.body.to.slice(0, 10) : [];
  if (!ok(from) || !to.length || !to.every(ok)) return res.status(400).json({ error: 'Ongeldige punten' });
  try { res.json({ minutes: await driveMinutes(from, to) }); } catch (err) {
    console.error('rijtijd', err.message);
    res.status(502).json({ error: 'Rijtijden zijn nu even niet bereikbaar' });
  }
});

/* ---------- uploads ---------- */

let sharp = null;
try { sharp = require('sharp'); } catch { /* zonder sharp geen controle op uploads */ }
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// Titel, foto, score enz. uit een geplakte link (Airbnb, Booking, hotelsite).
router.post('/link-info', async (req, res, next) => {
  try {
    const info = await linkInfo(req.body && req.body.url);
    if (info.image) {
      const name = await saveImage(info.image, db.UPLOAD_DIR).catch(() => null);
      if (name) info.image = `/uploads/${name}`;
    }
    res.json(info);
  } catch (err) {
    if (err.status) return next(err);
    res.json({ blocked: true });
  }
});

router.post('/upload', (req, res) => {
  const match = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(req.body.data || '');
  const ext = match && MIME_EXT[match[1].toLowerCase()];
  if (!ext) return res.status(400).json({ error: 'Ongeldig afbeeldingsformaat' });
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const buf = Buffer.from(match[2], 'base64');
  // Controleren dat het echt een afbeelding is (en niet iets anders met een .jpg-naam).
  const check = sharp ? sharp(buf).metadata() : Promise.resolve({ format: ext });
  check.then((meta) => {
    if (!meta || !meta.format) throw new Error('geen afbeelding');
    fs.writeFileSync(path.join(db.UPLOAD_DIR, name), buf);
    res.json({ url: `/uploads/${name}` });
  }, () => res.status(400).json({ error: 'Dit bestand is geen afbeelding' }));
});

module.exports = router;
