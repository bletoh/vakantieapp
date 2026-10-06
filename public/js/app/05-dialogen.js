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
      addToTrip: item ? null : preset.addToTrip || null,
    };
    const section = findSection(itemCtx.sectionId);
    $('#itemDialogTitle').textContent = item ? 'Aanpassen' : addLabel(section);
    for (const f of ['title', 'subtitle', 'price', 'rating', 'body', 'pros', 'cons', 'link', 'added_by']) {
      itemForm.elements[f].value = item ? (item[f] ?? '') : '';
    }
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
    resetLinkFetch(item);
    itemDialog.showModal();
    if (!item) focusSoon(() => (section && (section.kind === 'stay' || preset.focusLink) ? $('#itemLink') : itemForm.elements.title));
  }

  /* --- link plakken: naam, foto, score en ligging ophalen --- */

  let fetchedLink = '';
  const LINK_HINT = 'Plak een link, dan vullen we de naam, foto en score voor je in.';
  function setLinkStatus(text, kind = '') {
    const el = $('#linkFetchStatus');
    el.textContent = text;
    el.className = `link-status${kind ? ' ' + kind : ''}`;
  }
  function resetLinkFetch(item) {
    fetchedLink = item ? item.link || '' : '';
    setLinkStatus(item && item.link ? 'Andere link geplakt? Tik op Ophalen om lege velden aan te vullen.' : LINK_HINT);
    $('#linkFetchBtn').disabled = false;
  }

  async function fetchLinkInfo() {
    if ($('#linkFetchBtn').disabled) return;
    const input = $('#itemLink');
    const raw = input.value.trim();
    // Uit een gedeeld Airbnb-bericht alleen de link halen ("Bekijk dit verblijf: https://…").
    const m = /https?:\/\/\S+/.exec(raw);
    if (!m) { if (raw) setLinkStatus('Dat lijkt geen link. Hij begint meestal met https://', 'warn'); return; }
    const url = m[0];
    if (url !== raw) input.value = url;
    fetchedLink = url;
    const ctx = itemCtx;
    const btn = $('#linkFetchBtn');
    btn.disabled = true;
    setLinkStatus('Gegevens ophalen…', 'loading-dots');
    let info;
    try { info = await api('/link-info', 'POST', { url }); } catch (err) { info = { blocked: true, error: err.message }; }
    btn.disabled = false;
    if (ctx !== itemCtx || !itemDialog.open) return;
    if (info.link && info.link !== url) { input.value = info.link; fetchedLink = info.link; }
    const el = itemForm.elements;
    const filled = [];
    const fill = (name, value, label) => {
      if (!value || !el[name] || String(el[name].value).trim()) return;
      el[name].value = value;
      filled.push(label);
    };
    fill('title', info.title, 'naam');
    const sub = [info.ratingText, info.subtitle, info.guests ? `max ${info.guests} gasten` : ''].filter(Boolean).join(' · ');
    fill('subtitle', sub, 'details');
    if (!$('#priceField').hidden) fill('price', info.price, 'prijs');
    fill('rating', info.rating ? String(info.rating) : '', 'score');
    fill('body', info.body, 'beschrijving');
    if (info.image && !itemCtx.image) { itemCtx.image = info.image; renderItemImage(); filled.push('foto'); }
    if (info.lat != null && info.lng != null) {
      if (itemCtx.lat == null) { itemCtx.lat = info.lat; itemCtx.lng = info.lng; }
      // Nog geen bestemming gekozen: de dichtstbijzijnde pin (binnen 150 km).
      if (!$('#locationField').hidden && !el.location_id.value) {
        const near = locations().filter(hasPos)
          .map((l) => ({ l, km: distanceKm([info.lat, info.lng], [l.lat, l.lng]) }))
          .sort((a, b) => a.km - b.km)[0];
        if (near && near.km < 150) { el.location_id.value = String(near.l.id); filled.push(`bestemming ${shortName(near.l.title)}`); }
      }
    }
    const site = info.site ? ` van ${info.site}` : '';
    const needPrice = !$('#priceField').hidden && !el.price.value.trim();
    if (info.blocked) {
      setLinkStatus(`${info.site || 'Deze site'} laat ons de gegevens niet ophalen${filled.length ? `; de ${filled.join(', ')} staat er al in` : ''}. Vul de rest even zelf in. De link blijft gewoon werken.`, 'warn');
    } else if (filled.length) {
      setLinkStatus(`✓ Ingevuld${site}: ${filled.join(', ')}.${needPrice ? ' De prijs staat niet in de link: vul de totaalprijs zelf in.' : ''}`, 'ok');
    } else {
      setLinkStatus(`Opgehaald${site}; de velden waren al ingevuld.`, 'ok');
    }
    if (needPrice) el.price.placeholder = 'Bijv. € 1.250 totaal';
    if (needPrice && !info.blocked) el.price.focus();
    else if (!el.title.value.trim()) el.title.focus();
  }

  $('#linkFetchBtn').addEventListener('click', fetchLinkInfo);
  // Bij plakken meteen ophalen; bij typen pas als je het veld verlaat.
  $('#itemLink').addEventListener('paste', () => setTimeout(fetchLinkInfo, 0));
  $('#itemLink').addEventListener('change', () => { if ($('#itemLink').value.trim() && $('#itemLink').value.trim() !== fetchedLink) fetchLinkInfo(); });
  $('#itemLink').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchLinkInfo(); } });

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
    delete data.added_by;
    try {
      const isNew = !itemCtx.id;
      const id = isNew
        ? (await api(`/sections/${itemCtx.sectionId}/items`, 'POST', data)).id
        : (await api(`/items/${itemCtx.id}`, 'PUT', data), itemCtx.id);
      if (wantBest !== itemCtx.wasBest) await api(`/items/${id}/best`, 'PUT');
      itemDialog.close();
      // Toegevoegd vanuit een reis: meteen in die reis zetten.
      const addTo = isNew && itemCtx.addToTrip && state.trips.find((t) => t.id === itemCtx.addToTrip);
      if (addTo) await setTripItem(addTo, id, true);
      await reload();
      toast(isNew ? (addTo ? `Toegevoegd aan ${addTo.title} ✓` : 'Toegevoegd, bedankt! ✓') : 'Opgeslagen ✓');
      const saved = findItem(id);
      // Nieuwe bestemming: meteen het planpaneel openen.
      if (isNew && saved && sectionOf(saved).kind === 'map') openPin(saved.id);
      // Nieuwe suggestie bij een bestemming: ook in de reis van die bestemming zetten.
      else if (isNew && saved && saved.location_id && findItem(saved.location_id)) await syncTrip(findItem(saved.location_id));
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
    $('#linkDialogTitle').textContent = `${section.icon} ${section.title} kiezen voor ${shortName(loc.title)}`;
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
      await syncTrip(linkCtx.loc, unlink ? { remove: it.id } : {});
      toast(unlink ? 'Ontkoppeld' : 'Gekoppeld ✓');
      if (!unlink && linkCtx.section.kind === 'flight') animateFlight(linkCtx.loc.id);
    } catch (err) { toast(err.message, true); }
  });

  $('#linkNew').addEventListener('click', () => {
    linkDialog.close();
    openItemDialog(null, linkCtx.section.id, { location_id: linkCtx.loc.id });
  });
