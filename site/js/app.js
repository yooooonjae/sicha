/* 시차(視差) 앱 — bundle을 읽어 다섯 장을 계측한다. */
(function () {
  "use strict";
  const B = window.__BUNDLE__ || {};
  const $ = id => document.getElementById(id);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const NAMES = (B.meta && B.meta.sgg_names) || {};
  const nm = sgg => NAMES[sgg] || sgg;

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

  /* ── 모바일 목차 ──────────────────────────────── */
  const ov = $("tocOverlay");
  $("tocBtn").addEventListener("click", () => { ov.hidden = false; });
  $("tocClose").addEventListener("click", () => { ov.hidden = true; });
  ov.querySelectorAll("a").forEach(a => a.addEventListener("click", () => { ov.hidden = true; }));

  /* ── 스크롤 등장 ──────────────────────────────── */
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { threshold: 0.08 });
  document.querySelectorAll(".plate, .kpi").forEach(el => { el.classList.add("rise"); io.observe(el); });

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
    E("line", { x1: x0, x2: x0, y1: M.t, y2: H - M.b, stroke: css("--ink"), "stroke-width": 1.3 });
    items.forEach((d, i) => {
      const cy = M.t + i * rowH;
      E("text", { x: M.l - 10, y: cy + rowH / 2 + 5, "text-anchor": "end",
        "font-size": 13, "font-weight": 700, fill: css("--ink-2") }).textContent = d.name;
      const w = half * Math.abs(d.value) / hi;
      const negC = css("--neg"), posC = css("--pos");
      E("rect", { x: d.value < 0 ? x0 - w : x0, y: cy + 9, width: Math.max(2, w),
        height: rowH - 18, rx: 2, fill: d.value < 0 ? negC : posC, opacity: .88 });
      E("text", { x: d.value < 0 ? x0 - w - 7 : x0 + w + 7, y: cy + rowH / 2 + 5,
        "text-anchor": d.value < 0 ? "end" : "start", "font-size": 12.5, "font-weight": 700,
        fill: d.value < 0 ? negC : posC, "font-family": "var(--font-num)" })
        .textContent = (d.value > 0 ? "+" : "") + d.value.toFixed(1) + "%";
    });
    E("text", { x: x0, y: H - 8, "text-anchor": "middle", "font-size": 11.5,
      fill: css("--ink-3"), "font-family": "var(--font-num)" }).textContent = "0%";
  }

  /* ── 렌더 (테마 전환 시 재호출) ───────────────── */
  function render() {
    const J = B.jeonse, R = B.real, M = B.meta || {};

    /* 홈 KPI */
    const kp = [];
    if (J) {
      const latest = Object.values(J.by_sgg).map(s => s[s.length - 1].ratio);
      const med = latest.sort((a, b) => a - b)[Math.floor(latest.length / 2)];
      kp.push({ v: med.toFixed(1) + "%", l: "전세가율 중앙값 — 최신 분기 · " +
        Object.keys(J.by_sgg).length + "개 시군구", c: "blue" });
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

    /* Ⅰ 계보 수치 */
    $("m-scope").textContent = (M.sgg_names ? Object.keys(M.sgg_names).length : "—") + "개 시군구";
    $("lin-sale").textContent = (M.n_sale || 0).toLocaleString() + "건";
    $("lin-rent").textContent = (M.n_rent || 0).toLocaleString() + "행";
    $("lin-gongsi").textContent = R ? (R.by_complex.length + "관측") : "—";

    /* Ⅰ 단지 해부 — 현실화 관측 최다 단지 */
    if (R && R.by_complex.length) {
      const byApt = {};
      R.by_complex.forEach(c => { (byApt[c.apt + "|" + c.sgg] = byApt[c.apt + "|" + c.sgg] || []).push(c); });
      const best = Object.values(byApt).sort((a, b) => b.length - a.length)[0]
        .sort((a, b) => a.year - b.year);
      const b0 = best[best.length - 1];
      $("c1-title").textContent = `단지 해부 — ${b0.sggNm} ${b0.apt} (전용 ${b0.ar}㎡대)`;
      let jrCell = "—";
      if (J && J.by_sgg[b0.sgg]) {
        const s = J.by_sgg[b0.sgg][J.by_sgg[b0.sgg].length - 1];
        jrCell = s.ratio + "% <span style='color:var(--ink-3)'>(" + s.q + " 시군구)</span>";
      }
      $("c1-table").innerHTML = `<table class="sheet"><thead><tr>
        <th>연도</th><th class="num">시장의 눈 — 매매 중앙값</th><th class="num">행정의 눈 — 공시가격</th>
        <th class="num">현실화율</th></tr></thead><tbody>` +
        best.map(c => `<tr><td class="num">${c.year}</td>
          <td class="num">${c.market_eok.toFixed(1)}억</td>
          <td class="num" style="color:var(--eye-red)">${c.gongsi_eok.toFixed(1)}억</td>
          <td class="num"><b>${c.ratio}%</b></td></tr>`).join("") +
        `<tr><td colspan="3" style="color:var(--ink-2)">세입자의 눈 — 이 시군구의 최신 전세가율</td>
        <td class="num" style="color:var(--eye-blue)"><b>${jrCell}</b></td></tr></tbody></table>`;
    }

    /* Ⅱ 전세가율 */
    if (J) {
      const top = Object.entries(J.by_sgg)
        .sort((a, b) => b[1].length - a[1].length).slice(0, 5);
      Charts.line($("j-line"), top.map(([sgg, series], i) => ({
        name: nm(sgg),
        points: series.map(p => ({ label: p.q.replace("Q", " Q"), y: p.ratio })),
      })), { height: 330, aria: "시군구별 전세가율 분기 추이" });

      const latest = Object.entries(J.by_sgg)
        .map(([sgg, s]) => ({ name: nm(sgg), value: s[s.length - 1].ratio }))
        .sort((a, b) => b.value - a.value);
      Charts.hbars($("j-rank"), latest, { width: 560, labelW: 118, rowH: 36,
        color: "--s1", fmt: v => v.toFixed(1) + "%", aria: "최신 분기 시군구 전세가율" });

      const rev = Object.entries(J.reverse || {})
        .map(([sgg, r]) => ({ name: nm(sgg), value: r.chg_pct }))
        .sort((a, b) => a.value - b.value);
      divergeBars($("j-rev"), rev, { aria: "역전세 — 8분기 전 대비 전세 변화" });
      const rr0 = Object.values(J.reverse || {})[0];
      if (rr0) $("j-line-note").textContent =
        `표본: ${Object.keys(J.by_sgg).length}개 시군구. 매칭 표본 5건 이상 분기는 단지·면적대 매칭 비율, ` +
        `미만이면 ㎡당 중앙값 비율 폴백 — 두 방식이 섞임을 감안해 추세로 읽어야 한다. ` +
        `역전세 비교창: ${rr0.back_q} → ${rr0.now_q}.`;
    }

    /* Ⅲ 현실화율 */
    if (R) {
      $("m-real-n").textContent = R.by_complex.length + "개 단지·연도 관측";
      const years = Object.keys(R.by_year).sort();
      Charts.line($("r-year"), [{
        name: "현실화율 중앙값",
        points: years.map(y => ({ label: y + ".01", y: R.by_year[y].med })),
      }], { height: 280, interactive: false, aria: "연도별 현실화율 중앙값" });

      const pts = R.by_complex.filter(c => c.year >= 2024).map(c => ({
        x: c.market_eok, y: c.ratio, label: c.apt,
        group: c.sido === "서울" ? "서울" : "그 외",
      }));
      Charts.scatter($("r-scatter"), pts, { width: 560, height: 420,
        groups: { "서울": "--s2", "그 외": "--ink-3" },
        xName: "시장 중앙값(억)", yName: "현실화율(%)",
        xFmt: v => v.toFixed(0), yFmt: v => v.toFixed(0) + "%",
        aria: "단지별 시장가와 현실화율 산점" });

      const rk = Object.entries(R.by_sgg).map(([sgg, r]) => ({
        name: nm(sgg), value: r.med })).sort((a, b) => b.value - a.value);
      Charts.hbars($("r-rank"), rk, { width: 560, labelW: 118, rowH: 36,
        color: "--s2", fmt: v => v.toFixed(1) + "%", aria: "시군구별 현실화율" });
    }

    /* Ⅳ 사분면 */
    if (B.quad && B.quad.length) {
      const xs = B.quad.map(q => q.rr).sort((a, b) => a - b);
      const ys = B.quad.map(q => q.jr).sort((a, b) => a - b);
      const xm = xs[Math.floor(xs.length / 2)], ym = ys[Math.floor(ys.length / 2)];
      Charts.scatter($("q-quad"), B.quad.map(q => ({
        x: q.rr, y: q.jr, label: nm(q.sgg),
        group: (q.jr >= ym && q.rr < xm) ? "겹침" : "관측",
      })), { height: 480, xRef: xm, yRef: ym,
        groups: { "겹침": "--s2", "관측": "--s1" },
        xName: "현실화율(%) — 행정의 시차", yName: "전세가율(%) — 세입자의 시차",
        xFmt: v => v.toFixed(0), yFmt: v => v.toFixed(0),
        aria: "전세가율과 현실화율의 사분면" });
      $("q-note").innerHTML = `기준선은 표본 중앙값(현실화율 ${xm.toFixed(1)}% · 전세가율 ` +
        `${ym.toFixed(1)}%). <b>왼쪽 위(적색)</b>가 이중 시차 — 전세가율은 중앙값 위,
        현실화율은 중앙값 아래인 시군구다. 시군구 수가 적어 탐색적 지도다 —
        개별 지역 판정은 원자료 확인이 먼저다.`;
    }

    /* Ⅴ 방법론 수치 */
    const src = [];
    src.push(`<tr><td>국토부 RTMS 매매</td><td>아파트 매매 실거래(수지 공유 원천)</td>
      <td>${M.sgg_names ? Object.keys(M.sgg_names).length : "—"}개 시군구 · 36개월</td>
      <td class="num">${(M.n_sale || 0).toLocaleString()}건</td></tr>`);
    src.push(`<tr><td>국토부 RTMS 전월세</td><td>아파트 전월세 실거래 — 동일 시군구·월 범위</td>
      <td>동일</td><td class="num">${(M.n_rent || 0).toLocaleString()}행</td></tr>`);
    if (R) src.push(`<tr><td>VWorld NED 공시</td><td>공동주택 공시가격 — 지오코더→지적→공시 3단 체인</td>
      <td>2021~2025 · 표본단지</td><td class="num">${R.by_complex.length}관측</td></tr>`);
    $("m-src-rows").innerHTML = src.join("");
    $("m-src-n").textContent = `매매 ${(M.n_sale || 0).toLocaleString()} · 전월세 ${(M.n_rent || 0).toLocaleString()}`;
    if (M.n_skip != null) $("m-skip").textContent = M.n_skip;
  }

  render();
})();
