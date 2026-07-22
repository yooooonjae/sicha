/* 시차(視差) 앱 — bundle을 읽어 다섯 장을 계측한다. */
(function () {
  "use strict";
  const B = window.__BUNDLE__ || {};
  const $ = id => document.getElementById(id);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const NAMES = (B.meta && B.meta.sgg_names) || {};
  const nm = sgg => NAMES[sgg] || sgg;

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
          <td class="num">${c.market_eok.toFixed(1)}<span class="u">억</span></td>
          <td class="num" style="color:var(--eye-red)">${c.gongsi_eok.toFixed(1)}<span class="u">억</span></td>
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
        .map(([sgg, s]) => ({ name: nm(sgg), value: atRef(s) }))
        .filter(d => d.value != null)
        .sort((a, b) => b.value - a.value);
      Charts.hbars($("j-rank"), latest, { width: 560, labelW: 118, rowH: 36,
        color: "--s1", fmt: v => v.toFixed(1) + "%", aria: refQ + " 기준 시군구 전세가율" });
      const jru = $("j-rank-unit"); if (jru) jru.textContent = `% · ${refQ} 기준 · ${latest.length}개 시군구`;

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

    /* Ⅴ 전달경로 — 데스크톱: 네트워크+우측 상세 · 모바일: 세로 타임라인 */
    const LG = B.lag;
    if (LG && LG.grid) {
      const findLag = (x, y) => {
        const g = LG.grid.find(g2 => g2.x === x && g2.y === y);
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
      const rCol = v => v < 0 ? "var(--eye-red)" : "var(--eye-blue)";
      // 관계 상세(우측 패널·모바일 인라인 공유) — grid 항목을 판독표로
      const detailHTML = (x, y) => {
        const g = LG.grid.find(g2 => g2.x === x && g2.y === y);
        if (!g) return `<p class="pd-empty">${x} → ${y} — 시차 표에 없는 관계다.</p>`;
        const agr = g.agree == null ? null : (g.r < 0 ? 100 - g.agree : g.agree);
        const rg = o => o ? `+${o.lag}M · r ${o.r > 0 ? "+" : ""}${o.r.toFixed(2)}` : "표본 부족";
        const row = (t, v) => `<div><dt>${t}</dt><dd class="num">${v}</dd></div>`;
        return `<div class="pd-head">${x} <span style="color:var(--ink-3)">→</span> ${y}</div>
          <div class="pd-big num">+${g.lag}<span class="pd-unit">개월</span><span style="color:${rCol(g.r)}">r ${g.r > 0 ? "+" : ""}${g.r.toFixed(2)}</span></div>
          <dl class="pd-list">
            ${row("표본", "n=" + g.n)}
            ${row("방향 일치", agr != null ? agr + "%" + (g.r < 0 ? " <span style='color:var(--ink-3)'>(역)</span>" : "") : "—")}
            ${row("인상기", rg(g.regime_up))}
            ${row("인하기", rg(g.regime_down))}
            ${g.lag_near != null ? row("6M내 피크", "+" + g.lag_near + "M (" + g.r_near + ")") : ""}
            ${g.at_bound ? `<div><dt>주의</dt><dd style="color:var(--eye-red)">상한(${g.max_lag}M)에서 최대 — 미확정</dd></div>` : ""}
          </dl>
          <button class="btn-sm pd-open" data-x="${x}" data-y="${y}">실험실에서 열기 →</button>`;
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
        pp.innerHTML = `<div class="pt-tabs">${CHAINS.map((c, i) =>
          `<button class="pt-tab${i === 0 ? " on" : ""}" data-c="${i}">${c.name}</button>`).join("")}</div><div class="pt-flow" id="pt-flow"></div>`;
        const drawFlow = () => {
          const ch = CHAINS[ci];
          let h = "";
          ch.nodes.forEach((nd, i) => {
            h += `<div class="pt-node${SUPPLY_NODE.has(nd) ? " supply" : ""}" data-node="${i}"><span class="pt-dot"></span>${nd}</div>`;
            if (i < ch.nodes.length - 1) {
              const a = nd, b = ch.nodes[i + 1], lag = findLag(a, b);
              const supE = SUPPLY_EDGE.has(a + "|" + b);
              const txt = lag == null ? "—" : lag === 0 ? "0M 동행" : "+" + lag + "M";
              h += `<div class="pt-edge${supE ? " supply" : ""}" data-edge="${i}">
                <span class="pt-arrow">↓</span>
                <button class="pt-lag${lag === 0 ? " zero" : ""}" data-x="${a}" data-y="${b}">${txt}</button>
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
          pp.querySelectorAll(".pt-tab").forEach(b2 => b2.classList.remove("on"));
          bt.classList.add("on"); ci = +bt.dataset.c; drawFlow();
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
          const supply = SUPPLY_EDGE.has(a + "|" + b);
          let d;
          if (y1 === y2) d = `M ${x1 + R0} ${y1} L ${x2 - R0 - 8} ${y2}`;
          else d = `M ${x1 - 14} ${y1 + R0 - 6} L ${x2 + 26} ${y2 - R0 + 2}`;
          svg += `<path id="pe${ei}" d="${d}" fill="none" stroke="var(--rule)" stroke-width="1.6"${supply ? ' stroke-dasharray="6 5"' : ""} marker-end="url(#pm)"/>`;
          if (lag) {  // 동행(0M)은 펄스를 그리지 않는다 — 순서를 판정할 수 없으므로
            const dur = Math.max(1.4, lag * 0.55);
            svg += `<circle r="4.5" fill="var(--ink)" opacity="0"><animateMotion class="path-anim" dur="${dur}s" repeatCount="indefinite" begin="indefinite"><mpath href="#pe${ei}"/></animateMotion><set attributeName="opacity" to="1" begin="pp-play.click"/></circle>`;
          }
          if (lag != null) {
            const mx = (x1 + x2) / 2, my = y1 === y2 ? y1 - 16 : (y1 + y2) / 2 + 2;
            const txt = lag === 0 ? "0M 동행" : "+" + lag + "M";
            const w3 = lag === 0 ? 80 : 62;
            svg += `<g class="path-lag" data-x="${a}" data-y="${b}" style="cursor:pointer">
              <rect x="${mx - w3 / 2}" y="${my - 15}" width="${w3}" height="23" rx="11.5" fill="var(--wash-blue)"/>
              <text x="${mx}" y="${my + 1}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--eye-blue-deep)" font-family="${lag === 0 ? "var(--font-body)" : "var(--font-num)"}">${txt}</text>
              <title>${a} → ${b}${lag === 0 ? " — 월간 자료에서는 선후를 구분할 수 없다" : ""} — 우측에 상세</title></g>`;
          }
        });
        for (const [nm2, [x, y]] of Object.entries(NODES)) {
          const supply = SUPPLY_NODE.has(nm2);
          svg += `<circle cx="${x}" cy="${y}" r="${R0 - 6}" fill="var(--surface)" stroke="${supply ? "var(--eye-red)" : "var(--eye-blue)"}" stroke-width="2"/>
            <text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--ink)">${nm2}</text>`;
        }
        svg += `<defs><marker id="pm" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--rule)"/></marker></defs></svg>`;
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
        const XORD = ["기준금리", "국고10년", "주담대금리", "거래량", "매매가", "미분양", "인허가", "착공", "준공"];
        const YORD = ["주담대금리", "거래량", "매매가", "전세가", "미분양", "착공", "준공", "준공후미분양"];
        const rowsH = XORD.filter(x => L.grid.some(g => g.x === x));
        const colsH = YORD.filter(y => L.grid.some(g => g.y === y));
        const gAt = (x, y) => L.grid.find(g => g.x === x && g.y === y);
        const lagAt = (x, y) => { const g = gAt(x, y); return g ? (g.lag_near != null ? g.lag_near : g.lag) : null; };
        const cellsH = rowsH.map(x => colsH.map(y => { const g = gAt(x, y); return g ? Math.abs(g.r) : NaN; }));
        Charts.heatmap($("lag-heat"), { xs: colsH, ys: rowsH, cells: cellsH }, {
          width: MOB ? 660 : 1120, cellH: MOB ? 32 : 38, labelW: 84,
          cellText: true, xName: "반응", yName: "선행", vLabel: "|r|",
          cellFmt: (v, r, c) => { const lg = lagAt(rowsH[r], colsH[c]); return lg == null ? "" : lg === 0 ? "0M" : "+" + lg + "M"; },
          tipFmt: (v, r, c) => { const g = gAt(rowsH[r], colsH[c]); return g ? `+${lagAt(rowsH[r], colsH[c])}M · r ${g.r > 0 ? "+" : ""}${g.r.toFixed(2)} · n=${g.n}` : "관측 쌍 아님"; },
          legend: "행(선행) → 열(반응) · 셀 = 최적 시차 · 농도 = |r| · 빈칸 = 관측 쌍 아님",
          aria: "선행×반응 시차 전수표", onCell: (colV, rowV) => loadLab(rowV, colV, true),
        });
      }
      const grade = g => g.n < 25 ? ["짧은 표본", "var(--ink-3)"]
        : g.n < 60 ? (g.stable ? ["B−(중간)", "var(--ink-2)"] : ["C(중간)", "var(--ink-3)"])
        : (g.stable && Math.abs(g.r) >= 0.4) ? ["A", "var(--eye-blue)"]
        : g.stable ? ["B", "var(--eye-blue)"] : ["C", "var(--ink-3)"];
      const rC = v => v < 0 ? "var(--eye-red)" : "var(--eye-blue)";
      const agreeShow = g => g.agree == null ? null
        : (g.r < 0 ? 100 - g.agree : g.agree);
      const spark = (ws, maxLag) => {
        if (!ws || ws.length < 3) return '<span style="font-size:12px;color:var(--ink-3)">이동창 표본 부족</span>';
        const ML = maxLag || 24;
        const W2 = 190, H2 = 40, n2 = ws.length;
        const x2 = i => 6 + i * (W2 - 12) / (n2 - 1);
        const y2 = l => 4 + (1 - l / ML) * (H2 - 12);
        const pl = ws.map((w, i) => `${x2(i).toFixed(1)},${y2(w.lag).toFixed(1)}`).join(" ");
        return `<svg viewBox="0 0 ${W2} ${H2}" style="width:${W2}px;height:${H2}px;vertical-align:middle">
          <line x1="6" x2="${W2-6}" y1="${y2(0)}" y2="${y2(0)}" stroke="var(--hairline)" stroke-width="1"/>
          <polyline points="${pl}" fill="none" stroke="var(--eye-blue)" stroke-width="1.6"/>
          ${ws.map((w, i) => `<circle cx="${x2(i).toFixed(1)}" cy="${y2(w.lag).toFixed(1)}" r="2" fill="var(--eye-blue)"/>`).join("")}
        </svg>`;
      };
      const GROUPS = [
        ["금융 → 신용", ["기준금리|주담대금리"]],
        ["금융·신용 → 수요·가격", ["기준금리|거래량", "기준금리|매매가", "주담대금리|거래량", "주담대금리|매매가", "국고10년|매매가"]],
        ["수요 → 가격", ["거래량|매매가", "거래량|전세가", "매매가|전세가"]],
        ["가격·재고 → 공급", ["매매가|미분양", "미분양|착공", "인허가|착공", "착공|준공", "준공|준공후미분양"]],
      ];
      const GRP_TONE = ["--seq-600", "--seq-500", "--seq-400", "--seq-300"]; // A~D 청색 계열 농도 (좌측 3px 그룹선)
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
        const [gd, gc] = grade(g);
        const ag = agreeShow(g);
        const rg = (t, o) => o ? `${t} <b class="num">+${o.lag}M</b> <span class="num" style="color:${rC(o.r)}">${o.r > 0 ? "+" : ""}${o.r.toFixed(2)}</span>` : `${t} <span style="color:var(--ink-3)">표본 부족</span>`;
        return `<div class="plate${rest ? " lag-rest" : ""}" data-grp2="${groupOf(g)}" ${rest ? "hidden" : ""} style="margin-bottom:0;border-left:3px solid ${css(gi >= 0 && gi < GRP_TONE.length ? GRP_TONE[gi] : "--rule")}">
          <div style="display:flex;align-items:baseline;gap:10px">
            <div class="viz-title">${g.x} → ${g.y}</div>
            <span class="num" style="margin-left:auto;font-weight:800;color:${gc}">${gd}</span>
          </div>
          <div style="font-size:20px;margin:6px 0 2px"><b class="num">+${g.lag}</b>개월
            <span class="num" style="color:${rC(g.r)}">r ${g.r > 0 ? "+" : ""}${g.r.toFixed(2)}</span>
            <span style="font-size:12.5px;color:var(--ink-3)"> n=<span class="num">${g.n}</span>${g.lag_near != null ? ` · 6M내 피크 <span class="num">+${g.lag_near}M(${g.r_near})</span>` : ""}${g.at_bound ? ` · <b style="color:var(--eye-red)">탐색 상한(<span class="num">${g.max_lag}M</span>)에서 최대 — 미확정</b>` : ""}</span></div>
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
          <path d="${d}" fill="none" stroke="var(--eye-blue)" stroke-width="1.8"/>
          ${(() => { const z0 = zp.find(p => p.k === 0 && p.z != null); return z0 ? `<circle cx="${x2(0)}" cy="${y2(z0.z)}" r="3" fill="var(--ink)" stroke="var(--surface)" stroke-width="1" pointer-events="none"/>` : ""; })()}
          ${zp.filter(p => p.z != null).map(p => `<circle class="ev-hit" cx="${x2(p.k)}" cy="${y2(p.z)}" r="4.5" fill="transparent" style="cursor:crosshair"><title>T${p.k >= 0 ? "+" : ""}${p.k}M · z=${p.z > 0 ? "+" : ""}${p.z}</title></circle>`).join("")}
          ${peakK != null ? `<circle cx="${x2(peakK)}" cy="${y2(zp.find(p=>p.k===peakK).z)}" r="3.6" fill="var(--eye-red)" stroke="var(--surface)" stroke-width="1" pointer-events="none"/>` : ""}
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
          ${ev.rows.length ? `<table class="sheet"><thead><tr><th>지표</th><th>T−12 ~ T+12 이탈 경로(z)</th>
            <th class="num">첫 반응</th><th class="num">최대 반응</th></tr></thead><tbody>` +
            ev.rows.map(r => `<tr><td><b>${r.ind}</b></td>
              <td>${zSpark(r.z, r.first, r.peak_k)}</td>
              <td class="num">${r.first != null ? "+" + r.first + "M" : "없음"}</td>
              <td class="num">+${r.peak_k}M <span style="color:${r.peak_z < 0 ? "var(--eye-red)" : "var(--eye-blue)"}">z=${r.peak_z > 0 ? "+" : ""}${r.peak_z}</span></td></tr>`).join("") +
            "</tbody></table>" : '<p class="note">이 사건 시점을 덮는 관측 지표가 없다(표본 기간 밖).</p>'}
          <p class="note"><span class="ev-read num" style="color:var(--eye-blue-deep)"></span>동시 사건: ${ev.concurrent}. 점선 = 사건월(T=0), 가는 선 = ±1z.
          거래량·매매가는 2023-08 이후 표본이라 그 이전 사건에는 나타나지 않는다.</p>
        </div>`;
      const tabs = B.events.map((ev, i) =>
        `<button class="btn-sm ev-tab${i === 0 ? " on" : ""}" data-i="${i}">${ev.name.split(" ")[0].slice(0, 10)}</button>`).join("");
      $("event-cards").innerHTML = `<div class="tab-row">${tabs}</div><div id="ev-panel">${evCard(B.events[0])}</div>`;
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
        $("event-cards").querySelectorAll(".ev-tab").forEach(b2 => b2.classList.remove("on"));
        btn.classList.add("on");
        $("ev-panel").innerHTML = evCard(B.events[+btn.dataset.i]);
        bindEvDots();
      }));
    }

    /* Ⅶ 지역확산 — 확산 지도(대표) + 발산 바 */
    const SP = B.spread, KOREA = window.__KOREA__ || [];
    if (SP) {
      const wrap = $("spread-wrap");
      const vars = Object.entries(SP).filter(([, rows]) => rows.length);
      if (!vars.length) { wrap.innerHTML = ""; }
      else {
        wrap.innerHTML = `<div class="plate">
          <div class="tab-row">${vars.map(([vn], i) =>
            `<button class="btn-sm sp-tab${i === 0 ? " on" : ""}" data-vn="${vn}">${vn}</button>`).join("")}</div>
          <div class="viz-title" id="sp-title"></div>
          <div class="viz-q">서울과 각 시도의 양방향 최적 시차 —
            <b style="color:var(--eye-blue)">■ 청</b> 서울이 먼저 ·
            <b style="color:var(--eye-red)">■ 적</b> 그 지역이 먼저 ·
            <b style="color:var(--ink-3)">■ 회</b> 동행 · <b style="color:var(--ink-3)">□ 옅음</b> 독립·자료없음</div>
          <div id="sp-read" class="sp-read"></div>
          <div class="spread-split">
            <div id="sp-map"></div>
            <div><div class="viz-unit" style="margin:0 0 4px">개월 · 양방향 최적 시차(발산 바)</div><div id="sp-panel"></div></div>
          </div>
          <p class="note" id="sp-note"></p></div>`;
        const seqBlue = ["--seq-300", "--seq-400", "--seq-500", "--seq-600", "--seq-700"];
        const fillFor = rec => {
          if (!rec || rec.verdict === "독립") return { f: css("--surface-2"), s: css("--hairline-2"), w: 1 };
          if (rec.verdict === "동행") return { f: css("--seq-200"), s: css("--hairline"), w: 1 };
          if (rec.verdict === "서울 선행") return { f: css(seqBlue[Math.min(4, Math.floor(Math.abs(rec.k) / 3))]), s: css("--hairline"), w: 1 };
          const pct = 30 + Math.min(58, Math.abs(rec.k) * 6); // 지역 선행 — 적색 농도
          return { f: `color-mix(in srgb, ${css("--eye-red")} ${pct}%, ${css("--surface")})`, s: css("--hairline"), w: 1 };
        };
        const strokeOf = (name, byRegion) => name === "서울" ? css("--ink")
          : (byRegion[name] && byRegion[name].verdict === "독립") || !byRegion[name] ? css("--hairline-2") : css("--hairline");
        const drawSp = vn => {
          const rows = SP[vn], byRegion = {};
          rows.forEach(r => byRegion[r.region] = r);
          const bars = rows.filter(r2 => r2.verdict !== "독립");
          const indep = rows.filter(r2 => r2.verdict === "독립").map(r2 => r2.region);
          $("sp-title").textContent = `${vn} — 서울 대비 지역 시차 지도`;
          $("sp-note").innerHTML = `판정: <span class="num">${rows.filter(r2 => r2.verdict === "서울 선행").length}</span>곳 서울 선행 · ` +
            `<span class="num">${rows.filter(r2 => r2.verdict === "지역 선행").length}</span>곳 지역 선행 · ` +
            `<span class="num">${rows.filter(r2 => r2.verdict === "동행").length}</span>곳 동행${indep.length ? " · 독립(|r|<0.3): " + indep.join("·") : ""}. ` +
            `|r| 최대 기준이며 <b>예측적 선후관계다 — 전달 경로의 증명이 아니다.</b>`;
          // 지도
          let msvg = `<svg viewBox="0 0 520 690" role="img" aria-label="${vn} 지역확산 지도" style="width:100%;height:auto;display:block">`;
          KOREA.forEach(sd => {
            const isSeoul = sd.name === "서울";
            const st = isSeoul ? { f: css("--wash-blue"), s: css("--ink"), w: 2.2 } : fillFor(byRegion[sd.name]);
            msvg += `<path class="kmap-region" data-region="${sd.name}" d="${sd.d}" fill="${st.f}" stroke="${st.s}" stroke-width="${st.w}"/>`;
          });
          msvg += `</svg>`;
          $("sp-map").innerHTML = msvg;
          // 판독
          const rr = rec => `r=<span class="num">${rec.r > 0 ? "+" : ""}${rec.r.toFixed(2)}</span> · n=<span class="num">${rec.n}</span>`;
          const readout = name => {
            const rec = byRegion[name];
            if (name === "서울") return `<b>서울</b> — 기준 지역(비교 대상)`;
            if (!rec) return `<b>${name}</b> — 이 변수 표본 없음`;
            if (rec.verdict === "독립") return `<b>${name}</b> — 독립(|r|&lt;0.3) · ${rr(rec)}`;
            if (rec.verdict === "동행") return `<b>${name}</b> — 서울과 동행(±1개월) · ${rr(rec)}`;
            if (rec.verdict === "서울 선행") return `<b>${name}</b> — 서울이 <span class="num">+${rec.k}</span>개월 선행 · ${rr(rec)}`;
            return `<b>${name}</b> — ${name}가 <span class="num">+${Math.abs(rec.k)}</span>개월 선행 · ${rr(rec)}`;
          };
          const readEl = $("sp-read");
          readEl.innerHTML = `<span style="color:var(--ink-3)">지역에 마우스를 올리거나 탭하면 상세가 뜬다 · 서울(굵은 테두리)이 기준</span>`;
          const paths = [...$("sp-map").querySelectorAll(".kmap-region")];
          const show = p => {
            paths.forEach(o => { o.setAttribute("stroke", strokeOf(o.dataset.region, byRegion)); o.setAttribute("stroke-width", o.dataset.region === "서울" ? 2.2 : 1); });
            p.setAttribute("stroke", css("--ink")); p.setAttribute("stroke-width", 2.6);
            p.parentNode.appendChild(p); // 선택 외곽선을 위로
            readEl.innerHTML = readout(p.dataset.region);
          };
          paths.forEach(p => {
            p.style.cursor = "pointer";
            p.addEventListener("pointerenter", () => show(p));
            p.addEventListener("click", () => show(p));
          });
          // 발산 바(우)
          divergeBars($("sp-panel"), bars.map(r2 => ({ name: r2.region, value: r2.k })),
            { width: MOB ? 560 : 720, posColor: "--s1", negColor: "--s2", zeroLabel: "동시",
              fmt: v => (v > 0 ? "+" : "") + v + "M", aria: vn + " 지역확산 시차" });
        };
        drawSp(vars[0][0]);
        wrap.querySelectorAll(".sp-tab").forEach(btn => btn.addEventListener("click", () => {
          wrap.querySelectorAll(".sp-tab").forEach(b2 => b2.classList.remove("on"));
          btn.classList.add("on"); drawSp(btn.dataset.vn);
        }));
      }
    }

    /* Ⅷ 방법론 수치 */
    const src = [];
    src.push(`<tr><td>국토부 RTMS 매매</td><td>아파트 매매 실거래(수지 공유 원천)</td>
      <td>${M.sgg_names ? Object.keys(M.sgg_names).length : "—"}개 시군구 · 36개월</td>
      <td class="num">${(M.n_sale || 0).toLocaleString()}<span class="u">건</span></td></tr>`);
    src.push(`<tr><td>국토부 RTMS 전월세</td><td>아파트 전월세 실거래 — 동일 시군구·월 범위</td>
      <td>동일</td><td class="num">${(M.n_rent || 0).toLocaleString()}<span class="u">행</span></td></tr>`);
    if (R) src.push(`<tr><td>VWorld NED 공시</td><td>공동주택 공시가격 — 지오코더→지적→공시 3단 체인</td>
      <td>2021~2025 · 표본단지</td><td class="num">${R.by_complex.length}<span class="u">관측</span></td></tr>`);
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
        { name: nx + "·z", color: "--s1",
          points: labels.map((t, i) => ({ label: mk(t), y: zx(xv[i]) })) },
        { name: ny + (k ? ` +${k}M` : "") + "·z", color: "--s2",
          points: labels.map((t, i) => ({ label: mk(t), y: zy(yv[i]) })) },
      ], { width: MOB ? 560 : 1160, height: MOB ? 340 : 320, rightPad: MOB ? 96 : 116, interactive: false, aria: "두 변수의 파형 정렬(표준화)" });
      const cur = corrAt(xm, ym_, k);
      $("lab-read").innerHTML = cur.r == null
        ? `시차 <span class="num">+${k}</span>개월 · 겹침 <span class="num">${cur.n}</span>개월 — 표본 부족`
        : `시차 <b class="num">+${k}</b>개월 · r = <b class="num" style="color:${cur.r < 0 ? "var(--eye-red)" : "var(--eye-blue)"}">${cur.r > 0 ? "+" : ""}${cur.r.toFixed(2)}</b> · 겹침 <span class="num">${cur.n}</span>개월`;
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
