// Accounts met naam en wachtwoord, sessie in een cookie, en lidmaatschap van groepen.
const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'vp_sid';
const YEAR = 365 * 24 * 3600;
// Voor nieuwe wachtwoorden; bestaande (vanaf 6 tekens) blijven gewoon werken.
const MIN_PASSWORD = 8;

// Verlopen sessies (cookie is een jaar geldig) uit de database halen, bij de start en daarna dagelijks.
const purgeSessions = () => db.prepare("DELETE FROM sessions WHERE created_at < datetime('now', '-365 days')").run();
purgeSessions();
setInterval(purgeSessions, 24 * 3600e3).unref();

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function checkPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), want.length);
  return crypto.timingSafeEqual(want, got);
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
}

function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
}

function userFromRequest(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  return db.prepare('SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token) || null;
}

// Ingelogd zijn is nodig voor alles onder /api, behalve inloggen en registreren.
function requireUser(req, res, next) {
  req.user = userFromRequest(req);
  if (!req.user) return res.status(401).json({ error: 'Log eerst in' });
  next();
}

// De actieve groep komt mee in de header X-Team; je moet er lid van zijn.
function requireTeam(req, res, next) {
  const teamId = parseInt(req.get('X-Team'), 10);
  const m = teamId && db.prepare(`
    SELECT t.id, t.name, t.invite_code, m.role FROM team_members m JOIN teams t ON t.id = m.team_id
    WHERE m.team_id = ? AND m.user_id = ?`).get(teamId, req.user.id);
  if (!m) return res.status(403).json({ error: 'Je bent geen lid van deze groep', code: 'no-team' });
  req.team = m;
  next();
}

// Eenvoudige rem op wachtwoorden raden: hooguit 10 mislukte pogingen per kwartier per naam en per IP.
const fails = new Map();
function tooManyFails(keys) {
  const now = Date.now();
  return keys.some((k) => {
    const f = fails.get(k);
    return f && now - f.since < 15 * 60e3 && f.n >= 10;
  });
}
function noteFail(keys) {
  const now = Date.now();
  for (const k of keys) {
    const f = fails.get(k);
    if (!f || now - f.since > 15 * 60e3) fails.set(k, { since: now, n: 1 });
    else f.n += 1;
  }
}
function clearFails(keys) { for (const k of keys) fails.delete(k); }

module.exports = {
  MIN_PASSWORD, hashPassword, checkPassword, startSession, endSession, userFromRequest, requireUser, requireTeam, tooManyFails, noteFail, clearFails,
};
