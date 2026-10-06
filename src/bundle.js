// De app staat in losse bestanden (public/js/app/*.js, in volgorde van naam). Die vormen samen
// één functie: de server plakt ze aan elkaar en levert ze als /js/app.js. Zo blijft het voor de
// browser één bestand en is er geen build-stap nodig.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'public', 'js', 'app');

function buildApp() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();
  const body = files.map((f) => `  // ===== ${f} =====\n${fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\n+$/, '')}`).join('\n\n');
  const code = `(() => {\n  'use strict';\n\n${body}\n})();\n`;
  return { code, etag: `"${crypto.createHash('sha1').update(code).digest('base64url').slice(0, 16)}"`, files };
}

// In productie één keer bij het starten; anders bij elk verzoek opnieuw (handig tijdens het ontwikkelen).
function appRoute() {
  let cached = process.env.NODE_ENV === 'production' ? buildApp() : null;
  return (req, res) => {
    const b = cached || buildApp();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', b.etag);
    if (req.headers['if-none-match'] === b.etag) return res.status(304).end();
    res.send(b.code);
  };
}

module.exports = { buildApp, appRoute };
