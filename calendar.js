(async function () {
  const cfg = window.ADRIA;
  if (!sb) { $('#status').remove(); $('#grid').outerHTML = configMissing(); return; }
  const { data } = await sb.auth.getSession();
  const session = data && data.session;
  if (!session) { location.replace('index.html'); return; }

  $('#mailus').href = 'mailto:' + cfg.CONTACT_EMAIL;
  $('#logout').onclick = async () => { await sb.auth.signOut(); location.replace('index.html'); };

  let cal = null;

  async function load() {
    const i = await sb.rpc('init_calendar');
    if (i.error) throw i.error;
    const r = await sb.rpc('get_calendar');
    if (r.error) throw r.error;
    cal = r.data;
    render();
  }

  const TAGS = { foto: 'Foto', promo: 'Sorpresa', premio: 'Regalo' };
  const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  function statusText() {
    const t = cal.today_day, n = cal.total_days;
    if (t < 1) { const d = 1 - t; return 'Il calendario si apre il ' + fmtDate(cal.start_date, 1) + '. ' + (d === 1 ? 'Manca un giorno.' : 'Mancano ' + d + ' giorni.'); }
    if (t > n) return 'Il calendario è concluso. Puoi rivedere le tue caselle quando vuoi.';
    const today = cal.boxes.find((b) => b.day === t);
    const late = cal.boxes.filter((b) => !b.opened && b.day < t).length;
    let s = today && !today.opened ? 'Oggi è il ' + fmtDate(cal.start_date, t) + ': la tua casella ti aspetta.' : 'Hai aperto la casella di oggi. A domani.';
    if (late) s += ' ' + (late === 1 ? 'Hai ancora una casella da aprire.' : 'Hai ancora ' + late + ' caselle da aprire.');
    return s;
  }

  function render() {
    $('#who').textContent = cal.nome ? 'Ciao ' + cal.nome : '';
    $('#status').textContent = statusText();
    $('#grid').innerHTML = cal.boxes.map((b) => {
      const date = fmtDate(cal.start_date, b.day);
      if (b.opened) {
        const tag = b.prize ? TAGS[b.prize.category] : 'Frase';
        return '<button class="tile opened" data-day="' + b.day + '" aria-label="Casella del ' + date + ', aperta"><span class="n">' + b.day + '</span><span class="tag">' + tag + '</span></button>';
      }
      if (b.day <= cal.today_day) {
        return '<button class="tile ready' + (b.day === cal.today_day ? ' today' : '') + '" data-day="' + b.day + '" aria-label="Apri la casella del ' + date + '"><span class="n">' + b.day + '</span><span class="tag">Apri</span></button>';
      }
      return '<button class="tile locked" disabled aria-label="Casella del ' + date + ', non ancora disponibile"><span class="n">' + b.day + '</span>' + LOCK + '</button>';
    }).join('');
  }

  $('#grid').addEventListener('click', async (e) => {
    const t = e.target.closest('.tile'); if (!t || t.disabled) return;
    const day = +t.dataset.day;
    const box = cal.boxes.find((b) => b.day === day);
    if (box.opened) return showModal(box);
    t.disabled = true;
    const r = await sb.rpc('open_box', { p_day: day });
    if (r.error) { $('#err').innerHTML = '<div class="msg err">' + esc(friendly(r.error)) + '</div>'; t.disabled = false; return; }
    $('#err').innerHTML = '';
    const idx = cal.boxes.findIndex((b) => b.day === day);
    cal.boxes[idx] = r.data;
    render();
    showModal(r.data);
  });

  // ---------------- finestra della casella ----------------
  function close() { $('#modal').innerHTML = ''; document.body.style.overflow = ''; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  function claimLabel(p) { return p.fulfilment === 'salotto' ? 'Prenota il tuo Salotto' : p.category === 'premio' ? 'Richiedi il regalo' : 'Richiedi la sorpresa'; }

  function mailtoFor(box) {
    const p = box.prize, date = fmtDate(cal.start_date, box.day), nl = '\r\n';
    let body = 'Ciao Adria,' + nl + 'ho aperto la casella del ' + date + ' del Calendario dell’Avvento e ho trovato: ' + p.title + '.' + nl + nl +
      'Il mio codice: ' + box.claim_code + nl + 'Nome e cognome: ' + (cal.nome || '') + nl + 'Email: ' + session.user.email + nl;
    if (p.fulfilment === 'spedizione') body += nl + 'Indirizzo di spedizione (via, numero, CAP, città, provincia):' + nl + nl + 'Telefono:' + nl + nl + 'So che la spedizione è a mio carico.' + nl;
    if (p.fulfilment === 'salotto') body += nl + 'Città e provincia:' + nl + 'Giorni e orari che preferisco per il Salotto:' + nl + 'Telefono:' + nl;
    body += nl + 'Grazie!';
    return { subject: 'Calendario dell’Avvento · ' + p.title + ' · ' + box.claim_code, body };
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (_) {} ta.remove(); return ok;
    }
  }

  function showModal(box, still) {
    const date = fmtDate(cal.start_date, box.day);
    const p = box.prize;
    let prize = '';
    if (p) {
      const kicker = p.category === 'premio' ? 'Hai vinto un regalo' : p.category === 'foto' ? 'Una fotografia per te' : 'Una sorpresa per te';
      let claim = '';
      if (p.claimable) {
        if (box.fulfilled) claim = '<p class="note">Adria ha preso in carico la tua richiesta. Grazie!</p>';
        else if (box.claim_started) claim =
          '<div class="code"><small>Il tuo codice</small><strong>' + esc(box.claim_code) + '</strong></div>' +
          '<div class="row"><button class="btn gold small" id="reopen">Riapri l’email</button><button class="btn ghost small" id="copytext">Copia il testo</button></div>' +
          '<p class="note" id="claimnote">Invia l’email a ' + esc(cfg.CONTACT_EMAIL) + ' con il codice: ci pensiamo noi. Se non si è aperta l’app di posta, copia il testo e incollalo in una nuova email.</p>';
        else claim = '<button class="btn gold" id="claim">' + esc(claimLabel(p)) + '</button><p class="note">Si aprirà la tua email già pronta, con un codice personale. Devi solo inviarla.</p>';
      }
      prize = '<div class="orn"></div><div class="prize"><p class="kicker">' + kicker + '</p>' +
        (p.image_url ? '<img src="' + esc(p.image_url) + '" alt="' + esc(p.title) + '">' : '') +
        '<h3>' + esc(p.title) + '</h3><p>' + esc(p.body) + '</p>' + claim + '</div>';
    } else {
      prize = '<p class="only-frase">Oggi il regalo è questo pensiero. Domani, una nuova sorpresa.</p>';
    }
    $('#modal').innerHTML =
      '<div class="overlay' + (still ? ' still' : '') + '" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-label="Casella del ' + esc(date) + '">' +
      '<button class="close" aria-label="Chiudi">×</button>' +
      '<p class="date">' + esc(date) + '</p><blockquote>' + esc(box.phrase) + '</blockquote>' +
      '<button class="btn ghost" id="share" style="margin-top:0">Condividi la frase</button>' +
      '<p class="note" style="text-align:center;margin-top:8px">Salvala o mettila nelle tue storie, e taggaci.</p>' + prize + '</div></div>';
    document.body.style.overflow = 'hidden';

    $('#ov').addEventListener('click', (e) => { if (e.target.id === 'ov') close(); });
    $('.close').onclick = close;
    $('#share').onclick = () => shareCard(box);

    const claimBtn = $('#claim');
    if (claimBtn) claimBtn.onclick = async () => {
      claimBtn.disabled = true;
      const r = await sb.rpc('request_claim', { p_day: box.day });
      if (r.error) { claimBtn.disabled = false; claimBtn.insertAdjacentHTML('afterend', '<div class="msg err">' + esc(friendly(r.error)) + '</div>'); return; }
      box.claim_started = true;
      const idx = cal.boxes.findIndex((b) => b.day === box.day); cal.boxes[idx] = box;
      showModal(box, true);
      openMail(box);
    };
    const re = $('#reopen'); if (re) re.onclick = () => openMail(box);
    const ct = $('#copytext'); if (ct) ct.onclick = async () => {
      const m = mailtoFor(box);
      const ok = await copy('A: ' + cfg.CONTACT_EMAIL + '\n' + 'Oggetto: ' + m.subject + '\n\n' + m.body);
      $('#claimnote').textContent = ok ? 'Testo copiato. Incollalo in una nuova email e invialo a ' + cfg.CONTACT_EMAIL + '.' : 'Non riesco a copiare: scrivi a ' + cfg.CONTACT_EMAIL + ' indicando il codice ' + box.claim_code + '.';
    };
  }

  function openMail(box) {
    const m = mailtoFor(box);
    location.href = 'mailto:' + cfg.CONTACT_EMAIL + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body);
  }

  // ---------------- scheda condivisibile (1080x1350) ----------------
  const spaced = (t, sp) => t.split('').join(sp || ' ');
  function wrap(g, text, maxW) {
    const words = text.split(/\s+/), lines = []; let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    }
    if (cur) lines.push(cur); return lines;
  }

  async function shareCard(box) {
    const btn = $('#share'); btn.disabled = true;
    try {
      const date = fmtDate(cal.start_date, box.day).toUpperCase();
      try {
        await Promise.all([document.fonts.load('italic 500 60px "Cormorant Garamond"'), document.fonts.load('500 60px "Cormorant Garamond"'), document.fonts.load('400 30px "Jost"')]);
      } catch (_) {}
      const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#f7f2ea'); bg.addColorStop(1, '#e8dcc9'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const rg = g.createRadialGradient(W / 2, -80, 40, W / 2, -80, 900); rg.addColorStop(0, 'rgba(63,131,145,.30)'); rg.addColorStop(1, 'rgba(63,131,145,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#b08d57'; g.lineWidth = 2; g.strokeRect(48, 48, W - 96, H - 96); g.lineWidth = 1; g.strokeRect(62, 62, W - 124, H - 124);
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';

      g.fillStyle = '#b08d57'; g.font = '400 30px Jost, sans-serif'; g.fillText(spaced(date, '  '), W / 2, 215);
      g.fillRect(W / 2 - 40, 255, 80, 2);

      let size = 80, lines, lh;
      for (; size >= 44; size -= 2) {
        g.font = 'italic 500 ' + size + 'px "Cormorant Garamond", Georgia, serif';
        lines = wrap(g, box.phrase, W - 270); lh = size * 1.24;
        if (lines.length * lh <= 640) break;
      }
      g.fillStyle = '#14283a';
      let y = 650 - (lines.length * lh) / 2 + size * 0.78;
      for (const ln of lines) { g.fillText(ln, W / 2, y); y += lh; }

      g.fillStyle = '#b08d57'; g.fillRect(W / 2 - 40, 1010, 80, 2);
      g.fillStyle = '#14283a'; g.font = '500 76px "Cormorant Garamond", Georgia, serif'; g.fillText(spaced('ADRIA', ' '), W / 2, 1110);
      g.fillStyle = '#b08d57'; g.font = '400 24px Jost, sans-serif'; g.fillText(spaced('BEACHWEAR', ' '), W / 2, 1160);
      g.fillStyle = '#6c7681'; g.font = '300 24px Jost, sans-serif'; g.fillText('Calendario dell’Avvento ' + (cfg.YEAR || '') + ' · ' + (cfg.SITE_NAME || ''), W / 2, 1230);

      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const file = new File([blob], 'adria-avvento-' + box.day + '.png', { type: 'image/png' });
      const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Adria Beachwear' }); } catch (e) { if (e.name !== 'AbortError') download(); }
      } else download();
    } finally { btn.disabled = false; }
  }

  try { await load(); } catch (e) {
    $('#status').textContent = '';
    $('#err').innerHTML = '<div class="msg err">' + esc(friendly(e)) + '</div>';
  }
})();
