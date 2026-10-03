(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = { settings: {}, sections: [], trips: [] };

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
    render();
  }

  /* ---------- routing ---------- */

  function currentRoute() {
    if (location.hash === '#reizen') return 'reizen';
    const m = /^#tab-(\d+)$/.exec(location.hash);
    if (m && findSection(+m[1])) return +m[1];
    return state.sections.length ? state.sections[0].id : null;
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
    nav.innerHTML = state.sections.map((s) => {
      const active = route === s.id;
      return `<a class="tab${active ? ' active' : ''}" href="#tab-${s.id}"${active ? ' aria-current="page"' : ''}>${esc(s.title)}</a>`;
    }).join('')
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
          <div class="map-hint">Tik op de kaart om een pin te prikken</div>
        </div>` : ''}
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

  // Koppelingen tussen een locatie (pin) en vluchten/overnachtingen, als kleine chips.
  function linkChipsHtml(it, s) {
    if (s.kind === 'map') {
      const links = linkedTo(it.id);
      const pin = it.lat != null ? '<span class="chip">Op de kaart</span>' : '';
      if (!links.length && !pin) return '';
      return `<div class="chips">${pin}${links.map(({ s: ls, it: li }) =>
        `<a class="chip" href="#tab-${ls.id}">${esc(ls.icon)} ${esc(li.title)}</a>`).join('')}</div>`;
    }
    const loc = it.location_id && findItem(it.location_id);
    if (!loc) return '';
    return `<div class="chips"><a class="chip" href="#tab-${loc.section_id}">📍 ${esc(loc.title)}</a></div>`;
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
      <article class="card trip" data-trip="${t.id}" tabindex="0" aria-label="${esc(t.title)} aanpassen">
        <div class="card-body">
          <span class="card-hint" aria-hidden="true">Aanpassen</span>
          <h3 class="card-title">${esc(t.title)}</h3>
          ${t.added_by ? `<div class="added-by">Voorgesteld door ${esc(t.added_by)}</div>` : ''}
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
    'add-item': (btn) => openItemDialog(null, +btn.dataset.id),
    'add-section': () => openSectionDialog(null),
    'edit-section': (btn) => openSectionDialog(findSection(+btn.dataset.id)),
    'edit-site': () => openSiteDialog(),
    'edit-item': (btn) => openItemDialog(findItem(+btn.dataset.id)),
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
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 18,
    }).addTo(map);

    L.circleMarker(HOME, { radius: 6, color: '#fff', weight: 2, fillColor: '#f97316', fillOpacity: 1 })
      .addTo(map).bindTooltip('🇳🇱 Nederland', { direction: 'top', offset: [0, -6] });

    const pins = sortedItems(section).filter((it) => it.lat != null && it.lng != null);
    for (const it of pins) {
      const m = L.marker([it.lat, it.lng], { icon: pinIcon(it), draggable: true, autoPan: true })
        .addTo(map)
        .bindTooltip(esc(it.title), { permanent: true, interactive: true, direction: 'top', className: 'pin-label' })
        .bindPopup(() => pinPopupHtml(it.id), { minWidth: 220, maxWidth: 280 });
      m.on('click', () => flyTo(it.id));
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

    if (pins.length) {
      map.fitBounds(L.latLngBounds([HOME, ...pins.map((p) => [p.lat, p.lng])]), { padding: [40, 40], maxZoom: 7 });
    } else {
      map.setView([45, 12], 3.5);
    }

    // Een tik die alleen een open pinvenster sluit, prikt geen nieuwe pin.
    let popupClosedAt = 0;
    map.on('popupclose', () => { popupClosedAt = Date.now(); });
    map.on('click', (e) => {
      if (Date.now() - popupClosedAt < 400) return;
      addPinAt(section, e.latlng);
    });
    // Na het tekenen (en als de kaart zichtbaar is) de vluchten laten vliegen.
    setTimeout(() => { if (map) { map.invalidateSize(); drawFlights(true); } }, 150);
  }

  function pinPopupHtml(locId) {
    const loc = findItem(locId);
    if (!loc) return '';
    const links = linkedTo(locId);
    const linkable = state.sections.filter((s) => s.kind === 'flight' || s.kind === 'stay');
    return `
      <div class="pin-popup">
        <strong class="pin-popup-title">${esc(loc.title)}</strong>
        ${links.length ? `<ul class="pin-links">${links.map(({ s, it }) => `
          <li><button type="button" data-action="edit-item" data-id="${it.id}">
            <span>${esc(s.icon)}</span><span>${esc(it.title)}</span>
            ${s.show_price && it.price ? `<small>${esc(it.price)}</small>` : ''}
          </button></li>`).join('')}</ul>` : '<p class="hint">Nog niets gekoppeld.</p>'}
        <div class="pin-actions">
          ${linkable.map((s) => `<button type="button" class="btn sm" data-action="link-item" data-loc="${loc.id}" data-section="${s.id}">＋ ${esc(s.icon)} ${esc(s.title)}</button>`).join('')}
          <button type="button" class="btn sm ghost" data-action="edit-item" data-id="${loc.id}">✎ Aanpassen</button>
        </div>
      </div>`;
  }

  async function addPinAt(section, latlng) {
    const preset = { lat: latlng.lat, lng: latlng.lng };
    openItemDialog(null, section.id, preset);
    const name = await placeName(latlng.lat, latlng.lng);
    if (name && itemDialog.open && !itemCtx.id && !itemForm.elements.title.value) {
      itemForm.elements.title.value = name;
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

  // Reis
  const tripDialog = $('#tripDialog');
  const tripForm = $('#tripForm');
  let tripCtx = null;

  function openTripDialog(trip) {
    tripCtx = trip;
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

  tripForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      title: tripForm.elements.title.value.trim(),
      note: tripForm.elements.note.value.trim(),
      added_by: tripForm.elements.added_by.value.trim(),
      item_ids: $$('[data-pick]', tripForm).map((el) => +el.value).filter(Boolean),
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
