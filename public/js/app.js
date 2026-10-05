(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = { settings: {}, sections: [], trips: [], availability: [], polls: [] };

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function safeUrl(u) {
    if (!u) return '';
    if (u.startsWith('/uploads/')) return u;
    try {
      const url = new URL(u);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }

  function lines(s) {
    return String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);
  }

  async function api(path, method = 'GET', body) {
    const res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Er ging iets mis');
    return data;
  }

  let toastTimer;
  // Melding onderin. Met `action` ({ label, run }) krijgt hij een knop, bijv. "Ongedaan maken".
  function toast(msg, isError = false, action = null) {
    const el = $('#toast');
    // Een modaal venster maakt de rest van de pagina onklikbaar; zet de melding er dan in.
    const modal = $$('dialog[open]').reverse().find((d) => d.matches(':modal'));
    const host = modal || document.body;
    if (el.parentElement !== host) host.append(el);
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.toggle('has-action', !!action);
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-btn';
      btn.textContent = action.label;
      btn.addEventListener('click', () => { el.classList.remove('show'); action.run(); }, { once: true });
      el.append(btn);
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2200);
  }

  const store = {
    get(key, fallback = '') {
      try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* ignore */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };

  const liked = (() => {
    let set;
    try { set = new Set(JSON.parse(store.get('liked', '[]'))); } catch { set = new Set(); }
    return {
      has: (id) => set.has(id),
      toggle(id) {
        set.has(id) ? set.delete(id) : set.add(id);
        store.set('liked', JSON.stringify([...set]));
        return set.has(id);
      },
    };
  })();

  // Soorten tabs die je aan een pin kunt koppelen, in de volgorde van het planpaneel.
  const KINDS = {
    flight: { icon: '✈️', title: 'Vlucht', price: true },
    stay: { icon: '🏨', title: 'Overnachting', price: true },
    do: { icon: '🎉', title: 'Activiteiten', price: false },
    eat: { icon: '🍽️', title: 'Eten & drinken', price: false },
  };
  const PIN_KINDS = Object.keys(KINDS);

  const findSection = (id) => state.sections.find((s) => s.id === id);
  const findItem = (id) => {
    for (const s of state.sections) {
      const it = s.items.find((i) => i.id === id);
      if (it) return it;
    }
    return null;
  };
  const sectionOf = (it) => it && findSection(it.section_id);
  const sectionsOfKind = (kind) => state.sections.filter((s) => s.kind === kind);
  const sortedItems = (s) => [...s.items].sort((a, b) => a.position - b.position || a.id - b.id);
  const linkedTo = (locId) => state.sections
    .filter((s) => s.kind !== 'map')
    .flatMap((s) => sortedItems(s).filter((i) => i.location_id === locId).map((it) => ({ s, it })));
  const linkedOfKind = (locId, kind) => linkedTo(locId).filter(({ s }) => s.kind === kind);
  const locations = () => sectionsOfKind('map').flatMap((s) => sortedItems(s));
  const mapSection = () => sectionsOfKind('map')[0] || null;
  const pinNumber = (id) => locations().findIndex((l) => l.id === id) + 1;
  const shortName = (title) => String(title || '').split(',')[0].trim() || title;
  const hasPos = (it) => it && it.lat != null && it.lng != null;

  // Reizen waarin deze bestemming zit; de populairste is "de" reis van de pin.
  const tripsFor = (locId) => state.trips
    .filter((t) => t.item_ids.includes(locId))
    .sort((a, b) => b.likes - a.likes || a.id - b.id);

  async function reload() {
    const data = await api('/content');
    state.settings = data.settings;
    state.sections = data.sections;
    state.trips = data.trips || [];
    state.availability = data.availability || [];
    state.polls = data.polls || [];
    render();
    if (pinCtx && pinDialog.open) renderPinSheet();
  }

  /* ---------- routing ---------- */

  // Routes: #kaart (start), #pin-12 (kaart met planpaneel van pin 12), #datum, #reizen, #stem, #stem-abc, #tab-3.
  function currentRoute() {
    const h = location.hash;
    if (h === '#reizen') return 'reizen';
    if (h === '#stem' || /^#stem-\w+$/.test(h)) return 'stem';
    if (h === '#datum') return 'datum';
    if (h === '#kaart' || /^#pin-\d+$/.test(h)) return mapSection() ? 'kaart' : fallbackRoute();
    const m = /^#tab-(\d+)$/.exec(h);
    if (m && findSection(+m[1])) return findSection(+m[1]).kind === 'map' ? 'kaart' : +m[1];
    return fallbackRoute();
  }

  function fallbackRoute() {
    if (mapSection()) return 'kaart';
    const first = state.sections.find((s) => !PIN_KINDS.includes(s.kind)) || state.sections[0];
    return first ? first.id : 'datum';
  }

  function pinFromHash() {
    const m = /^#pin-(\d+)$/.exec(location.hash);
    return m ? findItem(+m[1]) : null;
  }

  // Zet de url zonder een hashchange te veroorzaken (bijv. #pin-3 bij het openen van een pin).
  function setHashQuietly(hash) {
    if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname);
  }

  window.addEventListener('hashchange', () => {
    renderTabs();
    renderPanel();
    if (currentRoute() !== 'kaart') {
      const tabsTop = $('#tabs').getBoundingClientRect().top + window.scrollY;
      if (window.scrollY > tabsTop) window.scrollTo({ top: tabsTop, behavior: 'smooth' });
    }
  });

  /* ---------- rendering ---------- */

  function stars(n) {
    if (!n) return '';
    return `<span class="stars" aria-label="${n} van 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
  }

  function addLabel(s) {
    const t = ((s && s.title) || '').trim();
    return 'Voeg ' + (t ? t.charAt(0).toLowerCase() + t.slice(1) : 'iets') + ' toe';
  }

  function render() {
    const title = state.settings.site_title || 'Vakantie';
    document.title = title;
    $('#brand').textContent = title;
    renderTabs();
    renderPanel();
  }

  function tabLink(href, label, active, extra = '') {
    return `<a class="tab${active ? ' active' : ''}${extra}" href="${href}"${active ? ' aria-current="page"' : ''}>${label}</a>`;
  }

  function renderTabs() {
    const route = currentRoute();
    const nav = $('#tabs');
    // Vluchten en overnachtingen beheer je via de pinnen op de kaart; die tabs tonen we niet.
    const map = mapSection();
    const lists = state.sections.filter((s) => s.kind !== 'map' && !(map && (s.kind === 'flight' || s.kind === 'stay')));
    nav.innerHTML = (map ? tabLink('#kaart', `<span aria-hidden="true">🗺️</span> ${esc(map.title)}`, route === 'kaart', ' tab-map') : '')
      + tabLink('#datum', '<span aria-hidden="true">📅</span> Datum', route === 'datum')
      + tabLink('#reizen', '<span aria-hidden="true">🧳</span> Reizen', route === 'reizen')
      + tabLink('#stem', `<span aria-hidden="true">🗳️</span> Stemmen${openPolls().length ? ` <span class="tab-badge">${openPolls().length}</span>` : ''}`, route === 'stem')
      + lists.map((s) => tabLink(`#tab-${s.id}`, `${s.icon ? `<span aria-hidden="true">${esc(s.icon)}</span> ` : ''}${esc(s.title)}`, route === s.id)).join('')
      + '<button type="button" class="tab add" data-action="add-section" aria-label="Tab toevoegen">＋</button>';
    const active = $('.tab.active', nav);
    if (active) {
      const left = active.offsetLeft - nav.clientWidth / 2 + active.clientWidth / 2;
      nav.scrollTo({ left, behavior: 'smooth' });
    }
  }

  function renderPanel() {
    const route = currentRoute();
    const panel = $('#panel');
    document.body.classList.toggle('route-map', route === 'kaart');
    if (route !== 'kaart') {
      unmountMap();
      if (pinDialog.open) closePinSheet();
    }
    if (route === 'kaart') { renderMapView(); return; }
    if (route === 'reizen') { panel.innerHTML = tripsHtml(); return; }
    if (route === 'stem') { panel.innerHTML = stemHtml(); return; }
    if (route === 'datum') { panel.innerHTML = pollHtml(); return; }
    const s = findSection(route);
    panel.innerHTML = s ? sectionHtml(s) : `
      <div class="empty">
        <p>Er zijn nog geen tabs.</p>
        <button type="button" class="btn primary" data-action="add-section">＋ Tab toevoegen</button>
      </div>`;
  }

  function sectionHtml(s) {
    const items = sortedItems(s);
    const best = items.find((i) => i.is_best);
    const others = items.filter((i) => i !== best);
    const pinnable = PIN_KINDS.includes(s.kind) && mapSection();

    return `
      <div class="section-head">
        <h2>
          <span aria-hidden="true">${esc(s.icon)}</span>${esc(s.title)}
          <button type="button" class="text-btn" data-action="edit-section" data-id="${s.id}">Tab bewerken</button>
        </h2>
        ${s.intro ? `<p class="section-intro">${esc(s.intro)}</p>` : ''}
        ${pinnable ? '<p class="section-intro">Tip: open een bestemming op de <a href="#kaart">kaart</a> om suggesties in de buurt te vinden en ze meteen aan de reis te koppelen.</p>' : ''}
      </div>
      <button type="button" class="add-cta" data-action="add-item" data-id="${s.id}">
        <span class="add-cta-plus" aria-hidden="true">＋</span>
        <span>${esc(addLabel(s))}</span>
      </button>
      ${best ? cardHtml(best, s, true) : ''}
      ${others.length ? `
        <div class="label">${best ? 'Andere opties' : 'Opties'}</div>
        <div class="grid">${others.map((i) => cardHtml(i, s, false)).join('')}</div>` : ''}
      ${!items.length ? '<div class="empty"><p>Nog niets toegevoegd. Wees de eerste!</p></div>' : ''}`;
  }

  // Koppeling met een bestemming op de kaart, als chip.
  function linkChipsHtml(it) {
    const loc = it.location_id && findItem(it.location_id);
    if (!loc) return '';
    return `<div class="chips"><a class="chip" href="#pin-${loc.id}">📍 ${esc(loc.title)}</a></div>`;
  }

  function cardHtml(it, s, feature) {
    const img = safeUrl(it.image);
    const link = safeUrl(it.link);
    const pros = lines(it.pros);
    const cons = lines(it.cons);
    const price = s.show_price && it.price;

    return `
      <article class="card${it.is_best ? ' best' : ''}${feature && img ? ' feature' : ''}" data-item="${it.id}" tabindex="0" aria-label="${esc(it.title)} aanpassen">
        ${img ? `<div class="card-media"><img src="${esc(img)}" alt="" loading="lazy"></div>` : ''}
        <div class="card-body">
          <span class="card-hint" aria-hidden="true">Aanpassen</span>
          ${it.is_best ? '<span class="badge-best">Beste keuze</span>' : ''}
          ${it.subtitle ? `<div class="card-sub">${esc(it.subtitle)}</div>` : ''}
          <h3 class="card-title">${esc(it.title)}</h3>
          ${it.added_by ? `<div class="added-by">Voorgesteld door ${esc(it.added_by)}</div>` : ''}
          ${linkChipsHtml(it)}
          ${(price || it.rating) ? `
            <div class="card-meta">
              ${price ? `<span class="price">${esc(it.price)}</span>` : ''}
              ${stars(it.rating)}
            </div>` : ''}
          ${it.body ? `<p class="card-text">${esc(it.body)}</p>` : ''}
          ${pros.length ? `<ul class="pc pros">${pros.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
          ${cons.length ? `<ul class="pc cons">${cons.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
          <div class="card-foot">
            ${likeBtn('item', it.id, it.likes)}
            ${link ? `<a class="link-btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Bekijk ↗</a>` : ''}
          </div>
        </div>
      </article>`;
  }

  function likeBtn(kind, id, likes) {
    const on = liked.has(kind === 'trip' ? 't' + id : id);
    return `<button type="button" class="like${on ? ' on' : ''}" data-action="like" data-kind="${kind}" data-id="${id}" aria-pressed="${on}" aria-label="Vind ik leuk">`
      + `<span class="heart" aria-hidden="true">${on ? '♥' : '♡'}</span><span class="count">${likes || 0}</span></button>`;
  }

  function tripsHtml() {
    const trips = [...state.trips].sort((a, b) => b.likes - a.likes || a.id - b.id);
    return `
      <div class="section-head">
        <h2>Reizen</h2>
        <p class="section-intro">Elke bestemming die je op de <a href="#kaart">kaart</a> plant, komt hier als reis te staan. Geef je favoriet een hartje.</p>
      </div>
      <div class="cta-row">
        ${mapSection() ? `<a class="add-cta" href="#kaart"><span class="add-cta-plus" aria-hidden="true">🗺️</span><span>Plan een reis op de kaart</span></a>` : ''}
        <button type="button" class="btn ghost" data-action="add-trip">＋ Reis zonder kaart</button>
      </div>
      ${trips.length ? `<div class="grid">${trips.map(tripCardHtml).join('')}</div>`
        : '<div class="empty"><p>Nog geen reizen voorgesteld. Wees de eerste!</p></div>'}`;
  }

  function tripLocation(t) {
    return locations().find((l) => t.item_ids.includes(l.id)) || null;
  }

  function tripPickHref(s, it) {
    if (s.kind === 'map') return `#pin-${it.id}`;
    if (it.location_id && findItem(it.location_id)) return `#pin-${it.location_id}`;
    return `#tab-${s.id}`;
  }

  function tripCardHtml(t) {
    const picks = [];
    for (const s of state.sections) {
      for (const it of sortedItems(s)) if (t.item_ids.includes(it.id)) picks.push({ s, it });
    }
    picks.sort((a, b) => (a.s.kind === 'map' ? -1 : 0) - (b.s.kind === 'map' ? -1 : 0));
    const loc = tripLocation(t);
    const img = loc && safeUrl(loc.image);
    return `
      <article class="card trip${conflictsOf(t)?.length ? ' conflict' : ''}" data-trip="${t.id}" tabindex="0" aria-label="${esc(t.title)} aanpassen">
        ${img ? `<div class="card-media"><img src="${esc(img)}" alt="" loading="lazy"></div>` : ''}
        <div class="card-body">
          <span class="card-hint" aria-hidden="true">Aanpassen</span>
          <h3 class="card-title">${esc(t.title)}</h3>
          ${t.added_by ? `<div class="added-by">Voorgesteld door ${esc(t.added_by)}</div>` : ''}
          ${tripDatesHtml(t)}
          ${picks.length ? `<ul class="trip-picks">${picks.map(({ s, it }) => `
            <li><a class="trip-pick" href="${tripPickHref(s, it)}">
              <span class="trip-pick-icon" aria-hidden="true">${esc(s.kind === 'map' ? '📍' : s.icon)}</span>
              <span class="trip-pick-text"><small>${esc(s.kind === 'map' ? 'Bestemming' : s.title)}</small>${esc(it.title)}
                ${s.show_price && it.price ? `<span class="price">${esc(it.price)}</span>` : ''}</span>
            </a></li>`).join('')}</ul>` : ''}
          ${t.note ? `<p class="card-text">${esc(t.note)}</p>` : ''}
          <div class="card-foot">
            ${likeBtn('trip', t.id, t.likes)}
            ${loc ? `<a class="link-btn" href="#pin-${loc.id}">Verder plannen op de kaart →</a>` : ''}
          </div>
        </div>
      </article>`;
  }

  /* ---------- datums ---------- */

  const toDate = (iso) => new Date(iso + 'T00:00:00Z');
  const isoOf = (d) => d.toISOString().slice(0, 10);
  const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
  const dayCount = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5) + 1;
  const fmt = (iso, opts) => toDate(iso).toLocaleDateString('nl-NL', { timeZone: 'UTC', ...opts });
  const fmtShort = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  const todayIso = () => {
    const n = new Date();
    return isoOf(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
  };
  const rangeDays = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
  const rangeText = (a, b) => (a === b ? fmtShort(a) : `${fmtShort(a)} – ${fmtShort(b)}`);

  function pollSettings() {
    const start = state.settings.poll_start || todayIso();
    let end = state.settings.poll_end || addDays(start, 7 * 12 - 1);
    if (end < start) end = start;
    const days = Math.max(1, Math.min(60, parseInt(state.settings.trip_days, 10) || 7));
    return { start, end, days };
  }

  // Wie kan wanneer: per persoon een set met datums.
  function availabilityMap() {
    const byName = new Map();
    for (const { name, date } of state.availability) {
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(date);
    }
    return byName;
  }

  // Beste periodes: zoveel mogelijk mensen die álle dagen kunnen, daarna de meeste persoon-dagen.
  function bestWindows(byName, { start, end, days }) {
    const people = [...byName.keys()];
    if (!people.length || dayCount(start, end) < days) return [];
    const windows = [];
    for (let s = start; addDays(s, days - 1) <= end; s = addDays(s, 1)) {
      const range = rangeDays(s, addDays(s, days - 1));
      const per = people.map((name) => ({ name, n: range.filter((d) => byName.get(name).has(d)).length }));
      windows.push({
        start: s,
        end: range[range.length - 1],
        full: per.filter((p) => p.n === days).map((p) => p.name),
        partial: per.filter((p) => p.n > 0 && p.n < days),
        none: per.filter((p) => p.n === 0).map((p) => p.name),
        score: per.reduce((sum, p) => sum + p.n, 0),
      });
    }
    windows.sort((a, b) => b.full.length - a.full.length || b.score - a.score || (a.start < b.start ? -1 : 1));
    const picked = [];
    for (const w of windows) {
      if (w.score === 0) break;
      if (picked.some((p) => !(w.end < p.start || w.start > p.end))) continue;
      picked.push(w);
      if (picked.length === 3) break;
    }
    return picked;
  }

  // Wie kan niet tijdens een reis (alleen mensen die de datumprikker hebben ingevuld).
  function conflictsOf(trip) {
    if (!trip.start_date || !trip.end_date) return null;
    const range = rangeDays(trip.start_date, trip.end_date);
    const out = [];
    for (const [name, set] of availabilityMap()) {
      const ok = range.filter((d) => set.has(d)).length;
      if (ok < range.length) out.push({ name, ok, total: range.length });
    }
    return out;
  }

  function conflictText(list) {
    return list.map((c) => `${esc(c.name)} (${c.ok} van ${c.total} dagen)`).join(', ');
  }

  function tripDatesHtml(t) {
    if (!t.start_date) return '';
    const conflicts = conflictsOf(t);
    const n = dayCount(t.start_date, t.end_date);
    return `
      <div class="trip-dates">${rangeText(t.start_date, t.end_date)} · ${n} ${n === 1 ? 'dag' : 'dagen'}</div>
      ${conflicts.length ? `<div class="conflict-note"><strong>Kan niet:</strong> ${conflictText(conflicts)}</div>`
        : availabilityMap().size ? '<div class="ok-note">✓ Iedereen kan</div>' : ''}`;
  }

  function pollHtml() {
    const cfg = pollSettings();
    const byName = availabilityMap();
    const me = store.get('name').trim();
    const mine = byName.get(me) || new Set();
    const people = [...byName.keys()].sort((a, b) => a.localeCompare(b, 'nl'));
    const best = bestWindows(byName, cfg);
    const dated = state.trips.filter((t) => t.start_date);

    // Kalender: maanden met weken die op maandag beginnen.
    const tripDays = new Map();
    for (const t of dated) for (const d of rangeDays(t.start_date, t.end_date)) tripDays.set(d, (conflictsOf(t) || []).length ? 'conflict' : 'ok');
    const months = [];
    let cursor = cfg.start.slice(0, 8) + '01';
    while (cursor <= cfg.end) {
      const first = cursor;
      const next = isoOf(new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7), 1)));
      const last = addDays(next, -1);
      let weekStart = addDays(first, -((toDate(first).getUTCDay() + 6) % 7));
      const weeks = [];
      while (weekStart <= last) {
        const days = rangeDays(weekStart, addDays(weekStart, 6));
        const inRange = days.filter((d) => d >= cfg.start && d <= cfg.end && d.slice(0, 7) === first.slice(0, 7));
        weeks.push(`
          <button type="button" class="wk" data-week="${inRange.join(',')}"${inRange.length ? '' : ' disabled'} aria-label="Week ${weekNumber(weekStart)}: hele week aan of uit">${weekNumber(weekStart)}</button>
          ${days.map((d) => {
            if (d.slice(0, 7) !== first.slice(0, 7)) return '<span class="day out"></span>';
            const active = d >= cfg.start && d <= cfg.end;
            const count = people.filter((p) => byName.get(p).has(d)).length;
            const heat = people.length ? count / people.length : 0;
            const cls = ['day', mine.has(d) ? 'mine' : '', active ? '' : 'off', tripDays.has(d) ? `trip-${tripDays.get(d)}` : ''].join(' ');
            return `<button type="button" class="${cls}" data-day="${d}" style="--heat:${heat.toFixed(2)}"${active ? '' : ' disabled'}
              aria-pressed="${mine.has(d)}" aria-label="${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}, ${count} kunnen">
              <span class="dnum">${+d.slice(8)}</span>${count ? `<span class="dcount">${count}</span>` : ''}</button>`;
          }).join('')}`);
        weekStart = addDays(weekStart, 7);
      }
      months.push(`
        <div class="month">
          <div class="month-head">
            <h3 class="month-title">${fmt(first, { month: 'long', year: 'numeric' })}</h3>
            ${me ? (() => {
              const md = rangeDays(first, last).filter((d) => d >= cfg.start && d <= cfg.end);
              const all = md.length && md.every((d) => mine.has(d));
              return md.length ? `<button type="button" class="text-btn" data-week="${md.join(',')}" aria-pressed="${all}">${all ? 'Hele maand wissen' : 'Ik kan de hele maand'}</button>` : '';
            })() : ''}
          </div>
          <div class="cal">
            <span class="dow"></span>${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((d) => `<span class="dow">${d}</span>`).join('')}
            ${weeks.join('')}
          </div>
        </div>`);
      cursor = next;
    }

    const back = findItem(+store.get('returnPin'));
    return `
      ${back ? `<div class="return-bar">
        <span>Klaar met invullen?</span>
        <a class="btn sm primary" href="#pin-${back.id}" data-return>← Terug naar ${esc(shortName(back.title))} op de kaart</a>
      </div>` : ''}
      <div class="section-head">
        <h2>Datum <button type="button" class="text-btn" data-action="edit-poll">Periode instellen</button></h2>
        <p class="section-intro">Vink aan wanneer je kunt. De beste periodes van ${cfg.days} dagen tussen ${fmtShort(cfg.start)} en ${fmtShort(cfg.end)} komen bovenaan.</p>
      </div>

      ${whoHtml(me, people)}

      <div class="label">Beste periodes</div>
      ${best.length ? `<ol class="best-list">${best.map((w, i) => `
        <li class="best-row${i === 0 ? ' top' : ''}">
          <div class="best-main">
            <strong>${rangeText(w.start, w.end)}</strong>
            <small>${w.full.length} van ${people.length} kunnen alle ${cfg.days} dagen</small>
            <div class="chips">
              ${w.full.map((n) => `<span class="chip ok">${esc(n)}</span>`).join('')}
              ${w.partial.map((p) => `<span class="chip part">${esc(p.name)} ${p.n}/${cfg.days}</span>`).join('')}
              ${w.none.map((n) => `<span class="chip no">${esc(n)}</span>`).join('')}
            </div>
          </div>
          <button type="button" class="btn sm" data-action="plan-window" data-start="${w.start}" data-end="${w.end}">Plan reis →</button>
        </li>`).join('')}</ol>` : '<p class="hint">Nog niemand heeft dagen aangevinkt.</p>'}

      ${dated.length ? `
        <div class="label">Geplande reizen</div>
        <ul class="planned">${dated.map((t) => {
          const c = conflictsOf(t);
          return `<li class="planned-row${c.length ? ' conflict' : ''}" data-trip="${t.id}" tabindex="0">
            <strong>${esc(t.title)}</strong>
            <span>${rangeText(t.start_date, t.end_date)}</span>
            ${c.length ? `<small>Kan niet: ${conflictText(c)}</small>` : people.length ? '<small>✓ Iedereen kan</small>' : ''}
          </li>`;
        }).join('')}</ul>` : ''}

      <div class="label" id="kalender">Kalender</div>
      ${me ? `<div class="quick-fill">
          <button type="button" class="btn sm primary" data-fill="all">✓ Ik kan de hele periode</button>
          ${mine.size ? '<button type="button" class="btn sm ghost" data-fill="none">Alles wissen</button>' : ''}
        </div>` : ''}
      <p class="hint">Tik of veeg over de dagen waarop je kunt. Kun je bijna altijd? Kies <em>Ik kan de hele periode</em> en tik weg wanneer je niet kunt. Donkerder = meer mensen kunnen.</p>
      <div class="months${me ? '' : ' locked'}">${months.join('')}</div>

      ${people.length ? `
        <div class="label">Ingevuld door</div>
        <ul class="people">${people.map((n) => `
          <li><span>${esc(n)}</span><small>${byName.get(n).size} dagen</small>
            <button type="button" class="text-btn" data-action="remove-person" data-name="${esc(n)}">Verwijderen</button></li>`).join('')}
        </ul>` : ''}`;
  }

  // Wie vult er in? Bekende namen zijn één tik; een nieuwe naam typ je één keer.
  let whoOpen = false;
  function whoHtml(me, people) {
    if (me && !whoOpen) {
      return `<div class="who who-set">
        <span>Je vult in als <strong>${esc(me)}</strong></span>
        <button type="button" class="text-btn" data-who-change>Iemand anders?</button>
      </div>`;
    }
    const names = [...new Set([...people, ...knownPeople()])].filter((n) => n && n !== me).sort((a, b) => a.localeCompare(b, 'nl'));
    return `<div class="who" id="who">
      <p class="who-q">Wie ben jij?</p>
      ${names.length ? `<div class="who-chips">${names.map((n) => `<button type="button" class="chip-btn" data-who="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
      <form class="who-new" data-who-form>
        <label class="sr-only" for="pollName">${names.length ? 'Of typ een nieuwe naam' : 'Je naam'}</label>
        <input id="pollName" maxlength="40" autocomplete="given-name" placeholder="${names.length ? 'Nieuwe naam' : 'Je naam'}" enterkeyhint="done">
        <button type="submit" class="btn primary">Verder</button>
      </form>
    </div>`;
  }

  function chooseWho(name) {
    name = String(name || '').trim();
    if (!name) return;
    store.set('name', name);
    whoOpen = false;
    renderPanel();
    const cal = $('#kalender');
    if (cal) cal.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  document.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-who-form]')) return;
    e.preventDefault();
    chooseWho($('#pollName').value);
  });

  function weekNumber(iso) {
    const d = toDate(iso);
    d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  }

  function pollName() {
    const name = whoOpen ? '' : store.get('name').trim();
    if (!name) {
      toast('Kies eerst wie je bent', true);
      const who = $('#who');
      if (who) who.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      const input = $('#pollName');
      if (input && !$('.chip-btn')) input.focus({ preventScroll: true });
      return '';
    }
    return name;
  }

  async function setAvailable(dates, available) {
    const name = pollName();
    if (!name || !dates.length) return;
    // Direct tonen, daarna opslaan.
    const key = (d) => `${name}|${d}`;
    const have = new Set(state.availability.map((a) => `${a.name}|${a.date}`));
    if (available) dates.forEach((d) => { if (!have.has(key(d))) state.availability.push({ name, date: d }); });
    else state.availability = state.availability.filter((a) => !(a.name === name && dates.includes(a.date)));
    const y = window.scrollY;
    renderPanel();
    window.scrollTo(0, y);
    try {
      await api('/availability', 'PUT', { name, dates, available });
    } catch (err) {
      toast(err.message, true);
      await reload();
    }
  }

  // Vegen over dagen: alle dagen waar je overheen gaat krijgen dezelfde stand als de eerste.
  // touch-action: pan-y laat verticaal scrollen werken; horizontaal vegen vinkt dagen aan.
  let paint = null;
  document.addEventListener('pointerdown', (e) => {
    const day = e.target.closest && e.target.closest('.months [data-day]');
    if (!day || day.disabled || e.button > 0 || !store.get('name').trim() || whoOpen) return;
    paint = { on: day.getAttribute('aria-pressed') !== 'true', days: new Set([day.dataset.day]), moved: false, id: e.pointerId };
    if (day.hasPointerCapture && day.hasPointerCapture(e.pointerId)) day.releasePointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', (e) => {
    if (!paint || e.pointerId !== paint.id) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const day = el && el.closest && el.closest('.months [data-day]');
    if (!day || day.disabled || paint.days.has(day.dataset.day)) return;
    paint.days.add(day.dataset.day);
    paint.moved = true;
    for (const d of paint.days) {
      const b = $(`[data-day="${d}"]`);
      if (b) b.classList.toggle('painting', true), b.classList.toggle('paint-off', !paint.on);
    }
  });
  const endPaint = (e) => {
    if (!paint || (e && e.pointerId !== paint.id)) return;
    const p = paint;
    paint = null;
    if (!p.moved) return; // gewone tik: dat doet de klik
    suppressDayClick = true;
    setTimeout(() => { suppressDayClick = false; }, 400);
    setAvailable([...p.days], p.on);
  };
  document.addEventListener('pointerup', endPaint);
  document.addEventListener('pointercancel', () => {
    // Bijv. de browser begint te scrollen: wat al geveegd is toch opslaan.
    if (paint && paint.moved) endPaint({ pointerId: paint.id }); else paint = null;
  });
  let suppressDayClick = false;

  document.addEventListener('click', (e) => {
    const who = e.target.closest('[data-who]');
    if (who) { chooseWho(who.dataset.who); return; }
    if (e.target.closest('[data-who-change]')) {
      whoOpen = true;
      renderPanel();
      const first = $('#who .chip-btn') || $('#pollName');
      if (first) first.focus();
      return;
    }
    const fill = e.target.closest('[data-fill]');
    if (fill) {
      const cfg = pollSettings();
      const all = rangeDays(cfg.start, cfg.end);
      if (fill.dataset.fill === 'none' && !confirm('Al je aangevinkte dagen wissen?')) return;
      setAvailable(all, fill.dataset.fill === 'all');
      toast(fill.dataset.fill === 'all' ? 'Hele periode aangevinkt ✓ Tik nu de dagen weg waarop je niet kunt.' : 'Gewist');
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day && !day.disabled) {
      if (!suppressDayClick) setAvailable([day.dataset.day], day.getAttribute('aria-pressed') !== 'true');
      return;
    }
    const wk = e.target.closest('[data-week]');
    if (wk && !wk.disabled) {
      const dates = wk.dataset.week.split(',').filter(Boolean);
      const mine = availabilityMap().get(store.get('name').trim()) || new Set();
      setAvailable(dates, !dates.every((d) => mine.has(d)));
    }
  });


  /* ---------- actions ---------- */

  const actions = {
    async like(btn) {
      const id = +btn.dataset.id;
      const isTrip = btn.dataset.kind === 'trip';
      const on = liked.toggle(isTrip ? 't' + id : id);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      $('.heart', btn).textContent = on ? '♥' : '♡';
      const { likes } = await api(`/${isTrip ? 'trips' : 'items'}/${id}/like`, 'POST', { delta: on ? 1 : -1 });
      (isTrip ? state.trips.find((t) => t.id === id) : findItem(id)).likes = likes;
      $('.count', btn).textContent = likes;
    },
    'add-trip': () => openTripDialog(null),
    'plan-window': (btn) => openDestDialog(btn.dataset.start, btn.dataset.end),
    'edit-poll': () => openPollDialog(),
    async 'remove-person'(btn) {
      const name = btn.dataset.name;
      if (!confirm(`Alle aangevinkte dagen van ${name} verwijderen?`)) return;
      await api(`/availability/${encodeURIComponent(name)}`, 'DELETE');
      await reload();
      toast('Verwijderd');
    },
    'add-item': (btn) => openItemDialog(null, +btn.dataset.id),
    'add-place': () => {
      const s = mapSection();
      if (s) openItemDialog(null, s.id);
    },
    'add-section': () => openSectionDialog(null),
    'edit-section': (btn) => openSectionDialog(findSection(+btn.dataset.id)),
    'edit-site': () => openSiteDialog(),
    'edit-item': (btn) => openItemDialog(findItem(+btn.dataset.id)),
    'open-pin': (btn) => openPin(+btn.dataset.id),
    'link-item': (btn) => openLinkDialog(findItem(+btn.dataset.loc), findSection(+btn.dataset.section)),
    'map-fit': () => fitAll(true),
    'focus-search': () => { const el = $('#placeSearch'); if (el) el.focus(); },
  };

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-return]')) store.remove('returnPin');
    const btn = e.target.closest('[data-action]');
    if (btn && actions[btn.dataset.action]) {
      btn.disabled = true;
      try { await actions[btn.dataset.action](btn); } catch (err) { toast(err.message, true); }
      if (btn.isConnected) btn.disabled = false;
      return;
    }
    // Tik op een kaart om hem aan te passen.
    if (e.target.closest('a, button, dialog, input, label')) return;
    openCard(e.target.closest('[data-item], [data-trip]'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-item], [data-trip]')) openCard(e.target);
  });

  function openCard(card) {
    if (!card) return;
    if (card.dataset.item) openItemDialog(findItem(+card.dataset.item));
    else openTripDialog(state.trips.find((t) => t.id === +card.dataset.trip));
  }

  /* ---------- dialogs ---------- */

  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  });

  function imageFieldHtml(url, fallbackIcon) {
    const img = safeUrl(url);
    return `
      ${img ? `<img src="${esc(img)}" alt="">` : `<div class="placeholder">${esc(fallbackIcon)}</div>`}
      <button type="button" class="img-edit" data-pick-image>📷 ${img ? 'Wijzigen' : 'Foto toevoegen'}</button>`;
  }

  // Item
  const itemDialog = $('#itemDialog');
  const itemForm = $('#itemForm');
  let itemCtx = null; // { id, sectionId, image, wasBest }

  function renderItemImage() {
    const s = findSection(itemCtx.sectionId);
    $('#itemImageField').innerHTML = imageFieldHtml(itemCtx.image, s ? s.icon : '📷');
  }

  function openItemDialog(item, sectionId, preset = {}) {
    itemCtx = {
      id: item ? item.id : null,
      sectionId: item ? item.section_id : sectionId,
      image: item ? item.image : '',
      wasBest: !!(item && item.is_best),
      lat: item ? item.lat : preset.lat ?? null,
      lng: item ? item.lng : preset.lng ?? null,
    };
    const section = findSection(itemCtx.sectionId);
    $('#itemDialogTitle').textContent = item ? 'Aanpassen' : addLabel(section);
    for (const f of ['title', 'subtitle', 'price', 'rating', 'body', 'pros', 'cons', 'link', 'added_by']) {
      itemForm.elements[f].value = item ? (item[f] ?? '') : '';
    }
    if (!item) itemForm.elements.added_by.value = store.get('name');
    itemForm.elements.is_best.checked = itemCtx.wasBest;
    $('#itemDelete').hidden = !item;
    $('#priceField').hidden = !(section && section.show_price);
    const locs = section && section.kind !== 'map' ? locations() : [];
    const locId = item ? item.location_id : preset.location_id;
    $('#locationField').hidden = !locs.length;
    itemForm.elements.location_id.innerHTML = '<option value="">Geen</option>'
      + locs.map((l) => `<option value="${l.id}"${l.id === locId ? ' selected' : ''}>${esc(l.title)}</option>`).join('');
    if (!item && preset.title) itemForm.elements.title.value = preset.title;
    renderItemImage();
    itemDialog.showModal();
    if (!item) setTimeout(() => itemForm.elements.title.focus(), 50);
  }

  $('#itemImageField').addEventListener('click', (e) => {
    if (!e.target.closest('[data-pick-image]')) return;
    openImageDialog((url) => { itemCtx.image = url; renderItemImage(); });
  });

  itemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(itemForm).entries());
    const wantBest = itemForm.elements.is_best.checked;
    delete data.is_best;
    data.image = itemCtx.image || '';
    data.lat = itemCtx.lat;
    data.lng = itemCtx.lng;
    if ($('#locationField').hidden) delete data.location_id;
    if (data.added_by) store.set('name', data.added_by.trim());
    try {
      const isNew = !itemCtx.id;
      const id = isNew
        ? (await api(`/sections/${itemCtx.sectionId}/items`, 'POST', data)).id
        : (await api(`/items/${itemCtx.id}`, 'PUT', data), itemCtx.id);
      if (wantBest !== itemCtx.wasBest) await api(`/items/${id}/best`, 'PUT');
      itemDialog.close();
      await reload();
      toast(isNew ? 'Toegevoegd, bedankt! ✓' : 'Opgeslagen ✓');
      const saved = findItem(id);
      // Nieuwe bestemming: meteen het planpaneel openen.
      if (isNew && saved && sectionOf(saved).kind === 'map') openPin(saved.id);
      // Nieuwe suggestie bij een bestemming: ook in de reis van die bestemming zetten.
      else if (isNew && saved && saved.location_id && findItem(saved.location_id)) await syncTrip(findItem(saved.location_id));
    } catch (err) { toast(err.message, true); }
  });

  $('#itemDelete').addEventListener('click', async () => {
    const it = findItem(itemCtx.id);
    if (!it || !confirm(`"${it.title}" verwijderen?`)) return;
    try {
      await api(`/items/${it.id}`, 'DELETE');
      itemDialog.close();
      await reload();
      toast('Verwijderd');
    } catch (err) { toast(err.message, true); }
  });

  // Vlucht of overnachting aan een pin koppelen
  const linkDialog = $('#linkDialog');
  let linkCtx = null;

  function openLinkDialog(loc, section) {
    if (!loc || !section) return;
    linkCtx = { loc, section };
    $('#linkDialogTitle').textContent = `${section.icon} ${section.title} kiezen voor ${shortName(loc.title)}`;
    const items = sortedItems(section);
    $('#linkList').innerHTML = items.length ? items.map((it) => {
      const on = it.location_id === loc.id;
      const other = !on && it.location_id && findItem(it.location_id);
      return `<button type="button" class="link-option${on ? ' on' : ''}" data-link="${it.id}">
          <span><strong>${esc(it.title)}</strong>${other ? `<small>nu gekoppeld aan ${esc(other.title)}</small>` : ''}</span>
          ${section.show_price && it.price ? `<span class="price">${esc(it.price)}</span>` : ''}
          <span class="link-check" aria-hidden="true">${on ? '✓' : ''}</span>
        </button>`;
    }).join('') : '<p class="hint">Er staat nog niets in deze tab.</p>';
    $('#linkNew').textContent = `＋ Nieuwe ${section.title.toLowerCase()} toevoegen`;
    linkDialog.showModal();
  }

  $('#linkList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-link]');
    if (!btn) return;
    const it = findItem(+btn.dataset.link);
    const unlink = it.location_id === linkCtx.loc.id;
    try {
      await api(`/items/${it.id}`, 'PUT', { location_id: unlink ? null : linkCtx.loc.id });
      linkDialog.close();
      await reload();
      await syncTrip(linkCtx.loc, unlink ? { remove: it.id } : {});
      toast(unlink ? 'Ontkoppeld' : 'Gekoppeld ✓');
      if (!unlink && linkCtx.section.kind === 'flight') animateFlight(linkCtx.loc.id);
    } catch (err) { toast(err.message, true); }
  });

  $('#linkNew').addEventListener('click', () => {
    linkDialog.close();
    openItemDialog(null, linkCtx.section.id, { location_id: linkCtx.loc.id });
  });

  /* ---------- kaart: de centrale plek om een reis te plannen ---------- */

  const HOME = [52.3105, 4.7683]; // Schiphol
  const HOME_CODE = 'AMS';
  const DOT_COLORS = { stay: '#b8412c', do: '#3f6b3a', eat: '#c27a1a' };
  let map = null;
  let markers = {};
  let dataLayer = null;
  let flightLayers = [];
  let didFit = false;

  function unmountMap() {
    if (map) { map.remove(); map = null; }
    markers = {};
    dataLayer = null;
    flightLayers = [];
    didFit = false;
  }

  // Samenvatting van hoe ver een bestemming gepland is.
  function planOf(loc) {
    const trip = tripsFor(loc.id)[0] || null;
    const per = {};
    for (const k of PIN_KINDS) per[k] = linkedOfKind(loc.id, k);
    const conflicts = trip ? conflictsOf(trip) : null;
    const done = [!!(trip && trip.start_date), per.flight.length > 0, per.stay.length > 0];
    return { trip, per, conflicts, done: done.filter(Boolean).length, total: done.length };
  }

  const shortRange = (a, b) => {
    const o = { day: 'numeric', month: 'short' };
    return a === b ? fmt(a, o) : `${fmt(a, o)} – ${fmt(b, o)}`;
  };

  function renderMapView() {
    const panel = $('#panel');
    if (!map || !$('#map')) {
      unmountMap();
      panel.innerHTML = `
        <div class="mapview">
          <div class="map-stage">
            <div class="map-search" role="search">
              <label for="placeSearch" class="sr-only">Zoek een bestemming</label>
              <span class="map-search-icon" aria-hidden="true">⌕</span>
              <input id="placeSearch" type="search" placeholder="Zoek een stad, eiland of land…" autocomplete="off" spellcheck="false"
                role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="placeResults">
              <ul id="placeResults" class="place-results" role="listbox" aria-label="Zoekresultaten" hidden></ul>
            </div>
            <div id="map" class="map" role="region" aria-label="Kaart met bestemmingen. Tik op de kaart om een pin te prikken, of gebruik het zoekveld."></div>
            <div class="map-hint" id="mapHint" aria-hidden="true">Tik op de kaart om een pin te prikken</div>
          </div>
          <div class="dest-sheet" id="destSheet">
            <button type="button" class="sheet-grip" id="destGrip" aria-expanded="false" aria-controls="planner" aria-label="Lijst met bestemmingen uitklappen"><span aria-hidden="true"></span></button>
            <aside class="planner" id="planner" aria-label="Bestemmingen en planning"></aside>
          </div>
        </div>`;
      listOpen = false;
      mountMap();
      sheetSwipe($('#destGrip'), { up: () => setListOpen(true), down: () => setListOpen(false), tap: () => setListOpen(!listOpen) });
    } else {
      drawMapData();
    }
    $('#planner').innerHTML = plannerHtml();
    const pin = pinFromHash();
    if (pin && (!pinCtx || pinCtx.locId !== pin.id || !pinDialog.open)) openPin(pin.id, { fly: true });
  }

  /* --- mobiel: de kaart vult het scherm, de lijst schuift er als paneel overheen --- */

  const isPhone = () => window.matchMedia('(max-width: 600px)').matches;
  let listOpen = false;

  function setListOpen(open) {
    listOpen = open;
    const sheet = $('#destSheet');
    if (!sheet) return;
    sheet.classList.toggle('open', open);
    const grip = $('#destGrip');
    grip.setAttribute('aria-expanded', String(open));
    grip.setAttribute('aria-label', open ? 'Lijst met bestemmingen inklappen' : 'Lijst met bestemmingen uitklappen');
    if (!open) $('#planner').scrollTop = 0;
  }

  // Omhoog of omlaag vegen over een greep; een tik (of Enter) doet `tap`.
  function sheetSwipe(el, { up, down, tap }) {
    if (!el) return;
    let y0 = null;
    let swiped = false;
    el.addEventListener('pointerdown', (e) => { y0 = e.clientY; swiped = false; });
    el.addEventListener('pointerup', (e) => {
      if (y0 === null) return;
      const dy = e.clientY - y0;
      y0 = null;
      if (Math.abs(dy) < 24) return;
      swiped = true;
      (dy < 0 ? up : down)();
    });
    el.addEventListener('pointercancel', () => { y0 = null; });
    if (tap) el.addEventListener('click', () => { if (!swiped) tap(); swiped = false; });
  }

  // In het uitgeklapte lijstpaneel: tik op de kop klapt het weer in.
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.dest-sheet .planner-head h2') && isPhone()) setListOpen(!listOpen);
  });

  /* --- zijpaneel / lijst onder de kaart --- */

  function whenStripHtml() {
    const cfg = pollSettings();
    const byName = availabilityMap();
    const best = bestWindows(byName, cfg)[0];
    if (!byName.size) {
      return `<a class="when-strip" href="#datum">
        <span class="when-icon" aria-hidden="true">📅</span>
        <span><strong>Wanneer kan iedereen?</strong><small>Vul de datumprikker in, dan zie je hier de beste week.</small></span>
        <span class="when-go" aria-hidden="true">→</span></a>`;
    }
    return `<a class="when-strip" href="#datum">
      <span class="when-icon" aria-hidden="true">📅</span>
      <span>${best ? `<strong>Beste periode: ${shortRange(best.start, best.end)}</strong>
        <small>${best.full.length} van ${byName.size} kunnen alle ${cfg.days} dagen</small>`
        : '<strong>Nog geen periode waarin iedereen kan</strong><small>Bekijk de datumprikker</small>'}</span>
      <span class="when-go" aria-hidden="true">→</span></a>`;
  }

  function stepChip(icon, ok, label, text) {
    return `<span class="step-chip${ok ? ' ok' : ''}" title="${esc(label)}"><span aria-hidden="true">${icon}</span>`
      + `<span class="sr-only">${esc(label)}: </span>${text}</span>`;
  }

  function destRowHtml(loc) {
    const n = pinNumber(loc.id);
    const p = planOf(loc);
    const img = safeUrl(loc.image);
    const t = p.trip;
    const dateText = t && t.start_date ? shortRange(t.start_date, t.end_date) : 'datum?';
    const conflict = p.conflicts && p.conflicts.length;
    const active = pinCtx && pinCtx.locId === loc.id && pinDialog.open;
    return `
      <li class="dest${loc.is_best ? ' best' : ''}${active ? ' active' : ''}" data-dest="${loc.id}">
        <button type="button" class="dest-main" data-action="open-pin" data-id="${loc.id}" aria-label="${esc(loc.title)} plannen, ${p.done} van ${p.total} stappen klaar">
          <span class="dest-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}<span class="dest-num">${hasPos(loc) ? n : '?'}</span></span>
          <span class="dest-text">
            <strong>${esc(loc.title)}</strong>
            <span class="dest-steps">
              ${stepChip('📅', t && t.start_date && !conflict, 'Datum', conflict ? `<span class="warn">${dateText}</span>` : dateText)}
              ${stepChip('✈️', p.per.flight.length, 'Vlucht', p.per.flight.length ? '✓' : '–')}
              ${stepChip('🏨', p.per.stay.length, 'Overnachting', p.per.stay.length ? '✓' : '–')}
              ${p.per.do.length + p.per.eat.length ? stepChip('🎉', true, 'Activiteiten en eten', p.per.do.length + p.per.eat.length) : ''}
            </span>
          </span>
          <span class="dest-go" aria-hidden="true">›</span>
        </button>
        <div class="dest-side">
          <span class="progress" role="img" aria-label="${p.done} van ${p.total} geregeld"><span style="width:${Math.round(p.done / p.total * 100)}%"></span></span>
          ${t ? likeBtn('trip', t.id, t.likes) : likeBtn('item', loc.id, loc.likes)}
        </div>
      </li>`;
  }

  function plannerHtml() {
    const s = mapSection();
    const locs = locations();
    const loose = state.sections
      .filter((x) => x.kind === 'flight' || x.kind === 'stay')
      .flatMap((x) => sortedItems(x).filter((it) => !it.location_id || !findItem(it.location_id)).map((it) => ({ s: x, it })));
    return `
      ${pollBannerHtml()}
      ${whenStripHtml()}
      <div class="planner-head">
        <h2>Bestemmingen${locs.length ? ` <span class="count-pill">${locs.length}</span>` : ''}</h2>
        <button type="button" class="text-btn" data-action="edit-section" data-id="${s.id}">Tab bewerken</button>
      </div>
      ${locs.length ? `<ol class="dest-list">${locs.map(destRowHtml).join('')}</ol>` : `
        <ol class="onboarding">
          <li><strong>Kies een plek.</strong> Zoek bovenaan de kaart, of tik ergens op de kaart.</li>
          <li><strong>Plan de reis.</strong> Kies een datum uit de datumprikker, een vlucht en een hotel in de buurt.</li>
          <li><strong>Stem samen.</strong> Iedereen kan bestemmingen toevoegen en hartjes geven.</li>
        </ol>
        <button type="button" class="btn primary block" data-action="focus-search">⌕ Zoek een bestemming</button>`}
      ${locs.length >= 2 ? `<button type="button" class="btn block vote-cta" data-action="new-poll">🗳️ Laat de groep kiezen tussen ${locs.length} bestemmingen</button>` : ''}
      <div class="planner-foot">
        <button type="button" class="text-btn" data-action="add-place">＋ Bestemming toevoegen zonder kaart</button>
        ${locs.some(hasPos) ? '<button type="button" class="text-btn" data-action="map-fit">Toon alle pinnen</button>' : ''}
      </div>
      ${loose.length ? `
        <div class="label">Nog niet aan een bestemming gekoppeld</div>
        <ul class="linked">${loose.map(({ s: ls, it }) => `
          <li><button type="button" data-action="edit-item" data-id="${it.id}">
            <span aria-hidden="true">${esc(ls.icon)}</span><span>${esc(it.title)}</span>
            ${ls.show_price && it.price ? `<span class="price">${esc(it.price)}</span>` : ''}
          </button></li>`).join('')}</ul>` : ''}`;
  }

  // Met het toetsenbord: Tab naar een pin en Enter of spatie opent het planpaneel.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const icon = e.target.closest && e.target.closest('.leaflet-marker-icon');
    const hit = icon && Object.entries(markers).find(([, m]) => m.getElement() === icon);
    if (!hit) return;
    e.preventDefault();
    openPin(+hit[0]);
  });

  // Lijst en kaart aan elkaar koppelen: aanwijzen van een rij laat de pin oplichten.
  document.addEventListener('pointerover', (e) => {
    const row = e.target.closest && e.target.closest('[data-dest]');
    highlightPin(row ? +row.dataset.dest : null);
  });
  document.addEventListener('focusin', (e) => {
    const row = e.target.closest && e.target.closest('[data-dest]');
    if (row) highlightPin(+row.dataset.dest);
  });

  let highlighted = null;
  function highlightPin(id) {
    if (highlighted === id) return;
    if (highlighted && markers[highlighted] && markers[highlighted].getElement()) markers[highlighted].getElement().classList.remove('hover');
    highlighted = id;
    if (id && markers[id] && markers[id].getElement()) markers[id].getElement().classList.add('hover');
  }

  /* --- de kaart zelf --- */

  function pinIcon(item) {
    const n = pinNumber(item.id);
    const active = pinCtx && pinCtx.locId === item.id && pinDialog.open;
    return L.divIcon({
      className: 'pin-icon',
      html: `<div class="pin${item.is_best ? ' best' : ''}${active ? ' active' : ''}"><span>${n}</span></div>`,
      iconSize: [32, 42],
      iconAnchor: [16, 42],
      tooltipAnchor: [0, -40],
    });
  }

  function mountMap() {
    const el = $('#map');
    if (!el) return;
    if (!window.L) {
      el.innerHTML = '<div class="map-error">De kaart kon niet geladen worden.</div>';
      return;
    }
    map = L.map(el, { worldCopyJump: true, zoomSnap: 0.5, zoomControl: false });
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Inzoomen', zoomOutTitle: 'Uitzoomen' }).addTo(map);
    // Standaardkaart van OpenStreetMap: gratis, geen API-sleutel nodig.
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    });
    // Satellietbeeld van Esri (gratis, geen sleutel), met plaatsnamen eroverheen.
    const satellite = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Beelden &copy; Esri, Maxar, Earthstar Geographics', maxZoom: 19, maxNativeZoom: 18,
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, maxNativeZoom: 18,
      }),
    ]);
    const setBase = (sat) => {
      (sat ? streets : satellite).remove();
      (sat ? satellite : streets).addTo(map);
      el.classList.toggle('sat', sat);
      store.set('mapLayer', sat ? 'sat' : '');
      const b = el.querySelector('[data-map="layer"]');
      if (b) { b.setAttribute('aria-pressed', String(sat)); b.title = sat ? 'Toon de gewone kaart' : 'Toon satellietbeeld'; }
    };

    const Buttons = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() {
        const box = L.DomUtil.create('div', 'leaflet-bar map-buttons');
        box.innerHTML = `
          <a href="#" role="button" data-map="fit" title="Toon alle pinnen" aria-label="Toon alle pinnen">⤢</a>
          <a href="#" role="button" data-map="layer" title="Toon satellietbeeld" aria-label="Satellietbeeld" aria-pressed="false">🛰️</a>`;
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.on(box, 'click', (e) => {
          const a = e.target.closest('[data-map]');
          if (!a) return;
          L.DomEvent.preventDefault(e);
          if (a.dataset.map === 'fit') fitAll(true);
          else setBase(!el.classList.contains('sat'));
        });
        return box;
      },
    });
    new Buttons().addTo(map);
    setBase(store.get('mapLayer') === 'sat');

    // Ver uitgezoomd: alleen nummers en namen, geen datums; heel ver: alleen nummers.
    const zoomClass = () => {
      const z = map.getZoom();
      el.classList.toggle('zoom-far', z < 5);
      el.classList.toggle('zoom-world', z < 3.5);
    };
    map.on('zoomend', zoomClass);

    L.circleMarker(HOME, { radius: 6, color: '#fff', weight: 2, fillColor: '#f97316', fillOpacity: 1, interactive: false })
      .addTo(map).bindTooltip('🇳🇱 Thuis', { direction: 'top', offset: [0, -6] });

    dataLayer = L.layerGroup().addTo(map);
    drawMapData();

    if (!pinFromHash()) fitAll(false);
    else { const p = pinFromHash(); if (hasPos(p)) map.setView([p.lat, p.lng], 9); else fitAll(false); }
    zoomClass();

    // Even wachten bij een klik: een dubbelklik is inzoomen, geen nieuwe pin.
    let clickTimer = null;
    map.on('click', (e) => {
      clearTimeout(clickTimer);
      // Op de telefoon ligt er een paneel over de kaart: eerst tikken sluit dat, pas daarna prik je.
      if (isPhone() && (listOpen || pinDialog.open)) {
        if (pinDialog.open) closePinSheet();
        setListOpen(false);
        return;
      }
      clickTimer = setTimeout(() => addPinAt(e.latlng), 280);
    });
    map.on('dblclick zoomstart movestart', () => clearTimeout(clickTimer));
    // Na het tekenen (en als de kaart zichtbaar is) de vluchten laten vliegen.
    setTimeout(() => { if (map) { map.invalidateSize(); drawFlights(true); } }, 150);
    setupSearch();
  }

  function fitAll(animate) {
    if (!map) return;
    const pins = locations().filter(hasPos);
    if (pins.length) {
      const b = L.latLngBounds([HOME, ...pins.map((p) => [p.lat, p.lng])]);
      // Bovenaan extra ruimte, zodat geen pin achter het zoekveld valt.
      map.fitBounds(b, { paddingTopLeft: [50, 150], paddingBottomRight: [70, 40], maxZoom: 7, animate });
    } else {
      map.setView([44, 12], 3.5, { animate });
    }
  }

  // Pinnen en gekoppelde plekken (opnieuw) tekenen zonder het kaartbeeld te verschuiven.
  function drawMapData() {
    if (!map || !dataLayer) return;
    dataLayer.clearLayers();
    markers = {};
    for (const it of locations().filter(hasPos)) {
      const t = tripsFor(it.id)[0];
      const label = `${esc(it.title)}${t && t.start_date ? `<small>${shortRange(t.start_date, t.end_date)}</small>` : ''}`;
      const m = L.marker([it.lat, it.lng], {
        icon: pinIcon(it), draggable: true, autoPan: true, title: `${it.title}: reis plannen`, riseOnHover: true,
      })
        .addTo(dataLayer)
        .bindTooltip(label, { permanent: true, interactive: true, direction: 'top', className: 'pin-label', bubblingMouseEvents: false });
      m.on('click', () => openPin(it.id));
      m.getTooltip().on('click', () => openPin(it.id));
      m.on('dragend', async () => {
        const { lat, lng } = m.getLatLng();
        try {
          await api(`/items/${it.id}`, 'PUT', { lat, lng });
          it.lat = lat; it.lng = lng;
          drawFlights(false);
          toast('Pin verplaatst ✓');
        } catch (err) { toast(err.message, true); }
      });
      markers[it.id] = m;
    }

    // Gekozen hotels, activiteiten en restaurants als gekleurde stipjes rond hun pin.
    for (const kind of ['stay', 'do', 'eat']) {
      for (const st of sectionsOfKind(kind)) {
        for (const h of st.items) {
          if (!hasPos(h) || !h.location_id) continue;
          L.circleMarker([h.lat, h.lng], { radius: 7, weight: 2, color: '#fff', fillColor: DOT_COLORS[kind], fillOpacity: 1, bubblingMouseEvents: false })
            .addTo(dataLayer).bindTooltip(`${st.icon} ${esc(h.title)}`, { direction: 'top', offset: [0, -4] })
            .on('click', () => openItemDialog(h));
        }
      }
    }
    drawFlights(false);
  }

  // Tik op de kaart: pin direct opslaan en meteen het planpaneel tonen.
  // De plaatsnaam wordt op de achtergrond opgezocht en daarna ingevuld.
  let pinning = false;
  async function addPinAt(latlng, title, { fly = true } = {}) {
    const section = mapSection();
    if (pinning || !section) return;
    pinning = true;
    const { lat, lng } = latlng.wrap ? latlng.wrap() : latlng;
    try {
      const { id } = await api(`/sections/${section.id}/items`, 'POST', {
        title: title || 'Nieuwe plek', lat, lng, added_by: store.get('name'),
      });
      await reload();
      openPin(id, { fly });
      toast('Pin geprikt ✓', false, { label: 'Ongedaan maken', run: () => undoPin(id) });
      if (!title) {
        const name = await placeName(lat, lng);
        if (name && findItem(id) && findItem(id).title === 'Nieuwe plek') {
          await api(`/items/${id}`, 'PUT', { title: name });
          await reload();
        }
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      pinning = false;
    }
  }

  // Per ongeluk geprikt: pin meteen weer weghalen.
  async function undoPin(id) {
    try {
      if (pinCtx && pinCtx.locId === id) closePinSheet();
      await api(`/items/${id}`, 'DELETE');
      await reload();
      toast('Pin weggehaald');
    } catch (err) { toast(err.message, true); }
  }

  // Plaatsnaam opzoeken bij de aangeklikte plek (OpenStreetMap Nominatim).
  async function placeName(lat, lng) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=nl&lat=${lat}&lon=${lng}`);
      if (!res.ok) return '';
      const a = (await res.json()).address || {};
      const place = a.city || a.town || a.village || a.municipality || a.county || a.state || '';
      return [place, a.country].filter(Boolean).join(', ');
    } catch { return ''; }
  }

  /* --- zoeken (Photon, gratis en zonder sleutel; Nominatim als reserve) --- */

  let searchTimer = null;
  let searchSeq = 0;
  let searchResults = [];
  let searchActive = -1;
  let pendingEnter = false;
  let searchBusy = false;

  async function geocode(q) {
    try {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=7`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      return (data.features || []).map((f) => {
        const p = f.properties || {};
        const [lng, lat] = f.geometry.coordinates;
        const where = [p.city !== p.name ? p.city : '', p.state !== p.name ? p.state : '', p.country !== p.name ? p.country : '']
          .filter(Boolean);
        return {
          name: p.name || q,
          detail: [...new Set(where)].join(', '),
          country: p.country || '',
          lat, lng,
          extent: p.extent,
        };
      });
    } catch {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=7&accept-language=nl&addressdetails=1&q=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      return (await res.json()).map((r) => ({
        name: r.name || r.display_name.split(',')[0],
        detail: r.display_name.split(',').slice(1).join(',').trim(),
        country: (r.address && r.address.country) || '',
        lat: +r.lat,
        lng: +r.lon,
      }));
    }
  }

  // Met één tik op de kaart: populaire vakantiebestemmingen vanuit Nederland.
  const POPULAR = [
    ['Barcelona', 'Spanje', 41.3874, 2.1686], ['Lissabon', 'Portugal', 38.7223, -9.1393],
    ['Rome', 'Italië', 41.9028, 12.4964], ['Kreta', 'Griekenland', 35.2401, 24.8093],
    ['Mallorca', 'Spanje', 39.6953, 3.0176], ['Side', 'Turkije', 36.7673, 31.3890],
    ['Málaga', 'Spanje', 36.7213, -4.4214], ['Algarve', 'Portugal', 37.0179, -7.9307],
    ['Parijs', 'Frankrijk', 48.8566, 2.3522], ['Gran Canaria', 'Spanje', 27.9202, -15.5474],
    ['Dubrovnik', 'Kroatië', 42.6507, 18.0944], ['Praag', 'Tsjechië', 50.0755, 14.4378],
  ].map(([name, country, lat, lng]) => ({ name, country, detail: country, lat, lng }));

  function showPopular() {
    const list = $('#placeResults');
    const input = $('#placeSearch');
    if (!list || !input || input.value.trim()) return;
    const picks = POPULAR.filter((r) => !nearbyPin(r)).slice(0, 8);
    if (!picks.length) return;
    searchResults = picks;
    searchActive = -1;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    list.innerHTML = `<li class="place-head" role="presentation">Populair · tik om toe te voegen</li>`
      + picks.map((r, i) => `<li id="place-${i}" role="option" data-place="${i}" aria-selected="false" class="place-chip">
        <strong>${esc(r.name)}</strong><small>${esc(r.country)}</small></li>`).join('');
    markActive();
  }

  function setupSearch() {
    const input = $('#placeSearch');
    if (!input) return;
    input.addEventListener('focus', showPopular);
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      pendingEnter = false;
      searchBusy = input.value.trim().length >= 2;
      const q = input.value.trim();
      if (q.length < 2) { showResults([]); if (!q) showPopular(); return; }
      searchTimer = setTimeout(async () => {
        const seq = ++searchSeq;
        renderResultsLoading();
        let results = [];
        try { results = await geocode(q); } catch { /* geen resultaten */ }
        if (seq !== searchSeq) return;
        searchBusy = false;
        showResults(results, q);
        if (pendingEnter) { pendingEnter = false; if (results.length) choosePlace(results[0]); }
      }, 280);
    });
    input.addEventListener('keydown', (e) => {
      const list = $('#placeResults');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!searchResults.length) return;
        e.preventDefault();
        searchActive = (searchActive + (e.key === 'ArrowDown' ? 1 : -1) + searchResults.length) % searchResults.length;
        markActive();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!input.value.trim() && searchActive < 0) return;
        if (searchResults.length && !searchBusy) choosePlace(searchResults[Math.max(0, searchActive)]);
        else if (input.value.trim().length >= 2) pendingEnter = true;
      } else if (e.key === 'Escape') {
        if (!list.hidden) { e.preventDefault(); showResults([]); } else input.value = '';
      }
    });
    input.addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement !== input) showResults([]);
    }, 150));
    // Bij neerdrukken alleen het zoekveld actief houden; kiezen pas bij de klik zelf,
    // anders valt die klik door op de kaart eronder en komt er een tweede pin bij.
    $('#placeResults').addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-place]')) e.preventDefault();
    });
    $('#placeResults').addEventListener('click', (e) => {
      const li = e.target.closest('[data-place]');
      if (li) choosePlace(searchResults[+li.dataset.place]);
    });
  }

  function renderResultsLoading() {
    const list = $('#placeResults');
    if (!list) return;
    list.hidden = false;
    list.innerHTML = '<li class="place-status">Zoeken…</li>';
    $('#placeSearch').setAttribute('aria-expanded', 'true');
  }

  function showResults(results, q) {
    const input = $('#placeSearch');
    const list = $('#placeResults');
    if (!input || !list) return;
    searchResults = results;
    searchActive = results.length ? 0 : -1;
    const open = results.length > 0 || (q && q.length >= 2);
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    list.innerHTML = results.length ? results.map((r, i) => {
      const near = nearbyPin(r);
      return `<li id="place-${i}" role="option" data-place="${i}" aria-selected="${i === 0}">
        <strong>${esc(r.name)}</strong>${r.detail ? `<small>${esc(r.detail)}</small>` : ''}
        ${near ? `<em>Staat al op de kaart als ${esc(shortName(near.title))}</em>` : ''}
      </li>`;
    }).join('') : (open ? '<li class="place-status">Niets gevonden. Probeer een andere spelling.</li>' : '');
    markActive();
  }

  function markActive() {
    const input = $('#placeSearch');
    $$('#placeResults [role="option"]').forEach((li, i) => {
      li.setAttribute('aria-selected', String(i === searchActive));
      if (i === searchActive) li.scrollIntoView({ block: 'nearest' });
    });
    if (searchActive >= 0) input.setAttribute('aria-activedescendant', `place-${searchActive}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function nearbyPin(r) {
    return locations().find((l) => hasPos(l) && distanceKm([l.lat, l.lng], [r.lat, r.lng]) < 15) || null;
  }

  // Kies een zoekresultaat: bestaande pin openen of een nieuwe prikken.
  async function choosePlace(r) {
    if (!r) return;
    const input = $('#placeSearch');
    showResults([]);
    input.value = '';
    input.blur();
    const near = nearbyPin(r);
    if (near) { openPin(near.id, { fly: true }); return; }
    // Een land of regio past in beeld; een stad of eiland zoomt in tot zichtbaar is wat er in de buurt ligt.
    const e = Array.isArray(r.extent) && r.extent.length === 4 ? r.extent : null;
    if (map && e) map.flyToBounds([[e[3], e[0]], [e[1], e[2]]], { paddingTopLeft: [40, 120], paddingBottomRight: [40, 40 + sheetOverlap()], maxZoom: 10, duration: reducedMotion() ? 0 : 1.2 });
    else if (map) flyToVisible([r.lat, r.lng], 9);
    await addPinAt({ lat: r.lat, lng: r.lng }, [r.name, r.country !== r.name ? r.country : ''].filter(Boolean).join(', '), { fly: !map });
  }

  /* --- vluchtanimatie --- */

  // Gebogen route van Nederland naar een pin.
  function arcPoints(from, to, n = 64) {
    const [lat1, lng1] = from;
    const [lat2, lng2] = to;
    const dx = lng2 - lng1;
    const dy = lat2 - lat1;
    const cx = (lng1 + lng2) / 2 - dy * 0.2;
    const cy = (lat1 + lat2) / 2 + dx * 0.2;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      pts.push([u * u * lat1 + 2 * u * t * cy + t * t * lat2, u * u * lng1 + 2 * u * t * cx + t * t * lng2]);
    }
    return pts;
  }

  const PLANE_SVG = '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function flightLocations() {
    const ids = new Set(sectionsOfKind('flight').flatMap((s) => s.items.map((i) => i.location_id)).filter(Boolean));
    return [...ids].map(findItem).filter((l) => hasPos(l) && markers[l.id]);
  }

  function drawFlights(animate) {
    if (!map) return;
    flightLayers.forEach((l) => l.remove());
    flightLayers = [];
    flightLocations().forEach((loc, i) => {
      const line = L.polyline(arcPoints(HOME, [loc.lat, loc.lng]), { className: 'flight-line', weight: 2.5, interactive: false }).addTo(map);
      flightLayers.push(line);
      if (animate) setTimeout(() => animateFlight(loc.id), i * 600);
    });
  }

  function animateFlight(locId) {
    if (!map || reducedMotion()) return;
    const loc = findItem(locId);
    const hasFlight = sectionsOfKind('flight').some((s) => s.items.some((i) => i.location_id === locId));
    if (!hasPos(loc) || !hasFlight) return;
    const pts = arcPoints(HOME, [loc.lat, loc.lng]);
    const plane = L.marker(pts[0], {
      icon: L.divIcon({ className: 'plane-icon', html: `<div class="plane">${PLANE_SVG}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
    const trail = L.polyline([], { className: 'flight-trail', weight: 3, interactive: false }).addTo(map);
    const ownMap = map;
    const duration = 2200;
    const start = performance.now();
    const step = (now) => {
      if (map !== ownMap) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const idx = Math.min(pts.length - 1, Math.floor(eased * (pts.length - 1)));
      const next = pts[Math.min(pts.length - 1, idx + 1)];
      plane.setLatLng(pts[idx]);
      trail.setLatLngs(pts.slice(0, idx + 1));
      const a = map.latLngToLayerPoint(pts[idx]);
      const b = map.latLngToLayerPoint(next);
      if (a.distanceTo(b) > 0.5) {
        const angle = Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI;
        const el = plane.getElement() && plane.getElement().firstChild;
        if (el) el.style.transform = `rotate(${angle}deg)`;
      }
      if (t < 1) requestAnimationFrame(step);
      else {
        setTimeout(() => { plane.remove(); trail.remove(); }, 400);
        const m = markers[locId];
        if (m && m.getElement()) {
          m.getElement().classList.add('landed');
          setTimeout(() => m.getElement() && m.getElement().classList.remove('landed'), 700);
        }
      }
    };
    requestAnimationFrame(step);
  }

  /* ---------- planpaneel per pin: datum, vlucht, hotel, activiteiten en eten ---------- */

  const nearbyCache = new Map();
  const pinDialog = $('#pinDialog');
  let pinCtx = null; // { locId, open: Set, airports, hotels, do, eat }
  let pinReturnFocus = null;

  // Plekken in de buurt via onze eigen server (die Overpass bevraagt en de uitkomst bewaart).
  async function nearbyData(kind, loc) {
    const key = `${kind}|${loc.lat.toFixed(3)}|${loc.lng.toFixed(3)}`;
    if (nearbyCache.has(key)) return nearbyCache.get(key);
    const data = await api(`/nearby/${kind}?lat=${loc.lat}&lng=${loc.lng}`);
    nearbyCache.set(key, data);
    return data;
  }

  function distanceKm(a, b) {
    const R = 6371;
    const rad = (d) => d * Math.PI / 180;
    const dLat = rad(b[0] - a[0]);
    const dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Grove schatting: ± 800 km/u kruissnelheid plus een half uur voor opstijgen en landen.
  function flightTime(km) {
    const min = Math.round(km / 800 * 60 + 30);
    return `${Math.floor(min / 60)}u ${String(min % 60).padStart(2, '0')}m`;
  }

  const elPos = (el) => (el.center ? [el.center.lat, el.center.lon] : [el.lat, el.lon]);
  const kmText = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`);

  async function findAirports(loc) {
    const els = await nearbyData('airports', loc);
    const seen = new Set();
    return els
      .map((el) => {
        const t = el.tags || {};
        const pos = elPos(el);
        return {
          iata: String(t.iata || '').trim().toUpperCase(),
          name: t['name:nl'] || t['name:en'] || t.name || t.iata,
          international: /international/i.test([t['aerodrome:type'], t.aerodrome, t.name, t['name:en']].join(' ')),
          pos,
          km: distanceKm([loc.lat, loc.lng], pos),
        };
      })
      .filter((a) => /^[A-Z]{3}$/.test(a.iata) && a.iata !== HOME_CODE && !seen.has(a.iata) && seen.add(a.iata))
      .sort((a, b) => (b.international - a.international) || a.km - b.km)
      .slice(0, 3)
      .sort((a, b) => a.km - b.km);
  }

  const HOTEL_TYPES = { hotel: 'Hotel', resort: 'Resort', apartment: 'Appartement', hostel: 'Hostel', guest_house: 'Pension', motel: 'Motel' };

  async function findHotels(loc) {
    const els = await nearbyData('hotels', loc);
    return els
      .map((el) => {
        const t = el.tags || {};
        const pos = elPos(el);
        const stars = parseInt(t.stars, 10);
        return {
          name: t.name,
          type: HOTEL_TYPES[t.tourism] || 'Verblijf',
          stars: stars >= 1 && stars <= 7 ? stars : null,
          website: safeUrl(t.website || t['contact:website'] || ''),
          street: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '),
          city: t['addr:city'] || '',
          osm: `https://www.openstreetmap.org/${el.type}/${el.id}`,
          pos,
          km: distanceKm([loc.lat, loc.lng], pos),
        };
      })
      .filter((h) => h.name)
      .sort((a, b) => (b.stars || 0) - (a.stars || 0) || a.km - b.km)
      .slice(0, 30);
  }

  const PLACE_TYPES = {
    attraction: 'Bezienswaardigheid', museum: 'Museum', viewpoint: 'Uitzichtpunt', theme_park: 'Pretpark', zoo: 'Dierentuin',
    aquarium: 'Aquarium', gallery: 'Galerie', beach: 'Strand', water_park: 'Waterpark', castle: 'Kasteel', ruins: 'Ruïne',
    archaeological_site: 'Opgraving', monument: 'Monument', restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar',
    ice_cream: 'IJssalon', pub: 'Kroeg',
  };

  // Leuke dingen om te doen (binnen 8 km) of plekken om te eten (binnen 2 km), uit OpenStreetMap.
  async function findPlaces(loc, kind) {
    const els = await nearbyData(kind, loc);
    const seen = new Set();
    return els
      .map((el) => {
        const t = el.tags || {};
        const pos = elPos(el);
        const type = t.tourism || t.natural || t.leisure || t.historic || t.amenity;
        const known = !!(t.wikidata || t.wikipedia);
        return {
          name: t['name:nl'] || t.name,
          type: PLACE_TYPES[type] || 'Plek',
          cuisine: t.cuisine ? t.cuisine.split(';').slice(0, 2).join(', ').replace(/_/g, ' ') : '',
          website: safeUrl(t.website || t['contact:website'] || ''),
          osm: `https://www.openstreetmap.org/${el.type}/${el.id}`,
          // Bekende plekken (met Wikipedia-pagina of website) eerst.
          score: (known ? 2 : 0) + (t.website || t['contact:website'] ? 1 : 0) + (t.opening_hours ? 0.5 : 0),
          pos,
          km: distanceKm([loc.lat, loc.lng], pos),
        };
      })
      .filter((p) => p.name && !seen.has(p.name) && seen.add(p.name))
      .sort((x, y) => y.score - x.score || x.km - y.km)
      .slice(0, 20);
  }

  async function ensureSection(kind) {
    const found = sectionsOfKind(kind)[0];
    if (found) return found;
    const k = KINDS[kind];
    const { id } = await api('/sections', 'POST', { title: k.title, icon: k.icon, kind, show_price: k.price });
    await reload();
    return findSection(id);
  }

  // Houd de reis van een bestemming bij: de pin, alles wat eraan gekoppeld is en de datums.
  async function syncTrip(loc, patch = {}) {
    if (!loc) return null;
    const trip = tripsFor(loc.id)[0];
    const ids = new Set([...(trip ? trip.item_ids : []), loc.id, ...linkedTo(loc.id).map(({ it }) => it.id)]);
    if (patch.remove) ids.delete(patch.remove);
    const body = {
      title: trip ? trip.title : `Reis naar ${shortName(loc.title)}`,
      note: trip ? trip.note || '' : '',
      added_by: trip ? trip.added_by || '' : store.get('name'),
      start_date: 'start_date' in patch ? patch.start_date : (trip && trip.start_date) || '',
      end_date: 'end_date' in patch ? patch.end_date : (trip && trip.end_date) || '',
      item_ids: [...ids],
    };
    let id = trip && trip.id;
    if (trip) await api(`/trips/${trip.id}`, 'PUT', body);
    else id = (await api('/trips', 'POST', body)).id;
    await reload();
    return id;
  }

  const isWide = () => window.matchMedia('(min-width: 960px)').matches;

  // Open het planpaneel van een bestemming (vanaf de kaart, de lijst of een link).
  function openPin(id, { fly = true } = {}) {
    const loc = findItem(id);
    if (!loc) return;
    if (currentRoute() !== 'kaart') { location.hash = `#pin-${id}`; return; }
    setHashQuietly(`#pin-${id}`);
    if (fly && map && hasPos(loc)) flyToVisible([loc.lat, loc.lng], Math.max(map.getZoom(), 8));
    setListOpen(false);
    openPinSheet(loc);
  }

  // Hoeveel pixels van de kaart het planpaneel op de telefoon bedekt.
  function sheetOverlap() {
    if (!map || !isPhone()) return 0;
    const box = map.getContainer().getBoundingClientRect();
    return Math.max(0, Math.round(box.bottom - window.innerHeight * (1 - BOTTOM_SHEET)));
  }

  // Vlieg naar een plek zodat die midden in het stuk kaart staat dat niet onder het planpaneel ligt.
  function flyToVisible(latlng, zoom) {
    let target = L.latLng(latlng);
    if (isPhone()) {
      const box = map.getContainer().getBoundingClientRect();
      const sheetTop = window.innerHeight * (1 - BOTTOM_SHEET);
      const want = (box.top + 72 + sheetTop) / 2; // tussen zoekveld en paneel
      const dy = (box.top + box.height / 2) - want;
      target = map.unproject(map.project(target, zoom).add([0, dy]), zoom);
    }
    map.flyTo(target, zoom, { duration: reducedMotion() ? 0 : 0.8 });
  }

  function openPinSheet(loc) {
    if (!loc) return;
    const same = pinCtx && pinCtx.locId === loc.id;
    if (!same) {
      const p = planOf(loc);
      // Open meteen de eerste stap die nog niet geregeld is.
      const first = !(p.trip && p.trip.start_date) ? 'when' : !p.per.flight.length ? 'flight' : !p.per.stay.length ? 'stay' : 'do';
      pinCtx = { locId: loc.id, open: new Set([first]) };
    }
    // Wie zelf weer een bestemming opent, heeft de terugknop in de datumprikker niet meer nodig.
    store.remove('returnPin');
    if (!pinDialog.open) {
      pinReturnFocus = document.activeElement;
      const mode = sheetMode();
      pinDialog.classList.toggle('side', mode === 'side');
      pinDialog.classList.toggle('bottom', mode === 'bottom');
      setPinFull(false);
      document.body.classList.toggle('pin-bottom', mode === 'bottom');
      if (mode === 'side') { placeSideSheet(); pinDialog.show(); } else if (mode === 'bottom') pinDialog.show(); else pinDialog.showModal();
      $('#pinTitle').focus({ preventScroll: true });
    }
    renderPinSheet();
    refreshPinMarkers();
    if (!same && hasPos(loc)) {
      loadPinData('airports', () => findAirports(loc));
      loadPinData('hotels', () => findHotels(loc));
      for (const k of ['do', 'eat']) if (pinCtx.open.has(k)) loadPinData(k, () => findPlaces(loc, k));
    }
  }

  function closePinSheet() {
    if (pinDialog.open) pinDialog.close();
  }

  // Breed scherm: naast de kaart. Telefoon: half over de kaart, zodat pin en stipjes zichtbaar blijven.
  const BOTTOM_SHEET = 0.56;
  function sheetMode() {
    if (currentRoute() !== 'kaart') return 'modal';
    return isWide() ? 'side' : isPhone() ? 'bottom' : 'modal';
  }
  const currentMode = () => (pinDialog.classList.contains('side') ? 'side' : pinDialog.classList.contains('bottom') ? 'bottom' : 'modal');

  function setPinFull(full) {
    pinDialog.classList.toggle('full', full);
    const grip = $('#pinGrip');
    grip.setAttribute('aria-expanded', String(full));
    grip.setAttribute('aria-label', full ? 'Planpaneel kleiner maken, kaart tonen' : 'Planpaneel groter maken');
  }
  sheetSwipe($('#pinGrip'), {
    up: () => setPinFull(true),
    down: () => (pinDialog.classList.contains('full') ? setPinFull(false) : closePinSheet()),
    tap: () => setPinFull(!pinDialog.classList.contains('full')),
  });
  sheetSwipe($('.sheet-head', pinDialog), {
    up: () => { if (currentMode() === 'bottom') setPinFull(true); },
    down: () => { if (currentMode() !== 'bottom') return; if (pinDialog.classList.contains('full')) setPinFull(false); else closePinSheet(); },
  });

  pinDialog.addEventListener('close', () => {
    pinCtx = null;
    document.body.classList.remove('pin-bottom');
    if (/^#pin-\d+$/.test(location.hash)) setHashQuietly('#kaart');
    refreshPinMarkers();
    if (pinReturnFocus && pinReturnFocus.isConnected) pinReturnFocus.focus({ preventScroll: true });
    pinReturnFocus = null;
  });

  // Niet-modale zijbalk (breed scherm) sluit ook met Escape.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pinDialog.open && currentMode() !== 'modal' && !$('dialog[open]:not(#pinDialog)')) {
      closePinSheet();
    }
  });

  // Op een breed scherm ligt het planpaneel precies over de bestemmingenlijst, zodat de kaart vrij blijft.
  function placeSideSheet() {
    const planner = $('#planner');
    if (!planner) return;
    const r = planner.getBoundingClientRect();
    const top = Math.max(r.top, 0);
    Object.assign(pinDialog.style, {
      top: `${top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${window.innerHeight - top}px`,
    });
  }
  window.addEventListener('resize', () => {
    if (!pinDialog.open) return;
    if (sheetMode() !== currentMode()) {
      const ctx = pinCtx;
      pinDialog.close();
      if (ctx) openPin(ctx.locId, { fly: false });
    } else if (currentMode() === 'side') placeSideSheet();
  });
  window.addEventListener('scroll', () => { if (pinDialog.open && pinDialog.classList.contains('side')) placeSideSheet(); }, { passive: true });

  function refreshPinMarkers() {
    for (const [id, m] of Object.entries(markers)) {
      const it = findItem(+id);
      if (it) m.setIcon(pinIcon(it));
    }
    $$('.dest').forEach((li) => li.classList.toggle('active', !!(pinCtx && pinDialog.open && +li.dataset.dest === pinCtx.locId)));
  }

  async function loadPinData(key, fn) {
    const locId = pinCtx.locId;
    if (Array.isArray(pinCtx[key]) || pinCtx[key] === 'loading') return;
    pinCtx[key] = 'loading';
    renderPinSheet();
    let result;
    try { result = await fn(); } catch { result = 'error'; }
    if (!pinCtx || pinCtx.locId !== locId) return;
    pinCtx[key] = result;
    renderPinSheet();
  }

  /* --- inhoud van het planpaneel --- */

  function statusHtml(v, empty) {
    if (v === 'loading' || v === undefined) return '<p class="hint loading-dots">Zoeken in de buurt (de eerste keer kan dit even duren)</p>';
    if (v === 'error') return `<p class="hint">OpenStreetMap is nu even te druk. <button type="button" class="text-btn" data-retry>Opnieuw proberen</button></p>`;
    if (!v.length) return `<p class="hint">${empty}</p>`;
    return '';
  }

  function chosenHtml(list) {
    if (!list.length) return '';
    return `<ul class="chosen">${list.map(({ s, it }) => `
      <li>
        <button type="button" class="chosen-main" data-action="edit-item" data-id="${it.id}">
          <span aria-hidden="true">${esc(s.icon)}</span>
          <span><strong>${esc(it.title)}</strong>${it.subtitle ? `<small>${esc(it.subtitle)}</small>` : ''}</span>
          ${s.show_price && it.price ? `<span class="price">${esc(it.price)}</span>` : ''}
        </button>
        <button type="button" class="icon-btn sm" data-unlink="${it.id}" aria-label="${esc(it.title)} weghalen bij deze bestemming">✕</button>
      </li>`).join('')}</ul>`;
  }

  function stepHtml(key, icon, title, summary, done, body) {
    const open = pinCtx.open.has(key);
    return `
      <details class="step${done ? ' done' : ''}" data-step="${key}"${open ? ' open' : ''}>
        <summary>
          <span class="step-icon" aria-hidden="true">${done ? '✓' : icon}</span>
          <span class="step-title">${title}<small>${summary}</small></span>
        </summary>
        <div class="step-body">${body}</div>
      </details>`;
  }

  function whenStepHtml(loc, p) {
    const t = p.trip;
    const cfg = pollSettings();
    const byName = availabilityMap();
    const windows = bestWindows(byName, cfg);
    const dated = t && t.start_date;
    const conflicts = p.conflicts || [];
    const me = store.get('name').trim();
    const summary = dated
      ? `${shortRange(t.start_date, t.end_date)}${conflicts.length ? ` · <span class="warn">${conflicts.length} kan niet</span>` : byName.size ? ' · iedereen kan' : ''}`
      : 'Nog niet gekozen';
    const body = `
      ${dated ? `<div class="when-chosen">
          <p class="when-range"><strong>${rangeText(t.start_date, t.end_date)}</strong> · ${dayCount(t.start_date, t.end_date)} dagen</p>
          ${conflicts.length ? `<div class="conflict-note"><strong>Kan niet:</strong> ${conflictText(conflicts)}</div>`
            : byName.size ? '<div class="ok-note">✓ Iedereen die de datumprikker invulde kan</div>' : ''}
        </div>` : ''}
      ${windows.length ? `
        <p class="mini-label">Beste periodes uit de datumprikker</p>
        <div class="window-list">${windows.map((w, i) => {
          const on = dated && t.start_date === w.start && t.end_date === w.end;
          return `<button type="button" class="window${on ? ' on' : ''}" data-set-dates="${w.start}|${w.end}" aria-pressed="${!!on}">
            ${i === 0 ? '<span class="window-tag">Beste</span>' : ''}
            <strong>${shortRange(w.start, w.end)}</strong>
            <small>${w.full.length} van ${byName.size} kunnen</small>
          </button>`;
        }).join('')}</div>`
        : `<p class="hint">${byName.size ? 'Er is nog geen periode van ' + cfg.days + ' dagen waarin mensen kunnen.' : 'Nog niemand heeft de datumprikker ingevuld.'}</p>`}
      <div class="row-2 date-row">
        <label>Vertrek<input type="date" data-date="start" value="${esc(dated ? t.start_date : '')}"></label>
        <label>Terug<input type="date" data-date="end" value="${esc(dated ? t.end_date : '')}"></label>
      </div>
      <div class="step-actions">
        <a class="btn sm" href="#datum" data-go-poll>📅 ${me && byName.has(me) ? 'Jouw beschikbaarheid aanpassen' : 'Vul in wanneer jij kunt'}</a>
        ${dated ? '<button type="button" class="btn sm ghost" data-clear-dates>Datum wissen</button>' : ''}
      </div>`;
    return stepHtml('when', '📅', 'Wanneer', summary, dated && !conflicts.length, body);
  }

  function resultsHtml(items, addAttr, titles, renderMain) {
    return `<ul class="results">${items.map((x, i) => {
      const added = titles.has(x.addTitle || x.name);
      return `<li class="result">
        <div class="result-main">${renderMain(x)}</div>
        <button type="button" class="btn sm${added ? ' done' : ''}" ${addAttr}="${i}"${added ? ' disabled' : ''}>${added ? '✓ Gekozen' : '＋ Kies'}</button>
      </li>`;
    }).join('')}</ul>`;
  }

  function kindStepHtml(loc, p, kind) {
    const k = KINDS[kind];
    const section = sectionsOfKind(kind)[0];
    const chosen = p.per[kind];
    const titles = new Set(chosen.map(({ it }) => it.title));
    const own = section && section.items.length
      ? `<button type="button" class="text-btn" data-action="link-item" data-loc="${loc.id}" data-section="${section.id}">Kies uit eerdere suggesties</button>` : '';
    const ownNew = `<button type="button" class="text-btn" data-new-kind="${kind}">＋ Zelf ${k.title.toLowerCase()} invullen</button>`;
    let found = '';
    if (!hasPos(loc)) {
      found = '<p class="hint">Zet de bestemming op de kaart om suggesties in de buurt te zien.</p>';
    } else if (kind === 'flight') {
      const airports = Array.isArray(pinCtx.airports) ? pinCtx.airports.map((a) => ({ ...a, addTitle: `Amsterdam → ${a.name} (${a.iata})` })) : [];
      found = `
        ${statusHtml(pinCtx.airports, 'Geen vliegveld gevonden binnen 200 km.')}
        ${resultsHtml(airports, 'data-add-airport', titles, (a) => `
          <strong>${HOME_CODE} → ${esc(a.iata)}</strong>
          <span>${esc(a.name)}</span>
          <small>${kmText(a.km)} van de pin · ± ${flightTime(distanceKm(HOME, a.pos))} vliegen</small>
          <span class="result-links">
            <a href="${flightsUrl(a.iata, p.trip)}" target="_blank" rel="noopener">Google Flights ↗</a>
            <a href="${skyscannerUrl(a.iata, p.trip)}" target="_blank" rel="noopener">Skyscanner ↗</a>
          </span>`)}
        <p class="fineprint">Vliegtijd is een schatting. ${p.trip && p.trip.start_date ? 'De links zoeken op jullie reisdatums.' : 'Kies eerst een datum, dan zoeken de links op die dagen.'}</p>`;
    } else if (kind === 'stay') {
      const hotels = Array.isArray(pinCtx.hotels) ? pinCtx.hotels : [];
      found = `
        ${statusHtml(pinCtx.hotels, 'Geen hotels gevonden binnen 5 km.')}
        ${resultsHtml(hotels, 'data-add-hotel', titles, (h) => `
          <strong>${esc(h.name)}</strong>
          <small>${h.stars ? `${'★'.repeat(h.stars)} · ` : ''}${esc(h.type)} · ${kmText(h.km)}</small>
          <span class="result-links">
            ${h.website ? `<a href="${esc(h.website)}" target="_blank" rel="noopener">Website ↗</a>` : ''}
            <a href="${bookingUrl(`${h.name} ${h.city || shortName(loc.title)}`, p.trip)}" target="_blank" rel="noopener">Prijs op Booking ↗</a>
          </span>`)}
        <p class="fineprint">Hotelgegevens: © OpenStreetMap-bijdragers.</p>`;
    } else {
      const places = Array.isArray(pinCtx[kind]) ? pinCtx[kind] : [];
      found = `
        ${statusHtml(pinCtx[kind], kind === 'do' ? 'Niets gevonden binnen 8 km.' : 'Geen restaurants gevonden binnen 2 km.')}
        ${resultsHtml(places, `data-add-${kind}`, titles, (x) => `
          <strong>${esc(x.name)}</strong>
          <small>${esc(x.type)}${x.cuisine ? ` · ${esc(x.cuisine)}` : ''} · ${kmText(x.km)}</small>
          <span class="result-links">
            ${x.website ? `<a href="${esc(x.website)}" target="_blank" rel="noopener">Website ↗</a>` : ''}
            <a href="${esc(x.osm)}" target="_blank" rel="noopener">Op OpenStreetMap ↗</a>
          </span>`)}`;
    }
    const n = chosen.length;
    const summary = n ? chosen.map(({ it }) => esc(it.title)).slice(0, 2).join(', ') + (n > 2 ? ` en ${n - 2} meer` : '')
      : kind === 'flight' || kind === 'stay' ? 'Nog niet gekozen' : 'Optioneel';
    const nearbyLabel = { flight: 'Vliegvelden in de buurt', stay: 'Hotels in de buurt', do: 'Te doen in de buurt', eat: 'Eten in de buurt' }[kind];
    return stepHtml(kind, k.icon, k.title, summary, n > 0, `
      ${chosenHtml(chosen)}
      <div class="step-actions">${own}${ownNew}</div>
      <p class="mini-label">${nearbyLabel}</p>
      ${found}`);
  }

  // Zoeklinks met de reisdatums al ingevuld als die bekend zijn.
  function flightsUrl(iata, trip) {
    const when = trip && trip.start_date ? ` on ${trip.start_date} returning ${trip.end_date}` : '';
    return `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${HOME_CODE} to ${iata}${when}`)}`;
  }
  function skyscannerUrl(iata, trip) {
    const d = (iso) => iso.slice(2).replace(/-/g, '');
    const dates = trip && trip.start_date ? `${d(trip.start_date)}/${d(trip.end_date)}/` : '';
    return `https://www.skyscanner.nl/transport/vluchten/${HOME_CODE.toLowerCase()}/${esc(iata.toLowerCase())}/${dates}`;
  }
  function bookingUrl(q, trip) {
    const dates = trip && trip.start_date ? `&checkin=${trip.start_date}&checkout=${trip.end_date > trip.start_date ? trip.end_date : addDays(trip.start_date, 1)}` : '';
    return `https://www.booking.com/searchresults.nl.html?ss=${encodeURIComponent(q)}${dates}`;
  }

  function renderPinSheet() {
    if (!pinCtx) return;
    const loc = findItem(pinCtx.locId);
    if (!loc) { closePinSheet(); return; }
    const p = planOf(loc);
    const n = pinNumber(loc.id);
    $('#pinTitle').textContent = loc.title;
    $('#pinNum').innerHTML = hasPos(loc) ? `<span>${n}</span>` : '';
    $('#pinNum').hidden = !hasPos(loc);
    const body = $('#pinBody');
    const scroll = body.scrollTop;
    const img = safeUrl(loc.image);
    const other = linkedTo(loc.id).filter(({ s }) => !PIN_KINDS.includes(s.kind));
    const otherTrips = tripsFor(loc.id).slice(1);
    body.innerHTML = `
      <div class="plan-top">
        ${img ? `<div class="plan-img"><img src="${esc(img)}" alt=""></div>` : ''}
        <div class="plan-meta">
          ${loc.subtitle ? `<span class="card-sub">${esc(loc.subtitle)}</span>` : ''}
          ${loc.added_by ? `<span class="added-by">Voorgesteld door ${esc(loc.added_by)}</span>` : ''}
          <span class="progress lg" role="img" aria-label="${p.done} van ${p.total} geregeld"><span style="width:${Math.round(p.done / p.total * 100)}%"></span></span>
          <span class="plan-status">${p.done === p.total ? '✓ Datum, vlucht en hotel geregeld' : `${p.done} van ${p.total} geregeld: datum, vlucht en hotel`}</span>
        </div>
      </div>
      ${whenStepHtml(loc, p)}
      ${kindStepHtml(loc, p, 'flight')}
      ${kindStepHtml(loc, p, 'stay')}
      ${kindStepHtml(loc, p, 'do')}
      ${kindStepHtml(loc, p, 'eat')}
      ${other.length ? `<section class="plan-other"><p class="mini-label">Ook gekoppeld</p>${chosenHtml(other)}</section>` : ''}
      <section class="plan-trip">
        ${p.trip ? `
          <div class="plan-trip-row">
            <span><small class="mini-label">Reis</small><strong>${esc(p.trip.title)}</strong></span>
            ${likeBtn('trip', p.trip.id, p.trip.likes)}
          </div>
          <div class="step-actions">
            <button type="button" class="btn sm" data-edit-trip="${p.trip.id}">Naam en toelichting</button>
            <a class="btn sm ghost" href="#reizen">Alle reizen vergelijken →</a>
          </div>
          ${otherTrips.length ? `<p class="hint">Deze bestemming zit ook in: ${otherTrips.map((t) => `<button type="button" class="text-btn" data-edit-trip="${t.id}">${esc(t.title)}</button>`).join(', ')}</p>` : ''}`
        : '<p class="hint">Kies een datum, vlucht of hotel; dan wordt de reis automatisch aangemaakt, zodat iedereen hem in Reizen kan zien en een hartje kan geven.</p>'}
      </section>`;
    body.scrollTop = scroll;
  }

  // Openklappen van een stap onthouden (en suggesties pas dan ophalen).
  $('#pinBody').addEventListener('toggle', (e) => {
    const d = e.target.closest && e.target.closest('details[data-step]');
    if (!d || !pinCtx) return;
    const key = d.dataset.step;
    if (d.open) pinCtx.open.add(key); else pinCtx.open.delete(key);
    const loc = findItem(pinCtx.locId);
    if (d.open && (key === 'do' || key === 'eat') && hasPos(loc)) loadPinData(key, () => findPlaces(loc, key));
  }, true);

  $('#pinBody').addEventListener('change', async (e) => {
    const input = e.target.closest('[data-date]');
    if (!input || !pinCtx) return;
    const loc = findItem(pinCtx.locId);
    const start = $('[data-date="start"]', pinDialog);
    const end = $('[data-date="end"]', pinDialog);
    if (input === start && start.value && (!end.value || end.value < start.value)) {
      end.value = addDays(start.value, pollSettings().days - 1);
    }
    if (!start.value && !end.value) return;
    await setTripDates(loc, start.value || end.value, end.value || start.value);
  });

  // Na het afronden van een stap meteen door naar de volgende die nog open staat.
  function advanceStep(from) {
    if (!pinCtx) return;
    const loc = findItem(pinCtx.locId);
    if (!loc) return;
    const p = planOf(loc);
    const next = !(p.trip && p.trip.start_date) ? 'when' : !p.per.flight.length ? 'flight' : !p.per.stay.length ? 'stay' : 'do';
    if (next === from) return;
    pinCtx.open.delete(from);
    pinCtx.open.add(next);
    renderPinSheet();
    if (next === 'do' && hasPos(loc)) loadPinData('do', () => findPlaces(loc, 'do'));
    const el = $(`[data-step="${next}"]`, pinDialog);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  async function setTripDates(loc, start, end) {
    if (start > end) [start, end] = [end, start];
    try {
      await syncTrip(loc, { start_date: start, end_date: end });
      const c = conflictsOf({ start_date: start, end_date: end });
      toast(c && c.length ? `Datum opgeslagen · ${c.length} kan niet` : 'Datum opgeslagen ✓', !!(c && c.length));
    } catch (err) { toast(err.message, true); }
  }

  $('#pinBody').addEventListener('click', async (e) => {
    if (!pinCtx) return;
    const loc = findItem(pinCtx.locId);
    const t = e.target;

    if (t.closest('[data-retry]')) {
      for (const [key, fn] of [['airports', () => findAirports(loc)], ['hotels', () => findHotels(loc)],
        ['do', () => findPlaces(loc, 'do')], ['eat', () => findPlaces(loc, 'eat')]]) {
        if (pinCtx[key] === 'error') { pinCtx[key] = undefined; loadPinData(key, fn); }
      }
      return;
    }
    const win = t.closest('[data-set-dates]');
    if (win) {
      const [start, end] = win.dataset.setDates.split('|');
      await setTripDates(loc, start, end);
      advanceStep('when');
      return;
    }
    if (t.closest('[data-clear-dates]')) {
      try { await syncTrip(loc, { start_date: '', end_date: '' }); toast('Datum gewist'); } catch (err) { toast(err.message, true); }
      return;
    }
    if (t.closest('[data-go-poll]')) {
      store.set('returnPin', String(loc.id));
      closePinSheet();
      return;
    }
    const editTrip = t.closest('[data-edit-trip]');
    if (editTrip) { openTripDialog(state.trips.find((x) => x.id === +editTrip.dataset.editTrip)); return; }
    const newKind = t.closest('[data-new-kind]');
    if (newKind) {
      const section = await ensureSection(newKind.dataset.newKind);
      openItemDialog(null, section.id, { location_id: loc.id });
      return;
    }
    const unlink = t.closest('[data-unlink]');
    if (unlink) {
      const it = findItem(+unlink.dataset.unlink);
      if (!it) return;
      unlink.disabled = true;
      try {
        await api(`/items/${it.id}`, 'PUT', { location_id: null });
        await reload();
        await syncTrip(loc, { remove: it.id });
        toast(`${it.title} weggehaald`);
      } catch (err) { unlink.disabled = false; toast(err.message, true); }
      return;
    }

    const add = t.closest('[data-add-airport], [data-add-hotel], [data-add-do], [data-add-eat]');
    if (!add) return;
    add.disabled = true;
    const kind = add.matches('[data-add-airport]') ? 'flight' : add.matches('[data-add-hotel]') ? 'stay' : null;
    const first = kind && !planOf(loc).per[kind].length;
    try {
      await addSuggestion(loc, add);
      toast('Toegevoegd aan de reis ✓');
      if (first) advanceStep(kind);
    } catch (err) {
      add.disabled = false;
      toast(err.message, true);
    }
  });

  async function addSuggestion(loc, btn) {
    const by = store.get('name');
    if (btn.dataset.addAirport !== undefined) {
      const a = pinCtx.airports[+btn.dataset.addAirport];
      const section = await ensureSection('flight');
      await api(`/sections/${section.id}/items`, 'POST', {
        title: `Amsterdam → ${a.name} (${a.iata})`,
        subtitle: `${HOME_CODE} → ${a.iata} · ± ${flightTime(distanceKm(HOME, a.pos))} vliegen`,
        body: `Vliegveld op ${kmText(a.km)} van ${loc.title}. Vliegtijd is een schatting; zoek de prijs op via de link.`,
        link: flightsUrl(a.iata, tripsFor(loc.id)[0]),
        location_id: loc.id,
        added_by: by,
      });
      await reload();
      await syncTrip(loc);
      animateFlight(loc.id);
      return;
    }
    if (btn.dataset.addHotel !== undefined) {
      const h = pinCtx.hotels[+btn.dataset.addHotel];
      const section = await ensureSection('stay');
      await api(`/sections/${section.id}/items`, 'POST', {
        title: h.name,
        subtitle: [h.stars ? `${h.stars}★` : '', h.type, h.city].filter(Boolean).join(' · '),
        body: [h.street && `${h.street}${h.city ? ', ' + h.city : ''}`, `${kmText(h.km)} van ${loc.title}.`].filter(Boolean).join('\n'),
        rating: h.stars && h.stars <= 5 ? h.stars : null,
        link: h.website || h.osm,
        lat: h.pos[0],
        lng: h.pos[1],
        location_id: loc.id,
        added_by: by,
      });
    } else {
      const kind = btn.dataset.addDo !== undefined ? 'do' : 'eat';
      const x = pinCtx[kind][+(btn.dataset.addDo ?? btn.dataset.addEat)];
      const section = await ensureSection(kind);
      await api(`/sections/${section.id}/items`, 'POST', {
        title: x.name,
        subtitle: [x.type, x.cuisine].filter(Boolean).join(' · '),
        body: `${kmText(x.km)} van ${loc.title}.`,
        link: x.website || x.osm,
        lat: x.pos[0],
        lng: x.pos[1],
        location_id: loc.id,
        added_by: by,
      });
    }
    await reload();
    await syncTrip(loc);
  }

  $('#pinDelete').addEventListener('click', async () => {
    const loc = findItem(pinCtx.locId);
    const n = linkedTo(loc.id).length;
    if (!loc || !confirm(`Bestemming "${loc.title}" verwijderen?${n ? ` De ${n} gekozen vlucht(en), hotel(s) en plekken blijven bewaard, maar zonder bestemming.` : ''}`)) return;
    try {
      await api(`/items/${loc.id}`, 'DELETE');
      closePinSheet();
      await reload();
      toast('Bestemming verwijderd');
    } catch (err) { toast(err.message, true); }
  });

  $('#pinEdit').addEventListener('click', () => {
    openItemDialog(findItem(pinCtx.locId));
  });

  // Vanuit de datumprikker: kies voor welke bestemming de gekozen periode is.
  const destDialog = $('#destDialog');
  let destCtx = null;

  function openDestDialog(start, end) {
    const locs = locations();
    if (!locs.length) { openTripDialog(null, { start_date: start, end_date: end }); return; }
    destCtx = { start, end };
    $('#destDialogTitle').textContent = `Waarheen van ${shortRange(start, end)}?`;
    $('#destList').innerHTML = locs.map((l) => {
      const t = tripsFor(l.id)[0];
      return `<button type="button" class="link-option" data-dest-pick="${l.id}">
        <span><strong>${esc(l.title)}</strong>${t && t.start_date ? `<small>nu gepland: ${shortRange(t.start_date, t.end_date)}</small>` : ''}</span>
        <span class="link-check" aria-hidden="true">›</span>
      </button>`;
    }).join('');
    destDialog.showModal();
  }

  $('#destList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dest-pick]');
    if (!b) return;
    const loc = findItem(+b.dataset.destPick);
    b.disabled = true;
    try {
      await syncTrip(loc, { start_date: destCtx.start, end_date: destCtx.end });
      destDialog.close();
      toast(`Datum gezet voor ${shortName(loc.title)} ✓`);
      location.hash = `#pin-${loc.id}`;
    } catch (err) { b.disabled = false; toast(err.message, true); }
  });

  $('#destNoMap').addEventListener('click', () => {
    destDialog.close();
    openTripDialog(null, { start_date: destCtx.start, end_date: destCtx.end });
  });

  /* ---------- stemronde: samen kiezen, te delen via WhatsApp ---------- */

  const findPoll = (slug) => state.polls.find((p) => p.slug === slug) || null;
  const pollUrl = (p) => `${location.origin}/stem/${p.slug}`;
  const openPolls = () => state.polls.filter((p) => !p.is_closed);

  function pollFromHash() {
    const m = /^#stem-([\w]+)$/.exec(location.hash);
    return m ? findPoll(m[1]) : null;
  }

  // Een gedeelde link /stem/abc opent de app op de stempagina.
  (() => {
    const m = /^\/stem\/([\w]+)\/?$/.exec(location.pathname);
    if (m) history.replaceState(null, '', `/#stem-${m[1]}`);
  })();

  function tallyOf(poll) {
    const rows = poll.item_ids.map(findItem).filter(Boolean).map((it) => ({
      it,
      voters: poll.votes.filter((v) => v.item_id === it.id).map((v) => v.name),
    }));
    return rows.sort((a, b) => b.voters.length - a.voters.length || pinNumber(a.it.id) - pinNumber(b.it.id));
  }

  function daysLeft(poll) {
    if (!poll.closes_at) return null;
    return dayCount(todayIso(), poll.closes_at) - 1;
  }

  function deadlineText(poll) {
    if (poll.is_closed) return 'Gesloten';
    if (!poll.closes_at) return 'Loopt tot iemand hem sluit';
    const d = daysLeft(poll);
    const left = d <= 0 ? 'laatste dag' : d === 1 ? 'nog 1 dag' : `nog ${d} dagen`;
    return `Stemmen kan t/m ${fmtShort(poll.closes_at)} · ${left}`;
  }

  // Iedereen die we kennen uit de app: datumprikker, voorstellen en eerdere stemrondes.
  function knownPeople() {
    const names = new Set();
    for (const a of state.availability) names.add(a.name);
    for (const s of state.sections) for (const it of s.items) if (it.added_by) names.add(it.added_by);
    for (const t of state.trips) if (t.added_by) names.add(t.added_by);
    for (const p of state.polls) {
      for (const v of p.votes) names.add(v.name);
      for (const n of p.participants) names.add(n);
    }
    const me = store.get('name').trim();
    if (me) names.add(me);
    return [...names].map((n) => n.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'nl'));
  }

  function notVoted(poll) {
    const voted = new Set(poll.votes.map((v) => v.name.toLowerCase()));
    return poll.participants.filter((n) => !voted.has(n.toLowerCase()));
  }

  const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
  const listOr = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} of ${names[names.length - 1]}` : names.join(''));

  function inviteText(poll) {
    const names = tallyOf(poll).map((r) => shortName(r.it.title));
    return `🗳️ *${poll.title}*\nStem mee: ${listOr(names)}?\n${poll.closes_at ? `Stemmen kan t/m ${fmtShort(poll.closes_at)}.\n` : ''}👉 ${pollUrl(poll)}`;
  }

  function reminderText(poll) {
    const missing = notVoted(poll);
    const d = daysLeft(poll);
    const when = d == null ? '' : d <= 0 ? ' Vandaag is de laatste dag!' : ` Nog ${d === 1 ? '1 dag' : `${d} dagen`} (t/m ${fmtShort(poll.closes_at)}).`;
    return `⏰ Herinnering: stem mee over *${poll.title}*!${when}\n${missing.length ? `Nog niet gestemd: ${missing.join(', ')}\n` : ''}👉 ${pollUrl(poll)}`;
  }

  function resultText(poll) {
    const rows = tallyOf(poll);
    const total = poll.votes.length;
    const head = poll.is_closed && rows[0] && rows[0].voters.length
      ? `🏆 Uitslag *${poll.title}*: ${shortName(rows[0].it.title)} wint!`
      : `📊 Tussenstand *${poll.title}* (${total} ${total === 1 ? 'stem' : 'stemmen'})`;
    const lines = rows.map((r, i) => `${i + 1}. ${shortName(r.it.title)}: ${r.voters.length} ${r.voters.length === 1 ? 'stem' : 'stemmen'}`);
    return `${head}\n${lines.join('\n')}\n👉 ${pollUrl(poll)}`;
  }

  function shareButtonsHtml(poll, kind) {
    const text = kind === 'reminder' ? reminderText(poll) : kind === 'result' ? resultText(poll) : inviteText(poll);
    const label = { invite: 'Deel via WhatsApp', reminder: 'Stuur herinnering via WhatsApp', result: poll.is_closed ? 'Deel de uitslag via WhatsApp' : 'Deel de tussenstand via WhatsApp' }[kind];
    return `<a class="btn wa" href="${esc(waLink(text))}" target="_blank" rel="noopener">${WA_ICON}<span>${label}</span></a>`;
  }

  const WA_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3Z"/></svg>';

  /* --- pagina's --- */

  function stemHtml() {
    const poll = pollFromHash();
    if (poll) return pollPageHtml(poll);
    const polls = state.polls;
    const canMake = locations().length >= 2;
    return `
      <div class="section-head">
        <h2>Stemmen</h2>
        <p class="section-intro">Laat de groep kiezen tussen bestemmingen. Deel de stemronde in de WhatsApp-groep; de link toont meteen een voorbeeld met de keuzes.</p>
      </div>
      ${canMake ? `<button type="button" class="add-cta" data-action="new-poll"><span class="add-cta-plus" aria-hidden="true">🗳️</span><span>Nieuwe stemronde</span></button>`
        : `<p class="hint">Zet eerst minstens twee bestemmingen op de <a href="#kaart">kaart</a>, dan kun je de groep laten kiezen.</p>`}
      ${polls.length ? `<ul class="poll-list">${polls.map((p) => {
        const rows = tallyOf(p);
        const lead = rows[0] && rows[0].voters.length ? rows[0] : null;
        return `<li><a class="poll-row${p.is_closed ? ' closed' : ''}" href="#stem-${esc(p.slug)}">
          <span class="poll-row-main">
            <strong>${esc(p.title)}</strong>
            <small>${esc(deadlineText(p))} · ${p.votes.length} ${p.votes.length === 1 ? 'stem' : 'stemmen'}</small>
          </span>
          ${lead ? `<span class="poll-lead">${p.is_closed ? '🏆' : '↑'} ${esc(shortName(lead.it.title))}</span>` : ''}
          <span class="dest-go" aria-hidden="true">›</span>
        </a></li>`;
      }).join('')}</ul>` : ''}`;
  }

  function optionMetaHtml(loc) {
    const p = planOf(loc);
    const bits = [];
    if (p.trip && p.trip.start_date) bits.push(`📅 ${shortRange(p.trip.start_date, p.trip.end_date)}`);
    const flight = p.per.flight.find(({ it }) => it.price);
    const stay = p.per.stay.find(({ it }) => it.price);
    if (flight) bits.push(`✈️ ${esc(flight.it.price)}`);
    if (stay) bits.push(`🏨 ${esc(stay.it.price)}`);
    return bits.length ? `<span class="option-meta">${bits.join(' · ')}</span>` : '';
  }

  function pollPageHtml(poll) {
    const me = store.get('name').trim();
    const mine = poll.votes.find((v) => v.name.toLowerCase() === me.toLowerCase());
    const rows = tallyOf(poll);
    const total = poll.votes.length;
    const max = Math.max(1, ...rows.map((r) => r.voters.length));
    const missing = notVoted(poll);
    const winner = poll.is_closed && rows[0] && rows[0].voters.length ? rows[0] : null;
    return `
      <a class="back-link" href="#stem">← Alle stemrondes</a>
      <div class="section-head">
        <span class="plan-kicker">${poll.is_closed ? 'Uitslag stemronde' : 'Stemronde'}</span>
        <h2>${esc(poll.title)}</h2>
        <p class="section-intro">${esc(deadlineText(poll))} · ${total} ${total === 1 ? 'stem' : 'stemmen'}${poll.created_by ? ` · gestart door ${esc(poll.created_by)}` : ''}</p>
      </div>

      ${winner ? `<div class="winner">
        <span class="winner-cup" aria-hidden="true">🏆</span>
        <span><small>Gekozen</small><strong>${esc(winner.it.title)}</strong></span>
        <a class="btn sm" href="#pin-${winner.it.id}">Verder plannen op de kaart →</a>
      </div>` : ''}

      ${!poll.is_closed ? `
        <label class="poll-name">Jouw naam
          <input id="voteName" value="${esc(me)}" maxlength="40" autocomplete="given-name" placeholder="Naam" list="peopleList">
          <datalist id="peopleList">${poll.participants.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        </label>
        <p class="hint">${mine ? `Je stemde op <strong>${esc(shortName(findItem(mine.item_id)?.title))}</strong>. Tik op een andere bestemming om je stem te wijzigen.` : 'Tik op de bestemming waar jij heen wilt.'}</p>` : ''}

      <div class="options" role="radiogroup" aria-label="Bestemmingen">
        ${rows.map((r, i) => {
          const on = mine && mine.item_id === r.it.id;
          const img = safeUrl(r.it.image);
          const lead = total && i === 0 && r.voters.length;
          return `<div class="option${on ? ' on' : ''}${poll.is_closed ? ' closed' : ''}${lead ? ' lead' : ''}">
            <button type="button" class="option-main" role="radio" aria-checked="${!!on}" data-vote="${r.it.id}"${poll.is_closed ? ' disabled' : ''}>
              <span class="option-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}<span class="dest-num">${pinNumber(r.it.id)}</span></span>
              <span class="option-text">
                <strong>${esc(r.it.title)}</strong>
                ${optionMetaHtml(r.it)}
                <span class="bar" aria-hidden="true"><span style="width:${Math.round(r.voters.length / max * 100)}%"></span></span>
                <small>${r.voters.length} ${r.voters.length === 1 ? 'stem' : 'stemmen'}${r.voters.length ? `: ${r.voters.map(esc).join(', ')}` : ''}</small>
              </span>
              ${!poll.is_closed ? `<span class="option-check" aria-hidden="true">${on ? '✓' : ''}</span>` : ''}
            </button>
            <a class="option-map" href="#pin-${r.it.id}">Bekijk op de kaart</a>
          </div>`;
        }).join('')}
      </div>

      <div class="label">Delen</div>
      <div class="share-grid">
        ${!poll.is_closed ? `
          <div class="share-card">
            <strong>Uitnodigen</strong>
            <p>Stuur de stemronde naar de groep. WhatsApp laat een voorbeeld met de keuzes zien.</p>
            ${shareButtonsHtml(poll, 'invite')}
            <button type="button" class="btn sm ghost" data-copy="${esc(pollUrl(poll))}">Link kopiëren</button>
          </div>
          <div class="share-card">
            <strong>Herinneren</strong>
            ${poll.participants.length
              ? (missing.length ? `<p>Nog niet gestemd: <span class="missing">${missing.map((n) => `<span class="chip part">${esc(n)}</span>`).join(' ')}</span></p>` : '<p>✓ Iedereen heeft gestemd.</p>')
              : '<p>Voeg deelnemers toe (via Aanpassen) om te zien wie nog niet stemde.</p>'}
            ${missing.length || !poll.participants.length ? shareButtonsHtml(poll, 'reminder') : ''}
          </div>` : ''}
        <div class="share-card">
          <strong>${poll.is_closed ? 'Uitslag' : 'Tussenstand'}</strong>
          <p>${total ? rows.slice(0, 3).map((r, i) => `${i + 1}. ${esc(shortName(r.it.title))} (${r.voters.length})`).join(' · ') : 'Nog geen stemmen.'}</p>
          ${total ? shareButtonsHtml(poll, 'result') : ''}
        </div>
      </div>

      <div class="poll-admin">
        <button type="button" class="btn sm" data-action="edit-poll-round" data-slug="${esc(poll.slug)}">Aanpassen</button>
        <button type="button" class="btn sm" data-action="toggle-poll" data-slug="${esc(poll.slug)}">${poll.is_closed ? 'Weer openen' : 'Stemronde sluiten'}</button>
        <button type="button" class="btn sm ghost danger" data-action="delete-poll" data-slug="${esc(poll.slug)}">Verwijderen</button>
      </div>`;
  }

  // Op de kaart: een open stemronde waarop jij nog niet stemde valt meteen op.
  function pollBannerHtml() {
    const me = store.get('name').trim().toLowerCase();
    const p = openPolls().find((x) => !me || !x.votes.some((v) => v.name.toLowerCase() === me));
    if (!p) return '';
    return `<a class="vote-strip" href="#stem-${esc(p.slug)}">
      <span class="when-icon" aria-hidden="true">🗳️</span>
      <span><strong>Stem mee: ${esc(p.title)}</strong><small>${esc(deadlineText(p))} · ${p.votes.length} ${p.votes.length === 1 ? 'stem' : 'stemmen'}</small></span>
      <span class="when-go" aria-hidden="true">→</span></a>`;
  }

  /* --- stemmen --- */

  document.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Link gekopieerd ✓'); } catch { toast(copy.dataset.copy); }
      return;
    }
    const btn = e.target.closest('[data-vote]');
    if (!btn || btn.disabled) return;
    const poll = pollFromHash();
    const input = $('#voteName');
    const name = (input ? input.value : store.get('name')).trim();
    if (!poll) return;
    if (!name) {
      toast('Vul eerst je naam in', true);
      if (input) input.focus();
      return;
    }
    store.set('name', name);
    const itemId = +btn.dataset.vote;
    const mine = poll.votes.find((v) => v.name.toLowerCase() === name.toLowerCase());
    const undo = mine && mine.item_id === itemId;
    btn.disabled = true;
    try {
      await api(`/polls/${poll.id}/vote`, 'PUT', { name: mine ? mine.name : name, item_id: undo ? null : itemId });
      await reload();
      toast(undo ? 'Stem ingetrokken' : `Gestemd op ${shortName(findItem(itemId).title)} ✓`);
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'voteName') {
      store.set('name', e.target.value.trim());
      renderPanel();
    }
  });

  Object.assign(actions, {
    'new-poll': () => openPollRoundDialog(null),
    'edit-poll-round': (btn) => openPollRoundDialog(findPoll(btn.dataset.slug)),
    async 'toggle-poll'(btn) {
      const poll = findPoll(btn.dataset.slug);
      const closing = !poll.is_closed;
      if (closing && !confirm('Stemronde sluiten? Daarna kan niemand meer stemmen.')) return;
      // Weer openen van een ronde waarvan de sluitdatum voorbij is: sluitdatum vervalt.
      const body = closing ? { closed: true } : { closed: false, ...(poll.closes_at && poll.closes_at < todayIso() ? { closes_at: '' } : {}) };
      await api(`/polls/${poll.id}`, 'PUT', body);
      await reload();
      const fresh = findPoll(poll.slug);
      const rows = tallyOf(fresh);
      // De winnaar wordt de beste keuze op de kaart (rode pin).
      if (closing && rows[0] && rows[0].voters.length && (!rows[1] || rows[1].voters.length < rows[0].voters.length) && !rows[0].it.is_best) {
        await api(`/items/${rows[0].it.id}/best`, 'PUT');
        await reload();
        toast(`${shortName(rows[0].it.title)} wint en is nu de beste keuze ✓`);
      } else toast(closing ? 'Stemronde gesloten' : 'Stemronde weer open');
    },
    async 'delete-poll'(btn) {
      const poll = findPoll(btn.dataset.slug);
      if (!confirm(`Stemronde "${poll.title}" met ${poll.votes.length} stemmen verwijderen?`)) return;
      await api(`/polls/${poll.id}`, 'DELETE');
      location.hash = '#stem';
      await reload();
      toast('Verwijderd');
    },
  });

  /* --- aanmaken en aanpassen --- */

  const pollRoundDialog = $('#pollRoundDialog');
  const pollRoundForm = $('#pollRoundForm');
  let pollRoundCtx = null;

  function openPollRoundDialog(poll) {
    pollRoundCtx = poll;
    const f = pollRoundForm.elements;
    $('#pollRoundTitle').textContent = poll ? 'Stemronde aanpassen' : 'Nieuwe stemronde';
    f.title.value = poll ? poll.title : 'Waar gaan we heen?';
    f.closes_at.value = poll ? poll.closes_at || '' : addDays(todayIso(), 7);
    f.participants.value = (poll ? poll.participants : knownPeople()).join('\n');
    const chosen = poll ? poll.item_ids : locations().map((l) => l.id);
    $('#pollRoundOptions').innerHTML = locations().map((l) => `
      <label class="pick"><input type="checkbox" name="item" value="${l.id}"${chosen.includes(l.id) ? ' checked' : ''}>
        <span>${pinNumber(l.id)}. ${esc(l.title)}</span></label>`).join('');
    pollRoundDialog.showModal();
  }

  pollRoundForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = pollRoundForm.elements;
    const data = {
      title: f.title.value.trim(),
      closes_at: f.closes_at.value,
      participants: f.participants.value,
      item_ids: $$('input[name="item"]:checked', pollRoundForm).map((el) => +el.value),
      created_by: store.get('name'),
    };
    if (data.item_ids.length < 2) { toast('Kies minstens twee bestemmingen', true); return; }
    try {
      let slug = pollRoundCtx && pollRoundCtx.slug;
      if (pollRoundCtx) await api(`/polls/${pollRoundCtx.id}`, 'PUT', data);
      else slug = (await api('/polls', 'POST', data)).slug;
      pollRoundDialog.close();
      await reload();
      location.hash = `#stem-${slug}`;
      toast(pollRoundCtx ? 'Opgeslagen ✓' : 'Stemronde klaar. Deel hem in de groep! ✓');
    } catch (err) { toast(err.message, true); }
  });

  // Periode van de datumprikker
  const pollDialog = $('#pollDialog');
  const pollForm = $('#pollForm');

  function openPollDialog() {
    const cfg = pollSettings();
    pollForm.elements.poll_start.value = cfg.start;
    pollForm.elements.poll_end.value = cfg.end;
    pollForm.elements.trip_days.value = cfg.days;
    pollDialog.showModal();
  }

  pollForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = pollForm.elements;
    let [start, end] = [f.poll_start.value, f.poll_end.value];
    if (start && end && end < start) [start, end] = [end, start];
    try {
      await api('/settings', 'PUT', { poll_start: start, poll_end: end, trip_days: f.trip_days.value });
      pollDialog.close();
      await reload();
      toast('Opgeslagen ✓');
    } catch (err) { toast(err.message, true); }
  });

  // Reis
  const tripDialog = $('#tripDialog');
  const tripForm = $('#tripForm');
  let tripCtx = null;

  function openTripDialog(trip, preset = {}) {
    tripCtx = trip;
    tripForm.elements.start_date.value = trip ? trip.start_date || '' : preset.start_date || '';
    tripForm.elements.end_date.value = trip ? trip.end_date || '' : preset.end_date || '';
    updateTripWarning();
    $('#tripDialogTitle').textContent = trip ? 'Reis aanpassen' : 'Stel een reis voor';
    tripForm.elements.title.value = trip ? trip.title : '';
    tripForm.elements.note.value = trip ? trip.note || '' : '';
    tripForm.elements.added_by.value = trip ? trip.added_by || '' : store.get('name');
    const chosen = trip ? trip.item_ids : [];
    const sections = state.sections.filter((s) => s.items.length);
    // Per tab een lijstje om aan te vinken; een reis kan meerdere activiteiten of restaurants hebben.
    $('#tripPicks').innerHTML = sections.length ? sections.map((s) => {
      const items = sortedItems(s).sort((a, b) => chosen.includes(b.id) - chosen.includes(a.id));
      return `<fieldset class="pick-group">
        <legend>${esc(s.kind === 'map' ? '📍' : s.icon)} ${esc(s.kind === 'map' ? 'Bestemming' : s.title)}</legend>
        ${items.map((it) => {
          const loc = it.location_id && findItem(it.location_id);
          return `<label class="pick"><input type="checkbox" data-pick value="${it.id}"${chosen.includes(it.id) ? ' checked' : ''}>
            <span>${esc(it.title)}${s.show_price && it.price ? ` <span class="price">${esc(it.price)}</span>` : ''}${loc ? `<small>bij ${esc(shortName(loc.title))}</small>` : ''}</span></label>`;
        }).join('')}
      </fieldset>`;
    }).join('')
      : '<p class="hint">Voeg eerst een bestemming toe op de kaart, dan kun je die hier kiezen.</p>';
    $('#tripDelete').hidden = !trip;
    tripDialog.showModal();
    if (!trip) setTimeout(() => tripForm.elements.title.focus(), 50);
  }

  // Live waarschuwing in het reisvenster als iemand niet kan op de gekozen datums.
  function updateTripWarning() {
    const start = tripForm.elements.start_date.value;
    const end = tripForm.elements.end_date.value || start;
    const el = $('#tripDateWarn');
    const c = start ? conflictsOf({ start_date: start <= end ? start : end, end_date: start <= end ? end : start }) : null;
    el.hidden = !c || (!c.length && !availabilityMap().size);
    if (!c) return;
    el.className = c.length ? 'date-warn conflict' : 'date-warn ok';
    el.innerHTML = c.length ? `<strong>Kan niet:</strong> ${conflictText(c)}` : '✓ Iedereen kan op deze datums';
  }
  tripForm.elements.start_date.addEventListener('change', () => {
    const f = tripForm.elements;
    if (f.start_date.value && (!f.end_date.value || f.end_date.value < f.start_date.value)) {
      f.end_date.value = addDays(f.start_date.value, pollSettings().days - 1);
    }
    updateTripWarning();
  });
  tripForm.elements.end_date.addEventListener('change', updateTripWarning);

  tripForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      title: tripForm.elements.title.value.trim(),
      note: tripForm.elements.note.value.trim(),
      added_by: tripForm.elements.added_by.value.trim(),
      item_ids: $$('[data-pick]:checked', tripForm).map((el) => +el.value).filter(Boolean),
      start_date: tripForm.elements.start_date.value,
      end_date: tripForm.elements.end_date.value,
    };
    if (data.added_by) store.set('name', data.added_by);
    try {
      if (tripCtx) await api(`/trips/${tripCtx.id}`, 'PUT', data);
      else await api('/trips', 'POST', data);
      const isNew = !tripCtx;
      tripDialog.close();
      await reload();
      toast(isNew ? 'Reis voorgesteld, bedankt! ✓' : 'Opgeslagen ✓');
    } catch (err) { toast(err.message, true); }
  });

  $('#tripDelete').addEventListener('click', async () => {
    if (!tripCtx || !confirm(`Reis "${tripCtx.title}" verwijderen?`)) return;
    try {
      await api(`/trips/${tripCtx.id}`, 'DELETE');
      tripDialog.close();
      await reload();
      toast('Verwijderd');
    } catch (err) { toast(err.message, true); }
  });

  // Tab
  const sectionDialog = $('#sectionDialog');
  const sectionForm = $('#sectionForm');
  let sectionCtx = null;

  function openSectionDialog(section) {
    sectionCtx = section;
    $('#sectionDialogTitle').textContent = section ? 'Tab aanpassen' : 'Nieuwe tab';
    sectionForm.elements.icon.value = section ? section.icon || '' : '';
    sectionForm.elements.title.value = section ? section.title : '';
    sectionForm.elements.intro.value = section ? section.intro || '' : '';
    sectionForm.elements.show_price.checked = !!(section && section.show_price);
    sectionForm.elements.kind.value = section ? section.kind || '' : '';
    $('#sectionExtra').hidden = !section;
    if (section) {
      const idx = state.sections.indexOf(section);
      $('#sectionLeft').disabled = idx === 0;
      $('#sectionRight').disabled = idx === state.sections.length - 1;
    }
    sectionDialog.showModal();
    if (!section) setTimeout(() => sectionForm.elements.title.focus(), 50);
  }

  sectionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      icon: sectionForm.elements.icon.value.trim() || '⭐',
      title: sectionForm.elements.title.value.trim(),
      intro: sectionForm.elements.intro.value.trim(),
      show_price: sectionForm.elements.show_price.checked,
      kind: sectionForm.elements.kind.value,
    };
    try {
      let id = sectionCtx && sectionCtx.id;
      if (id) await api(`/sections/${id}`, 'PUT', data);
      else id = (await api('/sections', 'POST', data)).id;
      sectionDialog.close();
      await reload();
      location.hash = '#tab-' + id;
      toast('Opgeslagen ✓');
    } catch (err) { toast(err.message, true); }
  });

  async function moveSection(dir) {
    const ids = state.sections.map((s) => s.id);
    const i = ids.indexOf(sectionCtx.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api('/sections/reorder', 'PUT', { ids });
      await reload();
      sectionCtx = findSection(sectionCtx.id);
      $('#sectionLeft').disabled = j === 0;
      $('#sectionRight').disabled = j === ids.length - 1;
    } catch (err) { toast(err.message, true); }
  }
  $('#sectionLeft').addEventListener('click', () => moveSection(-1));
  $('#sectionRight').addEventListener('click', () => moveSection(1));

  $('#sectionDelete').addEventListener('click', async () => {
    const s = sectionCtx;
    const n = s.items.length;
    if (!confirm(`Tab "${s.title}"${n ? ` en alles wat erin staat (${n})` : ''} verwijderen?`)) return;
    try {
      await api(`/sections/${s.id}`, 'DELETE');
      sectionDialog.close();
      history.replaceState(null, '', location.pathname);
      await reload();
      toast('Tab verwijderd');
    } catch (err) { toast(err.message, true); }
  });

  // Titel
  const siteDialog = $('#siteDialog');
  const siteForm = $('#siteForm');

  function openSiteDialog() {
    siteForm.elements.site_title.value = state.settings.site_title || '';
    siteDialog.showModal();
    setTimeout(() => siteForm.elements.site_title.focus(), 50);
  }

  siteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/settings', 'PUT', { site_title: siteForm.elements.site_title.value.trim() });
      siteDialog.close();
      await reload();
      toast('Opgeslagen ✓');
    } catch (err) { toast(err.message, true); }
  });

  // Afbeelding kiezen
  const imageDialog = $('#imageDialog');
  let onImagePicked = null;

  function openImageDialog(callback) {
    onImagePicked = callback;
    $('#imageUrl').value = '';
    $('#imageFile').value = '';
    imageDialog.showModal();
  }

  function pickImage(url) {
    onImagePicked(url);
    imageDialog.close();
  }

  // Verklein foto's in de browser zodat uploads vanaf een telefoon snel gaan.
  function resizeImage(file, max = 1920, quality = 0.85) {
    return new Promise((resolve, reject) => {
      if (file.type === 'image/gif') {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Kon afbeelding niet lezen')); };
      img.src = url;
    });
  }

  $('#imageFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast('Uploaden…');
    try {
      const data = await resizeImage(file);
      const { url } = await api('/upload', 'POST', { data });
      pickImage(url);
    } catch (err) { toast(err.message, true); }
  });

  $('#imageUrlSave').addEventListener('click', () => {
    const url = safeUrl($('#imageUrl').value.trim());
    if (!url) { toast('Ongeldige link', true); return; }
    pickImage(url);
  });

  $('#imageRemove').addEventListener('click', () => pickImage(''));

  /* ---------- init ---------- */

  reload().catch((err) => {
    $('#panel').innerHTML = `<div class="empty">Kon de inhoud niet laden: ${esc(err.message)}</div>`;
  });
})();
