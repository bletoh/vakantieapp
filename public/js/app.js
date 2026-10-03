(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = { settings: {}, sections: [], trips: [], availability: [] };

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
  function toast(msg, isError = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  const store = {
    get(key, fallback = '') {
      try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* ignore */ }
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

  const findSection = (id) => state.sections.find((s) => s.id === id);
  const findItem = (id) => {
    for (const s of state.sections) {
      const it = s.items.find((i) => i.id === id);
      if (it) return it;
    }
    return null;
  };
  const sectionsOfKind = (kind) => state.sections.filter((s) => s.kind === kind);
  const linkedTo = (locId) => state.sections
    .filter((s) => s.kind !== 'map')
    .flatMap((s) => s.items.filter((i) => i.location_id === locId).map((it) => ({ s, it })));
  const locations = () => sectionsOfKind('map').flatMap((s) => sortedItems(s));
  const sortedItems = (s) => [...s.items].sort((a, b) => a.position - b.position || a.id - b.id);

  async function reload() {
    const data = await api('/content');
    state.settings = data.settings;
    state.sections = data.sections;
    state.trips = data.trips || [];
    state.availability = data.availability || [];
    render();
    if (pinCtx && pinDialog.open) renderPinSheet();
  }

  /* ---------- routing ---------- */

  function currentRoute() {
    if (location.hash === '#reizen') return 'reizen';
    if (location.hash === '#datum') return 'datum';
    const m = /^#tab-(\d+)$/.exec(location.hash);
    if (m && findSection(+m[1])) return +m[1];
    const first = state.sections.find((s) => s.kind !== 'flight' && s.kind !== 'stay') || state.sections[0];
    return first ? first.id : null;
  }

  window.addEventListener('hashchange', () => {
    renderTabs();
    renderPanel();
    const tabsTop = $('#tabs').getBoundingClientRect().top + window.scrollY;
    if (window.scrollY > tabsTop) window.scrollTo({ top: tabsTop, behavior: 'smooth' });
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

  function renderTabs() {
    const route = currentRoute();
    const nav = $('#tabs');
    // Vluchten en overnachtingen beheer je via de pinnen op de kaart; die tabs tonen we niet.
    const hasMap = sectionsOfKind('map').length > 0;
    const visible = state.sections.filter((s) => !(hasMap && (s.kind === 'flight' || s.kind === 'stay')));
    nav.innerHTML = visible.map((s) => {
      const active = route === s.id;
      return `<a class="tab${active ? ' active' : ''}" href="#tab-${s.id}"${active ? ' aria-current="page"' : ''}>${esc(s.title)}</a>`;
    }).join('')
      + `<a class="tab${route === 'datum' ? ' active' : ''}" href="#datum"${route === 'datum' ? ' aria-current="page"' : ''}>Datum</a>`
      + `<a class="tab trips-tab${route === 'reizen' ? ' active' : ''}" href="#reizen"${route === 'reizen' ? ' aria-current="page"' : ''}>`
      + 'Reizen</a>'
      + '<button type="button" class="tab add" data-action="add-section" aria-label="Tab toevoegen">＋</button>';
    const active = $('.tab.active', nav);
    if (active) {
      const left = active.offsetLeft - nav.clientWidth / 2 + active.clientWidth / 2;
      nav.scrollTo({ left, behavior: 'smooth' });
    }
  }

  function renderPanel() {
    const route = currentRoute();
    if (route === 'reizen') { unmountMap(); $('#panel').innerHTML = tripsHtml(); return; }
    if (route === 'datum') { unmountMap(); $('#panel').innerHTML = pollHtml(); return; }
    const s = findSection(route);
    unmountMap();
    $('#panel').innerHTML = s ? sectionHtml(s) : `
      <div class="empty">
        <p>Er zijn nog geen tabs.</p>
        <button type="button" class="btn primary" data-action="add-section">＋ Tab toevoegen</button>
      </div>`;
    if (s && s.kind === 'map') mountMap(s);
  }

  function sectionHtml(s) {
    const items = sortedItems(s);
    const best = items.find((i) => i.is_best);
    const others = items.filter((i) => i !== best);

    return `
      <div class="section-head">
        <h2>
          <span aria-hidden="true">${esc(s.icon)}</span>${esc(s.title)}
          <button type="button" class="text-btn" data-action="edit-section" data-id="${s.id}">Tab bewerken</button>
        </h2>
        ${s.intro ? `<p class="section-intro">${esc(s.intro)}</p>` : ''}
      </div>
      ${s.kind === 'map' ? `
        <div class="map-wrap">
          <div id="map" class="map" aria-label="Kaart"></div>
          <div class="map-hint">Tik op de kaart om een pin te prikken, tik op een pin voor vluchten en hotels</div>
        </div>` : ''}
      <button type="button" class="add-cta" data-action="add-item" data-id="${s.id}">
        <span class="add-cta-plus" aria-hidden="true">＋</span>
        <span>${esc(addLabel(s))}</span>
      </button>
      ${best ? cardHtml(best, s, true) : ''}
      ${others.length ? `
        <div class="label">${best ? 'Andere opties' : 'Opties'}</div>
        <div class="grid">${others.map((i) => cardHtml(i, s, false)).join('')}</div>` : ''}
      ${!items.length ? '<div class="empty"><p>Nog niets toegevoegd. Wees de eerste!</p></div>' : ''}
      ${s.kind === 'map' ? unlinkedHtml() : ''}`;
  }

  // Vluchten en overnachtingen die nog niet aan een pin hangen, zodat ze niet zoekraken.
  function unlinkedHtml() {
    const rest = state.sections
      .filter((s) => s.kind === 'flight' || s.kind === 'stay')
      .flatMap((s) => sortedItems(s).filter((it) => !it.location_id || !findItem(it.location_id)).map((it) => ({ s, it })));
    if (!rest.length) return '';
    return `
      <div class="label">Nog niet aan een pin gekoppeld</div>
      <div class="grid">${rest.map(({ s, it }) => cardHtml(it, s, false)).join('')}</div>`;
  }

  // Koppelingen tussen een locatie (pin) en vluchten/overnachtingen, als kleine chips.
  function linkChipsHtml(it, s) {
    if (s.kind === 'map') {
      const links = linkedTo(it.id);
      const pin = it.lat != null ? `<button type="button" class="chip" data-action="open-pin" data-id="${it.id}">📍 Op de kaart · vluchten en hotels</button>` : '';
      if (!links.length && !pin) return '';
      return `<div class="chips">${pin}</div>${links.length ? `<ul class="linked">${links.map(({ s: ls, it: li }) => `
        <li><button type="button" data-action="edit-item" data-id="${li.id}">
          <span aria-hidden="true">${esc(ls.icon)}</span><span>${esc(li.title)}</span>
          ${ls.show_price && li.price ? `<span class="price">${esc(li.price)}</span>` : ''}
        </button></li>`).join('')}</ul>` : ''}`;
    }
    const loc = it.location_id && findItem(it.location_id);
    if (!loc) return '';
    return `<div class="chips"><button type="button" class="chip" data-action="open-pin" data-id="${loc.id}">📍 ${esc(loc.title)}</button></div>`;
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
          ${linkChipsHtml(it, s)}
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
      + `<span class="heart">${on ? '♥' : '♡'}</span><span class="count">${likes || 0}</span></button>`;
  }

  function tripsHtml() {
    const trips = [...state.trips].sort((a, b) => b.likes - a.likes || a.id - b.id);
    return `
      <div class="section-head">
        <h2>Reizen</h2>
        <p class="section-intro">Combineer suggesties uit de andere tabs, zoals een locatie, vlucht en overnachting, tot één reis.</p>
      </div>
      <button type="button" class="add-cta" data-action="add-trip">
        <span class="add-cta-plus" aria-hidden="true">＋</span>
        <span>Stel een reis voor</span>
      </button>
      ${trips.length ? `<div class="grid">${trips.map(tripCardHtml).join('')}</div>`
        : '<div class="empty"><p>Nog geen reizen voorgesteld. Wees de eerste!</p></div>'}`;
  }

  function tripCardHtml(t) {
    const picks = [];
    for (const s of state.sections) {
      for (const it of s.items) if (t.item_ids.includes(it.id)) picks.push({ s, it });
    }
    return `
      <article class="card trip${conflictsOf(t)?.length ? ' conflict' : ''}" data-trip="${t.id}" tabindex="0" aria-label="${esc(t.title)} aanpassen">
        <div class="card-body">
          <span class="card-hint" aria-hidden="true">Aanpassen</span>
          <h3 class="card-title">${esc(t.title)}</h3>
          ${t.added_by ? `<div class="added-by">Voorgesteld door ${esc(t.added_by)}</div>` : ''}
          ${tripDatesHtml(t)}
          ${picks.length ? `<ul class="trip-picks">${picks.map(({ s, it }) => `
            <li><a class="trip-pick" href="#tab-${s.id}">
              <span class="trip-pick-icon" aria-hidden="true">${esc(s.icon)}</span>
              <span class="trip-pick-text"><small>${esc(s.title)}</small>${esc(it.title)}
                ${s.show_price && it.price ? `<span class="price">${esc(it.price)}</span>` : ''}</span>
            </a></li>`).join('')}</ul>` : ''}
          ${t.note ? `<p class="card-text">${esc(t.note)}</p>` : ''}
          <div class="card-foot">${likeBtn('trip', t.id, t.likes)}</div>
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
          <button type="button" class="wk" data-week="${inRange.join(',')}"${inRange.length ? '' : ' disabled'} aria-label="Hele week">${weekNumber(weekStart)}</button>
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
          <h3 class="month-title">${fmt(first, { month: 'long', year: 'numeric' })}</h3>
          <div class="cal">
            <span class="dow"></span>${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((d) => `<span class="dow">${d}</span>`).join('')}
            ${weeks.join('')}
          </div>
        </div>`);
      cursor = next;
    }

    return `
      <div class="section-head">
        <h2>Datum <button type="button" class="text-btn" data-action="edit-poll">Periode instellen</button></h2>
        <p class="section-intro">Vink aan wanneer je kunt. De beste periodes van ${cfg.days} dagen tussen ${fmtShort(cfg.start)} en ${fmtShort(cfg.end)} komen bovenaan.</p>
      </div>

      <label class="poll-name">Jouw naam
        <input id="pollName" value="${esc(me)}" maxlength="40" autocomplete="given-name" placeholder="Naam">
      </label>

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
          <button type="button" class="btn sm" data-action="plan-window" data-start="${w.start}" data-end="${w.end}">Plan reis</button>
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

      <div class="label">Kalender</div>
      <p class="hint">Tik op een dag als je kunt. Tik op het weeknummer voor de hele week. Hoe donkerder, hoe meer mensen kunnen.</p>
      <div class="months">${months.join('')}</div>

      ${people.length ? `
        <div class="label">Ingevuld door</div>
        <ul class="people">${people.map((n) => `
          <li><span>${esc(n)}</span><small>${byName.get(n).size} dagen</small>
            <button type="button" class="text-btn" data-action="remove-person" data-name="${esc(n)}">Verwijderen</button></li>`).join('')}
        </ul>` : ''}`;
  }

  function weekNumber(iso) {
    const d = toDate(iso);
    d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  }

  function pollName() {
    const input = $('#pollName');
    const name = (input ? input.value : store.get('name')).trim();
    if (!name) {
      toast('Vul eerst je naam in', true);
      if (input) input.focus();
      return '';
    }
    store.set('name', name);
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

  document.addEventListener('click', (e) => {
    const day = e.target.closest('[data-day]');
    if (day && !day.disabled) { setAvailable([day.dataset.day], day.getAttribute('aria-pressed') !== 'true'); return; }
    const wk = e.target.closest('[data-week]');
    if (wk && !wk.disabled) {
      const dates = wk.dataset.week.split(',').filter(Boolean);
      const mine = availabilityMap().get(store.get('name').trim()) || new Set();
      setAvailable(dates, !dates.every((d) => mine.has(d)));
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'pollName') {
      store.set('name', e.target.value.trim());
      renderPanel();
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
    'plan-window': (btn) => openTripDialog(null, { start_date: btn.dataset.start, end_date: btn.dataset.end }),
    'edit-poll': () => openPollDialog(),
    async 'remove-person'(btn) {
      const name = btn.dataset.name;
      if (!confirm(`Alle aangevinkte dagen van ${name} verwijderen?`)) return;
      await api(`/availability/${encodeURIComponent(name)}`, 'DELETE');
      await reload();
      toast('Verwijderd');
    },
    'add-item': (btn) => openItemDialog(null, +btn.dataset.id),
    'add-section': () => openSectionDialog(null),
    'edit-section': (btn) => openSectionDialog(findSection(+btn.dataset.id)),
    'edit-site': () => openSiteDialog(),
    'edit-item': (btn) => openItemDialog(findItem(+btn.dataset.id)),
    'open-pin': (btn) => openPinSheet(findItem(+btn.dataset.id)),
    'link-item': (btn) => openLinkDialog(findItem(+btn.dataset.loc), findSection(+btn.dataset.section)),
  };

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn && actions[btn.dataset.action]) {
      btn.disabled = true;
      try { await actions[btn.dataset.action](btn); } catch (err) { toast(err.message, true); }
      if (btn.isConnected) btn.disabled = false;
      return;
    }
    // Tik op een kaart om hem aan te passen.
    if (e.target.closest('a, button, dialog')) return;
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
      // Nieuwe pin op de kaart: meteen vluchten en hotels in de buurt tonen.
      const saved = findItem(id);
      if (isNew && saved && saved.lat != null && findSection(saved.section_id).kind === 'map') openPinSheet(saved);
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
    $('#linkDialogTitle').textContent = `${section.icon} ${section.title} koppelen aan ${loc.title}`;
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
      toast(unlink ? 'Ontkoppeld' : 'Gekoppeld ✓');
      if (!unlink && linkCtx.section.kind === 'flight') flyTo(linkCtx.loc.id);
    } catch (err) { toast(err.message, true); }
  });

  $('#linkNew').addEventListener('click', () => {
    linkDialog.close();
    openItemDialog(null, linkCtx.section.id, { location_id: linkCtx.loc.id });
  });

  /* ---------- kaart ---------- */

  const HOME = [52.3105, 4.7683]; // Schiphol
  let map = null;
  let markers = {};
  let flightLayers = [];

  function unmountMap() {
    if (map) { map.remove(); map = null; }
    markers = {};
    flightLayers = [];
  }

  function pinIcon(item) {
    return L.divIcon({
      className: 'pin-icon',
      html: `<div class="pin${item.is_best ? ' best' : ''}"><span></span></div>`,
      iconSize: [30, 40],
      iconAnchor: [15, 40],
      tooltipAnchor: [0, -38],
      popupAnchor: [0, -38],
    });
  }

  function mountMap(section) {
    const el = $('#map');
    if (!el) return;
    if (!window.L) {
      el.innerHTML = '<div class="map-error">De kaart kon niet geladen worden.</div>';
      return;
    }
    map = L.map(el, { worldCopyJump: true, zoomSnap: 0.5 });
    // Standaardkaart van OpenStreetMap: gratis, geen API-sleutel nodig.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    L.circleMarker(HOME, { radius: 6, color: '#fff', weight: 2, fillColor: '#f97316', fillOpacity: 1 })
      .addTo(map).bindTooltip('🇳🇱 Nederland', { direction: 'top', offset: [0, -6] });

    const pins = sortedItems(section).filter((it) => it.lat != null && it.lng != null);
    for (const it of pins) {
      const m = L.marker([it.lat, it.lng], { icon: pinIcon(it), draggable: true, autoPan: true })
        .addTo(map)
        .bindTooltip(esc(it.title), { permanent: true, interactive: true, direction: 'top', className: 'pin-label' });
      m.on('click', () => { flyTo(it.id); openPinSheet(it); });
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

    // Opgeslagen hotels als kleine stipjes rond hun pin.
    for (const st of sectionsOfKind('stay')) {
      for (const h of st.items) {
        if (h.lat == null || !h.location_id) continue;
        L.circleMarker([h.lat, h.lng], { radius: 5, weight: 2, color: '#fff', fillColor: '#b8412c', fillOpacity: 1 })
          .addTo(map).bindTooltip(esc(h.title), { direction: 'top', offset: [0, -4] })
          .on('click', () => openItemDialog(h));
      }
    }

    if (pins.length) {
      map.fitBounds(L.latLngBounds([HOME, ...pins.map((p) => [p.lat, p.lng])]), { padding: [40, 40], maxZoom: 7 });
    } else {
      map.setView([45, 12], 3.5);
    }

    map.on('click', (e) => addPinAt(section, e.latlng));
    // Na het tekenen (en als de kaart zichtbaar is) de vluchten laten vliegen.
    setTimeout(() => { if (map) { map.invalidateSize(); drawFlights(true); } }, 150);
  }

  // Tik op de kaart: pin direct opslaan en meteen vluchten en hotels tonen.
  // De plaatsnaam wordt op de achtergrond opgezocht en daarna ingevuld.
  let pinning = false;
  async function addPinAt(section, latlng) {
    if (pinning) return;
    pinning = true;
    const { lat, lng } = latlng;
    try {
      const { id } = await api(`/sections/${section.id}/items`, 'POST', {
        title: 'Nieuwe plek', lat, lng, added_by: store.get('name'),
      });
      await reload();
      openPinSheet(findItem(id));
      const name = await placeName(lat, lng);
      if (name && findItem(id) && findItem(id).title === 'Nieuwe plek') {
        await api(`/items/${id}`, 'PUT', { title: name });
        await reload();
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      pinning = false;
    }
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

  function flightLocations() {
    const ids = new Set(sectionsOfKind('flight').flatMap((s) => s.items.map((i) => i.location_id)).filter(Boolean));
    return [...ids].map(findItem).filter((l) => l && l.lat != null && markers[l.id]);
  }

  function drawFlights(animate) {
    if (!map) return;
    flightLayers.forEach((l) => l.remove());
    flightLayers = [];
    flightLocations().forEach((loc, i) => {
      const line = L.polyline(arcPoints(HOME, [loc.lat, loc.lng]), { className: 'flight-line', weight: 2.5, interactive: false }).addTo(map);
      line._locId = loc.id;
      flightLayers.push(line);
      if (animate) setTimeout(() => flyTo(loc.id), i * 600);
    });
  }

  function flyTo(locId) {
    if (!map) return;
    const loc = findItem(locId);
    const hasFlight = sectionsOfKind('flight').some((s) => s.items.some((i) => i.location_id === locId));
    if (!loc || loc.lat == null || !hasFlight) return;
    const pts = arcPoints(HOME, [loc.lat, loc.lng]);
    const plane = L.marker(pts[0], {
      icon: L.divIcon({ className: 'plane-icon', html: `<div class="plane">${PLANE_SVG}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
    const trail = L.polyline([], { className: 'flight-trail', weight: 3, interactive: false }).addTo(map);
    const duration = 2200;
    const start = performance.now();
    const step = (now) => {
      if (!map) return;
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

  /* ---------- pinpaneel: vluchten en hotels in de buurt (gratis, via OpenStreetMap) ---------- */

  const HOME_CODE = 'AMS';
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const overpassCache = new Map();
  const pinDialog = $('#pinDialog');
  let pinCtx = null;

  async function overpass(query) {
    if (overpassCache.has(query)) return overpassCache.get(query);
    let lastErr;
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = (await res.json()).elements || [];
        overpassCache.set(query, data);
        return data;
      } catch (err) { lastErr = err; }
    }
    throw lastErr;
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

  async function findAirports(loc) {
    const q = `[out:json][timeout:25];nwr(around:200000,${loc.lat},${loc.lng})["aeroway"="aerodrome"]["iata"];out center tags;`;
    const els = await overpass(q);
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
    const q = `[out:json][timeout:25];nwr(around:5000,${loc.lat},${loc.lng})["tourism"~"^(hotel|resort|apartment|hostel|guest_house|motel)$"]["name"];out center tags 80;`;
    const els = await overpass(q);
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

  const kmText = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`);

  async function ensureSection(kind, title, icon) {
    const found = sectionsOfKind(kind)[0];
    if (found) return found;
    const { id } = await api('/sections', 'POST', { title, icon, kind, show_price: true });
    await reload();
    return findSection(id);
  }

  function openPinSheet(loc) {
    if (!loc) return;
    pinCtx = { locId: loc.id };
    renderPinSheet();
    if (!pinDialog.open) pinDialog.showModal();
    if (loc.lat == null) return;
    loadPinData('airports', () => findAirports(loc));
    loadPinData('hotels', () => findHotels(loc));
  }

  async function loadPinData(key, fn) {
    const locId = pinCtx.locId;
    pinCtx[key] = 'loading';
    renderPinSheet();
    let result;
    try { result = await fn(); } catch { result = 'error'; }
    if (!pinCtx || pinCtx.locId !== locId) return;
    pinCtx[key] = result;
    renderPinSheet();
  }

  function renderPinSheet() {
    const loc = findItem(pinCtx.locId);
    if (!loc) { pinDialog.close(); return; }
    $('#pinTitle').textContent = loc.title;
    const links = linkedTo(loc.id);
    const titles = new Set(links.map(({ it }) => it.title));
    const status = (v, empty) => (v === 'loading' ? '<p class="hint">Zoeken…</p>'
      : v === 'error' ? '<p class="hint">Kon niet laden. Probeer het later nog eens.</p>'
        : !v || !v.length ? `<p class="hint">${empty}</p>` : '');

    const airports = Array.isArray(pinCtx.airports) ? pinCtx.airports : [];
    const hotels = Array.isArray(pinCtx.hotels) ? pinCtx.hotels : [];

    $('#pinBody').innerHTML = `
      ${links.length ? `
        <section>
          <h3 class="sheet-label">Gekozen</h3>
          <ul class="linked">${links.map(({ s, it }) => `
            <li><button type="button" data-action="edit-item" data-id="${it.id}">
              <span aria-hidden="true">${esc(s.icon)}</span><span>${esc(it.title)}</span>
              ${s.show_price && it.price ? `<span class="price">${esc(it.price)}</span>` : ''}
            </button></li>`).join('')}</ul>
        </section>` : ''}
      ${state.sections.some((s) => s.kind === 'flight' || s.kind === 'stay') ? `
        <div class="pin-actions">${state.sections.filter((s) => s.kind === 'flight' || s.kind === 'stay').map((s) =>
          `<button type="button" class="btn sm" data-action="link-item" data-loc="${loc.id}" data-section="${s.id}">＋ Eigen ${esc(s.title.toLowerCase())} kiezen</button>`).join('')}
        </div>` : ''}
      ${loc.lat == null ? '<p class="hint">Deze locatie staat nog niet op de kaart. Prik een pin om vluchten en hotels te zoeken.</p>' : `
      <section>
        <h3 class="sheet-label">Vluchten vanaf Amsterdam</h3>
        ${status(pinCtx.airports, 'Geen vliegveld gevonden binnen 200 km.')}
        <ul class="results">${airports.map((a, i) => {
          const title = `Amsterdam → ${a.name} (${a.iata})`;
          const added = titles.has(title);
          return `<li class="result">
            <div class="result-main">
              <strong>${HOME_CODE} → ${esc(a.iata)}</strong>
              <span>${esc(a.name)}</span>
              <small>${kmText(a.km)} van de pin · ± ${flightTime(distanceKm(HOME, a.pos))} vliegen</small>
              <span class="result-links">
                <a href="https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${HOME_CODE} to ${a.iata}`)}" target="_blank" rel="noopener">Google Flights ↗</a>
                <a href="https://www.skyscanner.nl/transport/vluchten/${HOME_CODE.toLowerCase()}/${esc(a.iata.toLowerCase())}/" target="_blank" rel="noopener">Skyscanner ↗</a>
              </span>
            </div>
            <button type="button" class="btn sm${added ? ' done' : ''}" data-add-airport="${i}"${added ? ' disabled' : ''}>${added ? '✓ Toegevoegd' : '＋ Toevoegen'}</button>
          </li>`;
        }).join('')}</ul>
        <p class="fineprint">Vliegtijd is een schatting. Prijzen zie je via de links.</p>
      </section>
      <section>
        <h3 class="sheet-label">Hotels in de buurt</h3>
        ${status(pinCtx.hotels, 'Geen hotels gevonden binnen 5 km.')}
        <ul class="results">${hotels.map((h, i) => {
          const added = titles.has(h.name);
          return `<li class="result">
            <div class="result-main">
              <strong>${esc(h.name)}</strong>
              <small>${h.stars ? `${'★'.repeat(h.stars)} · ` : ''}${esc(h.type)} · ${kmText(h.km)}</small>
              <span class="result-links">
                ${h.website ? `<a href="${esc(h.website)}" target="_blank" rel="noopener">Website ↗</a>` : ''}
                <a href="https://www.booking.com/searchresults.nl.html?ss=${encodeURIComponent(`${h.name} ${h.city || loc.title}`)}" target="_blank" rel="noopener">Prijs op Booking ↗</a>
              </span>
            </div>
            <button type="button" class="btn sm${added ? ' done' : ''}" data-add-hotel="${i}"${added ? ' disabled' : ''}>${added ? '✓ Toegevoegd' : '＋ Toevoegen'}</button>
          </li>`;
        }).join('')}</ul>
        <p class="fineprint">Hotelgegevens: © OpenStreetMap-bijdragers.</p>
      </section>`}`;
  }

  $('#pinDelete').addEventListener('click', async () => {
    const loc = findItem(pinCtx.locId);
    if (!loc || !confirm(`Pin "${loc.title}" verwijderen?`)) return;
    try {
      await api(`/items/${loc.id}`, 'DELETE');
      pinDialog.close();
      await reload();
      toast('Pin verwijderd');
    } catch (err) { toast(err.message, true); }
  });

  $('#pinEdit').addEventListener('click', () => {
    const loc = findItem(pinCtx.locId);
    pinDialog.close();
    openItemDialog(loc);
  });

  $('#pinBody').addEventListener('click', async (e) => {
    const aBtn = e.target.closest('[data-add-airport]');
    const hBtn = e.target.closest('[data-add-hotel]');
    if (!aBtn && !hBtn) return;
    const loc = findItem(pinCtx.locId);
    const btn = aBtn || hBtn;
    btn.disabled = true;
    try {
      if (aBtn) {
        const a = pinCtx.airports[+aBtn.dataset.addAirport];
        const section = await ensureSection('flight', 'Vlucht', '✈️');
        await api(`/sections/${section.id}/items`, 'POST', {
          title: `Amsterdam → ${a.name} (${a.iata})`,
          subtitle: `${HOME_CODE} → ${a.iata} · ± ${flightTime(distanceKm(HOME, a.pos))} vliegen`,
          body: `Vliegveld op ${kmText(a.km)} van ${loc.title}. Vliegtijd is een schatting; zoek de prijs op via de link.`,
          link: `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${HOME_CODE} to ${a.iata}`)}`,
          location_id: loc.id,
          added_by: store.get('name'),
        });
      } else {
        const h = pinCtx.hotels[+hBtn.dataset.addHotel];
        const section = await ensureSection('stay', 'Overnachting', '🏨');
        await api(`/sections/${section.id}/items`, 'POST', {
          title: h.name,
          subtitle: [h.stars ? `${h.stars}★` : '', h.type, h.city].filter(Boolean).join(' · '),
          body: [h.street && `${h.street}${h.city ? ', ' + h.city : ''}`, `${kmText(h.km)} van ${loc.title}.`].filter(Boolean).join('\n'),
          rating: h.stars && h.stars <= 5 ? h.stars : null,
          link: h.website || h.osm,
          lat: h.pos[0],
          lng: h.pos[1],
          location_id: loc.id,
          added_by: store.get('name'),
        });
      }
      await reload();
      if (aBtn) flyTo(loc.id);
      renderPinSheet();
      toast('Toegevoegd ✓');
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
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
    $('#tripPicks').innerHTML = sections.length ? sections.map((s) => `
      <label>${esc(s.icon)} ${esc(s.title)}
        <select data-pick>
          <option value="">Geen</option>
          ${sortedItems(s).map((it) => `<option value="${it.id}"${chosen.includes(it.id) ? ' selected' : ''}>${esc(it.title)}${s.show_price && it.price ? ` (${esc(it.price)})` : ''}</option>`).join('')}
        </select>
      </label>`).join('')
      : '<p class="hint">Voeg eerst suggesties toe in de andere tabs, dan kun je ze hier combineren.</p>';
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
      item_ids: $$('[data-pick]', tripForm).map((el) => +el.value).filter(Boolean),
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
