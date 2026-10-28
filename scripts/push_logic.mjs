// Чистая логика рассылки: кому и что отправить. Без сети, поэтому проверяется тестами целиком.
import { createRequire } from 'node:module';
const UR = createRequire(import.meta.url)('../logic.js');
export const FRESH_MS = 90 * 60 * 1000; // как в приложении: статус старше 90 минут не считаем актуальным

export function liveTimeOf(live) {
  const t = Date.parse((live && (live.statusTime || live.generated)) || '');
  return isFinite(t) ? t : null;
}

export function isFresh(live, now) {
  const t = liveTimeOf(live);
  return t != null && (now == null ? Date.now() : now) - t <= FRESH_MS;
}

// napId -> сколько точек свободно сейчас (станции без точек пропускаем)
export function freeMapOf(live) {
  const m = new Map();
  for (const s of (live && Array.isArray(live.sites) ? live.sites : [])) {
    if (!s || !s.id || !Array.isArray(s.pts) || !s.pts.length) continue;
    m.set(s.id, s.pts.filter((p) => p && p.s === 'free').length);
  }
  return m;
}

// Язык подписки: ru (по умолчанию), en или lv
export const langOf = (record) => (record && (record.lang === 'en' || record.lang === 'lv') ? record.lang : 'ru');

export function textFor(lang, name) {
  if (lang === 'lv') return 'Atbrīvojās lādētājs: ' + (name || 'Uzlādes stacija');
  const n = name || (lang === 'en' ? 'Charging station' : 'Станция');
  return lang === 'en' ? 'A charger is free: ' + n : 'Освободилась зарядка: ' + n;
}

// Подписка -> { watch: новое состояние, messages: что отправить, changed: менялось ли состояние }
// Уведомляем, когда было 0 свободных точек, а стало больше нуля (как в самом приложении).
// Станции, которых нет в данных, не трогаем: нет данных, нет вывода.
export function evaluate(record, freeMap, appUrl) {
  const messages = [];
  let changed = false;
  const lang = langOf(record);
  const watch = ((record && record.watch) || []).map((w) => {
    if (!freeMap.has(w.napId)) return w;
    const cur = freeMap.get(w.napId);
    if (w.free === 0 && cur > 0) {
      messages.push({
        napId: w.napId,
        title: 'Uzlādes Radars',
        body: textFor(lang, w.name),
        url: appUrl + '?st=' + encodeURIComponent(w.napId),
        tag: 'watch-n:' + w.napId, // совпадает с меткой внутри приложения: открытое приложение и пуш заменяют друг друга
      });
    }
    if (w.free !== cur) { changed = true; return Object.assign({}, w, { free: cur }); }
    return w;
  });
  return { watch, messages, changed };
}

// ---------- таймер «зарядка до 80% готова» ----------
export const TIMER_LEAD_MS = 7 * 60 * 1000; // запуск раз в 15 минут: шлём тем, кому срок выйдет до следующего запуска (в среднем это за ~0-7 мин до срока)
export const TIMER_STALE_MS = 2 * 3600 * 1000; // просроченный больше чем на 2 часа уже не нужен

export function timerText(lang, name) {
  if (lang === 'lv') return 'Uzlāde līdz 80% gandrīz gatava: ' + (name || 'stacija');
  const n = name || (lang === 'en' ? 'the station' : 'станции');
  return lang === 'en' ? 'Your charge to 80% is about ready at ' + n : 'Зарядка до 80% почти готова на ' + n;
}

// -> { messages, timers: что осталось, fired: id сработавших или устаревших }
export function evaluateTimers(record, now, appUrl) {
  const t0 = now == null ? Date.now() : now;
  const lang = langOf(record);
  const messages = [];
  const fired = [];
  const timers = [];
  for (const x of (record && Array.isArray(record.timers) ? record.timers : [])) {
    if (!x || typeof x.id !== 'string' || !isFinite(x.at)) continue;
    if (x.at - t0 > TIMER_LEAD_MS) { timers.push(x); continue; }
    fired.push(x.id);
    if (t0 - x.at > TIMER_STALE_MS) continue; // слишком поздно: не тревожим
    messages.push({ id: x.id, title: 'Uzlādes Radars', body: timerText(lang, x.name), url: appUrl, tag: 'timer:' + x.id });
  }
  return { messages, timers, fired };
}

// ---------- вечерняя сводка ----------
const rigaDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
const rigaHour = (ms) => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', hour: '2-digit', hourCycle: 'h23' }).format(ms), 10) % 24;

export function digestLine(lang, fav, free, win) {
  const parts = [];
  const L = {
    ru: { free: (n) => (n > 0 ? 'свободно ' + n : 'сейчас все заняты'), best: (h) => 'свободнее всего около ' + h },
    en: { free: (n) => (n > 0 ? n + ' free now' : 'all busy now'), best: (h) => 'quietest around ' + h },
    lv: { free: (n) => (n > 0 ? 'brīvi ' + n : 'pašlaik viss aizņemts'), best: (h) => 'visbrīvāk ap ' + h },
  }[lang] || null;
  if (free != null) parts.push(L.free(free));
  if (win && !win.good) parts.push(L.best(String(win.best.hour).padStart(2, '0') + ':00'));
  return (fav.name || fav.napId) + (parts.length ? ': ' + parts.join(', ') : '');
}

// Сводка уходит один раз в сутки в окне «заданный час по Риге + ещё час» (запуски идут с задержками)
// -> { message|null, last: новая дата отправки или null }
export function evaluateDigest(record, freeMap, patterns, now, appUrl) {
  const d = record && record.digest;
  if (!d || !Number.isInteger(d.hour) || !Array.isArray(d.favs) || !d.favs.length) return { message: null, last: null };
  const t0 = now == null ? Date.now() : now;
  const today = rigaDate(t0);
  const h = rigaHour(t0);
  if (d.last === today || !(h === d.hour || h === (d.hour + 1) % 24)) return { message: null, last: null };
  const lang = langOf(record);
  const lines = [];
  for (const f of d.favs.slice(0, 3)) {
    const free = freeMap && freeMap.has(f.napId) ? freeMap.get(f.napId) : null;
    const win = UR.bestWindow({ napId: f.napId }, patterns, t0, 15);
    if (free == null && !win) continue; // про эту станцию нечего сказать
    lines.push(digestLine(lang, f, free, win));
  }
  if (!lines.length) return { message: null, last: null };
  return {
    message: { title: 'Uzlādes Radars · ' + (lang === 'en' ? 'tonight' : lang === 'lv' ? 'vakars' : 'вечер'), body: lines.join('\n'), url: appUrl, tag: 'digest' },
    last: today,
  };
}
