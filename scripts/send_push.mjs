// Рассылка пушей «освободилась зарядка». Запускается из update-live.yml после сборки live.json.
// Берёт подписки из Worker, сравнивает с живыми данными, шлёт пуши, возвращает новое состояние в Worker.
// Любая ошибка здесь не должна ломать публикацию live.json: скрипт всегда завершается кодом 0 и пишет причину в лог.
// Запуск: node scripts/send_push.mjs <live.json> [patterns.json]
//   нужны: push-config.json в корне, переменная CLOUDFLARE_API_TOKEN, пакет web-push (ставится в workflow)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveAdminToken, deriveVapid } from './push_keys.mjs';
import { isFresh, freeMapOf, evaluate, evaluateTimers, evaluateDigest } from './push_logic.mjs';

const TIMEOUT_MS = 20000;

export async function run({ api, adminToken, live, patterns, now, appUrl, sendNotification, fetchImpl, log }) {
  const f = fetchImpl || fetch;
  const say = log || (() => {});
  const stats = { subs: 0, sent: 0, failed: 0, removed: 0, updated: 0, timers: 0, digests: 0, skipped: null };
  // Старые данные: «освободилось» не шлём (нет оснований), но таймеры и сводка от живых данных почти не зависят
  const fresh = isFresh(live, now);
  if (!fresh) { stats.skipped = 'stale-live'; say('Статус старше 90 минут: слежение пропускаем, таймеры и сводку обрабатываем'); }
  const freeMap = fresh ? freeMapOf(live) : new Map();
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
    const page = await req('/subs?limit=40' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    cursor = page.cursor || null;
    const updates = [];
    const remove = [];
    for (const item of page.items || []) {
      stats.subs++;
      const r = evaluate(item, freeMap, appUrl);
      const tm = evaluateTimers(item, t0, appUrl);
      const dg = evaluateDigest(item, freeMap, patterns, t0, appUrl);
      const queue = r.messages.map((m) => ({ kind: 'watch', m }))
        .concat(tm.messages.map((m) => ({ kind: 'timer', m, id: m.id })))
        .concat(dg.message ? [{ kind: 'digest', m: dg.message }] : []);
      let dead = false;
      let digestSent = false;
      const failedTimers = new Set();
      for (const q of queue) {
        const m = q.m;
        try {
          await sendNotification(item.sub, JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag }), { TTL: q.kind === 'watch' ? 1800 : 3600, urgency: q.kind === 'digest' ? 'normal' : 'high' });
          stats.sent++;
          if (q.kind === 'timer') stats.timers++;
          if (q.kind === 'digest') { stats.digests++; digestSent = true; }
        } catch (e) {
          stats.failed++;
          if (q.kind === 'timer') failedTimers.add(q.id); // временная ошибка: таймер остаётся до следующего запуска
          if (e && (e.statusCode === 404 || e.statusCode === 410)) { dead = true; break; } // подписка больше не существует
          say('Не отправилось (' + (e && (e.statusCode || e.message)) + ')');
        }
      }
      if (dead) { remove.push(item.key); stats.removed++; continue; }
      const upd = { key: item.key, watch: r.watch };
      let changed = r.changed;
      const firedOk = tm.fired.filter((id) => !failedTimers.has(id));
      if (firedOk.length) {
        upd.timers = tm.timers.concat((item.timers || []).filter((x) => x && failedTimers.has(x.id)));
        upd.fired = firedOk;
        changed = true;
      }
      if (digestSent) { upd.digestLast = dg.last; changed = true; }
      if (changed) updates.push(upd);
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
  const liveFile = process.argv[2];
  try {
    const config = JSON.parse(fs.readFileSync(new URL('../push-config.json', import.meta.url), 'utf8'));
    const secret = process.env.CLOUDFLARE_API_TOKEN;
    if (!config.api || !secret) { console.log('Пуши не настроены (нет адреса Worker или секрета), пропускаю'); return; }
    const live = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
    let patterns = null;
    try { if (process.argv[3]) patterns = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')); } catch (e) { console.log('patterns.json не прочитан, сводка без «лучшего часа»'); }
    const repo = process.env.GITHUB_REPOSITORY || 'digitalcreatorhub/Uzlades-radars';
    const [owner, name] = repo.split('/');
    const appUrl = process.env.APP_URL || 'https://' + owner.toLowerCase() + '.github.io/' + name + '/';
    const webpush = (await import('web-push')).default;
    const vapid = deriveVapid(secret);
    webpush.setVapidDetails(appUrl, vapid.publicKey, vapid.privateKey);
    const stats = await run({
      api: config.api.replace(/\/$/, ''),
      adminToken: deriveAdminToken(secret),
      live,
      patterns,
      appUrl,
      sendNotification: (sub, payload, opts) => webpush.sendNotification(sub, payload, opts),
      log: (s) => console.log(s),
    });
    console.log('Пуши: ' + JSON.stringify(stats));
  } catch (e) {
    console.log('Рассылка пушей не удалась: ' + (e && e.message));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
