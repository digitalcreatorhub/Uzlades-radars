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

console.log('\n' + passed + ' tests passed');
