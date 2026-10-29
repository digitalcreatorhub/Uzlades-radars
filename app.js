/* Uzlādes Radars: приложение. Станции берём из OpenStreetMap (Overpass) прямо в браузере,
   а статус «свободно / занято» и цены из национальной точки доступа Латвии (transportdata.gov.lv):
   Actions раз в 15 минут собирают live.json, приложение читает его и сливает со станциями (logic.js). */
(function () {
  'use strict';

  const UR = window.UR;
  const APP_VERSION = 'v18'; // совпадает с VERSION в sw.js (проверяет тест); меняется с каждым выпуском

  /* ---------- хранилище ---------- */
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* без хранилища работаем дальше */ } },
  };

  const readJson = (k, d) => { try { const v = JSON.parse(store.get(k)); return v == null ? d : v; } catch (e) { return d; } };
  const writeJson = (k, v) => store.set(k, JSON.stringify(v));

  /* ---------- тексты ---------- */
  const I18N = {
    ru: {
      install: 'Установить',
      installTitle: 'Установить на телефон',
      installLead: 'Приложение откроется с экрана «Домой», как обычное, и будет работать быстрее.',
      installIos1: 'Нажмите «Поделиться» (квадрат со стрелкой вверх) внизу экрана Safari.',
      installIos2: 'Прокрутите список и выберите «На экран “Домой”».',
      installIos3: 'Нажмите «Добавить» в правом верхнем углу.',
      installAndroid1: 'Откройте меню браузера (три точки в углу).',
      installAndroid2: 'Выберите «Установить приложение» или «Добавить на главный экран».',
      installAndroid3: 'Подтвердите установку.',
      installOther1: 'В адресной строке браузера нажмите значок установки или откройте меню и выберите «Установить Uzlādes Radars».',
      installClose: 'Понятно',
      tabGo: 'Куда', tabList: 'Рядом', tabPrices: 'Цены',
      connAny: 'Все', pwrFast: '50+ кВт', pwrUltra: '150+ кВт', unitKm: 'км',
      loading: 'Загружаю станции…',
      loadError: 'Не удалось загрузить станции. Проверьте интернет.',
      stale: 'Показаны сохранённые данные: обновить не получилось.',
      retry: 'Повторить',
      toastLocDenied: 'Нет доступа к местоположению. Разрешите его в настройках браузера.',
      toastLocUnavailable: 'Не удалось определить место. Считаю от центра Риги.',
      locate: 'Определить моё место',
      locating: 'Определяю…',
      myPlace: 'Моё место',
      accM: '±{n} м',
      locDeniedLine: 'Нет доступа к месту',
      yourPlace: 'Ваше место {acc}',
      fromCenter: 'Считаю от центра Риги',
      fromYou: 'Считаю от вашего места',
      prioBalanced: 'Баланс', prioCheap: 'Дешевле', prioNear: 'Ближе',
      noResults: 'Под эти фильтры станций нет. Попробуйте другой разъём или мощность.',
      alsoGood: 'Ещё варианты',
      distCenter: '{n} км от центра', distYou: '{n} км от вас', fromCenterShort: 'от центра', fromYouShort: 'от вас',
      per100: 'за 100 км хода',
      minFor100: '≈ {n} мин на 100 км', per100Short: '≈ {eur} € / 100 км', per100Time: '≈ {eur} € · {n} мин / 100 км',
      priceUnknown: 'цена не известна',
      perKwh: '€/кВт·ч',
      go: 'Поехали',
      navGoogle: 'Google Maps', navWaze: 'Waze',
      back: 'Назад',
      details: 'Подробнее',
      operator: 'Сеть', otherNet: 'Другая сеть', unnamed: 'Станция без названия',
      allOperators: 'Все сети',
      count: '{n} станций',
      dtPower: 'Мощность', dtSockets: 'Разъёмы', dtPoints: 'Точек', dtPrice: 'Цена', dtFee: 'Стоимость',
      dtHours: 'Часы работы', dtAddress: 'Адрес', dtBusy: 'Занятость', dtLiveList: 'Точки',
      powerEst: '{n} кВт (оценка)', powerKnown: 'до {n} кВт', powerNone: 'не указана',
      feeYes: 'платная', feeNo: 'бесплатная',
      busyUnknown: 'Нет данных. Свободна ли станция, покажет приложение сети.',
      priceNote: 'ориентир', priceLive: 'по данным станции',
      liveFree: 'Свободно {f} из {n}', liveBusy: 'Все заняты', liveOut: 'Не работает', liveUnknown: 'Статус неизвестен',
      liveAsOf: 'Статус свободных зарядок на {time}', liveUpd: 'обновлено {time}', liveNone: 'Статус зарядок сейчас недоступен',
      liveStaleNote: 'Статус устарел ({time}), не показываю его как актуальный',
      ptFree: 'свободна', ptBusy: 'занята', ptOut: 'не работает', ptUnk: 'нет данных',
      busySince: 'занята с {time}', outSince: 'не работает с {time}',
      payTitle: 'Как оплатить', payShort: 'Оплата',
      payApp: 'Приложение сети', payRfid: 'RFID-карта', payCard: 'Банковская карта',
      payAppShort: 'Приложение', payRfidShort: 'RFID', payCardShort: 'Карта',
      usualTitle: 'Обычно здесь занято', usualWeekday: 'будни', usualWeekend: 'выходные',
      usualNow: 'Сейчас обычно занято ≈ {n}%', usualSince: 'по данным с {date}',
      usualLine: 'В это время обычно занято ≈ {n}%',
      dtEta: 'Прогноз', etaIn: 'Освободится примерно через {min} мин (обычно зарядка здесь ≈ {typ} мин)', etaSoon: 'Скоро может освободиться (обычно зарядка здесь ≈ {typ} мин)', etaOver: 'Занято дольше обычного ({typ} мин): может освободиться в любой момент',
      liveSource: 'Статус и цены: Eco-Movement через национальную точку доступа Латвии (CC0).',
      updAvail: 'Доступна новая версия приложения', updGo: 'Обновить', verLine: 'Версия {v}',
      fMax: 'Цена до…', fMaxN: 'до {p} €', fGratis: 'Бесплатные', fDisc: 'Со скидкой', fIndoor: 'В помещении',
      routeEta: 'прибытие ≈ {time}', routeOcc: 'к этому часу обычно занято ≈ {n}%', routeCharge: '{from}→80%: ≈ {min} мин',
      routeSave: 'Сохранить маршрут', routeShare: 'Поделиться', routeSaved: 'Сохранённые маршруты', routeSavedDone: 'Маршрут сохранён', routeDel: 'Удалить', routeShareText: 'Маршрут {from} → {to} с остановками на зарядку', routeSavedNone: '',
      garageNew: '+ Ещё машина', carName: 'Название (необязательно)', garageFull: 'Можно сохранить до 5 машин',
      mineTitle: 'Мои скидки', mineNote: 'Отметьте, что у вас есть: цены на карте, в списках и в карточках станут с вашей скидкой.',
      priceMine: 'с вашей скидкой, без неё {p}', priceTou: 'ночной тариф', dtMaxh: 'Высота въезда', dtIndoor: 'Расположение', indoorYes: 'в помещении или паркинге',
      touNow: 'Ночной тариф {price} € с {from}:00 до {to}:00 действует сейчас, ещё {left}.', touSoon: 'Ночной тариф {price} € с {from}:00 до {to}:00 начнётся через {left}.',
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
      tabRoute: 'Маршрут', tabFav: 'Мои',
      estShort: '{from}→{to}%: {min} мин · {cost} €', estShortNoCost: '{from}→{to}%: {min} мин', estNoneShort: 'нет вашего разъёма',
      fFree: 'Свободно', fOpen: '24/7', fCard: 'Картой', fCar: 'Для моей', cheapTip: 'самая низкая цена рядом', allBusy: 'Все заняты', allBusyTip: 'все точки заняты',
      discTitle: 'Скидки сети', discNote: 'Сверено {date}. Условия меняются: точные уточняйте в приложении сети.', discSrc: 'источник', discPricesTitle: 'Скидки по сетям',
      carBtn: 'Моя машина', carTitle: 'Моя машина',
      carLead: 'Выберите модель. Значения ориентировочные, любое можно поправить под свою машину.',
      carModel: 'Модель', carKwh: 'Батарея (полезная), кВт·ч', carDc: 'Макс. быстрая (DC), кВт', carAc: 'Макс. AC, кВт', carCons: 'Расход, кВт·ч/100 км',
      carConn: 'Разъёмы машины', carOnly: 'Показывать только подходящие станции',
      carPetrol: 'Бензин, €/л', carPetrolHint: 'пусто = средняя 95 из Degvielas Radars', carPetrolCons: 'Расход бензиновой машины, л/100 км',
      carHome: 'Дома, €/кВт·ч', carHomeHint: 'необязательно',
      carSave: 'Сохранить', carClear: 'Убрать машину', carClose: 'Закрыть',
      carSet: 'Машина: {name}',
      rangeLine: '{t} °C: запас ≈ {km} км (в тепле {full})',
      rangeLineWarm: 'запас хода при 100% ≈ {km} км',
      estTitle: 'Моя машина здесь', estSpeed: 'Возьмёт до {kw} кВт',
      estLine: 'Зарядка {from}→{to}%: ≈ {min} мин · ≈ {cost} €',
      estLineNoCost: 'Зарядка {from}→{to}%: ≈ {min} мин',
      estNone: 'Разъёмы этой станции вашей машине не подходят.',
      estNote: 'Оценка: реальная скорость зависит от температуры батареи и заряда.',
      cmpTitle: 'Стоимость 100 км', cmpHere: 'Здесь', cmpHome: 'Дома', cmpPetrol: 'Бензин',
      cmpSave: 'Дешевле бензина на ≈ {eur} € за 100 км',
      cmpMore: 'Дороже бензина на ≈ {eur} € за 100 км',
      cmpPetrolNote: '{l} л/100 км по {price} €/л',
      relGood: 'Работает стабильно', relMid: 'Иногда не работают точки ({pct}%)', relBad: 'Часто не работают точки ({pct}%)',
      relNote: 'по {n} замерам', relTitle: 'Надёжность',
      fcLine: 'Через час обычно занято ≈ {n}%',
      priceUp: 'Подорожала на {d} € с {date}', priceDown: 'Подешевела на {d} € с {date}',
      favAdd: 'В избранное', favRemove: 'В избранном', favEmpty: 'Пока пусто. Нажмите ★ у станции, и она появится здесь с живым статусом.',
      favTitle: 'Избранные станции',
      chargeTitle: 'Журнал зарядок', chargeAdd: '+ Записать зарядку', chargeKwh: 'Сколько кВт·ч', chargeEur: 'Сколько заплатили, €',
      chargeName: 'Где (необязательно)', chargeSave: 'Сохранить', chargeCancel: 'Отмена',
      chargeBad: 'Введите кВт·ч и сумму числами.',
      chargeEmpty: 'Пока пусто. Запишите зарядку, и здесь появятся итоги за месяц.',
      chargeMonth: 'Этот месяц: {kwh} кВт·ч · {eur} € · {n} шт.', chargePrev: 'Прошлый месяц: {kwh} кВт·ч · {eur} €',
      chargeAvg: 'Средняя цена: {p} €/кВт·ч', chargeDel: 'Удалить запись', chargeDelSure: 'Удалить?',
      chargeHere: 'Записать зарядку здесь', chargeNote: 'Записи хранятся только на этом телефоне.',
      amenTitle: 'Рядом (≈100 м)', amenLoading: 'Ищу, что есть рядом…', amenNone: 'Рядом ничего не отмечено в OpenStreetMap.',
      amenToilets: 'Туалет', amenFood: 'Кафе, еда', amenShop: 'Магазин', amenWifi: 'Wi-Fi', amenNote: 'По данным OpenStreetMap, может быть неполно.',
      share: 'Поделиться', shareCopied: 'Ссылка скопирована', shareText: 'Зарядная станция: {name}',
      appleMaps: 'Apple Карты',
      watch: 'Следить', unwatch: 'Слежу', watchOn: 'Скажу, когда освободится. Работает, пока приложение открыто.',
      pushOn: 'Скажу, когда освободится: уведомление придёт и при закрытом приложении.',
      pushDenied: 'Уведомления запрещены в настройках браузера, поэтому скажу, только пока приложение открыто. Разрешите их в настройках сайта.',
      pushFail: 'Не получилось включить уведомления при закрытом приложении, скажу, только пока оно открыто. Попробуйте ещё раз позже.',
      watchNoLive: 'Для этой станции нет статуса в реальном времени.',
      watchFreeNow: 'Свободная зарядка уже есть.',
      watchFreed: 'Освободилась: {name}',
      pushIos: 'На iPhone уведомления при закрытом приложении работают, только если добавить его на экран «Домой».',
      watchOff: 'Больше не слежу',
      savTitle: 'Экономия против бензина', savMonth: 'Этот месяц', savYear: '{y} год', savAll: 'За всё время',
      savSaved: 'экономия', savOver: 'дороже бензина', savLine: 'проехали ≈ {km} км, заплатили {paid} € вместо ≈ {petrol} €',
      savNote: 'Считаю по расходу вашей машины ({cons} кВт·ч/100 км) и бензину {l} л/100 км по {price} €/л. Цена бензина сегодняшняя, поэтому цифра ориентировочная.',
      csvBtn: 'Скачать журнал (CSV)', csvDone: 'Журнал сохранён в файл', csvFail: 'Не получилось сохранить файл.',
      whenBest: 'Свободнее всего около {h}:00 (обычно занято ≈ {n}%), сейчас ≈ {now}%',
      whenGood: 'Сейчас хороший момент: обычно занято ≈ {n}%',
      nearFree: 'Рядом свободно:', unitM: 'м',
      timerTitle: 'Таймер: напомнить про 80%', timerHint: 'Заряд сейчас:', timerBtn: '{soc}% · {min} мин',
      timerSet: 'Таймер на {min} мин. Напомню, когда будет 80%.', timerSetPush: 'Таймер на {min} мин. Напомню, когда будет 80%, и при закрытом приложении.',
      timerActive: 'Таймер: через {min} мин', timerSoon: 'Таймер: почти готово', timerCancel: 'Отменить', timerOff: 'Таймер отменён',
      timerDone: 'Зарядка до 80% почти готова: {name}',
      digestBtn: 'Вечерняя сводка', digestOff: 'выкл', digestOn: 'Пришлю сводку по избранным в {h}:00.', digestStopped: 'Сводка выключена.',
      digestNoFav: 'Сначала добавьте станции в избранное (★): сводка будет про них.',
      digestNoPush: 'Сводка приходит уведомлением, а на этом устройстве они недоступны.',
      digestHint: 'Раз в день: что свободно на избранных и когда там спокойнее.',
      searchPh: 'Название, адрес или сеть', searchClear: 'Сбросить поиск',
      routeFrom: 'Откуда', routeTo: 'Куда', routeFromMine: 'Моё место', routeToPh: 'Город или адрес',
      routeGo: 'Найти станции', routeSoc: 'Заряд на старте, %',
      routeLen: 'Маршрут {km} км, в пути ≈ {h}',
      routeNoNeed: 'Доедете без зарядки: запас хода ≈ {km} км.',
      routeStops: 'Остановки на зарядку', routeStop: 'Остановка {n}',
      routeNoCar: 'Укажите машину, и я посчитаю остановки по запасу хода. Пока показываю станции у маршрута.',
      routeNoStart: 'В пределах запаса хода нет подходящих быстрых станций у маршрута. Выберите другую машину, заряд или объезд.',
      routeNoNext: 'После последней остановки на пути нет подходящей быстрой станции в пределах запаса хода.',
      routeTooMany: 'Слишком много остановок для расчёта. Разбейте маршрут на части.',
      routeAlong: 'Быстрые станции у маршрута (лучшая на каждые 10 км)', routeFail: 'Маршрут не найден. Проверьте адрес и интернет.',
      routeNotFound: 'Не нашёл такое место. Уточните название.',
      routeClear: 'Сбросить маршрут', routeEdit: 'Изменить маршрут', routeKm: 'на {n} км', routeOff: 'в {n} м от трассы', routeOffKm: 'в {n} км от трассы',
      routeArrive: 'приедете с {n}%', routeNoStations: 'Вдоль маршрута нет станций с вашими фильтрами.',
      routeWait: 'Ищу маршрут…',
      baltics: 'Литва и Эстония: станции из OpenStreetMap без статуса в реальном времени.',
      loadingBalt: 'Загружаю станции…',
      sockType2: 'Type 2', sockCcs: 'CCS', sockChademo: 'CHAdeMO', sockTesla: 'Tesla',
      unitKw: 'кВт', unitKwh: 'кВт·ч', unitH: 'ч', unitMin: 'мин',
    },
    en: {
      install: 'Install',
      installTitle: 'Install on your phone',
      installLead: 'It opens from your home screen like a regular app and starts faster.',
      installIos1: 'Tap “Share” (the square with an up arrow) at the bottom of Safari.',
      installIos2: 'Scroll the list and choose “Add to Home Screen”.',
      installIos3: 'Tap “Add” in the top right corner.',
      installAndroid1: 'Open the browser menu (three dots in the corner).',
      installAndroid2: 'Choose “Install app” or “Add to Home screen”.',
      installAndroid3: 'Confirm the installation.',
      installOther1: 'Click the install icon in the address bar, or open the menu and choose “Install Uzlādes Radars”.',
      installClose: 'Got it',
      tabGo: 'Best', tabList: 'Nearby', tabPrices: 'Prices',
      connAny: 'All', pwrFast: '50+ kW', pwrUltra: '150+ kW', unitKm: 'km',
      loading: 'Loading stations…',
      loadError: 'Could not load stations. Check your connection.',
      stale: 'Showing saved data: the update failed.',
      retry: 'Retry',
      toastLocDenied: 'Location is blocked. Allow it in your browser settings.',
      toastLocUnavailable: 'Could not get your location. Using central Riga.',
      locate: 'Use my location',
      locating: 'Locating…',
      myPlace: 'My location',
      accM: '±{n} m',
      locDeniedLine: 'Location blocked',
      yourPlace: 'Your location {acc}',
      fromCenter: 'Measuring from central Riga',
      fromYou: 'Measuring from your location',
      prioBalanced: 'Balanced', prioCheap: 'Cheaper', prioNear: 'Closer',
      noResults: 'No stations match these filters. Try another connector or power.',
      alsoGood: 'More options',
      distCenter: '{n} km from centre', distYou: '{n} km from you', fromCenterShort: 'from centre', fromYouShort: 'from you',
      per100: 'per 100 km of range',
      minFor100: '≈ {n} min per 100 km', per100Short: '≈ {eur} € / 100 km', per100Time: '≈ {eur} € · {n} min / 100 km',
      priceUnknown: 'price unknown',
      perKwh: '€/kWh',
      go: 'Go',
      navGoogle: 'Google Maps', navWaze: 'Waze',
      back: 'Back',
      details: 'Details',
      operator: 'Network', otherNet: 'Other network', unnamed: 'Unnamed station',
      allOperators: 'All networks',
      count: '{n} stations',
      dtPower: 'Power', dtSockets: 'Connectors', dtPoints: 'Points', dtPrice: 'Price', dtFee: 'Cost',
      dtHours: 'Hours', dtAddress: 'Address', dtBusy: 'Availability', dtLiveList: 'Points',
      powerEst: '{n} kW (estimate)', powerKnown: 'up to {n} kW', powerNone: 'not listed',
      feeYes: 'paid', feeNo: 'free',
      busyUnknown: 'No data. The network app shows whether the station is free.',
      priceNote: 'indicative', priceLive: 'from the station',
      liveFree: '{f} of {n} free', liveBusy: 'All busy', liveOut: 'Out of service', liveUnknown: 'Status unknown',
      liveAsOf: 'Availability as of {time}', liveUpd: 'updated {time}', liveNone: 'Availability is unavailable right now',
      liveStaleNote: 'Availability is out of date ({time}), not shown as current',
      ptFree: 'free', ptBusy: 'in use', ptOut: 'out of service', ptUnk: 'no data',
      busySince: 'in use since {time}', outSince: 'out of service since {time}',
      payTitle: 'How to pay', payShort: 'Pay with',
      payApp: 'Network app', payRfid: 'RFID card', payCard: 'Bank card',
      payAppShort: 'App', payRfidShort: 'RFID', payCardShort: 'Card',
      usualTitle: 'Usually busy here', usualWeekday: 'weekdays', usualWeekend: 'weekends',
      usualNow: 'Usually ≈ {n}% busy right now', usualSince: 'data since {date}',
      usualLine: 'Usually ≈ {n}% busy at this time',
      dtEta: 'Forecast', etaIn: 'Should free up in about {min} min (charging here usually takes ≈ {typ} min)', etaSoon: 'May free up soon (charging here usually takes ≈ {typ} min)', etaOver: 'Busy longer than usual ({typ} min): may free up any minute',
      liveSource: 'Availability and prices: Eco-Movement via the Latvian national access point (CC0).',
      updAvail: 'A new version of the app is available', updGo: 'Update', verLine: 'Version {v}',
      fMax: 'Price up to…', fMaxN: 'up to {p} €', fGratis: 'Free', fDisc: 'Discounted', fIndoor: 'Indoor',
      routeEta: 'arrive ≈ {time}', routeOcc: 'usually ≈ {n}% busy by then', routeCharge: '{from}→80%: ≈ {min} min',
      routeSave: 'Save route', routeShare: 'Share', routeSaved: 'Saved routes', routeSavedDone: 'Route saved', routeDel: 'Delete', routeShareText: 'Route {from} → {to} with charging stops', routeSavedNone: '',
      garageNew: '+ Another car', carName: 'Name (optional)', garageFull: 'Up to 5 cars can be saved',
      mineTitle: 'My discounts', mineNote: 'Tick what you have: prices on the map, in lists and on station cards will include your discount.',
      priceMine: 'with your discount, {p} without', priceTou: 'night rate', dtMaxh: 'Entry height', dtIndoor: 'Location', indoorYes: 'indoors or in a car park',
      touNow: 'Night rate {price} € from {from}:00 to {to}:00 is on now, {left} left.', touSoon: 'Night rate {price} € from {from}:00 to {to}:00 starts in {left}.',
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
      tabRoute: 'Route', tabFav: 'Saved',
      estShort: '{from}→{to}%: {min} min · {cost} €', estShortNoCost: '{from}→{to}%: {min} min', estNoneShort: 'no connector for your car',
      fFree: 'Free now', fOpen: '24/7', fCard: 'Card', fCar: 'My car', cheapTip: 'lowest price nearby', allBusy: 'All busy', allBusyTip: 'all points busy',
      discTitle: 'Network discounts', discNote: 'Checked {date}. Terms change: confirm the exact ones in the network app.', discSrc: 'source', discPricesTitle: 'Discounts by network',
      carBtn: 'My car', carTitle: 'My car',
      carLead: 'Pick a model. Values are approximate, edit any of them to match your car.',
      carModel: 'Model', carKwh: 'Battery (usable), kWh', carDc: 'Max fast (DC), kW', carAc: 'Max AC, kW', carCons: 'Consumption, kWh/100 km',
      carConn: 'Car connectors', carOnly: 'Show compatible stations only',
      carPetrol: 'Petrol, €/l', carPetrolHint: 'empty = average 95 from Degvielas Radars', carPetrolCons: 'Petrol car consumption, l/100 km',
      carHome: 'Home, €/kWh', carHomeHint: 'optional',
      carSave: 'Save', carClear: 'Remove car', carClose: 'Close',
      carSet: 'Car: {name}',
      rangeLine: '{t} °C: range ≈ {km} km ({full} when warm)',
      rangeLineWarm: 'range at 100% ≈ {km} km',
      estTitle: 'My car here', estSpeed: 'Will take up to {kw} kW',
      estLine: 'Charging {from}→{to}%: ≈ {min} min · ≈ {cost} €',
      estLineNoCost: 'Charging {from}→{to}%: ≈ {min} min',
      estNone: 'This station has no connector your car can use.',
      estNote: 'An estimate: real speed depends on battery temperature and charge level.',
      cmpTitle: 'Cost of 100 km', cmpHere: 'Here', cmpHome: 'At home', cmpPetrol: 'Petrol',
      cmpSave: 'Cheaper than petrol by ≈ {eur} € per 100 km',
      cmpMore: 'More expensive than petrol by ≈ {eur} € per 100 km',
      cmpPetrolNote: '{l} l/100 km at {price} €/l',
      relGood: 'Works reliably', relMid: 'Some points are down at times ({pct}%)', relBad: 'Points are often down ({pct}%)',
      relNote: 'from {n} checks', relTitle: 'Reliability',
      fcLine: 'In an hour usually ≈ {n}% busy',
      priceUp: 'Price up {d} € since {date}', priceDown: 'Price down {d} € since {date}',
      favAdd: 'Save', favRemove: 'Saved', favEmpty: 'Nothing yet. Tap ★ on a station and it will appear here with live status.',
      favTitle: 'Saved stations',
      chargeTitle: 'Charging log', chargeAdd: '+ Log a charge', chargeKwh: 'kWh charged', chargeEur: 'Amount paid, €',
      chargeName: 'Where (optional)', chargeSave: 'Save', chargeCancel: 'Cancel',
      chargeBad: 'Enter kWh and the amount as numbers.',
      chargeEmpty: 'Nothing yet. Log a charge and the monthly totals will show up here.',
      chargeMonth: 'This month: {kwh} kWh · {eur} € · {n}', chargePrev: 'Last month: {kwh} kWh · {eur} €',
      chargeAvg: 'Average price: {p} €/kWh', chargeDel: 'Delete entry', chargeDelSure: 'Delete?',
      chargeHere: 'Log a charge here', chargeNote: 'Entries are stored on this phone only.',
      amenTitle: 'Nearby (≈100 m)', amenLoading: 'Looking for what is nearby…', amenNone: 'Nothing nearby is tagged in OpenStreetMap.',
      amenToilets: 'Toilet', amenFood: 'Cafe, food', amenShop: 'Shop', amenWifi: 'Wi-Fi', amenNote: 'From OpenStreetMap, may be incomplete.',
      share: 'Share', shareCopied: 'Link copied', shareText: 'Charging station: {name}',
      appleMaps: 'Apple Maps',
      watch: 'Watch', unwatch: 'Watching', watchOn: 'I will tell you when one frees up. Works while the app is open.',
      pushOn: 'I will tell you when one frees up: you will get a notification even when the app is closed.',
      pushDenied: 'Notifications are blocked in the browser settings, so I can only tell you while the app is open. Allow them in the site settings.',
      pushFail: 'Could not enable notifications for a closed app, so I can only tell you while it is open. Try again later.',
      watchNoLive: 'This station has no live status.',
      watchFreeNow: 'A free charger is already available.',
      watchFreed: 'Now free: {name}',
      pushIos: 'On iPhone, notifications while the app is closed only work if you add it to the Home Screen.',
      watchOff: 'Stopped watching',
      savTitle: 'Savings vs petrol', savMonth: 'This month', savYear: 'Year {y}', savAll: 'All time',
      savSaved: 'saved', savOver: 'more than petrol', savLine: 'drove ≈ {km} km, paid {paid} € instead of ≈ {petrol} €',
      savNote: 'Based on your car\'s consumption ({cons} kWh/100 km) and petrol at {l} l/100 km, {price} €/l. The petrol price is today\'s, so the figure is approximate.',
      csvBtn: 'Download log (CSV)', csvDone: 'Log saved to a file', csvFail: 'Could not save the file.',
      whenBest: 'Quietest around {h}:00 (usually ≈ {n}% busy), now ≈ {now}%',
      whenGood: 'Good moment to go: usually ≈ {n}% busy now',
      nearFree: 'Free nearby:', unitM: 'm',
      timerTitle: 'Timer: remind me at 80%', timerHint: 'Charge now:', timerBtn: '{soc}% · {min} min',
      timerSet: 'Timer set for {min} min. I will remind you at 80%.', timerSetPush: 'Timer set for {min} min. I will remind you at 80%, even when the app is closed.',
      timerActive: 'Timer: in {min} min', timerSoon: 'Timer: almost ready', timerCancel: 'Cancel', timerOff: 'Timer cancelled',
      timerDone: 'Charge to 80% is almost ready: {name}',
      digestBtn: 'Evening digest', digestOff: 'off', digestOn: 'I will send a digest of your saved stations at {h}:00.', digestStopped: 'Digest is off.',
      digestNoFav: 'Save some stations first (★): the digest covers them.',
      digestNoPush: 'The digest arrives as a notification, which is not available on this device.',
      digestHint: 'Once a day: what is free at your saved stations and when it is quieter.',
      searchPh: 'Name, address or network', searchClear: 'Clear search',
      routeFrom: 'From', routeTo: 'To', routeFromMine: 'My location', routeToPh: 'City or address',
      routeGo: 'Find stations', routeSoc: 'Charge at start, %',
      routeLen: 'Route {km} km, ≈ {h} driving',
      routeNoNeed: 'You can make it without charging: range ≈ {km} km.',
      routeStops: 'Charging stops', routeStop: 'Stop {n}',
      routeNoCar: 'Set your car and I will plan stops from its range. For now: stations along the route.',
      routeNoStart: 'No suitable fast stations along the route within your range. Try another car, charge level or detour.',
      routeNoNext: 'After the last stop there is no suitable fast station within range.',
      routeTooMany: 'Too many stops to plan. Split the route.',
      routeAlong: 'Fast stations along the route (best one per 10 km)', routeFail: 'Route not found. Check the address and your connection.',
      routeNotFound: 'Could not find that place. Be more specific.',
      routeClear: 'Clear route', routeEdit: 'Edit route', routeKm: 'at km {n}', routeOff: '{n} m off the road', routeOffKm: '{n} km off the road',
      routeArrive: 'arrive with {n}%', routeNoStations: 'No stations along the route match your filters.',
      routeWait: 'Finding a route…',
      baltics: 'Lithuania and Estonia: OpenStreetMap stations without live status.',
      loadingBalt: 'Loading stations…',
      sockType2: 'Type 2', sockCcs: 'CCS', sockChademo: 'CHAdeMO', sockTesla: 'Tesla',
      unitKw: 'kW', unitKwh: 'kWh', unitH: 'h', unitMin: 'min',
    },
  };
  // Латышский лежит в lang-lv.js (если файл не загрузился, показываем английский)
  I18N.lv = Object.assign({}, I18N.en, window.UR_LV || {});
  const LANGS = ['ru', 'en', 'lv'];
  const LOCALES = { ru: 'ru-RU', en: 'en-GB', lv: 'lv-LV' };

  // Язык: сохранённый выбор, иначе латышский для тех, у кого браузер на латышском, иначе русский
  let lang = (() => {
    const s = store.get('ur_lang');
    if (LANGS.includes(s)) return s;
    return /^lv\b/i.test((navigator.language || '')) ? 'lv' : 'ru';
  })();
  function t(key, vars) {
    let s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || I18N.ru[key] || key;
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
    patterns: null, // patterns.json: «когда обычно занято»
    stations: [], // результат слияния: их показываем
    liveError: false,
    origin: { lat: RIGA.lat, lon: RIGA.lon, real: false },
    filters: { connector: 'any', power: 'any', operator: 'all', freeNow: false, open247: false, cardPay: false, maxPrice: null, free: false, discount: false, indoor: false, mine: {}, tou: true, query: '', car: null },
    car: null, // профиль машины (logic.normalizeCar) или null
    prefs: { petrol: null, petrolCons: 7, home: null }, // бензин и домашний тариф
    petrol: null, // средняя цена 95 из Degvielas Radars
    tempC: null, // температура воздуха там, где человек
    favs: [], // избранное: [{ k, id, napId, lat, lon, name }]
    charges: [], // журнал зарядок: [{ id, ts, kwh, eur, name }]
    chargeForm: null, // открытая форма записи: { kwh, eur, name, error } или null
    chargeDelArm: null, // id записи, ждущей второго нажатия «Удалить?»
    amen: {}, // удобства рядом: ключ места -> { t, v: { toilets, food, shop, wifi } }
    watch: [], // слежение за станциями: [{ k, id, napId, lat, lon, name, free }]
    route: null, // построенный маршрут
    osmBy: {}, // станции OSM по странам
    priority: 'balanced',
    tab: 'go',
    detailId: null,
    theme: store.get('ur_theme') === 'light' ? 'light' : 'dark',
    status: null, // 'loading' | 'error' | 'stale' | null
    locating: false,
    geoDenied: false,
  };

  const $ = (id) => document.getElementById(id);

  /* ---------- загрузка станций (Overpass) ---------- */
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  // Страны: код ISO для запроса и рамка, по которой понимаем, что карту увели в другую страну.
  // Латвия грузится сразу, Литва и Эстония только когда на них смотрят или строят маршрут.
  const COUNTRIES = {
    LV: { bbox: [55.67, 20.97, 58.09, 28.24] },
    LT: { bbox: [53.89, 20.93, 56.45, 26.84] },
    EE: { bbox: [57.51, 21.76, 59.68, 28.21] },
  };
  const queryFor = (cc) =>
    '[out:json][timeout:90];area["ISO3166-1"="' + cc + '"][admin_level=2]->.a;(' +
    'node["amenity"="charging_station"](area.a);way["amenity"="charging_station"](area.a););out center tags;';
  const cacheKey = (cc) => 'ur_osm_' + cc + '_v2';
  const CACHE_TTL = 12 * 3600 * 1000;
  const loadingCountry = {};

  function readCache(cc) {
    const c = readJson(cacheKey(cc), null);
    return c && Array.isArray(c.stations) ? c : null;
  }

  // Спрашиваем все зеркала Overpass одновременно, берём первый хороший ответ.
  async function fetchElements(cc) { return overpass(queryFor(cc), 60000); }

  async function overpass(query, timeoutMs) {
    const controllers = [];
    const attempt = async (url) => {
      const ctl = new AbortController();
      controllers.push(ctl);
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
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
    state.osm = [].concat.apply([], Object.keys(state.osmBy).map((k) => state.osmBy[k]));
    state.stations = UR.mergeLive(state.osm, state.live, {});
    openPendingStation();
  }

  // Загрузка одной страны: сначала кэш, потом сеть. Возвращает true, если сеть ответила.
  async function loadCountry(cc, force) {
    if (loadingCountry[cc]) return false;
    loadingCountry[cc] = true;
    try {
      const cached = readCache(cc);
      if (cached) {
        state.osmBy[cc] = cached.stations;
        rebuildStations();
        quietRender = state.origin.real;
        renderAll();
        quietRender = false;
        if (!force && Date.now() - cached.t < CACHE_TTL) return true;
      }
      const main = cc === 'LV';
      if (main && !cached && !state.stations.length) setStatus('loading');
      try {
        const els = await fetchElements(cc);
        state.osmBy[cc] = els.map(UR.toStation).filter(Boolean);
        writeJson(cacheKey(cc), { t: Date.now(), stations: state.osmBy[cc] });
        rebuildStations();
        if (main) setStatus(null);
        return true;
      } catch (e) {
        // Overpass недоступен: если есть данные национальной точки доступа, приложение всё равно работает
        if (main) setStatus(state.stations.length ? (state.osm.length ? 'stale' : null) : 'error');
        return false;
      } finally {
        quietRender = state.origin.real;
        renderAll();
        quietRender = false;
      }
    } finally {
      loadingCountry[cc] = false;
    }
  }

  const loadStations = (force) => loadCountry('LV', force);

  // Какая страна под центром карты (для подгрузки Литвы и Эстонии)
  function countryAt(lat, lon) {
    for (const cc of Object.keys(COUNTRIES)) {
      const b = COUNTRIES[cc].bbox;
      if (lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3]) return cc;
    }
    return null;
  }
  let balticNoted = false;
  function onMapMoved() {
    if (!map || !map.getCenter) return;
    const c = map.getCenter();
    const cc = countryAt(c.lat, c.lng);
    if (cc && cc !== 'LV' && !state.osmBy[cc]) {
      if (!balticNoted) { balticNoted = true; toast(t('baltics')); }
      loadCountry(cc, false);
    }
  }


  /* ---------- моя машина, цены бензина, погода ---------- */
  function loadProfile() {
    const mine = readJson('ur_mine_v1', {});
    state.mine = {};
    for (const id of UR.mineOptions()) if (mine && mine[id] === true) state.mine[id] = true;
    state.filters.mine = state.mine;
    // Гараж: до пяти машин, одна активная. Старый ur_car_v1 с одной машиной подхватывается сам.
    const g = readJson('ur_garage_v1', null);
    let list = [];
    let idx = -1;
    if (g && Array.isArray(g.list)) {
      list = g.list.map((c) => UR.normalizeCar(c)).filter(Boolean).slice(0, 5);
      idx = Number.isInteger(g.idx) ? g.idx : 0;
    } else {
      const one = UR.normalizeCar(readJson('ur_car_v1', null));
      if (one) { list = [one]; idx = 0; }
    }
    if (idx >= list.length) idx = list.length - 1;
    state.garage = { list, idx };
    state.car = list[idx] || null;
    const p = readJson('ur_prefs_v1', {});
    const num = (v, lo, hi) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) && n >= lo && n <= hi ? n : null; };
    state.prefs = { petrol: num(p.petrol, 0.5, 5), petrolCons: num(p.petrolCons, 2, 25) || 7, home: num(p.home, 0.01, 2) };
    state.filters.car = state.car;
  }
  function saveProfile() {
    writeJson('ur_garage_v1', { list: state.garage.list, idx: state.garage.idx });
    writeJson('ur_car_v1', state.car); // дублируем активную: старые версии читают её
    writeJson('ur_prefs_v1', state.prefs);
    state.filters.car = state.car;
  }
  const rankCtx = () => ({ car: state.car, tempC: state.car ? state.tempC : null });
  const petrolPrice = () => state.prefs.petrol || state.petrol || 1.85;

  // Средняя цена бензина 95 из соседнего приложения Degvielas Radars (его отчёт открыт на GitHub)
  const FUEL_URL = 'https://raw.githubusercontent.com/digitalcreatorhub/degvievas-radars/main/data/report.json';
  async function loadFuel() {
    const c = readJson('ur_fuel_v1', null);
    if (c && isFinite(c.v)) state.petrol = c.v;
    if (c && Date.now() - c.t < 12 * 3600 * 1000) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch(FUEL_URL, { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const v = j && j.fuels && j.fuels['95'] && j.fuels['95'].avg;
      if (isFinite(v) && v > 0.5 && v < 5) {
        state.petrol = v;
        writeJson('ur_fuel_v1', { t: Date.now(), v });
        renderPanelQuiet();
      }
    } catch (e) { /* возьмём запасное значение */ } finally { clearTimeout(timer); }
  }

  // Температура воздуха нужна, чтобы честно считать запас хода на холоде. Спрашиваем, только если задана машина.
  async function loadWeather() {
    if (!state.car) return;
    const o = state.origin;
    const key = Math.round(o.lat * 2) + ',' + Math.round(o.lon * 2);
    const c = readJson('ur_temp_v1', null);
    if (c && c.key === key && Date.now() - c.t < 30 * 60 * 1000) { state.tempC = c.v; return; }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + o.lat.toFixed(2) + '&longitude=' + o.lon.toFixed(2) + '&current=temperature_2m', { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const v = j && j.current && j.current.temperature_2m;
      if (isFinite(v)) {
        state.tempC = v;
        writeJson('ur_temp_v1', { t: Date.now(), key, v });
        renderPanelQuiet();
      }
    } catch (e) { /* без поправки на холод */ } finally { clearTimeout(timer); }
  }
  function renderPanelQuiet() {
    quietRender = true;
    try { renderPanel(); } finally { quietRender = false; }
  }

  /* ---------- избранное и слежение ---------- */
  const refOf = (st) => ({ k: st.napId ? 'n:' + st.napId : 'o:' + st.id, id: st.id, napId: st.napId || null, lat: st.lat, lon: st.lon, name: stationTitle(st) });
  // Находим станцию по сохранённой ссылке: сначала по номеру, потом по месту (id при слиянии может смениться)
  function resolveRef(ref) {
    let st = ref.napId && state.stations.find((x) => x.napId === ref.napId);
    if (!st) st = state.stations.find((x) => x.id === ref.id);
    if (!st) {
      let best = null;
      for (const x of state.stations) {
        const d = UR.haversine(ref.lat, ref.lon, x.lat, x.lon);
        if (d < 0.1 && (!best || d < best.d)) best = { st: x, d };
      }
      st = best && best.st;
    }
    return st || null;
  }
  const isFav = (st) => state.favs.some((f) => f.k === refOf(st).k);
  function toggleFav(st) {
    const r = refOf(st);
    const i = state.favs.findIndex((f) => f.k === r.k);
    if (i >= 0) state.favs.splice(i, 1); else state.favs.unshift(r);
    writeJson('ur_favs_v1', state.favs);
    if (state.digest) pushSync(); // сводка идёт по избранным
  }
  const isWatched = (st) => state.watch.some((w) => w.k === refOf(st).k);

  async function askNotifyPermission() {
    try {
      if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    } catch (e) { /* не критично: останется сообщение внутри приложения */ }
  }
  function notifyUser(text, tag) {
    toast(text);
    try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) { /* без вибрации */ }
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then((reg) => reg.showNotification('Uzlādes Radars', { body: text, tag, icon: 'icons/icon-192.png' })).catch(() => new Notification('Uzlādes Radars', { body: text, tag }));
        } else new Notification('Uzlādes Radars', { body: text, tag });
      }
    } catch (e) { /* уведомление не получилось, сообщение в приложении уже показано */ }
  }

  async function toggleWatch(st) {
    const r = refOf(st);
    const i = state.watch.findIndex((w) => w.k === r.k);
    if (i >= 0) {
      state.watch.splice(i, 1);
      writeJson('ur_watch_v1', state.watch);
      toast(t('watchOff'));
      pushSync();
      return;
    }
    const sum = UR.liveSummary(st, null);
    if (!sum || !UR.isLiveFresh(state.live)) { toast(t('watchNoLive')); return; }
    await askNotifyPermission();
    state.watch.push(Object.assign(r, { free: sum.free }));
    writeJson('ur_watch_v1', state.watch);
    if (PUSH.api && isIosBrowserTab()) { toast(t('pushIos')); pushSync(); return; } // iPhone во вкладке Safari: пуши невозможны, говорим как включить
    const res = await pushSync();
    const base = sum.free > 0 ? t('watchFreeNow') : res === 'on' ? t('pushOn') : res === 'denied' ? t('pushDenied') : res === 'error' ? t('pushFail') : t('watchOn');
    toast(base);
  }

  /* ---------- таймер «зарядка до 80%» и вечерняя сводка ---------- */
  const saveTimers = () => writeJson('ur_timers_v1', state.timers);
  const timerFor = (st) => state.timers.find((x) => x.k === refOf(st).k) || null;
  const DIGEST_HOURS = [17, 19, 21];

  async function startTimer(st, soc) {
    const kw = state.car && UR.carPowerKw(state.car, st);
    const e = kw ? UR.chargeEstimate(state.car, kw, null, soc, 80) : null;
    if (!e || !e.minutes) return;
    await askNotifyPermission();
    const r = refOf(st);
    state.timers = state.timers.filter((x) => x.k !== r.k);
    state.timers.push({ id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), at: Date.now() + e.minutes * 60000, name: stationTitle(st), k: r.k });
    state.timers = state.timers.slice(-5);
    saveTimers();
    const res = await pushSync();
    toast(t(res === 'on' ? 'timerSetPush' : 'timerSet', { min: e.minutes }));
  }
  function cancelTimer(st) {
    const r = refOf(st);
    state.timers = state.timers.filter((x) => x.k !== r.k);
    saveTimers();
    toast(t('timerOff'));
    pushSync();
  }
  // Приложение открыто: напоминаем сами (пуш придёт и при закрытом, а метка у них общая, поэтому не задвоится)
  function checkTimers() {
    const now = Date.now();
    const due = state.timers.filter((x) => x.at <= now);
    if (!due.length) return;
    state.timers = state.timers.filter((x) => x.at > now);
    saveTimers();
    for (const x of due) if (now - x.at < 10 * 60000) notifyUser(t('timerDone', { name: x.name }), 'timer:' + x.id);
    pushSync();
    if (state.detailId) renderPanel();
  }
  setInterval(checkTimers, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkTimers(); });

  async function cycleDigest() {
    const cur = state.digest ? DIGEST_HOURS.indexOf(state.digest.hour) : -1;
    const next = cur + 1 < DIGEST_HOURS.length ? DIGEST_HOURS[cur + 1] : null;
    if (next != null && !state.favs.some((f) => f.napId)) { toast(t('digestNoFav')); return; }
    if (next != null && !pushSupported()) { toast(t('digestNoPush')); return; }
    state.digest = next == null ? null : { hour: next };
    writeJson('ur_digest_v1', state.digest);
    if (next != null) {
      if (isIosBrowserTab()) toast(t('pushIos')); else {
        await askNotifyPermission();
        const res = await pushSync();
        toast(res === 'denied' ? t('pushDenied') : res === 'on' ? t('digestOn', { h: next }) : t('pushFail'));
      }
    } else { pushSync(); toast(t('digestStopped')); }
    renderPanel();
  }

  /* ---------- пуши при закрытом приложении ---------- */
  // Адрес Worker лежит в push-config.json (пусто, пока сервер не выложен: тогда работают только уведомления при открытом приложении)
  const PUSH = { api: null };
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIosBrowserTab = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));

  async function loadPushConfig() {
    try {
      const res = await fetch('push-config.json', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      if (j && typeof j.api === 'string' && /^https:\/\/[^\s]+$/.test(j.api)) PUSH.api = j.api.replace(/\/+$/, '');
    } catch (e) { /* без конфига пуши просто выключены */ }
  }

  const b64urlToBytes = (b64) => {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const bytesToB64url = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function pushPost(path, body) {
    const res = await fetch(PUSH.api + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  }

  // Приводит сервер в соответствие со списком слежения на телефоне. Лучшее усилие: при любой ошибке остаются уведомления при открытом приложении.
  // Возвращает итог: 'on' (телефон подписан), 'off' (пуши не настроены или не поддерживаются), 'denied' (уведомления запрещены), 'none' (следить не за чем), 'error'.
  async function pushSync() {
    try {
      if (!PUSH.api || !pushSupported()) return 'off';
      if (Notification.permission !== 'granted') return Notification.permission === 'denied' ? 'denied' : 'off';
      const reg = await navigator.serviceWorker.ready;
      const items = state.watch.filter((w) => w.napId).map((w) => ({ napId: w.napId, name: w.name, free: Number.isInteger(w.free) ? w.free : null }));
      const timers = state.timers.map((x) => ({ id: x.id, at: x.at, name: x.name }));
      const favs = state.digest ? state.favs.filter((f) => f.napId).slice(0, 10).map((f) => ({ napId: f.napId, name: f.name })) : [];
      const digest = favs.length ? { hour: state.digest.hour, favs } : null;
      let sub = await reg.pushManager.getSubscription();
      if (!items.length && !timers.length && !digest) {
        if (sub) { try { await pushPost('/unsubscribe', { endpoint: sub.endpoint }); } catch (e) { /* сервер сам забудет через 60 дней */ } await sub.unsubscribe(); }
        return 'none';
      }
      const vres = await fetch(PUSH.api + '/vapid');
      if (!vres.ok) return 'error';
      const key = (await vres.json()).key;
      if (!key) return 'error';
      // ключи сервера сменились: старая подписка не подойдёт
      if (sub && sub.options && sub.options.applicationServerKey && bytesToB64url(sub.options.applicationServerKey) !== key) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) });
      const j = sub.toJSON();
      await pushPost('/sync', { sub: { endpoint: j.endpoint, keys: j.keys }, lang, watch: items, timers, digest });
      return 'on';
    } catch (e) { return 'error'; /* повторим при следующем изменении или открытии */ }
  }

  // После каждого обновления статуса: была ли занята вся станция, а теперь есть свободная
  function checkWatches() {
    if (!state.watch.length || !state.live || !UR.isLiveFresh(state.live)) return;
    let changed = false;
    for (const w of state.watch) {
      const st = resolveRef(w);
      const sum = st && UR.liveSummary(st, null);
      if (!sum) continue;
      if (w.free === 0 && sum.free > 0) notifyUser(t('watchFreed', { name: w.name }), 'watch-' + w.k);
      if (w.free !== sum.free) { w.free = sum.free; changed = true; }
    }
    if (changed) writeJson('ur_watch_v1', state.watch);
  }

  /* ---------- ссылки: станция, вкладка, ярлыки ---------- */
  const params = new URLSearchParams(location.search);
  state.pending = { st: params.get('st'), go: params.get('go'), tab: params.get('tab'), rf: params.get('rf'), rt: params.get('rt'), rs: params.get('rs') };
  // Метки с мощностью (как в Chargemap): включаются ссылкой ?pills=1, выключаются ?pills=0, дальше запоминается
  if (params.get('pills') === '1' || params.get('pills') === '0') writeJson('ur_pills_v1', params.get('pills') === '1');
  state.pills = readJson('ur_pills_v1', false) === true;
  function stationUrl(st) {
    return location.origin + location.pathname + '?st=' + encodeURIComponent(st.napId || st.id);
  }
  // Станция из ссылки открывается, как только она появилась в данных. Один раз.
  function openPendingStation() {
    const p = state.pending;
    if (!p || !p.st) return;
    const st = state.stations.find((x) => x.napId === p.st || x.id === p.st);
    if (!st) return;
    p.st = null;
    setTimeout(() => { openDetail(st.id, true); setSheetOpen(true); }, 0);
  }
  async function shareStation(st) {
    const url = stationUrl(st);
    const text = t('shareText', { name: stationTitle(st) });
    try {
      if (navigator.share) { await navigator.share({ title: 'Uzlādes Radars', text, url }); return; }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(t('shareCopied'));
    } catch (e) {
      toast(url);
    }
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
    checkWatches();
    quietRender = !!quiet || state.origin.real;
    renderAll();
    quietRender = false;
    applyShortcut();
    if (state.status === 'error' && state.stations.length) setStatus(null);
  }

  // «Когда обычно занято»: файл меняется медленно, грузим при запуске и изредка обновляем. Нет файла: просто нет графика.
  const PATTERNS_URL = 'https://raw.githubusercontent.com/digitalcreatorhub/Uzlades-radars/live/patterns.json';
  let patternsLoadedAt = 0;
  async function loadPatterns() {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(PATTERNS_URL, { signal: ctl.signal, cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || typeof data.sites !== 'object') throw new Error('bad patterns.json');
      state.patterns = data;
      patternsLoadedAt = Date.now();
      quietRender = true;
      try { renderPanel(); } finally { quietRender = false; }
    } catch (e) { /* без графика обойдёмся */ } finally { clearTimeout(timer); }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - patternsLoadedAt > 30 * 60 * 1000) loadPatterns();
    if (document.visibilityState === 'visible' && Date.now() - liveLoadedAt > 2 * 60 * 1000) loadLive(true);
  });
  setInterval(() => { if (document.visibilityState === 'visible') loadLive(true); }, LIVE_REFRESH_MS);

  /* ---------- карта ---------- */
  let map, tiles, markerLayer, routeLayer, youMarker, youCircle;
  const markers = new Map();

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  const classColor = (cls) => cssVar('--c-' + cls) || cssVar('--c-unknown');

  function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: false, preferCanvas: true }).setView([RIGA.lat, RIGA.lon], 12);
    L.control.zoom({ position: 'topright' }).addTo(map);
    // подпись источника карты нельзя прятать; снизу её закрывает панель, поэтому она сверху слева
    if (L.control.attribution) L.control.attribution({ position: 'topleft', prefix: false }).addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    if (map.on) map.on('moveend', onMapMoved);
    if (map.on) map.on('zoomend', () => { if (lastMarkerList.length) renderMarkers(lastMarkerList); });
    // Что на экране, то и сравниваем: после сдвига карты пересчитываем самые дешёвые станции и перерисовываем, только если набор изменился
    let moveTimer = null;
    if (map.on) map.on('moveend', () => {
      if (!lastMarkerList.length) return;
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        const key = alertKey(lastMarkerList, pillSet(lastMarkerList));
        if (state.pills || key !== lastCheapKey) renderMarkers(lastMarkerList);
      }, 250);
    });
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

  let lastMarkerList = [];
  // Станции, что сейчас в кадре, ближайшие к центру карты (не больше max)
  function viewCandidates(list, max) {
    let cand = list;
    if (map && map.getBounds) {
      const b = map.getBounds();
      if (b && b.contains) cand = list.filter((st) => b.contains([st.lat, st.lon]) || st.id === state.detailId);
    }
    const c = map && map.getCenter ? map.getCenter() : null;
    if (c) {
      const d2 = (st) => (st.lat - c.lat) * (st.lat - c.lat) + ((st.lon - c.lng) * Math.cos((c.lat * Math.PI) / 180)) ** 2;
      cand = cand.slice().sort((a, b) => (a.id === state.detailId ? -1 : b.id === state.detailId ? 1 : d2(a) - d2(b)));
    }
    return cand.slice(0, max);
  }

  // Какие станции рисуем «выносками» (скрытый режим ?pills=1): только при достаточном приближении, не больше N ближайших к центру
  function pillSet(list) {
    if (!state.pills || !map || !map.getZoom) return new Set();
    const z = map.getZoom();
    if (z < 11) return new Set();
    return new Set(viewCandidates(list, z >= 15 ? 140 : z >= 13 ? 90 : 50).map((st) => st.id));
  }

  // Самые дешёвые станции среди тех, что в кадре (от масштаба 11): у них переливающийся зелёный ободок
  let lastCheapKey = '';
  const alertKey = (list, pillIds) => [...cheapSet(list, pillIds)].sort().join(',') + '|' + [...busySet(list, pillIds)].sort().join(',');
  // Станции, где заняты все точки: красный ободок, «все заняты» вместо кВт (от масштаба 11, не больше 30 ближайших)
  function busySet(list, pillIds) {
    if (!map || !map.getZoom || map.getZoom() < 11) return new Set();
    const cand = pillIds && pillIds.size ? list.filter((st) => pillIds.has(st.id)) : viewCandidates(list, 150);
    return UR.busyIds(cand, state.filters, 30);
  }
  function cheapSet(list, pillIds) {
    if (!map || !map.getZoom || map.getZoom() < 11) return new Set();
    const cand = pillIds && pillIds.size ? list.filter((st) => pillIds.has(st.id)) : viewCandidates(list, 150);
    return UR.cheapestIds(cand, state.filters, 6);
  }

  // Ярлык вместо точки: у самой дешёвой станции (kind 'cheap') кВт сменяются ценой, у станции, где заняты все точки (kind 'busy'), надписью «Все заняты»
  function cheapDotHtml(st, level, selected, kind) {
    const kw = (st.kw ? Math.round(st.kw) : '?') + ' ' + t('unitKw');
    let alt = '';
    if (kind === 'busy') alt = t('allBusy');
    else {
      const p = UR.priceOf(st, state.filters);
      alt = p && isFinite(p.mid) ? fmtEur(p.mid) + ' €' : '';
    }
    return '<span class="cd cd-' + esc(st.cls) + ' lv-' + level + (kind === 'busy' ? ' bz' : '') + (selected ? ' sel' : '') + '"><i class="cd-a">' + esc(kw) + '</i>' + (alt ? '<i class="cd-b">' + esc(alt) + '</i>' : '') + '</span>';
  }

  const PLUG_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="4" fill="#123a63"/><circle cx="8" cy="8" r="3.4" fill="none" stroke="#cfe8ff" stroke-width="1.5"/><circle cx="8" cy="8" r="1" fill="#cfe8ff"/></svg>';
  function pillHtml(st, sum, level, selected, cheap) {
    const kw = st.kw ? String(Math.round(st.kw)) : '?';
    const unit = t('unitKw');
    const cnt = sum && sum.total ? '<div class="pc"><b>' + (level === 'out' ? '–' : sum.free) + '</b>/' + sum.total + '</div>' : '';
    return '<span class="pl lv-' + level + (selected ? ' sel' : '') + (cheap ? ' cheap' : '') + '"><span class="pw"><span><b>' + kw + '</b> <em>' + unit + '</em></span>' + PLUG_SVG + '</span>' + cnt + '</span>';
  }

  function renderMarkers(list) {
    lastMarkerList = list;
    markerLayer.clearLayers();
    markers.clear();
    const stroke = cssVar('--bg');
    const okColor = cssVar('--ok');
    const textColor = cssVar('--text');
    const pillIds = pillSet(list);
    const cheapIds = cheapSet(list, pillIds);
    const busyIds = busySet(list, pillIds);
    lastCheapKey = alertKey(list, pillIds);
    for (const st of list) {
      const selected = st.id === state.detailId;
      const sum = UR.liveSummary(st, state.filters);
      const level = sum ? sum.level : 'unknown';
      if (pillIds.has(st.id)) {
        const pm = L.marker([st.lat, st.lon], {
          icon: L.divIcon({ className: 'ppill', html: pillHtml(st, sum, level, selected, cheapIds.has(st.id)), iconSize: [0, 0] }),
          zIndexOffset: selected ? 1000 : level === 'free' ? 500 : 0,
          title: stationTitle(st) + (cheapIds.has(st.id) ? ' · ' + t('cheapTip') : ''),
          keyboard: true,
        });
        pm.on('click', () => openDetail(st.id, false));
        pm.addTo(markerLayer);
        markers.set(st.id, pm);
        continue;
      }
      // свободно: зелёная рамка и мягкое свечение; все заняты: тусклая метка; не работает: ещё бледнее
      const ring = level === 'free' ? okColor : stroke;
      const zoomed = !map || !map.getZoom || map.getZoom() >= 12;
      if (zoomed && (selected || level === 'free')) {
        // ореол под меткой: свечение у свободных и выбранной станции
        L.circleMarker([st.lat, st.lon], {
          radius: selected ? 20 : 15,
          weight: 0,
          fillColor: selected ? textColor : okColor,
          fillOpacity: selected ? 0.2 : 0.2,
          interactive: false,
          halo: true,
        }).addTo(markerLayer);
      }
      const alertKind = busyIds.has(st.id) ? 'busy' : cheapIds.has(st.id) ? 'cheap' : null;
      if (alertKind) {
        const cm = L.marker([st.lat, st.lon], {
          icon: L.divIcon({ className: 'cdot', html: cheapDotHtml(st, level, selected, alertKind), iconSize: [0, 0] }),
          zIndexOffset: alertKind === 'cheap' ? 400 : 200,
          title: stationTitle(st) + ' · ' + t(alertKind === 'busy' ? 'allBusyTip' : 'cheapTip'),
          keyboard: true,
        });
        cm.on('click', () => openDetail(st.id, false));
        cm.addTo(markerLayer);
        markers.set(st.id, cm);
        continue;
      }
      const m = L.circleMarker([st.lat, st.lon], {
        radius: selected ? 11 : zoomed ? 8 : 5,
        weight: selected ? 3 : level === 'free' ? 3 : 2,
        color: selected ? textColor : ring,
        fillColor: classColor(st.cls),
        fillOpacity: level === 'out' ? 0.3 : level === 'busy' ? 0.55 : 1,
      });
      m.on('click', () => openDetail(st.id, false));
      m.addTo(markerLayer);
      markers.set(st.id, m);
    }
    if (youMarker) youMarker.remove();
    if (youCircle) youCircle.remove();
    youMarker = youCircle = null;
    if (state.origin.real) {
      const acc = state.origin.accuracy;
      // круг точности GPS: честно показывает, насколько можно верить метке (слишком грубые не рисуем)
      if (acc && acc >= 15 && acc < 3000) {
        youCircle = L.circle([state.origin.lat, state.origin.lon], {
          radius: acc, weight: 1, color: cssVar('--you'), fillColor: cssVar('--you'), fillOpacity: 0.1, interactive: false,
        }).addTo(map);
      }
      youMarker = L.circleMarker([state.origin.lat, state.origin.lon], {
        radius: 7, weight: 3, color: cssVar('--bg'), fillColor: cssVar('--you'), fillOpacity: 1, interactive: false,
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

  function originText() {
    if (state.origin.real) {
      const a = state.origin.accuracy;
      return a ? t('yourPlace', { acc: t('accM', { n: Math.round(a) }) }) : t('fromYou');
    }
    return state.geoDenied ? t('locDeniedLine') : t('fromCenter');
  }

  // Плашки «как оплатить». Для неизвестного ничего не рисуем: выдумывать способ оплаты нельзя.
  function payChips(st, withLabel) {
    if (!st.pay || !st.pay.length) return '';
    // в тесной карточке на карте короткие подписи, в «Подробнее» полные
    const names = withLabel ? { app: 'payAppShort', rfid: 'payRfidShort', card: 'payCardShort' } : { app: 'payApp', rfid: 'payRfid', card: 'payCard' };
    const chips = st.pay.filter((k) => names[k]).map((k) => '<span class="chip-pay chip-pay-' + k + '">' + esc(t(names[k])) + '</span>').join('');
    if (!chips) return '';
    return '<div class="pay">' + (withLabel ? '<span class="pay-label">' + esc(t('payShort')) + '</span>' : '') + chips + '</div>';
  }

  // «занята с 12:40»: когда статус точки сменился. Старше суток не показываем: смысла мало.
  function sinceText(p) {
    if (!p.u || (p.s !== 'busy' && p.s !== 'out')) return '';
    const ms = p.u * 60000;
    const age = Date.now() - ms;
    if (age < 0 || age > 24 * 3600 * 1000) return '';
    const d = new Date(ms);
    const sameDay = d.toDateString() === new Date().toDateString();
    const time = (sameDay ? '' : String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + ' ') + fmtTime(ms);
    return t(p.s === 'busy' ? 'busySince' : 'outSince', { time });
  }

  // Свежий статус и у лучшей станции он есть: время обновления показываем рядом с бейджем, отдельная строка не нужна
  function liveFreshForBest(ranked) {
    return !!(state.live && UR.isLiveFresh(state.live) && ranked.length && ranked[0].live);
  }

  // Когда освободится занятая станция: по тому, сколько такие зарядки на этой площадке обычно длятся (patterns.dur). Только если заняты все точки.
  function etaText(st) {
    const sum = UR.liveSummary(st, state.filters);
    if (!sum || sum.level !== 'busy') return '';
    const e = UR.freeEta(st, state.patterns);
    if (!e) return '';
    if (e.over) return t('etaOver', { typ: e.typical });
    if (e.min < 5) return t('etaSoon', { typ: e.typical });
    return t('etaIn', { min: Math.round(e.min / 5) * 5, typ: e.typical });
  }

  function usualLine(st) {
    const pat = UR.patternFor(st, state.patterns);
    return pat && pat.now >= 0 ? '<div class="usual-line">' + esc(t('usualLine', { n: pat.now })) + '</div>' : '';
  }

  // График «когда обычно занято» по часам: только если накоплено достаточно замеров
  function usualChart(st) {
    const pat = UR.patternFor(st, state.patterns);
    if (!pat) return '';
    const bars = pat.hours.map((v, h) => {
      const cls = v < 0 ? 'na' : v < 35 ? 'lo' : v < 65 ? 'mid' : 'hi';
      const label = String(h).padStart(2, '0') + ':00 ' + (v < 0 ? '–' : v + '%');
      return '<i class="' + cls + (h === pat.hour ? ' cur' : '') + '" style="height:' + (v < 0 ? 6 : Math.max(8, v)) + '%" title="' + esc(label) + '"></i>';
    }).join('');
    const since = pat.since ? pat.since.split('-').reverse().join('.') : '';
    return (
      '<div class="usual"><div class="usual-head"><b>' + esc(t('usualTitle')) + '</b><span>' + esc(t(pat.weekend ? 'usualWeekend' : 'usualWeekday')) + '</span></div>' +
      '<div class="bars" role="img" aria-label="' + esc(t('usualTitle')) + '">' + bars + '</div>' +
      '<div class="axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>' +
      '<p class="note">' + (pat.now >= 0 ? esc(t('usualNow', { n: pat.now })) : '') + (since ? ' · ' + esc(t('usualSince', { date: since })) : '') + '</p></div>'
    );
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
      (isApple && !withDetails ? '<a class="btn" href="https://maps.apple.com/?daddr=' + st.lat + ',' + st.lon + '&dirflg=d" target="_blank" rel="noopener">' + esc(t('appleMaps')) + '</a>' : '') +
      (withDetails ? '<button class="btn" data-detail="' + esc(st.id) + '">' + esc(t('details')) + '</button>' : '') +
      '</div>'
    );
  }


  /* ---------- значки ---------- */
  const SVG = (inner, fill) => '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="' + (fill || 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  const ICON = {
    star: SVG('<path d="M12 3.3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17.2 6.6 20.1l1-6.1L3.2 9.7l6.1-.9z"/>'),
    share: SVG('<path d="M12 15V3M8 7l4-4 4 4M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7"/>'),
    bell: SVG('<path d="M6 17h12l-1.6-2.1V11a4.4 4.4 0 00-8.8 0v3.9zM10 20.5h4"/>'),
    car: SVG('<path d="M4.5 16v-3.6l1.9-4.6A2 2 0 018.3 6.5h7.4a2 2 0 011.9 1.3l1.9 4.6V16M3 16h18M7 16v2.2M17 16v2.2M7.5 12.6h.01M16.5 12.6h.01"/>'),
    search: SVG('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    close: SVG('<path d="M6 6l12 12M18 6L6 18"/>'),
  };
  const STAR_FILLED = (on) => (on ? ICON.star.replace('fill="none"', 'fill="currentColor"') : ICON.star);

  /* ---------- вкладки ---------- */
  const filtered = () => UR.applyFilters(state.stations, state.filters);
  const stationById = (id) => state.stations.find((x) => x.id === id);

  function favButton(st, cls) {
    const on = isFav(st);
    return '<button class="' + (cls || 'icon-btn') + '" data-fav="' + esc(st.id) + '" aria-pressed="' + on + '" aria-label="' + esc(t(on ? 'favRemove' : 'favAdd')) + '">' + STAR_FILLED(on) + (cls === 'tool' ? '<span>' + esc(t(on ? 'favRemove' : 'favAdd')) + '</span>' : '') + '</button>';
  }

  // Строка про машину и запас хода: видна на главной вкладке, если задана машина
  function carLine() {
    if (!state.car) return '';
    const warm = UR.rangeKm(state.car, 100, 20);
    const now = UR.rangeKm(state.car, 100, state.tempC);
    const cold = state.tempC != null && state.tempC < 12;
    const text = cold ? t('rangeLine', { t: String(Math.round(state.tempC)).replace('-', '−'), km: now, full: warm }) : t('rangeLineWarm', { km: now });
    return '<button class="car-line" data-act="car">' + ICON.car + '<span><b>' + esc(state.car.name) + '</b> · ' + esc(text) + '</span></button>';
  }

  // Короткая подпись под ценой в карточке: с машиной это зарядка 20→80%, без неё стоимость 100 км хода
  function priceCaption(best) {
    if (state.car) {
      if (best.incompatible) return t('estNoneShort');
      const e = UR.chargeEstimate(state.car, best.kwCar, best.price, 20, 80);
      if (e) return e.cost != null ? t('estShort', { from: 20, to: 80, min: e.minutes, cost: fmtEur(e.cost) }) : t('estShortNoCost', { from: 20, to: 80, min: e.minutes });
    }
    return best.minutes ? t('per100Time', { eur: fmtEur(best.costPer100), n: best.minutes }) : t('per100Short', { eur: fmtEur(best.costPer100) });
  }

  function renderGo() {
    const list = filtered();
    const ranked = UR.rank(list, state.origin, state.priority, state.filters, rankCtx());
    const prios = [['balanced', 'prioBalanced'], ['cheap', 'prioCheap'], ['near', 'prioNear']];
    let html =
      '<div class="seg" role="group">' +
      prios.map(([id, key]) => '<button data-prio="' + id + '" aria-pressed="' + (state.priority === id) + '">' + esc(t(key)) + '</button>').join('') +
      '</div>' +
      '<div class="origin-line"><span>' + esc(originText()) + '</span>' +
      '<button class="link-btn" id="btn-locate">' + esc(state.locating ? t('locating') : t('locate')) + '</button></div>' +
      carLine() +
      (liveNote() && !liveFreshForBest(ranked) ? '<div class="live-note">' + esc(liveNote()) + '</div>' : '');

    if (!ranked.length) {
      html += '<p class="empty">' + esc(state.stations.length ? t('noResults') : state.status === 'loading' ? t('loading') : '') + '</p>';
      $('panel').innerHTML = html;
      return;
    }

    const best = ranked[0];
    const st = best.st;
    html +=
      '<article class="best">' +
      '<div class="best-head"><div class="best-title"><h2>' + esc(stationTitle(st)) + '</h2><div class="sub">' + esc(stationSub(st)) + '</div>' +
      (best.live ? '<div class="live-line">' + livePill(best.live) + (state.live && UR.isLiveFresh(state.live) ? ' <span class="live-time">' + esc(t('liveUpd', { time: fmtTime(UR.liveTime(state.live)) })) + '</span>' : '') + '</div>' : '') + '</div>' +
      '<div class="best-side">' + gauge(st, true) + favButton(st) + '</div></div>' +
      '<div class="facts">' +
      '<div><b>' + esc(fmtKm(best.distKm)) + ' ' + esc(t('unitKm')) + '</b><span>' + esc(t(state.origin.real ? 'fromYouShort' : 'fromCenterShort')) + '</span></div>' +
      '<div>' + (best.price
        ? '<b>' + fmtRange(best.price) + ' ' + esc(t('perKwh')) + '</b><span>' + esc(priceCaption(best)) + (best.price.mine ? ' · ' + esc(t('priceMine', { p: fmtEur(best.price.listMid) + ' €' })) : best.price.tou ? ' · ' + esc(t('priceTou')) : '') + '</span>'
        : '<b>' + esc(t('priceUnknown')) + '</b>') + '</div>' +
      '</div>' + payChips(st, true) + (etaText(st) ? '<div class="usual-line eta-line">' + esc(etaText(st)) + '</div>' : '') + usualLine(st) + navLinks(st, true) +
      '</article>';

    const more = ranked.slice(1, 4);
    if (more.length) {
      html += '<h3 class="sect">' + esc(t('alsoGood')) + '</h3><div class="rows">' + more.map(rowHtml).join('') + '</div>';
    }
    $('panel').innerHTML = html;
    focusStation(st);
  }

  function rowHtml(r) {
    const st = r.st;
    const rel = UR.reliabilityOf(st, state.patterns);
    const warn = rel && rel.level === 'bad' ? ' <span class="warn" title="' + esc(t('relBad', { pct: rel.pct })) + '">⚠</span>' : '';
    return (
      '<button class="row" data-detail="' + esc(st.id) + '">' + gauge(st, false) +
      '<span class="main"><span class="title" style="display:block">' + (isFav(st) ? '<span class="fav-mark">★</span> ' : '') + esc(stationTitle(st)) + warn + '</span>' +
      '<span class="meta" style="display:block">' + esc(stationSub(st)) + '</span>' +
      (r.live ? '<span class="live-line" style="display:block">' + livePill(r.live) + '</span>' : '') + '</span>' +
      '<span class="side">' + esc(fmtKm(r.distKm)) + ' ' + esc(t('unitKm')) +
      '<small>' + (r.price ? fmtRange(r.price) + ' ' + esc(t('perKwh')) : esc(t('priceUnknown'))) + '</small></span></button>'
    );
  }

  // Список «Рядом»: поиск остаётся на месте, а строки перерисовываются отдельно (клавиатура не закрывается)
  function listBodyHtml() {
    const ranked = UR.rank(filtered(), state.origin, 'near', state.filters, rankCtx());
    if (!ranked.length) return { count: 0, html: '<p class="empty">' + esc(state.stations.length ? t('noResults') : state.status === 'loading' ? t('loading') : '') + '</p>' };
    return { count: ranked.length, html: '<div class="rows">' + ranked.slice(0, 80).map(rowHtml).join('') + '</div>' };
  }
  function renderListBody() {
    const body = $('list-body');
    if (!body) return;
    const r = listBodyHtml();
    body.innerHTML = r.html;
    const c = $('list-count');
    if (c) c.textContent = t('count', { n: r.count });
  }

  function renderList() {
    const ops = UR.OPERATORS.map((o) => [o.id, o.name]).concat([['other', t('otherNet')]]);
    const options = [['all', t('allOperators')]].concat(ops)
      .map(([id, name]) => '<option value="' + id + '"' + (state.filters.operator === id ? ' selected' : '') + '>' + esc(name) + '</option>').join('');
    const r = listBodyHtml();
    $('panel').innerHTML =
      '<div class="search">' + ICON.search +
      '<input id="q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + esc(t('searchPh')) + '" value="' + esc(state.filters.query) + '">' +
      '<button class="search-x" id="q-clear" aria-label="' + esc(t('searchClear')) + '"' + (state.filters.query ? '' : ' hidden') + '>' + ICON.close + '</button></div>' +
      '<div class="list-tools"><select id="sel-operator" aria-label="' + esc(t('operator')) + '">' + options + '</select>' +
      '<span class="count" id="list-count">' + esc(t('count', { n: r.count })) + '</span></div>' +
      '<div id="list-body">' + r.html + '</div>';
  }

  function renderFav() {
    const refs = state.favs.map((f) => resolveRef(f)).filter(Boolean);
    let html = '<h3 class="sect">' + esc(t('favTitle')) + '</h3>';
    if (PUSH.api && pushSupported()) {
      html += '<button type="button" class="digest-btn" data-act="digest" aria-pressed="' + !!state.digest + '"><span>' + ICON.bell + esc(t('digestBtn')) + '</span><b>' + esc(state.digest ? state.digest.hour + ':00' : t('digestOff')) + '</b></button><p class="note digest-note">' + esc(t('digestHint')) + '</p>';
    }
    if (!refs.length) {
      html += '<p class="empty">' + esc(t('favEmpty')) + '</p>';
    } else {
      const neutral = Object.assign({}, state.filters, { connector: 'any', power: 'any', operator: 'all', freeNow: false, open247: false, cardPay: false, maxPrice: null, free: false, discount: false, indoor: false, query: '' });
      const ranked = UR.rank(refs, state.origin, 'near', neutral, rankCtx());
      html += '<div class="rows">' + ranked.map(rowHtml).join('') + '</div>';
    }
    $('panel').innerHTML = html + chargeLogHtml();
  }

  /* ---------- журнал зарядок ---------- */
  const saveCharges = () => writeJson('ur_charges_v1', state.charges);
  const fmtNum = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
  const fmtDay = (ts) => new Date(ts).toLocaleDateString(LOCALES[lang] || 'en-GB', { timeZone: 'Europe/Riga', day: '2-digit', month: '2-digit' });

  // Экономия против бензина: за месяц, год и всё время
  function savingsHtml(list) {
    const cons = state.car ? state.car.cons : 17;
    const s = UR.savingsStats(list, { cons, petrolPrice: petrolPrice(), petrolCons: state.prefs.petrolCons });
    if (!s || !s.all.count) return '';
    const cell = (label, x) => {
      if (!x.count) return '';
      const pos = x.saved >= 0;
      return '<div class="sav-cell ' + (pos ? 'pos' : 'neg') + '"><span>' + esc(label) + '</span><b>' + (pos ? '' : '−') + esc(fmtEur(Math.abs(x.saved))) + ' €</b><small>' + esc(t(pos ? 'savSaved' : 'savOver')) + '</small></div>';
    };
    const cells = cell(t('savMonth'), s.month) + cell(t('savYear', { y: s.y }), s.year) + (s.all.count > s.year.count ? cell(t('savAll'), s.all) : '');
    return '<div class="sav"><div class="sav-head"><b>' + esc(t('savTitle')) + '</b></div><div class="sav-grid">' + cells + '</div>' +
      '<p class="sav-line">' + esc(t('savLine', { km: s.year.count ? s.year.km : s.all.km, paid: fmtEur(s.year.count ? s.year.eur : s.all.eur), petrol: fmtEur(s.year.count ? s.year.petrol : s.all.petrol) })) + '</p>' +
      '<small>' + esc(t('savNote', { cons: String(cons).replace('.', ','), l: String(state.prefs.petrolCons).replace('.', ','), price: fmtEur(petrolPrice()) })) + '</small></div>';
  }

  // Журнал в файл CSV: через «Поделиться» с файлом, где это есть (телефоны), иначе обычное скачивание
  async function exportCharges() {
    try {
      const csv = UR.chargesCsv(state.charges);
      const name = 'uzlades-radars-' + new Date().toISOString().slice(0, 10) + '.csv';
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const file = typeof File === 'function' ? new File([blob], name, { type: 'text/csv' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Uzlādes Radars' }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(t('csvDone'));
    } catch (e) { toast(t('csvFail')); }
  }

  function chargeLogHtml() {
    const list = state.charges;
    const cf = state.chargeForm;
    let h = '<h3 class="sect charge-sect">' + esc(t('chargeTitle')) + '</h3>';
    if (cf) {
      h += '<form id="charge-form" class="charge-form" novalidate>' +
        '<div class="fld-grid">' +
        '<label class="fld"><span>' + esc(t('chargeKwh')) + '</span><input id="ch-kwh" type="text" inputmode="decimal" autocomplete="off" value="' + esc(cf.kwh) + '"></label>' +
        '<label class="fld"><span>' + esc(t('chargeEur')) + '</span><input id="ch-eur" type="text" inputmode="decimal" autocomplete="off" value="' + esc(cf.eur) + '"></label></div>' +
        '<label class="fld"><span>' + esc(t('chargeName')) + '</span><input id="ch-name" type="text" maxlength="80" autocomplete="off" value="' + esc(cf.name) + '"></label>' +
        (cf.error ? '<p class="charge-err" role="alert">' + esc(t('chargeBad')) + '</p>' : '') +
        '<div class="btn-row"><button type="button" class="btn" data-act="chargeCancel">' + esc(t('chargeCancel')) + '</button>' +
        '<button type="submit" class="btn btn-primary">' + esc(t('chargeSave')) + '</button></div></form>';
    } else {
      h += '<button class="btn btn-block" data-act="chargeAdd">' + esc(t('chargeAdd')) + '</button>';
    }
    if (!list.length) return h + '<p class="note charge-note">' + esc(t('chargeEmpty')) + '</p>';
    const sum = UR.chargeSummary(list);
    if (sum.cur.count) {
      h += '<div class="charge-sum"><b>' + esc(t('chargeMonth', { kwh: fmtNum(sum.cur.kwh), eur: fmtEur(sum.cur.eur), n: sum.cur.count })) + '</b>' +
        (sum.cur.perKwh != null ? '<span>' + esc(t('chargeAvg', { p: sum.cur.perKwh.toFixed(3).replace('.', ',') })) + '</span>' : '') + '</div>';
    }
    if (sum.prev.count) h += '<div class="charge-prev">' + esc(t('chargePrev', { kwh: fmtNum(sum.prev.kwh), eur: fmtEur(sum.prev.eur) })) + '</div>';
    h += savingsHtml(list);
    h += '<ul class="charge-list">' + list.slice(0, 30).map((e) =>
      '<li><span class="ch-date">' + esc(fmtDay(e.ts)) + '</span><span class="ch-name">' + esc(e.name || '–') + '</span>' +
      '<span class="ch-val">' + esc(fmtNum(e.kwh)) + ' ' + esc(t('unitKwh')) + ' · ' + esc(fmtEur(e.eur)) + ' €</span>' +
      '<button class="ch-del' + (state.chargeDelArm === e.id ? ' armed' : '') + '" data-chdel="' + esc(e.id) + '" aria-label="' + esc(t('chargeDel')) + '">' +
      (state.chargeDelArm === e.id ? esc(t('chargeDelSure')) : '×') + '</button></li>').join('') + '</ul>';
    return h + '<button class="link-btn" data-act="chargeCsv">' + esc(t('csvBtn')) + '</button><p class="note charge-note">' + esc(t('chargeNote')) + '</p>';
  }

  function openChargeForm(name) {
    state.chargeForm = { kwh: '', eur: '', name: name || '', error: false };
    state.chargeDelArm = null;
    state.tab = 'fav';
    state.detailId = null;
    renderTabs();
    renderMarkers(filtered());
    renderPanel();
    const f = $('charge-form');
    if (f && f.scrollIntoView) f.scrollIntoView({ block: 'center' });
    const k = $('ch-kwh');
    if (k) k.focus();
  }

  function submitCharge() {
    const cf = state.chargeForm;
    if (!cf) return;
    const entry = UR.normalizeCharge({ kwh: cf.kwh, eur: cf.eur, name: cf.name });
    if (!entry) { cf.error = true; renderPanel(); return; }
    state.charges = UR.addCharge(state.charges, entry);
    saveCharges();
    state.chargeForm = null;
    renderPanel();
  }

  function deleteCharge(id) {
    if (state.chargeDelArm !== id) { state.chargeDelArm = id; renderPanel(); return; }
    state.charges = state.charges.filter((e) => e.id !== id);
    state.chargeDelArm = null;
    saveCharges();
    renderPanel();
  }

  /* ---------- удобства рядом (OpenStreetMap) ---------- */
  const AMEN_TTL = 24 * 3600 * 1000;
  const amenKey = (st) => st.lat.toFixed(4) + ',' + st.lon.toFixed(4);

  function amenInner(st) {
    const c = state.amen[amenKey(st)];
    if (!c) return '<span class="note">' + esc(t('amenLoading')) + '</span>';
    const v = c.v;
    const chips = [['toilets', 'amenToilets'], ['food', 'amenFood'], ['shop', 'amenShop'], ['wifi', 'amenWifi']]
      .filter(([k]) => v[k] > 0).map(([k, key]) => '<span class="chip-pay">' + esc(t(key)) + '</span>').join('');
    return chips ? '<div class="pay">' + chips + '</div><span class="note">' + esc(t('amenNote')) + '</span>' : '<span class="note">' + esc(t('amenNone')) + '</span>';
  }

  function amenBlock(st) {
    return '<div class="amen"><h3 class="sect">' + esc(t('amenTitle')) + '</h3><div id="amen">' + amenInner(st) + '</div></div>';
  }

  async function ensureAmenities(st) {
    const key = amenKey(st);
    const c = state.amen[key];
    if (c && Date.now() - c.t < AMEN_TTL) return;
    try {
      const els = await overpass(UR.amenityQuery(st.lat, st.lon), 25000);
      state.amen[key] = { t: Date.now(), v: UR.parseAmenities(els) };
      const keys = Object.keys(state.amen);
      if (keys.length > 60) keys.sort((a, b) => state.amen[a].t - state.amen[b].t).slice(0, keys.length - 60).forEach((k) => { delete state.amen[k]; });
      writeJson('ur_amen_v1', state.amen);
      const box = $('amen');
      if (box && state.detailId === st.id) box.innerHTML = amenInner(st);
    } catch (e) {
      const box = $('amen');
      if (box && state.detailId === st.id) { const blk = box.closest('.amen'); if (blk) blk.hidden = true; } // сеть не ответила: блок просто не показываем
    }
  }

  /* ---------- скидки сетей ---------- */
  const discDate = () => UR.DISCOUNTS_DATE.split('-').reverse().join('.');
  function discItems(list) {
    return '<ul class="disc-list">' + list.map((d) =>
      '<li>' + esc(d[lang] || d.en || d.ru) + ' <a href="' + esc(d.src) + '" target="_blank" rel="noopener">' + esc(t('discSrc')) + '</a></li>').join('') + '</ul>';
  }
  function discountBlock(st) {
    const list = UR.stationDiscounts(st);
    if (!list.length) return '';
    const tou = UR.touInfo(st.operatorId);
    const touHtml = tou ? '<p class="tou-line">' + esc(t(tou.active ? 'touNow' : 'touSoon', { price: fmtEur(tou.price), from: tou.from, to: String(tou.to).padStart(2, '0'), left: fmtDur(tou.inMin) })) + '</p>' : '';
    return '<div class="disc"><h3 class="sect">' + esc(t('discTitle')) + '</h3>' + touHtml + discItems(list) +
      '<p class="note">' + esc(t('discNote', { date: discDate() })) + '</p></div>';
  }
  function discountsPrices() {
    const blocks = UR.OPERATORS.map((op) => {
      const list = UR.activeDiscounts(op.id);
      return list.length ? '<h4 class="disc-op">' + esc(op.name) + '</h4>' + discItems(list) : '';
    }).join('');
    if (!blocks) return '';
    return '<div class="disc"><h3 class="sect">' + esc(t('discPricesTitle')) + '</h3>' + blocks +
      '<p class="note">' + esc(t('discNote', { date: discDate() })) + '</p></div>';
  }

  function mineBlock() {
    const chips = UR.mineOptions().map((id) => {
      const d = UR.DISCOUNTS[id].find((x) => x.personal);
      return '<button class="chip" data-mine="' + esc(id) + '" aria-pressed="' + !!state.mine[id] + '">' + esc(d.label[lang] || d.label.en || d.label.ru) + '</button>';
    }).join('');
    return '<div class="mine"><h3 class="sect">' + esc(t('mineTitle')) + '</h3><p class="note">' + esc(t('mineNote')) + '</p><div class="mine-chips">' + chips + '</div></div>';
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
      mineBlock() +
      '<table class="price-table"><thead><tr><th>' + esc(t('thNet')) + '</th>' +
      '<th><span class="dot" style="background:var(--c-ac)"></span>' + esc(t('thAc')) + '</th>' +
      '<th><span class="dot" style="background:var(--c-dc)"></span>' + esc(t('thDc')) + '</th>' +
      '<th><span class="dot" style="background:var(--c-hpc)"></span>' + esc(t('thHpc')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (state.live ? '<p class="note" style="margin-top:12px">' + esc(t('liveSource')) + '</p>' : '') +
      discountsPrices() +
      '<p class="note ver">' + esc(t('verLine', { v: APP_VERSION })) + '</p>';
  }

  const PT_NAMES = { type2: 'sockType2', ccs: 'sockCcs', chademo: 'sockChademo', tesla: 'sockTesla' };

  function livePoints(st) {
    const key = { free: 'ptFree', busy: 'ptBusy', out: 'ptOut', unk: 'ptUnk' };
    const pts = st.live.pts.slice().sort((a, b) => (b.kw || 0) - (a.kw || 0));
    return (
      '<ul class="pts">' +
      pts.map((p) => {
        const name = PT_NAMES[p.t] ? t(PT_NAMES[p.t]) : '?';
        const kw = p.kw ? ' ' + Math.round(p.kw) + ' ' + t('unitKw') : '';
        const price = p.p != null ? fmtEur(p.p) + ' ' + t('perKwh') : '';
        return '<li><span class="pt-dot pt-' + esc(p.s) + '"></span><span class="pt-name">' + esc(name + kw) + '</span>' +
          '<span class="pt-state">' + esc(sinceText(p) || t(key[p.s] || 'ptUnk')) + '</span><span class="pt-price">' + esc(price) + '</span></li>';
      }).join('') +
      '</ul>'
    );
  }

  /* ---------- «Подробнее»: надёжность, прогноз, машина, сравнение ---------- */
  function insightsHtml(st) {
    const out = [];
    const rel = UR.reliabilityOf(st, state.patterns);
    if (rel) {
      const key = rel.level === 'good' ? 'relGood' : rel.level === 'mid' ? 'relMid' : 'relBad';
      out.push('<div class="insight rel-' + rel.level + '"><i></i><span><b>' + esc(t(key, { pct: rel.pct })) + '</b> <small>' + esc(t('relNote', { n: rel.n })) + '</small></span></div>');
    }
    const fc = UR.forecastFor(st, state.patterns, Date.now(), 60);
    if (fc) out.push('<div class="insight"><i></i><span>' + esc(t('fcLine', { n: fc.pct })) + '</span></div>');
    const bw = UR.bestWindow(st, state.patterns, Date.now(), 12);
    if (bw && bw.good && bw.now <= 35) out.push('<div class="insight rel-good"><i></i><span>' + esc(t('whenGood', { n: bw.now })) + '</span></div>');
    else if (bw && !bw.good && bw.best.pct + 15 <= bw.now) out.push('<div class="insight"><i></i><span>' + esc(t('whenBest', { h: String(bw.best.hour).padStart(2, '0'), n: bw.best.pct, now: bw.now })) + '</span></div>');
    const sumNow = UR.liveSummary(st, null);
    if (sumNow && sumNow.level === 'busy' && UR.isLiveFresh(state.live)) {
      const nb = UR.nearbyFree(st, state.stations, null, 2);
      if (nb) {
        const dist = nb.km < 1 ? Math.max(50, Math.round(nb.km * 20) * 50) + ' ' + t('unitM') : fmtKm(nb.km) + ' ' + t('unitKm');
        out.push('<div class="insight rel-good"><i></i><span>' + esc(t('nearFree')) + ' <button type="button" class="inl" data-goto="' + esc(nb.st.id) + '">' + esc(stationTitle(nb.st)) + '</button>, ' + esc(dist) + '</span></div>');
      }
    }
    const pc = UR.priceChangeOf(st, state.patterns);
    if (pc) {
      const d = pc.date.split('-').reverse().slice(0, 2).join('.');
      out.push('<div class="insight ' + (pc.delta > 0 ? 'px-up' : 'px-down') + '"><i></i><span>' + esc(t(pc.delta > 0 ? 'priceUp' : 'priceDown', { d: fmtEur(Math.abs(pc.delta)), date: d })) + '</span></div>');
    }
    return out.length ? '<div class="insights">' + out.join('') + '</div>' : '';
  }

  function timerHtml(st, kw) {
    const tm = timerFor(st);
    if (tm) {
      const left = Math.ceil((tm.at - Date.now()) / 60000);
      return '<div class="timer"><b>' + esc(left > 1 ? t('timerActive', { min: left }) : t('timerSoon')) + '</b><button type="button" class="inl" data-timer-off="' + esc(st.id) + '">' + esc(t('timerCancel')) + '</button></div>';
    }
    const btns = [10, 20, 40, 60].map((soc) => {
      const e = UR.chargeEstimate(state.car, kw, null, soc, 80);
      return e && e.minutes ? '<button type="button" class="chip-btn" data-timer="' + esc(st.id) + '" data-soc="' + soc + '">' + esc(t('timerBtn', { soc, min: e.minutes })) + '</button>' : '';
    }).join('');
    return btns ? '<div class="timer"><b>' + esc(t('timerTitle')) + '</b><small>' + esc(t('timerHint')) + '</small><div class="timer-btns">' + btns + '</div></div>' : '';
  }

  function carBlock(st, price) {
    if (!state.car) return '';
    const kw = UR.carPowerKw(state.car, st);
    if (kw == null) return '<div class="est est-none"><div class="est-head">' + ICON.car + '<b>' + esc(t('estTitle')) + '</b></div><p>' + esc(t('estNone')) + '</p></div>';
    const e = UR.chargeEstimate(state.car, kw, price, 20, 80);
    return (
      '<div class="est"><div class="est-head">' + ICON.car + '<b>' + esc(t('estTitle')) + '</b><span>' + esc(state.car.name) + '</span></div>' +
      '<p><b>' + esc(t('estSpeed', { kw: Math.round(kw) })) + '</b></p>' +
      (e ? '<p>' + esc(e.cost != null ? t('estLine', { from: 20, to: 80, min: e.minutes, cost: fmtEur(e.cost) }) : t('estLineNoCost', { from: 20, to: 80, min: e.minutes })) + '</p>' : '') +
      timerHtml(st, kw) +
      '<small>' + esc(t('estNote')) + '</small></div>'
    );
  }

  function compareBlock(price) {
    const c = UR.costPer100(state.car, state.car ? state.tempC : null, {
      stationPrice: price ? price.mid : null, homePrice: state.prefs.home, petrolPrice: petrolPrice(), petrolCons: state.prefs.petrolCons,
    });
    if (c.station == null && c.home == null) return '';
    const cell = (label, v, cls) => '<div class="cmp-cell' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + '</span><b>' + fmtEur(v) + ' €</b></div>';
    const cells = [];
    if (c.station != null) cells.push(cell(t('cmpHere'), c.station, 'is-ev'));
    if (c.home != null) cells.push(cell(t('cmpHome'), c.home, 'is-ev'));
    cells.push(cell(t('cmpPetrol'), c.petrol, 'is-petrol'));
    const ref = c.station != null ? c.station : c.home;
    const diff = c.petrol - ref;
    return (
      '<div class="cmp"><div class="cmp-head"><b>' + esc(t('cmpTitle')) + '</b><small>' + esc(t('cmpPetrolNote', { l: String(state.prefs.petrolCons).replace('.', ','), price: fmtEur(petrolPrice()) })) + '</small></div>' +
      '<div class="cmp-grid">' + cells.join('') + '</div>' +
      '<p>' + esc(t(diff >= 0 ? 'cmpSave' : 'cmpMore', { eur: fmtEur(Math.abs(diff)) })) + '</p></div>'
    );
  }

  function toolsHtml(st) {
    const live = !!(st.live && UR.isLiveFresh(state.live));
    const watched = isWatched(st);
    return (
      '<div class="tools">' + favButton(st, 'tool') +
      '<button class="tool" data-share="' + esc(st.id) + '">' + ICON.share + '<span>' + esc(t('share')) + '</span></button>' +
      '<button class="tool" data-watch="' + esc(st.id) + '" aria-pressed="' + watched + '"' + (live || watched ? '' : ' aria-disabled="true"') + '>' + ICON.bell + '<span>' + esc(t(watched ? 'unwatch' : 'watch')) + '</span></button></div>'
    );
  }

  function renderDetail() {
    const st = state.stations.find((s) => s.id === state.detailId);
    if (!st) { state.detailId = null; renderPanel(); return; }
    const livePrice = UR.livePriceOf(st, null);
    const listPrice = livePrice || UR.priceFor(st.operatorId, st.cls);
    const price = UR.personalPrice(listPrice, st.operatorId, { mine: state.mine, tou: true });
    const sum = UR.liveSummary(st, null);
    const rows = [];
    rows.push([t('dtPower'), st.kw ? (st.powerKnown ? t('powerKnown', { n: Math.round(st.kw) }) : t('powerEst', { n: Math.round(st.kw) })) : t('powerNone')]);
    rows.push([t('dtSockets'), socketsText(st)]);
    if (st.points) rows.push([t('dtPoints'), String(st.points)]);
    rows.push([t('dtPrice'), price ? fmtRange(price) + ' ' + t('perKwh') + ' (' + (price.mine ? t('priceMine', { p: fmtRange(listPrice) }) : price.tou ? t('priceTou') : t(livePrice ? 'priceLive' : 'priceNote')) + ')' : t('priceUnknown')]);
    if (st.indoor) rows.push([t('dtIndoor'), t('indoorYes')]);
    if (st.maxheight) rows.push([t('dtMaxh'), String(st.maxheight).replace(/^(\d+(?:\.\d+)?)$/, '$1 m')]);
    const payHtml = payChips(st, false);
    if (payHtml) rows.push([t('payTitle'), payHtml, true]);
    if (st.fee) rows.push([t('dtFee'), st.fee === 'yes' ? t('feeYes') : st.fee === 'no' ? t('feeNo') : st.fee]);
    if (st.hours) rows.push([t('dtHours'), st.hours]);
    if (st.address) rows.push([t('dtAddress'), st.address]);
    const busyHtml = sum ? livePill(sum) : esc(t('busyUnknown'));
    const osm = st.osmType ? 'https://www.openstreetmap.org/' + st.osmType + '/' + st.osmId : null;
    $('panel').innerHTML =
      '<button class="link-btn back" id="btn-back">' + esc(t('back')) + '</button>' +
      '<div class="detail"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">' +
      '<div><h2>' + esc(stationTitle(st)) + '</h2><div class="sub">' + esc(st.operatorName || t('otherNet')) + '</div></div>' + gauge(st, true) + '</div>' +
      toolsHtml(st) +
      '<dl>' + rows.map(([k, v, raw]) => '<dt>' + esc(k) + '</dt><dd>' + (raw ? v : esc(v)) + '</dd>').join('') +
      '<dt>' + esc(t('dtBusy')) + '</dt><dd>' + busyHtml + '</dd>' + (etaText(st) ? '<dt>' + esc(t('dtEta')) + '</dt><dd>' + esc(etaText(st)) + '</dd>' : '') + '</dl>' +
      insightsHtml(st) +
      carBlock(st, price) +
      compareBlock(price) +
      discountBlock(st) +
      (st.live ? livePoints(st) + (liveNote() ? '<p class="note">' + esc(liveNote()) + '</p>' : '') : '') +
      usualChart(st) +
      amenBlock(st) +
      navLinks(st) +
      '<button class="link-btn" data-charge="' + esc(st.id) + '">' + esc(t('chargeHere')) + '</button>' +
      (osm ? '<p class="note" style="margin-top:14px"><a href="' + osm + '" target="_blank" rel="noopener" style="color:var(--muted)">' + esc(t('fixOsm')) + '</a></p>' : '') +
      (st.live ? '<p class="note">' + esc(t('liveSource')) + '</p>' : '') + '</div>';
    ensureAmenities(st);
  }

  /* ---------- маршрут A→B ---------- */
  state.routeForm = { from: '', to: '', soc: 90 };
  state.routes = (readJson('ur_routes_v1', []) || []).filter((x) => x && typeof x.id === 'string' && typeof x.to === 'string').slice(0, 10);

  async function geocode(q) {
    // только Балтия, ближайшее к вам выше: иначе «Airport» находит Хельсинки
    const o = state.origin || { lat: 56.95, lon: 24.11 };
    const vb = [o.lon - 2.5, o.lat + 1.5, o.lon + 2.5, o.lat - 1.5].map((x) => x.toFixed(3)).join(',');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=lv,lt,ee&viewbox=' + vb + '&bounded=0&accept-language=' + lang + '&q=' + encodeURIComponent(q), { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (!Array.isArray(j) || !j.length) return null;
      return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), label: String(j[0].display_name || q).split(',').slice(0, 2).join(',').trim() };
    } finally { clearTimeout(timer); }
  }

  async function fetchRoute(a, b) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    try {
      const url = 'https://router.project-osrm.org/route/v1/driving/' + a.lon + ',' + a.lat + ';' + b.lon + ',' + b.lat + '?overview=full&geometries=geojson';
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const r = j && j.routes && j.routes[0];
      if (!r || !r.geometry || !Array.isArray(r.geometry.coordinates)) throw new Error('no route');
      return { km: r.distance / 1000, min: r.duration / 60, line: r.geometry.coordinates.map((c) => [c[1], c[0]]) };
    } finally { clearTimeout(timer); }
  }

  async function findRoute() {
    const f = state.routeForm;
    if (!f.to.trim()) return;
    state.route = { status: 'wait' };
    renderPanel();
    try {
      let from;
      if (!f.from.trim() || f.from.trim().toLowerCase() === t('routeFromMine').toLowerCase()) {
        from = { lat: state.origin.lat, lon: state.origin.lon, label: t('routeFromMine') };
      } else {
        from = await geocode(f.from.trim());
        if (!from) { state.route = { status: 'notfound', which: 'from' }; renderPanel(); return; }
        await new Promise((r) => setTimeout(r, 1100)); // правила геокодера: не чаще запроса в секунду
      }
      const to = await geocode(f.to.trim());
      if (!to) { state.route = { status: 'notfound', which: 'to' }; renderPanel(); return; }
      const r = await fetchRoute(from, to);
      // загружаем страны, через которые идёт маршрут
      const need = Object.keys(COUNTRIES).filter((cc) => !state.osmBy[cc] && r.line.some((q, i) => i % 20 === 0 && countryAt(q[0], q[1]) === cc));
      if (need.length) await Promise.all(need.map((cc) => loadCountry(cc, false)));
      state.route = { status: 'ok', from, to, km: r.km, min: r.min, line: r.line, cache: null };
      renderAll();
      // после построения панель в среднем положении, а карта крупно показывает весь маршрут
      if (sheetLevel() !== 'peek') { setSheetLevel('peek'); setTimeout(fitRoute, 380); }
      fitRoute();
    } catch (e) {
      state.route = { status: 'fail' };
      renderPanel();
    }
  }

  function fitRoute() {
    const r = state.route;
    if (!r || r.status !== 'ok' || !map || !map.fitBounds || !L.latLngBounds) return;
    const top = ($('filters').getBoundingClientRect().bottom || 120) + 10;
    const bottom = window.innerWidth < 760 ? window.innerHeight - $('sheet').getBoundingClientRect().top + 10 : 20;
    const left = window.innerWidth < 760 ? 24 : $('sheet').getBoundingClientRect().right + 24;
    try { map.fitBounds(L.latLngBounds(r.line), { paddingTopLeft: [left, top], paddingBottomRight: [24, bottom] }); } catch (e) { /* карта сама подстроится */ }
  }

  // Остановки и станции вдоль маршрута считаем один раз на набор данных и фильтров
  function routeCalc() {
    const r = state.route;
    if (!r || r.status !== 'ok') return null;
    const f = state.filters;
    const sig = [state.stations.length, state.live && state.live.generated, f.connector, f.power, f.operator, f.open247, f.cardPay, f.maxPrice, f.free, f.discount, f.indoor, Object.keys(state.mine).sort().join(), f.query, state.car && [state.car.id, state.car.kwh, state.car.dc, state.car.cons, state.car.conn.join(), state.car.onlyCompatible].join(), state.tempC == null ? '' : Math.round(state.tempC), state.routeForm.soc].join('|');
    if (r.cache && r.cache.sig === sig) return r.cache;
    const pool = UR.applyFilters(state.stations, Object.assign({}, f, { freeNow: false }));
    const along = UR.stationsAlong(pool, r.line, 3);
    const plan = state.car ? UR.planStops(state.car, along, r.km, Math.max(15, Math.min(100, state.routeForm.soc)), state.tempC) : null;
    r.cache = { sig, along, plan };
    return r.cache;
  }

  const fmtDur = (min) => {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h ? h + ' ' + t('unitH') + ' ' + (m ? m + ' ' + t('unitMin') : '') : m + ' ' + t('unitMin');
  };
  const fmtOff = (km) => (km < 1 ? t('routeOff', { n: Math.max(50, Math.round(km * 10) * 100 / 10 | 0) }) : t('routeOffKm', { n: fmtKm(km) }));

  // Вдоль всего маршрута: быстрые станции (подходящие машине, если она задана), одна лучшая на каждые 10 км
  function alongList(along) {
    const kwOf = (c) => (state.car ? UR.carPowerKw(state.car, c.st) : c.st.kw) || 0;
    let pool = along.filter((c) => kwOf(c) >= 50);
    if (!pool.length) pool = along;
    const rank = (c) => {
      const sum = UR.liveSummary(c.st, state.filters);
      return (sum && sum.level === 'free' ? 2000 : sum && sum.level === 'busy' ? 1000 : 0) + Math.min(kwOf(c), 400);
    };
    return UR.thinAlong(pool, 10, rank);
  }

  function routeRow(c, title, extra) {
    const st = c.st;
    return (
      '<button class="row" data-detail="' + esc(st.id) + '">' + gauge(st, false) +
      '<span class="main"><span class="title" style="display:block">' + esc(title || stationTitle(st)) + '</span>' +
      '<span class="meta" style="display:block">' + esc((title ? stationTitle(st) + ' · ' : '') + stationSub(st)) + '</span>' +
      (extra ? [].concat(extra).filter(Boolean).map((x) => '<span class="meta" style="display:block">' + esc(x) + '</span>').join('') : '') +
      (UR.liveSummary(st, state.filters) ? '<span class="live-line" style="display:block">' + livePill(UR.liveSummary(st, state.filters)) + '</span>' : '') + '</span>' +
      '<span class="side">' + esc(t('routeKm', { n: c.along < 10 ? fmtKm(c.along) : Math.round(c.along) })) + '<small>' + esc(fmtOff(c.off)) + '</small></span></button>'
    );
  }

  /* ---------- сохранённые маршруты и ссылка на маршрут ---------- */
  const saveRoutes = () => writeJson('ur_routes_v1', state.routes);
  function savedRoutesHtml() {
    if (!state.routes.length) return '';
    return '<h3 class="sect">' + esc(t('routeSaved')) + '</h3><div class="saved-routes">' +
      state.routes.map((x) => '<span class="saved-route"><button type="button" class="chip" data-route-load="' + esc(x.id) + '">' + esc((x.from || t('routeFromMine')) + ' → ' + x.to) + '</button>' +
        '<button type="button" class="chip chip-x" data-route-del="' + esc(x.id) + '" aria-label="' + esc(t('routeDel')) + '">×</button></span>').join('') + '</div>';
  }
  function currentRouteRef() {
    const r = state.route;
    if (!r || r.status !== 'ok') return null;
    const f = state.routeForm;
    const mine = !f.from.trim() || f.from.trim().toLowerCase() === t('routeFromMine').toLowerCase();
    return { from: mine ? '' : f.from.trim().slice(0, 80), to: f.to.trim().slice(0, 80), soc: Math.max(15, Math.min(100, parseInt(f.soc, 10) || 90)) };
  }
  function routeUrl(ref) {
    const q = new URLSearchParams();
    if (ref.from) q.set('rf', ref.from);
    q.set('rt', ref.to);
    q.set('rs', String(ref.soc));
    return location.origin + location.pathname + '?' + q.toString();
  }
  function saveCurrentRoute() {
    const ref = currentRouteRef();
    if (!ref) return;
    const id = (ref.from + '|' + ref.to).toLowerCase();
    state.routes = [Object.assign({ id }, ref)].concat(state.routes.filter((x) => x.id !== id)).slice(0, 10);
    saveRoutes();
    toast(t('routeSavedDone'));
    renderPanel();
  }
  async function shareRoute() {
    const ref = currentRouteRef();
    if (!ref) return;
    const url = routeUrl(ref);
    const text = t('routeShareText', { from: ref.from || t('routeFromMine'), to: ref.to });
    try {
      if (navigator.share) { await navigator.share({ title: 'Uzlādes Radars', text, url }); return; }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    try { await navigator.clipboard.writeText(url); toast(t('shareCopied')); } catch (e) { toast(url); }
  }
  function loadSavedRoute(id) {
    const x = state.routes.find((r) => r.id === id);
    if (!x) return;
    state.routeForm.from = x.from;
    state.routeForm.to = x.to;
    state.routeForm.soc = x.soc;
    findRoute();
  }

  function renderRoute() {
    const f = state.routeForm;
    const r = state.route;
    const originHtml = '<div class="origin-line"><span>' + esc(originText()) + '</span><button class="link-btn" id="btn-locate">' + esc(state.locating ? t('locating') : t('locate')) + '</button></div>';
    const formHtml =
      '<form class="route-form" id="route-form" autocomplete="off">' +
      '<label><span>' + esc(t('routeFrom')) + '</span><input id="route-from" type="text" enterkeyhint="next" placeholder="' + esc(t('routeFromMine')) + '" value="' + esc(f.from) + '"></label>' +
      '<label><span>' + esc(t('routeTo')) + '</span><input id="route-to" type="text" enterkeyhint="search" placeholder="' + esc(t('routeToPh')) + '" value="' + esc(f.to) + '"></label>' +
      (state.car ? '<label class="soc"><span>' + esc(t('routeSoc')) + '</span><input id="route-soc" type="number" inputmode="numeric" min="15" max="100" value="' + esc(f.soc) + '"></label>' : '') +
      '<button class="btn btn-primary" type="submit" id="route-go">' + esc(t('routeGo')) + '</button></form>';
    const routeOk = !!(r && r.status === 'ok');
    // маршрут построен: итог и остановки сразу под картой, форма сворачивается в «Изменить маршрут»
    let html = routeOk
      ? ''
      : originHtml + formHtml + savedRoutesHtml();
    if (!r) {
      if (!state.car) html += '<p class="note">' + esc(t('routeNoCar')) + '</p>';
    } else if (r.status === 'wait') {
      html += '<p class="empty">' + esc(t('routeWait')) + '</p>';
    } else if (r.status === 'fail') {
      html += '<p class="empty">' + esc(t('routeFail')) + '</p>';
    } else if (r.status === 'notfound') {
      html += '<p class="empty">' + esc(t('routeNotFound')) + '</p>';
    } else if (r.status === 'ok') {
      const calc = routeCalc();
      html += '<div class="route-sum"><span>' + esc(t('routeLen', { km: Math.round(r.km), h: fmtDur(r.min) })) + '</span><button class="link-btn" data-act="routeClear">' + esc(t('routeClear')) + '</button></div>';
      html += '<p class="note">A: ' + esc(r.from.label) + '<br>B: ' + esc(r.to.label) + '</p>' +
        '<div class="route-acts"><button class="chip" data-act="routeSave">' + esc(t('routeSave')) + '</button><button class="chip" data-act="routeShare">' + esc(t('routeShare')) + '</button></div>' +
        '<details class="route-edit"><summary>' + esc(t('routeEdit')) + '</summary><div class="route-edit-body">' + originHtml + formHtml + '</div></details>';
      if (!state.car) html += '<p class="note">' + esc(t('routeNoCar')) + '</p>';
      if (calc.plan) {
        const plan = calc.plan;
        if (plan.ok && !plan.stops.length) {
          html += '<div class="route-ok">' + esc(t('routeNoNeed', { km: UR.rangeKm(state.car, Math.max(15, Math.min(100, f.soc)), state.tempC) })) + '</div>';
        }
        const nowMs = Date.now();
        const times = UR.stopTimes(plan, state.car, r.min, r.km, nowMs);
        if (plan.stops.length) {
          html += '<h3 class="sect">' + esc(t('routeStops')) + '</h3><div class="rows">' +
            plan.stops.map((s, i) => {
              const kw = UR.carPowerKw(state.car, s.st);
              const e = UR.chargeEstimate(state.car, kw, UR.priceOf(s.st, state.filters), s.arriveSoc, 80);
              const tm = times[i];
              const fc = tm ? UR.forecastFor(s.st, state.patterns, nowMs, (tm.arriveMs - nowMs) / 60000) : null;
              const line1 = t('routeArrive', { n: s.arriveSoc }) + (e ? ' · ' + t('routeCharge', { from: s.arriveSoc, min: e.minutes }) : '');
              const line2 = tm ? t('routeEta', { time: fmtTime(tm.arriveMs) }) + (fc ? ' · ' + t('routeOcc', { n: fc.pct }) : '') : '';
              return routeRow(s, t('routeStop', { n: i + 1 }), [line1, line2]);
            }).join('') + '</div>';
        }
        if (!plan.ok) html += '<div class="route-warn">' + esc(t(plan.reason === 'noStart' ? 'routeNoStart' : plan.reason === 'tooMany' ? 'routeTooMany' : 'routeNoNext')) + '</div>';
      }
      if (!calc.along.length) {
        html += '<p class="empty">' + esc(t('routeNoStations')) + '</p>';
      } else {
        html += '<h3 class="sect">' + esc(t('routeAlong')) + '</h3><div class="rows">' + alongList(calc.along).map((c) => routeRow(c)).join('') + '</div>';
      }
      html += savedRoutesHtml();
    }
    $('panel').innerHTML = html;
  }

  // Линия маршрута и остановки на карте (свой слой, отдельный от станций)
  function drawRoute() {
    if (!map || !routeLayer) return;
    routeLayer.clearLayers();
    const r = state.route;
    if (!r || r.status !== 'ok' || !L.polyline) return;
    L.polyline(r.line, { color: cssVar('--accent'), weight: 5, opacity: 0.85, interactive: false, lineJoin: 'round' }).addTo(routeLayer);
    const calc = routeCalc();
    const pin = (ll, text, cls) => {
      if (!L.marker || !L.divIcon) return;
      L.marker(ll, { icon: L.divIcon({ className: 'pin ' + cls, html: '<span>' + esc(text) + '</span>', iconSize: [28, 28], iconAnchor: [14, 14] }), interactive: false, keyboard: false }).addTo(routeLayer);
    };
    pin(r.line[0], 'A', 'pin-end');
    pin(r.line[r.line.length - 1], 'B', 'pin-end');
    if (calc && calc.plan) calc.plan.stops.forEach((s, i) => pin([s.st.lat, s.st.lon], String(i + 1), 'pin-stop'));
  }

  function renderPanel() {
    document.documentElement.dataset.view = state.detailId ? 'detail' : state.tab;
    if (state.detailId) return renderDetail();
    if (state.tab === 'go') return renderGo();
    if (state.tab === 'list') return renderList();
    if (state.tab === 'route') return renderRoute();
    if (state.tab === 'fav') return renderFav();
    return renderPrices();
  }

  function renderTabs() {
    const tabs = [['go', 'tabGo'], ['list', 'tabList'], ['route', 'tabRoute'], ['fav', 'tabFav'], ['prices', 'tabPrices']];
    $('tabs').innerHTML = tabs
      .map(([id, key]) => '<button class="tab" role="tab" data-tab="' + id + '" aria-selected="' + (state.tab === id && !state.detailId) + '">' +
        (id === 'fav' ? '<span class="tab-star">★</span>' : '') + esc(t(key)) + (id === 'fav' && state.favs.length ? '<em>' + state.favs.length + '</em>' : '') + '</button>')
      .join('');
  }

  function renderFilters() {
    const liveOk = !!(state.live && UR.isLiveFresh(state.live));
    if (state.filters.freeNow && !liveOk) state.filters.freeNow = false;
    const conn = [['any', t('connAny')], ['ccs', 'CCS'], ['type2', 'Type 2'], ['chademo', 'CHAdeMO']];
    const pwr = [['fast', t('pwrFast')], ['ultra', t('pwrUltra')]]; // повторное нажатие снимает фильтр
    const extra = [];
    if (liveOk) extra.push(['freeNow', t('fFree')]);
    extra.push(['open247', t('fOpen')], ['cardPay', t('fCard')]);
    const saveChips = [['free', t('fGratis')], ['discount', t('fDisc')], ['indoor', t('fIndoor')]];
    $('filters').innerHTML =
      (state.car ? '<button class="chip chip-car" data-act="carOnly" aria-pressed="' + state.car.onlyCompatible + '">' + ICON.car + esc(t('fCar')) + '</button><span class="chip-gap"></span>' : '') +
      conn.map(([id, label]) => '<button class="chip" data-conn="' + id + '" aria-pressed="' + (state.filters.connector === id) + '">' + esc(label) + '</button>').join('') +
      '<span class="chip-gap"></span>' +
      pwr.map(([id, label]) => '<button class="chip" data-pwr="' + id + '" aria-pressed="' + (state.filters.power === id) + '">' + esc(label) + '</button>').join('') +
      '<span class="chip-gap"></span>' +
      extra.map(([id, label]) => '<button class="chip" data-flt="' + id + '" aria-pressed="' + !!state.filters[id] + '">' + esc(label) + '</button>').join('') +
      '<span class="chip-gap"></span><button class="chip" data-act="maxPrice" aria-pressed="' + !!state.filters.maxPrice + '">' + esc(state.filters.maxPrice ? t('fMaxN', { p: fmtEur(state.filters.maxPrice) }) : t('fMax')) + '</button>' +
      saveChips.map(([id, label]) => '<button class="chip" data-flt="' + id + '" aria-pressed="' + !!state.filters[id] + '">' + esc(label) + '</button>').join('') +
      '';
  }

  function renderTop() {
    $('btn-lang').textContent = lang.toUpperCase();
    $('btn-theme').textContent = state.theme === 'dark' ? '☾' : '☀';
    $('btn-install').textContent = t('install');
    $('btn-install').title = t('install');
    $('btn-car').title = t('carBtn');
    $('btn-car').setAttribute('aria-label', t('carBtn'));
    $('btn-car').classList.toggle('on', !!state.car);
    $('btn-install').hidden = isStandalone();
    $('btn-gps').setAttribute('aria-label', t('myPlace'));
    $('btn-gps').title = t('myPlace');
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
    drawRoute();
    renderPanel();
  }

  /* ---------- действия ---------- */
  let quietRender = false; // фоновое обновление не должно уводить карту от того, что смотрит человек
  // Видимая часть карты: на телефоне её нижнюю часть закрывает панель, на компьютере левый край.
  // Чтобы станция и «вы» оказывались на виду, центр карты сдвигаем в середину видимой части.
  function viewCenter(latlng, zoom) {
    if (!map || !map.project || !map.unproject || !map.getSize) return latlng;
    const size = map.getSize();
    const sh = $('sheet').getBoundingClientRect();
    const top = $('filters').getBoundingClientRect().bottom + 8;
    let left = 0;
    let bottom = size.y;
    if (sh.width < size.x * 0.9) left = sh.right + 8;
    else bottom = Math.max(sh.top - 8, top + 140);
    const dx = (left + size.x) / 2 - size.x / 2;
    const dy = (top + bottom) / 2 - size.y / 2;
    const ll = L.latLng(latlng);
    return map.unproject(map.project(ll, zoom).subtract([dx, dy]), zoom);
  }

  function focusStation(st) {
    if (!map || quietRender) return;
    const z = Math.max(map.getZoom(), 14);
    map.flyTo(viewCenter([st.lat, st.lon], z), z, { duration: 0.6 });
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

  /* ---------- моё местоположение ---------- */
  let lastFixAt = 0;
  let firstFix = true;

  // opts.auto: запрос при открытии или возврате в приложение (без всплывающих сообщений об ошибках)
  function locate(opts) {
    const o = opts || {};
    if (!navigator.geolocation) { if (!o.auto) toast(t('toastLocUnavailable')); return; }
    if (state.locating) return;
    state.locating = true;
    setGpsBusy(true);
    if (!o.auto) renderPanel();

    const onFix = (pos) => {
      state.locating = false;
      state.geoDenied = false;
      lastFixAt = Date.now();
      setGpsBusy(false);
      state.origin = { lat: pos.coords.latitude, lon: pos.coords.longitude, real: true, accuracy: pos.coords.accuracy };
      loadWeather();
      // карта остаётся на человеке: перерисовка не должна увести её к «лучшей» станции
      if (map) {
        const z = firstFix || o.zoom ? Math.max(o.zoom || 15, 14) : Math.max(map.getZoom(), 14);
        map.setView(viewCenter([state.origin.lat, state.origin.lon], z), z);
      }
      firstFix = false;
      quietRender = true;
      try { renderAll(); } finally { quietRender = false; }
    };
    const onFail = (err, retried) => {
      // слабый сигнал или таймаут при высокой точности: один раз пробуем грубее, но быстрее
      if (err && err.code !== 1 && !retried) {
        navigator.geolocation.getCurrentPosition(onFix, (e2) => onFail(e2, true), { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
        return;
      }
      state.locating = false;
      setGpsBusy(false);
      if (err && err.code === 1) state.geoDenied = true;
      if (!o.auto) toast(err && err.code === 1 ? t('toastLocDenied') : t('toastLocUnavailable'));
      renderPanel();
    };
    navigator.geolocation.getCurrentPosition(onFix, (e) => onFail(e, false), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  function setGpsBusy(on) {
    const b = $('btn-gps');
    if (b) b.setAttribute('aria-busy', String(!!on));
  }

  // Каждое открытие: сразу спрашиваем место. Если доступ закрыт навсегда, повторно не беспокоим.
  function locateOnOpen() {
    const go = () => locate({ auto: true });
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then((r) => {
          if (r.state === 'denied') { state.geoDenied = true; renderPanel(); } else go();
        }).catch(go);
        return;
      }
    } catch (e) { /* падаем в обычный запрос */ }
    go();
  }

  // Вернулись в приложение (из другого приложения, после блокировки экрана): обновляем место.
  function onResume() {
    if (document.visibilityState === 'visible' && Date.now() - lastFixAt > 60 * 1000 && !state.geoDenied) locate({ auto: true });
  }
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('pageshow', (e) => { if (e.persisted) onResume(); });

  // Три положения панели: свёрнута (карта почти на весь экран), средняя и полная
  function setSheetLevel(level) {
    const sh = $('sheet');
    sh.dataset.open = String(level === 'full');
    if (level === 'mini') sh.dataset.size = 'mini'; else delete sh.dataset.size;
    $('grab').setAttribute('aria-expanded', String(level === 'full'));
    setTimeout(() => map && map.invalidateSize(), 360);
  }
  const sheetLevel = () => ($('sheet').dataset.size === 'mini' ? 'mini' : $('sheet').dataset.open === 'true' ? 'full' : 'peek');
  function setSheetOpen(open) { setSheetLevel(open ? 'full' : 'peek'); }

  /* ---------- события ---------- */
  // Панель можно тянуть вверх и вниз за ручку; обычное нажатие работает как раньше
  let dragSuppressClick = false;
  (function sheetDrag() {
    const g = $('grab');
    let y0 = null;
    g.addEventListener('pointerdown', (e) => {
      y0 = e.clientY;
      try { g.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    });
    g.addEventListener('pointerup', (e) => {
      if (y0 === null) return;
      const dy = e.clientY - y0;
      y0 = null;
      if (Math.abs(dy) > 24) {
        const order = ['mini', 'peek', 'full'];
        const i = order.indexOf(sheetLevel());
        setSheetLevel(order[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]);
        dragSuppressClick = true;
        setTimeout(() => { dragSuppressClick = false; }, 60);
      }
    });
    g.addEventListener('pointercancel', () => { y0 = null; });
  })();

  document.addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    const d = el.dataset;
    if (d.conn) { state.filters.connector = d.conn; state.detailId = null; renderAll(); }
    else if (d.flt) { state.filters[d.flt] = !state.filters[d.flt]; state.detailId = null; renderAll(); }
    else if (d.fav) {
      const st = stationById(d.fav);
      if (st) { toggleFav(st); renderTabs(); renderPanel(); }
    }
    else if (d.share) { const st = stationById(d.share); if (st) shareStation(st); }
    else if (d.watch) {
      const st = stationById(d.watch);
      if (st) toggleWatch(st).then(() => renderPanel());
    }
    else if (d.timer) { const st = stationById(d.timer); if (st) startTimer(st, parseInt(d.soc, 10)).then(() => renderPanel()); }
    else if (d.timerOff) { const st = stationById(d.timerOff); if (st) { cancelTimer(st); renderPanel(); } }
    else if (d.goto) { const st = stationById(d.goto); if (st) openDetail(st.id, true); }
    else if (d.act === 'digest') cycleDigest();
    else if (d.charge) { const st = stationById(d.charge); if (st) { openChargeForm(stationTitle(st)); setSheetOpen(true); } }
    else if (d.act === 'maxPrice') {
      const steps = [0.3, 0.35, 0.4, 0.5];
      const i = steps.indexOf(state.filters.maxPrice);
      state.filters.maxPrice = i < 0 ? steps[0] : steps[i + 1] || null;
      state.detailId = null;
      renderAll();
    } else if (d.mine) {
      if (state.mine[d.mine]) delete state.mine[d.mine]; else state.mine[d.mine] = true;
      writeJson('ur_mine_v1', state.mine);
      renderAll();
    }
    else if (d.act === 'routeSave') saveCurrentRoute();
    else if (d.act === 'routeShare') shareRoute();
    else if (d.routeLoad) loadSavedRoute(d.routeLoad);
    else if (d.routeDel) { state.routes = state.routes.filter((x) => x.id !== d.routeDel); saveRoutes(); renderPanel(); }
    else if (d.act === 'chargeAdd') openChargeForm('');
    else if (d.act === 'chargeCsv') exportCharges();
    else if (d.act === 'chargeCancel') { state.chargeForm = null; renderPanel(); }
    else if (d.chdel) deleteCharge(d.chdel);
    else if (d.act === 'car') openCarDialog();
    else if (d.act === 'carOnly' && state.car) { state.car.onlyCompatible = !state.car.onlyCompatible; saveProfile(); state.detailId = null; renderAll(); }
    else if (d.act === 'routeClear') { state.route = null; renderAll(); }
    else if (el.id === 'btn-car') openCarDialog();
    else if (el.id === 'q-clear') { state.filters.query = ''; renderAll(); const q = $('q'); if (q) q.focus(); }
    else if (d.pwr) { state.filters.power = state.filters.power === d.pwr ? 'any' : d.pwr; state.detailId = null; renderAll(); }
    else if (d.tab) { if (sheetLevel() === 'mini') setSheetLevel('peek'); state.tab = d.tab; state.detailId = null; renderTabs(); renderMarkers(filtered()); renderPanel(); $('panel').scrollTop = 0; }
    else if (d.prio) { state.priority = d.prio; renderPanel(); }
    else if (d.detail) { openDetail(d.detail, true); setSheetOpen(true); }
    else if (el.id === 'btn-back') closeDetail();
    else if (el.id === 'btn-locate') locate({ zoom: 15 });
    else if (el.id === 'btn-gps') locate({ zoom: 16 });
    else if (el.id === 'btn-retry') { setStatus('loading'); loadStations(true); loadLive(true); }
    else if (el.id === 'grab') { if (!dragSuppressClick) setSheetLevel(sheetLevel() === 'peek' ? 'full' : 'peek'); }
    else if (el.id === 'btn-lang') { lang = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]; store.set('ur_lang', lang); renderAll(); }
    else if (el.id === 'btn-theme') {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      store.set('ur_theme', state.theme);
      document.documentElement.dataset.theme = state.theme;
      setTiles();
      renderAll();
    }
  });

  // поиск по названию, адресу и сети: перерисовываем только список, поле остаётся в фокусе
  let searchTimer;
  document.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'q') {
      state.filters.query = e.target.value;
      const x = $('q-clear');
      if (x) x.hidden = !e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { renderMarkers(filtered()); renderListBody(); }, 160);
    } else if (id === 'route-from') state.routeForm.from = e.target.value;
    else if (id === 'route-to') state.routeForm.to = e.target.value;
    else if (id === 'route-soc') state.routeForm.soc = parseFloat(e.target.value) || 90;
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'route-form') { e.preventDefault(); findRoute(); }
    else if (e.target.id === 'charge-form') { e.preventDefault(); submitCharge(); }
  });
  document.addEventListener('input', (e) => {
    const cf = state.chargeForm;
    if (!cf) return;
    if (e.target.id === 'ch-kwh') cf.kwh = e.target.value;
    else if (e.target.id === 'ch-eur') cf.eur = e.target.value;
    else if (e.target.id === 'ch-name') cf.name = e.target.value;
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'sel-operator') { state.filters.operator = e.target.value; renderAll(); }
  });

  /* ---------- окно «Моя машина» ---------- */
  let carDlgIdx = 0; // какая машина из гаража открыта в окне (равна длине списка: новая)
  function openCarDialog(sel) {
    const g = state.garage;
    carDlgIdx = sel != null ? sel : Math.max(0, g.idx);
    if (carDlgIdx > g.list.length) carDlgIdx = g.list.length;
    const c = g.list[carDlgIdx] || Object.assign({}, UR.CARS[0], { onlyCompatible: true });
    const pr = state.prefs;
    const field = (id, label, val, hint, step) =>
      '<label class="fld"><span>' + esc(label) + '</span><input id="' + id + '" type="text" inputmode="decimal" value="' + esc(val == null ? '' : String(val).replace('.', ',')) + '"' + (hint ? ' placeholder="' + esc(hint) + '"' : '') + '></label>';
    const conns = [['ccs', 'CCS'], ['type2', 'Type 2'], ['chademo', 'CHAdeMO']];
    const modelName = (UR.CARS.find((m) => m.id === c.id) || {}).name;
    const garage = '<div class="garage">' +
      g.list.map((x, i) => '<button type="button" class="chip" data-garage="' + i + '" aria-pressed="' + (i === carDlgIdx) + '">' + esc(x.name) + '</button>').join('') +
      (g.list.length < 5 ? '<button type="button" class="chip" data-garage="new" aria-pressed="' + (carDlgIdx >= g.list.length) + '">' + esc(t('garageNew')) + '</button>' : '') + '</div>';
    $('car-body').innerHTML =
      (g.list.length ? garage : '') +
      '<label class="fld"><span>' + esc(t('carModel')) + '</span><select id="car-model">' +
      UR.CARS.map((m) => '<option value="' + m.id + '"' + (m.id === c.id ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>' + esc(t('carName')) + '</span><input id="car-name" type="text" maxlength="40" value="' + esc(c.name && c.name !== modelName ? c.name : '') + '"></label>' +
      '<div class="fld-grid">' + field('car-kwh', t('carKwh'), c.kwh) + field('car-cons', t('carCons'), c.cons) + field('car-dc', t('carDc'), c.dc) + field('car-ac', t('carAc'), c.ac) + '</div>' +
      '<div class="fld"><span>' + esc(t('carConn')) + '</span><div class="checks">' +
      conns.map(([id, label]) => '<label class="check"><input type="checkbox" data-conn-box="' + id + '"' + (c.conn.includes(id) ? ' checked' : '') + '><span>' + label + '</span></label>').join('') + '</div></div>' +
      '<label class="check wide"><input type="checkbox" id="car-only"' + (c.onlyCompatible ? ' checked' : '') + '><span>' + esc(t('carOnly')) + '</span></label>' +
      '<div class="fld-grid">' + field('car-petrol', t('carPetrol'), pr.petrol, t('carPetrolHint') + ' (' + fmtEur(state.petrol || 1.85) + ')') + field('car-pcons', t('carPetrolCons'), pr.petrolCons) + field('car-home', t('carHome'), pr.home, t('carHomeHint')) + '</div>';
    $('car-title').textContent = t('carTitle');
    $('car-lead').textContent = t('carLead');
    $('car-save').textContent = t('carSave');
    $('car-clear').textContent = t('carClear');
    $('car-clear').hidden = carDlgIdx >= g.list.length;
    $('car-close').setAttribute('aria-label', t('carClose'));
    $('car-dialog').hidden = false;
    $('car-model').focus();
  }
  function closeCarDialog() { $('car-dialog').hidden = true; }
  function readCarForm() {
    const val = (id) => $(id).value.trim();
    const conn = Array.from(document.querySelectorAll('[data-conn-box]')).filter((b) => b.checked).map((b) => b.dataset.connBox);
    const car = UR.normalizeCar({ id: val('car-model'), name: val('car-name'), kwh: val('car-kwh'), cons: val('car-cons'), dc: val('car-dc'), ac: val('car-ac'), conn, onlyCompatible: $('car-only').checked });
    const num = (id, lo, hi) => { const n = parseFloat(val(id).replace(',', '.')); return isFinite(n) && n >= lo && n <= hi ? n : null; };
    return { car, prefs: { petrol: num('car-petrol', 0.5, 5), petrolCons: num('car-pcons', 2, 25) || 7, home: num('car-home', 0.01, 2) } };
  }
  function saveCarDialog() {
    const r = readCarForm();
    const g = state.garage;
    if (carDlgIdx >= g.list.length) { g.list.push(r.car); carDlgIdx = g.list.length - 1; } else g.list[carDlgIdx] = r.car;
    g.idx = carDlgIdx;
    state.car = r.car;
    state.prefs = r.prefs;
    saveProfile();
    closeCarDialog();
    loadWeather();
    state.detailId = null;
    renderAll();
  }
  $('car-save').addEventListener('click', saveCarDialog);
  $('car-close').addEventListener('click', closeCarDialog);
  $('car-clear').addEventListener('click', () => {
    const g = state.garage;
    if (carDlgIdx < g.list.length) g.list.splice(carDlgIdx, 1);
    g.idx = Math.min(g.idx, g.list.length - 1);
    state.car = g.list[g.idx] || null;
    if (!state.car) state.tempC = null;
    saveProfile();
    closeCarDialog();
    renderAll();
  });
  $('car-dialog').addEventListener('click', (e) => {
    if (e.target === $('car-dialog')) { closeCarDialog(); return; }
    const b = e.target.closest('[data-garage]');
    if (b) openCarDialog(b.dataset.garage === 'new' ? state.garage.list.length : parseInt(b.dataset.garage, 10));
  });
  // выбор модели подставляет её данные в поля; правки руками сохраняются до следующей смены модели
  $('car-dialog').addEventListener('change', (e) => {
    if (e.target.id !== 'car-model') return;
    const m = UR.CARS.find((x) => x.id === e.target.value);
    if (!m) return;
    const set = (id, v) => { $(id).value = String(v).replace('.', ','); };
    set('car-kwh', m.kwh); set('car-cons', m.cons); set('car-dc', m.dc); set('car-ac', m.ac);
    document.querySelectorAll('[data-conn-box]').forEach((b) => { b.checked = m.conn.includes(b.dataset.connBox); });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('car-dialog').hidden) closeCarDialog(); });

  /* ярлыки на рабочем столе и ссылки: ?tab=fav, ?go=free */
  function applyShortcut() {
    const p = state.pending;
    if (!p) return;
    if (p.tab && ['go', 'list', 'route', 'fav', 'prices'].includes(p.tab)) {
      state.tab = p.tab;
      p.tab = null;
      renderTabs();
      renderPanel();
    }
    if (p.rt) {
      // ссылка на маршрут: заполняем форму и сразу считаем
      state.routeForm.from = String(p.rf || '').slice(0, 80);
      state.routeForm.to = String(p.rt).slice(0, 80);
      state.routeForm.soc = Math.max(15, Math.min(100, parseInt(p.rs, 10) || 90));
      p.rt = null;
      state.tab = 'route';
      renderTabs();
      findRoute();
    }
    if (p.go === 'free' && state.live && UR.isLiveFresh(state.live)) {
      p.go = null;
      state.tab = 'go';
      state.filters.freeNow = true;
      state.priority = 'near';
      renderAll();
    }
  }

  /* установка как приложения */
  // Chrome на Android даёт системное окно установки (beforeinstallprompt). В Safari на iPhone такого нет,
  // поэтому там и везде, где системного окна нет, показываем короткую инструкцию.
  let installEvent = null;
  const UA = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(UA);
  const isApple = isIos || /Macintosh/.test(UA);
  function isStandalone() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  function openInstallDialog() {
    const keys = isIos ? ['installIos1', 'installIos2', 'installIos3'] : isAndroid ? ['installAndroid1', 'installAndroid2', 'installAndroid3'] : ['installOther1'];
    $('install-title').textContent = t('installTitle');
    $('install-lead').textContent = t('installLead');
    $('install-steps').innerHTML = keys.map((k) => '<li>' + esc(t(k)) + '</li>').join('');
    $('install-close').textContent = t('installClose');
    $('install-dialog').hidden = false;
    $('install-close').focus();
  }
  function closeInstallDialog() {
    $('install-dialog').hidden = true;
    $('btn-install').focus();
  }

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
  window.addEventListener('appinstalled', () => { installEvent = null; $('btn-install').hidden = true; closeInstallDialog(); });
  $('btn-install').addEventListener('click', async () => {
    if (!installEvent) { openInstallDialog(); return; }
    const ev = installEvent;
    installEvent = null; // событие одноразовое
    try {
      ev.prompt();
      await ev.userChoice;
    } catch (e) { /* человек закрыл окно */ }
  });
  $('install-close').addEventListener('click', closeInstallDialog);
  $('install-dialog').addEventListener('click', (e) => { if (e.target === $('install-dialog')) closeInstallDialog(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('install-dialog').hidden) closeInstallDialog(); });

  /* ---------- запуск ---------- */
  document.documentElement.dataset.theme = state.theme;
  loadProfile();
  state.charges = (readJson('ur_charges_v1', []) || []).map((e) => UR.normalizeCharge(e)).filter(Boolean).sort((a, b) => b.ts - a.ts).slice(0, UR.CHARGE_LIMIT);
  state.amen = (() => { const a = readJson('ur_amen_v1', {}); return a && typeof a === 'object' && !Array.isArray(a) ? a : {}; })();
  state.favs = readJson('ur_favs_v1', []).filter((f) => f && f.k && isFinite(f.lat) && isFinite(f.lon));
  state.watch = readJson('ur_watch_v1', []).filter((w) => w && w.k && isFinite(w.lat) && isFinite(w.lon));
  state.timers = (readJson('ur_timers_v1', []) || []).filter((x) => x && typeof x.id === 'string' && Number.isInteger(x.at) && x.at > Date.now() - 3600000).slice(0, 5);
  state.digest = (() => { const d = readJson('ur_digest_v1', null); return d && Number.isInteger(d.hour) && d.hour >= 0 && d.hour <= 23 ? { hour: d.hour } : null; })();
  loadPushConfig().then(() => {
    if (state.watch.length || state.timers.length || state.digest) pushSync(); // обновляет подписку и срок её жизни на сервере
    if (state.tab === 'fav' && !state.detailId) renderPanel(); // кнопка сводки появляется, когда известен адрес Worker
  });
  checkTimers();
  initMap();
  applyShortcut();
  renderAll();
  loadStations(false);
  loadLive(false);
  loadPatterns();
  loadFuel();
  loadWeather();

  locateOnOpen();

  /* ---------- проверка новой версии ---------- */
  // Открытая вкладка или окно само не обновляется. Раз в несколько минут и при возврате в приложение смотрим sw.js на сервере:
  // если там другая версия, предлагаем обновиться (кнопка чистит кэши и перезагружает страницу).
  let updShown = false;
  let updChecked = 0;
  async function checkUpdate(force) {
    if (updShown || (!force && Date.now() - updChecked < 3 * 60 * 1000)) return;
    updChecked = Date.now();
    try {
      const r = await fetch('sw.js?c=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const m = /VERSION\s*=\s*'ur-(v\d+)'/.exec(await r.text());
      if (m && m[1] !== APP_VERSION) showUpdate();
    } catch (e) { /* нет сети: проверим в следующий раз */ }
  }
  function showUpdate() {
    updShown = true;
    const el = document.createElement('div');
    el.className = 'upd';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span>' + esc(t('updAvail')) + '</span><button type="button" class="btn btn-primary" id="upd-go">' + esc(t('updGo')) + '</button>';
    document.body.appendChild(el);
    $('upd-go').addEventListener('click', applyUpdate);
  }
  async function applyUpdate() {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch (e) { /* перезагрузим и так */ }
    location.reload();
  }
  setTimeout(() => checkUpdate(true), 4000);
  setInterval(() => checkUpdate(false), 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(false); });
  window.addEventListener('focus', () => checkUpdate(false));

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* работаем без офлайн-режима */ });
    });
  }
})();
