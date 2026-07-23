"""시차 사이트 빌드 — web/ 산출 (원자 스왑, 수지의 교훈 계승).

실행: python3 src/build/assemble.py [--index]
"""

import datetime
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
BUNDLE = ROOT / "out" / "site_bundle.json"


def robots() -> str:
    if "--index" in sys.argv:
        return '<meta name="robots" content="index, follow">'
    return '<meta name="robots" content="noindex, nofollow, noarchive">'


def git_commit() -> str:
    """빌드 스탬프용 커밋 — env BUILD_SHA 우선(메인이 배포 시 주입), 없으면 HEAD 직접 파싱.
    git 바이너리 호출 없이 .git 파싱으로 폴백한다."""
    env = os.environ.get("BUILD_SHA")
    if env and env.strip():
        return env.strip()[:9]
    gd = ROOT / ".git"
    try:
        head = (gd / "HEAD").read_text().strip()
        if not head.startswith("ref:"):
            return head[:9]  # detached HEAD = 직접 SHA
        ref = head.split(" ", 1)[1].strip()
        loose = gd / ref
        if loose.exists():
            return loose.read_text().strip()[:9]
        packed = gd / "packed-refs"  # 느슨한 ref 없으면 packed-refs 폴백
        if packed.exists():
            for line in packed.read_text().splitlines():
                parts = line.split()
                if len(parts) == 2 and parts[1] == ref:
                    return parts[0][:9]
        return "dev"
    except OSError:
        return "dev"


def cutoff(bundle: dict) -> str:
    """관측 컷오프 — 매니페스트 월간 데이터셋의 최신 관측월(YYYY.MM)."""
    ends = [r[1] for d in bundle.get("manifest", {}).get("datasets", [])
            for r in [d.get("obs_range") or []]
            if len(r) == 2 and re.fullmatch(r"\d{4}-\d{2}", str(r[1]))]
    return max(ends).replace("-", ".") if ends else "—"


def hero_stats(bundle: dict) -> dict:
    """히어로 좌하 스탯 밴드 값 — 관문(home) KPI와 동일 번들 소스·동일 공식으로 계산.
    app.js render()의 전세가율/현실화율 중앙값·시차지도 쌍 수와 문자열이 일치하도록 맞춘다
    (하드코딩 회피). 데이터 결손 시 '—'."""
    out = {"jeonse": "—", "real": "—", "lag": "—"}
    J = bundle.get("jeonse") or {}
    by_sgg = J.get("by_sgg") or {}
    if by_sgg:
        qc: dict = {}
        for s in by_sgg.values():
            q = s[-1]["q"]
            qc[q] = qc.get(q, 0) + 1
        # app.js: sort((a,b)=> qc[b]-qc[a] || (a>b?-1:1)) — 빈도 내림차순, 동률이면 분기 문자열 내림차순
        ref_q = sorted(sorted(qc, reverse=True), key=lambda k: qc[k], reverse=True)[0]
        ref = [p["ratio"] for s in by_sgg.values()
               for p in [next((x for x in s if x["q"] == ref_q), None)] if p is not None]
        if ref:
            med = sorted(ref)[len(ref) // 2]           # Math.floor(n/2)
            out["jeonse"] = f"{med:.1f}%"
    by_year = (bundle.get("real") or {}).get("by_year") or {}
    if by_year:
        y = sorted(by_year)[-1]
        out["real"] = f"{by_year[y]['med']:.1f}%"
    grid = (bundle.get("lag") or {}).get("grid")
    if isinstance(grid, list):
        out["lag"] = f"{len(grid)}쌍"
    return out


def minify_json(path: Path) -> str:
    s = json.dumps(json.loads(path.read_text()), ensure_ascii=False, separators=(",", ":"))
    return (s.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026"))


def main():
    tpl = (SITE / "index.template.html").read_text()
    tpl = re.sub(r"\{\{CSS:([\w.\-]+)\}\}", lambda m: (SITE / "css" / m.group(1)).read_text(), tpl)
    tpl = re.sub(r"\{\{JS:([\w.\-]+)\}\}", lambda m: (SITE / "js" / m.group(1)).read_text(), tpl)
    bundle_data = json.loads(BUNDLE.read_text())
    tpl = tpl.replace("{{DATA}}", minify_json(BUNDLE))
    tpl = tpl.replace("{{KOREA}}", minify_json(SITE / "assets_korea.json"))
    tpl = tpl.replace("{{BUILT_AT}}", datetime.date.today().isoformat())
    tpl = tpl.replace("{{COMMIT}}", git_commit())
    tpl = tpl.replace("{{CUTOFF}}", cutoff(bundle_data))
    tpl = tpl.replace("{{ROBOTS}}", robots())
    hs = hero_stats(bundle_data)   # 히어로 스탯 — 관문 KPI와 같은 소스 값(assemble가 주입)
    tpl = tpl.replace("{{HERO_JEONSE_MED}}", hs["jeonse"])
    tpl = tpl.replace("{{HERO_REAL_MED}}", hs["real"])
    tpl = tpl.replace("{{HERO_LAG_N}}", hs["lag"])

    # 조사 분리 검사 — 강조 태그 닫힘과 조사 사이 공백/개행은 실화면 띄어쓰기가 된다 (5차 리뷰 채택)
    import re as _re
    _bad = _re.findall(r"</(?:b|strong|em|i)>[ \t]*\n[ \t]*(?:이|가|을|를|은|는|의|와|과|로|다|이다|한다|된다)[ .,<]", tpl)
    if _bad:
        raise RuntimeError(f"조사 분리 의심 {len(_bad)}건 — 태그와 조사를 붙이거나 조사를 태그 안으로: {_bad[:3]}")
    left = re.findall(r"\{\{[A-Z_:.\w\-]+\}\}", tpl)
    if left:
        raise RuntimeError(f"미치환 플레이스홀더: {left}")

    doc = ("<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n"
           + tpl[:tpl.index("<nav")] + "\n</head>\n<body>\n"
           + tpl[tpl.index("<nav"):] + "\n</body>\n</html>\n")

    tmp = ROOT / "web.tmp"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir()
    (tmp / "index.html").write_text(doc)
    og = SITE / "og.png"
    if og.exists():
        shutil.copy(og, tmp / "og.png")   # OG 이미지 — 배포 시 web/og.png로 함께 나간다
    final = ROOT / "web"
    if final.exists():
        shutil.rmtree(final)
    tmp.rename(final)
    print(f"빌드: {final/'index.html'} ({(final/'index.html').stat().st_size/1024:.0f} KB, 단일 파일)")


if __name__ == "__main__":
    main()
