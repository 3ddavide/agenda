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
const VERSION = '2026-11-21.2';
const chain = {};

function flash(msg, undo) { tmsg.textContent = msg; tundo.hidden = !undo; toast.classList.add('show'); clearTimeout(flash.t); flash.t = setTimeout(() => toast.classList.remove('show'), undo ? 5000 : 1800); }
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
  } catch (e) { console.error(e); flash('Attivazione non riuscita: riprova'); }
}
async function pushTest() {
  flash('Invio in corso…');
  const { data, error } = await sb.functions.invoke('promemoria', { body: { mode: 'test' } });
  if (error) { console.error(error); flash('Prova non riuscita: controlla la Edge Function'); return; }
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
// La giornata completa: impegni fissi riorganizzati in base alle attività con fascia oraria.
function dayPlan(d) {
  const tasks = tasksOn(iso(d)), fx = fixed(d), busy = tasks.filter(x => x.rs != null);
  const names = list => list.map(b => b.n).join(', ');
  // 1) Impegni fissi non spostabili (università, laboratorio): restano, ma segnalati.
  for (const x of fx) if (x.rs != null && !x.mv && !x.skip) {
    const c = busy.filter(b => overlaps(x, b));
    if (!c.length) continue;
    x.skip = c.some(b => b.rs <= x.rs && b.re >= x.re);
    x.why = (x.why ? x.why + ' · ' : '') + (x.skip ? 'Saltato per ' : 'Sovrapposto a ') + names(c);
  }
  const arrivo = fx.find(x => x.uni && x.rs != null);
  for (const x of fx) if (x.uni && x.rs == null && arrivo?.skip) { x.skip = true; x.why = arrivo.why; }
  // 2) Impegni spostabili (allenamenti, pulizia): se toccano un'attività, si spostano.
  const clash = x => busy.filter(b => overlaps(x, b));
  const toMove = fx.filter(x => x.rs != null && x.mv && !x.skip && clash(x).length);
  const blocks = [...busy, ...fx.filter(x => x.rs != null && !x.skip && !toMove.includes(x))];
  for (const x of toMove) {
    const c = clash(x), len = x.re - x.rs, s = freeSlot(blocks, len, x.rs);
    if (s === null) { x.skip = true; x.why = 'Saltato per ' + names(c) + ': nessun orario libero'; continue; }
    x.why = 'Spostato dalle ' + x.t + ' per ' + names(c);
    x.t = toHM(s); if (x.e) x.e = toHM(s + len); x.rs = s; x.re = s + len;
    blocks.push(x);
  }
  return [...fx, ...tasks].sort((a, b) => (a.t || '99').localeCompare(b.t || '99'));
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
  return '<ul class="ag">' + it.map(x => `<li class="${x.done ? 'done' : ''}${x.skip ? ' skip' : ''}">
    <span class="tm">${x.t ? esc(x.t) + (x.e ? '<small>' + esc(x.e) + '</small>' : '') : '—'}</span>
    <span class="dot ${esc(x.a)}"></span>
    <span class="tt${x.fx ? ' fx' : ''}">${x.dl ? '<span class="dl">Scadenza · </span>' : ''}${x.id ? taskName(x.id, x.n) : `<span class="nm">${esc(x.n)}</span>`}${x.why ? '<small class="why">' + esc(x.why) + '</small>' : ''}</span>
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
function viewOggi() {
  const d = new Date(), ds = iso(d), day = S.days[ds] || {}, h = day.h || {}, n = countDay(ds), w = d.getDay(), tr = trainOf(d);
  const trHero = !tr ? 'giorno di riposo' : tr.skip ? 'allenamento saltato oggi' : 'allenamento: ' + esc(tr.n.toLowerCase()) + ' alle ' + esc(tr.t);
  const trHab = !tr ? 'Oggi riposo: spunta se hai rispettato il piano' : tr.skip ? esc(tr.why) : 'In programma: ' + esc(tr.n) + ' alle ' + esc(tr.t) + (tr.why ? ' (spostato)' : '');
  const top = day.top || ['', '', ''], topd = day.topd || [false, false, false];
  const ph = ['La cosa più importante di oggi', 'Seconda priorità', 'Terza priorità'];
  return `<section class="hero"><p class="kick">${GG[w]}</p><h1>${d.getDate()} ${MM[d.getMonth()]}</h1>
  <p class="sub">${n} di ${HAB.length} abitudini · ${trHero}</p></section>
  <section class="card"><div class="ch"><h2>Abitudini</h2><span class="meter" aria-label="${n} su ${HAB.length}"><i style="width:${Math.round(pctDay(ds) * 100)}%"></i></span></div>
  <ul class="habits">${HAB.map(([k, l]) => `<li><button class="hab${h[k] ? ' on' : ''}" data-act="hab" data-d="${ds}" data-k="${esc(k)}" aria-pressed="${!!h[k]}">
    <span class="tick"></span><span class="hl">${esc(l)}${k === 'allen' ? `<small>${trHab}</small>` : ''}</span>
    <span class="streak">${streak(k)}</span></button></li>`).join('')}</ul></section>
  <section class="card"><h2>3 priorità</h2>${[0, 1, 2].map(i => `<div class="pri${topd[i] ? ' on' : ''}"><button class="chk${topd[i] ? ' on' : ''}" data-act="topd" data-i="${i}" aria-label="Priorità ${i + 1} fatta" aria-pressed="${!!topd[i]}"></button>
    <input id="pri${i}" data-act="top" data-i="${i}" value="${esc(top[i])}" placeholder="${ph[i]}" aria-label="Priorità ${i + 1}"></div>`).join('')}</section>
  ${pushCard()}
  ${d.getHours() >= 19 ? tomorrowCard(addD(d, 1)) : ''}
  ${lateCard(ds)}
  <section class="card"><h2>Agenda di oggi</h2>${agenda(d)}</section>
  ${addForm(ds)}${footer()}`;
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

function viewSett() {
  const today = iso(new Date()), m = addD(monday(new Date()), weekOff * 7), days = [...Array(7)].map((_, i) => addD(m, i)), e = days[6];
  const lbl = m.getMonth() === e.getMonth() ? `${m.getDate()}–${e.getDate()} ${MM[e.getMonth()]}` : `${m.getDate()} ${MM[m.getMonth()].slice(0, 3)} – ${e.getDate()} ${MM[e.getMonth()].slice(0, 3)}`;
  const inWeek = days.some(d => iso(d) === today);
  return `<div class="navrow"><button data-act="wk" data-v="-1" aria-label="Settimana precedente">‹</button><h1>${lbl}</h1><button data-act="wk" data-v="1" aria-label="Settimana successiva">›</button></div>
  <section class="card"><h2>Abitudini della settimana</h2><div class="scroll"><table class="grid">
  <thead><tr><th></th>${days.map(d => `<th class="${iso(d) === today ? 'td' : ''}">${GS[d.getDay()]}<small>${d.getDate()}</small></th>`).join('')}</tr></thead>
  <tbody>${HAB.map(([k, l]) => `<tr><th scope="row">${esc(l)}</th>${days.map(d => {
    const ds = iso(d), on = S.days[ds]?.h?.[k];
    return `<td><button class="dotb${on ? ' on' : ''}" data-act="hab" data-d="${ds}" data-k="${esc(k)}" aria-pressed="${!!on}" aria-label="${esc(l)}, ${GG[d.getDay()]} ${d.getDate()}"></button></td>`;
  }).join('')}</tr>`).join('')}
  <tr class="pct"><th scope="row">Totale</th>${days.map(d => { const ds = iso(d); return `<td>${ds > today ? '–' : Math.round(pctDay(ds) * 100) + '%'}</td>`; }).join('')}</tr></tbody></table></div></section>
  <section class="days">${days.map(d => `<div class="day${iso(d) === today ? ' today' : ''}"><h3>${GG[d.getDay()]} <span>${d.getDate()}</span></h3>${agenda(d)}</div>`).join('')}</section>
  ${somedayCard()}
  ${addForm(inWeek ? today : iso(m))}${footer()}`;
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

function viewMese() {
  const now = new Date(), today = iso(now), first = new Date(now.getFullYear(), now.getMonth() + monthOff, 1);
  const mk = first.getFullYear() + '-' + pad(first.getMonth() + 1), dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const start = monday(first), weeks = Math.ceil((((first.getDay() + 6) % 7) + dim) / 7);
  if (!selDay || selDay.slice(0, 7) !== mk) selDay = today.slice(0, 7) === mk ? today : mk + '-01';
  const cells = [...Array(weeks * 7)].map((_, i) => {
    const d = addD(start, i), ds = iso(d), inm = d.getMonth() === first.getMonth();
    const p = inm && ds <= today ? pctDay(ds) : 0, ts = inm ? tasksOn(ds) : [];
    return `<button class="cell${inm ? '' : ' out'}${ds === today ? ' td' : ''}${ds === selDay ? ' sel' : ''}" style="--p:${p}" data-act="sel" data-d="${ds}" aria-label="${d.getDate()} ${MM[d.getMonth()]}"><span class="num">${d.getDate()}</span><span class="dots">${ts.slice(0, 4).map(t => `<i class="${t.dl ? 'dlx' : esc(t.a)}"></i>`).join('')}</span></button>`;
  }).join('');
  const sd = parse(selDay);
  const dls = Object.entries(S.tasks).filter(([, t]) => t.dl && t.date && t.date.slice(0, 7) === mk).sort((a, b) => a[1].date.localeCompare(b[1].date));
  const goals = Object.entries(S.goals).filter(([, g]) => g.month === mk);
  return `<div class="navrow"><button data-act="mo" data-v="-1" aria-label="Mese precedente">‹</button><h1>${MM[first.getMonth()]} ${first.getFullYear()}</h1><button data-act="mo" data-v="1" aria-label="Mese successivo">›</button></div>
  <section class="card"><div class="cal">${['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(x => `<span class="wd">${x}</span>`).join('')}${cells}</div>
  <div class="legend"><span>Più è blu il giorno, più abitudini hai rispettato</span><span><i class="dot uni"></i>Università</span><span><i class="dot sport"></i>Sport</span><span><i class="dot lavoro"></i>Lavoro</span><span><i class="dot pers"></i>Personale</span><span><i class="dot eventi"></i>Eventi</span><span><i class="dot" style="background:var(--red)"></i>Scadenza</span></div></section>
  <section class="card"><h2>${GG[sd.getDay()]} ${sd.getDate()} ${MM[sd.getMonth()]}</h2>${agenda(sd)}</section>
  <section class="card"><h2>Scadenze del mese</h2>${dls.length ? '<ul class="ag">' + dls.map(([id, t]) => { const d = parse(t.date); return `<li class="${t.done ? 'done' : ''}"><span class="tm">${d.getDate()} ${MM[d.getMonth()].slice(0, 3)}</span><span class="dot" style="background:var(--red)"></span><span class="tt">${esc(t.title)}</span><span class="acts"><button class="mini${t.done ? ' on' : ''}" data-act="done" data-id="${id}" aria-label="Segna come fatto">✓</button></span></li>`; }).join('') + '</ul>' : '<p class="empty">Nessuna scadenza. Aggiungile da “Aggiungi attività” spuntando “È una scadenza”.</p>'}</section>
  <section class="card"><h2>Obiettivi di ${MM[first.getMonth()]}</h2>
  ${goals.length ? '<ul class="goals">' + goals.map(([id, g]) => `<li class="${g.done ? 'done' : ''}"><button class="chk${g.done ? ' on' : ''}" data-act="gdone" data-id="${id}" aria-label="Obiettivo raggiunto" aria-pressed="${!!g.done}"></button><i class="dot ${esc(g.area || 'pers')}"></i><span class="tt">${esc(g.title)}</span><button class="mini" data-act="gdel" data-id="${id}" aria-label="Elimina obiettivo">×</button></li>`).join('') + '</ul>' : '<p class="empty">Scegli uno o due obiettivi per questo mese, non di più.</p>'}
  <form data-form="goal" data-m="${mk}"><div class="row"><input name="title" placeholder="3 allenamenti a settimana per tutto il mese" required aria-label="Nuovo obiettivo"><select name="area" aria-label="Area">${areaOpts('sport')}</select><button class="primary">Aggiungi</button></div></form></section>${footer()}`;
}

// Modulo che si apre sopra la pagina (modifica attività, opzioni impegni fissi).
function sheetView() {
  if (!sheet) return '';
  let body = '';
  if (sheet.kind === 'task') {
    const t = S.tasks[sheet.id]; if (!t) { sheet = null; return ''; }
    body = `<form class="card sheet" data-form="edit" data-id="${sheet.id}"><h2>Modifica attività</h2>
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
    body = `<form class="card sheet" data-form="fxtime" data-d="${sheet.ds}" data-k="${esc(sheet.k)}"><h2>${esc(x.n)}</h2>
    <p class="sub">${GG[d.getDay()]} ${d.getDate()} ${MM[d.getMonth()]} · di solito alle ${esc(x.t0)}</p>
    <div class="row"><button type="button" class="ghost" data-act="fxskip">Salta solo ${when}</button></div>
    <div class="row"><label class="tl">Nuovo orario<input type="time" name="t" value="${esc(x.skip ? x.t0 : x.t)}" required></label><button class="primary">Sposta solo ${when}</button></div>
    ${x.ov ? '<div class="row"><button type="button" class="ghost" data-act="fxreset">Ripristina come al solito</button></div>' : ''}
    <div class="row end"><button type="button" class="ghost" data-act="close">Annulla</button></div></form>`;
  }
  return `<div class="ov" data-act="close">${body}</div>`;
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

const VIEWS = { oggi: viewOggi, settimana: viewSett, mese: viewMese };
function cur() { const h = location.hash.slice(1); return VIEWS[h] ? h : 'oggi'; }
function render(force) {
  const a = document.activeElement;
  if (!force && a && app.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) { pending = true; return; }
  pending = false;
  document.body.classList.toggle('out', !user);
  if (!user) { app.innerHTML = viewLogin(); return; }
  const v = cur();
  for (const l of document.querySelectorAll('.tabs a')) {
    if (l.getAttribute('href') === '#' + v) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current');
  }
  app.innerHTML = VIEWS[v]() + sheetView();
}

// ---------- Eventi ----------
app.addEventListener('focusout', () => setTimeout(() => { if (pending && !app.contains(document.activeElement)) render(); }, 0));
app.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === 'hab') { const ds = b.dataset.d, h = { ...(S.days[ds]?.h || {}) }; h[b.dataset.k] = !h[b.dataset.k]; setDay(ds, { h }); }
  else if (a === 'topd') { const ds = iso(new Date()), td = [...(S.days[ds]?.topd || [false, false, false])]; td[+b.dataset.i] = !td[+b.dataset.i]; setDay(ds, { topd: td }); }
  else if (a === 'done' && S.tasks[id]) put('tasks', id, { ...S.tasks[id], done: !S.tasks[id].done });
  else if (a === 'del' && S.tasks[id]) { lastDel = ['tasks', id, S.tasks[id]]; put('tasks', id, null); flash('Attività eliminata', true); }
  else if (a === 'edit' && S.tasks[id]) { sheet = { kind: 'task', id }; render(true); }
  else if (a === 'close') { if (b.classList.contains('ov') && e.target !== b) return; sheet = null; render(true); }
  else if (a === 'pushon') pushOn();
  else if (a === 'pushtest') pushTest();
  else if (a === 'fx') { sheet = { kind: 'fx', ds: b.dataset.d, k: b.dataset.k }; render(true); }
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
app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.act === 'top') e.target.blur(); });
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
    put('tasks', uid(), { ...v, date: f.dataset.form === 'someday' ? null : (fd.get('date') || iso(new Date())), done: false });
  }
  else put('goals', uid(), { title, month: f.dataset.m, area: fd.get('area') || 'pers', done: false });
  flash('Aggiunto');
});
tundo.addEventListener('click', () => { if (lastDel) { put(lastDel[0], lastDel[1], lastDel[2]); lastDel = null; toast.classList.remove('show'); } });
window.addEventListener('hashchange', () => render(true));
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
