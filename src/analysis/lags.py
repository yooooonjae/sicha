"""時差 편 — 신호의 전달시간 계측 (Ⅴ 시차지도 · Ⅵ 시차실험실의 원료).

실행: python3 -m src.analysis.lags   (metrics.py 실행 후 — bundle에 "lag" 섹션 병합)
원천: 수지 ecos/kosis/rtms · 순환 treasury10y · 시차 rent
방법: 월별 시계열 → 변환(금리 = 12개월 차분 pp · 수량/가격 = 전년동월비 %)
      → 교차상관 r(x_t, y_{t+k}) k=0..24 스캔 → 최적 시차·안정성(전/후반 부호 일치).
표현 규칙: "예측적 선후관계이며 단독 인과효과가 아니다"(사이트 문구 계약).
"""

import json
import re
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
SUJI = Path("/Users/iseul/개발/data")
SUN = Path("/Users/iseul/순환/data")
MAX_LAG = 24


def to_map(rows):
    """ym이 YYYYMM 6자리인 행만 — 연간 합계·빈 키 행 방어."""
    return {r["ym"]: r["value"] for r in rows
            if r.get("value") is not None and re.fullmatch(r"\d{6}", str(r.get("ym") or ""))}


def load_series():
    """이름 → {ym: 원값}. 전국(수량)·표본 합산(거래) 기준."""
    S = {}
    e = json.load(open(SUJI / "ecos.json"))
    S["기준금리"] = to_map(e["base_rate"])
    S["주담대금리"] = to_map(e["mortgage_rate"])
    t = json.load(open(SUN / "treasury10y.json"))
    rows = t.get("series") or t.get("rates") or t
    S["국고10년"] = {r["ym"]: r.get("rate", r.get("value")) for r in rows
                  if isinstance(r, dict) and r.get("ym")}
    k = json.load(open(SUJI / "kosis.json"))
    for name, key in [("미분양", "unsold"), ("준공후미분양", "unsold_completed"),
                      ("인허가", "permits"), ("착공", "starts"), ("준공", "completions")]:
        S[name] = to_map(k[key]["전국"])
    r = json.load(open(SUJI / "rtms.json"))
    vol, prc = {}, {}
    for sido, guns in r["trades"].items():
        for gu, months in guns.items():
            for m in months:
                vol[m["ym"]] = vol.get(m["ym"], 0) + m["count"]
                prc.setdefault(m["ym"], []).append(m["median_price_per_m2"])
    S["거래량"] = vol
    S["매매가"] = {ym: median(v) for ym, v in prc.items()}
    rp = ROOT / "data" / "rent.json"
    if rp.exists():
        rents = json.load(open(rp)).get("rents", {})
        jm = {}
        for sgg, months in rents.items():
            if not sgg.startswith("11"):
                continue  # 서울 표본
            for ym, rows2 in months.items():
                jm.setdefault(ym, []).extend(
                    r2["deposit"] / r2["ar"] for r2 in rows2
                    if r2.get("rent", 0) == 0 and r2.get("ar"))
        S["전세가"] = {ym: median(v) for ym, v in jm.items() if len(v) >= 30}
    return S


RATE_VARS = {"기준금리", "주담대금리", "국고10년"}


def transform(name, m):
    """금리 = 12개월 차분(pp) · 그 외 = 전년동월비(%). {ym: 변환값}."""
    out = {}
    for ym, v in m.items():
        prev_ym = f"{int(ym[:4])-1}{ym[4:]}"
        p = m.get(prev_ym)
        if p is None:
            continue
        if name in RATE_VARS:
            out[ym] = round(v - p, 3)
        elif p:
            out[ym] = round((v / p - 1) * 100, 2)
    return out


def xcorr(xm, ym_, k):
    """r(x_t, y_{t+k}) — 겹치는 월만. (r, n)"""
    pairs = []
    for t, xv in xm.items():
        yt = _shift(t, k)
        if yt in ym_:
            pairs.append((xv, ym_[yt]))
    n = len(pairs)
    if n < 20:
        return None, n
    mx = sum(p[0] for p in pairs) / n
    my = sum(p[1] for p in pairs) / n
    sx = sum((p[0]-mx)**2 for p in pairs) ** .5
    sy = sum((p[1]-my)**2 for p in pairs) ** .5
    if not sx or not sy:
        return None, n
    r = sum((p[0]-mx)*(p[1]-my) for p in pairs) / (sx*sy)
    return round(r, 3), n


def _shift(ym, k):
    y, m = int(ym[:4]), int(ym[4:6]) + k
    y += (m-1)//12; m = (m-1) % 12 + 1
    return f"{y}{m:02d}"


def best_lag(xm, ym_):
    """0..24 스캔 → {lag, r, n, curve, stable}."""
    curve = []
    for k in range(MAX_LAG+1):
        r, n = xcorr(xm, ym_, k)
        curve.append({"k": k, "r": r, "n": n})
    valid = [c for c in curve if c["r"] is not None]
    if not valid:
        return None
    top = max(valid, key=lambda c: abs(c["r"]))
    near = [c for c in valid if c["k"] <= 6]
    top_near = max(near, key=lambda c: abs(c["r"])) if near else None
    # 안정성: 표본을 전/후반 분할 — 같은 시차에서 부호가 일치하는가
    yms = sorted(xm)
    half = yms[len(yms)//2]
    xa = {t: v for t, v in xm.items() if t < half}
    xb = {t: v for t, v in xm.items() if t >= half}
    ra, _ = xcorr(xa, ym_, top["k"])
    rb, _ = xcorr(xb, ym_, top["k"])
    stable = (ra is not None and rb is not None
              and (ra > 0) == (top["r"] > 0) == (rb > 0))
    out = {"lag": top["k"], "r": top["r"], "n": top["n"],
           "r_early": ra, "r_late": rb, "stable": stable, "curve": curve}
    if top_near and top_near["k"] != top["k"]:
        out["lag_near"], out["r_near"] = top_near["k"], top_near["r"]
    return out


PAIRS = [  # 시차지도 사전계산 — 전달경로 가설 순
    ("기준금리", "주담대금리"), ("기준금리", "거래량"), ("기준금리", "매매가"),
    ("주담대금리", "거래량"), ("주담대금리", "매매가"), ("국고10년", "매매가"),
    ("거래량", "매매가"), ("거래량", "전세가"), ("매매가", "전세가"),
    ("매매가", "미분양"), ("미분양", "착공"), ("인허가", "착공"),
    ("착공", "준공"), ("준공", "미분양"),
]


def main():
    S = load_series()
    T = {n: transform(n, m) for n, m in S.items()}
    T = {n: m for n, m in T.items() if len(m) >= 24}
    print("변환 시계열:", {n: len(m) for n, m in T.items()})

    grid = []
    for a, b in PAIRS:
        if a not in T or b not in T:
            continue
        res = best_lag(T[a], T[b])
        if res:
            grid.append({"x": a, "y": b, **{k2: v for k2, v in res.items() if k2 != "curve"}})
            print(f"  {a} → {b}: 최적 +{res['lag']}개월 r={res['r']} "
                  f"(n={res['n']}, 안정 {'O' if res['stable'] else 'X'})")

    bp = ROOT / "out" / "site_bundle.json"
    bundle = json.load(open(bp))
    bundle["lag"] = {
        "series": {n: sorted(({"ym": t, "v": v} for t, v in m.items()),
                             key=lambda r: r["ym"]) for n, m in T.items()},
        "rate_vars": sorted(RATE_VARS & set(T)),
        "grid": grid,
        "max_lag": MAX_LAG,
    }
    json.dump(bundle, open(bp, "w"), ensure_ascii=False)
    print(f"병합: lag.series {len(T)}개 변수 · grid {len(grid)}쌍 → {bp}")





# ── 지역확산 — 서울 기준 양방향 시차 (선행을 전제하지 않는다) ──────

SPREAD_VARS = [("미분양", "unsold"), ("인허가", "permits"), ("착공", "starts")]
REGIONS = ["경기", "인천", "부산", "대구", "광주", "대전", "울산", "세종",
           "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]


def spread():
    """변수별 서울↔각 지역 양방향(-18..+18) 스캔 → 판정.
    k>0 = 서울이 k개월 선행 · k<0 = 지역이 선행 · |k|<=1 동행 · max|r|<0.3 독립."""
    k = json.load(open(SUJI / "kosis.json"))
    out = {}
    for name, key in SPREAD_VARS:
        seoul = transform(name, to_map(k[key]["서울"]))
        rows = []
        for rg in REGIONS:
            if rg not in k[key]:
                continue
            other = transform(name, to_map(k[key][rg]))
            best = None
            for kk in range(-18, 19):
                r, n = (xcorr(seoul, other, kk) if kk >= 0
                        else xcorr(other, seoul, -kk))
                if r is not None and (best is None or abs(r) > abs(best[1])):
                    best = (kk, r, n)
            if not best:
                continue
            kk, r, n = best
            verdict = ("독립" if abs(r) < 0.3 else
                       "동행" if abs(kk) <= 1 else
                       "서울 선행" if kk > 0 else "지역 선행")
            rows.append({"region": rg, "k": kk, "r": round(r, 3), "n": n,
                         "verdict": verdict})
        rows.sort(key=lambda x: x["k"])
        out[name] = rows
        lead = sum(1 for x in rows if x["verdict"] == "서울 선행")
        lag_ = sum(1 for x in rows if x["verdict"] == "지역 선행")
        print(f"  {name}: 서울 선행 {lead} · 지역 선행 {lag_} · "
              f"동행 {sum(1 for x in rows if x['verdict']=='동행')} · "
              f"독립 {sum(1 for x in rows if x['verdict']=='독립')}")
    return out


def main_spread():
    bp = ROOT / "out" / "site_bundle.json"
    bundle = json.load(open(bp))
    bundle["spread"] = spread()
    json.dump(bundle, open(bp, "w"), ensure_ascii=False)
    print("병합: spread →", bp)


if __name__ == "__main__":
    main()
    main_spread()
