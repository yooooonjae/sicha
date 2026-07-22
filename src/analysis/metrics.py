"""지표 계산 — 전세가율·역전세·현실화율·이중 시차 사분면 → out/site_bundle.json.

실행: python3 -m src.analysis.metrics
입력: data/rent.json(없으면 전세 지표 생략) · data/gongsi.json · 수지 매매 raw(sale_*.xml)
정의(스펙): 전세 = rent==0. 전세가율 = 단지·면적대(±10%) 매칭 전세 중앙값 ÷ 매매 중앙값
          (시군구·분기, 매칭 표본<5면 ㎡당 중앙값 비율 폴백 — basis 필드로 구분).
          역전세 = 현재 분기 ÷ 8분기 전 − 1. 현실화율 = 공시가 ÷ 직전 1년 동단지·동면적대 매매 중앙값.
"""

import glob
import json
import os
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

from src.analysis import manifest

ROOT = Path(__file__).resolve().parents[2]
SUJI_RAW = Path(os.environ.get("SUJI_DIR", str(Path.home() / "개발"))) / "data" / "raw" / "rtms"


def band_match(ar, target, tol=0.10):
    """전용면적 매칭 — target ±10% 이내인가."""
    if not ar or not target:
        return False
    return abs(ar - target) <= target * tol


def jeonse_only(rows):
    """전세 표본 = 월세 0 · 보증금·전용면적 유효인 계약만.

    rent 결측(None)·월세>0·보증금 0·면적 0/결측은 제외한다 — 뒤의 deposit/ar 나눗셈이
    항상 유효하도록, 그리고 rental_breakdown의 n_jeonse와 정확히 일치하도록 엄격화한다.
    """
    out = []
    for r in rows:
        rent = r.get("rent")
        if rent is not None and rent == 0 and r.get("deposit") and r.get("ar"):
            out.append(r)
    return out


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
    """sale_*.xml → ({sgg: {ym: [{apt, ar, price(만원), umd, jibun}]}}, {sgg: 시군구명}).

    시군구명은 estateAgentSggNm(중개소 소재지)의 최빈 토큰에서 시도 접두를 떼어 만든다 —
    공시 표본(gongsi)에 이름이 없는 시군구(예: 성북 11290)의 라벨 결손을 메운다.
    """
    out = defaultdict(lambda: defaultdict(list))
    name_cnt = defaultdict(Counter)
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
            for tok in tag("estateAgentSggNm").split(","):
                tok = tok.strip()
                if tok:
                    name_cnt[sgg][tok] += 1
            try:
                out[sgg][ym].append({
                    "apt": tag("aptNm"), "ar": float(tag("excluUseAr")),
                    "price": int(tag("dealAmount").replace(",", "")),
                    "umd": tag("umdNm"), "jibun": tag("jibun")})
            except ValueError:
                continue
    names = {}
    for sgg, cnt in name_cnt.items():
        top = cnt.most_common(1)
        if top:  # "서울 성북구" → "성북구" (시도 접두 제거)
            names[sgg] = re.sub(r"^\S+\s+", "", top[0][0]) or sgg
    return out, names


def q_of(ym):
    return f"{ym[:4]}Q{(int(ym[4:6]) - 1) // 3 + 1}"


def shift_quarter(q, d):
    """'YYYYQn'에서 d분기 이동(d<0 = 과거). 결측 분기 왜곡을 막는 정확한 분기 키 계산."""
    y, qn = int(q[:4]), int(q.split("Q")[1])
    idx = y * 4 + (qn - 1) + d
    return f"{idx // 4}Q{idx % 4 + 1}"


def rental_breakdown(rents):
    """전월세 표본 분해 — 전체·전세·월세·무효(rent 결측/면적0/전세인데 보증금0)."""
    n_all = n_j = n_m = n_inv = 0
    for months in rents.values():
        for rows in months.values():
            for r in rows:
                n_all += 1
                rent = r.get("rent")
                if rent is None or not r.get("ar"):
                    n_inv += 1
                elif rent == 0:
                    if r.get("deposit"):
                        n_j += 1
                    else:
                        n_inv += 1
                else:
                    n_m += 1
    return {"n_rental_all": n_all, "n_jeonse": n_j, "n_monthly": n_m, "n_invalid": n_inv}


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
            # 정확히 8분기 전 분기 키로 비교 — series[-9] 인덱스 비교는 분기 결측 시 왜곡된다.
            # 8분기 전 분기가 실재할 때만 비교하고, 없으면 '비교 불가'로 reverse에서 제외한다.
            present = {s["q"] for s in series}
            now_q = series[-1]["q"]
            back_q = shift_quarter(now_q, -8)
            if back_q in present:
                nj = [r["deposit"] / r["ar"] for r in jeonse_only(
                    sum((months[m] for m in months if q_of(m) == now_q), []))]
                bj = [r["deposit"] / r["ar"] for r in jeonse_only(
                    sum((months[m] for m in months if q_of(m) == back_q), []))]
                if nj and bj:
                    chg = reverse_change(median(nj), median(bj))
                    if chg is not None:
                        reverse[sgg] = {"now_q": now_q, "back_q": back_q,
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
    # 정부 발표 공동주택 평균 현실화율(국토부 보도자료) — 표본과의 괴리 대조선
    official = {"2021": 70.2, "2022": 71.5, "2023": 69.0, "2024": 69.0, "2025": 69.0}
    return {
        "by_complex": by_complex,
        "by_year": {y: {"med": round(median(v), 1), "n": len(v)}
                    for y, v in sorted(by_year.items())},
        "by_sgg": {g: {"med": round(median(v), 1), "n": len(v)}
                   for g, v in by_sgg.items()},
        "official": official,
    }


# ── 단지 해부 — 동일 단지 전세(세입자의 눈) ────────────────────────

def anatomy(real, rents, sales):
    """해부 대상(현실화 관측 최다 단지)의 동일 단지·면적대(±10%) 전세·매매 중앙값.

    세입자의 눈을 시군구 폴백이 아니라 '같은 단지'에서 직접 읽는다 — apt명 정확 일치.
    전세 표본 5건 이상이면 대표값(전세 중앙값·전세가율)을, 미만이면 표본 수만 반환한다.
    선택은 app.js와 동일: apt|sgg 그룹 중 관측 최다 → 최신 연도 기록의 전용면적을 기준.
    """
    by_apt = defaultdict(list)
    for c in real.get("by_complex", []):
        by_apt[(c["apt"], c["sgg"])].append(c)
    if not by_apt:
        return None
    (apt, sgg), recs = max(by_apt.items(), key=lambda kv: len(kv[1]))
    tgt = sorted(recs, key=lambda c: c["year"])[-1]  # 최신 연도 = app.js의 b0
    ar = tgt["ar"]
    deps = [r["deposit"]
            for rows in rents.get(sgg, {}).values()
            for r in jeonse_only(rows)
            if r["apt"] == apt and band_match(r["ar"], ar)]
    prices = [t["price"]
              for rows in sales.get(sgg, {}).values()
              for t in rows
              if t["apt"] == apt and band_match(t["ar"], ar)]
    out = {"apt": apt, "sgg": sgg, "sggNm": tgt["sggNm"], "ar": ar,
           "n_jeonse": len(deps)}
    if len(deps) >= 5:
        jm = median(deps)
        out["jeonse_eok"] = round(jm / 10_000, 2)  # 보증금(만원) → 억
        if prices:
            mm = median(prices)
            out["market_eok"] = round(mm / 10_000, 2)
            out["n_market"] = len(prices)
            out["jeonse_ratio"] = round(jm / mm * 100, 1)  # 동일 단지 전세가율(%)
    return out


def main():
    sales, sales_names = load_sales()
    n_sale = sum(len(r) for s in sales.values() for r in s.values())
    print(f"매매 로드: {len(sales)}시군구 · {n_sale:,}건 · 이름 파생 {len(sales_names)}개")

    bundle = {"meta": {"built_at": time.strftime("%Y-%m-%d"), "n_sale": n_sale,
                       "sgg_names": dict(sales_names)}}

    gongsi = None
    gp = ROOT / "data" / "gongsi.json"
    if gp.exists():
        gongsi = json.load(open(gp))
        # 공시 큐레이션 이름이 있으면 우선(기존 라벨 불변) · 없는 시군구는 매매 파생 이름 유지
        for s in gongsi["samples"]:
            bundle["meta"]["sgg_names"][s["sgg"]] = (
                s["sggNm"].replace("서울 ", "").replace("경기 ", "") or s["sgg"])
        bundle["meta"]["sgg_full"] = {s["sgg"]: s["sggNm"] for s in gongsi["samples"]}
        bundle["real"] = realization(gongsi, sales)
        print(f"현실화율: 단지·연도 관측 {len(bundle['real']['by_complex'])}개 · "
              f"연도별 {bundle['real']['by_year']}")

    rp = ROOT / "data" / "rent.json"
    rent_doc = json.load(open(rp)) if rp.exists() else None  # 173MB — 한 번만 로드
    if rent_doc and rent_doc.get("rents"):
        rents = rent_doc["rents"]
        bd = rental_breakdown(rents)
        by_sgg, reverse = jeonse_metrics(rents, sales)
        bundle["jeonse"] = {"by_sgg": by_sgg, "reverse": reverse}
        bundle["meta"]["n_rent"] = bd["n_rental_all"]  # 하위호환 — 전월세 전체 행 수
        bundle["meta"].update(bd)                      # 전세/월세/무효 분리 저장
        print(f"전세가율: {len(by_sgg)}시군구 · 역전세 {len(reverse)}시군구 · "
              f"전월세 {bd['n_rental_all']:,}행(전세 {bd['n_jeonse']:,}·월세 {bd['n_monthly']:,}·무효 {bd['n_invalid']:,})")
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
            an = anatomy(bundle["real"], rents, sales)
            if an:
                bundle["anatomy"] = an
                rt = (f"전세 {an['jeonse_eok']}억·전세가율 {an.get('jeonse_ratio')}%"
                      if an["n_jeonse"] >= 5 else "표본 부족(대표값 미표시)")
                print(f"단지 해부: {an['sggNm']} {an['apt']} {an['ar']}㎡ · "
                      f"동일 단지 전세 {an['n_jeonse']}건 — {rt}")
    else:
        print("전세 데이터 없음 — rent.json 수집 후 재실행")

    # ── 데이터 상태 매니페스트(視差 원천) — 관측월 ≠ 수집일 ──────────
    sale_yms = sorted({ym for s in sales.values() for ym in s})
    sale_files = glob.glob(str(SUJI_RAW / "sale_*_p*.xml"))
    sale_collected = (time.strftime("%Y-%m-%d", time.localtime(
        max(os.path.getmtime(f) for f in sale_files))) if sale_files else None)
    prog = None
    pp = ROOT / "data" / "rent_progress.json"
    if pp.exists():
        done = len(json.load(open(pp)).get("done", []))
        try:  # 목표 셀 = 매매 raw의 (시군구×월) 집합(진행률의 분모)
            from src.collect.rent import target_set
            sgg_t, ym_t = target_set()
            total = len(sgg_t) * len(ym_t)
        except Exception:
            total = done
        prog = {"done": done, "total": total,
                "pct": round(done / total * 100, 1) if total else 0.0}
    ds = []
    if sale_yms:
        ds.append({"key": "rtms_sale", "name": "국토부 RTMS 매매 실거래",
                   "source": "국토교통부 RTMS(수지 공유 원천)", "scope": "전국 표본(시도 대표 시군구)",
                   "obs_range": [manifest.ym_dash(sale_yms[0]), manifest.ym_dash(sale_yms[-1])],
                   "collected_at": sale_collected, "rows": n_sale, "unit": "건", "progress": 1.0})
    if rent_doc and rent_doc.get("rents"):
        yr = rent_doc.get("ym_range") or [None, None]
        ds.append({"key": "rtms_rent", "name": "국토부 RTMS 전월세 실거래",
                   "source": "국토교통부 RTMS 전월세", "scope": "동일 시군구·월(전세가율 분모와 정합)",
                   "obs_range": [manifest.ym_dash(yr[0]), manifest.ym_dash(yr[1])],
                   "collected_at": rent_doc.get("collected_at"),
                   "rows": bundle["meta"].get("n_rental_all", 0), "unit": "행", "progress": prog})
    if gongsi:
        gyears = sorted({y for s in gongsi["samples"] for y in s.get("prices", {})})
        ds.append({"key": "gongsi", "name": "공동주택 공시가격",
                   "source": "VWorld NED(부동산공시)", "scope": "거래 상위 단지 표본",
                   "obs_range": [gyears[0], gyears[-1]] if gyears else None,
                   "collected_at": gongsi.get("collected_at"),
                   "rows": len(gongsi["samples"]), "unit": "단지", "progress": 1.0})
    bundle["manifest"] = manifest.upsert(ds, bundle["meta"]["built_at"])
    print(f"매니페스트(視差): {len(ds)}개 데이터셋 → DATA_MANIFEST.json")

    (ROOT / "out").mkdir(exist_ok=True)
    json.dump(bundle, open(ROOT / "out" / "site_bundle.json", "w"),
              ensure_ascii=False)
    print("저장: out/site_bundle.json")


if __name__ == "__main__":
    main()
