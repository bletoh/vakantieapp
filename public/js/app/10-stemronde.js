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

  const rou = { a: null, b: null, wheel: 0, ball: 200, spinning: false };
  const POCKETS = 12; // afwisselend rood (eerste plek) en zwart (tweede plek)
  const SEG = 360 / POCKETS;
  const C = 120;

  // Gelijkspel in een stemronde? Dan die twee alvast klaarzetten.
  function rouletteTie() {
    for (const p of state.polls) {
      const rows = tallyOf(p);
      if (rows.length >= 2 && rows[0].voters.length && rows[0].voters.length === rows[1].voters.length) return { poll: p, a: rows[0].it, b: rows[1].it };
    }
    return null;
  }

  // Hoek (graden, met de klok mee vanaf boven) en straal naar een punt op het rad.
  const polar = (deg, r) => { const a = deg * Math.PI / 180; return [C + r * Math.sin(a), C - r * Math.cos(a)]; };
  const f2 = (n) => n.toFixed(2);

  function pocketPath(i, r1, r2) {
    const [ax, ay] = polar(i * SEG, r2);
    const [bx, by] = polar((i + 1) * SEG, r2);
    const [cx, cy] = polar((i + 1) * SEG, r1);
    const [dx, dy] = polar(i * SEG, r1);
    return `M${f2(ax)} ${f2(ay)} A${r2} ${r2} 0 0 1 ${f2(bx)} ${f2(by)} L${f2(cx)} ${f2(cy)} A${r1} ${r1} 0 0 0 ${f2(dx)} ${f2(dy)} Z`;
  }

  function wheelSvg() {
    const bulbs = Array.from({ length: 24 }, (_, i) => { const [x, y] = polar(i * 15, 113); return `<circle class="bulb b${i % 2}" cx="${f2(x)}" cy="${f2(y)}" r="2.6"/>`; }).join('');
    const pockets = Array.from({ length: POCKETS }, (_, i) => {
      const [tx, ty] = polar(i * SEG + SEG / 2, 84);
      return `<path class="pocket ${i % 2 ? 'black' : 'red'}" d="${pocketPath(i, 74, 94)}"/>
        <text class="pocket-num" x="${f2(tx)}" y="${f2(ty)}" transform="rotate(${i * SEG + SEG / 2} ${f2(tx)} ${f2(ty)})">${i + 1}</text>`;
    }).join('');
    const frets = Array.from({ length: POCKETS }, (_, i) => { const [x1, y1] = polar(i * SEG, 70); const [x2, y2] = polar(i * SEG, 94); return `<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}"/>`; }).join('');
    const spokes = [0, 90, 180, 270].map((d) => { const [x, y] = polar(d, 30); return `<line x1="${C}" y1="${C}" x2="${f2(x)}" y2="${f2(y)}"/><circle cx="${f2(x)}" cy="${f2(y)}" r="3.4"/>`; }).join('');
    const [bx, by] = polar(rou.ball, rou.ballR || 101);
    return `<svg class="wheel" viewBox="0 0 240 240" aria-hidden="true">
      <defs>
        <radialGradient id="rouWood" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#6b3a1f"/><stop offset="1" stop-color="#2a140a"/></radialGradient>
        <linearGradient id="rouGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e08a"/><stop offset=".5" stop-color="#d4af37"/><stop offset="1" stop-color="#8a6d1d"/></linearGradient>
        <radialGradient id="rouCone" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#4a2a17"/><stop offset="1" stop-color="#1c0e06"/></radialGradient>
        <radialGradient id="rouBall" cx="35%" cy="35%" r="65%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#b9b9b9"/></radialGradient>
      </defs>
      <circle cx="${C}" cy="${C}" r="119" fill="url(#rouWood)"/>
      <circle cx="${C}" cy="${C}" r="113" fill="none" stroke="url(#rouGold)" stroke-width="7"/>
      ${bulbs}
      <circle cx="${C}" cy="${C}" r="108" fill="#1a0d06"/>
      <circle cx="${C}" cy="${C}" r="97" fill="none" stroke="url(#rouGold)" stroke-width="2"/>
      <g class="wheel-rot" style="transform: rotate(${rou.wheel}deg)">
        ${pockets}
        <g class="frets" stroke="url(#rouGold)" stroke-width="1.6">${frets}</g>
        <circle cx="${C}" cy="${C}" r="70" fill="url(#rouCone)" stroke="url(#rouGold)" stroke-width="2"/>
        <circle cx="${C}" cy="${C}" r="44" fill="none" stroke="#d4af37" stroke-opacity=".35"/>
        <g class="spokes" stroke="url(#rouGold)" stroke-width="4" stroke-linecap="round" fill="url(#rouGold)">${spokes}</g>
        <circle cx="${C}" cy="${C}" r="10" fill="url(#rouGold)"/>
      </g>
      <circle class="ball" cx="${f2(bx)}" cy="${f2(by)}" r="5.2" fill="url(#rouBall)"/>
    </svg>`;
  }

  function rouletteHtml() {
    const locs = locations();
    const tie = rouletteTie();
    if (!rou.a || !findItem(rou.a)) rou.a = tie ? tie.a.id : locs[0].id;
    if (!rou.b || !findItem(rou.b) || rou.b === rou.a) rou.b = tie ? tie.b.id : (locs.find((l) => l.id !== rou.a) || locs[1]).id;
    const opts = (sel) => locs.map((l) => `<option value="${l.id}"${l.id === sel ? ' selected' : ''}>${esc(l.title)}</option>`).join('');
    return `
      <section class="roulette" aria-labelledby="rouTitle">
        <div class="roulette-head">
          <h3 id="rouTitle"><span aria-hidden="true">♠ ♥</span> Casino Roulette <span aria-hidden="true">♦ ♣</span></h3>
          <p>${tie ? `Gelijkspel in <strong>${esc(tie.poll.title)}</strong>? Laat het lot beslissen.` : 'Komen jullie er niet uit? Zet in op rood of zwart.'}</p>
        </div>
        <div class="roulette-bets">
          <label class="bet red"><span class="chip-dot" aria-hidden="true"></span><span class="bet-col">Rood</span><select id="rouA" aria-label="Plek op rood">${opts(rou.a)}</select></label>
          <label class="bet black"><span class="chip-dot" aria-hidden="true"></span><span class="bet-col">Zwart</span><select id="rouB" aria-label="Plek op zwart">${opts(rou.b)}</select></label>
        </div>
        <div class="wheel-wrap" id="rouWheel">${wheelSvg()}</div>
        <button type="button" class="spin-chip" data-roulette-spin><span>SPIN</span></button>
        <div class="roulette-result" id="rouResult" role="status"></div>
        <p class="roulette-fine">De server trekt de winnaar en de uitslag komt in de groepschat, zodat iedereen hem ziet. <button type="button" class="link-btn" data-roulette-clear>Uitslagen uit de chat halen</button></p>
      </section>`;
  }

  document.addEventListener('change', (e) => {
    if (e.target.id !== 'rouA' && e.target.id !== 'rouB') return;
    rou[e.target.id === 'rouA' ? 'a' : 'b'] = +e.target.value;
    const r = $('#rouResult');
    if (r) r.innerHTML = '';
  });

  // Wiel en balletje tekenen tijdens het draaien (zonder het hele rad opnieuw op te bouwen).
  function placeWheel() {
    const g = $('#rouWheel .wheel-rot');
    if (g) g.style.transform = `rotate(${rou.wheel}deg)`;
    const ball = $('#rouWheel .ball');
    if (ball) { const [x, y] = polar(rou.ball, rou.ballR || 101); ball.setAttribute('cx', f2(x)); ball.setAttribute('cy', f2(y)); }
  }

  function confetti(box) {
    const colors = ['#d4af37', '#f7e08a', '#c8102e', '#ffffff', '#111111'];
    for (let i = 0; i < 26; i++) {
      const s = document.createElement('span');
      s.className = 'confetti';
      const a = Math.random() * Math.PI * 2;
      const d = 70 + Math.random() * 110;
      s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      s.style.setProperty('--dy', `${Math.sin(a) * d - 40}px`);
      s.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
      s.style.background = colors[i % colors.length];
      box.appendChild(s);
      setTimeout(() => s.remove(), 1300);
    }
  }

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-roulette-clear]')) {
      if (!confirm('Alle roulette-uitslagen uit de groepschat halen?')) return;
      try {
        const { removed } = await api('/messages/roulette', 'DELETE');
        const gone = new Set(removed);
        if (chat.loaded) chat.messages = chat.messages.filter((m) => !gone.has(m.id));
        toast(removed.length ? `${removed.length} ${removed.length === 1 ? 'uitslag' : 'uitslagen'} uit de chat gehaald` : 'Er staan geen roulette-uitslagen in de chat');
      } catch (err) { toast(err.message, true); }
      return;
    }
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
    // Een willekeurig vakje van de winnende kleur (rood = eerste plek, zwart = tweede).
    const choices = Array.from({ length: POCKETS }, (_, i) => i).filter((i) => i % 2 === r.index);
    const pocket = choices[Math.floor(Math.random() * choices.length)];
    const w0 = rou.wheel;
    const w1 = w0 + 360 * 3 + Math.random() * 360;
    // Het balletje draait de andere kant op en eindigt midden in het vakje (in schermhoek).
    const target = (((pocket * SEG + SEG / 2 + w1) % 360) + 360) % 360;
    const b0 = rou.ball;
    const back = ((b0 - target) % 360 + 360) % 360;
    const b1 = b0 - (360 * 5 + back);
    const ms = reducedMotion() ? 0 : 5200;
    const box = btn.closest('.roulette');
    box.classList.add('spinning');
    await new Promise((done) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = ms ? Math.min(1, (now - t0) / ms) : 1;
        const ew = 1 - (1 - t) ** 3;
        const eb = 1 - (1 - t) ** 2.4;
        rou.wheel = w0 + (w1 - w0) * ew;
        rou.ball = b0 + (b1 - b0) * eb;
        // Tegen het eind valt het balletje van de baan in het vakje, met een klein stuitertje.
        const drop = t < 0.72 ? 0 : Math.min(1, (t - 0.72) / 0.2);
        const bounce = t > 0.72 && t < 0.97 ? Math.sin((t - 0.72) / 0.25 * Math.PI * 3) * 3 * (1 - (t - 0.72) / 0.25) : 0;
        rou.ballR = 101 - 17 * drop + bounce;
        placeWheel();
        if (t < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    rou.wheel %= 360;
    rou.ball = ((rou.ball % 360) + 360) % 360;
    box.classList.remove('spinning');
    rou.spinning = false;
    btn.disabled = false;
    const win = findItem(r.winner_id);
    if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
    const res = $('#rouResult');
    if (res && win) {
      res.innerHTML = `<span class="roulette-win ${r.index ? 'black' : 'red'}"><small>${pocket + 1} ${r.index ? 'zwart' : 'rood'}</small><strong>${esc(shortName(win.title))} wint!</strong></span>
        <a class="btn sm gold" href="#pin-${win.id}">Verder plannen →</a>`;
      if (!reducedMotion()) confetti(box.querySelector('.wheel-wrap'));
    }
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
