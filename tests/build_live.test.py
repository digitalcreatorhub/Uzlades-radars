"""Тесты сборщика live.json. Запуск: python3 -I tests/build_live.test.py"""
import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'scripts'))
import build_live  # noqa: E402

STATIC = open(os.path.join(HERE, '..', 'data', 'sample_static.xml'), 'rb').read()
STATUS = open(os.path.join(HERE, 'fixtures', 'status_small.xml'), 'rb').read()


class BuildLive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = build_live.build(STATIC, STATUS)
        cls.by_id = {s['id']: s for s in cls.live['sites']}

    def test_static_parsed(self):
        sites = build_live.parse_static(STATIC)
        self.assertEqual(len(sites), 241)
        s = sites['2a9bfe1e-bb5e-4a56-9bf4-d6bb0bac2322']
        self.assertAlmostEqual(s['lat'], 56.96133, places=4)
        self.assertAlmostEqual(s['lon'], 24.10622, places=4)
        self.assertEqual(s['op'], 'Elektrum Drive')
        self.assertEqual(s['c'], 'Rīga')
        self.assertEqual(s['a'], 'Pulkveža Brieža iela 12')
        self.assertEqual(s['h'], '24/7')
        self.assertEqual(len(s['pts']), 6)

    def test_connector_and_power_mapping(self):
        s = build_live.parse_static(STATIC)['2a9bfe1e-bb5e-4a56-9bf4-d6bb0bac2322']
        pts = {p['e']: p for p in s['pts']}
        cha = pts['LV*ELR*EPLVRIXPB12012CHA']
        self.assertEqual((cha['t'], cha['m'], cha['kw']), ('chademo', 'dc', 100.0))
        ccs = pts['LV*ELR*EPLVRIXPB12011CCS']
        self.assertEqual((ccs['t'], ccs['m'], ccs['kw']), ('ccs', 'dc', 150.0))

    def test_status_joined_by_evse(self):
        s = self.by_id['2a9bfe1e-bb5e-4a56-9bf4-d6bb0bac2322']
        pts = {p['e']: p for p in s['pts']}
        self.assertEqual(pts['LV*ELR*EPLVRIXPB12012CHA']['s'], 'free')
        # в потоке 0,44 без НДС, в live.json цена уже с НДС 21%
        self.assertEqual(pts['LV*ELR*EPLVRIXPB12012CHA']['p'], 0.532)
        self.assertTrue(s['u'].startswith('2026-10-'))

    def test_price_with_vat_only_when_not_included(self):
        raw = STATUS.replace(b'<fac:taxIncluded>false</fac:taxIncluded>', b'<fac:taxIncluded>true</fac:taxIncluded>', 1)
        _, status = build_live.parse_status(raw)
        self.assertEqual(status['LV*ELR*EPLVRIXPB12012CHA']['p'], 0.44)  # налог уже включён: не трогаем
        _, status = build_live.parse_status(STATUS)
        self.assertEqual(status['LV*ELR*EPLVRIXPB12012CHA']['p'], 0.532)

    def test_status_values_mapped(self):
        allowed = {'free', 'busy', 'out', 'unk'}
        got = {p['s'] for s in self.live['sites'] for p in s['pts']}
        self.assertTrue(got <= allowed, got)
        self.assertIn('busy', got)

    def test_points_without_status_are_unknown(self):
        # в маленькой фикстуре статус есть лишь у нескольких площадок
        untouched = [p for s in self.live['sites'] for p in s['pts'] if p['e'].startswith('LV*ELR*EPLVAIVAHES')]
        self.assertTrue(untouched)
        self.assertTrue(all(p['s'] == 'unk' and 'p' not in p for p in untouched))

    def test_status_time_and_stats(self):
        self.assertEqual(self.live['statusTime'][:10], '2026-10-27')
        st = self.live['stats']
        self.assertEqual(st['sites'], 241)
        self.assertGreater(st['pointsWithStatus'], 0)

    def test_json_is_compact_and_serialisable(self):
        raw = json.dumps(self.live, ensure_ascii=False, separators=(',', ':'))
        self.assertLess(len(raw), 250_000)
        self.assertEqual(json.loads(raw)['v'], 1)

    def test_broken_site_without_coordinates_is_skipped(self):
        bad = STATIC.replace(b'<loc:latitude>56.96133033</loc:latitude>', b'')
        sites = build_live.parse_static(bad)
        self.assertNotIn('2a9bfe1e-bb5e-4a56-9bf4-d6bb0bac2322', sites)


class PaymentAndSince(unittest.TestCase):
    def test_payment_methods_mapped(self):
        sites = build_live.parse_static(STATIC)
        s = sites['2a9bfe1e-bb5e-4a56-9bf4-d6bb0bac2322']
        self.assertEqual(s['pay'], ['app', 'rfid'])
        allpay = {m for x in sites.values() for m in x['pay']}
        self.assertTrue(allpay <= {'app', 'rfid', 'card'}, allpay)
        self.assertIn('card', allpay)

    def test_unknown_payment_method_is_ignored(self):
        raw = STATIC.replace(b'<egi:authenticationAndIdentificationMethods>rfid<', b'<egi:authenticationAndIdentificationMethods>telepathy<', 1)
        sites = build_live.parse_static(raw)
        for x in sites.values():
            self.assertNotIn('telepathy', x['pay'])

    def test_busy_points_carry_status_change_time(self):
        live = build_live.build(STATIC, STATUS)
        busy = [p for s in live['sites'] for p in s['pts'] if p.get('s') == 'busy']
        free = [p for s in live['sites'] for p in s['pts'] if p.get('s') == 'free']
        self.assertTrue(busy and free)
        self.assertTrue(all(isinstance(p.get('u'), int) and p['u'] > 29_000_000 for p in busy))
        self.assertTrue(all('u' not in p for p in free), 'у свободных точек время не храним: экономим размер')


def fake_live(status_time, states):
    return {'statusTime': status_time, 'sites': [{'id': 'S1', 'pts': [{'s': x} for x in states]}]}


class History(unittest.TestCase):
    def utc(self, s):
        return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)

    def test_bucket_uses_riga_time_and_weekend(self):
        # вторник 27.10.2026 10:00 UTC = 12:00 в Риге (зима, UTC+2): будни, час 12
        self.assertEqual(build_live.bucket_of(self.utc('2026-10-27T10:00:00')), 12)
        # суббота 31.10.2026 22:30 UTC = воскресенье 00:30 в Риге: выходные, час 0
        self.assertEqual(build_live.bucket_of(self.utc('2026-10-31T22:30:00')), 24)
        # пятница 30.10 22:30 UTC = суббота 00:30 в Риге: выходные
        self.assertEqual(build_live.bucket_of(self.utc('2026-10-30T22:30:00')), 24)

    def test_accumulates_busy_share_and_ignores_duplicates(self):
        now = self.utc('2026-10-27T10:05:00')
        st = build_live.empty_history(now)
        self.assertTrue(build_live.update_history(st, fake_live('2026-10-27T10:00:00+00:00', ['busy', 'free', 'free', 'out']), now))
        self.assertAlmostEqual(st['sites']['S1']['s'][12], 1 / 3, places=3)  # занято 1 из 3 рабочих
        self.assertEqual(st['sites']['S1']['n'][12], 1)
        # тот же снимок второй раз не считаем
        self.assertFalse(build_live.update_history(st, fake_live('2026-10-27T10:00:00+00:00', ['busy']), now))
        self.assertEqual(st['sites']['S1']['n'][12], 1)

    def test_stale_feed_and_all_unknown_are_skipped(self):
        now = self.utc('2026-10-27T10:05:00')
        st = build_live.empty_history(now)
        self.assertFalse(build_live.update_history(st, fake_live('2026-10-27T07:00:00+00:00', ['busy']), now))
        self.assertTrue(build_live.update_history(st, fake_live('2026-10-27T10:00:00+00:00', ['unk', 'out']), now))
        self.assertNotIn('S1', st['sites'])

    def test_patterns_need_enough_samples(self):
        now = self.utc('2026-10-27T10:05:00')
        st = build_live.empty_history(now)
        st['sites']['S1'] = {'s': [0.0] * 48, 'n': [0] * 48}
        # меньше порога: картины нет
        st['sites']['S1']['n'][12] = build_live.MIN_SAMPLES - 1
        st['sites']['S1']['s'][12] = (build_live.MIN_SAMPLES - 1) * 0.5
        self.assertNotIn('S1', build_live.render_patterns(st, now)['sites'])
        # порог набран: в среднем занято 25%
        st['sites']['S1']['n'][12] = build_live.MIN_SAMPLES
        st['sites']['S1']['s'][12] = build_live.MIN_SAMPLES * 0.25
        row = build_live.render_patterns(st, now)['sites']['S1']
        self.assertEqual(len(row), 48)
        self.assertEqual(row[12], 25)
        self.assertEqual(row.count(-1), 47, 'остальные корзины без данных')

    def test_repeated_runs_build_up_samples(self):
        st = build_live.empty_history(self.utc('2026-11-03T10:00:00'))
        for i in range(build_live.MIN_SAMPLES):
            t = '2026-11-%02dT10:00:00+00:00' % (2 + i)  # ноябрь: зимнее время, 10:00 UTC = 12:00 в Риге
            now = self.utc(t[:19])
            build_live.update_history(st, fake_live(t, ['busy', 'free']), now)
        wd = [i for i in range(24) if st['sites']['S1']['n'][i] > 0]
        we = [i for i in range(24, 48) if st['sites']['S1']['n'][i] > 0]
        self.assertEqual(wd, [12])
        self.assertEqual(we, [36])
        self.assertEqual(st['sites']['S1']['n'][12] + st['sites']['S1']['n'][36], build_live.MIN_SAMPLES)

    def test_reliability_counts_out_share_and_needs_enough_snapshots(self):
        st = build_live.empty_history(self.utc('2026-11-03T10:00:00'))
        for i in range(build_live.REL_MIN):
            t = '2026-11-03T%02d:%02d:00+00:00' % (i // 60 % 24, i % 60)
            now = self.utc(t[:19]) + timedelta(minutes=5)
            # одна точка из четырёх не работает, остальные работают
            build_live.update_history(st, fake_live(t, ['out', 'free', 'busy', 'free']), now)
        self.assertEqual(st['rel']['S1'][1], build_live.REL_MIN)
        pat = build_live.render_patterns(st, now)
        self.assertEqual(pat['rel']['S1'], [25, build_live.REL_MIN])
        # меньше порога: ничего не показываем
        st['rel']['S1'][1] = build_live.REL_MIN - 1
        self.assertNotIn('S1', build_live.render_patterns(st, now)['rel'])

    def test_all_out_site_is_counted_even_without_busy_or_free(self):
        now = self.utc('2026-10-27T10:05:00')
        st = build_live.empty_history(now)
        build_live.update_history(st, fake_live('2026-10-27T10:00:00+00:00', ['out', 'out']), now)
        self.assertEqual(st['rel']['S1'], [1.0, 1])
        self.assertNotIn('S1', st['sites'])

    def test_price_change_is_recorded_and_reported_when_recent(self):
        def live_with_price(t, price):
            return {'statusTime': t, 'sites': [{'id': 'S1', 'pts': [{'s': 'free', 'kw': 150, 'p': price}, {'s': 'free', 'kw': 22, 'p': 0.2}]}]}
        st = build_live.empty_history(self.utc('2026-10-20T10:00:00'))
        build_live.update_history(st, live_with_price('2026-10-20T10:00:00+00:00', 0.41), self.utc('2026-10-20T10:05:00'))
        build_live.update_history(st, live_with_price('2026-10-21T10:00:00+00:00', 0.41), self.utc('2026-10-21T10:05:00'))
        self.assertEqual(st['px']['S1'], [['2026-10-20', 0.41]], 'без смены запись не растёт, цена берётся у самых быстрых точек')
        self.assertNotIn('S1', build_live.render_patterns(st, self.utc('2026-10-21T12:00:00'))['px'])
        build_live.update_history(st, live_with_price('2026-10-27T10:00:00+00:00', 0.44), self.utc('2026-10-27T10:05:00'))
        self.assertEqual(build_live.render_patterns(st, self.utc('2026-10-27T12:00:00'))['px']['S1'], [0.44, 0.41, '2026-10-27'])
        # смена старше двух недель уже не новость
        self.assertNotIn('S1', build_live.render_patterns(st, self.utc('2026-11-20T12:00:00'))['px'])


def pt(e, s, u=None, kw=50):
    d = {'e': e, 's': s, 'kw': kw}
    if u is not None:
        d['u'] = u
    return d


def live_pts(status_time, pts):
    return {'statusTime': status_time, 'sites': [{'id': 'S1', 'pts': pts}]}


class Durations(unittest.TestCase):
    def utc(self, s):
        return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)

    def minutes(self, s):
        return int(self.utc(s).timestamp() // 60)

    def test_session_length_is_measured_from_busy_start_to_midpoint_between_snapshots(self):
        st = build_live.empty_history(self.utc('2026-10-27T10:00:00'))
        start = self.minutes('2026-10-27T09:00:00')
        self.assertTrue(build_live.update_history(st, live_pts('2026-10-27T10:00:00+00:00', [pt('E1', 'busy', start)]), self.utc('2026-10-27T10:01:00')))
        self.assertEqual(st['busy'], {'E1': start})
        self.assertFalse(st.get('dur'))
        # через 15 минут точка свободна: зарядка кончилась между 10:00 и 10:15, середина 10:07:30, значит ≈ 67 минут
        self.assertTrue(build_live.update_history(st, live_pts('2026-10-27T10:15:00+00:00', [pt('E1', 'free')]), self.utc('2026-10-27T10:16:00')))
        self.assertEqual(st['dur']['S1'], [[67, 50]])
        self.assertEqual(st['busy'], {})

    def test_gap_between_snapshots_and_absurd_lengths_are_ignored(self):
        st = build_live.empty_history(self.utc('2026-10-27T10:00:00'))
        build_live.update_history(st, live_pts('2026-10-27T10:00:00+00:00', [pt('E1', 'busy', self.minutes('2026-10-27T09:00:00')), pt('E2', 'busy', self.minutes('2026-10-25T09:00:00'))]), self.utc('2026-10-27T10:01:00'))
        # следующий снимок через 3 часа: когда освободились, неизвестно
        build_live.update_history(st, live_pts('2026-10-27T13:00:00+00:00', [pt('E1', 'free'), pt('E2', 'free')]), self.utc('2026-10-27T13:01:00'))
        self.assertFalse(st.get('dur'))
        # а вот двое суток занятости при нормальном интервале отбрасываются как ночёвка
        build_live.update_history(st, live_pts('2026-10-27T13:15:00+00:00', [pt('E2', 'busy', self.minutes('2026-10-25T09:00:00'))]), self.utc('2026-10-27T13:16:00'))
        build_live.update_history(st, live_pts('2026-10-27T13:30:00+00:00', [pt('E2', 'free')]), self.utc('2026-10-27T13:31:00'))
        self.assertFalse(st.get('dur'))

    def test_points_without_id_do_not_break_and_median_needs_enough_sessions(self):
        st = build_live.empty_history(self.utc('2026-10-27T10:00:00'))
        self.assertTrue(build_live.update_history(st, fake_live('2026-10-27T10:00:00+00:00', ['busy', 'free']), self.utc('2026-10-27T10:01:00')))
        st['dur'] = {'S1': [[30, 50], [50, 50], [40, 50], [20, 7], [25, 7]], 'S2': [[10, 22]]}
        pat = build_live.render_patterns(st, self.utc('2026-10-27T10:30:00'))
        self.assertNotIn('s', pat['dur'].get('S1', {}))  # медленных всего 2 из 4 нужных
        self.assertNotIn('S2', pat['dur'])
        st['dur']['S1'] += [[60, 50], [35, 50]]
        pat = build_live.render_patterns(st, self.utc('2026-10-27T10:30:00'))
        self.assertEqual(pat['dur']['S1']['f'], [40, 5])  # 30, 35, 40, 50, 60


if __name__ == '__main__':
    unittest.main()
