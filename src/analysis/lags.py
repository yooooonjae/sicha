"""時差 편 — 신호의 전달시간 계측 (Ⅴ 시차지도 · Ⅵ 시차실험실의 원료).

실행: python3 -m src.analysis.lags   (metrics.py 실행 후 — bundle에 "lag" 섹션 병합)
원천: 수지 ecos/kosis/rtms · 순환 treasury10y · 시차 rent
방법: 월별 시계열 → 변환(금리 = 12개월 차분 pp · 수량/가격 = 전년동월비 %)
      → 교차상관 r(x_t, y_{t+k}) k=0..24 스캔 → 최적 시차·안정성(전/후반 부호 일치).
표현 규칙: "예측적 선후관계이며 단독 인과효과가 아니다"(사이트 문구 계약).
"""

import datetime
import json
import math
import os
import re
import time
from pathlib import Path
from statistics import median

from src.analysis import manifest
from src.analysis.metrics import jeonse_only

ROOT = Path(__file__).resolve().parents[2]
LEDGER = ROOT / "data" / "ledger.json"
SUJI = Path(os.environ.get("SUJI_DIR", str(Path.home() / "개발"))) / "data"
SUN = Path(os.environ.get("SUNHWAN_DIR", str(Path.home() / "순환"))) / "data"
MAX_LAG = 24


def to_map(rows):
    """ym이 YYYYMM 6자리인 행만 — 연간 합계·빈 키 행 방어."""
    return {r["ym"]: r["value"] for r in rows
            if r.get("value") is not None and re.fullmatch(r"\d{6}", str(r.get("ym") or ""))}


# ── 분기 계열 인코딩 — 분기를 '분기말 월'(YYYY{03,06,09,12})에 얹는다 ────────────
# 월 단위 교차상관·Granger 기계(_shift·xcorr·best_lag·granger)를 그대로 재사용하기 위해,
# 분기 계열도 YYYYMM 격자에 표현한다. 분기 자료는 분기말 월에만 값이 있으므로 월 시차 k 중
# 3의 배수(=k/3 분기)에서만 겹침이 생긴다 → 최적 시차는 자연히 분기 단위(+3·Q개월)로 나온다.
# 사이트는 이 쌍을 "+kQ"(k=lag/3)로 표기하고 툴팁·각주에 '분기 단위 · 월 환산 +3k개월'을 병기한다.

def _quarter_endmonth(q):
    """'2014Q3' → '201409'(분기말 월 YYYYMM)."""
    y, qq = q.split("Q")
    return f"{int(y)}{int(qq) * 3:02d}"


def monthly_to_quarter_end(m):
    """월 재고(stock) 계열 → 분기말(말월) 값 {YYYYMM(분기말): v}. 재고는 시점값이라 분기말이 자연."""
    return {ym: v for ym, v in m.items() if int(ym[4:6]) in (3, 6, 9, 12)}


def monthly_to_quarter_mean(m):
    """월 유량(flow) 계열 → 분기 3개월 산술평균(완전 분기만) {YYYYMM(분기말): v}.
    유량은 분기 내 누적이라 평균(=합/3)이 자연 — 비율(전년동기비) 변환 후엔 합·평균이 동치다."""
    buckets = {}
    for ym, v in m.items():
        y, mo = int(ym[:4]), int(ym[4:6])
        qend = ((mo - 1) // 3 + 1) * 3           # 그 달이 속한 분기의 말월
        buckets.setdefault(f"{y}{qend:02d}", []).append(v)
    return {q: sum(vs) / len(vs) for q, vs in buckets.items() if len(vs) == 3}


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
                # 전세 표본 정의는 metrics.jeonse_only로 공통화 —
                # 전세가율 장(metrics)과 시차 장(lags)이 같은 엄격판 표본 위에 서게 한다
                # (rent 결측·월세>0·보증금 0·면적 0/결측 제외).
                jm.setdefault(ym, []).extend(
                    r2["deposit"] / r2["ar"] for r2 in jeonse_only(rows2))
        S["전세가"] = {ym: median(v) for ym, v in jm.items() if len(v) >= 30}
    # ── HUG 초기분양률(분기·전국) + 짝지을 월 공급 계열의 월→분기 집계 ──────
    # 초기분양률 자체를 시차 분석에 편입한다(허브 부산 사례가 밝힌 "초기분양률은 시차 분석에
    # 포함되지 않는다"는 한계 해소). 원천은 순환 리포(KOSIS 승인통계 orgId 414) — 경로 참조·
    # 존재 가드(수지 raw 재사용 관례와 동일, 파일 복사 금지). 분기말 월 격자에 얹는다.
    hp = SUN / "hug_initial_rate.json"
    if hp.exists():
        hug = json.load(open(hp)).get("전국", [])
        hn = {_quarter_endmonth(r["q"]): r["rate"] for r in hug
              if r.get("rate") is not None and re.fullmatch(r"\d{4}Q[1-4]", str(r.get("q") or ""))}
        if len(hn) >= 24:
            S["초기분양률"] = hn
            if "미분양" in S:
                S["미분양(분기)"] = monthly_to_quarter_end(S["미분양"])   # 재고 = 분기말
            if "착공" in S:
                S["착공(분기)"] = monthly_to_quarter_mean(S["착공"])       # 유량 = 3개월 평균
    return S


RATE_VARS = {"기준금리", "주담대금리", "국고10년"}
# 차분(레벨 변화) 변환 대상 = 금리 + 초기분양률. 초기분양률은 0~100% 유계 비율이라 금리처럼
# 전년동기 pp 차분이 자연스럽다(수준의 추세·계절을 제거해 정상화). 그 외 수량·가격은 전년비(%).
DIFF_VARS = RATE_VARS | {"초기분양률"}


# ── 공간 범위 계약 (SERIES) — 각 시계열의 {scope, freq, unit, agg} ──────
# scope ∈ {"전국", "전국 표본", "서울 표본", "대표 시군구 표본"}. PAIRS scope 일치 검사의 근거.
# 총량 vs 표본 구분: KOSIS 계열(미분양·착공·준공·준공후미분양)은 '전국'(행정 총량),
#   거래량·매매가는 수지 표본 시군구를 집계한 값이라 '전국 표본'으로 구분한다.
#   → 표본↔총량 쌍(예: 매매가→미분양, 기준금리→거래량)은 scope_mismatch가 되어
#     A등급이 막히고 카드·전달경로에서 '탐색적'(회색 점선)으로 낮춰 표시된다
#     — 대표 시군구 인허가 → 전국 착공과 동일한 처리다.
# 전세가(서울 표본)와 짝지을 때만 거래량·매매가의 서울 하위 계열로 범위를 맞춘다.
SERIES_META = {
    "기준금리":     {"scope": "전국", "freq": "월", "unit": "% (연)", "agg": "월말 정책금리"},
    "주담대금리":   {"scope": "전국", "freq": "월", "unit": "% (연)", "agg": "신규취급 가중평균"},
    "국고10년":     {"scope": "전국", "freq": "월", "unit": "% (연)", "agg": "월평균 금리"},
    "미분양":       {"scope": "전국", "freq": "월", "unit": "호", "agg": "전국 합계"},
    "준공후미분양": {"scope": "전국", "freq": "월", "unit": "호", "agg": "전국 합계"},
    "착공":         {"scope": "전국", "freq": "월", "unit": "호", "agg": "전국 합계"},
    "준공":         {"scope": "전국", "freq": "월", "unit": "호", "agg": "전국 합계"},
    "인허가":       {"scope": "대표 시군구 표본", "freq": "월", "unit": "세대", "agg": "시도 대표 시군구 세대수 합"},
    "거래량":       {"scope": "전국 표본", "freq": "월", "unit": "건", "agg": "표본 시군구 거래건수 합"},
    "매매가":       {"scope": "전국 표본", "freq": "월", "unit": "원/㎡", "agg": "표본 시군구 ㎡당 중앙값"},
    "거래량(서울)": {"scope": "서울 표본", "freq": "월", "unit": "건", "agg": "서울 표본 거래건수 합"},
    "매매가(서울)": {"scope": "서울 표본", "freq": "월", "unit": "원/㎡", "agg": "서울 표본 ㎡당 중앙값"},
    "전세가":       {"scope": "서울 표본", "freq": "월", "unit": "원/㎡", "agg": "서울 표본 전세 ㎡당 중앙값"},
    # 분기 계열(freq "분기") — HUG 초기분양률 + 이와 짝지을 월 공급 계열의 분기 집계본.
    # 셋 다 scope "전국"이라 서로 짝지으면 scope_mismatch가 아니다(공간 범위 일치).
    "초기분양률":   {"scope": "전국", "freq": "분기", "unit": "%", "agg": "HUG 민간아파트 초기분양률(지역·분기 평균, 전국)"},
    "미분양(분기)": {"scope": "전국", "freq": "분기", "unit": "호", "agg": "월 전국 미분양 재고를 분기말(말월)로 집계"},
    "착공(분기)":   {"scope": "전국", "freq": "분기", "unit": "호", "agg": "월 전국 착공을 분기 3개월 평균으로 집계"},
}


def scope_of(name):
    return (SERIES_META.get(name) or {}).get("scope", "전국")


def tlabel(name):
    q = (SERIES_META.get(name) or {}).get("freq") == "분기"
    if name in DIFF_VARS:
        return "전년동기 차분(pp)" if q else "12개월 차분(pp)"
    return "전년동기비(%)" if q else "전년동월비(%)"


def overlap_period(xm, ym_, k):
    """최적 시차에서 겹치는 관측월 범위 [min, max] (6자리 ym)."""
    ts = sorted(t for t in xm if _shift(t, k) in ym_)
    return [ts[0], ts[-1]] if ts else None


def transform(name, m):
    """차분 대상(금리·초기분양률) = 전년동기 차분(pp) · 그 외 = 전년동기비(%). {ym: 변환값}.
    분기 계열은 분기말 월 격자라 prev_ym(전년 동월)이 곧 전년 동분기 — 월·분기 공통 코드."""
    out = {}
    for ym, v in m.items():
        prev_ym = f"{int(ym[:4])-1}{ym[4:]}"
        p = m.get(prev_ym)
        if p is None:
            continue
        if name in DIFF_VARS:
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


# ── Granger 인과 검정 — 제한/비제한 F-검정 (Ⅴ 탐색적 상관에 통계 검정을 병기) ──────
#
# 각 쌍 X→Y에 대해 두 회귀의 잔차제곱합(RSS)을 비교한다:
#   제한(restricted)    : Y_t ~ Y_{t-1..p}                (자기 과거만)
#   비제한(unrestricted): Y_t ~ Y_{t-1..p} + X_{t-1..p}   (X의 과거를 추가)
# X의 과거가 Y 예측을 유의하게 개선하면(RSS가 크게 감소) "X가 Y를 Granger-선행"한다.
#   F = ((RSS_r − RSS_u)/p) / (RSS_u/(n − 2p − 1)),  df1 = p, df2 = n − 2p − 1
# p값 = F분포 상측꼬리 P(F>f) — statsmodels 없이 순수 파이썬으로 정칙 불완전베타
#   I_x(a,b)를 Numerical Recipes 연분수로 계산한다(정확도 <1e-6, 기준 임계값 대조 검증).
#
# 표현 규칙: 교차상관과 동일하게 "예측적 선후"일 뿐 단독 인과가 아니다. 검정은 추가 필드일
# 뿐 관측 수치(전달시간·r)를 바꾸지 않는다. 한계는 방법론에 명시 — 비정상성·구조변화·
# 자기상관 이분산을 보정하지 않으며, 표본이 짧아 자유도가 부족하면 검정하지 않는다(null).

GRANGER_CAND = (3, 6)   # 후보 시차 차수 — 3=단기 전달·6=반년 전달(월자료 관례). 짧은 표본은 3만 가능.
GRANGER_MIN_DF = 10     # 잔차 자유도(df2) 최소 — 이 미만이면 F-검정 불신 → null


def _betacf(a, b, x):
    """정칙 불완전베타의 연분수(Numerical Recipes betacf) — I_x(a,b) 계산의 핵심."""
    MAXIT, EPS, FPMIN = 300, 1e-16, 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    d = 1.0 / (FPMIN if abs(d) < FPMIN else d)
    h = d
    for m in range(1, MAXIT + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        de = d * c
        h *= de
        if abs(de - 1.0) < EPS:
            break
    return h


def _betai(a, b, x):
    """정칙 불완전베타 I_x(a,b) ∈ [0,1] — F분포 CDF의 재료. math.lgamma만 사용(순수 파이썬)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    bt = math.exp(lbeta + a * math.log(x) + b * math.log(1.0 - x))
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def f_sf(f, d1, d2):
    """F(d1,d2)의 상측꼬리 P(F>f) = Granger p값. 상측을 직접 계산해 작은 p의 정밀도를 지킨다.
    P(F≤f)=I_x(d1/2,d2/2), x=d1·f/(d1·f+d2) → P(F>f)=I_{1−x}(d2/2,d1/2)."""
    if f <= 0 or d1 <= 0 or d2 <= 0:
        return 1.0
    return _betai(d2 / 2.0, d1 / 2.0, d2 / (d2 + d1 * f))


def _rss(y, cols):
    """OLS 잔차제곱합 — 절편은 평균중심화로 흡수, 예측열은 수정 그람-슈미트(MGS)로 직교화.
    X'X 정규방정식을 만들지 않아 지속계열 시차의 강한 다중공선성에도 수치 안정적이다
    (X'X는 조건수를 제곱한다). 앞 열과 공선인 열은 건너뛴다(사영 공간·RSS 불변)."""
    n = len(y)
    my = sum(y) / n
    resid = [v - my for v in y]          # 중심화한 y에서 시작 — 각 직교방향 사영을 차례로 뺀다
    basis = []                           # [(직교벡터, 제곱노름)]
    for col in cols:
        mc = sum(col) / n
        v = [col[t] - mc for t in range(n)]
        for u, un2 in basis:             # 기존 기저에 대해 직교화
            fac = sum(v[t] * u[t] for t in range(n)) / un2
            for t in range(n):
                v[t] -= fac * u[t]
        vn2 = sum(x * x for x in v)
        if vn2 < 1e-18:                   # 공선 열 — 정보 없음, 건너뜀
            continue
        basis.append((v, vn2))
        fac = sum(resid[t] * v[t] for t in range(n)) / vn2
        for t in range(n):
            resid[t] -= fac * v[t]
    return sum(x * x for x in resid)


def _lag_rows(xm, ym_, p, step=1):
    """(Y_t, [Y_{t-1..p}], [X_{t-1..p}]) 행 — 2p개 시차값이 모두 존재하는 연속 관측만.
    제한·비제한이 같은 표본 위에 서도록(중첩 비교의 전제) X·Y 시차가 모두 있어야 포함한다.
    step = 한 시차 차수당 월 수(월 계열=1, 분기 계열=3) — 분기는 전분기(=−3월)를 1차로 본다."""
    rows = []
    for t in sorted(ym_):
        yl, xl, ok = [], [], True
        for i in range(1, p + 1):
            ti = _shift(t, -i * step)
            if ti in ym_ and ti in xm:
                yl.append(ym_[ti])
                xl.append(xm[ti])
            else:
                ok = False
                break
        if ok:
            rows.append((ym_[t], yl, xl))
    return rows


def granger(xm, ym_, step=1):
    """X(xm)가 Y(ym_)를 Granger-선행하는가. → (p값, 사용 차수) 또는 (None, 차수 or None).

    차수 p 선택: 후보 {3,6} 중 비제한모형 AIC 최소. 둘 다 가능하면 공통표본(더 짧은 쪽 =
      큰 p의 표본)에서 AIC를 비교한다 — AIC의 n·ln(RSS/n) 항이 표본크기에 의존하므로 같은
      표본에서 재야 정당하기 때문이다. p=6이 자유도 부족이면 자동으로 p=3만 남는다(표본
      짧으면 3 규칙과 일치). 어느 차수도 df2<GRANGER_MIN_DF면 검정 불가 → None.
    step = 한 차수당 월 수(월=1, 분기=3) — 분기 쌍은 차수가 '분기 시차'가 된다(월 기계 재사용)."""
    feas = []
    for p in GRANGER_CAND:
        rows = _lag_rows(xm, ym_, p, step)
        if len(rows) - (2 * p + 1) >= GRANGER_MIN_DF:
            feas.append((p, rows))
    if not feas:
        return None, None
    if len(feas) >= 2:                       # 공통표본(행 수 최소 = 최대 차수의 표본)에서 AIC 비교
        rows_c = min((r for _, r in feas), key=len)
        nc = len(rows_c)
        yc = [r[0] for r in rows_c]
        aic = {}
        for p, _r in feas:
            cols = ([[r[1][i] for r in rows_c] for i in range(p)]
                    + [[r[2][i] for r in rows_c] for i in range(p)])
            ru = _rss(yc, cols)
            if ru > 0:
                aic[p] = nc * math.log(ru / nc) + 2 * (2 * p + 1)
        p_sel = min(aic, key=aic.get) if aic else feas[0][0]
    else:
        p_sel = feas[0][0]
    rows = next(r for pp, r in feas if pp == p_sel)   # 선택 차수는 자체 최대표본으로 검정(정보 최대)
    n = len(rows)
    y = [r[0] for r in rows]
    ycols = [[r[1][i] for r in rows] for i in range(p_sel)]
    xcols = [[r[2][i] for r in rows] for i in range(p_sel)]
    rss_u = _rss(y, ycols + xcols)
    rss_r = _rss(y, ycols)
    df1, df2 = p_sel, n - (2 * p_sel + 1)
    if rss_u <= 0 or df2 <= 0:
        return None, p_sel
    fstat = (max(0.0, rss_r - rss_u) / df1) / (rss_u / df2)   # X가 무기여면 F=0 → p=1(정상)
    return round(f_sf(fstat, df1, df2), 6), p_sel


# 쌍별 탐색 상한 — 24 고정은 착공→준공(20개월+)류에서 우측 경계 절단을 만든다 (12차 리뷰)
PAIRS = [  # (선행, 반응, 최대 탐색 시차)
    ("기준금리", "주담대금리", 18), ("기준금리", "거래량", 18), ("기준금리", "매매가", 18),
    ("주담대금리", "거래량", 18), ("주담대금리", "매매가", 18), ("국고10년", "매매가", 18),
    ("거래량", "매매가", 18),
    # 전세가는 서울 표본 — 서울 하위 계열과 짝지어 공간 범위를 맞춘다(전국↔서울 불일치 제거)
    ("거래량(서울)", "전세가", 18), ("매매가(서울)", "전세가", 18),
    ("매매가", "미분양", 30), ("미분양", "착공", 30), ("인허가", "착공", 30),
    ("착공", "준공", 48), ("준공", "준공후미분양", 30),
    # 초기분양률(HUG·전국·분기) 편입 — 월 공급 계열을 분기로 집계해 맞춘 분기 단위 2쌍.
    # 탐색 상한 24개월 = 8분기(분기말 격자라 유효 시차는 3의 배수=+kQ). 표본이 짧아 참고 수준.
    ("미분양(분기)", "초기분양률", 24), ("초기분양률", "착공(분기)", 24),
]


# ── 신호원장 — 예측을 판정일·검증기한과 함께 적고, 기한 뒤 자동 채점 ──────

# 반응 계열 데이터 공개 지연(개월) — 목표월 값은 대략 +1M 뒤 공개된다.
PUB_DELAY = 1


def _month_end(ym):
    """YYYYMM → 그 달 말일 ISO(YYYY-MM-DD). 윤년 2월 클램프."""
    y, m = int(ym[:4]), int(ym[4:6])
    leap = y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)
    last = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return datetime.date(y, m, last).isoformat()


def _verify_by(target_month, pub_delay=PUB_DELAY):
    """검증기한 = (목표월 + 데이터 공개지연)월의 말일 — 결정일과 무관.
    반응월 데이터가 실제로 공개되는 시점을 기준선으로 삼아, '결정일+시차' 방식이
    낳던 사후정보 혼입(이미 관측된 반응월을 미래 기한으로 표기)을 제거한다."""
    return _month_end(_shift(target_month, pub_delay))


def load_ledger():
    if LEDGER.exists():
        try:
            return json.load(open(LEDGER))
        except (json.JSONDecodeError, OSError):
            pass
    return {"created": None, "entries": []}


def update_ledger(signals, T, run_date):
    """당일 신호를 원장에 append — 선행→반응@전환월 key로 중복 방지(재관측은 in-place 갱신).

    · 판정일 = 최초 기록일(고정) · 검증기한 = 목표월 + 데이터 공개지연(_verify_by, 결정일 무관).
    · 사후정보 혼입 방지 — 목표월(전환월+시차)이 반응 계열의 최신 관측월(as_of) 이하이면
      결정 시점에 이미 반응이 관측된 것이므로 "backtest"(사후 검증)로 분류해 그 자리에서
      실제 부호로 즉시 채점한다. 미관측(목표월 > as_of)이면 "live"(전향 예측)로 대기한다.
      kind는 최초 결정 시점 기준으로 고정한다 — 이후 데이터가 도착해도 backtest로 뒤집지
      않는다(먼저 적어 둔 live 기록만이 전향 예측력의 증거다).
    · 채점 = 반응 변수 변환값(전년동월비/차분)의 목표월 부호를 예측 방향(선행 방향×관계 부호)과 대조.
    한계: 단순 부호 규칙 — 크기·유의성·자기상관을 보지 않는다. 전환월이 없는 신호(방향
    전환 미탐지)는 판정 기준이 없어 원장에서 제외한다.
    """
    led = load_ledger()
    entries = {e["id"]: e for e in led.get("entries", [])}
    for s in signals:
        turn, lag = s.get("turn"), s.get("lag")
        if not turn or lag is None:
            continue
        r = s.get("r")
        key = f"{s['x']}→{s['y']}@{turn}"
        rel = -1 if (r is not None and r < 0) else 1
        dsign = 1 if s["dir"] == "+" else -1
        exp = "+" if dsign * rel > 0 else "-"
        target = _shift(turn, lag)
        yseries = T.get(s["y"]) or {}
        as_of = max(yseries) if yseries else None  # 반응 계열 최신 관측월
        kind = "backtest" if (as_of is not None and target <= as_of) else "live"
        if key in entries:  # 재관측 — 판정일·시차·예측·kind는 고정, 생생 필드만 갱신
            e = entries[key]
            e.update(last_seen=run_date, elapsed=s.get("elapsed"))
            if "kind" not in e:  # 구 스키마 1회 이관 — 결정일=오늘이라 현재 as_of 분류가 유효
                e.update(kind=kind, as_of=as_of)
            continue
        entries[key] = {
            "id": key, "x": s["x"], "y": s["y"], "dir": s["dir"], "turn": turn,
            "lag": lag, "r": r, "expect_dir": exp, "target_month": target,
            "kind": kind, "as_of": as_of,
            "decided_on": run_date, "verify_by": _verify_by(target),
            "status": "pending", "observed_dir": None, "scored_on": None,
            "elapsed": s.get("elapsed"), "last_seen": run_date,
        }
    for e in entries.values():
        # 검증기한은 목표월의 순수 함수 — 구 항목(결정일 기준)도 여기서 목표월 기준으로 교정.
        e["verify_by"] = _verify_by(e["target_month"])
        if e["status"] in ("적중", "빗나감"):
            continue  # 확정 채점은 되돌리지 않는다
        yv = (T.get(e["y"]) or {}).get(e["target_month"])
        if yv is None:  # 반응월 미관측 — live는 계속 대기, backtest면 표본 밖(미검증)
            if e.get("kind") == "backtest":
                e.update(status="미검증", scored_on=run_date)
            continue
        # backtest는 즉시, live는 목표월 데이터가 관측되는 순간 채점(전향성은 판정일 고정으로 보존).
        obs = "+" if yv > 0 else "-" if yv < 0 else "0"
        e.update(observed_dir=obs, scored_on=run_date,
                 status="적중" if obs == e["expect_dir"]
                 else "빗나감" if obs != "0" else "미검증")
    ordered = sorted(entries.values(), key=lambda e: (e["decided_on"], e["id"]))
    out = {"created": led.get("created") or run_date, "updated": run_date, "entries": ordered}
    LEDGER.parent.mkdir(exist_ok=True)
    json.dump(out, open(LEDGER, "w"), ensure_ascii=False, indent=1)
    return out


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
        # 분기 계열(freq "분기") 쌍은 분기말 격자 — 시차 단위를 분기로 병기하고 Granger는 step=3.
        is_q = (SERIES_META.get(a) or {}).get("freq") == "분기"
        step = 3 if is_q else 1
        if is_q:
            g["freq"] = "Q"                       # 사이트: "+kQ" 라벨·"분기 단위" 툴팁의 근거
            g["lagQ"] = g["lag"] // 3             # 월 시차 → 분기 시차(유효 시차는 3의 배수)
            if "lag_near" in g:
                g["lagQ_near"] = g["lag_near"] // 3
        # Granger 검정 — gp: X→Y p값 · gl: 사용 차수 · gpr: 역방향 Y→X p값(방향성 근거).
        # 기존 필드·원장 로직은 불변, 추가 필드일 뿐이다. 자유도 부족이면 null.
        g["gp"], g["gl"] = granger(T[a], T[b], step)
        g["gpr"], _ = granger(T[b], T[a], step)
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
              f"| 창 {len(g['windows'])} "
              f"| G p={g['gp']}({g['gl']}차) 역={g['gpr']}")

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

    # 신호원장 — 당일 신호를 판정일·검증기한과 함께 기록·채점(축적 기록, 커밋 대상)
    run_date = time.strftime("%Y-%m-%d")
    led = update_ledger(bundle_signals, T, run_date)
    ents = led["entries"]

    def _rate(scored):
        hits = [e for e in scored if e["status"] == "적중"]
        return round(len(hits) / len(scored) * 100) if scored else None

    _scored = [e for e in ents if e["status"] in ("적중", "빗나감")]
    _live = [e for e in ents if e.get("kind") == "live"]
    _bt = [e for e in ents if e.get("kind") == "backtest"]
    _live_scored = [e for e in _live if e["status"] in ("적중", "빗나감")]
    _bt_scored = [e for e in _bt if e["status"] in ("적중", "빗나감")]
    # 전향(live)·사후(backtest)를 분리 집계 — 지도의 예측력 증거는 오직 live 기록이다.
    ledger_view = {"entries": ents,
                   "kpi": {"total": len(ents), "live": len(_live), "backtest": len(_bt),
                           "verified": len(_scored), "hit_rate": _rate(_scored),
                           "live_verified": len(_live_scored), "live_hit_rate": _rate(_live_scored),
                           "backtest_verified": len(_bt_scored), "backtest_hit_rate": _rate(_bt_scored),
                           "start": led["created"]}}
    print(f"신호원장: 누적 {len(ents)} (전향 {len(_live)}·사후 {len(_bt)}) · 검증완료 {len(_scored)} "
          f"· 전향적중률 {ledger_view['kpi']['live_hit_rate']} "
          f"· 사후적중률 {ledger_view['kpi']['backtest_hit_rate']} → data/ledger.json")

    # 데이터 상태 매니페스트(時差 원천) — metrics가 쓴 視差 위에 병합
    def _months(*names):
        return len({k for n in names for k in S.get(n, {})})

    def _range(*names):
        ks = sorted(k for n in names for k in S.get(n, {}))
        return [manifest.ym_dash(ks[0]), manifest.ym_dash(ks[-1])] if ks else None

    def _collected(path):
        return (time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(path)))
                if os.path.exists(path) else None)

    sigha_ds = [
        {"key": "ecos_rate", "name": "한국은행 ECOS 금리(기준·주담대)",
         "source": "한국은행 ECOS(수지 공유 원천)", "scope": "전국",
         "obs_range": _range("기준금리", "주담대금리"), "collected_at": _collected(SUJI / "ecos.json"),
         "rows": _months("기준금리", "주담대금리"), "unit": "개월", "progress": 1.0},
        {"key": "treasury10y", "name": "국고채 10년 금리",
         "source": "순환(循環) treasury10y", "scope": "전국",
         "obs_range": _range("국고10년"), "collected_at": _collected(SUN / "treasury10y.json"),
         "rows": _months("국고10년"), "unit": "개월", "progress": 1.0},
        {"key": "kosis_supply", "name": "KOSIS 주택 공급(미분양·착공·준공)",
         "source": "KOSIS(수지 공유 원천)", "scope": "전국 총량",
         "obs_range": _range("미분양", "착공", "준공", "준공후미분양"),
         "collected_at": _collected(SUJI / "kosis.json"),
         "rows": _months("미분양", "착공", "준공", "준공후미분양"), "unit": "개월", "progress": 1.0},
        {"key": "archub_permits", "name": "건축HUB 인허가(세대수)",
         "source": "건축HUB(수지 공유 원천)", "scope": "대표 시군구 표본",
         "obs_range": _range("인허가"), "collected_at": _collected(SUJI / "archub.json"),
         "rows": _months("인허가"), "unit": "개월", "progress": 1.0},
        {"key": "hug_initial_rate", "name": "HUG 민간아파트 초기분양률(분기)",
         "source": "순환(循環) hug_initial_rate — KOSIS 승인통계(orgId 414)", "scope": "전국",
         "obs_range": _range("초기분양률"), "collected_at": _collected(SUN / "hug_initial_rate.json"),
         "rows": _months("초기분양률"), "unit": "분기", "progress": 1.0},
    ]

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
    bundle["ledger"] = ledger_view
    bundle["manifest"] = manifest.upsert(sigha_ds, run_date)
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
