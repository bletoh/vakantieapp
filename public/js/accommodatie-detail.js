(async function () {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const content = document.getElementById('content');

  if (!id) {
    content.innerHTML = `<div class="error-msg">Geen accommodatie opgegeven.</div>`;
    return;
  }

  async function load() {
    let a;
    try {
      a = await api(`/accommodations/${id}`);
    } catch (e) {
      content.innerHTML = `<div class="error-msg">${escapeHtml(e.message)}</div>`;
      return;
    }

    content.innerHTML = `
      <div class="postcard-header">
        <div>
          <div class="eyebrow">Accommodatie</div>
          <h1>${escapeHtml(a.title)}</h1>
          <div class="meta">Voorgesteld door ${escapeHtml(a.added_by)} · ${a.voters.length} stem${a.voters.length === 1 ? '' : 'men'}</div>
        </div>
      </div>

      ${a.url ? `<div class="card"><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Bekijk listing →</a></div>` : ''}
      ${a.notes ? `<div class="card"><p>${escapeHtml(a.notes)}</p></div>` : ''}

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
        await api(`/accommodations/${id}/vote`, { method: 'POST', body: JSON.stringify({ name }) });
        load();
      } catch (e) {
        document.getElementById('error').textContent = e.message;
      }
    });

    document.getElementById('delete-btn').addEventListener('click', async () => {
      if (!confirm('Dit voorstel definitief verwijderen?')) return;
      try {
        await api(`/accommodations/${id}`, { method: 'DELETE' });
        window.location.href = '/accommodaties.html';
      } catch (e) {
        document.getElementById('error').textContent = e.message;
      }
    });
  }

  load();
})();
