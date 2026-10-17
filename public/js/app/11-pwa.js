  /* ---------- app installeren en pushmeldingen (PWA) ---------- */

  // Android/desktop-Chrome geven een installatie-verzoek dat we zelf mogen tonen; iPhone niet (dan uitleg).
  let installPrompt = null;
  let pushOn = false;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; refreshAppBlock(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; toast('Reismannetje staat nu op je beginscherm ✓'); refreshAppBlock(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').then(checkPush).catch(() => {}); });
  }

  // Staan meldingen al aan op dit apparaat? Dan de aanmelding ook (opnieuw) aan dit account koppelen.
  async function checkPush() {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    pushOn = !!sub && Notification.permission === 'granted';
    if (pushOn && session.user) api('/push/subscribe', 'POST', { subscription: sub.toJSON() }).catch(() => {});
    refreshAppBlock();
  }

  function keyBytes(b64) {
    const raw = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Meldingen zijn geblokkeerd. Zet ze aan bij de instellingen van je browser of telefoon.', true); return; }
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/push/key');
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await api('/push/subscribe', 'POST', { subscription: sub.toJSON() });
    pushOn = true;
    refreshAppBlock();
    toast('Meldingen staan aan ✓');
  }

  async function disablePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/push/unsubscribe', 'POST', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    pushOn = false;
    refreshAppBlock();
    toast('Meldingen staan uit');
  }

  // Blok op de Groep-pagina.
  function appBlockHtml() {
    let install;
    if (standalone()) install = `<p class="hint app-ok">${ic('check')} Je gebruikt Reismannetje als app.</p>`;
    else if (installPrompt) install = `<button type="button" class="btn sm primary" data-app-install>${ic('plus')} App installeren</button>`;
    else if (isIOS()) install = `<p class="hint">Als app op je iPhone: tik in Safari op <strong>Deel</strong> ${ic('share')} en kies <strong>Zet op beginscherm</strong>.</p>`;
    else install = '<p class="hint">Open Reismannetje op je telefoon in Chrome of Safari en kies <strong>Installeren</strong> of <strong>Zet op beginscherm</strong>.</p>';
    let push;
    if (pushSupported()) {
      push = pushOn
        ? `<p class="hint app-ok">${ic('bell')} Je krijgt een melding bij nieuwe berichten in je groepen.</p><button type="button" class="btn sm ghost" data-push-off>Meldingen uitzetten</button>`
        : `<button type="button" class="btn sm" data-push-on>${ic('bell')} Meldingen aanzetten</button><p class="hint">Bij nieuwe berichten, reizen en stemrondes.</p>`;
    } else if (isIOS() && !standalone()) {
      push = '<p class="hint">Meldingen werken op de iPhone zodra je Reismannetje op je beginscherm hebt gezet.</p>';
    } else {
      push = '<p class="hint">Deze browser kan geen meldingen tonen.</p>';
    }
    return `<div id="appBlock"><div class="label">App en meldingen</div>
      <div class="app-block"><div class="row-btns">${install}</div><div class="row-btns">${push}</div></div></div>`;
  }

  function refreshAppBlock() {
    const el = $('#appBlock');
    if (el) el.outerHTML = appBlockHtml();
  }

  document.addEventListener('click', async (e) => {
    try {
      if (e.target.closest('[data-app-install]') && installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        refreshAppBlock();
      } else if (e.target.closest('[data-push-on]')) {
        await enablePush();
      } else if (e.target.closest('[data-push-off]')) {
        await disablePush();
      }
    } catch (err) { toast(err.message || 'Dat lukte niet', true); }
  });
