// Запуск: node tests/worker.test.mjs
import assert from 'node:assert/strict';
import worker, { cleanSub, cleanWatch } from '../worker/index.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log('ok  ' + name);
}

// Простое хранилище вместо KV: get/put/delete/list с курсором
function fakeKv() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v, opts) { m.set(k, v); this.lastOpts = opts; },
    async delete(k) { m.delete(k); },
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? parseInt(cursor, 10) : 0;
      const slice = keys.slice(start, start + limit);
      const next = start + limit;
      return { keys: slice.map((name) => ({ name })), list_complete: next >= keys.length, cursor: String(next) };
    },
  };
}

const P256DH = 'B'.repeat(87);
const AUTH = 'a'.repeat(22);
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const mkSub = (endpoint) => ({ endpoint: endpoint || ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } });
const env = () => ({ SUBS: fakeKv(), ADMIN_TOKEN: 'admin-secret', VAPID_PUBLIC: 'PUBKEY' });
const call = (e, method, path, body, headers) =>
  worker.fetch(new Request('https://w.test' + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), e);
const admin = { Authorization: 'Bearer admin-secret' };

await test('health и vapid: открыты, без ключа vapid честный 503', async () => {
  const e = env();
  const h = await call(e, 'GET', '/health');
  assert.equal(h.status, 200);
  assert.deepEqual(await h.json(), { ok: true, v: 1, vapid: true });
  assert.deepEqual(await (await call(e, 'GET', '/vapid')).json(), { key: 'PUBKEY' });
  const e2 = env(); delete e2.VAPID_PUBLIC;
  assert.equal((await call(e2, 'GET', '/vapid')).status, 503);
  assert.equal((await call(e, 'GET', '/nothing')).status, 404);
});

await test('CORS: страница приложения и localhost можно, чужой сайт нет', async () => {
  const e = env();
  const ok = await call(e, 'GET', '/vapid', null, { Origin: 'https://digitalcreatorhub.github.io' });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://digitalcreatorhub.github.io');
  const local = await call(e, 'GET', '/vapid', null, { Origin: 'http://localhost:8080' });
  assert.equal(local.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8080');
  const bad = await call(e, 'GET', '/vapid', null, { Origin: 'https://evil.example' });
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  const pre = await call(e, 'OPTIONS', '/sync', null, { Origin: 'https://digitalcreatorhub.github.io' });
  assert.equal(pre.status, 204);
});

await test('cleanSub: только настоящие push-сервисы, ключи нужной формы', () => {
  assert.ok(cleanSub(mkSub()));
  assert.ok(cleanSub(mkSub('https://updates.push.services.mozilla.com/wpush/v2/x')));
  assert.ok(cleanSub(mkSub('https://web.push.apple.com/QAbc')));
  assert.ok(cleanSub(mkSub('https://wns2-par02p.notify.windows.com/w/?token=x')));
  assert.equal(cleanSub(mkSub('http://fcm.googleapis.com/x')), null); // не https
  assert.equal(cleanSub(mkSub('https://evil.example/fcm.googleapis.com')), null); // чужой хост
  assert.equal(cleanSub(mkSub('https://fcm.googleapis.com.evil.example/x')), null); // похожее имя
  assert.equal(cleanSub(mkSub('https://user:pw@fcm.googleapis.com/x')), null);
  assert.equal(cleanSub(mkSub('https://169.254.169.254/latest')), null);
  assert.equal(cleanSub({ endpoint: ENDPOINT, keys: { p256dh: 'short', auth: AUTH } }), null);
  assert.equal(cleanSub({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: 'bad auth!' } }), null);
  assert.equal(cleanSub(null), null);
  assert.equal(cleanSub({ endpoint: 'x'.repeat(700) }), null);
});

await test('cleanWatch: числа, повторы, предел, мусор в названиях', () => {
  const w = cleanWatch([{ napId: 'a', name: '  Имя\n', free: 0 }, { napId: 'a', name: 'дубль' }, { napId: 'b', free: 'x' }, { napId: '' }, null, { napId: 'c', free: 3 }]);
  assert.deepEqual(w, [{ napId: 'a', name: 'Имя', free: 0 }, { napId: 'b', name: '', free: null }, { napId: 'c', name: '', free: 3 }]);
  const many = cleanWatch(Array.from({ length: 50 }, (_, i) => ({ napId: 'n' + i })));
  assert.equal(many.length, 20);
  assert.equal(cleanWatch('no'), null);
});

await test('sync: сохраняет подписку, TTL, повторный sync не затирает состояние сервера', async () => {
  const e = env();
  const r = await call(e, 'POST', '/sync', { sub: mkSub(), lang: 'en', watch: [{ napId: 'S1', name: 'Galleria', free: 0 }] });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, watching: 1 });
  assert.equal(e.SUBS.m.size, 1);
  assert.ok(e.SUBS.lastOpts.expirationTtl >= 30 * 24 * 3600);
  // сервер сменил состояние (занято -> свободно), приложение присылает старое значение 0
  const key = [...e.SUBS.m.keys()][0];
  const rec = JSON.parse(e.SUBS.m.get(key));
  rec.watch[0].free = 2;
  e.SUBS.m.set(key, JSON.stringify(rec));
  await call(e, 'POST', '/sync', { sub: mkSub(), lang: 'ru', watch: [{ napId: 'S1', name: 'Galleria', free: 0 }, { napId: 'S2', name: 'Новая', free: 1 }] });
  const after = JSON.parse(e.SUBS.m.get(key));
  assert.equal(after.watch.find((w) => w.napId === 'S1').free, 2); // осталось серверное
  assert.equal(after.watch.find((w) => w.napId === 'S2').free, 1); // новая взяла значение приложения
  assert.equal(after.lang, 'ru');
});

await test('sync: плохие запросы отклоняются, пустой список удаляет подписку', async () => {
  const e = env();
  assert.equal((await call(e, 'POST', '/sync', 'not json')).status, 400);
  assert.equal((await call(e, 'POST', '/sync', { sub: { endpoint: 'https://evil.example/x', keys: {} }, watch: [] })).status, 400);
  assert.equal((await call(e, 'POST', '/sync', { sub: mkSub(), watch: 'x' })).status, 400);
  assert.equal((await call(e, 'POST', '/sync', 'x'.repeat(9000))).status, 400);
  await call(e, 'POST', '/sync', { sub: mkSub(), watch: [{ napId: 'S1' }] });
  assert.equal(e.SUBS.m.size, 1);
  const r = await call(e, 'POST', '/sync', { sub: mkSub(), watch: [] });
  assert.equal((await r.json()).watching, 0);
  assert.equal(e.SUBS.m.size, 0);
});

await test('unsubscribe: удаляет подписку, мусор отклоняет', async () => {
  const e = env();
  await call(e, 'POST', '/sync', { sub: mkSub(), watch: [{ napId: 'S1' }] });
  assert.equal((await call(e, 'POST', '/unsubscribe', { endpoint: 5 })).status, 400);
  assert.equal((await call(e, 'POST', '/unsubscribe', { endpoint: ENDPOINT })).status, 200);
  assert.equal(e.SUBS.m.size, 0);
});

await test('subs и state: без пароля 401, с паролем постранично', async () => {
  const e = env();
  for (let i = 0; i < 5; i++) await call(e, 'POST', '/sync', { sub: mkSub('https://fcm.googleapis.com/fcm/send/u' + i), watch: [{ napId: 'S' + i, name: 'N' + i, free: 0 }] });
  assert.equal((await call(e, 'GET', '/subs')).status, 401);
  assert.equal((await call(e, 'GET', '/subs', null, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await call(e, 'POST', '/state', { updates: [], remove: [] })).status, 401);
  const p1 = await (await call(e, 'GET', '/subs?limit=2', null, admin)).json();
  assert.equal(p1.items.length, 2);
  assert.ok(p1.cursor);
  const seen = [...p1.items];
  let cursor = p1.cursor;
  while (cursor) {
    const p = await (await call(e, 'GET', '/subs?limit=2&cursor=' + cursor, null, admin)).json();
    seen.push(...p.items); cursor = p.cursor;
  }
  assert.equal(new Set(seen.map((x) => x.key)).size, 5);
  assert.ok(seen[0].sub.endpoint && Array.isArray(seen[0].watch) && seen[0].lang);
});

await test('state: обновляет, удаляет, не воскрешает удалённое, отвергает чужие ключи', async () => {
  const e = env();
  await call(e, 'POST', '/sync', { sub: mkSub(), watch: [{ napId: 'S1', name: 'A', free: 0 }] });
  await call(e, 'POST', '/sync', { sub: mkSub('https://fcm.googleapis.com/fcm/send/other'), watch: [{ napId: 'S2', name: 'B', free: 0 }] });
  const [k1, k2] = [...e.SUBS.m.keys()];
  const r = await call(e, 'POST', '/state', { updates: [{ key: k1, watch: [{ napId: 'S1', name: 'A', free: 4 }] }, { key: 'evil', watch: [] }, { key: 's:' + '0'.repeat(64), watch: [{ napId: 'Z' }] }], remove: [k2, 'bad'] }, admin);
  assert.deepEqual(await r.json(), { ok: true, updated: 1, removed: 1 });
  assert.equal(JSON.parse(e.SUBS.m.get(k1)).watch[0].free, 4);
  assert.equal(e.SUBS.m.has(k2), false);
  assert.equal(e.SUBS.m.has('s:' + '0'.repeat(64)), false); // несуществующую не создаём
  assert.equal((await call(e, 'POST', '/state', { updates: Array.from({ length: 100 }, () => ({})) }, admin)).status, 400);
});

await test('без ADMIN_TOKEN в окружении админ-ручки закрыты для всех', async () => {
  const e = env(); delete e.ADMIN_TOKEN;
  assert.equal((await call(e, 'GET', '/subs', null, { Authorization: 'Bearer ' })).status, 401);
  assert.equal((await call(e, 'GET', '/subs', null, { Authorization: 'Bearer undefined' })).status, 401);
});

console.log('\n' + passed + ' tests passed');
