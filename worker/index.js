/* Worker «uzlades-push»: хранилище подписок на пуши «освободилась зарядка».
   Сам пуши не шлёт: это делает GitHub Action раз в 15 минут (у него есть свежие данные и нет лимита процессора).
   Приложение:   GET /vapid, POST /sync, POST /unsubscribe
   GitHub Action: GET /subs, POST /state (нужен секрет ADMIN_TOKEN)
   Мониторинг:   GET /health */

const ALLOWED_ORIGINS = ['https://digitalcreatorhub.github.io'];
// Пуши идут только на адреса настоящих push-сервисов: иначе подписка могла бы указать на любой сайт
const PUSH_HOSTS = [
  /(^|\.)googleapis\.com$/, // Chrome, Android (FCM)
  /(^|\.)push\.services\.mozilla\.com$/, // Firefox
  /(^|\.)push\.apple\.com$/, // Safari, iPhone
  /(^|\.)notify\.windows\.com$/, // Edge
];
const TTL_SECONDS = 60 * 24 * 3600; // подписка живёт 60 дней с последнего открытия приложения
const MAX_BODY = 8 * 1024;
const MAX_WATCH = 20;
const PAGE_MAX = 40;
const MAX_TIMERS = 5;
const MAX_DIGEST_FAVS = 10;
const TIMER_WINDOW_MS = 12 * 3600 * 1000; // таймер зарядки: не дальше чем на 12 часов вперёд
const FIRED_KEEP = 20;
const B64URL = /^[A-Za-z0-9_-]+$/;

const json = (data, status, cors) =>
  new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors || {}) });

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return ok
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : {};
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Сравнение без утечки по времени: сравниваем хэши одинаковой длины
async function isAdmin(request, env) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || !given) return false;
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(env.ADMIN_TOKEN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return { error: 'too_large' };
  try { return { data: JSON.parse(text) }; } catch (e) { return { error: 'bad_json' }; }
}

// -> подписка в чистом виде или null
function cleanSub(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const { endpoint, keys } = sub;
  if (typeof endpoint !== 'string' || endpoint.length > 600) return null;
  let u;
  try { u = new URL(endpoint); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !PUSH_HOSTS.some((re) => re.test(u.hostname))) return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (keys.p256dh.length < 80 || keys.p256dh.length > 100 || !B64URL.test(keys.p256dh)) return null;
  if (keys.auth.length < 16 || keys.auth.length > 32 || !B64URL.test(keys.auth)) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function cleanWatch(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const w of list) {
    if (!w || typeof w.napId !== 'string' || !w.napId || w.napId.length > 160 || seen.has(w.napId)) continue;
    seen.add(w.napId);
    const free = Number.isInteger(w.free) && w.free >= 0 && w.free <= 200 ? w.free : null;
    out.push({ napId: w.napId, name: String(w.name == null ? '' : w.name).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80), free });
    if (out.length >= MAX_WATCH) break;
  }
  return out;
}

// Таймеры «зарядка до 80% готова»: [{ id, at (мс), name }], не больше MAX_TIMERS, срок от «час назад» до 12 часов вперёд
function cleanTimers(list, now) {
  if (!Array.isArray(list)) return [];
  const t0 = now == null ? Date.now() : now;
  const out = [];
  const seen = new Set();
  for (const x of list) {
    if (!x || typeof x.id !== 'string' || !/^[A-Za-z0-9_-]{1,24}$/.test(x.id) || seen.has(x.id)) continue;
    if (!Number.isInteger(x.at) || x.at < t0 - 3600 * 1000 || x.at > t0 + TIMER_WINDOW_MS) continue;
    seen.add(x.id);
    out.push({ id: x.id, at: x.at, name: String(x.name == null ? '' : x.name).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) });
    if (out.length >= MAX_TIMERS) break;
  }
  return out;
}

// Вечерняя сводка: { hour: 0..23, favs: [{ napId, name }] } или null
function cleanDigest(d) {
  if (!d || typeof d !== 'object' || !Number.isInteger(d.hour) || d.hour < 0 || d.hour > 23) return null;
  const favs = cleanWatch((d.favs || []).map((f) => ({ napId: f && f.napId, name: f && f.name })));
  if (!favs || !favs.length) return null;
  return { hour: d.hour, favs: favs.slice(0, MAX_DIGEST_FAVS).map((f) => ({ napId: f.napId, name: f.name })) };
}

const subKey = async (endpoint) => 's:' + (await sha256Hex(endpoint));

async function handleSync(request, env, cors) {
  const r = await readJson(request);
  if (r.error) return json({ error: r.error }, 400, cors);
  const sub = cleanSub(r.data && r.data.sub);
  const watch = cleanWatch(r.data && r.data.watch);
  if (!sub || !watch) return json({ error: 'bad_request' }, 400, cors);
  const key = await subKey(sub.endpoint);
  let old = null;
  try { old = await env.SUBS.get(key, 'json'); } catch (e) { old = null; }
  const fired = new Set((old && old.fired) || []);
  const timers = cleanTimers(r.data.timers).filter((x) => !fired.has(x.id)); // уже сработавший таймер заново не принимаем
  const digest = cleanDigest(r.data.digest);
  if (!watch.length && !timers.length && !digest) { await env.SUBS.delete(key); return json({ ok: true, watching: 0 }, 200, cors); }
  // Состояние «сколько было свободно» хранит сервер: у уже известных станций оставляем его, приложение задаёт только начальное
  const prev = new Map(((old && old.watch) || []).map((w) => [w.napId, w.free]));
  for (const w of watch) if (prev.has(w.napId) && prev.get(w.napId) != null) w.free = prev.get(w.napId);
  const lang = r.data.lang === 'en' || r.data.lang === 'lv' ? r.data.lang : 'ru';
  const rec = { sub, watch, lang, t: Date.now() };
  if (timers.length) rec.timers = timers;
  if (digest) { rec.digest = digest; if (old && old.digest && old.digest.last) rec.digest.last = old.digest.last; }
  if (old && old.fired && old.fired.length) rec.fired = old.fired;
  await env.SUBS.put(key, JSON.stringify(rec), { expirationTtl: TTL_SECONDS });
  return json({ ok: true, watching: watch.length, timers: timers.length, digest: !!digest }, 200, cors);
}

async function handleUnsubscribe(request, env, cors) {
  const r = await readJson(request);
  if (r.error) return json({ error: r.error }, 400, cors);
  const endpoint = r.data && r.data.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 600) return json({ error: 'bad_request' }, 400, cors);
  await env.SUBS.delete(await subKey(endpoint));
  return json({ ok: true }, 200, cors);
}

// Страница подписок для рассылки: ?cursor=...&limit=40 -> { items: [{ key, sub, watch, lang }], cursor }
async function handleSubs(request, env) {
  const url = new URL(request.url);
  const limit = Math.min(PAGE_MAX, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || PAGE_MAX));
  const page = await env.SUBS.list({ prefix: 's:', limit, cursor: url.searchParams.get('cursor') || undefined });
  const items = [];
  for (const k of page.keys) {
    const v = await env.SUBS.get(k.name, 'json');
    if (v && v.sub && Array.isArray(v.watch)) items.push({ key: k.name, sub: v.sub, watch: v.watch, lang: v.lang || 'ru', timers: v.timers || [], digest: v.digest || null });
  }
  return json({ items, cursor: page.list_complete ? null : page.cursor }, 200);
}

// Обновления от рассылки: { updates: [{ key, watch }], remove: [key] }
async function handleState(request, env) {
  const r = await readJson(request);
  if (r.error) return json({ error: r.error }, 400);
  const updates = Array.isArray(r.data && r.data.updates) ? r.data.updates : [];
  const remove = Array.isArray(r.data && r.data.remove) ? r.data.remove : [];
  if (updates.length + remove.length > PAGE_MAX * 2) return json({ error: 'too_many' }, 400);
  let updated = 0, removed = 0;
  for (const key of remove) {
    if (typeof key === 'string' && /^s:[0-9a-f]{64}$/.test(key)) { await env.SUBS.delete(key); removed++; }
  }
  for (const u of updates) {
    if (!u || typeof u.key !== 'string' || !/^s:[0-9a-f]{64}$/.test(u.key)) continue;
    const watch = cleanWatch(u.watch);
    if (!watch) continue;
    const old = await env.SUBS.get(u.key, 'json');
    if (!old) continue; // подписку уже удалили: не воскрешаем
    const next = Object.assign({}, old, { watch });
    if (Array.isArray(u.timers)) {
      const keep = cleanTimers(u.timers, 0).slice(0, MAX_TIMERS); // сроки уже проверены при приёме; здесь только форма
      if (keep.length) next.timers = keep; else delete next.timers;
    }
    if (Array.isArray(u.fired)) next.fired = u.fired.filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(x)).concat(old.fired || []).slice(0, FIRED_KEEP);
    if (typeof u.digestLast === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(u.digestLast) && next.digest) next.digest = Object.assign({}, next.digest, { last: u.digestLast });
    if (!next.watch.length && !(next.timers && next.timers.length) && !next.digest) { await env.SUBS.delete(u.key); removed++; continue; }
    await env.SUBS.put(u.key, JSON.stringify(next), { expirationTtl: TTL_SECONDS });
    updated++;
  }
  return json({ ok: true, updated, removed }, 200);
}

async function handle(request, env) {
  const url = new URL(request.url);
  const cors = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'GET' && path === '/health') return json({ ok: true, v: 1, vapid: !!env.VAPID_PUBLIC }, 200, cors);
  if (request.method === 'GET' && path === '/vapid') {
    return env.VAPID_PUBLIC ? json({ key: env.VAPID_PUBLIC }, 200, cors) : json({ error: 'not_configured' }, 503, cors);
  }
  if (request.method === 'POST' && path === '/sync') return handleSync(request, env, cors);
  if (request.method === 'POST' && path === '/unsubscribe') return handleUnsubscribe(request, env, cors);

  if (path === '/subs' || path === '/state') {
    if (!(await isAdmin(request, env))) return json({ error: 'unauthorized' }, 401);
    if (request.method === 'GET' && path === '/subs') return handleSubs(request, env);
    if (request.method === 'POST' && path === '/state') return handleState(request, env);
  }
  return json({ error: 'not_found' }, 404, cors);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      return json({ error: 'internal' }, 500);
    }
  },
};

export { handle, cleanSub, cleanWatch, cleanTimers, cleanDigest, PUSH_HOSTS };
