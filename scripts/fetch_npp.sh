#!/usr/bin/env bash
# Скачивает данные национальной точки доступа (transportdata.gov.lv) в data/raw.
# Ключи берутся из переменных окружения NPP_API_KEY (набор по зарядкам) и
# NPP_API_KEY_PRICES (набор с ценами). Ключи нигде не печатаются.
# Использование: bash scripts/fetch_npp.sh <dataset_id> [<dataset_id> ...]
set -u

BASE="https://www.transportdata.gov.lv"
OUT="data/raw"
mkdir -p "$OUT"
LOG="$OUT/_log.txt"
: > "$LOG"

say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }

# 1) описание наборов: открытый запрос, ключ не нужен
for id in "$@"; do
  code=$(curl -sS -m 60 -o "$OUT/meta_$id.json" -w '%{http_code}' \
    "$BASE/lv/public/metadata/data?dataset_id=$id" 2>>"$LOG" || echo 000)
  say "metadata $id -> HTTP $code ($(wc -c < "$OUT/meta_$id.json" 2>/dev/null || echo 0) bytes)"
done

# 1b) описание набора по номеру (nid) и каталог всех наборов в формате DCAT
for nid in ${NPP_EXTRA_NIDS:-429625}; do
  code=$(curl -sS -m 60 -o "$OUT/meta_nid_$nid.json" -w '%{http_code}' \
    "$BASE/lv/public/metadata/data?dataset_id=$nid" 2>>"$LOG" || echo 000)
  say "metadata nid $nid -> HTTP $code ($(wc -c < "$OUT/meta_nid_$nid.json" 2>/dev/null || echo 0) bytes)"
done
if [ -n "${NPP_API_KEY:-}" ]; then
  code=$(curl -sS -m 90 -o "$OUT/catalog_dcat.xml" -w '%{http_code}' \
    -H "x-api-key: $NPP_API_KEY" "$BASE/api/v1/subscriber/metadata_dcat" 2>>"$LOG" || echo 000)
  say "catalog dcat -> HTTP $code ($(wc -c < "$OUT/catalog_dcat.xml" 2>/dev/null || echo 0) bytes)"
fi

# 2) список файлов и снимок данных: нужен ключ набора в заголовке x-api-key
fetch_with_key() {
  local name="$1" key="$2"
  if [ -z "$key" ]; then
    say "$name: ключ не задан, пропускаю"
    return
  fi
  local code
  code=$(curl -sS -m 60 -o "$OUT/files_$name.json" -w '%{http_code}' \
    -H "x-api-key: $key" "$BASE/api/v1/metadata/file/info" 2>>"$LOG" || echo 000)
  say "$name file list -> HTTP $code"

  # file_id из списка файлов; для потока изменений нужен "1"
  local ids
  ids=$( { jq -r '.. | objects | (.file_id? // .id? // empty)' "$OUT/files_$name.json" 2>/dev/null; echo 1; } \
    | sort -u | head -n 5)

  local fid fmt f
  for fid in $ids; do
    for fmt in xml; do
      f="$OUT/${name}_${fid}.${fmt}"
      code=$(curl -sS -m 120 -o "$f" -w '%{http_code}' -X POST \
        -H "x-api-key: $key" -H 'Content-Type: application/json' \
        -d "{\"file_id\":\"$fid\",\"format\":\"$fmt\"}" \
        "$BASE/api/v1/get/file/download-file" 2>>"$LOG" || echo 000)
      say "$name download file_id=$fid format=$fmt -> HTTP $code ($(wc -c < "$f" 2>/dev/null || echo 0) bytes)"
      [ "$code" = "200" ] || rm -f "$f"
    done
  done
}

fetch_with_key ev "${NPP_API_KEY:-}"
fetch_with_key prices "${NPP_API_KEY_PRICES:-}"

# слишком большие файлы в репозиторий не кладём
find "$OUT" -type f -size +20M -print -delete | while read -r big; do say "удалён слишком большой файл: $big"; done
exit 0
