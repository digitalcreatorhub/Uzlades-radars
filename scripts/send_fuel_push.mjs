// Рассылка утреннего отчёта по топливу для приложения «Degvielas Radars».
// Подписки лежат в том же Worker uzlades-push (поле app = fuel), цены берутся из data/report.json опубликованного сайта приложения.
// Любая ошибка здесь не должна ломать рабочий процесс: скрипт всегда завершается кодом 0 и пишет причину в лог.
// Запуск: node scripts/send_fuel_push.mjs
//   нужны: push-config.json в корне, переменная CLOUDFLARE_API_TOKEN (из неё выводятся ключи, как у зарядок), пакет web-push
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveAdminToken, deriveVapid } from './push_keys.mjs';
import { evaluateMorning } from './fuel_logic.mjs';

const TIMEOUT_MS = 20000;
const APP_URL = 'https://digitalcreatorhub.github.io/degvievas-radars/';
const REPORT_URL = APP_URL + 'data/report.json';

export async function run({ api, adminToken, report, now, appUrl, sendNotification, fetchImpl, log }) {
  const f = fetchImpl || fetch;
  const say = log || (() => {});
  const stats = { subs: 0, sent: 0, failed: 0, removed: 0, updated: 0, skipped: null };
  const t0 = now == null ? Date.now() : now;
  const headers = { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' };
  const req = async (path, opts) => {
    const res = await f(api + path, Object.assign({ headers, signal: AbortSignal.timeout(TIMEOUT_MS) }, opts));
    if (!res.ok) throw new Error(path + ': HTTP ' + res.status);
    return res.json();
  };

  let cursor = null;
  let pages = 0;
  do {
    const page = await req('/subs?app=fuel&limit=40' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    cursor = page.cursor || null;
    const updates = [];
    const remove = [];
    for (const item of page.items || []) {
      stats.subs++;
      const r = evaluateMorning(item, report, t0, appUrl);
      if (r.skipped) stats.skipped = r.skipped;
      if (!r.message) continue;
      try {
        await sendNotification(item.sub, JSON.stringify(r.message), { TTL: 6 * 3600, urgency: 'normal' });
        stats.sent++;
        updates.push({ key: item.key, morningLast: r.last });
      } catch (e) {
        stats.failed++;
        if (e && (e.statusCode === 404 || e.statusCode === 410)) { remove.push(item.key); stats.removed++; continue; } // подписка больше не существует
        say('Не отправилось (' + (e && (e.statusCode || e.message)) + ')'); // временная ошибка: попробуем на следующем запуске в окне
      }
    }
    if (updates.length || remove.length) {
      const out = await req('/state', { method: 'POST', body: JSON.stringify({ updates, remove }) });
      stats.updated += out.updated || 0;
    }
    pages++;
  } while (cursor && pages < 50);
  return stats;
}

async function main() {
  try {
    const config = JSON.parse(fs.readFileSync(new URL('../push-config.json', import.meta.url), 'utf8'));
    const secret = process.env.CLOUDFLARE_API_TOKEN;
    if (!config.api || !secret) { console.log('Пуши не настроены (нет адреса Worker или секрета), пропускаю'); return; }
    const reportRes = await fetch(process.env.FUEL_REPORT_URL || REPORT_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
    if (!reportRes.ok) { console.log('Отчёт по топливу не получен: HTTP ' + reportRes.status); return; }
    const report = await reportRes.json();
    const webpush = (await import('web-push')).default;
    const vapid = deriveVapid(secret);
    webpush.setVapidDetails(APP_URL, vapid.publicKey, vapid.privateKey);
    const stats = await run({
      api: config.api.replace(/\/$/, ''),
      adminToken: deriveAdminToken(secret),
      report,
      appUrl: APP_URL,
      sendNotification: (sub, payload, opts) => webpush.sendNotification(sub, payload, opts),
      log: (s) => console.log(s),
    });
    console.log('Утренний отчёт по топливу: ' + JSON.stringify(stats));
  } catch (e) {
    console.log('Рассылка утреннего отчёта не удалась: ' + (e && e.message));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
