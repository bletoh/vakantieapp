  /* ---------- kaart: de centrale plek om een reis te plannen ---------- */

  const HOME = [52.3105, 4.7683]; // Schiphol
  const HOME_CODE = 'AMS';
  const DOT_COLORS = { stay: '#e0245e', do: '#008a05', eat: '#d97706' };
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
              <span class="map-search-icon">${ic('search')}</span>
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
      sheetSwipe($('#destGrip'), {
        up: () => setListOpen(true), down: () => setListOpen(false), tap: () => setListOpen(!listOpen),
        sheet: () => (isPhone() ? $('#destSheet') : null),
      });
      setupCarousel();
    } else {
      drawMapData();
    }
    $('#planner').innerHTML = plannerHtml();
    restoreCarousel();
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
    carouselHold = Date.now() + 500;
  }

  // Ingeklapt op de telefoon staan de bestemmingen als kaartjes naast elkaar.
  // Veeg je naar een ander kaartje, dan licht die pin op en schuift de kaart er zo nodig heen.
  let carouselLeft = 0;
  let carouselQuiet = false;
  let carouselHold = 0;
  let carouselCurrent = null;

  const carouselList = () => (isPhone() && !listOpen ? $('#destSheet .dest-list') : null);

  function centeredCard(list) {
    let best = null;
    let bestDist = Infinity;
    for (const li of list.children) {
      const d = Math.abs(li.offsetLeft - 16 - list.scrollLeft);
      if (d < bestDist) { best = li; bestDist = d; }
    }
    return best;
  }

  function markCurrent(id) {
    carouselCurrent = id;
    $$('#destSheet .dest').forEach((li) => li.classList.toggle('current', +li.dataset.dest === id));
  }

  function setupCarousel() {
    let timer = null;
    $('#destSheet').addEventListener('scroll', (e) => {
      const list = e.target;
      if (!list.classList || !list.classList.contains('dest-list')) return;
      carouselLeft = list.scrollLeft;
      clearTimeout(timer);
      timer = setTimeout(() => carouselSettled(list), 140);
    }, true);
  }

  function carouselSettled(list) {
    if (carouselQuiet) { carouselQuiet = false; return; }
    if (list !== carouselList() || pinDialog.open || Date.now() < carouselHold) return;
    const li = centeredCard(list);
    const loc = li && findItem(+li.dataset.dest);
    if (!loc || loc.id === carouselCurrent) return;
    markCurrent(loc.id);
    highlightPin(loc.id);
    if (map && hasPos(loc) && !map.getBounds().pad(-0.2).contains([loc.lat, loc.lng])) {
      map.panTo([loc.lat, loc.lng], { animate: !reducedMotion(), duration: 0.6 });
    }
  }

  // Zet een kaartje vooraan zonder dat de kaart gaat schuiven.
  function scrollCarouselTo(id) {
    const list = carouselList();
    const li = list && list.querySelector(`[data-dest="${id}"]`);
    if (!li) return;
    const left = Math.max(0, Math.min(list.scrollWidth - list.clientWidth, li.offsetLeft - 16));
    if (Math.abs(left - list.scrollLeft) > 2) { carouselQuiet = true; list.scrollLeft = left; }
    markCurrent(id);
  }

  // Na opnieuw tekenen van de lijst: hetzelfde kaartje in beeld houden.
  function restoreCarousel() {
    const list = carouselList();
    if (!list) return;
    if (carouselLeft > 0) {
      list.scrollLeft = carouselLeft;
      if (list.scrollLeft > 0) carouselQuiet = true;
    }
    if (carouselCurrent) markCurrent(carouselCurrent);
  }

  // Omhoog of omlaag vegen over een greep; een tik (of Enter) doet `tap`.
  // Met `sheet` (een functie die het paneel geeft) volgt het paneel je vinger tijdens het vegen.
  function sheetSwipe(el, { up, down, tap, sheet }) {
    if (!el) return;
    let y0 = null;
    let h0 = 0;
    let target = null;
    let swiped = false;
    const release = () => {
      if (target) { target.style.height = ''; target.style.transition = ''; }
      target = null;
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('button:not(.sheet-grip), a, input')) return;
      y0 = e.clientY;
      swiped = false;
      target = sheet ? sheet() : null;
      if (target) h0 = target.getBoundingClientRect().height;
      try { el.setPointerCapture(e.pointerId); } catch { /* niet erg */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (y0 === null || !target) return;
      const dy = e.clientY - y0;
      if (Math.abs(dy) < 4) return;
      const max = target.parentElement === document.body || target.tagName === 'DIALOG'
        ? window.innerHeight - 20 : target.parentElement.getBoundingClientRect().height - 8;
      target.style.transition = 'none';
      target.style.height = `${Math.max(60, Math.min(max, h0 - dy))}px`;
    });
    el.addEventListener('pointerup', (e) => {
      if (y0 === null) return;
      const dy = e.clientY - y0;
      y0 = null;
      if (Math.abs(dy) < 24) { release(); return; }
      swiped = true;
      // Inline hoogte loslaten en tegelijk de nieuwe stand kiezen: de CSS-overgang doet de rest.
      const t = target;
      target = null;
      (dy < 0 ? up : down)();
      if (t && t.style.height !== '0px') { t.style.transition = ''; t.style.height = ''; }
    });
    el.addEventListener('pointercancel', () => { y0 = null; release(); });
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
        <span class="when-icon">${ic('calendar')}</span>
        <span><strong>Wanneer kan iedereen?</strong><small>Vul de datumprikker in, dan zie je hier de beste week.</small></span>
        <span class="when-go" aria-hidden="true">→</span></a>`;
    }
    return `<a class="when-strip" href="#datum">
      <span class="when-icon">${ic('calendar')}</span>
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
              ${stepChip(ic('calendar'), t && t.start_date && !conflict, 'Datum', conflict ? `<span class="warn">${dateText}</span>` : dateText)}
              ${stepChip(ic('plane'), p.per.flight.length, 'Vlucht', p.per.flight.length ? '✓' : '–')}
              ${stepChip(ic('bed'), p.per.stay.length, 'Overnachting', p.per.stay.length ? '✓' : '–')}
              ${p.per.do.length + p.per.eat.length ? stepChip(ic('sparkles'), true, 'Activiteiten en eten', p.per.do.length + p.per.eat.length) : ''}
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
      ${whoFilterHtml()}
      ${locs.length ? `<ol class="dest-list">${locs.filter(visibleOnMap).map(destRowHtml).join('')}</ol>` : `
        <ol class="onboarding">
          <li><strong>Kies een plek.</strong> Zoek bovenaan de kaart, of tik ergens op de kaart.</li>
          <li><strong>Plan de reis.</strong> Kies een datum uit de datumprikker, een vlucht en een hotel in de buurt.</li>
          <li><strong>Stem samen.</strong> Iedereen kan bestemmingen toevoegen en hartjes geven.</li>
        </ol>
        <button type="button" class="btn primary block" data-action="focus-search">${ic('search')} Zoek een bestemming</button>`}
      ${locs.length >= 2 ? `<button type="button" class="btn block vote-cta" data-action="new-poll">${ic('vote')} Laat de groep kiezen tussen ${locs.length} bestemmingen</button>` : ''}
      <div class="planner-foot">
        <button type="button" class="text-btn" data-action="add-place">＋ Bestemming toevoegen zonder kaart</button>
        ${locs.some(hasPos) ? '<button type="button" class="text-btn" data-action="map-fit">Toon alle pinnen</button>' : ''}
      </div>
      ${loose.length ? `
        <div class="label">Nog niet aan een bestemming gekoppeld</div>
        <ul class="linked">${loose.map(({ s: ls, it }) => `
          <li><button type="button" data-action="edit-item" data-id="${it.id}">
            <span class="chosen-icon">${kindIcon(ls.kind, ls.icon)}</span><span>${esc(it.title)}</span>
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
      html: `<div class="pin${item.is_best ? ' best' : ''}${active ? ' active' : ''}"><span>${n}</span>${item.added_by ? `<i class="pin-av" style="--c:${colorOf(item.added_by)}">${esc(initialOf(item.added_by))}</i>` : ''}</div>`,
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
          <a href="#" role="button" data-map="fit" title="Toon alle pinnen" aria-label="Toon alle pinnen">${ic('expand')}</a>
          <a href="#" role="button" data-map="layer" title="Toon satellietbeeld" aria-label="Satellietbeeld" aria-pressed="false">${ic('layers')}</a>`;
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
    // Labels daarna opnieuw meten: een verborgen label (of een nog niet geladen lettertype)
    // heeft een verkeerde breedte, en dan staat het label scheef over de pin.
    const zoomClass = () => {
      if (!map) return;
      const z = map.getZoom();
      el.classList.toggle('zoom-far', z < 5);
      el.classList.toggle('zoom-world', z < 3.5);
      for (const m of Object.values(markers)) { const t = m.getTooltip(); if (t) t.update(); }
    };
    map.on('zoomend', zoomClass);
    if (document.fonts) document.fonts.ready.then(zoomClass);

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
    for (const it of locations().filter(hasPos).filter(visibleOnMap)) {
      const t = tripsFor(it.id)[0];
      const label = `${esc(it.title)}${t && t.start_date ? `<small>${shortRange(t.start_date, t.end_date)}</small>` : it.added_by ? `<small>${esc(it.added_by)}</small>` : ''}`;
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
        title: title || 'Nieuwe plek', lat, lng, added_by: myName(),
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
    ['Dubrovnik', 'Kroatië', 42.6507, 18.0944], ['Ibiza', 'Spanje', 38.9067, 1.4206],
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
