const express = require('express');
const path = require('path');
const fs = require('fs');
const compression = require('compression');

const db = require('./db');
const apiRouter = require('./routes/api');
const social = require('./routes/social');
const auth = require('./auth');
const shareRouter = require('./routes/share');

const app = express();
// Achter Caddy (één stap, op het eigen Docker-netwerk): alleen dát adres mag het echte IP doorgeven.
// Met `true` kon iemand zelf een X-Forwarded-For meesturen en zo de rem op inlogpogingen omzeilen.
app.set('trust proxy', 'loopback, uniquelocal');
app.disable('x-powered-by');
const PORT = process.env.PORT || 4000;

// Beveiligingsheaders: niet in een frame laden, geen MIME-gokken, nette referrer en https afdwingen.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(compression());

// Voor Docker en de controle-scripts: draait de app en werkt de database?
// Met ?backup=1 ook: is er de afgelopen 30 uur een back-up gemaakt? (voor de controle vanaf de NAS)
app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
  if (req.query.backup === undefined) return res.json({ ok: true });
  let hours = null;
  try { hours = (Date.now() / 1000 - parseInt(fs.readFileSync(path.join(db.DATA_DIR, '.last-backup'), 'utf8'), 10)) / 3600; } catch { /* nog nooit */ }
  const fresh = hours != null && hours < 30;
  res.status(fresh ? 200 : 503).json({ ok: fresh, backup: fresh ? 'recent' : 'te oud of ontbreekt', hours: hours == null ? null : Math.round(hours) });
});

app.use(express.json({ limit: '15mb' }));

// Inloggen en groepen kiezen; daarna alles binnen de actieve groep (header X-Team).
app.use('/api', social.router);
app.use('/api', auth.requireUser, social.team);
app.use('/api', auth.requireUser, auth.requireTeam, apiRouter);
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html')));
app.use(shareRouter);
// Lettertype zelf aanbieden in plaats van via Google Fonts (dan gaat er geen IP-adres naar Google).
app.use('/vendor/inter', express.static(path.dirname(require.resolve('@fontsource-variable/inter/package.json')), { maxAge: '30d' }));
app.use('/vendor/leaflet', express.static(path.dirname(require.resolve('leaflet')), { maxAge: '7d' }));
app.use('/uploads', express.static(db.UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error(new Date().toISOString(), req.method, req.originalUrl, err);
  // Interne fouten niet letterlijk aan de bezoeker laten zien.
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  res.status(status).json({ error: status >= 500 ? 'Er ging iets mis op de server. Probeer het zo nog eens.' : err.message, code: err.code });
});

process.on('unhandledRejection', (err) => console.error(new Date().toISOString(), 'unhandledRejection', err));

const server = app.listen(PORT, () => {
  console.log(`Vakantieapp draait op poort ${PORT}`);
});

// Netjes stoppen bij `docker stop` / een update: lopende verzoeken afmaken en de database sluiten.
function shutdown(signal) {
  console.log(`${signal}: afsluiten`);
  server.close(() => {
    try { db.close(); } catch { /* al dicht */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
