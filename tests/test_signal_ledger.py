"""신호원장(ledger) 계약 테스트 — 예측의 장부 (附 신호원장).

계약:
  ① 검증기한 = 판정일 + 예상시차 + 2개월  (verify_by == decided_on + (lag+2)M).
  ② 예측월(target_month) = 전환월(turn) + 예상시차(lag)  (_shift 규칙과 일치).
  ③ dedup — 같은 신호(선행→반응@전환월)는 원장에 한 번만(중복 id 없음).

날짜/시프트 순수 함수 테스트는 항상 돈다. data/ledger.json은 리포에 커밋되므로
(CI 포함) 있으면 실측을 대조하고, 없으면 명시적으로 skip 한다.

실행: python3 tests/test_signal_ledger.py  (또는 pytest tests/)
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# lags import는 부작용 없음(load_series는 main()에서만 호출) — CI 러너에서도 안전.
from src.analysis.lags import _date_plus_months, _shift

LEDGER = ROOT / "data" / "ledger.json"

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


_ISO = re.compile(r"\d{4}-\d{2}-\d{2}")


def _entries():
    if not LEDGER.exists():
        _skip(f"원장 없음({LEDGER}) — 검증 건너뜀")
    led = json.loads(LEDGER.read_text())
    return led.get("entries", [])


# ── 순수 날짜/시프트 규칙 (데이터 무의존 — 항상 실행) ──────────────────────

def test_date_plus_months_formula():
    # +시차+2M 산식의 핵심 — 월 이월과 말일 클램프(윤년 포함).
    assert _date_plus_months("2026-07-23", 2) == "2026-09-23"
    assert _date_plus_months("2026-01-31", 1) == "2026-02-28"   # 비윤년 말일 클램프
    assert _date_plus_months("2023-11-30", 3) == "2024-02-29"   # 윤년(2024) 말일 클램프
    assert _date_plus_months("2026-11-30", 3) == "2027-02-28"   # 해 넘김 + 비윤년
    assert _date_plus_months("2026-12-15", 1) == "2027-01-15"   # 연말 이월


def test_shift_month_formula():
    assert _shift("202607", 0) == "202607"
    assert _shift("202512", 1) == "202601"     # 해 넘김
    assert _shift("202601", 18) == "202707"


def test_verify_by_equals_decided_plus_lag_plus_2_synthetic():
    # 계약을 산식으로 못박음 — 판정일·시차가 무엇이든 검증기한은 +시차+2M.
    for dstr in ("2025-01-15", "2026-07-23", "2026-11-30"):
        for lag in (0, 1, 6, 18):
            assert _date_plus_months(dstr, lag + 2) == _date_plus_months(_date_plus_months(dstr, lag), 2)


# ── 원장 실측 검증 (data/ledger.json 커밋됨 — CI 포함 실행) ─────────────

def test_ledger_verify_by_is_decided_plus_lag_plus_2():
    for e in _entries():
        assert _ISO.fullmatch(e["decided_on"]), f"판정일 형식 오류: {e['id']}"
        assert e["lag"] >= 0, f"음수 시차: {e['id']}"
        exp = _date_plus_months(e["decided_on"], e["lag"] + 2)
        assert e["verify_by"] == exp, (
            f"{e['id']}: 검증기한 {e['verify_by']} ≠ 판정일+시차+2M {exp} "
            f"(판정일 {e['decided_on']}·시차 {e['lag']})")


def test_ledger_target_month_is_turn_plus_lag():
    for e in _entries():
        exp = _shift(e["turn"], e["lag"])
        assert e["target_month"] == exp, (
            f"{e['id']}: 예측월 {e['target_month']} ≠ 전환월+시차 {exp}")


def test_ledger_ids_are_deduped():
    entries = _entries()
    ids = [e["id"] for e in entries]
    assert len(ids) == len(set(ids)), f"중복 id 존재: {[i for i in ids if ids.count(i) > 1]}"
    # id는 선행→반응@전환월 dedup 키와 일치해야 한다 (재관측이 새 행을 만들지 않는 근거).
    for e in entries:
        assert e["id"] == f"{e['x']}→{e['y']}@{e['turn']}", f"id 규칙 위반: {e['id']}"


if __name__ == "__main__":
    passed = skipped = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); passed += 1; print(f"  ✓ {name}")
            except _SKIP_EXC as e:
                skipped += 1; print(f"  ⊘ SKIP {name}: {e}")
    print(f"통과 {passed} · 스킵 {skipped}")
