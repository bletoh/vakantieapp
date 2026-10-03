const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

const SETTING_KEYS = [
  'site_title', 'site_subtitle', 'destination', 'date_text',
  'hero_image', 'footer_text',
];
const SECTION_FIELDS = ['title', 'icon', 'intro'];
const ITEM_FIELDS = ['title', 'subtitle', 'body', 'image', 'link', 'price', 'rating', 'pros', 'cons'];

function pick(body, fields) {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

function normalizeItem(data) {
  if ('rating' in data) {
    const r = parseInt(data.rating, 10);
    data.rating = r >= 1 && r <= 5 ? r : null;
  }
  for (const k of Object.keys(data)) {
    if (typeof data[k] === 'string') data[k] = data[k].trim();
  }
  return data;
}

function updateRow(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`;
  db.prepare(sql).run({ ...data, id });
}

function getContent() {
  const settings = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) settings[r.key] = r.value;
  const sections = db.prepare('SELECT * FROM sections ORDER BY position, id').all();
  const items = db.prepare('SELECT * FROM items ORDER BY position, id').all();
  for (const s of sections) s.items = items.filter((i) => i.section_id === s.id);
  return { settings, sections };
}

router.get('/content', (req, res) => {
  res.json(getContent());
});

/* ---------- settings ---------- */

router.put('/settings', (req, res) => {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  for (const key of SETTING_KEYS) {
    if (req.body[key] !== undefined) upsert.run(key, String(req.body[key]).trim());
  }
  res.json({ ok: true });
});

/* ---------- sections ---------- */

router.post('/sections', (req, res) => {
  const { title = 'Nieuwe tab', icon = '⭐', intro = '' } = req.body;
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sections').get().p;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO sections (title, icon, intro, position) VALUES (?, ?, ?, ?)')
    .run(title, icon, intro, pos);
  res.json({ id: lastInsertRowid });
});

router.put('/sections/reorder', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const stmt = db.prepare('UPDATE sections SET position = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, id)))();
  res.json({ ok: true });
});

router.put('/sections/:id', (req, res) => {
  const data = pick(req.body, SECTION_FIELDS);
  if (data.title !== undefined && !String(data.title).trim()) {
    return res.status(400).json({ error: 'Titel mag niet leeg zijn' });
  }
  updateRow('sections', req.params.id, data);
  res.json({ ok: true });
});

router.delete('/sections/:id', (req, res) => {
  db.prepare('DELETE FROM sections WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- items ---------- */

router.post('/sections/:id/items', (req, res) => {
  const section = db.prepare('SELECT id FROM sections WHERE id = ?').get(req.params.id);
  if (!section) return res.status(404).json({ error: 'Tab niet gevonden' });
  const data = normalizeItem(pick(req.body, ITEM_FIELDS));
  if (!data.title) data.title = 'Nieuwe optie';
  const pos = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM items WHERE section_id = ?')
    .get(section.id).p;
  const cols = ['section_id', 'position', ...Object.keys(data)];
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO items (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`)
    .run({ ...data, section_id: section.id, position: pos });
  res.json({ id: lastInsertRowid });
});

router.put('/sections/:id/items/reorder', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const stmt = db.prepare('UPDATE items SET position = ? WHERE id = ? AND section_id = ?');
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, id, req.params.id)))();
  res.json({ ok: true });
});

router.put('/items/:id', (req, res) => {
  const data = normalizeItem(pick(req.body, ITEM_FIELDS));
  if (data.title !== undefined && !data.title) {
    return res.status(400).json({ error: 'Titel mag niet leeg zijn' });
  }
  updateRow('items', req.params.id, data);
  res.json({ ok: true });
});

router.put('/items/:id/best', (req, res) => {
  const item = db.prepare('SELECT id, section_id, is_best FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Niet gevonden' });
  db.transaction(() => {
    db.prepare('UPDATE items SET is_best = 0 WHERE section_id = ?').run(item.section_id);
    if (!item.is_best) db.prepare('UPDATE items SET is_best = 1 WHERE id = ?').run(item.id);
  })();
  res.json({ ok: true });
});

router.post('/items/:id/like', (req, res) => {
  const delta = req.body.delta === -1 ? -1 : 1;
  db.prepare('UPDATE items SET likes = MAX(0, likes + ?) WHERE id = ?').run(delta, req.params.id);
  const row = db.prepare('SELECT likes FROM items WHERE id = ?').get(req.params.id);
  res.json({ likes: row ? row.likes : 0 });
});

router.delete('/items/:id', (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------- uploads ---------- */

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

router.post('/upload', (req, res) => {
  const match = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(req.body.data || '');
  const ext = match && MIME_EXT[match[1].toLowerCase()];
  if (!ext) return res.status(400).json({ error: 'Ongeldig afbeeldingsformaat' });
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(db.UPLOAD_DIR, name), Buffer.from(match[2], 'base64'));
  res.json({ url: `/uploads/${name}` });
});

module.exports = router;
