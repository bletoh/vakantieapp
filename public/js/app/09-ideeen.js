  /* ---------- ideeën: vakantiepakketten (vlucht + schatting verblijf) voor de groep ---------- */

  // Categorieën voor een vriendengroep. 'goedkoop' volgt uit de prijzen; 'kort' en 'ver' uit de vliegtijd.
  const IDEA_CATS = [
    ['nachtleven', 'Feesten & clubs'], ['strand', 'Strand & beachclubs'], ['zon', 'Zon'], ['stad', 'Stedentrip'],
    ['goedkoop', 'Goedkoop bier & eten'], ['eten', 'Lekker eten'], ['avontuur', 'Actie & avontuur'], ['watersport', 'Watersport & surfen'],
    ['eiland', 'Eiland'], ['natuur', 'Natuur & hiken'], ['allin', 'All-inclusive'], ['wintersport', 'Wintersport & après-ski'],
    ['cultuur', 'Beetje cultuur'], ['casino', "Casino's"], ['kort', 'Korte vlucht (< 3 uur)'], ['ver', 'Verre reis'],
  ];
  const CAT_LABEL = Object.fromEntries(IDEA_CATS);
  const LEVELS = {
    budget: { label: 'Voordelig', what: 'hostel of simpel appartement', factor: 0.55 },
    mid: { label: 'Middenklasse', what: 'appartement of hotel', factor: 1 },
    luxe: { label: 'Luxe', what: 'villa of goed hotel', factor: 1.9 },
  };
  // Regio per land, voor de keuze 'Waar'.
  const REGIONS = [['all', 'Overal'], ['eu', 'Europa'], ['azie', 'Azië & Oceanië'], ['amerika', 'Amerika'], ['afrika', 'Afrika & Midden-Oosten']];
  const REGION_OF = {
    Thailand: 'azie', Vietnam: 'azie', Indonesië: 'azie', Singapore: 'azie', China: 'azie', 'Zuid-Korea': 'azie', Japan: 'azie',
    Maleisië: 'azie', Filipijnen: 'azie', 'Sri Lanka': 'azie', Malediven: 'azie', India: 'azie', Australië: 'azie',
    'Verenigde Staten': 'amerika', Mexico: 'amerika', Brazilië: 'amerika', Argentinië: 'amerika', 'Costa Rica': 'amerika',
    Colombia: 'amerika', Peru: 'amerika', Canada: 'amerika',
    Marokko: 'afrika', Egypte: 'afrika', Kaapverdië: 'afrika', Tanzania: 'afrika', 'Zuid-Afrika': 'afrika', Mauritius: 'afrika',
    Seychellen: 'afrika', 'Verenigde Arabische Emiraten': 'afrika', Macau: 'azie',
  };
  const regionOf = (d) => REGION_OF[d.c] || 'eu';
  // Keuze voor het verblijf; 'auto' = zo goed als het budget toelaat.
  const STAY_OPTS = [['budget', 'Voordelig'], ['mid', 'Middenklasse'], ['luxe', 'Luxe'], ['auto', 'Beste binnen budget']];
  const SORTS = [['match', 'Beste match'], ['price', 'Laagste prijs (vlucht + verblijf)']];
  // Zoeken zonder hoofdletters en accenten: "malaga" vindt Málaga, "indonesie" vindt Indonesië.
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const searchHit = (d, q) => fold(d.c).includes(q) || fold(d.n).includes(q);
  const PAGE = 12;
  const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const euro = (n) => `€ ${Math.round(n).toLocaleString('nl-NL')}`;

  let destinations = null;
  const ideaCtx = { list: [], airports: new Map(), limit: PAGE };

  async function loadDestinations() {
    if (!destinations) destinations = await fetch('/data/bestemmingen.json').then((r) => r.json());
    return destinations;
  }

  // Standaard zoveel personen als er namen bekend zijn (datumprikker, stemrondes), anders vier.
  const defaultPersons = () => (knownPeople().length >= 2 ? knownPeople().length : 4);

  function ideaPrefs() {
    let p = {};
    try { p = JSON.parse(store.get('ideas') || '{}'); } catch { /* standaard */ }
    const cats = (Array.isArray(p.cats) ? p.cats : []).filter((c) => CAT_LABEL[c]);
    return {
      cats, month: p.month || 'poll', days: +p.days || pollSettings().days, budget: +p.budget || 0,
      region: REGIONS.some(([k]) => k === p.region) ? p.region : 'all',
      stay: STAY_OPTS.some(([k]) => k === p.stay) ? p.stay : 'mid',
      sort: SORTS.some(([k]) => k === p.sort) ? p.sort : 'match',
      q: typeof p.q === 'string' ? p.q.slice(0, 60) : '',
      persons: Math.min(30, Math.max(1, +p.persons || defaultPersons())),
    };
  }
  const saveIdeaPrefs = (p) => store.set('ideas', JSON.stringify(p));

  // Beste periode uit de datumprikker, als die er is.
  const pollWindow = () => bestWindows(availabilityMap(), pollSettings())[0] || null;

  // Welke maand telt mee voor het weer (0-11), of null.
  function ideaMonth(p) {
    if (p.month === 'any') return null;
    if (p.month === 'poll') {
      const w = pollWindow();
      return w ? toDate(w.start).getUTCMonth() : toDate(pollSettings().start).getUTCMonth();
    }
    return toDate(`${p.month}-01`).getUTCMonth();
  }

  // Datums voor de reis als je een pakket op de kaart zet: de beste periode, als die in de gekozen maand valt.
  function ideaDates(p) {
    const w = pollWindow();
    if (!w) return null;
    if (p.month === 'poll' || p.month === 'any' || w.start.slice(0, 7) === p.month) return { start_date: w.start, end_date: w.end };
    return null;
  }

  // Hoe fijn is het weer voor wat je zoekt (0-1)?
  function weatherScore(d, m, cats) {
    if (m === null) return null;
    const t = d.temp[m];
    const parts = [];
    if (cats.includes('wintersport')) parts.push(d.t.includes('wintersport') && [11, 0, 1, 2, 3].includes(m) ? 1 : 0);
    if (cats.some((c) => ['strand', 'zon', 'watersport', 'eiland'].includes(c))) {
      parts.push(t >= 26 && t <= 33 ? 1 : t > 33 && t <= 36 ? 0.6 : t > 36 ? 0.25 : t >= 23 ? 0.7 : t >= 20 ? 0.35 : 0);
    }
    if (cats.some((c) => ['natuur', 'avontuur'].includes(c))) parts.push(t >= 12 && t <= 27 ? 1 : (t >= 6 && t < 12) || (t > 27 && t <= 31) ? 0.6 : 0.2);
    if (!parts.length) parts.push(t >= 16 && t <= 28 ? 1 : (t >= 10 && t < 16) || (t > 28 && t <= 32) ? 0.6 : 0.25);
    const score = parts.reduce((a, b) => a + b, 0) / parts.length;
    // In het regenseizoen (moesson, orkanen) is het warm maar nat: minder geschikt.
    return isRainy(d, m) ? score * 0.5 : score;
  }

  // Kosten: vlucht p.p. plus verblijf. Met meer mensen deel je een appartement of villa en wordt
  // het per persoon goedkoper; alleen betaal je een hele kamer.
  function ideaCost(d, p) {
    const n = p.persons;
    const nights = Math.max(1, p.days - 1);
    const share = n === 1 ? 1.6 : n >= 6 ? 0.8 : n >= 4 ? 0.9 : 1;
    const calc = (level) => {
      const nightPP = d.h * LEVELS[level].factor * share;
      const stayPP = nightPP * nights;
      return { level, nights, persons: n, nightPP, stayPP, stayGroup: stayPP * n, flightPP: d.f, totalPP: d.f + stayPP, totalGroup: (d.f + stayPP) * n };
    };
    if (p.stay !== 'auto') {
      const c = calc(p.stay);
      return { ...c, over: !!p.budget && c.totalPP > p.budget };
    }
    // Bij "laagste prijs" zonder vaste keuze: het voordeligste verblijf.
    if (p.sort === 'price') return { ...calc('budget'), over: !!p.budget && calc('budget').totalPP > p.budget };
    if (!p.budget) return { ...calc('mid'), over: false };
    for (const level of ['luxe', 'mid', 'budget']) { const c = calc(level); if (c.totalPP <= p.budget) return { ...c, over: false }; }
    return { ...calc('budget'), over: true };
  }

  const isRainy = (d, m) => m !== null && Array.isArray(d.r) && d.r.includes(m);
  const tagsOf = (d) => [...d.t, ...(d.h <= 50 ? ['goedkoop'] : []), ...(d.cas && !d.t.includes('casino') ? ['casino'] : [])];

  function rankIdeas(p) {
    const m = ideaMonth(p);
    const wish = p.cats.filter((c) => c !== 'kort' && c !== 'ver');
    // Zoek je op een land of plek, dan telt alleen dat; regio en wensen bepalen dan alleen de volgorde.
    const q = fold(p.q);
    const ranked = destinations.map((d) => {
      if (q && !searchHit(d, q)) return null;
      if (!q && p.region !== 'all' && regionOf(d) !== p.region) return null;
      const km = distanceKm(HOME, [d.lat, d.lng]);
      const hours = km / 800 + 0.5;
      if (!q && p.cats.includes('kort') && hours > 3.5) return null;
      if (!q && p.cats.includes('ver') && hours < 6) return null;
      const tags = tagsOf(d);
      const matched = wish.filter((c) => tags.includes(c));
      if (!q && wish.length && !matched.length) return null;
      if (!q && wish.includes('wintersport') && !tags.includes('wintersport')) return null;
      const cost = ideaCost(d, p);
      if (cost.over && cost.totalPP > p.budget * 1.15) return null;
      const match = wish.length ? matched.length / wish.length : 0.6;
      const weather = weatherScore(d, m, wish);
      let score = weather === null ? match : 0.6 * match + 0.4 * weather;
      score += groupScoreDelta(d, hours);
      // Casino's: de beste (Las Vegas, Macau, Monte-Carlo) bovenaan.
      if (wish.includes('casino') && d.cas) score += (d.cas[0] - 2) * 0.12;
      if (cost.over) score -= 0.15;
      // score is het matchpercentage (max 100%); rank telt ook mee boven de 100% voor de volgorde.
      return { d, km, matched, weather, month: m, cost, score: Math.max(0, Math.min(1, score)), rank: score, pin: nearbyPin(d) };
    }).filter(Boolean);
    // Laagste prijs: gewoon van goedkoop naar duur, zonder spreiding over landen.
    if (p.sort === 'price') return ranked.sort((a, b) => a.cost.totalPP - b.cost.totalPP || b.rank - a.rank);
    ranked.sort((a, b) => b.rank - a.rank || a.cost.totalPP - b.cost.totalPP);
    // Spreiding: bovenaan hooguit twee per land, de rest schuift door naar achteren.
    const perCountry = new Map();
    const first = [];
    const later = [];
    for (const x of ranked) {
      const n = perCountry.get(x.d.c) || 0;
      (n < 2 ? first : later).push(x);
      perCountry.set(x.d.c, n + 1);
    }
    return [...first, ...later];
  }

  function monthOptions(p) {
    const w = pollWindow();
    const now = new Date();
    const opts = [`<option value="poll"${p.month === 'poll' ? ' selected' : ''}>${w ? `Beste periode (${shortRange(w.start, w.end)})` : 'Periode van de datumprikker'}</option>`];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const v = isoOf(d).slice(0, 7);
      opts.push(`<option value="${v}"${p.month === v ? ' selected' : ''}>${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}</option>`);
    }
    opts.push(`<option value="any"${p.month === 'any' ? ' selected' : ''}>Maakt niet uit</option>`);
    return opts.join('');
  }

  function ideasHtml() {
    const p = ideaPrefs();
    return `
      <div class="section-head">
        <h2>Ideeën</h2>
        <p class="section-intro">Met hoeveel zijn jullie en waar hebben jullie zin in? Je krijgt bestemmingen met een vlucht vanaf Schiphol en een schatting van het verblijf voor de hele groep.</p>
      </div>
      <div class="idea-search">
        ${ic('search')}
        <input id="ideaSearch" type="search" aria-label="Zoek een land of plek" list="ideaPlaces" placeholder="Zoek een land of plek, bijv. Spanje of Bali" value="${esc(p.q)}" autocomplete="off" enterkeyhint="search">
        <button type="button" class="icon-btn sm" data-idea-clear aria-label="Zoekopdracht wissen"${p.q ? '' : ' hidden'}>✕</button>
        <datalist id="ideaPlaces"></datalist>
      </div>
      <div class="idea-bar">
        <button type="button" class="btn idea-filter-btn" data-idea-filters aria-expanded="${ideaFiltersOpen()}" aria-controls="ideaFilters">
          ${ic('sliders')} Filters <span class="filter-count" id="ideaFilterCount"></span><span class="chev" aria-hidden="true">▾</span>
        </button>
        <label class="idea-sort"><span class="sr-only">Sorteren</span><select id="ideaSort">
          ${SORTS.map(([k, label]) => `<option value="${k}"${p.sort === k ? ' selected' : ''}>${esc(k === 'price' ? 'Laagste prijs' : label)}</option>`).join('')}
        </select></label>
      </div>
      <p class="idea-summary" id="ideaSummary"></p>
      <div class="idea-filters" id="ideaFilters"${ideaFiltersOpen() ? '' : ' hidden'}>
        <div class="idea-opts">
          <label class="idea-when">Wanneer<select id="ideaMonth">${monthOptions(p)}</select></label>
          <label>Personen
            <span class="stepper">
              <button type="button" data-persons="-1" aria-label="Eén persoon minder">−</button>
              <input id="ideaPersons" type="number" min="1" max="30" inputmode="numeric" value="${p.persons}">
              <button type="button" data-persons="1" aria-label="Eén persoon meer">+</button>
            </span>
          </label>
          <label>Dagen<input id="ideaDays" type="number" min="2" max="30" inputmode="numeric" value="${p.days}"></label>
          <label><span>Budget p.p. <small>incl. verblijf</small></span><span class="euro"><input id="ideaBudget" type="number" min="0" step="50" inputmode="numeric" placeholder="Geen max" value="${p.budget || ''}"></span></label>
        </div>
        <p class="mini-label idea-cats-label">Verblijf</p>
        <div class="idea-cats" role="radiogroup" aria-label="Verblijf">
          ${STAY_OPTS.map(([k, label]) => `<button type="button" class="cat" role="radio" data-stay="${k}" aria-checked="${p.stay === k}" aria-pressed="${p.stay === k}">${esc(label)}</button>`).join('')}
        </div>
        <p class="mini-label idea-cats-label">Waar naartoe?${p.q ? ' <small class="idea-q-note">(zoekopdracht gaat voor)</small>' : ''}</p>
        <div class="idea-cats idea-regions" role="radiogroup" aria-label="Regio">
          ${REGIONS.map(([k, label]) => `<button type="button" class="cat" role="radio" data-region="${k}" aria-checked="${p.region === k}" aria-pressed="${p.region === k}">${esc(label)}</button>`).join('')}
        </div>
        <p class="mini-label idea-cats-label">Waar hebben jullie zin in?</p>
        <div class="idea-cats" role="group" aria-label="Waar hebben jullie zin in?">
          ${IDEA_CATS.map(([k, label]) => `<button type="button" class="cat" data-cat="${k}" aria-pressed="${p.cats.includes(k)}">${esc(label)}</button>`).join('')}
        </div>
        <button type="button" class="btn block idea-filters-done" data-idea-filters>Klaar</button>
      </div>
      <div id="ideaResults" class="idea-results" aria-live="polite"><p class="hint loading-dots">Bestemmingen laden</p></div>`;
  }

  // Filters zijn ingeklapt; eronder een korte samenvatting van wat er aan staat.
  const ideaFiltersOpen = () => store.get('ideaFilters') === 'open';
  function updateIdeaSummary(p) {
    const sum = $('#ideaSummary');
    if (!sum) return;
    const month = p.month === 'any' ? 'elke maand' : p.month === 'poll' ? 'beste periode' : MONTHS[toDate(`${p.month}-01`).getUTCMonth()];
    const bits = [`${p.persons} ${p.persons === 1 ? 'persoon' : 'personen'}`, `${p.days} dagen`, month,
      STAY_OPTS.find(([k]) => k === p.stay)[1].toLowerCase(), p.budget ? `max ${euro(p.budget)} p.p.` : '',
      p.region !== 'all' ? REGIONS.find(([k]) => k === p.region)[1] : '', ...p.cats.map((c) => CAT_LABEL[c])].filter(Boolean);
    sum.textContent = bits.join(' · ');
    const n = p.cats.length + (p.region !== 'all') + (p.budget > 0) + (p.stay !== 'mid') + (p.month !== 'poll');
    $('#ideaFilterCount').textContent = n ? String(n) : '';
  }

  async function renderIdeaResults() {
    const box = $('#ideaResults');
    if (!box) return;
    updateIdeaSummary(ideaPrefs());
    try { await loadDestinations(); } catch { box.innerHTML = '<p class="hint">De bestemmingen konden niet geladen worden.</p>'; return; }
    const p = ideaPrefs();
    const all = rankIdeas(p);
    ideaCtx.list = all.slice(0, ideaCtx.limit);
    const m = ideaMonth(p);
    const dl = $('#ideaPlaces');
    if (dl && !dl.childElementCount) {
      const names = [...new Set(destinations.map((d) => d.c))].sort((a, b) => a.localeCompare(b, 'nl'));
      dl.innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
    }
    if (p.q) {
      const n = all.length;
      box.innerHTML = `
        <p class="hint">${n ? `${n} ${n === 1 ? 'bestemming' : 'bestemmingen'} voor “${esc(p.q)}”${p.sort === 'price' ? ', goedkoopste eerst' : ''}.` : ''}</p>
        ${ideaCtx.list.map((x, i) => packageHtml(x, i, p, m)).join('')}
        ${!n ? `<div class="empty"><p>Geen bestemming gevonden voor “${esc(p.q)}”${p.budget ? ' binnen het budget' : ''}. ${p.budget ? 'Verhoog het budget of kies een ander verblijf. ' : ''}Staat het niet in de lijst? <a href="#kaart">Zoek het op de kaart</a> en zet het daar neer.</p></div>` : ''}
        ${all.length > ideaCtx.list.length ? `<button type="button" class="btn block idea-more" data-idea-more>Meer bestemmingen tonen (nog ${all.length - ideaCtx.list.length})</button>` : ''}`;
      ideaCtx.list.forEach((x, i) => fillPackage(x, i));
      return;
    }
    box.innerHTML = `
      ${!p.cats.length ? '<p class="hint">Nog niets aangetikt: dit zijn bestemmingen met lekker weer in die periode. Tik hierboven aan waar jullie zin in hebben voor betere tips.</p>' : ''}
      ${ideaCtx.list.length ? ideaCtx.list.map((x, i) => packageHtml(x, i, p, m)).join('')
        : '<div class="empty"><p>Geen bestemming die bij alles past. Haal een wens weg of verhoog het budget.</p></div>'}
      ${all.length > ideaCtx.list.length ? `<button type="button" class="btn block idea-more" data-idea-more>Meer bestemmingen tonen (nog ${all.length - ideaCtx.list.length})</button>` : ''}
      ${ideaCtx.list.length ? `<p class="fineprint">Verblijf: echte prijzen van Airbnb (hele woning voor ${p.persons} ${p.persons === 1 ? 'persoon' : 'personen'}, ${esc(shortRange(ideaStayDates(p).checkin, ideaStayDates(p).checkout))}, incl. kosten), zodra het kaartje in beeld is. Vlucht: ${priceStatus && priceStatus.flights ? 'echte prijzen (Aviasales), de goedkoopste retour die de afgelopen dagen gevonden is' : 'een schatting'}. De volgorde is op basis van de schatting.</p>` : ''}`;
    ideaCtx.list.forEach((x, i) => fillPackage(x, i));
  }

  function packageHtml(x, i, p, m) {
    const { d, cost } = x;
    const n = cost.persons;
    const trip = ideaTrip();
    return `
      <article class="pkg" data-pkg="${i}">
        <div class="pkg-img">${ideaImgHtml(d)}<span class="pkg-score">${Math.round(x.score * 100)}% match</span></div>
        <div class="pkg-body">
          <div class="pkg-head">
            <h3>${esc(d.n)}${d.c !== d.n ? ` <small>${esc(d.c)}</small>` : ''}</h3>
            <span class="pkg-pp"><strong class="pkg-pp-val">± ${euro(cost.totalPP)} p.p.</strong><small>incl. vlucht en verblijf</small></span>
          </div>
          ${x.pin ? '<span class="pkg-on">Staat al op de kaart</span>' : ''}
          <div class="pkg-why">
            ${x.matched.map((c) => `<span class="chip">${esc(CAT_LABEL[c])}</span>`).join('')}
            ${m !== null ? `<span class="chip weather">± ${d.temp[m]}° in ${MONTHS[m]}</span>` : ''}
            ${isRainy(d, m) ? '<span class="chip rain">Regenseizoen</span>' : ''}
          </div>
          ${p.cats.includes('casino') && d.cas ? `<p class="pkg-casino">🎰 ${'★'.repeat(d.cas[0])} ${esc(d.cas[1])}</p>` : ''}
          ${groupFeelHtml(x)}
          <div class="pkg-block">
            <div class="pkg-line">${ic('plane')}<span><strong>Vlucht</strong> <span class="pkg-flight">vanaf Schiphol · ± ${flightTime(x.km)}</span></span></div>
            <div class="pkg-price"><span class="pkg-flight-label">retour, ${n} ${n === 1 ? 'persoon' : 'personen'} · schatting</span><span class="pkg-flight-price">± ${euro(cost.flightPP * n)}</span></div>
            <p class="pkg-links pkg-flight-links"></p>
          </div>
          <div class="pkg-block">
            <div class="pkg-line">${ic('bed')}<span><strong>Verblijf</strong> · ${LEVELS[cost.level].label.toLowerCase()} (${LEVELS[cost.level].what})</span></div>
            <div class="pkg-price"><span class="pkg-stay-label">${cost.nights} ${cost.nights === 1 ? 'nacht' : 'nachten'}, ${n} ${n === 1 ? 'persoon' : 'personen'} · <span class="loading-dots">echte prijs ophalen</span></span><span class="pkg-stay-price">± ${euro(cost.stayGroup)}</span></div>
            <p class="pkg-links pkg-stay-links"><a href="${bookingGroupUrl(d, trip, n)}" target="_blank" rel="noopener">Verblijf zoeken voor ${n} ${n === 1 ? 'persoon' : 'personen'} ↗</a></p>
          </div>
          <div class="pkg-foot">
            <div class="pkg-total"><strong class="pkg-total-group">± ${euro(cost.totalGroup)} voor de groep</strong>
              <small><span class="pkg-total-pp">± ${euro(cost.totalPP)} p.p.</span> incl. verblijf · ${p.days} dagen${cost.over ? ' · <span class="warn">net boven budget</span>' : ''}</small></div>
            ${x.pin ? `<a class="btn" href="#pin-${x.pin.id}">Bekijk op de kaart</a>`
              : `<button type="button" class="btn primary" data-idea-add="${i}">${ic('pin')} Zet op de kaart</button>`}
          </div>
        </div>
      </article>`;
  }

  // Vaste, met de hand gecontroleerde foto per bestemming (Wikimedia Commons, in bestemmingen.json).
  // Wikimedia levert alleen vaste breedtes (o.a. 500 en 960 pixels); andere maten geven een fout.
  function ideaImgHtml(d) {
    if (!d.img) return '';
    const big = d.img.replace('/500px-', '/960px-');
    return `<img src="${esc(d.img)}" srcset="${esc(d.img)} 500w, ${esc(big)} 960w"
      sizes="(max-width: 600px) 100vw, 380px" alt="${esc(d.n)}" loading="lazy" onerror="this.remove()">`;
  }

  // Booking-zoekopdracht voor de hele groep (kamers voor twee, datums als die bekend zijn).
  function bookingGroupUrl(d, trip, n) {
    const place = d.n.replace(/\s*\(.*\)$/, '');
    const qs = new URLSearchParams({ ss: d.c && d.c !== d.n ? `${place}, ${d.c}` : place, group_adults: n, no_rooms: Math.max(1, Math.ceil(n / 2)), group_children: 0 });
    if (trip && trip.start_date) { qs.set('checkin', trip.start_date); qs.set('checkout', trip.end_date > trip.start_date ? trip.end_date : addDays(trip.start_date, 1)); }
    return `https://www.booking.com/searchresults.nl.html?${qs}`;
  }

  // Het dichtstbijzijnde vliegveld (lijst op de server, dus snel) met zoeklinks voor de hele groep.
  async function fillPackage(x, i) {
    const key = x.d.n;
    const airports = ideaCtx.airports.get(key) || await findAirports({ lat: x.d.lat, lng: x.d.lng }).catch(() => []);
    ideaCtx.airports.set(key, airports);
    const card = $(`.pkg[data-pkg="${i}"]`);
    if (!card || ideaCtx.list[i] !== x) return;
    const a = airports[0];
    if (!a) return;
    const n = x.cost.persons;
    const trip = ideaTrip();
    $('.pkg-flight', card).textContent = `${HOME_CODE} → ${a.iata} · ± ${flightTime(distanceKm(HOME, a.pos))}`;
    $('.pkg-flight-links', card).innerHTML = `
      <a href="${flightsUrl(a.iata, trip)}" target="_blank" rel="noopener">Google Flights ↗</a>
      <a href="${skyscannerUrl(a.iata, trip)}?adultsv2=${n}" target="_blank" rel="noopener">Skyscanner voor ${n} ↗</a>`;
    x.iatas = airports.slice(0, 3).map((ap) => ap.iata);
    watchRealPrices(card, x, i);
  }

  /* --- echte prijzen: Airbnb voor het verblijf, Aviasales voor de vlucht (als er een token is) --- */

  // Datums waarvoor we prijzen opvragen: de beste periode als die past, anders midden in de gekozen maand,
  // anders over zes weken.
  function ideaStayDates(p) {
    const w = ideaDates(p);
    const nights = Math.max(1, p.days - 1);
    let checkin = w ? w.start_date : /^\d{4}-\d{2}$/.test(p.month) ? `${p.month}-15` : null;
    const soon = addDays(todayIso(), 14);
    if (!checkin) checkin = addDays(todayIso(), 42);
    else if (checkin < soon) checkin = soon;
    return { checkin, checkout: addDays(checkin, nights), nights };
  }

  let priceStatus = null;
  // "Transavia, direct" of "easyJet, 1 overstap"; bij een prijs uit dezelfde maand ook de echte datums.
  const AIRLINES = { HV: 'Transavia', KL: 'KLM', U2: 'easyJet', FR: 'Ryanair', VY: 'Vueling', TB: 'TUI', OR: 'TUI', W6: 'Wizz Air', A3: 'Aegean', TP: 'TAP', IB: 'Iberia', AZ: 'ITA', LH: 'Lufthansa', BA: 'British Airways', TK: 'Turkish Airlines', PC: 'Pegasus', EK: 'Emirates', QR: 'Qatar Airways', SN: 'Brussels Airlines', LX: 'Swiss', OS: 'Austrian', AF: 'Air France', UX: 'Air Europa', DY: 'Norwegian', D8: 'Norwegian', SK: 'SAS', EW: 'Eurowings', XQ: 'SunExpress', CY: 'Cyprus Airways', KM: 'KM Malta', OU: 'Croatia Airlines', JU: 'Air Serbia', MS: 'EgyptAir', AT: 'Royal Air Maroc', DL: 'Delta', UA: 'United', AA: 'American' };
  function flightNote(f, approx) {
    const bits = [AIRLINES[f.airline] || f.airline, f.transfers === 0 ? 'direct' : f.transfers ? `${f.transfers} overstap${f.transfers > 1 ? 'pen' : ''}` : ''].filter(Boolean);
    const when = approx && f.departAt ? ` · ${shortRange(f.departAt.slice(0, 10), (f.returnAt || f.departAt).slice(0, 10))}` : '';
    return `(${bits.join(', ')}${when})`;
  }
  const priceObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      priceObserver.unobserve(e.target);
      const job = e.target.__prices;
      if (job) job();
    }
  }, { rootMargin: '300px 0px' }) : null;

  // Pas ophalen als het kaartje (bijna) in beeld is: dan hoeven we Airbnb niet voor alles tegelijk te vragen.
  function watchRealPrices(card, x, i) {
    card.__prices = () => fillRealPrices(card, x, i);
    if (priceObserver) priceObserver.observe(card); else card.__prices();
  }

  async function fillRealPrices(card, x, i) {
    const p = ideaPrefs();
    const n = x.cost.persons;
    const { checkin, checkout } = ideaStayDates(p);
    const range = shortRange(checkin, checkout);
    if (!priceStatus) priceStatus = await api('/prices/status').catch(() => ({ flights: false }));
    const qs = new URLSearchParams({ lat: x.d.lat, lng: x.d.lng, checkin, checkout, adults: n });
    const [stay, flight] = await Promise.all([
      api(`/prices/stay?${qs}`).catch(() => null),
      // De drie dichtstbijzijnde vliegvelden proberen (Lloret: Girona, Barcelona…) en de goedkoopste nemen.
      priceStatus.flights && x.iatas && x.iatas.length ? Promise.all(x.iatas.map((iata) => api(`/prices/flight?${new URLSearchParams({ destination: iata, depart: checkin, ret: checkout })}`).catch(() => null)))
        .then((rs) => rs.filter((r) => r && r.cheapest).sort((a, b) => (a.approx - b.approx) || a.cheapest.price - b.cheapest.price)[0] || null) : null,
    ]);
    if (!card.isConnected || ideaCtx.list[i] !== x) return;
    const c = x.cost;
    x.real = {};
    if (stay && stay.levels) {
      c.stayGroup = stay.levels[c.level] || stay.levels.mid;
      c.stayPP = c.stayGroup / n;
      x.real.stay = stay;
      $('.pkg-stay-label', card).innerHTML = `${stay.nights} ${stay.nights === 1 ? 'nacht' : 'nachten'} (${esc(range)}), ${n} ${n === 1 ? 'persoon' : 'personen'} · <span class="real">echte prijs Airbnb</span>`;
      $('.pkg-stay-price', card).textContent = euro(c.stayGroup);
      $('.pkg-stay-links', card).insertAdjacentHTML('afterbegin', `<a href="${esc(stay.url)}" target="_blank" rel="noopener">${stay.count} Airbnb's vanaf ${euro(stay.levels.min)} ↗</a> `);
    } else {
      $('.pkg-stay-label', card).innerHTML = `${c.nights} ${c.nights === 1 ? 'nacht' : 'nachten'}, ${n} ${n === 1 ? 'persoon' : 'personen'} · schatting`;
    }
    const f = flight && flight.cheapest;
    if (f) {
      c.flightPP = f.price;
      x.real.flight = flight;
      $('.pkg-flight-label', card).innerHTML = `retour, ${n} ${n === 1 ? 'persoon' : 'personen'} · <span class="real">echte prijs</span> ${esc(flightNote(f, flight.approx))}`;
      if (x.iatas[0] !== flight.destination) $('.pkg-flight', card).textContent = `${HOME_CODE} → ${flight.destination} · goedkoopste vliegveld in de buurt`;
      $('.pkg-flight-price', card).textContent = euro(f.price * n);
      if (f.link) $('.pkg-flight-links', card).insertAdjacentHTML('afterbegin', `<a href="${esc(f.link)}" target="_blank" rel="noopener">Deze vlucht (${esc(f.airline)}) ↗</a> `);
    }
    c.totalPP = c.flightPP + c.stayPP;
    c.totalGroup = c.totalPP * n;
    const sure = x.real.stay && x.real.flight;
    const pre = sure ? '' : '± ';
    $('.pkg-pp-val', card).textContent = `${pre}${euro(c.totalPP)} p.p.`;
    $('.pkg-total-group', card).textContent = `${pre}${euro(c.totalGroup)} voor de groep`;
    $('.pkg-total-pp', card).textContent = `${pre}${euro(c.totalPP)} p.p.`;
  }

  const ideaTitle = (d) => (d.c && d.c !== d.n ? `${d.n}, ${d.c}` : d.n);
  const googleReviewsUrl = (name, city) => `https://www.google.com/search?q=${encodeURIComponent(`${name} ${city} reviews`)}`;

  // Oordeel van de groep over een verblijf dat al eens is toegevoegd (score, tekst en wie).
  function groupReview(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    for (const s of sectionsOfKind('stay')) {
      const it = s.items.find((x) => x.title.trim().toLowerCase() === n && (x.rating || lines(x.pros).length));
      if (it) return { rating: it.rating || 0, text: lines(it.pros)[0] || '', by: it.added_by || '' };
    }
    return null;
  }

  // Een reis-achtig object voor de zoeklinks (datums uit de datumprikker als die passen).
  function ideaTrip() {
    const dts = ideaDates(ideaPrefs());
    return dts ? { start_date: dts.start_date, end_date: dts.end_date } : null;
  }

  // Eén tik: bestemming als pin met de vlucht en een reis; de schatting voor het verblijf staat in de toelichting.
  async function addIdea(i) {
    const x = ideaCtx.list[i];
    if (!x) return;
    const p = ideaPrefs();
    const by = myName();
    const c = x.cost;
    // "±" alleen bij een schatting; echte prijzen (Airbnb, Aviasales) zonder.
    const fl = x.real && x.real.flight ? '' : '± ';
    const st = x.real && x.real.stay ? '' : '± ';
    let loc = nearbyPin(x.d);
    if (!loc) {
      const section = mapSection();
      if (!section) throw new Error('Er is nog geen kaart-tab');
      const { id } = await api(`/sections/${section.id}/items`, 'POST', { title: ideaTitle(x.d), lat: x.d.lat, lng: x.d.lng, added_by: by });
      await reload();
      loc = findItem(id);
    }
    const trip = ideaTrip();
    const a = (ideaCtx.airports.get(x.d.n) || [])[0];
    if (a && !linkedOfKind(loc.id, 'flight').length) {
      const s = await ensureSection('flight');
      await api(`/sections/${s.id}/items`, 'POST', {
        title: `Amsterdam → ${a.name} (${a.iata})`,
        subtitle: `${HOME_CODE} → ${a.iata} · ± ${flightTime(distanceKm(HOME, a.pos))} vliegen`,
        body: `Per persoon: vlucht retour ${fl}${euro(c.flightPP)} + verblijf ${st}${euro(c.stayPP)} (${x.real && x.real.stay ? 'echte Airbnb-prijs' : LEVELS[c.level].label.toLowerCase()}, ${c.nights} ${c.nights === 1 ? 'nacht' : 'nachten'}) = ${fl || st}${euro(c.totalPP)}.\n`
          + `Voor de groep van ${c.persons}: ± ${euro(c.totalGroup)}. Zoek de echte prijs op via de link.`,
        price: `${fl || st}${euro(c.totalPP)} p.p. incl. verblijf`,
        link: flightsUrl(a.iata, trip),
        location_id: loc.id,
        added_by: by,
      });
    }
    await reload();
    const note = `${fl || st ? 'Schatting' : 'Prijs'}: ${fl || st}${euro(c.totalPP)} p.p. incl. verblijf (vlucht ${fl}${euro(c.flightPP)} + verblijf ${st}${euro(c.stayPP)}, `
      + `${LEVELS[c.level].label.toLowerCase()}, ${c.nights} ${c.nights === 1 ? 'nacht' : 'nachten'}). `
      + `Voor de groep van ${c.persons}: ± ${euro(c.totalGroup)}.`;
    const existing = tripsFor(loc.id)[0];
    await syncTrip(findItem(loc.id), { ...(ideaDates(p) || {}), ...(!existing || !existing.note ? { note } : {}) });
    toast(`${x.d.n} staat op de kaart ✓`);
    location.hash = `#pin-${loc.id}`;
  }

  // Bediening van de ideeën-tab.
  document.addEventListener('click', async (e) => {
    const region = e.target.closest('[data-region]');
    if (region) {
      const p = ideaPrefs();
      p.region = region.dataset.region;
      saveIdeaPrefs(p);
      $$('[data-region]').forEach((b) => { const on = b.dataset.region === p.region; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); });
      ideaCtx.limit = PAGE;
      renderIdeaResults();
      return;
    }
    if (e.target.closest('[data-idea-filters]')) {
      const panel = $('#ideaFilters');
      const open = panel.hidden;
      panel.hidden = !open;
      store.set('ideaFilters', open ? 'open' : 'closed');
      $('.idea-filter-btn').setAttribute('aria-expanded', String(open));
      if (!open) $('.idea-filter-btn').scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    const choice = e.target.closest('[data-stay], [data-sort]');
    if (choice) {
      const key = choice.dataset.stay ? 'stay' : 'sort';
      const p = ideaPrefs();
      p[key] = choice.dataset[key];
      saveIdeaPrefs(p);
      $$(`[data-${key}]`).forEach((b) => { const on = b.dataset[key] === p[key]; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); });
      ideaCtx.limit = PAGE;
      renderIdeaResults();
      return;
    }
    if (e.target.closest('[data-idea-clear]')) {
      const p = ideaPrefs(); p.q = ''; saveIdeaPrefs(p);
      $('#ideaSearch').value = '';
      e.target.closest('[data-idea-clear]').hidden = true;
      $('.idea-q-note')?.remove();
      ideaCtx.limit = PAGE;
      renderIdeaResults();
      return;
    }
    if (e.target.closest('[data-idea-more]')) {
      const y = window.scrollY;
      ideaCtx.limit += PAGE;
      await renderIdeaResults();
      window.scrollTo({ top: y });
      return;
    }
    const cat = e.target.closest('.idea-cats .cat[data-cat]');
    if (cat) {
      ideaCtx.limit = PAGE;
      const p = ideaPrefs();
      const k = cat.dataset.cat;
      p.cats = p.cats.includes(k) ? p.cats.filter((c) => c !== k) : [...p.cats, k];
      if (k === 'kort') p.cats = p.cats.filter((c) => c !== 'ver');
      if (k === 'ver') p.cats = p.cats.filter((c) => c !== 'kort');
      saveIdeaPrefs(p);
      $$('.idea-cats .cat').forEach((b) => b.setAttribute('aria-pressed', String(p.cats.includes(b.dataset.cat))));
      renderIdeaResults();
      return;
    }
    const step = e.target.closest('[data-persons]');
    if (step) {
      const input = $('#ideaPersons');
      input.value = Math.min(30, Math.max(1, (parseInt(input.value, 10) || 1) + +step.dataset.persons));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const add = e.target.closest('[data-idea-add]');
    if (add) {
      add.disabled = true;
      add.innerHTML = 'Bezig…';
      try { await addIdea(+add.dataset.ideaAdd); } catch (err) { toast(err.message, true); add.disabled = false; add.textContent = 'Zet op de kaart'; }
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'ideaSort') {
      const p = ideaPrefs(); p.sort = e.target.value; saveIdeaPrefs(p); ideaCtx.limit = PAGE; renderIdeaResults();
    }
    if (e.target.id === 'ideaMonth') {
      const p = ideaPrefs(); p.month = e.target.value; saveIdeaPrefs(p); renderIdeaResults();
    }
  });
  let ideaTimer = null;
  document.addEventListener('input', (e) => {
    if (e.target.id === 'ideaSearch') {
      clearTimeout(ideaTimer);
      ideaTimer = setTimeout(() => {
        const p = ideaPrefs();
        p.q = e.target.value.trim().slice(0, 60);
        saveIdeaPrefs(p);
        $('[data-idea-clear]').hidden = !p.q;
        const label = $('.idea-regions')?.previousElementSibling;
        if (label) label.innerHTML = `Waar naartoe?${p.q ? ' <small class="idea-q-note">(zoekopdracht gaat voor)</small>' : ''}`;
        ideaCtx.limit = PAGE;
        renderIdeaResults();
      }, 250);
      return;
    }
    if (!['ideaDays', 'ideaBudget', 'ideaPersons'].includes(e.target.id)) return;
    clearTimeout(ideaTimer);
    ideaTimer = setTimeout(() => {
      const p = ideaPrefs();
      const days = parseInt($('#ideaDays').value, 10);
      p.days = days >= 2 && days <= 30 ? days : pollSettings().days;
      p.budget = Math.max(0, parseInt($('#ideaBudget').value, 10) || 0);
      const persons = parseInt($('#ideaPersons').value, 10);
      p.persons = persons >= 1 && persons <= 30 ? persons : defaultPersons();
      saveIdeaPrefs(p);
      renderIdeaResults();
    }, 300);
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
