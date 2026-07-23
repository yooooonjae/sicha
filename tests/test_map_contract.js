/* DOM 계약 테스트 — 지역확산 지도 (Ⅶ 지역확산).
 *
 * 빌드 산출(web/index.html)에서 다음을 assert 수준으로 확인한다:
 *   ① 인라인된 window.__KOREA__ 가 17개 시도 path(name+d)를 담는다.
 *   ② 지도 path 렌더 클래스(kmap-region)와 판독 요소(sp-read)·지도 마운트(sp-map)·
 *      확산 섹션 마운트(spread-wrap) 문자열이 산출물에 존재한다.
 *
 * 지도 <path>·판독 패널은 런타임(app.js)에서 __KOREA__로 그려지므로, 여기서는
 * 헤드리스 브라우저 없이 "데이터 17개 + 렌더/판독 코드 존재" 계약만 본다.
 * web/index.html이 없으면(예: CI — web/ 미커밋) 명시적으로 skip(정상 종료)한다.
 *
 * 실행: node tests/test_map_contract.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "web", "index.html");

if (!fs.existsSync(OUT)) {
  console.log(`  ⊘ SKIP test_map_contract: 빌드 산출 없음(${OUT}) — 검증 건너뜀`);
  process.exit(0);
}

const html = fs.readFileSync(OUT, "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ① 17개 시도 path 데이터 — 인라인 __KOREA__ */
const m = html.match(/window\.__KOREA__\s*=\s*(\[[\s\S]*?\]);<\/script>/);
ok(!!m, "window.__KOREA__ 인라인 배열을 찾지 못함");
if (m) {
  let korea = null;
  try { korea = JSON.parse(m[1]); } catch (e) { fails.push("__KOREA__ JSON 파싱 실패: " + e.message); }
  if (korea) {
    ok(Array.isArray(korea), "__KOREA__ 가 배열이 아님");
    ok(korea.length === 17, `시도 path 개수 ${korea && korea.length} ≠ 17`);
    const names = new Set();
    korea.forEach((sd, i) => {
      ok(sd && typeof sd.name === "string" && sd.name.length > 0, `path[${i}] name 없음`);
      ok(sd && typeof sd.d === "string" && /^[Mm]/.test(sd.d.trim()), `path[${i}](${sd && sd.name}) d가 SVG 경로 아님`);
      if (sd && sd.name) names.add(sd.name);
    });
    ok(names.size === 17, `시도 이름 중복 — 고유 ${names.size} ≠ 17`);
    ok(names.has("서울"), "기준 지역 '서울' path 없음");
    ["경기", "부산", "제주"].forEach(n => ok(names.has(n), `시도 '${n}' path 없음`));
  }
}

/* ② 렌더/판독 요소 존재 (app.js 인라인 산출물 안에서) */
ok(/spread-wrap/.test(html), "확산 섹션 마운트(spread-wrap) 없음");
ok(/kmap-region/.test(html), "지도 시도 path 렌더 클래스(kmap-region) 없음");
ok(/id="sp-map"|sp-map/.test(html), "지도 마운트(sp-map) 없음");
ok(/id="sp-read"|sp-read/.test(html), "판독 요소(sp-read) 없음");

if (fails.length) {
  console.error("  ✗ test_map_contract — 계약 위반:");
  fails.forEach(f => console.error("     · " + f));
  process.exit(1);
}
console.log("  ✓ test_map_contract (17개 시도 path · 렌더/판독 요소 존재)");
process.exit(0);
