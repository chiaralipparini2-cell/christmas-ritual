(async function () {
  const app = $('#app');
  if (!sb) { app.insertAdjacentHTML('beforeend', configMissing()); $('#card').classList.add('hidden'); return; }

  const { data } = await sb.auth.getSession();
  if (data && data.session) { location.replace('calendar.html'); return; }

  const REGIONI = ['Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna', 'Friuli-Venezia Giulia', 'Lazio', 'Liguria', 'Lombardia', 'Marche', 'Molise', 'Piemonte', 'Puglia', 'Sardegna', 'Sicilia', 'Toscana', 'Trentino-Alto Adige', 'Umbria', "Valle d'Aosta", 'Veneto', 'Fuori Italia'];
  $('#regione').innerHTML = '<option value="">Scegli la tua regione</option>' + REGIONI.map((r) => `<option>${esc(r)}</option>`).join('');

  function tab(which) {
    const reg = which === 'reg';
    $('#t-reg').setAttribute('aria-selected', reg);
    $('#t-log').setAttribute('aria-selected', !reg);
    $('#f-reg').classList.toggle('hidden', !reg);
    $('#f-log').classList.toggle('hidden', reg);
  }
  $('#t-reg').onclick = () => tab('reg');
  $('#t-log').onclick = () => tab('log');

  const showErr = (el, e) => { el.innerHTML = '<div class="msg err">' + esc(friendly(e)) + '</div>'; };
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  $('#forgot').href = 'mailto:' + window.ADRIA.CONTACT_EMAIL + '?subject=' + encodeURIComponent('Password dimenticata - Calendario dell’Avvento') +
    '&body=' + encodeURIComponent('Ciao Adria, ho dimenticato la password del calendario. La mia email è: ');

  $('#f-reg').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#m-reg'); m.innerHTML = '';
    const nome = $('#nome').value.trim(), email = $('#email').value.trim().toLowerCase(), regione = $('#regione').value, pw = $('#pw').value;
    if (!nome) return (m.innerHTML = '<div class="msg err">Scrivi il tuo nome.</div>');
    if (!validEmail(email)) return (m.innerHTML = '<div class="msg err">Controlla l’indirizzo email.</div>');
    if (pw.length < 8) return (m.innerHTML = '<div class="msg err">La password deve avere almeno 8 caratteri.</div>');
    if (!regione) return (m.innerHTML = '<div class="msg err">Scegli la tua regione.</div>');
    if (!$('#privacy').checked) return (m.innerHTML = '<div class="msg err">Per continuare serve accettare l’informativa privacy.</div>');
    const b = $('#b-reg'); b.disabled = true;
    const { data: d, error } = await sb.auth.signUp({
      email, password: pw,
      options: { data: { nome, regione, privacy: 'true', marketing: $('#marketing').checked ? 'true' : 'false' } }
    });
    b.disabled = false;
    if (error) return showErr(m, error);
    if (d && d.session) { location.href = 'calendar.html'; return; }
    m.innerHTML = '<div class="msg info">Registrazione quasi completata: conferma la tua email dal messaggio che ti abbiamo inviato.</div>';
  });

  $('#f-log').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#m-log'); m.innerHTML = '';
    const email = $('#email2').value.trim().toLowerCase(), pw = $('#pw2').value;
    if (!validEmail(email) || !pw) return (m.innerHTML = '<div class="msg err">Inserisci email e password.</div>');
    const b = $('#b-log'); b.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    b.disabled = false;
    if (error) return showErr(m, error);
    location.href = 'calendar.html';
  });
})();
