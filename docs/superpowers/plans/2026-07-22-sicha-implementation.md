# 시차(視差) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전세가율·현실화율·이중 시차 사분면을 실데이터로 관측하는 단일 HTML 리서치 사이트(sicha.pages.dev)를 구축한다.

**Architecture:** 수지·순환에서 검증된 3단 파이프라인의 세 번째 인스턴스 — 수집(src/collect → data/) → 지표(src/analysis → out/site_bundle.json) → 조립(src/build/assemble.py → web/index.html 단일 파일). 차트는 순환 charts.js 이식, 미감은 순백+적청 신규 토큰.

**Tech Stack:** Python 3(표준 라이브러리만, urllib), 인라인 SVG 차트 엔진(이식), Cloudflare Pages(wrangler).

## Global Constraints

- config.json 커밋 금지 (.gitignore 등록 완료) · git 저자 `Yooooonjae <ssyyjj0517@naver.com>` · Claude 트레일러 금지
- robots noindex 기본, `--index` 플래그로만 개방 · 외부 네트워크 요청 없는 단일 HTML
- 광역 정규식 치환 금지 — 정확 문자열+assert
- 색: 흑(#111 실거래)·청(전세)·적(공시), 순백 배경. 모든 색은 CSS 변수. `--seq-*` 히트맵 토큰 라이트/다크 정의 필수
- 매매 원천은 수지 보유분 재사용: `~/개발/data/raw/rtms/sale_*.xml` (1,694파일, aptNm·excluUseAr·jibun·umdNm·dealAmount·sggCd), 집계는 `~/개발/data/rtms.json`

---

### Task 1: 전월세 수집기

**Files:**
- Create: `src/collect/rent.py`
- Output: `data/rent.json`, `data/rent_progress.json`(resume)

**Interfaces:**
- Consumes: `~/개발/data/raw/rtms/sale_*.xml` 파일명에서 시군구 코드·월 범위 집합 도출 (`sale_{sgg}_{ym}_p*.xml`)
- Produces: `data/rent.json` = `{"rents": {sgg_cd: {ym: [row…]}}, "sgg_set": […], "ym_range": [min,max], "collected_at": "YYYY-MM-DD"}`
  row = `{"apt": aptNm, "ar": excluUseAr(float), "deposit": 보증금_만원(int), "rent": 월세_만원(int), "umd": umdNm, "jibun": jibun, "floor": int, "built": buildYear}`

- [ ] **Step 1: 수집기 작성** — 엔드포인트 `http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent`, 파라미터 `serviceKey, LAWD_CD(5자리), DEAL_YMD(YYYYMM), numOfRows=1000, pageNo`. XML 파싱은 `re.findall(r'<item>(.*?)</item>', body, re.S)` + 필드별 `re.search`(수지 rtms 수집기와 동일 패턴). totalCount>1000이면 페이지 순회. 403/429/limited면 진행 상태를 `data/rent_progress.json`에 저장하고 종료(재실행 시 이어받기). 호출 간 `time.sleep(0.15)`.
- [ ] **Step 2: 스모크 실행** — `python3 src/collect/rent.py --limit 3` (시군구 3개 × 최근 2개월만). Expected: rent.json 생성, row 필드 8종 채워짐. 403이면 "키 미반영 — 재시도 예정" 출력 후 exit 0.
- [ ] **Step 3: 전량 실행** — `python3 src/collect/rent.py` (sgg_set 전체 × ym_range 전체 ≈ 47시군구 × 36개월 ≈ 1,700호출). 쿼터 소진 시 progress 저장 확인.
- [ ] **Step 4: Commit** — `git add src/collect/rent.py && git commit -m "feat: 전월세 실거래 수집기(resume 지원)"`

### Task 2: 공시가격 표본 수집기

**Files:**
- Create: `src/collect/gongsi.py`
- Output: `data/gongsi.json`

**Interfaces:**
- Consumes: 매매 raw XML — 시군구별 거래 최다 단지 상위 3곳의 `(umdNm, jibun, aptNm)`; VWorld 체인은 `~/개발/src/collect/vworld.py`의 `_get` 패턴 재사용
- Produces: `data/gongsi.json` = `{"samples": [{"sgg": cd, "apt": name, "umd": umd, "jibun": jibun, "pnu": pnu, "prices": {"2021": {"pc": 공시가원, "ar": 전용㎡}, … "2025": …}}], "collected_at": …}` — prices는 대표 호(최빈 전용면적대 중앙 호) 기준

- [ ] **Step 1: 표본 선정 로직** — sale XML 전체 파싱 → `(sggCd, umdNm, jibun, aptNm)` 그룹 거래수 집계 → 시군구별 상위 3. 주소 문자열 = `{시도} {시군구} {umdNm} {jibun}` (시도·시군구명은 sggCd 앞 2자리→시도 매핑 + `estateAgentSggNm` 필드 활용).
- [ ] **Step 2: VWorld 체인** — 지오코더(type=parcel) → LP_PA_CBND_BUBUN(pnu) → `ned/data/getApartHousingPriceAttr` (stdrYear 2021~2025, numOfRows=200). 호 다수 반환 시: 전용면적 최빈 구간(±2㎡)의 `pblntfPc` 중앙값 채택. 실패 단지는 skip 기록.
- [ ] **Step 3: 실행·검증** — `python3 src/collect/gongsi.py`. Expected: 표본 100+단지, 연도별 prices 채워짐, 잠실 사례(17.89억)와 자릿수 일치.
- [ ] **Step 4: Commit**

### Task 3: 지표 계산 + 테스트

**Files:**
- Create: `src/analysis/metrics.py`, `tests/test_metrics.py`
- Output: `out/site_bundle.json`

**Interfaces:**
- Consumes: `data/rent.json`, `data/gongsi.json`, `~/개발/data/raw/rtms/sale_*.xml`(매매 원거래), `~/개발/data/ecos.json`(금리 보조)
- Produces: `out/site_bundle.json` =
  - `jeonse.by_sgg[sgg] = [{q, ratio, n_sale, n_rent, sale_med_m2, rent_med_m2}]` (분기)
  - `jeonse.reverse[sgg] = {now_med, back8_med, chg_pct, n}` (동일 단지·면적대 매칭 집계)
  - `real.by_complex = [{apt, sgg, year, ratio, gongsi, market_med}]`, `real.by_sgg`, `real.by_year`
  - `quad = [{sgg, name, jr(전세가율), rr(현실화율), n}]`
  - `meta = {sgg_names, ym_range, built_at, counts}`
- 정의(스펙 준수): 전세 = `rent==0`인 계약. 전세가율 = 단지·면적대(±10%) 매칭된 전세 중앙값 ÷ 매매 중앙값, 시군구·분기 집계(매칭 표본 부족 시 ㎡당 중앙값 비율 폴백, `basis` 필드로 구분). 역전세 = 현재 분기 ÷ 8분기 전 − 1. 현실화율 = 공시가 ÷ 직전 1년 동단지·동면적대 매매 중앙값.

- [ ] **Step 1: 실패 테스트 작성** — `tests/test_metrics.py`: ① 중앙값·면적대 매칭(±10%) ② 전세 필터(rent>0 제외) ③ 역전세 부호 ④ 현실화율 매칭(면적대 불일치 시 None) — 합성 데이터 4케이스.
- [ ] **Step 2: 실행 확인(FAIL)** — `python3 -m pytest tests/ -q` → ImportError.
- [ ] **Step 3: 구현** — metrics.py에 `median, band_match(ar, target, tol=0.10), jeonse_ratio(...), reverse_index(...), realization(...)` 구현 후 main()에서 bundle 조립.
- [ ] **Step 4: PASS 확인 + 실데이터 빌드** — pytest 통과, `python3 src/analysis/metrics.py` → out/site_bundle.json 생성, 서울 전세가율 50~70% 범위 새너티 체크.
- [ ] **Step 5: Commit**

### Task 4: 빌드 파이프라인 + 토큰

**Files:**
- Create: `src/build/assemble.py` (원본: `~/순환/src/build/assemble.py` 복사 — 조사-분리·플레이스홀더 검사 유지, BUNDLE 경로만 확인)
- Create: `site/css/tokens.css`(신규 — 순백·적청·--seq-* 라이트/다크), `site/css/base.css`, `site/css/components.css` (골격은 순환 것 참조하되 시차 미감으로 재작성)
- Create: `site/js/charts.js` (원본: `~/순환/site/js/charts.js` 복사 — 색 참조가 CSS 변수인지 확인, 하드코딩 색만 토큰 치환)

- [ ] **Step 1: assemble.py 복사·경로 조정** — ROOT 기준 동일, `{{DATA}}`/`{{CSS:}}`/`{{JS:}}` 치환 로직 그대로.
- [ ] **Step 2: tokens.css 작성** — `--ink:#111; --paper:#fff; --blue:#1d4ed8(전세); --red:#dc2626(공시); --rule:#e5e7eb; --seq-1…7`(청 램프), 다크는 `[data-theme="dark"]` 반전. WCAG 4.5:1 보조색.
- [ ] **Step 3: 빈 템플릿으로 빌드 통과 확인** — 최소 index.template.html(nav+빈 섹션)로 `python3 src/build/assemble.py` → web/index.html 생성.
- [ ] **Step 4: Commit**

### Task 5: 사이트 본문 (홈 + 5장)

**Files:**
- Modify: `site/index.template.html` — 홈(세 시선 다이어그램 SVG·KPI·자매 연구 카드), Ⅰ 세 개의 가격(잠실 해부), Ⅱ 전세가율(분기 라인·시군구 hbars·역전세), Ⅲ 현실화율(연도 궤적·단지 산점), Ⅳ 사분면(scatter), Ⅴ 방법론(details 접힘)
- Create: `site/js/app.js` — bundle 읽어 각 장 렌더(charts.js 호출), ☀/☾ 토글, 모바일 목차

**설계 준수사항:** frontend-design 스킬 재로드 후 작업. 장 제목은 은유("세입자의 눈"), 차트 제목은 직설("시군구별 전세가율 — 분기 중앙값 비율"). 8차 리뷰 교훈 선반영 — 섹션 여백 `padding-block: clamp(72px,8vw,120px)`, min-height 금지, 모바일 CTA 1+2, 테마 토글 ☀/☾, 캡션 4.5:1, hbars 긴 목록은 상·하위 5 + 펼치기.

- [ ] **Step 1: 홈+Ⅰ장 → 빌드·캡처 확인** (1440·390 하니스, 애니메이션 주입)
- [ ] **Step 2: Ⅱ·Ⅲ장 차트 → 캡처 확인** (차트 폭 0 함정: 렌더는 보이는 상태에서)
- [ ] **Step 3: Ⅳ 사분면·Ⅴ 방법론 → 캡처 확인** (details 안 차트 금지)
- [ ] **Step 4: 다크·모바일 전수 캡처 확인**
- [ ] **Step 5: Commit** (장 단위로 중간 커밋 허용)

### Task 6: 배포·검증

- [ ] **Step 1:** `npx wrangler pages project create sicha --production-branch main` (실패=이미 존재 시 무시)
- [ ] **Step 2:** `npx wrangler pages deploy web --project-name sicha --commit-dirty=true`
- [ ] **Step 3:** 라이브 curl로 핵심 문구·noindex 확인, 최종 캡처 4장(데스크톱·모바일 × 라이트·다크)
- [ ] **Step 4: Commit + 메모리 갱신** (sunhwan-portfolio-projects.md에 시차 추가)
