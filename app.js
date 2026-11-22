// La mia agenda: logica dell'app.
// Dati: Supabase (tabelle days, tasks, goals). Settimana tipo: config.js.
{
const C = window.AGENDA_CONFIG || {};
const HAB = (C.habits || []).map(h => [h.k, h.label]);
const AREE = { uni: 'Università', sport: 'Sport', lavoro: 'Lavoro', pers: 'Personale', eventi: 'Eventi' };
const TRAIN = C.training || {};
const UNI = C.uni || { days: [], start: '', end: '' };
const REC = C.recurring || [];
const GG = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
const GS = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
const MM = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];

const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addD = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const monday = d => addD(d, -((d.getDay() + 6) % 7));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const PL = { from: '07:00', to: '22:30', step: 15, trainingDur: 90, defaultDur: 60, ...(C.planner || {}) };
const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const toHM = n => pad(Math.floor(n / 60)) + ':' + pad(n % 60);
const overlaps = (a, b) => a.rs < b.re && b.rs < a.re;
const plan = w => TRAIN[w] || { name: 'Riposo', t: null };
const isRest = w => !plan(w).t;

const S = { days: {}, tasks: {}, goals: {} };
let sb = null, user = null, weekOff = 0, monthOff = 0, selDay = null, pending = false, lastDel = null, signup = false;
let sheet = null;   // modulo aperto: { kind: 'task', id } oppure { kind: 'fx', ds, k }
let pushState = 'unknown';   // promemoria: unknown | unsupported | denied | off | on
const app = document.getElementById('app'), note = document.getElementById('note');
const toast = document.getElementById('toast'), tmsg = document.getElementById('tmsg'), tundo = document.getElementById('tundo');
const CACHE = 'agenda-cache-v1';
// Versione mostrata in fondo alla pagina: aggiornala insieme ai "?v=" in index.html a ogni pubblicazione.
const VERSION = '2026-11-22.1';
const chain = {};

function flash(msg, undo, ms) { tmsg.textContent = msg; tundo.hidden = !undo; toast.classList.add('show'); clearTimeout(flash.t); flash.t = setTimeout(() => toast.classList.remove('show'), ms || (undo ? 5000 : 1800)); }
function cacheSave() { try { localStorage.setItem(CACHE, JSON.stringify(S)); } catch (e) {} }
function cacheLoad() { try { const v = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (v) for (const k of ['days', 'tasks', 'goals']) S[k] = v[k] || {}; } catch (e) {} }

// ---------- Database ----------
const KEY = { days: 'date', tasks: 'id', goals: 'id' };
function toRow(col, id, v) {
  const base = { user_id: user.id };
  if (col === 'days') return { ...base, date: id, h: v.h || {}, top: v.top || null, topd: v.topd || null, fx: v.fx && Object.keys(v.fx).length ? v.fx : null };
  if (col === 'tasks') return { ...base, id, title: v.title, date: v.date || null, time: v.time || null, end_time: v.end || null, area: v.area || 'pers', dl: !!v.dl, done: !!v.done };
  return { ...base, id, title: v.title, month: v.month, area: v.area || 'pers', done: !!v.done };
}
async function write(col, id, val) {
  const q = sb.from(col);
  const r = val === null
    ? await q.delete().eq(KEY[col], id)
    : await q.upsert(toRow(col, id, val), { onConflict: col === 'days' ? 'user_id,date' : 'id' });
  if (r.error) throw r.error;
}
function put(col, id, val, quiet) {
  if (val === null) delete S[col][id]; else S[col][id] = val;
  if (!quiet) render(true);
  cacheSave();
  const k = col + '/' + id;
  chain[k] = (chain[k] || Promise.resolve()).then(() => write(col, id, val)).catch(e => { console.error(e); flash('Non salvato: controlla la connessione'); });
}
function setDay(ds, patch, quiet) { put('days', ds, { ...(S.days[ds] || {}), ...patch }, quiet); }

async function loadAll() {
  const res = await Promise.all(['days', 'tasks', 'goals'].map(c => sb.from(c).select('*').limit(5000)));
  const bad = res.find(r => r.error);
  if (bad) { note.textContent = 'Non riesco a leggere i dati (' + bad.error.message + ').'; return; }
  const [d, t, g] = res.map(r => r.data);
  S.days = Object.fromEntries(d.map(r => [r.date, { h: r.h || {}, ...(r.top ? { top: r.top } : {}), ...(r.topd ? { topd: r.topd } : {}), ...(r.fx ? { fx: r.fx } : {}) }]));
  S.tasks = Object.fromEntries(t.map(r => [r.id, { title: r.title, date: r.date, time: r.time || '', end: r.end_time || '', area: r.area, dl: r.dl, done: r.done }]));
  S.goals = Object.fromEntries(g.map(r => [r.id, { title: r.title, month: r.month, area: r.area, done: r.done }]));
  note.textContent = '';
  cacheSave();
  render();
}

// ---------- Promemoria (notifiche push) ----------
// L'iPhone le permette solo se l'agenda è aperta dall'icona sulla schermata Home (iOS 16.4+).
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!C.vapidPublicKey;
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function saveSub(sub) {
  const j = sub.toJSON();
  const r = await sb.from('push_subs').upsert({ endpoint: j.endpoint, user_id: user.id, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
  if (r.error) throw r.error;
}
async function pushInit() {
  if (pushInit.started) return;
  pushInit.started = true;
  if (!pushOk()) { pushState = 'unsupported'; render(); return; }
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const sub = await reg.pushManager.getSubscription();
    if (Notification.permission === 'denied') pushState = 'denied';
    else if (sub && Notification.permission === 'granted') { pushState = 'on'; await saveSub(sub); }
    else pushState = 'off';
  } catch (e) { console.error(e); if (pushState === 'unknown') pushState = 'off'; }
  render();
}
async function pushOn() {
  const perm = await Notification.requestPermission();   // deve partire subito dal tocco sul pulsante
  if (perm !== 'granted') { pushState = perm === 'denied' ? 'denied' : 'off'; render(true); flash('Notifiche non consentite'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(C.vapidPublicKey) });
    await saveSub(sub);
    pushState = 'on'; render(true); flash('Promemoria attivati: ogni sera alle 21:30');
  } catch (e) { console.error(e); flash('Attivazione non riuscita: ' + String((e && (e.message || e.name)) || e).slice(0, 90), false, 8000); }
}
async function pushTest() {
  flash('Invio in corso…');
  const { data, error } = await sb.functions.invoke('promemoria', { body: { mode: 'test' } });
  if (error) { console.error(error); flash('Prova non riuscita: ' + String(error.message || error).slice(0, 90), false, 8000); return; }
  if (data && data.errors && data.errors.length && !data.sent) { flash('Prova non riuscita: ' + String(data.errors[0]).slice(0, 90), false, 8000); return; }
  flash(data && data.sent ? 'Inviata: arriva tra pochi secondi' : 'Nessun dispositivo iscritto');
}
// Riquadro visibile finché i promemoria non sono attivi (con la spiegazione se non si può).
function pushCard() {
  if (pushState === 'on' || pushState === 'unknown') return '';
  const inSafari = /iPhone|iPad/.test(navigator.userAgent) && navigator.standalone === false;
  const why = pushState === 'denied' ? 'Le notifiche sono bloccate: riattivale in Impostazioni → Notifiche → Agenda, poi riapri l’app.'
    : pushState === 'unsupported' ? (inSafari ? 'Sei in Safari: apri l’agenda dall’icona sulla schermata Home per attivarli.'
      : 'Qui le notifiche non sono disponibili. Su iPhone servono iOS 16.4 o successivo e l’agenda aperta dall’icona sulla schermata Home.') : '';
  return `<section class="card"><h2>Promemoria serale</h2><p class="sub">Ogni sera alle 21:30 una notifica con le attività in sospeso e le priorità di domani.</p>
  ${why ? `<p class="hint">${why}</p>` : '<div class="row"><button class="primary" data-act="pushon">Attiva promemoria</button></div>'}</section>`;
}

// ---------- Agenda ----------
function recurringOn(d) {
  const ds = iso(d), w = d.getDay(), out = [];
  for (const r of REC) {
    if (r.from && ds < r.from) continue;
    if (r.to && ds > r.to) continue;
    let hit = false;
    if (r.weekdays) hit = r.weekdays.includes(w);
    else if (r.everyDays && r.anchor) { const gap = Math.round((parse(ds) - parse(r.anchor)) / 864e5); hit = gap >= 0 && gap % r.everyDays === 0; }
    if (!hit) continue;
    const x = { t: r.t || '', e: r.end || '', n: r.name, a: r.area || 'pers', fx: 1, mv: !!r.move, k: 'rec:' + (r.id || r.name) };
    if (r.t) { x.rs = toMin(r.t); x.re = r.end ? toMin(r.end) : x.rs + (r.dur || PL.defaultDur); }
    out.push(override(x, ds));
  }
  return out;
}
// Modifiche "solo per questo giorno" salvate in days.fx: { chiave: { skip: true } | { t: "HH:MM" } }.
function override(x, ds) {
  x.t0 = x.t;
  const ov = S.days[ds]?.fx?.[x.k];
  if (!ov) return x;
  x.mv = false; x.ov = 1;
  if (ov.skip) { x.skip = true; x.why = 'Saltato solo per questo giorno'; }
  else if (ov.t && x.rs != null) {
    const len = x.re - x.rs, s = toMin(ov.t);
    x.why = 'Orario cambiato solo per questo giorno (di solito ' + x.t + ')';
    x.t = ov.t; x.rs = s; x.re = s + len; if (x.e) x.e = toHM(s + len);
  }
  return x;
}
function setFx(ds, k, val) {
  const fx = { ...(S.days[ds]?.fx || {}) };
  if (val) fx[k] = val; else delete fx[k];
  sheet = null; setDay(ds, { fx });
}
// Impegni fissi del giorno. rs / re = inizio e fine in minuti (servono per le sovrapposizioni).
function fixed(d) {
  const w = d.getDay(), out = [], uni = UNI.days.includes(w);
  if (uni) out.push({ t: UNI.start, n: 'Arrivo in università', a: 'uni', fx: 1, uni: 1, ...(UNI.start && UNI.end ? { rs: toMin(UNI.start), re: toMin(UNI.end) } : {}) });
  out.push(...recurringOn(d));
  if (!isRest(w)) { const p = plan(w), s = toMin(p.t); out.push(override({ t: p.t, n: p.name, a: 'sport', fx: 1, train: 1, k: 'train', mv: p.move !== false, rs: s, re: s + (p.dur || PL.trainingDur) }, iso(d))); }
  if (uni) out.push({ t: UNI.end, n: 'Rientro a casa', a: 'pers', fx: 1, uni: 1 });
  return out;
}
function tasksOn(ds) {
  return Object.entries(S.tasks).filter(([, t]) => t.date === ds).map(([id, t]) => {
    const x = { id, t: t.time || '', e: t.end || '', n: t.title, a: t.area || 'pers', done: !!t.done, dl: !!t.dl };
    if (x.t && x.e && x.e > x.t) { x.rs = toMin(x.t); x.re = toMin(x.e); }
    // Senza ora di fine la durata è stimata (le scadenze invece non occupano tempo).
    else if (x.t && !x.dl) { x.rs = toMin(x.t); x.re = x.rs + (x.a === 'sport' ? PL.trainingDur : PL.defaultDur); x.est = true; }
    return x;
  });
}
// Primo orario libero (il più vicino a "pref") in cui sta un impegno lungo "len" minuti.
function freeSlot(blocks, len, pref) {
  let best = null;
  for (let s = toMin(PL.from); s + len <= toMin(PL.to); s += PL.step) {
    if (blocks.some(b => overlaps({ rs: s, re: s + len }, b))) continue;
    if (best === null || Math.abs(s - pref) < Math.abs(best - pref)) best = s;
  }
  return best;
}
const GO_HOME_GAP = 30;   // minuti: se il prossimo impegno inizia prima, non si passa da casa
const names = list => list.map(b => b.n + (b.est ? ' (durata stimata)' : '')).join(', ');
// Accorcia l'università se altri impegni ne coprono l'inizio o la fine.
function fitUni(arrivo, out) {
  let start = arrivo.rs, end = arrivo.re;
  const before = [], after = [];
  for (let b; (b = out.find(b => b.rs <= start && b.re > start));) { start = b.re; before.push(b); }
  for (let b; (b = out.find(b => b.rs < end && b.re >= end));) { end = b.rs; after.push(b); }
  if (start >= end) { arrivo.skip = true; arrivo.why = 'Saltato per ' + names([...new Set([...before, ...after])]); return; }
  const why = [];
  if (before.length) { why.push(`Posticipato dalle ${arrivo.t} per ${names(before)}`); arrivo.t = toHM(start); }
  if (after.length) why.push(`Esci alle ${toHM(end)} per ${names(after)}`);
  arrivo.rs = start; arrivo.re = end;
  if (why.length) arrivo.why = why.join(' · ');
}
// Il rientro slitta alla fine di ciò che segue l'università; si elimina se non ha senso.
function fitReturn(rientro, arrivo, fx, busy) {
  if (arrivo.skip) { rientro.gone = true; return; }
  const others = fx.filter(x => x.rs != null && !x.uni && !x.skip);
  let home = toMin(rientro.t);
  const chain = [];
  for (;;) {
    // Lo fanno slittare solo attività e impegni spostati; una volta slittato, conta tutto ciò che segue.
    const list = [...busy, ...(chain.length ? others : others.filter(x => x.moved || x.ov))];
    const next = list.find(x => x.rs < home + GO_HOME_GAP && x.re > home);
    if (!next) break;
    home = next.re; chain.push(next);
  }
  if (!chain.length) return;
  if (home >= 24 * 60) { rientro.gone = true; return; }
  rientro.why = `Spostato dalle ${rientro.t} per ${names(chain)}`;
  rientro.t = toHM(home);
}
// La giornata completa: impegni fissi adattati alle attività con un orario.
function dayPlan(d) {
  const tasks = tasksOn(iso(d)), fx = fixed(d), busy = tasks.filter(x => x.rs != null);
  // Le attività di area Università si fanno lì: non sono in conflitto con l'università.
  const outside = busy.filter(x => x.a !== 'uni');
  const arrivo = fx.find(x => x.uni && x.rs != null), rientro = fx.find(x => x.uni && x.rs == null);
  if (arrivo) fitUni(arrivo, outside);
  // 1) Impegni fissi non spostabili (università, laboratorio): restano, ma segnalati.
  for (const x of fx) if (x.rs != null && !x.mv && !x.skip) {
    const c = (x.uni ? outside : busy).filter(b => overlaps(x, b));
    if (!c.length) continue;
    x.skip = c.some(b => b.rs <= x.rs && b.re >= x.re);
    x.why = (x.why ? x.why + ' · ' : '') + (x.skip ? 'Saltato per ' : 'Sovrapposto a ') + names(c);
  }
  // 2) Impegni spostabili (allenamenti, pulizia): se toccano un'attività, si spostano.
  const clash = x => busy.filter(b => overlaps(x, b));
  const toMove = fx.filter(x => x.rs != null && x.mv && !x.skip && clash(x).length);
  const blocks = [...busy, ...fx.filter(x => x.rs != null && !x.skip && !toMove.includes(x))];
  for (const x of toMove) {
    const c = clash(x), len = x.re - x.rs, s = freeSlot(blocks, len, x.rs);
    if (s === null) { x.skip = true; x.why = 'Saltato per ' + names(c) + ': nessun orario libero'; continue; }
    x.why = 'Spostato dalle ' + x.t + ' per ' + names(c);
    x.t = toHM(s); if (x.e) x.e = toHM(s + len); x.rs = s; x.re = s + len; x.moved = true;
    blocks.push(x);
  }
  // 3) Il rientro va calcolato per ultimo, quando gli altri orari sono definitivi.
  if (arrivo && rientro) fitReturn(rientro, arrivo, fx, busy);
  return [...fx.filter(x => !x.gone), ...tasks].sort((a, b) => (a.t || '99').localeCompare(b.t || '99'));
}
const trainOf = d => dayPlan(d).find(x => x.train) || null;
function countDay(ds) { const h = S.days[ds]?.h || {}; return HAB.filter(([k]) => h[k]).length; }
function pctDay(ds) { return HAB.length ? countDay(ds) / HAB.length : 0; }
function streak(k) {
  let d = new Date(), n = 0;
  if (!S.days[iso(d)]?.h?.[k]) d = addD(d, -1);
  while (S.days[iso(d)]?.h?.[k]) { n++; d = addD(d, -1); }
  return n > 1 ? n + ' giorni di fila' : '';
}

// Titolo di un'attività: toccandolo si apre il modulo di modifica.
const taskName = (id, title) => `<button class="nm lk" data-act="edit" data-id="${id}" aria-label="Modifica: ${esc(title)}">${esc(title)}</button>`;
function agenda(d) {
  const it = dayPlan(d);
  if (!it.length) return '<p class="empty">Niente in programma.</p>';
  // Passati (giorni prima di oggi, o già finiti oggi): barrati come nel widget.
  const ds = iso(d), now = new Date(), today = iso(now), nowMin = now.getHours() * 60 + now.getMinutes();
  const isPast = x => ds < today || (ds === today && !!x.t && (x.re != null ? x.re : toMin(x.t)) <= nowMin);
  const sub = x => x.why || (x.id ? AREE[x.a] || '' : x.fx ? 'impegno fisso' : '');
  return '<ul class="ag">' + it.map(x => `<li class="${x.done ? 'done' : ''}${x.skip ? ' skip' : ''}${isPast(x) ? ' past' : ''}">
    <span class="tm">${x.t ? esc(x.t) + (x.e ? '<small>' + esc(x.e) + '</small>' : '') : '—'}</span>
    <span class="dot ${esc(x.a)}"></span>
    <span class="tt${x.fx ? ' fx' : ''}">${x.dl ? '<span class="dl">Scadenza · </span>' : ''}${x.id ? taskName(x.id, x.n) : `<span class="nm">${esc(x.n)}</span>`}${sub(x) ? '<small class="why">' + esc(sub(x)) + '</small>' : ''}</span>
    ${x.id ? `<span class="acts"><button class="mini${x.done ? ' on' : ''}" data-act="done" data-id="${x.id}" aria-label="Segna come fatto">✓</button><button class="mini" data-act="del" data-id="${x.id}" aria-label="Elimina">×</button></span>`
      : x.k ? `<span class="acts"><button class="mini${x.ov ? ' ovr' : ''}" data-act="fx" data-d="${iso(d)}" data-k="${esc(x.k)}" aria-label="Opzioni per ${esc(x.n)}">⋯</button></span>` : '<span></span>'}
  </li>`).join('') + '</ul>';
}
const areaOpts = sel => Object.entries(AREE).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v}</option>`).join('');
function addForm(ds) {
  return `<form class="card" data-form="task"><h2>Aggiungi attività</h2>
  <input name="title" placeholder="Ripasso capitolo 4" required aria-label="Attività">
  <div class="row"><input type="date" name="date" value="${ds}" aria-label="Giorno"><select name="area" aria-label="Area">${areaOpts('uni')}</select></div>
  <div class="row"><label class="tl">Dalle<input type="time" name="time" aria-label="Ora di inizio (facoltativa)"></label><label class="tl">alle<input type="time" name="end" aria-label="Ora di fine (facoltativa)"></label></div>
  <label class="cb"><input type="checkbox" name="allday"> Tutto il giorno</label>
  <label class="cb"><input type="checkbox" name="dl"> È una scadenza (esame, consegna)</label>
  <button class="primary">Aggiungi</button></form>`;
}

// ---------- Viste ----------
// ---------- Interfaccia a widget: elementi comuni ----------
const ICON = {
  habit: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3v2.5a5 5 0 0 0 10 0V3M7 21v-2.5a5 5 0 0 1 10 0V21"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  inbox: '<path d="M4 13.5 6.5 5h11l2.5 8.5V19H4z"/><path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20"/>',
  repeat: '<path d="M4 11a8 8 0 0 1 14-5l2 2M20 4v4h-4M20 13a8 8 0 0 1-14 5l-2-2M4 20v-4h4"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  bars: '<path d="M6 20v-6M12 20V6M18 20v-9"/>',
  pin: '<path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
};
const svg = (n, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// Nome breve di un'abitudine per i cerchi: dalla chiave ("medit" → "Medit.", "sveglia" → "Sveglia").
const shortHab = (k, l) => cap(k) + (new RegExp('\\b' + k + '\\b', 'i').test(l) ? '' : '.');
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
function weekRange(m) {
  const e = addD(m, 6);
  return m.getMonth() === e.getMonth() ? `${m.getDate()}–${e.getDate()} ${MM[e.getMonth()].slice(0, 3)}`
    : `${m.getDate()} ${MM[m.getMonth()].slice(0, 3)} – ${e.getDate()} ${MM[e.getMonth()].slice(0, 3)}`;
}
function since(ds, today) {
  const d = parse(ds), n = Math.round((parse(today) - d) / 864e5);
  return n === 1 ? 'da ieri' : n < 7 ? 'da ' + GG[d.getDay()].toLowerCase() : 'dal ' + d.getDate() + ' ' + MM[d.getMonth()].slice(0, 3);
}
// Un widget: icona squadrata, titolo, dato sintetico a destra; toccandolo si apre il pannello "p".
const widget = (cls, p, icon, title, right, body) =>
  `<div class="w glass ${cls}" data-act="open" data-p="${p}" role="button" tabindex="0" aria-label="${esc(title)}: apri"><div class="wh"><span class="ic">${svg(icon)}</span><span class="wt">${esc(title)}</span>${right || ''}</div><div class="wb">${body}</div></div>`;
const badge = n => n ? `<span class="badge" aria-label="${n} da recuperare">${n}</span>` : '';
let popKey = '';   // abitudine appena spuntata (per la piccola animazione)

// Tema: automatico (segue l'iPhone), chiaro o scuro. Ricordato solo su questo telefono.
const THEME_KEY = 'agenda-tema';
let themeMem = 'auto';
function getTheme() { try { return localStorage.getItem(THEME_KEY) || themeMem; } catch (e) { return themeMem; } }
function applyTheme(t) {
  const r = document.documentElement;
  if (t === 'light' || t === 'dark') r.dataset.theme = t; else delete r.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', dark ? '#0e0e11' : '#e9e9ee');
}
function setTheme(t) { themeMem = t; try { localStorage.setItem(THEME_KEY, t); } catch (e) {} applyTheme(t); render(true); }
applyTheme(getTheme());
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(getTheme()));

// Intestazione (data piccola + titolo grande, pulsanti + e ⋯) e selettore dei tre livelli.
function shellHead(v) {
  const now = new Date(), wm = addD(monday(now), weekOff * 7), mf = new Date(now.getFullYear(), now.getMonth() + monthOff, 1);
  const head = {
    oggi: [`${MM[now.getMonth()]} · settimana ${isoWeek(now)}`, `${GG[now.getDay()]} ${now.getDate()}`],
    settimana: [`settimana ${isoWeek(wm)}`, weekRange(wm)],
    mese: [String(mf.getFullYear()), cap(MM[mf.getMonth()])],
  }[v];
  const seg = [['oggi', 'Giorno', `${GS[now.getDay()].toLowerCase()} ${now.getDate()}`], ['settimana', 'Settimana', weekRange(wm)], ['mese', 'Mese', MM[mf.getMonth()]]];
  // Settimana e Mese: frecce per spostarsi e "oggi" per tornare al periodo attuale.
  const nav = { settimana: ['wk', weekOff, 'Settimana'], mese: ['mo', monthOff, 'Mese'] }[v];
  const kick = nav ? `<button class="kn" data-act="${nav[0]}" data-v="-1" aria-label="${nav[2]} precedente">${svg('left')}</button><span>${esc(head[0])}</span><button class="kn" data-act="${nav[0]}" data-v="1" aria-label="${nav[2]} successiva">${svg('right')}</button>${nav[1] ? `<button class="kn txt" data-act="${nav[0]}0">oggi</button>` : ''}` : esc(head[0]);
  return `<header class="hd"><div class="tx"><p class="kick">${kick}</p><h1>${esc(head[1])}</h1></div>
    <button class="rbtn glass" data-act="menu" aria-label="Impostazioni, backup e promemoria">${svg('more')}${pushState === 'off' ? '<span class="pip"></span>' : ''}</button>
    <button class="rbtn glass" data-act="add" aria-label="Aggiungi attività">${svg('plus')}</button></header>
  <nav class="seg glass" aria-label="Livelli">${seg.map(([k, l, s]) => `<a href="#${k}"${k === v ? ' aria-current="page"' : ''}>${l}<small>${esc(s)}</small></a>`).join('')}</nav>`;
}

// ---------- Livello Giorno ----------
function viewGiorno() {
  const d = new Date(), ds = iso(d), day = S.days[ds] || {}, h = day.h || {}, n = countDay(ds);
  // Abitudini (largo): cerchi spuntabili direttamente.
  const habs = `<div class="habrow">${HAB.map(([k, l]) => `<button class="hc${h[k] ? ' on' : ''}${popKey === ds + k ? ' pop' : ''}" data-act="hab" data-d="${ds}" data-k="${esc(k)}" aria-pressed="${!!h[k]}" aria-label="${esc(l)}">
    <span class="ring">${svg('check')}</span><span>${esc(shortHab(k, l))}</span></button>`).join('')}</div>`;
  // Agenda (alto): impegni in ordine di orario, linea "adesso", passati barrati.
  const nowMin = d.getHours() * 60 + d.getMinutes(), it = dayPlan(d), rows = [];
  let placed = false;
  const nowRow = { now: 1 };
  for (const x of it.filter(x => x.t)) {
    const s = toMin(x.t), end = x.re != null ? x.re : s;
    if (!placed && s > nowMin) { rows.push(nowRow); placed = true; }
    rows.push({ ...x, past: !!(x.done || x.skip || end <= nowMin) });
  }
  if (!placed) rows.push(nowRow);
  for (const x of it.filter(x => !x.t)) rows.push({ ...x, past: !!(x.done || x.skip) });
  const from = Math.max(0, rows.indexOf(nowRow) - 3);
  const ag = `<ul class="agl">${rows.slice(from).map(x => x.now ? `<li class="now">${toHM(nowMin)}</li>`
    : `<li class="${x.past ? 'past' : ''}"><span class="t">${x.t ? esc(x.t) : '—'}</span><span class="n">${esc(x.n)}</span></li>`).join('')}</ul>`;
  // Priorità (piccolo): spuntabili.
  const top = day.top || ['', '', ''], topd = day.topd || [false, false, false];
  const pr = top.some(s => s && s.trim()) ? `<ul class="pl">${[0, 1, 2].filter(i => top[i] && top[i].trim()).map(i => `<li class="${topd[i] ? 'done' : ''}">
    <button class="cbx${topd[i] ? ' on' : ''}" data-act="topd" data-i="${i}" aria-pressed="${!!topd[i]}" aria-label="Fatta: ${esc(top[i])}"></button><span class="x">${esc(top[i])}</span></li>`).join('')}</ul>`
    : '<p class="small mutd" style="margin:0">Scrivi le 3 cose più importanti di oggi.</p>';
  // In sospeso (piccolo): prime 2 attività arretrate.
  const late = Object.entries(S.tasks).filter(([, t]) => t.date && t.date < ds && !t.done).sort((a, b) => b[1].date.localeCompare(a[1].date));
  const so = late.length ? `<ul class="sl">${late.slice(0, 2).map(([, t]) => `<li><b>${esc(t.title)}</b><small>${since(t.date, ds)}</small></li>`).join('')}</ul>`
    : '<p class="small mutd" style="margin:0">Niente in sospeso.</p>';
  // Prepara domani (largo, basso): in evidenza dalle 19:00.
  const t = addD(d, 1), tr = trainOf(t), topT = S.days[iso(t)]?.top || [], nT = topT.filter(s => s && s.trim()).length;
  const hot = d.getHours() >= 19 && nT < 3;
  const pdText = `${GG[t.getDay()]}: ${!tr ? 'riposo' : tr.skip ? 'allenamento saltato' : esc(tr.n.toLowerCase()) + ' alle ' + esc(tr.t)}.<br>${nT === 3 ? 'Priorità di domani pronte.' : nT ? `Priorità di domani: ${nT} di 3.` : 'Scegli le 3 priorità.'}`;
  return widget('a-hab', 'habits', 'habit', 'Abitudini', `<span class="meta">${n} di ${HAB.length}</span>`, habs)
    + widget('a-ag', 'agenda', 'clock', 'Agenda', '', ag)
    + widget('a-pr', 'prio', 'list', 'Priorità', '', pr)
    + widget('a-so', 'late', 'hourglass', 'In sospeso', badge(late.length), so)
    + widget('a-pd' + (hot ? ' hot' : ''), 'tomorrow', 'moon', 'Prepara domani', '',
      `<div class="pd"><p>${pdText}</p><button class="pill${hot ? ' solid' : ''}" data-act="open" data-p="tomorrow">${nT ? 'Modifica' : 'Inizia'}</button></div>`);
}

// Contenuto dei pannelli (tappa 1: le funzioni di sempre; il nuovo aspetto arriva alla tappa 2).
function panelBody(p) {
  const d = new Date(), ds = iso(d), day = S.days[ds] || {}, h = day.h || {};
  if (p === 'habits') {
    const tr = trainOf(d);
    const trHab = !tr ? 'Oggi riposo: spunta se hai rispettato il piano' : tr.skip ? esc(tr.why) : 'In programma: ' + esc(tr.n) + ' alle ' + esc(tr.t) + (tr.why ? ' (spostato)' : '');
    return ['Abitudini', `<ul class="habits">${HAB.map(([k, l]) => `<li><button class="hab${h[k] ? ' on' : ''}" data-act="hab" data-d="${ds}" data-k="${esc(k)}" aria-pressed="${!!h[k]}">
      <span class="tick"></span><span class="hl">${esc(l)}${k === 'allen' ? `<small>${trHab}</small>` : ''}</span><span class="streak">${streak(k)}</span></button></li>`).join('')}</ul>`];
  }
  // Toglie il titolo interno dei vecchi riquadri (il titolo ora è nell'intestazione del pannello).
  const noHead = h => h.replace(/<h2>[^<]*<\/h2>/, '').replace(/^(<section class="card">)?\s*<p class="sub">[^<]*<\/p>/, '$1');
  if (p === 'agenda') return ['Agenda', `${agenda(d)}<button class="addrow" data-act="addon" data-d="${ds}">+ Aggiungi a oggi</button>`];
  if (p === 'prio') {
    const top = day.top || ['', '', ''], topd = day.topd || [false, false, false];
    const ph = ['La cosa più importante di oggi', 'Seconda priorità', 'Terza priorità'];
    return ['3 priorità', [0, 1, 2].map(i => `<div class="pri${topd[i] ? ' on' : ''}"><button class="chk${topd[i] ? ' on' : ''}" data-act="topd" data-i="${i}" aria-label="Priorità ${i + 1} fatta" aria-pressed="${!!topd[i]}"></button>
      <input id="pri${i}" data-act="top" data-i="${i}" value="${esc(top[i])}" placeholder="${ph[i]}" aria-label="Priorità ${i + 1}"></div>`).join('')];
  }
  if (p === 'late') return ['In sospeso', noHead(lateCard(ds)) || '<p class="empty">Niente in sospeso: sei in pari.</p>'];
  if (p === 'tomorrow') return ['Prepara domani', noHead(tomorrowCard(addD(d, 1))).replace(/<h2>[^<]*<\/h2>\s*<p class="sub">[^<]*<\/p>/, '')];
  if (p === 'add') {
    const v = cur(), m = addD(monday(d), weekOff * 7);
    const def = sheet && sheet.d ? sheet.d : v === 'mese' && selDay ? selDay : v === 'settimana' && weekOff ? iso(m) : ds;
    return ['Aggiungi attività', noHead(addForm(def))];
  }
  // --- Settimana ---
  if (p === 'whab') {
    const days = weekDays(), today = iso(new Date());
    return ['Abitudini della settimana', `<div class="scroll"><table class="grid">
      <thead><tr><th></th>${days.map(d => `<th class="${iso(d) === today ? 'td' : ''}">${GS[d.getDay()]}<small>${d.getDate()}</small></th>`).join('')}</tr></thead>
      <tbody>${HAB.map(([k, l]) => `<tr><th scope="row">${esc(l)}</th>${days.map(d => {
        const dd = iso(d), on = S.days[dd]?.h?.[k];
        return `<td><button class="dotb${on ? ' on' : ''}" data-act="hab" data-d="${dd}" data-k="${esc(k)}" aria-pressed="${!!on}" aria-label="${esc(l)}, ${GG[d.getDay()]} ${d.getDate()}"></button></td>`;
      }).join('')}</tr>`).join('')}
      <tr class="pct"><th scope="row">Totale</th>${days.map(d => { const dd = iso(d); return `<td>${dd > today ? '–' : Math.round(pctDay(dd) * 100) + '%'}</td>`; }).join('')}</tr></tbody></table></div>`];
  }
  if (p === 'wdays') {
    const today = iso(new Date());
    return ['Giorni della settimana', `<section class="days">${weekDays().map(d => `<div class="day${iso(d) === today ? ' today' : ''}"><h3>${GG[d.getDay()]} <span>${d.getDate()} ${MM[d.getMonth()].slice(0, 3)}</span></h3>${agenda(d)}</div>`).join('')}</section>`];
  }
  if (p === 'wtrain') {
    const tr = trainingsOf(weekDays());
    return ['Allenamenti della settimana', tr.length ? `<ul class="ag">${tr.map(x => `<li><span class="tm">${cap(DOW[x.d.getDay()])}<small>${x.d.getDate()}</small></span><span class="dot sport"></span>
      <span class="tt">${esc(x.tr.n)} alle ${esc(x.tr.t)}${x.tr.why ? `<small class="why">${esc(x.tr.why)}</small>` : ''}</span>
      <span class="acts"><button class="mini${x.done ? ' on' : ''}" data-act="hab" data-d="${x.ds}" data-k="allen" aria-pressed="${x.done}" aria-label="Allenamento fatto">✓</button><button class="mini" data-act="fx" data-d="${x.ds}" data-k="train" aria-label="Salta o sposta">⋯</button></span></li>`).join('')}</ul>
      <p class="hint">✓ segna l'abitudine "Allenamento" di quel giorno; ⋯ salta o sposta solo quel giorno.</p>` : '<p class="empty">Nessun allenamento previsto questa settimana.</p>'];
  }
  if (p === 'someday') return ['Prima o poi', somedayCard().replace(/<h2>Prima o poi<\/h2>/, '')];
  if (p === 'review') {
    const days = weekDays(), tr = trainingsOf(days), st = habitStats(days), pct = pctOf(days);
    const late = Object.values(S.tasks).filter(t => t.date && t.date < iso(new Date()) && !t.done).length;
    const sd = Object.values(S.tasks).filter(t => !t.date && !t.done).length;
    const done = reviewDone();
    const items = [
      ['Guarda le abitudini', `${pct === null ? '—' : pct + '%'} della settimana · ` + st.map(s => `${esc(shortHab(s.k, s.l))} ${s.n}/${s.of}`).join(', ')],
      ['Allenamenti', `${tr.filter(x => x.done).length} fatti su ${tr.length} previsti`],
      ['Cosa ha funzionato e cosa no', 'Una riga per ciascuno: cosa ripeti, cosa cambi.'],
      ['Svuota "In sospeso"', late ? `${late} attività da spostare o cancellare` : 'Niente in sospeso'],
      ['Scegli da "Prima o poi"', sd ? `${sd} voci: dai una data a 1 o 2` : 'La lista è vuota'],
      ['Controlla la prossima settimana', 'Impegni fissi da saltare o spostare, scadenze in arrivo'],
      ['Scrivi le priorità di lunedì', 'Le 3 cose più importanti per ripartire'],
    ];
    return ['Review della settimana', `<p class="sub" style="margin-bottom:8px">15 minuti, la domenica. Le spunte restano su questo telefono.</p>
      <ul class="rvl">${items.map(([t, s], i) => `<li class="${done[i] ? 'done' : ''}"><button class="cbx${done[i] ? ' on' : ''}" data-act="rvchk" data-i="${i}" aria-pressed="${!!done[i]}" aria-label="${esc(t)}"></button><div><b>${t}</b><small>${s}</small></div></li>`).join('')}</ul>`];
  }
  // --- Mese ---
  if (p === 'day') {
    const sd = parse(selDay || iso(new Date()));
    return [`${GG[sd.getDay()]} ${sd.getDate()} ${MM[sd.getMonth()]}`, `${agenda(sd)}<button class="addrow" data-act="addon" data-d="${iso(sd)}">+ Aggiungi a questo giorno</button>`];
  }
  if (p === 'deadlines') {
    const { first, mk } = monthInfo(), today = iso(new Date());
    const dls = Object.entries(S.tasks).filter(([, t]) => t.dl && t.date && (t.date.slice(0, 7) === mk || (monthOff === 0 && t.date >= today))).sort((a, b) => a[1].date.localeCompare(b[1].date));
    return [`Scadenze di ${MM[first.getMonth()]}${monthOff === 0 ? ' e in arrivo' : ''}`, dls.length ? '<ul class="ag">' + dls.map(([id, t]) => { const dd = parse(t.date); return `<li class="${t.done ? 'done' : ''}"><span class="tm">${dd.getDate()} ${MM[dd.getMonth()].slice(0, 3)}</span><span class="dot" style="background:var(--solid)"></span><span class="tt">${taskName(id, t.title)}</span><span class="acts"><button class="mini${t.done ? ' on' : ''}" data-act="done" data-id="${id}" aria-label="Segna come fatto">✓</button></span></li>`; }).join('') + '</ul>'
      : '<p class="empty">Nessuna scadenza. Aggiungile con + spuntando “È una scadenza”.</p>'];
  }
  if (p === 'goals') {
    const { first, mk } = monthInfo(), goals = Object.entries(S.goals).filter(([, g]) => g.month === mk);
    return [`Obiettivi di ${MM[first.getMonth()]}`, `${goals.length ? '<ul class="goals">' + goals.map(([id, g]) => `<li class="${g.done ? 'done' : ''}"><button class="chk${g.done ? ' on' : ''}" data-act="gdone" data-id="${id}" aria-label="Obiettivo raggiunto" aria-pressed="${!!g.done}"></button><span class="tt">${esc(g.title)}</span><button class="mini" data-act="gdel" data-id="${id}" aria-label="Elimina obiettivo">×</button></li>`).join('') + '</ul>' : '<p class="empty">Scegli uno o due obiettivi per questo mese, non di più.</p>'}
      <form data-form="goal" data-m="${mk}"><div class="row"><input name="title" placeholder="3 allenamenti a settimana" required aria-label="Nuovo obiettivo"><select name="area" aria-label="Area">${areaOpts('sport')}</select><button class="primary">Aggiungi</button></div></form>`];
  }
  if (p === 'stats') {
    const { first, days } = monthInfo(), st = habitStats(days);
    return [`Statistiche di ${MM[first.getMonth()]}`, `<ul class="stl">${st.map(s => `<li><div class="stt"><b>${esc(s.l)}</b><span>${s.pct}%</span></div><div class="stb"><i style="width:${s.pct}%"></i></div>
      <small>${s.n} giorni su ${s.of} · serie più lunga: ${s.best} ${s.best === 1 ? 'giorno' : 'giorni'}</small></li>`).join('')}</ul>`];
  }
  if (p === 'fixed') {
    return ['Impegni fissi', `<ul class="ag">${fixedSummary().map(([n, w, t]) => `<li><span class="tm" style="white-space:normal;font-size:13px">${esc(w)}</span><span class="dot"></span><span class="tt">${esc(n)}${t ? `<small class="why">${esc(t)}</small>` : ''}</span><span></span></li>`).join('')}</ul>
      <p class="hint">Si cambiano in config.js. Per saltarne o spostarne uno solo un giorno usa ⋯ nell'agenda di quel giorno.</p>`];
  }
  if (p === 'menu') {
    const pr = pushState === 'on' ? '<section class="card"><h2>Promemoria serale</h2><p class="sub">Attivi: ogni sera alle 21:30.</p><div class="row"><button class="ghost" data-act="pushtest">Invia notifica di prova</button></div></section>' : pushCard();
    const th = getTheme();
    const tema = `<section class="card"><h2>Tema</h2><div class="tseg" role="group" aria-label="Tema">${[['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']].map(([k, l]) =>
      `<button data-act="theme" data-v="${k}" aria-pressed="${th === k}">${l}</button>`).join('')}</div>
      <p class="hint">Automatico segue la modalità chiara o scura dell'iPhone.</p></section>`;
    return ['Impostazioni', `${tema}${pr}<div class="foot"><button class="ghost" data-act="export">Scarica backup</button><button class="ghost" data-act="logout">Esci</button></div><p class="hint center">Versione ${VERSION}</p>`];
  }
  return ['', ''];
}
// Dalle 19:00: le 3 priorità di domani (salvate nel giorno di domani).
function tomorrowCard(t) {
  const ds = iso(t), top = S.days[ds]?.top || ['', '', ''];
  const ph = ['La cosa più importante di domani', 'Seconda priorità', 'Terza priorità'];
  return `<section class="card"><h2>Prepara domani</h2><p class="sub">${GG[t.getDay()]} ${t.getDate()} ${MM[t.getMonth()]}</p>
  ${[0, 1, 2].map(i => `<div class="pri"><span class="pn">${i + 1}</span><input data-act="top" data-d="${ds}" data-i="${i}" value="${esc(top[i])}" placeholder="${ph[i]}" aria-label="Priorità ${i + 1} di domani"></div>`).join('')}</section>`;
}
// Attività di giorni passati non completate.
function lateCard(today) {
  const late = Object.entries(S.tasks).filter(([, t]) => t.date && t.date < today && !t.done).sort((a, b) => a[1].date.localeCompare(b[1].date));
  if (!late.length) return '';
  return `<section class="card"><h2>In sospeso</h2><ul class="ag">${late.map(([id, t]) => { const d = parse(t.date); return `<li>
    <span class="tm">${d.getDate()} ${MM[d.getMonth()].slice(0, 3)}</span><span class="dot ${esc(t.area || 'pers')}"></span>
    <span class="tt">${t.dl ? '<span class="dl">Scadenza · </span>' : ''}${taskName(id, t.title)}</span>
    <span class="acts"><button class="mini txt" data-act="mv" data-id="${id}" data-v="0" aria-label="Sposta a oggi">A oggi</button><button class="mini txt" data-act="mv" data-id="${id}" data-v="1" aria-label="Sposta a domani">A domani</button></span></li>`; }).join('')}</ul></section>`;
}

// ---------- Livello Settimana ----------
const DOW = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const weekDays = () => { const m = addD(monday(new Date()), weekOff * 7); return [...Array(7)].map((_, i) => addD(m, i)); };
// Percentuale abitudini su un elenco di giorni (contano solo quelli fino a oggi).
function pctOf(days) {
  const today = iso(new Date()), past = days.filter(d => iso(d) <= today);
  return past.length ? Math.round(past.reduce((s, d) => s + pctDay(iso(d)), 0) / past.length * 100) : null;
}
// Impegno principale di un giorno: un'attività tua, altrimenti un ricorrente, altrimenti l'allenamento.
function mainOf(d) {
  const it = dayPlan(d).filter(x => !x.skip && !x.uni);
  const pick = it.find(x => x.id && !x.done) || it.find(x => x.fx && !x.train) || it.find(x => x.train) || it.find(x => x.id);
  const sun = d.getDay() === 0;
  // Nomi brevi per gli impegni fissi ("Laboratorio di urbanistica" → "Laboratorio", "Palestra (facoltativa)" → "Palestra").
  const name = !pick ? '' : pick.id ? pick.n : pick.train ? pick.n.replace(/\s*\(.*\)$/, '') : pick.n.split(' ')[0];
  const txt = pick ? name + (pick.train && pick.t && !sun ? ' ' + pick.t : '') : UNI.days.includes(d.getDay()) ? 'Università' : '—';
  return sun ? txt + ' · Review' : txt;
}
// Allenamenti della settimana: previsti dal piano (esclusi i saltati) e fatti secondo l'abitudine "allen".
function trainingsOf(days) {
  const today = iso(new Date());
  return days.map(d => ({ d, ds: iso(d), tr: trainOf(d) })).filter(x => x.tr && !x.tr.skip)
    .map(x => ({ ...x, done: !!S.days[x.ds]?.h?.allen, future: x.ds > today }));
}
function viewSett() {
  const today = iso(new Date()), days = weekDays(), pct = pctOf(days);
  // Abitudini: griglia pallini (prime 3 righe + "+N").
  const rows = HAB.slice(0, 3), more = HAB.length - rows.length;
  const hg = `<div class="hg"><span></span>${days.map(d => `<span class="hl1${iso(d) === today ? ' td' : ''}">${GS[d.getDay()].charAt(0)}</span>`).join('')}
    ${rows.map(([k, l]) => `<span class="hn">${esc(shortHab(k, l))}</span>${days.map(d => { const ds = iso(d); return `<i class="pd2 ${ds > today ? 'fut' : S.days[ds]?.h?.[k] ? 'on' : ''}"></i>`; }).join('')}`).join('')}</div>`;
  // Giorni: impegno principale.
  const gi = `<ul class="gl">${days.map(d => { const ds = iso(d); return `<li class="${ds < today ? 'past' : ds === today ? 'td' : ''}"><b>${cap(DOW[d.getDay()])}</b><span>${esc(mainOf(d))}</span></li>`; }).join('')}</ul>`;
  // Allenamenti: fatti / previsti.
  const tr = trainingsOf(days), done = tr.filter(x => x.done).length;
  const al = `<div class="big"><b>${done}</b><span>/${tr.length}</span></div><div class="tdots">${tr.map(x => `<i class="pd2 ${x.done ? 'on' : x.future ? 'fut' : ''}" title="${GG[x.d.getDay()]}"></i>`).join('')}</div>`;
  // Prima o poi.
  const sd = Object.entries(S.tasks).filter(([, t]) => !t.date && !t.done);
  const pp = sd.length ? `<ul class="sl">${sd.slice(0, 2).map(([, t]) => `<li><b>${esc(t.title)}</b></li>`).join('')}</ul>${sd.length > 2 ? `<p class="small faint" style="margin:2px 0 0">+${sd.length - 2} altre</p>` : ''}`
    : '<p class="small mutd" style="margin:0">Niente in lista.</p>';
  // Review.
  const sun = new Date().getDay() === 0 && weekOff === 0;
  const rv = `<div class="pd"><p>${sun ? 'Oggi' : 'Domenica'}, 15 minuti.<br>Cosa ha funzionato e cosa no.</p><button class="pill${sun ? ' solid' : ''}" data-act="open" data-p="review">Apri</button></div>`;
  return widget('a-hab', 'whab', 'habit', 'Abitudini', `<span class="meta">${more > 0 ? `<span class="faint">+${more} · </span>` : ''}${pct === null ? '—' : pct + '%'}</span>`, hg)
    + widget('a-gi', 'wdays', 'cal', 'Giorni', '', gi)
    + widget('a-al', 'wtrain', 'dumbbell', 'Allenamenti', '', al)
    + widget('a-pp', 'someday', 'inbox', 'Prima o poi', badge(sd.length), pp)
    + widget('a-rv' + (sun ? ' hot' : ''), 'review', 'repeat', 'Review della settimana', '', rv);
}
// Attività senza data: da fare "prima o poi".
function somedayCard() {
  const list = Object.entries(S.tasks).filter(([, t]) => !t.date).sort((a, b) => (a[1].done - b[1].done) || a[1].title.localeCompare(b[1].title));
  return `<section class="card"><h2>Prima o poi</h2>
  ${list.length ? '<ul class="ag">' + list.map(([id, t]) => `<li class="${t.done ? 'done' : ''}"><span class="tm">—</span><span class="dot ${esc(t.area || 'pers')}"></span>
    <span class="tt">${t.dl ? '<span class="dl">Scadenza · </span>' : ''}${taskName(id, t.title)}</span>
    <span class="acts"><button class="mini${t.done ? ' on' : ''}" data-act="done" data-id="${id}" aria-label="Segna come fatto">✓</button><button class="mini" data-act="del" data-id="${id}" aria-label="Elimina">×</button></span></li>`).join('') + '</ul>'
    : '<p class="empty">Le cose da fare senza una data precisa. Toccane una per darle un giorno.</p>'}
  <form data-form="someday"><div class="row"><input name="title" placeholder="Riparare la bici" required aria-label="Nuova attività senza data"><select name="area" aria-label="Area">${areaOpts('pers')}</select><button class="primary">Aggiungi</button></div></form></section>`;
}

// Spunte della checklist della review: solo su questo telefono (localStorage), una lista per settimana.
// Se la memoria del telefono non è disponibile, le spunte restano almeno finché l'app è aperta.
const reviewKey = () => 'agenda-review-' + iso(weekDays()[0]), reviewMem = {};
function reviewDone() {
  try { const v = localStorage.getItem(reviewKey()); if (v) return JSON.parse(v); } catch (e) {}
  return reviewMem[reviewKey()] || [];
}
function reviewToggle(i) {
  const d = [...reviewDone()]; d[i] = !d[i]; reviewMem[reviewKey()] = d;
  try { localStorage.setItem(reviewKey(), JSON.stringify(d)); } catch (e) {}
  render(true);
}

// ---------- Livello Mese ----------
function monthInfo() {
  const now = new Date(), first = new Date(now.getFullYear(), now.getMonth() + monthOff, 1);
  const mk = first.getFullYear() + '-' + pad(first.getMonth() + 1), dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return { first, mk, dim, days: [...Array(dim)].map((_, i) => new Date(first.getFullYear(), first.getMonth(), i + 1)) };
}
const monthDeadlines = mk => Object.entries(S.tasks).filter(([, t]) => t.dl && t.date && t.date.slice(0, 7) === mk).sort((a, b) => a[1].date.localeCompare(b[1].date));
// Per ogni abitudine: percentuale nel mese, giorni fatti e serie più lunga (solo fino a oggi).
function habitStats(days) {
  const today = iso(new Date()), past = days.filter(d => iso(d) <= today);
  return HAB.map(([k, l]) => {
    let n = 0, run = 0, best = 0;
    for (const d of past) { if (S.days[iso(d)]?.h?.[k]) { n++; run++; best = Math.max(best, run); } else run = 0; }
    return { k, l, n, of: past.length, pct: past.length ? Math.round(n / past.length * 100) : 0, best };
  });
}
// Impegni fissi da config.js, riassunti in poche righe.
// Giorni della settimana in forma breve, da lunedì; 3+ giorni di fila diventano "gio–sab".
function daysTxt(arr) {
  const m = [...new Set(arr)].map(w => (w + 6) % 7).sort((a, b) => a - b), name = i => DOW[(i + 1) % 7], out = [];
  for (let i = 0; i < m.length;) {
    let j = i; while (j + 1 < m.length && m[j + 1] === m[j] + 1) j++;
    out.push(j - i >= 2 ? `${name(m[i])}–${name(m[j])}` : m.slice(i, j + 1).map(name).join(', '));
    i = j + 1;
  }
  return out.join(', ');
}
function fixedSummary() {
  const today = iso(new Date()), out = [];
  if (UNI.days.length) out.push(['Università', daysTxt(UNI.days), `${UNI.start}–${UNI.end}`]);
  for (const r of REC) {
    if (r.to && r.to < today) continue;
    const when = r.weekdays ? daysTxt(r.weekdays) : r.everyDays && r.anchor
      ? (r.everyDays % 7 === 0 ? `ogni ${r.everyDays / 7 === 1 ? '' : r.everyDays / 7 + ' '}${DOW[parse(r.anchor).getDay()]}` : `ogni ${r.everyDays} giorni`) : '';
    out.push([r.name, when, r.t ? r.t + (r.end ? '–' + r.end : '') : '']);
  }
  const by = {};
  for (let w = 0; w < 7; w++) { const p = plan(w), nm = p.name.replace(/\s*\(.*\)$/, ''); if (p.t) (by[nm] = by[nm] || []).push(w); }
  for (const [name, ws] of Object.entries(by)) out.push([name, daysTxt(ws), [...ws].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(w => `${DOW[w]} ${plan(w).t}`).join(', ')]);
  return out;
}
function viewMese() {
  const today = iso(new Date()), { first, mk, dim, days } = monthInfo();
  const start = monday(first), weeks = Math.ceil((((first.getDay() + 6) % 7) + dim) / 7);
  const dls = monthDeadlines(mk), dlDays = new Set(dls.filter(([, t]) => !t.done).map(([, t]) => t.date)), pct = pctOf(days);
  // Calendario: più scuro = più abitudini; oggi in nero; pallino = scadenza.
  const cells = [...Array(weeks * 7)].map((_, i) => {
    const d = addD(start, i), ds = iso(d), inm = d.getMonth() === first.getMonth(), p = inm && ds <= today ? pctDay(ds) : 0;
    return `<button class="cc${inm ? '' : ' out'}${ds === today ? ' td' : ''}" style="--p:${p.toFixed(2)}" data-act="day" data-d="${ds}" aria-label="${d.getDate()} ${MM[d.getMonth()]}${dlDays.has(ds) ? ', scadenza' : ''}">${d.getDate()}${dlDays.has(ds) && inm ? '<i></i>' : ''}</button>`;
  }).join('');
  const cal = `<div class="calw" style="--wk:${weeks}">${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map(x => `<span class="wd2">${x}</span>`).join('')}${cells}</div>
    <p class="small faint" style="margin:6px 0 0">Più scuro = più abitudini rispettate · pallino = scadenza</p>`;
  // Scadenze.
  // Nel mese corrente anche le prossime scadenze in arrivo (es. all'inizio del mese dopo).
  const open = Object.entries(S.tasks).filter(([, t]) => t.dl && t.date && !t.done && (t.date.slice(0, 7) === mk || (monthOff === 0 && t.date >= today))).sort((a, b) => a[1].date.localeCompare(b[1].date));
  const next = open.filter(([, t]) => t.date >= today).concat(open.filter(([, t]) => t.date < today));
  const sc = next.length ? `<ul class="sl">${next.slice(0, 2).map(([, t]) => { const d = parse(t.date); return `<li><b><strong>${d.getDate()} ${MM[d.getMonth()].slice(0, 3)}</strong> · ${esc(t.title)}</b></li>`; }).join('')}</ul>`
    : '<p class="small mutd" style="margin:0">Nessuna scadenza.</p>';
  // Obiettivi spuntabili.
  const goals = Object.entries(S.goals).filter(([, g]) => g.month === mk), gd = goals.filter(([, g]) => g.done).length;
  const ob = goals.length ? `<ul class="pl">${goals.map(([id, g]) => `<li class="${g.done ? 'done' : ''}"><button class="cbx${g.done ? ' on' : ''}" data-act="gdone" data-id="${id}" aria-pressed="${!!g.done}" aria-label="Raggiunto: ${esc(g.title)}"></button><span class="x">${esc(g.title)}</span></li>`).join('')}</ul>`
    : '<p class="small mutd" style="margin:0">Scegli 1 o 2 obiettivi.</p>';
  // Statistiche: barre per abitudine.
  const st = habitStats(days);
  const bars = `<div class="bars">${st.map(s => `<div class="bar"><i style="height:${Math.max(4, s.pct)}%"></i><span>${esc(cap(s.k).slice(0, 2))}</span></div>`).join('')}</div>`;
  // Impegni fissi.
  const fx = `<ul class="fl">${fixedSummary().filter(([n]) => n !== 'Università').map(([n, w]) => `<li>${esc(n.split(' ')[0])} · ${esc(w)}</li>`).join('')}</ul>`;
  return widget('a-cal', 'day', 'cal', 'Calendario', `<span class="meta">abitudini ${pct === null ? '—' : pct + '%'}</span>`, cal)
    + widget('a-sc', 'deadlines', 'flag', 'Scadenze', badge(open.length), sc)
    + widget('a-ob', 'goals', 'target', 'Obiettivi', goals.length ? `<span class="meta">${gd} di ${goals.length}</span>` : '', ob)
    + widget('a-st', 'stats', 'bars', 'Statistiche', '', bars)
    + widget('a-fx', 'fixed', 'pin', 'Impegni fissi', '', fx);
}

// Icona e riga di riepilogo di ogni pannello.
const PANEL_ICON = { habits: 'habit', agenda: 'clock', prio: 'list', late: 'hourglass', tomorrow: 'moon', add: 'plus', menu: 'more',
  whab: 'habit', wdays: 'cal', wtrain: 'dumbbell', someday: 'inbox', review: 'repeat', day: 'cal', deadlines: 'flag', goals: 'target', stats: 'bars', fixed: 'pin' };
const longDate = d => `${GG[d.getDay()]} ${d.getDate()} ${MM[d.getMonth()]}`;
const impegni = n => n === 1 ? '1 impegno' : `${n} impegni`;
function panelSub(p) {
  const d = new Date(), ds = iso(d), days = weekDays(), { first, mk } = monthInfo();
  switch (p) {
    case 'habits': return `${countDay(ds)} di ${HAB.length} oggi`;
    case 'agenda': return `${longDate(d)} · ${impegni(dayPlan(d).length)}`;
    case 'prio': return longDate(d);
    case 'late': { const n = Object.values(S.tasks).filter(t => t.date && t.date < ds && !t.done).length; return n ? `${n} da recuperare` : 'Tutto in pari'; }
    case 'tomorrow': return longDate(addD(d, 1));
    case 'whab': { const pc = pctOf(days); return `${weekRange(days[0])}${pc === null ? '' : ' · ' + pc + '%'}`; }
    case 'wdays': return weekRange(days[0]);
    case 'wtrain': { const tr = trainingsOf(days); return `${tr.filter(x => x.done).length} fatti su ${tr.length}`; }
    case 'someday': { const n = Object.values(S.tasks).filter(t => !t.date && !t.done).length; return n === 1 ? '1 da fare' : `${n} da fare`; }
    case 'review': return 'Domenica, 15 minuti';
    case 'day': { const sd = parse(selDay || ds); return impegni(dayPlan(sd).length); }
    case 'deadlines': case 'stats': return cap(MM[first.getMonth()]) + ' ' + first.getFullYear();
    case 'goals': { const g = Object.values(S.goals).filter(x => x.month === mk); return g.length ? `${g.filter(x => x.done).length} di ${g.length} raggiunti` : cap(MM[first.getMonth()]); }
    case 'fixed': return 'Da config.js';
    case 'menu': return 'Versione ' + VERSION;
    default: return '';
  }
}
let sheetAnim = false;   // true solo all'apertura: l'animazione non si ripete a ogni aggiornamento
function openSheet(s) { sheet = s; sheetAnim = true; render(true); }
// Chiude il pannello con l'animazione di discesa (subito se "Riduci movimento" è attivo).
function closeSheet() {
  const ov = app.querySelector('.ov'), sh = ov && ov.querySelector('.sheet');
  if (!sh || matchMedia('(prefers-reduced-motion: reduce)').matches) { sheet = null; render(true); return; }
  ov.classList.add('leaving'); sh.style.transition = 'transform .22s ease-in'; sh.style.transform = 'translateY(105%)';
  setTimeout(() => { if (ov.isConnected) { sheet = null; render(true); } }, 220);
}
// Il pannello si apre sotto il selettore dei livelli, che resta visibile.
function sheetTop() { const s = document.querySelector('.seg'); return s ? Math.round(s.getBoundingClientRect().bottom + 8) : 0; }
const sheetHead = (icon, title, sub) => `<div class="grab" aria-hidden="true"></div><div class="shh">${icon ? `<span class="ic">${svg(icon)}</span>` : ''}<div class="tx"><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
  <button class="rbtn glass x" data-act="close" aria-label="Chiudi">${svg('x')}</button></div>`;

// Pannello che si apre dal basso (widget, +, ⋯, modifica attività, opzioni impegni fissi).
function sheetView() {
  if (!sheet) return '';
  let body = '', label = '';
  if (sheet.kind === 'panel') {
    const [title, html] = panelBody(sheet.p);
    label = title;
    body = sheetHead(PANEL_ICON[sheet.p], title, panelSub(sheet.p)) + html;
  }
  if (sheet.kind === 'task') {
    const t = S.tasks[sheet.id]; if (!t) { sheet = null; return ''; }
    label = 'Modifica attività';
    body = sheetHead('list', 'Modifica attività', t.date ? longDate(parse(t.date)) : 'Prima o poi') + `<form data-form="edit" data-id="${sheet.id}">
    <input name="title" value="${esc(t.title)}" required aria-label="Attività">
    <div class="row"><input type="date" name="date" value="${esc(t.date || '')}" aria-label="Giorno (vuoto = Prima o poi)"><select name="area" aria-label="Area">${areaOpts(t.area || 'pers')}</select></div>
    <div class="row"><label class="tl">Dalle<input type="time" name="time" value="${esc(t.time || '')}" aria-label="Ora di inizio"></label><label class="tl">alle<input type="time" name="end" value="${esc(t.end || '')}" aria-label="Ora di fine"></label></div>
    <label class="cb"><input type="checkbox" name="dl"${t.dl ? ' checked' : ''}> È una scadenza (esame, consegna)</label>
    <p class="hint">Senza data l'attività va in “Prima o poi” (scheda Settimana).</p>
    <div class="row end"><button type="button" class="ghost" data-act="close">Annulla</button><button class="primary">Salva</button></div></form>`;
  }
  if (sheet.kind === 'fx') {
    const d = parse(sheet.ds), x = fixed(d).find(f => f.k === sheet.k); if (!x) { sheet = null; return ''; }
    const when = sheet.ds === iso(new Date()) ? 'oggi' : GG[d.getDay()].toLowerCase() + ' ' + d.getDate();
    label = x.n;
    body = sheetHead(x.train ? 'dumbbell' : 'pin', x.n, `${longDate(d)} · di solito alle ${x.t0}`) + `<form data-form="fxtime" data-d="${sheet.ds}" data-k="${esc(sheet.k)}">
    <div class="row"><button type="button" class="ghost" data-act="fxskip">Salta solo ${when}</button></div>
    <div class="row"><label class="tl">Nuovo orario<input type="time" name="t" value="${esc(x.skip ? x.t0 : x.t)}" required></label><button class="primary">Sposta solo ${when}</button></div>
    ${x.ov ? '<div class="row"><button type="button" class="ghost" data-act="fxreset">Ripristina come al solito</button></div>' : ''}
    <div class="row end"><button type="button" class="ghost" data-act="close">Annulla</button></div></form>`;
  }
  const anim = sheetAnim ? ' anim' : '';
  return `<div class="ov${anim}" data-act="close" style="top:${sheetTop()}px"><div class="sheet${anim}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${body}</div></div>`;
}

function footer() {
  return `<div class="foot">${pushState === 'on' ? '<button class="ghost" data-act="pushtest">Invia notifica di prova</button>' : ''}<button class="ghost" data-act="export">Scarica backup</button><button class="ghost" data-act="logout">Esci</button></div>
  <p class="hint center">Versione ${VERSION}</p>`;
}

function viewLogin() {
  const notSet = !C.supabaseUrl || C.supabaseUrl.startsWith('INCOLLA');
  if (notSet) return `<section class="login"><h1>Quasi pronto</h1><p class="sub">Apri <b>config.js</b> e incolla URL e chiave del tuo progetto Supabase. Poi ricarica la pagina.</p></section>`;
  return `<section class="login"><p class="kick">La mia agenda</p><h1>${signup ? 'Crea il tuo account' : 'Accedi'}</h1>
  <form data-form="login"><input type="email" name="email" placeholder="nome@esempio.it" autocomplete="email" required aria-label="Email">
  <input type="password" name="pw" placeholder="Password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required aria-label="Password">
  <p class="err" id="lerr"></p><button class="primary">${signup ? 'Crea account' : 'Accedi'}</button></form>
  <button class="alt" data-act="swap">${signup ? 'Ho già un account' : 'Prima volta? Crea l’account'}</button></section>`;
}

const VIEWS = { oggi: viewGiorno, settimana: viewSett, mese: viewMese };
const NEW_LAYOUT = { oggi: true, settimana: true, mese: true };   // livelli ridisegnati a widget
function cur() { const h = location.hash.slice(1); return VIEWS[h] ? h : 'oggi'; }
function render(force) {
  const a = document.activeElement;
  if (!force && a && app.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) { pending = true; return; }
  pending = false;
  document.body.classList.toggle('out', !user);
  if (!user) { app.innerHTML = viewLogin(); return; }
  const v = cur();
  app.innerHTML = `<div class="shell">${shellHead(v)}<section class="board ${NEW_LAYOUT[v] ? v : 'legacy'}">${VIEWS[v]()}</section></div>` + sheetView();
  sheetAnim = false;
}

// ---------- Eventi ----------
app.addEventListener('focusout', () => setTimeout(() => { if (pending && !app.contains(document.activeElement)) render(); }, 0));
app.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === 'hab') { const ds = b.dataset.d, h = { ...(S.days[ds]?.h || {}) }; h[b.dataset.k] = !h[b.dataset.k]; popKey = h[b.dataset.k] ? ds + b.dataset.k : ''; setDay(ds, { h }); popKey = ''; }
  else if (a === 'open') openSheet({ kind: 'panel', p: b.dataset.p });
  else if (a === 'add' || a === 'menu') openSheet({ kind: 'panel', p: a });
  else if (a === 'day') { selDay = b.dataset.d; openSheet({ kind: 'panel', p: 'day' }); }
  else if (a === 'addon') { selDay = b.dataset.d; openSheet({ kind: 'panel', p: 'add', d: b.dataset.d }); }
  else if (a === 'rvchk') reviewToggle(+b.dataset.i);
  else if (a === 'theme') setTheme(b.dataset.v);
  else if (a === 'wk0') { weekOff = 0; render(true); }
  else if (a === 'mo0') { monthOff = 0; render(true); }
  else if (a === 'topd') { const ds = iso(new Date()), td = [...(S.days[ds]?.topd || [false, false, false])]; td[+b.dataset.i] = !td[+b.dataset.i]; setDay(ds, { topd: td }); }
  else if (a === 'done' && S.tasks[id]) put('tasks', id, { ...S.tasks[id], done: !S.tasks[id].done });
  else if (a === 'del' && S.tasks[id]) { lastDel = ['tasks', id, S.tasks[id]]; put('tasks', id, null); flash('Attività eliminata', true); }
  else if (a === 'edit' && S.tasks[id]) openSheet({ kind: 'task', id });
  else if (a === 'close') { if (b.classList.contains('ov') && e.target !== b) return; closeSheet(); }
  else if (a === 'pushon') pushOn();
  else if (a === 'pushtest') pushTest();
  else if (a === 'fx') openSheet({ kind: 'fx', ds: b.dataset.d, k: b.dataset.k });
  else if (a === 'fxskip' && sheet?.kind === 'fx') { setFx(sheet.ds, sheet.k, { skip: true }); flash('Saltato solo per questo giorno'); }
  else if (a === 'fxreset' && sheet?.kind === 'fx') { setFx(sheet.ds, sheet.k, null); flash('Ripristinato'); }
  else if (a === 'mv' && S.tasks[id]) { const to = +b.dataset.v; put('tasks', id, { ...S.tasks[id], date: iso(addD(new Date(), to)) }); flash(to ? 'Spostata a domani' : 'Spostata a oggi'); }
  else if (a === 'gdone' && S.goals[id]) put('goals', id, { ...S.goals[id], done: !S.goals[id].done });
  else if (a === 'gdel' && S.goals[id]) { lastDel = ['goals', id, S.goals[id]]; put('goals', id, null); flash('Obiettivo eliminato', true); }
  else if (a === 'wk') { weekOff += +b.dataset.v; render(true); }
  else if (a === 'mo') { monthOff += +b.dataset.v; selDay = null; render(true); }
  else if (a === 'sel') { selDay = b.dataset.d; render(true); }
  else if (a === 'swap') { signup = !signup; render(true); }
  else if (a === 'logout') { await sb.auth.signOut(); user = null; for (const k of ['days', 'tasks', 'goals']) S[k] = {}; try { localStorage.removeItem(CACHE); } catch (x) {} render(true); }
  else if (a === 'export') {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), ...S }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'agenda-backup-' + iso(new Date()) + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }
});
app.addEventListener('change', e => {
  const t = e.target; if (t.dataset.act !== 'top') return;
  const ds = t.dataset.d || iso(new Date()), top = [...(S.days[ds]?.top || ['', '', ''])]; top[+t.dataset.i] = t.value.trim();
  setDay(ds, { top }, true);
});
app.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.act === 'top') e.target.blur();
  // Widget da tastiera: Invio o spazio lo aprono.
  if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.act === 'open' && e.target.tagName === 'DIV') { e.preventDefault(); e.target.click(); }
  if (e.key === 'Escape' && sheet) closeSheet();
});
// Trascinare il pannello in giù (dalla maniglia o dall'intestazione) lo chiude.
let drag = null;
app.addEventListener('pointerdown', e => {
  const h = e.target.closest('.grab, .shh'); if (!h || e.target.closest('button')) return;
  const sh = h.closest('.sheet'); if (!sh) return;
  drag = { sh, y: e.clientY, dy: 0, t: Date.now() }; sh.style.transition = 'none';
  try { h.setPointerCapture(e.pointerId); } catch (x) {}
});
app.addEventListener('pointermove', e => {
  if (!drag) return;
  drag.dy = Math.max(0, e.clientY - drag.y); drag.sh.style.transform = `translateY(${drag.dy}px)`;
});
function endDrag() {
  if (!drag) return;
  const { sh, dy, t } = drag; drag = null;
  if (dy > 110 || (dy > 30 && dy / Math.max(1, Date.now() - t) > 0.6)) closeSheet();
  else { sh.style.transition = 'transform .2s ease-out'; sh.style.transform = ''; }
}
app.addEventListener('pointerup', endDrag);
app.addEventListener('pointercancel', endDrag);
app.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, fd = new FormData(f);
  if (f.dataset.form === 'login') {
    const err = document.getElementById('lerr'), email = String(fd.get('email')).trim(), password = String(fd.get('pw'));
    err.textContent = '';
    const r = signup ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
    if (r.error) { err.textContent = r.error.message; return; }
    if (!r.data.session) { err.textContent = 'Account creato: conferma dal link nell’email, poi accedi.'; signup = false; return; }
    user = r.data.session.user; render(true); loadAll(); pushInit(); return;
  }
  if (f.dataset.form === 'fxtime') { const t = String(fd.get('t') || ''); if (t) { setFx(f.dataset.d, f.dataset.k, { t }); flash('Orario cambiato solo per questo giorno'); } return; }
  const title = String(fd.get('title') || '').trim(); if (!title) return;
  if (f.dataset.form === 'task' || f.dataset.form === 'edit' || f.dataset.form === 'someday') {
    let time = String(fd.get('time') || ''), end = String(fd.get('end') || '');
    if (fd.get('allday')) { time = PL.from; end = PL.to; }
    if (end && (!time || end <= time)) { flash('L’ora di fine deve essere dopo quella di inizio'); return; }
    const v = { title, time, end, area: fd.get('area') || 'pers', dl: !!fd.get('dl') };
    if (f.dataset.form === 'edit') {
      const id = f.dataset.id; if (!S.tasks[id]) return;
      sheet = null; put('tasks', id, { ...S.tasks[id], ...v, date: fd.get('date') || null }); flash('Salvato'); return;
    }
    if (f.dataset.form === 'task') sheet = null;   // "Aggiungi" dal pulsante +: chiude il pannello
    put('tasks', uid(), { ...v, date: f.dataset.form === 'someday' ? null : (fd.get('date') || iso(new Date())), done: false });
  }
  else put('goals', uid(), { title, month: f.dataset.m, area: fd.get('area') || 'pers', done: false });
  flash('Aggiunto');
});
tundo.addEventListener('click', () => { if (lastDel) { put(lastDel[0], lastDel[1], lastDel[2]); lastDel = null; toast.classList.remove('show'); } });
window.addEventListener('hashchange', () => { sheet = null; render(true); });   // cambiare livello chiude il pannello
document.addEventListener('visibilitychange', () => { if (!document.hidden && user) loadAll(); });

// ---------- Avvio ----------
(async () => {
  const ready = C.supabaseUrl && !C.supabaseUrl.startsWith('INCOLLA') && window.supabase;
  if (!ready) { render(true); return; }
  sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey);
  const { data } = await sb.auth.getSession();
  user = data.session?.user || null;
  if (user) { cacheLoad(); render(true); loadAll(); pushInit(); } else render(true);
  sb.auth.onAuthStateChange((_ev, session) => { const u = session?.user || null; if (!!u !== !!user) { user = u; render(true); if (u) { loadAll(); pushInit(); } } });
})();
}
