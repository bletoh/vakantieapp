const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT ai.*, a.title as activity_title
    FROM agenda_items ai
    LEFT JOIN activities a ON a.id = ai.activity_id
    ORDER BY ai.date, ai.time
  `).all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { date, time, title, description, activity_id } = req.body;
  if (!date || !title || !title.trim()) {
    return res.status(400).json({ error: 'Datum en titel zijn verplicht' });
  }
  const info = db.prepare(`
    INSERT INTO agenda_items (date, time, title, description, activity_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(date, time || null, title.trim(), (description || '').trim(), activity_id || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM agenda_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
