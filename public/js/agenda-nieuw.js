(async function () {
  const form = document.getElementById('form');
  const errorBox = document.getElementById('error');
  const select = document.getElementById('activity_id');

  try {
    const activities = await api('/activities');
    for (const a of activities) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.title;
      select.appendChild(opt);
    }
  } catch (e) {
    // if activities can't load, form still works without linking
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.textContent = '';

    const date = document.getElementById('date').value;
    const time = document.getElementById('time').value;
    const title = document.getElementById('title').value.trim();
    const description = document.getElementById('description').value.trim();
    const activity_id = select.value ? Number(select.value) : null;

    if (!date || !title) {
      errorBox.textContent = 'Datum en titel zijn verplicht.';
      return;
    }

    try {
      await api('/agenda', {
        method: 'POST',
        body: JSON.stringify({ date, time, title, description, activity_id }),
      });
      window.location.href = '/agenda.html';
    } catch (err) {
      errorBox.textContent = err.message;
    }
  });
})();
