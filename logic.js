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

  // -> { lo, hi, mid } или null, если цену по этой сети/классу мы не знаем
  function priceFor(operatorId, cls) {
    const table = PRICES[operatorId];
    const order = FALLBACK_ORDER[cls];
    if (!table || !order) return null;
    for (const c of order) {
      if (table[c]) {
        const [lo, hi] = table[c];
        return { lo, hi, mid: (lo + hi) / 2 };
      }
    }
    return null;
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

  function applyFilters(stations, f) {
    return stations.filter(
      (st) =>
        matchesConnector(st, f.connector) &&
        matchesSpeed(st, f.power) &&
        (f.operator === 'all' || st.operatorId === f.operator)
    );
  }

  const WEIGHTS = {
    balanced: { dist: 1.5, price: 1.5, time: 1 },
    cheap: { dist: 0.5, price: 3, time: 0.5 },
    near: { dist: 3, price: 1, time: 1 },
  };
  const UNKNOWN_PRICE = 0.45; // для станций без известной цены: чуть выше среднего, чтобы не выигрывали вслепую

  // Добавляет расстояние, цену, время и оценку; сортирует от лучшей к худшей.
  function rank(stations, origin, priority) {
    const w = WEIGHTS[priority] || WEIGHTS.balanced;
    const out = stations.map((st) => {
      const distKm = haversine(origin.lat, origin.lon, st.lat, st.lon);
      const price = priceFor(st.operatorId, st.cls);
      const minutes = chargeMinutes100(st.kw, st.cls);
      const p = price ? price.mid : UNKNOWN_PRICE;
      const score =
        distKm * w.dist + ((p - 0.25) / 0.1) * w.price + ((minutes == null ? 60 : minutes) / 10) * w.time;
      return {
        st,
        distKm,
        price,
        minutes,
        costPer100: price ? price.mid * KWH_PER_100KM : null,
        score,
      };
    });
    out.sort((a, b) => a.score - b.score);
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
    segments,
    chargeMinutes100,
    matchesConnector,
    matchesSpeed,
    applyFilters,
    rank,
  };
});
