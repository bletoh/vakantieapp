(function () {
  const nameInput = document.getElementById('name-input');
  const monthNav = document.getElementById('month-nav');
  const calDiv = document.getElementById('cal');
  const saveBtn = document.getElementById('save-btn');
  const errorBox = document.getElementById('error');
  const summaryDiv = document.getElementById('summary');

  nameInput.value = getName();

  let viewDate = new Date();
  viewDate.setDate(1);
  let selected = new Set();
  let allAvailability = {};

  const monthNames = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
  const dayLetters = ['ma','di','wo','do','vr','za','zo'];

  function isoDate(y, m, d) {
    const mm = String(m + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }

  function renderMonthNav() {
    monthNav.innerHTML = `
      <button class="btn btn-outline" id="prev-month">←</button>
      <div style="flex:1;text-align:center;font-family:'IBM Plex Mono',monospace;padding-top:8px;">
        ${monthNames[viewDate.getMonth()]} ${viewDate.getFullYear()}
      </div>
      <button class="btn btn-outline" id="next-month">→</button>
    `;
    document.getElementById('prev-month').addEventListener('click', () => {
      viewDate.setMonth(viewDate.getMonth() - 1);
      renderAll();
    });
    document.getElementById('next-month').addEventListener('click', () => {
      viewDate.setMonth(viewDate.getMonth() + 1);
      renderAll();
    });
  }

  function renderCalendar() {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const firstDay = new Date(y, m, 1);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    let startOffset = firstDay.getDay() - 1; // Monday = 0
    if (startOffset < 0) startOffset = 6;

    let html = dayLetters.map(l => `<div class="cal-day empty" style="cursor:default;font-weight:600;">${l}</div>`).join('');
    for (let i = 0; i < startOffset; i++) html += `<div class="cal-day empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoDate(y, m, d);
      const isSel = selected.has(iso);
      html += `<div class="cal-day${isSel ? ' selected' : ''}" data-date="${iso}">${d}</div>`;
    }
    calDiv.innerHTML = `<div class="cal-grid">${html}</div>`;

    calDiv.querySelectorAll('.cal-day[data-date]').forEach((el) => {
      el.addEventListener('click', () => {
        const date = el.dataset.date;
        if (selected.has(date)) {
          selected.delete(date);
          el.classList.remove('selected');
        } else {
          selected.add(date);
          el.classList.add('selected');
        }
      });
    });
  }

  function renderSummary() {
    const names = Object.keys(allAvailability);
    if (names.length === 0) {
      summaryDiv.innerHTML = `<div class="empty-state">Nog niemand heeft data ingevuld.</div>`;
      return;
    }
    const dateSet = new Set();
    names.forEach(n => allAvailability[n].forEach(d => dateSet.add(d)));
    const dates = Array.from(dateSet).sort();

    if (dates.length === 0) {
      summaryDiv.innerHTML = `<div class="empty-state">Nog geen data.</div>`;
      return;
    }

    let html = '<div style="overflow-x:auto;"><table class="avail-table"><tr><th>Datum</th>';
    html += names.map(n => `<th>${escapeHtml(n)}</th>`).join('');
    html += '</tr>';
    for (const date of dates) {
      html += `<tr><td>${fmtDate(date)}</td>`;
      for (const n of names) {
        const has = allAvailability[n].includes(date);
        html += `<td class="${has ? 'yes' : ''}">${has ? '✓' : ''}</td>`;
      }
      html += '</tr>';
    }
    html += '</table></div>';
    summaryDiv.innerHTML = html;
  }

  async function loadSummary() {
    try {
      allAvailability = await api('/availability');
      renderSummary();
      const name = nameInput.value.trim();
      if (name && allAvailability[name]) {
        selected = new Set(allAvailability[name]);
        renderCalendar();
      }
    } catch (e) {
      errorBox.textContent = e.message;
    }
  }

  function renderAll() {
    renderMonthNav();
    renderCalendar();
  }

  saveBtn.addEventListener('click', async () => {
    errorBox.textContent = '';
    const name = nameInput.value.trim();
    if (!name) {
      errorBox.textContent = 'Vul je naam in.';
      return;
    }
    setName(name);
    try {
      await api('/availability', {
        method: 'POST',
        body: JSON.stringify({ name, dates: Array.from(selected) }),
      });
      loadSummary();
    } catch (e) {
      errorBox.textContent = e.message;
    }
  });

  renderAll();
  loadSummary();
})();
