// Запуск: node tests/fuel_push.test.mjs
import assert from 'node:assert/strict';
import { evaluateMorning, fuelLine } from '../scripts/fuel_logic.mjs';
import { run } from '../scripts/send_fuel_push.mjs';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok  ' + name); }

// 29 октября 2026 06:10 UTC = 08:10 по Риге (зимнее время, UTC+2)
const NOW = Date.UTC(2026, 9, 29, 6, 10, 0);
const APP = 'https://digitalcreatorhub.github.io/degvievas-radars/';
const REPORT = {
  date: '2026-10-29',
  fuels: {
    95: { price: 1.807, chain: 'Viada', address: 'Andreja Saharova iela 10, Rīga', delta: -0.04, low30: true },
    diesel: { price: 1.987, chain: 'Viada', address: 'Andreja Saharova iela 10, Rīga', delta: 0.04, low30: false },
    lpg: { price: 0.931, chain: 'Astarte', address: 'Krasta iela 93', delta: -0.0001, low30: false },
  },
};
const rec = (over) => Object.assign({ key: 's:' + 'a'.repeat(64), sub: { endpoint: 'https://fcm.googleapis.com/x' }, lang: 'ru', morning: { hour: 8, fuels: ['95', 'diesel'] } }, over || {});

await test('fuelLine: цена, сеть, улица без города, стрелка в центах, звёздочка у минимума за 30 дней', () => {
  assert.equal(fuelLine('ru', '95', REPORT.fuels[95]), '95: 1.807 € · Viada, Andreja Saharova iela 10 (↓4.0 c) ★');
  assert.equal(fuelLine('ru', 'diesel', REPORT.fuels.diesel), 'дизель: 1.987 € · Viada, Andreja Saharova iela 10 (↑4.0 c)');
  assert.equal(fuelLine('en', 'diesel', REPORT.fuels.diesel).startsWith('diesel: 1.987'), true);
  assert.equal(fuelLine('lv', 'diesel', REPORT.fuels.diesel).startsWith('dīzelis: 1.987'), true);
  // изменение меньше полцента не показываем
  assert.equal(fuelLine('ru', 'lpg', REPORT.fuels.lpg), 'газ: 0.931 € · Astarte, Krasta iela 93');
});

await test('утренний отчёт: в окне часа уходит, только выбранные виды топлива, ссылка на приложение', () => {
  const r = evaluateMorning(rec(), REPORT, NOW, APP);
  assert.equal(r.last, '2026-10-29');
  assert.equal(r.message.title, 'Degvielas Radars · Рига');
  assert.equal(r.message.url, APP);
  assert.equal(r.message.body.split('\n').length, 2);
  assert.ok(!r.message.body.includes('газ'));
});

await test('утренний отчёт: окно «час + ещё час», до часа и после окна не шлём', () => {
  assert.ok(evaluateMorning(rec({ morning: { hour: 7, fuels: ['95'] } }), REPORT, NOW, APP).message); // 08:10, окно 07-08
  assert.equal(evaluateMorning(rec({ morning: { hour: 9, fuels: ['95'] } }), REPORT, NOW, APP).message, null); // ещё рано
  assert.equal(evaluateMorning(rec({ morning: { hour: 6, fuels: ['95'] } }), REPORT, NOW, APP).message, null); // окно прошло
});

await test('утренний отчёт: один раз в сутки', () => {
  assert.equal(evaluateMorning(rec({ morning: { hour: 8, fuels: ['95'], last: '2026-10-29' } }), REPORT, NOW, APP).message, null);
  assert.ok(evaluateMorning(rec({ morning: { hour: 8, fuels: ['95'], last: '2026-10-28' } }), REPORT, NOW, APP).message);
});

await test('утренний отчёт: вчерашние цены не шлём, нет нужных цен тоже', () => {
  const old = evaluateMorning(rec(), Object.assign({}, REPORT, { date: '2026-10-28' }), NOW, APP);
  assert.equal(old.message, null);
  assert.equal(old.skipped, 'stale-report');
  assert.equal(evaluateMorning(rec(), null, NOW, APP).skipped, 'stale-report');
  const none = evaluateMorning(rec({ morning: { hour: 8, fuels: ['98'] } }), REPORT, NOW, APP);
  assert.equal(none.message, null);
  assert.equal(none.skipped, 'no-prices');
  assert.equal(evaluateMorning(rec({ morning: null }), REPORT, NOW, APP).message, null);
});

await test('утренний отчёт: язык подписки', () => {
  assert.equal(evaluateMorning(rec({ lang: 'en' }), REPORT, NOW, APP).message.title, 'Degvielas Radars · Riga');
  assert.equal(evaluateMorning(rec({ lang: 'lv' }), REPORT, NOW, APP).message.title, 'Degvielas Radars · Rīga');
  assert.equal(evaluateMorning(rec({ lang: 'xx' }), REPORT, NOW, APP).message.title, 'Degvielas Radars · Рига');
});

await test('run: шлёт, запоминает дату на сервере, удаляет мёртвые подписки, временную ошибку оставляет на следующий запуск', async () => {
  const items = [
    rec({ key: 's:' + '1'.repeat(64) }),
    rec({ key: 's:' + '2'.repeat(64), sub: { endpoint: 'dead' } }),
    rec({ key: 's:' + '3'.repeat(64), sub: { endpoint: 'flaky' } }),
  ];
  const posted = [];
  const fetchImpl = async (url, opts) => {
    if (url.includes('/subs?app=fuel')) return { ok: true, json: async () => ({ items, cursor: null }) };
    if (url.endsWith('/state')) { posted.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true, updated: 1, removed: 1 }) }; }
    throw new Error('unexpected ' + url);
  };
  const sent = [];
  const sendNotification = async (sub, payload) => {
    if (sub.endpoint === 'dead') { const e = new Error('gone'); e.statusCode = 410; throw e; }
    if (sub.endpoint === 'flaky') { const e = new Error('boom'); e.statusCode = 500; throw e; }
    sent.push(JSON.parse(payload));
  };
  const stats = await run({ api: 'https://w.test', adminToken: 't', report: REPORT, now: NOW, appUrl: APP, sendNotification, fetchImpl });
  assert.equal(stats.subs, 3);
  assert.equal(stats.sent, 1);
  assert.equal(stats.failed, 2);
  assert.equal(stats.removed, 1);
  assert.equal(sent[0].tag, 'fuel-morning');
  assert.deepEqual(posted[0].updates, [{ key: 's:' + '1'.repeat(64), morningLast: '2026-10-29' }]);
  assert.deepEqual(posted[0].remove, ['s:' + '2'.repeat(64)]);
});

await test('run: когда слать нечего, в Worker ничего не пишем', async () => {
  let writes = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/subs?app=fuel')) return { ok: true, json: async () => ({ items: [rec({ morning: { hour: 9, fuels: ['95'] } })], cursor: null }) };
    writes++; return { ok: true, json: async () => ({}) };
  };
  const stats = await run({ api: 'https://w.test', adminToken: 't', report: REPORT, now: NOW, appUrl: APP, sendNotification: async () => { throw new Error('must not send'); }, fetchImpl });
  assert.equal(stats.sent, 0);
  assert.equal(writes, 0);
});

console.log('\n' + passed + ' tests passed');
