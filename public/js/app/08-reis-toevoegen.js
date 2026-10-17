  /* ---------- huurauto: vergelijken met de leeftijd van de jongste bestuurder ---------- */

  // Indicatie per land bij de grote verhuurders: [minimumleeftijd, toeslag per dag onder 25 (van, tot)].
  // Dit verschilt per verhuurder en autoklasse; de voorwaarden van de verhuurder gelden altijd.
  const CAR_RULES = {
    Spanje: [21, 10, 20], Portugal: [21, 10, 15], Italië: [21, 15, 25], Griekenland: [21, 10, 15], Frankrijk: [21, 30, 40],
    Kroatië: [21, 10, 15], Bulgarije: [21, 8, 12], Cyprus: [21, 10, 15], Malta: [21, 10, 15], Turkije: [21, 10, 20],
    Duitsland: [18, 15, 20], Oostenrijk: [19, 15, 20], Zwitserland: [20, 20, 30], Engeland: [21, 30, 45], Schotland: [21, 30, 45],
    Ierland: [21, 25, 35], Denemarken: [19, 15, 20], Zweden: [19, 15, 20], Noorwegen: [19, 15, 20], Finland: [20, 15, 20],
    IJsland: [20, 0, 10], Marokko: [21, 8, 12], Egypte: [23, 10, 15], Kaapverdië: [21, 5, 10], 'Zuid-Afrika': [21, 10, 15],
    Tanzania: [23, 10, 20], Mauritius: [23, 5, 10], 'Verenigde Arabische Emiraten': [21, 10, 20],
    'Verenigde Staten': [20, 25, 35], Canada: [21, 20, 30], Mexico: [21, 10, 25], 'Costa Rica': [21, 10, 20],
    Brazilië: [21, 5, 15], Argentinië: [21, 10, 15], Colombia: [21, 5, 15], Peru: [22, 10, 15],
    Australië: [21, 15, 25], Thailand: [21, 0, 10], Indonesië: [21, 0, 10], Maleisië: [23, 5, 10], Filipijnen: [21, 5, 10],
    Vietnam: [21, 0, 10], 'Sri Lanka': [21, 0, 10], India: [21, 0, 10], Japan: [18, 0, 0], 'Zuid-Korea': [21, 5, 10],
  };
  const CAR_RULE_DEFAULT = [21, 10, 25];
  const NO_CAR_NEEDED = ['Malediven', 'Singapore', 'Seychellen', 'China', 'Macau', 'Monaco'];

  // "€ 1.250", "367,92" of "1,250.50" naar een getal.
  function parseEuro(v) {
    let t = String(v ?? '').replace(/[^\d.,]/g, '');
    if (!t) return null;
    const lastC = t.lastIndexOf(','), lastD = t.lastIndexOf('.');
    if (lastC > -1 && lastD > -1) {
      const dec = lastC > lastD ? ',' : '.';
      t = t.replace(new RegExp(`\\${dec === ',' ? '.' : ','}`, 'g'), '').replace(dec, '.');
    } else if (lastC > -1) {
      t = /,\d{1,2}$/.test(t) && t.split(',').length === 2 ? t.replace(',', '.') : t.replace(/,/g, '');
    } else if (lastD > -1) {
      if (/\.\d{3}$/.test(t) || t.split('.').length > 2) t = t.replace(/\./g, '');
    }
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  }

  function carPrefs() {
    let p = {};
    try { p = JSON.parse(store.get('cars') || '{}'); } catch { /* standaard */ }
    return {
      age: Math.min(99, Math.max(18, +p.age || 23)),
      onlyOk: p.onlyOk !== false,
      sort: p.sort === 'new' ? 'new' : 'total',
    };
  }
  const saveCarPrefs = (p) => store.set('cars', JSON.stringify(p));

  const carItems = () => sectionsOfKind('car').flatMap((s) => sortedItems(s));
  const tripsWithItem = (id) => state.trips.filter((t) => t.item_ids.includes(id));
  const tripDays = (t) => (t && t.start_date ? dayCount(t.start_date, t.end_date) : null);

  // Land van een reis: de dichtstbijzijnde bestemming uit de ideeënlijst.
  function tripCountry(t) {
    const loc = t && tripLocation(t);
    if (!loc || !hasPos(loc) || !destinations) return null;
    let best = null;
    for (const d of destinations) {
      const km = distanceKm([loc.lat, loc.lng], [d.lat, d.lng]);
      if (!best || km < best.km) best = { c: d.c, km };
    }
    return best && best.km < 400 ? best.c : null;
  }

  // Wat kost de auto voor iemand van deze leeftijd, en mag het wel?
  function carCost(it, age) {
    const rent = parseEuro(it.price);
    const young = age < 25 && it.young_fee ? it.young_fee : 0;
    const allowed = it.min_age ? age >= it.min_age : null;
    return { rent, young, total: rent != null ? rent + young : null, allowed };
  }

  // Toevoegen / aanpassen
  const carDialog = $('#carDialog');
  const carForm = $('#carForm');
  let carCtx = null;

  function openCarDialog(it, tripId) {
    carCtx = { id: it ? it.id : null };
    const el = carForm.elements;
    $('#carDialogTitle').textContent = it ? 'Huurauto aanpassen' : 'Huurauto toevoegen';
    $('#carDelete').hidden = !it;
    for (const f of ['link', 'title', 'subtitle', 'body']) el[f].value = it ? it[f] || '' : '';
    el.price.value = it && it.price ? String(it.price).replace(/^€\s*/, '') : '';
    el.min_age.value = it && it.min_age ? it.min_age : '';
    el.fee.value = it && it.young_fee != null ? it.young_fee : '';
    el.fee_unit.value = it ? 'total' : 'day';
    const inTrips = it ? tripsWithItem(it.id) : [];
    const pre = tripId ? String(tripId) : inTrips[0] ? String(inTrips[0].id) : '';
    el.trip.innerHTML = '<option value="">Nog geen reis</option>'
      + state.trips.map((t) => `<option value="${t.id}"${String(t.id) === pre ? ' selected' : ''}>${esc(t.title)}</option>`).join('');
    el.trip.disabled = inTrips.length > 1 && !tripId;
    syncCarDays();
    carDialog.showModal();
    focusSoon(it ? el.title : el.link);
  }

  function syncCarDays() {
    const el = carForm.elements;
    const t = state.trips.find((x) => x.id === +el.trip.value);
    if (tripDays(t)) el.days.value = tripDays(t);
    else if (!el.days.value) el.days.value = 7;
    updateCarFeeNote();
  }
  function updateCarFeeNote() {
    const el = carForm.elements;
    const fee = parseEuro(el.fee.value);
    const days = parseInt(el.days.value, 10) || 0;
    $('#carFeeNote').textContent = fee && el.fee_unit.value === 'day' && days
      ? `€ ${fee} × ${days} dagen = € ${(fee * days).toLocaleString('nl-NL')} toeslag in totaal.`
      : 'Staat in de voorwaarden van de verhuurder, vaak onder "jonge bestuurder" of "young driver".';
  }
  carForm.elements.trip.addEventListener('change', syncCarDays);
  for (const f of ['fee', 'days', 'fee_unit']) carForm.elements[f].addEventListener('input', updateCarFeeNote);

  carForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const el = carForm.elements;
    const rent = parseEuro(el.price.value);
    const fee = parseEuro(el.fee.value);
    const days = parseInt(el.days.value, 10) || 1;
    const tripId = +el.trip.value || null;
    const trip = state.trips.find((t) => t.id === tripId);
    const loc = trip && tripLocation(trip);
    const data = {
      title: el.title.value, subtitle: el.subtitle.value, body: el.body.value, link: el.link.value,
      price: rent != null ? `€ ${rent.toLocaleString('nl-NL', rent % 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {})}` : '',
      min_age: el.min_age.value, young_fee: fee == null ? '' : el.fee_unit.value === 'day' ? fee * days : fee,
    };
    try {
      const isNew = !carCtx.id;
      if (isNew) {
        const section = await ensureSection('car');
        carCtx.id = (await api(`/sections/${section.id}/items`, 'POST', { ...data, location_id: loc ? loc.id : null, added_by: myName() })).id;
      } else {
        await api(`/items/${carCtx.id}`, 'PUT', data);
      }
      await reload();
      if (trip && !trip.item_ids.includes(carCtx.id)) await setTripItem(trip, carCtx.id, true);
      carDialog.close();
      await reload();
      toast(isNew ? `Huurauto toegevoegd${trip ? ` aan ${trip.title}` : ''} ✓` : 'Opgeslagen ✓');
    } catch (err) { toast(err.message, true); }
  });

  $('#carDelete').addEventListener('click', async () => {
    const it = findItem(carCtx.id);
    if (!it || !confirm(`"${it.title}" verwijderen?`)) return;
    try { await api(`/items/${it.id}`, 'DELETE'); carDialog.close(); await reload(); toast('Verwijderd'); } catch (err) { toast(err.message, true); }
  });

  // Een onderdeel in of uit een reis halen (de rest van de reis blijft gelijk).
  async function setTripItem(t, itemId, on) {
    const ids = new Set(t.item_ids);
    if (on) ids.add(itemId); else ids.delete(itemId);
    await api(`/trips/${t.id}`, 'PUT', { title: t.title, note: t.note || '', start_date: t.start_date || '', end_date: t.end_date || '', item_ids: [...ids] });
    t.item_ids = [...ids];
    // Op de kaart: de auto hoort bij de bestemming van de reis.
    const loc = on && tripLocation(t);
    const it = findItem(itemId);
    if (loc && it && !it.location_id) await api(`/items/${itemId}`, 'PUT', { location_id: loc.id });
  }

  // Paneel "Toevoegen aan deze reis": huurauto of activiteiten, geopend vanaf een reiskaartje.
  const tripAddDialog = $('#tripAddDialog');
  let tripAdd = null; // { tripId, mode: 'car' | 'do' | 'eat', places }
  const TRIP_ADD = {
    do: { title: 'Activiteiten', one: 'activiteit', none: 'Nog geen activiteiten in deze reis.', near: 'Te doen in de buurt', empty: 'Niets gevonden binnen 8 km.' },
    eat: { title: 'Eten & drinken', one: 'restaurant of bar', none: 'Nog geen restaurants of bars in deze reis.', near: 'Eten en drinken in de buurt', empty: 'Geen restaurants gevonden binnen 2 km.' },
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-trip-add]');
    if (b) openTripAdd(+b.dataset.tripId, b.dataset.tripAdd);
  });

  function openTripAdd(tripId, mode) {
    tripAdd = { tripId, mode, places: undefined };
    renderTripAdd();
    tripAddDialog.showModal();
    if (mode !== 'car') loadTripPlaces();
    // Het land (voor de leeftijdsregels) komt uit de bestemmingenlijst.
    if (mode === 'car' && !destinations) loadDestinations().then(refreshTripAdd, () => {});
  }
  const tripAddTrip = () => tripAdd && state.trips.find((t) => t.id === tripAdd.tripId);

  function renderTripAdd() {
    const t = tripAddTrip();
    if (!t) { if (tripAddDialog.open) tripAddDialog.close(); return; }
    $('#tripAddTitle').textContent = `${tripAdd.mode === 'car' ? 'Huurauto' : TRIP_ADD[tripAdd.mode].title} · ${t.title}`;
    const body = $('#tripAddBody');
    const scroll = body.scrollTop;
    body.innerHTML = tripAdd.mode === 'car' ? tripCarHtml(t) : tripPlacesHtml(t, tripAdd.mode);
    body.scrollTop = scroll;
  }

  /* --- huurauto voor een reis --- */

  function tripCarHtml(t) {
    const p = carPrefs();
    let list = carItems().map((it) => ({ it, cost: carCost(it, p.age), trips: tripsWithItem(it.id) }))
      // Auto's van deze reis en auto's die nog bij geen enkele reis horen.
      .filter((x) => x.trips.some((y) => y.id === t.id) || !x.trips.length);
    const hidden = p.onlyOk ? list.filter((x) => x.cost.allowed === false) : [];
    if (p.onlyOk) list = list.filter((x) => x.cost.allowed !== false);
    if (p.sort === 'total') list.sort((a, b) => (a.cost.total ?? Infinity) - (b.cost.total ?? Infinity) || b.it.id - a.it.id);
    else list.sort((a, b) => b.it.id - a.it.id);
    return `
      <div class="car-top">
        <label>Jongste bestuurder
          <span class="stepper">
            <button type="button" data-car-age="-1" aria-label="Een jaar jonger">−</button>
            <input id="carAge" type="number" min="18" max="99" inputmode="numeric" value="${p.age}" aria-label="Leeftijd jongste bestuurder">
            <button type="button" data-car-age="1" aria-label="Een jaar ouder">+</button>
          </span>
        </label>
        <div class="idea-cats car-filters">
          <button type="button" class="cat" data-car-ok aria-pressed="${p.onlyOk}">Alleen auto's die ik mag huren</button>
          ${[['total', 'Laagste totaalprijs'], ['new', 'Nieuwste eerst']].map(([k, l]) => `<button type="button" class="cat" role="radio" data-car-sort="${k}" aria-checked="${p.sort === k}" aria-pressed="${p.sort === k}">${l}</button>`).join('')}
        </div>
      </div>
      ${carSearchHtml(t, p)}
      <button type="button" class="btn primary block" data-car-new>${ic('plus')} Huurauto toevoegen</button>
      ${list.length ? `<div class="car-list">${list.map((x, i) => carCardHtml(x, p, t, i === 0 && p.sort === 'total' && list.length > 1)).join('')}</div>`
        : `<p class="hint">${hidden.length ? `Geen auto die je op ${p.age} mag huren.` : 'Nog geen huurauto bij deze reis.'}</p>`}
      ${hidden.length ? `<p class="hint">${hidden.length} ${hidden.length === 1 ? 'auto is' : "auto's zijn"} verborgen omdat je ${hidden.length === 1 ? 'hem' : 'ze'} op ${p.age} niet mag huren. <button type="button" class="text-btn" data-car-ok>Toch tonen</button></p>` : ''}`;
  }

  function carSearchHtml(t, p) {
    const loc = tripLocation(t);
    const place = loc ? shortName(loc.title) : t.title.replace(/^Reis naar /, '');
    const country = tripCountry(t);
    const days = tripDays(t);
    const [min, lo, hi] = (country && CAR_RULES[country]) || CAR_RULE_DEFAULT;
    let rule;
    if (country && NO_CAR_NEEDED.includes(country)) rule = `In ${esc(country)} huur je meestal geen auto: taxi, Grab of boot is gebruikelijker.`;
    else {
      const where = country ? `In ${esc(country)}` : 'Bij de meeste verhuurders';
      const fee = p.age >= 25 || !hi ? 'zonder toeslag voor jonge bestuurders'
        : `met meestal € ${lo}–${hi} per dag toeslag${days ? ` (± € ${lo * days}–${hi * days} voor ${days} dagen)` : ''}`;
      rule = `${where} mag je meestal vanaf <strong>${min} jaar</strong> huren. `
        + (p.age >= min ? `Op ${p.age} kan dat dus, ${fee}.` : `Op ${p.age} is dat vaak lastig: zoek naar verhuurders die het wel toestaan.`)
        + (p.age < 25 ? ' Vaak moet je je rijbewijs ook al 1 à 2 jaar hebben, en dure auto\'s zijn soms pas vanaf 25.' : '');
    }
    const dates = t.start_date ? `/${t.start_date}/${t.end_date > t.start_date ? t.end_date : addDays(t.start_date, 1)}` : '';
    const google = `https://www.google.com/search?q=${encodeURIComponent(`huurauto ${place} ${p.age} jaar jonge bestuurder`)}`;
    return `
      <div class="car-search">
        <div class="car-rule">${ic('car')}<p>${rule}<small>Indicatie bij grote verhuurders; de voorwaarden van de verhuurder gelden altijd.</small></p></div>
        <p class="mini-label">Zoeken in ${esc(place)}${t.start_date ? ` · ${shortRange(t.start_date, t.end_date)}` : ''}</p>
        <p class="pkg-links">
          <a href="https://www.kayak.nl/cars/${encodeURIComponent(place)}${dates}" target="_blank" rel="noopener">Kayak ↗</a>
          <a href="https://www.discovercars.com/nl" target="_blank" rel="noopener">DiscoverCars ↗</a>
          <a href="https://www.rentalcars.com/nl/" target="_blank" rel="noopener">Rentalcars ↗</a>
          <a href="https://www.sunnycars.nl/" target="_blank" rel="noopener">Sunny Cars ↗</a>
          <a href="${google}" target="_blank" rel="noopener">Google ↗</a>
        </p>
        <p class="fineprint">Vul op de site bij "leeftijd bestuurder" ${p.age} in, anders zie je de prijs zonder toeslag.</p>
      </div>`;
  }

  function carCardHtml({ it, cost, trips }, p, t, cheapest) {
    const link = safeUrl(it.link);
    const inTrip = trips.some((y) => y.id === t.id);
    const age = cost.allowed === true ? `<span class="car-age ok">✓ Mag op ${p.age}${it.min_age ? ` (vanaf ${it.min_age})` : ''}</span>`
      : cost.allowed === false ? `<span class="car-age no">✕ Pas vanaf ${it.min_age} jaar</span>`
        : '<span class="car-age unknown">Minimumleeftijd onbekend</span>';
    const money = (n) => `€ ${n.toLocaleString('nl-NL', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
    return `
      <article class="car-card${cost.allowed === false ? ' blocked' : ''}${inTrip ? ' in-trip' : ''}">
        <div class="car-head">
          <span class="car-ic">${ic('car')}</span>
          <div><h3>${esc(it.title)}</h3>${it.subtitle ? `<small>${esc(it.subtitle)}</small>` : ''}</div>
          ${cheapest ? '<span class="car-best">Goedkoopst</span>' : ''}
        </div>
        ${age}
        <dl class="car-price">
          <div><dt>Huurprijs</dt><dd>${cost.rent != null ? money(cost.rent) : '–'}</dd></div>
          ${p.age < 25 ? `<div><dt>Toeslag jonge bestuurder</dt><dd>${it.young_fee ? money(it.young_fee) : it.young_fee === 0 ? 'geen' : 'onbekend'}</dd></div>` : ''}
          <div class="car-total"><dt>Totaal${p.age < 25 ? ` op ${p.age}` : ''}</dt><dd>${cost.total != null ? money(cost.total) : '–'}</dd></div>
        </dl>
        ${it.body ? `<p class="card-text">${esc(it.body)}</p>` : ''}
        <div class="car-foot">
          <button type="button" class="btn sm${inTrip ? ' done' : ' primary'}" data-trip-toggle="${it.id}" aria-pressed="${inTrip}">${inTrip ? '✓ In deze reis' : '＋ Aan deze reis toevoegen'}</button>
          ${link && !link.startsWith('/') ? `<a class="btn sm out-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(linkSite(link) || 'Bekijk')} ↗</a>` : ''}
          <button type="button" class="text-btn" data-car-edit="${it.id}">Aanpassen</button>
        </div>
      </article>`;
  }

  /* --- activiteiten voor een reis --- */

  async function loadTripPlaces() {
    const t = tripAddTrip();
    const loc = t && tripLocation(t);
    if (!loc || !hasPos(loc)) { tripAdd.places = null; renderTripAdd(); return; }
    const ctx = tripAdd;
    let places;
    try { places = await findPlaces(loc, ctx.mode); } catch { places = 'error'; }
    if (ctx !== tripAdd) return;
    tripAdd.places = places;
    if (tripAddDialog.open) renderTripAdd();
  }

  function tripPlacesHtml(t, kind) {
    const L = TRIP_ADD[kind];
    const loc = tripLocation(t);
    const doItems = sectionsOfKind(kind).flatMap((s) => sortedItems(s));
    const chosen = doItems.filter((it) => t.item_ids.includes(it.id));
    const earlier = doItems.filter((it) => !t.item_ids.includes(it.id) && (!it.location_id || (loc && it.location_id === loc.id) || !tripsWithItem(it.id).length));
    const titles = new Set(chosen.map((it) => it.title));
    const places = tripAdd.places;
    let nearby = '';
    if (places === null) nearby = '<p class="hint">Deze reis heeft geen plek op de kaart, dus er zijn geen suggesties in de buurt.</p>';
    else if (places === undefined) nearby = '<p class="hint loading-dots">Zoeken in de buurt (de eerste keer kan dit even duren)</p>';
    else if (places === 'error') nearby = '<p class="hint">OpenStreetMap is nu even te druk. <button type="button" class="text-btn" data-places-retry>Opnieuw proberen</button></p>';
    else if (!places.length) nearby = `<p class="hint">${L.empty}</p>`;
    else nearby = resultsHtml(places, 'data-place-add', titles, (x) => `
      <strong>${esc(x.name)}</strong>
      <small>${esc(x.type)}${x.cuisine ? ` · ${esc(x.cuisine)}` : ''} · ${kmText(x.km)}</small>
      <span class="result-links">
        ${x.website ? `<a href="${esc(x.website)}" target="_blank" rel="noopener">Website ↗</a>` : ''}
        ${kind === 'eat' ? `<a href="${googleReviewsUrl(x.name, shortName(loc.title))}" target="_blank" rel="noopener">Google-reviews ↗</a>` : ''}
        <a href="${esc(x.osm)}" target="_blank" rel="noopener">Op OpenStreetMap ↗</a>
      </span>`);
    return `
      ${chosen.length ? `<p class="mini-label">In deze reis</p>
        <ul class="chosen">${chosen.map((it) => `
          <li>
            <button type="button" class="chosen-main" data-do-edit="${it.id}">
              <span class="chosen-icon">${kindIcon(kind)}</span>
              <span><strong>${esc(it.title)}</strong>${it.subtitle ? `<small>${esc(it.subtitle)}</small>` : ''}</span>
            </button>
            ${safeUrl(it.link) && !safeUrl(it.link).startsWith('/') ? `<a class="btn sm out-link" href="${esc(safeUrl(it.link))}" target="_blank" rel="noopener noreferrer">${esc(linkSite(it.link) || 'Website')} ↗</a>` : ''}
            <button type="button" class="icon-btn sm" data-trip-toggle="${it.id}" aria-label="${esc(it.title)} uit deze reis halen">✕</button>
          </li>`).join('')}</ul>` : `<p class="hint">${L.none}</p>`}
      <button type="button" class="btn primary block" data-do-new>${ic('plus')} Zelf een ${L.one} invullen</button>
      ${earlier.length ? `<p class="mini-label">Eerdere suggesties</p>
        <ul class="results">${earlier.map((it) => `
          <li class="result"><div class="result-main"><strong>${esc(it.title)}</strong>${it.subtitle ? `<small>${esc(it.subtitle)}</small>` : ''}${it.added_by ? `<small>door ${esc(it.added_by)}</small>` : ''}</div>
            <button type="button" class="btn sm" data-trip-toggle="${it.id}">＋ Kies</button></li>`).join('')}</ul>` : ''}
      <p class="mini-label">${L.near}${loc ? ` van ${esc(shortName(loc.title))}` : ''}</p>
      ${nearby}
      ${Array.isArray(places) && places.length ? '<p class="fineprint">Gegevens: © OpenStreetMap-bijdragers.</p>' : ''}`;
  }

  // Bediening van het paneel.
  $('#tripAddBody').addEventListener('click', async (e) => {
    const t = tripAddTrip();
    if (!t) return;
    const el = e.target;
    if (el.closest('[data-car-new]')) { openCarDialog(null, t.id); return; }
    const edit = el.closest('[data-car-edit]');
    if (edit) { openCarDialog(findItem(+edit.dataset.carEdit), t.id); return; }
    const doEdit = el.closest('[data-do-edit]');
    if (doEdit) { openItemDialog(findItem(+doEdit.dataset.doEdit)); return; }
    if (el.closest('[data-do-new]')) {
      const section = await ensureSection(tripAdd.mode);
      const loc = tripLocation(t);
      openItemDialog(null, section.id, { location_id: loc ? loc.id : null, addToTrip: t.id });
      return;
    }
    if (el.closest('[data-places-retry]')) { tripAdd.places = undefined; renderTripAdd(); loadTripPlaces(); return; }
    const toggle = el.closest('[data-trip-toggle]');
    const place = el.closest('[data-place-add]');
    if (toggle || place) {
      (toggle || place).disabled = true;
      try {
        if (toggle) {
          const id = +toggle.dataset.tripToggle;
          const on = !t.item_ids.includes(id);
          await setTripItem(t, id, on);
          await reload();
          toast(on ? `Toegevoegd aan ${t.title} ✓` : `Uit ${t.title} gehaald`);
        } else {
          const x = tripAdd.places[+place.dataset.placeAdd];
          const loc = tripLocation(t);
          const section = await ensureSection(tripAdd.mode);
          const { id } = await api(`/sections/${section.id}/items`, 'POST', {
            title: x.name, subtitle: [x.type, x.cuisine].filter(Boolean).join(' · '), body: `${kmText(x.km)} van ${loc.title}.`, link: x.website || x.osm,
            lat: x.pos[0], lng: x.pos[1], location_id: loc.id, added_by: myName(),
          });
          await setTripItem(t, id, true);
          await reload();
          toast(`${x.name} toegevoegd ✓`);
        }
      } catch (err) { toast(err.message, true); }
      renderTripAdd();
      return;
    }
    const p = carPrefs();
    if (el.closest('[data-car-ok]')) { p.onlyOk = !p.onlyOk; saveCarPrefs(p); renderTripAdd(); return; }
    const sort = el.closest('[data-car-sort]');
    if (sort) { p.sort = sort.dataset.carSort; saveCarPrefs(p); renderTripAdd(); return; }
    const step = el.closest('[data-car-age]');
    if (step) {
      p.age = Math.min(99, Math.max(18, p.age + +step.dataset.carAge)); saveCarPrefs(p); renderTripAdd();
    }
  });
  let carTimer = null;
  $('#tripAddBody').addEventListener('input', (e) => {
    if (e.target.id !== 'carAge') return;
    clearTimeout(carTimer);
    carTimer = setTimeout(() => {
      const a = parseInt(e.target.value, 10);
      if (!(a >= 18 && a <= 99)) return;
      const p = carPrefs(); p.age = a; saveCarPrefs(p);
      const pos = e.target.selectionStart;
      renderTripAdd();
      const input = $('#carAge'); input.focus(); try { input.setSelectionRange(pos, pos); } catch { /* number-veld */ }
    }, 400);
  });
  // Na elke wijziging (ook van anderen) het open paneel bijwerken.
  function refreshTripAdd() {
    try { if (tripAddDialog.open) renderTripAdd(); } catch { /* paneel nog niet klaar */ }
  }

  /* --- inpak- en takenlijst per reis --- */

  const TODO_DEFAULTS = ['Paspoort of ID-kaart', 'Reisverzekering geregeld', 'Online ingecheckt', 'Boarding pass op de telefoon',
    'Oplader en powerbank', 'Wereldstekker', 'Zonnebrand', 'Zwembroek', 'Zonnebril', 'Medicijnen', 'Pinpas en creditcard',
    'Speaker (één iemand)', 'Kaartspel of drankspel (één iemand)', 'Slippers'];
  const todoOpen = new Set(); // reizen waarvan de lijst openstaat, zodat hij na het verversen open blijft

  function todosHtml(t) {
    const list = t.todos || [];
    const done = list.filter((d) => d.done).length;
    const me = myName();
    return `
      <details class="todos" data-todos="${t.id}"${todoOpen.has(t.id) ? ' open' : ''}>
        <summary>${ic('list')}<span>Inpaklijst en taken</span>
          ${list.length ? `<span class="todo-count${done === list.length ? ' all' : ''}">${done}/${list.length}</span>` : '<span class="todo-count">leeg</span>'}</summary>
        ${list.length ? `<ul class="todo-list">${list.map((d) => `
          <li class="${d.done ? 'done' : ''}">
            <label class="todo-check"><input type="checkbox" data-todo-done="${d.id}"${d.done ? ' checked' : ''}><span>${esc(d.text)}</span></label>
            <button type="button" class="todo-who${d.who ? ' set' : ''}${d.who === me ? ' me' : ''}" data-todo-who="${d.id}" data-who="${esc(d.who || '')}"
              title="${d.who ? `${esc(d.who)} regelt dit` : 'Zeg dat jij dit regelt'}">${d.who ? `${avatar(d.who)}<span>${d.who === me ? 'Ik' : esc(d.who)}</span>` : 'Ik regel dit'}</button>
            <button type="button" class="todo-del" data-todo-del="${d.id}" aria-label="${esc(d.text)} verwijderen">×</button>
          </li>`).join('')}</ul>` : '<p class="todo-empty">Zet hier wat iedereen moet regelen of meenemen. Vink af wat klaar is.</p>'}
        <form class="todo-add" data-todo-add="${t.id}">
          <input name="text" maxlength="120" placeholder="Iets toevoegen, bijv. zonnebrand" aria-label="Iets toevoegen aan de lijst" autocomplete="off">
          <button type="submit" class="btn sm">${ic('plus')}<span class="sr-only">Toevoegen</span></button>
        </form>
        ${list.length < 3 ? `<button type="button" class="text-btn todo-default" data-todo-default="${t.id}">＋ Standaard inpaklijst gebruiken</button>` : ''}
      </details>`;
  }

  async function todoChange(fn, tripId) {
    try { await fn(); } catch (err) { toast(err.message, true); }
    await reload();
    const input = tripId && $(`[data-todo-add="${tripId}"] input`);
    if (input) input.focus();
  }

  document.addEventListener('toggle', (e) => {
    const d = e.target.closest && e.target.closest('[data-todos]');
    if (!d || e.target !== d) return;
    if (d.open) todoOpen.add(+d.dataset.todos); else todoOpen.delete(+d.dataset.todos);
  }, true);

  document.addEventListener('change', (e) => {
    const box = e.target.closest && e.target.closest('[data-todo-done]');
    if (box) todoChange(() => api(`/todos/${box.dataset.todoDone}`, 'PUT', { done: box.checked }));
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest && e.target.closest('[data-todo-add]');
    if (!form) return;
    e.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) return;
    const id = +form.dataset.todoAdd;
    todoChange(() => api(`/trips/${id}/todos`, 'POST', { text }), id);
  });

  document.addEventListener('click', (e) => {
    const who = e.target.closest('[data-todo-who]');
    if (who) {
      const cur = who.dataset.who, me = myName();
      if (cur && cur !== me && !confirm(`${cur} regelt dit al. Wil jij het overnemen?`)) return;
      todoChange(() => api(`/todos/${who.dataset.todoWho}`, 'PUT', { who: cur === me ? '' : me }));
      return;
    }
    const del = e.target.closest('[data-todo-del]');
    if (del) { todoChange(() => api(`/todos/${del.dataset.todoDel}`, 'DELETE')); return; }
    const def = e.target.closest('[data-todo-default]');
    if (def) {
      const id = +def.dataset.todoDefault;
      todoOpen.add(id);
      todoChange(() => api(`/trips/${id}/todos`, 'POST', { texts: TODO_DEFAULTS }));
    }
  });

  /* --- kosten delen per reis (zoals Tricount) --- */

  const costOpen = new Set();
  const centsEuro = (c) => (c / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });

  // Saldo per persoon in centen (+ = krijgt geld, - = moet betalen). De rest-centen gaan naar de eersten in de lijst.
  function costBalances(expenses) {
    const bal = new Map();
    const add = (n, c) => bal.set(n, (bal.get(n) || 0) + c);
    for (const e of expenses) {
      add(e.paid_by, e.cents);
      const share = Math.floor(e.cents / e.split.length);
      let rest = e.cents - share * e.split.length;
      for (const n of e.split) { add(n, -(share + (rest > 0 ? 1 : 0))); rest--; }
    }
    return bal;
  }

  // Zo min mogelijk overboekingen: steeds de grootste schuldenaar naar de grootste ontvanger.
  function costTransfers(bal) {
    const debt = [...bal].filter(([, c]) => c < 0).map(([n, c]) => ({ n, c: -c })).sort((a, b) => b.c - a.c);
    const cred = [...bal].filter(([, c]) => c > 0).map(([n, c]) => ({ n, c })).sort((a, b) => b.c - a.c);
    const out = [];
    while (debt.length && cred.length) {
      const d = debt[0], k = cred[0], c = Math.min(d.c, k.c);
      if (c > 0) out.push({ from: d.n, to: k.n, c });
      d.c -= c; k.c -= c;
      if (!d.c) debt.shift();
      if (!k.c) cred.shift();
    }
    return out;
  }

  function costsHtml(t) {
    const ex = t.expenses || [];
    const total = ex.reduce((s, e) => s + e.cents, 0);
    const me = myName();
    const names = state.members.map((m) => m.name);
    const transfers = costTransfers(costBalances(ex));
    const mine = costBalances(ex).get(me) || 0;
    const going = goingNames(t); // standaard alleen wie meegaat; heeft nog niemand gereageerd, dan iedereen
    return `
      <details class="todos costs" data-costs="${t.id}"${costOpen.has(t.id) ? ' open' : ''}>
        <summary><span class="cost-ico" aria-hidden="true">€</span><span>Kosten delen</span>
          <span class="todo-count">${ex.length ? centsEuro(total) : 'leeg'}</span></summary>
        ${ex.length ? `
          <div class="cost-settle">
            ${transfers.length ? `<div class="cost-head">Zo staat iedereen quitte</div>
              <ul>${transfers.map((x) => `<li class="${x.from === me || x.to === me ? 'me' : ''}">${avatar(x.from)}<strong>${esc(x.from === me ? 'Jij' : x.from)}</strong>
                <span class="cost-arrow" aria-label="betaalt aan">→</span>${avatar(x.to)}<strong>${esc(x.to === me ? 'jou' : x.to)}</strong><span class="cost-amt">${centsEuro(x.c)}</span></li>`).join('')}</ul>
              ${mine ? `<p class="cost-mine ${mine > 0 ? 'plus' : 'min'}">${mine > 0 ? `Jij krijgt nog ${centsEuro(mine)}` : `Jij moet nog ${centsEuro(-mine)} betalen`}</p>` : ''}`
              : '<p class="cost-mine plus">✓ Iedereen staat quitte</p>'}
          </div>
          <ul class="cost-list">${[...ex].reverse().map((e) => `
            <li><span class="cost-text"><strong>${esc(e.title)}</strong>
              <small>${esc(e.paid_by === me ? 'Jij' : e.paid_by)} betaalde · voor ${e.split.length === names.length && names.every((n) => e.split.includes(n)) ? 'iedereen' : esc(e.split.join(', '))}</small></span>
              <span class="cost-amt">${centsEuro(e.cents)}</span>
              <button type="button" class="todo-del" data-cost-del="${e.id}" aria-label="${esc(e.title)} verwijderen">×</button></li>`).join('')}</ul>`
          : '<p class="todo-empty">Hou bij wie wat betaalt (huis, auto, boodschappen). Reismannetje rekent uit wie wie nog hoeveel moet.</p>'}
        <form class="cost-add" data-cost-add="${t.id}">
          <div class="cost-row">
            <input name="title" maxlength="80" placeholder="Waarvoor? bijv. boodschappen" aria-label="Waarvoor" autocomplete="off" required>
            <span class="euro-in"><input name="amount" inputmode="decimal" placeholder="0,00" aria-label="Bedrag in euro" autocomplete="off" required></span>
          </div>
          <label class="cost-paid">Betaald door
            <select name="paid_by">${names.map((n) => `<option${n === me ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          <fieldset class="cost-split"><legend>Voor wie</legend>
            ${names.map((n) => `<label><input type="checkbox" name="split" value="${esc(n)}"${!going.length || going.includes(n) ? ' checked' : ''}><span>${esc(n === me ? `${n} (jij)` : n)}</span></label>`).join('')}
          </fieldset>
          <button type="submit" class="btn sm primary">${ic('plus')} Uitgave toevoegen</button>
        </form>
      </details>`;
  }

  document.addEventListener('toggle', (e) => {
    const d = e.target.closest && e.target.closest('[data-costs]');
    if (!d || e.target !== d) return;
    if (d.open) costOpen.add(+d.dataset.costs); else costOpen.delete(+d.dataset.costs);
  }, true);

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest && e.target.closest('[data-cost-add]');
    if (!form) return;
    e.preventDefault();
    const f = form.elements;
    const split = [...form.querySelectorAll('input[name=split]:checked')].map((i) => i.value);
    if (!split.length) { toast('Kies voor wie het was', true); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api(`/trips/${form.dataset.costAdd}/expenses`, 'POST', { title: f.title.value, amount: f.amount.value, paid_by: f.paid_by.value, split });
      toast('Uitgave toegevoegd ✓');
      await reload();
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });

  document.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-cost-del]');
    if (!del || !confirm('Deze uitgave verwijderen?')) return;
    try { await api(`/expenses/${del.dataset.costDel}`, 'DELETE'); await reload(); } catch (err) { toast(err.message, true); }
  });

  /* --- wie gaat er mee --- */

  const RSVP = [['ja', 'Ik ga mee'], ['misschien', 'Misschien'], ['nee', 'Ik kan niet']];
  const goingNames = (t) => (t.rsvp || []).filter((r) => r.value === 'ja').map((r) => r.name);

  function rsvpHtml(t) {
    const list = t.rsvp || [];
    const mine = (list.find((r) => r.name === myName()) || {}).value || '';
    const by = (v) => list.filter((r) => r.value === v).map((r) => r.name);
    const yes = by('ja'), maybe = by('misschien'), no = by('nee');
    const open = state.members.filter((m) => !list.some((r) => r.name === m.name)).length;
    return `
      <div class="rsvp" role="group" aria-label="Ga jij mee?">
        <div class="rsvp-btns">${RSVP.map(([v, label]) => `<button type="button" class="rsvp-btn ${v}${mine === v ? ' on' : ''}" data-rsvp="${v}" data-trip-id="${t.id}" aria-pressed="${mine === v}">${label}</button>`).join('')}</div>
        ${list.length ? `<div class="rsvp-who">
          ${yes.length ? `<span class="rsvp-faces" title="${esc(yes.join(', '))}">${yes.slice(0, 6).map((n) => avatar(n)).join('')}</span><strong>${yes.length} ${yes.length === 1 ? 'gaat' : 'gaan'} mee</strong>` : '<strong>Nog niemand zeker</strong>'}
          ${maybe.length ? `<span>· ${maybe.length} misschien</span>` : ''}${no.length ? `<span>· ${no.length} niet</span>` : ''}${open ? `<span>· ${open} nog niet gereageerd</span>` : ''}
        </div>` : ''}
      </div>`;
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rsvp]');
    if (!b) return;
    const value = b.classList.contains('on') ? '' : b.dataset.rsvp;
    b.disabled = true;
    try { await api(`/trips/${b.dataset.tripId}/rsvp`, 'PUT', { value }); await reload(); } catch (err) { toast(err.message, true); b.disabled = false; }
  });

  /* --- volgende reis: één kaartje bovenaan het kaartpaneel met alles bij elkaar --- */

  function nextTrip() {
    const today = todayIso(), me = myName();
    const up = state.trips.filter((t) => t.start_date && (t.end_date || t.start_date) >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    return up.find((t) => goingNames(t).includes(me)) || up[0] || null;
  }

  function nextTripHtml() {
    const t = nextTrip();
    if (!t) return '';
    const c = countdown(t);
    const loc = tripLocation(t);
    const img = loc && destPhoto(loc);
    const going = goingNames(t).length;
    const todos = t.todos || [];
    const bal = costBalances(t.expenses || []).get(myName()) || 0;
    const bits = [
      going ? `${going} ${going === 1 ? 'gaat' : 'gaan'} mee` : 'Wie gaat er mee?',
      todos.length ? `inpaklijst ${todos.filter((d) => d.done).length}/${todos.length}` : '',
      bal > 0 ? `jij krijgt ${centsEuro(bal)}` : bal < 0 ? `jij moet ${centsEuro(-bal)}` : '',
    ].filter(Boolean);
    return `
      <a class="next-trip" href="#reizen" data-focus-trip="${t.id}">
        <span class="next-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ic('suitcase')}</span>
        <span class="next-text"><small>Volgende reis</small><strong>${esc(t.title)}</strong>
          <span class="next-bits">${bits.map(esc).join(' · ')}</span></span>
        ${c ? `<span class="countdown${c.cls ? ' ' + c.cls : ''}">${esc(c.text)}</span>` : ''}
      </a>`;
  }

  // Vanaf het kaartje naar de reis op de Reizen-pagina scrollen en hem even laten oplichten.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-focus-trip]');
    if (!a) return;
    const id = a.dataset.focusTrip;
    setTimeout(() => {
      const card = $(`[data-trip="${id}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1600);
    }, 250);
  });
