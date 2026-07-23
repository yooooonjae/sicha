# 시차(視差·時差) — 수집 → 지표 → 조립 3단 파이프라인
# 원자료는 자매 리포(수지·순환)를 참조한다: SUJI_DIR·SUNHWAN_DIR (기본 ~/개발·~/순환).
# 레시피는 `target: ; cmd` 한 줄 형식 — 탭 들여쓰기에 의존하지 않는다.
.DEFAULT_GOAL := build
PY := python3
# CHROME: 헤드리스 OG 렌더용 브라우저 — PATH에서 자동 탐색(portable). 리눅스는 chrome/chromium,
# 못 찾으면 macOS 기본 앱 경로로 폴백. og 타깃에서 "$(CHROME)"로 따옴표 감싸 공백 경로도 안전.
CHROME := $(shell command -v google-chrome-stable 2>/dev/null || command -v google-chrome 2>/dev/null || command -v chromium 2>/dev/null || command -v chromium-browser 2>/dev/null || echo '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

.PHONY: all analysis metrics lags events build build-index og test \
        collect-rent collect-gongsi clean help

## all: 지표→시차→사건→조립 전 과정 (원자료 필요)
all: analysis build

## analysis: 지표·시차·사건연구 순차 → out/site_bundle.json (+ data/ledger.json·DATA_MANIFEST.json)
analysis: metrics lags events

## metrics: 전세가율·현실화율·사분면·視差 매니페스트
metrics: ; $(PY) -m src.analysis.metrics
## lags: 전달 시차·국면·이동창·지역확산 + 신호원장(ledger)·時差 매니페스트
lags: ; $(PY) -m src.analysis.lags
## events: 정책 5건 사건연구(z 이탈)
events: ; $(PY) -m src.analysis.events

## build: out/site_bundle.json → web/index.html (단일 파일, og.png 동봉·빌드 스탬프)
build: ; $(PY) src/build/assemble.py
## build-index: 검색 색인 허용(robots index)으로 빌드
build-index: ; $(PY) src/build/assemble.py --index

## og: OG 이미지 재생성 (site/og.html → site/og.png, 헤드리스 크롬 1200×630)
og: ; "$(CHROME)" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,630 --default-background-color=FFFFFFFF --screenshot="$(CURDIR)/site/og.png" "$(CURDIR)/site/og.html"

## test: 지표·시차 부호 규칙 단위 테스트 (원자료 불필요)
test: ; $(PY) tests/test_metrics.py

## collect-rent: 전월세 실거래 수집(resume) — config.json service_key 필요
collect-rent: ; $(PY) src/collect/rent.py
## collect-gongsi: 공동주택 공시가격 표본 수집 — config.json vworld_key 필요
collect-gongsi: ; $(PY) src/collect/gongsi.py

## clean: 빌드 산출물 제거 (원장·매니페스트·수집 데이터는 보존)
clean: ; rm -rf web web.tmp out/site_bundle.json

## help: 타깃 목록
help: ; @grep -E '^##' $(MAKEFILE_LIST) | sed 's/## //'
