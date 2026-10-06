  /* ---------- accounts, groepen en chat ---------- */

  // Vaste kleur per persoon, zodat je op de kaart en in de chat snel ziet wie wat deed.
  const PERSON_COLORS = ['#e0245e', '#0a7cff', '#008a05', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#4d7c0f', '#b45309', '#4f46e5'];
  function colorOf(name) {
    let h = 0;
    for (const ch of String(name || '').toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return PERSON_COLORS[h % PERSON_COLORS.length];
  }
  const initialOf = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
  const avatar = (name, cls = '') => `<span class="av${cls ? ` ${cls}` : ''}" style="--c:${colorOf(name)}" aria-hidden="true">${esc(initialOf(name))}</span>`;
  const isAdmin = () => !!(state.team && state.team.role === 'admin');
  const memberNames = () => new Set(state.members.map((m) => m.name.toLowerCase()));
  // Dagen wissen: van jezelf, als beheerder, of van een naam die geen lid (meer) is.
  const canRemovePerson = (name) => name.toLowerCase() === myName().toLowerCase() || isAdmin() || !memberNames().has(name.toLowerCase());

  let invite = null; // uitnodiging uit een /join/<code>-link: { code, id, name, members, member } of { code, error }

  async function loadInvite() {
    const code = store.get('pendingJoin');
    if (!code) { invite = null; return; }
    try { invite = { code, ...(await api(`/invite/${encodeURIComponent(code)}`)) }; } catch (err) { invite = { code, error: err.message }; }
  }

  function showGate(html) {
    stopTicking();
    document.body.classList.add('gate');
    document.body.classList.remove('route-map', 'route-chat');
    unmountMap();
    $$('dialog[open]').forEach((d) => d.close());
    $('#tabs').innerHTML = '';
    $('#panel').innerHTML = `<div class="gate-wrap"><div class="gate-card">
      <div class="gate-brand">${ic('compass')} Vakantieplanner</div>${html}</div></div>`;
    document.title = 'Vakantieplanner';
  }

  function inviteNoteHtml() {
    if (!invite) return '';
    if (invite.error) return `<p class="form-error">${esc(invite.error)}</p>`;
    const n = invite.members.length;
    return `<div class="invite-note">${ic('users')}<span>Je bent uitgenodigd voor <strong>${esc(invite.name)}</strong>
      ${n ? `<small>${esc(invite.members.slice(0, 4).join(', '))}${n > 4 ? ` en ${n - 4} anderen` : ''} ${n === 1 ? 'zit' : 'zitten'} er al in</small>` : ''}</span></div>`;
  }

  let authMode = 'login';
  function showAuth(mode) {
    session.user = null;
    session.teamId = null;
    authMode = mode || (invite && !invite.error ? 'register' : authMode);
    const reg = authMode === 'register';
    showGate(`
      ${inviteNoteHtml()}
      <div class="seg" role="group" aria-label="Inloggen of account maken">
        <button type="button" data-auth-mode="register" aria-pressed="${reg}">Nieuw account</button>
        <button type="button" data-auth-mode="login" aria-pressed="${!reg}">Inloggen</button>
      </div>
      <form id="authForm" class="gate-form" novalidate>
        <label>Je naam<input name="name" maxlength="30" required autocomplete="username" autocapitalize="words" enterkeyhint="next"
          placeholder="${reg ? 'Hoe noemen je vrienden je?' : ''}"></label>
        <label>Wachtwoord<input name="password" type="password" minlength="6" required
          autocomplete="${reg ? 'new-password' : 'current-password'}" enterkeyhint="go" placeholder="${reg ? 'Minstens 8 tekens' : ''}"></label>
        <p class="form-error" id="authError" hidden></p>
        <button type="submit" class="btn primary block">${reg ? 'Account maken' : 'Inloggen'}</button>
      </form>
      <p class="hint">${reg ? 'Je naam staat bij je pinnen, reizen, stemmen en berichten.' : 'Wachtwoord vergeten? Vraag de beheerder van je groep om een tijdelijk wachtwoord.'}</p>
      <p class="fineprint"><a href="/privacy" target="_blank" rel="noopener">Privacy: wat we bewaren</a></p>`);
    const first = $('#authForm input[name="name"]');
    if (first && !isPhone()) first.focus();
  }

  function teamsListHtml() {
    return session.teams.map((t) => `
      <button type="button" class="team-row${t.id === session.teamId ? ' on' : ''}" data-team-open="${t.id}">
        ${avatar(t.name, 'team')}<span><strong>${esc(t.name)}</strong><small>${t.members} ${t.members === 1 ? 'lid' : 'leden'}${t.role === 'admin' ? ' · beheerder' : ''}</small></span>
        ${t.unread ? `<span class="tab-badge">${t.unread}</span>` : ''}<span class="when-go" aria-hidden="true">→</span>
      </button>`).join('');
  }

  function newTeamFormHtml() {
    return `<form id="newTeamForm" class="gate-form inline-form">
      <label>Nieuwe groep<input name="name" maxlength="60" required placeholder="Bijv. Zomervakantie 2027" enterkeyhint="done"></label>
      <button type="submit" class="btn primary">Maken</button>
    </form>`;
  }

  function showTeams() {
    session.teamId = null;
    const joinable = invite && !invite.error && !invite.member;
    showGate(`
      <h2 class="gate-title">Hoi ${esc(myName())}</h2>
      ${joinable ? `${inviteNoteHtml()}<button type="button" class="btn primary block" data-join>Doe mee met ${esc(invite.name)}</button>`
        : invite && invite.error ? inviteNoteHtml() : ''}
      ${session.teams.length ? `<div class="label">Jouw groepen</div><div class="team-list">${teamsListHtml()}</div>`
        : !joinable ? '<p class="hint">Je zit nog niet in een groep. Maak er een en stuur de uitnodigingslink naar je vrienden, of open de link die je van iemand kreeg.</p>' : ''}
      ${newTeamFormHtml()}
      <button type="button" class="text-btn" data-logout>Uitloggen</button>`);
    if (invite && invite.error) { store.remove('pendingJoin'); invite = null; }
  }

  async function signedIn({ user, teams }) {
    session.user = user;
    session.teams = teams;
    if (invite && !invite.error) {
      if (invite.member || teams.some((t) => t.id === invite.id)) {
        const id = invite.id;
        store.remove('pendingJoin');
        invite = null;
        return enterTeam(id);
      }
      return showTeams();
    }
    const last = +store.get('team');
    const t = teams.find((x) => x.id === last) || teams[0];
    if (t) return enterTeam(t.id);
    return showTeams();
  }

  async function enterTeam(id) {
    session.teamId = id;
    store.set('team', String(id));
    document.body.classList.remove('gate');
    chat.reset();
    try {
      await reload();
    } catch (err) {
      if (err.code !== 'no-team') $('#panel').innerHTML = `<div class="empty">Kon de groep niet laden: ${esc(err.message)}</div>`;
      return;
    }
    startTicking();
  }

  async function switchTeam(id) {
    if (id === session.teamId) { location.hash = '#kaart'; return; }
    setHashQuietly('#kaart');
    unmountMap();
    $$('dialog[open]').forEach((d) => d.close());
    await enterTeam(id);
    toast(`Je zit nu in ${state.team.name}`);
  }

  // Niet (meer) in de groep: terug naar het overzicht van je groepen.
  async function leaveTeamView() {
    session.teamId = null;
    store.remove('team');
    let me;
    try { me = await api('/auth/me'); } catch { return; }
    if (!me.user) { showAuth('login'); return; }
    session.teams = me.teams;
    showTeams();
  }

  async function refreshTeams() {
    try { session.teams = (await api('/auth/me')).teams; } catch { /* volgende keer */ }
  }

  document.addEventListener('click', async (e) => {
    const mode = e.target.closest('[data-auth-mode]');
    if (mode) { showAuth(mode.dataset.authMode); return; }
    const open = e.target.closest('[data-team-open]');
    if (open) { await switchTeam(+open.dataset.teamOpen); return; }
    if (e.target.closest('[data-join]')) {
      try {
        const { id, teams } = await api(`/invite/${encodeURIComponent(invite.code)}`, 'POST');
        session.teams = teams;
        store.remove('pendingJoin');
        invite = null;
        await enterTeam(id);
        location.hash = '#chat';
        toast(`Welkom in ${state.team.name}!`);
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest('[data-account-delete]')) {
      if (!confirm('Je account definitief verwijderen? Je naam, wachtwoord en voorkeuren worden gewist en je verlaat al je groepen. Je chatberichten blijven staan zonder naam.')) return;
      const password = prompt('Typ je wachtwoord om het account te verwijderen');
      if (password == null) return;
      try {
        await api('/auth/account', 'DELETE', { password });
        store.remove('team');
        toast('Je account is verwijderd');
        showAuth('register');
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest('[data-logout]')) {
      if (!confirm('Uitloggen?')) return;
      await api('/auth/logout', 'POST').catch(() => {});
      store.remove('team');
      showAuth('login');
    }
  });

  document.addEventListener('submit', async (e) => {
    if (e.target.id === 'authForm') {
      e.preventDefault();
      const f = e.target;
      const err = $('#authError');
      const btn = $('button[type="submit"]', f);
      btn.disabled = true;
      try {
        const res = await api(`/auth/${authMode === 'register' ? 'register' : 'login'}`, 'POST',
          { name: f.elements.name.value.trim(), password: f.elements.password.value });
        await signedIn(res);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
      }
      return;
    }
    if (e.target.id === 'newTeamForm') {
      e.preventDefault();
      const name = e.target.elements.name.value.trim();
      if (!name) return;
      try {
        const { id, teams } = await api('/teams', 'POST', { name });
        session.teams = teams;
        await enterTeam(id);
        location.hash = '#groep';
        toast('Groep gemaakt ✓ Stuur nu de uitnodigingslink naar je vrienden.');
      } catch (ex) { toast(ex.message, true); }
    }
  });

  /* --- chat --- */

  const chat = {
    messages: [], lastId: 0, loaded: false,
    reset() { this.messages = []; this.lastId = 0; this.loaded = false; },
  };
  let tickTimer = null;
  let ticking = false;

  function startTicking() {
    stopTicking();
    tick();
    tickTimer = setInterval(() => { if (!document.hidden) tick(); }, 4000);
  }
  function stopTicking() { clearInterval(tickTimer); tickTimer = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && tickTimer) tick(); });

  let reloadTimer = null;
  const reloadSoon = () => {
    clearTimeout(reloadTimer);
    // Niet verversen terwijl iemand iets invult; dat doen we daarna wel.
    reloadTimer = setTimeout(() => (document.querySelector('dialog[open]') ? reloadSoon() : reload().catch(() => {})), 600);
  };

  async function tick() {
    if (ticking || !session.teamId) return;
    ticking = true;
    const teamId = session.teamId;
    try {
      const [{ messages, removed = [], unref = [] }, { teams }] = await Promise.all([
        api(`/messages${chat.loaded ? `?after=${chat.lastId}` : ''}`),
        api('/unread'),
      ]);
      if (teamId !== session.teamId) return;
      const first = !chat.loaded;
      const fresh = chat.loaded ? messages : [];
      if (chat.loaded) chat.messages.push(...messages); else { chat.messages = messages; chat.loaded = true; }
      if (messages.length) chat.lastId = messages[messages.length - 1].id;
      // Berichten over een verwijderde pin of reis zijn op de server opgeruimd: hier ook weghalen.
      const gone = new Set(removed);
      const noRef = new Set(unref);
      let changed = false;
      if (gone.size && chat.messages.some((m) => gone.has(m.id))) { chat.messages = chat.messages.filter((m) => !gone.has(m.id)); changed = true; }
      for (const m of chat.messages) if (noRef.has(m.id) && m.ref_type) { m.ref_type = null; m.ref_id = null; changed = true; }
      for (const t of teams) { const own = session.teams.find((x) => x.id === t.id); if (own) own.unread = t.unread; }
      // Iemand anders zette iets op de kaart, stelde een reis voor of begon een stemronde: inhoud verversen.
      if (fresh.some((m) => m.kind === 'event' && m.user_id !== session.user.id)) reloadSoon();
      if (currentRoute() === 'chat') {
        if (first || fresh.length || changed) renderChat();
        markRead();
      }
      updateBadges();
    } catch { /* volgende keer opnieuw */ } finally { ticking = false; }
  }

  function markRead() {
    const team = session.teams.find((t) => t.id === session.teamId);
    if (!chat.lastId || (team && !team.unread && team.readUpTo >= chat.lastId)) return;
    if (team) { team.unread = 0; team.readUpTo = chat.lastId; }
    api('/messages/read', 'PUT', { upto: chat.lastId }).catch(() => {});
    updateBadges();
  }

  const unreadHere = () => (session.teams.find((t) => t.id === session.teamId) || {}).unread || 0;
  const unreadElsewhere = () => session.teams.filter((t) => t.id !== session.teamId).reduce((n, t) => n + (t.unread || 0), 0);

  function updateBadges() {
    const more = (state.team ? pollsToVote().length : 0) + unreadElsewhere();
    for (const [sel, n] of [['.tab-chat', unreadHere()], ['.tab-group', unreadElsewhere()], ['.tab-more', more]]) {
      const tab = $(sel);
      if (!tab) continue;
      let b = $('.tab-badge', tab);
      if (!n) { if (b) b.remove(); continue; }
      if (!b) { b = document.createElement('span'); b.className = 'tab-badge'; tab.append(b); }
      b.textContent = n > 99 ? '99+' : n;
    }
  }

  const msgDate = (m) => new Date(m.created_at.replace(' ', 'T') + 'Z');
  const timeOf = (m) => msgDate(m).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  function dayLabel(d) {
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Vandaag';
    if (d.toDateString() === y.toDateString()) return 'Gisteren';
    return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  // Links in berichten klikbaar maken (tekst is al ge-escaped).
  const linkify = (html) => html.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);

  function refHtml(m) {
    if (m.ref_type === 'item') {
      const it = findItem(m.ref_id);
      if (!it) return '<div class="ref-card gone">Deze pin is verwijderd</div>';
      const img = safeUrl(it.image);
      return `<a class="ref-card" href="#pin-${it.id}">
        <span class="ref-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ic('pin')}</span>
        <span><small>Pin ${pinNumber(it.id) || ''}</small><strong>${esc(it.title)}</strong>${it.added_by ? `<small>door ${esc(it.added_by)}</small>` : ''}</span>
        <span class="when-go" aria-hidden="true">→</span></a>`;
    }
    if (m.ref_type === 'trip') {
      const t = state.trips.find((x) => x.id === m.ref_id);
      if (!t) return '<div class="ref-card gone">Deze reis is verwijderd</div>';
      const loc = t.item_ids.map(findItem).find((it) => it && sectionOf(it) && sectionOf(it).kind === 'map');
      const img = loc && safeUrl(loc.image);
      const n = t.item_ids.length;
      return `<div class="ref-card trip-ref">
        <span class="ref-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ic('suitcase')}</span>
        <span><small>Reis${t.added_by ? ` · voorgesteld door ${esc(t.added_by)}` : ''}</small><strong>${esc(t.title)}</strong>
          <small>${t.start_date ? esc(shortRange(t.start_date, t.end_date)) : 'Nog geen datum'} · ${n} ${n === 1 ? 'onderdeel' : 'onderdelen'} · ♥ ${t.likes}</small></span>
        <span class="ref-actions">
          ${loc ? `<a class="btn sm" href="#pin-${loc.id}">Op de kaart</a>` : ''}
          <button type="button" class="btn sm ghost" data-trip-open="${t.id}">Bekijk</button>
        </span></div>`;
    }
    if (m.ref_type === 'poll') {
      const poll = state.polls.find((p) => p.id === m.ref_id);
      if (!poll) return '<div class="ref-card gone">Deze stemronde is verwijderd</div>';
      const rows = tallyOf(poll);
      const mine = poll.votes.find((v) => v.name.toLowerCase() === myName().toLowerCase());
      const max = Math.max(1, ...rows.map((r) => r.voters.length));
      return `<div class="ref-card poll-ref">
        <div class="poll-ref-head">${ic('vote')}<span><strong>${esc(poll.title)}</strong><small>${esc(deadlineText(poll))} · ${poll.votes.length} ${poll.votes.length === 1 ? 'stem' : 'stemmen'}</small></span></div>
        <div class="poll-ref-options">${rows.map((r) => {
          const on = mine && mine.item_id === r.it.id;
          return `<button type="button" class="poll-ref-opt${on ? ' on' : ''}" data-vote="${r.it.id}" data-poll="${esc(poll.slug)}"${poll.is_closed ? ' disabled' : ''}
            aria-pressed="${!!on}"><span class="bar" aria-hidden="true"><span style="width:${Math.round(r.voters.length / max * 100)}%"></span></span>
            <span class="poll-ref-label">${on ? '✓ ' : ''}${esc(shortName(r.it.title))}</span><span class="poll-ref-n">${r.voters.length}</span></button>`;
        }).join('')}</div>
        <a class="text-btn" href="#stem-${esc(poll.slug)}">${poll.is_closed ? 'Uitslag bekijken' : 'Wie stemde wat?'}</a>
      </div>`;
    }
    return '';
  }

  function msgHtml(m, prev) {
    const d = msgDate(m);
    const newDay = !prev || msgDate(prev).toDateString() !== d.toDateString();
    const sep = newDay ? `<div class="msg-day"><span>${esc(dayLabel(d))}</span></div>` : '';
    const name = m.name || 'Oud-lid';
    if (m.kind === 'event') {
      return `${sep}<div class="msg-event" data-msg="${m.id}">${avatar(name)}<span><strong>${esc(name)}</strong> ${esc(m.body)} <time>${timeOf(m)}</time></span></div>
        ${m.ref_type ? `<div class="msg-event-ref">${refHtml(m)}</div>` : ''}`;
    }
    const mine = m.user_id === session.user.id;
    const cont = !newDay && prev && prev.kind !== 'event' && prev.user_id === m.user_id && d - msgDate(prev) < 5 * 60e3;
    return `${sep}<div class="msg${mine ? ' mine' : ''}${cont ? ' cont' : ''}" data-msg="${m.id}">
      ${!mine && !cont ? avatar(name) : '<span class="av-space"></span>'}
      <div class="bubble">
        ${!mine && !cont ? `<span class="msg-name" style="color:${colorOf(name)}">${esc(name)}</span>` : ''}
        ${m.body ? `<p>${linkify(esc(m.body)).replace(/\n/g, '<br>')}</p>` : ''}
        ${m.ref_type ? refHtml(m) : ''}
        <span class="msg-meta"><time>${timeOf(m)}</time>${mine || isAdmin() ? `<button type="button" class="msg-del" data-msg-del="${m.id}" aria-label="Bericht verwijderen">✕</button>` : ''}</span>
      </div></div>`;
  }

  function chatHtml() {
    return `
      <div class="chat">
        <div class="chat-head">
          <div><h2>${esc(state.team.name)}</h2><small>${state.members.map((m) => esc(m.name)).join(', ')}</small></div>
          <a class="btn sm ghost" href="#groep">${ic('users')} Groep</a>
        </div>
        <div class="chat-log" id="chatLog" aria-live="polite"></div>
        <form class="chat-compose" id="chatForm">
          <button type="button" class="icon-btn chat-attach" data-chat-share aria-label="Reis, pin of stemronde delen">${ic('plus')}</button>
          <label for="chatInput" class="sr-only">Bericht</label>
          <textarea id="chatInput" rows="1" maxlength="2000" placeholder="Bericht aan ${esc(state.team.name)}" enterkeyhint="send"></textarea>
          <button type="submit" class="btn primary chat-send" aria-label="Versturen">${ic('send')}</button>
        </form>
      </div>`;
  }

  function renderChat() {
    const log = $('#chatLog');
    if (!log) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const top = log.scrollTop;
    log.innerHTML = !chat.loaded ? '<p class="hint center">Laden…</p>'
      : chat.messages.length ? chat.messages.map((m, i) => msgHtml(m, chat.messages[i - 1])).join('')
      : `<div class="empty"><p>Nog geen berichten. Zeg hoi, of deel een reis, pin of stemronde met de ${ic('plus')}-knop.</p></div>`;
    log.scrollTop = atBottom || !log.dataset.ready ? log.scrollHeight : top;
    log.dataset.ready = '1';
  }

  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  document.addEventListener('input', (e) => { if (e.target.id === 'chatInput') autosize(e.target); });
  // Op de telefoon: tijdens het typen de tabbalk verbergen en de chat net zo hoog maken als wat boven het toetsenbord zichtbaar is.
  document.addEventListener('focusin', (e) => { if (e.target.id === 'chatInput' && isPhone()) document.body.classList.add('typing'); });
  document.addEventListener('focusout', (e) => { if (e.target.id === 'chatInput') document.body.classList.remove('typing'); });
  // Tik op verzenden: het tekstveld houdt de focus. Anders komt de onderbalk terug, schuift het
  // invoerveld omhoog en valt de tik naast de knop (het bericht ging dan niet weg).
  document.addEventListener('mousedown', (e) => { if (e.target.closest('.chat-send')) e.preventDefault(); });
  if (window.visualViewport) {
    const fit = () => {
      document.documentElement.style.setProperty('--vvh', `${window.visualViewport.height}px`);
      const log = $('#chatLog');
      if (log && document.body.classList.contains('typing')) log.scrollTop = log.scrollHeight;
    };
    window.visualViewport.addEventListener('resize', fit);
    fit();
  }
  document.addEventListener('keydown', (e) => {
    // Enter verstuurt op een computer; op de telefoon geeft Enter een nieuwe regel.
    if (e.target.id === 'chatInput' && e.key === 'Enter' && !e.shiftKey && !isPhone()) {
      e.preventDefault();
      $('#chatForm').requestSubmit();
    }
  });

  async function sendMessage(body, ref) {
    const { id } = await api('/messages', 'POST', { body, ...(ref || {}) });
    chat.messages.push({ id, user_id: session.user.id, name: myName(), kind: 'text', body, ref_type: ref ? ref.ref_type : null,
      ref_id: ref ? ref.ref_id : null, created_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
    chat.lastId = Math.max(chat.lastId, id);
    const log = $('#chatLog');
    if (log) { renderChat(); log.scrollTop = log.scrollHeight; }
  }

  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'chatForm') return;
    e.preventDefault();
    const input = $('#chatInput');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    autosize(input);
    try { await sendMessage(body); } catch (err) { input.value = body; toast(err.message, true); }
    if (!isPhone() || document.activeElement === input) input.focus();
  });

  document.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-msg-del]');
    if (del) {
      if (!confirm('Dit bericht verwijderen?')) return;
      const id = +del.dataset.msgDel;
      try {
        await api(`/messages/${id}`, 'DELETE');
        chat.messages = chat.messages.filter((m) => m.id !== id);
        renderChat();
      } catch (err) { toast(err.message, true); }
      return;
    }
    const tripOpen = e.target.closest('[data-trip-open]');
    if (tripOpen) { openTripDialog(state.trips.find((t) => t.id === +tripOpen.dataset.tripOpen)); return; }
    if (e.target.closest('[data-chat-share]')) { openShareDialog(); return; }
    const share = e.target.closest('[data-share-ref]');
    if (share) {
      const [type, id] = share.dataset.shareRef.split(':');
      const input = $('#chatInput');
      const body = input ? input.value.trim() : '';
      try {
        await sendMessage(body, { ref_type: type, ref_id: +id });
        if (input) { input.value = ''; autosize(input); }
        $('#shareDialog').close();
        if (currentRoute() !== 'chat') { location.hash = '#chat'; toast('Gedeeld in de chat ✓'); }
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest('[data-share-poll]')) {
      $('#shareDialog').close();
      openPollRoundDialog(null);
    }
  });

  function openShareDialog() {
    const locs = locations();
    $('#shareBody').innerHTML = `
      ${locs.length >= 2 ? `<button type="button" class="btn primary block" data-share-poll>${ic('vote')} Stemronde starten</button>` : ''}
      ${state.trips.length ? `<div class="label">Reis delen</div><div class="link-list">${state.trips.map((t) => `
        <button type="button" class="link-row" data-share-ref="trip:${t.id}">${ic('suitcase')}
          <span><strong>${esc(t.title)}</strong><small>${t.start_date ? esc(shortRange(t.start_date, t.end_date)) : 'Nog geen datum'}${t.added_by ? ` · ${esc(t.added_by)}` : ''}</small></span></button>`).join('')}</div>` : ''}
      ${locs.length ? `<div class="label">Pin delen</div><div class="link-list">${locs.map((l) => `
        <button type="button" class="link-row" data-share-ref="item:${l.id}"><span class="dest-num">${pinNumber(l.id)}</span>
          <span><strong>${esc(l.title)}</strong>${l.added_by ? `<small>door ${esc(l.added_by)}</small>` : ''}</span></button>`).join('')}</div>`
        : '<p class="hint">Zet eerst een bestemming op de kaart; daarna kun je hem hier delen.</p>'}
      ${state.polls.length ? `<div class="label">Stemronde delen</div><div class="link-list">${state.polls.map((p) => `
        <button type="button" class="link-row" data-share-ref="poll:${p.id}">${ic('vote')}
          <span><strong>${esc(p.title)}</strong><small>${esc(deadlineText(p))}</small></span></button>`).join('')}</div>` : ''}`;
    $('#shareDialog').showModal();
  }

  /* --- groepspagina: leden, uitnodigen, voorkeuren --- */

  const inviteUrl = () => `${location.origin}/join/${state.team.invite_code}`;

  function prefChipsHtml(me) {
    return IDEA_CATS.map(([k, label]) => {
      const v = me.likes.includes(k) ? 'like' : me.dislikes.includes(k) ? 'dislike' : '';
      return `<button type="button" class="pref${v ? ` ${v}` : ''}" data-pref="${k}" aria-label="${esc(label)}: ${v === 'like' ? 'vind ik leuk' : v === 'dislike' ? 'liever niet' : 'maakt niet uit'}">
        <span aria-hidden="true">${v === 'like' ? '👍' : v === 'dislike' ? '👎' : ''}</span>${esc(label)}</button>`;
    }).join('');
  }

  function memberPrefsText(m) {
    const parts = [];
    if (m.likes.length) parts.push(`👍 ${m.likes.map((c) => CAT_LABEL[c]).join(', ')}`);
    if (m.dislikes.length) parts.push(`👎 ${m.dislikes.map((c) => CAT_LABEL[c]).join(', ')}`);
    if (m.note) parts.push(`“${m.note}”`);
    return parts.map(esc).join(' · ');
  }

  function groupHtml() {
    const me = state.members.find((m) => m.id === session.user.id) || { likes: [], dislikes: [], note: '' };
    const admin = isAdmin();
    const others = session.teams.filter((t) => t.id !== session.teamId);
    return `
      <div class="section-head">
        <span class="plan-kicker">Groep</span>
        <h2>${esc(state.team.name)} ${admin ? '<button type="button" class="text-btn" data-group-rename>Naam wijzigen</button>' : ''}</h2>
        <p class="section-intro">Alles in deze groep (kaart, reizen, stemrondes, datumprikker en chat) zien alleen de leden.</p>
      </div>

      <div class="share-card invite-card">
        <strong>${ic('users')} Vrienden uitnodigen</strong>
        <p>Iedereen met deze link kan een account maken en meedoen.</p>
        <div class="invite-link"><input readonly value="${esc(inviteUrl())}" aria-label="Uitnodigingslink" onclick="this.select()"></div>
        <div class="row-btns">
          <button type="button" class="btn sm primary" data-invite-share>Link delen</button>
          <a class="btn sm" href="https://wa.me/?text=${encodeURIComponent(`Doe mee met ${state.team.name} in de vakantieplanner: ${inviteUrl()}`)}" target="_blank" rel="noopener">WhatsApp</a>
          <button type="button" class="btn sm ghost" data-copy="${esc(inviteUrl())}">Kopiëren</button>
          ${admin ? '<button type="button" class="btn sm ghost" data-invite-new>Nieuwe link</button>' : ''}
        </div>
      </div>

      <div class="label" id="voorkeuren">Mijn voorkeuren</div>
      <p class="hint">Tik één keer voor 👍 (vind ik leuk), twee keer voor 👎 (liever niet). Bij Ideeën ziet iedereen dan welke bestemmingen bij de groep passen.</p>
      <div class="prefs">${prefChipsHtml(me)}</div>
      <label class="pref-note">Opmerking voor de groep <small>(optioneel)</small>
        <input id="prefNote" maxlength="200" value="${esc(me.note)}" placeholder="Bijv. max € 800, liefst in augustus" enterkeyhint="done"></label>

      <div class="label">Leden (${state.members.length})</div>
      <ul class="members">${state.members.map((m) => `
        <li>${avatar(m.name)}
          <div class="member-main"><strong>${esc(m.name)}${m.id === session.user.id ? ' <small>(jij)</small>' : ''}</strong>
            ${m.role === 'admin' ? '<span class="chip">Beheerder</span>' : ''}
            ${memberPrefsText(m) ? `<small class="member-prefs">${memberPrefsText(m)}</small>` : '<small class="member-prefs">Nog geen voorkeuren</small>'}</div>
          ${admin && m.id !== session.user.id ? `<details class="member-menu"><summary aria-label="Opties voor ${esc(m.name)}">⋯</summary><div>
            <button type="button" data-member-role="${m.id}" data-role="${m.role === 'admin' ? 'member' : 'admin'}">${m.role === 'admin' ? 'Geen beheerder meer' : 'Maak beheerder'}</button>
            <button type="button" data-member-reset="${m.id}">Tijdelijk wachtwoord maken</button>
            <button type="button" class="danger" data-member-remove="${m.id}">Uit de groep halen</button></div></details>` : ''}
        </li>`).join('')}</ul>

      <div class="label">Mijn groepen</div>
      ${others.length ? `<div class="team-list">${teamsListHtml().replace(/<button type="button" class="team-row on"[\s\S]*?<\/button>/, '')}</div>` : '<p class="hint">Je zit alleen in deze groep.</p>'}
      <details class="new-team"><summary class="btn block">${ic('plus')} Nieuwe groep maken</summary>${newTeamFormHtml()}</details>

      <div class="label">Account</div>
      <div class="account-row">${avatar(myName())}<span>Ingelogd als <strong>${esc(myName())}</strong></span></div>
      <div class="row-btns">
        <button type="button" class="btn sm" data-password>Wachtwoord wijzigen</button>
        <button type="button" class="btn sm ghost" data-logout>Uitloggen</button>
        <button type="button" class="btn sm ghost danger" data-group-leave>Groep verlaten</button>
      </div>
      <p class="fineprint account-links"><a href="/privacy" target="_blank" rel="noopener">Privacy: wat we bewaren</a> · <button type="button" class="text-btn danger" data-account-delete>Account verwijderen</button></p>`;
  }

  let prefTimer = null;
  function savePrefs() {
    const me = state.members.find((m) => m.id === session.user.id);
    if (!me) return;
    clearTimeout(prefTimer);
    prefTimer = setTimeout(async () => {
      try {
        await api('/prefs', 'PUT', { likes: me.likes, dislikes: me.dislikes, note: me.note });
        toast('Voorkeuren opgeslagen ✓');
      } catch (err) { toast(err.message, true); }
    }, 500);
  }

  document.addEventListener('input', (e) => {
    if (e.target.id !== 'prefNote') return;
    const me = state.members.find((m) => m.id === session.user.id);
    if (me) { me.note = e.target.value.trim(); savePrefs(); }
  });

  document.addEventListener('click', async (e) => {
    const pref = e.target.closest('[data-pref]');
    if (pref) {
      const me = state.members.find((m) => m.id === session.user.id);
      const k = pref.dataset.pref;
      // neutraal → leuk → liever niet → neutraal
      if (me.likes.includes(k)) { me.likes = me.likes.filter((c) => c !== k); me.dislikes.push(k); }
      else if (me.dislikes.includes(k)) me.dislikes = me.dislikes.filter((c) => c !== k);
      else me.likes.push(k);
      $('.prefs').innerHTML = prefChipsHtml(me);
      const row = $$('.members li').find((li) => li.querySelector('strong') && li.querySelector('strong').textContent.startsWith(me.name));
      if (row) { const small = $('.member-prefs', row); if (small) small.innerHTML = memberPrefsText(me) || 'Nog geen voorkeuren'; }
      savePrefs();
      return;
    }
    if (e.target.closest('[data-invite-share]')) {
      const url = inviteUrl();
      if (navigator.share) {
        try { await navigator.share({ title: state.team.name, text: `Doe mee met ${state.team.name} in de vakantieplanner`, url }); } catch { /* geannuleerd */ }
      } else {
        try { await navigator.clipboard.writeText(url); toast('Link gekopieerd ✓'); } catch { toast(url); }
      }
      return;
    }
    if (e.target.closest('[data-invite-new]')) {
      if (!confirm('Nieuwe uitnodigingslink maken? De oude link werkt dan niet meer.')) return;
      const { invite_code: code } = await api('/team/invite', 'POST');
      state.team.invite_code = code;
      renderPanel();
      toast('Nieuwe link gemaakt ✓');
      return;
    }
    if (e.target.closest('[data-group-rename]')) {
      const name = prompt('Nieuwe naam van de groep', state.team.name);
      if (!name || !name.trim()) return;
      try { await api('/team', 'PUT', { name: name.trim() }); await refreshTeams(); await reload(); toast('Naam gewijzigd ✓'); } catch (err) { toast(err.message, true); }
      return;
    }
    const role = e.target.closest('[data-member-role]');
    if (role) {
      try { await api(`/team/members/${role.dataset.memberRole}`, 'PUT', { role: role.dataset.role }); await reload(); } catch (err) { toast(err.message, true); }
      return;
    }
    const reset = e.target.closest('[data-member-reset]');
    if (reset) {
      const m = state.members.find((x) => x.id === +reset.dataset.memberReset);
      if (!confirm(`Een tijdelijk wachtwoord maken voor ${m.name}? Het oude wachtwoord werkt dan niet meer.`)) return;
      try {
        const { password } = await api(`/team/members/${m.id}/reset`, 'POST');
        prompt(`Tijdelijk wachtwoord voor ${m.name}. Stuur het naar ${m.name}; die kan het daarna zelf wijzigen.`, password);
      } catch (err) { toast(err.message, true); }
      return;
    }
    const remove = e.target.closest('[data-member-remove]');
    if (remove) {
      const m = state.members.find((x) => x.id === +remove.dataset.memberRemove);
      if (!confirm(`${m.name} uit de groep halen?`)) return;
      try { await api(`/team/members/${m.id}`, 'DELETE'); await reload(); toast(`${m.name} is uit de groep`); } catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest('[data-group-leave]')) {
      if (!confirm(`Weet je zeker dat je ${state.team.name} wilt verlaten?`)) return;
      try {
        await api(`/team/members/${session.user.id}`, 'DELETE');
        await leaveTeamView();
        toast('Je hebt de groep verlaten');
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest('[data-password]')) {
      const current = prompt('Je huidige wachtwoord');
      if (current == null) return;
      const next = prompt('Nieuw wachtwoord (minstens 8 tekens)');
      if (next == null) return;
      try { await api('/auth/password', 'PUT', { current, password: next }); toast('Wachtwoord gewijzigd ✓'); } catch (err) { toast(err.message, true); }
    }
  });

  /* --- groepsvoorkeuren bij de ideeën --- */

  // Per lid: duimpje bij deze bestemming, of een categorie die diegene leuk of juist niet leuk vindt.
  function groupFeel(d, hours) {
    const tags = [...tagsOf(d), ...(hours <= 3.5 ? ['kort'] : []), ...(hours >= 6 ? ['ver'] : [])];
    const up = [];
    const down = [];
    let mine = 0;
    for (const m of state.members) {
      const r = state.reactions.find((x) => x.user_id === m.id && x.dest === d.n);
      if (m.id === session.user.id && r) mine = r.value;
      const bad = m.dislikes.filter((c) => tags.includes(c));
      const good = m.likes.filter((c) => tags.includes(c));
      if (r && r.value < 0) down.push({ name: m.name, why: 'duim omlaag' });
      else if (r && r.value > 0) up.push({ name: m.name, why: '' });
      else if (bad.length) down.push({ name: m.name, why: `liever geen ${bad.map((c) => CAT_LABEL[c].toLowerCase()).join(', ')}` });
      else if (good.length) up.push({ name: m.name, why: good.map((c) => CAT_LABEL[c].toLowerCase()).join(', ') });
    }
    return { up, down, mine };
  }

  function groupFeelHtml(x) {
    if (state.members.length < 1) return '';
    const f = groupFeel(x.d, x.km / 800 + 0.5);
    return `<div class="pkg-group">
      <div class="feel">
        ${f.down.map((p) => `<span class="feel-row down" title="${esc(p.why)}">${avatar(p.name)}<span><strong>${esc(p.name)}</strong> ${esc(p.why)}</span></span>`).join('')}
        ${f.up.length ? `<span class="feel-row up">${f.up.slice(0, 5).map((p) => avatar(p.name)).join('')}<span>${esc(f.up.map((p) => p.name).join(', '))} ${f.up.length === 1 ? 'vindt' : 'vinden'} dit wat</span></span>` : ''}
        ${!f.up.length && !f.down.length ? '<span class="feel-row none">Nog geen reacties uit de groep</span>' : ''}
      </div>
      <div class="react" role="group" aria-label="Jouw reactie">
        <button type="button" class="react-btn${f.mine > 0 ? ' on' : ''}" data-react="1" data-dest="${esc(x.d.n)}" aria-pressed="${f.mine > 0}" aria-label="Leuk">${ic('thumbUp')}</button>
        <button type="button" class="react-btn down${f.mine < 0 ? ' on' : ''}" data-react="-1" data-dest="${esc(x.d.n)}" aria-pressed="${f.mine < 0}" aria-label="Liever niet">${ic('thumbDown')}</button>
      </div></div>`;
  }

  // Score bijstellen: wat de groep niet ziet zitten zakt, wat ze leuk vinden stijgt.
  function groupScoreDelta(d, hours) {
    const f = groupFeel(d, hours);
    return Math.max(-0.3, -0.12 * f.down.length) + Math.min(0.15, 0.05 * f.up.length);
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-react]');
    if (!btn) return;
    const dest = btn.dataset.dest;
    const value = btn.getAttribute('aria-pressed') === 'true' ? 0 : +btn.dataset.react;
    state.reactions = state.reactions.filter((r) => !(r.user_id === session.user.id && r.dest === dest));
    if (value) state.reactions.push({ user_id: session.user.id, dest, value });
    const card = btn.closest('.pkg');
    const x = card && ideaCtx.list[+card.dataset.pkg];
    if (x) card.querySelector('.pkg-group').outerHTML = groupFeelHtml(x);
    try { await api('/reactions', 'PUT', { dest, value }); } catch (err) { toast(err.message, true); }
  });

  /* --- wie heeft wat gepind: filter op de kaart --- */

  let whoFilter = '';
  const visibleOnMap = (it) => !whoFilter || (it.added_by || '').toLowerCase() === whoFilter.toLowerCase();

  function whoFilterHtml() {
    const counts = new Map();
    for (const l of locations()) if (l.added_by) counts.set(l.added_by, (counts.get(l.added_by) || 0) + 1);
    if (counts.size < 2 && !whoFilter) return '';
    return `<div class="who-filter" role="group" aria-label="Pinnen van">
      <button type="button" class="chip-btn${!whoFilter ? ' on' : ''}" data-who-filter="" aria-pressed="${!whoFilter}">Iedereen</button>
      ${[...counts].sort((a, b) => b[1] - a[1]).map(([n, c]) => `<button type="button" class="chip-btn${whoFilter === n ? ' on' : ''}" data-who-filter="${esc(n)}" aria-pressed="${whoFilter === n}">${avatar(n)}${esc(n)} <small>${c}</small></button>`).join('')}
    </div>`;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-who-filter]');
    if (!b) return;
    whoFilter = b.dataset.whoFilter;
    renderPanel();
  });
