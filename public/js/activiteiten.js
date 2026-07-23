(async function () {
  const list = document.getElementById('list');

  async function load() {
    let activities;
    try {
      activities = await api('/activities');
    } catch (e) {
      list.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
      return;
    }

    if (activities.length === 0) {
      list.innerHTML = `<div class="empty-state">Nog geen ideeën. Wees de eerste!</div>`;
      return;
    }

    list.innerHTML = activities.map((a) => `
      <div class="card">
        <div class="card-title">
          <a href="/activiteit-detail.html?id=${a.id}" style="text-decoration:none;">${escapeHtml(a.title)}</a>
        </div>
        <div class="meta">Voorgesteld door ${escapeHtml(a.added_by)}</div>
        ${a.description ? `<p>${escapeHtml(a.description)}</p>` : ''}
        <div class="actions-row" style="margin-top:12px;">
          <button class="btn btn-vote" data-id="${a.id}">👍 ${a.vote_count}</button>
          <a class="btn btn-outline" href="/activiteit-detail.html?id=${a.id}">Details</a>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.btn-vote').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = ensureName();
        if (!name) return;
        try {
          await api(`/activities/${btn.dataset.id}/vote`, {
            method: 'POST',
            body: JSON.stringify({ name }),
          });
          load();
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }

  load();
})();
