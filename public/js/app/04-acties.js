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
    'select-trips': () => { tripSelect = []; render(); },
    'select-cancel': () => { tripSelect = null; render(); },
    'share-bundle': () => shareBundle(),
    'plan-window': (btn) => openDestDialog(btn.dataset.start, btn.dataset.end),
    'edit-poll': () => openPollDialog(),
    async 'remove-person'(btn) {
      const name = btn.dataset.name;
      if (!confirm(`Alle aangevinkte dagen van ${name} verwijderen?`)) return;
      await api(`/availability/${encodeURIComponent(name)}`, 'DELETE');
      await reload();
      toast('Verwijderd');
    },
    'add-item': (btn) => openItemDialog(null, +btn.dataset.id),
    'add-place': () => {
      const s = mapSection();
      if (s) openItemDialog(null, s.id);
    },
    'add-section': () => openSectionDialog(null),
    'edit-section': (btn) => openSectionDialog(findSection(+btn.dataset.id)),
    'edit-site': () => openSiteDialog(),
    'edit-item': (btn) => openItemDialog(findItem(+btn.dataset.id)),
    'open-pin': (btn) => openPin(+btn.dataset.id),
    'link-item': (btn) => openLinkDialog(findItem(+btn.dataset.loc), findSection(+btn.dataset.section)),
    'map-fit': () => fitAll(true),
    'focus-search': () => { const el = $('#placeSearch'); if (el) el.focus(); },
  };

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-return]')) store.remove('returnPin');
    const btn = e.target.closest('[data-action]');
    if (btn && actions[btn.dataset.action]) {
      btn.disabled = true;
      try { await actions[btn.dataset.action](btn); } catch (err) { toast(err.message, true); }
      if (btn.isConnected) btn.disabled = false;
      return;
    }
    // Tik op een kaart om hem aan te passen.
    if (e.target.closest('a, button, dialog, input, label')) return;
    openCard(e.target.closest('[data-item], [data-trip]'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-item], [data-trip]')) openCard(e.target);
  });

  function openCard(card) {
    if (!card) return;
    if (tripSelect && card.dataset.trip) { toggleTripSelect(+card.dataset.trip); return; }
    if (card.dataset.item) openItemDialog(findItem(+card.dataset.item));
    else openTripDialog(state.trips.find((t) => t.id === +card.dataset.trip));
  }
