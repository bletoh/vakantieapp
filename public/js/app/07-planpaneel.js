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
    const list = els
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
      .slice(0, 4)
      .sort((a, b) => a.km - b.km);
    return practicalAirports(loc, list);
  }

  // Alleen vliegvelden waar je praktisch komt: het dichtstbijzijnde altijd, de rest alleen als je er
  // binnen 2 uur over de weg bent. Zo valt Ibiza af als je naar Valencia gaat (alleen per boot, 4+ uur).
  const MAX_DRIVE = 120;
  async function practicalAirports(loc, list) {
    if (list.length < 2) return list;
    let minutes = null;
    try { minutes = (await api('/drive', 'POST', { from: [loc.lat, loc.lng], to: list.map((a) => a.pos) })).minutes; } catch { /* rijtijden niet bereikbaar */ }
    if (!minutes) return list.filter((a, i) => i === 0 || a.km <= 60).slice(0, 3); // grove terugval
    list.forEach((a, i) => { a.drive = minutes[i]; });
    return list.filter((a, i) => i === 0 || (a.drive != null && a.drive <= MAX_DRIVE)).slice(0, 3);
  }
  const driveText = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}u${String(min % 60).padStart(2, '0')}`);

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
    const k = KINDS[kind] || (kind === 'car' ? { icon: '🚗', title: 'Huurauto', price: true } : null);
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
      note: 'note' in patch ? patch.note : trip ? trip.note || '' : '',
      added_by: trip ? trip.added_by || '' : myName(),
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
    scrollCarouselTo(id);
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
      if (mode !== 'side') Object.assign(pinDialog.style, { top: '', left: '', width: '', height: '', transition: '' });
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
  // Omlaag vegen vanuit de halve stand: paneel zakt weg en sluit.
  function slidePinSheetAway() {
    if (reducedMotion()) { closePinSheet(); return; }
    pinDialog.style.transition = 'height .18s ease-in';
    pinDialog.style.height = '0px';
    setTimeout(closePinSheet, 180);
  }
  const pinSheetEl = () => (currentMode() === 'bottom' ? pinDialog : null);
  sheetSwipe($('#pinGrip'), {
    up: () => setPinFull(true),
    down: () => (pinDialog.classList.contains('full') ? setPinFull(false) : slidePinSheetAway()),
    tap: () => setPinFull(!pinDialog.classList.contains('full')),
    sheet: pinSheetEl,
  });
  sheetSwipe($('.sheet-head', pinDialog), {
    up: () => { if (currentMode() === 'bottom') setPinFull(true); },
    down: () => { if (currentMode() !== 'bottom') return; if (pinDialog.classList.contains('full')) setPinFull(false); else slidePinSheetAway(); },
    sheet: pinSheetEl,
  });

  pinDialog.addEventListener('close', () => {
    pinCtx = null;
    document.body.classList.remove('pin-bottom');
    if (currentMode() === 'bottom') { pinDialog.style.height = ''; pinDialog.style.transition = ''; }
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
          <span class="chosen-icon">${kindIcon(s.kind, s.icon)}</span>
          <span><strong>${esc(it.title)}</strong>${it.subtitle ? `<small>${esc(it.subtitle)}</small>` : ''}</span>
          ${s.show_price && it.price ? `<span class="price">${esc(it.price)}</span>` : ''}
        </button>
        ${safeUrl(it.link) && !safeUrl(it.link).startsWith('/') ? `<a class="btn sm out-link" href="${esc(safeUrl(it.link))}" target="_blank" rel="noopener noreferrer">${esc(linkSite(it.link) || 'Website')} ↗</a>` : ''}
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
    const known = byName.size > 0 && p.conflicts !== null;
    const me = myName().trim();
    const summary = dated
      ? `${shortRange(t.start_date, t.end_date)}${conflicts.length ? ` · <span class="warn">${conflicts.length} kan niet</span>` : known ? ' · iedereen kan' : ''}`
      : 'Nog niet gekozen';
    const body = `
      ${dated ? `<div class="when-chosen">
          <p class="when-range"><strong>${rangeText(t.start_date, t.end_date)}</strong> · ${dayCount(t.start_date, t.end_date)} dagen</p>
          ${conflicts.length ? `<div class="conflict-note"><strong>Kan niet:</strong> ${conflictText(conflicts)}</div>`
            : known ? '<div class="ok-note">✓ Iedereen die de datumprikker invulde kan</div>'
            : byName.size ? '<p class="hint">Valt buiten de periode van de datumprikker, dus we weten niet wie er kan.</p>' : ''}
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
        <a class="btn sm" href="#datum" data-go-poll>${ic('calendar')} ${me && byName.has(me) ? 'Jouw beschikbaarheid aanpassen' : 'Vul in wanneer jij kunt'}</a>
        ${dated ? '<button type="button" class="btn sm ghost" data-clear-dates>Datum wissen</button>' : ''}
      </div>`;
    return stepHtml('when', ic('calendar'), 'Wanneer', summary, dated && !conflicts.length, body);
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

  // Echte vluchtprijs (retour p.p., Aviasales) per vliegveld voor de datums van de reis.
  const flightPriceKey = (iata, t) => `${iata}|${t.start_date}|${t.end_date || t.start_date}`;
  function flightPriceHtml(a, p) {
    const t = p.trip;
    if (!t || !t.start_date) return '';
    pinCtx.fp = pinCtx.fp || {};
    const key = flightPriceKey(a.iata, t);
    if (!(key in pinCtx.fp)) {
      pinCtx.fp[key] = 'loading';
      const locId = pinCtx.locId;
      queueMicrotask(async () => {
        if (!priceStatus) priceStatus = await api('/prices/status').catch(() => ({ flights: false }));
        let r = null;
        if (priceStatus.flights) {
          const qs = new URLSearchParams({ destination: a.iata, depart: t.start_date, ret: t.end_date || t.start_date });
          r = await api(`/prices/flight?${qs}`).catch(() => null);
        }
        if (!pinCtx || pinCtx.locId !== locId) return;
        pinCtx.fp[key] = r;
        renderPinSheet();
      });
    }
    const r = pinCtx.fp[key];
    if (r === 'loading') return '<small class="loading-dots">Vluchtprijs ophalen</small>';
    const f = r && r.cheapest;
    if (!f) return '';
    return `<span class="airbnb-price"><strong>€ ${f.price.toLocaleString('nl-NL')} p.p.</strong> retour · <span class="real-note">echte prijs</span> ${esc(flightNote(f, r.approx))}</span>`;
  }

  // Echte Airbnb-prijzen voor de datums van de reis en de groepsgrootte (uit Ideeën).
  function airbnbHtml(loc, p, titles) {
    if (!hasPos(loc)) return '';
    const t = p.trip;
    if (!t || !t.start_date) return '<p class="hint">Kies eerst een datum, dan zie je hier echte Airbnb-prijzen voor jullie groep.</p>';
    const n = ideaPrefs().persons;
    const checkout = t.end_date > t.start_date ? t.end_date : addDays(t.start_date, 1);
    const key = `${loc.id}|${t.start_date}|${checkout}|${n}`;
    if (pinCtx.airbnbKey !== key) {
      pinCtx.airbnbKey = key;
      pinCtx.airbnb = undefined;
      const qs = new URLSearchParams({ lat: loc.lat, lng: loc.lng, checkin: t.start_date, checkout, adults: n });
      queueMicrotask(() => loadPinData('airbnb', () => api(`/prices/stay?${qs}`)));
    }
    const r = pinCtx.airbnb;
    const head = `<p class="hint airbnb-for">Hele woningen voor <strong>${n} ${n === 1 ? 'persoon' : 'personen'}</strong>, ${shortRange(t.start_date, t.end_date)}. <small>Groepsgrootte pas je aan bij Ideeën.</small></p>`;
    if (r === undefined || r === 'loading') return `${head}<p class="hint loading-dots">Echte prijzen ophalen bij Airbnb</p>`;
    if (r === 'error') return `${head}<p class="hint">Airbnb is nu even niet bereikbaar. <button type="button" class="text-btn" data-airbnb-retry>Opnieuw proberen</button></p>`;
    if (!r.listings.length) return `${head}<p class="hint">Geen woningen gevonden voor ${n} personen op deze datums. <a href="${esc(r.url)}" target="_blank" rel="noopener">Zelf zoeken op Airbnb ↗</a></p>`;
    return `${head}
      <p class="airbnb-levels">Vanaf <strong>€ ${r.levels.min.toLocaleString('nl-NL')}</strong> · meestal € ${r.levels.mid.toLocaleString('nl-NL')} voor de groep <small>(€ ${Math.round(r.levels.mid / n).toLocaleString('nl-NL')} p.p.)</small></p>
      ${resultsHtml(r.listings.slice(0, 6).map((x) => ({ ...x, addTitle: x.name })), 'data-add-airbnb', titles, (a) => `
        <strong>${esc(a.name)}</strong>
        <small>${a.rating ? `★ ${String(a.rating).replace('.', ',')}${a.reviews ? ` (${a.reviews})` : ''} · ` : ''}${esc(a.rooms)}</small>
        <span class="airbnb-price"><strong>€ ${a.total.toLocaleString('nl-NL')}</strong> totaal · € ${a.perPerson.toLocaleString('nl-NL')} p.p.</span>
        <span class="result-links"><a href="${esc(a.link)}?check_in=${r.checkin}&check_out=${r.checkout}&adults=${r.adults}" target="_blank" rel="noopener">Bekijk op Airbnb ↗</a></span>`)}
      <p class="fineprint">Echte prijzen van Airbnb incl. kosten, opgehaald ${r.stale ? 'eerder (Airbnb was nu niet bereikbaar)' : 'in de afgelopen 12 uur'}. <a href="${esc(r.url)}" target="_blank" rel="noopener">Alle ${r.count} op Airbnb ↗</a></p>`;
  }

  function kindStepHtml(loc, p, kind) {
    const k = KINDS[kind];
    const section = sectionsOfKind(kind)[0];
    const chosen = p.per[kind];
    const titles = new Set(chosen.map(({ it }) => it.title));
    const own = section && section.items.length
      ? `<button type="button" class="text-btn" data-action="link-item" data-loc="${loc.id}" data-section="${section.id}">Kies uit eerdere suggesties</button>` : '';
    const ownNew = kind === 'stay'
      ? `<button type="button" class="btn sm" data-new-kind="stay">＋ Airbnb- of Booking-link plakken</button>`
      : `<button type="button" class="text-btn" data-new-kind="${kind}">＋ Zelf ${k.title.toLowerCase()} invullen</button>`;
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
          <small>${a.drive != null ? `${driveText(a.drive)} rijden` : kmText(a.km)} van de pin · ± ${flightTime(distanceKm(HOME, a.pos))} vliegen</small>
          ${flightPriceHtml(a, p)}
          <span class="result-links">
            <a href="${flightsUrl(a.iata, p.trip)}" target="_blank" rel="noopener">Google Flights ↗</a>
            <a href="${skyscannerUrl(a.iata, p.trip)}" target="_blank" rel="noopener">Skyscanner ↗</a>
          </span>`)}
        <p class="fineprint">Vliegtijd is een schatting. ${p.trip && p.trip.start_date ? 'De links zoeken op jullie reisdatums.' : 'Kies eerst een datum, dan zoeken de links op die dagen.'}</p>`;
    } else if (kind === 'stay') {
      const hotels = Array.isArray(pinCtx.hotels) ? pinCtx.hotels : [];
      found = `
        ${airbnbHtml(loc, p, titles)}
        <p class="mini-label">Hotels in de buurt</p>
        ${statusHtml(pinCtx.hotels, 'Geen hotels gevonden binnen 5 km.')}
        ${resultsHtml(hotels, 'data-add-hotel', titles, (h) => `
          <strong>${esc(h.name)}</strong>
          <small>${h.stars ? `${'★'.repeat(h.stars)} · ` : ''}${esc(h.type)} · ${kmText(h.km)}</small>
          ${(() => { const g = groupReview(h.name); return g ? `<span class="group-review">${ic('users')} Groep: ${g.rating ? `${'★'.repeat(g.rating)} ` : ''}${g.text ? `“${esc(g.text)}”` : ''}${g.by ? ` · ${esc(g.by)}` : ''}</span>` : ''; })()}
          <span class="result-links">
            ${h.website ? `<a href="${esc(h.website)}" target="_blank" rel="noopener">Website ↗</a>` : ''}
            <a href="${bookingUrl(`${h.name} ${h.city || shortName(loc.title)}`, p.trip)}" target="_blank" rel="noopener">Reviews en prijs op Booking ↗</a>
            <a href="${googleReviewsUrl(h.name, h.city || shortName(loc.title))}" target="_blank" rel="noopener">Google-reviews ↗</a>
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
    const nearbyLabel = { flight: 'Vliegvelden in de buurt', stay: "Airbnb's voor jullie groep", do: 'Te doen in de buurt', eat: 'Eten in de buurt' }[kind];
    return stepHtml(kind, kindIcon(kind), k.title, summary, n > 0, `
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
          ${loc.added_by ? `<span class="added-by">${avatar(loc.added_by)}Gepind door ${esc(loc.added_by)}</span>` : ''}
          <span class="progress lg" role="img" aria-label="${p.done} van ${p.total} geregeld"><span style="width:${Math.round(p.done / p.total * 100)}%"></span></span>
          <span class="plan-status">${p.done === p.total ? '✓ Datum, vlucht en hotel geregeld' : `${p.done} van ${p.total} geregeld: datum, vlucht en hotel`}</span>
          ${p.done ? tripShareHtml(p.trip) : ''}
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
      openItemDialog(null, section.id, { location_id: loc.id, focusLink: newKind.dataset.newKind === 'stay' });
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

    if (t.closest('[data-airbnb-retry]')) { pinCtx.airbnbKey = null; renderPinSheet(); return; }
    const add = t.closest('[data-add-airport], [data-add-hotel], [data-add-airbnb], [data-add-do], [data-add-eat]');
    if (!add) return;
    add.disabled = true;
    const kind = add.matches('[data-add-airport]') ? 'flight' : add.matches('[data-add-hotel], [data-add-airbnb]') ? 'stay' : null;
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
    const by = myName();
    if (btn.dataset.addAirport !== undefined) {
      const a = pinCtx.airports[+btn.dataset.addAirport];
      const trip = tripsFor(loc.id)[0];
      const fr = trip && trip.start_date && pinCtx.fp && pinCtx.fp[flightPriceKey(a.iata, trip)];
      const f = fr && fr !== 'loading' && fr.cheapest;
      const section = await ensureSection('flight');
      await api(`/sections/${section.id}/items`, 'POST', {
        title: `Amsterdam → ${a.name} (${a.iata})`,
        subtitle: `${HOME_CODE} → ${a.iata} · ± ${flightTime(distanceKm(HOME, a.pos))} vliegen${f ? ` · ${flightNote(f, fr.approx).slice(1, -1)}` : ''}`,
        body: f
          ? `Echte prijs: € ${f.price.toLocaleString('nl-NL')} p.p. retour${fr.approx ? ` (goedkoopste in die maand: ${shortRange(f.departAt.slice(0, 10), (f.returnAt || f.departAt).slice(0, 10))})` : ''}, gevonden via Aviasales op ${fmt(fr.fetchedAt.slice(0, 10), { day: 'numeric', month: 'long' })}. Prijzen veranderen snel; boek via de link.`
          : `Vliegveld op ${kmText(a.km)} van ${loc.title}. Vliegtijd is een schatting; zoek de prijs op via de link.`,
        ...(f ? { price: `€ ${f.price.toLocaleString('nl-NL')} p.p.` } : {}),
        link: (f && f.link) || flightsUrl(a.iata, tripsFor(loc.id)[0]),
        location_id: loc.id,
        added_by: by,
      });
      await reload();
      await syncTrip(loc);
      animateFlight(loc.id);
      return;
    }
    if (btn.dataset.addAirbnb !== undefined) {
      const a = pinCtx.airbnb.listings[+btn.dataset.addAirbnb];
      const r = pinCtx.airbnb;
      const section = await ensureSection('stay');
      await api(`/sections/${section.id}/items`, 'POST', {
        title: a.name,
        subtitle: [a.rating ? `★ ${String(a.rating).replace('.', ',')}${a.reviews ? ` (${a.reviews})` : ''}` : '', a.rooms].filter(Boolean).join(' · '),
        body: `Echte Airbnb-prijs voor ${r.adults} ${r.adults === 1 ? 'persoon' : 'personen'}, ${r.nights} ${r.nights === 1 ? 'nacht' : 'nachten'} (${shortRange(r.checkin, addDays(r.checkout, -1))}): € ${a.total.toLocaleString('nl-NL')} totaal, € ${a.perPerson.toLocaleString('nl-NL')} p.p. Opgehaald op ${fmt(r.fetchedAt.slice(0, 10), { day: 'numeric', month: 'long' })}.`,
        price: `€ ${a.total.toLocaleString('nl-NL')}`,
        rating: a.rating ? Math.round(a.rating) : null,
        link: a.link,
        image: a.image,
        lat: a.lat,
        lng: a.lng,
        location_id: loc.id,
        added_by: by,
      });
    } else if (btn.dataset.addHotel !== undefined) {
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
