"""사건연구 — 정책 전후에 무엇이 언제 반응했는가 (Ⅷ장).

실행: python3 -m src.analysis.events   (lags.py 이후 — bundle에 "events" 병합)
방법: 사건월 T=0 기준 T-12~T+12의 변환값(YoY·차분) 경로를,
      사건 전 12개월 평균·표준편차 대비 이탈(z)로 표준화.
      첫 반응 = |z|>1 첫 달 · 최대 반응 = |z| 최대 달.
한계(화면 계약): 비교군 없음(전국 단일 경로) · 동시 사건 중첩 · 인과 주장 아님.
"""

import json
from pathlib import Path

from src.analysis.lags import load_series, transform, _shift

ROOT = Path(__file__).resolve().parents[2]

# 정책 캘린더 — 발표일·시행일 분리. 날짜가 공적으로 확실한 사건만.
EVENTS = [
    {"id": "bigstep", "name": "기준금리 빅스텝 +0.50%p", "type": "통화",
     "announce": "2022-07-13", "effective": "2022-07-13", "t0": "202207",
     "note": "사상 첫 0.50%p 인상 — 인상기의 정점 구간 진입.",
     "concurrent": "같은 달 취득세·규제 완화 논의 병행"},
    {"id": "deregulate", "name": "규제지역 전면 해제", "type": "규제",
     "announce": "2023-01-03", "effective": "2023-01-05", "t0": "202301",
     "note": "강남 3구·용산 외 전면 해제 — 조정대상지역·투기과열지구 일괄.",
     "concurrent": "1월 말 특례보금자리론 출시와 중첩 — 효과 분리 불가"},
    {"id": "dsr1", "name": "스트레스 DSR 1단계 시행", "type": "대출",
     "announce": "2023-12-27", "effective": "2024-02-26", "t0": "202402",
     "note": "은행권 주담대 한도에 가산금리 반영 개시.",
     "concurrent": "신생아 특례대출(1월) 시행과 중첩"},
    {"id": "cut1", "name": "기준금리 인하 개시 3.50→3.25", "type": "통화",
     "announce": "2024-10-11", "effective": "2024-10-11", "t0": "202410",
     "note": "38개월 만의 인하 전환 — 인하기 진입점.",
     "concurrent": "9월 스트레스 DSR 2단계 시행 직후"},
    {"id": "loan627", "name": "6·27 가계부채 관리방안", "type": "대출",
     "announce": "2025-06-27", "effective": "2025-06-28", "t0": "202506",
     "note": "수도권 주담대 6억 원 상한 등 총량 규제.",
     "concurrent": "새 정부 초기 정책 패키지와 중첩"},
]

INDICATORS = ["거래량", "매매가", "미분양", "착공", "주담대금리"]
PRE, POST = 12, 12


def event_paths():
    S = load_series()
    T = {n: transform(n, m) for n, m in S.items()}
    out = []
    for ev in EVENTS:
        rows = []
        for ind in INDICATORS:
            m = T.get(ind, {})
            path = []
            for k in range(-PRE, POST + 1):
                ym = _shift(ev["t0"], k)
                path.append({"k": k, "v": m.get(ym)})
            pre_vals = [p["v"] for p in path if p["k"] < 0 and p["v"] is not None]
            post = [p for p in path if p["k"] >= 0 and p["v"] is not None]
            if len(pre_vals) < 8 or len(post) < 3:
                continue  # 표본 미달 지표는 정직하게 제외
            mu = sum(pre_vals) / len(pre_vals)
            sd = (sum((v - mu) ** 2 for v in pre_vals) / len(pre_vals)) ** .5 or 1
            zpath = [{"k": p["k"], "z": round((p["v"] - mu) / sd, 2) if p["v"] is not None else None}
                     for p in path]
            first = next((p["k"] for p in zpath if p["k"] >= 0 and p["z"] is not None
                          and abs(p["z"]) > 1), None)
            peaks = [p for p in zpath if p["k"] >= 0 and p["z"] is not None]
            peak = max(peaks, key=lambda p: abs(p["z"])) if peaks else None
            rows.append({"ind": ind, "z": zpath, "first": first,
                         "peak_k": peak["k"] if peak else None,
                         "peak_z": peak["z"] if peak else None,
                         "n_post": len(post)})
        out.append({**ev, "rows": rows})
        f = lambda r: (f"{r['ind']} 첫반응 {'+' + str(r['first']) + 'M' if r['first'] is not None else '없음'}"
                       f"·피크 +{r['peak_k']}M(z={r['peak_z']})")
        print(f"  {ev['name']}: " + (" / ".join(f(r) for r in rows) if rows else "관측 가능 지표 없음"))
    return out


def main():
    bp = ROOT / "out" / "site_bundle.json"
    bundle = json.load(open(bp))
    bundle["events"] = event_paths()
    json.dump(bundle, open(bp, "w"), ensure_ascii=False)
    print("병합: events →", bp)


if __name__ == "__main__":
    main()
