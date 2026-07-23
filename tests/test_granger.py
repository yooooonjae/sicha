"""Granger 인과 검정 테스트 — 제한/비제한 F-검정의 방향성·귀무 거동 (Ⅴ 시차지도).

인공 시계열 2건으로 검정의 두 축을 고정한다:
  ① X가 Y를 k차 선행하도록 생성한 계열에서 X→Y가 유의(p<0.05)하고 역방향(Y→X) p는
     그보다 크다 — 방향을 옳게 가려낸다(순환/피드백 없는 외생 X는 Y로 역예측되지 않는다).
  ② 독립 백색잡음 쌍에서는 유의하지 않다(p>0.05) — 없는 관계를 만들어내지 않는다.

시드 고정 난수라 외부 데이터·산출물 없이 항상 결정적으로 돈다(CI 포함).

실행: python3 tests/test_granger.py  (또는 pytest tests/)
"""

import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# import 부작용 없음(load_series는 main()에서만) — CI 러너에서도 안전.
from src.analysis.lags import granger


def _series(vals, base=(2000, 1)):
    """값 리스트 → {YYYYMM: 값} 연속월 시계열(granger가 먹는 형식)."""
    y, m = base
    out = {}
    for v in vals:
        out[f"{y}{m:02d}"] = v
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


# ── ① 방향 탐지 — X가 Y를 k차 선행하면 X→Y가 유의하고 역방향은 덜하다 ──────────

def test_granger_detects_true_lead_direction():
    rng = random.Random(42)
    N, K = 120, 2
    x = [rng.gauss(0, 1) for _ in range(N)]
    # Y_t = 0.8·X_{t-K} + 잡음 — X가 Y를 K개월 선행(외생 X, Y로의 피드백 없음).
    y = [0.0] * K + [0.8 * x[t - K] + 0.5 * rng.gauss(0, 1) for t in range(K, N)]
    X, Y = _series(x), _series(y)

    fp, fl = granger(X, Y)          # X→Y (순방향)
    rp, _ = granger(Y, X)           # Y→X (역방향)

    assert fp is not None, "순방향 검정이 null — 자유도 충분해야 한다"
    assert fl in (3, 6), f"사용 차수가 후보 밖: {fl}"
    assert fp < 0.05, f"X→Y가 유의하지 않다: p={fp}"          # ①-a 방향을 잡아낸다
    assert rp is not None and rp > fp, (                      # ①-b 역방향은 덜 유의
        f"역방향 p({rp})가 순방향 p({fp})보다 크지 않다 — 방향 구분 실패")


# ── ② 귀무 거동 — 독립 백색잡음 쌍은 유의하지 않다 ──────────────────────────────

def test_granger_null_on_independent_noise():
    rng = random.Random(101)
    N = 120
    x = [rng.gauss(0, 1) for _ in range(N)]
    y = [rng.gauss(0, 1) for _ in range(N)]     # x와 무관하게 독립 생성
    X, Y = _series(x), _series(y)

    p, order = granger(X, Y)
    assert p is not None, "검정이 null — 자유도 충분해야 한다"
    assert order in (3, 6), f"사용 차수가 후보 밖: {order}"
    assert p > 0.05, f"독립 잡음인데 유의하게 나왔다: p={p} (없는 관계를 만들면 안 된다)"


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
