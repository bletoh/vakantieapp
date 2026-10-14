// Pushmeldingen (Web Push) bij nieuwe chatberichten en gebeurtenissen in je groep.
// De VAPID-sleutels worden één keer gemaakt en bewaard in DATA_DIR/vapid.json (zit in de back-up).
// Een melding gaat naar alle leden van de groep met meldingen aan, behalve naar wie het bericht stuurde.
// Wat er naar de pushdienst (Google, Apple, Mozilla) gaat is versleuteld; die ziet alleen dát er iets is.
const express = require('express');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const db = require('./db');

const KEY_FILE = path.join(db.DATA_DIR, 'vapid.json');
let keys;
try {
  keys = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
} catch {
  keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(KEY_FILE, JSON.stringify(keys), { mode: 0o600 });
}
webpush.setVapidDetails(process.env.PUBLIC_URL || 'https://reismannetje.nl', keys.publicKey, keys.privateKey);

db.exec(`
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const subsFor = db.prepare(`SELECT s.id, s.endpoint, s.p256dh, s.auth FROM push_subs s
  JOIN team_members m ON m.user_id = s.user_id WHERE m.team_id = ? AND s.user_id != ?`);
const dropSub = db.prepare('DELETE FROM push_subs WHERE id = ?');
const REF_TEXT = { trip: 'deelde een reis', item: 'deelde een plek', poll: 'deelde een stemronde' };

// Wordt aangeroepen bij elk nieuw bericht (zie db.onMessage); stuurt op de achtergrond, blokkeert niets.
function notify(teamId, userId, kind, body, refType) {
  setImmediate(() => {
    try {
      const subs = subsFor.all(teamId, userId);
      if (!subs.length) return;
      const team = db.prepare('SELECT name FROM teams WHERE id = ?').get(teamId);
      const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
      const name = user ? user.name : 'Iemand';
      const text = kind === 'event' ? `${name} ${body}` : body ? `${name}: ${body}` : `${name} ${REF_TEXT[refType] || 'stuurde iets'}`;
      const payload = JSON.stringify({
        title: team ? team.name : 'Reismannetje',
        body: text.length > 160 ? `${text.slice(0, 157)}…` : text,
        url: `/?team=${teamId}#chat`,
        tag: `team-${teamId}`,
      });
      for (const s of subs) {
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 })
          .catch((err) => {
            // 404/410: dit apparaat heeft meldingen uitgezet of de app verwijderd.
            if (err.statusCode === 404 || err.statusCode === 410) dropSub.run(s.id);
          });
      }
    } catch (err) {
      console.error('push:', err.message);
    }
  });
}
db.onMessage = notify;

// Alleen https-adressen van bekende pushdiensten, zodat de server niet naar willekeurige adressen gaat posten.
const PUSH_HOSTS = /(^|\.)(googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.microsoft\.com)$/;
function validSub(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return false;
  let u;
  try { u = new URL(sub.endpoint); } catch { return false; }
  return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname)
    && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string'
    && sub.endpoint.length < 1000 && sub.keys.p256dh.length < 200 && sub.keys.auth.length < 100;
}

const router = express.Router();
router.get('/key', (req, res) => res.json({ key: keys.publicKey }));
router.post('/subscribe', (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!validSub(sub)) return res.status(400).json({ error: 'Ongeldige aanmelding voor meldingen' });
  db.prepare(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(req.user.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
  res.json({ ok: true });
});
router.post('/unsubscribe', (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (typeof endpoint === 'string') db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user.id);
  res.json({ ok: true });
});

module.exports = { router, notify, validSub };
