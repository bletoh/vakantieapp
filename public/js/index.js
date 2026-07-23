(async function () {
  try {
    const settings = await api('/settings');
    const line = document.getElementById('period-line');
    if (settings.period_start && settings.period_end) {
      line.textContent = `Periode: ${fmtDate(settings.period_start)} t/m ${fmtDate(settings.period_end)}`;
    }
  } catch (e) {
    // silently ignore, keep default text
  }
})();
