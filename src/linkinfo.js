// Gegevens van een geplakte link (Airbnb, Booking, een hotelsite) ophalen: titel, foto, score enz.
// Alleen openbare adressen: nooit iets op de server zelf of in het eigen netwerk.
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(url) {
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error('Alleen http- en https-links'), { status: 400 });
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivateIp)) throw Object.assign(new Error('Deze link kan niet worden opgehaald'), { status: 400 });
}

// Zelf de redirects volgen, zodat ook elke tussenstap een openbaar adres is (korte deellinks van Airbnb).
async function fetchHtml(start) {
  let url = new URL(start);
  for (let hop = 0; hop < 6; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url);
      continue;
    }
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return { url, html: '' };
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size > MAX_BYTES) { reader.cancel().catch(() => {}); break; }
    }
    return { url, html: Buffer.concat(chunks).toString('utf8') };
  }
  return { url, html: '' };
}

const decode = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

function metaTags(html) {
  const out = {};
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const val = /content\s*=\s*["']([^"']*)["']/i.exec(tag) || /content\s*=\s*"([^"]*)"/i.exec(tag);
    if (key && val && !(key[1].toLowerCase() in out)) out[key[1].toLowerCase()] = decode(val[1]);
  }
  return out;
}

// Alle JSON-LD-objecten plat op een rij (ook binnen @graph).
function jsonLd(html) {
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    out.push(o);
    if (o['@graph']) walk(o['@graph']);
  };
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* kapotte JSON-LD overslaan */ }
  }
  return out;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const imgUrl = (v) => { v = first(v); return typeof v === 'string' ? v : (v && (v.url || v.contentUrl)) || ''; };
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s || '');

function siteName(url, meta) {
  const h = url.hostname.replace(/^www\./, '');
  if (/(^|\.)airbnb\./.test(h) || h === 'abnb.me') return 'Airbnb';
  if (/(^|\.)booking\.com$/.test(h)) return 'Booking.com';
  if (/(^|\.)vrbo\.com$/.test(h)) return 'Vrbo';
  if (/(^|\.)expedia\./.test(h)) return 'Expedia';
  if (/(^|\.)hostelworld\.com$/.test(h)) return 'Hostelworld';
  return meta['og:site_name'] || h;
}

// Airbnb-link korter maken voor het delen: alleen de kamer en eventueel datums en gasten.
function cleanLink(url, site) {
  if (site !== 'Airbnb') return url.href;
  const m = /\/rooms\/(?:plus\/)?(\d+)/.exec(url.pathname);
  if (!m) return url.href;
  const keep = new URLSearchParams();
  for (const k of ['check_in', 'check_out', 'adults', 'children']) if (url.searchParams.get(k)) keep.set(k, url.searchParams.get(k));
  const q = keep.toString();
  return `https://www.airbnb.nl/rooms/${m[1]}${q ? `?${q}` : ''}`;
}

// Airbnb geeft de foto op volle grootte; 1200 px breed is genoeg en laadt veel sneller.
function bigImage(src, base) {
  if (!src) return '';
  try {
    const u = new URL(src, base);
    if (u.hostname.endsWith('muscache.com')) { u.search = ''; u.searchParams.set('im_w', '1200'); }
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch { return ''; }
}

// Booking laat de server er niet in; de naam staat gelukkig in het adres (/hotel/pt/lisbon-destination-hostel).
function titleFromPath(url) {
  const m = /\/hotel\/[a-z]{2}\/([^/.]+)/.exec(url.pathname);
  return m ? decodeURIComponent(m[1]).replace(/-/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : '';
}

function parse(url, html) {
  const meta = metaTags(html);
  const ld = jsonLd(html);
  const lodging = ld.find((o) => /VacationRental|Hotel|Lodging|Hostel|Resort|Apartment|House|Accommodation|BedAndBreakfast/i.test([].concat(o['@type']).join(' ')))
    || ld.find((o) => o.aggregateRating || o.address) || {};
  const product = ld.find((o) => o.offers) || {};
  const site = siteName(url, meta);
  const titleTag = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]);

  let title = lodging.name || '';
  let subtitle = '';
  if (site === 'Airbnb') {
    // og:title is daar "Appartement · Catania · ★5,0 · 3 slaapkamers", de naam staat in og:description.
    title = title || meta['og:description'] || '';
    subtitle = (meta['og:title'] || '').split('·').map((s) => s.trim()).filter((s) => s && !s.startsWith('★')).join(' · ');
  } else {
    title = title || meta['og:title'] || meta['twitter:title'] || titleTag.split(/\s[|–-]\s/)[0];
  }

  const rating = lodging.aggregateRating || product.aggregateRating || {};
  const best = num(rating.bestRating) || (num(rating.ratingValue) > 5 ? 10 : 5);
  const score = num(rating.ratingValue);
  const offer = first(product.offers) || {};
  const price = num(offer.price ?? offer.lowPrice);
  const currency = offer.priceCurrency === 'EUR' || !offer.priceCurrency ? '€' : offer.priceCurrency;
  const addr = lodging.address || {};
  const geo = lodging.geo || {};
  const lat = num(lodging.latitude ?? geo.latitude ?? meta['place:location:latitude']);
  const lng = num(lodging.longitude ?? geo.longitude ?? meta['place:location:longitude']);
  const capacity = /"personCapacity":(\d+)/.exec(html);
  const guests = capacity ? +capacity[1] : num((lodging.containsPlace && lodging.containsPlace.occupancy && lodging.containsPlace.occupancy.value) || (lodging.occupancy && lodging.occupancy.value));

  return {
    site,
    link: cleanLink(url, site),
    title: clip(decode(title), 120),
    subtitle: clip(subtitle || [addr.addressLocality, addr.addressCountry && typeof addr.addressCountry === 'string' ? addr.addressCountry : ''].filter(Boolean).join(', '), 160),
    body: clip(decode(lodging.description || product.description || meta['og:description'] || meta.description || ''), 300),
    image: bigImage(imgUrl(lodging.image) || imgUrl(product.image) || meta['og:image'] || meta['twitter:image'] || '', url),
    rating: score ? Math.max(1, Math.min(5, Math.round((score / best) * 5))) : null,
    ratingText: score ? `${score.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}${best === 10 ? '/10' : ''}${rating.ratingCount || rating.reviewCount ? ` uit ${rating.ratingCount || rating.reviewCount} reviews` : ''}` : '',
    price: price ? `${currency} ${price.toLocaleString('nl-NL')}` : '',
    guests: guests || null,
    lat, lng,
  };
}

async function linkInfo(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { throw Object.assign(new Error('Dat is geen geldige link'), { status: 400 }); }
  const { url: finalUrl, html } = await fetchHtml(url);
  const site = siteName(finalUrl, {});
  const info = html ? parse(finalUrl, html) : { site, link: cleanLink(finalUrl, site) };
  if (!info.title && !info.image) {
    info.blocked = true;
    info.title = titleFromPath(finalUrl);
  }
  return info;
}

module.exports = { linkInfo, parse };
