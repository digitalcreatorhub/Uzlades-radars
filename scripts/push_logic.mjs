// Чистая логика рассылки: кому и что отправить. Без сети, поэтому проверяется тестами целиком.
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

export function textFor(lang, name) {
  const n = name || (lang === 'en' ? 'Charging station' : 'Станция');
  return lang === 'en' ? 'A charger is free: ' + n : 'Освободилась зарядка: ' + n;
}

// Подписка -> { watch: новое состояние, messages: что отправить, changed: менялось ли состояние }
// Уведомляем, когда было 0 свободных точек, а стало больше нуля (как в самом приложении).
// Станции, которых нет в данных, не трогаем: нет данных, нет вывода.
export function evaluate(record, freeMap, appUrl) {
  const messages = [];
  let changed = false;
  const lang = record && record.lang === 'en' ? 'en' : 'ru';
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
