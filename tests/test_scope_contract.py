"""공간 범위(scope) 계약 테스트 — 시차지도 grid 번들 검증 (Ⅴ 시차지도).

두 겹의 계약을 지킨다:
  ① 전 grid 쌍의 scope_mismatch 플래그가 (x_scope != y_scope)와 일치한다.
  ② A등급은 표본 60개월+ 에서만 가능하다(+ 안정·|r|≥0.4·범위 일치) — site/js/app.js의 grade() 규칙.

순수 등급 규칙 테스트는 데이터 없이 항상 돈다. 번들(out/site_bundle.json) 검증 테스트는
번들이 있으면 실측을 대조하고, 없으면(예: CI — out/ 미커밋) 명시적으로 skip 한다.

실행: python3 tests/test_scope_contract.py  (또는 pytest tests/)
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "out" / "site_bundle.json"

try:  # 스킵 하네스 — pytest면 정식 skip, 없으면 플레인 러너가 잡는 예외.
    import pytest
    _SKIP_EXC = pytest.skip.Exception

    def _skip(msg):
        pytest.skip(msg)
except ImportError:
    class _SkipTest(Exception):
        pass

    _SKIP_EXC = _SkipTest

    def _skip(msg):
        raise _SkipTest(msg)


def _grid():
    if not BUNDLE.exists():
        _skip(f"번들 없음({BUNDLE}) — 빌드 산출 의존 검증 건너뜀")
    b = json.loads(BUNDLE.read_text())
    grid = (b.get("lag") or {}).get("grid")
    if not grid:
        _skip("번들에 lag.grid 없음 — 검증 대상 없음")
    return grid


def grade(g):
    """site/js/app.js의 grade()를 그대로 옮긴 등급 규칙 (단일 출처 계약).

    n<25 짧은표본 · n<60 B−(중간)/C(중간) · n≥60에서만 A/B/C ·
    공간 범위 불일치는 A 금지(B로 강등).
    """
    n, stable, r = g["n"], g["stable"], g["r"]
    if n < 25:
        res = "짧은 표본"
    elif n < 60:
        res = "B−(중간)" if stable else "C(중간)"
    elif stable and abs(r) >= 0.4:
        res = "A"
    elif stable:
        res = "B"
    else:
        res = "C"
    if g.get("scope_mismatch") and res == "A":
        res = "B"  # 공간 범위 불일치 = A 금지
    return res


# ── 순수 등급 규칙 (데이터 무의존 — 항상 실행) ──────────────────────────

def test_grade_rule_blocks_A_below_60():
    # 표본이 59개월이면 아무리 안정·강상관이어도 A 불가.
    assert grade({"n": 59, "stable": True, "r": 0.9}) != "A"
    assert grade({"n": 24, "stable": True, "r": 0.9}) == "짧은 표본"
    # 60개월+·안정·|r|≥0.4·범위 일치 → A.
    assert grade({"n": 60, "stable": True, "r": 0.9, "scope_mismatch": False}) == "A"
    assert grade({"n": 200, "stable": True, "r": -0.42, "scope_mismatch": False}) == "A"
    # 불안정·약상관은 A 아님.
    assert grade({"n": 120, "stable": False, "r": 0.9}) == "C"
    assert grade({"n": 120, "stable": True, "r": 0.30}) == "B"


def test_grade_scope_mismatch_blocks_A():
    # 60+·안정·강상관이라도 공간 범위 불일치면 A 금지(B).
    g = {"n": 120, "stable": True, "r": 0.9, "scope_mismatch": True}
    assert grade(g) == "B"


# ── 번들 검증 (있으면 실측 대조 · 없으면 skip) ──────────────────────────

def test_bundle_grid_scope_flag_consistent():
    """전 grid 쌍: scope_mismatch == (x_scope != y_scope) · 필수 키 존재."""
    grid = _grid()
    for g in grid:
        for k in ("x", "y", "n", "r", "stable", "x_scope", "y_scope", "scope_mismatch"):
            assert k in g, f"grid 항목에 '{k}' 없음: {g.get('x')}→{g.get('y')}"
        expect = g["x_scope"] != g["y_scope"]
        assert g["scope_mismatch"] == expect, (
            f"{g['x']}→{g['y']}: scope_mismatch={g['scope_mismatch']} 인데 "
            f"x_scope={g['x_scope']}·y_scope={g['y_scope']} (기대 {expect})")


def test_bundle_A_grade_requires_60_months():
    """번들 실측: A로 채점되는 쌍은 반드시 n≥60·안정·|r|≥0.4·범위 일치."""
    grid = _grid()
    a_pairs = [g for g in grid if grade(g) == "A"]
    for g in a_pairs:
        assert g["n"] >= 60, f"A인데 표본<60: {g['x']}→{g['y']} n={g['n']}"
        assert g["stable"] is True, f"A인데 불안정: {g['x']}→{g['y']}"
        assert abs(g["r"]) >= 0.4, f"A인데 |r|<0.4: {g['x']}→{g['y']} r={g['r']}"
        assert not g["scope_mismatch"], f"A인데 범위 불일치: {g['x']}→{g['y']}"


if __name__ == "__main__":
    passed = skipped = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); passed += 1; print(f"  ✓ {name}")
            except _SKIP_EXC as e:
                skipped += 1; print(f"  ⊘ SKIP {name}: {e}")
    print(f"통과 {passed} · 스킵 {skipped}")
