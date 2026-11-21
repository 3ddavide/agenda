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

Pubblicata come sito statico su GitHub Pages; i dati stanno su Supabase.

## Modello dei dati

- `days` (chiave `user_id` + `date`): `h` = oggetto JSON abitudine → true/false
  (chiavi come in `config.js` → `habits[].k`), `top` = 3 priorità, `topd` = 3 booleani.
- `tasks`: attività singole con `date`, `time` ("HH:MM" o vuoto), `end_time` (fine fascia), `area`
  (`uni` | `sport` | `lavoro` | `pers` | `eventi`), `dl` (scadenza), `done`.
- `goals`: obiettivi del mese con `month` ("AAAA-MM").
- Gli impegni fissi (università, laboratorio, allenamenti, pulizia camera) NON sono nel
  database: vengono calcolati da `config.js` ogni volta che si apre l'app.
- Riorganizzazione (`dayPlan` in `app.js`): se un'attività con fascia oraria si sovrappone a un
  impegno fisso spostabile (allenamenti, `move: true`), questo va nel buco libero più vicino
  dentro `planner.from`–`planner.to`; università e laboratorio non si spostano ma vengono segnati.

## Regole

- Non cambiare le chiavi delle abitudini già in uso (si perderebbe lo storico).
- Non mettere mai la chiave `service_role` di Supabase nei file del sito: solo la chiave anon.
- Prima di modifiche alla struttura del database, scrivi la migrazione SQL in
  `supabase/` e spiega all'utente dove incollarla.
- Dopo una modifica, ricorda all'utente di fare commit e push per aggiornare il sito.
- Lo stile è volutamente semplice: una colonna, tre schede, pochi colori
  (blu `--acc` dominante, colori delle aree solo nei pallini).

## Idee per il futuro (agenti)

- Review della domenica: leggere le abitudini della settimana da Supabase,
  riassumere cosa ha funzionato e proporre la settimana successiva.
- Briefing serale: le 3 priorità di domani e gli impegni fissi.
