  /* ---------- datums ---------- */

  const toDate = (iso) => new Date(iso + 'T00:00:00Z');
  const isoOf = (d) => d.toISOString().slice(0, 10);
  const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
  const dayCount = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5) + 1;
  const fmt = (iso, opts) => toDate(iso).toLocaleDateString('nl-NL', { timeZone: 'UTC', ...opts });
  const fmtShort = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  const todayIso = () => {
    const n = new Date();
    return isoOf(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
  };
  const rangeDays = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
  const rangeText = (a, b) => (a === b ? fmtShort(a) : `${fmtShort(a)} – ${fmtShort(b)}`);

  function pollSettings() {
    const start = state.settings.poll_start || todayIso();
    let end = state.settings.poll_end || addDays(start, 7 * 12 - 1);
    if (end < start) end = start;
    const days = Math.max(1, Math.min(60, parseInt(state.settings.trip_days, 10) || 7));
    return { start, end, days };
  }

  // Wie kan wanneer: per persoon een set met datums.
  function availabilityMap() {
    const byName = new Map();
    for (const { name, date } of state.availability) {
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(date);
    }
    return byName;
  }

  // Beste periodes: zoveel mogelijk mensen die álle dagen kunnen, daarna de meeste persoon-dagen.
  function bestWindows(byName, { start, end, days }) {
    const people = [...byName.keys()];
    if (!people.length || dayCount(start, end) < days) return [];
    const windows = [];
    for (let s = start; addDays(s, days - 1) <= end; s = addDays(s, 1)) {
      const range = rangeDays(s, addDays(s, days - 1));
      const per = people.map((name) => ({ name, n: range.filter((d) => byName.get(name).has(d)).length }));
      windows.push({
        start: s,
        end: range[range.length - 1],
        full: per.filter((p) => p.n === days).map((p) => p.name),
        partial: per.filter((p) => p.n > 0 && p.n < days),
        none: per.filter((p) => p.n === 0).map((p) => p.name),
        score: per.reduce((sum, p) => sum + p.n, 0),
      });
    }
    windows.sort((a, b) => b.full.length - a.full.length || b.score - a.score || (a.start < b.start ? -1 : 1));
    const picked = [];
    for (const w of windows) {
      if (w.score === 0) break;
      if (picked.some((p) => !(w.end < p.start || w.start > p.end))) continue;
      picked.push(w);
      if (picked.length === 3) break;
    }
    return picked;
  }

  // Wie kan niet tijdens een reis (alleen mensen die de datumprikker hebben ingevuld).
  function conflictsOf(trip) {
    if (!trip.start_date || !trip.end_date) return null;
    // Valt de reis helemaal buiten de periode van de datumprikker, dan weten we niet wie er kan.
    const cfg = pollSettings();
    if (trip.end_date < cfg.start || trip.start_date > cfg.end) return null;
    const range = rangeDays(trip.start_date, trip.end_date);
    const out = [];
    for (const [name, set] of availabilityMap()) {
      const ok = range.filter((d) => set.has(d)).length;
      if (ok < range.length) out.push({ name, ok, total: range.length });
    }
    return out;
  }

  function conflictText(list) {
    return list.map((c) => `${esc(c.name)} (${c.ok} van ${c.total} dagen)`).join(', ');
  }

  function tripDatesHtml(t) {
    if (!t.start_date) return '';
    const conflicts = conflictsOf(t);
    const n = dayCount(t.start_date, t.end_date);
    return `
      <div class="trip-dates">${rangeText(t.start_date, t.end_date)} · ${n} ${n === 1 ? 'dag' : 'dagen'}</div>
      ${!conflicts ? (availabilityMap().size ? '<div class="hint">Valt buiten de periode van de datumprikker</div>' : '')
        : conflicts.length ? `<div class="conflict-note"><strong>Kan niet:</strong> ${conflictText(conflicts)}</div>`
        : availabilityMap().size ? '<div class="ok-note">✓ Iedereen kan</div>' : ''}`;
  }

  function pollHtml() {
    const cfg = pollSettings();
    const byName = availabilityMap();
    const me = myName().trim();
    const mine = byName.get(me) || new Set();
    const people = [...byName.keys()].sort((a, b) => a.localeCompare(b, 'nl'));
    const best = bestWindows(byName, cfg);
    const dated = state.trips.filter((t) => t.start_date);

    // Kalender: maanden met weken die op maandag beginnen.
    const tripDays = new Map();
    for (const t of dated) for (const d of rangeDays(t.start_date, t.end_date)) tripDays.set(d, (conflictsOf(t) || []).length ? 'conflict' : 'ok');
    const months = [];
    let cursor = cfg.start.slice(0, 8) + '01';
    while (cursor <= cfg.end) {
      const first = cursor;
      const next = isoOf(new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7), 1)));
      const last = addDays(next, -1);
      let weekStart = addDays(first, -((toDate(first).getUTCDay() + 6) % 7));
      const weeks = [];
      while (weekStart <= last) {
        const days = rangeDays(weekStart, addDays(weekStart, 6));
        const inRange = days.filter((d) => d >= cfg.start && d <= cfg.end && d.slice(0, 7) === first.slice(0, 7));
        weeks.push(`
          <button type="button" class="wk" data-week="${inRange.join(',')}"${inRange.length ? '' : ' disabled'} aria-label="Week ${weekNumber(weekStart)}: hele week aan of uit">${weekNumber(weekStart)}</button>
          ${days.map((d) => {
            if (d.slice(0, 7) !== first.slice(0, 7)) return '<span class="day out"></span>';
            const active = d >= cfg.start && d <= cfg.end;
            const count = people.filter((p) => byName.get(p).has(d)).length;
            const heat = people.length ? count / people.length : 0;
            const cls = ['day', mine.has(d) ? 'mine' : '', active ? '' : 'off', tripDays.has(d) ? `trip-${tripDays.get(d)}` : ''].join(' ');
            return `<button type="button" class="${cls}" data-day="${d}" style="--heat:${heat.toFixed(2)}"${active ? '' : ' disabled'}
              aria-pressed="${mine.has(d)}" aria-label="${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}, ${count} kunnen">
              <span class="dnum">${+d.slice(8)}</span>${count ? `<span class="dcount">${count}</span>` : ''}</button>`;
          }).join('')}`);
        weekStart = addDays(weekStart, 7);
      }
      months.push(`
        <div class="month">
          <div class="month-head">
            <h3 class="month-title">${fmt(first, { month: 'long', year: 'numeric' })}</h3>
            ${me ? (() => {
              const md = rangeDays(first, last).filter((d) => d >= cfg.start && d <= cfg.end);
              const all = md.length && md.every((d) => mine.has(d));
              return md.length ? `<button type="button" class="text-btn" data-week="${md.join(',')}" aria-pressed="${all}">${all ? 'Hele maand wissen' : 'Ik kan de hele maand'}</button>` : '';
            })() : ''}
          </div>
          <div class="cal">
            <span class="dow"></span>${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((d) => `<span class="dow">${d}</span>`).join('')}
            ${weeks.join('')}
          </div>
        </div>`);
      cursor = next;
    }

    const back = findItem(+store.get('returnPin'));
    return `
      ${back ? `<div class="return-bar">
        <span>Klaar met invullen?</span>
        <a class="btn sm primary" href="#pin-${back.id}" data-return>← Terug naar ${esc(shortName(back.title))} op de kaart</a>
      </div>` : ''}
      <div class="section-head">
        <h2>Datum <button type="button" class="text-btn" data-action="edit-poll">Periode instellen</button></h2>
        <p class="section-intro">Vink aan wanneer je kunt. De beste periodes van ${cfg.days} dagen tussen ${fmtShort(cfg.start)} en ${fmtShort(cfg.end)} komen bovenaan.</p>
      </div>

      ${whoHtml(me, people)}

      <div class="label">Beste periodes</div>
      ${best.length ? `<ol class="best-list">${best.map((w, i) => `
        <li class="best-row${i === 0 ? ' top' : ''}">
          <div class="best-main">
            <strong>${rangeText(w.start, w.end)}</strong>
            <small>${w.full.length} van ${people.length} kunnen alle ${cfg.days} dagen</small>
            <div class="chips">
              ${w.full.map((n) => `<span class="chip ok">${esc(n)}</span>`).join('')}
              ${w.partial.map((p) => `<span class="chip part">${esc(p.name)} ${p.n}/${cfg.days}</span>`).join('')}
              ${w.none.map((n) => `<span class="chip no">${esc(n)}</span>`).join('')}
            </div>
          </div>
          <button type="button" class="btn sm" data-action="plan-window" data-start="${w.start}" data-end="${w.end}">Plan reis →</button>
        </li>`).join('')}</ol>` : '<p class="hint">Nog niemand heeft dagen aangevinkt.</p>'}

      ${dated.length ? `
        <div class="label">Geplande reizen</div>
        <ul class="planned">${dated.map((t) => {
          const c = conflictsOf(t) || [];
          const known = conflictsOf(t) !== null;
          return `<li class="planned-row${c.length ? ' conflict' : ''}" data-trip="${t.id}" tabindex="0">
            <strong>${esc(t.title)}</strong>
            <span>${rangeText(t.start_date, t.end_date)}</span>
            ${c.length ? `<small>Kan niet: ${conflictText(c)}</small>` : !known ? '<span>Buiten de periode van de datumprikker</span>' : people.length ? '<small>✓ Iedereen kan</small>' : ''}
          </li>`;
        }).join('')}</ul>` : ''}

      <div class="label" id="kalender">Kalender</div>
      ${me ? `<div class="quick-fill">
          <button type="button" class="btn sm primary" data-fill="all">✓ Ik kan de hele periode</button>
          ${mine.size ? '<button type="button" class="btn sm ghost" data-fill="none">Alles wissen</button>' : ''}
        </div>` : ''}
      <p class="hint">Tik of veeg over de dagen waarop je kunt. Kun je bijna altijd? Kies <em>Ik kan de hele periode</em> en tik weg wanneer je niet kunt. Donkerder = meer mensen kunnen.</p>
      <div class="months${me ? '' : ' locked'}">${months.join('')}</div>

      ${people.length ? `
        <div class="label">Ingevuld door</div>
        <ul class="people">${people.map((n) => `
          <li><span>${esc(n)}</span><small>${byName.get(n).size} dagen</small>
            ${canRemovePerson(n) ? `<button type="button" class="text-btn" data-action="remove-person" data-name="${esc(n)}">Wissen</button>` : ''}</li>`).join('')}
        </ul>` : ''}`;
  }

  // Je vult altijd in als jezelf (je account).
  const whoOpen = false;
  function whoHtml(me) {
    return `<div class="who who-set"><span>Je vult in als <strong>${esc(me)}</strong></span></div>`;
  }

  function weekNumber(iso) {
    const d = toDate(iso);
    d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  }

  function pollName() {
    return myName();
  }

  async function setAvailable(dates, available) {
    const name = pollName();
    if (!name || !dates.length) return;
    // Direct tonen, daarna opslaan.
    const key = (d) => `${name}|${d}`;
    const have = new Set(state.availability.map((a) => `${a.name}|${a.date}`));
    if (available) dates.forEach((d) => { if (!have.has(key(d))) state.availability.push({ name, date: d }); });
    else state.availability = state.availability.filter((a) => !(a.name === name && dates.includes(a.date)));
    const y = window.scrollY;
    renderPanel();
    window.scrollTo(0, y);
    try {
      await api('/availability', 'PUT', { name, dates, available });
    } catch (err) {
      toast(err.message, true);
      await reload();
    }
  }

  // Vegen over dagen: alle dagen waar je overheen gaat krijgen dezelfde stand als de eerste.
  // touch-action: pan-y laat verticaal scrollen werken; horizontaal vegen vinkt dagen aan.
  let paint = null;
  document.addEventListener('pointerdown', (e) => {
    const day = e.target.closest && e.target.closest('.months [data-day]');
    if (!day || day.disabled || e.button > 0 || !myName().trim() || whoOpen) return;
    paint = { on: day.getAttribute('aria-pressed') !== 'true', days: new Set([day.dataset.day]), moved: false, id: e.pointerId };
    if (day.hasPointerCapture && day.hasPointerCapture(e.pointerId)) day.releasePointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', (e) => {
    if (!paint || e.pointerId !== paint.id) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const day = el && el.closest && el.closest('.months [data-day]');
    if (!day || day.disabled || paint.days.has(day.dataset.day)) return;
    paint.days.add(day.dataset.day);
    paint.moved = true;
    for (const d of paint.days) {
      const b = $(`[data-day="${d}"]`);
      if (b) b.classList.toggle('painting', true), b.classList.toggle('paint-off', !paint.on);
    }
  });
  const endPaint = (e) => {
    if (!paint || (e && e.pointerId !== paint.id)) return;
    const p = paint;
    paint = null;
    if (!p.moved) return; // gewone tik: dat doet de klik
    suppressDayClick = true;
    setTimeout(() => { suppressDayClick = false; }, 400);
    setAvailable([...p.days], p.on);
  };
  document.addEventListener('pointerup', endPaint);
  document.addEventListener('pointercancel', () => {
    // Bijv. de browser begint te scrollen: wat al geveegd is toch opslaan.
    if (paint && paint.moved) endPaint({ pointerId: paint.id }); else paint = null;
  });
  let suppressDayClick = false;

  document.addEventListener('click', (e) => {
    const fill = e.target.closest('[data-fill]');
    if (fill) {
      const cfg = pollSettings();
      const all = rangeDays(cfg.start, cfg.end);
      if (fill.dataset.fill === 'none' && !confirm('Al je aangevinkte dagen wissen?')) return;
      setAvailable(all, fill.dataset.fill === 'all');
      toast(fill.dataset.fill === 'all' ? 'Hele periode aangevinkt ✓ Tik nu de dagen weg waarop je niet kunt.' : 'Gewist');
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day && !day.disabled) {
      if (!suppressDayClick) setAvailable([day.dataset.day], day.getAttribute('aria-pressed') !== 'true');
      return;
    }
    const wk = e.target.closest('[data-week]');
    if (wk && !wk.disabled) {
      const dates = wk.dataset.week.split(',').filter(Boolean);
      const mine = availabilityMap().get(myName().trim()) || new Set();
      setAvailable(dates, !dates.every((d) => mine.has(d)));
    }
  });
