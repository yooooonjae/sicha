"""사건연구 기준창 계약 테스트 — z의 기준은 T<0만 (Ⅷ 사건연구).

계약: z 표준화의 평균·표준편차 기준창은 사건 이전(k<0)만 쓴다 — 사후 정보 누출 없음.
  검증 근거: z=(v−μ)/σ 에서 μ·σ가 k<0 표본으로만 산출되면, k<0 구간의 z는
  평균 0·모표준편차 1 로 정확히 표준화된다. 만약 기준창이 사후(k≥0)를 포함했다면
  k<0 구간의 z 평균이 0에서 벗어난다. 첫반응·피크는 k≥0만 본다.

순수 산식 테스트는 항상 돈다. 번들(out/site_bundle.json)의 events z경로 실측은
있으면 대조하고, 없으면(예: CI — out/ 미커밋) 명시적으로 skip 한다.

실행: python3 tests/test_event_window.py  (또는 pytest tests/)
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


def _events():
    if not BUNDLE.exists():
        _skip(f"번들 없음({BUNDLE}) — 빌드 산출 의존 검증 건너뜀")
    b = json.loads(BUNDLE.read_text())
    ev = b.get("events")
    if not ev:
        _skip("번들에 events 없음 — 검증 대상 없음")
    return ev


def _mean(xs):
    return sum(xs) / len(xs)


def _pstd(xs):
    m = _mean(xs)
    return (sum((x - m) ** 2 for x in xs) / len(xs)) ** .5


# src/analysis/events.py의 z 계산을 그대로 복제 — 기준창은 k<0만 (단일 출처 계약).
def _zpath_pre_only(path):
    pre_vals = [p["v"] for p in path if p["k"] < 0 and p["v"] is not None]
    mu = _mean(pre_vals)
    sd = _pstd(pre_vals) or 1
    z = [{"k": p["k"], "z": (p["v"] - mu) / sd if p["v"] is not None else None} for p in path]
    return mu, sd, z


# ── 순수 산식 (데이터 무의존 — 항상 실행) ──────────────────────────────

def test_z_baseline_uses_only_negative_k():
    # 사후(k≥0)를 극단값(1000)으로 오염시켜도, 기준창이 k<0만이면 pre z 평균은 0.
    path = [{"k": k, "v": 10.0 + (k % 3)} for k in range(-12, 0)] + \
           [{"k": k, "v": 1000.0} for k in range(0, 13)]
    mu, sd, z = _zpath_pre_only(path)
    pre_z = [p["z"] for p in z if p["k"] < 0]
    assert abs(_mean(pre_z)) < 1e-9              # 기준창 표준화 ⇒ 평균 0
    assert abs(_pstd(pre_z) - 1) < 1e-9          # ⇒ 모표준편차 1
    # 만약 사후를 포함했다면 μ가 크게 달라졌을 것 — 기준창 제한이 실질적 의미를 가진다.
    mu_all = _mean([p["v"] for p in path])
    assert abs(mu_all - mu) > 100
    # 오염된 사후 z는 크게 이탈 — 첫반응·피크가 k≥0에서 잡힌다.
    assert all(p["z"] > 1 for p in z if p["k"] >= 0)


# ── 번들 실측 검증 (있으면 대조 · 없으면 skip) ─────────────────────────

def test_bundle_event_baseline_is_pre_only():
    """실측 z경로: k<0 구간이 평균 0·모표준편차 1 로 표준화됐는지(=기준창이 T<0)."""
    for ev in _events():
        for row in ev["rows"]:
            ks = [p["k"] for p in row["z"]]
            assert min(ks) < 0 and max(ks) >= 0, f"{ev['id']}/{row['ind']}: 경로가 T<0·T≥0 를 못 걸침"
            pre = [p["z"] for p in row["z"] if p["k"] < 0 and p["z"] is not None]
            assert len(pre) >= 2, f"{ev['id']}/{row['ind']}: 기준창 표본 부족"
            m = _mean(pre)
            assert abs(m) < 0.02, (
                f"{ev['id']}/{row['ind']}: 기준창 z 평균 {m:.4f}≠0 — 사후 누출 의심")
            s = _pstd(pre)
            if s > 0.1:  # sd==0 클램프(무변동) 케이스는 제외
                assert abs(s - 1) < 0.05, (
                    f"{ev['id']}/{row['ind']}: 기준창 z 모표준편차 {s:.4f}≠1")


def test_bundle_first_and_peak_are_post_only():
    """첫반응·피크 시점은 k≥0만 참조한다(사후 반응만 채점)."""
    for ev in _events():
        for row in ev["rows"]:
            assert row["first"] is None or row["first"] >= 0, f"{ev['id']}/{row['ind']}: 첫반응이 T<0"
            assert row["peak_k"] is None or row["peak_k"] >= 0, f"{ev['id']}/{row['ind']}: 피크가 T<0"


if __name__ == "__main__":
    passed = skipped = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); passed += 1; print(f"  ✓ {name}")
            except _SKIP_EXC as e:
                skipped += 1; print(f"  ⊘ SKIP {name}: {e}")
    print(f"통과 {passed} · 스킵 {skipped}")
