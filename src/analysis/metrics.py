"""지표 계산 — 전세가율·역전세·현실화율·이중 시차 사분면 → out/site_bundle.json.

실행: python3 -m src.analysis.metrics
입력: data/rent.json(없으면 전세 지표 생략) · data/gongsi.json · 수지 매매 raw(sale_*.xml)
정의(스펙): 전세 = rent==0. 전세가율 = 단지·면적대(±10%) 매칭 전세 중앙값 ÷ 매매 중앙값
          (시군구·분기, 매칭 표본<5면 ㎡당 중앙값 비율 폴백 — basis 필드로 구분).
          역전세 = 현재 분기 ÷ 8분기 전 − 1. 현실화율 = 공시가 ÷ 직전 1년 동단지·동면적대 매매 중앙값.
"""

import glob
import json
import re
import time
from collections import defaultdict
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
SUJI_RAW = Path("/Users/iseul/개발/data/raw/rtms")


def band_match(ar, target, tol=0.10):
    """전용면적 매칭 — target ±10% 이내인가."""
    if not ar or not target:
        return False
    return abs(ar - target) <= target * tol


def jeonse_only(rows):
    """전세 = 월세 0인 계약만."""
    return [r for r in rows if r.get("rent", 0) == 0]


def ratio_of_medians(rents, sales):
    """중앙값의 비율 — 표본 어느 쪽이든 비면 None."""
    if not rents or not sales:
        return None
    return median(rents) / median(sales)


def reverse_change(now_med, back_med):
    """역전세 지표(%) — 8분기 전 대비 변화율. 기준 0이면 None."""
    if not back_med:
        return None
    return (now_med / back_med - 1) * 100


# ── 매매 원거래 로드 (수지 raw XML) ────────────────────────────────

def load_sales():
    """sale_*.xml → {sgg: {ym: [{apt, ar, price(만원), umd, jibun}]}}"""
    out = defaultdict(lambda: defaultdict(list))
    for f in glob.glob(str(SUJI_RAW / "sale_*_p*.xml")):
        m = re.match(r"sale_(\d{5})_(\d{6})_p", Path(f).name)
        if not m:
            continue
        sgg, ym = m.group(1), m.group(2)
        body = open(f, encoding="utf-8", errors="ignore").read()
        for it in re.findall(r"<item>(.*?)</item>", body, re.S):
            def tag(t):
                mm = re.search(rf"<{t}>(.*?)</{t}>", it)
                return mm.group(1).strip() if mm else ""
            try:
                out[sgg][ym].append({
                    "apt": tag("aptNm"), "ar": float(tag("excluUseAr")),
                    "price": int(tag("dealAmount").replace(",", "")),
                    "umd": tag("umdNm"), "jibun": tag("jibun")})
            except ValueError:
                continue
    return out


def q_of(ym):
    return f"{ym[:4]}Q{(int(ym[4:6]) - 1) // 3 + 1}"


# ── 전세가율·역전세 (rent.json 있을 때) ────────────────────────────

def jeonse_metrics(rents, sales):
    """시군구·분기 전세가율 + 역전세. 반환 (by_sgg, reverse)."""
    by_sgg, reverse = {}, {}
    for sgg, months in rents.items():
        # 분기 버킷
        rq, sq = defaultdict(list), defaultdict(list)
        for ym, rows in months.items():
            rq[q_of(ym)].extend(jeonse_only(rows))
        for ym, rows in sales.get(sgg, {}).items():
            sq[q_of(ym)].extend(rows)
        series = []
        for q in sorted(set(rq) & set(sq)):
            jr, sr = rq[q], sq[q]
            # 단지·면적대 매칭 우선
            pairs_r, pairs_s = [], []
            s_by_apt = defaultdict(list)
            for s in sr:
                s_by_apt[s["apt"]].append(s)
            for r in jr:
                cand = [s["price"] for s in s_by_apt.get(r["apt"], [])
                        if band_match(s["ar"], r["ar"])]
                if cand:
                    pairs_r.append(r["deposit"]); pairs_s.append(median(cand))
            if len(pairs_r) >= 5:
                ratio, basis = ratio_of_medians(pairs_r, pairs_s), "matched"
                n = len(pairs_r)
            else:  # ㎡당 중앙값 폴백
                rm = [r["deposit"] / r["ar"] for r in jr if r["ar"]]
                sm = [s["price"] / s["ar"] for s in sr if s["ar"]]
                ratio, basis = ratio_of_medians(rm, sm), "per_m2"
                n = min(len(rm), len(sm))
            if ratio:
                series.append({"q": q, "ratio": round(ratio * 100, 1),
                               "basis": basis, "n": n})
        if series:
            by_sgg[sgg] = series
            qs = [s["q"] for s in series]
            if len(qs) >= 9:
                now, back = series[-1], series[-9]
                # 같은 basis의 전세 ㎡ 중앙값 비교가 정확하지만 1차는 비율 시계열의 원값으로
                now_med = median([r["deposit"] / r["ar"] for r in jeonse_only(
                    sum((months[m] for m in months if q_of(m) == now["q"]), [])) if r["ar"]])
                back_med = median([r["deposit"] / r["ar"] for r in jeonse_only(
                    sum((months[m] for m in months if q_of(m) == back["q"]), [])) if r["ar"]])
                chg = reverse_change(now_med, back_med)
                if chg is not None:
                    reverse[sgg] = {"now_q": now["q"], "back_q": back["q"],
                                    "chg_pct": round(chg, 1)}
    return by_sgg, reverse


# ── 현실화율 (gongsi + 매매 raw) ──────────────────────────────────

def realization(gongsi, sales):
    """단지별 현실화율 = 공시가 ÷ 해당 연도 직전 1년 동단지·면적대 매매 중앙값(만원→원)."""
    by_complex = []
    for s in gongsi["samples"]:
        sgg = s["sgg"]
        for yr, p in s["prices"].items():
            lo, hi = f"{int(yr)-1}07", f"{yr}06"  # 공시기준 1/1 전후 1년 창
            mk = [t["price"] for ym, rows in sales.get(sgg, {}).items()
                  if lo <= ym <= hi for t in rows
                  if t["apt"] == s["apt"] and band_match(t["ar"], p["ar"], 0.10)]
            if len(mk) >= 3:
                market = median(mk) * 10_000
                by_complex.append({
                    "apt": s["apt"], "sgg": sgg, "sggNm": s["sggNm"], "sido": s["sido"],
                    "year": int(yr), "ratio": round(p["pc"] / market * 100, 1),
                    "gongsi_eok": round(p["pc"] / 1e8, 2),
                    "market_eok": round(market / 1e8, 2), "ar": p["ar"], "n": len(mk)})
    by_year = defaultdict(list)
    for c in by_complex:
        by_year[c["year"]].append(c["ratio"])
    by_sgg = defaultdict(list)
    for c in by_complex:
        if c["year"] >= 2024:
            by_sgg[c["sgg"]].append(c["ratio"])
    return {
        "by_complex": by_complex,
        "by_year": {y: {"med": round(median(v), 1), "n": len(v)}
                    for y, v in sorted(by_year.items())},
        "by_sgg": {g: {"med": round(median(v), 1), "n": len(v)}
                   for g, v in by_sgg.items()},
    }


def main():
    sales = load_sales()
    n_sale = sum(len(r) for s in sales.values() for r in s.values())
    print(f"매매 로드: {len(sales)}시군구 · {n_sale:,}건")

    bundle = {"meta": {"built_at": time.strftime("%Y-%m-%d"), "n_sale": n_sale}}

    gp = ROOT / "data" / "gongsi.json"
    if gp.exists():
        gongsi = json.load(open(gp))
        bundle["meta"]["sgg_names"] = {s["sgg"]: s["sggNm"].replace("서울 ", "").replace("경기 ", "")
                                       or s["sgg"] for s in gongsi["samples"]}
        bundle["meta"]["sgg_full"] = {s["sgg"]: s["sggNm"] for s in gongsi["samples"]}
        bundle["real"] = realization(gongsi, sales)
        print(f"현실화율: 단지·연도 관측 {len(bundle['real']['by_complex'])}개 · "
              f"연도별 {bundle['real']['by_year']}")

    rp = ROOT / "data" / "rent.json"
    if rp.exists() and json.load(open(rp)).get("rents"):
        rents = json.load(open(rp))["rents"]
        n_rent = sum(len(v) for s in rents.values() for v in s.values())
        by_sgg, reverse = jeonse_metrics(rents, sales)
        bundle["jeonse"] = {"by_sgg": by_sgg, "reverse": reverse}
        bundle["meta"]["n_rent"] = n_rent
        print(f"전세가율: {len(by_sgg)}시군구 · 역전세 {len(reverse)}시군구 · 전월세 {n_rent:,}행")
        # 사분면: 최신 분기 전세가율 × 시군구 현실화율
        if "real" in bundle:
            quad = []
            for sgg, series in by_sgg.items():
                rr = bundle["real"]["by_sgg"].get(sgg)
                if rr:
                    quad.append({"sgg": sgg, "jr": series[-1]["ratio"],
                                 "rr": rr["med"], "n": rr["n"]})
            bundle["quad"] = quad
            print(f"사분면: {len(quad)}시군구")
    else:
        print("전세 데이터 없음 — rent.json 수집 후 재실행")

    (ROOT / "out").mkdir(exist_ok=True)
    json.dump(bundle, open(ROOT / "out" / "site_bundle.json", "w"),
              ensure_ascii=False)
    print("저장: out/site_bundle.json")


if __name__ == "__main__":
    main()
