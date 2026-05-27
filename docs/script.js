// Lightning vs. Fire — DSC106 Project 3 (narrative stage flow)
// Pure D3 v7 + topojson-client.

const TOTAL_STAGES = 6;
let currentStage = 1;

// Shared data (set in main)
let fires, lights, joined, usTopo, weeks;
let stateTotals, fireBreaks, lightBreaks;
let firePerWeekState, lightPerWeekState, priorPerWeekState, fireCountPerWeekState;
let stateFC;

// Bivariate palette tuned for cream/light background.
// Rows = fire (low/mid/high), Cols = lightning (low/mid/high).
// Corners encode the myth-bust:
//   high-fire / low-lightning = red    (Western states)
//   low-fire / high-lightning = teal   (Florida / Gulf)
const BIVARIATE = [
  ["#d8d4c5", "#a8c4cf", "#3f97a5"], // fire low
  ["#cfa39c", "#9c9aa7", "#3f7080"], // fire mid
  ["#b8453a", "#7a3a5e", "#2c2e58"], // fire high
];

// VPD weekly averages (kPa) derived from vpd_2024_fire_season_daily.csv
// Keyed to same week strings as fires_weekly_2024.csv
const VPD_WEEKLY = {"2024-05-27":1.1989,"2024-06-03":1.3776,"2024-06-10":1.4668,"2024-06-17":1.3398,"2024-06-24":1.4859,"2024-07-01":1.4983,"2024-07-08":1.8138,"2024-07-15":1.5749,"2024-07-22":1.5294,"2024-07-29":1.708,"2024-08-05":1.4306,"2024-08-12":1.4145,"2024-08-19":1.4358,"2024-08-26":1.4666,"2024-09-02":1.4265,"2024-09-09":1.3874,"2024-09-16":1.1257,"2024-09-23":1.2991,"2024-09-30":1.3542,"2024-10-07":1.3568,"2024-10-14":0.9147,"2024-10-21":0.9798,"2024-10-28":0.7051};

// Bivariate palette: fire (rows, low→high) × VPD (cols, low→high)
// Low-VPD / high-fire = muted red (fire without drought driver — agricultural/human)
// High-VPD / high-fire = deep crimson (classic drought-driven wildfire)
// High-VPD / low-fire = amber (dry air but not yet burning)
const BIVARIATE_VPD = [
  ["#d8d4c5", "#e8c97a", "#c9a23a"], // fire low:  cream → amber
  ["#cfa39c", "#c4855a", "#b86030"], // fire mid:  salmon → burnt orange
  ["#b8453a", "#912533", "#5c0d1e"], // fire high: red → deep crimson
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
    caption: "Same data, summarized: each state colored by total fire radiative power for the season. The pattern hardens. Fires concentrate in the Mountain West and a corridor through Texas and the Plains.",
    showPanel: true,
    panelDelay: 750,         // wait for map fade-in to complete, then bring panel in
    render: renderStage3,
    controls: () => "",
    nextHint: "Add lightning to the picture →",
  },
  4: {
    title: "Now overlay the lightning",
    caption: "Each state is now colored on two axes: fire activity vertically, lightning activity horizontally. The myth-buster reveals itself: the bright-red Western states aren't where the lightning is. Florida and the Gulf get the most lightning but barely burn. Click any state for a weekly breakdown.",
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
    nextHint: "A new factor enters the picture →",
  },
  6: {
    title: "Does atmospheric dryness explain what lightning doesn't?",
    caption: "Each state is now colored on two axes: fire activity vertically, Vapor Pressure Deficit (VPD) horizontally. VPD measures how thirsty the atmosphere is — high VPD pulls moisture out of vegetation, priming fuels for burning. The Western states that burned hardest also sit in the high-VPD column. Drag the week slider to watch both the fire circles and the VPD dryness pulse through the season.",
    showPanel: true,
    panelDelay: 0,
    render: renderStage6,
    controls: stage6Controls,
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
  precomputeVpdData();

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
// State-membership lookup (point-in-polygon, cached).
// Returns the state FIPS id for a (lon,lat), or null if outside all U.S.
// state polygons. Used to drop fire/lightning cells that fall over Canada,
// Mexico, or open water within the Albers USA projection extent.
// ============================================================
const CELL_DEG = 0.5;
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
// Records carry the SW corner of their 0.5° cell. For state-membership
// checks we want the cell *center* — much more representative of where
// the actual fire detections are.
function findStateForCell(d) {
  return findState(d.lon + CELL_DEG / 2, d.lat + CELL_DEG / 2);
}

// ============================================================
// PRECOMPUTATION — state-level aggregates (used by stages 3+4)
// ============================================================
function precomputeStateData() {

  firePerWeekState = new Map();
  lightPerWeekState = new Map();
  priorPerWeekState = new Map();
  fireCountPerWeekState = new Map();

  for (const d of fires) {
    const st = findStateForCell(d);
    if (st === null) continue;
    const k = `${d.week}_${st}`;
    firePerWeekState.set(k, (firePerWeekState.get(k) || 0) + d.power);
    priorPerWeekState.set(k, (priorPerWeekState.get(k) || 0) + d.hadLightning);
    fireCountPerWeekState.set(k, (fireCountPerWeekState.get(k) || 0) + 1);
  }
  for (const d of lights) {
    const st = findStateForCell(d);
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

// VPD helpers — season average per state is estimated by weighting each week's
// VPD by that state's total fire power that week, giving a fire-intensity-weighted
// atmospheric dryness signal. For states with no fire, we use the national
// weekly average VPD across all weeks.
let stateVpdWeighted; // Map: stateId → fire-weighted mean VPD
let vpdBreaks;        // [p33, p66] thresholds across active states

function precomputeVpdData() {
  const vpdWeeks = Object.keys(VPD_WEEKLY);
  const nationalAvgVpd = vpdWeeks.reduce((s, w) => s + VPD_WEEKLY[w], 0) / vpdWeeks.length;

  stateVpdWeighted = new Map();
  for (const f of stateFC.features) {
    let totalWeight = 0, weightedVpd = 0;
    for (const w of vpdWeeks) {
      const statePower = firePerWeekState.get(`${w}_${f.id}`) || 0;
      weightedVpd += statePower * (VPD_WEEKLY[w] || nationalAvgVpd);
      totalWeight += statePower;
    }
    stateVpdWeighted.set(f.id, totalWeight > 0 ? weightedVpd / totalWeight : nationalAvgVpd);
  }

  const activeVpds = [...stateVpdWeighted.values()].sort(d3.ascending);
  vpdBreaks = [d3.quantile(activeVpds, 0.33), d3.quantile(activeVpds, 0.66)];
}

function binVpd(v) { return v <= vpdBreaks[0] ? 0 : v <= vpdBreaks[1] ? 1 : 2; }


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
    .attr("fill", "#fbfaf7")
    .attr("stroke", "#1f1f1f").attr("stroke-width", 1.8);
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

  // Filter to inside US state polygons only — drops Canadian/Mexican border
  // cells that the Albers USA projection would otherwise place on the map.
  const projFires = fires.map(d => {
    if (findStateForCell(d) === null) return null;
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
      .attr("stroke", "#1a1a1a").attr("stroke-opacity", 0.35)
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
    if (findStateForCell(d) === null) continue; // drop non-US cells
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
    .attr("stroke", "#1a1a1a").attr("stroke-opacity", 0.3)
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
  const noDataColor = "#fbfaf7";  // visible "no data" gray

  const statePaths = svg.append("g").selectAll("path")
    .data(stateFC.features).enter()
    .append("path").attr("d", path)
    .attr("fill", noDataColor)
    .attr("stroke", "#1f1f1f").attr("stroke-width", 1.8)
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
  const noDataColor = "#fbfaf7";

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
    .attr("stroke", "#1f1f1f").attr("stroke-width", 1.8)
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
    .attr("fill", "rgba(251,250,247,0.96)")
    .attr("stroke", "#1f1f1f");
  g.append("text").attr("x", left + 30).attr("y", top - 6).attr("fill", "#6b6b6b")
    .style("font-size", "10px").style("text-transform", "uppercase").style("letter-spacing", "1px")
    .text("Lightning →");
  g.append("text").attr("x", left + 8).attr("y", top + 50)
    .attr("fill", "#6b6b6b").attr("transform", `rotate(-90, ${left + 8}, ${top + 50})`)
    .style("font-size", "10px").style("text-transform", "uppercase").style("letter-spacing", "1px")
    .text("Fire →");
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      g.append("rect")
        .attr("x", left + 26 + col * size).attr("y", top + (2 - row) * size)
        .attr("width", size).attr("height", size)
        .attr("fill", BIVARIATE[row][col])
        .attr("stroke", "#fbfaf7").attr("stroke-width", 1);
    }
  }
  return g;
}

function bindStateInteractions(paths, tip, { showLightning }) {
  paths
    .on("mousemove", function(event, d) {
      const s = stateTotals.get(d.id);
      const lightLine = showLightning
        ? `Lightning: ${s.light ? s.light.toLocaleString() + " flashes" : "none"}<br>`
        : "";
      tip.style("display", "block")
        .style("left", (event.pageX + 14) + "px")
        .style("top", (event.pageY + 14) + "px")
        .html(`<strong>${s.name}</strong><br>
               Fire power: ${s.fire ? s.fire.toLocaleString(undefined, {maximumFractionDigits:0}) + " MW" : "none"}<br>
               ${lightLine}<em>click to see timeline</em>`);
      paths.attr("stroke-width", x => x.id === d.id ? 3.2 : 1.8)
           .attr("stroke", x => x.id === d.id ? "#b8453a" : "#1f1f1f");
    })
    .on("mouseleave", function() {
      tip.style("display", "none");
      paths.attr("stroke-width", 1.8).attr("stroke", "#1f1f1f");
    })
    .on("click", function(event, d) {
      renderStatePanel(d.id, stateTotals.get(d.id), { showLightning });
      paths.attr("stroke-width", x => x.id === d.id ? 3.2 : 1.8)
           .attr("stroke", x => x.id === d.id ? "#b8453a" : "#1f1f1f");
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
           <span class="stat-val fire">${totals.fire ? totals.fire.toLocaleString(undefined, {maximumFractionDigits:0}) + " MW" : "none"}</span>`);
  if (showLightning) {
    rows.append("div").attr("class", "stat-row")
      .html(`<span class="stat-label">Total lightning flashes</span>
             <span class="stat-val light">${totals.light ? totals.light.toLocaleString() : "none"}</span>`);
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
    verdict = `Of ${totals.fireCount} fire cells in ${totals.name}, ${totals.priorCount} had prior-day lightning. That is ${100 - pctNoPrior}% had a lightning antecedent.`;
  }
  panel.append("div").attr("class", "panel-verdict").html(verdict);
}

// ============================================================
// STAGE 5 — Scatter verdict
// ============================================================
function stage5Controls() {
  return `
    <div class="thesis-line" id="thesis-line">
      <span class="thesis-num" id="thesis-num">88%</span>
      <span class="thesis-text">
        of <span id="thesis-scope">all 2,656 fire cells</span> in 2024
        had <strong>no</strong> lightning in the 24 hours before they burned.
      </span>
    </div>
    <div class="region-row">
      <strong>Filter by region:</strong>
      <button data-region="All" class="region-btn active">All</button>
      <button data-region="West" class="region-btn">West</button>
      <button data-region="Mountain/Plains" class="region-btn">Mountain/Plains</button>
      <button data-region="South-Central" class="region-btn">South-Central</button>
      <button data-region="East" class="region-btn">East</button>
    </div>
    <div id="selection-info">
      Drag any rectangle on the chart to inspect a subset.
    </div>
  `;
}
function renderStage5() {
  clearViz();
  // Match the map stages so the chart occupies the same visual area as the
  // map and the layout doesn't shift between stages 4 and 5.
  const W = 900, H = 540, M = { top: 20, right: 24, bottom: 60, left: 60 };
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

  // Visual annotation: highlight the "no prior lightning" zone (X near 0)
  // so the ~88% column reads as a population, not a 1-pixel artifact.
  // Label sits above the chart (no overlap with axis/data).
  const noLightZoneRight = x(5);
  svg.append("g").attr("class", "annotation").lower()
    .call(g => {
      g.append("rect")
        .attr("x", x(0)).attr("y", M.top)
        .attr("width", noLightZoneRight - x(0))
        .attr("height", H - M.bottom - M.top)
        .attr("fill", "#b8453a").attr("fill-opacity", 0.06);
      g.append("line")
        .attr("x1", noLightZoneRight).attr("x2", noLightZoneRight)
        .attr("y1", M.top).attr("y2", H - M.bottom)
        .attr("stroke", "#b8453a").attr("stroke-opacity", 0.35)
        .attr("stroke-dasharray", "3 3");
      // Single annotation above the chart, with a bracket pointing to the column
      const labelY = M.top - 14;
      g.append("text")
        .attr("x", noLightZoneRight + 4)
        .attr("y", labelY)
        .attr("text-anchor", "start")
        .attr("fill", "#b8453a")
        .style("font-family", "'Helvetica Neue', Helvetica, Arial, sans-serif")
        .style("font-size", "11px")
        .style("font-weight", "600")
        .text("← Cells with no preceding lightning");
    });

  // Pre-jitter once per row so brushing/region filtering is stable.
  // X=0 cells get a wide one-sided jitter (0–4 X units) so the ~88% majority
  // is visually obvious as a thick column on the left, not a 1-pixel stripe.
  const data0 = joined
    .filter(d => d.power > 0)
    .map(d => ({
      ...d,
      _x: d.priorLightning + (d.priorLightning < 5 ? Math.random() * 4 : 0),
    }));

  const dotsLayer = svg.append("g");
  let activeRegion = "All";
  let brushSel = null;   // [[x0,y0],[x1,y1]] in pixel space, or null

  function dotMatches(d) {
    if (activeRegion !== "All" && d.region !== activeRegion) return false;
    if (!brushSel) return true;
    const cx = x(d._x), cy = y(Math.max(d.power, 1));
    const [[bx0, by0], [bx1, by1]] = brushSel;
    return cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1;
  }

  function fmt(n) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); }

  function draw() {
    // Render ALL dots — highlight matches; dim non-matches (don't remove)
    const sel = dotsLayer.selectAll("circle").data(data0, d => `${d.week}-${d.lat}-${d.lon}`);
    sel.enter().append("circle")
      .attr("r", 3.5).attr("stroke", "#fbfaf7").attr("stroke-width", 0.3)
      .merge(sel)
      .attr("cx", d => x(d._x))
      .attr("cy", d => y(Math.max(d.power, 1)))
      .attr("fill", d => regionColor(d.region))
      .attr("fill-opacity", d => dotMatches(d) ? 0.85 : 0.08)
      .attr("r", d => dotMatches(d) ? 3.6 : 2.4);

    // THESIS number — reflects the region filter only, not the brush.
    // This is the project's headline finding and should not change just
    // because the user moved their brush around the chart.
    const regionAll = data0.filter(d =>
      activeRegion === "All" || d.region === activeRegion
    );
    const regionNoL = regionAll.filter(d => d.priorLightning < 5).length;
    const regionPct = regionAll.length
      ? Math.round(100 * regionNoL / regionAll.length)
      : 0;
    const tn = document.getElementById("thesis-num");
    if (tn) tn.textContent = `${regionPct}%`;
    const ts = document.getElementById("thesis-scope");
    if (ts) {
      ts.textContent = activeRegion === "All"
        ? `all ${regionAll.length.toLocaleString()} fire cells`
        : `${regionAll.length.toLocaleString()} fire cells in the ${activeRegion} region`;
    }

    const matched = data0.filter(dotMatches);
    const info = document.getElementById("selection-info");
    if (info) {
      if (!brushSel) {
        info.textContent = "Drag any rectangle on the chart to inspect a subset. Click outside the box to clear.";
      } else {
        const [[bx0, by0], [bx1, by1]] = brushSel;
        const xLo = Math.max(0, x.invert(bx0)).toFixed(0);
        const xHi = x.invert(bx1).toFixed(0);
        const yHi = y.invert(by0).toFixed(0);
        const yLo = y.invert(by1).toFixed(0);
        const meanPower = matched.length ? d3.mean(matched, d => d.power) : 0;
        const meanLight = matched.length ? d3.mean(matched, d => d.priorLightning) : 0;
        info.innerHTML =
          `Selected <strong>${matched.length.toLocaleString()}</strong> fire cells ` +
          `(${xLo}–${xHi} prior-day flashes, ${fmt(yLo)}–${fmt(yHi)} MW). ` +
          `Mean fire power <strong>${fmt(meanPower)} MW</strong>, ` +
          `mean prior-day lightning <strong>${fmt(meanLight)} flashes</strong>.`;
      }
    }
  }

  const brush = d3.brush()
    .extent([[M.left, M.top], [W - M.right, H - M.bottom]])
    .on("end", (event) => {
      brushSel = event.selection || null;
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

// ============================================================
// STAGE 6 — Bivariate fire × VPD choropleth + fire circles with VPD slider
// ============================================================
function stage6Controls() {
  const vpdWeeks = Object.keys(VPD_WEEKLY).sort();
  return `
    <label for="vpd-week-slider" style="display:flex;align-items:center;gap:10px;">
      <span>Week: <strong id="vpd-week-label">${vpdWeeks[0]}</strong></span>
      <span style="margin-left:auto;font-size:12px;">VPD: <strong id="vpd-val-label">—</strong> kPa</span>
    </label>
    <input type="range" id="vpd-week-slider" min="0" max="${vpdWeeks.length - 1}" value="${vpdWeeks.length - 1}" step="1">
    <div style="font-size:11px;color:#888;margin-top:4px;">
      Slider animates the fire circles by week. Map colors reflect each state's fire-weighted seasonal VPD.
    </div>
  `;
}

function renderStage6() {
  clearViz();
  const { svg, projection, path } = buildMap(720, 460);
  const tip = d3.select("#tooltip");
  const noDataColor = "#fbfaf7";

  // --- State bivariate choropleth (fire × VPD) ---
  function bivariateVpd(stateId) {
    const s = stateTotals.get(stateId);
    if (!s || (s.fire === 0)) return noDataColor;
    const vpd = stateVpdWeighted.get(stateId) || 0;
    return BIVARIATE_VPD[binFire(s.fire)][binVpd(vpd)];
  }

  const statePaths = svg.append("g").selectAll("path")
    .data(stateFC.features).enter()
    .append("path").attr("d", path)
    .attr("fill", noDataColor)
    .attr("stroke", "#1f1f1f").attr("stroke-width", 1.8)
    .style("cursor", "pointer");

  // Bind interactions — show VPD in panel
  statePaths
    .on("mousemove", function(event, d) {
      const s = stateTotals.get(d.id);
      const vpd = stateVpdWeighted.get(d.id);
      tip.style("display", "block")
        .style("left", (event.pageX + 14) + "px")
        .style("top",  (event.pageY + 14) + "px")
        .html(`<strong>${s.name}</strong><br>
               Fire power: ${s.fire ? s.fire.toLocaleString(undefined, {maximumFractionDigits:0}) + " MW" : "none"}<br>
               Seasonal VPD (fire-weighted): ${vpd ? vpd.toFixed(2) + " kPa" : "—"}<br>
               <em>click for weekly timeline</em>`);
      statePaths.attr("stroke-width", x => x.id === d.id ? 3.2 : 1.8)
                .attr("stroke",       x => x.id === d.id ? "#b8453a" : "#1f1f1f");
    })
    .on("mouseleave", function() {
      tip.style("display", "none");
      statePaths.attr("stroke-width", 1.8).attr("stroke", "#1f1f1f");
    })
    .on("click", function(event, d) {
      renderStatePanelVpd(d.id, stateTotals.get(d.id));
      statePaths.attr("stroke-width", x => x.id === d.id ? 3.2 : 1.8)
                .attr("stroke",       x => x.id === d.id ? "#b8453a" : "#1f1f1f");
    });

  statePaths.transition()
    .delay((d, i) => i * 12)
    .duration(700)
    .attr("fill", d => bivariateVpd(d.id));

  // --- Bivariate legend ---
  const legendG = svg.append("g").attr("class", "legend-group").style("opacity", 0);
  drawVpdLegend(legendG);
  legendG.transition().delay(700).duration(450).style("opacity", 1);

  // --- Fire circles layer (same mechanic as Stage 1, driven by VPD slider) ---
  const vpdWeeks = Object.keys(VPD_WEEKLY).sort();
  const circleLayer = svg.append("g");

  const projFires = fires.map(d => {
    if (findStateForCell(d) === null) return null;
    const p = projection([d.lon, d.lat]);
    return p ? { ...d, _x: p[0], _y: p[1] } : null;
  }).filter(Boolean);

  const sizeScale  = d3.scaleSqrt()
    .domain([1, d3.max(projFires, d => d.power) || 1])
    .range([2, 12]);
  const colorScale = d3.scaleSequential(d3.interpolateOrRd)
    .domain([0, d3.max(projFires, d => d.maxPower) || 1]);

  function drawCircles(weekIdx) {
    const w = vpdWeeks[weekIdx];
    const vpd = VPD_WEEKLY[w];
    document.getElementById("vpd-week-label").textContent = w;
    document.getElementById("vpd-val-label").textContent = vpd ? vpd.toFixed(2) : "—";

    const wkData = projFires.filter(d => d.week === w);
    const sel = circleLayer.selectAll("circle")
      .data(wkData, d => `${d.lat},${d.lon}`);

    sel.enter().append("circle")
      .attr("stroke", "#1a1a1a").attr("stroke-opacity", 0.35)
      .attr("fill-opacity", 0)
      .attr("r", 0)
      .merge(sel)
      .attr("cx", d => d._x).attr("cy", d => d._y)
      .attr("fill", d => colorScale(d.maxPower))
      .transition().duration(200)
      .attr("r", d => sizeScale(d.power))
      .attr("fill-opacity", 0.85);

    sel.exit().transition().duration(150).attr("r", 0).remove();
  }

  const slider = document.getElementById("vpd-week-slider");
  slider.addEventListener("input", () => drawCircles(+slider.value));
  // Default to peak VPD week (index 6 = July 8)
  slider.value = 6;
  drawCircles(6);
}

function drawVpdLegend(g) {
  const size = 22;
  const left = 10, top = 300;
  g.append("rect").attr("x", left - 4).attr("y", top - 22)
    .attr("width", 148).attr("height", 120)
    .attr("fill", "rgba(251,250,247,0.96)")
    .attr("stroke", "#1f1f1f");
  g.append("text").attr("x", left + 30).attr("y", top - 6).attr("fill", "#6b6b6b")
    .style("font-size", "10px").style("text-transform", "uppercase").style("letter-spacing", "1px")
    .text("VPD (dryness) →");
  g.append("text").attr("x", left + 8).attr("y", top + 50)
    .attr("fill", "#6b6b6b").attr("transform", `rotate(-90, ${left + 8}, ${top + 50})`)
    .style("font-size", "10px").style("text-transform", "uppercase").style("letter-spacing", "1px")
    .text("Fire →");
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      g.append("rect")
        .attr("x", left + 26 + col * size).attr("y", top + (2 - row) * size)
        .attr("width", size).attr("height", size)
        .attr("fill", BIVARIATE_VPD[row][col])
        .attr("stroke", "#fbfaf7").attr("stroke-width", 1);
    }
  }
  // Corner labels
  g.append("text").attr("x", left + 26).attr("y", top + 3 * size + 12)
    .style("font-size", "9px").attr("fill", "#888").text("low VPD");
  g.append("text").attr("x", left + 26 + 2 * size).attr("y", top + 3 * size + 12)
    .style("font-size", "9px").attr("fill", "#888").attr("text-anchor", "end").text("high VPD");
}

function renderStatePanelVpd(stateId, totals) {
  const panel = d3.select("#state-panel");
  panel.selectAll("*").remove();
  const vpd = stateVpdWeighted.get(stateId);

  panel.append("h3").text(totals.name);
  panel.append("div").attr("class", "panel-sub").text("June–October 2024");
  const rows = panel.append("div");

  rows.append("div").attr("class", "stat-row")
    .html(`<span class="stat-label">Total fire radiative power</span>
           <span class="stat-val fire">${totals.fire ? totals.fire.toLocaleString(undefined, {maximumFractionDigits:0}) + " MW" : "none"}</span>`);
  rows.append("div").attr("class", "stat-row")
    .html(`<span class="stat-label">Fire-weighted seasonal VPD</span>
           <span class="stat-val" style="color:#c9a23a">${vpd ? vpd.toFixed(3) + " kPa" : "—"}</span>`);
  rows.append("div").attr("class", "stat-row")
    .html(`<span class="stat-label">Fire cells observed</span>
           <span class="stat-val">${totals.fireCount.toLocaleString()}</span>`);

  // Weekly dual-axis chart: fire bars + VPD line
  const W = 280, H = 140, M = { top: 10, right: 16, bottom: 22, left: 34 };
  const chart = panel.append("div").attr("class", "panel-chart")
    .append("svg").attr("viewBox", `0 0 ${W} ${H}`)
    .style("width", "100%").style("height", H + "px");

  const series = weeks.map(w => ({
    week: w,
    fire: firePerWeekState.get(`${w}_${stateId}`) || 0,
    vpd: VPD_WEEKLY[w] || null,
  }));

  const x = d3.scaleBand().domain(weeks).range([M.left, W - M.right]).padding(0.1);
  const yFire = d3.scaleLinear()
    .domain([0, d3.max(series, d => d.fire) || 1]).range([H - M.bottom, M.top]);
  const yVpd = d3.scaleLinear()
    .domain([0.5, 2.0]).range([H - M.bottom, M.top]);

  // Fire bars
  chart.append("g").selectAll("rect").data(series).enter().append("rect")
    .attr("x", d => x(d.week))
    .attr("y", d => yFire(d.fire))
    .attr("width", x.bandwidth())
    .attr("height", d => H - M.bottom - yFire(d.fire))
    .attr("fill", "#e0532a").attr("fill-opacity", 0.85);

  // VPD line
  const vpdLine = d3.line()
    .defined(d => d.vpd !== null)
    .x(d => x(d.week) + x.bandwidth() / 2)
    .y(d => yVpd(d.vpd))
    .curve(d3.curveMonotoneX);

  chart.append("path").datum(series).attr("d", vpdLine)
    .attr("fill", "none").attr("stroke", "#c9a23a").attr("stroke-width", 2);

  const tickWeeks = [weeks[0], weeks[Math.floor(weeks.length / 2)], weeks[weeks.length - 1]];
  chart.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${H - M.bottom})`)
    .call(d3.axisBottom(x).tickValues(tickWeeks).tickFormat(d => d.slice(5)));

  panel.append("div").attr("class", "panel-sub")
    .style("text-align", "center").style("margin-top", "0")
    .html(`<span style="color:#e0532a">■</span> fire MW &nbsp; <span style="color:#c9a23a">━</span> VPD kPa`);

  let verdict;
  if (totals.fireCount === 0) {
    verdict = "No fires were detected here in 2024.";
  } else {
    const vpdRank = vpd >= vpdBreaks[1] ? "high" : vpd >= vpdBreaks[0] ? "moderate" : "low";
    verdict = `${totals.name} had a fire-weighted seasonal VPD of <strong>${vpd ? vpd.toFixed(2) : "—"} kPa</strong> — ${vpdRank} relative to other states. ${vpdRank === "high" ? "Dry atmospheric conditions here aligned strongly with elevated fire activity." : vpdRank === "moderate" ? "Atmospheric dryness played a partial role alongside other ignition factors." : "Fire here occurred despite lower atmospheric dryness — other ignition factors dominated."}`;
  }
  panel.append("div").attr("class", "panel-verdict").html(verdict);
}
