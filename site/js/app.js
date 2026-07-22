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
      const OF = R.official || {};
      const years = [...new Set(Object.keys(R.by_year).concat(Object.keys(OF)))].sort();
      Charts.line($("r-year"), [
        { name: "정부 발표 평균(공동주택 전체)", color: "--ink-3",
          points: years.map(y => ({ label: y + ".01", y: OF[y] != null ? OF[y] : NaN })) },
        { name: "이 표본 중앙값", color: "--s2", emph: true,
          points: years.map(y => ({ label: y + ".01", y: R.by_year[y] ? R.by_year[y].med : NaN })) },
      ], { height: 300, interactive: false, aria: "연도별 현실화율 — 표본과 정부 발표 대조" });

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

    /* Ⅴ 시차지도 */
    const L = B.lag;
    if (L && L.grid && L.grid.length) {
      $("lag-map").innerHTML = `<table class="sheet"><thead><tr>
        <th>선행 → 반응</th><th class="num">최적 시차</th><th class="num">r</th>
        <th class="num">n</th><th>안정</th><th>비고</th></tr></thead><tbody>` +
        L.grid.map(g => {
          const near = g.lag_near != null
            ? `6개월 내 피크 +${g.lag_near}M (r=${g.r_near})` : "";
          const warn = g.n <= 24 ? (near ? near + " · 짧은 표본" : "짧은 표본") : near;
          return `<tr><td><b>${g.x}</b> → ${g.y}</td>
            <td class="num"><b>+${g.lag}개월</b></td>
            <td class="num" style="color:${g.r < 0 ? "var(--eye-red)" : "var(--eye-blue)"}">${g.r > 0 ? "+" : ""}${g.r.toFixed(2)}</td>
            <td class="num">${g.n}</td>
            <td>${g.stable ? '<span class="eye-tag blue">안정</span>' : '<span class="eye-tag" style="color:var(--ink-3)">불안정</span>'}</td>
            <td style="font-size:12px;color:var(--ink-2)">${warn}</td></tr>`;
        }).join("") + "</tbody></table>";
    }

    /* Ⅵ 시차실험실 */
    if (L && L.series) initLab(L);

    /* Ⅶ 방법론 수치 */
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

  /* ── 시차실험실 — 슬라이더로 파형 정렬 ─────────── */
  let labInit = false;
  function initLab(L) {
    const names = Object.keys(L.series);
    const sx = $("lab-x"), sy = $("lab-y"), sk = $("lab-k");
    if (!labInit) {
      labInit = true;
      sx.innerHTML = names.map(n => `<option>${n}</option>`).join("");
      sy.innerHTML = names.map(n => `<option>${n}</option>`).join("");
      sx.value = names.includes("기준금리") ? "기준금리" : names[0];
      sy.value = names.includes("거래량") ? "거래량" : names[1] || names[0];
      [sx, sy].forEach(el => el.addEventListener("change", () => { presetK(); drawLab(); }));
      sk.addEventListener("input", drawLab);
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
      const nx = sx.value, ny = sy.value, k = +sk.value;
      const xm = toMap(L.series[nx]), ym_ = toMap(L.series[ny]);
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
        { name: nx + " — " + unit(nx) + "·z", color: "--s1",
          points: labels.map((t, i) => ({ label: mk(t), y: zx(xv[i]) })) },
        { name: ny + (k ? ` (+${k}개월 앞당김)` : "") + " — " + unit(ny) + "·z", color: "--s2",
          points: labels.map((t, i) => ({ label: mk(t), y: zy(yv[i]) })) },
      ], { height: 320, interactive: false, aria: "두 변수의 파형 정렬(표준화)" });
      const cur = corrAt(xm, ym_, k);
      $("lab-read").innerHTML = cur.r == null
        ? `시차 +${k}개월 · 겹침 ${cur.n}개월 — 표본 부족`
        : `시차 <b>+${k}개월</b> · r = <b style="color:${cur.r < 0 ? "var(--eye-red)" : "var(--eye-blue)"}">${cur.r > 0 ? "+" : ""}${cur.r.toFixed(2)}</b> · 겹침 ${cur.n}개월`;
      // 시차별 곡선
      const pts = [];
      for (let kk = 0; kk <= (L.max_lag || 24); kk++) {
        const c = corrAt(xm, ym_, kk);
        if (c.r != null) pts.push({ x: kk, y: c.r, label: "+" + kk + "M", group: kk === k ? "현재" : "곡선" });
      }
      Charts.scatter($("lab-curve"), pts, { width: 560, height: 300, yRef: 0,
        groups: { "현재": "--s2", "곡선": "--ink-3" },
        xName: "시차(개월)", yName: "r",
        xFmt: v => "+" + Math.round(v), yFmt: v => v.toFixed(1),
        aria: "시차별 상관 곡선" });
    }
  }

  render();
})();
