/* 시차(視差) 앱 — bundle을 읽어 다섯 장을 계측한다. */
(function () {
  "use strict";
  const B = window.__BUNDLE__ || {};
  const $ = id => document.getElementById(id);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const NAMES = (B.meta && B.meta.sgg_names) || {};
  const nm = sgg => NAMES[sgg] || sgg;
  const fmtYm = ym => ym ? ym.slice(0, 4) + "." + ym.slice(4) : "";

  /* 실험실 로드 — 전달경로 라벨·시차지도 셀·모바일 카드가 공유 (선택 후 옵션 스크롤) */
  function loadLab(x, y, scroll) {
    const sx = $("lab-x"), sy = $("lab-y");
    if (!sx || !sy) return;
    sx.value = x; sy.value = y;
    sx.dispatchEvent(new Event("change"));
    if (scroll) { const t = document.getElementById("ch6"); if (t) t.scrollIntoView({ behavior: "smooth" }); }
  }

  /* ── 테마 ─────────────────────────────────────── */
  const root = document.documentElement;
  const themeBtn = $("themeBtn");
  function applyTheme(t) {
    if (t === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    themeBtn.textContent = t === "dark" ? "☾" : "☀";
    try { localStorage.setItem("sicha-theme", t); } catch (e) {}
  }
  let saved = null;
  try { saved = localStorage.getItem("sicha-theme"); } catch (e) {}
  applyTheme(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  themeBtn.addEventListener("click", () => {
    const dark = root.getAttribute("data-theme") === "dark";
    applyTheme(dark ? "light" : "dark");
    render(); // 차트 색 재계산
  });

  /* ── 모바일 목차 (접근성: aria·Esc·포커스 트랩·스크롤 잠금) ──── */
  const ov = $("tocOverlay");
  const tocBtn = $("tocBtn"), tocClose = $("tocClose");
  tocBtn.setAttribute("aria-expanded", "false");
  tocBtn.setAttribute("aria-controls", "tocOverlay");
  const tocFocusables = () => [...ov.querySelectorAll("a, button")]
    .filter(el => !el.disabled && el.offsetParent !== null);
  function openToc() {
    ov.hidden = false;
    document.body.classList.add("scroll-lock");     // 배경 스크롤 잠금
    tocBtn.setAttribute("aria-expanded", "true");
    const first = ov.querySelector("a");            // 열 때 첫 링크로 포커스
    if (first) first.focus();
  }
  function closeToc(returnFocus) {
    if (ov.hidden) return;
    ov.hidden = true;
    document.body.classList.remove("scroll-lock");
    tocBtn.setAttribute("aria-expanded", "false");
    if (returnFocus !== false) tocBtn.focus();       // 닫을 때 버튼으로 복귀
  }
  tocBtn.addEventListener("click", openToc);
  tocClose.addEventListener("click", () => closeToc());
  ov.addEventListener("click", e => { if (e.target === ov) closeToc(); }); // 오버레이 배경 클릭 닫기
  ov.querySelectorAll("a").forEach(a =>
    a.addEventListener("click", () => closeToc(false)));  // 링크 이동 시 포커스 복귀 생략
  document.addEventListener("keydown", e => {
    if (ov.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); closeToc(); }     // Esc 닫기·포커스 복귀
    else if (e.key === "Tab") {                                     // 포커스 트랩(Tab 순환)
      const f = tocFocusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ── 스크롤 등장 ──────────────────────────────── */
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { threshold: 0.08 });
  // 모션 2 — 장 헤더·카드·plate·KPI 스크롤 등장(정적 요소만; 동적 카드는 render가 그린 뒤라 미관측)
  document.querySelectorAll(".plate, .kpi, .ch-head, .nav-card").forEach(el => { el.classList.add("rise"); io.observe(el); });

  /* ── 숫자 카운트업 (모션 3) — 텍스트의 숫자 토큰만 rAF 카운트(소수 자리·"/"·단위 보존).
     reduced-motion: 관측 안 함 → 주입/렌더된 최종값 그대로. ── */
  const REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function countUp(node) {
    const raw = node.textContent;
    const segs = raw.split(/(\d+(?:\.\d+)?)/);   // 짝수 idx=리터럴, 홀수 idx=숫자 토큰
    const nums = segs.map((s, i) => i % 2 ? { v: parseFloat(s), d: (s.split(".")[1] || "").length } : null);
    if (!nums.some(Boolean)) return;             // 숫자 없음(예: "—") — 건너뜀
    const DUR = 800, t0 = performance.now();
    (function frame(now) {
      const p = Math.min(1, (now - t0) / DUR), e = 1 - Math.pow(1 - p, 3);  // easeOutCubic
      node.textContent = segs.map((s, i) => nums[i] ? (nums[i].v * e).toFixed(nums[i].d) : s).join("");
      if (p < 1) requestAnimationFrame(frame);
      else node.textContent = raw;               // 정확한 최종값 복원
    })(performance.now());
  }
  const countIO = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { countIO.unobserve(e.target); countUp(e.target); }
  }), { threshold: 0.6 });
  const watchCount = node => { if (!REDUCE_MOTION) countIO.observe(node); };
  // 히어로 좌하 스탯(빌드 주입 텍스트) — JS가 파싱해 카운트(주입 값 자체는 불변)
  document.querySelectorAll(".hs-v").forEach(watchCount);
  let kpiCounted = false;   // 관문 KPI는 첫 render 후 1회만 관측(테마 토글 재애니 방지)

  /* ── 역전세 발산 바 (전용 렌더러 — 0 중심 좌우) ── */
  function divergeBars(rootEl, items, opts) {
    opts = opts || {};
    const W = opts.width || 560, rowH = 40, M = { t: 8, r: 66, b: 26, l: 120 };
    const H = M.t + items.length * rowH + M.b;
    rootEl.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", opts.aria || "발산 막대");
    svg.style.width = "100%"; svg.style.height = "auto";
    rootEl.appendChild(svg);
    const E = (t, at, parent) => { const n = document.createElementNS(NS, t);
      for (const k in at) n.setAttribute(k, at[k]); (parent || svg).appendChild(n); return n; };
    const hi = Math.max(...items.map(d => Math.abs(d.value)), 1e-9);
    const half = (W - M.l - M.r) / 2, x0 = M.l + half;
    const span = half - 48;  // 값 텍스트 자리 확보 — 최대 바도 라벨을 침범하지 않게
    E("line", { x1: x0, x2: x0, y1: M.t, y2: H - M.b, stroke: css("--ink"), "stroke-width": 1.3 });
    items.forEach((d, i) => {
      const cy = M.t + i * rowH;
      E("text", { x: M.l - 10, y: cy + rowH / 2 + 5, "text-anchor": "end",
        "font-size": 13, "font-weight": 700, fill: css("--ink-2") }).textContent = d.name;
      const w = span * Math.abs(d.value) / hi;
      const negC = css(opts.negColor || "--neg"), posC = css(opts.posColor || "--pos");
      E("rect", { x: d.value < 0 ? x0 - w : x0, y: cy + 9, width: Math.max(2, w),
        height: rowH - 18, rx: 2, fill: d.value < 0 ? negC : posC, opacity: .88 });
      E("text", { x: d.value < 0 ? x0 - w - 7 : x0 + w + 7, y: cy + rowH / 2 + 5,
        "text-anchor": d.value < 0 ? "end" : "start", "font-size": 12.5, "font-weight": 700,
        fill: d.value < 0 ? negC : posC, "font-family": "var(--font-num)" })
        .textContent = opts.fmt ? opts.fmt(d.value) : ((d.value > 0 ? "+" : "") + d.value.toFixed(1) + "%");
    });
    E("text", { x: x0, y: H - 8, "text-anchor": "middle", "font-size": 11.5,
      fill: css("--ink-3"), "font-family": "var(--font-num)" }).textContent = opts.zeroLabel || "0%";
  }

  /* ── 렌더 (테마 전환 시 재호출) ───────────────── */
  const mobQ = matchMedia("(max-width: 640px)");
  mobQ.addEventListener("change", () => render());
  function render() {
    const MOB = mobQ.matches;  // 모바일 — 좁은 viewBox로 세로 판독 확보
    const J = B.jeonse, R = B.real, M = B.meta || {};

    /* 전세가율 기준분기 — 각 시군구 최신 분기의 최빈값(전역 최신 q)으로 고정해 분기 혼용을 막는다 */
    let refQ = null, atRef = null;
    if (J) {
      const qc = {};
      Object.values(J.by_sgg).forEach(s => { const q = s[s.length - 1].q; qc[q] = (qc[q] || 0) + 1; });
      refQ = Object.keys(qc).sort((a, b) => qc[b] - qc[a] || (a > b ? -1 : 1))[0];
      atRef = s => { const p = s.find(x => x.q === refQ); return p ? p.ratio : null; };
    }

    /* 홈 KPI */
    const kp = [];
    if (J) {
      const ref = Object.values(J.by_sgg).map(atRef).filter(v => v != null);
      const med = ref.sort((a, b) => a - b)[Math.floor(ref.length / 2)];
      kp.push({ v: med.toFixed(1) + "%", l: `전세가율 중앙값 — ${refQ} 기준 · ${ref.length}개 시군구`, c: "blue" });
      const revs = Object.values(J.reverse || {}).map(r => r.chg_pct);
      const negN = revs.filter(v => v < 0).length;
      kp.push({ v: negN + "/" + revs.length, l: "역전세권 시군구 — 8분기 전보다 전세 하락", c: "blue" });
    }
    if (R) {
      const y = Object.keys(R.by_year).sort().pop();
      kp.push({ v: R.by_year[y].med.toFixed(1) + "%", l: y + " 현실화율 중앙값 — 표본 " +
        R.by_year[y].n + "개 관측", c: "red" });
      kp.push({ v: String((R.by_complex || []).length), l: "단지·연도 현실화 관측", c: "red" });
    }
    $("home-kpis").innerHTML = kp.map(k =>
      `<div class="kpi"><div class="v ${k.c}">${k.v}</div><div class="l">${k.l}</div></div>`).join("");
    // 모션 3 — 관문 KPI 4개 카운트업(첫 render 후 1회만 관측)
    if (!kpiCounted) { $("home-kpis").querySelectorAll(".v").forEach(watchCount); kpiCounted = true; }

    /* Ⅰ 계보 수치 */
    $("m-scope").textContent = (M.sgg_names ? Object.keys(M.sgg_names).length : "—") + "개 시군구";
    $("lin-sale").textContent = (M.n_sale || 0).toLocaleString() + "건";
    $("lin-rent").innerHTML = (M.n_rental_all != null ? M.n_rental_all : (M.n_rent || 0)).toLocaleString()
      + "행 <span style='color:var(--ink-3)'>· 전세 표본 " + (M.n_jeonse || 0).toLocaleString() + "</span>";
    $("lin-gongsi").textContent = R ? (R.by_complex.length + "관측") : "—";

    /* Ⅰ 단지 해부 — 현실화 관측 최다 단지 */
    if (R && R.by_complex.length) {
      const byApt = {};
      R.by_complex.forEach(c => { (byApt[c.apt + "|" + c.sgg] = byApt[c.apt + "|" + c.sgg] || []).push(c); });
      const best = Object.values(byApt).sort((a, b) => b.length - a.length)[0]
        .sort((a, b) => a.year - b.year);
      const b0 = best[best.length - 1];
      $("c1-title").textContent = `단지 해부 — ${b0.sggNm} ${b0.apt} (전용 ${b0.ar}㎡대)`;
      // 세입자의 눈 — 동일 단지·면적대(±10%) 전세 표본이 5건 이상이면 그 단지에서 직접 읽고,
      // 미만이면 대표값을 감추고 시군구 전세가율을 '지역 참고값'으로 강등(옅은 색·참고 배지)한다.
      const AN = B.anatomy;
      const sg = (J && J.by_sgg[b0.sgg]) ? J.by_sgg[b0.sgg][J.by_sgg[b0.sgg].length - 1] : null;
      let tenantRows;
      if (AN && AN.n_jeonse >= 5 && AN.jeonse_ratio != null) {
        tenantRows = `<tr><td colspan="3" style="color:var(--ink-2)">세입자의 눈 — 동일 단지·면적대 전세 중앙값
          <b style="color:var(--eye-blue)">${AN.jeonse_eok.toFixed(1)}<span class="u">억</span></b>
          <span style="color:var(--ink-3)">· 표본 ${AN.n_jeonse}건</span></td>
          <td class="num" style="color:var(--eye-blue)"><b>${AN.jeonse_ratio}%</b></td></tr>`;
      } else {
        const n = AN ? AN.n_jeonse : 0;
        tenantRows = `<tr><td colspan="3" style="color:var(--ink-2)">세입자의 눈 — 동일 단지 전세 표본 <b class="num">${n}</b>건 · 대표값 미표시</td>
          <td class="num" style="color:var(--ink-3)">—</td></tr>`;
        if (sg) tenantRows += `<tr class="ref-row"><td colspan="3">지역 참고값 — 이 시군구 최신 전세가율 <span class="ref-badge">참고</span></td>
          <td class="num">${sg.ratio}% <span style="color:var(--ink-3)">(${sg.q} 시군구)</span></td></tr>`;
      }
      $("c1-table").innerHTML = `<div class="table-scroll"><table class="sheet"><thead><tr>
        <th>연도</th><th class="num">시장의 눈 — 매매 중앙값</th><th class="num">행정의 눈 — 공시가격</th>
        <th class="num">현실화율</th></tr></thead><tbody>` +
        best.map(c => `<tr><td class="num">${c.year}</td>
          <td class="num">${c.market_eok.toFixed(1)}<span class="u">억</span></td>
          <td class="num" style="color:var(--eye-red)">${c.gongsi_eok.toFixed(1)}<span class="u">억</span></td>
          <td class="num"><b>${c.ratio}%</b></td></tr>`).join("") +
        tenantRows + `</tbody></table></div>`;
    }

    /* Ⅱ 전세가율 */
    if (J) {
      const top = Object.entries(J.by_sgg)
        .sort((a, b) => b[1].length - a[1].length).slice(0, 5);
      Charts.line($("j-line"), top.map(([sgg, series], i) => ({
        name: nm(sgg),
        points: series.map(p => ({ label: p.q.replace("Q", " Q"), y: p.ratio })),
      })), { width: MOB ? 560 : 1160, height: MOB ? 300 : 330, aria: "시군구별 전세가율 분기 추이" });

      const latest = Object.entries(J.by_sgg)
        .map(([sgg, s]) => ({ name: nm(sgg), value: atRef(s) }))
        .filter(d => d.value != null)
        .sort((a, b) => b.value - a.value);
      Charts.hbars($("j-rank"), latest, { width: 560, labelW: 118, rowH: 34,
        color: "--s1", rankTiers: true, medianLine: true,
        fmt: v => v.toFixed(1) + "%", aria: refQ + " 기준 시군구 전세가율" });
      const jru = $("j-rank-unit"); if (jru) jru.textContent = `% · ${refQ} 기준 · ${latest.length}개 시군구`;

      const rev = Object.entries(J.reverse || {})
        .map(([sgg, r]) => ({ name: nm(sgg), value: r.chg_pct }))
        .sort((a, b) => a.value - b.value);
      divergeBars($("j-rev"), rev, { aria: "역전세 — 8분기 전 대비 전세 변화" });
      const rr0 = Object.values(J.reverse || {})[0];
      if (rr0) $("j-line-note").textContent =
        `표본: ${Object.keys(J.by_sgg).length}개 시군구. 매칭 표본 5건 이상 분기는 단지·면적대 매칭 비율, ` +
        `미만이면 ㎡당 중앙값 비율 폴백 — 두 방식이 섞임을 감안해 추세로 읽어야 한다. ` +
        `역전세 비교창: 정확히 8분기(${rr0.back_q}→${rr0.now_q}) 전 대비 — 8분기 전 분기가 결측인 시군구는 비교에서 제외.`;
    }

    /* Ⅲ 현실화율 */
    if (R) {
      $("m-real-n").textContent = R.by_complex.length + "개 단지·연도 관측";
      const OF = R.official || {};
      const years = [...new Set(Object.keys(R.by_year).concat(Object.keys(OF)))].sort();
      Charts.line($("r-year"), [
        { name: "정부 발표 평균", color: "--ink-3",
          points: years.map(y => ({ label: y + ".01", y: OF[y] != null ? OF[y] : NaN })) },
        { name: "이 표본 중앙값", color: "--s2", emph: true,
          points: years.map(y => ({ label: y + ".01", y: R.by_year[y] ? R.by_year[y].med : NaN })) },
      ], { width: MOB ? 560 : 1160, height: 300, rightPad: MOB ? 88 : 96, interactive: false, aria: "연도별 현실화율 — 표본과 정부 발표 대조" });

      const pts = R.by_complex.filter(c => c.year >= 2024).map(c => ({
        x: c.market_eok, y: c.ratio, label: c.apt,
        group: c.sido === "서울" ? "서울" : "그 외",
      }));
      Charts.scatter($("r-scatter"), pts, { width: MOB ? 420 : 560, height: MOB ? 480 : 420,
        groups: { "서울": "--s2", "그 외": "--ink-3" },
        xName: "시장 중앙값(억)", yName: "현실화율(%)",
        xFmt: v => v.toFixed(0), yFmt: v => v.toFixed(0) + "%",
        aria: "단지별 시장가와 현실화율 산점" });

      const rk = Object.entries(R.by_sgg).map(([sgg, r]) => ({
        name: nm(sgg), value: r.med })).sort((a, b) => b.value - a.value);
      Charts.hbars($("r-rank"), rk, { width: 560, labelW: 118, rowH: 34,
        color: "--s2", rankTiers: true, medianLine: true,
        fmt: v => v.toFixed(1) + "%", aria: "시군구별 현실화율" });
    }

    /* Ⅳ 사분면 */
    if (B.quad && B.quad.length) {
      const xs = B.quad.map(q => q.rr).sort((a, b) => a - b);
      const ys = B.quad.map(q => q.jr).sort((a, b) => a - b);
      const xm = xs[Math.floor(xs.length / 2)], ym = ys[Math.floor(ys.length / 2)];
      Charts.scatter($("q-quad"), B.quad.map(q => ({
        x: q.rr, y: q.jr, label: nm(q.sgg),
        group: (q.jr >= ym && q.rr < xm) ? "겹침" : "관측",
      })), { width: MOB ? 420 : 1160, height: MOB ? 520 : 480, xRef: xm, yRef: ym,
        riskQuad: "관찰 우선 구역",
        groups: { "겹침": "--s2", "관측": "--s1" },
        xName: "현실화율(%) — 행정의 시차", yName: "전세가율(%) — 세입자의 시차",
        xFmt: v => v.toFixed(0), yFmt: v => v.toFixed(0),
        aria: "전세가율과 현실화율의 사분면" });
      $("q-note").innerHTML = `기준선은 표본 중앙값(현실화율 ${xm.toFixed(1)}% · 전세가율 ` +
        `${ym.toFixed(1)}%). <b>왼쪽 위(적색)</b>가 이중 시차 — 전세가율은 중앙값 위,
        현실화율은 중앙값 아래인 시군구다. 시군구 수가 적어 탐색적 지도다 —
        개별 지역 판정은 원자료 확인이 먼저다.`;
    }

    /* Ⅴ 전달경로 — 데스크톱: 네트워크+우측 상세 · 모바일: 세로 타임라인 */
    const LG = B.lag;
    if (LG && LG.grid) {
      // 전세가는 서울 하위 계열로만 관측되므로, 개념 노드(매매가→전세가)를 서울 쌍으로 해석한다.
      const gridResolve = (x, y) => LG.grid.find(g2 => g2.x === x && g2.y === y)
        || LG.grid.find(g2 => g2.x === x + "(서울)" && g2.y === y);
      const findLag = (x, y) => {
        const g = gridResolve(x, y);
        return g ? (g.lag_near != null ? g.lag_near : g.lag) : null;
      };
      const NODES = {
        "기준금리": [95, 95], "주담대금리": [305, 95], "거래량": [515, 95],
        "매매가": [725, 95], "전세가": [945, 95],
        "미분양": [420, 275], "착공": [615, 275], "준공": [810, 275], "준공후미분양": [1010, 275],
      };
      const EDGES = [
        ["기준금리", "주담대금리"], ["주담대금리", "거래량"], ["거래량", "매매가"],
        ["매매가", "전세가"], ["매매가", "미분양"], ["미분양", "착공"],
        ["착공", "준공"], ["준공", "준공후미분양"],
      ];
      const SUPPLY_EDGE = new Set(["매매가|미분양", "미분양|착공", "착공|준공", "준공|준공후미분양"]);
      const SUPPLY_NODE = new Set(["미분양", "착공", "준공", "준공후미분양"]);
      const rCol = v => v < 0 ? "var(--time-supply)" : "var(--time-main)";
      // 관계 상세(우측 패널·모바일 인라인 공유) — grid 항목을 판독표로
      const detailHTML = (x, y) => {
        const g = gridResolve(x, y);
        if (!g) return `<p class="pd-empty">${x} → ${y} — 시차 표에 없는 관계다.</p>`;
        const agr = g.agree == null ? null : (g.r < 0 ? 100 - g.agree : g.agree);
        const rg = o => o ? `+${o.lag}M · r ${o.r > 0 ? "+" : ""}${o.r.toFixed(2)}` : "표본 부족";
        const row = (t, v) => `<div><dt>${t}</dt><dd class="num">${v}</dd></div>`;
        const scopeBox = g.scope_mismatch
          ? `<div class="pd-scopewarn">공간 범위 불일치 · ${g.x_scope} → ${g.y_scope}</div>`
          : `<div class="pd-scope">공간 범위 · ${g.x_scope}${g.period ? " · " + fmtYm(g.period[0]) + "–" + fmtYm(g.period[1]) : ""}</div>`;
        return `<div class="pd-head">${g.x} <span style="color:var(--ink-3)">→</span> ${g.y}</div>
          ${scopeBox}
          <div class="pd-big num">+${g.lag}<span class="pd-unit">개월</span><span style="color:${rCol(g.r)}">r ${g.r > 0 ? "+" : ""}${g.r.toFixed(2)}</span></div>
          <dl class="pd-list">
            ${row("표본", "n=" + g.n)}
            ${row("방향 일치", agr != null ? agr + "%" + (g.r < 0 ? " <span style='color:var(--ink-3)'>(역)</span>" : "") : "—")}
            ${row("인상기", rg(g.regime_up))}
            ${row("인하기", rg(g.regime_down))}
            ${g.lag_near != null ? row("6M내 피크", "+" + g.lag_near + "M (" + g.r_near + ")") : ""}
            ${g.at_bound ? `<div><dt>주의</dt><dd style="color:var(--time-supply)">상한(${g.max_lag}M)에서 최대 — 미확정</dd></div>` : ""}
          </dl>
          <button class="btn-sm pd-open" data-x="${g.x}" data-y="${g.y}">실험실에서 열기 →</button>`;
      };
      const bindOpen = scope => scope.querySelectorAll(".pd-open").forEach(b =>
        b.addEventListener("click", () => loadLab(b.dataset.x, b.dataset.y, true)));

      const pp = $("path-svg");
      const detail = $("path-detail");
      const playBtn = $("pp-play");
      if (!pp) { /* 컨테이너 없음 */ }
      else if (MOB) {
        // ── 모바일: 세로 타임라인 (금융·수요 / 공급 피드백 2탭) ──
        if (playBtn) playBtn.style.display = "none";
        if (detail) detail.hidden = true;
        const CHAINS = [
          { name: "금융·수요", nodes: ["기준금리", "주담대금리", "거래량", "매매가", "전세가"] },
          { name: "공급 피드백", nodes: ["매매가", "미분양", "착공", "준공", "준공후미분양"] },
        ];
        let ci = 0;
        pp.innerHTML = `<div class="pt-tabs" role="tablist">${CHAINS.map((c, i) =>
          `<button class="pt-tab${i === 0 ? " on" : ""}" role="tab" aria-selected="${i === 0}" data-c="${i}">${c.name}</button>`).join("")}</div><div class="pt-flow" id="pt-flow"></div>`;
        const drawFlow = () => {
          const ch = CHAINS[ci];
          let h = "";
          ch.nodes.forEach((nd, i) => {
            h += `<div class="pt-node${SUPPLY_NODE.has(nd) ? " supply" : ""}" data-node="${i}"><span class="pt-dot"></span>${nd}</div>`;
            if (i < ch.nodes.length - 1) {
              const a = nd, b = ch.nodes[i + 1], lag = findLag(a, b);
              const gg = gridResolve(a, b);
              const mmE = !!(gg && gg.scope_mismatch);  // 공간 범위 불일치 = 탐색적(회색 점선)
              const supE = SUPPLY_EDGE.has(a + "|" + b);
              const txt = lag == null ? "—" : lag === 0 ? "0M 동행" : "+" + lag + "M";
              h += `<div class="pt-edge${mmE ? " mismatch" : supE ? " supply" : ""}${lag === 0 ? " zero" : ""}" data-edge="${i}">
                <span class="pt-arrow">↓</span>
                <button class="pt-lag${mmE ? " mismatch" : ""}${lag === 0 ? " zero" : ""}" data-x="${a}" data-y="${b}">${txt}</button>
                <span class="pt-dash"></span></div>`;
            }
          });
          const flow = $("pt-flow");
          flow.innerHTML = h;
          const sel = (a, b, afterEl) => {
            const ex = flow.querySelector(".pt-inline");
            const same = ex && ex.dataset.x === a && ex.dataset.y === b;
            if (ex) ex.remove();
            if (same) return;
            const card = document.createElement("div");
            card.className = "pt-inline"; card.dataset.x = a; card.dataset.y = b;
            card.innerHTML = detailHTML(a, b);
            afterEl.insertAdjacentElement("afterend", card);
            bindOpen(card);
          };
          flow.querySelectorAll(".pt-lag").forEach(bt => bt.addEventListener("click", e => {
            e.stopPropagation(); sel(bt.dataset.x, bt.dataset.y, bt.closest(".pt-edge"));
          }));
          flow.querySelectorAll(".pt-node").forEach(ndEl => ndEl.addEventListener("click", () => {
            const i = +ndEl.dataset.node, ei = Math.min(i, ch.nodes.length - 2);
            const edgeEl = flow.querySelector(`.pt-edge[data-edge="${ei}"]`);
            sel(ch.nodes[ei], ch.nodes[ei + 1], edgeEl || ndEl);
          }));
        };
        pp.querySelectorAll(".pt-tab").forEach(bt => bt.addEventListener("click", () => {
          pp.querySelectorAll(".pt-tab").forEach(b2 => { b2.classList.remove("on"); b2.setAttribute("aria-selected", "false"); });
          bt.classList.add("on"); bt.setAttribute("aria-selected", "true"); ci = +bt.dataset.c; drawFlow();
        }));
        drawFlow();
      } else {
        // ── 데스크톱: 네트워크 SVG(좌 70%) + 상세 패널(우 30%) ──
        if (playBtn) playBtn.style.display = "";
        if (detail) detail.hidden = false;
        const R0 = 34;
        let svg = `<svg viewBox="0 0 1120 370" role="img" aria-label="신호 전달경로" style="width:100%;height:auto;display:block">`;
        EDGES.forEach(([a, b], ei) => {
          const [x1, y1] = NODES[a], [x2, y2] = NODES[b];
          const lag = findLag(a, b);
          const g0 = gridResolve(a, b);
          const mismatch = !!(g0 && g0.scope_mismatch);  // 공간 범위 불일치 = 탐색적(경로는 유지)
          const supply = SUPPLY_EDGE.has(a + "|" + b);
          const zero = lag === 0;
          // 색 의미화(時差 팔레트): 공간 범위 불일치 = 회 점선(탐색적, 우선) · 금융·수요 = 청록 실선 ·
          //           공급 피드백 = 적갈 점선 · 동행(0M) = 회 실선(펄스 없음)
          const col = mismatch ? "var(--time-neutral)" : zero ? "var(--time-neutral)" : supply ? "var(--time-supply)" : "var(--time-main)";
          const mk = mismatch || zero ? "arrow-mute" : supply ? "arrow-supply" : "arrow-demand";
          const dashed = mismatch || supply;
          let d;
          if (y1 === y2) d = `M ${x1 + R0} ${y1} L ${x2 - R0 - 8} ${y2}`;
          else d = `M ${x1 - 14} ${y1 + R0 - 6} L ${x2 + 26} ${y2 - R0 + 2}`;
          svg += `<path id="pe${ei}" d="${d}" fill="none" stroke="${col}" stroke-width="1.8" opacity="${mismatch ? .5 : zero ? .55 : .8}"${dashed ? ' stroke-dasharray="6 5"' : ""} marker-end="url(#${mk})"/>`;
          if (lag && !mismatch) {  // 동행(0M)·불일치(탐색적)는 확정 펄스를 그리지 않는다
            const dur = Math.max(1.4, lag * 0.55);
            svg += `<circle r="4.5" fill="${supply ? "var(--time-supply)" : "var(--time-main)"}" opacity="0"><animateMotion class="path-anim" dur="${dur}s" repeatCount="indefinite" begin="indefinite"><mpath href="#pe${ei}"/></animateMotion><set attributeName="opacity" to="1" begin="pp-play.click"/></circle>`;
          }
          if (lag != null) {
            const mx = (x1 + x2) / 2, my = y1 === y2 ? y1 - 16 : (y1 + y2) / 2 + 2;
            const txt = zero ? "0M 동행" : "+" + lag + "M";
            const w3 = zero ? 80 : 62;
            const pillBg = mismatch || zero ? "var(--surface-2)" : supply ? "var(--time-supply-wash)" : "var(--time-main-wash)";
            const pillFg = mismatch ? "var(--time-neutral)" : zero ? "var(--ink-2)" : supply ? "var(--time-supply-deep)" : "var(--time-main-deep)";
            svg += `<g class="path-lag${mismatch ? " mismatch" : ""}" data-x="${a}" data-y="${b}" style="cursor:pointer">
              <rect x="${mx - w3 / 2}" y="${my - 15}" width="${w3}" height="23" rx="11.5" fill="${pillBg}"${mismatch ? ' stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="3 2"' : ""}/>
              <text x="${mx}" y="${my + 1}" text-anchor="middle" font-size="14" font-weight="700" fill="${pillFg}" font-family="${zero ? "var(--font-body)" : "var(--font-num)"}">${txt}</text>
              <title>${a} → ${b}${mismatch ? ` · 공간 범위 불일치(${g0.x_scope} → ${g0.y_scope}) — 탐색적, 경로 유지` : zero ? " — 월간 자료에서는 선후를 구분할 수 없다" : ""} — 우측에 상세</title></g>`;
          }
        });
        for (const [nm2, [x, y]] of Object.entries(NODES)) {
          const supply = SUPPLY_NODE.has(nm2);
          svg += `<circle cx="${x}" cy="${y}" r="${R0 - 6}" fill="var(--surface)" stroke="${supply ? "var(--time-supply)" : "var(--time-main)"}" stroke-width="2"/>
            <text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--ink)">${nm2}</text>`;
        }
        // 화살촉을 계열 색으로 분리(時差 팔레트): 수요=청록 · 공급=적갈 · 동행=회
        const arrowM = (id, fill) => `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${fill}"/></marker>`;
        svg += `<defs>${arrowM("arrow-demand", "var(--time-main)")}${arrowM("arrow-supply", "var(--time-supply)")}${arrowM("arrow-mute", "var(--time-neutral)")}</defs></svg>`;
        pp.innerHTML = svg;
        if (playBtn && !playBtn.dataset.bound) {
          playBtn.dataset.bound = "1";
          playBtn.addEventListener("click", () => {
            pp.querySelectorAll(".path-anim").forEach((an, i2) => { try { an.beginElementAt(i2 * 0.4); } catch (e) {} });
            playBtn.textContent = "재생 중"; playBtn.disabled = true;
          });
        }
        const showDetail = (x, y, gEl) => {
          if (!detail) return;
          detail.innerHTML = detailHTML(x, y);
          bindOpen(detail);
          pp.querySelectorAll(".path-lag").forEach(o => o.classList.remove("on"));
          if (gEl) gEl.classList.add("on");
        };
        pp.querySelectorAll(".path-lag").forEach(g2 => g2.addEventListener("click", () =>
          showDetail(g2.dataset.x, g2.dataset.y, g2)));
      }
    }

    /* Ⅴ 연구 카드 (아래) — 그 위 시차지도 히트맵이 장의 대표 화면 */
    const L = B.lag;
    if (L && L.grid && L.grid.length) {
      /* 시차지도 — 선행(행) × 반응(열) 전수표. 셀=최적 시차 · 농도=|r| · 클릭=실험실 */
      if ($("lag-heat")) {
        const XORD = ["기준금리", "국고10년", "주담대금리", "거래량", "매매가", "거래량(서울)", "매매가(서울)", "미분양", "인허가", "착공", "준공"];
        const YORD = ["주담대금리", "거래량", "매매가", "전세가", "미분양", "착공", "준공", "준공후미분양"];
        const rowsH = XORD.filter(x => L.grid.some(g => g.x === x));
        const colsH = YORD.filter(y => L.grid.some(g => g.y === y));
        const gAt = (x, y) => L.grid.find(g => g.x === x && g.y === y);
        // 셀은 '6M 국소 피크 우선' 시차를 표시하므로 r·농도도 같은 피크값으로 맞춘다(부호·강도 일치).
        const lagAt = (x, y) => { const g = gAt(x, y); return g ? (g.lag_near != null ? g.lag_near : g.lag) : null; };
        const rAt = (x, y) => { const g = gAt(x, y); return g ? (g.lag_near != null ? g.r_near : g.r) : null; };
        const rFmt = r => (r < 0 ? "−" : "+") + Math.abs(r).toFixed(2).replace(/^0\./, "."); // 부호 포함 r(−.62)
        const cellsH = rowsH.map(x => colsH.map(y => { const r = rAt(x, y); return r == null ? NaN : Math.abs(r); }));
        Charts.heatmap($("lag-heat"), { xs: colsH, ys: rowsH, cells: cellsH }, {
          width: MOB ? 720 : 1120, cellH: MOB ? 42 : 46, labelW: 96, negColor: "--time-supply",
          cellText: true, xName: "반응", yName: "선행", vLabel: "|r|",
          cellFmt: (v, r, c) => { const lg = lagAt(rowsH[r], colsH[c]); return lg == null ? "" : lg === 0 ? "0M" : "+" + lg + "M"; },
          cellSub: (v, r, c) => { const rr = rAt(rowsH[r], colsH[c]); return rr == null ? "" : rFmt(rr); }, // 아래줄 = 표시 시차의 부호 r
          cellDashed: (r, c) => { const g = gAt(rowsH[r], colsH[c]); return !!(g && !g.stable); }, // 불안정 = 점선
          cellMark: (r, c) => { const g = gAt(rowsH[r], colsH[c]); return g && g.at_bound ? "▲" : ""; }, // 탐색 상한 도달
          tipFmt: (v, r, c) => { const g = gAt(rowsH[r], colsH[c]); if (!g) return "관측 쌍 아님"; const lg = lagAt(rowsH[r], colsH[c]), rr = rAt(rowsH[r], colsH[c]); return `+${lg}M · r ${rr > 0 ? "+" : ""}${rr.toFixed(2)} · n=${g.n}${g.lag_near != null ? ` · 전역 최적 +${g.lag}M(r ${g.r > 0 ? "+" : ""}${g.r.toFixed(2)})` : ""}${g.stable ? "" : " · 불안정"}${g.at_bound ? " · 상한 도달" : ""}${g.scope_mismatch ? " · 공간 범위 불일치" : ""}`; },
          legend: "셀 위 = 최적 시차 · 아래 = 부호 r · 농도 = |r| · 점선 = 불안정 · ▲ = 탐색 상한 · 빈칸 = 관측 쌍 아님",
          aria: "선행×반응 시차 전수표", onCell: (colV, rowV) => loadLab(rowV, colV, true),
        });
      }
      const grade = g => {
        let res = g.n < 25 ? ["짧은 표본", "var(--ink-3)"]
          : g.n < 60 ? (g.stable ? ["B−(중간)", "var(--ink-2)"] : ["C(중간)", "var(--ink-3)"])
          : (g.stable && Math.abs(g.r) >= 0.4) ? ["A", "var(--time-main)"]
          : g.stable ? ["B", "var(--time-main)"] : ["C", "var(--ink-3)"];
        if (g.scope_mismatch && res[0] === "A") res = ["B", "var(--time-main)"]; // 공간 범위 불일치 = A 금지
        return res;
      };
      const rC = v => v < 0 ? "var(--time-supply)" : "var(--time-main)";
      const agreeShow = g => g.agree == null ? null
        : (g.r < 0 ? 100 - g.agree : g.agree);
      const spark = (ws, maxLag) => {
        if (!ws || ws.length < 3) return '<span style="font-size:12px;color:var(--ink-3)">이동창 표본 부족</span>';
        const ML = maxLag || 24;
        const W2 = 190, H2 = 40, n2 = ws.length;
        const x2 = i => 6 + i * (W2 - 34) / (n2 - 1);   // 우측 28px — 끝 도트·최종값 소라벨 자리
        const y2 = l => 4 + (1 - l / ML) * (H2 - 12);
        const pl = ws.map((w, i) => `${x2(i).toFixed(1)},${y2(w.lag).toFixed(1)}`).join(" ");
        // D-6 — 끝 도트(r3·서피스 링) + 최종값 소라벨(마지막 이동창의 최적 시차)
        const le = ws[n2 - 1], ex = x2(n2 - 1), ey = y2(le.lag);
        const ly = Math.max(9, Math.min(H2 - 3, ey + 3.5));
        return `<svg viewBox="0 0 ${W2} ${H2}" style="width:${W2}px;height:${H2}px;vertical-align:middle">
          <line x1="6" x2="${W2-34}" y1="${y2(0)}" y2="${y2(0)}" stroke="var(--hairline)" stroke-width="1"/>
          <polyline class="spark-line" points="${pl}" fill="none" stroke="var(--time-main)" stroke-width="1.6"/>
          ${ws.map((w, i) => `<circle cx="${x2(i).toFixed(1)}" cy="${y2(w.lag).toFixed(1)}" r="2" fill="var(--time-main)"/>`).join("")}
          <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3" fill="var(--time-main)" stroke="var(--surface)" stroke-width="1.5"/>
          <text x="${(ex + 6).toFixed(1)}" y="${ly.toFixed(1)}" font-size="9.5" font-weight="700" fill="var(--time-main-deep)" font-family="var(--font-num)" class="spark-end">+${le.lag}M</text>
        </svg>`;
      };
      const GROUPS = [
        ["금융 → 신용", ["기준금리|주담대금리"]],
        ["금융·신용 → 수요·가격", ["기준금리|거래량", "기준금리|매매가", "주담대금리|거래량", "주담대금리|매매가", "국고10년|매매가"]],
        ["수요 → 가격", ["거래량|매매가", "거래량(서울)|전세가", "매매가(서울)|전세가"]],
        ["가격·재고 → 공급", ["매매가|미분양", "미분양|착공", "인허가|착공", "착공|준공", "준공|준공후미분양"]],
      ];
      const groupOf = g => { const k2 = g.x + "|" + g.y;
        const f = GROUPS.find(([, ks]) => ks.includes(k2)); return f ? f[0] : "기타"; };
      const ordered = [];
      GROUPS.forEach(([gn], gi) => { const arr = L.grid.filter(g => groupOf(g) === gn);
        arr.forEach((g, i) => ordered.push({ g, head: i === 0 ? gn : null, gi, cnt: arr.length, rest: i > 0, restN: arr.length - 1 })); });
      { const arr = L.grid.filter(g => groupOf(g) === "기타");
        arr.forEach((g, i) => ordered.push({ g, head: i === 0 ? "기타" : null, gi: -1, cnt: arr.length })); }
      $("lag-map").innerHTML = ordered.map(({ g, head, gi, cnt, rest, restN }) => (head ?
        `<div class="lag-grphead" style="grid-column:1/-1">
          ${gi >= 0 ? `<span class="lag-badge">${String.fromCharCode(65 + gi)}</span>` : ""}
          <span class="lag-grpname">${head}</span><span class="lag-grpcnt">· ${cnt}개 관계</span>
          ${restN ? `<button class="btn-sm lag-more" data-grp="${head}" style="margin-left:auto">나머지 ${restN}개 보기 ▾</button>` : ""}</div>` : "") + (g2 => {
        const [gd] = grade(g);
        // 등급 문자 키 — 배지(.lag-grade) 스타일만 결정 (A 채움 · B/C 아웃라인 · 짧은표본 회).
        // 좌측 3px 등급 컬러 바는 제거(E) — 카드는 순백+헤어라인+shadow-1로 깔끔하게.
        const gk = gd[0] === "A" ? "a" : gd[0] === "B" ? "b" : gd[0] === "C" ? "c" : "x";
        const ag = agreeShow(g);
        const rg = (t, o) => o ? `${t} <b class="num">+${o.lag}M</b> <span class="num" style="color:${rC(o.r)}">${o.r > 0 ? "+" : ""}${o.r.toFixed(2)}</span>` : `${t} <span style="color:var(--ink-3)">표본 부족</span>`;
        const per = g.period ? `${fmtYm(g.period[0])}–${fmtYm(g.period[1])}` : "—";
        const tv = g.x_transform === g.y_transform ? g.x_transform : `${g.x_transform}→${g.y_transform}`;
        const scopeTxt = g.scope_mismatch ? `${g.x_scope} → ${g.y_scope}` : (g.x_scope || "—");
        return `<div class="plate${rest ? " lag-rest" : ""}" data-grp2="${groupOf(g)}" ${rest ? "hidden" : ""} style="margin-bottom:0">
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <div class="viz-title">${g.x} → ${g.y}</div>
            ${g.scope_mismatch ? '<span class="scope-badge">공간 범위 불일치</span>' : ""}
            <span class="lag-grade g-${gk}">${gd}</span>
          </div>
          <div class="lag-meta">
            <span><span class="lag-meta-k">공간 범위</span> ${g.scope_mismatch ? `<b class="scope-warn">${scopeTxt}</b>` : `<b>${scopeTxt}</b>`}</span>
            <span class="lag-meta-sep">·</span><span><span class="lag-meta-k">기간</span> <span class="num">${per}</span></span>
            <span class="lag-meta-sep">·</span><span><span class="lag-meta-k">변환</span> ${tv}</span>
            <span class="lag-meta-sep">·</span><span><span class="lag-meta-k">n</span> <span class="num">${g.n}</span></span>
          </div>
          <div style="font-size:20px;margin:6px 0 2px"><b class="num">+${g.lag}</b>개월
            <span class="num" style="color:${rC(g.r)}">r ${g.r > 0 ? "+" : ""}${g.r.toFixed(2)}</span>
            <span style="font-size:12.5px;color:var(--ink-3)"> n=<span class="num">${g.n}</span>${g.lag_near != null ? ` · 6M내 피크 <span class="num">+${g.lag_near}M(${g.r_near})</span>` : ""}${g.at_bound ? ` · <b style="color:var(--time-supply)">탐색 상한(<span class="num">${g.max_lag}M</span>)에서 최대 — 미확정</b>` : ""}</span></div>
          <div style="font-size:13px;color:var(--ink-2);margin-bottom:6px">
            ${ag != null ? `방향 일치 <b class="num">${ag}%</b>${g.r < 0 ? " (역방향 기준)" : ""}` : "방향 일치 표본 부족"}
            &nbsp;·&nbsp; ${rg("인상기", g.regime_up)} &nbsp;·&nbsp; ${rg("인하기", g.regime_down)}</div>
          <div style="display:flex;align-items:center;gap:8px">${spark(g.windows, g.max_lag)}
            <span style="font-size:11.5px;color:var(--ink-3)">이동창(60M)별 최적 시차 — 0~${g.max_lag || 24}M</span></div>
        </div>`;
      })(g)).join("");
      $("lag-map").querySelectorAll(".lag-more").forEach(btn => btn.addEventListener("click", () => {
        const open = btn.dataset.open === "1";
        $("lag-map").querySelectorAll(`.lag-rest[data-grp2="${btn.dataset.grp}"]`)
          .forEach(el2 => { el2.hidden = open; });
        btn.dataset.open = open ? "0" : "1";
        btn.textContent = open ? btn.textContent.replace("접기 ▴", "").replace(/나머지 (\d+)개 보기 ▾|접기 ▴/, "") || btn.textContent : "접기 ▴";
        if (open) btn.textContent = "나머지 " + $("lag-map").querySelectorAll(`.lag-rest[data-grp2="${btn.dataset.grp}"]`).length + "개 보기 ▾";
      }));
    }

    /* 홈 현재 신호 */
    if (B.signals && B.signals.length) {
      $("home-signals").innerHTML = B.signals.map(sg => {
        const dirTxt = sg.dir === "-" ? "하락 전환" : "상승 전환";
        const el2 = sg.elapsed != null ? `<span class="num">${sg.elapsed}</span>개월 경과` : "전환 미탐지";
        const ag = sg.agree;
        return `<div class="kpi"><div class="v" style="font-size:17px">${sg.x} ${dirTxt}</div>
          <div class="l">→ <b>${sg.y}</b> 반응 관측 구간 <b class="num">+${sg.lag}</b>개월 · 현재
          <b>${el2}</b>${ag != null ? ` · 과거 방향 일치 <span class="num">${ag}%</span>${sg.r < 0 ? " <span style='color:var(--ink-3)'>(역)</span>" : ""}` : ""} · 기준 <span class="num">${sg.latest.slice(0,4)}.${sg.latest.slice(4)}</span></div></div>`;
      }).join("");
    } else { const sp = $("signal-plate"); if (sp) sp.hidden = true; }

    /* Ⅵ 시차실험실 */
    if (L && L.series) initLab(L);

    /* Ⅷ 사건연구 */
    if (B.events && B.events.length) {
      const zSpark = (zp, first, peakK) => {
        const W2 = 300, H2 = 54, lo = -3.5, hi2 = 3.5;
        const x2 = k => 8 + (k + 12) * (W2 - 16) / 24;
        const y2 = z => 6 + (1 - (Math.max(lo, Math.min(hi2, z)) - lo) / (hi2 - lo)) * (H2 - 12);
        let d = "", pen = false;
        zp.forEach(p => {
          if (p.z == null) { pen = false; return; }
          d += (pen ? "L" : "M") + x2(p.k).toFixed(1) + " " + y2(p.z).toFixed(1);
          pen = true;
        });
        return `<svg viewBox="0 0 ${W2} ${H2}" style="width:${W2}px;max-width:100%;height:${H2}px">
          <line x1="8" x2="${W2-8}" y1="${y2(0)}" y2="${y2(0)}" stroke="var(--hairline)" stroke-width="1"/>
          <line x1="${x2(0)}" x2="${x2(0)}" y1="4" y2="${H2-4}" stroke="var(--ink)" stroke-width="1.2" stroke-dasharray="3 3"/>
          ${[1,-1].map(v => `<line x1="8" x2="${W2-8}" y1="${y2(v)}" y2="${y2(v)}" stroke="var(--hairline-2)" stroke-width="1"/>`).join("")}
          <path d="${d}" fill="none" stroke="var(--time-main)" stroke-width="1.8"/>
          ${(() => { const z0 = zp.find(p => p.k === 0 && p.z != null); return z0 ? `<circle cx="${x2(0)}" cy="${y2(z0.z)}" r="3" fill="var(--ink)" stroke="var(--surface)" stroke-width="1" pointer-events="none"/>` : ""; })()}
          ${zp.filter(p => p.z != null).map(p => `<circle class="ev-hit" cx="${x2(p.k)}" cy="${y2(p.z)}" r="4.5" fill="transparent" style="cursor:crosshair"><title>T${p.k >= 0 ? "+" : ""}${p.k}M · z=${p.z > 0 ? "+" : ""}${p.z}</title></circle>`).join("")}
          ${peakK != null ? `<circle cx="${x2(peakK)}" cy="${y2(zp.find(p=>p.k===peakK).z)}" r="3.6" fill="var(--time-supply)" stroke="var(--surface)" stroke-width="1" pointer-events="none"/>` : ""}
        </svg>`;
      };
      const evCard = ev => `
        <div class="plate">
          <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
            <div class="viz-title">${ev.name}</div>
            <span class="eye-tag ${ev.type === "통화" ? "blue" : ev.type === "규제" ? "red" : "black"}">${ev.type}</span>
            <span style="margin-left:auto;font-size:12.5px;color:var(--ink-2)">발표 <span class="num">${ev.announce}</span> · 시행 <span class="num">${ev.effective}</span></span>
          </div>
          <div class="viz-q" style="margin-bottom:10px">${ev.note}</div>
          ${ev.rows.length ? `<div class="table-scroll"><table class="sheet"><thead><tr><th>지표</th><th>T−12 ~ T+12 이탈 경로(z)</th>
            <th class="num">첫 반응</th><th class="num">최대 반응</th></tr></thead><tbody>` +
            ev.rows.map(r => `<tr><td><b>${r.ind}</b></td>
              <td>${zSpark(r.z, r.first, r.peak_k)}</td>
              <td class="num">${r.first != null ? "+" + r.first + "M" : "없음"}</td>
              <td class="num">+${r.peak_k}M <span style="color:${r.peak_z < 0 ? "var(--time-supply)" : "var(--time-main)"}">z=${r.peak_z > 0 ? "+" : ""}${r.peak_z}</span></td></tr>`).join("") +
            "</tbody></table></div>" : '<p class="note">이 사건 시점을 덮는 관측 지표가 없다(표본 기간 밖).</p>'}
          <p class="note"><span class="ev-read num" style="color:var(--time-main-deep)"></span>동시 사건: ${ev.concurrent}. 점선 = 사건월(T=0), 가는 선 = ±1z.
          거래량·매매가는 2023-08 이후 표본이라 그 이전 사건에는 나타나지 않는다.</p>
        </div>`;
      const tabs = B.events.map((ev, i) =>
        `<button class="btn-sm ev-tab${i === 0 ? " on" : ""}" role="tab" aria-selected="${i === 0}" data-i="${i}">${ev.name.split(" ")[0].slice(0, 10)}</button>`).join("");
      $("event-cards").innerHTML = `<div class="tab-row" role="tablist">${tabs}</div><div id="ev-panel">${evCard(B.events[0])}</div>`;
      const bindEvDots = () => $("ev-panel").querySelectorAll("circle.ev-hit").forEach(c =>
        c.addEventListener("pointerdown", () => {
          const t = c.querySelector("title"), plate = c.closest(".plate");
          plate.querySelectorAll("circle.ev-hit.on").forEach(o => o.classList.remove("on"));
          c.classList.add("on");
          const rd = plate.querySelector(".ev-read");
          if (t && rd) rd.textContent = "판독: " + t.textContent + " · ";
        }));
      bindEvDots();
      $("event-cards").querySelectorAll(".ev-tab").forEach(btn => btn.addEventListener("click", () => {
        $("event-cards").querySelectorAll(".ev-tab").forEach(b2 => { b2.classList.remove("on"); b2.setAttribute("aria-selected", "false"); });
        btn.classList.add("on"); btn.setAttribute("aria-selected", "true");
        $("ev-panel").innerHTML = evCard(B.events[+btn.dataset.i]);
        bindEvDots();
      }));
    }

    /* 신호원장 — 예측 장부 + 자동 채점 KPI (전향 live·사후 backtest 분리, 축적 전엔 '축적 시작' 정직 표기) */
    if (B.ledger) {
      const LD = B.ledger, kk = LD.kpi || {};
      const live = kk.live || 0, bt = kk.backtest || 0, lv = kk.live_verified || 0, bv = kk.backtest_verified || 0;
      const kL = [
        { v: `${live} · ${bt}`, l: "전향(live) · 사후(backtest) — 결정 시점 반응월 데이터 유무로 구분" },
        lv
          ? { v: kk.live_hit_rate + "%", l: `전향 방향 적중률 — live ${lv}건 채점(사후 backtest 제외)`, c: kk.live_hit_rate >= 50 ? "pos" : "neg" }
          : { v: "축적 시작", l: (kk.start || "—") + " — 전향 예측 반응월 도래 전(정직 표기)", c: "mut" },
        bv
          ? { v: kk.backtest_hit_rate + "%", l: `사후 부호 일치 — backtest ${bv}건(전향 예측 아님·참고)`, c: "mut" }
          : { v: "—", l: "사후 검증 없음 — 참고 지표", c: "mut" },
      ];
      const kEl = $("ledger-kpis");
      if (kEl) kEl.innerHTML = kL.map(x =>
        `<div class="kpi"><div class="v${x.c ? " " + x.c : ""}" style="font-size:22px">${x.v}</div><div class="l">${x.l}</div></div>`).join("");
      const stColor = s => s === "적중" ? "var(--pos)" : s === "빗나감" ? "var(--neg)" : "var(--ink-3)";
      const stLabel = s => s === "pending" ? "대기" : s;
      const dirWord = d => d === "-" ? "하락" : d === "+" ? "상승" : d;
      const kindTag = k => k === "backtest"
        ? `<span title="결정 시점에 반응월이 이미 관측돼 있던 사후 검증 — 전향 예측이 아니다" style="font-size:11px;font-weight:700;color:var(--ink-3);border:1px solid var(--rule);border-radius:3px;padding:1px 5px;white-space:nowrap">사후 backtest</span>`
        : `<span title="결정 시점에 반응월이 미관측 — 미리 적어 둔 전향 예측" style="font-size:11px;font-weight:700;color:var(--eye-blue);border:1px solid var(--eye-blue);border-radius:3px;padding:1px 5px;white-space:nowrap">전향 live</span>`;
      const rows = (LD.entries || []).slice().reverse(); // 최신 판정 먼저
      const tEl = $("ledger-table");
      if (tEl) tEl.innerHTML = rows.length ? `<div class="table-scroll"><table class="sheet">
        <thead><tr><th>판정일</th><th>구분</th><th>신호(선행 → 반응)</th><th class="num">예상</th><th class="num">검증기한</th><th>상태</th></tr></thead><tbody>` +
        rows.map(e => `<tr>
          <td class="num">${e.decided_on}</td>
          <td>${kindTag(e.kind)}</td>
          <td><b>${e.x}</b> ${dirWord(e.dir)} <span style="color:var(--ink-3)">→</span> <b>${e.y}</b></td>
          <td class="num">+${e.lag}M · ${dirWord(e.expect_dir)}</td>
          <td class="num">${e.verify_by}</td>
          <td style="font-weight:700;color:${stColor(e.status)}">${stLabel(e.status)}${e.observed_dir ? ` <span style="color:var(--ink-3);font-weight:400">관측 ${dirWord(e.observed_dir)}</span>` : ""}</td>
        </tr>`).join("") + `</tbody></table></div>` :
        `<p class="note" style="border-top:none;padding-top:0">아직 기록된 신호가 없다 — 선행 변수의 방향 전환이 잡히는 빌드부터 축적된다.</p>`;
      const nEl = $("ledger-note");
      if (nEl) nEl.innerHTML = `채점 규칙: 반응 변수 변환값(전년동월비·차분)의 <b>목표월(전환월 + 예상시차)</b> 부호를 예측 방향(선행 방향 × 관계 부호)과 대조한다.
        <b>검증기한 = 목표월 + 데이터 공개지연(1개월)</b>이라 결정일과 무관하다. 결정 시점에 목표월이 반응 계열의 최신 관측월보다 미래면 <b>전향(live)</b> 예측으로 대기하고,
        이미 관측돼 있으면 <b>사후(backtest)</b>로 그 자리에서 채점한다 — <b>backtest는 사후 검증이며 전향 예측이 아니다.</b> <b>단순 부호 규칙</b>이라 반응의 크기·유의성·자기상관은
        보지 않으며, 반응월이 표본 밖이면 '미검증'이다. 신호는 선행 변수의 방향 전환이라 재빌드해도 같은 전환은 한 번만 기록된다(판정일·kind 고정).`;
    } else { const lp = $("ledger"); if (lp) lp.hidden = true; }

    /* Ⅶ 지역확산 — 확산 지도(대표) + 발산 바 */
    const SP = B.spread, KOREA = window.__KOREA__ || [];
    if (SP) {
      const wrap = $("spread-wrap");
      const vars = Object.entries(SP).filter(([, rows]) => rows.length);
      if (!vars.length) { wrap.innerHTML = ""; }
      else {
        wrap.innerHTML = `<div class="plate">
          <div class="tab-row" role="tablist">${vars.map(([vn], i) =>
            `<button class="btn-sm sp-tab${i === 0 ? " on" : ""}" role="tab" aria-selected="${i === 0}" data-vn="${vn}">${vn}</button>`).join("")}</div>
          <div class="viz-title" id="sp-title"></div>
          <div class="viz-q">서울과 각 시도의 양방향 최적 시차 —
            <b style="color:var(--time-main)">■ 청록</b> 서울이 먼저 ·
            <b style="color:var(--time-supply)">■ 적갈</b> 그 지역이 먼저 ·
            <b style="color:var(--time-neutral)">■ 회</b> 동행 · <b style="color:var(--ink-3)">□ 옅음</b> 독립·자료없음</div>
          <div id="sp-read" class="sp-read"></div>
          <div class="spread-split">
            <div class="sp-mapcol">
              <div id="sp-map"></div>
              <div class="sp-metros" id="sp-metros" role="group" aria-label="소형 광역시 바로 선택"></div>
            </div>
            <div><div class="viz-unit" style="margin:0 0 4px">개월 · 양방향 최적 시차(발산 바)</div><div id="sp-panel"></div></div>
          </div>
          <p class="note" id="sp-note"></p></div>`;
        const seqTeal = ["--seq-300", "--seq-400", "--seq-500", "--seq-600", "--seq-700"]; // 청록 램프(--seq) — 서울 선행 농도
        const fillFor = rec => {
          if (!rec || rec.verdict === "독립") return { f: css("--surface-2"), s: css("--hairline-2") };
          if (rec.verdict === "동행") return { f: css("--time-neutral-wash"), s: css("--hairline") };
          if (rec.verdict === "서울 선행") return { f: css(seqTeal[Math.min(4, Math.floor(Math.abs(rec.k) / 3))]), s: css("--hairline") };
          const pct = 30 + Math.min(58, Math.abs(rec.k) * 6); // 지역 선행 — 적갈 농도
          return { f: `color-mix(in srgb, ${css("--time-supply")} ${pct}%, ${css("--surface")})`, s: css("--hairline") };
        };
        // 판정 → 라벨·색 클래스·한 줄 해석 (판독 패널의 판정·해석 공통 출처)
        const verdictInfo = (name, rec) => {
          if (name === "서울") return { label: "기준 지역", cls: "ref", line: "다른 시도의 시차를 재는 비교 기준이다." };
          if (!rec) return { label: "표본 없음", cls: "none", line: "이 변수의 지역 표본이 없다." };
          if (rec.verdict === "독립") return { label: "독립 (|r|&lt;0.3)", cls: "indep", line: name + "는 서울과 뚜렷한 선후 관계가 없다." };
          if (rec.verdict === "동행") return { label: "동행 (±1개월)", cls: "sync", line: name + "는 서울과 거의 동시에 움직인다." };
          if (rec.verdict === "서울 선행") return { label: "서울 선행 +" + rec.k + "M", cls: "seoul", line: "서울이 " + name + "보다 " + rec.k + "개월 먼저 움직였다." };
          return { label: "지역 선행 +" + Math.abs(rec.k) + "M", cls: "region", line: name + "가 서울보다 " + Math.abs(rec.k) + "개월 먼저 움직였다." };
        };
        const METROS = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"]; // 소형 광역시(작은 폴리곤) 보조 선택
        const drawSp = vn => {
          const rows = SP[vn], byRegion = {};
          rows.forEach(r => byRegion[r.region] = r);
          const bars = rows.filter(r2 => r2.verdict !== "독립");
          const indep = rows.filter(r2 => r2.verdict === "독립").map(r2 => r2.region);
          $("sp-title").textContent = `${vn} — 서울 대비 지역 시차 지도`;
          $("sp-note").innerHTML = `판정: <span class="num">${rows.filter(r2 => r2.verdict === "서울 선행").length}</span>곳 서울 선행 · ` +
            `<span class="num">${rows.filter(r2 => r2.verdict === "지역 선행").length}</span>곳 지역 선행 · ` +
            `<span class="num">${rows.filter(r2 => r2.verdict === "동행").length}</span>곳 동행${indep.length ? " · 독립(|r|&lt;0.3): " + indep.join("·") : ""}. ` +
            `|r| 최대 기준이며 <b>예측적 선후관계다 — 전달 경로의 증명이 아니다.</b>`;
          // 지도 — 서울은 is-ref(점선 기준선), 나머지는 판정 채움 + 기본 실선(호버·선택은 CSS 클래스가 담당)
          let msvg = `<svg viewBox="0 0 520 690" role="img" aria-label="${vn} 지역확산 지도" style="width:100%;height:auto;display:block">`;
          KOREA.forEach(sd => {
            const isSeoul = sd.name === "서울";
            const st = isSeoul ? { f: css("--time-main-wash"), s: css("--ink") } : fillFor(byRegion[sd.name]);
            msvg += `<path class="kmap-region${isSeoul ? " is-ref" : ""}" data-region="${sd.name}" d="${sd.d}" fill="${st.f}" stroke="${st.s}" stroke-width="1"/>`;
          });
          msvg += `</svg>`;
          $("sp-map").innerHTML = msvg;
          // 판독 패널 — 지역 / 변수 / 판정 / r·n / 한 줄 해석
          const readEl = $("sp-read");
          const renderRead = name => {
            if (name == null) { readEl.innerHTML = `<span class="spr-hint">지도의 지역을 누르거나 아래 <b>소형 광역시</b> 버튼을 선택하면 판독이 뜬다 · <span class="spr-ref-chip">서울</span>은 기준 지역</span>`; return; }
            const rec = byRegion[name], vi = verdictInfo(name, rec);
            const rn = rec ? `<span class="num">${rec.r > 0 ? "+" : ""}${rec.r.toFixed(2)}</span> · n <span class="num">${rec.n}</span>` : `<span style="color:var(--ink-3)">—</span>`;
            readEl.innerHTML = `<div class="spr-grid">` +
              `<div class="spr-f"><span class="spr-k">지역</span><span class="spr-v spr-region">${name}</span></div>` +
              `<div class="spr-f"><span class="spr-k">변수</span><span class="spr-v">${vn}</span></div>` +
              `<div class="spr-f"><span class="spr-k">판정</span><span class="spr-verdict ${vi.cls}">${vi.label}</span></div>` +
              `<div class="spr-f"><span class="spr-k">r · n</span><span class="spr-v">${rn}</span></div>` +
              `</div><p class="spr-line">${vi.line}</p>`;
          };
          // 지도 상태·선택 관리 (서울=기준은 선택 강조 대상이 아니라 항상 점선)
          const paths = [...$("sp-map").querySelectorAll(".kmap-region")];
          const metroWrap = $("sp-metros");
          let selected = null;
          const syncMetros = () => metroWrap.querySelectorAll(".sp-metro").forEach(b =>
            b.classList.toggle("on", !b.disabled && b.dataset.region === selected));
          const setSel = name => {
            selected = name;
            paths.forEach(o => o.classList.toggle("is-sel", name !== "서울" && o.dataset.region === name));
            const sp = paths.find(o => o.dataset.region === name);
            if (sp && name !== "서울") sp.parentNode.appendChild(sp); // 선택 외곽선을 위로
            syncMetros(); renderRead(name);
          };
          paths.forEach(p => {
            p.addEventListener("pointerenter", () => renderRead(p.dataset.region)); // 호버 = 미리보기(외곽선은 CSS :hover)
            p.addEventListener("pointerleave", () => renderRead(selected));
            p.addEventListener("click", () => setSel(p.dataset.region));
          });
          // 소형 광역시 버튼 — 지도 아래, 탭=지도 탭과 동일(판독+강조). 서울은 기준이라 비활성
          metroWrap.innerHTML = METROS.map(mn => {
            const dis = mn === "서울";
            return `<button class="btn-sm sp-metro" data-region="${mn}"${dis ? " disabled aria-disabled=\"true\"" : ""}>${mn}${dis ? `<span class="sp-metro-tag">기준</span>` : ""}</button>`;
          }).join("");
          metroWrap.querySelectorAll(".sp-metro").forEach(b => {
            if (b.disabled) return;
            b.addEventListener("click", () => setSel(b.dataset.region));
          });
          renderRead(null);
          // 발산 바(우)
          divergeBars($("sp-panel"), bars.map(r2 => ({ name: r2.region, value: r2.k })),
            { width: MOB ? 560 : 720, posColor: "--time-main", negColor: "--time-supply", zeroLabel: "동시",
              fmt: v => (v > 0 ? "+" : "") + v + "M", aria: vn + " 지역확산 시차" });
        };
        drawSp(vars[0][0]);
        wrap.querySelectorAll(".sp-tab").forEach(btn => btn.addEventListener("click", () => {
          wrap.querySelectorAll(".sp-tab").forEach(b2 => { b2.classList.remove("on"); b2.setAttribute("aria-selected", "false"); });
          btn.classList.add("on"); btn.setAttribute("aria-selected", "true"); drawSp(btn.dataset.vn);
        }));
      }
    }

    /* Ⅸ 방법론 수치 */
    const src = [];
    src.push(`<tr><td>국토부 RTMS 매매</td><td>아파트 매매 실거래(수지 공유 원천)</td>
      <td>${M.sgg_names ? Object.keys(M.sgg_names).length : "—"}개 시군구 · 36개월</td>
      <td class="num">${(M.n_sale || 0).toLocaleString()}<span class="u">건</span></td></tr>`);
    const nAll = M.n_rental_all != null ? M.n_rental_all : (M.n_rent || 0);
    src.push(`<tr><td>국토부 RTMS 전월세</td>
      <td>아파트 전월세 실거래 — 전세 표본 ${(M.n_jeonse || 0).toLocaleString()} · 월세 ${(M.n_monthly || 0).toLocaleString()}${M.n_invalid ? " · 무효 " + M.n_invalid.toLocaleString() : ""}(전세 = 월세 0·보증금·면적 유효)</td>
      <td>동일 시군구·월 범위</td><td class="num">${nAll.toLocaleString()}<span class="u">행</span></td></tr>`);
    if (R) src.push(`<tr><td>VWorld NED 공시</td><td>공동주택 공시가격 — 지오코더→지적→공시 3단 체인</td>
      <td>2021~2025 · 표본단지</td><td class="num">${R.by_complex.length}<span class="u">관측</span></td></tr>`);
    $("m-src-rows").innerHTML = src.join("");
    $("m-src-n").textContent = `매매 ${(M.n_sale || 0).toLocaleString()} · 전월세 ${nAll.toLocaleString()}(전세 ${(M.n_jeonse || 0).toLocaleString()})`;
    if (M.n_skip != null) $("m-skip").textContent = M.n_skip;

    /* Ⅸ 데이터 상태 — 관측월·수집일 매니페스트 */
    if (B.manifest && B.manifest.datasets && $("m-manifest-rows")) {
      const pgt = p => p == null ? "—"
        : (typeof p === "object")
          ? `${p.pct.toFixed(0)}% <span style="color:var(--ink-3)">(${p.done.toLocaleString()}/${p.total.toLocaleString()})</span>`
          : `${Math.round(p * 100)}%`;
      $("m-manifest-rows").innerHTML = B.manifest.datasets.map(d => {
        const obs = d.obs_range ? `${d.obs_range[0]} ~ ${d.obs_range[1]}` : "—";
        return `<tr><td><b>${d.name}</b><br><span style="color:var(--ink-3);font-size:12px">${d.source || ""}</span></td>
          <td>${d.scope || "—"}</td>
          <td class="num">${obs}</td>
          <td class="num">${d.collected_at || "—"}</td>
          <td class="num">${(d.rows || 0).toLocaleString()}<span class="u">${d.unit || ""}</span></td>
          <td class="num">${pgt(d.progress)}</td></tr>`;
      }).join("");
    }
  }

  /* ── 시차실험실 — 슬라이더로 파형 정렬 ─────────── */
  let labInit = false;
  function initLab(L) {
    const names = Object.keys(L.series);
    const sx = $("lab-x"), sy = $("lab-y"), sk = $("lab-k"), sr = $("lab-regime");
    if (!labInit) {
      labInit = true;
      sx.innerHTML = names.map(n => `<option>${n}</option>`).join("");
      sy.innerHTML = names.map(n => `<option>${n}</option>`).join("");
      sx.value = names.includes("기준금리") ? "기준금리" : names[0];
      sy.value = names.includes("거래량") ? "거래량" : names[1] || names[0];
      let sweep = null;
      const stopSweep = () => { if (sweep) { clearInterval(sweep); sweep = null; $("lab-play").textContent = "▶"; } };
      [sx, sy].forEach(el => el.addEventListener("change", () => { stopSweep(); presetK(); drawLab(); }));
      sk.addEventListener("input", drawLab);
      sr.addEventListener("change", () => { stopSweep(); drawLab(); });
      const play = $("lab-play");
      play.addEventListener("click", () => {
        if (sweep) { clearInterval(sweep); sweep = null; play.textContent = "▶"; return; }
        sk.value = 0; drawLab(); play.textContent = "⏸";
        sweep = setInterval(() => {
          const nk = +sk.value + 1;
          if (nk > 24) { clearInterval(sweep); sweep = null; play.textContent = "▶"; return; }
          sk.value = nk; drawLab();
        }, 340);
      });
      presetK();
    }
    drawLab();

    function presetK() {  // 사전계산된 최적 시차(저시차 피크 우선)로 슬라이더 초기화
      const g = (L.grid || []).find(g2 => g2.x === sx.value && g2.y === sy.value);
      sk.value = g ? (g.lag_near != null ? g.lag_near : Math.min(g.lag, 24)) : 0;
    }

    function toMap(rows) { const m = new Map(); rows.forEach(r => m.set(r.ym, r.v)); return m; }
    function shift(ym, k) {
      let y = +ym.slice(0, 4), mo = +ym.slice(4, 6) + k;
      y += Math.floor((mo - 1) / 12); mo = (mo - 1) % 12 + 1;
      return String(y) + String(mo).padStart(2, "0");
    }
    function corrAt(xm, ym_, k) {
      const px = [], py = [];
      xm.forEach((v, t) => { const u = ym_.get(shift(t, k)); if (u != null) { px.push(v); py.push(u); } });
      const n = px.length;
      if (n < 20) return { r: null, n };
      const mx = px.reduce((a, b) => a + b, 0) / n, my = py.reduce((a, b) => a + b, 0) / n;
      let sxx = 0, syy = 0, sxy = 0;
      for (let i = 0; i < n; i++) { const a = px[i] - mx, b = py[i] - my; sxx += a * a; syy += b * b; sxy += a * b; }
      return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null, n };
    }

    function drawLab() {
      const MOB = matchMedia("(max-width: 640px)").matches;
      const nx = sx.value, ny = sy.value, k = +sk.value, rgm = sr.value;
      let xm = toMap(L.series[nx]);
      const ym_ = toMap(L.series[ny]);
      if (rgm !== "all" && L.series["기준금리"]) {
        const base = toMap(L.series["기준금리"]);
        const keep = t => { const v = base.get(t); return v != null && (rgm === "up" ? v > 0.1 : v < -0.1); };
        xm = new Map([...xm].filter(([t]) => keep(t)));
      }
      const isRate = n => (L.rate_vars || []).includes(n);
      const unit = n => isRate(n) ? "12개월 차분(pp)" : "전년동월비(%)";
      // 파형: x 그대로, y는 k개월 앞당김(t-k의 값을 t 위치에)
      let labels = [...xm.keys()].sort();
      // 두 계열의 겹침 구간 중심으로 줌 — 짧은 계열이 구석에 몰리지 않게 (±8개월 여유)
      const hasY = labels.map(t => ym_.has(shift(t, k)));
      const fi = hasY.indexOf(true), li = hasY.lastIndexOf(true);
      if (fi >= 0 && li - fi + 1 < labels.length - 16) {
        labels = labels.slice(Math.max(0, fi - 8), Math.min(labels.length, li + 9));
      }
      const mk = t => t.slice(0, 4) + "." + t.slice(4, 6);
      // 표준화(z) — 단위가 다른 두 파형의 '모양'을 정렬해 비교 (상관은 원값과 동일)
      const zfn = vals => {
        const fin = vals.filter(Number.isFinite);
        const m = fin.reduce((a, b) => a + b, 0) / (fin.length || 1);
        const sd = Math.sqrt(fin.reduce((a, b) => a + (b - m) ** 2, 0) / (fin.length || 1)) || 1;
        return v => Number.isFinite(v) ? (v - m) / sd : NaN;
      };
      const xv = labels.map(t => xm.has(t) ? xm.get(t) : NaN);
      const yv = labels.map(t => ym_.has(shift(t, k)) ? ym_.get(shift(t, k)) : NaN);
      const zx = zfn(xv), zy = zfn(yv);
      Charts.line($("lab-wave"), [
        { name: nx + "·z", color: "--time-main",
          points: labels.map((t, i) => ({ label: mk(t), y: zx(xv[i]) })) },
        { name: ny + (k ? ` +${k}M` : "") + "·z", color: "--time-supply",
          points: labels.map((t, i) => ({ label: mk(t), y: zy(yv[i]) })) },
      ], { width: MOB ? 560 : 1160, height: MOB ? 340 : 320, rightPad: MOB ? 96 : 116, interactive: false, glow: true, aria: "두 변수의 파형 정렬(표준화)" });
      const cur = corrAt(xm, ym_, k);
      $("lab-read").innerHTML = cur.r == null
        ? `시차 <span class="num">+${k}</span>개월 · 겹침 <span class="num">${cur.n}</span>개월 — 표본 부족`
        : `시차 <b class="num">+${k}</b>개월 · r = <b class="num" style="color:${cur.r < 0 ? "var(--time-supply)" : "var(--time-main)"}">${cur.r > 0 ? "+" : ""}${cur.r.toFixed(2)}</b> · 겹침 <span class="num">${cur.n}</span>개월`;
      // 시차별 곡선
      const pts = [];
      for (let kk = 0; kk <= (L.max_lag || 24); kk++) {
        const c = corrAt(xm, ym_, kk);
        if (c.r != null) pts.push({ x: kk, y: c.r, label: "+" + kk + "M", group: kk === k ? "현재" : "곡선" });
      }
      Charts.scatter($("lab-curve"), pts, { width: MOB ? 420 : 560, height: MOB ? 340 : 300, yRef: 0,
        groups: { "현재": "--time-main", "곡선": "--ink-3" },
        xName: "시차(개월)", yName: "r",
        xFmt: v => "+" + Math.round(v), yFmt: v => v.toFixed(1),
        aria: "시차별 상관 곡선" });
    }
  }

  render();
})();
