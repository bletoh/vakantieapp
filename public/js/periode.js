(async function () {
  const form = document.getElementById('form');
  const startField = document.getElementById('period_start');
  const endField = document.getElementById('period_end');
  const errorBox = document.getElementById('error');

  try {
    const settings = await api('/settings');
    if (settings.period_start) startField.value = settings.period_start;
    if (settings.period_end) endField.value = settings.period_end;
  } catch (e) {
    // no existing settings yet, that's fine
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.textContent = '';

    const period_start = startField.value;
    const period_end = endField.value;

    if (!period_start || !period_end) {
      errorBox.textContent = 'Vul beide data in.';
      return;
    }
    if (period_end < period_start) {
      errorBox.textContent = 'Einddatum kan niet voor de startdatum liggen.';
      return;
    }

    try {
      await api('/settings', {
        method: 'POST',
        body: JSON.stringify({ period_start, period_end }),
      });
      window.location.href = '/index.html';
    } catch (err) {
      errorBox.textContent = err.message;
    }
  });
})();
