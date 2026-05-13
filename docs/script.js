// Lightning vs. Fire — DSC106 Project 3 (narrative stage flow)
// Pure D3 v7 + topojson-client.

const TOTAL_STAGES = 5;
let currentStage = 1;

// Shared data (set in main)
let fires, lights, joined, usTopo, weeks;
let stateTotals, fireBreaks, lightBreaks;
let firePerWeekState, lightPerWeekState, priorPerWeekState, fireCountPerWeekState;
let stateFC;

const BIVARIATE = [
  ["#e8e8e8", "#b3d4e4", "#5ac8c8"], // fire low
  ["#e4acac", "#a5add3", "#5698b9"], // fire mid
  ["#c85a5a", "#985dc8", "#574caf"], // fire high
];

const STAGES = {
  1: {
    title: "Where America burned in 2024, week by week",
    caption: "Each circle is a 0.5° cell where GOES-16 detected fire that week. Size = total radiative power, color = peak intensity. Drag the slider to scrub through the season.",
    showPanel: false,
    render: renderStage1,
    controls: stage1Controls,
    nextHint: "See the entire season at once →",
  },
  2: {
    title: "The full 2024 fire season, all weeks at once",
    caption: "Same dots, but accumulated across every week of June–October. The geography of the season emerges: the Western mountains, the Mississippi Valley, the Mexican border.",
    showPanel: false,
    render: renderStage2,
    controls: () => "",
    nextHint: "Aggregate to state level →",
  },
  3: {
    title: "Fires aggregated by state",
    caption: "Same data, summarized: each state colored by total fire radiative power for the season. The pattern hardens — fires concentrate in the Mountain West and a corridor through Texas and the Plains.",
    showPanel: true,
    panelDelay: 750,         // wait for map fade-in to complete, then bring panel in
    render: renderStage3,
    controls: () => "",
    nextHint: "Add lightning to the picture →",
  },
  4: {
    title: "Now overlay the lightning",
    caption: "Each state is now colored on two axes — fire activity (vertical) and lightning activity (horizontal). The myth-buster reveals itself: the bright-red Western states aren't where the lightning is. Florida and the Gulf get the most lightning but barely burn. Click any state for a weekly breakdown.",
    showPanel: true,
    panelDelay: 0,           // panel already visible from stage 3
    render: renderStage4,
    controls: () => "",
    nextHint: "See the headline verdict →",
  },
  5: {
    title: "The verdict",
    caption: "One dot per fire-cell-week. X = lightning flashes in the same cell within the prior 24 hours. Y = fire radiative power. If lightning caused fires, the dots would line up on a diagonal. They don't. Brush the X-axis to filter; toggle regions to compare.",
    showPanel: false,
    render: renderStage5,
    controls: stage5Controls,
    nextHint: "",
  },
};

// ============================================================
// MAIN
// ============================================================
(async function main() {
  [usTopo, fires, lights, joined] = await Promise.all([
    d3.json("us-states.topo.json"),
    d3.csv("data/fires_weekly_2024.csv", d => ({
      week: d.week,
      lat: +d.lat_bin,
      lon: +d.lon_bin,
      fires: +d.fire_count,
      power: +d.fire_power_MW,
      maxPower: +d.max_power_MW,
      priorLightning: +d.prior_lightning_count,
      hadLightning: +d.had_prior_lightning,
    })),
    d3.csv("data/lightning_weekly_2024.csv", d => ({
      week: d.week,
      lat: +d.lat_bin,
      lon: +d.lon_bin,
      flashes: +d.flash_count,
    })),
    d3.csv("data/joined_weekly_2024.csv", d => ({
      week: d.week,
      lat: +d.lat_bin,
      lon: +d.lon_bin,
      fires: +d.fire_count,
      power: +d.fire_power_MW,
      maxPower: +d.max_power_MW,
      priorLightning: +d.flash_count,
      hadLightning: +d.had_prior_lightning,
      region: d.region,
    })),
  ]);

  weeks = Array.from(new Set(fires.map(d => d.week))).sort();
  stateFC = topojson.feature(usTopo, usTopo.objects.states);
  precomputeStateData();

  buildStageDots();

  // Scroll-triggered stage changes via IntersectionObserver
  const steps = document.querySelectorAll(".step");
  const observer = new IntersectionObserver((entries) => {
    // Prefer the step closest to top with highest intersection ratio
    let best = null, bestScore = -1;
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio > bestScore) {
        best = e.target;
        bestScore = e.intersectionRatio;
      }
    }
    if (best) {
      const n = +best.dataset.stage;
      // Mark active step
      steps.forEach(s => s.classList.toggle("active", s === best));
      if (n !== currentStage) goToStage(n);
    }
  }, {
    threshold: [0.25, 0.5, 0.75],
    rootMargin: "-30% 0px -30% 0px", // step must be near vertical center
  });
  steps.forEach(s => observer.observe(s));

  // Stage-dot clicks scroll to the corresponding step
  d3.selectAll(".stage-dots .dot").on("click", function() {
    const n = +this.dataset.stage;
    const step = document.querySelector(`.step[data-stage="${n}"]`);
    if (step) step.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // Initial paint of stage 1
  goToStage(1);
})();

function buildStageDots() {
  const wrap = d3.select("#stage-dots");
  wrap.selectAll("*").remove();
  for (let i = 1; i <= TOTAL_STAGES; i++) {
    wrap.append("div").attr("class", "dot")
      .attr("data-stage", i)
      .on("click", () => goToStage(i));
  }
}

let panelRevealTimer = null;

function goToStage(n) {
  if (n < 1 || n > TOTAL_STAGES) return;
  currentStage = n;
  const cfg = STAGES[n];

  d3.selectAll(".stage-dots .dot").classed("active", function() {
    return +this.dataset.stage === n;
  });

  const vizArea = document.querySelector(".viz-area");
  const panel = document.getElementById("state-panel");

  // Cancel any pending panel reveal from previous stage
  if (panelRevealTimer) { clearTimeout(panelRevealTimer); panelRevealTimer = null; }

  if (cfg.showPanel) {
    // Reset content
    panel.innerHTML = `<div class="state-panel-placeholder">Click any state to see its weekly fire ${n === 4 ? "and lightning " : ""}timeline.</div>`;
    if (cfg.panelDelay > 0) {
      // Render map first at full width, then bring panel in after the map fade-in
      vizArea.classList.add("fullwidth");
      panel.classList.add("hidden");
      panelRevealTimer = setTimeout(() => {
        vizArea.classList.remove("fullwidth");
        panel.classList.remove("hidden");
      }, cfg.panelDelay);
    } else {
      vizArea.classList.remove("fullwidth");
      panel.classList.remove("hidden");
    }
  } else {
    vizArea.classList.add("fullwidth");
    panel.classList.add("hidden");
  }

  document.getElementById("stage-controls").innerHTML = cfg.controls();
  cfg.render();
}

// ============================================================
// PRECOMPUTATION — state-level aggregates (used by stages 3+4)
// ============================================================
function precomputeStateData() {
  const stateCache = new Map();
  function findState(lon, lat) {
    const k = `${lon.toFixed(2)},${lat.toFixed(2)}`;
    if (stateCache.has(k)) return stateCache.get(k);
    for (const f of stateFC.features) {
      if (d3.geoContains(f, [lon, lat])) { stateCache.set(k, f.id); return f.id; }
    }
    stateCache.set(k, null);
    return null;
  }

  firePerWeekState = new Map();
  lightPerWeekState = new Map();
  priorPerWeekState = new Map();
  fireCountPerWeekState = new Map();

  for (const d of fires) {
    const st = findState(d.lon, d.lat);
    if (st === null) continue;
    const k = `${d.week}_${st}`;
    firePerWeekState.set(k, (firePerWeekState.get(k) || 0) + d.power);
    priorPerWeekState.set(k, (priorPerWeekState.get(k) || 0) + d.hadLightning);
    fireCountPerWeekState.set(k, (fireCountPerWeekState.get(k) || 0) + 1);
  }
  for (const d of lights) {
    const st = findState(d.lon, d.lat);
    if (st === null) continue;
    const k = `${d.week}_${st}`;
    lightPerWeekState.set(k, (lightPerWeekState.get(k) || 0) + d.flashes);
  }

  stateTotals = new Map();
  for (const f of stateFC.features) {
    stateTotals.set(f.id, { fire: 0, light: 0, fireCount: 0, priorCount: 0, name: f.properties.name });
  }
  for (const [k, v] of firePerWeekState) {
    const st = k.split("_")[1]; stateTotals.get(st).fire += v;
  }
  for (const [k, v] of lightPerWeekState) {
    const st = k.split("_")[1]; if (stateTotals.has(st)) stateTotals.get(st).light += v;
  }
  for (const [k, v] of priorPerWeekState) {
    const st = k.split("_")[1]; stateTotals.get(st).priorCount += v;
  }
  for (const [k, v] of fireCountPerWeekState) {
    const st = k.split("_")[1]; stateTotals.get(st).fireCount += v;
  }

  const activeStates = [...stateTotals.values()].filter(s => s.fire > 0 || s.light > 0);
  const sortedFire = activeStates.map(s => s.fire).sort(d3.ascending);
  const sortedLight = activeStates.map(s => s.light).sort(d3.ascending);
  fireBreaks = [d3.quantile(sortedFire, 0.33), d3.quantile(sortedFire, 0.66)];
  lightBreaks = [d3.quantile(sortedLight, 0.33), d3.quantile(sortedLight, 0.66)];
}

function binFire(v) { return v <= fireBreaks[0] ? 0 : v <= fireBreaks[1] ? 1 : 2; }
function binLight(v) { return v <= lightBreaks[0] ? 0 : v <= lightBreaks[1] ? 1 : 2; }

// ============================================================
// SHARED HELPERS
// ============================================================
function clearViz() { d3.select("#main-viz").selectAll("*").remove(); }

function buildMap(width, height) {
  const svg = d3.select("#main-viz").append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%").style("height", "100%");
  const projection = d3.geoAlbersUsa().scale(width * 1.3).translate([width / 2, height / 2]);
  const path = d3.geoPath(projection);
  return { svg, projection, path };
}

function paintStateBase(svg, path) {
  return svg.append("g").selectAll("path")
    .data(stateFC.features).enter()
    .append("path").attr("class", "state-fill").attr("d", path)
    .attr("fill", "#1c1c22")
    .attr("stroke", "#2c2c33").attr("stroke-width", 0.6);
}

// ============================================================
// STAGE 1 — Weekly fires with slider
// ============================================================
function stage1Controls() {
  return `
    <label for="week-slider">Week starting: <span id="week-label"></span></label>
    <input type="range" id="week-slider" min="0" max="${weeks.length - 1}" value="0" step="1">
  `;
}
function renderStage1() {
  clearViz();
  const { svg, projection, path } = buildMap(900, 540);
  paintStateBase(svg, path);
  const layer = svg.append("g");
  const tip = d3.select("#tooltip");

  const projFires = fires.map(d => {
    const p = projection([d.lon, d.lat]);
    return p ? { ...d, _x: p[0], _y: p[1] } : null;
  }).filter(Boolean);

  const sizeScale = d3.scaleSqrt().domain([1, d3.max(projFires, d => d.power) || 1]).range([2, 14]);
  const colorScale = d3.scaleSequential(d3.interpolateOrRd).domain([0, d3.max(projFires, d => d.maxPower) || 1]);

  const weekTotals = d3.rollup(projFires, v => d3.sum(v, d => d.power), d => d.week);
  const defaultWeek = d3.greatest(weeks, w => weekTotals.get(w) || 0);
  const slider = document.getElementById("week-slider");
  slider.value = weeks.indexOf(defaultWeek);
  const label = document.getElementById("week-label");

  function draw() {
    const w = weeks[+slider.value];
    label.textContent = w;
    const wkData = projFires.filter(d => d.week === w);
    const sel = layer.selectAll("circle").data(wkData, d => `${d.lat},${d.lon}`);
    sel.enter().append("circle")
      .attr("stroke", "#fff").attr("stroke-opacity", 0.25)
      .on("mousemove", function(event, d) {
        tip.style("display", "block")
          .style("left", (event.pageX + 14) + "px")
          .style("top", (event.pageY + 14) + "px")
          .html(`<strong>${d.lat.toFixed(2)}°N, ${(-d.lon).toFixed(2)}°W</strong><br>
                 Week of ${d.week}<br>
                 Detections: ${d.fires}<br>
                 Total power: ${d.power.toLocaleString()} MW`);
      })
      .on("mouseleave", () => tip.style("display", "none"))
      .merge(sel)
      .attr("cx", d => d._x).attr("cy", d => d._y)
      .attr("r", d => sizeScale(d.power))
      .attr("fill", d => colorScale(d.maxPower))
      .attr("fill-opacity", 0.85);
    sel.exit().remove();
  }
  slider.addEventListener("input", draw);
  draw();
}

// ============================================================
// STAGE 2 — All weeks accumulated
// ============================================================
function renderStage2() {
  clearViz();
  const { svg, projection, path } = buildMap(900, 540);
  paintStateBase(svg, path);
  const tip = d3.select("#tooltip");

  const cellMap = new Map();
  for (const d of fires) {
    const p = projection([d.lon, d.lat]);
    if (!p) continue;
    const key = `${d.lat},${d.lon}`;
    if (!cellMap.has(key)) {
      cellMap.set(key, { lat: d.lat, lon: d.lon, _x: p[0], _y: p[1], fires: 0, power: 0, maxPower: 0, weeks: 0 });
    }
    const c = cellMap.get(key);
    c.fires += d.fires;
    c.power += d.power;
    c.maxPower = Math.max(c.maxPower, d.maxPower);
    c.weeks += 1;
  }
  // Sort by week order (chronological appearance) so transition feels like accumulation
  const cells = [...cellMap.values()];

  const sizeScale = d3.scaleSqrt().domain([1, d3.max(cells, d => d.power) || 1]).range([2, 18]);
  const colorScale = d3.scaleSequential(d3.interpolateOrRd).domain([0, d3.max(cells, d => d.maxPower) || 1]);

  svg.append("g").selectAll("circle").data(cells).enter()
    .append("circle")
    .attr("cx", d => d._x).attr("cy", d => d._y)
    .attr("fill", d => colorScale(d.maxPower))
    .attr("stroke", "#fff").attr("stroke-opacity", 0.2)
    .attr("r", 0)              // start small
    .attr("fill-opacity", 0)   // start invisible
    .on("mousemove", function(event, d) {
      tip.style("display", "block")
        .style("left", (event.pageX + 14) + "px")
        .style("top", (event.pageY + 14) + "px")
        .html(`<strong>${d.lat.toFixed(2)}°N, ${(-d.lon).toFixed(2)}°W</strong><br>
               ${d.fires} detections across ${d.weeks} weeks<br>
               Total power: ${d.power.toLocaleString(undefined, {maximumFractionDigits:0})} MW`);
    })
    .on("mouseleave", () => tip.style("display", "none"))
    .transition()
    .delay((d, i) => Math.min(i, 200) * 4)   // stagger up to ~800ms
    .duration(500)
    .attr("r", d => sizeScale(d.power))
    .attr("fill-opacity", 0.65);
}

// ============================================================
// STAGE 3 — State-level fire choropleth
// ============================================================
function renderStage3() {
  clearViz();
  const { svg, path } = buildMap(720, 460);
  const tip = d3.select("#tooltip");

  const fireMax = d3.max([...stateTotals.values()], s => s.fire) || 1;
  const fireColor = d3.scaleSequential(d3.interpolateOrRd).domain([0, Math.log10(fireMax + 1)]);
  const noDataColor = "#3a3a42";  // visible "no data" gray

  const statePaths = svg.append("g").selectAll("path")
    .data(stateFC.features).enter()
    .append("path").attr("d", path)
    .attr("fill", noDataColor)
    .attr("stroke", "#2c2c33").attr("stroke-width", 0.6)
    .style("cursor", "pointer");

  bindStateInteractions(statePaths, tip, { showLightning: false });

  // Fade-in fire colors over the state polygons
  statePaths.transition()
    .delay((d, i) => i * 12)
    .duration(600)
    .attr("fill", d => {
      const s = stateTotals.get(d.id);
      return s.fire > 0 ? fireColor(Math.log10(s.fire + 1)) : noDataColor;
    });
}

// ============================================================
// STAGE 4 — Bivariate with lightning toggle
// ============================================================
function renderStage4() {
  clearViz();
  const { svg, path } = buildMap(720, 460);
  const tip = d3.select("#tooltip");
  const noDataColor = "#3a3a42";

  function bivariate(s) {
    if (s.fire === 0 && s.light === 0) return noDataColor;
    return BIVARIATE[binFire(s.fire)][binLight(s.light)];
  }

  // Start every state at no-data gray, then fade in bivariate colors row-by-row
  // (same style as Stage 3 — visual consistency, so the transition reads as a
  // continuation of the same animation idiom)
  const statePaths = svg.append("g").selectAll("path")
    .data(stateFC.features).enter()
    .append("path").attr("d", path)
    .attr("fill", noDataColor)
    .attr("stroke", "#2c2c33").attr("stroke-width", 0.6)
    .style("cursor", "pointer");

  bindStateInteractions(statePaths, tip, { showLightning: true });

  statePaths.transition()
    .delay((d, i) => i * 12)
    .duration(700)
    .attr("fill", d => bivariate(stateTotals.get(d.id)));

  // Bivariate legend fades in after the colors land
  const legendG = svg.append("g").attr("class", "legend-group").style("opacity", 0);
  drawBivLegend(legendG);
  legendG.transition().delay(700).duration(450).style("opacity", 1);
}

function drawBivLegend(g) {
  const size = 22;
  const left = 10, top = 340;
  g.append("rect").attr("x", left - 4).attr("y", top - 22)
    .attr("width", 140).attr("height", 110)
    .attr("fill", "rgba(15,15,18,0.92)")
    .attr("stroke", "#2c2c33");
  g.append("text").attr("x", left + 30).attr("y", top - 6).attr("fill", "#9b9794")
    .style("font-size", "10px").style("text-transform", "uppercase").style("letter-spacing", "1px")
    .text("Lightning →");
  g.append("text").attr("x", left + 8).attr("y", top + 50)
    .attr("fill", "#9b9794").attr("transform", `rotate(-90, ${left + 8}, ${top + 50})`)
    .style("font-size", "10px").style("text-transform", "uppercase").style("letter-spacing", "1px")
    .text("Fire →");
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      g.append("rect")
        .attr("x", left + 26 + col * size).attr("y", top + (2 - row) * size)
        .attr("width", size).attr("height", size)
        .attr("fill", BIVARIATE[row][col])
        .attr("stroke", "#0f0f12").attr("stroke-width", 1);
    }
  }
  return g;
}

function bindStateInteractions(paths, tip, { showLightning }) {
  paths
    .on("mousemove", function(event, d) {
      const s = stateTotals.get(d.id);
      const lightLine = showLightning
        ? `Lightning: ${s.light ? s.light.toLocaleString() + " flashes" : "—"}<br>`
        : "";
      tip.style("display", "block")
        .style("left", (event.pageX + 14) + "px")
        .style("top", (event.pageY + 14) + "px")
        .html(`<strong>${s.name}</strong><br>
               Fire power: ${s.fire ? s.fire.toLocaleString(undefined, {maximumFractionDigits:0}) + " MW" : "—"}<br>
               ${lightLine}<em>click to see timeline</em>`);
      paths.attr("stroke-width", x => x.id === d.id ? 2 : 0.6)
           .attr("stroke", x => x.id === d.id ? "#fff" : "#2c2c33");
    })
    .on("mouseleave", function() {
      tip.style("display", "none");
      paths.attr("stroke-width", 0.6).attr("stroke", "#2c2c33");
    })
    .on("click", function(event, d) {
      renderStatePanel(d.id, stateTotals.get(d.id), { showLightning });
      paths.attr("stroke-width", x => x.id === d.id ? 2.5 : 0.6)
           .attr("stroke", x => x.id === d.id ? "#fff" : "#2c2c33");
    });
}

function renderStatePanel(stateId, totals, { showLightning }) {
  const panel = d3.select("#state-panel");
  panel.selectAll("*").remove();
  const pctNoPrior = totals.fireCount === 0 ? null :
    Math.round(100 * (1 - totals.priorCount / totals.fireCount));

  panel.append("h3").text(totals.name);
  panel.append("div").attr("class", "panel-sub").text("June–October 2024");
  const rows = panel.append("div");
  rows.append("div").attr("class", "stat-row")
    .html(`<span class="stat-label">Total fire radiative power</span>
           <span class="stat-val fire">${totals.fire ? totals.fire.toLocaleString(undefined, {maximumFractionDigits:0}) + " MW" : "—"}</span>`);
  if (showLightning) {
    rows.append("div").attr("class", "stat-row")
      .html(`<span class="stat-label">Total lightning flashes</span>
             <span class="stat-val light">${totals.light ? totals.light.toLocaleString() : "—"}</span>`);
  }
  rows.append("div").attr("class", "stat-row")
    .html(`<span class="stat-label">Fire cells observed</span>
           <span class="stat-val">${totals.fireCount.toLocaleString()}</span>`);
  if (showLightning) {
    rows.append("div").attr("class", "stat-row")
      .html(`<span class="stat-label">Cells <em>with</em> prior-day lightning</span>
             <span class="stat-val">${totals.priorCount.toLocaleString()}</span>`);
  }

  const W = 280, H = 130, M = { top: 10, right: 16, bottom: 22, left: 30 };
  const chart = panel.append("div").attr("class", "panel-chart")
    .append("svg").attr("viewBox", `0 0 ${W} ${H}`)
    .style("width", "100%").style("height", H + "px");
  const series = weeks.map(w => ({
    week: w,
    fire: firePerWeekState.get(`${w}_${stateId}`) || 0,
    light: lightPerWeekState.get(`${w}_${stateId}`) || 0,
  }));
  const x = d3.scaleBand().domain(weeks).range([M.left, W - M.right]).padding(0.1);
  const yFire = d3.scaleLinear().domain([0, d3.max(series, d => d.fire) || 1]).range([H - M.bottom, M.top]);
  const yLight = d3.scaleLinear().domain([0, d3.max(series, d => d.light) || 1]).range([H - M.bottom, M.top]);

  chart.append("g").selectAll("rect").data(series).enter().append("rect")
    .attr("x", d => x(d.week))
    .attr("y", d => yFire(d.fire))
    .attr("width", x.bandwidth())
    .attr("height", d => H - M.bottom - yFire(d.fire))
    .attr("fill", "#e0532a").attr("fill-opacity", 0.85);

  if (showLightning) {
    const line = d3.line()
      .x(d => x(d.week) + x.bandwidth() / 2)
      .y(d => yLight(d.light))
      .curve(d3.curveMonotoneX);
    chart.append("path").datum(series).attr("d", line)
      .attr("fill", "none").attr("stroke", "#f0c419").attr("stroke-width", 2);
  }

  const tickWeeks = [weeks[0], weeks[Math.floor(weeks.length / 2)], weeks[weeks.length - 1]];
  chart.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${H - M.bottom})`)
    .call(d3.axisBottom(x).tickValues(tickWeeks).tickFormat(d => d.slice(5)));

  panel.append("div").attr("class", "panel-sub").style("text-align", "center").style("margin-top", "0")
    .html(showLightning
      ? `<span style="color:#e0532a">■</span> fire MW &nbsp; <span style="color:#f0c419">━</span> lightning flashes`
      : `<span style="color:#e0532a">■</span> fire MW per week`);

  let verdict;
  if (totals.fireCount === 0) {
    verdict = "No fires were detected here in 2024.";
  } else if (!showLightning) {
    verdict = `${totals.fireCount.toLocaleString()} fire cells were observed in ${totals.name} this season, totalling ${totals.fire.toLocaleString(undefined, {maximumFractionDigits:0})} MW.`;
  } else if (pctNoPrior >= 70) {
    verdict = `Of ${totals.fireCount} fire cells in ${totals.name}, only ${totals.priorCount} had lightning within 24 hours before. <strong>${pctNoPrior}% had no lightning preceding them.</strong>`;
  } else {
    verdict = `Of ${totals.fireCount} fire cells in ${totals.name}, ${totals.priorCount} had prior-day lightning — ${100 - pctNoPrior}% had a lightning antecedent.`;
  }
  panel.append("div").attr("class", "panel-verdict").html(verdict);
}

// ============================================================
// STAGE 5 — Scatter verdict
// ============================================================
function stage5Controls() {
  return `
    <div class="headline" style="margin-right:24px">
      <span id="headline-num">—</span>
      <span class="headline-text">of selected fire cells had <strong>no</strong> prior-day lightning</span>
    </div>
    <div>
      <strong style="margin-right:6px">Filter region:</strong>
      <button data-region="All" class="region-btn active">All</button>
      <button data-region="West" class="region-btn">West</button>
      <button data-region="Mountain/Plains" class="region-btn">Mountain/Plains</button>
      <button data-region="South-Central" class="region-btn">South-Central</button>
      <button data-region="East" class="region-btn">East</button>
    </div>
  `;
}
function renderStage5() {
  clearViz();
  const W = 900, H = 460, M = { top: 20, right: 24, bottom: 50, left: 60 };
  const svg = d3.select("#main-viz").append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%").style("height", "100%");

  const x = d3.scaleLinear()
    .domain([0, d3.max(joined, d => d.priorLightning) || 1])
    .range([M.left, W - M.right]).nice();
  const y = d3.scaleLog()
    .domain([Math.max(1, d3.min(joined, d => d.power) || 1), d3.max(joined, d => d.power) || 1])
    .range([H - M.bottom, M.top]).nice();
  const regionColor = d3.scaleOrdinal()
    .domain(["West", "Mountain/Plains", "South-Central", "East"])
    .range(["#e0532a", "#f6b042", "#4cc2ff", "#a78bfa"]);

  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${H - M.bottom})`)
    .call(d3.axisBottom(x).ticks(8))
    .append("text").attr("x", W / 2).attr("y", 38).attr("fill", "currentColor")
    .attr("text-anchor", "middle").style("font-size", "12px")
    .text("Lightning flashes in same cell, prior 24 hours");
  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(${M.left},0)`)
    .call(d3.axisLeft(y).ticks(6, "~s"))
    .append("text").attr("x", -H / 2).attr("y", -42).attr("transform", "rotate(-90)")
    .attr("fill", "currentColor").attr("text-anchor", "middle").style("font-size", "12px")
    .text("Total fire radiative power (MW, log scale)");

  const jitter = d => d.priorLightning === 0 ? (Math.random() - 0.5) * 0.6 : 0;
  const dotsLayer = svg.append("g");
  let activeRegion = "All";
  let xRange = x.domain();

  function visibleData() {
    return joined.filter(d => {
      const xv = d.priorLightning + jitter(d);
      return (activeRegion === "All" || d.region === activeRegion)
        && d.power > 0
        && xv >= xRange[0] && xv <= xRange[1];
    });
  }
  function draw() {
    const data = visibleData();
    const sel = dotsLayer.selectAll("circle").data(data, d => `${d.week}-${d.lat}-${d.lon}`);
    sel.enter().append("circle")
      .attr("r", 3.5).attr("fill-opacity", 0.7).attr("stroke", "#0f0f12").attr("stroke-width", 0.3)
      .merge(sel)
      .attr("cx", d => x(d.priorLightning + jitter(d)))
      .attr("cy", d => y(Math.max(d.power, 1)))
      .attr("fill", d => regionColor(d.region));
    sel.exit().remove();
    const noL = data.filter(d => d.priorLightning < 5).length;
    const pct = data.length ? Math.round(100 * noL / data.length) : 0;
    const hn = document.getElementById("headline-num");
    if (hn) hn.textContent = `${pct}%`;
  }

  const brush = d3.brushX()
    .extent([[M.left, M.top], [W - M.right, H - M.bottom]])
    .on("end", (event) => {
      xRange = event.selection ? event.selection.map(x.invert) : x.domain();
      draw();
    });
  svg.append("g").attr("class", "brush").call(brush);

  d3.selectAll(".region-btn").on("click", function() {
    d3.selectAll(".region-btn").classed("active", false);
    d3.select(this).classed("active", true);
    activeRegion = this.dataset.region;
    draw();
  });

  draw();
}
