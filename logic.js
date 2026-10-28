/* Uzlādes Radars: чистая логика (без DOM). Работает и в браузере (window.UR), и в Node (тесты). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Сети Латвии. Порядок важен: первое совпадение по operator/brand/network/name побеждает.
  const OPERATORS = [
    { id: 'elektrum', name: 'Elektrum Drive', re: /elektrum/i },
    { id: 'ignitis', name: 'Ignitis ON', re: /ignitis/i },
    { id: 'enefit', name: 'Enefit', re: /enefit|\bvolt\b/i },
    { id: 'eleport', name: 'Eleport', re: /eleport/i },
    { id: 'virsi', name: 'Virši', re: /vir[sš]i/i },
    { id: 'emobi', name: 'e-mobi', re: /e-?mobi|csdd/i },
    { id: 'ionity', name: 'IONITY', re: /ionity/i },
    { id: 'neste', name: 'Neste', re: /neste/i },
    { id: 'tesla', name: 'Tesla', re: /tesla/i },
  ];

  // Ориентировочные цены публичной зарядки, €/кВт·ч с НДС. Источник: сайты операторов,
  // сводка Cenotava.lv на 26.10.2026. Это справочные диапазоны, не живые тарифы.
  const PRICES_DATE = '2026-10-26';
  const PRICES = {
    virsi: { dc: [0.28, 0.36], hpc: [0.38, 0.42] },
    emobi: { ac: [1.15, 1.15], dc: [0.25, 0.32], perMin: 0.21 },
    ignitis: { ac: [0.27, 0.31], dc: [0.32, 0.38], hpc: [0.39, 0.43], idleFeePerMin: 0.10 },
    enefit: { ac: [0.36, 0.39], dc: [0.36, 0.39], hpc: [0.43, 0.47], minFee: 0.5 },
    eleport: { ac: [0.34, 0.34], dc: [0.41, 0.44], hpc: [0.41, 0.44] },
    elektrum: { ac: [0.40, 0.66], dc: [0.44, 0.51], hpc: [0.44, 0.66] },
    ionity: { hpc: [0.76, 0.76] },
    neste: {},
    tesla: {},
  };

  const SOCKET_KEYS = {
    type2: ['socket:type2', 'socket:type2_cable'],
    ccs: ['socket:type2_combo'],
    chademo: ['socket:chademo'],
    tesla: ['socket:tesla_supercharger', 'socket:tesla_destination', 'socket:nacs'],
  };

  const KWH_PER_100KM = 17; // средний расход для оценок «за 100 км хода»

  function operatorOf(tags) {
    const hay = [tags.operator, tags.brand, tags.network, tags.name].filter(Boolean).join(' ');
    for (const op of OPERATORS) if (op.re.test(hay)) return { id: op.id, name: op.name };
    const own = tags.operator || tags.brand || tags.network || null;
    return { id: 'other', name: own };
  }

  // "22 kW", "150000", "50;22 kW", "11,5 kW" -> максимум в кВт
  function parseKw(v) {
    if (v == null) return null;
    let best = null;
    for (const part of String(v).toLowerCase().replace(/,/g, '.').split(';')) {
      const m = part.match(/(\d+(?:\.\d+)?)\s*(kw|w)?/);
      if (!m) continue;
      let n = parseFloat(m[1]);
      const unit = m[2];
      if (unit === 'w' || (!unit && n >= 1000)) n = n / 1000;
      if (isFinite(n) && n > 0 && n <= 1000) best = best == null ? n : Math.max(best, n);
    }
    return best;
  }

  function parseSockets(tags) {
    const sockets = {};
    let maxKw = null;
    for (const type of Object.keys(SOCKET_KEYS)) {
      for (const key of SOCKET_KEYS[type]) {
        const v = tags[key];
        if (!v || v === 'no') continue;
        const n = parseInt(v, 10);
        sockets[type] = Math.max(sockets[type] || 0, isFinite(n) && n > 0 ? n : 1);
        const kw = parseKw(tags[key + ':output']);
        if (kw != null) maxKw = maxKw == null ? kw : Math.max(maxKw, kw);
      }
    }
    for (const key of ['charging_station:output', 'maxpower']) {
      const kw = parseKw(tags[key]);
      if (kw != null) maxKw = maxKw == null ? kw : Math.max(maxKw, kw);
    }
    return { sockets, maxKw };
  }

  // ac: до 43 кВт, dc: 44–149 кВт, hpc: от 150 кВт
  function classify(kw) {
    if (kw == null) return 'unknown';
    if (kw >= 150) return 'hpc';
    if (kw > 43) return 'dc';
    return 'ac';
  }

  // Как оплатить, по тегам OSM: app (приложение сети), rfid (карта сети / NFC), card (банковская карта)
  function parsePay(tags) {
    const yes = (k) => tags[k] === 'yes';
    const pay = [];
    if (yes('authentication:app') || yes('payment:app')) pay.push('app');
    if (yes('authentication:membership_card') || yes('authentication:nfc')) pay.push('rfid');
    if (yes('payment:credit_cards') || yes('payment:debit_cards') || yes('payment:contactless')) pay.push('card');
    return pay;
  }

  function toStation(el) {
    const tags = el.tags || {};
    if (tags.access === 'private' || tags.access === 'no') return null;
    const lat = el.lat != null ? el.lat : el.center && el.center.lat;
    const lon = el.lon != null ? el.lon : el.center && el.center.lon;
    if (lat == null || lon == null) return null;

    const { sockets, maxKw } = parseSockets(tags);
    let kw = maxKw;
    let powerKnown = kw != null;
    if (kw == null) {
      // Мощность не указана: осторожная оценка по типу разъёма, помечаем как оценку.
      if (sockets.ccs || sockets.chademo || sockets.tesla) kw = 50;
      else if (sockets.type2) kw = 22;
    }
    const op = operatorOf(tags);
    const cap = parseInt(tags.capacity, 10);
    return {
      id: el.type + '/' + el.id,
      osmType: el.type,
      osmId: el.id,
      lat,
      lon,
      name: tags.name || tags['name:en'] || '',
      operatorId: op.id,
      operatorName: op.name,
      sockets,
      kw,
      powerKnown,
      cls: classify(kw),
      points: isFinite(cap) && cap > 0 ? cap : null,
      fee: tags.fee || null,
      hours: tags.opening_hours || null,
      address: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
      pay: parsePay(tags),
    };
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  const FALLBACK_ORDER = {
    ac: ['ac', 'dc'],
    dc: ['dc', 'hpc', 'ac'],
    hpc: ['hpc', 'dc'],
  };

  // Живые цены по сетям и классам мощности (из национальной точки доступа), поверх справочных PRICES.
  let livePrices = {};
  function setLivePrices(table) {
    livePrices = table || {};
  }
  // Таблица цен сети: справочные значения, перекрытые живыми. Вид: { ac:[lo,hi], dc:[..], hpc:[..], ... }
  function priceTable(operatorId) {
    return Object.assign({}, PRICES[operatorId] || {}, livePrices[operatorId] || {});
  }
  function hasLivePrice(operatorId, cls) {
    return !!(livePrices[operatorId] && livePrices[operatorId][cls]);
  }

  // -> { lo, hi, mid } или null, если цену по этой сети/классу мы не знаем
  function priceFor(operatorId, cls) {
    const table = priceTable(operatorId);
    const order = FALLBACK_ORDER[cls];
    if (!order) return null;
    for (const c of order) {
      if (table[c]) {
        const [lo, hi] = table[c];
        return { lo, hi, mid: (lo + hi) / 2 };
      }
    }
    return null;
  }

  /* ---------- живые данные национальной точки доступа (live.json) ---------- */
  const LIVE_FRESH_MS = 90 * 60 * 1000; // старше этого статус не показываем как актуальный
  const MATCH_M = 75; // площадка NAP и станция OSM в пределах этого расстояния считаются одним местом

  function liveTime(live) {
    const t = Date.parse((live && (live.statusTime || live.generated)) || '');
    return isFinite(t) ? t : null;
  }
  function isLiveFresh(live, now) {
    const t = liveTime(live);
    return t != null && (now == null ? Date.now() : now) - t <= LIVE_FRESH_MS;
  }

  // Подходит ли точка зарядки под выбранные фильтры (разъём и скорость)
  function pointMatches(pt, f) {
    if (!f) return true;
    if (f.connector && f.connector !== 'any' && pt.t !== f.connector) return false;
    if (f.power === 'fast' && !(pt.kw > 43)) return false;
    if (f.power === 'ultra' && !(pt.kw >= 150)) return false;
    // «Только мои разъёмы»: точки чужого типа не считаем ни свободными, ни занятыми
    const car = f.car;
    if (car && car.onlyCompatible && pt.t && pt.t !== 'other' && !(car.conn.includes(pt.t) || (pt.t === 'tesla' && car.tesla))) return false;
    return true;
  }

  // Сколько точек свободно / занято / не работает у станции (только подходящие под фильтры).
  // level: free (есть свободная), busy (все рабочие заняты), out (ничего не работает), unknown.
  function liveSummary(st, filters) {
    if (!st || !st.live) return null;
    const pts = st.live.pts.filter((p) => pointMatches(p, filters));
    if (!pts.length) return null;
    const c = { free: 0, busy: 0, out: 0, unk: 0 };
    for (const p of pts) c[p.s in c ? p.s : 'unk']++;
    let level = 'unknown';
    if (c.free > 0) level = 'free';
    else if (c.busy > 0) level = 'busy';
    else if (c.out > 0 && c.unk === 0) level = 'out';
    return { free: c.free, busy: c.busy, out: c.out, unk: c.unk, total: pts.length, level };
  }

  // Цена станции по данным самих точек: для подходящих под фильтр, а без фильтра для самых быстрых точек.
  function livePriceOf(st, filters) {
    if (!st || !st.live) return null;
    let pts = st.live.pts.filter((p) => p.p != null && pointMatches(p, filters));
    if (!pts.length) return null;
    const noFilter = !filters || ((!filters.connector || filters.connector === 'any') && (!filters.power || filters.power === 'any'));
    if (noFilter) {
      const top = Math.max.apply(null, pts.map((p) => p.kw || 0));
      const fastest = pts.filter((p) => (p.kw || 0) >= top * 0.8);
      if (fastest.length) pts = fastest;
    }
    const lo = Math.min.apply(null, pts.map((p) => p.p));
    const hi = Math.max.apply(null, pts.map((p) => (p.pm != null ? p.pm : p.p)));
    return { lo, hi, mid: (lo + hi) / 2, live: true };
  }

  // Цена по умолчанию для станции: живая, если есть, иначе справочная по сети и классу.
  function priceOf(st, filters) {
    return livePriceOf(st, filters) || priceFor(st.operatorId, st.cls);
  }

  // Сводные цены по сетям и классам из всех точек с ценой: 10–90 перцентиль (отсекает редкие выбросы).
  function buildPriceTable(live) {
    const buckets = {};
    for (const site of (live && live.sites) || []) {
      const op = operatorOf({ operator: site.op, name: site.n }).id;
      for (const p of site.pts) {
        if (p.p == null || p.kw == null) continue;
        const cls = classify(p.kw);
        if (cls === 'unknown') continue;
        ((buckets[op] = buckets[op] || {})[cls] = buckets[op][cls] || []).push(p.p);
      }
    }
    const table = {};
    for (const op of Object.keys(buckets)) {
      if (op === 'other') continue;
      for (const cls of Object.keys(buckets[op])) {
        const v = buckets[op][cls].sort((a, b) => a - b);
        const n = v.length;
        const lo = n < 5 ? v[0] : v[Math.floor(0.1 * (n - 1))];
        const hi = n < 5 ? v[n - 1] : v[Math.ceil(0.9 * (n - 1))];
        (table[op] = table[op] || {})[cls] = [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];
      }
    }
    return table;
  }

  // Внутренние коды вроде "PLVRIXPB12_EDLV-52" людям не показываем
  function prettyName(n) {
    if (!n) return '';
    const s = String(n).trim();
    if (!/\s/.test(s)) return '';
    if (/_/.test(s)) return '';
    return s;
  }

  function napStation(site, fresh) {
    const counts = {};
    let kw = null;
    for (const p of site.pts) {
      if (p.t && p.t !== 'other') counts[p.t] = (counts[p.t] || 0) + 1;
      if (p.kw != null) kw = kw == null ? p.kw : Math.max(kw, p.kw);
    }
    const op = operatorOf({ operator: site.op, name: site.n });
    const city = site.c && site.c !== 'Rīga' ? site.c : '';
    return {
      id: 'nap:' + site.id,
      osmType: null,
      osmId: null,
      lat: site.lat,
      lon: site.lon,
      name: prettyName(site.n),
      operatorId: op.id,
      operatorName: op.name || site.op || null,
      sockets: counts,
      kw,
      powerKnown: kw != null,
      cls: classify(kw),
      points: site.pts.length,
      fee: 'yes',
      hours: site.h === '24/7' ? '24/7' : null,
      address: [site.a, city].filter(Boolean).join(', '),
      pay: Array.isArray(site.pay) ? site.pay.slice() : [],
      napId: site.id,
      live: {
        upd: site.u || null,
        // u: когда статус точки сменился (минуты от эпохи), только у занятых и неработающих
        pts: site.pts.map((p) => ({ t: p.t, kw: p.kw, s: fresh ? p.s || 'unk' : 'unk', p: p.p, pm: p.pm, u: p.u })),
      },
    };
  }

  function inBbox(lat, lon, bbox) {
    return !bbox || (lat >= bbox[0] && lat <= bbox[2] && lon >= bbox[1] && lon <= bbox[3]);
  }

  // Сливает станции OSM с площадками национальной точки доступа.
  // NAP главный там, где знает площадку (статус, цена, разъёмы, мощность); OSM даёт название и остальное.
  // opts: { bbox: [south, west, north, east], now }
  function mergeLive(osmStations, live, opts) {
    const o = opts || {};
    if (!live || !Array.isArray(live.sites)) return osmStations.slice();
    const fresh = isLiveFresh(live, o.now);
    let remaining = osmStations.slice();
    const added = [];
    const merged = [];
    for (const site of live.sites) {
      if (!inBbox(site.lat, site.lon, o.bbox)) continue;
      const nap = napStation(site, fresh);
      const near = remaining
        .map((st) => ({ st, d: haversine(nap.lat, nap.lon, st.lat, st.lon) * 1000 }))
        .filter((x) => x.d <= MATCH_M && (x.st.operatorId === 'other' || nap.operatorId === 'other' || x.st.operatorId === nap.operatorId))
        .sort((a, b) => a.d - b.d);
      if (!near.length) { added.push(nap); continue; }
      const base = near[0].st;
      const gone = new Set(near.map((x) => x.st.id));
      remaining = remaining.filter((st) => !gone.has(st.id));
      merged.push(
        Object.assign({}, nap, {
          id: base.id,
          osmType: base.osmType,
          osmId: base.osmId,
          name: base.name || nap.name,
          address: base.address || nap.address,
          hours: base.hours || nap.hours,
          pay: nap.pay.length ? nap.pay : base.pay || [],
          operatorId: nap.operatorId !== 'other' ? nap.operatorId : base.operatorId,
          operatorName: nap.operatorId !== 'other' ? nap.operatorName : base.operatorName || nap.operatorName,
        })
      );
    }
    return remaining.concat(merged, added);
  }

  /* ---------- «когда обычно занято» (patterns.json) ---------- */
  // Час и тип дня по времени Риги, независимо от часового пояса телефона
  function rigaClock(ms) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', hour: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(ms);
    const get = (type) => (parts.find((x) => x.type === type) || {}).value;
    return { hour: parseInt(get('hour'), 10) % 24, weekend: get('weekday') === 'Sat' || get('weekday') === 'Sun' };
  }

  // -> { weekend, hours: [24 значений, процент занятости или -1], now: процент или -1, hour } или null, если данных нет
  function patternFor(st, patterns, nowMs) {
    if (!st || !st.napId || !patterns || !patterns.sites) return null;
    const row = patterns.sites[st.napId];
    if (!row || row.length !== 48) return null;
    const clock = rigaClock(nowMs == null ? Date.now() : nowMs);
    const hours = row.slice(clock.weekend ? 24 : 0, clock.weekend ? 48 : 24);
    if (!hours.some((v) => v >= 0)) return null;
    return { weekend: clock.weekend, hours, hour: clock.hour, now: hours[clock.hour], since: patterns.since || null };
  }

  // Сколько сегментов (из 5) заполнить на шкале мощности
  function segments(kw) {
    if (kw == null) return 0;
    if (kw <= 11) return 1;
    if (kw <= 43) return 2; // остальной AC
    if (kw <= 50) return 3;
    if (kw < 150) return 4;
    return 5; // класс 150+ кВт всегда полная шкала
  }

  // Оценка: за сколько минут зарядится 100 км хода. Реальная мощность ниже номинала,
  // у машины есть свой предел: 11 кВт на AC, 100 кВт на DC.
  function chargeMinutes100(kw, cls) {
    if (!kw) return null;
    const cap = cls === 'ac' ? 11 : 100;
    const eff = Math.min(kw, cap) * 0.8;
    const minutes = (KWH_PER_100KM / eff) * 60;
    return Math.max(5, Math.round(minutes / 5) * 5);
  }

  function matchesConnector(st, connector) {
    return connector === 'any' || !!st.sockets[connector];
  }

  function matchesSpeed(st, speed) {
    if (speed === 'any') return true;
    if (speed === 'fast') return st.cls === 'dc' || st.cls === 'hpc';
    if (speed === 'ultra') return st.cls === 'hpc';
    return true;
  }

  /* ---------- профиль машины ---------- */
  // Ориентировочные паспортные данные: полезная ёмкость, пик зарядки DC и AC, средний расход в смешанном режиме.
  // Это отправная точка: в приложении любое значение можно поправить под свою машину.
  const CARS = [
    { id: 'tesla3', name: 'Tesla Model 3 (RWD)', kwh: 57.5, dc: 170, ac: 11, cons: 15.5, conn: ['ccs', 'type2'], tesla: true },
    { id: 'tesla3lr', name: 'Tesla Model 3 Long Range', kwh: 75, dc: 250, ac: 11, cons: 16, conn: ['ccs', 'type2'], tesla: true },
    { id: 'teslay', name: 'Tesla Model Y Long Range', kwh: 75, dc: 250, ac: 11, cons: 17, conn: ['ccs', 'type2'], tesla: true },
    { id: 'id3', name: 'VW ID.3 Pro (58 кВт·ч)', kwh: 58, dc: 120, ac: 11, cons: 16.5, conn: ['ccs', 'type2'] },
    { id: 'id4', name: 'VW ID.4 Pro (77 кВт·ч)', kwh: 77, dc: 135, ac: 11, cons: 19, conn: ['ccs', 'type2'] },
    { id: 'enyaq', name: 'Škoda Enyaq 85', kwh: 77, dc: 135, ac: 11, cons: 18.5, conn: ['ccs', 'type2'] },
    { id: 'elroq', name: 'Škoda Elroq 85', kwh: 77, dc: 175, ac: 11, cons: 17, conn: ['ccs', 'type2'] },
    { id: 'kona', name: 'Hyundai Kona Electric 65', kwh: 64.8, dc: 100, ac: 11, cons: 15.5, conn: ['ccs', 'type2'] },
    { id: 'ioniq5', name: 'Hyundai Ioniq 5 (77 кВт·ч)', kwh: 74, dc: 220, ac: 11, cons: 18, conn: ['ccs', 'type2'] },
    { id: 'niro', name: 'Kia Niro EV', kwh: 64.8, dc: 85, ac: 11, cons: 16.5, conn: ['ccs', 'type2'] },
    { id: 'ev6', name: 'Kia EV6 (77 кВт·ч)', kwh: 74, dc: 230, ac: 11, cons: 18, conn: ['ccs', 'type2'] },
    { id: 'leaf40', name: 'Nissan Leaf 40 кВт·ч', kwh: 37, dc: 46, ac: 6.6, cons: 16.5, conn: ['chademo', 'type2'] },
    { id: 'leaf62', name: 'Nissan Leaf e+ 62 кВт·ч', kwh: 59, dc: 100, ac: 6.6, cons: 18, conn: ['chademo', 'type2'] },
    { id: 'zoe', name: 'Renault Zoe R135', kwh: 52, dc: 46, ac: 22, cons: 17, conn: ['ccs', 'type2'] },
    { id: 'mg4', name: 'MG4 Long Range', kwh: 61.7, dc: 140, ac: 11, cons: 17, conn: ['ccs', 'type2'] },
    { id: 'bmwi4', name: 'BMW i4 eDrive40', kwh: 80.7, dc: 205, ac: 11, cons: 18.5, conn: ['ccs', 'type2'] },
    { id: 'polestar2', name: 'Polestar 2 Long Range', kwh: 75, dc: 205, ac: 11, cons: 18.5, conn: ['ccs', 'type2'] },
    { id: 'byd', name: 'BYD Dolphin (60 кВт·ч)', kwh: 60.5, dc: 88, ac: 11, cons: 16, conn: ['ccs', 'type2'] },
    { id: 'e208', name: 'Peugeot e-208', kwh: 46, dc: 100, ac: 11, cons: 16.5, conn: ['ccs', 'type2'] },
    { id: 'custom', name: 'Другая машина', kwh: 60, dc: 100, ac: 11, cons: 17, conn: ['ccs', 'type2'] },
  ];
  const DC_TYPES = ['ccs', 'chademo', 'tesla'];

  // Приводит сохранённый профиль к допустимому виду (из localStorage приходит что угодно)
  function normalizeCar(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const num = (v, lo, hi, d) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) && n >= lo && n <= hi ? n : d; };
    const base = CARS.find((c) => c.id === raw.id) || CARS[CARS.length - 1];
    const conn = Array.isArray(raw.conn) ? raw.conn.filter((c) => ['ccs', 'type2', 'chademo'].includes(c)) : base.conn;
    return {
      id: base.id,
      name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 60) : base.name,
      kwh: num(raw.kwh, 10, 200, base.kwh),
      dc: num(raw.dc, 3, 500, base.dc),
      ac: num(raw.ac, 1.4, 50, base.ac),
      cons: num(raw.cons, 8, 40, base.cons),
      conn: conn.length ? conn : base.conn,
      tesla: raw.tesla == null ? !!base.tesla : !!raw.tesla,
      onlyCompatible: raw.onlyCompatible !== false,
    };
  }

  // Подходит ли станции разъёмом машине. Если разъёмы станции неизвестны, не прячем её.
  function carAccepts(car, st) {
    if (!car) return true;
    const keys = Object.keys(st.sockets || {});
    if (!keys.length) return true;
    return keys.some((k) => car.conn.includes(k) || (k === 'tesla' && car.tesla));
  }

  // Лучшая мощность, которую машина реально возьмёт на этой станции, кВт. null, если разъём не подходит.
  function carPowerKw(car, st) {
    if (!car) return st.kw || null;
    const cands = [];
    if (st.live && st.live.pts && st.live.pts.length) {
      for (const p of st.live.pts) if (p.t && p.kw) cands.push([p.t, p.kw]);
    }
    if (!cands.length) {
      for (const t of Object.keys(st.sockets || {})) {
        if (st.kw) cands.push([t, t === 'type2' ? Math.min(st.kw, 22) : st.kw]);
      }
    }
    let best = null;
    for (const [t, kw] of cands) {
      if (!(car.conn.includes(t) || (t === 'tesla' && car.tesla))) continue;
      const lim = DC_TYPES.includes(t) ? car.dc : car.ac;
      const v = Math.min(kw, lim);
      if (best == null || v > best) best = v;
    }
    return best;
  }

  const CHARGE_LOSS = 0.93; // доля энергии из розетки, которая попадает в батарею
  // Оценка зарядки от from% до to% (по умолчанию 20→80). price: {mid}. Это оценка, не обещание:
  // у быстрых станций мощность падает к концу зарядки, учтено усреднением.
  function chargeEstimate(car, kw, price, from, to) {
    if (!car || !kw) return null;
    const a = from == null ? 20 : from;
    const b = to == null ? 80 : to;
    if (!(b > a)) return null;
    const energy = (car.kwh * (b - a)) / 100;
    const dc = kw > 22;
    const avg = kw * (dc ? (b <= 80 ? 0.85 : 0.65) : 0.95);
    const minutes = Math.max(5, Math.round(((energy / CHARGE_LOSS) / avg) * 60 / 5) * 5);
    const billed = energy / CHARGE_LOSS;
    return { minutes, energy, billed, cost: price ? billed * price.mid : null, from: a, to: b };
  }

  // Множитель расхода от температуры воздуха: на холоде расход растёт (печка, батарея, шины).
  // Оценка по общим данным испытаний, не по конкретной машине.
  function coldFactor(tempC) {
    if (tempC == null || !isFinite(tempC)) return 1;
    const t = Math.max(-25, Math.min(40, tempC));
    if (t >= 20) return 1;
    if (t >= 10) return 1 + (20 - t) * 0.006;
    if (t >= 0) return 1.06 + (10 - t) * 0.01;
    return 1.16 + -t * 0.012;
  }

  function rangeKm(car, soc, tempC) {
    if (!car) return null;
    return Math.round(((car.kwh * soc) / 100) / ((car.cons * coldFactor(tempC)) / 100));
  }

  // Стоимость 100 км: зарядка на этой станции, дома и бензин. Все значения в евро, null если данных нет.
  function costPer100(car, tempC, opts) {
    const o = opts || {};
    const cons = (car ? car.cons : KWH_PER_100KM) * coldFactor(tempC);
    return {
      cons,
      station: o.stationPrice != null ? (cons / CHARGE_LOSS) * o.stationPrice : null,
      home: o.homePrice != null ? (cons / 0.9) * o.homePrice : null,
      petrol: o.petrolPrice != null ? (o.petrolCons || 7) * o.petrolPrice : null,
    };
  }

  /* ---------- поиск и фильтры ---------- */
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function matchesQuery(st, q) {
    if (!q) return true;
    const hay = fold([st.name, st.address, st.operatorName].filter(Boolean).join(' '));
    return fold(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  function isOpen247(st) {
    return /24\s*\/\s*7/.test(st.hours || '');
  }

  function applyFilters(stations, f) {
    return stations.filter((st) => {
      if (!matchesConnector(st, f.connector) || !matchesSpeed(st, f.power)) return false;
      if (f.operator !== 'all' && st.operatorId !== f.operator) return false;
      if (f.open247 && !isOpen247(st)) return false;
      if (f.cardPay && !(st.pay || []).includes('card')) return false;
      if (f.query && !matchesQuery(st, f.query)) return false;
      if (f.car && f.car.onlyCompatible && !carAccepts(f.car, st)) return false;
      if (f.freeNow) {
        const sum = liveSummary(st, f);
        if (!sum || sum.level !== 'free') return false;
      }
      return true;
    });
  }

  const WEIGHTS = {
    balanced: { dist: 1.5, price: 1.5, time: 1 },
    cheap: { dist: 0.5, price: 3, time: 0.5 },
    near: { dist: 3, price: 1, time: 1 },
  };
  const UNKNOWN_PRICE = 0.45; // для станций без известной цены: чуть выше среднего, чтобы не выигрывали вслепую

  const BUSY_PENALTY = 8; // все рабочие точки заняты: примерно как лишние 5 км пути
  const OUT_PENALTY = 1000; // ничего не работает: в самый конец

  // Добавляет расстояние, цену, время и оценку; сортирует от лучшей к худшей.
  // filters нужны, чтобы считать свободные точки и цену только по подходящим разъёмам.
  // ctx: { car, tempC }. С профилем машины время и стоимость считаются под неё, чужие разъёмы уходят вниз.
  function rank(stations, origin, priority, filters, ctx) {
    const w = WEIGHTS[priority] || WEIGHTS.balanced;
    const car = ctx && ctx.car;
    const tempC = ctx && ctx.tempC;
    const out = stations.map((st) => {
      const distKm = haversine(origin.lat, origin.lon, st.lat, st.lon);
      const price = priceOf(st, filters);
      let minutes = chargeMinutes100(st.kw, st.cls);
      let kwCar = null;
      let kwhPer100 = KWH_PER_100KM;
      let incompatible = false;
      if (car) {
        kwhPer100 = car.cons * coldFactor(tempC);
        kwCar = carPowerKw(car, st);
        if (kwCar == null) {
          incompatible = true;
          minutes = null;
        } else {
          const eff = kwCar * (kwCar > 22 ? 0.85 : 0.95);
          minutes = Math.max(5, Math.round(((kwhPer100 / CHARGE_LOSS) / eff) * 60 / 5) * 5);
        }
      }
      const live = liveSummary(st, filters);
      const p = price ? price.mid : UNKNOWN_PRICE;
      let score =
        distKm * w.dist + ((p - 0.25) / 0.1) * w.price + ((minutes == null ? 60 : minutes) / 10) * w.time;
      if (live && live.level === 'busy') score += BUSY_PENALTY;
      if (live && live.level === 'out') score += OUT_PENALTY;
      if (incompatible) score += 200;
      return {
        st,
        distKm,
        price,
        minutes,
        live,
        kwCar,
        incompatible,
        costPer100: price ? (price.mid * kwhPer100) / (car ? CHARGE_LOSS : 1) : null,
        score,
      };
    });
    out.sort((a, b) => a.score - b.score);
    return out;
  }

  /* ---------- прогноз, надёжность, смена цены (из patterns.json) ---------- */
  // Занятость через `aheadMin` минут: время и тип дня берём по Риге, поэтому переход через полночь и в выходные верен.
  function forecastFor(st, patterns, nowMs, aheadMin) {
    if (!st || !st.napId || !patterns || !patterns.sites) return null;
    const row = patterns.sites[st.napId];
    if (!row || row.length !== 48) return null;
    const at = (nowMs == null ? Date.now() : nowMs) + (aheadMin == null ? 60 : aheadMin) * 60000;
    const clock = rigaClock(at);
    const v = row[(clock.weekend ? 24 : 0) + clock.hour];
    if (v == null || v < 0) return null;
    return { pct: v, hour: clock.hour, atMs: at };
  }

  // Надёжность площадки: доля снимков, где часть точек не работала. null, пока снимков мало.
  function reliabilityOf(st, patterns) {
    if (!st || !st.napId || !patterns || !patterns.rel) return null;
    const r = patterns.rel[st.napId];
    if (!r || r.length !== 2) return null;
    const pct = r[0];
    return { pct, n: r[1], level: pct <= 3 ? 'good' : pct <= 12 ? 'mid' : 'bad' };
  }

  // Недавняя смена цены: { now, prev, delta, date } или null
  function priceChangeOf(st, patterns) {
    if (!st || !st.napId || !patterns || !patterns.px) return null;
    const r = patterns.px[st.napId];
    if (!r || r.length !== 3) return null;
    const delta = Math.round((r[0] - r[1]) * 100) / 100;
    if (!delta) return null;
    return { now: r[0], prev: r[1], delta, date: r[2] };
  }

  /* ---------- маршрут A→B ---------- */
  // Всё считаем на плоскости вокруг средней широты: для коридора в несколько километров точности хватает.
  function projector(lat0) {
    const kx = Math.cos((lat0 * Math.PI) / 180) * 111.32;
    return (lat, lon) => [lon * kx, lat * 110.57];
  }

  // Длина маршрута и накопленная длина до каждой точки; line: [[lat, lon], ...]
  function routeLengths(line) {
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversine(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]));
    return cum;
  }

  // Расстояние от точки до маршрута и место проекции вдоль него. { off, along } в километрах.
  function locateOnRoute(lat, lon, line, cum) {
    const pr = projector(lat);
    const p = pr(lat, lon);
    let best = null;
    for (let i = 1; i < line.length; i++) {
      const a = pr(line[i - 1][0], line[i - 1][1]);
      const b = pr(line[i][0], line[i][1]);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      let u = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
      u = Math.max(0, Math.min(1, u));
      const off = Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dy));
      if (!best || off < best.off) best = { off, along: cum[i - 1] + u * (cum[i] - cum[i - 1]) };
    }
    return best;
  }

  // Станции вдоль маршрута не дальше maxOffKm от него, по порядку следования
  function stationsAlong(stations, line, maxOffKm) {
    if (!line || line.length < 2) return [];
    const cum = routeLengths(line);
    let s = 90, w = 180, n = -90, e = -180;
    for (const q of line) { s = Math.min(s, q[0]); n = Math.max(n, q[0]); w = Math.min(w, q[1]); e = Math.max(e, q[1]); }
    const pad = maxOffKm / 100 + 0.02;
    const out = [];
    for (const st of stations) {
      if (st.lat < s - pad || st.lat > n + pad || st.lon < w - pad * 2 || st.lon > e + pad * 2) continue;
      const r = locateOnRoute(st.lat, st.lon, line, cum);
      if (r && r.off <= maxOffKm) out.push({ st, along: r.along, off: r.off });
    }
    out.sort((a, b) => a.along - b.along);
    return out;
  }

  // Не больше одной станции на каждые bucketKm вдоль маршрута: берём лучшую по scoreOf (больше лучше), при равенстве ближе к трассе
  function thinAlong(list, bucketKm, scoreOf) {
    const best = new Map();
    for (const c of list) {
      const k = Math.floor(c.along / bucketKm);
      const cur = best.get(k);
      const sc = scoreOf(c);
      if (!cur || sc > cur.sc || (sc === cur.sc && c.off < cur.c.off)) best.set(k, { c, sc });
    }
    return Array.from(best.values()).map((x) => x.c).sort((a, b) => a.along - b.along);
  }

  // Остановки на зарядку. Едем с start% до резерва 10%, заряжаемся до 80% на быстрых станциях.
  // Возвращает { total, stops: [{st, along, off, arriveSoc}], ok, reason } .
  function planStops(car, cands, totalKm, startSoc, tempC, opts) {
    const o = opts || {};
    const reserve = 10;
    const target = 80;
    const minKw = o.minKw || 50;
    const out = { total: totalKm, stops: [], ok: true, reason: null };
    if (!car) return out;
    const usable = (soc) => Math.max(0, rangeKm(car, soc - reserve, tempC));
    let pos = 0;
    let soc = startSoc == null ? 90 : startSoc;
    for (let guard = 0; guard < 12; guard++) {
      const reach = usable(soc);
      if (totalKm - pos <= reach) return out;
      const lo = pos + 20; // ближе 20 км заряжаться бессмысленно
      const win = cands.filter((c) => c.along > lo && c.along <= pos + reach && (carPowerKw(car, c.st) || 0) >= Math.min(minKw, car.dc));
      if (!win.length) { out.ok = false; out.reason = pos === 0 ? 'noStart' : 'noNext'; return out; }
      // Чем дальше достижимая быстрая станция, тем меньше остановок: берём из последних 30% запаса
      // самую мощную (при равенстве ближе к трассе); если там пусто, самую дальнюю из достижимых.
      const far = win.filter((c) => c.along >= pos + reach * 0.7);
      const pick = far.length
        ? far.slice().sort((x, y) => (carPowerKw(car, y.st) || 0) - (carPowerKw(car, x.st) || 0) || x.off - y.off)[0]
        : win.slice().sort((x, y) => y.along - x.along)[0];
      const used = pick.along - pos;
      const arrive = Math.max(reserve, soc - (used / (rangeKm(car, 100, tempC) || 1)) * 100);
      out.stops.push({ st: pick.st, along: pick.along, off: pick.off, arriveSoc: Math.round(arrive) });
      pos = pick.along;
      soc = target;
    }
    out.ok = false;
    out.reason = 'tooMany';
    return out;
  }

  /* ---------- журнал зарядок ---------- */
  const CHARGE_LIMIT = 500;

  const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) ? n : null;
  };

  // Запись журнала из формы: кВт·ч и сумма обязательны, остальное по возможности.
  // -> { id, ts, kwh, eur, name } или null, если числа не годятся
  function normalizeCharge(raw, nowMs) {
    if (!raw) return null;
    const kwh = num(raw.kwh);
    const eur = num(raw.eur);
    if (kwh == null || eur == null || kwh <= 0 || kwh > 300 || eur < 0 || eur > 1000) return null;
    const now = nowMs == null ? Date.now() : nowMs;
    let ts = num(raw.ts);
    if (ts == null || ts <= 0 || ts > now + 3600 * 1000) ts = now;
    const name = String(raw.name == null ? '' : raw.name).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
    return {
      id: String(raw.id || ts.toString(36) + Math.floor((now % 997) * 7).toString(36)),
      ts: Math.round(ts),
      kwh: Math.round(kwh * 100) / 100,
      eur: Math.round(eur * 100) / 100,
      name,
    };
  }

  // Добавляет запись в начало, новые выше; хранит не больше CHARGE_LIMIT, без дублей по id.
  function addCharge(list, entry) {
    const rest = (Array.isArray(list) ? list : []).filter((e) => e && e.id !== entry.id);
    return [entry].concat(rest).sort((a, b) => b.ts - a.ts).slice(0, CHARGE_LIMIT);
  }

  // Месяц по времени Риги, вида «2026-10».
  function rigaMonth(ms) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit' }).formatToParts(ms);
    const get = (type) => (parts.find((x) => x.type === type) || {}).value;
    return get('year') + '-' + get('month');
  }

  function prevMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
  }

  // Итоги за месяц: { count, kwh, eur, perKwh } (perKwh = null, если энергии нет).
  function monthTotals(list, key) {
    let count = 0, kwh = 0, eur = 0;
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || rigaMonth(e.ts) !== key) continue;
      count++; kwh += e.kwh; eur += e.eur;
    }
    return { count, kwh: Math.round(kwh * 100) / 100, eur: Math.round(eur * 100) / 100, perKwh: kwh > 0 ? Math.round((eur / kwh) * 1000) / 1000 : null };
  }

  // -> { cur: итоги этого месяца, prev: итоги прошлого, key }
  function chargeSummary(list, nowMs) {
    const key = rigaMonth(nowMs == null ? Date.now() : nowMs);
    return { key, cur: monthTotals(list, key), prev: monthTotals(list, prevMonth(key)) };
  }

  /* ---------- удобства рядом со станцией (OpenStreetMap) ---------- */
  const AMENITY_RADIUS_M = 100;

  // Запрос Overpass: туалеты, еда, магазины и Wi-Fi вокруг точки.
  function amenityQuery(lat, lon, radius) {
    const r = Math.round(radius || AMENITY_RADIUS_M);
    const a = '(around:' + r + ',' + Number(lat).toFixed(5) + ',' + Number(lon).toFixed(5) + ')';
    return '[out:json][timeout:25];(' +
      'nwr["amenity"~"^(toilets|cafe|restaurant|fast_food)$"]' + a + ';' +
      'nwr["shop"~"^(convenience|supermarket|kiosk)$"]' + a + ';' +
      'nwr["internet_access"~"^(wlan|wifi|yes)$"]' + a + ';' +
      ');out tags;';
  }

  // Элементы Overpass -> { toilets, food, shop, wifi } (числа, без повторов по id).
  function parseAmenities(elements) {
    const out = { toilets: 0, food: 0, shop: 0, wifi: 0 };
    const seen = new Set();
    for (const el of Array.isArray(elements) ? elements : []) {
      if (!el || !el.tags || typeof el.tags !== 'object') continue;
      const key = el.type + '/' + el.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const tg = el.tags;
      if (tg.amenity === 'charging_station') continue; // сама станция не удобство
      if (tg.amenity === 'toilets') out.toilets++;
      if (/^(cafe|restaurant|fast_food)$/.test(tg.amenity || '')) out.food++;
      if (/^(convenience|supermarket|kiosk)$/.test(tg.shop || '')) out.shop++;
      if (/^(wlan|wifi|yes)$/.test(tg.internet_access || '')) out.wifi++;
    }
    return out;
  }

  return {
    OPERATORS,
    PRICES,
    PRICES_DATE,
    KWH_PER_100KM,
    operatorOf,
    parseKw,
    parseSockets,
    classify,
    toStation,
    haversine,
    priceFor,
    priceTable,
    hasLivePrice,
    setLivePrices,
    isLiveFresh,
    liveTime,
    pointMatches,
    liveSummary,
    livePriceOf,
    priceOf,
    buildPriceTable,
    prettyName,
    napStation,
    mergeLive,
    parsePay,
    rigaClock,
    patternFor,
    MATCH_M,
    LIVE_FRESH_MS,
    segments,
    chargeMinutes100,
    CARS,
    normalizeCar,
    carAccepts,
    carPowerKw,
    chargeEstimate,
    coldFactor,
    rangeKm,
    costPer100,
    matchesQuery,
    isOpen247,
    forecastFor,
    reliabilityOf,
    priceChangeOf,
    routeLengths,
    locateOnRoute,
    stationsAlong,
    thinAlong,
    planStops,
    matchesConnector,
    matchesSpeed,
    applyFilters,
    rank,
    CHARGE_LIMIT,
    normalizeCharge,
    addCharge,
    rigaMonth,
    monthTotals,
    chargeSummary,
    AMENITY_RADIUS_M,
    amenityQuery,
    parseAmenities,
  };
});
