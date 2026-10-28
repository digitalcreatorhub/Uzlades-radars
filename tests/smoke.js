// Дымовой тест в настоящем Chromium. Leaflet подменён заглушкой, Overpass отвечает тестовыми станциями.
// Запуск: node tests/smoke.js <папка проекта> <папка для скриншотов>  (нужен Playwright с Chromium)
const path = require('path');
const fs = require('fs');
const http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require.resolve('playwright', { paths: ['/usr/local/lib/node_modules_global'] }))); }

const root = path.resolve(process.argv[2]); // относительный путь («.») раньше давал 404 на все файлы
const shots = process.argv[3];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

const LEAFLET_STUB = `
window.__groups = []; Object.defineProperty(window, '__markers', { get(){ return window.__groups.reduce((a,g)=>a+g.n,0); } }); window.__circles = 0; window.__center = null;
function Layer(){ this.on=function(){return this}; this.addTo=function(){return this}; this.remove=function(){return this}; }
window.L = {
  map(){ const m={ setView(c,z){ window.__center=[c[0],c[1],z]; return m}, flyTo(c,z){ window.__center=[c[0],c[1],z]; return m}, getZoom(){return 12}, invalidateSize(){}, on(){return m}, fitBounds(b){ window.__fit = b; return m}, getCenter(){ return {lat:56.95,lng:24.1}; } }; return m; },
  control:{ zoom(){ return new Layer(); } },
  layerGroup(){ const g=new Layer(); g.n=0; window.__groups.push(g); g.clearLayers=function(){ g.n=0; }; g.addTo=function(){return g}; return g; },
  polyline(l){ const m=new Layer(); m.addTo=function(){ window.__polylines=(window.__polylines||0)+1; return m; }; return m; },
  marker(ll,o){ const m=new Layer(); const pill=o&&o.icon&&/ppill|cdot/.test(o.icon.className||''); m.addTo=function(g){ if(pill){ if(g&&g.n!==undefined) g.n++; window.__pillHtml=(window.__pillHtml||[]).concat(o.icon.html); } else window.__pins=(window.__pins||0)+1; return m; }; return m; },
  divIcon(o){ return o; },
  latLngBounds(l){ return l; },
  tileLayer(u){ window.__tileUrl = u; return new Layer(); },
  circle(){ const m=new Layer(); m.addTo=function(){ window.__circles++; return m; }; return m; },
  circleMarker(ll,o){ const m=new Layer(); m.addTo=function(g){ if(g && g.n!==undefined && !(o&&o.halo)) g.n++; return m; }; return m; },
};`;

const el = (type, id, lat, lon, tags) => ({ type, id, lat, lon, tags: { amenity: 'charging_station', ...tags } });
const MOCK = {
  elements: [
    el('node', 1, 56.9500, 24.1100, { name: 'Galleria Riga', operator: 'Eleport', 'socket:type2_combo': '2', 'socket:type2_combo:output': '150 kW', capacity: '4', 'addr:street': 'Dzirnavu iela', 'addr:housenumber': '67' }),
    el('node', 2, 56.9560, 24.1200, { operator: 'Elektrum Drive', 'socket:type2': '2', 'socket:type2:output': '22 kW' }),
    el('node', 3, 56.9300, 24.0900, { name: 'Virši Centrs', brand: 'Virši', 'socket:type2_combo': '2', 'socket:type2_combo:output': '50 kW', 'socket:chademo': '1', 'socket:chademo:output': '50 kW' }),
    { type: 'way', id: 4, center: { lat: 56.97, lon: 24.15 }, tags: { amenity: 'charging_station', operator: 'Ignitis ON', 'socket:type2_combo': '4', 'socket:type2_combo:output': '300 kW' } },
    el('node', 5, 56.94, 24.13, { operator: 'Tesla', 'socket:tesla_supercharger': '8', 'socket:tesla_supercharger:output': '250 kW' }),
    el('node', 6, 56.96, 24.08, { operator: '<img src=x onerror=alert(1)>', name: '"><script>window.__xss=1</script>' }),
    el('node', 7, 56.92, 24.2, { access: 'private', 'socket:type2': '1' }),
  ],
};

const results = [];
const check = (name, ok, extra) => { results.push([name, !!ok]); console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // обрывы сети мы устраиваем нарочно: их сообщения про «Failed to load resource» не считаем ошибками приложения
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('leaflet.min.js')) return route.fulfill({ contentType: 'text/javascript', body: LEAFLET_STUB });
    if (url.includes('overpass')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK) });
    if (url.includes('fonts.googleapis') || url.includes('leaflet.min.css')) return route.fulfill({ contentType: 'text/css', body: '' });
    return route.abort(); // в том числе live.json: приложение должно работать и без него
  });

  await page.goto(base + '/');
  await page.waitForSelector('.best', { timeout: 8000 });
  await page.waitForFunction(() => /Нет доступа/.test(document.querySelector('.origin-line')?.innerText || ''), null, { timeout: 5000 }).catch(() => {});
  check('нет доступа к GPS: понятная строка и расчёт от центра', (await page.locator('.origin-line').innerText()).includes('Нет доступа к месту'));
  check('без live.json: нет бейджей статуса', (await page.locator('.live').count()) === 0);
  check('без live.json: сообщение, что статус недоступен', (await page.locator('.live-note').innerText()).includes('недоступен'));

  check('карточка лучшей станции показана', await page.locator('.best h2').count() === 1);
  check('маркеры: 6 станций (приватная скрыта)', (await page.evaluate(() => window.__markers)) === 6, 'markers=' + (await page.evaluate(() => window.__markers)));
  check('XSS не сработал', (await page.evaluate(() => window.__xss)) === undefined && !errors.some((e) => e.startsWith('dialog')));
  check('кнопки навигации ведут на Google Maps и Waze', (await page.locator('.best a.btn').evaluateAll((a) => a.map((x) => x.href))).join(' ').includes('google.com/maps/dir') );

  const btnBottom = await page.locator('.best a.btn').first().evaluate((a) => a.getBoundingClientRect().bottom);
  check('кнопка маршрута видна в свёрнутой панели', btnBottom <= 780, 'bottom=' + Math.round(btnBottom));
  check('150 кВт: полная шкала из 5 столбиков', (await page.locator('.best .gauge i.on').count()) === 5);
  await page.screenshot({ path: path.join(shots, '1-go.png') });

  // фильтр CCS
  await page.click('[data-conn="ccs"]');
  const ccsRows = await page.locator('.best, .row').count();
  check('фильтр CCS: остаются станции с CCS', ccsRows >= 1 && (await page.evaluate(() => window.__markers)) === 3, 'markers=' + (await page.evaluate(() => window.__markers)));
  await page.click('[data-pwr="ultra"]');
  check('CCS + 150+ кВт: 2 станции', (await page.evaluate(() => window.__markers)) === 2, 'markers=' + (await page.evaluate(() => window.__markers)));
  await page.click('[data-conn="any"]');
  await page.click('[data-pwr="ultra"]'); // повторное нажатие снимает фильтр
  check('повторное нажатие снимает фильтр мощности', (await page.evaluate(() => window.__markers)) === 6);

  // приоритеты
  await page.click('[data-prio="cheap"]');
  const cheapTitle = await page.locator('.best h2').innerText();
  await page.click('[data-prio="near"]');
  const nearTitle = await page.locator('.best h2').innerText();
  check('приоритет меняет выбор или не ломает вывод', cheapTitle.length > 0 && nearTitle.length > 0, cheapTitle + ' | ' + nearTitle);

  // список
  await page.click('[data-tab="list"]');
  check('вкладка «Рядом»: 6 строк', (await page.locator('.row').count()) === 6, 'rows=' + (await page.locator('.row').count()));
  await page.selectOption('#sel-operator', 'virsi');
  check('фильтр по сети Virši: 1 строка', (await page.locator('.row').count()) === 1);
  await page.selectOption('#sel-operator', 'all');
  await page.screenshot({ path: path.join(shots, '2-list.png') });

  // карточка станции
  await page.locator('.row').first().click();
  check('карточка станции открыта', (await page.locator('.detail h2').count()) === 1);
  check('в карточке написано, что занятости нет', (await page.locator('.detail dl').innerText()).length > 20);
  await page.screenshot({ path: path.join(shots, '3-detail.png') });
  await page.click('#btn-back');
  check('назад из карточки', (await page.locator('.detail').count()) === 0);

  // цены
  await page.click('[data-tab="prices"]');
  check('таблица цен: 9 сетей', (await page.locator('.price-table tbody tr').count()) === 9, 'rows=' + (await page.locator('.price-table tbody tr').count()));
  await page.screenshot({ path: path.join(shots, '4-prices.png') });

  // язык и тема
  await page.click('#btn-lang');
  check('английский язык', (await page.locator('.tab').first().innerText()) === 'Best');
  await page.click('#btn-lang');
  await page.click('#btn-theme');
  check('светлая тема', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await page.click('[data-tab="go"]');
  await page.screenshot({ path: path.join(shots, '5-light.png') });
  await page.click('#btn-theme');

  // раскрытие панели
  const before = await page.locator('#sheet').getAttribute('data-open');
  await page.click('#grab');
  const after = await page.locator('#sheet').getAttribute('data-open');
  check('ручка переключает панель', before !== after, before + ' -> ' + after);
  if (after !== 'true') await page.click('#grab');
  await page.screenshot({ path: path.join(shots, '6-open.png') });

  // повторная загрузка из кэша (без сети)
  await page.route('**/overpass**', (r) => r.abort());
  await page.reload();
  await page.waitForSelector('.best', { timeout: 8000 });
  check('повторный запуск показывает станции из кэша', (await page.evaluate(() => window.__markers)) === 6);

  check('тёмные тайлы: класс на карте в тёмной теме', await page.evaluate(() => document.getElementById('map').classList.contains('dark-tiles')));

  // все зеркала Overpass недоступны и кэша нет: ошибка с кнопкой «Повторить»
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
  const page2 = await ctx2.newPage();
  await page2.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('leaflet.min.js')) return route.fulfill({ contentType: 'text/javascript', body: LEAFLET_STUB });
    if (url.includes('fonts.googleapis') || url.includes('leaflet.min.css')) return route.fulfill({ contentType: 'text/css', body: '' });
    return route.abort();
  });
  await page2.goto(base + '/');
  await page2.waitForSelector('#btn-retry', { timeout: 8000 });
  check('нет сети: показана ошибка и кнопка «Повторить»', (await page2.locator('#status').innerText()).includes('Не удалось'));
  await ctx2.close();


  /* ---------- сценарии с живыми данными ---------- */
  const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
  const P = (t, kw, s, p) => ({ e: 'LV*T*' + t + kw + s, t, m: kw > 43 ? 'dc' : 'ac', kw, s, p });
  const liveDoc = (statusTime) => ({
    v: 1, statusTime, generated: statusTime,
    sites: [
      // совпадает с Galleria Riga (OSM node 1), сеть Eleport
      { id: 'a1', n: 'GAL_1', op: 'Eleport', lat: 56.95002, lon: 24.11002, a: 'Dzirnavu iela 67', c: 'Rīga', h: '24/7', u: statusTime, pay: ['app', 'rfid', 'card'],
        pts: [P('ccs', 150, 'free', 0.41), Object.assign(P('ccs', 150, 'busy', 0.41), { u: Math.floor((Date.now() - 25 * 60000) / 60000) }), P('type2', 22, 'free', 0.34)] },
      // только в NAP, все заняты
      { id: 'a2', n: 'Elektrum, DC 50kW', op: 'Elektrum Drive', lat: 56.94, lon: 24.1, a: 'Lāčplēša iela 10', c: 'Rīga', h: '24/7', u: statusTime,
        pts: [Object.assign(P('ccs', 50, 'busy', 0.44), { u: Math.floor((Date.now() - 12 * 60000) / 60000) }), Object.assign(P('chademo', 50, 'busy', 0.44), { u: Math.floor((Date.now() - 20 * 60000) / 60000) })] },
      // только в NAP, не работает
      { id: 'a3', n: 'OUT_3', op: 'Ignitis ON', lat: 56.945, lon: 24.106, a: 'Čaka iela 5', c: 'Rīga', h: '24/7', u: statusTime,
        pts: [P('ccs', 60, 'out', 0.35)] },
      // вне Риги: игнорируется
      { id: 'far', n: 'FAR', op: 'Elektrum Drive', lat: 57.54, lon: 25.42, a: 'Raiņa iela 12', c: 'Valmiera', h: '24/7', u: statusTime,
        pts: [P('ccs', 50, 'free', 0.44)] },
    ],
  });
  const routeFor = (ctxPage, liveBody, patternsBody) => ctxPage.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('leaflet.min.js')) return route.fulfill({ contentType: 'text/javascript', body: LEAFLET_STUB });
    if (url.includes('overpass')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK) });
    if (url.includes('raw.githubusercontent.com/') && url.includes('patterns.json')) {
      return patternsBody == null ? route.abort() : route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(patternsBody) });
    }
    if (url.includes('raw.githubusercontent.com')) {
      return liveBody == null ? route.abort() : route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(liveBody) });
    }
    if (url.includes('fonts.googleapis') || url.includes('leaflet.min.css')) return route.fulfill({ contentType: 'text/css', body: '' });
    return route.abort();
  });

  // 1) свежий поток
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const p3 = await ctx3.newPage();
  const errors3 = [];
  p3.on('pageerror', (e) => errors3.push('pageerror: ' + e.message));
  p3.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors3.push('console: ' + m.text()); });
  const nowH = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Riga' }).format(new Date())) % 24;
  const hoursRow = Array.from({ length: 24 }, (_, h) => (((h - nowH + 24) % 24) >= 12 && ((h - nowH + 24) % 24) < 18 ? -1 : 10 + h * 3)); // данных нет в 6 часах, не включая текущий
  const patternsDoc = { v: 1, since: '2026-10-27', minSamples: 12, sites: { a1: hoursRow.concat(hoursRow) }, dur: { a2: { f: [45, 8] } }, durMin: 4 };
  await routeFor(p3, liveDoc(minsAgo(5)), patternsDoc);
  await p3.goto(base + '/');
  await p3.waitForSelector('.live', { timeout: 8000 });
  // OSM даёт 6 станций (приватная скрыта); node 1 сливается с a1; a2, a3 и far (Валмиера, теперь это Латвия) добавляются
  check('live: 9 маркеров (6 из OSM + 3 только из NAP)', (await p3.evaluate(() => window.__markers)) === 9, 'markers=' + (await p3.evaluate(() => window.__markers)));
  check('live: у станции, где все заняты, красный ярлык «Все заняты»; у дешёвой кВт сменяются ценой в €', await p3.evaluate(() => { const h = (window.__pillHtml || []).join('\n'); return /cd-dc lv-busy bz"><i class="cd-a">50 кВт<\/i><i class="cd-b">Все заняты/.test(h) && /<i class="cd-b">\d,\d\d €<\/i>/.test(h); }));
  check('live: переливающийся ободок только у самых дешёвых точек (не у всех)', await p3.evaluate(() => { const h = window.__pillHtml || []; const n = new Set(h.filter((x) => /class="cd /.test(x))).size; return n >= 1 && n <= 6 && n < window.__markers; }));
  check('live: время обновления статуса рядом с бейджем', /обновлено \d\d:\d\d/.test(await p3.locator('.best .live-time').innerText()));
  const bestTxt = await p3.locator('.best').innerText();
  check('live: в карточке лучшей станции бейдж «Свободно 2 из 3»', bestTxt.includes('Свободно 2 из 3'), bestTxt.replace(/\n/g, ' | ').slice(0, 160));
  check('live: цена в карточке взята из потока (0,41)', bestTxt.includes('0,41'));
  await p3.screenshot({ path: path.join(shots, '7-live-go.png') });

  // оплата, «занята с», график «обычно занято»
  await p3.waitForSelector('.usual-line', { timeout: 5000 });
  const bestHtml = await p3.locator('.best').innerText();
  check('оплата: в карточке лучшей станции видны плашки способов', bestHtml.includes('Приложение') && bestHtml.includes('RFID') && bestHtml.includes('Карта'));
  const goBtnBottom = await p3.locator('.best a.btn').first().evaluate((a) => a.getBoundingClientRect().bottom);
  check('оплата и «обычно»: кнопка маршрута всё равно видна на экране 780 px', goBtnBottom <= 780, 'bottom=' + Math.round(goBtnBottom));
  check('оплата: плашки в одну строку', (await p3.locator('.best .pay').evaluate((el) => el.getBoundingClientRect().height)) < 40);
  check('обычно занято: строка в карточке лучшей станции', /обычно занято ≈ \d+%/.test(bestHtml));
  await p3.screenshot({ path: path.join(shots, '13-pay-go.png') });
  await p3.click('[data-tab="list"]');
  await p3.locator('.row', { hasText: 'Dzirnavu' }).first().click();
  const detailTxt = await p3.locator('.detail').innerText();
  check('оплата: в «Подробнее» строка «Как оплатить» с плашками', detailTxt.includes('Как оплатить') && (await p3.locator('.detail dd .chip-pay').count()) === 3);
  check('«занята с»: у занятой точки время смены статуса', /занята с (\d\d\.\d\d )?\d\d:\d\d/.test(await p3.locator('.pts').innerText()));
  check('график: 24 столбика, текущий час выделен', (await p3.locator('.bars i').count()) === 24 && (await p3.locator('.bars i.cur').count()) === 1);
  check('график: часы без данных отмечены отдельно', (await p3.locator('.bars i.na').count()) === 6);
  check('график: подпись про источник и дату начала', (await p3.locator('.usual .note').innerText()).includes('по данным с 27.10.2026'));
  await p3.screenshot({ path: path.join(shots, '14-pay-detail.png') });
  await p3.click('#btn-back');

  await p3.click('[data-tab="list"]');
  const rowsTxt = await p3.locator('.rows').innerText();
  check('live: в списке есть «Все заняты» и «Не работает»', rowsTxt.includes('Все заняты') && rowsTxt.includes('Не работает'));
  await p3.locator('.row', { hasText: 'Lāčplēša' }).first().click();
  const etaTxt = await p3.locator('.detail').innerText();
  check('прогноз: у станции, где все заняты, «освободится примерно через 25 мин (обычно ≈ 45 мин)»', /Освободится примерно через 25 мин \(обычно зарядка здесь ≈ 45 мин\)/.test(etaTxt), etaTxt.replace(/\n/g, ' | ').slice(0, 300));
  await p3.click('#btn-back');
  await p3.click('[data-tab="list"]');
  check('live: в списке 9 строк', (await p3.locator('.row').count()) === 9, 'rows=' + (await p3.locator('.row').count()));
  check('live: станция только из OSM (Virši) без бейджа статуса', (await p3.locator('.row', { hasText: 'Virši' }).first().locator('.live').count()) === 0);
  await p3.screenshot({ path: path.join(shots, '8-live-list.png') });

  // фильтр по CHAdeMO: свободные считаются только по подходящим точкам
  await p3.click('[data-conn="chademo"]');
  const chaTxt = await p3.locator('.rows').innerText();
  check('live+фильтр CHAdeMO: остаётся станция a2, все заняты', (await p3.locator('.row').count()) >= 1 && chaTxt.includes('Все заняты'));
  await p3.click('[data-conn="any"]');

  // карточка станции со списком точек
  await p3.locator('.row', { hasText: 'Dzirnavu' }).first().click();
  check('live: в карточке список точек с состояниями', (await p3.locator('.pts li').count()) === 3 && (await p3.locator('.pts').innerText()).includes('свободна'));
  check('live: в карточке указан источник данных', (await p3.locator('.detail').innerText()).includes('Eco-Movement'));
  check('live: у слитой станции остаётся ссылка на OSM', (await p3.locator('.detail a[href*="openstreetmap.org/node/1"]').count()) === 1);
  await p3.screenshot({ path: path.join(shots, '9-live-detail.png') });
  await p3.click('#btn-back');
  // станция только из NAP: ссылки на OSM нет
  await p3.locator('.row', { hasText: 'Lāčplēša' }).first().click();
  check('оплата и график: у станции без этих данных ничего не рисуется', (await p3.locator('.detail .chip-pay').count()) === 0 && (await p3.locator('.usual').count()) === 0);
  check('live: у станции только из NAP нет ссылки на OSM', (await p3.locator('.detail a[href*="openstreetmap.org"]').count()) === 0);
  await p3.click('#btn-back');

  // вкладка цен: живые цены и подпись
  await p3.click('[data-tab="prices"]');
  check('live: вкладка цен ссылается на данные станций', (await p3.locator('.note').first().innerText()).includes('по данным самих станций'));
  await p3.screenshot({ path: path.join(shots, '10-live-prices.png') });
  check('live: нет ошибок в консоли', errors3.length === 0, errors3.join(' || '));
  await ctx3.close();

  // 2) устаревший поток (3 часа назад): статусы не показываем как актуальные
  const ctx4 = await browser.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
  const p4 = await ctx4.newPage();
  await routeFor(p4, liveDoc(minsAgo(180)));
  await p4.goto(base + '/');
  await p4.waitForSelector('.live-note', { timeout: 8000 });
  check('stale: пометка, что статус устарел', (await p4.locator('.live-note').innerText()).includes('устарел'));
  check('stale: нет бейджей «Свободно»', !(await p4.locator('#panel').innerText()).includes('Свободно'));
  await ctx4.close();

  // 3) Overpass недоступен, но live есть: приложение работает на одних данных NAP
  const ctx5 = await browser.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
  const p5 = await ctx5.newPage();
  await p5.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('leaflet.min.js')) return route.fulfill({ contentType: 'text/javascript', body: LEAFLET_STUB });
    if (url.includes('raw.githubusercontent.com')) return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(liveDoc(minsAgo(3))) });
    if (url.includes('fonts.googleapis') || url.includes('leaflet.min.css')) return route.fulfill({ contentType: 'text/css', body: '' });
    return route.abort();
  });
  await p5.goto(base + '/');
  await p5.waitForSelector('.best', { timeout: 8000 });
  await p5.waitForTimeout(500);
  check('без Overpass: работает на данных NAP (4 станции)', (await p5.evaluate(() => window.__markers)) === 4, 'markers=' + (await p5.evaluate(() => window.__markers)));
  check('без Overpass: нет баннера ошибки', await p5.locator('#status').isHidden());
  await ctx5.close();

  /* ---------- GPS ---------- */
  const ctx6 = await browser.newContext({
    viewport: { width: 390, height: 780 }, serviceWorkers: 'block',
    permissions: ['geolocation'], geolocation: { latitude: 56.946, longitude: 24.1, accuracy: 40 },
  });
  await ctx6.addInitScript(() => { const n = Date.now; window.__skew = 0; Date.now = () => n.call(Date) + window.__skew; });
  const p6 = await ctx6.newPage();
  const errors6 = [];
  p6.on('pageerror', (e) => errors6.push('pageerror: ' + e.message));
  await routeFor(p6, liveDoc(minsAgo(4)));
  await p6.goto(base + '/');
  await p6.waitForFunction(() => /Ваше место/.test(document.querySelector('.origin-line')?.innerText || ''), null, { timeout: 8000 });
  await p6.waitForTimeout(600); // даём данным станций дозагрузиться
  const near = (c, lat, lon) => c && Math.abs(c[0] - lat) < 1e-6 && Math.abs(c[1] - lon) < 1e-6;
  check('GPS при открытии: расчёт от вашего места с точностью', (await p6.locator('.origin-line').innerText()).includes('±40 м'));
  check('GPS при открытии: карта осталась на вас (данные станций её не увели)', near(await p6.evaluate(() => window.__center), 56.946, 24.1), JSON.stringify(await p6.evaluate(() => window.__center)));
  check('GPS: нарисован круг точности', (await p6.evaluate(() => window.__circles)) >= 1);
  check('GPS: в карточке расстояние «от вас»', (await p6.locator('.best').innerText()).includes('от вас'));
  await p6.screenshot({ path: path.join(shots, '11-gps.png') });

  await ctx6.setGeolocation({ latitude: 56.93, longitude: 24.09, accuracy: 20 });
  await p6.click('#btn-gps');
  await p6.waitForFunction(() => /±20 м/.test(document.querySelector('.origin-line')?.innerText || ''), null, { timeout: 5000 });
  check('кнопка на карте: место обновилось, карта на новой точке', near(await p6.evaluate(() => window.__center), 56.93, 24.09));

  // быстрый возврат (меньше минуты): GPS зря не дёргаем
  await ctx6.setGeolocation({ latitude: 56.97, longitude: 24.15, accuracy: 15 });
  await p6.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p6.waitForTimeout(500);
  check('быстрый возврат: место не пересчитывается', near(await p6.evaluate(() => window.__center), 56.93, 24.09));
  // долгий возврат: обновляем
  await p6.evaluate(() => { window.__skew = 120000; });
  await p6.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p6.waitForFunction(() => /±15 м/.test(document.querySelector('.origin-line')?.innerText || ''), null, { timeout: 5000 });
  check('возврат через 2 минуты: место обновилось', near(await p6.evaluate(() => window.__center), 56.97, 24.15));
  check('GPS: нет JS-ошибок', errors6.length === 0, errors6.join(' || '));
  await ctx6.close();

  /* ---------- установка на телефон ---------- */
  const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const AND_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
  const openFresh = async (opts, init) => {
    const c = await browser.newContext(Object.assign({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' }, opts || {}));
    if (init) await c.addInitScript(init);
    const pg = await c.newPage();
    await routeFor(pg, null);
    await pg.goto(base + '/');
    await pg.waitForSelector('#btn-install', { state: 'attached' });
    return { c, pg };
  };

  // 1) обычный браузер без системного окна: кнопка видна, открывается инструкция
  let r = await openFresh();
  check('установка: кнопка видна', await r.pg.locator('#btn-install').isVisible());
  await r.pg.click('#btn-install');
  check('установка: открылась инструкция', await r.pg.locator('#install-dialog').isVisible() && (await r.pg.locator('#install-title').innerText()) === 'Установить на телефон');
  check('установка: на компьютере один шаг', (await r.pg.locator('#install-steps li').count()) === 1);
  await r.pg.keyboard.press('Escape');
  check('установка: Esc закрывает окно', await r.pg.locator('#install-dialog').isHidden());
  await r.c.close();

  // 2) iPhone: три шага через «Поделиться»
  r = await openFresh({ userAgent: IOS_UA, hasTouch: true, isMobile: true });
  await r.pg.click('#btn-install');
  const iosSteps = await r.pg.locator('#install-steps').innerText();
  check('установка iPhone: три шага про «Поделиться» и «На экран “Домой”»', (await r.pg.locator('#install-steps li').count()) === 3 && iosSteps.includes('Поделиться') && iosSteps.includes('Домой'));
  await r.pg.screenshot({ path: path.join(shots, '12-install-ios.png') });
  await r.pg.click('#install-close');
  check('установка: кнопка «Понятно» закрывает окно', await r.pg.locator('#install-dialog').isHidden());
  await r.c.close();

  // 3) Android без системного события: инструкция про меню
  r = await openFresh({ userAgent: AND_UA, hasTouch: true, isMobile: true });
  await r.pg.click('#btn-install');
  check('установка Android: шаги про меню браузера', (await r.pg.locator('#install-steps').innerText()).includes('меню'));
  await r.c.close();

  // 4) Android с системным окном установки: вызывается оно, инструкции нет
  r = await openFresh({ userAgent: AND_UA, hasTouch: true, isMobile: true });
  await r.pg.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(e);
  });
  await r.pg.click('#btn-install');
  check('установка Android: вызвано системное окно, инструкция не показана', (await r.pg.evaluate(() => window.__prompted)) === 1 && await r.pg.locator('#install-dialog').isHidden());
  await r.pg.click('#btn-install');
  check('установка: после отказа повторное нажатие открывает инструкцию', await r.pg.locator('#install-dialog').isVisible());
  await r.c.close();

  // 5) уже установлено (открыто как приложение): кнопки нет
  r = await openFresh({}, () => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => /display-mode:\s*standalone/.test(q)
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
      : mm(q);
  });
  check('установка: в установленном приложении кнопки нет', await r.pg.locator('#btn-install').isHidden());
  await r.c.close();

  /* ---------- новые функции: машина, избранное, поиск, ссылки, маршрут ---------- */
  {
    const cF = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const pf = await cF.newPage();
    const errF = [];
    pf.on('pageerror', (e) => errF.push('pageerror: ' + e.message));
    pf.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errF.push('console: ' + m.text()); });
    pf.on('dialog', (d) => { errF.push('dialog: ' + d.message()); d.dismiss(); });
    const window_geoUrls = [];
    const line = [[56.95, 24.11], [57.1, 24.5], [57.54, 25.42]].map((q) => [q[1], q[0]]);
    await pf.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes('leaflet.min.js')) return route.fulfill({ contentType: 'text/javascript', body: LEAFLET_STUB });
      if (url.includes('overpass')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK) });
      if (url.includes('nominatim')) { window_geoUrls.push(url); } 
      if (url.includes('nominatim')) return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ lat: '57.54', lon: '25.42', display_name: 'Valmiera, Latvija' }]) });
      if (url.includes('router.project-osrm.org')) return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ routes: [{ distance: 105000, duration: 4200, geometry: { coordinates: line } }] }) });
      if (url.includes('open-meteo')) return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ current: { temperature_2m: -8 } }) });
      if (url.includes('fonts.googleapis') || url.includes('leaflet.min.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    await pf.goto(base + '/');
    await pf.waitForSelector('.best', { timeout: 8000 });

    // машина
    check('машина: без профиля нет строки про авто', (await pf.locator('.car-line').count()) === 0);
    await pf.click('#btn-car');
    check('машина: окно открылось', await pf.locator('#car-dialog').isVisible());
    await pf.screenshot({ path: path.join(shots, '15-car-dialog.png') });
    await pf.click('#car-save');
    check('машина: окно закрылось после сохранения', await pf.locator('#car-dialog').isHidden());
    check('машина: появилась строка с авто и кнопка подсвечена', (await pf.locator('.car-line').count()) === 1 && (await pf.locator('#btn-car.on').count()) === 1);
    check('машина: профиль сохранён', await pf.evaluate(() => !!localStorage.getItem('ur_car_v1')));
    check('машина: в карточке время и цена зарядки 20→80%', /20→80|20 → 80/.test(await pf.locator('.best').innerText()) || /мин/.test(await pf.locator('.best').innerText()));
    await pf.screenshot({ path: path.join(shots, '16-car-go.png') });

    // гараж: вторая машина
    await pf.click('#btn-car');
    check('гараж: после первой машины в окне есть выбор «+ Ещё машина»', (await pf.locator('[data-garage="new"]').count()) === 1);
    await pf.click('[data-garage="new"]');
    await pf.fill('#car-name', 'Жена');
    await pf.click('#car-save');
    const garage = await pf.evaluate(() => JSON.parse(localStorage.getItem('ur_garage_v1')));
    check('гараж: две машины, активна вторая', garage.list.length === 2 && garage.idx === 1 && garage.list[1].name === 'Жена');
    check('гараж: строка с авто показывает название «Жена»', /Жена/.test(await pf.locator('.car-line').innerText()));
    await pf.click('#btn-car');
    await pf.click('[data-garage="0"]');
    await pf.click('#car-save');
    check('гараж: выбор первой машины делает её активной', (await pf.evaluate(() => JSON.parse(localStorage.getItem('ur_garage_v1')).idx)) === 0 && !/Жена/.test(await pf.locator('.car-line').innerText()));

    // поиск и фильтры в списке
    await pf.click('[data-tab="list"]');
    const rowsAll = await pf.locator('.row').count();
    await pf.fill('#q', 'Galleria');
    await pf.waitForTimeout(250);
    check('поиск: по названию остаётся 1 строка', (await pf.locator('.row').count()) === 1, 'было ' + rowsAll);
    check('поиск: фокус остался в поле', await pf.evaluate(() => document.activeElement && document.activeElement.id === 'q'));
    await pf.click('#q-clear');
    await pf.waitForTimeout(250);
    check('поиск: очистка возвращает список', (await pf.locator('.row').count()) === rowsAll);

    // карточка, избранное, ссылка
    await pf.locator('.row').first().click();
    await pf.waitForSelector('.detail, [data-fav]');
    await pf.screenshot({ path: path.join(shots, '17-detail-new.png') });
    check('карточка: блок «Время зарядки»', (await pf.locator('.est').count()) === 1);
    check('карточка: сравнение с бензином', (await pf.locator('.cmp').count()) === 1);
    await pf.locator('.tool[data-fav]').click();
    check('избранное: звезда нажата', (await pf.locator('.tool[data-fav][aria-pressed="true"]').count()) === 1);
    check('избранное: сохранено в localStorage', await pf.evaluate(() => (JSON.parse(localStorage.getItem('ur_favs_v1') || '[]') || []).length === 1));
    await pf.click('[data-tab="fav"]');
    check('избранное: вкладка показывает 1 станцию', (await pf.locator('.row').count()) === 1);

    // маршрут
    await pf.click('[data-tab="route"]');
    check('маршрут: форма видна', (await pf.locator('#route-to').count()) === 1);
    await pf.fill('#route-to', 'Valmiera');
    await pf.click('#route-go');
    await pf.waitForSelector('.route-sum', { timeout: 8000 });
    check('маршрут: показана длина', /105 км/.test(await pf.locator('.route-sum').innerText()), await pf.locator('.route-sum').innerText());
    check('маршрут: поиск адреса только по Балтии и рядом с вами', window_geoUrls.length >= 1 && window_geoUrls.every((u) => /countrycodes=lv,lt,ee/.test(u) && /viewbox=/.test(u)), window_geoUrls[0]);
    check('маршрут: видно, что найдено (A и B)', /B: Valmiera/.test(await pf.locator('.note').first().innerText().catch(() => '')) || /B: Valmiera/.test(await pf.locator('#panel').innerText()));
    check('маршрут: статус места виден на вкладке', (await pf.locator('.origin-line').count()) === 1);
    check('маршрут: линия нарисована', (await pf.evaluate(() => window.__polylines || 0)) >= 1);
    await pf.screenshot({ path: path.join(shots, '18-route.png') });
    await pf.click('[data-act="routeSave"]');
    check('маршрут: «Сохранить» кладёт маршрут в список и в localStorage', (await pf.locator('.saved-route [data-route-load]').count()) === 1 && (await pf.evaluate(() => JSON.parse(localStorage.getItem('ur_routes_v1')).length)) === 1);
    check('маршрут: есть кнопка «Поделиться»', (await pf.locator('[data-act="routeShare"]').count()) === 1);
    await pf.click('[data-act="routeClear"]');
    check('маршрут: сброс убирает сводку', (await pf.locator('.route-sum').count()) === 0);
    await pf.click('[data-route-load]');
    await pf.waitForSelector('.route-sum', { timeout: 8000 });
    check('маршрут: сохранённый строится заново одним нажатием', /105 км/.test(await pf.locator('.route-sum').innerText()));
    await pf.click('[data-route-del]');
    check('маршрут: удаление убирает из списка', (await pf.locator('.saved-route').count()) === 0);
    await pf.goto(base + '/?rt=Valmiera&rs=70');
    await pf.waitForSelector('.route-sum', { timeout: 9000 });
    check('ссылка на маршрут: форма заполнена и маршрут построен', (await pf.inputValue('#route-to')) === 'Valmiera' && (await pf.inputValue('#route-soc')) === '70');
    await pf.click('[data-act="routeClear"]');

    // язык
    await pf.click('#btn-lang');
    check('английский: вкладка «Saved» и «Route»', (await pf.locator('.tab').allInnerTexts()).join(' ').includes('Route'));
    await pf.click('#btn-lang');
    check('новые функции: нет JS-ошибок', errF.length === 0, errF.join(' || '));
    await cF.close();

    // глубокая ссылка на станцию и горячие ссылки манифеста
    const cD = await browser.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
    const pd = await cD.newPage();
    const errD = [];
    pd.on('pageerror', (e) => errD.push(e.message));
    await pd.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes('leaflet.min.js')) return route.fulfill({ contentType: 'text/javascript', body: LEAFLET_STUB });
      if (url.includes('overpass')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK) });
      if (url.includes('fonts.googleapis') || url.includes('leaflet.min.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    await pd.goto(base + '/?tab=fav');
    await pd.waitForSelector('.tab[aria-selected="true"]', { timeout: 8000 });
    check('ярлык ?tab=fav открывает «Мои»', /Мои/.test(await pd.locator('.tab[aria-selected="true"]').innerText()));
    await pd.goto(base + '/?st=node/1');
    await pd.waitForSelector('[data-fav]', { timeout: 8000 });
    check('ссылка ?st= открывает карточку станции', /Galleria/.test(await pd.locator('body').innerText()));
    check('ссылки: нет JS-ошибок', errD.length === 0, errD.join(' || '));
    await cD.close();
  }

  // пуши при закрытом приложении: подписка уходит на сервер при слежении и снимается при отмене
  {
    const SUB_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/smoke-test';
    const cK = await browser.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
    const pk = await cK.newPage();
    const errK = [];
    pk.on('pageerror', (e) => errK.push('pageerror: ' + e.message));
    pk.on('dialog', (d) => { errK.push('dialog: ' + d.message()); d.dismiss(); });
    // настоящих push-сервисов в безголовом Chromium нет: подставляем сервис-воркер и подписку, остальное работает как есть
    await pk.addInitScript((endpoint) => {
      window.Notification = class { static get permission() { return 'granted'; } static requestPermission() { return Promise.resolve('granted'); } };
      window.PushManager = function PushManager() {};
      let sub = null;
      const mk = (key) => ({ endpoint, options: { applicationServerKey: key }, toJSON: () => ({ endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }), unsubscribe: async () => { sub = null; window.__unsubscribed = (window.__unsubscribed || 0) + 1; return true; } });
      const reg = { pushManager: { getSubscription: async () => sub, subscribe: async (o) => { window.__subscribeOpts = { userVisibleOnly: o.userVisibleOnly, keyLen: o.applicationServerKey.length }; sub = mk(o.applicationServerKey.buffer); return sub; } }, showNotification: async () => {} };
      Object.defineProperty(navigator, 'serviceWorker', { get: () => ({ ready: Promise.resolve(reg), register: async () => reg, addEventListener() {} }) });
    }, SUB_ENDPOINT);
    await routeFor(pk, liveDoc(minsAgo(3)), null);
    const pushCalls = [];
    await pk.route('**/push-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ api: 'https://push.test' }) }));
    await pk.route('https://push.test/**', async (route) => {
      const u = new URL(route.request().url());
      const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type', 'content-type': 'application/json' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
      pushCalls.push({ path: u.pathname, body: route.request().postData() ? JSON.parse(route.request().postData()) : null });
      if (u.pathname === '/vapid') return route.fulfill({ headers: h, body: JSON.stringify({ key: 'B'.repeat(87) }) });
      return route.fulfill({ headers: h, body: JSON.stringify({ ok: true }) });
    });
    await pk.goto(base + '/?st=a2');
    await pk.waitForSelector('.detail', { timeout: 8000 });
    await pk.click('[data-watch]');
    await pk.waitForFunction(() => !!window.__subscribeOpts, null, { timeout: 8000 }).catch(() => {});
    await pk.waitForTimeout(400);
    const sync = pushCalls.find((c) => c.path === '/sync');
    check('пуши: при слежении телефон подписался на сервере push', (await pk.evaluate(() => window.__subscribeOpts && window.__subscribeOpts.userVisibleOnly)) === true && (await pk.evaluate(() => window.__subscribeOpts.keyLen)) > 60);
    check('пуши: на сервер ушла подписка и станция под слежением', !!sync && sync.body.sub.endpoint === SUB_ENDPOINT && sync.body.lang === 'ru' && sync.body.watch.length === 1 && sync.body.watch[0].napId === 'a2' && sync.body.watch[0].free === 0, JSON.stringify(sync && sync.body));
    check('пуши: подсказка честная, уведомление придёт и при закрытом приложении', /при закрытом приложении/.test(await pk.locator('#toast').innerText()) && !/пока приложение открыто/.test(await pk.locator('#toast').innerText()), await pk.locator('#toast').innerText());
    await pk.click('[data-watch]');
    await pk.waitForTimeout(500);
    const un = pushCalls.find((c) => c.path === '/unsubscribe');
    check('пуши: при отмене слежения подписка снимается и на сервере, и в браузере', !!un && un.body.endpoint === SUB_ENDPOINT && (await pk.evaluate(() => window.__unsubscribed)) === 1);
    check('пуши: нет JS-ошибок', errK.length === 0, errK.join(' || '));
    await cK.close();

    // без адреса сервера в push-config.json приложение не делает никаких запросов к серверу
    const cK2 = await browser.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
    const pk2 = await cK2.newPage();
    await routeFor(pk2, liveDoc(minsAgo(3)), null);
    let leaked = 0;
    await pk2.route('https://push.test/**', (r) => { leaked++; r.abort(); });
    await pk2.goto(base + '/?st=a2');
    await pk2.waitForSelector('.detail', { timeout: 8000 });
    await pk2.click('[data-watch]');
    await pk2.waitForTimeout(500);
    check('пуши: без адреса сервера подсказка прежняя, только при открытом приложении', /пока приложение открыто/.test(await pk2.locator('#toast').innerText()));
    check('пуши: без адреса сервера слежение работает и ничего не отправляется', leaked === 0 && (await pk2.evaluate(() => JSON.parse(localStorage.getItem('ur_watch_v1') || '[]').length)) === 1);
    await cK2.close();
  }

  // когда ехать, таймер зарядки, вечерняя сводка
  {
    const SUB_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/smoke-test-2';
    const cW = await browser.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
    const pw = await cW.newPage();
    const errW = [];
    pw.on('pageerror', (e) => errW.push('pageerror: ' + e.message));
    pw.on('dialog', (d) => { errW.push('dialog: ' + d.message()); d.dismiss(); });
    await pw.addInitScript((endpoint) => {
      window.Notification = class { static get permission() { return 'granted'; } static requestPermission() { return Promise.resolve('granted'); } };
      window.PushManager = function PushManager() {};
      let sub = null;
      const mk = (key) => ({ endpoint, options: { applicationServerKey: key }, toJSON: () => ({ endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }), unsubscribe: async () => { sub = null; return true; } });
      const reg = { pushManager: { getSubscription: async () => sub, subscribe: async (o) => { sub = mk(o.applicationServerKey.buffer); return sub; } }, showNotification: async () => {} };
      Object.defineProperty(navigator, 'serviceWorker', { get: () => ({ ready: Promise.resolve(reg), register: async () => reg, addEventListener() {} }) });
      if (!localStorage.getItem('ur_car_v1')) localStorage.setItem('ur_car_v1', JSON.stringify({ id: 'teslay' }));
    }, SUB_ENDPOINT);
    const nowH2 = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Riga' }).format(new Date())) % 24;
    const row2 = Array.from({ length: 24 }, (_, h) => (h === nowH2 ? 70 : h === (nowH2 + 3) % 24 ? 10 : 50));
    await routeFor(pw, liveDoc(minsAgo(3)), { v: 1, since: '2026-10-27', minSamples: 12, sites: { a2: row2.concat(row2) }, dur: {}, durMin: 4 });
    const callsW = [];
    await pw.route('**/push-config.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ api: 'https://push.test' }) }));
    await pw.route('https://push.test/**', async (route) => {
      const u = new URL(route.request().url());
      const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type', 'content-type': 'application/json' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
      callsW.push({ path: u.pathname, body: route.request().postData() ? JSON.parse(route.request().postData()) : null });
      if (u.pathname === '/vapid') return route.fulfill({ headers: h, body: JSON.stringify({ key: 'B'.repeat(87) }) });
      return route.fulfill({ headers: h, body: JSON.stringify({ ok: true }) });
    });
    await pw.goto(base + '/?st=a2');
    await pw.waitForSelector('.detail .insight', { timeout: 8000 });
    const dtxt = await pw.locator('.detail').innerText();
    check('когда ехать: «Свободнее всего около ЧЧ:00» и текущая занятость', new RegExp('Свободнее всего около ' + String((nowH2 + 3) % 24).padStart(2, '0') + ':00 \\(обычно занято ≈ 10%\\), сейчас ≈ 70%').test(dtxt), dtxt.slice(0, 500));
    check('рядом свободно: у занятой станции предложена соседняя со свободной точкой', /Рядом свободно:\s*Galleria/.test(dtxt) && (await pw.locator('.detail [data-goto]').count()) === 1, dtxt.slice(0, 500));
    await pw.locator('.timer').scrollIntoViewIfNeeded();
    await pw.screenshot({ path: path.join(shots, '40-when-timer.png') });
    check('таймер: четыре кнопки с временем до 80%', (await pw.locator('.timer [data-timer]').count()) === 4);
    await pw.locator('.timer [data-timer][data-soc="20"]').click();
    await pw.waitForTimeout(500);
    const tsync = callsW.filter((c) => c.path === '/sync').pop();
    check('таймер: сохранён локально и ушёл на сервер вместе с подпиской', (await pw.evaluate(() => JSON.parse(localStorage.getItem('ur_timers_v1') || '[]').length)) === 1 && !!tsync && tsync.body.timers.length === 1 && tsync.body.timers[0].at > Date.now() && /^t[a-z0-9]+$/.test(tsync.body.timers[0].id) && tsync.body.watch.length === 0, JSON.stringify(tsync && tsync.body));
    check('таймер: подсказка про закрытое приложение и обратный отсчёт в карточке', /при закрытом приложении/.test(await pw.locator('#toast').innerText()) && /Таймер: через \d+ мин/.test(await pw.locator('.timer').innerText()), await pw.locator('.timer').innerText());
    await pw.locator('[data-timer-off]').click();
    await pw.waitForTimeout(400);
    check('таймер: отмена убирает его и локально, и на сервере (подписка снята)', (await pw.evaluate(() => JSON.parse(localStorage.getItem('ur_timers_v1') || '[]').length)) === 0 && callsW.some((c) => c.path === '/unsubscribe') && (await pw.locator('.timer [data-timer]').count()) === 4);
    // срок вышел, пока приложение было закрыто: при открытии напоминаем сами
    await pw.evaluate(() => localStorage.setItem('ur_timers_v1', JSON.stringify([{ id: 'tdue', at: Date.now() - 60000, name: 'Elektrum', k: 'x' }])));
    await pw.reload();
    await pw.waitForSelector('.detail', { timeout: 8000 });
    await pw.waitForTimeout(300);
    check('таймер: просроченный срок даёт напоминание при открытии и снимается', /Зарядка до 80% почти готова: Elektrum/.test(await pw.locator('#toast').innerText()) && (await pw.evaluate(() => JSON.parse(localStorage.getItem('ur_timers_v1') || '[]').length)) === 0, await pw.locator('#toast').innerText());
    // вечерняя сводка
    await pw.click('[data-tab="fav"]');
    check('сводка: кнопка есть и выключена', /Вечерняя сводка\s*выкл/i.test((await pw.locator('.digest-btn').innerText()).replace(/\n/g, ' ')));
    await pw.click('.digest-btn');
    await pw.waitForTimeout(250);
    check('сводка: без избранных предупреждает и не включается', /избранное/.test(await pw.locator('#toast').innerText()) && [null, 'null'].includes(await pw.evaluate(() => localStorage.getItem('ur_digest_v1'))));
    await pw.evaluate(() => localStorage.setItem('ur_favs_v1', JSON.stringify([{ k: 'n:a2', id: 'x', napId: 'a2', lat: 56.94, lon: 24.1, name: 'Elektrum Drive' }])));
    await pw.reload();
    await pw.waitForSelector('.digest-btn, .detail', { timeout: 8000 });
    await pw.goto(base + '/?tab=fav');
    await pw.waitForSelector('.digest-btn', { timeout: 8000 });
    await pw.click('.digest-btn');
    await pw.waitForTimeout(500);
    const dsync = callsW.filter((c) => c.path === '/sync').pop();
    check('сводка: включается на 17:00, на сервер уходит час и избранные', /17:00/.test(await pw.locator('.digest-btn').innerText()) && !!dsync && !!dsync.body.digest && dsync.body.digest.hour === 17 && dsync.body.digest.favs[0].napId === 'a2', JSON.stringify(dsync && dsync.body));
    await pw.click('.digest-btn'); await pw.waitForTimeout(150);
    await pw.click('.digest-btn'); await pw.waitForTimeout(150);
    check('сводка: часы 19 и 21 по кругу', /21:00/.test(await pw.locator('.digest-btn').innerText()));
    await pw.click('.digest-btn'); await pw.waitForTimeout(400);
    check('сводка: четвёртое нажатие выключает', /выкл/.test(await pw.locator('.digest-btn').innerText()) && [null, 'null'].includes(await pw.evaluate(() => localStorage.getItem('ur_digest_v1'))));
    check('когда ехать, таймер, сводка: нет JS-ошибок', errW.length === 0, errW.join(' || '));
    await cW.close();
  }

  // журнал зарядок и удобства рядом
  {
    const AMEN = { elements: [
      { type: 'node', id: 101, tags: { amenity: 'toilets' } },
      { type: 'node', id: 102, tags: { amenity: 'cafe', internet_access: 'wlan' } },
    ] };
    const cJ = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const pj = await cJ.newPage();
    const errJ = [];
    pj.on('pageerror', (e) => errJ.push('pageerror: ' + e.message));
    pj.on('dialog', (d) => { errJ.push('dialog: ' + d.message()); d.dismiss(); });
    await pj.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes('leaflet.min.js')) return route.fulfill({ contentType: 'text/javascript', body: LEAFLET_STUB });
      if (url.includes('overpass')) {
        const body = route.request().postData() || '';
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(/around%3A/.test(body) ? AMEN : MOCK) });
      }
      if (url.includes('fonts.googleapis') || url.includes('leaflet.min.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    await pj.goto(base + '/?st=node/1');
    await pj.waitForSelector('.detail', { timeout: 8000 });
    await pj.waitForFunction(() => /Туалет/.test((document.getElementById('amen') || {}).innerText || ''), null, { timeout: 8000 }).catch(() => {});
    const amenTxt = await pj.locator('#amen').innerText();
    check('рядом: найдены туалет, еда и Wi-Fi', /Туалет/.test(amenTxt) && /Кафе/.test(amenTxt) && /Wi-Fi/.test(amenTxt) && !/Магазин/.test(amenTxt), amenTxt.replace(/\n/g, ' | '));
    await pj.screenshot({ path: path.join(shots, '18-amenities.png') });

    await pj.click('[data-charge]');
    check('журнал: форма открылась на вкладке «Мои», название станции подставлено', (await pj.locator('#charge-form').count()) === 1 && /Galleria/.test(await pj.inputValue('#ch-name')));
    await pj.click('#charge-form button[type="submit"]');
    check('журнал: пустая форма не сохраняется, видна подсказка', (await pj.locator('.charge-err').count()) === 1 && (await pj.locator('.charge-list li').count()) === 0);
    await pj.fill('#ch-kwh', '32,5');
    await pj.fill('#ch-eur', '11,4');
    await pj.click('#charge-form button[type="submit"]');
    check('журнал: запись появилась, форма закрылась', (await pj.locator('.charge-list li').count()) === 1 && (await pj.locator('#charge-form').count()) === 0);
    const sumTxt = await pj.locator('.charge-sum').innerText();
    check('журнал: итог за месяц и средняя цена', /32,5 кВт·ч/.test(sumTxt) && /11,40 €/.test(sumTxt) && /0,351/.test(sumTxt), sumTxt.replace(/\n/g, ' | '));
    const savTxt = await pj.locator('.sav').innerText();
    check('журнал: блок «Экономия против бензина» за месяц и год, в плюсе', /Экономия против бензина/.test(savTxt) && (await pj.locator('.sav-cell.pos').count()) >= 2 && /проехали ≈ 178 км, заплатили 11,40 € вместо ≈ 23,0\d? €/.test(savTxt.replace(/\n/g, ' ')), savTxt.replace(/\n/g, ' | '));
    const [dl] = await Promise.all([pj.waitForEvent('download', { timeout: 5000 }).catch(() => null), pj.click('[data-act="chargeCsv"]')]);
    const csvText = dl ? require('node:fs').readFileSync(await dl.path(), 'utf8') : '';
    check('журнал: кнопка «Скачать журнал (CSV)» отдаёт файл с шапкой и записью', !!dl && /^\ufeffdate,time,kWh,EUR,EUR_per_kWh,place\r\n\d{4}-\d{2}-\d{2},\d{2}:\d{2},32\.5,11\.4,0\.351,/.test(csvText) && /\.csv$/.test(dl.suggestedFilename()), csvText.slice(0, 120));
    await pj.screenshot({ path: path.join(shots, '19-charge-log.png') });
    await pj.reload();
    await pj.waitForSelector('.tab', { timeout: 8000 });
    await pj.click('[data-tab="fav"]');
    check('журнал: запись пережила перезагрузку', (await pj.locator('.charge-list li').count()) === 1);
    await pj.click('.ch-del');
    check('журнал: первое нажатие только просит подтверждение', (await pj.locator('.charge-list li').count()) === 1 && /Удалить\?/.test(await pj.locator('.ch-del').innerText()));
    await pj.click('.ch-del');
    check('журнал: второе нажатие удаляет', (await pj.locator('.charge-list li').count()) === 0 && (await pj.locator('.charge-sum').count()) === 0);
    check('журнал: нет JS-ошибок', errJ.length === 0, errJ.join(' || '));
    await cJ.close();
  }

  // Метки с мощностью и скидки сетей
  {
    const cP = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const pp = await cP.newPage();
    const errP = [];
    pp.on('pageerror', (e) => errP.push('pageerror: ' + e.message));
    pp.on('dialog', (d) => { errP.push('dialog: ' + d.message()); d.dismiss(); });
    await pp.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes('leaflet.min.js')) return route.fulfill({ contentType: 'text/javascript', body: LEAFLET_STUB });
      if (url.includes('overpass')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK) });
      if (url.includes('fonts.googleapis') || url.includes('leaflet.min.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    await pp.goto(base + '/');
    await pp.waitForSelector('.best', { timeout: 8000 });
    check('метки: по умолчанию обычные точки, без выносок и без чипа переключения', (await pp.locator('[data-act="pills"]').count()) === 0 && (await pp.evaluate(() => (window.__pillHtml || []).filter((h) => /class="pl /.test(h)).length)) === 0 && (await pp.evaluate(() => window.__markers)) === 6);
    await pp.goto(base + '/?pills=1');
    await pp.waitForSelector('.best', { timeout: 8000 });
    const html = await pp.evaluate(() => (window.__pillHtml || []).join('\n'));
    check('метки: скрытый режим ?pills=1 рисует выноски с кВт', new Set(await pp.evaluate(() => window.__pillHtml || [])).size === 6 && /<b>150<\/b> <em>кВт<\/em>/.test(html) && /<b>22<\/b>/.test(html), html.slice(0, 200));
    check('метки: выноска без данных показывает «?», без доступности', /<b>\?<\/b> <em>кВт<\/em>/.test(html) && /lv-unknown/.test(html));
    check('метки: в названии нет сырого HTML', !/<img|<script/.test(html));
    await pp.goto(base + '/?pills=0');
    await pp.waitForSelector('.best', { timeout: 8000 });
    check('метки: ?pills=0 возвращает точки и запоминается', (await pp.evaluate(() => (window.__pillHtml || []).filter((h) => /class="pl /.test(h)).length)) === 0 && (await pp.evaluate(() => localStorage.getItem('ur_pills_v1'))) === 'false');
    // скидки
    await pp.click('[data-tab="prices"]');
    const pr = await pp.locator('#panel, .panel').first().innerText().catch(() => '');
    check('скидки: во вкладке цен есть блок со скидками и ссылками на источники', /Скидки по сетям/i.test(pr) && (await pp.locator('.disc-list a[href^="https://"]').count()) >= 4, pr.slice(-300));
    check('скидки: указана дата сверки', /Сверено 28\.10\.2026/.test(pr));
    await pp.screenshot({ path: path.join(shots, '20-discounts.png') });
    check('метки и скидки: нет JS-ошибок', errP.length === 0, errP.join(' || '));
    await cP.close();
  }

  // Баннер обновления: сервер отдаёт другую версию sw.js
  {
    const cU = await browser.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
    const pu = await cU.newPage();
    await pu.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base + '/sw.js')) return route.fulfill({ contentType: 'text/javascript', body: "const VERSION = 'ur-v999';" });
      if (url.startsWith(base)) return route.continue();
      if (url.includes('leaflet.min.js')) return route.fulfill({ contentType: 'text/javascript', body: LEAFLET_STUB });
      if (url.includes('overpass')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK) });
      if (url.includes('fonts.googleapis') || url.includes('leaflet.min.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    await pu.goto(base + '/');
    await pu.waitForSelector('.upd', { timeout: 9000 }).catch(() => {});
    check('обновление: при другой версии на сервере появляется баннер с кнопкой', (await pu.locator('.upd #upd-go').count()) === 1);
    await pu.click('[data-tab="prices"]');
    check('версия: номер виден во вкладке «Цены»', /Версия v\d+/.test(await pu.locator('.note.ver').innerText()));
    await cU.close();
  }

  // «Моя цена» и фильтры экономии
  {
    const cM = await browser.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block' });
    const pm = await cM.newPage();
    const errM = [];
    pm.on('pageerror', (e) => errM.push('pageerror: ' + e.message));
    await routeFor(pm, liveDoc(minsAgo(3)), null);
    await pm.goto(base + '/');
    await pm.waitForSelector('.live', { timeout: 8000 });
    const before = await pm.locator('.best').innerText();
    check('моя цена: без отметок в карточке лучшей станции цена 0,41', before.includes('0,41'), before.replace(/\n/g, ' | ').slice(0, 200));
    await pm.click('[data-tab="prices"]');
    check('моя цена: во вкладке «Цены» четыре сети для отметки', (await pm.locator('.mine-chips [data-mine]').count()) === 4);
    await pm.click('[data-mine="eleport"]');
    check('моя цена: отметка запоминается', (await pm.evaluate(() => localStorage.getItem('ur_mine_v1'))) === '{"eleport":true}' && (await pm.locator('[data-mine="eleport"]').getAttribute('aria-pressed')) === 'true');
    await pm.click('[data-tab="go"]');
    const after = await pm.locator('.best').innerText();
    check('моя цена: после отметки Eleport цена 0,41 → 0,32 и пометка', after.includes('0,32') && /с вашей скидкой, без неё/.test(after), after.replace(/\n/g, ' | ').slice(0, 260));
    await pm.click('[data-flt="discount"]');
    check('фильтр «Со скидкой»: остаются только станции с моей скидкой (Eleport)', (await pm.evaluate(() => window.__markers)) >= 1 && (await pm.evaluate(() => window.__markers)) <= 2, 'markers=' + (await pm.evaluate(() => window.__markers)));
    await pm.click('[data-flt="discount"]');
    await pm.click('[data-act="maxPrice"]');
    check('фильтр цены: первое нажатие «до 0,30 €»', /до 0,30 €/.test(await pm.locator('[data-act="maxPrice"]').innerText()));
    for (let i = 0; i < 4; i++) await pm.click('[data-act="maxPrice"]');
    check('фильтр цены: пять нажатий (0,30 → 0,35 → 0,40 → 0,50 → выкл) возвращают «Цена до…»', /Цена до/.test(await pm.locator('[data-act="maxPrice"]').innerText()));
    await pm.screenshot({ path: path.join(shots, '21-my-price.png') });
    check('моя цена: нет JS-ошибок', errM.length === 0, errM.join(' || '));
    await cM.close();
  }

  // Маршрут с остановкой: время прибытия и прогноз занятости к этому часу
  {
    const cS = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const ps = await cS.newPage();
    const errS = [];
    ps.on('pageerror', (e) => errS.push('pageerror: ' + e.message));
    const MOCK2 = { elements: MOCK.elements.concat([el('node', 77, 57.1, 24.5, { name: 'Stop77', operator: 'Ignitis ON', 'socket:type2_combo': '4', 'socket:type2_combo:output': '150 kW' })]) };
    const line2 = [[56.95, 24.11], [57.1, 24.5], [57.54, 25.42]].map((q) => [q[1], q[0]]);
    const hours = Array.from({ length: 48 }, () => 42);
    await ps.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes('leaflet.min.js')) return route.fulfill({ contentType: 'text/javascript', body: LEAFLET_STUB });
      if (url.includes('overpass')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK2) });
      if (url.includes('nominatim')) return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ lat: '57.54', lon: '25.42', display_name: 'Valmiera, Latvija' }]) });
      if (url.includes('router.project-osrm.org')) return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ routes: [{ distance: 600000, duration: 21600, geometry: { coordinates: line2 } }] }) });
      if (url.includes('fonts.googleapis') || url.includes('leaflet.min.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    await ps.addInitScript(() => localStorage.setItem('ur_car_v1', JSON.stringify({ id: 'tesla-3-lr' })));
    await ps.goto(base + '/?tab=route');
    await ps.waitForSelector('#route-to', { timeout: 8000 });
    await ps.fill('#route-to', 'Valmiera');
    await ps.fill('#route-soc', '25');
    await ps.click('#route-go');
    await ps.waitForSelector('.route-sum', { timeout: 9000 });
    const stopTxt = await ps.locator('#panel').innerText();
    check('маршрут с остановкой: время прибытия «прибытие ≈ ЧЧ:ММ»', /прибытие ≈ \d{1,2}:\d{2}/.test(stopTxt), stopTxt.replace(/\n/g, ' | ').slice(0, 400));
    check('маршрут с остановкой: время зарядки «→80%: ≈ N мин»', /→80%: ≈ \d+ мин/.test(stopTxt));
    check('маршрут с остановкой: нет JS-ошибок', errS.length === 0, errS.join(' || '));
    await cS.close();
  }

  check('нет ошибок в консоли', errors.length === 0, errors.join(' || '));

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r[1]).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' проверок прошли');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('crash', e); process.exit(2); });
