const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, COUNT(v.id) as vote_count
    FROM accommodations a
    LEFT JOIN accommodation_votes v ON v.accommodation_id = a.id
    GROUP BY a.id
    ORDER BY vote_count DESC, a.created_at DESC
  `).all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const accommodation = db.prepare('SELECT * FROM accommodations WHERE id = ?').get(req.params.id);
  if (!accommodation) return res.status(404).json({ error: 'Niet gevonden' });
  const voters = db.prepare('SELECT name, created_at FROM accommodation_votes WHERE accommodation_id = ? ORDER BY created_at').all(req.params.id);
  res.json({ ...accommodation, voters });
});

router.post('/', (req, res) => {
  const { title, url, notes, added_by } = req.body;
  if (!title || !title.trim() || !added_by || !added_by.trim()) {
    return res.status(400).json({ error: 'Titel en naam zijn verplicht' });
  }
  const info = db.prepare('INSERT INTO accommodations (title, url, notes, added_by) VALUES (?, ?, ?, ?)')
    .run(title.trim(), (url || '').trim(), (notes || '').trim(), added_by.trim());
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM accommodations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/vote', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Naam is verplicht' });
  const existing = db.prepare('SELECT id FROM accommodation_votes WHERE accommodation_id = ? AND name = ?').get(req.params.id, name.trim());
  if (existing) {
    db.prepare('DELETE FROM accommodation_votes WHERE id = ?').run(existing.id);
    return res.json({ voted: false });
  }
  db.prepare('INSERT INTO accommodation_votes (accommodation_id, name) VALUES (?, ?)').run(req.params.id, name.trim());
  res.json({ voted: true });
});

module.exports = router;
