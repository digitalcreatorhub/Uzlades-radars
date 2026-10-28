// Запуск: node tests/push.test.mjs
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { deriveVapid, deriveAdminToken } from '../scripts/push_keys.mjs';
import { isFresh, freeMapOf, evaluate, textFor, evaluateTimers, evaluateDigest, timerText } from '../scripts/push_logic.mjs';
import { run } from '../scripts/send_push.mjs';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok  ' + name); }

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const live = (sites, ageMin) => ({ v: 1, generated: iso(NOW - 2 * 60000), statusTime: iso(NOW - (ageMin == null ? 3 : ageMin) * 60000), sites });
const site = (id, states) => ({ id, pts: states.map((s) => ({ s })) });
const APP = 'https://digitalcreatorhub.github.io/Uzlades-radars/';

await test('ключи: одинаковый секрет даёт одинаковые ключи, формат подходит для Web Push', () => {
  const secret = 'cfut_' + 'x'.repeat(40);
  const a = deriveVapid(secret);
  const b = deriveVapid(secret);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, deriveVapid(secret + 'y'));
  const priv = Buffer.from(a.privateKey, 'base64url');
  const pub = Buffer.from(a.publicKey, 'base64url');
  assert.equal(priv.length, 32);
  assert.equal(pub.length, 65);
  assert.equal(pub[0], 4); // несжатая точка
  const e = createECDH('prime256v1'); e.setPrivateKey(priv);
  assert.deepEqual(e.getPublicKey(), pub); // открытый ключ действительно от закрытого
  assert.match(deriveAdminToken(secret), /^[0-9a-f]{64}$/);
  assert.notEqual(deriveAdminToken(secret), deriveAdminToken(secret + 'y'));
  assert.notEqual(deriveAdminToken(secret), a.privateKey);
  assert.throws(() => deriveVapid('short'));
  assert.throws(() => deriveAdminToken(undefined));
});

await test('isFresh: граница 90 минут и мусор', () => {
  assert.equal(isFresh(live([], 89), NOW), true);
  assert.equal(isFresh(live([], 91), NOW), false);
  assert.equal(isFresh({}, NOW), false);
  assert.equal(isFresh(null, NOW), false);
  assert.equal(isFresh({ generated: iso(NOW - 60000) }, NOW), true);
});

await test('freeMapOf: считает свободные точки, станции без точек пропускает', () => {
  const m = freeMapOf(live([site('A', ['free', 'busy', 'free']), site('B', ['busy', 'out', 'unk']), { id: 'C', pts: [] }, { id: 'D' }, null]));
  assert.deepEqual([...m], [['A', 2], ['B', 0]]);
  assert.equal(freeMapOf(null).size, 0);
});

await test('evaluate: пуш только при переходе 0 -> больше нуля, состояние обновляется', () => {
  const rec = { lang: 'ru', watch: [
    { napId: 'A', name: 'Galleria', free: 0 }, // стала свободна: пуш
    { napId: 'B', name: 'Virši', free: 0 }, // всё ещё занята
    { napId: 'C', name: 'Свободная', free: 3 }, // была свободна, свободна: молчим
    { napId: 'D', name: 'Была свободна', free: 2 }, // стала занята: молчим, запоминаем 0
    { napId: 'E', name: 'Новая', free: null }, // начальное состояние: молчим, запоминаем
    { napId: 'F', name: 'Нет в данных', free: 0 }, // нет данных: не трогаем
  ] };
  const fm = freeMapOf(live([site('A', ['free', 'busy']), site('B', ['busy']), site('C', ['free', 'free', 'free']), site('D', ['busy', 'busy']), site('E', ['free'])]));
  const r = evaluate(rec, fm, APP);
  assert.equal(r.messages.length, 1);
  assert.deepEqual(r.messages[0], { napId: 'A', title: 'Uzlādes Radars', body: 'Освободилась зарядка: Galleria', url: APP + '?st=A', tag: 'watch-n:A' });
  assert.deepEqual(r.watch.map((w) => [w.napId, w.free]), [['A', 1], ['B', 0], ['C', 3], ['D', 0], ['E', 1], ['F', 0]]);
  assert.equal(r.changed, true);
  const again = evaluate({ lang: 'ru', watch: r.watch }, fm, APP);
  assert.equal(again.messages.length, 0); // повторный запуск не шлёт то же самое
  assert.equal(again.changed, false);
});

await test('evaluate: английский текст, адрес кодируется, пустое имя', () => {
  assert.equal(textFor('en', 'X'), 'A charger is free: X');
  assert.equal(textFor('ru', ''), 'Освободилась зарядка: Станция');
  const fm = freeMapOf(live([site('Elektrum Drive-9ace/8d31', ['free'])]));
  const r = evaluate({ lang: 'en', watch: [{ napId: 'Elektrum Drive-9ace/8d31', name: 'Sunīši', free: 0 }] }, fm, APP);
  assert.equal(r.messages[0].body, 'A charger is free: Sunīši');
  assert.equal(r.messages[0].url, APP + '?st=Elektrum%20Drive-9ace%2F8d31');
  assert.deepEqual(evaluate(null, fm, APP), { watch: [], messages: [], changed: false });
});

// Поддельный Worker для проверки всей цепочки run(): страницы подписок, отправка, обновление состояния
function fakeWorker(items, pageSize) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: (opts && opts.method) || 'GET', auth: opts.headers.Authorization, body: opts.body && JSON.parse(opts.body) });
    if (u.pathname === '/subs') {
      const start = parseInt(u.searchParams.get('cursor') || '0', 10);
      const slice = items.slice(start, start + pageSize);
      const next = start + pageSize;
      return { ok: true, status: 200, json: async () => ({ items: slice, cursor: next < items.length ? String(next) : null }) };
    }
    if (u.pathname === '/state') {
      const b = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ ok: true, updated: b.updates.length, removed: b.remove.length }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { calls, fetchImpl };
}
const mkItem = (key, napId, free, lang) => ({ key, sub: { endpoint: 'https://fcm.googleapis.com/' + key, keys: { p256dh: 'p', auth: 'a' } }, lang: lang || 'ru', watch: [{ napId, name: 'N-' + napId, free }] });

await test('run: полный проход по страницам, отправка, обновление состояния, пароль в запросах', async () => {
  const items = [mkItem('s:1', 'A', 0), mkItem('s:2', 'B', 0), mkItem('s:3', 'A', 0, 'en')];
  const w = fakeWorker(items, 2);
  const sent = [];
  const stats = await run({
    api: 'https://w.test', adminToken: 'TOKEN', live: live([site('A', ['free']), site('B', ['busy'])]), now: NOW, appUrl: APP,
    fetchImpl: w.fetchImpl, sendNotification: async (sub, payload, opts) => { sent.push({ sub, payload: JSON.parse(payload), opts }); },
  });
  assert.equal(stats.subs, 3);
  assert.equal(stats.sent, 2);
  assert.equal(sent[0].payload.body, 'Освободилась зарядка: N-A');
  assert.equal(sent[1].payload.body, 'A charger is free: N-A');
  assert.equal(sent[0].opts.TTL, 1800);
  assert.ok(w.calls.every((c) => c.auth === 'Bearer TOKEN'));
  const stateCalls = w.calls.filter((c) => c.path === '/state');
  assert.equal(stateCalls.length, 2); // по одному на страницу, где что-то поменялось
  assert.deepEqual(stateCalls[0].body.updates.map((u) => u.key), ['s:1']); // B не менялась
  assert.equal(stateCalls[0].body.updates[0].watch[0].free, 1);
});

await test('run: устаревшие данные: «освободилась» не шлём, состояние слежения не трогаем', async () => {
  const w = fakeWorker([mkItem('s:1', 'A', 0)], 40);
  let sent = 0;
  const stats = await run({ api: 'https://w.test', adminToken: 'T', live: live([site('A', ['free'])], 120), now: NOW, appUrl: APP, fetchImpl: w.fetchImpl, sendNotification: async () => { sent++; } });
  assert.equal(stats.skipped, 'stale-live');
  assert.equal(sent, 0);
  assert.equal(w.calls.some((c) => c.path === '/state'), false);
});

await test('run: мёртвая подписка (410) удаляется, временная ошибка не удаляет и не теряет состояние', async () => {
  const items = [mkItem('s:dead', 'A', 0), mkItem('s:flaky', 'A', 0), mkItem('s:ok', 'A', 0)];
  const w = fakeWorker(items, 40);
  const stats = await run({
    api: 'https://w.test', adminToken: 'T', live: live([site('A', ['free'])]), now: NOW, appUrl: APP, fetchImpl: w.fetchImpl,
    sendNotification: async (sub) => {
      if (sub.endpoint.endsWith('s:dead')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
      if (sub.endpoint.endsWith('s:flaky')) { const e = new Error('boom'); e.statusCode = 500; throw e; }
    },
  });
  assert.equal(stats.sent, 1);
  assert.equal(stats.failed, 2);
  assert.equal(stats.removed, 1);
  const st = w.calls.find((c) => c.path === '/state').body;
  assert.deepEqual(st.remove, ['s:dead']);
  assert.deepEqual(st.updates.map((u) => u.key).sort(), ['s:flaky', 's:ok']);
});

await test('run: Worker недоступен или отвечает ошибкой: исключение наружу (скрипт его поймает), без отправки', async () => {
  let sent = 0;
  const bad = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(run({ api: 'https://w.test', adminToken: 'T', live: live([site('A', ['free'])]), now: NOW, appUrl: APP, fetchImpl: bad, sendNotification: async () => { sent++; } }), /HTTP 503/);
  assert.equal(sent, 0);
});

await test('evaluateTimers: срок вышел или выйдет до следующего запуска: пуш; далёкие остаются; просроченные тихо снимаются', () => {
  const rec = { lang: 'ru', timers: [
    { id: 'due', at: NOW + 5 * 60000, name: 'Galleria' },   // выйдет через 5 минут: шлём
    { id: 'late', at: NOW - 20 * 60000, name: 'Virši' },    // уже вышел: шлём
    { id: 'far', at: NOW + 40 * 60000, name: 'Далеко' },    // ещё рано
    { id: 'old', at: NOW - 3 * 3600000, name: 'Давно' },    // слишком поздно: без пуша, но снимаем
    { id: 7 }, null,
  ] };
  const r = evaluateTimers(rec, NOW, APP);
  assert.deepEqual(r.messages.map((m) => m.id), ['due', 'late']);
  assert.equal(r.messages[0].body, 'Зарядка до 80% почти готова на Galleria');
  assert.equal(r.messages[0].tag, 'timer:due');
  assert.deepEqual(r.timers.map((x) => x.id), ['far']);
  assert.deepEqual(r.fired, ['due', 'late', 'old']);
  assert.equal(timerText('en', ''), 'Your charge to 80% is about ready at the station');
  assert.deepEqual(evaluateTimers({}, NOW, APP), { messages: [], timers: [], fired: [] });
});

// NOW = 28.10.2026 14:00 по Риге (зима, UTC+2)
const row = new Array(48).fill(55); row[22] = 8; // будни 22:00 — самое свободное
const PAT = { sites: { A: row } };
const digestRec = (over) => Object.assign({ lang: 'ru', watch: [], digest: { hour: 14, favs: [{ napId: 'A', name: 'Galleria' }, { napId: 'ZZ', name: 'Нет данных' }] } }, over);

await test('evaluateDigest: раз в сутки в нужный час, с текущей занятостью и лучшим часом', () => {
  const fm = freeMapOf(live([site('A', ['free', 'busy'])]));
  const r = evaluateDigest(digestRec(), fm, PAT, NOW, APP);
  assert.equal(r.last, '2026-10-28');
  assert.equal(r.message.tag, 'digest');
  assert.equal(r.message.body, 'Galleria: свободно 1, свободнее всего около 22:00'); // станции без данных в сводку не попадают
  // тот же день: второй раз не шлём
  assert.equal(evaluateDigest(digestRec({ digest: { hour: 14, favs: [{ napId: 'A', name: 'Galleria' }], last: '2026-10-28' } }), fm, PAT, NOW, APP).message, null);
  // следующий час окна ещё подходит (запуск задержался), через два часа уже нет
  assert.ok(evaluateDigest(digestRec({ digest: { hour: 13, favs: [{ napId: 'A', name: 'G' }] } }), fm, PAT, NOW, APP).message);
  assert.equal(evaluateDigest(digestRec({ digest: { hour: 12, favs: [{ napId: 'A', name: 'G' }] } }), fm, PAT, NOW, APP).message, null);
  assert.equal(evaluateDigest(digestRec({ digest: { hour: 17, favs: [{ napId: 'A', name: 'G' }] } }), fm, PAT, NOW, APP).message, null);
  // без живых данных (устарели) сводка строится по шаблонам занятости
  const noLive = evaluateDigest(digestRec(), new Map(), PAT, NOW, APP);
  assert.equal(noLive.message.body, 'Galleria: свободнее всего около 22:00');
  // совсем нет данных: молчим и дату не ставим
  assert.deepEqual(evaluateDigest(digestRec(), new Map(), null, NOW, APP), { message: null, last: null });
  assert.deepEqual(evaluateDigest({ lang: 'ru' }, new Map(), PAT, NOW, APP), { message: null, last: null });
  // английский
  assert.equal(evaluateDigest(digestRec({ lang: 'en' }), freeMapOf(live([site('A', ['busy'])])), PAT, NOW, APP).message.body, 'Galleria: all busy now, quietest around 22:00');
});

await test('run: таймер и сводка отправляются, состояние возвращается в Worker (сработавший таймер, дата сводки)', async () => {
  const item = Object.assign(mkItem('s:1', 'A', 1), { timers: [{ id: 'due', at: NOW + 60000, name: 'Galleria' }, { id: 'far', at: NOW + 3600000, name: 'X' }], digest: { hour: 14, favs: [{ napId: 'A', name: 'Galleria' }] } });
  const w = fakeWorker([item], 40);
  const sent = [];
  const stats = await run({ api: 'https://w.test', adminToken: 'T', live: live([site('A', ['free'])]), patterns: PAT, now: NOW, appUrl: APP, fetchImpl: w.fetchImpl, sendNotification: async (s, payload) => { sent.push(JSON.parse(payload)); } });
  assert.deepEqual(sent.map((p) => p.tag).sort(), ['digest', 'timer:due']);
  assert.equal(stats.timers, 1);
  assert.equal(stats.digests, 1);
  const upd = w.calls.find((c) => c.path === '/state').body.updates[0];
  assert.deepEqual(upd.timers.map((x) => x.id), ['far']);
  assert.deepEqual(upd.fired, ['due']);
  assert.equal(upd.digestLast, '2026-10-28');
  // повторный запуск с обновлённой записью ничего не шлёт
  const again = Object.assign({}, item, { timers: upd.timers, digest: Object.assign({}, item.digest, { last: upd.digestLast }) });
  const w2 = fakeWorker([again], 40);
  const sent2 = [];
  await run({ api: 'https://w.test', adminToken: 'T', live: live([site('A', ['free'])]), patterns: PAT, now: NOW, appUrl: APP, fetchImpl: w2.fetchImpl, sendNotification: async () => { sent2.push(1); } });
  assert.equal(sent2.length, 0);
  assert.equal(w2.calls.some((c) => c.path === '/state'), false);
});

await test('run: устаревшие данные не мешают таймеру; временная ошибка не теряет таймер и сводку', async () => {
  const item = Object.assign(mkItem('s:1', 'A', 0), { timers: [{ id: 'due', at: NOW, name: 'G' }], digest: { hour: 14, favs: [{ napId: 'A', name: 'G' }] } });
  const w = fakeWorker([item], 40);
  const sent = [];
  await run({ api: 'https://w.test', adminToken: 'T', live: live([site('A', ['free'])], 120), patterns: PAT, now: NOW, appUrl: APP, fetchImpl: w.fetchImpl, sendNotification: async (s, payload) => { sent.push(JSON.parse(payload).tag); } });
  assert.deepEqual(sent.sort(), ['digest', 'timer:due']);
  // временная ошибка (500): дату сводки не ставим, таймер остаётся на следующий запуск
  const w2 = fakeWorker([item], 40);
  await run({ api: 'https://w.test', adminToken: 'T', live: live([site('A', ['free'])]), patterns: PAT, now: NOW, appUrl: APP, fetchImpl: w2.fetchImpl, sendNotification: async () => { const e = new Error('boom'); e.statusCode = 500; throw e; } });
  const upd = (w2.calls.find((c) => c.path === '/state') || { body: { updates: [{}] } }).body.updates[0];
  assert.equal(upd.digestLast, undefined);
  assert.equal(upd.fired, undefined); // таймер не снят, уйдёт при следующем запуске
});

console.log('\n' + passed + ' tests passed');
