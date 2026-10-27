// Запуск: node tests/logic.test.js
const assert = require('node:assert/strict');
const UR = require('../logic.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok  ' + name);
}

test('parseKw: единицы и списки', () => {
  assert.equal(UR.parseKw('22 kW'), 22);
  assert.equal(UR.parseKw('150000'), 150);
  assert.equal(UR.parseKw('11,5 kW'), 11.5);
  assert.equal(UR.parseKw('50;22 kW'), 50);
  assert.equal(UR.parseKw('7400 W'), 7.4);
  assert.equal(UR.parseKw('abc'), null);
  assert.equal(UR.parseKw(undefined), null);
});

test('classify: границы классов', () => {
  assert.equal(UR.classify(11), 'ac');
  assert.equal(UR.classify(43), 'ac');
  assert.equal(UR.classify(50), 'dc');
  assert.equal(UR.classify(149), 'dc');
  assert.equal(UR.classify(150), 'hpc');
  assert.equal(UR.classify(null), 'unknown');
});

test('operatorOf: известные и неизвестные сети', () => {
  assert.equal(UR.operatorOf({ operator: 'Elektrum Drive' }).id, 'elektrum');
  assert.equal(UR.operatorOf({ brand: 'Virši-A' }).id, 'virsi');
  assert.equal(UR.operatorOf({ network: 'Enefit Volt' }).id, 'enefit');
  assert.equal(UR.operatorOf({ operator: 'CSDD e-mobi' }).id, 'emobi');
  const other = UR.operatorOf({ operator: 'Riga Parking SIA' });
  assert.equal(other.id, 'other');
  assert.equal(other.name, 'Riga Parking SIA');
  assert.equal(UR.operatorOf({}).name, null);
});

test('toStation: узел с CCS 150 кВт', () => {
  const st = UR.toStation({
    type: 'node',
    id: 1,
    lat: 56.95,
    lon: 24.1,
    tags: {
      amenity: 'charging_station',
      operator: 'Ignitis ON',
      capacity: '4',
      'socket:type2_combo': '2',
      'socket:type2_combo:output': '150 kW',
      'socket:type2': '2',
      'socket:type2:output': '22 kW',
      'addr:street': 'Brīvības iela',
      'addr:housenumber': '10',
    },
  });
  assert.equal(st.cls, 'hpc');
  assert.equal(st.kw, 150);
  assert.equal(st.powerKnown, true);
  assert.deepEqual(st.sockets, { ccs: 2, type2: 2 });
  assert.equal(st.points, 4);
  assert.equal(st.address, 'Brīvības iela 10');
  assert.equal(st.id, 'node/1');
});

test('toStation: way берёт координаты из center', () => {
  const st = UR.toStation({
    type: 'way',
    id: 7,
    center: { lat: 56.9, lon: 24.2 },
    tags: { amenity: 'charging_station', 'socket:type2': 'yes' },
  });
  assert.equal(st.lat, 56.9);
  assert.equal(st.lon, 24.2);
  // мощность не указана, только Type 2 -> оценка 22 кВт, помечена как неточная
  assert.equal(st.kw, 22);
  assert.equal(st.powerKnown, false);
  assert.equal(st.cls, 'ac');
});

test('toStation: приватные и без координат отбрасываются', () => {
  assert.equal(UR.toStation({ type: 'node', id: 2, lat: 1, lon: 1, tags: { access: 'private' } }), null);
  assert.equal(UR.toStation({ type: 'node', id: 3, tags: {} }), null);
});

test('toStation: без разъёмов и мощности -> unknown', () => {
  const st = UR.toStation({ type: 'node', id: 4, lat: 56.9, lon: 24.1, tags: { amenity: 'charging_station' } });
  assert.equal(st.cls, 'unknown');
  assert.equal(st.kw == null, true);
  assert.equal(st.powerKnown, false);
});

test('priceFor: точный класс, запасной класс и неизвестная сеть', () => {
  assert.equal(UR.priceFor('elektrum', 'dc').lo, 0.44);
  // у Virši нет AC-тарифа, берём DC как запасной
  assert.equal(UR.priceFor('virsi', 'ac').lo, 0.28);
  // у IONITY есть только hpc, для dc берём его как запасной
  assert.equal(UR.priceFor('ionity', 'dc').mid, 0.76);
  assert.equal(UR.priceFor('tesla', 'dc'), null);
  assert.equal(UR.priceFor('other', 'dc'), null);
  assert.equal(UR.priceFor('elektrum', 'unknown'), null);
});

test('segments и chargeMinutes100', () => {
  assert.equal(UR.segments(7), 1);
  assert.equal(UR.segments(22), 2);
  assert.equal(UR.segments(50), 3);
  assert.equal(UR.segments(120), 4);
  assert.equal(UR.segments(300), 5);
  assert.equal(UR.segments(150), 5); // граница класса HPC
  assert.equal(UR.segments(149), 4);
  assert.equal(UR.segments(43), 2);
  assert.equal(UR.segments(null), 0);
  // 17 кВт·ч при 0.8*100 кВт = 12.75 мин -> 15
  assert.equal(UR.chargeMinutes100(300, 'hpc'), 15);
  // AC 22 кВт, машина берёт 11: 17/(11*0.8)*60 = 115.9 -> 115
  assert.equal(UR.chargeMinutes100(22, 'ac'), 115);
});

test('applyFilters и rank', () => {
  const mk = (id, lat, lon, tags) => UR.toStation({ type: 'node', id, lat, lon, tags: { amenity: 'charging_station', ...tags } });
  const stations = [
    mk(1, 56.9496, 24.1052, { operator: 'Virši', 'socket:type2_combo': '2', 'socket:type2_combo:output': '50 kW' }),
    mk(2, 56.9500, 24.1100, { operator: 'IONITY', 'socket:type2_combo': '4', 'socket:type2_combo:output': '350 kW' }),
    mk(3, 56.9600, 24.1200, { operator: 'Elektrum Drive', 'socket:type2': '2', 'socket:type2:output': '22 kW' }),
    mk(4, 56.9700, 24.1300, { operator: 'Eleport', 'socket:chademo': '1', 'socket:chademo:output': '50 kW' }),
  ];
  const f = (o) => ({ connector: 'any', power: 'any', operator: 'all', ...o });
  assert.equal(UR.applyFilters(stations, f({})).length, 4);
  assert.deepEqual(UR.applyFilters(stations, f({ connector: 'ccs' })).map((s) => s.osmId), [1, 2]);
  assert.deepEqual(UR.applyFilters(stations, f({ connector: 'chademo' })).map((s) => s.osmId), [4]);
  assert.deepEqual(UR.applyFilters(stations, f({ power: 'ultra' })).map((s) => s.osmId), [2]);
  assert.deepEqual(UR.applyFilters(stations, f({ power: 'fast' })).map((s) => s.osmId), [1, 2, 4]);
  assert.deepEqual(UR.applyFilters(stations, f({ operator: 'virsi' })).map((s) => s.osmId), [1]);

  const origin = { lat: 56.9496, lon: 24.1052 };
  const near = UR.rank(stations, origin, 'near');
  assert.equal(near[0].st.osmId, 1); // ближайшая станция выигрывает при приоритете «ближе»
  const cheap = UR.rank(UR.applyFilters(stations, f({ connector: 'ccs' })), origin, 'cheap');
  assert.equal(cheap[0].st.osmId, 1); // Virši 50 кВт дешевле IONITY
  assert.ok(near[0].distKm < 0.01);
  assert.equal(near.every((r) => typeof r.score === 'number' && isFinite(r.score)), true);
  // станция без известной цены не ломает ранжирование
  const noPrice = UR.rank([mk(9, 56.95, 24.11, { operator: 'Tesla', 'socket:tesla_supercharger': '8', 'socket:tesla_supercharger:output': '250 kW' })], origin, 'balanced');
  assert.equal(noPrice[0].price, null);
  assert.equal(noPrice[0].costPer100, null);
});

test('haversine: Рига центр -> аэропорт примерно 8–10 км', () => {
  const d = UR.haversine(56.9496, 24.1052, 56.9236, 23.9711);
  assert.ok(d > 7 && d < 11, 'd=' + d);
});

/* ---------- живые данные национальной точки доступа ---------- */
const NOW = Date.parse('2026-10-27T10:00:00Z');
const BBOX = [56.85, 23.93, 57.07, 24.35];
const pt = (t, kw, s, p) => ({ e: 'LV*X*' + Math.random(), t, m: kw > 43 ? 'dc' : 'ac', kw, s, p });
const site = (id, lat, lon, op, pts, extra) =>
  Object.assign({ id, n: 'CODE_1-2', op, lat, lon, a: 'Brīvības iela 1', c: 'Rīga', h: '24/7', u: '2026-10-27T09:30:00+00:00', pts }, extra || {});
const liveOf = (sites, statusTime) => ({ v: 1, statusTime: statusTime || '2026-10-27T09:50:00+00:00', sites });

test('isLiveFresh: до 90 минут свежие, старше нет', () => {
  assert.equal(UR.isLiveFresh(liveOf([], '2026-10-27T09:50:00+00:00'), NOW), true);
  assert.equal(UR.isLiveFresh(liveOf([], '2026-10-27T08:00:00+00:00'), NOW), false);
  assert.equal(UR.isLiveFresh({ sites: [] }, NOW), false);
});

test('prettyName: внутренние коды скрываем, нормальные названия оставляем', () => {
  assert.equal(UR.prettyName('PLVRIXPB12_EDLV-52'), '');
  assert.equal(UR.prettyName('Elektrum, DC 50kW'), 'Elektrum, DC 50kW');
  assert.equal(UR.prettyName('CODE_with space'), '');
  assert.equal(UR.prettyName(null), '');
});

test('mergeLive: NAP-станция без соседей по OSM добавляется как новая', () => {
  const live = liveOf([site('a1', 56.95, 24.11, 'Elektrum Drive', [pt('ccs', 150, 'free', 0.44), pt('type2', 22, 'busy', 0.4)])]);
  const out = UR.mergeLive([], live, { bbox: BBOX, now: NOW });
  assert.equal(out.length, 1);
  const st = out[0];
  assert.equal(st.id, 'nap:a1');
  assert.equal(st.operatorId, 'elektrum');
  assert.equal(st.cls, 'hpc');
  assert.deepEqual(st.sockets, { ccs: 1, type2: 1 });
  assert.equal(st.points, 2);
  assert.equal(st.name, ''); // код "CODE_1-2" не показываем
  assert.equal(st.address, 'Brīvības iela 1');
  assert.equal(st.osmType, null);
});

test('mergeLive: станция OSM рядом поглощается, название и OSM-id сохраняются, данные берутся из NAP', () => {
  const osm = [
    UR.toStation({ type: 'node', id: 7, lat: 56.95, lon: 24.11, tags: { amenity: 'charging_station', name: 'Galleria Riga', operator: 'Elektrum Drive', 'socket:type2': '1' } }),
    // второй узел OSM на той же площадке (50 м) тоже поглощается, а не дублируется
    UR.toStation({ type: 'node', id: 8, lat: 56.95035, lon: 24.11, tags: { amenity: 'charging_station', operator: 'Elektrum Drive', 'socket:type2': '1' } }),
    // далёкая станция остаётся
    UR.toStation({ type: 'node', id: 9, lat: 56.96, lon: 24.12, tags: { amenity: 'charging_station', operator: 'Virši', 'socket:type2_combo': '2' } }),
  ];
  const live = liveOf([site('a1', 56.95, 24.11, 'Elektrum Drive', [pt('ccs', 150, 'free', 0.44)])]);
  const out = UR.mergeLive(osm, live, { bbox: BBOX, now: NOW });
  assert.equal(out.length, 2);
  const merged = out.find((s) => s.id === 'node/7');
  assert.ok(merged, 'должен остаться id узла OSM');
  assert.equal(merged.name, 'Galleria Riga');
  assert.equal(merged.osmId, 7);
  assert.equal(merged.cls, 'hpc');
  assert.equal(merged.live.pts.length, 1);
  assert.ok(!out.some((s) => s.id === 'node/8'), 'дубль с той же площадки удалён');
  assert.ok(out.some((s) => s.id === 'node/9'));
});

test('mergeLive: разные известные сети рядом не склеиваются', () => {
  const osm = [UR.toStation({ type: 'node', id: 1, lat: 56.95, lon: 24.11, tags: { amenity: 'charging_station', operator: 'Virši', 'socket:type2_combo': '1' } })];
  const live = liveOf([site('a1', 56.95, 24.11, 'Elektrum Drive', [pt('ccs', 50, 'free', 0.44)])]);
  assert.equal(UR.mergeLive(osm, live, { bbox: BBOX, now: NOW }).length, 2);
});

test('mergeLive: площадки вне Риги отбрасываются; без live вернёт OSM как есть', () => {
  const live = liveOf([site('far', 57.5, 25.4, 'Elektrum Drive', [pt('ccs', 50, 'free', 0.44)])]);
  assert.equal(UR.mergeLive([], live, { bbox: BBOX, now: NOW }).length, 0);
  const osm = [UR.toStation({ type: 'node', id: 1, lat: 56.95, lon: 24.11, tags: { amenity: 'charging_station', 'socket:type2': '1' } })];
  assert.equal(UR.mergeLive(osm, null, { bbox: BBOX, now: NOW }).length, 1);
});

test('mergeLive: устаревший поток не выдаёт статусы за актуальные', () => {
  const live = liveOf([site('a1', 56.95, 24.11, 'Elektrum Drive', [pt('ccs', 50, 'free', 0.44)])], '2026-10-27T06:00:00+00:00');
  const st = UR.mergeLive([], live, { bbox: BBOX, now: NOW })[0];
  assert.equal(st.live.pts[0].s, 'unk');
  assert.equal(UR.liveSummary(st).level, 'unknown');
  assert.equal(st.live.pts[0].p, 0.44); // цену оставляем
});

test('liveSummary: подсчёт, уровни и учёт фильтра по разъёму', () => {
  const st = UR.mergeLive([], liveOf([site('a1', 56.95, 24.11, 'Elektrum Drive', [
    pt('ccs', 150, 'busy', 0.5), pt('ccs', 150, 'busy', 0.5), pt('type2', 22, 'free', 0.3), pt('chademo', 50, 'out', 0.5),
  ])]), { bbox: BBOX, now: NOW })[0];
  const all = UR.liveSummary(st);
  assert.deepEqual([all.free, all.busy, all.out, all.total, all.level], [1, 2, 1, 4, 'free']);
  const ccs = UR.liveSummary(st, { connector: 'ccs', power: 'any' });
  assert.deepEqual([ccs.free, ccs.busy, ccs.total, ccs.level], [0, 2, 2, 'busy']);
  const cha = UR.liveSummary(st, { connector: 'chademo', power: 'any' });
  assert.equal(cha.level, 'out');
  assert.equal(UR.liveSummary(st, { connector: 'tesla', power: 'any' }), null);
  const ultra = UR.liveSummary(st, { connector: 'any', power: 'ultra' });
  assert.equal(ultra.total, 2);
  assert.equal(UR.liveSummary({ sockets: {} }), null);
});

test('livePriceOf: цена быстрых точек без фильтра, по фильтру только подходящие', () => {
  const st = UR.mergeLive([], liveOf([site('a1', 56.95, 24.11, 'Elektrum Drive', [
    pt('ccs', 150, 'free', 0.51), pt('type2', 22, 'free', 0.32),
  ])]), { bbox: BBOX, now: NOW })[0];
  assert.deepEqual([UR.livePriceOf(st).lo, UR.livePriceOf(st).hi], [0.51, 0.51]);
  const ac = UR.livePriceOf(st, { connector: 'type2', power: 'any' });
  assert.deepEqual([ac.lo, ac.hi], [0.32, 0.32]);
  assert.equal(UR.livePriceOf({ live: null }), null);
});

test('rank: все заняты уходит ниже, неработающая в самый конец, цена берётся из NAP', () => {
  const origin = { lat: 56.9496, lon: 24.1052 };
  const mkSite = (id, lat, s) => site(id, lat, 24.1052, 'Elektrum Drive', [pt('ccs', 150, s, 0.44)]);
  const stations = UR.mergeLive([], liveOf([mkSite('near-busy', 56.951, 'busy'), mkSite('mid-free', 56.965, 'free'), mkSite('near-out', 56.9505, 'out')]), { bbox: BBOX, now: NOW });
  const ranked = UR.rank(stations, origin, 'near', { connector: 'any', power: 'any' });
  assert.equal(ranked[0].st.id, 'nap:mid-free', 'свободная дальше выигрывает у занятой вплотную');
  assert.equal(ranked[ranked.length - 1].st.id, 'nap:near-out');
  assert.equal(ranked[0].live.level, 'free');
  assert.equal(ranked[0].price.live, true);
  assert.equal(ranked[0].price.mid, 0.44);
});

test('buildPriceTable + setLivePrices: живые цены перекрывают справочные, остальное остаётся', () => {
  const sites = [];
  for (const p of [0.30, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.90]) sites.push(site('s' + p, 56.95, 24.11, 'Ignitis ON', [pt('ccs', 60, 'free', p)]));
  const table = UR.buildPriceTable(liveOf(sites));
  assert.ok(table.ignitis && table.ignitis.dc, 'DC для Ignitis посчитан');
  assert.deepEqual(table.ignitis.dc, [0.31, 0.39], 'крайние значения (0,30 и выброс 0,90) отсечены');
  UR.setLivePrices(table);
  try {
    assert.ok(UR.hasLivePrice('ignitis', 'dc'));
    assert.equal(UR.priceTable('ignitis').ac[0], UR.PRICES.ignitis.ac[0], 'AC остался справочным');
    assert.equal(UR.priceFor('ignitis', 'dc').lo, 0.31);
  } finally {
    UR.setLivePrices({});
  }
  assert.equal(UR.priceFor('ignitis', 'dc').lo, UR.PRICES.ignitis.dc[0]);
});

test('parsePay: оплата из тегов OSM', () => {
  assert.deepEqual(UR.parsePay({ 'authentication:app': 'yes', 'payment:credit_cards': 'yes' }), ['app', 'card']);
  assert.deepEqual(UR.parsePay({ 'authentication:membership_card': 'yes', 'authentication:nfc': 'yes' }), ['rfid']);
  assert.deepEqual(UR.parsePay({ 'authentication:app': 'no' }), []);
  const st = UR.toStation({ type: 'node', id: 1, lat: 56.95, lon: 24.11, tags: { amenity: 'charging_station', 'authentication:app': 'yes', 'socket:type2': '1' } });
  assert.deepEqual(st.pay, ['app']);
});

test('mergeLive: оплата берётся из NAP, при её отсутствии из OSM; время смены статуса сохраняется', () => {
  const osm = [UR.toStation({ type: 'node', id: 1, lat: 56.95, lon: 24.11, tags: { amenity: 'charging_station', operator: 'Elektrum Drive', 'payment:credit_cards': 'yes', 'socket:type2': '1' } })];
  const withPay = liveOf([site('a1', 56.95, 24.11, 'Elektrum Drive', [Object.assign(pt('ccs', 50, 'busy', 0.44), { u: 29_000_000 })], { pay: ['app', 'rfid'] })]);
  const m1 = UR.mergeLive(osm, withPay, { bbox: BBOX, now: NOW })[0];
  assert.deepEqual(m1.pay, ['app', 'rfid']);
  assert.equal(m1.live.pts[0].u, 29_000_000);
  assert.equal(m1.napId, 'a1');
  const noPay = liveOf([site('a1', 56.95, 24.11, 'Elektrum Drive', [pt('ccs', 50, 'free', 0.44)], { pay: [] })]);
  assert.deepEqual(UR.mergeLive(osm, noPay, { bbox: BBOX, now: NOW })[0].pay, ['card']);
  // NAP-площадка без поля pay (старый live.json) не ломает работу
  const old = liveOf([site('a2', 56.97, 24.13, 'Elektrum Drive', [pt('ccs', 50, 'free', 0.44)])]);
  assert.deepEqual(UR.mergeLive([], old, { bbox: BBOX, now: NOW })[0].pay, []);
});

test('rigaClock: час и выходной по времени Риги', () => {
  // вторник 27.10.2026 10:00 UTC: в Риге 12:00, будни
  assert.deepEqual(UR.rigaClock(Date.parse('2026-10-27T10:00:00Z')), { hour: 12, weekend: false });
  // пятница 30.10 22:30 UTC: в Риге уже суббота 00:30
  assert.deepEqual(UR.rigaClock(Date.parse('2026-10-30T22:30:00Z')), { hour: 0, weekend: true });
  // летнее время (UTC+3): 15.07.2026 (среда) 10:00 UTC = 13:00
  assert.deepEqual(UR.rigaClock(Date.parse('2026-07-15T10:00:00Z')), { hour: 13, weekend: false });
});

test('patternFor: берёт нужные сутки и текущий час, без данных возвращает null', () => {
  const row = Array.from({ length: 48 }, (_, i) => (i === 12 ? 40 : i === 36 ? 90 : -1));
  const patterns = { since: '2026-10-27', sites: { a1: row } };
  const st = { napId: 'a1' };
  const weekday = UR.patternFor(st, patterns, Date.parse('2026-10-27T10:00:00Z'));
  assert.equal(weekday.now, 40);
  assert.equal(weekday.weekend, false);
  assert.equal(weekday.hours.length, 24);
  const weekend = UR.patternFor(st, patterns, Date.parse('2026-10-31T10:00:00Z')); // суббота 12:00
  assert.equal(weekend.weekend, true);
  assert.equal(weekend.now, 90);
  assert.equal(UR.patternFor({ napId: 'zzz' }, patterns), null);
  assert.equal(UR.patternFor({ napId: 'a1' }, { sites: { a1: new Array(48).fill(-1) } }), null);
  assert.equal(UR.patternFor({}, patterns), null);
  assert.equal(UR.patternFor(st, null), null);
});

/* ---------- профиль машины ---------- */
const mkSt = (o) => Object.assign({ id: 'x', lat: 56.95, lon: 24.1, sockets: {}, kw: null, cls: 'unknown', pay: [], operatorId: 'other' }, o);
const car = (id) => UR.normalizeCar({ id });

test('normalizeCar: мусор заменяется значениями пресета, правки сохраняются', () => {
  assert.equal(UR.normalizeCar(null), null);
  assert.equal(UR.normalizeCar('x'), null);
  const c = UR.normalizeCar({ id: 'leaf40', kwh: '41,5', dc: 'abc', conn: ['foo'], cons: 99 });
  assert.equal(c.kwh, 41.5);
  assert.equal(c.dc, 46, 'не число: берём из пресета');
  assert.deepEqual(c.conn, ['chademo', 'type2'], 'неизвестные разъёмы отбрасываются');
  assert.equal(c.cons, 16.5, 'вне допустимых границ: из пресета');
  assert.equal(c.onlyCompatible, true);
});

test('carAccepts: Leaf не ездит на CCS, а станции без данных не прячем', () => {
  const leaf = car('leaf40');
  assert.equal(UR.carAccepts(leaf, mkSt({ sockets: { ccs: 2 } })), false);
  assert.equal(UR.carAccepts(leaf, mkSt({ sockets: { ccs: 2, chademo: 1 } })), true);
  assert.equal(UR.carAccepts(leaf, mkSt({ sockets: {} })), true);
  assert.equal(UR.carAccepts(car('id3'), mkSt({ sockets: { tesla: 4 } })), false, 'фирменный разъём Tesla чужой машине не подходит');
  assert.equal(UR.carAccepts(car('tesla3'), mkSt({ sockets: { tesla: 4 } })), true);
  assert.equal(UR.carAccepts(null, mkSt({ sockets: { tesla: 4 } })), true);
});

test('carPowerKw: предел машины и разъём, AC на смешанной станции не получает DC-мощность', () => {
  const id3 = car('id3'); // DC 120, AC 11
  assert.equal(UR.carPowerKw(id3, mkSt({ sockets: { ccs: 2 }, kw: 300 })), 120);
  assert.equal(UR.carPowerKw(id3, mkSt({ sockets: { type2: 2 }, kw: 22 })), 11);
  // станция CCS 150 + Type 2: Type 2 оцениваем не больше 22, но CCS остаётся лучшим
  assert.equal(UR.carPowerKw(id3, mkSt({ sockets: { ccs: 1, type2: 1 }, kw: 150 })), 120);
  assert.equal(UR.carPowerKw(car('leaf40'), mkSt({ sockets: { ccs: 2 }, kw: 150 })), null);
  // живые точки точнее: у станции есть CCS на 50 и 150, берём то, что подходит
  const live = mkSt({ sockets: { ccs: 2 }, kw: 150, live: { pts: [{ t: 'ccs', kw: 50 }, { t: 'ccs', kw: 150 }, { t: 'chademo', kw: 50 }] } });
  assert.equal(UR.carPowerKw(id3, live), 120);
  assert.equal(UR.carPowerKw(car('leaf40'), live), 46);
});

test('chargeEstimate: время и цена зарядки 20→80%', () => {
  const c = car('id3'); // 58 кВт·ч
  const e = UR.chargeEstimate(c, 100, { mid: 0.4 }, 20, 80);
  assert.ok(Math.abs(e.energy - 34.8) < 0.01);
  assert.ok(Math.abs(e.billed - 34.8 / 0.93) < 0.01);
  assert.equal(e.minutes, 25); // 37.4 кВт·ч / (100*0.85) кВт ≈ 26 мин, округление до 5
  assert.ok(Math.abs(e.cost - (34.8 / 0.93) * 0.4) < 0.01);
  assert.equal(UR.chargeEstimate(c, 0, { mid: 0.4 }), null);
  assert.equal(UR.chargeEstimate(c, 50, null, 80, 20), null);
  assert.equal(UR.chargeEstimate(c, 50, null).cost, null);
  assert.ok(UR.chargeEstimate(c, 11, { mid: 0.3 }).minutes > 200, 'розетка 11 кВт: часы');
});

test('coldFactor и rangeKm: холод сокращает запас', () => {
  assert.equal(UR.coldFactor(22), 1);
  assert.equal(UR.coldFactor(null), 1);
  assert.ok(UR.coldFactor(0) > 1.15 && UR.coldFactor(0) < 1.17);
  assert.ok(UR.coldFactor(-10) > 1.27 && UR.coldFactor(-10) < 1.29);
  assert.equal(UR.coldFactor(-50), UR.coldFactor(-25), 'ниже −25 не растёт дальше');
  const c = car('id3');
  assert.ok(UR.rangeKm(c, 100, -10) < UR.rangeKm(c, 100, 20) * 0.8);
  assert.equal(UR.rangeKm(null, 100, 20), null);
});

test('costPer100: станция, дом, бензин', () => {
  const r = UR.costPer100(car('id3'), 20, { stationPrice: 0.4, homePrice: 0.2, petrolPrice: 1.9, petrolCons: 7 });
  assert.ok(Math.abs(r.station - (16.5 / 0.93) * 0.4) < 0.01);
  assert.ok(Math.abs(r.home - (16.5 / 0.9) * 0.2) < 0.01);
  assert.equal(r.petrol, 7 * 1.9);
  assert.equal(UR.costPer100(null, 20, {}).station, null);
});

test('фильтры: свободно сейчас, 24/7, оплата картой, поиск без диакритики, совместимость', () => {
  const free = mkSt({ id: 'a', name: 'Rīgas Centrs', address: 'Brīvības iela 1', operatorName: 'Eleport', sockets: { ccs: 1 }, hours: '24/7', pay: ['app', 'card'],
    live: { pts: [{ t: 'ccs', kw: 50, s: 'free' }] } });
  const busy = mkSt({ id: 'b', name: 'Mols', sockets: { chademo: 1 }, hours: 'Mo-Su 08:00-22:00', pay: ['app'],
    live: { pts: [{ t: 'chademo', kw: 50, s: 'busy' }] } });
  const all = [free, busy];
  const base = { connector: 'any', power: 'any', operator: 'all' };
  assert.deepEqual(UR.applyFilters(all, Object.assign({}, base, { freeNow: true })).map((s) => s.id), ['a']);
  assert.deepEqual(UR.applyFilters(all, Object.assign({}, base, { open247: true })).map((s) => s.id), ['a']);
  assert.deepEqual(UR.applyFilters(all, Object.assign({}, base, { cardPay: true })).map((s) => s.id), ['a']);
  assert.deepEqual(UR.applyFilters(all, Object.assign({}, base, { query: 'brivibas' })).map((s) => s.id), ['a'], 'ī ≈ i');
  assert.deepEqual(UR.applyFilters(all, Object.assign({}, base, { query: 'eleport centrs' })).map((s) => s.id), ['a']);
  assert.deepEqual(UR.applyFilters(all, Object.assign({}, base, { query: 'нет такого' })).map((s) => s.id), []);
  assert.deepEqual(UR.applyFilters(all, Object.assign({}, base, { car: car('leaf40') })).map((s) => s.id), ['b']);
  assert.deepEqual(UR.applyFilters(all, Object.assign({}, base, { car: Object.assign({}, car('leaf40'), { onlyCompatible: false }) })).map((s) => s.id), ['a', 'b']);
});

test('«свободно» считает только точки с моими разъёмами', () => {
  const st = mkSt({ sockets: { ccs: 1, chademo: 1 }, live: { pts: [{ t: 'ccs', kw: 50, s: 'busy' }, { t: 'chademo', kw: 50, s: 'free' }] } });
  assert.equal(UR.liveSummary(st, { car: car('id3') }).level, 'busy');
  assert.equal(UR.liveSummary(st, { car: car('leaf40') }).level, 'free');
  assert.equal(UR.liveSummary(st, null).level, 'free');
});

test('rank с машиной: свой разъём выше, время по её мощности', () => {
  const here = { lat: 56.95, lon: 24.1 };
  const a = mkSt({ id: 'a', lat: 56.951, sockets: { ccs: 2 }, kw: 150, cls: 'hpc', operatorId: 'eleport' });
  const b = mkSt({ id: 'b', lat: 56.9505, sockets: { chademo: 1 }, kw: 50, cls: 'dc', operatorId: 'eleport' });
  const r = UR.rank([a, b], here, 'balanced', { connector: 'any', power: 'any', operator: 'all' }, { car: car('leaf40'), tempC: 20 });
  assert.equal(r[0].st.id, 'b');
  assert.equal(r[0].kwCar, 46);
  assert.equal(r[1].incompatible, true);
  const plain = UR.rank([a], here, 'balanced', { connector: 'any', power: 'any', operator: 'all' });
  assert.equal(plain[0].incompatible, false);
  assert.ok(plain[0].minutes > 0);
  // на морозе та же зарядка 100 км дольше
  const cold = UR.rank([a], here, 'balanced', { connector: 'any', power: 'any', operator: 'all' }, { car: car('id3'), tempC: -10 });
  const warm = UR.rank([a], here, 'balanced', { connector: 'any', power: 'any', operator: 'all' }, { car: car('id3'), tempC: 20 });
  assert.ok(cold[0].minutes >= warm[0].minutes && cold[0].costPer100 > warm[0].costPer100);
});

/* ---------- прогноз, надёжность, цена ---------- */
test('forecastFor: берёт нужные сутки и час через заданное время, переход через полночь и выходные', () => {
  const row = new Array(48).fill(-1);
  row[18] = 70;  // будни 18:00
  row[0] = 5;    // будни 00:00
  row[24] = 33;  // выходные 00:00
  const patterns = { sites: { a1: row } };
  const st = { napId: 'a1' };
  // вторник 27.10.2026 17:30 в Риге = 15:30 UTC; через час 18:30, будни
  assert.equal(UR.forecastFor(st, patterns, Date.parse('2026-10-27T15:30:00Z'), 60).pct, 70);
  // пятница 30.10 23:30 Рига (21:30 UTC) + 60 мин = суббота 00:30: выходные, час 0
  assert.equal(UR.forecastFor(st, patterns, Date.parse('2026-10-30T21:30:00Z'), 60).pct, 33);
  // час без данных: null, а не выдуманное число
  assert.equal(UR.forecastFor(st, patterns, Date.parse('2026-10-27T05:00:00Z'), 60), null);
  assert.equal(UR.forecastFor({ napId: 'zzz' }, patterns), null);
});

test('reliabilityOf и priceChangeOf: уровни и защита от мусора', () => {
  const p = { rel: { a: [1, 400], b: [8, 400], c: [30, 400] }, px: { a: [0.44, 0.41, '2026-10-27'], b: [0.4, 0.4, '2026-10-27'] } };
  assert.equal(UR.reliabilityOf({ napId: 'a' }, p).level, 'good');
  assert.equal(UR.reliabilityOf({ napId: 'b' }, p).level, 'mid');
  assert.equal(UR.reliabilityOf({ napId: 'c' }, p).level, 'bad');
  assert.equal(UR.reliabilityOf({ napId: 'zz' }, p), null);
  assert.equal(UR.reliabilityOf({ napId: 'a' }, {}), null);
  assert.deepEqual(UR.priceChangeOf({ napId: 'a' }, p), { now: 0.44, prev: 0.41, delta: 0.03, date: '2026-10-27' });
  assert.equal(UR.priceChangeOf({ napId: 'b' }, p), null, 'нулевая разница не новость');
  assert.equal(UR.priceChangeOf({}, p), null);
});

/* ---------- маршрут ---------- */
test('stationsAlong: порядок вдоль маршрута и отсев далёких станций', () => {
  // прямая линия с запада на восток по широте 57°, 0.1° долготы ≈ 6 км
  const line = [[57, 24.0], [57, 24.5], [57, 25.0]];
  const mk = (id, lat, lon) => mkSt({ id, lat, lon });
  const list = [mk('far', 57.2, 24.4), mk('late', 57.005, 24.9), mk('early', 56.995, 24.1), mk('mid', 57.0, 24.5)];
  const got = UR.stationsAlong(list, line, 3);
  assert.deepEqual(got.map((x) => x.st.id), ['early', 'mid', 'late']);
  assert.ok(got[0].along > 5 && got[0].along < 7.5, 'along=' + got[0].along);
  assert.ok(got[0].off > 0.4 && got[0].off < 0.7, 'off=' + got[0].off);
  assert.deepEqual(UR.stationsAlong(list, [[57, 24]], 3), []);
});

test('planStops: без остановок, с остановками и когда станций нет', () => {
  const c = car('id3'); // запас при 100% ≈ 351 км при +20 °C
  const mk = (id) => mkSt({ id, sockets: { ccs: 2 }, kw: 150 });
  const cands = [{ st: mk('s1'), along: 200, off: 1 }, { st: mk('s2'), along: 280, off: 0.5 }, { st: mk('s3'), along: 520, off: 2 }];
  const short = UR.planStops(c, cands, 150, 100, 20);
  assert.equal(short.ok, true); assert.equal(short.stops.length, 0);
  const mid = UR.planStops(c, cands, 400, 100, 20);
  assert.equal(mid.ok, true);
  assert.deepEqual(mid.stops.map((x) => x.st.id), ['s2'], 'берём дальнюю достижимую станцию');
  assert.ok(mid.stops[0].arriveSoc >= 10 && mid.stops[0].arriveSoc < 40);
  const two = UR.planStops(c, cands, 700, 100, 20);
  assert.deepEqual(two.stops.map((x) => x.st.id), ['s2', 's3'], 'две остановки подряд');
  const long = UR.planStops(c, cands, 900, 100, 20);
  assert.equal(long.ok, false);
  assert.equal(long.reason, 'noNext');
  const none = UR.planStops(c, [], 700, 100, 20);
  assert.equal(none.ok, false); assert.equal(none.reason, 'noStart');
  // на морозе запас меньше, и остановка нужна там, где летом хватало
  assert.equal(UR.planStops(c, cands, 300, 100, 20).stops.length, 0);
  assert.ok(UR.planStops(c, cands, 300, 100, -15).stops.length >= 1);
  // слабые станции (22 кВт) для остановки в дороге не берём
  const weak = [{ st: mkSt({ id: 'w', sockets: { type2: 2 }, kw: 22 }), along: 280, off: 0 }];
  assert.equal(UR.planStops(c, weak, 400, 100, 20).ok, false);
});

console.log('\n' + passed + ' tests passed');
