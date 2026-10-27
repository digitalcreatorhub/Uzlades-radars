"""Тесты сборщика live.json. Запуск: python3 -I tests/build_live.test.py"""
import json
import os
import sys
import unittest

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
        self.assertEqual(pts['LV*ELR*EPLVRIXPB12012CHA']['p'], 0.44)
        self.assertTrue(s['u'].startswith('2026-10-'))

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


if __name__ == '__main__':
    unittest.main()
