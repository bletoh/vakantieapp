const express = require('express');
const db = require('../db');

const router = express.Router();

// Full matrix: all names and their available dates
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT name, date FROM availability ORDER BY name, date').all();
  const byName = {};
  for (const row of rows) {
    if (!byName[row.name]) byName[row.name] = [];
    byName[row.name].push(row.date);
  }
  res.json(byName);
});

// Set (replace) availability for one person
router.post('/', (req, res) => {
  const { name, dates } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Naam is verplicht' });
  if (!Array.isArray(dates)) return res.status(400).json({ error: 'Dates moet een lijst zijn' });

  const trimmedName = name.trim();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM availability WHERE name = ?').run(trimmedName);
    const insert = db.prepare('INSERT INTO availability (name, date) VALUES (?, ?)');
    for (const d of dates) insert.run(trimmedName, d);
  });
  tx();
  res.json({ ok: true, count: dates.length });
});

module.exports = router;
