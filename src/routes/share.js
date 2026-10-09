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

// Instellingen en naam horen bij de groep van de reis of stemronde.
const teamName = (teamId) => (db.prepare('SELECT name FROM teams WHERE id = ?').get(teamId) || {}).name || '';
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
  <meta property="og:site_name" content="${esc(meta.site || 'Vakantieplanner')}">
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
  res.type('html').send(page(req, {
    title: 'Vakantieplanner',
    description: 'Plan samen jullie vakantie: bestemming, datum, vlucht en hotel, met chat en stemrondes in je eigen groep.',
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
    site: teamName(poll.team_id),
    url: `${origin(req)}/stem/${poll.slug}`,
    image: sharp ? `${origin(req)}/og/stem/${poll.slug}.jpg?v=${v}` : '',
  }));
});

// Uitnodigingslink voor een groep: de app opent en vraagt om in te loggen of een account te maken.
router.get('/join/:code', (req, res) => {
  const team = db.prepare('SELECT id, name FROM teams WHERE invite_code = ?').get(String(req.params.code));
  // Verlopen link: toch de app openen, die meldt dat de link niet (meer) werkt.
  if (!team) return res.status(404).type('html').send(page(req, { title: 'Vakantieplanner', description: 'Deze uitnodigingslink werkt niet (meer).', url: `${origin(req)}/` }));
  const n = db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(team.id).n;
  res.set('Cache-Control', 'no-cache').type('html').send(page(req, {
    title: `Doe mee met ${team.name}`,
    description: `Je bent uitgenodigd voor de groep ${team.name}${n ? ` (${n} ${n === 1 ? 'lid' : 'leden'})` : ''}. Plan samen de vakantie: kaart, chat en stemrondes.`,
    site: 'Vakantieplanner',
    url: `${origin(req)}/join/${req.params.code}`,
    image: sharp ? `${origin(req)}/og/site.jpg` : '',
  }));
});

/* ---------- plaatjes voor het voorbeeld (1200 × 630) ---------- */

// Zelfde kleuren als de app: wit, grijstinten en één accentkleur.
const C = { paper: '#ffffff', ink: '#222222', muted: '#6a6a6a', red: '#e0245e', navy: '#222222', line: '#ebebeb', good: '#008a05' };

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

// Accentbalk bovenaan.
function stripe() {
  return `<rect width="1200" height="10" fill="${C.red}"/>`;
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
      ${r.votes != null ? `<text x="${w - 70}" y="${yy}" text-anchor="end" font-family="DejaVu Sans" font-size="26" fill="${C.muted}">${r.votes} ${r.votes === 1 ? 'stem' : 'stemmen'}</text>
      <rect x="70" y="${yy + 14}" width="${barMax}" height="12" rx="6" fill="${C.line}"/>
      <rect x="70" y="${yy + 14}" width="${Math.max(12, barMax * pct)}" height="12" rx="6" fill="${i === 0 && total ? C.red : C.navy}"/>` : ''}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="${C.paper}"/>
    ${stripe()}
    <text x="70" y="104" font-family="DejaVu Sans" font-size="26" font-weight="bold" fill="${C.red}">${esc(kicker)}</text>
    ${titleLines.map((l, i) => `<text x="70" y="${172 + i * 70}" font-family="DejaVu Sans" font-size="58" font-weight="bold" fill="${C.ink}">${esc(l)}</text>`).join('')}
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
      kicker: winner ? 'Uitslag stemronde' : 'Stem mee',
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
    // Algemeen plaatje: groepen zijn privé, dus hier niets uit een groep.
    const img = await renderCard({
      kicker: 'Vakantie plannen',
      title: 'Vakantieplanner',
      rows: ['Eigen groep met chat', 'Pinnen op de kaart', 'Stemrondes en datumprikker'].map((label) => ({ label, votes: null })),
      footer: 'Kies samen bestemming, datum, vlucht en hotel',
    });
    res.type('jpeg').set('Cache-Control', 'public, max-age=600').send(img);
  } catch (err) { next(err); }
});

/* ---------- gedeelde reis: alleen-lezen overzicht (/reis/<code>) ---------- */

const KIND_LABEL = { flight: 'Vlucht', stay: 'Overnachting', car: 'Huurauto', do: 'Activiteiten', eat: 'Eten & drinken' };
const KIND_ICON = { map: 'pin', flight: 'plane', stay: 'bed', car: 'car', do: 'sparkles', eat: 'utensils' };
const DOT = { stay: '#e0245e', do: '#008a05', eat: '#d97706' };
const HOME = [52.3105, 4.7683]; // Schiphol

const ICONS = {
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  bed: '<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>',
  car: '<path d="M5 17h14M3 17v-4l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v4a1 1 0 0 1-1 1h-1M5 18H4a1 1 0 0 1-1-1M3 13h18"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>',
  sparkles: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.list}</svg>`;

const isoDay = (d) => d.toISOString().slice(0, 10);
function rangeDays(a, b) {
  const out = [];
  for (let d = new Date(a + 'T00:00:00Z'); isoDay(d) <= b; d.setUTCDate(d.getUTCDate() + 1)) out.push(isoDay(d));
  return out;
}
const fmtDay = (iso, opts) => new Date(iso + 'T12:00:00Z').toLocaleDateString('nl-NL', { timeZone: 'UTC', ...opts });
function dateText(t) {
  if (!t.start_date) return '';
  const y = t.start_date.slice(0, 4) !== t.end_date.slice(0, 4);
  const a = fmtDay(t.start_date, { weekday: 'short', day: 'numeric', month: 'short', ...(y ? { year: 'numeric' } : {}) });
  const b = fmtDay(t.end_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const n = rangeDays(t.start_date, t.end_date).length;
  return t.start_date === t.end_date ? `${b}` : `${a} – ${b} · ${n} dagen`;
}
const shortDates = (t) => (t.start_date ? `${fmtDay(t.start_date, { day: 'numeric', month: 'short' })} – ${fmtDay(t.end_date, { day: 'numeric', month: 'short' })}` : '');
const clip = (str, n) => (String(str).length > n ? `${String(str).slice(0, n - 1).trim()}…` : String(str));

function tripBySlug(slug) {
  return db.prepare('SELECT * FROM trips WHERE share_slug = ?').get(String(slug)) || null;
}

// Alles wat op het overzicht komt: bestemming, gekozen dingen per soort en wie er kan.
function tripView(trip) {
  const picks = db.prepare(`
    SELECT i.*, s.kind, s.title AS section_title, s.icon AS section_icon, s.show_price
    FROM trip_picks p JOIN items i ON i.id = p.item_id JOIN sections s ON s.id = i.section_id
    WHERE p.trip_id = ? ORDER BY s.position, s.id, i.position, i.id`).all(trip.id);
  const loc = picks.find((x) => x.kind === 'map') || null;
  const groups = [];
  for (const x of picks) {
    if (x === loc) continue;
    let g = groups.find((y) => y.sectionId === x.section_id);
    if (!g) groups.push(g = { sectionId: x.section_id, kind: x.kind, title: KIND_LABEL[x.kind] || x.section_title, icon: x.section_icon, items: [] });
    g.items.push(x);
  }
  // Vlucht en overnachting eerst, daarna de rest in de volgorde van de tabs.
  const order = { flight: 0, stay: 1, car: 2, do: 3, eat: 4 };
  groups.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));

  // Wie er kan, alleen als de reis (deels) in de periode van de datumprikker valt.
  const pollStart = db.teamSetting(trip.team_id, 'poll_start') || isoDay(new Date());
  const pollEnd = db.teamSetting(trip.team_id, 'poll_end') || (() => {
    const d = new Date(pollStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 83); // standaard 12 weken, net als in de app
    return isoDay(d);
  })();
  let who = null;
  if (trip.start_date && !(trip.end_date < pollStart || trip.start_date > pollEnd)) {
    const days = rangeDays(trip.start_date, trip.end_date);
    const byName = new Map();
    for (const { name, date } of db.prepare('SELECT name, date FROM available_days WHERE team_id = ?').all(trip.team_id)) {
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(date);
    }
    if (byName.size) {
      const can = [];
      const cannot = [];
      for (const [name, set] of byName) {
        const ok = days.filter((d) => set.has(d)).length;
        (ok === days.length ? can : cannot).push({ name, ok, total: days.length });
      }
      who = { can, cannot };
    }
  }
  return { trip, loc, groups, who };
}

function flightUrl(item, trip) {
  const m = /→\s*([A-Z]{3})/.exec(item.subtitle || item.title || '');
  if (!m) return item.link || '';
  const when = trip.start_date ? ` on ${trip.start_date} returning ${trip.end_date}` : '';
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from AMS to ${m[1]}${when}`)}`;
}
function bookingUrl(item, loc, trip) {
  const q = `${item.title} ${loc ? shortName(loc.title) : ''}`.trim();
  const dates = trip.start_date ? `&checkin=${trip.start_date}&checkout=${trip.end_date > trip.start_date ? trip.end_date : trip.start_date}` : '';
  return `https://www.booking.com/searchresults.nl.html?ss=${encodeURIComponent(q)}${dates}`;
}
// "Bekijk op Airbnb" in plaats van een vaag "Website".
function linkSite(u) {
  let h;
  try { h = new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
  if (/(^|\.)airbnb\./.test(h) || h === 'abnb.me') return 'Airbnb';
  if (/(^|\.)booking\.com$/.test(h)) return 'Booking';
  if (/(^|\.)vrbo\.com$/.test(h)) return 'Vrbo';
  if (/(^|\.)hostelworld\.com$/.test(h)) return 'Hostelworld';
  if (/(^|\.)expedia\./.test(h)) return 'Expedia';
  if (/(^|\.)rentalcars\.com$/.test(h)) return 'Rentalcars';
  if (/(^|\.)sunnycars\./.test(h)) return 'Sunny Cars';
  if (/(^|\.)discovercars\.com$/.test(h)) return 'DiscoverCars';
  if (/(^|\.)kayak\./.test(h)) return 'Kayak';
  return '';
}
const safeLink = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const safeImg = (u) => (u && (u.startsWith('/uploads/') || /^https?:\/\//i.test(u)) ? u : '');

function tripMeta(v) {
  const { trip, loc, groups } = v;
  const flight = groups.find((g) => g.kind === 'flight');
  const stay = groups.find((g) => g.kind === 'stay');
  const extra = groups.filter((g) => g.kind === 'do' || g.kind === 'eat').reduce((n, g) => n + g.items.length, 0);
  const bits = [
    trip.start_date && shortDates(trip),
    flight && `vlucht ${(flight.items[0].subtitle || flight.items[0].title).split('·')[0].trim()}`,
    stay && `hotel ${stay.items[0].title}`,
    groups.find((g) => g.kind === 'car') && `huurauto ${groups.find((g) => g.kind === 'car').items[0].title}`,
    extra && `${extra} ${extra === 1 ? 'plek' : 'plekken'} om te bezoeken`,
  ].filter(Boolean);
  return {
    title: `✈️ ${trip.title}${loc && !trip.title.includes(shortName(loc.title)) ? ` · ${shortName(loc.title)}` : ''}`,
    description: bits.length ? `${bits.join(' · ')}. Tik voor het hele reisplan.` : 'Tik voor het hele reisplan.',
  };
}

function itemCard(x, v) {
  const { trip, loc } = v;
  const links = [];
  if (x.kind === 'flight') {
    const u = flightUrl(x, trip);
    if (u) links.push(`<a href="${esc(u)}" target="_blank" rel="noopener">Vluchten zoeken ↗</a>`);
  } else if (x.kind === 'stay') {
    // Eigen link (Airbnb, Booking, hotelsite) als grote knop; anders zoeken op Booking.
    if (!safeLink(x.link)) links.push(`<a href="${esc(bookingUrl(x, loc, trip))}" target="_blank" rel="noopener">Prijs op Booking ↗</a>`);
  } else if (x.kind === 'car') {
    // De knop "Bekijk de huurauto" staat hieronder al.
  } else if (safeLink(x.link)) {
    links.push(`<a href="${esc(x.link)}" target="_blank" rel="noopener">Meer info ↗</a>`);
  }
  const own = (x.kind === 'stay' || x.kind === 'car') && safeLink(x.link);
  const open = (inner, attrs = '') => (own ? `<a href="${esc(own)}" target="_blank" rel="noopener"${attrs}>${inner}</a>` : inner);
  const img = safeImg(x.image);
  const stars = x.rating ? `<span class="stars" aria-label="${x.rating} sterren">${'★'.repeat(x.rating)}</span>` : '';
  return `<article class="item">
    ${img ? open(`<img class="item-img" src="${esc(img)}" alt="" loading="lazy">`, ' class="item-img-link" tabindex="-1" aria-hidden="true"') : ''}
    <div class="item-body">
      <h3>${open(esc(x.title))}</h3>
      ${x.subtitle || stars ? `<p class="sub">${stars}${stars && x.subtitle ? ' · ' : ''}${esc(x.subtitle || '')}</p>` : ''}
      ${x.show_price && x.price ? `<span class="price">${esc(x.price)}</span>` : ''}
      ${x.body && x.kind !== 'flight' ? `<p class="body">${esc(x.body)}</p>` : ''}
      ${x.kind === 'car' && (x.min_age || x.young_fee) ? `<p class="sub">${[x.min_age ? `Vanaf ${x.min_age} jaar` : '', x.young_fee ? `toeslag jonge bestuurder € ${Math.round(x.young_fee).toLocaleString('nl-NL')}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
      ${own ? `<a class="go-btn" href="${esc(own)}" target="_blank" rel="noopener">${linkSite(own) ? `Bekijk op ${linkSite(own)}` : x.kind === 'car' ? 'Bekijk de huurauto' : 'Bekijk het verblijf'} ↗</a>` : ''}
      ${links.length ? `<p class="links">${links.join('')}</p>` : ''}
    </div>
  </article>`;
}

// Opmaak van de deelpagina's (losse reis en overzicht van meerdere reizen).
const PAGE_CSS = `
    :root { --bg: #fff; --surface: #fff; --surface-2: #f4f4f4; --ink: #222; --muted: #6a6a6a; --line: #e2e2e2;
      --brand: #e0245e; --good: #008a05; --bad: #c13515; color-scheme: light; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #121212; --surface: #1c1c1c; --surface-2: #262626; --ink: #f2f2f2; --muted: #a3a3a3; --line: #333;
        --brand: #ff5c8a; --good: #4cc26a; --bad: #ff7a66; color-scheme: dark; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
    a { color: inherit; }
    .ic { width: 1.2em; height: 1.2em; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .map { height: min(42vh, 360px); background: var(--surface-2); }
    .map .leaflet-tile-pane { filter: saturate(.85); }
    @media (prefers-color-scheme: dark) { .map .leaflet-tile-pane { filter: brightness(.72) saturate(.55); } }
    .hero-img { width: 100%; height: min(36vh, 300px); object-fit: cover; display: block; }
    main { max-width: 680px; margin: -22px auto 0; position: relative; z-index: 500; padding: 22px 16px 48px;
      background: var(--bg); border-radius: 22px 22px 0 0; }
    .kicker { margin: 0; color: var(--brand); font-weight: 600; font-size: .875rem; }
    h1 { margin: 4px 0 6px; font-size: clamp(1.75rem, 7vw, 2.25rem); line-height: 1.15; letter-spacing: -.025em; }
    .facts { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 10px 0 0; padding: 0; list-style: none; color: var(--ink); font-weight: 500; }
    .facts li { display: flex; align-items: center; gap: 8px; }
    .facts .muted { color: var(--muted); font-weight: 400; }
    .who { display: flex; gap: 12px; align-items: flex-start; margin: 20px 0 0; padding: 14px 16px; border-radius: 14px; }
    .who.all { background: color-mix(in srgb, var(--good) 10%, var(--surface)); }
    .who.all .ic { color: var(--good); }
    .who.some { background: color-mix(in srgb, var(--bad) 9%, var(--surface)); }
    .who.some .ic { color: var(--bad); }
    .who .ic { margin-top: 2px; }
    .who div { display: grid; gap: 2px; }
    .who small { font-weight: 400; color: var(--muted); }
    .who span { color: var(--muted); font-size: .9375rem; }
    .note { margin: 20px 0 0; padding: 14px 16px; border-radius: 14px; background: var(--surface-2); white-space: pre-line; }
    .note small { display: block; color: var(--muted); margin-top: 6px; }
    h2 { display: flex; align-items: center; gap: 10px; margin: 30px 0 12px; font-size: 1.25rem; letter-spacing: -.015em; }
    h2 .ic { width: 22px; height: 22px; }
    h2 .count { font-size: .8125rem; font-weight: 600; color: var(--muted); background: var(--surface-2); border-radius: 999px; padding: 1px 9px; }
    .items { display: grid; gap: 12px; }
    .item { display: flex; border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--surface); }
    .item-img { width: 104px; object-fit: cover; flex: none; }
    .item-body { padding: 14px 16px; display: grid; gap: 4px; min-width: 0; }
    .item h3 { margin: 0; font-size: 1.0625rem; line-height: 1.3; overflow-wrap: anywhere; }
    .sub { margin: 0; color: var(--muted); font-size: .875rem; }
    .stars { color: var(--ink); letter-spacing: 1px; }
    .price { justify-self: start; margin-top: 2px; padding: 2px 9px; border-radius: 6px; background: var(--surface-2); font-weight: 600; font-size: .875rem; }
    .body { margin: 2px 0 0; color: var(--muted); font-size: .875rem; white-space: pre-line; }
    .links { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 6px 0 0; font-size: .875rem; font-weight: 600; }
    .links a { text-decoration: underline; text-underline-offset: 3px; }
    .item-img-link { display: flex; flex: none; }
    .item h3 a { color: inherit; text-decoration: none; }
    .go-btn { justify-self: start; display: inline-flex; align-items: center; margin-top: 8px; min-height: 44px; padding: 10px 18px;
      border-radius: 10px; background: #e0245e; color: #fff; font-weight: 600; text-decoration: none; }
    .go-btn:hover { filter: brightness(.92); }
    .empty { color: var(--muted); }
    footer { max-width: 680px; margin: 0 auto; padding: 0 16px 40px; color: var(--muted); font-size: .8125rem; display: flex; align-items: center; gap: 8px; }
    .lock { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--surface-2); }
    .pin { width: 30px; height: 40px; position: relative; filter: drop-shadow(0 2px 2px rgba(0,0,0,.3)); }
    .pin::before { content: ''; position: absolute; left: 2px; top: 2px; width: 24px; height: 24px; background: #e0245e; border: 2px solid #fff; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); }
    .pin-icon { background: none; border: none; }
    .leaflet-container { font-family: inherit; }
    .leaflet-tooltip.lbl { border: none; border-radius: 999px; padding: 3px 10px; box-shadow: 0 2px 8px rgba(0,0,0,.2); font-weight: 600; font-size: .75rem; }
    .leaflet-tooltip.lbl::before { display: none; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 14px 0 0; color: var(--muted); font-size: .8125rem; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .legend i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; border: 2px solid #fff; box-shadow: 0 0 0 1px var(--line); }
`;

function tripPageHtml(req, v) {
  const { trip, loc, groups, who } = v;
  const site = teamName(trip.team_id) || 'Vakantieplanner';
  const meta = tripMeta(v);
  const url = `${origin(req)}/reis/${trip.share_slug}`;
  const ver = `${groups.reduce((n, g) => n + g.items.length, 0)}${trip.start_date || ''}${trip.likes}`;
  const image = sharp ? `${origin(req)}/og/reis/${trip.share_slug}.jpg?v=${encodeURIComponent(ver)}` : '';
  const heroImg = loc && safeImg(loc.image);
  const points = [];
  if (loc && loc.lat != null) points.push({ lat: loc.lat, lng: loc.lng, kind: 'map', title: loc.title });
  for (const g of groups) for (const x of g.items) if (x.lat != null && x.lng != null) points.push({ lat: x.lat, lng: x.lng, kind: g.kind, title: x.title });
  const mapData = JSON.stringify({ points, home: HOME, dot: DOT, flight: groups.some((g) => g.kind === 'flight') }).replace(/</g, '\\u003c');

  const whoHtml = who ? `
    <section class="who ${who.cannot.length ? 'some' : 'all'}">
      ${icon('users')}
      <div>
        ${who.cannot.length
          ? `<strong>Kan niet: ${who.cannot.map((c) => `${esc(c.name)} <small>(${c.ok} van ${c.total} dagen)</small>`).join(', ')}</strong>
             ${who.can.length ? `<span>Kan wel: ${who.can.map((c) => esc(c.name)).join(', ')}</span>` : ''}`
          : `<strong>Iedereen kan</strong><span>${who.can.map((c) => esc(c.name)).join(', ')}</span>`}
      </div>
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#121212" media="(prefers-color-scheme: dark)">
  <title>${esc(trip.title)} · ${esc(site)}</title>
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${esc(site)}">
  <meta property="og:title" content="${esc(meta.title)}">
  <meta property="og:description" content="${esc(meta.description)}">
  <meta property="og:url" content="${esc(url)}">
  ${image ? `<meta property="og:image" content="${esc(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="description" content="${esc(meta.description)}">
  <link rel="stylesheet" href="/vendor/inter/index.css">
  <link rel="stylesheet" href="/vendor/leaflet/leaflet.css">
  <style>${PAGE_CSS}</style>
</head>
<body>
  ${points.length ? '<div id="map" class="map" role="img" aria-label="Kaart van de reis"></div>' : heroImg ? `<img class="hero-img" src="${esc(heroImg)}" alt="">` : ''}
  <main>
    <p class="kicker">Reisplan${trip.added_by ? ` van ${esc(trip.added_by)}` : ''}</p>
    <h1>${esc(trip.title)}</h1>
    <ul class="facts">
      ${loc ? `<li>${icon('pin')}${esc(loc.title)}</li>` : ''}
      ${trip.start_date ? `<li>${icon('calendar')}${esc(dateText(trip))}</li>` : '<li class="muted">Datum nog niet gekozen</li>'}
      ${trip.likes ? `<li class="muted">${icon('heart')}${trip.likes} ${trip.likes === 1 ? 'hartje' : 'hartjes'}</li>` : ''}
    </ul>
    ${points.length > 1 ? `<div class="legend">${groups.filter((g) => DOT[g.kind] && g.items.some((x) => x.lat != null)).map((g) => `<span><i style="background:${DOT[g.kind]}"></i>${esc(g.title)}</span>`).join('')}</div>` : ''}
    ${whoHtml}
    ${trip.note ? `<p class="note">${esc(trip.note)}${trip.added_by ? `<small>— ${esc(trip.added_by)}</small>` : ''}</p>` : ''}
    ${groups.length ? groups.map((g) => `
      <h2>${KIND_ICON[g.kind] ? icon(KIND_ICON[g.kind]) : `<span aria-hidden="true">${esc(g.icon || '')}</span>`}${esc(g.title)}${g.items.length > 1 ? ` <span class="count">${g.items.length}</span>` : ''}</h2>
      <div class="items">${g.items.map((x) => itemCard(x, v)).join('')}</div>`).join('')
      : '<p class="empty">Er zijn nog geen vlucht, hotel of activiteiten gekozen.</p>'}
  </main>
  <footer><span class="lock">Alleen bekijken</span> Gedeeld via ${esc(site)}</footer>
  ${points.length ? `<script src="/vendor/leaflet/leaflet.js"></script>
  <script>
  (function () {
    var d = ${mapData};
    if (!window.L) return;
    var map = L.map('map', { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    var dest = d.points.filter(function (p) { return p.kind === 'map'; })[0];
    if (dest && d.flight) {
      L.polyline([d.home, [dest.lat, dest.lng]], { color: '#e0245e', weight: 2, dashArray: '2 7', lineCap: 'round', opacity: .8 }).addTo(map);
      L.circleMarker(d.home, { radius: 5, color: '#fff', weight: 2, fillColor: '#f97316', fillOpacity: 1 }).addTo(map);
    }
    d.points.forEach(function (p) {
      if (p.kind === 'map') {
        L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'pin-icon', html: '<div class="pin"></div>', iconSize: [30, 40], iconAnchor: [15, 40] }), keyboard: false })
          .addTo(map).bindTooltip(p.title.split(',')[0], { permanent: true, direction: 'top', offset: [0, -38], className: 'lbl' });
      } else {
        L.circleMarker([p.lat, p.lng], { radius: 7, weight: 2, color: '#fff', fillColor: d.dot[p.kind] || '#222', fillOpacity: 1 })
          .addTo(map).bindTooltip(p.title, { direction: 'top', offset: [0, -6] });
      }
    });
    var pts = d.points.map(function (p) { return [p.lat, p.lng]; });
    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 12 });
    else map.setView(pts[0], 10);
  })();
  </script>` : ''}
</body>
</html>`;
}

router.get('/reis/:slug', (req, res, next) => {
  const trip = tripBySlug(req.params.slug);
  if (!trip) return next();
  res.set('Cache-Control', 'no-cache').type('html').send(tripPageHtml(req, tripView(trip)));
});

router.get('/og/reis/:slug.jpg', async (req, res, next) => {
  if (!sharp) return next();
  const trip = tripBySlug(req.params.slug);
  if (!trip) return next();
  try {
    const v = tripView(trip);
    const max = v.loc && v.loc.image ? 34 : 50;
    const rows = [];
    if (trip.start_date) rows.push(dateText(trip));
    for (const g of v.groups) {
      const first = g.items[0];
      if (g.kind === 'flight') rows.push(`Vlucht ${(first.subtitle || first.title).split('·')[0].trim()}`);
      else if (g.kind === 'stay') rows.push(`Hotel ${first.title}`);
    }
    const extra = v.groups.filter((g) => g.kind === 'do' || g.kind === 'eat').reduce((n, g) => n + g.items.length, 0);
    if (extra) rows.push(`${extra} ${extra === 1 ? 'plek' : 'plekken'} om te bezoeken`);
    const img = await renderCard({
      kicker: v.loc ? clip(v.loc.title, 40) : 'Reisplan',
      title: trip.title,
      rows: rows.slice(0, 4).map((label) => ({ label: clip(label, max), votes: null })),
      footer: 'Tik voor het hele reisplan',
    }, v.loc && v.loc.image);
    res.type('jpeg').set('Cache-Control', 'public, max-age=300').send(img);
  } catch (err) { next(err); }
});

/* ---------- meerdere reizen in één overzicht (/reizen/<code>) ---------- */

function bundleBySlug(slug) {
  const b = db.prepare('SELECT * FROM trip_bundles WHERE slug = ?').get(String(slug));
  if (!b) return null;
  const trips = db.prepare(`
    SELECT t.* FROM trip_bundle_trips x JOIN trips t ON t.id = x.trip_id
    WHERE x.bundle_id = ? AND t.team_id = ? ORDER BY x.position`).all(b.id, b.team_id);
  return trips.length ? { ...b, trips } : null;
}

const placeOf = (v) => (v.loc ? shortName(v.loc.title) : '');
const BUNDLE_COLORS = ['#e0245e', '#2563eb', '#008a05', '#d97706', '#7c3aed', '#0891b2', '#be123c', '#4d7c0f'];

function bundleMeta(views) {
  const names = views.map((v) => placeOf(v) || v.trip.title);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} of ${names[names.length - 1]}` : names[0];
  return {
    title: `🧳 ${views.length} reizen: ${list}?`,
    description: `${views.map((v) => `${v.trip.title}${v.trip.start_date ? ` (${shortDates(v.trip)})` : ''}`).join(' · ')}. Tik om ze te vergelijken.`,
  };
}

// Korte samenvatting per reis: wat er gekozen is, zodat je de reizen naast elkaar kunt leggen.
function bundleFacts(v) {
  const facts = [];
  const first = (kind) => (v.groups.find((g) => g.kind === kind) || { items: [] }).items[0];
  const flight = first('flight');
  const stay = first('stay');
  const car = first('car');
  const priced = (x) => (x.show_price && x.price ? ` <span class="price">${esc(x.price)}</span>` : '');
  if (flight) facts.push(`<li>${icon('plane')}<span>${esc((flight.subtitle || flight.title).split('·')[0].trim())}${priced(flight)}</span></li>`);
  if (stay) facts.push(`<li>${icon('bed')}<span>${esc(stay.title)}${priced(stay)}</span></li>`);
  if (car) facts.push(`<li>${icon('car')}<span>${esc(car.title)}${priced(car)}</span></li>`);
  const extra = v.groups.filter((g) => g.kind === 'do' || g.kind === 'eat').reduce((n, g) => n + g.items.length, 0);
  if (extra) facts.push(`<li>${icon('sparkles')}<span>${extra} ${extra === 1 ? 'plek' : 'plekken'} om te bezoeken</span></li>`);
  if (v.who) {
    facts.push(v.who.cannot.length
      ? `<li class="bad">${icon('users')}<span>Kan niet: ${v.who.cannot.map((c) => esc(c.name)).join(', ')}</span></li>`
      : `<li class="good">${icon('users')}<span>Iedereen kan</span></li>`);
  }
  return facts;
}

function bundlePageHtml(req, bundle, views) {
  const site = teamName(bundle.team_id) || 'Vakantieplanner';
  const meta = bundleMeta(views);
  const url = `${origin(req)}/reizen/${bundle.slug}`;
  const ver = views.map((v) => `${v.trip.id}.${v.groups.reduce((n, g) => n + g.items.length, 0)}${v.trip.start_date || ''}${v.trip.likes}`).join('-');
  const image = sharp ? `${origin(req)}/og/reizen/${bundle.slug}.jpg?v=${encodeURIComponent(ver)}` : '';
  const points = views.map((v, i) => (v.loc && v.loc.lat != null
    ? { lat: v.loc.lat, lng: v.loc.lng, n: i + 1, title: placeOf(v), color: BUNDLE_COLORS[i % BUNDLE_COLORS.length] } : null)).filter(Boolean);
  const mapData = JSON.stringify({ points }).replace(/</g, '\\u003c');

  const cards = views.map((v, i) => {
    const { trip, loc, groups } = v;
    const img = loc && safeImg(loc.image);
    const facts = bundleFacts(v);
    return `
    <article class="trip-card" id="reis-${i + 1}">
      ${img ? `<img class="trip-img" src="${esc(img)}" alt="" loading="lazy">` : ''}
      <div class="trip-main">
        <p class="trip-kicker"><span class="num" style="background:${BUNDLE_COLORS[i % BUNDLE_COLORS.length]}">${i + 1}</span>${loc ? esc(loc.title) : 'Reis'}</p>
        <h2 class="trip-title">${esc(trip.title)}</h2>
        <ul class="facts">
          ${trip.start_date ? `<li>${icon('calendar')}${esc(dateText(trip))}</li>` : '<li class="muted">Datum nog niet gekozen</li>'}
          ${trip.likes ? `<li class="muted">${icon('heart')}${trip.likes}</li>` : ''}
        </ul>
        ${facts.length ? `<ul class="sum">${facts.join('')}</ul>` : ''}
        ${trip.note ? `<p class="note">${esc(trip.note)}${trip.added_by ? `<small>— ${esc(trip.added_by)}</small>` : ''}</p>` : ''}
        ${groups.length ? `<details>
          <summary>Alles van deze reis bekijken</summary>
          ${groups.map((g) => `
            <h3 class="grp">${KIND_ICON[g.kind] ? icon(KIND_ICON[g.kind]) : `<span aria-hidden="true">${esc(g.icon || '')}</span>`}${esc(g.title)}${g.items.length > 1 ? ` <span class="count">${g.items.length}</span>` : ''}</h3>
            <div class="items">${g.items.map((x) => itemCard(x, v)).join('')}</div>`).join('')}
        </details>` : '<p class="empty">Nog geen vlucht, hotel of activiteiten gekozen.</p>'}
        <a class="solo" href="/reis/${esc(trip.share_slug)}">Open deze reis apart →</a>
      </div>
    </article>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#121212" media="(prefers-color-scheme: dark)">
  <title>${views.length} reizen · ${esc(site)}</title>
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${esc(site)}">
  <meta property="og:title" content="${esc(meta.title)}">
  <meta property="og:description" content="${esc(meta.description)}">
  <meta property="og:url" content="${esc(url)}">
  ${image ? `<meta property="og:image" content="${esc(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="description" content="${esc(meta.description)}">
  <link rel="stylesheet" href="/vendor/inter/index.css">
  <link rel="stylesheet" href="/vendor/leaflet/leaflet.css">
  <style>${PAGE_CSS}
    main { max-width: 760px; }
    .jump { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; padding: 0; list-style: none; }
    .jump a { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 6px 14px 6px 6px; border: 1px solid var(--line);
      border-radius: 999px; text-decoration: none; font-weight: 600; font-size: .9375rem; background: var(--surface); }
    .num { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; color: #fff; font-size: .8125rem; font-weight: 700; flex: none; }
    .trip-card { margin: 22px 0 0; border: 1px solid var(--line); border-radius: 18px; overflow: hidden; background: var(--surface); scroll-margin-top: 12px; }
    .trip-img { width: 100%; height: 180px; object-fit: cover; display: block; }
    .trip-main { padding: 16px 18px 18px; }
    .trip-kicker { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--muted); font-size: .875rem; font-weight: 500; }
    .trip-title { margin: 8px 0 0; font-size: 1.375rem; line-height: 1.25; letter-spacing: -.02em; }
    .trip-main .facts { margin-top: 8px; font-size: .9375rem; }
    .sum { display: grid; gap: 8px; margin: 14px 0 0; padding: 14px 0 0; border-top: 1px solid var(--line); list-style: none; font-size: .9375rem; }
    .sum li { display: flex; gap: 10px; align-items: flex-start; }
    .sum li .ic { margin-top: 2px; color: var(--muted); }
    .sum li span { min-width: 0; overflow-wrap: anywhere; }
    .sum .price { margin-left: 6px; }
    .sum .good, .sum .good .ic { color: var(--good); }
    .sum .bad, .sum .bad .ic { color: var(--bad); }
    .trip-main .note { margin-top: 14px; }
    details { margin: 16px 0 0; }
    summary { cursor: pointer; display: inline-flex; align-items: center; min-height: 44px; padding: 8px 16px; border-radius: 10px;
      background: var(--surface-2); font-weight: 600; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary::after { content: '▾'; margin-left: 8px; transition: transform .2s; }
    details[open] summary::after { transform: rotate(180deg); }
    .grp { display: flex; align-items: center; gap: 10px; margin: 20px 0 10px; font-size: 1.0625rem; }
    .grp .count { font-size: .8125rem; font-weight: 600; color: var(--muted); background: var(--surface-2); border-radius: 999px; padding: 1px 9px; }
    .solo { display: inline-block; margin-top: 14px; font-size: .875rem; font-weight: 600; color: var(--muted); }
    .bpin { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; border: 2px solid #fff; color: #fff;
      font: 700 13px/1 'Inter Variable', Inter, system-ui, sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.35); }
  </style>
</head>
<body>
  ${points.length ? '<div id="map" class="map" role="img" aria-label="Kaart met de bestemmingen"></div>' : ''}
  <main${points.length ? '' : ' style="margin-top:0"'}>
    <p class="kicker">Reisoverzicht${bundle.created_by ? ` van ${esc(bundle.created_by)}` : ''}</p>
    <h1>${views.length} reizen om uit te kiezen</h1>
    <ul class="jump">${views.map((v, i) => `<li><a href="#reis-${i + 1}"><span class="num" style="background:${BUNDLE_COLORS[i % BUNDLE_COLORS.length]}">${i + 1}</span>${esc(placeOf(v) || v.trip.title)}</a></li>`).join('')}</ul>
    ${cards}
  </main>
  <footer><span class="lock">Alleen bekijken</span> Gedeeld via ${esc(site)}</footer>
  ${points.length ? `<script src="/vendor/leaflet/leaflet.js"></script>
  <script>
  (function () {
    var d = ${mapData};
    if (!window.L) return;
    var map = L.map('map', { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    d.points.forEach(function (p) {
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'pin-icon', html: '<div class="bpin" style="background:' + p.color + '">' + p.n + '</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) })
        .addTo(map).bindTooltip(p.title, { permanent: true, direction: 'top', offset: [0, -16], className: 'lbl' })
        .on('click', function () { var el = document.getElementById('reis-' + p.n); if (el) el.scrollIntoView({ behavior: 'smooth' }); });
    });
    var pts = d.points.map(function (p) { return [p.lat, p.lng]; });
    if (pts.length > 1) map.fitBounds(pts, { padding: [50, 50], maxZoom: 9 });
    else map.setView(pts[0], 8);
  })();
  </script>` : ''}
</body>
</html>`;
}

router.get('/reizen/:slug', (req, res, next) => {
  const bundle = bundleBySlug(req.params.slug);
  if (!bundle) return next();
  res.set('Cache-Control', 'no-cache').type('html').send(bundlePageHtml(req, bundle, bundle.trips.map(tripView)));
});

router.get('/og/reizen/:slug.jpg', async (req, res, next) => {
  if (!sharp) return next();
  const bundle = bundleBySlug(req.params.slug);
  if (!bundle) return next();
  try {
    const views = bundle.trips.map(tripView);
    const photo = (views.find((v) => v.loc && v.loc.image) || {}).loc;
    const max = photo ? 34 : 50;
    const rows = views.map((v, i) => `${i + 1}. ${placeOf(v) || v.trip.title}${v.trip.start_date ? ` · ${shortDates(v.trip)}` : ''}`);
    const img = await renderCard({
      kicker: 'Reisoverzicht',
      title: `${views.length} reizen om uit te kiezen`,
      rows: (rows.length > 3 ? [...rows.slice(0, 2), `en nog ${rows.length - 2} reizen`] : rows).map((label) => ({ label: clip(label, max), votes: null })),
      footer: 'Tik om ze te vergelijken',
    }, photo && photo.image);
    res.type('jpeg').set('Cache-Control', 'public, max-age=300').send(img);
  } catch (err) { next(err); }
});

module.exports = router;
