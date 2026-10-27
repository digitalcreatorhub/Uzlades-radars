#!/usr/bin/env python3
"""Собирает live.json для приложения из двух наборов национальной точки доступа (NAP, transportdata.gov.lv):

  * статический набор Eco-Movement (DATEX II EnergyInfrastructureTable): координаты, адреса,
    разъёмы, мощность. Обновляется раз в сутки;
  * набор статусов и цен Eco-Movement (DATEX II EnergyInfrastructureStatus): свободно / занято
    и цена за кВт·ч. Обновляется раз в 15 минут.

Оба набора под лицензией CC0. Точки зарядки сводятся по EVSE-коду
(в статике это fac:externalIdentifier, в статусах ссылка refillPointStatus).

Использование:
  build_live.py --static STATIC.xml --status STATUS.xml --out live.json     # из файлов (тесты)
  build_live.py --fetch --out live.json                                      # из NAP по ключам в окружении

Ключи (окружение): NPP_API_KEY (статусы), NPP_API_KEY_INFRA (статика, необязателен).
Без ключа статики берётся публичный образец из репозитория: он покрывает лишь часть точек.
Только стандартная библиотека. Ключи нигде не печатаются.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

BASE = 'https://www.transportdata.gov.lv'
SAMPLE_STATIC = os.path.join(os.path.dirname(__file__), '..', 'data', 'sample_static.xml')

CONNECTOR = {
    'iec62196T2': 'type2',
    'iec62196T2COMBO': 'ccs',
    'chademo': 'chademo',
    'teslaS': 'tesla',
    'teslaR': 'tesla',
    'teslaConnector': 'tesla',
}
STATUS = {
    'available': 'free',
    'charging': 'busy',
    'blocked': 'busy',
    'reserved': 'busy',
    'inoperative': 'out',
    'outOfOrder': 'out',
    'closed': 'out',
}


def local(tag):
    """Имя тега без пространства имён."""
    return tag.rsplit('}', 1)[-1]


def children(el, name):
    return [c for c in el if local(c.tag) == name]


def child(el, name):
    for c in el:
        if local(c.tag) == name:
            return c
    return None


def text_of(el, *path):
    """Текст вложенного элемента по цепочке имён; None, если чего-то нет."""
    cur = el
    for name in path:
        cur = child(cur, name) if cur is not None else None
    if cur is None or cur.text is None:
        return None
    t = cur.text.strip()
    return t or None


def first_value(el):
    """Первое значение из <name><values><value>…</value></values></name>."""
    if el is None:
        return None
    for v in el.iter():
        if local(v.tag) == 'value' and v.text and v.text.strip():
            return v.text.strip()
    return None


def parse_static(data):
    """Возвращает (sites, evse_index). sites: id -> описание площадки; evse_index: evse -> точка."""
    root = ET.fromstring(data)
    sites = {}
    for site in root.iter():
        if local(site.tag) != 'energyInfrastructureSite':
            continue
        sid = site.get('id')
        lat = lon = None
        addr = city = None
        for el in site.iter():
            n = local(el.tag)
            if n == 'latitude' and lat is None:
                lat = float(el.text)
            elif n == 'longitude' and lon is None:
                lon = float(el.text)
            elif n == 'city' and city is None:
                city = (el.text or '').strip() or None
            elif n == 'text' and addr is None:
                addr = (el.text or '').strip() or None
        if sid is None or lat is None or lon is None:
            continue
        hours_el = child(site, 'operatingHours')
        hours_type = (hours_el.get('{http://www.w3.org/2001/XMLSchema-instance}type') or '') if hours_el is not None else ''
        op_el = child(site, 'operator')
        pts = []
        for ref in site.iter():
            if local(ref.tag) != 'refillPoint':
                continue
            evse = text_of(ref, 'externalIdentifier')
            conn = child(ref, 'connector')
            if not evse or conn is None:
                continue
            ctype = text_of(conn, 'connectorType') or ''
            mode = text_of(conn, 'chargingMode') or ''
            try:
                kw = round(float(text_of(conn, 'maxPowerAtSocket')) / 1000.0, 1)
            except (TypeError, ValueError):
                kw = None
            pts.append({
                'e': evse,
                't': CONNECTOR.get(ctype, 'other'),
                'm': 'dc' if 'DC' in mode else ('ac' if 'AC' in mode else None),
                'kw': kw,
            })
        if not pts:
            continue
        sites[sid] = {
            'id': sid,
            'n': first_value(child(site, 'name')),
            'op': first_value(child(op_el, 'name')) if op_el is not None else None,
            'lat': round(lat, 6),
            'lon': round(lon, 6),
            'a': addr,
            'c': city,
            'h': '24/7' if hours_type.endswith('OpenAllHours') else ('custom' if hours_type else None),
            'pts': pts,
        }
    return sites


def parse_status(data):
    """Возвращает (время публикации, evse -> {'s': статус, 'p': цена, 'u': обновлено})."""
    root = ET.fromstring(data)
    pub = text_of(root, 'publicationTime')
    out = {}
    for st in root.iter():
        if local(st.tag) != 'energyInfrastructureStationStatus':
            continue
        updated = text_of(st, 'lastUpdated')
        prices = []
        for rl in st.iter():
            if local(rl.tag) == 'rateLine' and text_of(rl, 'rateLineType') == 'perUnit':
                try:
                    prices.append(float(text_of(rl, 'value')))
                except (TypeError, ValueError):
                    pass
        for rp in children(st, 'refillPointStatus'):
            ref = child(rp, 'reference')
            evse = ref.get('id') if ref is not None else None
            if not evse:
                continue
            raw = text_of(rp, 'status') or 'unknown'
            rec = {'s': STATUS.get(raw, 'unk'), 'u': updated}
            if prices:
                rec['p'] = min(prices)
                if max(prices) != min(prices):
                    rec['pm'] = max(prices)
            out[evse] = rec
    return pub, out


def build(static_xml, status_xml, source='api'):
    sites = parse_static(static_xml)
    pub, status = parse_status(status_xml)
    result = []
    matched = 0
    for site in sites.values():
        newest = None
        for p in site['pts']:
            st = status.get(p['e'])
            if st:
                matched += 1
                p['s'] = st['s']
                if 'p' in st:
                    p['p'] = st['p']
                    if 'pm' in st:
                        p['pm'] = st['pm']
                if st['u'] and (newest is None or st['u'] > newest):
                    newest = st['u']
            else:
                p['s'] = 'unk'
        site['u'] = newest
        result.append(site)
    result.sort(key=lambda s: (s['c'] or '', s['id']))
    return {
        'v': 1,
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'statusTime': pub,
        'staticSource': source,
        'stats': {
            'sites': len(result),
            'points': sum(len(s['pts']) for s in result),
            'pointsWithStatus': matched,
            'statusRecords': len(status),
        },
        'sites': result,
    }


def api_get_xml(key, label):
    """Список файлов набора по ключу, затем скачивание самого свежего XML."""
    def call(url, body=None):
        req = urllib.request.Request(url, data=body, headers={'x-api-key': key})
        if body is not None:
            req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.read()

    files = json.loads(call(BASE + '/api/v1/metadata/file/info')).get('files') or []
    files = [f for f in files if str(f.get('file_name', '')).lower().endswith('.xml')] or files
    if not files:
        raise RuntimeError(label + ': в наборе нет файлов')
    fid = str(max(files, key=lambda f: int(f['file_id']))['file_id'])
    body = json.dumps({'file_id': fid, 'format': 'xml'}).encode()
    data = call(BASE + '/api/v1/get/file/download-file', body)
    print('%s: файл %s, %d байт' % (label, fid, len(data)), file=sys.stderr)
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--static')
    ap.add_argument('--status')
    ap.add_argument('--fetch', action='store_true')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    source = 'file'
    if a.fetch:
        key = os.environ.get('NPP_API_KEY', '')
        if not key:
            print('Нет NPP_API_KEY', file=sys.stderr)
            return 2
        try:
            status_xml = api_get_xml(key, 'статусы')
        except (urllib.error.URLError, RuntimeError, ValueError, KeyError) as e:
            print('Статусы не получены: %s' % e, file=sys.stderr)
            return 3
        static_xml = None
        infra_key = os.environ.get('NPP_API_KEY_INFRA', '')
        if infra_key:
            try:
                static_xml = api_get_xml(infra_key, 'статика')
                source = 'api'
            except (urllib.error.URLError, RuntimeError, ValueError, KeyError) as e:
                print('Статика по ключу не получена (%s), беру образец' % e, file=sys.stderr)
        if static_xml is None:
            with open(SAMPLE_STATIC, 'rb') as f:
                static_xml = f.read()
            source = 'sample'
    else:
        with open(a.static, 'rb') as f:
            static_xml = f.read()
        with open(a.status, 'rb') as f:
            status_xml = f.read()

    live = build(static_xml, status_xml, source)
    if live['stats']['pointsWithStatus'] == 0:
        print('Ни одна точка не получила статус: файл не записан', file=sys.stderr)
        return 4
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(live, f, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps(live['stats'], ensure_ascii=False), 'источник статики:', live['staticSource'], file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
