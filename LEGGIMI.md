# La mia agenda: come metterla online (versione tua, fuori da Claude)

Tempo totale: circa 30–40 minuti, una volta sola.
Alla fine avrai un sito tuo, un database tuo con login, e l'app sulla schermata Home dell'iPhone.

---

## 0. Prepara la cartella

Scompatta lo zip in una cartella facile da trovare, per esempio `Documenti/agenda`.
Dentro trovi:

| File | A cosa serve |
|---|---|
| `index.html`, `app.js` | l'app |
| `config.js` | la tua settimana tipo + i dati di collegamento a Supabase |
| `supabase/schema.sql` | crea le tabelle del database |
| `CLAUDE.md` | le istruzioni che Claude Code legge da solo quando apri la cartella |
| `icon.png` | l'icona sulla schermata Home |

## 1. Crea il database su Supabase (10 minuti)

1. Vai su **supabase.com** e crea un account gratuito (anche con GitHub).
2. **New project**: nome `agenda`, scegli una password per il database (salvala da qualche parte)
   e una regione in Europa.
3. Quando il progetto è pronto apri **SQL Editor → New query**, incolla tutto il contenuto di
   `supabase/schema.sql` e premi **Run**. Deve comparire "Success".
4. Apri **Project Settings → API** (in alcune versioni: *Data API* / *API Keys*) e copia:
   - **Project URL**
   - la chiave **anon / publishable** (NON la `service_role` / secret)
5. Incollali in `config.js` al posto di `INCOLLA_QUI_URL_SUPABASE` e `INCOLLA_QUI_CHIAVE_ANON`.
6. Facoltativo ma comodo: in **Authentication → Sign In / Providers → Email** disattiva
   *Confirm email*, così crei l'account senza dover cliccare il link nell'email.

## 2. Installa Claude Code (5 minuti)

Apri il Terminale (Mac) o PowerShell (Windows) e incolla:

- **Mac:** `curl -fsSL https://claude.ai/install.sh | bash`
- **Windows (PowerShell):** `irm https://claude.ai/install.ps1 | iex`

Chiudi e riapri il terminale, poi scrivi `claude --version`: se esce un numero, è installato.
Se preferisci non usare il terminale esiste anche l'app desktop di Claude Code.

## 3. Pubblica il sito con Claude Code (10–15 minuti)

Nel terminale entra nella cartella e avvia Claude Code:

```
cd ~/Documents/agenda
claude
```

Al primo avvio ti chiede di accedere. Poi incolla questo messaggio:

> Ciao! Leggi CLAUDE.md e LEGGIMI.md. Voglio pubblicare questa agenda su GitHub Pages.
> Guidami passo passo: controlla se ho git e la GitHub CLI (gh) e aiutami a installarli
> se mancano, fammi fare il login su GitHub, crea il repository "agenda", fai il primo
> commit e push e attiva GitHub Pages. Prima di ogni comando spiegami in due parole cosa fa.

Claude Code ti chiederà il permesso prima di eseguire i comandi: leggi e approva.
Alla fine ti darà un indirizzo tipo `https://tuonome.github.io/agenda/`.

**Nota sulla privacy:** con GitHub gratuito il repository di GitHub Pages è pubblico. Si vedono il
codice e la tua settimana tipo (`config.js`), mai i tuoi dati (abitudini, attività), che restano
su Supabase dietro login. Se vuoi tenere privato anche `config.js`, chiedi a Claude Code di
pubblicare da un repository privato su Netlify o Cloudflare Pages (gratuiti anche loro).

## 4. Primo accesso e iPhone

1. Apri l'indirizzo, tocca **Prima volta? Crea l'account**, inserisci email e password.
2. Su Supabase, in **Authentication**, disattiva la registrazione di nuovi utenti
   (*Allow new users to sign up*): così nessun altro può crearsi un account sulla tua app.
3. Sull'iPhone apri l'indirizzo in **Safari** → **Condividi** → **Aggiungi alla schermata Home**,
   poi accedi con le stesse credenziali.

## 5. Modifiche future

Apri la cartella, avvia `claude` e chiedi in italiano, per esempio:

- "Sposta la palestra del lunedì alle 7:00"
- "Aggiungi l'abitudine 'Leggere 15 minuti'"
- "Il laboratorio finisce il 18 dicembre"

Claude Code modifica i file; poi gli chiedi "fai commit e push" e dopo un minuto il sito è aggiornato.

## 6. Backup

In fondo a ogni pagina c'è **Scarica backup**: salva tutti i tuoi dati in un file `.json`.
