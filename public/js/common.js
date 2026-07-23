// Shared helpers - no modal logic anywhere, on purpose.

function getName() {
  return localStorage.getItem('vp_name') || '';
}

function setName(name) {
  localStorage.setItem('vp_name', name);
}

function ensureName() {
  let name = getName();
  if (!name) {
    name = prompt('Wat is je naam?');
    if (name && name.trim()) {
      setName(name.trim());
      name = name.trim();
    }
  }
  return name;
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Er ging iets mis');
  }
  if (res.status === 204) return null;
  return res.json();
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
}

function buildSearchLinks(destination, checkin, checkout) {
  const dest = encodeURIComponent(destination || '');
  const links = {
    booking: `https://www.booking.com/searchresults.html?ss=${dest}`,
    airbnb: `https://www.airbnb.com/s/${dest}/homes`,
    tripadvisor: `https://www.tripadvisor.com/Search?q=${dest}`,
  };
  if (checkin && checkout) {
    links.booking += `&checkin=${checkin}&checkout=${checkout}`;
    links.airbnb += `?checkin=${checkin}&checkout=${checkout}`;
  }
  return links;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
