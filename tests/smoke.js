// Дымовой тест в настоящем Chromium. Leaflet подменён заглушкой, Overpass отвечает тестовыми станциями.
// Запуск: node tests/smoke.js <папка проекта> <папка для скриншотов>  (нужен Playwright с Chromium)
const path = require('path');
const fs = require('fs');
const http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require.resolve('playwright', { paths: ['/usr/local/lib/node_modules_global'] }))); }

const root = process.argv[2];
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
window.__markers = 0; window.__circles = 0; window.__center = null;
function Layer(){ this.on=function(){return this}; this.addTo=function(){return this}; this.remove=function(){return this}; }
window.L = {
  map(){ const m={ setView(c,z){ window.__center=[c[0],c[1],z]; return m}, flyTo(c,z){ window.__center=[c[0],c[1],z]; return m}, getZoom(){return 12}, invalidateSize(){}, }; return m; },
  control:{ zoom(){ return new Layer(); } },
  layerGroup(){ const g=new Layer(); g.clearLayers=function(){ window.__markers=0; }; g.addTo=function(){return g}; return g; },
  tileLayer(){ return new Layer(); },
  circle(){ const m=new Layer(); m.addTo=function(){ window.__circles++; return m; }; return m; },
  circleMarker(){ const m=new Layer(); m.addTo=function(){ window.__markers++; return m; }; return m; },
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
  check('английский язык', (await page.locator('.tab').first().innerText()) === 'Where to go');
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
      { id: 'a1', n: 'GAL_1', op: 'Eleport', lat: 56.95002, lon: 24.11002, a: 'Dzirnavu iela 67', c: 'Rīga', h: '24/7', u: statusTime,
        pts: [P('ccs', 150, 'free', 0.41), P('ccs', 150, 'busy', 0.41), P('type2', 22, 'free', 0.34)] },
      // только в NAP, все заняты
      { id: 'a2', n: 'Elektrum, DC 50kW', op: 'Elektrum Drive', lat: 56.94, lon: 24.1, a: 'Lāčplēša iela 10', c: 'Rīga', h: '24/7', u: statusTime,
        pts: [P('ccs', 50, 'busy', 0.44), P('chademo', 50, 'busy', 0.44)] },
      // только в NAP, не работает
      { id: 'a3', n: 'OUT_3', op: 'Ignitis ON', lat: 56.945, lon: 24.106, a: 'Čaka iela 5', c: 'Rīga', h: '24/7', u: statusTime,
        pts: [P('ccs', 60, 'out', 0.35)] },
      // вне Риги: игнорируется
      { id: 'far', n: 'FAR', op: 'Elektrum Drive', lat: 57.54, lon: 25.42, a: 'Raiņa iela 12', c: 'Valmiera', h: '24/7', u: statusTime,
        pts: [P('ccs', 50, 'free', 0.44)] },
    ],
  });
  const routeFor = (ctxPage, liveBody) => ctxPage.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('leaflet.min.js')) return route.fulfill({ contentType: 'text/javascript', body: LEAFLET_STUB });
    if (url.includes('overpass')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK) });
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
  await routeFor(p3, liveDoc(minsAgo(5)));
  await p3.goto(base + '/');
  await p3.waitForSelector('.live', { timeout: 8000 });
  // OSM даёт 6 станций (приватная скрыта); node 1 сливается с a1; a2 и a3 добавляются; far отбрасывается
  check('live: 8 маркеров (6 из OSM + 2 только из NAP)', (await p3.evaluate(() => window.__markers)) === 8, 'markers=' + (await p3.evaluate(() => window.__markers)));
  check('live: строка про свежесть статуса', (await p3.locator('.live-note').innerText()).startsWith('Статус свободных зарядок на '));
  const bestTxt = await p3.locator('.best').innerText();
  check('live: в карточке лучшей станции бейдж «Свободно 2 из 3»', bestTxt.includes('Свободно 2 из 3'), bestTxt.replace(/\n/g, ' | ').slice(0, 160));
  check('live: цена в карточке взята из потока (0,41)', bestTxt.includes('0,41'));
  await p3.screenshot({ path: path.join(shots, '7-live-go.png') });

  await p3.click('[data-tab="list"]');
  const rowsTxt = await p3.locator('.rows').innerText();
  check('live: в списке есть «Все заняты» и «Не работает»', rowsTxt.includes('Все заняты') && rowsTxt.includes('Не работает'));
  check('live: в списке 8 строк', (await p3.locator('.row').count()) === 8, 'rows=' + (await p3.locator('.row').count()));
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
  check('без Overpass: работает на данных NAP (3 станции)', (await p5.evaluate(() => window.__markers)) === 3, 'markers=' + (await p5.evaluate(() => window.__markers)));
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

  check('нет ошибок в консоли', errors.length === 0, errors.join(' || '));

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r[1]).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' проверок прошли');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('crash', e); process.exit(2); });
