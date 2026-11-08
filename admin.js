(async function () {
  const cfg = window.ADRIA;
  if (!sb) { $('#app').insertAdjacentHTML('beforeend', configMissing()); return; }
  $('#f-adm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('#aemail').value.trim().toLowerCase();
    const { error } = await sb.auth.signInWithPassword({ email, password: $('#apw').value });
    if (error) $('#m-adm').innerHTML = '<div class="msg err">' + esc(friendly(error)) + '</div>'; else location.reload();
  });
  $('#alogout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

  const { data } = await sb.auth.getSession();
  if (!data || !data.session) { $('#login').classList.remove('hidden'); return; }

  let rows = [];
  const [st, cl] = await Promise.all([sb.rpc('admin_stats'), sb.rpc('admin_claims')]);
  if (st.error || cl.error) {
    $('#aerr').innerHTML = '<div class="msg err">Questo account (' + esc(data.session.user.email) + ') non è autorizzato all’area riservata.</div><p class="fine"><button class="linkbtn" id="out2">Esci</button></p>';
    $('#out2').onclick = async () => { await sb.auth.signOut(); location.reload(); };
    return;
  }
  rows = cl.data;
  $('#panel').classList.remove('hidden');
  $('#awho').textContent = data.session.user.email;

  const s = st.data;
  $('#stats').innerHTML = [
    ['Clienti', s.clients], ['Caselle aperte', s.boxes_opened + '/' + s.boxes_total], ['Richieste', s.claims_started],
    ['Evase', s.fulfilled], ['Da gestire', s.claims_started - s.fulfilled], ['Ok marketing', s.marketing_ok]
  ].map((x) => '<div class="stat"><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>').join('');
  $('#stock').innerHTML = s.stock.map((x) => '<li><b>' + x.stock_left + '</b> / ' + x.stock + ' · ' + esc(x.title) + '</li>').join('');

  const FUL = { spedizione: 'Da spedire', salotto: 'Salotto', digitale: 'Digitale', nessuno: '' };
  function draw() {
    const q = $('#q').value.trim().toLowerCase(), f = $('#flt').value;
    let list = rows;
    if (q) list = rows.filter((r) => (r.claim_code + ' ' + r.email + ' ' + r.nome).toLowerCase().includes(q));
    else if (f === 'todo') list = rows.filter((r) => r.claim_started_at && !r.fulfilled_at);
    else if (f === 'done') list = rows.filter((r) => r.fulfilled_at);
    if (!list.length) { $('#list').innerHTML = '<p class="fine">Nessun risultato.</p>'; return; }
    $('#list').innerHTML = list.slice(0, 200).map((r) => {
      const pill = r.fulfilled_at ? '<span class="pill done">Evasa ' + esc(fmtStamp(r.fulfilled_at)) + '</span>'
        : r.claim_started_at ? '<span class="pill req">Richiesta ' + esc(fmtStamp(r.claim_started_at)) + '</span>'
        : '<span class="pill">Non richiesta</span>';
      return '<div class="claim"><div class="top"><span class="c">' + esc(r.claim_code) + '</span>' + pill + '</div>' +
        '<div style="font-family:var(--serif);font-size:21px;margin:4px 0 2px">' + esc(r.title) + ' <span style="font-size:13px;color:var(--muted);font-family:var(--sans)">· ' + esc(FUL[r.fulfilment] || '') + ' · casella ' + r.day + '</span></div>' +
        '<div class="who">' + esc(r.nome) + ' · ' + esc(r.email) + ' · ' + esc(r.regione) + '</div>' +
        '<div style="margin-top:10px"><button class="btn small ' + (r.fulfilled_at ? 'ghost' : '') + '" data-code="' + esc(r.claim_code) + '" data-v="' + (r.fulfilled_at ? '0' : '1') + '">' + (r.fulfilled_at ? 'Annulla evasa' : 'Segna come evasa') + '</button></div></div>';
    }).join('');
  }
  $('#q').addEventListener('input', draw); $('#flt').addEventListener('change', draw);
  $('#list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-code]'); if (!b) return;
    b.disabled = true;
    const v = b.dataset.v === '1';
    const r = await sb.rpc('admin_set_fulfilled', { p_code: b.dataset.code, p_value: v });
    if (r.error) { b.disabled = false; return; }
    const row = rows.find((x) => x.claim_code === b.dataset.code);
    row.fulfilled_at = v ? new Date().toISOString() : null; draw();
  });
  draw();
})();
