# La mia agenda

Agenda personale (abitudini, attività, obiettivi) su tre livelli: giorno, settimana, mese.
L'utente è uno studente universitario italiano. Rispondi sempre in italiano, in modo semplice:
non dare per scontato che conosca la programmazione e spiega cosa stai per fare prima di farlo.

## Come è fatta

- `index.html`: la pagina (struttura e stile). Nessun build step, nessun framework.
- `app.js`: tutta la logica (livelli Giorno / Settimana / Mese a widget, pannelli, login, salvataggio).
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
- `_prova/` (esclusa da git): anteprime e prove locali con un finto Supabase (`build.sh`,
  `build-artifact.sh` per l'anteprima privata su claude.ai senza chiavi).

Pubblicata come sito statico su GitHub Pages; i dati stanno su Supabase.

## Interfaccia (a widget)

- **Principio:** su iPhone (390 × 844) ogni livello sta in una schermata senza scorrere
  (scorrere è ammesso solo sotto 720 px di altezza, es. iPhone SE). Il widget mostra
  un'anteprima; toccandolo si apre un **pannello dal basso** con la funzione completa.
- **Cornice uguale per i tre livelli** (`shellHead` in `app.js`): data piccola + titolo grande,
  pulsanti rotondi **⋯** (Impostazioni) e **+** (Aggiungi attività, da qualsiasi livello);
  sotto, il selettore **Giorno / Settimana / Mese** (route `#oggi`, `#settimana`, `#mese`) con
  la data di riferimento. In Settimana e Mese, frecce ‹ › e "oggi" accanto alla data.
- **Griglia a 2 colonne** (`.board.<livello>` con `grid-template-areas` in `index.html`):
  piccolo 1×1, largo 2×1, alto 1×2, grande 2×2 (solo il Calendario).
- **Giorno** (`viewGiorno`): Abitudini (largo, cerchi spuntabili dal widget), Agenda (alto,
  linea "adesso", passati barrati), Priorità (piccolo, spuntabili), In sospeso (piccolo,
  contatore), Prepara domani (largo basso, in evidenza dalle 19 finché le priorità non sono 3).
- **Settimana** (`viewSett`): Abitudini (griglia pallini, prime 3 + "+N", percentuale),
  Giorni (alto, impegno principale per giorno: `mainOf`), Allenamenti (fatti/previsti da piano
  in config.js + abitudine `allen`), Prima o poi, Review della settimana (checklist; spunte
  salvate SOLO nel telefono in localStorage `agenda-review-<lunedì>`).
- **Mese** (`viewMese`): Calendario 2×2 (sfondo più scuro = più abitudini, oggi nero, un
  segno per attività inserita (`dayMarks`: pallino = impegno, lineetta = scadenza aperta, max 4
  e poi "+"; gli impegni fissi non contano), tocco = pannello del giorno), Scadenze (del mese + in arrivo), Obiettivi
  (spuntabili), Statistiche (barre per abitudine), Impegni fissi (riassunto da config.js).
- **Pannelli** (`sheetView`, `panelBody`, `panelSub`): si fermano sotto il selettore, che
  resta visibile; si chiudono con ✕, tocco fuori, Esc, trascinando in giù; cambiare livello
  li chiude. Animazioni spente con "Riduci movimento".
- **Impostazioni (⋯):** tema Automatico / Chiaro / Scuro (localStorage `agenda-tema`, imposta
  `data-theme` su `<html>`), promemoria (attiva / notifica di prova), backup, esci, versione.

## Promemoria serale (notifiche push)

- Ogni sera alle **21:30 ora italiana**: "Prepara domani" con il numero di attività in sospeso,
  oppure, se le priorità di domani sono già scritte, un promemoria per le abitudini.
- Nell'app: nelle Impostazioni (⋯) "Attiva promemoria" (con un pallino sul ⋯ finché non
  sono attivi) e "Invia notifica di prova". Su iPhone funziona solo aprendo l'agenda
  dall'icona Home (iOS 16.4+).
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
- Riorganizzazione (`dayPlan` in `app.js`), solo calcolata e mai salvata:
  - attività senza ora di fine: durata stimata (`trainingDur` per area sport, altrimenti
    `defaultDur`); le scadenze senza fine non occupano tempo;
  - impegno fisso spostabile sovrapposto (allenamenti, `move: true`): va nel buco libero più
    vicino dentro `planner.from`–`planner.to`; il laboratorio non si sposta ma viene segnato;
  - università (`fitUni`): l'arrivo slitta se l'inizio è coperto, l'uscita anticipata è segnalata;
    le attività di area `uni` non sono in conflitto con l'università;
  - rientro a casa (`fitReturn`, calcolato per ultimo): slitta alla fine degli impegni che seguono
    entro 30 minuti; sparisce se l'università è saltata o se si finisce dopo mezzanotte.

## Regole

- Non cambiare le chiavi delle abitudini già in uso (si perderebbe lo storico).
- Non mettere mai la chiave `service_role` di Supabase nei file del sito: solo la chiave anon.
- La chiave privata VAPID e qualsiasi altro segreto non vanno MAI nel repository: solo nei
  segreti di Supabase (o, temporaneamente, in `.segreti/`, che è esclusa da git).
- Prima di modifiche alla struttura del database, scrivi la migrazione SQL in
  `supabase/` e spiega all'utente dove incollarla.
- Dopo una modifica, ricorda all'utente di fare commit e push per aggiornare il sito.
- A ogni pubblicazione che cambia `app.js` o `config.js`, aumenta la versione in **tre punti
  uguali**: `VERSION` in `app.js` e i due `?v=` in `index.html`. Senza, l'iPhone può continuare
  a usare i file vecchi (la versione è mostrata in fondo alla pagina per controllarla).
- Stile **monocromatico** (nero, bianco, grigi; nessun colore, nemmeno per le aree): il nero
  pieno `--solid` è riservato a cose fatte, linea "adesso", giorno di oggi, contatori e
  pulsanti principali. Widget, selettore, pulsanti rotondi e pannelli in **vetro**
  (sfondo semitrasparente + `backdrop-filter: blur`, bordo chiaro, riflesso in alto, ombra
  morbida, angoli ~24px) su sfondo grigio sfumato. Font Inter. Tutti i colori sono variabili in
  `:root`, ridefinite per il tema scuro sia in `prefers-color-scheme: dark` sia in
  `[data-theme=dark]`. Bersagli tattili ≥ 44px; margini con `env(safe-area-inset-*)`.
- Prima di pubblicare un cambio d'interfaccia, verifica che i tre livelli stiano in una
  schermata a 390 × 844 e 375 × 812, in chiaro e in scuro (anteprima in `_prova/`), **anche
  simulando i margini dell'iPhone** (padding di `.shell` + 47/34 px e + 50/34 px): nel browser sono zero.

## Idee per il futuro (agenti)

- Review della domenica: leggere le abitudini della settimana da Supabase,
  riassumere cosa ha funzionato e proporre la settimana successiva.
- Briefing serale: in parte fatto (notifica delle 21:30 + riquadro "Prepara domani" dopo le 19);
  si potrebbero aggiungere al testo gli impegni fissi di domani.
