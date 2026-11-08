(function () {
  const cfg = window.ADRIA || {};
  window.$ = (s, r) => (r || document).querySelector(s);
  window.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/INCOLLA_QUI/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY) && window.supabase;
  window.sb = ok ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  window.fmtDate = (startISO, day) => {
    const p = String(startISO).split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + day - 1));
    return d.getUTCDate() + ' ' + MESI[d.getUTCMonth()];
  };
  window.fmtStamp = (iso) => iso ? new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  window.friendly = (err) => {
    const m = String((err && (err.message || err.error_description)) || err || '');
    if (/rate limit|too many|security purposes/i.test(m)) return 'Troppi tentativi ravvicinati. Aspetta qualche minuto e riprova.';
    if (/invalid login|invalid credentials/i.test(m)) return 'Email o password non corretti.';
    if (/already registered|already been registered/i.test(m)) return 'Questa email è già registrata: usa la scheda "Accedi".';
    if (/password/i.test(m) && /(short|least|weak|characters)/i.test(m)) return 'La password è troppo debole: usa almeno 8 caratteri.';
    if (/email not confirmed/i.test(m)) return 'Devi prima confermare la tua email.';
    if (/invalid.*email|email.*invalid/i.test(m)) return 'Controlla l’indirizzo email: non sembra corretto.';
    if (/giorno giusto/i.test(m)) return 'Questa casella non si può ancora aprire.';
    if (/privacy/i.test(m)) return 'Per entrare serve accettare l’informativa privacy: torna alla registrazione.';
    if (/non autorizzata/i.test(m)) return 'Questo account non è autorizzato.';
    return 'Qualcosa non ha funzionato. Riprova tra poco.';
  };

  window.configMissing = () =>
    '<div class="card"><div class="msg err"><b>Sito non ancora collegato al database.</b><br>Apri <code>assets/config.js</code> e incolla l’URL e la chiave pubblica di Supabase (vedi LEGGIMI.md).</div></div>';

  window.brandHtml = () =>
    '<div class="brand"><div class="name">ADRIA</div><div class="sub">Beachwear</div></div>';
})();
