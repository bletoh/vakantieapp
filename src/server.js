const express = require('express');
const path = require('path');

const db = require('./db');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json({ limit: '15mb' }));

app.use('/api', apiRouter);
app.use('/vendor/leaflet', express.static(path.dirname(require.resolve('leaflet')), { maxAge: '7d' }));
app.use('/uploads', express.static(db.UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Er ging iets mis' });
});

app.listen(PORT, () => {
  console.log(`Vakantieapp draait op poort ${PORT}`);
});
