(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = { settings: {}, sections: [], editing: false };

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

  function lines(s) {
    return String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);
  }

  async function api(path, method = 'GET', body) {
    const res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Er ging iets mis');
    return data;
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  const liked = (() => {
    let set;
    try { set = new Set(JSON.parse(localStorage.getItem('liked') || '[]')); } catch { set = new Set(); }
    return {
      has: (id) => set.has(id),
      toggle(id) {
        set.has(id) ? set.delete(id) : set.add(id);
        try { localStorage.setItem('liked', JSON.stringify([...set])); } catch { /* ignore */ }
        return set.has(id);
      },
    };
  })();

  const findSection = (id) => state.sections.find((s) => s.id === id);
  const findItem = (id) => {
    for (const s of state.sections) {
      const it = s.items.find((i) => i.id === id);
      if (it) return it;
    }
    return null;
  };
  const sortedItems = (s) => [...s.items].sort((a, b) => a.position - b.position || a.id - b.id);

  let pendingSave = Promise.resolve();

  async function reload() {
    await pendingSave;
    const data = await api('/content');
    state.settings = data.settings;
    state.sections = data.sections;
    render();
  }

  /* ---------- routing ---------- */

  function currentRoute() {
    const m = /^#tab-(\d+)$/.exec(location.hash);
    if (m && findSection(+m[1])) return +m[1];
    return state.sections.length ? state.sections[0].id : null;
  }

  window.addEventListener('hashchange', () => {
    renderTabs();
    renderPanel();
    const tabsTop = $('#tabs').getBoundingClientRect().top + window.scrollY - $('.topbar').offsetHeight;
    if (window.scrollY > tabsTop) window.scrollTo({ top: tabsTop, behavior: 'smooth' });
  });

  /* ---------- editable markup ---------- */

  // Een bewerkbaar tekstveld. path = "settings.key" | "section.id.field" | "item.id.field"
  function ed(path, value, { tag = 'span', cls = '', single = true, placeholder = '' } = {}) {
    const ce = state.editing ? ` contenteditable="true" spellcheck="true"` : '';
    return `<${tag} class="${cls}" data-edit="${path}"${single ? ' data-single' : ''}`
      + ` data-placeholder="${esc(placeholder)}"${ce}>${esc(value)}</${tag}>`;
  }

  function imgEditBtn(path, label = 'Foto wijzigen') {
    return `<button type="button" class="img-edit edit-only" data-image="${path}">📷 ${label}</button>`;
  }

  function stars(n) {
    if (!n) return '';
    return `<span class="stars" aria-label="${n} van 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
  }

  /* ---------- rendering ---------- */

  function render() {
    document.body.classList.toggle('editing', state.editing);
    const t = $('#editToggle');
    t.setAttribute('aria-pressed', String(state.editing));
    $('.edit-toggle-label', t).textContent = state.editing ? 'Klaar' : 'Bewerken';
    renderChrome();
    renderHero();
    renderTabs();
    renderPanel();
  }

  function renderChrome() {
    const title = state.settings.site_title || 'Vakantie';
    document.title = title;
    $('#brand').textContent = title;
    $('#footer').innerHTML = ed('settings.footer_text', state.settings.footer_text, {
      single: false, placeholder: 'Voettekst…',
    });
  }

  function renderHero() {
    const s = state.settings;
    const img = safeUrl(s.hero_image);
    const chip = (key, icon, ph) => (s[key] || state.editing)
      ? `<span class="chip-glass">${icon} ${ed('settings.' + key, s[key], { placeholder: ph })}</span>` : '';
    $('#hero').innerHTML = `
      ${img ? `<img class="hero-img" src="${esc(img)}" alt="">` : ''}
      ${imgEditBtn('settings.hero_image', 'Omslagfoto')}
      <div class="hero-content">
        <div class="hero-meta">
          ${chip('destination', '📍', 'Bestemming')}
          ${chip('date_text', '🗓️', 'Datum')}
        </div>
        ${ed('settings.site_title', s.site_title, { tag: 'h1', placeholder: 'Titel' })}
        ${ed('settings.site_subtitle', s.site_subtitle, { tag: 'p', single: false, placeholder: 'Ondertitel' })}
      </div>`;
  }

  function renderTabs() {
    const route = currentRoute();
    const tab = (href, icon, title, active) =>
      `<a class="tab${active ? ' active' : ''}" href="${href}"${active ? ' aria-current="page"' : ''}>`
      + `<span aria-hidden="true">${esc(icon)}</span>${esc(title)}</a>`;
    const nav = $('#tabs');
    nav.innerHTML = state.sections.map((s) => tab('#tab-' + s.id, s.icon, s.title, route === s.id)).join('')
      + (state.editing ? '<button type="button" class="tab add" data-action="add-section">＋ Tab</button>' : '');
    const active = $('.tab.active', nav);
    if (active) {
      const left = active.offsetLeft - nav.clientWidth / 2 + active.clientWidth / 2;
      nav.scrollTo({ left, behavior: 'smooth' });
    }
  }

  function renderPanel() {
    const route = currentRoute();
    const panel = $('#panel');
    const s = findSection(route);
    panel.innerHTML = s ? sectionHtml(s) : `
      <div class="empty">
        <p>Er zijn nog geen tabs.</p>
        <p class="view-only">Zet de bewerkmodus aan om een tab toe te voegen.</p>
        <button type="button" class="btn primary edit-only" style="margin:0 auto" data-action="add-section">＋ Tab toevoegen</button>
      </div>`;
  }

  function sectionHtml(s) {
    const items = sortedItems(s);
    const best = items.find((i) => i.is_best);
    const others = items.filter((i) => i !== best);
    const idx = state.sections.indexOf(s);

    return `
      <div class="section-head">
        <h2>${ed(`section.${s.id}.icon`, s.icon, { placeholder: '⭐' })}${ed(`section.${s.id}.title`, s.title, { placeholder: 'Tabnaam' })}</h2>
        ${(s.intro || state.editing) ? ed(`section.${s.id}.intro`, s.intro, {
          tag: 'p', cls: 'section-intro', single: false, placeholder: 'Korte introductie van dit onderdeel…',
        }) : ''}
        <div class="section-tools edit-only">
          <button type="button" class="btn sm" data-action="move-section" data-id="${s.id}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>← Tab</button>
          <button type="button" class="btn sm" data-action="move-section" data-id="${s.id}" data-dir="1" ${idx === state.sections.length - 1 ? 'disabled' : ''}>Tab →</button>
          <button type="button" class="btn sm ghost danger" data-action="delete-section" data-id="${s.id}">Tab verwijderen</button>
        </div>
      </div>
      <button type="button" class="add-cta" data-action="add-item" data-id="${s.id}">
        <span class="add-cta-plus" aria-hidden="true">＋</span>
        <span>${esc(addLabel(s))}</span>
      </button>
      ${best ? cardHtml(best, s, items, true) : ''}
      ${others.length ? `
        <div class="label">${best ? 'Andere opties' : 'Opties'}</div>
        <div class="grid">${others.map((i) => cardHtml(i, s, items, false)).join('')}</div>` : ''}
      ${!items.length ? `
        <div class="empty">
          <p>Nog niets toegevoegd. Wees de eerste!</p>
        </div>` : ''}`;
  }

  function addLabel(s) {
    const t = (s.title || '').trim();
    return 'Voeg ' + (t ? t.charAt(0).toLowerCase() + t.slice(1) : 'iets') + ' toe';
  }

  function cardHtml(it, s, items, feature) {
    const img = safeUrl(it.image);
    const link = safeUrl(it.link);
    const pros = lines(it.pros);
    const cons = lines(it.cons);
    const pos = items.indexOf(it);
    const isLiked = liked.has(it.id);
    const p = `item.${it.id}`;

    return `
      <article class="card${it.is_best ? ' best' : ''}${feature ? ' feature' : ''}" id="item-${it.id}">
        ${it.is_best ? '<span class="badge-best">🏆 Beste keuze</span>' : ''}
        <div class="card-media">
          ${img ? `<img src="${esc(img)}" alt="${esc(it.title)}" loading="lazy">` : `<div class="placeholder">${esc(s.icon)}</div>`}
          ${imgEditBtn(p + '.image')}
        </div>
        <div class="card-body">
          ${(it.subtitle || state.editing) ? ed(p + '.subtitle', it.subtitle, { cls: 'card-sub', placeholder: 'Ondertitel' }) : ''}
          ${ed(p + '.title', it.title, { tag: 'h3', cls: 'card-title', placeholder: 'Titel' })}
          ${it.added_by ? `<div class="added-by">Voorgesteld door ${esc(it.added_by)}</div>` : ''}
          ${(it.price || it.rating || state.editing) ? `
            <div class="card-meta">
              ${(it.price || state.editing) ? ed(p + '.price', it.price, { cls: 'price', placeholder: 'Prijs' }) : ''}
              ${stars(it.rating)}
            </div>` : ''}
          ${(it.body || state.editing) ? ed(p + '.body', it.body, { tag: 'p', cls: 'card-text', single: false, placeholder: 'Beschrijving…' }) : ''}
          ${pros.length ? `<ul class="pc pros">${pros.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
          ${cons.length ? `<ul class="pc cons">${cons.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
          <div class="card-foot">
            <button type="button" class="like${isLiked ? ' on' : ''}" data-action="like" data-id="${it.id}" aria-pressed="${isLiked}" aria-label="Vind ik leuk">
              <span class="heart">❤️</span><span class="count">${it.likes || 0}</span>
            </button>
            ${link ? `<a class="link-btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Bekijk ↗</a>` : ''}
          </div>
        </div>
        <div class="card-tools edit-only">
          <button type="button" class="btn sm${it.is_best ? ' on' : ''}" data-action="best" data-id="${it.id}">🏆 ${it.is_best ? 'Beste keuze' : 'Maak beste'}</button>
          <button type="button" class="btn sm" data-action="edit-item" data-id="${it.id}">✎ Alles bewerken</button>
          <button type="button" class="btn sm" data-action="move-item" data-id="${it.id}" data-dir="-1" ${pos === 0 ? 'disabled' : ''} aria-label="Omhoog">↑</button>
          <button type="button" class="btn sm" data-action="move-item" data-id="${it.id}" data-dir="1" ${pos === items.length - 1 ? 'disabled' : ''} aria-label="Omlaag">↓</button>
          <button type="button" class="btn sm ghost danger" data-action="delete-item" data-id="${it.id}" aria-label="Verwijderen">🗑</button>
        </div>
      </article>`;
  }

  /* ---------- saving ---------- */

  async function saveField(path, value) {
    const [kind, a, b] = path.split('.');
    if (kind === 'settings') {
      await api('/settings', 'PUT', { [a]: value });
      state.settings[a] = value;
    } else if (kind === 'section') {
      await api(`/sections/${a}`, 'PUT', { [b]: value });
      findSection(+a)[b] = value;
    } else if (kind === 'item') {
      await api(`/items/${a}`, 'PUT', { [b]: value });
      findItem(+a)[b] = value;
    }
  }

  // Inline tekst bewerken
  const panelRoots = document.body;
  panelRoots.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-edit]');
    if (el) el.dataset.original = el.innerText.trim();
  });

  panelRoots.addEventListener('focusout', async (e) => {
    const el = e.target.closest('[data-edit]');
    if (!el || !state.editing) return;
    const path = el.dataset.edit;
    const value = el.innerText.replace(/ /g, ' ').trim();
    if (value === el.dataset.original) return;
    const required = /\.(title)$/.test(path) && !path.startsWith('settings');
    if (required && !value) {
      el.innerText = el.dataset.original;
      toast('Titel mag niet leeg zijn', true);
      return;
    }
    try {
      pendingSave = saveField(path, value);
      await pendingSave;
      el.dataset.original = value;
      if (!value) el.innerHTML = '';
      toast('Opgeslagen ✓');
      if (path.startsWith('section.') || path === 'settings.site_title') {
        renderChrome();
        renderTabs();
      }
    } catch (err) {
      pendingSave = Promise.resolve();
      toast(err.message, true);
    }
  });

  panelRoots.addEventListener('keydown', (e) => {
    const el = e.target.closest('[data-edit]');
    if (!el) return;
    if (e.key === 'Enter' && el.hasAttribute('data-single')) { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.innerText = el.dataset.original || ''; el.blur(); }
  });

  panelRoots.addEventListener('paste', (e) => {
    const el = e.target.closest('[data-edit]');
    if (!el) return;
    e.preventDefault();
    let text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (el.hasAttribute('data-single')) text = text.replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
  });

  /* ---------- actions ---------- */

  const actions = {
    async like(btn) {
      const id = +btn.dataset.id;
      const on = liked.toggle(id);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      try {
        const { likes } = await api(`/items/${id}/like`, 'POST', { delta: on ? 1 : -1 });
        findItem(id).likes = likes;
        $('.count', btn).textContent = likes;
      } catch (err) { toast(err.message, true); }
    },

    async 'add-section'() {
      const { id } = await api('/sections', 'POST', { title: 'Nieuwe tab', icon: '⭐' });
      await reload();
      location.hash = '#tab-' + id;
      setTimeout(() => {
        const t = $(`[data-edit="section.${id}.title"]`);
        if (t) { t.focus(); document.getSelection().selectAllChildren(t); }
      }, 50);
    },

    async 'move-section'(btn) {
      const ids = state.sections.map((s) => s.id);
      const i = ids.indexOf(+btn.dataset.id);
      const j = i + +btn.dataset.dir;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await api('/sections/reorder', 'PUT', { ids });
      await reload();
    },

    async 'delete-section'(btn) {
      const s = findSection(+btn.dataset.id);
      if (!confirm(`Tab "${s.title}" en alle ${s.items.length} opties verwijderen?`)) return;
      await api(`/sections/${s.id}`, 'DELETE');
      location.hash = '';
      await reload();
      toast('Tab verwijderd');
    },

    'add-item'(btn) { openItemDialog(null, +btn.dataset.id); },
    'edit-item'(btn) { openItemDialog(findItem(+btn.dataset.id)); },

    async best(btn) {
      await api(`/items/${btn.dataset.id}/best`, 'PUT');
      await reload();
    },

    async 'move-item'(btn) {
      const it = findItem(+btn.dataset.id);
      const ids = sortedItems(findSection(it.section_id)).map((i) => i.id);
      const i = ids.indexOf(it.id);
      const j = i + +btn.dataset.dir;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await api(`/sections/${it.section_id}/items/reorder`, 'PUT', { ids });
      await reload();
    },

    async 'delete-item'(btn) {
      const it = findItem(+btn.dataset.id);
      if (!confirm(`"${it.title}" verwijderen?`)) return;
      await api(`/items/${it.id}`, 'DELETE');
      await reload();
      toast('Verwijderd');
    },
  };

  document.addEventListener('click', async (e) => {
    const imgBtn = e.target.closest('[data-image]');
    if (imgBtn) { openImageDialog(imgBtn.dataset.image); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn || !actions[btn.dataset.action]) return;
    btn.disabled = true;
    try { await actions[btn.dataset.action](btn); } catch (err) { toast(err.message, true); }
    if (btn.isConnected) btn.disabled = false;
  });

  function setEditing(on) {
    if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
    state.editing = on;
    try { localStorage.setItem('editing', on ? '1' : ''); } catch { /* ignore */ }
    render();
  }
  $('#editToggle').addEventListener('click', () => setEditing(!state.editing));
  $('#editDone').addEventListener('click', () => setEditing(false));

  /* ---------- dialogs ---------- */

  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  });

  // Item dialog
  const itemDialog = $('#itemDialog');
  const itemForm = $('#itemForm');
  let itemCtx = null; // { id, sectionId, image }

  function renderFormImage() {
    const img = safeUrl(itemCtx.image);
    const s = findSection(itemCtx.sectionId);
    $('#itemImageField').innerHTML = `
      ${img ? `<img src="${esc(img)}" alt="">` : `<div class="placeholder">${esc(s ? s.icon : '📷')}</div>`}
      <button type="button" class="img-edit" data-image="form">📷 ${img ? 'Wijzigen' : 'Foto toevoegen'}</button>`;
  }

  function openItemDialog(item, sectionId) {
    itemCtx = { id: item ? item.id : null, sectionId: item ? item.section_id : sectionId, image: item ? item.image : '' };
    const section = findSection(itemCtx.sectionId);
    $('#itemDialogTitle').textContent = item ? 'Bewerken' : addLabel(section);
    for (const f of ['title', 'subtitle', 'price', 'rating', 'body', 'pros', 'cons', 'link', 'added_by']) {
      itemForm.elements[f].value = item ? (item[f] ?? '') : '';
    }
    if (!item) {
      try { itemForm.elements.added_by.value = localStorage.getItem('name') || ''; } catch { /* ignore */ }
    }
    renderFormImage();
    itemDialog.showModal();
    if (!item) setTimeout(() => itemForm.elements.title.focus(), 50);
  }

  itemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(itemForm);
    const data = Object.fromEntries(fd.entries());
    data.image = itemCtx.image || '';
    try { if (data.added_by) localStorage.setItem('name', data.added_by.trim()); } catch { /* ignore */ }
    try {
      if (itemCtx.id) await api(`/items/${itemCtx.id}`, 'PUT', data);
      else await api(`/sections/${itemCtx.sectionId}/items`, 'POST', data);
      const isNew = !itemCtx.id;
      itemDialog.close();
      await reload();
      toast(isNew ? 'Toegevoegd, bedankt! ✓' : 'Opgeslagen ✓');
    } catch (err) { toast(err.message, true); }
  });

  // Image dialog
  const imageDialog = $('#imageDialog');
  let imageTarget = null;

  function openImageDialog(target) {
    imageTarget = target;
    $('#imageUrl').value = '';
    $('#imageFile').value = '';
    imageDialog.showModal();
  }

  async function applyImage(url) {
    if (imageTarget === 'form') {
      itemCtx.image = url;
      renderFormImage();
    } else {
      await saveField(imageTarget, url);
      if (imageTarget.startsWith('settings.')) renderHero(); else renderPanel();
      toast('Opgeslagen ✓');
    }
    imageDialog.close();
  }

  // Verklein foto's in de browser zodat uploads vanaf een telefoon snel gaan.
  function resizeImage(file, max = 1920, quality = 0.85) {
    return new Promise((resolve, reject) => {
      if (file.type === 'image/gif') {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Kon afbeelding niet lezen')); };
      img.src = url;
    });
  }

  $('#imageFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast('Uploaden…');
    try {
      const data = await resizeImage(file);
      const { url } = await api('/upload', 'POST', { data });
      await applyImage(url);
    } catch (err) { toast(err.message, true); }
  });

  $('#imageUrlSave').addEventListener('click', async () => {
    const url = safeUrl($('#imageUrl').value.trim());
    if (!url) { toast('Ongeldige link', true); return; }
    try { await applyImage(url); } catch (err) { toast(err.message, true); }
  });

  $('#imageRemove').addEventListener('click', async () => {
    try { await applyImage(''); } catch (err) { toast(err.message, true); }
  });

  /* ---------- init ---------- */

  try { state.editing = localStorage.getItem('editing') === '1'; } catch { /* ignore */ }
  reload().catch((err) => {
    $('#panel').innerHTML = `<div class="empty">Kon de inhoud niet laden: ${esc(err.message)}</div>`;
  });
})();
