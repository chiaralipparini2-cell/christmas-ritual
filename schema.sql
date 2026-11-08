-- =====================================================================
-- ADRIA BEACHWEAR - Calendario dell'Avvento
-- Incolla tutto questo file nel "SQL Editor" di Supabase e premi Run.
-- E' sicuro rieseguirlo: non cancella dati esistenti.
-- =====================================================================

-- ---------- IMPOSTAZIONI -------------------------------------------
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  start_date date not null default '2026-12-01',   -- giorno della casella 1
  days int not null default 25,                    -- numero di caselle
  expected_clients int not null default 30,        -- clienti attese (serve a distribuire le scorte)
  special_slots int not null default 2,            -- caselle "premio" per calendario
  photo_slots int not null default 8,              -- caselle con fotografia
  promo_slots int not null default 5,              -- caselle con promo speciale
  debug_today date                                 -- SOLO PER PROVE: finge che oggi sia questa data
);
insert into settings default values on conflict do nothing;

-- ---------- TABELLE --------------------------------------------------
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nome text not null default '',
  regione text not null default '',
  privacy_at timestamptz not null default now(),
  marketing boolean not null default false,
  marketing_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists phrases (
  day int primary key,
  text text not null
);

create table if not exists prizes (
  id serial primary key,
  category text not null check (category in ('foto','promo','premio')),
  type text not null,                 -- es. buono, pallina, salotto, collanina...
  title text not null,
  body text not null default '',
  image_url text,
  claimable boolean not null default false,
  fulfilment text not null default 'nessuno' check (fulfilment in ('nessuno','digitale','spedizione','salotto')),
  stock int,                          -- null = illimitato
  stock_left int,
  only_region text,                   -- se valorizzato, solo per clienti di quella regione
  unique (category, title)
);

create table if not exists boxes (
  user_id uuid not null references auth.users(id) on delete cascade,
  day int not null,
  slot text not null check (slot in ('special','foto','promo','frase')),
  prize_id int references prizes(id),
  claim_code text unique,
  opened_at timestamptz,
  claim_started_at timestamptz,
  fulfilled_at timestamptz,
  primary key (user_id, day)
);

-- ---------- SICUREZZA: nessun accesso diretto alle tabelle ----------
alter table settings enable row level security;
alter table profiles enable row level security;
alter table phrases  enable row level security;
alter table prizes   enable row level security;
alter table boxes    enable row level security;
revoke all on settings, profiles, phrases, prizes, boxes from anon, authenticated;

-- ---------- FUNZIONI DI SUPPORTO (non esposte) ----------------------
create or replace function app_today() returns date
language sql stable security definer set search_path = public as $$
  select coalesce((select debug_today from settings where id = 1),
                  (now() at time zone 'Europe/Rome')::date)
$$;

create or replace function current_day() returns int
language sql stable security definer set search_path = public as $$
  select (app_today() - (select start_date from settings where id = 1)) + 1
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  -- il ruolo e' nei metadati "app" dell'utente: si assegna solo da SQL Editor, nessuna cliente puo' darselo
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'adria_admin'
$$;

create or replace function pick_unlimited(p_uid uuid, p_cat text) returns int
language sql volatile security definer set search_path = public as $$
  select id from prizes
  where category = p_cat and stock is null
    and id not in (select prize_id from boxes where user_id = p_uid and prize_id is not null)
  order by random() limit 1
$$;

create or replace function box_json(p_uid uuid, p_day int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'day', b.day,
    'opened', true,
    'phrase', ph.text,
    'claim_code', b.claim_code,
    'claim_started', b.claim_started_at is not null,
    'fulfilled', b.fulfilled_at is not null,
    'prize', case when p.id is null then null else jsonb_build_object(
        'category', p.category, 'type', p.type, 'title', p.title, 'body', p.body,
        'image_url', p.image_url, 'claimable', p.claimable, 'fulfilment', p.fulfilment) end)
  from boxes b
  left join phrases ph on ph.day = b.day
  left join prizes p on p.id = b.prize_id
  where b.user_id = p_uid and b.day = p_day and b.opened_at is not null
$$;

-- ---------- 1) REGISTRAZIONE: crea il calendario della cliente ------
create or replace function init_calendar() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s settings%rowtype;
  meta jsonb;
  arr int[];
  i int;
  v_slot text;
begin
  if uid is null then raise exception 'non autenticata'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  if exists (select 1 from boxes where user_id = uid) then return; end if;

  select * into s from settings where id = 1;
  meta := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  if coalesce(meta ->> 'privacy', '') <> 'true' then
    raise exception 'consenso privacy mancante';
  end if;

  insert into profiles (user_id, email, nome, regione, marketing, marketing_at)
  values (uid, lower(auth.jwt() ->> 'email'),
          left(coalesce(meta ->> 'nome', ''), 80),
          left(coalesce(meta ->> 'regione', ''), 40),
          coalesce(meta ->> 'marketing', '') = 'true',
          case when coalesce(meta ->> 'marketing', '') = 'true' then now() end)
  on conflict (user_id) do nothing;

  -- ordine casuale dei giorni, poi assegno il tipo di casella
  select array_agg(d order by random()) into arr from generate_series(1, s.days) d;
  for i in 1 .. s.days loop
    v_slot := case
      when i <= s.special_slots then 'special'
      when i <= s.special_slots + s.photo_slots then 'foto'
      when i <= s.special_slots + s.photo_slots + s.promo_slots then 'promo'
      else 'frase' end;
    insert into boxes (user_id, day, slot) values (uid, arr[i], v_slot);
  end loop;
end $$;

-- ---------- 2) APERTURA CASELLA + SORTEGGIO -------------------------
create or replace function open_box(p_day int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s settings%rowtype;
  b boxes%rowtype;
  v_region text;
  v_prize prizes%rowtype;
  v_prize_id int;
  v_stock int;
  v_tickets int;
  v_p numeric;
  v_hex text;
  v_code text;
begin
  if uid is null then raise exception 'non autenticata'; end if;
  select * into s from settings where id = 1;
  if p_day < 1 or p_day > s.days then raise exception 'giorno non valido'; end if;
  if current_day() < p_day then raise exception 'questa casella si apre il giorno giusto'; end if;

  select * into b from boxes where user_id = uid and day = p_day for update;
  if not found then raise exception 'calendario non inizializzato'; end if;
  if b.opened_at is not null then return box_json(uid, p_day); end if;

  perform pg_advisory_xact_lock(7001);          -- una estrazione alla volta (scorte)
  select regione into v_region from profiles where user_id = uid;

  if b.slot = 'special' then
    -- scorta disponibile per questa cliente (regione e tipi gia' vinti esclusi)
    select coalesce(sum(stock_left), 0) into v_stock from prizes
     where category = 'premio' and stock is not null and stock_left > 0
       and (only_region is null or only_region = v_region)
       and type not in (select p2.type from boxes b2 join prizes p2 on p2.id = b2.prize_id where b2.user_id = uid);
    -- caselle "premio" ancora da aprire (anche delle clienti non ancora iscritte)
    v_tickets := (select count(*) from boxes where slot = 'special' and opened_at is null)
               + greatest(0, s.expected_clients - (select count(*) from profiles)) * s.special_slots;
    v_p := least(1, v_stock::numeric / greatest(v_tickets, 1));
    if v_stock > 0 and random() < v_p then
      select id into v_prize_id from prizes
       where category = 'premio' and stock is not null and stock_left > 0
         and (only_region is null or only_region = v_region)
         and type not in (select p2.type from boxes b2 join prizes p2 on p2.id = b2.prize_id where b2.user_id = uid)
       order by -ln(1 - random()) / stock_left        -- estrazione pesata sulla scorta
       limit 1;
    end if;
    if v_prize_id is null then v_prize_id := pick_unlimited(uid, 'promo'); end if;
  elsif b.slot = 'foto' then
    v_prize_id := pick_unlimited(uid, 'foto');
  elsif b.slot = 'promo' then
    v_prize_id := pick_unlimited(uid, 'promo');
  end if;

  if v_prize_id is not null then
    select * into v_prize from prizes where id = v_prize_id;
    if v_prize.stock is not null then
      update prizes set stock_left = stock_left - 1 where id = v_prize_id;
    end if;
    if v_prize.claimable then
      v_hex := replace(gen_random_uuid()::text, '-', '');
      v_code := 'ADRIA-' || upper(substr(v_hex, 1, 4)) || '-' || upper(substr(v_hex, 5, 4));
    end if;
  end if;

  update boxes set prize_id = v_prize_id, claim_code = v_code, opened_at = now()
   where user_id = uid and day = p_day;
  return box_json(uid, p_day);
end $$;

-- ---------- 3) LETTURA DEL CALENDARIO -------------------------------
create or replace function get_calendar() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s settings%rowtype;
begin
  if uid is null then raise exception 'non autenticata'; end if;
  select * into s from settings where id = 1;
  return jsonb_build_object(
    'today_day', current_day(),
    'start_date', s.start_date,
    'total_days', s.days,
    'nome', (select nome from profiles where user_id = uid),
    'boxes', coalesce((
      select jsonb_agg(
        case when b.opened_at is not null then box_json(uid, b.day)
             else jsonb_build_object('day', b.day, 'opened', false) end
        order by b.day)
      from boxes b where b.user_id = uid), '[]'::jsonb));
end $$;

-- ---------- 4) RICHIESTA REGALO (la cliente preme il tasto) ---------
create or replace function request_claim(p_day int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_code text;
begin
  if uid is null then raise exception 'non autenticata'; end if;
  update boxes set claim_started_at = coalesce(claim_started_at, now())
   where user_id = uid and day = p_day and opened_at is not null and claim_code is not null
   returning claim_code into v_code;
  if v_code is null then raise exception 'nessun premio da richiedere'; end if;
  return jsonb_build_object('claim_code', v_code,
    'nome', (select nome from profiles where user_id = uid),
    'email', (select email from profiles where user_id = uid));
end $$;

-- ---------- 5) AREA RISERVATA ADRIA ---------------------------------
create or replace function admin_claims() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'non autorizzata'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'claim_code', b.claim_code, 'email', pr.email, 'nome', pr.nome, 'regione', pr.regione,
      'day', b.day, 'title', p.title, 'type', p.type, 'fulfilment', p.fulfilment,
      'opened_at', b.opened_at, 'claim_started_at', b.claim_started_at, 'fulfilled_at', b.fulfilled_at)
      order by b.fulfilled_at is not null, b.claim_started_at desc nulls last, b.opened_at desc)
    from boxes b
    join prizes p on p.id = b.prize_id
    join profiles pr on pr.user_id = b.user_id
    where b.claim_code is not null), '[]'::jsonb);
end $$;

create or replace function admin_set_fulfilled(p_code text, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'non autorizzata'; end if;
  update boxes set fulfilled_at = case when p_value then now() else null end
   where claim_code = upper(trim(p_code));
end $$;

create or replace function admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'non autorizzata'; end if;
  return jsonb_build_object(
    'clients', (select count(*) from profiles),
    'marketing_ok', (select count(*) from profiles where marketing),
    'boxes_total', (select count(*) from boxes),
    'boxes_opened', (select count(*) from boxes where opened_at is not null),
    'claims_started', (select count(*) from boxes where claim_started_at is not null),
    'fulfilled', (select count(*) from boxes where fulfilled_at is not null),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'stock', stock, 'stock_left', stock_left) order by id)
                       from prizes where stock is not null), '[]'::jsonb));
end $$;

-- ---------- PERMESSI SULLE FUNZIONI --------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function init_calendar(), open_box(int), get_calendar(), request_claim(int),
  admin_claims(), admin_set_fulfilled(text, boolean), admin_stats() to authenticated;

-- ---------- CONTENUTI: LE 25 FRASI ----------------------------------
insert into phrases (day, text) values
(1,  'Dicembre apre le porte piano. È il mese in cui si impara che aspettare l''estate può essere un gesto elegante.'),
(2,  'Ciò che è fatto a mano conserva il tempo di chi lo ha fatto. Per questo non somiglia a nient''altro.'),
(3,  'Il lusso vero non fa rumore. Si riconosce da come ti fa stare.'),
(4,  'Ogni punto è una scelta. Ogni scelta è un''idea di bellezza.'),
(5,  'La sensualità non si mostra: si abita. Comincia dal sentirsi a casa nel proprio corpo.'),
(6,  'San Nicola lo sapeva: i doni migliori arrivano di nascosto e fanno sorridere due volte.'),
(7,  'L''attesa è la parte più elegante del desiderio.'),
(8,  'Oggi si accende l''albero. Accendi anche tu qualcosa di tuo: un pensiero, una promessa, un colore.'),
(9,  'Il mare d''inverno insegna la pazienza: tace, ma non smette di brillare.'),
(10, 'Scegliere poche cose belle è un modo gentile di rispettare il tempo e il mondo.'),
(11, 'La libertà ha la forma di una linea pulita e di un orizzonte aperto.'),
(12, 'Un tessuto giusto non stringe, accompagna. Come le persone giuste.'),
(13, 'Santa Lucia porta la luce nel giorno più corto. Anche tu puoi essere luce, senza fare rumore.'),
(14, 'Non esiste stagione sbagliata per sentirsi bellissime.'),
(15, 'Un dettaglio curato è una carezza fatta con le mani.'),
(16, 'L''unicità non si cerca: si smette di nasconderla.'),
(17, 'L''estate si prepara adesso, tra una misura e un sogno.'),
(18, 'Ogni donna ha un''estate dentro. Basta la luce giusta per farla uscire.'),
(19, 'La grazia è una forza che ha imparato a muoversi piano.'),
(20, 'Regalarsi qualcosa di bello non è vanità: è cura.'),
(21, 'Oggi è la notte più lunga dell''anno. Da domani la luce torna a crescere, anche per te.'),
(22, 'Il tempo dedicato a sé stesse non è mai tempo perso.'),
(23, 'Dietro ogni abito c''è una stanza con la luce accesa e due mani che non hanno fretta.'),
(24, 'Alla vigilia si custodisce l''essenziale: le persone che amiamo e il desiderio di stare bene.'),
(25, 'Buon Natale. Che l''anno nuovo ti trovi pronta per l''estate più bella.')
on conflict (day) do nothing;

-- ---------- CONTENUTI: PREMI ----------------------------------------
-- Premi con scorta (categoria 'premio'): stock = quanti ne hai in tutto.
insert into prizes (category, type, title, body, claimable, fulfilment, stock, stock_left, only_region) values
('premio','buono','Buono da 50 €',
 'Un buono da 50 € da usare su un tuo acquisto Adria Beachwear. Scadenza e spesa minima ti vengono indicate nella risposta alla tua richiesta.',
 true,'digitale', 8, 8, null),
('premio','pallina','Pallina di Natale Adria',
 'Una pallina di Natale firmata Adria, per il tuo albero o per un regalo. La spedizione è a tuo carico.',
 true,'spedizione', 10, 10, null),
('premio','salotto','Il Salotto Adria',
 'La titolare viene a casa tua a mostrarti tutta la collezione Adria, con calma, come in un salotto. Disponibile solo in Emilia-Romagna.',
 true,'salotto', 3, 3, 'Emilia-Romagna'),
('premio','collanina','Una collanina Adria',
 'Una collanina Adria per te. La spedizione è a tuo carico.',
 true,'spedizione', 6, 6, null),
('premio','kit_capelli','Kit capelli perfetti',
 'Il kit Adria per avere i capelli perfetti, al mare e in città. La spedizione è a tuo carico.',
 true,'spedizione', 6, 6, null),
('premio','copricapo','Un copricapo Adria',
 'Un copricapo Adria per le giornate di sole. La spedizione è a tuo carico.',
 true,'spedizione', 4, 4, null),
('premio','pantaloni_lino','Pantaloni in lino Adria',
 'Un paio di pantaloni in lino Adria, per l''estate che ti aspetta. La spedizione è a tuo carico.',
 true,'spedizione', 3, 3, null),
('premio','completo_tulle','Completo in tulle Adria',
 'Un completo in tulle Adria, leggero e sartoriale. La spedizione è a tuo carico.',
 true,'spedizione', 2, 2, null)
on conflict (category, title) do nothing;

-- Promo speciali (illimitate). Le condizioni precise le comunicate voi nella risposta.
insert into prizes (category, type, title, body, claimable, fulfilment) values
('promo','promo','Un accessorio in omaggio','Un accessorio Adria in omaggio sul tuo prossimo ordine. Ti scriviamo noi i dettagli.',true,'digitale'),
('promo','promo','Il tuo monogramma','Le tue iniziali ricamate a mano sul costume che sceglierai. Un tocco che è solo tuo.',true,'digitale'),
('promo','promo','Consulenza sartoriale privata','Una videochiamata personale con la nostra sarta per scegliere modello, taglia e dettagli.',true,'digitale'),
('promo','promo','Anteprima collezione 2027','Vedi la nuova collezione Adria prima di tutte, in anteprima riservata.',true,'digitale'),
('promo','promo','Confezione regalo di lusso','La confezione regalo Adria con biglietto scritto a mano, per il tuo prossimo ordine.',true,'digitale'),
('promo','promo','Atelier Care','Un ritocco o una riparazione gratuita su un tuo costume Adria, curata dalle nostre mani.',true,'digitale'),
('promo','promo','Priorità Summer Start','Il tuo nome in cima alla lista per la partenza dell''estate 2027, con le prime consegne.',true,'digitale')
on conflict (category, title) do nothing;

-- Fotografie: aggiungile con una riga per foto (vedi README, passo "Foto").
-- insert into prizes (category, type, title, body, image_url)
-- values ('foto','foto','Scatto dal mare','Un ricordo d''estate firmato Adria.','img/foto-01.jpg');
