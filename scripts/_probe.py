# Временная разведка: публичные карточки и образцы файлов наборов transportdata.gov.lv
import json, os, sys, urllib.request, urllib.parse
BASE = 'https://www.transportdata.gov.lv'
items = json.load(open('scripts/_probe_nids.json', encoding='utf-8'))
os.makedirs('probe/samples', exist_ok=True)
summary = []
def get(url, limit=4_000_000):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 uzlades-probe'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.read(limit + 1)[:limit]
for it in items:
    nid = it['nid']
    row = {'nid': nid, 'title': it['title']}
    try:
        st, body = get(BASE + '/lv/public/metadata/data?dataset_id=' + nid)
        meta = json.loads(body)
        m = meta[0] if isinstance(meta, list) else meta
        for k in ('field_dataset_visibility', 'field_update_frequency', 'field_communication_method', 'field_data_format_model',
                  'field_data_format_schema', 'field_field_data_format_syntax', 'field_field_data_sample', 'field_subscibers_count',
                  'field_licence_conditions', 'field_dataset_description', 'field_publisher_name', 'field_source_url', 'field_snapshot_url'):
            row[k] = m.get(k)
        sample = m.get('field_field_data_sample') or ''
        if sample:
            url = sample if sample.startswith('http') else BASE + urllib.parse.quote(sample, safe='/%:?=&')
            try:
                st2, data = get(url)
                fn = 'probe/samples/%s_%s' % (nid, os.path.basename(sample.split('?')[0])[:60].replace(' ', '_'))
                open(fn, 'wb').write(data)
                row['sample_http'] = st2
                row['sample_bytes'] = len(data)
                row['sample_file'] = fn
            except Exception as e:
                row['sample_error'] = str(e)[:120]
    except Exception as e:
        row['meta_error'] = str(e)[:160]
    summary.append(row)
    print(nid, row.get('field_communication_method'), row.get('sample_http'), row.get('sample_bytes'), row.get('meta_error', ''), file=sys.stderr)
json.dump(summary, open('probe/summary.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
