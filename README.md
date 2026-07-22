# 시차(視差·時差) — 한 자산을 보는 세 개의 눈, 신호의 전달시간

같은 아파트에 세 개의 가격이 동시에 존재한다 — 실거래가(시장) · 전세가(세입자) ·
공시가격(행정). **공간 편(視差)** 은 세 가격 사이의 각도(전세가율·현실화율·이중
리스크 사분면)를 재고, **시간 편(時差)** 은 금리·거래·가격·공급 사이의 전달
시간(교차상관 스캔·국면 분리·이동창·지역확산·정책 사건연구)을 잰다.

**라이브**: https://sicha.pages.dev

## 구조

```
src/collect/    rent.py(전월세 실거래 — 일 쿼터 분할 수집·resume)
                gongsi.py(공동주택 공시가격 — VWorld 지오코더→지적→공시 3단 체인)
src/analysis/   metrics.py(전세가율·역전세·현실화율) · lags.py(전달 시차·국면·이동창)
                events.py(정책 5건 event study — z-이탈 경로)
src/build/      assemble.py — 단일 HTML 조립(폰트 서브셋 인라인 포함)
tests/          지표 단위 테스트
```

재현: `python3 -m src.analysis.metrics && python3 -m src.analysis.lags
&& python3 -m src.analysis.events && python3 src/build/assemble.py`
(config.json의 API 키는 커밋하지 않는다 · 단일 파일 · 외부 요청 없음)

## 방법의 태도

모든 수치는 예측적 선후관계이며 인과 주장이 아니다. 국면 전환이 만드는 가짜
피크는 6개월 내 국소 피크를 병기하고, 탐색 편향·표본 한계·데이터 공백을
화면과 방법론 장에 그대로 남긴다.

## 연구 시리즈

[수지(收支)](https://yoonjae.pages.dev) — 개별 사업의 손익 ·
[순환(循環)](https://sunhwan.pages.dev) — 시장과 자본의 구조 ·
**시차(時差)** — 신호의 전달시간
