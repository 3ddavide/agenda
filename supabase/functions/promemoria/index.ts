// Edge Function "promemoria": invia la notifica serale "Prepara domani" all'iPhone.
//
// Chiamate possibili (POST, corpo JSON):
//   { "mode": "cron" }  da pg_cron, con l'intestazione x-cron-secret (segreto nel Vault del database).
//                       Invia solo se in Italia sono le 21 (vedi migrazione_promemoria_cron.sql).
//   { "mode": "test" }  dal pulsante "Invia notifica di prova", con il login dell'utente.
//
// Segreti necessari (Supabase → Edge Functions → Secrets):
//   VAPID_PRIVATE_KEY   chiave privata VAPID (mai nel repository).
//   SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono già disponibili in automatico.
// Impostazione: "Verify JWT" DISATTIVATO (l'autorizzazione è controllata qui sotto).

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// Chiave PUBBLICA VAPID (la stessa di config.js).
const VAPID_PUBLIC = 'BCVC2YpGYYc9tWnt7jNQ5hNTSA0Mez_7SkEFkDVx6cVvQUPicR9aSnTSbqL9IQBSnkMM6cRD6NMZiGGwJCHiYCg';
const VAPID_SUBJECT = 'https://3ddavide.github.io/agenda/';
const APP_URL = './#oggi';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---------- Date in ora italiana (gestisce da sola l'ora legale) ----------
function romeNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]));
  const today = `${p.year}-${p.month}-${p.day}`;
  const t = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + 1));
  return { today, tomorrow: t.toISOString().slice(0, 10), hour: +p.hour, minute: +p.minute };
}

// ---------- Utilità byte / base64url ----------
const enc = new TextEncoder();
const b64uDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const b64uEncode = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// ---------- VAPID (RFC 8292): firma che dimostra chi invia ----------
let vapidKey: CryptoKey | null = null;
async function vapidAuth(endpoint: string) {
  if (!vapidKey) {
    const d = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!d) throw new Error('Manca il segreto VAPID_PRIVATE_KEY');
    const pub = b64uDecode(VAPID_PUBLIC);
    vapidKey = await crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', d: d.trim(), x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), ext: true,
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  const head = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidKey, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64uEncode(sig)}, k=${VAPID_PUBLIC}`;
}

// ---------- Cifratura del messaggio (RFC 8291, aes128gcm) ----------
async function encrypt(payload: Uint8Array, p256dh: string, authSecret: string) {
  const uaPub = b64uDecode(p256dh), auth = b64uDecode(authSecret);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, cipher);
}

type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string };
async function sendPush(sub: Sub, message: object) {
  const body = await encrypt(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '43200',
      Urgency: 'normal',
    },
    body,
  });
  return { status: r.status, text: r.ok ? '' : await r.text() };
}

// ---------- Il messaggio della sera ----------
async function buildMessage(db: ReturnType<typeof createClient>, userId: string) {
  const { today, tomorrow } = romeNow();
  const late = await db.from('tasks').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('done', false).lt('date', today);
  const day = await db.from('days').select('top').eq('user_id', userId).eq('date', tomorrow).maybeSingle();
  if (late.error) throw late.error;
  if (day.error) throw day.error;
  const n = late.count ?? 0;
  const top = Array.isArray(day.data?.top) ? day.data!.top as unknown[] : [];
  const ready = top.some(s => typeof s === 'string' && s.trim() !== '');
  if (ready) {
    return { title: 'Abitudini di oggi', body: 'Le priorità di domani sono pronte. Prima di dormire, segna le abitudini di oggi.', tag: 'prepara-domani', url: APP_URL };
  }
  const sospese = n === 0 ? 'Nessuna attività in sospeso' : n === 1 ? 'Hai 1 attività in sospeso' : `Hai ${n} attività in sospeso`;
  return { title: 'Prepara domani', body: `${sospese} e non hai ancora scritto le priorità di domani.`, tag: 'prepara-domani', url: APP_URL };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'usa POST' }, 405);
  const input = await req.json().catch(() => ({})) as { mode?: string };
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Chi può chiamarla e per quali utenti.
  let userIds: string[];
  let prefix = '';
  if (input.mode === 'cron') {
    const { data: secret, error } = await db.rpc('promemoria_secret');
    if (error || !secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'non autorizzato' }, 401);
    const { hour } = romeNow();
    if (hour !== 21) return json({ skipped: `in Italia sono le ${hour}: invio solo alle 21` });
    const { data, error: e2 } = await db.from('push_subs').select('user_id');
    if (e2) return json({ error: e2.message }, 500);
    userIds = [...new Set((data ?? []).map(r => r.user_id as string))];
  } else if (input.mode === 'test') {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return json({ error: 'devi essere collegato' }, 401);
    userIds = [data.user.id];
    prefix = 'Prova · ';
  } else {
    return json({ error: 'mode deve essere "cron" o "test"' }, 400);
  }

  let sent = 0, failed = 0, removed = 0;
  const errors: string[] = [];
  for (const userId of userIds) {
    const { data: subs, error } = await db.from('push_subs').select('*').eq('user_id', userId);
    if (error) { errors.push(error.message); continue; }
    if (!subs?.length) continue;
    let msg;
    try { msg = await buildMessage(db, userId); } catch (e) { errors.push(String(e)); continue; }
    msg = { ...msg, title: prefix + msg.title };
    for (const sub of subs as Sub[]) {
      try {
        const r = await sendPush(sub, msg);
        if (r.status >= 200 && r.status < 300) sent++;
        else if (r.status === 404 || r.status === 410) { await db.from('push_subs').delete().eq('endpoint', sub.endpoint); removed++; }
        else { failed++; errors.push(`${r.status} ${r.text}`.slice(0, 200)); }
      } catch (e) { failed++; errors.push(String(e).slice(0, 200)); }
    }
  }
  return json({ sent, failed, removed, errors });
});
