const express = require('express');
const db = require('../db');

const router = express.Router();

// List all activities with vote counts
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, COUNT(v.id) as vote_count
    FROM activities a
    LEFT JOIN votes v ON v.activity_id = a.id
    GROUP BY a.id
    ORDER BY vote_count DESC, a.created_at DESC
  `).all();
  res.json(rows);
});

// Single activity with voter names
router.get('/:id', (req, res) => {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!activity) return res.status(404).json({ error: 'Niet gevonden' });
  const voters = db.prepare('SELECT name, created_at FROM votes WHERE activity_id = ? ORDER BY created_at').all(req.params.id);
  res.json({ ...activity, voters });
});

// Create activity
router.post('/', (req, res) => {
  const { title, description, added_by } = req.body;
  if (!title || !title.trim() || !added_by || !added_by.trim()) {
    return res.status(400).json({ error: 'Titel en naam zijn verplicht' });
  }
  const info = db.prepare('INSERT INTO activities (title, description, added_by) VALUES (?, ?, ?)')
    .run(title.trim(), (description || '').trim(), added_by.trim());
  res.status(201).json({ id: info.lastInsertRowid });
});

// Delete activity
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Vote (toggle: if already voted by this name, remove vote)
router.post('/:id/vote', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Naam is verplicht' });
  const existing = db.prepare('SELECT id FROM votes WHERE activity_id = ? AND name = ?').get(req.params.id, name.trim());
  if (existing) {
    db.prepare('DELETE FROM votes WHERE id = ?').run(existing.id);
    return res.json({ voted: false });
  }
  db.prepare('INSERT INTO votes (activity_id, name) VALUES (?, ?)').run(req.params.id, name.trim());
  res.json({ voted: true });
});

module.exports = router;
