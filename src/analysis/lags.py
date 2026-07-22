"""時差 편 — 신호의 전달시간 계측 (Ⅴ 시차지도 · Ⅵ 시차실험실의 원료).

실행: python3 -m src.analysis.lags   (metrics.py 실행 후 — bundle에 "lag" 섹션 병합)
원천: 수지 ecos/kosis/rtms · 순환 treasury10y · 시차 rent
방법: 월별 시계열 → 변환(금리 = 12개월 차분 pp · 수량/가격 = 전년동월비 %)
      → 교차상관 r(x_t, y_{t+k}) k=0..24 스캔 → 최적 시차·안정성(전/후반 부호 일치).
표현 규칙: "예측적 선후관계이며 단독 인과효과가 아니다"(사이트 문구 계약).
"""

import json
import os
import re
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
SUJI = Path(os.environ.get("SUJI_DIR", str(Path.home() / "개발"))) / "data"
SUN = Path(os.environ.get("SUNHWAN_DIR", str(Path.home() / "순환"))) / "data"
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
                      ("착공", "starts"), ("준공", "completions")]:
        S[name] = to_map(k[key]["전국"])
    # 인허가: KOSIS는 연간이라 사용 불가 — 건축HUB 월별(시도 대표 시군구 표본, 세대수 합)
    a = json.load(open(SUJI / "archub.json"))
    ih = {}
    for sido, rows in a["permits_monthly"].items():
        for r2 in rows:
            if re.fullmatch(r"\d{6}", str(r2.get("ym") or "")) and r2.get("units") is not None:
                ih[r2["ym"]] = ih.get(r2["ym"], 0) + r2["units"]
    S["인허가"] = ih
    r = json.load(open(SUJI / "rtms.json"))
    vol, prc = {}, {}
    for sido, guns in r["trades"].items():
        for gu, months in guns.items():
            for m in months:
                vol[m["ym"]] = vol.get(m["ym"], 0) + m["count"]
                prc.setdefault(m["ym"], []).append(m["median_price_per_m2"])
    S["거래량"] = vol
    S["매매가"] = {ym: median(v) for ym, v in prc.items()}
    # 서울 하위 계열 — 전세가(서울 표본)와 공간 범위를 맞춘다.
    # trades["서울"] = sggCd 11*(강남 11680·노원 11350)이라 별도 raw 재파싱 없이 동일 결과.
    svol, sprc = {}, {}
    for gu, months in r["trades"].get("서울", {}).items():
        for m in months:
            svol[m["ym"]] = svol.get(m["ym"], 0) + m["count"]
            sprc.setdefault(m["ym"], []).append(m["median_price_per_m2"])
    if svol:
        S["거래량(서울)"] = svol
        S["매매가(서울)"] = {ym: median(v) for ym, v in sprc.items()}
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


# ── 공간 범위 계약 (SERIES) — 각 시계열의 {scope, freq, unit, agg} ──────
# scope ∈ {"전국", "서울 표본", "대표 시군구 표본"}. PAIRS scope 일치 검사의 근거.
# 거래량·매매가는 전국 대표 표본이라 KOSIS 전국 계열과 같은 '전국'으로 취급하되,
# 전세가(서울 표본)와 짝지을 때만 서울 하위 계열로 범위를 맞춘다.
SERIES_META = {
    "기준금리":     {"scope": "전국", "freq": "월", "unit": "% (연)", "agg": "월말 정책금리"},
    "주담대금리":   {"scope": "전국", "freq": "월", "unit": "% (연)", "agg": "신규취급 가중평균"},
    "국고10년":     {"scope": "전국", "freq": "월", "unit": "% (연)", "agg": "월평균 금리"},
    "미분양":       {"scope": "전국", "freq": "월", "unit": "호", "agg": "전국 합계"},
    "준공후미분양": {"scope": "전국", "freq": "월", "unit": "호", "agg": "전국 합계"},
    "착공":         {"scope": "전국", "freq": "월", "unit": "호", "agg": "전국 합계"},
    "준공":         {"scope": "전국", "freq": "월", "unit": "호", "agg": "전국 합계"},
    "인허가":       {"scope": "대표 시군구 표본", "freq": "월", "unit": "세대", "agg": "시도 대표 시군구 세대수 합"},
    "거래량":       {"scope": "전국", "freq": "월", "unit": "건", "agg": "표본 시군구 거래건수 합"},
    "매매가":       {"scope": "전국", "freq": "월", "unit": "원/㎡", "agg": "표본 시군구 ㎡당 중앙값"},
    "거래량(서울)": {"scope": "서울 표본", "freq": "월", "unit": "건", "agg": "서울 표본 거래건수 합"},
    "매매가(서울)": {"scope": "서울 표본", "freq": "월", "unit": "원/㎡", "agg": "서울 표본 ㎡당 중앙값"},
    "전세가":       {"scope": "서울 표본", "freq": "월", "unit": "원/㎡", "agg": "서울 표본 전세 ㎡당 중앙값"},
}


def scope_of(name):
    return (SERIES_META.get(name) or {}).get("scope", "전국")


def tlabel(name):
    return "12개월 차분(pp)" if name in RATE_VARS else "전년동월비(%)"


def overlap_period(xm, ym_, k):
    """최적 시차에서 겹치는 관측월 범위 [min, max] (6자리 ym)."""
    ts = sorted(t for t in xm if _shift(t, k) in ym_)
    return [ts[0], ts[-1]] if ts else None


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


def best_lag(xm, ym_, max_lag=MAX_LAG):
    """0..max_lag 스캔 → {lag, r, n, curve, stable, at_bound}."""
    curve = []
    for k in range(max_lag+1):
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
           "r_early": ra, "r_late": rb, "stable": stable, "curve": curve,
           "max_lag": max_lag, "at_bound": top["k"] >= max_lag - 1}
    if top_near and top_near["k"] != top["k"]:
        out["lag_near"], out["r_near"] = top_near["k"], top_near["r"]
    return out


def regime_months(base_diff):
    """기준금리 12M 차분으로 국면 판정 — {ym: 'up'|'down'|None}."""
    return {t: ("up" if v > 0.1 else "down" if v < -0.1 else None)
            for t, v in base_diff.items()}


def agree_pct(xm, ym_, k):
    """최적 시차에서 부호 일치율(%) — 방향 예측력의 근사."""
    hit = tot = 0
    for t, xv in xm.items():
        yv = ym_.get(_shift(t, k))
        if yv is None or xv == 0 or yv == 0:
            continue
        tot += 1
        if (xv > 0) == (yv > 0):
            hit += 1
    return round(hit / tot * 100) if tot >= 12 else None


def rolling_lag(xm, ym_, win=60, step=6, max_lag=MAX_LAG):
    """이동창별 최적 시차 궤적 — [{end, lag, r}]."""
    yms = sorted(xm)
    out = []
    i = win
    while i <= len(yms):
        sub = {t: xm[t] for t in yms[i - win:i]}
        best = None
        for k in range(max_lag + 1):
            r, n = xcorr(sub, ym_, k)
            if r is not None and (best is None or abs(r) > abs(best[1])):
                best = (k, r)
        if best:
            out.append({"end": yms[i - 1], "lag": best[0], "r": round(best[1], 2)})
        i += step
    return out


# 쌍별 탐색 상한 — 24 고정은 착공→준공(20개월+)류에서 우측 경계 절단을 만든다 (12차 리뷰)
PAIRS = [  # (선행, 반응, 최대 탐색 시차)
    ("기준금리", "주담대금리", 18), ("기준금리", "거래량", 18), ("기준금리", "매매가", 18),
    ("주담대금리", "거래량", 18), ("주담대금리", "매매가", 18), ("국고10년", "매매가", 18),
    ("거래량", "매매가", 18),
    # 전세가는 서울 표본 — 서울 하위 계열과 짝지어 공간 범위를 맞춘다(전국↔서울 불일치 제거)
    ("거래량(서울)", "전세가", 18), ("매매가(서울)", "전세가", 18),
    ("매매가", "미분양", 30), ("미분양", "착공", 30), ("인허가", "착공", 30),
    ("착공", "준공", 48), ("준공", "준공후미분양", 30),
]


def main():
    S = load_series()
    T = {n: transform(n, m) for n, m in S.items()}
    T = {n: m for n, m in T.items() if len(m) >= 24}
    print("변환 시계열:", {n: len(m) for n, m in T.items()})

    # 공간 범위 계약 — PAIRS의 모든 변수는 scope가 정의돼 있어야 한다 (빌드 시 검사).
    for a, b, _ in PAIRS:
        assert a in SERIES_META and b in SERIES_META, f"scope 미정의: {a}→{b}"

    reg = regime_months(T.get("기준금리", {}))
    grid = []
    for a, b, ml in PAIRS:
        if a not in T or b not in T:
            continue
        res = best_lag(T[a], T[b], ml)
        if not res:
            continue
        g = {"x": a, "y": b, **{k2: v for k2, v in res.items() if k2 != "curve"}}
        # 공간 범위 일치 검사 — 불일치 쌍은 scope_mismatch로 표시(A등급·전달경로 제외의 근거)
        g["x_scope"], g["y_scope"] = scope_of(a), scope_of(b)
        g["scope_mismatch"] = g["x_scope"] != g["y_scope"]
        g["x_transform"], g["y_transform"] = tlabel(a), tlabel(b)
        g["period"] = overlap_period(T[a], T[b], res["lag"])
        g["agree"] = agree_pct(T[a], T[b], res["lag"])
        for rg_name, rg_key in [("up", "up"), ("down", "down")]:
            sub = {t: v for t, v in T[a].items() if reg.get(t) == rg_key}
            best = None
            for k in range(ml + 1):
                r, n = xcorr(sub, T[b], k)
                if r is not None and (best is None or abs(r) > abs(best[1])):
                    best = (k, r, n)
            if best:
                g["regime_" + rg_name] = {"lag": best[0], "r": round(best[1], 3), "n": best[2]}
        g["windows"] = rolling_lag(T[a], T[b], max_lag=ml)
        grid.append(g)
        ru, rd = g.get("regime_up"), g.get("regime_down")
        print(f"  {a} → {b}: +{res['lag']}M r={res['r']} 일치 {g['agree']}% "
              f"| 인상 {ru and f'+{ru[chr(108)+chr(97)+chr(103)]}M {ru[chr(114)]}'} "
              f"| 인하 {rd and f'+{rd[chr(108)+chr(97)+chr(103)]}M {rd[chr(114)]}'} "
              f"| 창 {len(g['windows'])}")

    # 홈 현재 신호 — 대표 쌍의 선행 변수 최근 방향 전환 + 경과
    signals = []
    for a, b in [("주담대금리", "거래량"), ("미분양", "착공"), ("기준금리", "주담대금리")]:
        g = next((x for x in grid if x["x"] == a and x["y"] == b), None)
        if not g or a not in T:
            continue
        yms = sorted(T[a])
        vals = [T[a][t] for t in yms]
        cur = vals[-1]
        turn = None
        for i in range(len(vals) - 2, max(len(vals) - 25, 0), -1):
            if (vals[i] > 0) != (cur > 0):
                turn = yms[i + 1]
                break
        elapsed = None
        if turn:
            y0, m0 = int(turn[:4]), int(turn[4:6])
            y1, m1 = int(yms[-1][:4]), int(yms[-1][4:6])
            elapsed = (y1 - y0) * 12 + (m1 - m0)
        lag_show = g.get("lag_near", g["lag"])
        # 방향 일치율은 관계의 부호를 반영해 저장한다 — 음의 관계는 100-agree(역방향 기준).
        # (app.js에서 max(agree,100-agree)로 뒤집던 왜곡 제거 — 양의 관계 40%가 60%로 둔갑하던 버그)
        agr = g["agree"]
        agree_dir = None if agr is None else (100 - agr if g["r"] < 0 else agr)
        signals.append({"x": a, "y": b, "dir": "+" if cur > 0 else "-",
                        "turn": turn, "elapsed": elapsed, "lag": lag_show,
                        "agree": agree_dir, "r": g["r"], "latest": yms[-1]})
    bundle_signals = signals

    # SERIES 계약 — 각 변환 시계열의 공간 범위·주기·단위·집계·변환·기간·n (연구 카드 메타 줄용)
    series_meta = {}
    for n, m in T.items():
        md = SERIES_META.get(n, {"scope": "전국", "freq": "월", "unit": "", "agg": ""})
        yms = sorted(m)
        series_meta[n] = {"scope": md["scope"], "freq": md["freq"], "unit": md["unit"],
                          "agg": md["agg"], "transform": tlabel(n),
                          "period": [yms[0], yms[-1]] if yms else None, "n": len(m)}

    n_mismatch = sum(1 for g in grid if g.get("scope_mismatch"))
    bp = ROOT / "out" / "site_bundle.json"
    bundle = json.load(open(bp))
    bundle["signals"] = bundle_signals
    bundle["lag"] = {
        "series": {n: sorted(({"ym": t, "v": v} for t, v in m.items()),
                             key=lambda r: r["ym"]) for n, m in T.items()},
        "series_meta": series_meta,
        "rate_vars": sorted(RATE_VARS & set(T)),
        "grid": grid,
        "max_lag": MAX_LAG,
    }
    json.dump(bundle, open(bp, "w"), ensure_ascii=False)
    print(f"병합: lag.series {len(T)}개 변수 · grid {len(grid)}쌍"
          f"(공간 범위 불일치 {n_mismatch}쌍) → {bp}")





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
