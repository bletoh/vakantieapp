  /* ---------- init ---------- */

  async function boot() {
    // Vanuit een pushmelding (/?team=3#chat): eerst die groep openen.
    const params = new URLSearchParams(location.search);
    if (params.has('team')) {
      store.set('team', params.get('team'));
      params.delete('team');
      history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
    }
    // Uitnodigingslink /join/<code>: onthouden tot je bent ingelogd.
    const join = /^\/join\/([\w-]+)\/?$/.exec(location.pathname);
    if (join) {
      store.set('pendingJoin', join[1]);
      history.replaceState(null, '', '/' + location.hash);
    }
    await loadInvite();
    const me = await api('/auth/me');
    session.mail = !!me.mail;
    if (!me.user) { showAuth(); return; }
    await signedIn(me);
    // Een gedeelde stemlink uit een andere groep van jou: daarheen gaan.
    const m = /^#stem-(\w+)$/.exec(location.hash);
    if (m && session.teamId && !findPoll(m[1])) {
      try {
        const { team_id: teamId } = await api(`/polls/slug/${m[1]}`);
        if (teamId !== session.teamId) { await enterTeam(teamId); location.hash = `#stem-${m[1]}`; renderTabs(); renderPanel(); }
      } catch (err) { toast(err.message, true); }
    }
  }

  boot().catch((err) => {
    // Geen verbinding (de app zelf komt dan uit de cache van de service worker): rustig melden en vanzelf
    // opnieuw proberen zodra er weer internet is.
    if (!navigator.onLine || err instanceof TypeError) {
      $('#panel').innerHTML = `<div class="empty offline"><img class="empty-mascot" src="/img/reismannetje.svg" alt="" width="64" height="91">
        <strong>Je bent offline</strong><p>Zodra je weer verbinding hebt, laadt Reismannetje vanzelf.</p>
        <button type="button" class="btn" onclick="location.reload()">Opnieuw proberen</button></div>`;
      window.addEventListener('online', () => location.reload(), { once: true });
      return;
    }
    $('#panel').innerHTML = `<div class="empty">Kon de app niet laden: ${esc(err.message)}</div>`;
  });
