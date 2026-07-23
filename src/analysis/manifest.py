"""DATA_MANIFEST.json — 데이터 상태 원장(관측월 ≠ 수집일).

metrics(視差 원천: 매매·전월세·공시)와 lags(時差 원천: 금리·공급·인허가)가 각자 아는
데이터셋을 key로 upsert한다. 사이트 방법론의 '데이터 상태' 표와 빌드 스탬프의 관측
컷오프가 이 파일(=bundle["manifest"])을 읽는다. 커밋 대상(축적 기록).

한 엔트리:
  key·name·source·scope · obs_range=[관측 시작, 관측 끝] · collected_at=수집일 ·
  rows·unit · progress(1.0 또는 {done,total,pct})
관측월은 데이터가 담는 기간, 수집일은 실제로 받아온 날 — 둘은 다르다.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "DATA_MANIFEST.json"

# 표시(방법론 표) 순서 — 視差 3종 → 時差 4종
ORDER = ["rtms_sale", "rtms_rent", "gongsi",
         "ecos_rate", "treasury10y", "kosis_supply", "archub_permits", "hug_initial_rate"]


def ym_dash(ym):
    """YYYYMM → 'YYYY-MM' (관측월 표기). 6자리 아닌 값은 그대로."""
    s = str(ym)
    return f"{s[:4]}-{s[4:6]}" if len(s) == 6 and s.isdigit() else s


def _load():
    if MANIFEST.exists():
        try:
            return json.load(open(MANIFEST))
        except (json.JSONDecodeError, OSError):
            pass
    return {"datasets": []}


def upsert(entries, generated_at):
    """entries를 key 기준 in-place 병합 후 DATA_MANIFEST.json에 기록하고 병합본을 반환한다.

    다른 단계가 앞서 기록한 엔트리는 보존한다(metrics→視差, lags→時差 2단 병합).
    """
    man = _load()
    by_key = {d["key"]: d for d in man.get("datasets", [])}
    for e in entries:
        by_key[e["key"]] = e
    ds = sorted(by_key.values(),
                key=lambda d: (ORDER.index(d["key"]) if d["key"] in ORDER else 99, d["key"]))
    merged = {"generated_at": generated_at, "datasets": ds}
    json.dump(merged, open(MANIFEST, "w"), ensure_ascii=False, indent=1)
    return merged
