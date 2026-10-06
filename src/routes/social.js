// Accounts, groepen (met uitnodigingslink), voorkeuren en de groepschat.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const mail = require('../mail');

const router = express.Router();

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{0,29}$/u;
const EMAIL_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i;

// Optioneel e-mailadres controleren: '' = geen, anders geldig en nog niet in gebruik.
function cleanEmail(raw, userId = 0) {
  const email = String(raw || '').trim();
  if (!email) return null;
  if (!EMAIL_RE.test(email)) throw fail(400, 'Dat e-mailadres klopt niet');
  if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id != ?').get(email, userId)) throw fail(409, 'Dit e-mailadres hoort al bij een ander account');
  return email;
}

function fail(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function teamsOf(userId) {
  return db.prepare(`
    SELECT t.id, t.name, t.invite_code, m.role,
      (SELECT COUNT(*) FROM team_members x WHERE x.team_id = t.id) AS members,
      (SELECT COUNT(*) FROM messages g WHERE g.team_id = t.id AND g.id > m.last_read AND COALESCE(g.user_id, 0) != m.user_id) AS unread
    FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.name COLLATE NOCASE`).all(userId);
}

function joinTeam(team, user) {
  // Wie als eerste een groep zonder leden binnenkomt (de groep van vóór de accounts), wordt beheerder.
  const empty = !db.prepare('SELECT 1 FROM team_members WHERE team_id = ?').get(team.id);
  const res = db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)')
    .run(team.id, user.id, empty ? 'admin' : 'member');
  if (res.changes) db.postEvent(team.id, user.id, 'doet nu mee met de groep');
}

/* ---------- account ---------- */

router.post('/auth/register', (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const password = String(req.body.password || '');
  if (!NAME_RE.test(name)) throw fail(400, 'Kies een naam van 1 tot 30 letters of cijfers');
  if (password.length < auth.MIN_PASSWORD) throw fail(400, `Kies een wachtwoord van minstens ${auth.MIN_PASSWORD} tekens`);
  if (db.prepare('SELECT 1 FROM users WHERE name = ?').get(name)) throw fail(409, 'Deze naam is al bezet. Log in, of kies een andere naam.');
  const email = cleanEmail(req.body.email);
  const id = db.prepare('INSERT INTO users (name, pass_hash, email) VALUES (?, ?, ?)').run(name, auth.hashPassword(password), email).lastInsertRowid;
  auth.startSession(req, res, id);
  res.json({ user: { id, name, email: email || '' }, teams: [] });
});

router.post('/auth/login', (req, res) => {
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  const keys = [`n:${name.toLowerCase()}`, `ip:${req.ip}`];
  if (auth.tooManyFails(keys)) throw fail(429, 'Te vaak een verkeerd wachtwoord. Probeer het over een kwartier opnieuw.');
  const user = db.prepare('SELECT * FROM users WHERE name = ?').get(name);
  if (!user || !auth.checkPassword(password, user.pass_hash)) {
    auth.noteFail(keys);
    throw fail(401, 'Naam of wachtwoord klopt niet');
  }
  auth.clearFails(keys);
  auth.startSession(req, res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email || '' }, teams: teamsOf(user.id) });
});

router.post('/auth/logout', (req, res) => {
  auth.endSession(req, res);
  res.json({ ok: true });
});

// Voorbeeld van een uitnodiging (naam en aantal leden), ook zonder lid te zijn.
router.get('/invite/:code', (req, res) => {
  const team = db.prepare('SELECT id, name FROM teams WHERE invite_code = ?').get(String(req.params.code));
  if (!team) throw fail(404, 'Deze uitnodigingslink werkt niet (meer). Vraag een nieuwe.');
  const members = db.prepare('SELECT u.name FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.joined_at').all(team.id).map((m) => m.name);
  const user = auth.userFromRequest(req);
  const member = !!(user && db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(team.id, user.id));
  res.json({ id: team.id, name: team.name, members, member });
});

// Wie ben ik? Zonder sessie gewoon `user: null` (geen foutmelding in de console).
router.get('/auth/me', (req, res) => {
  const user = auth.userFromRequest(req);
  if (user) user.email = (db.prepare('SELECT email FROM users WHERE id = ?').get(user.id) || {}).email || '';
  res.json({ user, teams: user ? teamsOf(user.id) : [], mail: mail.mailEnabled() });
});

/* ---------- wachtwoord vergeten (via e-mail) ---------- */

const RESET_TTL = 60 * 60e3; // een uur
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
// Hooguit 5 aanvragen per uur per IP en 3 per account, zodat niemand iemands inbox kan volspammen.
const forgotLog = new Map();
function forgotAllowed(key, max) {
  const now = Date.now();
  const list = (forgotLog.get(key) || []).filter((t) => now - t < 3600e3);
  if (list.length >= max) return false;
  list.push(now);
  forgotLog.set(key, list);
  return true;
}
// Het adres in de mail komt uit PUBLIC_URL (niet uit de Host-header, die kan iemand vervalsen).
const publicUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

// Express 4 vangt fouten in async-routes niet zelf op; deze helper geeft ze door aan de foutafhandeling.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.post('/auth/forgot', wrap(async (req, res) => {
  const who = String(req.body.who || '').trim();
  const answer = { ok: true, message: 'Als er een e-mailadres bij dit account hoort, is er een mail onderweg met een link om een nieuw wachtwoord te kiezen. Geen mail gekregen? Kijk in je spam, of vraag de beheerder van je groep om een tijdelijk wachtwoord.' };
  if (!mail.mailEnabled()) throw fail(400, 'Herstellen via e-mail staat niet aan. Vraag de beheerder van je groep om een tijdelijk wachtwoord.');
  if (!who) throw fail(400, 'Vul je naam of e-mailadres in');
  if (!forgotAllowed(`ip:${req.ip}`, 5)) throw fail(429, 'Te veel aanvragen. Probeer het over een uur opnieuw.');
  const user = db.prepare('SELECT * FROM users WHERE (name = ? OR email = ? COLLATE NOCASE) AND email IS NOT NULL').get(who, who);
  if (!user || !forgotAllowed(`u:${user.id}`, 3)) return res.json(answer);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), user.id, Date.now() + RESET_TTL);
  const link = `${publicUrl(req)}/reset/${token}`;
  try {
    await mail.sendMail({
      to: user.email,
      subject: 'Nieuw wachtwoord voor de Vakantieplanner',
      text: `Hoi ${user.name},\n\nJe (of iemand anders) vroeg een nieuw wachtwoord aan voor de Vakantieplanner.\nKies een nieuw wachtwoord via deze link (een uur geldig, één keer te gebruiken):\n\n${link}\n\nHeb je dit niet zelf aangevraagd? Dan kun je deze mail negeren; je wachtwoord blijft hetzelfde.`,
      html: `<p>Hoi ${user.name.replace(/[<>&"]/g, '')},</p><p>Je (of iemand anders) vroeg een nieuw wachtwoord aan voor de Vakantieplanner.</p><p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#e0245e;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Nieuw wachtwoord kiezen</a></p><p style="color:#6a6a6a">De link is een uur geldig en werkt één keer. Heb je dit niet zelf aangevraagd? Dan kun je deze mail negeren; je wachtwoord blijft hetzelfde.</p>`,
    });
  } catch (err) {
    console.error(new Date().toISOString(), 'mail versturen mislukt', err.message);
    throw fail(502, 'De mail kon niet worden verstuurd. Probeer het later, of vraag de beheerder om een tijdelijk wachtwoord.');
  }
  res.json(answer);
}));

router.post('/auth/reset', (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  const row = token && db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha(token));
  if (!row || row.used || row.expires_at < Date.now()) throw fail(400, 'Deze link werkt niet (meer). Vraag een nieuwe aan via "Wachtwoord vergeten".');
  if (password.length < auth.MIN_PASSWORD) throw fail(400, `Kies een wachtwoord van minstens ${auth.MIN_PASSWORD} tekens`);
  db.transaction(() => {
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(password), row.user_id);
    // Alle herstellinks van dit account vervallen, en overal uitloggen.
    db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').run(row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
  })();
  auth.startSession(req, res, row.user_id);
  const user = db.prepare("SELECT id, name, COALESCE(email, '') AS email FROM users WHERE id = ?").get(row.user_id);
  res.json({ user, teams: teamsOf(user.id) });
});

router.use(auth.requireUser);

router.put('/auth/password', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!auth.checkPassword(String(req.body.current || ''), user.pass_hash)) throw fail(400, 'Je huidige wachtwoord klopt niet');
  const password = String(req.body.password || '');
  if (password.length < auth.MIN_PASSWORD) throw fail(400, `Kies een wachtwoord van minstens ${auth.MIN_PASSWORD} tekens`);
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(password), user.id);
  res.json({ ok: true });
});

// Account verwijderen (AVG): naam, wachtwoord, sessies, lidmaatschappen en voorkeuren gaan weg.
// Chatberichten blijven staan zonder naam; wat iemand aan de groep heeft toegevoegd blijft van de groep.
router.delete('/auth/account', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!auth.checkPassword(String(req.body.password || ''), user.pass_hash)) throw fail(400, 'Je wachtwoord klopt niet');
  const blocking = db.prepare(`
    SELECT t.name FROM team_members m JOIN teams t ON t.id = m.team_id
    WHERE m.user_id = ? AND m.role = 'admin'
      AND (SELECT COUNT(*) FROM team_members x WHERE x.team_id = m.team_id AND x.role = 'admin') = 1
      AND (SELECT COUNT(*) FROM team_members x WHERE x.team_id = m.team_id) > 1`).all(user.id);
  if (blocking.length) throw fail(400, `Maak eerst iemand anders beheerder van ${blocking.map((b) => b.name).join(', ')}`);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  auth.endSession(req, res);
  res.json({ ok: true });
});

// E-mailadres voor wachtwoord-herstel instellen of weghalen (wachtwoord nodig).
router.put('/auth/email', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!auth.checkPassword(String(req.body.password || ''), user.pass_hash)) throw fail(400, 'Je wachtwoord klopt niet');
  const email = cleanEmail(req.body.email, user.id);
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, user.id);
  res.json({ ok: true, email: email || '' });
});

/* ---------- groepen ---------- */

router.post('/teams', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) throw fail(400, 'Geef de groep een naam');
  const id = db.createTeam(name, req.user.id);
  db.postEvent(id, req.user.id, `heeft de groep ${name} gemaakt`);
  res.json({ id, teams: teamsOf(req.user.id) });
});

router.post('/invite/:code', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE invite_code = ?').get(String(req.params.code));
  if (!team) throw fail(404, 'Deze uitnodigingslink werkt niet (meer). Vraag een nieuwe.');
  joinTeam(team, req.user);
  res.json({ id: team.id, teams: teamsOf(req.user.id) });
});

// Vanaf hier geldt de actieve groep (header X-Team).
const team = express.Router();
team.use(auth.requireTeam);
const adminOnly = (req) => { if (req.team.role !== 'admin') throw fail(403, 'Alleen een beheerder van de groep kan dit'); };

team.put('/team', (req, res) => {
  adminOnly(req);
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) throw fail(400, 'Geef de groep een naam');
  db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, req.team.id);
  db.postEvent(req.team.id, req.user.id, `heeft de groep hernoemd naar ${name}`);
  res.json({ ok: true });
});

// Nieuwe uitnodigingslink; de oude werkt dan niet meer.
team.post('/team/invite', (req, res) => {
  adminOnly(req);
  const code = db.inviteCode();
  db.prepare('UPDATE teams SET invite_code = ? WHERE id = ?').run(code, req.team.id);
  res.json({ invite_code: code });
});

team.put('/team/members/:uid', (req, res) => {
  adminOnly(req);
  const uid = +req.params.uid;
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  if (role === 'member' && uid === req.user.id
    && db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'admin'").get(req.team.id).n < 2) {
    throw fail(400, 'Maak eerst iemand anders beheerder');
  }
  db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(role, req.team.id, uid);
  res.json({ ok: true });
});

// Wachtwoord vergeten: een beheerder maakt een tijdelijk wachtwoord voor een lid.
team.post('/team/members/:uid/reset', (req, res) => {
  adminOnly(req);
  const uid = +req.params.uid;
  if (!db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(req.team.id, uid)) throw fail(404, 'Lid niet gevonden');
  const temp = crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
  db.transaction(() => {
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(temp), uid);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
  })();
  res.json({ password: temp });
});

// Iemand uit de groep halen (beheerder) of zelf de groep verlaten.
team.delete('/team/members/:uid', (req, res) => {
  const uid = +req.params.uid;
  if (uid !== req.user.id) adminOnly(req);
  const admins = db.prepare("SELECT user_id FROM team_members WHERE team_id = ? AND role = 'admin'").all(req.team.id).map((r) => r.user_id);
  const left = db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(req.team.id).n;
  if (admins.length === 1 && admins[0] === uid && left > 1) throw fail(400, 'Maak eerst iemand anders beheerder');
  const name = (db.prepare('SELECT name FROM users WHERE id = ?').get(uid) || {}).name;
  db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(req.team.id, uid);
  if (name) db.postEvent(req.team.id, uid, uid === req.user.id ? 'heeft de groep verlaten' : `is uit de groep gehaald door ${req.user.name}`);
  res.json({ ok: true });
});

/* ---------- voorkeuren ---------- */

const CATS = ['nachtleven', 'strand', 'zon', 'stad', 'goedkoop', 'eten', 'avontuur', 'watersport', 'eiland', 'natuur', 'allin', 'wintersport', 'cultuur', 'casino', 'kort', 'ver'];
const catList = (v) => [...new Set((Array.isArray(v) ? v : []).filter((c) => CATS.includes(c)))];

team.put('/prefs', (req, res) => {
  const likes = catList(req.body.likes);
  const dislikes = catList(req.body.dislikes).filter((c) => !likes.includes(c));
  const note = String(req.body.note || '').trim().slice(0, 200);
  db.prepare('UPDATE team_members SET likes = ?, dislikes = ?, note = ? WHERE team_id = ? AND user_id = ?')
    .run(JSON.stringify(likes), JSON.stringify(dislikes), note, req.team.id, req.user.id);
  res.json({ ok: true });
});

// Duim omhoog (1), omlaag (-1) of weg (0) bij een bestemming uit de ideeën.
team.put('/reactions', (req, res) => {
  const dest = String(req.body.dest || '').trim().slice(0, 80);
  const value = [1, -1].includes(req.body.value) ? req.body.value : 0;
  if (!dest) throw fail(400, 'Geen bestemming');
  if (value) {
    db.prepare(`INSERT INTO dest_reactions (team_id, user_id, dest, value) VALUES (?, ?, ?, ?)
      ON CONFLICT(team_id, user_id, dest) DO UPDATE SET value = excluded.value`).run(req.team.id, req.user.id, dest, value);
  } else {
    db.prepare('DELETE FROM dest_reactions WHERE team_id = ? AND user_id = ? AND dest = ?').run(req.team.id, req.user.id, dest);
  }
  res.json({ ok: true });
});

/* ---------- chat ---------- */

const REF_TYPES = { trip: 'trips', poll: 'polls' };

function refOk(teamId, type, id) {
  if (type === 'item') {
    return !!db.prepare('SELECT 1 FROM items i JOIN sections s ON s.id = i.section_id WHERE i.id = ? AND s.team_id = ?').get(id, teamId);
  }
  return REF_TYPES[type] && !!db.prepare(`SELECT 1 FROM ${REF_TYPES[type]} WHERE id = ? AND team_id = ?`).get(id, teamId);
}

// Opruimen: berichten over een pin, reis of stemronde die verwijderd is, verdwijnen na een minuut.
// Een automatische melding (of een gedeelde pin zonder tekst) gaat helemaal weg; bij een bericht
// met eigen tekst blijft de tekst staan en verdwijnt alleen het kaartje.
const GONE_REF = `ref_type IS NOT NULL AND (
  (ref_type = 'item' AND NOT EXISTS (SELECT 1 FROM items WHERE items.id = messages.ref_id))
  OR (ref_type = 'trip' AND NOT EXISTS (SELECT 1 FROM trips WHERE trips.id = messages.ref_id))
  OR (ref_type = 'poll' AND NOT EXISTS (SELECT 1 FROM polls WHERE polls.id = messages.ref_id)))`;
const markGone = db.prepare(`UPDATE messages SET gone_at = datetime('now') WHERE gone_at IS NULL AND ${GONE_REF}`);
const expired = db.prepare(`SELECT id, team_id, kind, body FROM messages WHERE gone_at <= datetime('now', '-1 minute')`);
const delMsg = db.prepare('DELETE FROM messages WHERE id = ?');
const unrefMsg = db.prepare('UPDATE messages SET ref_type = NULL, ref_id = NULL, gone_at = NULL WHERE id = ?');
// Wat er de laatste tien minuten is opgeruimd, zodat open chats het ook weghalen.
const cleaned = [];
function cleanupMessages() {
  markGone.run();
  const now = Date.now();
  db.transaction(() => {
    for (const m of expired.all()) {
      const drop = m.kind === 'event' || !m.body.trim();
      (drop ? delMsg : unrefMsg).run(m.id);
      cleaned.push({ team: m.team_id, id: m.id, drop, at: now });
    }
  })();
  while (cleaned.length && cleaned[0].at < now - 10 * 60 * 1000) cleaned.shift();
}
cleanupMessages();
setInterval(cleanupMessages, 15 * 1000).unref();

// Nieuwe berichten sinds `after`; zonder `after` de laatste 100.
team.get('/messages', (req, res) => {
  const after = parseInt(req.query.after, 10) || 0;
  const rows = after
    ? db.prepare(`SELECT g.*, u.name FROM messages g LEFT JOIN users u ON u.id = g.user_id
        WHERE g.team_id = ? AND g.id > ? ORDER BY g.id LIMIT 200`).all(req.team.id, after)
    : db.prepare(`SELECT * FROM (SELECT g.*, u.name FROM messages g LEFT JOIN users u ON u.id = g.user_id
        WHERE g.team_id = ? ORDER BY g.id DESC LIMIT 100) ORDER BY id`).all(req.team.id);
  const mine = cleaned.filter((c) => c.team === req.team.id);
  res.json({ messages: rows, removed: mine.filter((c) => c.drop).map((c) => c.id), unref: mine.filter((c) => !c.drop).map((c) => c.id) });
});

team.post('/messages', (req, res) => {
  const body = String(req.body.body || '').trim().slice(0, 2000);
  const refType = ['trip', 'poll', 'item'].includes(req.body.ref_type) ? req.body.ref_type : null;
  const refId = refType ? parseInt(req.body.ref_id, 10) : null;
  if (refType && !refOk(req.team.id, refType, refId)) throw fail(400, 'Dit kun je niet delen in deze groep');
  if (!body && !refType) throw fail(400, 'Typ eerst een bericht');
  const id = db.prepare('INSERT INTO messages (team_id, user_id, kind, body, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.team.id, req.user.id, 'text', body, refType, refId).lastInsertRowid;
  db.prepare('UPDATE team_members SET last_read = MAX(last_read, ?) WHERE team_id = ? AND user_id = ?').run(id, req.team.id, req.user.id);
  res.json({ id });
});

team.delete('/messages/:id', (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!msg) throw fail(404, 'Bericht niet gevonden');
  if (msg.user_id !== req.user.id && req.team.role !== 'admin') throw fail(403, 'Je kunt alleen je eigen berichten verwijderen');
  db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);
  res.json({ ok: true });
});

team.put('/messages/read', (req, res) => {
  const upto = parseInt(req.body.upto, 10) || 0;
  db.prepare('UPDATE team_members SET last_read = MAX(last_read, ?) WHERE team_id = ? AND user_id = ?').run(upto, req.team.id, req.user.id);
  res.json({ ok: true });
});

// Hoeveel ongelezen berichten in elke groep (voor de badges), plus het nieuwste bericht-id van de actieve groep.
router.get('/unread', (req, res) => {
  res.json({ teams: teamsOf(req.user.id).map(({ id, unread }) => ({ id, unread })) });
});

// Een gedeelde stemlink: in welke van jouw groepen zit deze stemronde?
router.get('/polls/slug/:slug', (req, res) => {
  const row = db.prepare(`SELECT p.team_id FROM polls p JOIN team_members m ON m.team_id = p.team_id AND m.user_id = ?
    WHERE p.slug = ?`).get(req.user.id, String(req.params.slug));
  if (!row) throw fail(404, 'Deze stemronde hoort bij een groep waar je (nog) geen lid van bent');
  res.json({ team_id: row.team_id });
});

module.exports = { router, team };
