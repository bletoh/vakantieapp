const express = require('express');
const path = require('path');

const db = require('./db');
const apiRouter = require('./routes/api');
const social = require('./routes/social');
const auth = require('./auth');
const shareRouter = require('./routes/share');

const app = express();
// Achter Caddy: https en de echte hostnaam doorgeven voor de deellinks.
app.set('trust proxy', true);
const PORT = process.env.PORT || 4000;

app.use(express.json({ limit: '15mb' }));

// Inloggen en groepen kiezen; daarna alles binnen de actieve groep (header X-Team).
app.use('/api', social.router);
app.use('/api', auth.requireUser, social.team);
app.use('/api', auth.requireUser, auth.requireTeam, apiRouter);
app.use(shareRouter);
app.use('/vendor/leaflet', express.static(path.dirname(require.resolve('leaflet')), { maxAge: '7d' }));
app.use('/uploads', express.static(db.UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Er ging iets mis', code: err.code });
});

app.listen(PORT, () => {
  console.log(`Vakantieapp draait op poort ${PORT}`);
});
