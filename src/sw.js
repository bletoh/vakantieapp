// Serveert de service worker op /sw.js. De versie volgt de app (script, stijl, startpagina en de worker zelf),
// zodat telefoons na een deploy vanzelf de nieuwe versie ophalen en de oude cache weggooien.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildApp } = require('./bundle');

const PUBLIC = path.join(__dirname, '..', 'public');
const SOURCE = path.join(__dirname, 'service-worker.js');

function build() {
  const h = crypto.createHash('sha256');
  h.update(buildApp().etag);
  for (const f of [path.join(PUBLIC, 'css', 'style.css'), path.join(PUBLIC, 'index.html'), SOURCE]) h.update(fs.readFileSync(f));
  const version = h.digest('hex').slice(0, 12);
  return { version, code: fs.readFileSync(SOURCE, 'utf8').replace('__VERSION__', version) };
}

function serviceWorker() {
  const cached = process.env.NODE_ENV === 'production' ? build() : null;
  return (req, res) => {
    const b = cached || build();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    res.send(b.code);
  };
}

module.exports = { serviceWorker, build };
