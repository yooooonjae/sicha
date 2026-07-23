"""신호원장(ledger) 계약 테스트 — 예측의 장부 (附 신호원장).

계약:
  ① 검증기한 = 목표월 + 데이터 공개지연(1M)의 말일 (verify_by == _verify_by(target_month)) —
     결정일과 무관. '결정일+시차'는 이미 관측된 반응월을 미래 기한으로 표기해 사후정보를 혼입했다.
  ② 예측월(target_month) = 전환월(turn) + 예상시차(lag)  (_shift 규칙과 일치).
  ③ dedup — 같은 신호(선행→반응@전환월)는 원장에 한 번만(중복 id 없음).
  ④ 사후정보 혼입 방지 — kind ∈ {live, backtest}, as_of 기록 존재. as_of가 있으면
     backtest ⟺ 목표월 ≤ as_of. backtest(사후)는 결정 시점에 이미 관측 → 'pending'일 수 없다.

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
from src.analysis.lags import _month_end, _shift, _verify_by

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

def test_month_end_formula():
    # 말일 산식 — 30/31일·비윤년/윤년 2월.
    assert _month_end("202601") == "2026-01-31"
    assert _month_end("202602") == "2026-02-28"   # 비윤년 2월
    assert _month_end("202402") == "2024-02-29"   # 윤년 2월
    assert _month_end("202604") == "2026-04-30"
    assert _month_end("202612") == "2026-12-31"


def test_shift_month_formula():
    assert _shift("202607", 0) == "202607"
    assert _shift("202512", 1) == "202601"     # 해 넘김
    assert _shift("202601", 18) == "202707"


def test_verify_by_is_target_plus_pub_delay():
    # 검증기한 = (목표월 + 공개지연 1M)월의 말일 — 결정일과 무관(사후정보 혼입 방지의 기준선).
    assert _verify_by("202601") == "2026-02-28"   # 목표 1월 → 2월 말
    assert _verify_by("202611") == "2026-12-31"   # 목표 11월 → 12월 말
    assert _verify_by("202612") == "2027-01-31"   # 해 넘김
    assert _verify_by("202401") == "2024-02-29"   # 윤년 2월 말
    # 산식 동치 — 목표월이 무엇이든 검증기한은 목표월+공개지연의 말일.
    for tm in ("202401", "202506", "202512", "202611"):
        assert _verify_by(tm) == _month_end(_shift(tm, 1))


# ── 원장 실측 검증 (data/ledger.json 커밋됨 — CI 포함 실행) ─────────────

def test_ledger_verify_by_is_target_month_plus_pub_delay():
    for e in _entries():
        assert _ISO.fullmatch(e["decided_on"]), f"판정일 형식 오류: {e['id']}"
        assert e["lag"] >= 0, f"음수 시차: {e['id']}"
        exp = _verify_by(e["target_month"])
        assert e["verify_by"] == exp, (
            f"{e['id']}: 검증기한 {e['verify_by']} ≠ 목표월+공개지연 {exp} "
            f"(목표월 {e['target_month']})")


def test_ledger_target_month_is_turn_plus_lag():
    for e in _entries():
        exp = _shift(e["turn"], e["lag"])
        assert e["target_month"] == exp, (
            f"{e['id']}: 예측월 {e['target_month']} ≠ 전환월+시차 {exp}")


def test_ledger_live_backtest_classification():
    """사후정보 혼입 방지 계약 — kind는 결정 시점의 as_of로 정해진다.
      · kind ∈ {live, backtest} · as_of 기록 존재.
      · as_of가 있으면 backtest ⟺ 목표월 ≤ as_of (미래 목표월을 사후로 오분류하지 않음).
      · backtest(사후)는 결정 시점에 이미 관측 → 'pending'(대기)일 수 없다(즉시 채점)."""
    for e in _entries():
        assert e.get("kind") in ("live", "backtest"), f"kind 누락/오류: {e['id']} ({e.get('kind')})"
        assert "as_of" in e, f"as_of 누락: {e['id']}"
        if e["as_of"] is not None:
            past = e["target_month"] <= e["as_of"]
            assert (e["kind"] == "backtest") == past, (
                f"{e['id']}: kind={e['kind']} 인데 목표월 {e['target_month']} vs as_of {e['as_of']}")
        if e["kind"] == "backtest":
            assert e["status"] != "pending", (
                f"{e['id']}: backtest 인데 대기(pending) — 즉시 채점 규칙 위반")


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
