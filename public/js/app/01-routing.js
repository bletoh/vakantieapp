  /* ---------- routing ---------- */

  // Routes: #kaart (start), #pin-12 (kaart met planpaneel van pin 12), #datum, #reizen, #stem, #stem-abc, #tab-3.
  function currentRoute() {
    const h = location.hash;
    if (h === '#reizen') return 'reizen';
    if (h === '#stem' || /^#stem-\w+$/.test(h)) return 'stem';
    if (h === '#datum') return 'datum';
    if (h === '#ideeen') return 'ideeen';
    if (h === '#chat') return 'chat';
    if (h === '#groep') return 'groep';
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
    // Op het inlog- of groepenscherm is er nog geen groep om te tonen.
    if (!session.teamId || !state.team) return;
    renderTabs();
    renderPanel();
    if (currentRoute() !== 'kaart') {
      const tabsTop = $('#tabs').getBoundingClientRect().top + window.scrollY;
      if (window.scrollY > tabsTop) window.scrollTo({ top: tabsTop, behavior: 'smooth' });
    }
  });
