"""지표 계산 단위 테스트 — 시차(視差).

실행: python3 -m pytest tests/ -q  (pytest 없으면 python3 tests/test_metrics.py)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.analysis.metrics import band_match, jeonse_only, ratio_of_medians, reverse_change


def test_band_match_10pct():
    # 전용 84.9 기준 ±10% — 76.4~93.4 안만 매칭
    assert band_match(84.9, 84.9)
    assert band_match(78.0, 84.9)
    assert not band_match(59.9, 84.9)
    assert not band_match(114.0, 84.9)


def test_jeonse_only_filters_wolse():
    rows = [{"deposit": 50000, "rent": 0}, {"deposit": 10000, "rent": 120},
            {"deposit": 45000, "rent": 0}]
    js = jeonse_only(rows)
    assert len(js) == 2 and all(r["rent"] == 0 for r in js)


def test_ratio_of_medians():
    # 전세 중앙값 60,000 / 매매 중앙값 100,000 = 0.6
    r = ratio_of_medians([50000, 60000, 70000], [90000, 100000, 110000])
    assert abs(r - 0.6) < 1e-9
    assert ratio_of_medians([1], []) is None


def test_reverse_change_sign():
    # 현재 45,000 vs 8분기 전 50,000 → -10% (역전세)
    chg = reverse_change(now_med=45000, back_med=50000)
    assert abs(chg - (-10.0)) < 1e-9
    assert abs(reverse_change(52500, 50000) - 5.0) < 1e-9
    assert reverse_change(45000, 0) is None


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn(); print(f"  ✓ {name}")
    print("전부 통과")
