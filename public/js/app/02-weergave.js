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
    const title = (state.team && state.team.name) || 'Vakantie';
    document.title = title;
    $('#brand').textContent = title;
    document.documentElement.style.setProperty('--brand-w', `${$('#brand').offsetWidth + 48}px`);
    renderTabs();
    renderPanel();
  }

  function tabLink(href, label, active, extra = '') {
    return `<a class="tab${active ? ' active' : ''}${extra}" href="${href}"${active ? ' aria-current="page"' : ''}>${label}</a>`;
  }

  // Stemrondes waarop jij nog niet stemde.
  const pollsToVote = () => openPolls().filter((p) => !p.votes.some((v) => v.name.toLowerCase() === myName().toLowerCase()));
  // Vluchten en overnachtingen beheer je via de pinnen op de kaart; die tabs tonen we niet.
  const listSections = () => {
    const map = mapSection();
    return state.sections.filter((s) => s.kind !== 'map' && s.kind !== 'car' && !(map && (s.kind === 'flight' || s.kind === 'stay' || s.kind === 'do' || s.kind === 'eat')));
  };
  const listTabIcon = (s) => (KIND_ICONS[s.kind] ? kindIcon(s.kind) : s.icon ? `<span class="tab-emoji" aria-hidden="true">${esc(s.icon)}</span>` : '');
  const badge = (n) => (n ? ` <span class="tab-badge">${n > 99 ? '99+' : n}</span>` : '');

  function renderTabs() {
    const route = currentRoute();
    const nav = $('#tabs');
    const map = mapSection();
    const lists = listSections();
    const vote = pollsToVote().length;
    if (isPhone()) {
      // Telefoon: vaste balk met vijf knoppen; de rest staat onder Meer.
      const inMore = route === 'datum' || route === 'stem' || route === 'groep' || typeof route === 'number';
      nav.innerHTML = (map ? tabLink('#kaart', `${ic('map')} <span>${esc(map.title)}</span>`, route === 'kaart', ' tab-map') : '')
        + tabLink('#ideeen', `${ic('compass')} <span>Ideeën</span>`, route === 'ideeen')
        + tabLink('#chat', `${ic('chat')} <span>Chat</span>`, route === 'chat', ' tab-chat')
        + tabLink('#reizen', `${ic('suitcase')} <span>Reizen</span>`, route === 'reizen')
        + `<button type="button" class="tab tab-more${inMore ? ' active' : ''}" data-more aria-haspopup="dialog">${ic('menu')} <span>Meer</span>${badge(vote + unreadElsewhere())}</button>`;
      updateBadges();
      return;
    }
    nav.innerHTML = (map ? tabLink('#kaart', `${ic('map')} <span>${esc(map.title)}</span>`, route === 'kaart', ' tab-map') : '')
      + tabLink('#chat', `${ic('chat')} <span>Chat</span>`, route === 'chat', ' tab-chat')
      + tabLink('#ideeen', `${ic('compass')} <span>Ideeën</span>`, route === 'ideeen')
      + tabLink('#datum', `${ic('calendar')} <span>Datum</span>`, route === 'datum')
      + tabLink('#reizen', `${ic('suitcase')} <span>Reizen</span>`, route === 'reizen')
      + tabLink('#stem', `${ic('vote')} <span>Stemmen</span>${badge(vote)}`, route === 'stem')
      + lists.map((s) => tabLink(`#tab-${s.id}`, `${listTabIcon(s)} <span>${esc(s.title)}</span>`, route === s.id)).join('')
      + tabLink('#groep', `${ic('users')} <span>Groep</span>`, route === 'groep', ' tab-group')
      + `<button type="button" class="tab add" data-action="add-section" aria-label="Tab toevoegen">${ic('plus')}</button>`;
    updateBadges();
    const active = $('.tab.active', nav);
    if (active) {
      const left = active.offsetLeft - nav.clientWidth / 2 + active.clientWidth / 2;
      nav.scrollTo({ left, behavior: 'smooth' });
    }
  }

  // Meer-paneel op de telefoon: je groep, groep wisselen en de overige onderdelen.
  function openMoreSheet() {
    const route = currentRoute();
    const vote = pollsToVote().length;
    const row = (href, icon, label, sub, active, extra = '') => `<a class="more-row${active ? ' on' : ''}" href="${href}" data-close><span class="more-ic">${icon}</span><span class="more-text"><strong>${label}</strong>${sub ? `<small>${sub}</small>` : ''}</span>${extra}</a>`;
    const others = session.teams.filter((t) => t.id !== session.teamId);
    $('#moreBody').innerHTML = `
      <a class="more-team" href="#groep" data-close>${avatar(state.team.name, 'team')}<span><small>Jouw groep</small><strong>${esc(state.team.name)}</strong>
        <small>${state.members.length} ${state.members.length === 1 ? 'lid' : 'leden'} · uitnodigen en voorkeuren</small></span><span class="when-go" aria-hidden="true">→</span></a>
      <div class="more-grid">
        ${row('#stem', ic('vote'), 'Stemmen', vote ? `${vote} open voor jou` : `${openPolls().length} open`, route === 'stem', badge(vote))}
        ${row('#datum', ic('calendar'), 'Datum', 'Wanneer kan iedereen?', route === 'datum')}
        ${listSections().map((s) => row(`#tab-${s.id}`, listTabIcon(s), esc(s.title), `${s.items.length} ${s.items.length === 1 ? 'optie' : 'opties'}`, route === s.id)).join('')}
        <button type="button" class="more-row" data-action="add-section"><span class="more-ic">${ic('plus')}</span><span class="more-text"><strong>Tab toevoegen</strong><small>Eigen lijstje, bijv. budget of inpaklijst</small></span></button>
      </div>
      ${others.length ? `<div class="label">Andere groepen</div><div class="team-list">${others.map((t) => `
        <button type="button" class="team-row" data-team-open="${t.id}">${avatar(t.name, 'team')}<span><strong>${esc(t.name)}</strong><small>${t.members} ${t.members === 1 ? 'lid' : 'leden'}</small></span>${t.unread ? `<span class="tab-badge">${t.unread}</span>` : ''}<span class="when-go" aria-hidden="true">→</span></button>`).join('')}</div>` : ''}`;
    $('#moreDialog').showModal();
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { openMoreSheet(); return; }
    // Een keuze in het Meer-paneel sluit het paneel.
    if (e.target.closest('#moreDialog [data-team-open], #moreDialog [data-action]')) $('#moreDialog').close();
  });

  // Van telefoon naar breder scherm (of andersom draaien): andere tabbalk.
  window.matchMedia('(max-width: 600px)').addEventListener('change', () => { if (session.teamId) renderTabs(); });

  function renderPanel() {
    const route = currentRoute();
    const panel = $('#panel');
    document.body.classList.toggle('route-map', route === 'kaart');
    document.body.classList.toggle('route-chat', route === 'chat');
    if (route !== 'kaart') {
      unmountMap();
      if (pinDialog.open) closePinSheet();
    }
    if (route === 'kaart') { renderMapView(); return; }
    if (route === 'chat') {
      if (!$('#chatLog')) panel.innerHTML = chatHtml();
      renderChat();
      markRead();
      return;
    }
    if (route === 'groep') { panel.innerHTML = groupHtml(); return; }
    if (route === 'reizen') { panel.innerHTML = tripsHtml(); return; }
    if (route === 'stem') { panel.innerHTML = stemHtml(); return; }
    if (route === 'datum') { panel.innerHTML = pollHtml(); return; }
    if (route === 'ideeen') {
      // Niet opnieuw opbouwen als je net iets intypt (bijv. het budget); alleen de resultaten verversen.
      if (!$('#ideaResults')) panel.innerHTML = ideasHtml();
      renderIdeaResults();
      return;
    }
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
          <span class="head-icon" aria-hidden="true">${kindIcon(s.kind, s.icon)}</span>${esc(s.title)}
          <button type="button" class="text-btn" data-action="edit-section" data-id="${s.id}">Tab bewerken</button>
        </h2>
        ${s.intro ? `<p class="section-intro">${esc(s.intro)}</p>` : ''}
        ${pinnable ? '<p class="section-intro">Tip: open een bestemming op de <a href="#kaart">kaart</a> om suggesties in de buurt te vinden en ze meteen aan de reis te koppelen.</p>' : ''}
      </div>
      <button type="button" class="add-cta" data-action="add-item" data-id="${s.id}">
        <span class="add-cta-plus">${ic('plus')}</span>
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
    return `<div class="chips"><a class="chip" href="#pin-${loc.id}">${ic('pin')} ${esc(loc.title)}</a></div>`;
  }

  function cardHtml(it, s, feature) {
    const img = safeUrl(it.image);
    const link = safeUrl(it.link);
    const pros = lines(it.pros);
    const cons = lines(it.cons);
    const price = s.show_price && it.price;

    return `
      <article class="card${it.is_best ? ' best' : ''}${feature && img ? ' feature' : ''}" data-item="${it.id}" tabindex="0" aria-label="${esc(it.title)} aanpassen">
        ${img ? `<div class="card-media">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">` : ''}<img src="${esc(img)}" alt="" loading="lazy">${link ? '</a>' : ''}</div>` : ''}
        <div class="card-body">
          <span class="card-hint" aria-hidden="true">Aanpassen</span>
          ${it.is_best ? '<span class="badge-best">Beste keuze</span>' : ''}
          ${it.subtitle ? `<div class="card-sub">${esc(it.subtitle)}</div>` : ''}
          <h3 class="card-title">${esc(it.title)}</h3>
          ${it.added_by ? `<div class="added-by">${avatar(it.added_by)}Voorgesteld door ${esc(it.added_by)}</div>` : ''}
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
            ${link ? `<a class="btn sm out-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(linkLabel(link))} ↗</a>` : ''}
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
        ${mapSection() ? `<a class="add-cta" href="#kaart"><span class="add-cta-plus">${ic('map')}</span><span>Plan een reis op de kaart</span></a>` : ''}
        <button type="button" class="btn ghost" data-action="add-trip">＋ Reis zonder kaart</button>
      </div>
      ${trips.length ? `<div class="grid">${trips.map(tripCardHtml).join('')}</div>`
        : '<div class="empty"><p>Nog geen reizen voorgesteld. Wees de eerste!</p></div>'}`;
  }

  // Alleen-lezen overzicht van een reis, te delen in WhatsApp.
  const tripShareUrl = (t) => `${location.origin}/reis/${t.share_slug}`;
  function tripShareText(t) {
    const lines = [`✈️ *${t.title}*`];
    if (t.start_date) lines.push(`📅 ${rangeText(t.start_date, t.end_date)} (${dayCount(t.start_date, t.end_date)} dagen)`);
    // Het verblijf met link erbij, zodat iedereen in één tik op Airbnb of Booking zit.
    for (const s of [...sectionsOfKind('stay'), ...sectionsOfKind('car')]) {
      for (const it of s.items) {
        const u = t.item_ids.includes(it.id) && safeUrl(it.link);
        if (u && !u.startsWith('/')) lines.push(`${s.kind === 'car' ? '🚗' : '🏠'} ${it.title}${s.show_price && it.price ? ` (${it.price})` : ''}: ${u}`);
      }
    }
    lines.push(`Bekijk het hele reisplan: ${tripShareUrl(t)}`);
    return lines.join('\n');
  }
  function tripShareHtml(t, cls = '') {
    if (!t || !t.share_slug) return '';
    return `<div class="trip-share ${cls}">
      <a class="btn sm wa" href="${waLink(tripShareText(t))}" target="_blank" rel="noopener">${WA_ICON} Deel reis via WhatsApp</a>
      <a class="text-btn" href="/reis/${esc(t.share_slug)}" target="_blank" rel="noopener">Bekijk wat zij zien ↗</a>
    </div>`;
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
          ${t.added_by ? `<div class="added-by">${avatar(t.added_by)}Voorgesteld door ${esc(t.added_by)}</div>` : ''}
          ${tripDatesHtml(t)}
          ${picks.length ? `<ul class="trip-picks">${picks.map(({ s, it }) => `
            <li><a class="trip-pick" href="${tripPickHref(s, it)}">
              <span class="trip-pick-icon" aria-hidden="true">${kindIcon(s.kind, s.icon)}</span>
              <span class="trip-pick-text"><small>${esc(s.kind === 'map' ? 'Bestemming' : s.title)}</small>${esc(it.title)}
                ${s.show_price && it.price ? `<span class="price">${esc(it.price)}${s.kind === 'car' && it.young_fee ? ` + € ${Math.round(it.young_fee).toLocaleString('nl-NL')} toeslag &lt;25` : ''}</span>` : ''}</span>
            </a>${s.kind !== 'map' && s.kind !== 'flight' && safeUrl(it.link) && !safeUrl(it.link).startsWith('/') ? `<a class="btn sm out-link" href="${esc(safeUrl(it.link))}" target="_blank" rel="noopener noreferrer">${esc(linkSite(it.link) || 'Website')} ↗</a>` : ''}</li>`).join('')}</ul>` : ''}
          <div class="trip-add">
            <span class="trip-add-label">Toevoegen aan deze reis</span>
            <button type="button" class="btn sm" data-trip-add="do" data-trip-id="${t.id}">${ic('sparkles')} Activiteit</button>
            <button type="button" class="btn sm" data-trip-add="eat" data-trip-id="${t.id}">${ic('utensils')} Eten & drinken</button>
            <button type="button" class="btn sm" data-trip-add="car" data-trip-id="${t.id}">${ic('car')} Huurauto</button>
          </div>
          ${t.note ? `<p class="card-text">${esc(t.note)}</p>` : ''}
          ${tripShareHtml(t)}
          <div class="card-foot">
            ${likeBtn('trip', t.id, t.likes)}
            ${loc ? `<a class="link-btn" href="#pin-${loc.id}">Verder plannen op de kaart →</a>` : ''}
          </div>
        </div>
      </article>`;
  }
