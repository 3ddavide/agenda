// Configurazione dell'agenda.
// 1) Incolla qui URL e chiave "anon / publishable" del tuo progetto Supabase
//    (Supabase → Project Settings → API). La chiave anon è pensata per stare
//    nel browser: i dati sono protetti dalle regole RLS in supabase/schema.sql.
// 2) Tutto il resto è la tua settimana tipo: modificalo qui (o chiedi a Claude Code).

window.AGENDA_CONFIG = {
  supabaseUrl: "https://mpzyrywlzsacjnnlhxed.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wenlyeXdsenNhY2pubmxoeGVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxODA2MjAsImV4cCI6MjExMDc1NjYyMH0.aVOkHXrcb0DMSEQ30djPHNi2tmrKDamjdhlCZMAXytA",

  // Abitudini: la chiave (k) non va cambiata dopo che hai iniziato a usarle,
  // altrimenti lo storico di quella abitudine non viene più mostrato.
  habits: [
    { k: "sveglia", label: "Alzarsi alla sveglia" },
    { k: "spese", label: "Niente spese inutili" },
    { k: "medit", label: "Meditazione" },
    { k: "allen", label: "Allenamento" },
    { k: "cibo", label: "Cibo pulito" }
  ],

  // Università: giorni (0 = domenica, 1 = lunedì … 6 = sabato) e orari.
  uni: { days: [1, 2, 3, 4, 5], start: "09:00", end: "20:00" },

  // Riorganizzazione automatica della giornata: se aggiungi un'attività con orario di
  // inizio e fine che si sovrappone a un impegno spostabile (allenamenti, impegni con
  // move: true), l'app lo sposta nel buco libero più vicino tra "from" e "to".
  // trainingDur / defaultDur = durata in minuti quando non c'è un orario di fine.
  planner: { from: "07:00", to: "22:30", step: 15, trainingDur: 90, defaultDur: 60 },

  // Allenamenti per giorno della settimana. t = orario, null = riposo.
  // Facoltativi: dur = durata in minuti, move: false = non spostarlo mai.
  training: {
    0: { name: "Corsa", t: "10:00" },
    1: { name: "Palestra", t: "20:30" },
    2: { name: "Corsa", t: "07:30" },
    3: { name: "Riposo", t: null },
    4: { name: "Palestra", t: "20:30" },
    5: { name: "Palestra", t: "20:30" },
    6: { name: "Palestra (facoltativa)", t: "10:00" }
  },

  // Impegni ricorrenti.
  // - weekdays: giorni della settimana; oppure everyDays + anchor (data di partenza)
  // - from / to: periodo di validità (facoltativi, formato AAAA-MM-GG)
  // - area: uni | sport | lavoro | pers | eventi
  // - end o dur (minuti): quanto dura; move: true = si può spostare se serve
  recurring: [
    { name: "Laboratorio di urbanistica", weekdays: [2, 3], t: "14:00", end: "19:30", area: "uni", from: "2026-09-01", to: null },
    { name: "Pulizia della camera", everyDays: 14, anchor: "2026-11-21", t: "11:30", dur: 60, area: "pers", move: true }
  ]
};
