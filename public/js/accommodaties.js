(async function () {
  const destInput = document.getElementById('destination');
  const periodNote = document.getElementById('period-note');
  const list = document.getElementById('list');
  let periodStart = null;
  let periodEnd = null;

  function updateLinks() {
    const links = buildSearchLinks(destInput.value.trim(), periodStart, periodEnd);
    document.getElementById('link-booking').href = links.booking;
    document.getElementById('link-airbnb').href = links.airbnb;
    document.getElementById('link-tripadvisor').href = links.tripadvisor;
  }

  try {
    const settings = await api('/settings');
    if (settings.destination) destInput.value = settings.destination;
    if (settings.period_start && settings.period_end) {
      periodStart = settings.period_start;
      periodEnd = settings.period_end;
      periodNote.textContent = `Periode: ${fmtDate(periodStart)} t/m ${fmtDate(periodEnd)}`;
    } else {
      periodNote.textContent = 'Periode nog niet vastgesteld — zoeklinks gaan zonder data.';
    }
  } catch (e) {
    periodNote.textContent = 'Periode nog niet vastgesteld — zoeklinks gaan zonder data.';
  }

  updateLinks();

  let saveTimer = null;
  destInput.addEventListener('input', () => {
    updateLinks();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api('/settings', { method: 'POST', body: JSON.stringify({ destination: destInput.value.trim() }) }).catch(() => {});
    }, 600);
  });

  async function loadList() {
    let items;
    try {
      items = await api('/accommodations');
    } catch (e) {
      list.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
      return;
    }

    if (items.length === 0) {
      list.innerHTML = `<div class="empty-state">Nog geen voorstellen. Vond je iets leuks? Voeg het toe!</div>`;
      return;
    }

    list.innerHTML = items.map((a) => `
      <div class="card">
        <div class="card-title">
          <a href="/accommodatie-detail.html?id=${a.id}" style="text-decoration:none;">${escapeHtml(a.title)}</a>
        </div>
        <div class="meta">Voorgesteld door ${escapeHtml(a.added_by)}</div>
        ${a.notes ? `<p>${escapeHtml(a.notes)}</p>` : ''}
        ${a.url ? `<div class="meta"><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Bekijk listing →</a></div>` : ''}
        <div class="actions-row" style="margin-top:12px;">
          <button class="btn btn-vote" data-id="${a.id}">👍 ${a.vote_count}</button>
          <a class="btn btn-outline" href="/accommodatie-detail.html?id=${a.id}">Details</a>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.btn-vote').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = ensureName();
        if (!name) return;
        try {
          await api(`/accommodations/${btn.dataset.id}/vote`, {
            method: 'POST',
            body: JSON.stringify({ name }),
          });
          loadList();
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }

  loadList();
})();
