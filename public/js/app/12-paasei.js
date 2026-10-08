  /* ---------- paasei: fiesta-modus ---------- */

  // Geheim: de Konami-code (↑↑↓↓←→←→BA) of "fiesta" / "vamos" / "olé" in de zoekbalk van Ideeën.
  // Er vliegt een vliegtuigje met een spandoek over, het regent cocktails en de app gaat disco.
  const FIESTA_BANNERS = [
    '¡VAMOS A LA PLAYA!',
    'Out of office tot september',
    'Wie het laatst boekt, betaalt de eerste ronde',
    'Zonnebrand is voor mietjes (smeer je toch in)',
    'Dit is geen vakantie, dit is een missie',
    'Budget? Nooit van gehoord',
    'Groepsapp-beheerder: ik hoop dat je dit leest',
    'Eén biertje nog en dan naar bed (gelogen)',
  ];
  const FIESTA_RAIN = ['🍹', '🏖️', '🕶️', '🌴', '🍺', '🦩', '☀️', '🍕', '🪩', '🥥', '🩴', '🎉'];
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let konamiAt = 0;
  let fiestaBusy = false;

  function fiesta() {
    if (fiestaBusy) return;
    fiestaBusy = true;
    const banner = FIESTA_BANNERS[Math.floor(Math.random() * FIESTA_BANNERS.length)];
    toast('🎉 Fiesta-modus aan. Niemand heeft dit gezien.');
    const layer = document.createElement('div');
    layer.className = 'fiesta-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `<div class="fiesta-plane"><span class="fiesta-banner">${esc(banner)}</span><span class="fiesta-rope"></span><span class="fiesta-jet">✈️</span></div>`
      + '<div class="fiesta-flamingo">🦩</div>';
    if (!reducedMotion()) {
      for (let i = 0; i < 44; i++) {
        const s = document.createElement('span');
        s.className = 'fiesta-drop';
        s.textContent = FIESTA_RAIN[i % FIESTA_RAIN.length];
        s.style.left = `${Math.random() * 100}%`;
        s.style.fontSize = `${18 + Math.random() * 22}px`;
        s.style.animationDelay = `${Math.random() * 4}s`;
        s.style.animationDuration = `${2.6 + Math.random() * 2.4}s`;
        s.style.setProperty('--spin', `${Math.random() * 720 - 360}deg`);
        s.style.setProperty('--drift', `${Math.random() * 120 - 60}px`);
        layer.append(s);
      }
    }
    document.body.append(layer);
    document.body.classList.add('fiesta');
    setTimeout(() => {
      layer.remove();
      document.body.classList.remove('fiesta');
      fiestaBusy = false;
    }, 9000);
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (!e.key) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    konamiAt = key === KONAMI[konamiAt] ? konamiAt + 1 : (key === KONAMI[0] ? 1 : 0);
    if (konamiAt === KONAMI.length) { konamiAt = 0; fiesta(); }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id !== 'ideaSearch') return;
    const q = e.target.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[!¡]/g, '');
    if (q === 'fiesta' || q === 'vamos' || q === 'ole') fiesta();
  });
