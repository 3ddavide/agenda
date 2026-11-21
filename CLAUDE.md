# La mia agenda

Agenda personale (abitudini, attività, obiettivi) su tre livelli: giorno, settimana, mese.
L'utente è uno studente universitario italiano. Rispondi sempre in italiano, in modo semplice:
non dare per scontato che conosca la programmazione e spiega cosa stai per fare prima di farlo.

## Come è fatta

- `index.html`: la pagina (struttura e stile). Nessun build step, nessun framework.
- `app.js`: tutta la logica (viste Oggi / Settimana / Mese, login, salvataggio).
- `config.js`: la settimana tipo dell'utente (abitudini, orari università, allenamenti,
  impegni ricorrenti) più URL e chiave anon di Supabase. **Per cambiare orari o abitudini
  si modifica solo questo file.**
- `supabase/schema.sql`: tabelle `days`, `tasks`, `goals` con Row Level Security
  (ogni utente vede solo le proprie righe).
- `icon.png`: icona per la schermata Home dell'iPhone.
- `manifest.webmanifest` (display standalone, percorsi relativi `./`) e `sw.js` (service worker:
  mostra le notifiche push e apre l'app al tocco; volutamente SENZA cache, così ogni push su
  GitHub arriva subito).
- `supabase/functions/promemoria/index.ts`: Edge Function che invia la notifica serale
  (cifratura Web Push RFC 8291 e firma VAPID scritte a mano con WebCrypto, nessuna libreria).
  Si incolla dal sito di Supabase (Edge Functions → editor) con **Verify JWT disattivato**:
  l'autorizzazione è dentro la funzione.
- `supabase/migrazione_*.sql`: migrazioni già eseguite dall'utente, in ordine di creazione.
- `.segreti/` (esclusa da git con `.gitignore`): file locali con segreti, mai da pubblicare.

Pubblicata come sito statico su GitHub Pages; i dati stanno su Supabase.

## Promemoria serale (notifiche push)

- Ogni sera alle **21:30 ora italiana**: "Prepara domani" con il numero di attività in sospeso,
  oppure, se le priorità di domani sono già scritte, un promemoria per le abitudini.
- Nell'app: riquadro "Attiva promemoria" in Oggi (solo se non attivi) e "Invia notifica di
  prova" nel fondo pagina. Su iPhone funziona solo aprendo l'agenda dall'icona Home (iOS 16.4+).
- Chiave VAPID **pubblica** in `config.js` (`vapidPublicKey`) e in `index.ts` (devono coincidere);
  la **privata** SOLO nel segreto `VAPID_PRIVATE_KEY` di Supabase (Edge Functions → Secrets).
- Programmazione (`supabase/migrazione_promemoria_cron.sql`): pg_cron lavora in UTC, quindi due
  job (19:30 e 20:30 UTC) chiamano la funzione con `{"mode":"cron"}`; la funzione invia solo se
  in Italia sono le 21 → una notifica al giorno, anche al cambio dell'ora legale.
- La chiamata da pg_cron è protetta dall'intestazione `x-cron-secret`: il codice è generato nel
  Vault (`promemoria_cron`) e letto con `public.promemoria_secret()` (solo `service_role`).
- `{"mode":"test"}` (pulsante di prova) richiede il login dell'utente e invia solo a lui.
- Iscrizioni scadute (risposta 404/410 da Apple) vengono cancellate da `push_subs`.

## Modello dei dati

- `days` (chiave `user_id` + `date`): `h` = oggetto JSON abitudine → true/false
  (chiavi come in `config.js` → `habits[].k`), `top` = 3 priorità, `topd` = 3 booleani,
  `fx` = impegni fissi cambiati solo quel giorno (`{"train": {"skip": true}, "rec:<nome>": {"t": "HH:MM"}}`).
  Le chiavi `rec:` usano il `name` (o `id`) dell'impegno in `config.js`: rinominarlo fa perdere le modifiche.
- `tasks`: attività singole con `date`, `time` ("HH:MM" o vuoto), `end_time` (fine fascia), `area`
  (`uni` | `sport` | `lavoro` | `pers` | `eventi`), `dl` (scadenza), `done`.
  `date` vuota = elenco "Prima o poi" (vista Settimana).
- `goals`: obiettivi del mese con `month` ("AAAA-MM").
- `push_subs` (chiave `endpoint`): iscrizioni alle notifiche push del telefono
  (`user_id`, `p256dh`, `auth`), con RLS come le altre tabelle.
- Gli impegni fissi (università, laboratorio, allenamenti, pulizia camera) NON sono nel
  database: vengono calcolati da `config.js` ogni volta che si apre l'app.
- Riorganizzazione (`dayPlan` in `app.js`): se un'attività con fascia oraria si sovrappone a un
  impegno fisso spostabile (allenamenti, `move: true`), questo va nel buco libero più vicino
  dentro `planner.from`–`planner.to`; università e laboratorio non si spostano ma vengono segnati.

## Regole

- Non cambiare le chiavi delle abitudini già in uso (si perderebbe lo storico).
- Non mettere mai la chiave `service_role` di Supabase nei file del sito: solo la chiave anon.
- La chiave privata VAPID e qualsiasi altro segreto non vanno MAI nel repository: solo nei
  segreti di Supabase (o, temporaneamente, in `.segreti/`, che è esclusa da git).
- Prima di modifiche alla struttura del database, scrivi la migrazione SQL in
  `supabase/` e spiega all'utente dove incollarla.
- Dopo una modifica, ricorda all'utente di fare commit e push per aggiornare il sito.
- Lo stile è volutamente semplice: una colonna, tre schede, pochi colori
  (blu `--acc` dominante, colori delle aree solo nei pallini).

## Idee per il futuro (agenti)

- Review della domenica: leggere le abitudini della settimana da Supabase,
  riassumere cosa ha funzionato e proporre la settimana successiva.
- Briefing serale: in parte fatto (notifica delle 21:30 + riquadro "Prepara domani" dopo le 19);
  si potrebbero aggiungere al testo gli impegni fissi di domani.
