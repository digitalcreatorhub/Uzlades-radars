/* Uzlādes Radars: приложение. Станции берём из OpenStreetMap (Overpass) прямо в браузере,
   а статус «свободно / занято» и цены из национальной точки доступа Латвии (transportdata.gov.lv):
   Actions раз в 15 минут собирают live.json, приложение читает его и сливает со станциями (logic.js). */
(function () {
  'use strict';

  const UR = window.UR;

  /* ---------- хранилище ---------- */
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* без хранилища работаем дальше */ } },
  };

  /* ---------- тексты ---------- */
  const I18N = {
    ru: {
      install: 'Установить',
      tabGo: 'Куда ехать', tabList: 'Рядом', tabPrices: 'Цены',
      connAny: 'Все', pwrFast: '50+ кВт', pwrUltra: '150+ кВт', unitKm: 'км',
      loading: 'Загружаю станции Риги…',
      loadError: 'Не удалось загрузить станции. Проверьте интернет.',
      stale: 'Показаны сохранённые данные: обновить не получилось.',
      retry: 'Повторить',
      toastLocDenied: 'Нет доступа к местоположению. Разрешите его в настройках браузера.',
      toastLocUnavailable: 'Не удалось определить место. Считаю от центра Риги.',
      locate: 'Определить моё место',
      locating: 'Определяю…',
      fromCenter: 'Считаю от центра Риги',
      fromYou: 'Считаю от вашего места',
      prioBalanced: 'Баланс', prioCheap: 'Дешевле', prioNear: 'Ближе',
      noResults: 'Под эти фильтры станций нет. Попробуйте другой разъём или мощность.',
      alsoGood: 'Ещё варианты',
      distCenter: '{n} км от центра Риги', distYou: '{n} км от вас',
      per100: 'за 100 км хода',
      minFor100: '≈ {n} мин на 100 км хода',
      priceUnknown: 'цена не известна',
      perKwh: '€/кВт·ч',
      go: 'Поехали',
      navGoogle: 'Google Maps', navWaze: 'Waze',
      back: 'Назад',
      details: 'Подробнее',
      operator: 'Сеть', otherNet: 'Другая сеть', unnamed: 'Станция без названия',
      allOperators: 'Все сети',
      count: '{n} станций',
      dtPower: 'Мощность', dtSockets: 'Разъёмы', dtPoints: 'Точек', dtPrice: 'Цена', dtFee: 'Оплата',
      dtHours: 'Часы работы', dtAddress: 'Адрес', dtBusy: 'Занятость', dtLiveList: 'Точки',
      powerEst: '{n} кВт (оценка)', powerKnown: 'до {n} кВт', powerNone: 'не указана',
      feeYes: 'платная', feeNo: 'бесплатная',
      busyUnknown: 'Нет данных. Свободна ли станция, покажет приложение сети.',
      priceNote: 'ориентир', priceLive: 'по данным станции',
      liveFree: 'Свободно {f} из {n}', liveBusy: 'Все заняты', liveOut: 'Не работает', liveUnknown: 'Статус неизвестен',
      liveAsOf: 'Статус свободных зарядок на {time}', liveNone: 'Статус зарядок сейчас недоступен',
      liveStaleNote: 'Статус устарел ({time}), не показываю его как актуальный',
      ptFree: 'свободна', ptBusy: 'занята', ptOut: 'не работает', ptUnk: 'нет данных',
      liveSource: 'Статус и цены: Eco-Movement через национальную точку доступа Латвии (CC0).',
      pricesLiveIntro: 'Цены в €/кВт·ч с НДС по данным самих станций на {time}. Где данных нет, ориентир от {date}.',
      fixOsm: 'Ошибка в данных? Исправить на OpenStreetMap',
      pricesIntro: 'Ориентировочные цены публичной зарядки в €/кВт·ч с НДС на {date}. Точную цену показывает приложение сети.',
      thNet: 'Сеть', thAc: 'AC', thDc: 'DC', thHpc: '150+',
      pricesNoData: 'в приложении',
      note_emobi: 'Платит минутами: 0,21 €/мин. Цена за кВт·ч зависит от скорости зарядки вашей машины.',
      note_ignitis: 'Простой: 0,10 €/мин, если авто стоит дольше 20 минут после зарядки.',
      note_enefit: 'Ночью (21:00–08:00) дешевле. Минимальная плата 0,50 €. Своим клиентам электричества −10%.',
      note_elektrum: 'Цена зависит от станции. Клиентам с договором −5%.',
      note_neste: 'Ночью (19:00–07:00) 0,32 €/кВт·ч до 30.11.2026. Дневную цену смотрите в приложении Neste.',
      note_tesla: 'Цены в приложении и на карте Tesla.',
      note_ionity: 'Цена без подписки. С подпиской дешевле.',
      sockType2: 'Type 2', sockCcs: 'CCS', sockChademo: 'CHAdeMO', sockTesla: 'Tesla',
    },
    en: {
      install: 'Install',
      tabGo: 'Where to go', tabList: 'Nearby', tabPrices: 'Prices',
      connAny: 'All', pwrFast: '50+ kW', pwrUltra: '150+ kW', unitKm: 'km',
      loading: 'Loading Riga stations…',
      loadError: 'Could not load stations. Check your connection.',
      stale: 'Showing saved data: the update failed.',
      retry: 'Retry',
      toastLocDenied: 'Location is blocked. Allow it in your browser settings.',
      toastLocUnavailable: 'Could not get your location. Using central Riga.',
      locate: 'Use my location',
      locating: 'Locating…',
      fromCenter: 'Measuring from central Riga',
      fromYou: 'Measuring from your location',
      prioBalanced: 'Balanced', prioCheap: 'Cheaper', prioNear: 'Closer',
      noResults: 'No stations match these filters. Try another connector or power.',
      alsoGood: 'More options',
      distCenter: '{n} km from central Riga', distYou: '{n} km from you',
      per100: 'per 100 km of range',
      minFor100: '≈ {n} min for 100 km of range',
      priceUnknown: 'price unknown',
      perKwh: '€/kWh',
      go: 'Go',
      navGoogle: 'Google Maps', navWaze: 'Waze',
      back: 'Back',
      details: 'Details',
      operator: 'Network', otherNet: 'Other network', unnamed: 'Unnamed station',
      allOperators: 'All networks',
      count: '{n} stations',
      dtPower: 'Power', dtSockets: 'Connectors', dtPoints: 'Points', dtPrice: 'Price', dtFee: 'Payment',
      dtHours: 'Hours', dtAddress: 'Address', dtBusy: 'Availability', dtLiveList: 'Points',
      powerEst: '{n} kW (estimate)', powerKnown: 'up to {n} kW', powerNone: 'not listed',
      feeYes: 'paid', feeNo: 'free',
      busyUnknown: 'No data. The network app shows whether the station is free.',
      priceNote: 'indicative', priceLive: 'from the station',
      liveFree: '{f} of {n} free', liveBusy: 'All busy', liveOut: 'Out of service', liveUnknown: 'Status unknown',
      liveAsOf: 'Availability as of {time}', liveNone: 'Availability is unavailable right now',
      liveStaleNote: 'Availability is out of date ({time}), not shown as current',
      ptFree: 'free', ptBusy: 'in use', ptOut: 'out of service', ptUnk: 'no data',
      liveSource: 'Availability and prices: Eco-Movement via the Latvian national access point (CC0).',
      pricesLiveIntro: 'Prices in €/kWh incl. VAT as reported by the stations at {time}. Where there is no data: indicative as of {date}.',
      fixOsm: 'Wrong data? Fix it on OpenStreetMap',
      pricesIntro: 'Indicative public charging prices in €/kWh incl. VAT as of {date}. The network app shows the exact price.',
      thNet: 'Network', thAc: 'AC', thDc: 'DC', thHpc: '150+',
      pricesNoData: 'in the app',
      note_emobi: 'Billed per minute: 0.21 €/min. The price per kWh depends on how fast your car charges.',
      note_ignitis: 'Idle fee: 0.10 €/min if the car stays over 20 minutes after charging.',
      note_enefit: 'Cheaper at night (21:00–08:00). Minimum fee 0.50 €. −10% for its electricity customers.',
      note_elektrum: 'Price depends on the station. −5% with a contract.',
      note_neste: 'Night price (19:00–07:00) 0.32 €/kWh until 30.11.2026. See the Neste app for day prices.',
      note_tesla: 'Prices are in the Tesla app and map.',
      note_ionity: 'Price without subscription. Cheaper with one.',
      sockType2: 'Type 2', sockCcs: 'CCS', sockChademo: 'CHAdeMO', sockTesla: 'Tesla',
    },
  };

  let lang = store.get('ur_lang') === 'en' ? 'en' : 'ru';
  function t(key, vars) {
    let s = (I18N[lang] && I18N[lang][key]) || I18N.ru[key] || key;
    if (vars) for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', vars[k]);
    return s;
  }

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtKm = (n) => (n < 10 ? n.toFixed(1) : String(Math.round(n))).replace('.', ',');
  const fmtEur = (n) => n.toFixed(2).replace('.', ',');
  const fmtRange = (p) => (p.lo === p.hi ? fmtEur(p.lo) : fmtEur(p.lo) + '–' + fmtEur(p.hi));

  /* ---------- состояние ---------- */
  const RIGA = { lat: 56.9496, lon: 24.1052 };
  const state = {
    osm: [], // станции из OpenStreetMap
    live: null, // live.json из национальной точки доступа
    stations: [], // результат слияния: их показываем
    liveError: false,
    origin: { lat: RIGA.lat, lon: RIGA.lon, real: false },
    filters: { connector: 'any', power: 'any', operator: 'all' },
    priority: 'balanced',
    tab: 'go',
    detailId: null,
    theme: store.get('ur_theme') === 'light' ? 'light' : 'dark',
    status: null, // 'loading' | 'error' | 'stale' | null
    locating: false,
  };

  const $ = (id) => document.getElementById(id);

  /* ---------- загрузка станций (Overpass) ---------- */
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  const BBOX_ARR = [56.85, 23.93, 57.07, 24.35]; // юг, запад, север, восток: Рига с пригородами
  const BBOX = BBOX_ARR.join(',');
  const QUERY =
    '[out:json][timeout:25];(' +
    'node["amenity"="charging_station"](' + BBOX + ');' +
    'way["amenity"="charging_station"](' + BBOX + ');' +
    ');out center tags;';
  const CACHE_KEY = 'ur_stations_v1';
  const CACHE_TTL = 12 * 3600 * 1000;

  function readCache() {
    const raw = store.get(CACHE_KEY);
    if (!raw) return null;
    try {
      const c = JSON.parse(raw);
      return c && Array.isArray(c.stations) ? c : null;
    } catch (e) { return null; }
  }

  // Спрашиваем все зеркала Overpass одновременно, берём первый хороший ответ.
  async function fetchElements() {
    const controllers = [];
    const attempt = async (url) => {
      const ctl = new AbortController();
      controllers.push(ctl);
      const timer = setTimeout(() => ctl.abort(), 20000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(QUERY),
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (!json || !Array.isArray(json.elements)) throw new Error('bad response');
        return json.elements;
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      return await Promise.any(ENDPOINTS.map(attempt));
    } finally {
      controllers.forEach((c) => { try { c.abort(); } catch (e) { /* уже завершён */ } });
    }
  }

  // Слияние OSM и национальной точки доступа; живые цены сетей обновляем вместе с ним.
  function rebuildStations() {
    UR.setLivePrices(state.live ? UR.buildPriceTable(state.live) : {});
    state.stations = UR.mergeLive(state.osm, state.live, { bbox: BBOX_ARR });
  }

  async function loadStations(force) {
    const cached = readCache();
    if (cached) {
      state.osm = cached.stations;
      rebuildStations();
      renderAll();
      if (!force && Date.now() - cached.t < CACHE_TTL) return;
    }
    if (!cached && !state.stations.length) setStatus('loading');
    try {
      const els = await fetchElements();
      state.osm = els.map(UR.toStation).filter(Boolean);
      store.set(CACHE_KEY, JSON.stringify({ t: Date.now(), stations: state.osm }));
      rebuildStations();
      setStatus(null);
    } catch (e) {
      // Overpass недоступен: если есть данные национальной точки доступа, приложение всё равно работает
      setStatus(state.stations.length ? (state.osm.length ? 'stale' : null) : 'error');
    }
    renderAll();
  }

  /* ---------- живые данные (статус и цены) ---------- */
  const LIVE_URL = 'https://raw.githubusercontent.com/digitalcreatorhub/Uzlades-radars/live/live.json';
  const LIVE_CACHE_KEY = 'ur_live_v1';
  const LIVE_REFRESH_MS = 5 * 60 * 1000;
  let liveLoadedAt = 0;

  function readLiveCache() {
    const raw = store.get(LIVE_CACHE_KEY);
    if (!raw) return null;
    try {
      const c = JSON.parse(raw);
      return c && Array.isArray(c.sites) ? c : null;
    } catch (e) { return null; }
  }

  // quiet: фоновое обновление, карту при этом не двигаем
  async function loadLive(quiet) {
    if (!quiet && !state.live) {
      const cached = readLiveCache();
      if (cached) { state.live = cached; rebuildStations(); renderAll(); }
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(LIVE_URL, { signal: ctl.signal, cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || !Array.isArray(data.sites)) throw new Error('bad live.json');
      state.live = data;
      state.liveError = false;
      liveLoadedAt = Date.now();
      store.set(LIVE_CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      state.liveError = true;
    } finally {
      clearTimeout(timer);
    }
    rebuildStations();
    quietRender = !!quiet;
    renderAll();
    quietRender = false;
    if (state.status === 'error' && state.stations.length) setStatus(null);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - liveLoadedAt > 2 * 60 * 1000) loadLive(true);
  });
  setInterval(() => { if (document.visibilityState === 'visible') loadLive(true); }, LIVE_REFRESH_MS);

  /* ---------- карта ---------- */
  let map, tiles, markerLayer, youMarker;
  const markers = new Map();

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  const classColor = (cls) => cssVar('--c-' + cls) || cssVar('--c-unknown');

  function initMap() {
    map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([RIGA.lat, RIGA.lon], 12);
    L.control.zoom({ position: 'topright' }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    setTiles();
  }

  // Стандартные тайлы OpenStreetMap (ключ не нужен). Тёмная тема: CSS-фильтр на слое тайлов.
  function setTiles() {
    if (tiles) tiles.remove();
    tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    $('map').classList.toggle('dark-tiles', state.theme === 'dark');
  }

  function renderMarkers(list) {
    markerLayer.clearLayers();
    markers.clear();
    const stroke = cssVar('--bg');
    for (const st of list) {
      const selected = st.id === state.detailId;
      const sum = UR.liveSummary(st, state.filters);
      const level = sum ? sum.level : 'unknown';
      // свободно: зелёная рамка; все заняты: тусклая метка; не работает: ещё бледнее
      const ring = level === 'free' ? cssVar('--ok') : stroke;
      const m = L.circleMarker([st.lat, st.lon], {
        radius: selected ? 11 : 8,
        weight: selected ? 3 : level === 'free' ? 3 : 2,
        color: selected ? cssVar('--text') : ring,
        fillColor: classColor(st.cls),
        fillOpacity: level === 'out' ? 0.3 : level === 'busy' ? 0.55 : 1,
      });
      m.on('click', () => openDetail(st.id, false));
      m.addTo(markerLayer);
      markers.set(st.id, m);
    }
    if (youMarker) youMarker.remove();
    if (state.origin.real) {
      youMarker = L.circleMarker([state.origin.lat, state.origin.lon], {
        radius: 7, weight: 3, color: cssVar('--bg'), fillColor: cssVar('--you'), fillOpacity: 1,
      }).addTo(map);
    }
  }

  /* ---------- вспомогательные куски разметки ---------- */
  function gauge(st, large) {
    const n = UR.segments(st.kw);
    let bars = '';
    for (let i = 1; i <= 5; i++) bars += '<i' + (i <= n ? ' class="on"' : '') + '></i>';
    return '<span class="gauge' + (large ? ' gauge-lg' : '') + '" data-cls="' + st.cls + '" aria-hidden="true">' + bars + '</span>';
  }

  function stationTitle(st) {
    return st.name || st.address || st.operatorName || t('unnamed');
  }
  function stationSub(st) {
    const title = stationTitle(st);
    const parts = [];
    if (st.operatorName && st.operatorName !== title) parts.push(st.operatorName);
    if (st.kw) parts.push(st.powerKnown ? t('powerKnown', { n: Math.round(st.kw) }) : t('powerEst', { n: Math.round(st.kw) }));
    if (st.address && st.address !== title) parts.push(st.address);
    return parts.join(' · ');
  }

  // Бейдж «Свободно 3 из 6» / «Все заняты» / «Не работает». Для станций без живых данных не показываем ничего.
  function livePill(sum) {
    if (!sum) return '';
    let key, vars;
    if (sum.level === 'free') { key = 'liveFree'; vars = { f: sum.free, n: sum.total }; }
    else if (sum.level === 'busy') key = 'liveBusy';
    else if (sum.level === 'out') key = 'liveOut';
    else key = 'liveUnknown';
    return '<span class="live live-' + sum.level + '"><i></i>' + esc(t(key, vars)) + '</span>';
  }

  function fmtTime(ms) {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  // Строка про свежесть статуса под переключателем приоритетов
  function liveNote() {
    if (!state.live) return state.liveError ? t('liveNone') : '';
    const ts = UR.liveTime(state.live);
    if (!UR.isLiveFresh(state.live)) return t('liveStaleNote', { time: ts ? fmtTime(ts) : '—' });
    return t('liveAsOf', { time: fmtTime(ts) });
  }

  function socketsText(st) {
    const names = { type2: t('sockType2'), ccs: t('sockCcs'), chademo: t('sockChademo'), tesla: t('sockTesla') };
    const parts = Object.keys(st.sockets).map((k) => names[k] + (st.sockets[k] > 1 ? ' ×' + st.sockets[k] : ''));
    return parts.length ? parts.join(', ') : '—';
  }

  function navLinks(st, withDetails) {
    const g = 'https://www.google.com/maps/dir/?api=1&destination=' + st.lat + ',' + st.lon;
    const w = 'https://waze.com/ul?ll=' + st.lat + ',' + st.lon + '&navigate=yes';
    return (
      '<div class="btn-row">' +
      '<a class="btn btn-primary" href="' + g + '" target="_blank" rel="noopener">' + esc(t('navGoogle')) + '</a>' +
      '<a class="btn" href="' + w + '" target="_blank" rel="noopener">' + esc(t('navWaze')) + '</a>' +
      (withDetails ? '<button class="btn" data-detail="' + esc(st.id) + '">' + esc(t('details')) + '</button>' : '') +
      '</div>'
    );
  }

  const filtered = () => UR.applyFilters(state.stations, state.filters);

  /* ---------- вкладки ---------- */
  function renderGo() {
    const list = filtered();
    const ranked = UR.rank(list, state.origin, state.priority, state.filters);
    const prios = [['balanced', 'prioBalanced'], ['cheap', 'prioCheap'], ['near', 'prioNear']];
    let html =
      '<div class="seg" role="group">' +
      prios.map(([id, key]) => '<button data-prio="' + id + '" aria-pressed="' + (state.priority === id) + '">' + esc(t(key)) + '</button>').join('') +
      '</div>' +
      '<div class="origin-line"><span>' + esc(state.origin.real ? t('fromYou') : t('fromCenter')) + '</span>' +
      '<button class="link-btn" id="btn-locate">' + esc(state.locating ? t('locating') : t('locate')) + '</button></div>' +
      (liveNote() ? '<div class="live-note">' + esc(liveNote()) + '</div>' : '');

    if (!ranked.length) {
      html += '<p class="empty">' + esc(state.stations.length ? t('noResults') : state.status === 'loading' ? t('loading') : '') + '</p>';
      $('panel').innerHTML = html;
      return;
    }

    const best = ranked[0];
    const st = best.st;
    html +=
      '<article class="best">' +
      '<div class="best-head"><div><h2>' + esc(stationTitle(st)) + '</h2><div class="sub">' + esc(stationSub(st)) + '</div>' +
      (best.live ? '<div class="live-line">' + livePill(best.live) + '</div>' : '') + '</div>' +
      gauge(st, true) + '</div>' +
      '<div class="facts">' +
      '<div><b>' + esc(t(state.origin.real ? 'distYou' : 'distCenter', { n: fmtKm(best.distKm) })) + '</b>' +
      (best.minutes ? ' <span>· ' + esc(t('minFor100', { n: best.minutes })) + '</span>' : '') + '</div>' +
      '<div>' + (best.price
        ? '<b>' + fmtRange(best.price) + ' ' + esc(t('perKwh')) + '</b> <span>≈ ' + fmtEur(best.costPer100) + ' € ' + esc(t('per100')) + '</span>'
        : '<span>' + esc(t('priceUnknown')) + '</span>') + '</div>' +
      '</div>' + navLinks(st, true) +
      '</article>';

    const more = ranked.slice(1, 4);
    if (more.length) {
      html += '<h3 style="margin:0 0 4px;font-size:15px">' + esc(t('alsoGood')) + '</h3><div class="rows">' + more.map(rowHtml).join('') + '</div>';
    }
    $('panel').innerHTML = html;
    focusStation(st);
  }

  function rowHtml(r) {
    const st = r.st;
    return (
      '<button class="row" data-detail="' + esc(st.id) + '">' + gauge(st, false) +
      '<span class="main"><span class="title" style="display:block">' + esc(stationTitle(st)) + '</span>' +
      '<span class="meta" style="display:block">' + esc(stationSub(st)) + '</span>' +
      (r.live ? '<span class="live-line" style="display:block">' + livePill(r.live) + '</span>' : '') + '</span>' +
      '<span class="side">' + esc(fmtKm(r.distKm)) + ' ' + esc(t('unitKm')) +
      '<small>' + (r.price ? fmtRange(r.price) + ' ' + esc(t('perKwh')) : esc(t('priceUnknown'))) + '</small></span></button>'
    );
  }

  function renderList() {
    const ranked = UR.rank(filtered(), state.origin, 'near', state.filters);
    const ops = UR.OPERATORS.map((o) => [o.id, o.name]).concat([['other', t('otherNet')]]);
    const options = [['all', t('allOperators')]].concat(ops)
      .map(([id, name]) => '<option value="' + id + '"' + (state.filters.operator === id ? ' selected' : '') + '>' + esc(name) + '</option>').join('');
    let html =
      '<div class="list-tools"><select id="sel-operator" aria-label="' + esc(t('operator')) + '">' + options + '</select>' +
      '<span class="count">' + esc(t('count', { n: ranked.length })) + '</span></div>';
    if (!ranked.length) {
      html += '<p class="empty">' + esc(state.stations.length ? t('noResults') : state.status === 'loading' ? t('loading') : '') + '</p>';
    } else {
      html += '<div class="rows">' + ranked.slice(0, 80).map(rowHtml).join('') + '</div>';
    }
    $('panel').innerHTML = html;
  }

  function renderPrices() {
    const cell = (op, cls) => {
      const p = UR.priceFor(op.id, cls);
      const own = UR.priceTable(op.id)[cls];
      if (!own) return '<span style="color:var(--muted)">–</span>';
      return fmtRange(p);
    };
    const rows = UR.OPERATORS.map((op) => {
      const pr = UR.priceTable(op.id);
      const hasAny = pr.ac || pr.dc || pr.hpc;
      const noteKey = 'note_' + op.id;
      const note = I18N.ru[noteKey] ? '<span class="sub">' + esc(t(noteKey)) + '</span>' : '';
      if (!hasAny) {
        return '<tr><td>' + esc(op.name) + note + '</td><td colspan="3" style="color:var(--muted)">' + esc(t('pricesNoData')) + '</td></tr>';
      }
      return '<tr><td>' + esc(op.name) + note + '</td>' +
        '<td class="num">' + cell(op, 'ac') + '</td><td class="num">' + cell(op, 'dc') + '</td><td class="num">' + cell(op, 'hpc') + '</td></tr>';
    }).join('');
    const date = UR.PRICES_DATE.split('-').reverse().join('.');
    const liveOk = state.live && UR.isLiveFresh(state.live);
    $('panel').innerHTML =
      '<p class="note">' + esc(liveOk ? t('pricesLiveIntro', { time: fmtTime(UR.liveTime(state.live)), date }) : t('pricesIntro', { date })) + '</p>' +
      '<table class="price-table"><thead><tr><th>' + esc(t('thNet')) + '</th>' +
      '<th><span class="dot" style="background:var(--c-ac)"></span>' + esc(t('thAc')) + '</th>' +
      '<th><span class="dot" style="background:var(--c-dc)"></span>' + esc(t('thDc')) + '</th>' +
      '<th><span class="dot" style="background:var(--c-hpc)"></span>' + esc(t('thHpc')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (state.live ? '<p class="note" style="margin-top:12px">' + esc(t('liveSource')) + '</p>' : '');
  }

  const PT_NAMES = { type2: 'sockType2', ccs: 'sockCcs', chademo: 'sockChademo', tesla: 'sockTesla' };

  function livePoints(st) {
    const key = { free: 'ptFree', busy: 'ptBusy', out: 'ptOut', unk: 'ptUnk' };
    const pts = st.live.pts.slice().sort((a, b) => (b.kw || 0) - (a.kw || 0));
    return (
      '<ul class="pts">' +
      pts.map((p) => {
        const name = PT_NAMES[p.t] ? t(PT_NAMES[p.t]) : '?';
        const kw = p.kw ? ' ' + Math.round(p.kw) + ' ' + (lang === 'ru' ? 'кВт' : 'kW') : '';
        const price = p.p != null ? fmtEur(p.p) + ' ' + t('perKwh') : '';
        return '<li><span class="pt-dot pt-' + esc(p.s) + '"></span><span class="pt-name">' + esc(name + kw) + '</span>' +
          '<span class="pt-state">' + esc(t(key[p.s] || 'ptUnk')) + '</span><span class="pt-price">' + esc(price) + '</span></li>';
      }).join('') +
      '</ul>'
    );
  }

  function renderDetail() {
    const st = state.stations.find((s) => s.id === state.detailId);
    if (!st) { state.detailId = null; renderPanel(); return; }
    const livePrice = UR.livePriceOf(st, null);
    const price = livePrice || UR.priceFor(st.operatorId, st.cls);
    const sum = UR.liveSummary(st, null);
    const rows = [];
    rows.push([t('dtPower'), st.kw ? (st.powerKnown ? t('powerKnown', { n: Math.round(st.kw) }) : t('powerEst', { n: Math.round(st.kw) })) : t('powerNone')]);
    rows.push([t('dtSockets'), socketsText(st)]);
    if (st.points) rows.push([t('dtPoints'), String(st.points)]);
    rows.push([t('dtPrice'), price ? fmtRange(price) + ' ' + t('perKwh') + ' (' + t(livePrice ? 'priceLive' : 'priceNote') + ')' : t('priceUnknown')]);
    if (st.fee) rows.push([t('dtFee'), st.fee === 'yes' ? t('feeYes') : st.fee === 'no' ? t('feeNo') : st.fee]);
    if (st.hours) rows.push([t('dtHours'), st.hours]);
    if (st.address) rows.push([t('dtAddress'), st.address]);
    const busyHtml = sum ? livePill(sum) : esc(t('busyUnknown'));
    const osm = st.osmType ? 'https://www.openstreetmap.org/' + st.osmType + '/' + st.osmId : null;
    $('panel').innerHTML =
      '<button class="link-btn back" id="btn-back">' + esc(t('back')) + '</button>' +
      '<div class="detail"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">' +
      '<div><h2>' + esc(stationTitle(st)) + '</h2><div class="sub">' + esc(st.operatorName || t('otherNet')) + '</div></div>' + gauge(st, true) + '</div>' +
      '<dl>' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') +
      '<dt>' + esc(t('dtBusy')) + '</dt><dd>' + busyHtml + '</dd></dl>' +
      (st.live ? livePoints(st) + (liveNote() ? '<p class="note">' + esc(liveNote()) + '</p>' : '') : '') +
      navLinks(st) +
      (osm ? '<p class="note" style="margin-top:14px"><a href="' + osm + '" target="_blank" rel="noopener" style="color:var(--muted)">' + esc(t('fixOsm')) + '</a></p>' : '') +
      (st.live ? '<p class="note">' + esc(t('liveSource')) + '</p>' : '') + '</div>';
  }

  function renderPanel() {
    if (state.detailId) return renderDetail();
    if (state.tab === 'go') return renderGo();
    if (state.tab === 'list') return renderList();
    return renderPrices();
  }

  function renderTabs() {
    const tabs = [['go', 'tabGo'], ['list', 'tabList'], ['prices', 'tabPrices']];
    $('tabs').innerHTML = tabs
      .map(([id, key]) => '<button class="tab" role="tab" data-tab="' + id + '" aria-selected="' + (state.tab === id && !state.detailId) + '">' + esc(t(key)) + '</button>')
      .join('');
  }

  function renderFilters() {
    const conn = [['any', t('connAny')], ['ccs', 'CCS'], ['type2', 'Type 2'], ['chademo', 'CHAdeMO']];
    const pwr = [['fast', t('pwrFast')], ['ultra', t('pwrUltra')]]; // повторное нажатие снимает фильтр
    $('filters').innerHTML =
      conn.map(([id, label]) => '<button class="chip" data-conn="' + id + '" aria-pressed="' + (state.filters.connector === id) + '">' + esc(label) + '</button>').join('') +
      '<span class="chip-gap"></span>' +
      pwr.map(([id, label]) => '<button class="chip" data-pwr="' + id + '" aria-pressed="' + (state.filters.power === id) + '">' + esc(label) + '</button>').join('');
  }

  function renderTop() {
    $('btn-lang').textContent = lang === 'ru' ? 'RU' : 'EN';
    $('btn-theme').textContent = state.theme === 'dark' ? '☾' : '☀';
    $('btn-install').textContent = t('install');
    document.documentElement.lang = lang;
    document.documentElement.dataset.theme = state.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', cssVar('--bg') || '#0a1820');
  }

  function setStatus(s) {
    state.status = s;
    renderStatus();
  }
  function renderStatus() {
    const el = $('status');
    if (!state.status) { el.hidden = true; return; }
    const text = state.status === 'loading' ? t('loading') : state.status === 'error' ? t('loadError') : t('stale');
    el.innerHTML = '<span>' + esc(text) + '</span>' + (state.status === 'loading' ? '' : '<button id="btn-retry">' + esc(t('retry')) + '</button>');
    el.hidden = false;
  }

  let toastTimer;
  function toast(text) {
    const el = $('toast');
    el.innerHTML = '<span>' + esc(text) + '</span>';
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  function renderAll() {
    renderTop();
    renderFilters();
    renderTabs();
    renderStatus();
    renderMarkers(filtered());
    renderPanel();
  }

  /* ---------- действия ---------- */
  let quietRender = false; // фоновое обновление не должно уводить карту от того, что смотрит человек
  function focusStation(st) {
    if (!map || quietRender) return;
    map.flyTo([st.lat, st.lon], Math.max(map.getZoom(), 14), { duration: 0.6 });
  }

  function openDetail(id, fly) {
    state.detailId = id;
    const st = state.stations.find((s) => s.id === id);
    renderTabs();
    renderMarkers(filtered());
    renderPanel();
    if (st && fly !== false) focusStation(st);
    $('panel').scrollTop = 0;
  }

  function closeDetail() {
    state.detailId = null;
    renderTabs();
    renderMarkers(filtered());
    renderPanel();
  }

  function locate() {
    if (!navigator.geolocation) { toast(t('toastLocUnavailable')); return; }
    state.locating = true;
    renderPanel();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.locating = false;
        state.origin = { lat: pos.coords.latitude, lon: pos.coords.longitude, real: true };
        map.setView([state.origin.lat, state.origin.lon], 14);
        renderAll();
      },
      (err) => {
        state.locating = false;
        toast(err && err.code === 1 ? t('toastLocDenied') : t('toastLocUnavailable'));
        renderPanel();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  function setSheetOpen(open) {
    $('sheet').dataset.open = String(open);
    $('grab').setAttribute('aria-expanded', String(open));
    setTimeout(() => map && map.invalidateSize(), 260);
  }

  /* ---------- события ---------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    const d = el.dataset;
    if (d.conn) { state.filters.connector = d.conn; state.detailId = null; renderAll(); }
    else if (d.pwr) { state.filters.power = state.filters.power === d.pwr ? 'any' : d.pwr; state.detailId = null; renderAll(); }
    else if (d.tab) { state.tab = d.tab; state.detailId = null; renderTabs(); renderMarkers(filtered()); renderPanel(); $('panel').scrollTop = 0; }
    else if (d.prio) { state.priority = d.prio; renderPanel(); }
    else if (d.detail) { openDetail(d.detail, true); setSheetOpen(true); }
    else if (el.id === 'btn-back') closeDetail();
    else if (el.id === 'btn-locate') locate();
    else if (el.id === 'btn-retry') { setStatus('loading'); loadStations(true); loadLive(true); }
    else if (el.id === 'grab') setSheetOpen($('sheet').dataset.open !== 'true');
    else if (el.id === 'btn-lang') { lang = lang === 'ru' ? 'en' : 'ru'; store.set('ur_lang', lang); renderAll(); }
    else if (el.id === 'btn-theme') {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      store.set('ur_theme', state.theme);
      document.documentElement.dataset.theme = state.theme;
      setTiles();
      renderAll();
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'sel-operator') { state.filters.operator = e.target.value; renderAll(); }
  });

  /* установка как приложения */
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    $('btn-install').hidden = false;
  });
  window.addEventListener('appinstalled', () => { installEvent = null; $('btn-install').hidden = true; });
  $('btn-install').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch (e) { /* пользователь закрыл окно */ }
    installEvent = null;
    $('btn-install').hidden = true;
  });

  /* ---------- запуск ---------- */
  document.documentElement.dataset.theme = state.theme;
  initMap();
  renderAll();
  loadStations(false);
  loadLive(false);

  // Если местоположение уже разрешено раньше, берём его без лишних вопросов.
  try {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((r) => { if (r.state === 'granted') locate(); }).catch(() => {});
    }
  } catch (e) { /* не страшно: останемся с центром Риги */ }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* работаем без офлайн-режима */ });
    });
  }
})();
