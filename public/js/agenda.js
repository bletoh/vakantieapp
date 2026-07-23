(async function () {
  const list = document.getElementById('list');

  async function load() {
    let items;
    try {
      items = await api('/agenda');
    } catch (e) {
      list.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
      return;
    }

    if (items.length === 0) {
      list.innerHTML = `<div class="empty-state">Nog geen agenda-items. Voeg het eerste toe!</div>`;
      return;
    }

    const byDate = {};
    for (const item of items) {
      if (!byDate[item.date]) byDate[item.date] = [];
      byDate[item.date].push(item);
    }

    const dates = Object.keys(byDate).sort();

    list.innerHTML = dates.map((date) => `
      <div class="day-group">
        <div class="day-label">${fmtDate(date)}</div>
        ${byDate[date].map((item) => `
          <div class="card">
            <div class="card-title">${item.time ? `${escapeHtml(item.time)} — ` : ''}${escapeHtml(item.title)}</div>
            ${item.activity_title ? `<div class="meta">Gekoppeld aan: ${escapeHtml(item.activity_title)}</div>` : ''}
            ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
            <div class="actions-row" style="margin-top:10px;">
              <button class="btn btn-danger" data-id="${item.id}">Verwijderen</button>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');

    list.querySelectorAll('.btn-danger').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Dit agenda-item verwijderen?')) return;
        try {
          await api(`/agenda/${btn.dataset.id}`, { method: 'DELETE' });
          load();
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }

  load();
})();
