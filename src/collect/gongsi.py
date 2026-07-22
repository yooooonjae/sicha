"""공동주택 공시가격 표본 수집 — 시차(視差) Ⅲ장(행정의 눈)의 원료.

실행: python3 src/collect/gongsi.py [--limit N]
산출: data/gongsi.json

표본: 매매 raw(수지)에서 시군구별 거래 최다 단지 상위 3곳 →
VWorld 지오코더(parcel) → 연속지적(PNU) → NED 공동주택가격(2021~2025).
전국 전수가 아닌 '거래 상위 단지 표본'임을 방법론에 명시한다(스펙).
호가 여러 개 반환되면 최빈 전용면적 구간(±2㎡)의 공시가 중앙값을 대표값으로 쓴다.
"""

import glob
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
SUJI_RAW = Path("/Users/iseul/개발/data/raw/rtms")
YEARS = ["2021", "2022", "2023", "2024", "2025"]

SIDO = {"11": "서울", "26": "부산", "27": "대구", "28": "인천", "29": "광주",
        "30": "대전", "31": "울산", "36": "세종", "41": "경기", "42": "강원", "51": "강원",
        "43": "충북", "44": "충남", "45": "전북", "52": "전북", "46": "전남",
        "47": "경북", "48": "경남", "50": "제주"}


def _get(url, params):
    qs = urllib.parse.urlencode(params)
    req = urllib.request.Request(f"{url}?{qs}", headers={"User-Agent": "sicha/0.1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def top_complexes():
    """시군구별 거래 최다 단지 상위 3 — (sgg, sido, sggNm, umd, jibun, apt, n)."""
    cnt = Counter()
    sggnm = {}
    for f in glob.glob(str(SUJI_RAW / "sale_*_p*.xml")):
        body = open(f, encoding="utf-8", errors="ignore").read()
        for it in re.findall(r"<item>(.*?)</item>", body, re.S):
            g = {t: (re.search(rf"<{t}>(.*?)</{t}>", it) or [None, ""])[1]
                 for t in ("sggCd", "umdNm", "jibun", "aptNm", "estateAgentSggNm")}
            sgg, umd, jb, apt = g["sggCd"].strip(), g["umdNm"].strip(), g["jibun"].strip(), g["aptNm"].strip()
            if not (sgg and umd and jb and apt):
                continue
            cnt[(sgg, umd, jb, apt)] += 1
            nm = g["estateAgentSggNm"].strip()
            if nm and sgg not in sggnm:
                sggnm[sgg] = nm
    by_sgg = defaultdict(list)
    for (sgg, umd, jb, apt), n in cnt.items():
        by_sgg[sgg].append((n, umd, jb, apt))
    out = []
    for sgg, lst in sorted(by_sgg.items()):
        for n, umd, jb, apt in sorted(lst, reverse=True)[:3]:
            out.append({"sgg": sgg, "sggNm": sggnm.get(sgg, ""),
                        "sido": SIDO.get(sgg[:2], ""), "umd": umd,
                        "jibun": jb, "apt": apt, "n_sale": n})
    return out


def lookup_prices(key, c):
    """단지 → PNU → 연도별 공시가 대표값. 실패 시 skip 사유 반환."""
    addr = f"{c['sggNm']} {c['umd']} {c['jibun']}".strip()
    g = _get("https://api.vworld.kr/req/address", {
        "service": "address", "request": "getcoord", "version": "2.0",
        "crs": "EPSG:4326", "address": addr, "refine": "true",
        "format": "json", "type": "parcel", "key": key})
    pt = g.get("response", {}).get("result", {}).get("point", {})
    if not pt:
        return None, "지오코딩 실패"
    time.sleep(0.12)
    p = _get("https://api.vworld.kr/req/data", {
        "service": "data", "request": "GetFeature", "data": "LP_PA_CBND_BUBUN",
        "key": key, "geomFilter": f"POINT({pt['x']} {pt['y']})", "size": "1",
        "format": "json", "geometry": "false", "crs": "EPSG:4326"})
    feats = p.get("response", {}).get("result", {}).get("featureCollection", {}).get("features", [])
    if not feats:
        return None, "지적 실패"
    pnu = feats[0]["properties"]["pnu"]
    time.sleep(0.12)

    prices = {}
    for yr in YEARS:
        try:
            l = _get("https://api.vworld.kr/ned/data/getApartHousingPriceAttr", {
                "key": key, "pnu": pnu, "stdrYear": yr,
                "format": "json", "numOfRows": "999", "pageNo": "1"})
        except Exception:
            continue
        rows = (l.get("apartHousingPrices") or {}).get("field") or []
        ars = [float(r.get("prvuseAr") or 0) for r in rows if r.get("pblntfPc")]
        if not ars:
            continue
        mode_ar = Counter(round(a) for a in ars).most_common(1)[0][0]
        pcs = [int(r["pblntfPc"]) for r in rows
               if r.get("pblntfPc") and abs(float(r.get("prvuseAr") or 0) - mode_ar) <= 2]
        if pcs:
            prices[yr] = {"pc": int(median(pcs)), "ar": mode_ar, "n_ho": len(pcs)}
        time.sleep(0.12)
    if not prices:
        return None, "공시가 없음(비공동주택 필지 가능)"
    return {"pnu": pnu, "prices": prices}, None


def main():
    key = json.load(open(ROOT / "config.json"))["vworld_key"]
    comps = top_complexes()
    if "--limit" in sys.argv:
        comps = comps[:int(sys.argv[sys.argv.index("--limit") + 1])]
    print(f"표본 후보: {len(comps)}단지 (시군구별 상위 3)")
    samples, skipped = [], []
    for i, c in enumerate(comps):
        try:
            r, why = lookup_prices(key, c)
        except Exception as e:
            r, why = None, f"오류 {str(e)[:60]}"
        if r:
            samples.append({**c, **r})
        else:
            skipped.append({**c, "why": why})
        if (i + 1) % 20 == 0:
            print(f"  {i+1}/{len(comps)} · 성공 {len(samples)} · 스킵 {len(skipped)}")
    out = {"samples": samples, "skipped": skipped,
           "years": YEARS, "collected_at": time.strftime("%Y-%m-%d")}
    (ROOT / "data").mkdir(exist_ok=True)
    json.dump(out, open(ROOT / "data" / "gongsi.json", "w"), ensure_ascii=False, indent=1)
    print(f"완료: 표본 {len(samples)}단지 · 스킵 {len(skipped)} → data/gongsi.json")
    if samples:
        s = samples[0]
        yr = sorted(s["prices"])[-1]
        print(f"  예: {s['sggNm']} {s['apt']} {yr} 공시 {s['prices'][yr]['pc']:,}원 ({s['prices'][yr]['ar']}㎡)")


if __name__ == "__main__":
    main()
