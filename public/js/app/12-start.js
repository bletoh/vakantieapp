  /* ---------- init ---------- */

  async function boot() {
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
    $('#panel').innerHTML = `<div class="empty">Kon de app niet laden: ${esc(err.message)}</div>`;
  });
