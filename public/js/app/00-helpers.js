
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = { settings: {}, sections: [], trips: [], availability: [], polls: [], team: null, members: [], reactions: [] };

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

  // Naam van de site achter een link, voor knoppen als "Bekijk op Airbnb".
  function linkSite(u) {
    let h;
    try { h = new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
    if (/(^|\.)airbnb\./.test(h) || h === 'abnb.me') return 'Airbnb';
    if (/(^|\.)booking\.com$/.test(h)) return 'Booking';
    if (/(^|\.)vrbo\.com$/.test(h)) return 'Vrbo';
    if (/(^|\.)hostelworld\.com$/.test(h)) return 'Hostelworld';
    if (/(^|\.)expedia\./.test(h)) return 'Expedia';
    if (/(^|\.)rentalcars\.com$/.test(h)) return 'Rentalcars';
    if (/(^|\.)sunnycars\./.test(h)) return 'Sunny Cars';
    if (/(^|\.)discovercars\.com$/.test(h)) return 'DiscoverCars';
    if (/(^|\.)kayak\./.test(h)) return 'Kayak';
    return '';
  }
  const linkLabel = (u) => (linkSite(u) ? `Bekijk op ${linkSite(u)}` : 'Bekijk website');

  // Na het openen van een venster de cursor in een veld zetten, maar niet als je al in een ander veld
  // bent gaan typen (anders verspringt je tekst naar het verkeerde veld).
  function focusSoon(getEl) {
    setTimeout(() => {
      const el = typeof getEl === 'function' ? getEl() : getEl;
      const a = document.activeElement;
      if (!el || (a && a !== el && a.matches('input, textarea, select') && el.closest('dialog, form')?.contains(a))) return;
      el.focus();
    }, 50);
  }

  function lines(s) {
    return String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);
  }

  async function api(path, method = 'GET', body) {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    if (session.teamId) headers['X-Team'] = String(session.teamId);
    const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Er ging iets mis');
      err.status = res.status;
      err.code = data.code;
      // Uitgelogd of niet meer in de groep: terug naar het beginscherm.
      if (res.status === 401 && !path.startsWith('/auth/')) showAuth();
      else if (data.code === 'no-team') leaveTeamView();
      throw err;
    }
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

  // Ingelogde gebruiker en actieve groep.
  const session = { user: null, teams: [], teamId: null };
  const myName = () => (session.user ? session.user.name : '');

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

  // Lijn-iconen (24×24, kleur volgt de tekst) in plaats van gekleurde emoji.
  const ICONS = {
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    suitcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
    vote: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    bed: '<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>',
    car: '<path d="M5 17h14M3 17v-4l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v4a1 1 0 0 1-1 1h-1M5 18H4a1 1 0 0 1-1-1M3 13h18"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>',
    sparkles: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    compass: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    menu: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    thumbUp: '<path d="M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z"/>',
    thumbDown: '<path d="M17 14V2M9 18.1 10 14H4.2a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9z"/>',
  };
  const ic = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const KIND_ICONS = { map: 'pin', flight: 'plane', stay: 'bed', car: 'car', do: 'sparkles', eat: 'utensils' };
  // Vaste soorten krijgen een lijn-icoon; eigen tabs houden het icoon dat iemand zelf koos.
  const kindIcon = (kind, own) => (KIND_ICONS[kind] ? ic(KIND_ICONS[kind]) : esc(own || ''));

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
    state.team = data.team;
    state.members = data.members || [];
    state.reactions = data.reactions || [];
    session.user = data.me || session.user;
    const own = session.teams.find((t) => t.id === data.team.id);
    if (own) own.name = data.team.name;
    render();
    if (pinCtx && pinDialog.open) renderPinSheet();
    refreshTripAdd();
  }
