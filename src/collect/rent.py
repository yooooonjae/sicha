"""아파트 전월세 실거래 수집 — 시차(視差) Ⅱ장(세입자의 눈)의 원료.

실행: python3 src/collect/rent.py [--limit N]   (N: 시군구 수 제한 스모크)
산출: data/rent.json · data/rent_progress.json(중단 재개)

범위는 수지 매매 raw(~/개발/data/raw/rtms/sale_{sgg}_{ym}_p*.xml)와 동일한
시군구·월 집합 — 전세가율의 분자·분모가 같은 표본 위에 서게 한다.
403(키 미반영)·쿼터 소진 시 진행 상태를 저장하고 조용히 종료한다(재실행=이어받기).
"""

import glob
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUJI_RAW = Path(os.environ.get("SUJI_DIR", str(Path.home() / "개발"))) / "data" / "raw" / "rtms"
URL = "http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent"

FIELDS = {  # 응답 태그 → 저장 키
    "aptNm": "apt", "excluUseAr": "ar", "deposit": "deposit",
    "monthlyRent": "rent", "umdNm": "umd", "jibun": "jibun",
    "floor": "floor", "buildYear": "built",
}


def target_set():
    """매매 raw 파일명에서 (시군구, 월) 집합 도출."""
    sggs, yms = set(), set()
    for f in glob.glob(str(SUJI_RAW / "sale_*_p*.xml")):
        m = re.match(r"sale_(\d{5})_(\d{6})_p", Path(f).name)
        if m:
            sggs.add(m.group(1)); yms.add(m.group(2))
    return sorted(sggs), sorted(yms)


def fetch(key, sgg, ym):
    """한 시군구·월의 전 페이지. (rows, err) — err: None|'denied'|'quota'."""
    rows, page = [], 1
    while True:
        qs = urllib.parse.urlencode({
            "serviceKey": key, "LAWD_CD": sgg, "DEAL_YMD": ym,
            "numOfRows": "1000", "pageNo": str(page)}, safe="%")
        try:
            with urllib.request.urlopen(f"{URL}?{qs}", timeout=20) as r:
                body = r.read().decode()
        except urllib.error.HTTPError as e:
            return rows, ("denied" if e.code == 403 else "quota")
        if "LIMITED_NUMBER_OF_SERVICE_REQUESTS" in body:
            return rows, "quota"
        if "SERVICE_ACCESS_DENIED" in body or "SERVICE_KEY_IS_NOT_REGISTERED" in body:
            return rows, "denied"
        items = re.findall(r"<item>(.*?)</item>", body, re.S)
        for it in items:
            row = {}
            for tag, k in FIELDS.items():
                m = re.search(rf"<{tag}>(.*?)</{tag}>", it)
                row[k] = (m.group(1).strip() if m else "")
            try:
                row["ar"] = float(row["ar"])
                row["deposit"] = int(row["deposit"].replace(",", "") or 0)
                row["rent"] = int(str(row["rent"]).replace(",", "") or 0)
                row["floor"] = int(row["floor"] or 0)
            except ValueError:
                continue
            rows.append(row)
        m = re.search(r"<totalCount>(\d+)</totalCount>", body)
        total = int(m.group(1)) if m else 0
        if page * 1000 >= total or not items:
            return rows, None
        page += 1
        time.sleep(0.15)


def main():
    key = json.load(open(ROOT / "config.json"))["service_key"]
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    sggs, yms = target_set()
    if limit:
        sggs, yms = sggs[:limit], yms[-2:]
    print(f"대상: 시군구 {len(sggs)}개 × 월 {len(yms)}개 = {len(sggs)*len(yms)}호출 예정")

    out_p = ROOT / "data" / "rent.json"
    prog_p = ROOT / "data" / "rent_progress.json"
    data = json.load(open(out_p)) if out_p.exists() else {"rents": {}}
    done = set(json.load(open(prog_p))["done"]) if prog_p.exists() else set()

    calls = 0
    for sgg in sggs:
        for ym in yms:
            k = f"{sgg}_{ym}"
            if k in done:
                continue
            rows, err = fetch(key, sgg, ym)
            if err == "denied":
                print(f"403/미등록 — 키 반영 대기. 진행 {len(done)}/{len(sggs)*len(yms)} 저장 후 종료")
                _save(out_p, prog_p, data, done)
                return
            if err == "quota":
                print(f"쿼터 소진 — 진행 {len(done)} 저장 후 종료(재실행 시 이어받기)")
                _save(out_p, prog_p, data, done)
                return
            data["rents"].setdefault(sgg, {})[ym] = rows
            done.add(k); calls += 1
            if calls % 50 == 0:
                print(f"  {calls}호출 · 최근 {sgg} {ym}: {len(rows)}행")
                _save(out_p, prog_p, data, done)
            time.sleep(0.15)

    data["sgg_set"] = sggs
    data["ym_range"] = [yms[0], yms[-1]]
    data["collected_at"] = time.strftime("%Y-%m-%d")
    _save(out_p, prog_p, data, done)
    n = sum(len(v) for s in data["rents"].values() for v in s.values())
    print(f"완료: {len(done)}셀 · 총 {n:,}행 → {out_p}")


def _save(out_p, prog_p, data, done):
    out_p.parent.mkdir(exist_ok=True)
    json.dump(data, open(out_p, "w"), ensure_ascii=False)
    json.dump({"done": sorted(done)}, open(prog_p, "w"))


if __name__ == "__main__":
    main()
