// Deelbare links met een voorbeeld in WhatsApp (Open Graph): de pagina zelf en een plaatje.
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');

let sharp = null;
try { sharp = require('sharp'); } catch { /* zonder sharp geen gegenereerd plaatje */ }

const router = express.Router();
const INDEX = path.join(__dirname, '..', '..', 'public', 'index.html');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const setting = (key) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) || {}).value || '';
const origin = (req) => `${req.protocol}://${req.get('host')}`;
const fmtDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });

function pollBySlug(slug) {
  return db.getPolls().find((p) => p.slug === slug) || null;
}

// Opties met aantal stemmen, populairste eerst.
function tally(poll) {
  const rows = poll.item_ids.map((id) => {
    const it = db.prepare('SELECT id, title, image FROM items WHERE id = ?').get(id);
    return it && { ...it, votes: poll.votes.filter((v) => v.item_id === id).length };
  }).filter(Boolean);
  return rows.sort((a, b) => b.votes - a.votes || a.id - b.id);
}

const shortName = (t) => String(t || '').split(',')[0].trim();

function pollText(poll) {
  const rows = tally(poll);
  const names = rows.map((r) => shortName(r.title));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} of ${names[names.length - 1]}` : names.join('');
  if (poll.is_closed && rows[0] && rows[0].votes) {
    return {
      title: `🏆 ${shortName(rows[0].title)} wint: ${poll.title}`,
      description: rows.map((r, i) => `${i + 1}. ${shortName(r.title)} (${r.votes})`).join(' · '),
    };
  }
  const n = new Set(poll.votes.map((v) => v.name)).size;
  return {
    title: `🗳️ Stem mee: ${poll.title}`,
    description: `${list}?${poll.closes_at ? ` Stemmen kan t/m ${fmtDate(poll.closes_at)}.` : ''} ${n ? `${n} ${n === 1 ? 'persoon heeft' : 'mensen hebben'} al gestemd.` : 'Wees de eerste die stemt!'}`,
  };
}

function page(req, meta) {
  const html = fs.readFileSync(INDEX, 'utf8');
  const tags = `
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(setting('site_title') || 'Vakantie')}">
  <meta property="og:title" content="${esc(meta.title)}">
  <meta property="og:description" content="${esc(meta.description)}">
  <meta property="og:url" content="${esc(meta.url)}">
  ${meta.image ? `<meta property="og:image" content="${esc(meta.image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="description" content="${esc(meta.description)}">`;
  return html.replace('</head>', `${tags}\n</head>`);
}

// Startpagina met een algemeen voorbeeld.
router.get('/', (req, res) => {
  const title = setting('site_title') || 'Onze vakantie';
  res.type('html').send(page(req, {
    title,
    description: 'Plan samen onze vakantie op de kaart: bestemming, datum, vlucht en hotel.',
    url: origin(req) + '/',
    image: sharp ? `${origin(req)}/og/site.jpg` : '',
  }));
});

router.get('/stem/:slug', (req, res, next) => {
  const poll = pollBySlug(req.params.slug);
  if (!poll) return next();
  const text = pollText(poll);
  // Versie in de plaatje-url, zodat WhatsApp een nieuwe tussenstand niet uit zijn cache haalt.
  const v = `${poll.votes.length}${poll.is_closed ? 'c' : ''}`;
  res.type('html').send(page(req, {
    ...text,
    url: `${origin(req)}/stem/${poll.slug}`,
    image: sharp ? `${origin(req)}/og/stem/${poll.slug}.jpg?v=${v}` : '',
  }));
});

/* ---------- plaatjes voor het voorbeeld (1200 × 630) ---------- */

const C = { paper: '#f3eee4', ink: '#1d1b16', muted: '#6f685c', red: '#b8412c', navy: '#1f3a68', line: '#d9cfbd', good: '#3f6b3a' };

function wrap(text, max) {
  const words = String(text).split(/\s+/);
  const out = [''];
  for (const w of words) {
    const cur = out[out.length - 1];
    if ((cur + ' ' + w).trim().length > max && cur) out.push(w);
    else out[out.length - 1] = (cur + ' ' + w).trim();
  }
  return out.slice(0, 2);
}

function stripe() {
  let s = '';
  for (let x = -40; x < 1240; x += 44) {
    s += `<polygon points="${x},0 ${x + 14},0 ${x + 8},10 ${x - 6},10" fill="${C.red}"/>`;
    s += `<polygon points="${x + 22},0 ${x + 36},0 ${x + 30},10 ${x + 16},10" fill="${C.navy}"/>`;
  }
  return s;
}

function cardSvg({ kicker, title, rows, footer, photoWidth }) {
  const w = 1200 - photoWidth;
  const titleLines = wrap(title, photoWidth ? 22 : 30);
  const total = rows.reduce((n, r) => n + (r.votes || 0), 0);
  const y = 190 + titleLines.length * 70;
  const barMax = w - 140;
  const rowSvg = rows.slice(0, titleLines.length > 1 ? 3 : 4).map((r, i) => {
    const yy = y + i * 74;
    const pct = total ? r.votes / total : 0;
    return `
      <text x="70" y="${yy}" font-family="DejaVu Sans" font-size="30" font-weight="bold" fill="${C.ink}">${esc(r.label)}</text>
      ${r.votes != null ? `<text x="${w - 70}" y="${yy}" text-anchor="end" font-family="DejaVu Sans Mono" font-size="26" fill="${C.muted}">${r.votes} ${r.votes === 1 ? 'stem' : 'stemmen'}</text>
      <rect x="70" y="${yy + 14}" width="${barMax}" height="12" rx="6" fill="${C.line}"/>
      <rect x="70" y="${yy + 14}" width="${Math.max(12, barMax * pct)}" height="12" rx="6" fill="${i === 0 && total ? C.red : C.navy}"/>` : ''}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="${C.paper}"/>
    ${stripe()}
    <text x="70" y="104" font-family="DejaVu Sans Mono" font-size="24" letter-spacing="4" fill="${C.red}">${esc(kicker)}</text>
    ${titleLines.map((l, i) => `<text x="70" y="${172 + i * 70}" font-family="DejaVu Serif" font-size="60" font-weight="bold" fill="${C.ink}">${esc(l)}</text>`).join('')}
    ${rowSvg}
    <text x="70" y="585" font-family="DejaVu Sans" font-size="26" fill="${C.muted}">${esc(footer)}</text>
  </svg>`;
}

async function renderCard(opts, photo) {
  const photoPath = photo && photo.startsWith('/uploads/') ? path.join(db.UPLOAD_DIR, path.basename(photo)) : '';
  const hasPhoto = photoPath && fs.existsSync(photoPath);
  const photoWidth = hasPhoto ? 420 : 0;
  const layers = [];
  if (hasPhoto) {
    layers.push({ input: await sharp(photoPath).resize(photoWidth, 630, { fit: 'cover' }).toBuffer(), left: 1200 - photoWidth, top: 0 });
  }
  const svg = Buffer.from(cardSvg({ ...opts, photoWidth }));
  return sharp({ create: { width: 1200, height: 630, channels: 3, background: C.paper } })
    .composite([{ input: svg, left: 0, top: 0 }, ...layers])
    .jpeg({ quality: 82 })
    .toBuffer();
}

router.get('/og/stem/:slug.jpg', async (req, res, next) => {
  if (!sharp) return next();
  const poll = pollBySlug(req.params.slug);
  if (!poll) return next();
  try {
    const rows = tally(poll);
    const winner = poll.is_closed && rows[0] && rows[0].votes ? rows[0] : null;
    const voters = new Set(poll.votes.map((v) => v.name)).size;
    const img = await renderCard({
      kicker: winner ? 'UITSLAG STEMRONDE' : 'STEM MEE',
      title: winner ? `${shortName(winner.title)} wint!` : poll.title,
      rows: rows.map((r) => ({ label: shortName(r.title), votes: voters ? r.votes : null })),
      footer: winner ? `${voters} mensen stemden` : poll.closes_at ? `Stemmen kan tot en met ${fmtDate(poll.closes_at)}` : 'Tik om te stemmen',
    }, (winner || rows.find((r) => r.image) || {}).image);
    res.type('jpeg').set('Cache-Control', 'public, max-age=300').send(img);
  } catch (err) { next(err); }
});

router.get('/og/site.jpg', async (req, res, next) => {
  if (!sharp) return next();
  try {
    const locs = db.prepare("SELECT i.title, i.image FROM items i JOIN sections s ON s.id = i.section_id WHERE s.kind = 'map' ORDER BY i.is_best DESC, i.likes DESC, i.id").all();
    const img = await renderCard({
      kicker: 'VAKANTIE PLANNEN',
      title: setting('site_title') || 'Onze vakantie',
      rows: locs.slice(0, 4).map((l) => ({ label: shortName(l.title), votes: null })),
      footer: 'Kies samen bestemming, datum, vlucht en hotel',
    }, setting('hero_image') || (locs.find((l) => l.image) || {}).image);
    res.type('jpeg').set('Cache-Control', 'public, max-age=600').send(img);
  } catch (err) { next(err); }
});

module.exports = router;
