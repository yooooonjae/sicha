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
      })), { width: MOB ? 560 : 1160, height: MOB ? 300 : 330, aria: "시군구별 전세가율 분기 추이" });

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
      ], { width: MOB ? 560 : 1160, height: 300, interactive: false, aria: "연도별 현실화율 — 표본과 정부 발표 대조" });

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
      })), { width: MOB ? 420 : 1160, height: MOB ? 520 : 480, xRef: xm, yRef: ym,
        groups: { "겹침": "--s2", "관측": "--s1" },
        xName: "현실화율(%) — 행정의 시차", yName: "전세가율(%) — 세입자의 시차",
        xFmt: v => v.toFixed(0), yFmt: v => v.toFixed(0),
        aria: "전세가율과 현실화율의 사분면" });
      $("q-note").innerHTML = `기준선은 표본 중앙값(현실화율 ${xm.toFixed(1)}% · 전세가율 ` +
        `${ym.toFixed(1)}%). <b>왼쪽 위(적색)</b>가 이중 시차 — 전세가율은 중앙값 위,
        현실화율은 중앙값 아래인 시군구다. 시군구 수가 적어 탐색적 지도다 —
        개별 지역 판정은 원자료 확인이 먼저다.`;
    }

    /* Ⅴ 전달경로 — 인터랙티브 허브 */
    const LG = B.lag;
    if (LG && LG.grid) {
      const findLag = (x, y) => {
        const g = LG.grid.find(g2 => g2.x === x && g2.y === y);
        return g ? (g.lag_near != null ? g.lag_near : g.lag) : null;
      };
      const NODES = {
        "기준금리": [95, 95], "주담대금리": [305, 95], "거래량": [515, 95],
        "매매가": [725, 95], "전세가": [945, 95],
        "미분양": [515, 275], "착공": [725, 275], "준공": [945, 275],
      };
      const EDGES = [
        ["기준금리", "주담대금리"], ["주담대금리", "거래량"], ["거래량", "매매가"],
        ["매매가", "전세가"], ["매매가", "미분양"], ["미분양", "착공"],
        ["착공", "준공"], ["준공", "미분양"],
      ];
      const R0 = 34;
      let svg = `<svg viewBox="0 0 1120 370" role="img" aria-label="신호 전달경로" style="width:100%;height:auto;display:block">`;
      EDGES.forEach(([a, b], ei) => {
        const [x1, y1] = NODES[a], [x2, y2] = NODES[b];
        const lag = findLag(a, b);
        const loop = a === "준공" && b === "미분양";
        let d;
        if (loop) d = `M ${x2 - 6} ${y2 + R0 - 8} C 860 356, 620 356, ${NODES["미분양"][0] + 10} ${NODES["미분양"][1] + R0 - 4}`;
        else if (y1 === y2) d = `M ${x1 + R0} ${y1} L ${x2 - R0 - 8} ${y2}`;
        else d = `M ${x1 - 14} ${y1 + R0 - 6} L ${x2 + 26} ${y2 - R0 + 2}`;
        const dur = Math.max(1.4, (lag == null ? 2 : Math.max(lag, 0.5)) * 0.55);
        svg += `<path id="pe${ei}" d="${d}" fill="none" stroke="var(--rule)" stroke-width="1.6" marker-end="url(#pm)"/>`;
        svg += `<circle r="4.5" fill="var(--ink)"><animateMotion dur="${dur}s" repeatCount="indefinite" begin="${(ei * 0.4).toFixed(1)}s"><mpath href="#pe${ei}"/></animateMotion></circle>`;
        if (lag != null) {
          const mx = loop ? 720 : (x1 + x2) / 2, my = loop ? 352 : (y1 === y2 ? y1 - 16 : (y1 + y2) / 2 + 2);
          svg += `<g class="path-lag" data-x="${a}" data-y="${b}" style="cursor:pointer">
            <rect x="${mx - 30}" y="${my - 15}" width="60" height="22" rx="11" fill="var(--wash-blue)"/>
            <text x="${mx}" y="${my + 1}" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--eye-blue-deep)" font-family="var(--font-num)">+${lag}M</text>
            <title>${a} → ${b} — 실험실에서 열기</title></g>`;
        }
      });
      for (const [nm2, [x, y]] of Object.entries(NODES)) {
        const supply = ["미분양", "착공", "준공"].includes(nm2);
        svg += `<circle cx="${x}" cy="${y}" r="${R0 - 8}" fill="var(--surface)" stroke="${supply ? "var(--eye-red)" : "var(--eye-blue)"}" stroke-width="1.8"/>
          <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--ink)">${nm2}</text>`;
      }
      svg += `<defs><marker id="pm" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--rule)"/></marker></defs></svg>`;
      const pp = $("path-svg");
      if (pp) {
        pp.innerHTML = svg;
        pp.querySelectorAll(".path-lag").forEach(g2 => g2.addEventListener("click", () => {
          const sx2 = $("lab-x"), sy2 = $("lab-y");
          if (!sx2) return;
          sx2.value = g2.dataset.x; sy2.value = g2.dataset.y;
          sx2.dispatchEvent(new Event("change"));
          document.getElementById("ch6").scrollIntoView({ behavior: "smooth" });
        }));
      }
    }

    /* Ⅴ 연구 카드 */
    const L = B.lag;
    if (L && L.grid && L.grid.length) {
      const grade = g => g.n <= 24 ? ["짧은 표본", "var(--ink-3)"]
        : (g.stable && Math.abs(g.r) >= 0.4) ? ["A", "var(--eye-blue)"]
        : g.stable ? ["B", "var(--eye-blue)"] : ["C", "var(--ink-3)"];
      const rC = v => v < 0 ? "var(--eye-red)" : "var(--eye-blue)";
      const agreeShow = g => g.agree == null ? null
        : (g.r < 0 ? 100 - g.agree : g.agree);
      const spark = ws => {
        if (!ws || ws.length < 3) return '<span style="font-size:12px;color:var(--ink-3)">이동창 표본 부족</span>';
        const W2 = 190, H2 = 40, n2 = ws.length;
        const x2 = i => 6 + i * (W2 - 12) / (n2 - 1);
        const y2 = l => 4 + (1 - l / 24) * (H2 - 12);
        const pl = ws.map((w, i) => `${x2(i).toFixed(1)},${y2(w.lag).toFixed(1)}`).join(" ");
        return `<svg viewBox="0 0 ${W2} ${H2}" style="width:${W2}px;height:${H2}px;vertical-align:middle">
          <line x1="6" x2="${W2-6}" y1="${y2(0)}" y2="${y2(0)}" stroke="var(--hairline)" stroke-width="1"/>
          <polyline points="${pl}" fill="none" stroke="var(--eye-blue)" stroke-width="1.6"/>
          ${ws.map((w, i) => `<circle cx="${x2(i).toFixed(1)}" cy="${y2(w.lag).toFixed(1)}" r="2" fill="var(--eye-blue)"/>`).join("")}
        </svg>`;
      };
      const GROUPS = [
        ["금융 → 수요·가격", ["기준금리|주담대금리", "기준금리|거래량", "기준금리|매매가", "주담대금리|거래량", "주담대금리|매매가", "국고10년|매매가"]],
        ["수요 → 가격", ["거래량|매매가", "거래량|전세가", "매매가|전세가"]],
        ["가격·공급 → 재고", ["매매가|미분양", "미분양|착공", "인허가|착공", "착공|준공", "준공|미분양"]],
      ];
      const groupOf = g => { const k2 = g.x + "|" + g.y;
        const f = GROUPS.find(([, ks]) => ks.includes(k2)); return f ? f[0] : "기타"; };
      const ordered = [];
      GROUPS.forEach(([gn]) => { L.grid.filter(g => groupOf(g) === gn)
        .forEach((g, i) => ordered.push({ g, head: i === 0 ? gn : null })); });
      L.grid.filter(g => groupOf(g) === "기타").forEach((g, i) => ordered.push({ g, head: i === 0 ? "기타" : null }));
      $("lag-map").innerHTML = ordered.map(({ g, head }) => (head ?
        `<div style="grid-column:1/-1;font-size:13px;letter-spacing:.14em;color:var(--ink-2);font-weight:700;margin-top:10px">${head}</div>` : "") + (g2 => {
        const [gd, gc] = grade(g);
        const ag = agreeShow(g);
        const rg = (t, o) => o ? `${t} <b class="num">+${o.lag}M</b> <span class="num" style="color:${rC(o.r)}">${o.r > 0 ? "+" : ""}${o.r.toFixed(2)}</span>` : `${t} <span style="color:var(--ink-3)">표본 부족</span>`;
        return `<div class="plate" style="margin-bottom:0">
          <div style="display:flex;align-items:baseline;gap:10px">
            <div class="viz-title">${g.x} → ${g.y}</div>
            <span class="num" style="margin-left:auto;font-weight:800;color:${gc}">${gd}</span>
          </div>
          <div style="font-size:20px;margin:6px 0 2px" class="num"><b>+${g.lag}개월</b>
            <span style="color:${rC(g.r)}">r ${g.r > 0 ? "+" : ""}${g.r.toFixed(2)}</span>
            <span style="font-size:12.5px;color:var(--ink-3)"> n=${g.n}${g.lag_near != null ? ` · 6M내 피크 +${g.lag_near}M(${g.r_near})` : ""}</span></div>
          <div style="font-size:13px;color:var(--ink-2);margin-bottom:6px">
            ${ag != null ? `방향 일치 <b class="num">${ag}%</b>${g.r < 0 ? " (역방향 기준)" : ""}` : "방향 일치 표본 부족"}
            &nbsp;·&nbsp; ${rg("인상기", g.regime_up)} &nbsp;·&nbsp; ${rg("인하기", g.regime_down)}</div>
          <div style="display:flex;align-items:center;gap:8px">${spark(g.windows)}
            <span style="font-size:11.5px;color:var(--ink-3)">이동창(60M)별 최적 시차 — 0~24M</span></div>
        </div>`;
      })(g)).join("");
    }

    /* 홈 현재 신호 */
    if (B.signals && B.signals.length) {
      $("home-signals").innerHTML = B.signals.map(sg => {
        const dirTxt = sg.dir === "-" ? "하락 전환" : "상승 전환";
        const el2 = sg.elapsed != null ? `${sg.elapsed}개월 경과` : "전환 미탐지";
        const ag = sg.agree != null ? Math.max(sg.agree, 100 - sg.agree) : null;
        return `<div class="kpi"><div class="v" style="font-size:17px">${sg.x} ${dirTxt}</div>
          <div class="l">→ <b>${sg.y}</b> 반응 관측 구간 <b class="num">+${sg.lag}개월</b> · 현재
          <b class="num">${el2}</b>${ag != null ? ` · 과거 방향 일치 ${ag}%` : ""} · 기준 ${sg.latest.slice(0,4)}.${sg.latest.slice(4)}</div></div>`;
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
          <path d="${d}" fill="none" stroke="var(--eye-blue)" stroke-width="1.8"/>
          ${zp.filter(p => p.z != null).map(p => `<circle cx="${x2(p.k)}" cy="${y2(p.z)}" r="4.5" fill="transparent" style="cursor:crosshair"><title>T${p.k >= 0 ? "+" : ""}${p.k}M · z=${p.z > 0 ? "+" : ""}${p.z}</title></circle>`).join("")}
          ${peakK != null ? `<circle cx="${x2(peakK)}" cy="${y2(zp.find(p=>p.k===peakK).z)}" r="3.2" fill="var(--eye-red)" pointer-events="none"/>` : ""}
        </svg>`;
      };
      $("event-cards").innerHTML = B.events.map(ev => `
        <div class="plate">
          <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
            <div class="viz-title">${ev.name}</div>
            <span class="eye-tag ${ev.type === "통화" ? "blue" : ev.type === "규제" ? "red" : "black"}">${ev.type}</span>
            <span style="margin-left:auto;font-size:12.5px;color:var(--ink-2)" class="num">발표 ${ev.announce} · 시행 ${ev.effective}</span>
          </div>
          <div class="viz-q" style="margin-bottom:10px">${ev.note}</div>
          ${ev.rows.length ? `<table class="sheet"><thead><tr><th>지표</th><th>T−12 ~ T+12 이탈 경로(z)</th>
            <th class="num">첫 반응</th><th class="num">최대 반응</th></tr></thead><tbody>` +
            ev.rows.map(r => `<tr><td><b>${r.ind}</b></td>
              <td>${zSpark(r.z, r.first, r.peak_k)}</td>
              <td class="num">${r.first != null ? "+" + r.first + "M" : "없음"}</td>
              <td class="num">+${r.peak_k}M <span style="color:${r.peak_z < 0 ? "var(--eye-red)" : "var(--eye-blue)"}">z=${r.peak_z > 0 ? "+" : ""}${r.peak_z}</span></td></tr>`).join("") +
            "</tbody></table>" : '<p class="note">이 사건 시점을 덮는 관측 지표가 없다(표본 기간 밖).</p>'}
          <p class="note">동시 사건: ${ev.concurrent}. 점선 = 사건월(T=0), 가는 선 = ±1z.
          거래량·매매가는 2023-08 이후 표본이라 그 이전 사건에는 나타나지 않는다.</p>
        </div>`).join("");
    }

    /* Ⅶ 지역확산 */
    const SP = B.spread;
    if (SP) {
      const wrap = $("spread-wrap");
      wrap.innerHTML = "";
      for (const [vn, rows] of Object.entries(SP)) {
        if (!rows.length) continue;
        const bars = rows.filter(r2 => r2.verdict !== "독립");
        const indep = rows.filter(r2 => r2.verdict === "독립").map(r2 => r2.region);
        const div = document.createElement("div");
        div.className = "plate";
        div.innerHTML = `<div class="viz-title">${vn} — 서울 대비 시차</div>
          <div class="viz-q">양(청)=서울이 먼저 · 음(적)=그 지역이 먼저</div>
          <div class="viz-unit">개월 · 양방향 최적 시차</div><div id="sp-${vn}"></div>
          <p class="note">판정: ${rows.filter(r2=>r2.verdict==="서울 선행").length}곳 서울 선행 ·
          ${rows.filter(r2=>r2.verdict==="지역 선행").length}곳 지역 선행 ·
          ${rows.filter(r2=>r2.verdict==="동행").length}곳 동행${indep.length ? " · 독립(|r|<0.3): " + indep.join("·") : ""}.
          |r| 최대 기준이며 예측적 선후관계다 — 전달 경로의 증명이 아니다.</p>`;
        wrap.appendChild(div);
        divergeBars($("sp-" + vn), bars.map(r2 => ({ name: r2.region, value: r2.k })),
          { posColor: "--s1", negColor: "--s2", zeroLabel: "동시",
            fmt: v => (v > 0 ? "+" : "") + v + "M", aria: vn + " 지역확산 시차" });
      }
    }

    /* Ⅷ 방법론 수치 */
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
    const sx = $("lab-x"), sy = $("lab-y"), sk = $("lab-k"), sr = $("lab-regime");
    if (!labInit) {
      labInit = true;
      sx.innerHTML = names.map(n => `<option>${n}</option>`).join("");
      sy.innerHTML = names.map(n => `<option>${n}</option>`).join("");
      sx.value = names.includes("기준금리") ? "기준금리" : names[0];
      sy.value = names.includes("거래량") ? "거래량" : names[1] || names[0];
      [sx, sy].forEach(el => el.addEventListener("change", () => { presetK(); drawLab(); }));
      sk.addEventListener("input", drawLab);
      sr.addEventListener("change", drawLab);
      const play = $("lab-play");
      let sweep = null;
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
        { name: nx + " — " + unit(nx) + "·z", color: "--s1",
          points: labels.map((t, i) => ({ label: mk(t), y: zx(xv[i]) })) },
        { name: ny + (k ? ` (+${k}개월 앞당김)` : "") + " — " + unit(ny) + "·z", color: "--s2",
          points: labels.map((t, i) => ({ label: mk(t), y: zy(yv[i]) })) },
      ], { width: MOB ? 560 : 1160, height: MOB ? 340 : 320, interactive: false, aria: "두 변수의 파형 정렬(표준화)" });
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
      Charts.scatter($("lab-curve"), pts, { width: MOB ? 420 : 560, height: MOB ? 340 : 300, yRef: 0,
        groups: { "현재": "--s2", "곡선": "--ink-3" },
        xName: "시차(개월)", yName: "r",
        xFmt: v => "+" + Math.round(v), yFmt: v => v.toFixed(1),
        aria: "시차별 상관 곡선" });
    }
  }

  render();
})();
