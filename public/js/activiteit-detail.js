(async function () {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const content = document.getElementById('content');

  if (!id) {
    content.innerHTML = `<div class="error-msg">Geen activiteit opgegeven.</div>`;
    return;
  }

  async function load() {
    let a;
    try {
      a = await api(`/activities/${id}`);
    } catch (e) {
      content.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
      return;
    }

    content.innerHTML = `
      <div class="postcard-header">
        <div>
          <div class="eyebrow">Activiteit</div>
          <h1>${escapeHtml(a.title)}</h1>
          <div class="meta">Voorgesteld door ${escapeHtml(a.added_by)} · ${a.voters.length} stem${a.voters.length === 1 ? '' : 'men'}</div>
        </div>
      </div>

      ${a.description ? `<div class="card"><p>${escapeHtml(a.description)}</p></div>` : ''}

      <div class="card">
        <div class="card-title">Wie stemde er?</div>
        ${a.voters.length === 0
          ? '<div class="meta">Nog niemand.</div>'
          : `<ul>${a.voters.map(v => `<li>${escapeHtml(v.name)}</li>`).join('')}</ul>`}
      </div>

      <div class="actions-row">
        <button class="btn btn-vote" id="vote-btn">👍 Stem</button>
        <button class="btn btn-danger" id="delete-btn">Verwijderen</button>
      </div>
      <div class="error-msg" id="error"></div>
    `;

    document.getElementById('vote-btn').addEventListener('click', async () => {
      const name = ensureName();
      if (!name) return;
      try {
        await api(`/activities/${id}/vote`, { method: 'POST', body: JSON.stringify({ name }) });
        load();
      } catch (e) {
        document.getElementById('error').textContent = e.message;
      }
    });

    document.getElementById('delete-btn').addEventListener('click', async () => {
      if (!confirm('Deze activiteit definitief verwijderen?')) return;
      try {
        await api(`/activities/${id}`, { method: 'DELETE' });
        window.location.href = '/activiteiten.html';
      } catch (e) {
        document.getElementById('error').textContent = e.message;
      }
    });
  }

  load();
})();
