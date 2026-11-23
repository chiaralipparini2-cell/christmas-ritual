// App da home + notifiche + promemoria calendario
(function () {
  var VAPID_PUBLIC = 'BCNOen_lNTEBsVbsNYiTvf4k1g9ZubUuK_OQ17K9U_s1yzGP5lw3euN3ESxVqjO8ZE54gdiLjmw4ZZBOEWMZm8s';
  var swReg = null, deferredInstall = null;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(function (r) { swReg = r; init(); }).catch(function () { init(); });
  } else { init(); }

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; render(); });
  window.addEventListener('appinstalled', function () { deferredInstall = null; render(); });

  function isStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function b64ToU8(s) { var p = '='.repeat((4 - s.length % 4) % 4), b = (s + p).replace(/-/g, '+').replace(/_/g, '/'), r = atob(b), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  function el() { return document.getElementById('remind'); }

  var state = { push: 'unknown', msg: '' };

  async function currentSub() {
    if (!pushSupported()) return null;
    var reg = swReg || (await navigator.serviceWorker.ready);
    return reg.pushManager.getSubscription();
  }
  async function saveSub(sub) {
    var j = sub.toJSON();
    var r = await window.sb.rpc('save_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (r.error) throw r.error;
  }

  async function init() {
    if (!el()) return;
    try {
      if (pushSupported()) {
        if (Notification.permission === 'denied') state.push = 'denied';
        else {
          var s = await currentSub();
          if (s && Notification.permission === 'granted') { state.push = 'on'; try { await saveSub(s); } catch (_) {} }
          else state.push = 'off';
        }
      } else state.push = 'unsupported';
    } catch (_) { state.push = 'off'; }
    render();
  }

  async function enable() {
    state.msg = '';
    try {
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') { state.push = perm === 'denied' ? 'denied' : 'off'; return render(); }
      var reg = swReg || (await navigator.serviceWorker.ready);
      var sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC) });
      await saveSub(sub);
      state.push = 'on'; state.msg = 'Fatto! Ti avviseremo ogni mattina alle 9:00.';
    } catch (e) { state.push = 'off'; state.msg = 'Non sono riuscita ad attivare le notifiche. Riprova tra poco.'; }
    render();
  }
  async function disable() {
    try {
      var s = await currentSub();
      if (s) { try { await window.sb.rpc('delete_push', { p_endpoint: s.endpoint }); } catch (_) {} await s.unsubscribe(); }
      state.push = 'off'; state.msg = 'Notifiche disattivate.';
    } catch (_) {}
    render();
  }

  function render() {
    var box = el(); if (!box) return;
    var h = '<h3>Ricordamelo ogni giorno</h3><p class="rm-sub">Non perdere nessuna casella.</p>';
    if (state.push === 'on') {
      h += '<p class="rm-ok">Notifica quotidiana attiva ✓</p><button class="linkbtn" id="rm-off">Disattiva</button>';
    } else if (state.push === 'off') {
      h += '<button class="btn small" id="rm-on">Attiva la notifica quotidiana</button>';
    } else if (state.push === 'denied') {
      h += '<p class="rm-note">Le notifiche sono bloccate sul tuo telefono. Puoi riattivarle dalle impostazioni del browser o dell’app.</p>';
    } else if (state.push === 'unsupported') {
      if (isIOS() && !isStandalone()) h += '<p class="rm-note">Per le notifiche su iPhone aggiungi prima l’app alla home: tocca <b>Condividi</b> e poi <b>Aggiungi alla schermata Home</b>. Aprila da lì e torna qui.</p>';
      else h += '<p class="rm-note">Questo dispositivo non supporta le notifiche dal sito. Usa il promemoria nel calendario qui sotto.</p>';
    }
    if (state.msg) h += '<p class="rm-msg">' + state.msg + '</p>';
    h += '<a class="btn ghost small" href="adria-avvento.ics">Aggiungi al calendario del telefono</a>';
    if (!isStandalone()) {
      if (deferredInstall) h += '<button class="btn ghost small" id="rm-inst">Aggiungi l’app alla home</button>';
      else if (isIOS()) h += '<p class="rm-note">Per avere l’icona Adria in home: <b>Condividi</b> → <b>Aggiungi alla schermata Home</b>.</p>';
      else h += '<p class="rm-note">Per l’icona in home: menu del browser → <b>Aggiungi a schermata Home</b>.</p>';
    }
    box.innerHTML = h; box.hidden = false;
    var a = document.getElementById('rm-on'); if (a) a.onclick = enable;
    var b = document.getElementById('rm-off'); if (b) b.onclick = disable;
    var c = document.getElementById('rm-inst'); if (c) c.onclick = async function () { deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (_) {} deferredInstall = null; render(); };
  }
})();
