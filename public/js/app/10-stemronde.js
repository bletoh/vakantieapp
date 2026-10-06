  /* ---------- stemronde: samen kiezen, te delen via WhatsApp ---------- */

  const findPoll = (slug) => state.polls.find((p) => p.slug === slug) || null;
  const pollUrl = (p) => `${location.origin}/stem/${p.slug}`;
  const openPolls = () => state.polls.filter((p) => !p.is_closed);

  function pollFromHash() {
    const m = /^#stem-([\w]+)$/.exec(location.hash);
    return m ? findPoll(m[1]) : null;
  }

  // Een gedeelde link /stem/abc opent de app op de stempagina.
  (() => {
    const m = /^\/stem\/([\w]+)\/?$/.exec(location.pathname);
    if (m) history.replaceState(null, '', `/#stem-${m[1]}`);
  })();

  function tallyOf(poll) {
    const rows = poll.item_ids.map(findItem).filter(Boolean).map((it) => ({
      it,
      voters: poll.votes.filter((v) => v.item_id === it.id).map((v) => v.name),
    }));
    return rows.sort((a, b) => b.voters.length - a.voters.length || pinNumber(a.it.id) - pinNumber(b.it.id));
  }

  function daysLeft(poll) {
    if (!poll.closes_at) return null;
    return dayCount(todayIso(), poll.closes_at) - 1;
  }

  function deadlineText(poll) {
    if (poll.is_closed) return 'Gesloten';
    if (!poll.closes_at) return 'Loopt tot iemand hem sluit';
    const d = daysLeft(poll);
    const left = d <= 0 ? 'laatste dag' : d === 1 ? 'nog 1 dag' : `nog ${d} dagen`;
    return `Stemmen kan t/m ${fmtShort(poll.closes_at)} · ${left}`;
  }

  // Iedereen die we kennen uit de app: datumprikker, voorstellen en eerdere stemrondes.
  function knownPeople() {
    const names = new Set();
    for (const a of state.availability) names.add(a.name);
    for (const s of state.sections) for (const it of s.items) if (it.added_by) names.add(it.added_by);
    for (const t of state.trips) if (t.added_by) names.add(t.added_by);
    for (const p of state.polls) {
      for (const v of p.votes) names.add(v.name);
      for (const n of p.participants) names.add(n);
    }
    const me = myName().trim();
    if (me) names.add(me);
    return [...names].map((n) => n.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'nl'));
  }

  function notVoted(poll) {
    const voted = new Set(poll.votes.map((v) => v.name.toLowerCase()));
    const who = poll.participants.length ? poll.participants : state.members.map((m) => m.name);
    return who.filter((n) => !voted.has(n.toLowerCase()));
  }

  const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
  const listOr = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} of ${names[names.length - 1]}` : names.join(''));

  function inviteText(poll) {
    const names = tallyOf(poll).map((r) => shortName(r.it.title));
    return `🗳️ *${poll.title}*\nStem mee: ${listOr(names)}?\n${poll.closes_at ? `Stemmen kan t/m ${fmtShort(poll.closes_at)}.\n` : ''}👉 ${pollUrl(poll)}`;
  }

  function reminderText(poll) {
    const missing = notVoted(poll);
    const d = daysLeft(poll);
    const when = d == null ? '' : d <= 0 ? ' Vandaag is de laatste dag!' : ` Nog ${d === 1 ? '1 dag' : `${d} dagen`} (t/m ${fmtShort(poll.closes_at)}).`;
    return `⏰ Herinnering: stem mee over *${poll.title}*!${when}\n${missing.length ? `Nog niet gestemd: ${missing.join(', ')}\n` : ''}👉 ${pollUrl(poll)}`;
  }

  function resultText(poll) {
    const rows = tallyOf(poll);
    const total = poll.votes.length;
    const head = poll.is_closed && rows[0] && rows[0].voters.length
      ? `🏆 Uitslag *${poll.title}*: ${shortName(rows[0].it.title)} wint!`
      : `📊 Tussenstand *${poll.title}* (${total} ${total === 1 ? 'stem' : 'stemmen'})`;
    const lines = rows.map((r, i) => `${i + 1}. ${shortName(r.it.title)}: ${r.voters.length} ${r.voters.length === 1 ? 'stem' : 'stemmen'}`);
    return `${head}\n${lines.join('\n')}\n👉 ${pollUrl(poll)}`;
  }

  function shareButtonsHtml(poll, kind) {
    const text = kind === 'reminder' ? reminderText(poll) : kind === 'result' ? resultText(poll) : inviteText(poll);
    const label = { invite: 'Deel via WhatsApp', reminder: 'Stuur herinnering via WhatsApp', result: poll.is_closed ? 'Deel de uitslag via WhatsApp' : 'Deel de tussenstand via WhatsApp' }[kind];
    return `<a class="btn wa" href="${esc(waLink(text))}" target="_blank" rel="noopener">${WA_ICON}<span>${label}</span></a>`;
  }

  const WA_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3Z"/></svg>';

  /* --- pagina's --- */

  function stemHtml() {
    const poll = pollFromHash();
    if (poll) return pollPageHtml(poll);
    const polls = state.polls;
    const canMake = locations().length >= 2;
    return `
      <div class="section-head">
        <h2>Stemmen</h2>
        <p class="section-intro">Laat de groep kiezen tussen bestemmingen. Deel de stemronde in de WhatsApp-groep; de link toont meteen een voorbeeld met de keuzes.</p>
      </div>
      ${canMake ? `<button type="button" class="add-cta" data-action="new-poll"><span class="add-cta-plus">${ic('vote')}</span><span>Nieuwe stemronde</span></button>`
        : `<p class="hint">Zet eerst minstens twee bestemmingen op de <a href="#kaart">kaart</a>, dan kun je de groep laten kiezen.</p>`}
      ${polls.length ? `<ul class="poll-list">${polls.map((p) => {
        const rows = tallyOf(p);
        const lead = rows[0] && rows[0].voters.length ? rows[0] : null;
        return `<li><a class="poll-row${p.is_closed ? ' closed' : ''}" href="#stem-${esc(p.slug)}">
          <span class="poll-row-main">
            <strong>${esc(p.title)}</strong>
            <small>${esc(deadlineText(p))} · ${p.votes.length} ${p.votes.length === 1 ? 'stem' : 'stemmen'}</small>
          </span>
          ${lead ? `<span class="poll-lead">${p.is_closed ? '🏆' : '↑'} ${esc(shortName(lead.it.title))}</span>` : ''}
          <span class="dest-go" aria-hidden="true">›</span>
        </a></li>`;
      }).join('')}</ul>` : ''}
      ${canMake ? rouletteHtml() : ''}`;
  }

  /* --- roulette: het lot laten kiezen tussen twee bestemmingen --- */

  const rou = { a: null, b: null, angle: 0, spinning: false };

  // Gelijkspel in een stemronde? Dan die twee alvast klaarzetten.
  function rouletteTie() {
    for (const p of state.polls) {
      const rows = tallyOf(p);
      if (rows.length >= 2 && rows[0].voters.length && rows[0].voters.length === rows[1].voters.length) return { poll: p, a: rows[0].it, b: rows[1].it };
    }
    return null;
  }

  function wheelSvg(names) {
    const n = names.length;
    const r = 100;
    const seg = 360 / n;
    const pt = (deg, rad) => { const a = (deg - 90) * Math.PI / 180; return [(110 + rad * Math.cos(a)).toFixed(2), (110 + rad * Math.sin(a)).toFixed(2)]; };
    const slices = names.map((name, i) => {
      const [x1, y1] = pt(i * seg, r);
      const [x2, y2] = pt((i + 1) * seg, r);
      const [tx, ty] = pt(i * seg + seg / 2, r * 0.55);
      const label = name.length > 14 ? `${name.slice(0, 13)}…` : name;
      return `<path class="wheel-seg s${i % 2}" d="M110 110 L${x1} ${y1} A${r} ${r} 0 ${seg > 180 ? 1 : 0} 1 ${x2} ${y2} Z"/>
        <text class="wheel-label s${i % 2}" x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${i * seg + seg / 2 - 90} ${tx} ${ty})">${esc(label)}</text>`;
    }).join('');
    return `<svg class="wheel" viewBox="0 0 220 220" aria-hidden="true">
      <g class="wheel-rot" style="transform: rotate(${rou.angle}deg)">${slices}<circle class="wheel-hub" cx="110" cy="110" r="14"/></g>
    </svg>`;
  }

  function rouletteHtml() {
    const locs = locations();
    const tie = rouletteTie();
    if (!rou.a || !findItem(rou.a)) rou.a = tie ? tie.a.id : locs[0].id;
    if (!rou.b || !findItem(rou.b) || rou.b === rou.a) rou.b = tie ? tie.b.id : (locs.find((l) => l.id !== rou.a) || locs[1]).id;
    const opts = (sel) => locs.map((l) => `<option value="${l.id}"${l.id === sel ? ' selected' : ''}>${esc(l.title)}</option>`).join('');
    const names = [rou.a, rou.b].map((id) => shortName(findItem(id).title));
    return `
      <section class="roulette" aria-labelledby="rouTitle">
        <div class="roulette-head">
          <span class="roulette-ic" aria-hidden="true">🎰</span>
          <div><h3 id="rouTitle">Roulette</h3>
          <p>${tie ? `Gelijkspel in <strong>${esc(tie.poll.title)}</strong>? Laat het lot beslissen.` : 'Komen jullie er niet uit? Laat het lot beslissen tussen twee plekken.'}</p></div>
        </div>
        <div class="roulette-pick">
          <label><span class="sr-only">Eerste plek</span><select id="rouA">${opts(rou.a)}</select></label>
          <span class="roulette-of">of</span>
          <label><span class="sr-only">Tweede plek</span><select id="rouB">${opts(rou.b)}</select></label>
        </div>
        <div class="wheel-wrap"><span class="wheel-pointer" aria-hidden="true"></span><div id="rouWheel">${wheelSvg(names)}</div></div>
        <button type="button" class="btn primary block" data-roulette-spin>Draai!</button>
        <p class="roulette-result" id="rouResult" role="status"></p>
        <p class="fineprint">De server kiest de winnaar en zet de uitslag in de groepschat, zodat iedereen hem ziet.</p>
      </section>`;
  }

  function redrawWheel() {
    const el = $('#rouWheel');
    if (el) el.innerHTML = wheelSvg([rou.a, rou.b].map((id) => shortName(findItem(id).title)));
    const r = $('#rouResult');
    if (r) r.innerHTML = '';
  }

  document.addEventListener('change', (e) => {
    if (e.target.id !== 'rouA' && e.target.id !== 'rouB') return;
    rou[e.target.id === 'rouA' ? 'a' : 'b'] = +e.target.value;
    redrawWheel();
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-roulette-spin]');
    if (!btn || rou.spinning) return;
    if (rou.a === rou.b) { toast('Kies twee verschillende plekken', true); return; }
    rou.spinning = true;
    btn.disabled = true;
    $('#rouResult').innerHTML = '';
    let r;
    try { r = await api('/roulette', 'POST', { item_ids: [rou.a, rou.b] }); } catch (err) {
      toast(err.message, true); rou.spinning = false; btn.disabled = false; return;
    }
    // Draaien zodat het midden (± wat speling) van het winnende vak onder de pijl stopt.
    const seg = 180;
    const center = r.index * seg + seg / 2;
    const jitter = (Math.random() - 0.5) * seg * 0.7;
    const base = Math.ceil(rou.angle / 360) * 360;
    rou.angle = base + 360 * 5 + (360 - center) + jitter;
    const g = $('#rouWheel .wheel-rot');
    const ms = reducedMotion() ? 0 : 4200;
    if (g) {
      g.style.transition = ms ? `transform ${ms}ms cubic-bezier(.12,.67,.12,1)` : 'none';
      requestAnimationFrame(() => { g.style.transform = `rotate(${rou.angle}deg)`; });
    }
    await new Promise((res) => setTimeout(res, ms + 150));
    rou.spinning = false;
    btn.disabled = false;
    btn.textContent = 'Nog een keer draaien';
    const win = findItem(r.winner_id);
    if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
    const res = $('#rouResult');
    if (res && win) res.innerHTML = `<span class="roulette-win">🎉 <strong>${esc(shortName(win.title))}</strong> wint!</span> <a class="btn sm" href="#pin-${win.id}">Verder plannen →</a>`;
  });

  function optionMetaHtml(loc) {
    const p = planOf(loc);
    const bits = [];
    if (p.trip && p.trip.start_date) bits.push(`${ic('calendar')} ${shortRange(p.trip.start_date, p.trip.end_date)}`);
    const flight = p.per.flight.find(({ it }) => it.price);
    const stay = p.per.stay.find(({ it }) => it.price);
    if (flight) bits.push(`${ic('plane')} ${esc(flight.it.price)}`);
    if (stay) bits.push(`${ic('bed')} ${esc(stay.it.price)}`);
    return bits.length ? `<span class="option-meta">${bits.join(' · ')}</span>` : '';
  }

  function pollPageHtml(poll) {
    const me = myName().trim();
    const mine = poll.votes.find((v) => v.name.toLowerCase() === me.toLowerCase());
    const rows = tallyOf(poll);
    const total = poll.votes.length;
    const max = Math.max(1, ...rows.map((r) => r.voters.length));
    const missing = notVoted(poll);
    const winner = poll.is_closed && rows[0] && rows[0].voters.length ? rows[0] : null;
    return `
      <a class="back-link" href="#stem">← Alle stemrondes</a>
      <div class="section-head">
        <span class="plan-kicker">${poll.is_closed ? 'Uitslag stemronde' : 'Stemronde'}</span>
        <h2>${esc(poll.title)}</h2>
        <p class="section-intro">${esc(deadlineText(poll))} · ${total} ${total === 1 ? 'stem' : 'stemmen'}${poll.created_by ? ` · gestart door ${esc(poll.created_by)}` : ''}</p>
      </div>

      ${winner ? `<div class="winner">
        <span class="winner-cup" aria-hidden="true">🏆</span>
        <span><small>Gekozen</small><strong>${esc(winner.it.title)}</strong></span>
        <a class="btn sm" href="#pin-${winner.it.id}">Verder plannen op de kaart →</a>
      </div>` : ''}

      ${!poll.is_closed ? `
        <p class="hint">${mine ? `Je stemde op <strong>${esc(shortName(findItem(mine.item_id)?.title))}</strong>. Tik op een andere bestemming om je stem te wijzigen.` : 'Tik op de bestemming waar jij heen wilt.'}</p>` : ''}

      <div class="options" role="radiogroup" aria-label="Bestemmingen">
        ${rows.map((r, i) => {
          const on = mine && mine.item_id === r.it.id;
          const img = safeUrl(r.it.image);
          const lead = total && i === 0 && r.voters.length;
          return `<div class="option${on ? ' on' : ''}${poll.is_closed ? ' closed' : ''}${lead ? ' lead' : ''}">
            <button type="button" class="option-main" role="radio" aria-checked="${!!on}" data-vote="${r.it.id}"${poll.is_closed ? ' disabled' : ''}>
              <span class="option-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}<span class="dest-num">${pinNumber(r.it.id)}</span></span>
              <span class="option-text">
                <strong>${esc(r.it.title)}</strong>
                ${optionMetaHtml(r.it)}
                <span class="bar" aria-hidden="true"><span style="width:${Math.round(r.voters.length / max * 100)}%"></span></span>
                <small>${r.voters.length} ${r.voters.length === 1 ? 'stem' : 'stemmen'}${r.voters.length ? `: ${r.voters.map(esc).join(', ')}` : ''}</small>
              </span>
              ${!poll.is_closed ? `<span class="option-check" aria-hidden="true">${on ? '✓' : ''}</span>` : ''}
            </button>
            <a class="option-map" href="#pin-${r.it.id}">Bekijk op de kaart</a>
          </div>`;
        }).join('')}
      </div>

      <div class="label">Delen</div>
      <div class="share-grid">
        ${!poll.is_closed ? `
          <div class="share-card">
            <strong>Uitnodigen</strong>
            <p>Stuur de stemronde naar de groep. WhatsApp laat een voorbeeld met de keuzes zien.</p>
            ${shareButtonsHtml(poll, 'invite')}
            <button type="button" class="btn sm ghost" data-copy="${esc(pollUrl(poll))}">Link kopiëren</button>
          </div>
          <div class="share-card">
            <strong>Herinneren</strong>
            ${poll.participants.length
              ? (missing.length ? `<p>Nog niet gestemd: <span class="missing">${missing.map((n) => `<span class="chip part">${esc(n)}</span>`).join(' ')}</span></p>` : '<p>✓ Iedereen heeft gestemd.</p>')
              : '<p>Voeg deelnemers toe (via Aanpassen) om te zien wie nog niet stemde.</p>'}
            ${missing.length || !poll.participants.length ? shareButtonsHtml(poll, 'reminder') : ''}
          </div>` : ''}
        <div class="share-card">
          <strong>${poll.is_closed ? 'Uitslag' : 'Tussenstand'}</strong>
          <p>${total ? rows.slice(0, 3).map((r, i) => `${i + 1}. ${esc(shortName(r.it.title))} (${r.voters.length})`).join(' · ') : 'Nog geen stemmen.'}</p>
          ${total ? shareButtonsHtml(poll, 'result') : ''}
        </div>
      </div>

      <div class="poll-admin">
        <button type="button" class="btn sm" data-action="edit-poll-round" data-slug="${esc(poll.slug)}">Aanpassen</button>
        <button type="button" class="btn sm" data-action="toggle-poll" data-slug="${esc(poll.slug)}">${poll.is_closed ? 'Weer openen' : 'Stemronde sluiten'}</button>
        <button type="button" class="btn sm ghost danger" data-action="delete-poll" data-slug="${esc(poll.slug)}">Verwijderen</button>
      </div>`;
  }

  // Op de kaart: een open stemronde waarop jij nog niet stemde valt meteen op.
  function pollBannerHtml() {
    const me = myName().trim().toLowerCase();
    const p = openPolls().find((x) => !me || !x.votes.some((v) => v.name.toLowerCase() === me));
    if (!p) return '';
    return `<a class="vote-strip" href="#stem-${esc(p.slug)}">
      <span class="when-icon">${ic('vote')}</span>
      <span><strong>Stem mee: ${esc(p.title)}</strong><small>${esc(deadlineText(p))} · ${p.votes.length} ${p.votes.length === 1 ? 'stem' : 'stemmen'}</small></span>
      <span class="when-go" aria-hidden="true">→</span></a>`;
  }

  /* --- stemmen --- */

  document.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Link gekopieerd ✓'); } catch { toast(copy.dataset.copy); }
      return;
    }
    const btn = e.target.closest('[data-vote]');
    if (!btn || btn.disabled) return;
    const poll = btn.dataset.poll ? findPoll(btn.dataset.poll) : pollFromHash();
    const name = myName();
    if (!poll || !name) return;
    const itemId = +btn.dataset.vote;
    const mine = poll.votes.find((v) => v.name.toLowerCase() === name.toLowerCase());
    const undo = mine && mine.item_id === itemId;
    btn.disabled = true;
    try {
      await api(`/polls/${poll.id}/vote`, 'PUT', { item_id: undo ? null : itemId });
      await reload();
      toast(undo ? 'Stem ingetrokken' : `Gestemd op ${shortName(findItem(itemId).title)} ✓`);
    } catch (err) { btn.disabled = false; toast(err.message, true); }
  });

  Object.assign(actions, {
    'new-poll': () => openPollRoundDialog(null),
    'edit-poll-round': (btn) => openPollRoundDialog(findPoll(btn.dataset.slug)),
    async 'toggle-poll'(btn) {
      const poll = findPoll(btn.dataset.slug);
      const closing = !poll.is_closed;
      if (closing && !confirm('Stemronde sluiten? Daarna kan niemand meer stemmen.')) return;
      // Weer openen van een ronde waarvan de sluitdatum voorbij is: sluitdatum vervalt.
      const body = closing ? { closed: true } : { closed: false, ...(poll.closes_at && poll.closes_at < todayIso() ? { closes_at: '' } : {}) };
      await api(`/polls/${poll.id}`, 'PUT', body);
      await reload();
      const fresh = findPoll(poll.slug);
      const rows = tallyOf(fresh);
      // De winnaar wordt de beste keuze op de kaart (rode pin).
      if (closing && rows[0] && rows[0].voters.length && (!rows[1] || rows[1].voters.length < rows[0].voters.length) && !rows[0].it.is_best) {
        await api(`/items/${rows[0].it.id}/best`, 'PUT');
        await reload();
        toast(`${shortName(rows[0].it.title)} wint en is nu de beste keuze ✓`);
      } else toast(closing ? 'Stemronde gesloten' : 'Stemronde weer open');
    },
    async 'delete-poll'(btn) {
      const poll = findPoll(btn.dataset.slug);
      if (!confirm(`Stemronde "${poll.title}" met ${poll.votes.length} stemmen verwijderen?`)) return;
      await api(`/polls/${poll.id}`, 'DELETE');
      location.hash = '#stem';
      await reload();
      toast('Verwijderd');
    },
  });

  /* --- aanmaken en aanpassen --- */

  const pollRoundDialog = $('#pollRoundDialog');
  const pollRoundForm = $('#pollRoundForm');
  let pollRoundCtx = null;

  function openPollRoundDialog(poll) {
    pollRoundCtx = poll;
    const f = pollRoundForm.elements;
    $('#pollRoundTitle').textContent = poll ? 'Stemronde aanpassen' : 'Nieuwe stemronde';
    f.title.value = poll ? poll.title : 'Waar gaan we heen?';
    f.closes_at.value = poll ? poll.closes_at || '' : addDays(todayIso(), 7);
    f.participants.value = (poll ? poll.participants : knownPeople()).join('\n');
    const chosen = poll ? poll.item_ids : locations().map((l) => l.id);
    $('#pollRoundOptions').innerHTML = locations().map((l) => `
      <label class="pick"><input type="checkbox" name="item" value="${l.id}"${chosen.includes(l.id) ? ' checked' : ''}>
        <span>${pinNumber(l.id)}. ${esc(l.title)}</span></label>`).join('');
    pollRoundDialog.showModal();
  }

  pollRoundForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = pollRoundForm.elements;
    const data = {
      title: f.title.value.trim(),
      closes_at: f.closes_at.value,
      participants: f.participants.value,
      item_ids: $$('input[name="item"]:checked', pollRoundForm).map((el) => +el.value),
      created_by: myName(),
    };
    if (data.item_ids.length < 2) { toast('Kies minstens twee bestemmingen', true); return; }
    try {
      let slug = pollRoundCtx && pollRoundCtx.slug;
      if (pollRoundCtx) await api(`/polls/${pollRoundCtx.id}`, 'PUT', data);
      else slug = (await api('/polls', 'POST', data)).slug;
      pollRoundDialog.close();
      await reload();
      location.hash = `#stem-${slug}`;
      toast(pollRoundCtx ? 'Opgeslagen ✓' : 'Stemronde klaar. Deel hem in de groep! ✓');
    } catch (err) { toast(err.message, true); }
  });

  // Periode van de datumprikker
  const pollDialog = $('#pollDialog');
  const pollForm = $('#pollForm');

  function openPollDialog() {
    const cfg = pollSettings();
    pollForm.elements.poll_start.value = cfg.start;
    pollForm.elements.poll_end.value = cfg.end;
    pollForm.elements.trip_days.value = cfg.days;
    pollDialog.showModal();
  }

  pollForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = pollForm.elements;
    let [start, end] = [f.poll_start.value, f.poll_end.value];
    if (start && end && end < start) [start, end] = [end, start];
    try {
      await api('/settings', 'PUT', { poll_start: start, poll_end: end, trip_days: f.trip_days.value });
      pollDialog.close();
      await reload();
      toast('Opgeslagen ✓');
    } catch (err) { toast(err.message, true); }
  });

  // Reis
  const tripDialog = $('#tripDialog');
  const tripForm = $('#tripForm');
  let tripCtx = null;

  function openTripDialog(trip, preset = {}) {
    tripCtx = trip;
    tripForm.elements.start_date.value = trip ? trip.start_date || '' : preset.start_date || '';
    tripForm.elements.end_date.value = trip ? trip.end_date || '' : preset.end_date || '';
    updateTripWarning();
    $('#tripDialogTitle').textContent = trip ? 'Reis aanpassen' : 'Stel een reis voor';
    tripForm.elements.title.value = trip ? trip.title : '';
    tripForm.elements.note.value = trip ? trip.note || '' : '';
    tripForm.elements.added_by.value = trip ? trip.added_by || '' : myName();
    const chosen = trip ? trip.item_ids : [];
    const sections = state.sections.filter((s) => s.items.length);
    // Per tab een lijstje om aan te vinken; een reis kan meerdere activiteiten of restaurants hebben.
    $('#tripPicks').innerHTML = sections.length ? sections.map((s) => {
      const items = sortedItems(s).sort((a, b) => chosen.includes(b.id) - chosen.includes(a.id));
      return `<fieldset class="pick-group">
        <legend>${kindIcon(s.kind, s.icon)} ${esc(s.kind === 'map' ? 'Bestemming' : s.title)}</legend>
        ${items.map((it) => {
          const loc = it.location_id && findItem(it.location_id);
          return `<label class="pick"><input type="checkbox" data-pick value="${it.id}"${chosen.includes(it.id) ? ' checked' : ''}>
            <span>${esc(it.title)}${s.show_price && it.price ? ` <span class="price">${esc(it.price)}</span>` : ''}${loc ? `<small>bij ${esc(shortName(loc.title))}</small>` : ''}</span></label>`;
        }).join('')}
      </fieldset>`;
    }).join('')
      : '<p class="hint">Voeg eerst een bestemming toe op de kaart, dan kun je die hier kiezen.</p>';
    $('#tripDelete').hidden = !trip;
    tripDialog.showModal();
    if (!trip) focusSoon(tripForm.elements.title);
  }

  // Live waarschuwing in het reisvenster als iemand niet kan op de gekozen datums.
  function updateTripWarning() {
    const start = tripForm.elements.start_date.value;
    const end = tripForm.elements.end_date.value || start;
    const el = $('#tripDateWarn');
    const c = start ? conflictsOf({ start_date: start <= end ? start : end, end_date: start <= end ? end : start }) : null;
    el.hidden = !c || (!c.length && !availabilityMap().size);
    if (!c) return;
    el.className = c.length ? 'date-warn conflict' : 'date-warn ok';
    el.innerHTML = c.length ? `<strong>Kan niet:</strong> ${conflictText(c)}` : '✓ Iedereen kan op deze datums';
  }
  tripForm.elements.start_date.addEventListener('change', () => {
    const f = tripForm.elements;
    if (f.start_date.value && (!f.end_date.value || f.end_date.value < f.start_date.value)) {
      f.end_date.value = addDays(f.start_date.value, pollSettings().days - 1);
    }
    updateTripWarning();
  });
  tripForm.elements.end_date.addEventListener('change', updateTripWarning);

  tripForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      title: tripForm.elements.title.value.trim(),
      note: tripForm.elements.note.value.trim(),
      item_ids: $$('[data-pick]:checked', tripForm).map((el) => +el.value).filter(Boolean),
      start_date: tripForm.elements.start_date.value,
      end_date: tripForm.elements.end_date.value,
    };
    try {
      if (tripCtx) await api(`/trips/${tripCtx.id}`, 'PUT', data);
      else await api('/trips', 'POST', data);
      const isNew = !tripCtx;
      tripDialog.close();
      await reload();
      toast(isNew ? 'Reis voorgesteld, bedankt! ✓' : 'Opgeslagen ✓');
    } catch (err) { toast(err.message, true); }
  });

  $('#tripDelete').addEventListener('click', async () => {
    if (!tripCtx || !confirm(`Reis "${tripCtx.title}" verwijderen?`)) return;
    try {
      await api(`/trips/${tripCtx.id}`, 'DELETE');
      tripDialog.close();
      await reload();
      toast('Verwijderd');
    } catch (err) { toast(err.message, true); }
  });

  // Tab
  const sectionDialog = $('#sectionDialog');
  const sectionForm = $('#sectionForm');
  let sectionCtx = null;

  function openSectionDialog(section) {
    sectionCtx = section;
    $('#sectionDialogTitle').textContent = section ? 'Tab aanpassen' : 'Nieuwe tab';
    sectionForm.elements.icon.value = section ? section.icon || '' : '';
    sectionForm.elements.title.value = section ? section.title : '';
    sectionForm.elements.intro.value = section ? section.intro || '' : '';
    sectionForm.elements.show_price.checked = !!(section && section.show_price);
    sectionForm.elements.kind.value = section ? section.kind || '' : '';
    $('#sectionExtra').hidden = !section;
    if (section) {
      const idx = state.sections.indexOf(section);
      $('#sectionLeft').disabled = idx === 0;
      $('#sectionRight').disabled = idx === state.sections.length - 1;
    }
    sectionDialog.showModal();
    if (!section) focusSoon(sectionForm.elements.title);
  }

  sectionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      icon: sectionForm.elements.icon.value.trim() || '⭐',
      title: sectionForm.elements.title.value.trim(),
      intro: sectionForm.elements.intro.value.trim(),
      show_price: sectionForm.elements.show_price.checked,
      kind: sectionForm.elements.kind.value,
    };
    try {
      let id = sectionCtx && sectionCtx.id;
      if (id) await api(`/sections/${id}`, 'PUT', data);
      else id = (await api('/sections', 'POST', data)).id;
      sectionDialog.close();
      await reload();
      location.hash = '#tab-' + id;
      toast('Opgeslagen ✓');
    } catch (err) { toast(err.message, true); }
  });

  async function moveSection(dir) {
    const ids = state.sections.map((s) => s.id);
    const i = ids.indexOf(sectionCtx.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api('/sections/reorder', 'PUT', { ids });
      await reload();
      sectionCtx = findSection(sectionCtx.id);
      $('#sectionLeft').disabled = j === 0;
      $('#sectionRight').disabled = j === ids.length - 1;
    } catch (err) { toast(err.message, true); }
  }
  $('#sectionLeft').addEventListener('click', () => moveSection(-1));
  $('#sectionRight').addEventListener('click', () => moveSection(1));

  $('#sectionDelete').addEventListener('click', async () => {
    const s = sectionCtx;
    const n = s.items.length;
    if (!confirm(`Tab "${s.title}"${n ? ` en alles wat erin staat (${n})` : ''} verwijderen?`)) return;
    try {
      await api(`/sections/${s.id}`, 'DELETE');
      sectionDialog.close();
      history.replaceState(null, '', location.pathname);
      await reload();
      toast('Tab verwijderd');
    } catch (err) { toast(err.message, true); }
  });

  // Titel
  const siteDialog = $('#siteDialog');
  const siteForm = $('#siteForm');

  function openSiteDialog() {
    siteForm.elements.site_title.value = state.settings.site_title || '';
    siteDialog.showModal();
    focusSoon(siteForm.elements.site_title);
  }

  siteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/settings', 'PUT', { site_title: siteForm.elements.site_title.value.trim() });
      siteDialog.close();
      await reload();
      toast('Opgeslagen ✓');
    } catch (err) { toast(err.message, true); }
  });

  // Afbeelding kiezen
  const imageDialog = $('#imageDialog');
  let onImagePicked = null;

  function openImageDialog(callback) {
    onImagePicked = callback;
    $('#imageUrl').value = '';
    $('#imageFile').value = '';
    imageDialog.showModal();
  }

  function pickImage(url) {
    onImagePicked(url);
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
      pickImage(url);
    } catch (err) { toast(err.message, true); }
  });

  $('#imageUrlSave').addEventListener('click', () => {
    const url = safeUrl($('#imageUrl').value.trim());
    if (!url) { toast('Ongeldige link', true); return; }
    pickImage(url);
  });

  $('#imageRemove').addEventListener('click', () => pickImage(''));
