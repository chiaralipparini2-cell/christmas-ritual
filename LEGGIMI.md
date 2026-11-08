# Calendario dell'Avvento · Adria Beachwear

Sito statico (si pubblica gratis su GitHub Pages) + database gratuito su Supabase.
Ogni cliente si registra con email e password e ha un calendario tutto suo,
con 25 caselle sorteggiate dal server. Le caselle si aprono dal 1° al 25 dicembre, secondo l'ora italiana del server.

## Come funziona il sorteggio
- Ogni calendario ha 25 caselle: **2 "premio"**, **8 foto**, **5 promo speciali**, le altre solo frase.
  Ogni casella contiene sempre la frase del giorno (condivisibile come immagine per Instagram).
- Le caselle "premio" estraggono dalle scorte: buoni, palline, Salotto, collanine, kit capelli, copricapo, pantaloni, completi.
  Massimo 2 premi per cliente, mai due dello stesso tipo. Il Salotto esce solo a chi ha scelto Emilia-Romagna.
- Le scorte sono distribuite nei 25 giorni (il sistema sa quante clienti aspetta) e non diventano negative.
- Finché non carichi le foto, le caselle "foto" mostrano solo la frase.
- Per i premi richiedibili la cliente preme il tasto: si apre la sua email già scritta, con un **codice personale** (ADRIA-XXXX-XXXX).

## Pubblicazione, passo per passo

Il sito **non manda nessuna email**: la cliente sceglie una password quando si registra. Per questo non serve Resend o altri servizi di posta.

### 1. Database (Supabase)
1. Crea un account su supabase.com, poi **New project**. Scegli la regione **Europe (Frankfurt)** e salva la password del database.
2. Menu **SQL Editor** > New query > incolla tutto `supabase/schema.sql` > **Run**. Puoi rieseguirlo senza perdere dati.
3. **Authentication > Sign In / Providers > Email**: lascia l'email attiva e **disattiva "Confirm email"**. Così la registrazione non invia nulla.
4. **Project Settings > API**: copia *Project URL* e la chiave *anon public*. Non usare mai la *service_role*.

### 2. Il tuo accesso all'area riservata
1. **Authentication > Users > Add user > Create new user**: email `info@adriabeachwear.com`, una password tua, spunta *Auto Confirm User*.
2. Fallo **prima** di pubblicare il sito. Poi, nel SQL Editor:
```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"adria_admin"}'
where email = 'info@adriabeachwear.com';
```
3. Per altri accessi admin, stessa cosa con un'altra email.

### 3. Sito (GitHub Pages)
1. Apri `assets/config.js` e incolla *Project URL* e *anon key*.
2. Su github.com crea un repository (es. `avvento`) e carica **tutto il contenuto** di questa cartella (compresa `.nojekyll`).
3. **Settings > Pages**: *Deploy from a branch*, branch `main`, cartella `/ (root)`. Dopo un minuto il sito è online all'indirizzo che GitHub mostra.

### 4. Prove prima del lancio
Nel SQL Editor, per fingere che oggi sia un altro giorno: `update settings set debug_today = '2026-12-10';`
Registrati, apri caselle, richiedi un regalo, condividi la frase e guarda `admin.html`.
**Prima del lancio ripristina tutto** (una riga alla volta):
```sql
update settings set debug_today = null;
delete from auth.users where email <> 'info@adriabeachwear.com';   -- cancella le utenti di prova
update prizes set stock_left = stock where stock is not null;       -- ripristina le scorte
```

## Password dimenticata
Non c'è recupero automatico, perché non mandiamo email. La cliente tocca "Scrivici" nella pagina di accesso, tu le imposti una nuova password dal SQL Editor e gliela comunichi:
```sql
update auth.users
set encrypted_password = extensions.crypt('NuovaPassword123', extensions.gen_salt('bf'))
where email = 'email.della.cliente@esempio.it';
```

## Gestione
- **Area riservata**: `admin.html`, accesso con la tua email e password (vedi punto 2). Mostra scorte, richieste e codici;
  cerca un codice, vedi chi è e cosa ha vinto, premi "Segna come evasa" quando hai spedito.
- **Cambiare le scorte** (anche a calendario partito):
  `update prizes set stock = 12, stock_left = stock_left + 4 where type = 'buono';`
- **Clienti attese** (serve a distribuire le scorte): `update settings set expected_clients = 40;`
- **Quanti premi per calendario** (vale per le nuove iscritte): `update settings set special_slots = 3;`
- **Aggiungere fotografie**: metti i file in `img/` (es. `foto-01.jpg`, meglio sotto 400 KB) e per ognuno:
  `insert into prizes (category, type, title, body, image_url) values ('foto','foto','Titolo','Testo breve','img/foto-01.jpg');`
  Per vederle in tutte le caselle foto servono almeno 8 foto diverse, altrimenti qualche casella resta senza.
- **Modificare frasi o testi dei premi**: tabella `phrases` e `prizes` (Table Editor di Supabase, modifichi direttamente).

## Da completare prima di pubblicare
- `privacy.html` e `regolamento.html` sono bozze con i campi gialli da compilare: fai verificare dal tuo commercialista,
  anche per la normativa sui concorsi a premio. Poi cancella i riquadri gialli.
- Le promo speciali nel database (`prizes`, categoria `promo`) sono idee da confermare. Le condizioni di buoni e promo
  (scadenza, spesa minima) le comunichi tu nella risposta alla richiesta.
- Il piano gratuito di Supabase mette in pausa il progetto dopo circa una settimana senza visite: apri il sito ogni tanto
  prima del lancio e, per sicurezza, controlla la dashboard.
