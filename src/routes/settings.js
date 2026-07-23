const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

const ALLOWED_KEYS = ['period_start', 'period_end', 'destination'];

router.post('/', (req, res) => {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  for (const key of ALLOWED_KEYS) {
    if (req.body[key] !== undefined) upsert.run(key, req.body[key]);
  }
  res.json({ ok: true });
});

module.exports = router;
