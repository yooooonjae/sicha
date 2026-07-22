"""지표 계산 단위 테스트 — 시차(視差).

실행: python3 -m pytest tests/ -q  (pytest 없으면 python3 tests/test_metrics.py)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.analysis.metrics import (band_match, jeonse_only, ratio_of_medians,
                                  rental_breakdown, reverse_change, shift_quarter)
from src.analysis.metrics import jeonse_metrics


def test_band_match_10pct():
    # 전용 84.9 기준 ±10% — 76.4~93.4 안만 매칭
    assert band_match(84.9, 84.9)
    assert band_match(78.0, 84.9)
    assert not band_match(59.9, 84.9)
    assert not band_match(114.0, 84.9)


def test_jeonse_only_filters_wolse():
    rows = [{"deposit": 50000, "rent": 0, "ar": 84.9}, {"deposit": 10000, "rent": 120, "ar": 59.9},
            {"deposit": 45000, "rent": 0, "ar": 110.0}]
    js = jeonse_only(rows)
    assert len(js) == 2 and all(r["rent"] == 0 for r in js)


def test_jeonse_only_strict_excludes_invalid():
    # 엄격화: rent 결측·보증금0·면적0/결측은 전세 표본에서 제외 (유효 전세 1건만)
    rows = [{"deposit": 50000, "rent": 0, "ar": 84.9},    # 전세 ✓
            {"deposit": 50000, "rent": None, "ar": 84.9},  # rent 결측 ✗
            {"deposit": 0, "rent": 0, "ar": 84.9},         # 보증금 0 ✗
            {"deposit": 50000, "rent": 0, "ar": 0},        # 면적 0 ✗
            {"deposit": 50000, "rent": 0}]                 # 면적 결측 ✗
    assert len(jeonse_only(rows)) == 1


def test_rental_breakdown_splits():
    rents = {"11000": {"202401": [
        {"deposit": 50000, "rent": 0, "ar": 84.9},    # 전세
        {"deposit": 10000, "rent": 120, "ar": 59.9},  # 월세
        {"deposit": 0, "rent": 0, "ar": 84.9},        # 무효(전세인데 보증금0)
        {"deposit": 50000, "rent": None, "ar": 84.9}, # 무효(rent 결측)
    ]}}
    bd = rental_breakdown(rents)
    assert bd == {"n_rental_all": 4, "n_jeonse": 1, "n_monthly": 1, "n_invalid": 2}


def test_shift_quarter_exact_8q():
    # 정확히 8분기: 2024Q1 → 2026Q1
    assert shift_quarter("2026Q1", -8) == "2024Q1"
    assert shift_quarter("2025Q3", -8) == "2023Q3"
    assert shift_quarter("2024Q4", 1) == "2025Q1"
    assert shift_quarter("2024Q1", -1) == "2023Q4"
    # 왕복 항등
    for q in ("2023Q2", "2025Q4", "2026Q1"):
        assert shift_quarter(shift_quarter(q, -8), 8) == q


def _rent_row(dep):
    return {"apt": "A", "deposit": dep, "rent": 0, "ar": 84.0}


def _sale_row(price):
    return {"apt": "A", "ar": 84.0, "price": price, "umd": "U", "jibun": "1"}


def test_reverse_uses_exact_8q_and_excludes_gap():
    # 9개 분기(2024Q1~2026Q1)를 분기당 1개월로 구성 — 각 분기 전세·매매 표본 존재
    qmonths = ["202401", "202404", "202407", "202410",
               "202501", "202504", "202507", "202510", "202601"]
    rents = {"11000": {ym: [_rent_row(50000 if ym != "202601" else 45000)] for ym in qmonths}}
    sales = {"11000": {ym: [_sale_row(90000)] for ym in qmonths}}
    _, reverse = jeonse_metrics(rents, sales)
    assert "11000" in reverse
    assert reverse["11000"]["now_q"] == "2026Q1"
    assert reverse["11000"]["back_q"] == "2024Q1"          # 정확히 8분기 전
    assert abs(reverse["11000"]["chg_pct"] - (-10.0)) < 1e-9  # 45000/50000-1

    # 8분기 전(2024Q1) 분기를 결측시키면 '비교 불가' → reverse에서 제외
    rents_gap = {"11000": {ym: rows for ym, rows in rents["11000"].items() if ym != "202401"}}
    sales_gap = {"11000": {ym: rows for ym, rows in sales["11000"].items() if ym != "202401"}}
    _, reverse_gap = jeonse_metrics(rents_gap, sales_gap)
    assert "11000" not in reverse_gap


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



def test_lag_sign_convention():
    """X→Y +kM = X가 k개월 먼저. 임펄스 2개월 지연 인공 계열로 부호 고정 검증."""
    from src.analysis.lags import best_lag
    x = {f"20{20+i//12:02d}{i%12+1:02d}": (1.0 if i % 7 == 3 else 0.0) for i in range(60)}
    y = {}
    for i in range(60):
        src = i - 2
        y[f"20{20+i//12:02d}{i%12+1:02d}"] = (1.0 if src >= 0 and src % 7 == 3 else 0.0)
    res = best_lag(x, y, max_lag=6)
    assert res["lag"] == 2 and res["r"] > 0.9, f"부호 규칙 위반: {res['lag']}, {res['r']}"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn(); print(f"  ✓ {name}")
    print("전부 통과")
