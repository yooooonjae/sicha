"""분기 계열 집계·인코딩 테스트 — HUG 초기분양률 편입(Ⅴ 시차지도 그룹 D).

월 계열을 분기말 월(YYYY{03,06,09,12}) 격자에 얹어 기존 월 단위 교차상관·Granger 기계를
재사용하는 계약을 한 테스트로 고정한다:
  ① '2014Q3' → '201409' 분기말 인코딩.
  ② 재고(stock) = 분기말(말월) 값만, 유량(flow) = 완전 분기(3개월)만 산술평균.
  ③ transform: 분기말 격자에서 prev_ym(전년 동월)이 곧 전년 동분기 → 초기분양률은
     전년동기 pp 차분, 분기 수량은 전년동기비(%).
  ④ Granger step=3(분기 시차)이 방향을 잡고, step 생략(=1) 월 계약은 불변.

외부 데이터·산출물 없이 인공 입력으로 항상 결정적으로 돈다(CI 포함).
실행: python3 tests/test_quarterly.py  (또는 pytest tests/)
"""

import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.analysis.lags import (
    _quarter_endmonth, monthly_to_quarter_end, monthly_to_quarter_mean,
    transform, granger, DIFF_VARS, GRANGER_CAND,
)


def test_quarterly_aggregation_encoding_and_granger_step():
    # ── ① 분기말 인코딩 ────────────────────────────────────────────────
    assert _quarter_endmonth("2014Q3") == "201409"
    assert _quarter_endmonth("2026Q1") == "202603"
    assert _quarter_endmonth("2020Q4") == "202012"

    monthly = {f"2020{m:02d}": float(m) for m in range(1, 13)}   # 2020.01~12 = 1..12

    # ── ② 재고=분기말(말월) · 유량=완전 분기 평균 ──────────────────────
    assert monthly_to_quarter_end(monthly) == {
        "202003": 3.0, "202006": 6.0, "202009": 9.0, "202012": 12.0}
    assert monthly_to_quarter_mean(monthly) == {          # (1+2+3)/3 … (10+11+12)/3
        "202003": 2.0, "202006": 5.0, "202009": 8.0, "202012": 11.0}
    # 부분 분기(2개월)는 버린다.
    assert monthly_to_quarter_mean({"202101": 1.0, "202102": 2.0}) == {}

    # ── ③ transform: 분기말 격자에서 전년 동분기 대비 ──────────────────
    assert "초기분양률" in DIFF_VARS                       # 비율지표 = pp 차분 대상
    tr = transform("초기분양률", {"201409": 80.0, "201509": 92.0, "201609": 70.0})
    assert tr["201509"] == 12.0 and tr["201609"] == -22.0  # 92−80 · 70−92 (전년동기 pp 차분)
    assert "201409" not in tr                              # 전년치 없음 → 제외
    assert transform("미분양(분기)", {"201409": 100.0, "201509": 120.0})["201509"] == 20.0

    # ── ④ Granger step=3(분기 시차)은 방향을 잡고, step 생략(월) 계약은 불변 ──
    rng = random.Random(7)
    qs, y, q = [], 2016, 3
    for _ in range(40):                                    # 분기말 월 40개(2016Q3~)
        qs.append(f"{y}{q * 3:02d}")
        q, y = (1, y + 1) if q == 4 else (q + 1, y)
    xv = [rng.gauss(0, 1) for _ in qs]
    X = dict(zip(qs, xv))
    Y = {k: (0.8 * xv[i - 2] if i >= 2 else 0.0) + 0.4 * rng.gauss(0, 1)
         for i, k in enumerate(qs)}                         # Y_t = 0.8·X_{t-2분기}+잡음
    p_fwd, order = granger(X, Y, 3)
    p_rev, _ = granger(Y, X, 3)
    assert order in GRANGER_CAND, f"차수 후보 밖: {order}"
    assert p_fwd is not None and p_fwd < 0.05, f"분기 X→Y 유의하지 않다: p={p_fwd}"
    assert p_rev is not None and p_rev > p_fwd, "역방향이 순방향보다 유의 — 방향 구분 실패"

    monthly_long = {f"20{i // 12:02d}{i % 12 + 1:02d}": rng.gauss(0, 1) for i in range(120)}
    p_default, o_default = granger(monthly_long, monthly_long)   # step 생략(=1) 기존 거동
    assert o_default in GRANGER_CAND and p_default is not None


if __name__ == "__main__":
    passed = failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                passed += 1
                print(f"  ✓ {name}")
            except AssertionError as e:
                failed += 1
                print(f"  ✗ {name}: {e}")
    print(f"통과 {passed} · 실패 {failed}")
    sys.exit(1 if failed else 0)
