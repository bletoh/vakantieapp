(function () {
  const form = document.getElementById('form');
  const addedByField = document.getElementById('added_by');
  const errorBox = document.getElementById('error');

  addedByField.value = getName();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.textContent = '';

    const added_by = addedByField.value.trim();
    const title = document.getElementById('title').value.trim();
    const url = document.getElementById('url').value.trim();
    const notes = document.getElementById('notes').value.trim();

    if (!added_by || !title) {
      errorBox.textContent = 'Naam en titel zijn verplicht.';
      return;
    }

    setName(added_by);

    try {
      await api('/accommodations', {
        method: 'POST',
        body: JSON.stringify({ added_by, title, url, notes }),
      });
      window.location.href = '/accommodaties.html';
    } catch (err) {
      errorBox.textContent = err.message;
    }
  });
})();
