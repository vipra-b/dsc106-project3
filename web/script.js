// Lightning vs. Fire — DSC106 Project 3 draft
// D3 v7 + topojson-client

const CELL = 0.5; // degrees

(async function main() {
  const [usTopo, fires, lights, joined] = await Promise.all([
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

  // Sorted unique weeks (used by both sliders)
  const weeks = Array.from(new Set(fires.map(d => d.week))).sort();

  // Each scene wrapped so one failure doesn't take down the others
  for (const [name, fn] of [
    ["Scene 1", () => renderScene1(fires, weeks, usTopo)],
    ["Scene 2", () => renderScene2(fires, lights, weeks, usTopo)],
    ["Scene 3", () => renderScene3(joined)],
  ]) {
    try { fn(); } catch (e) { console.error(`${name} failed:`, e); }
  }
})();

// -------------------------------------------------------------------
// Reusable: build a CONUS state map svg into a container
// -------------------------------------------------------------------
function buildBaseMap(containerId, { width, height }) {
  const container = d3.select("#" + containerId);
  container.selectAll("*").remove();
  const svg = container.append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%")
    .style("height", "100%");
  const projection = d3.geoAlbersUsa().scale(width * 1.3).translate([width / 2, height / 2]);
  const path = d3.geoPath(projection);
  return { svg, projection, path };
}

// -------------------------------------------------------------------
// SCENE 1: fires-only map, time slider, tooltip
// -------------------------------------------------------------------
function renderScene1(fires, weeks, usTopo) {
  const W = 900, H = 520;
  const { svg, projection, path } = buildBaseMap("map1", { width: W, height: H });

  // states
  const states = topojson.feature(usTopo, usTopo.objects.states);
  svg.append("g").selectAll("path").data(states.features).enter()
    .append("path").attr("class", "state-fill").attr("d", path);

  const cellLayer = svg.append("g");

  const tip = d3.select("#tooltip1");

  // Scales
  const allFires = fires.filter(d => projection([d.lon, d.lat]));
  const sizeScale = d3.scaleSqrt().domain([1, d3.max(allFires, d => d.power) || 1]).range([2, 14]);
  const colorScale = d3.scaleSequential(d3.interpolateOrRd).domain([0, d3.max(allFires, d => d.maxPower) || 1]);

  const slider = document.getElementById("week-slider");
  const label = document.getElementById("week-label");
  slider.max = weeks.length - 1;
  // Default to week with most fire activity
  const weekTotals = d3.rollup(allFires, v => d3.sum(v, d => d.power), d => d.week);
  const defaultWeek = d3.greatest(weeks, w => weekTotals.get(w) || 0);
  slider.value = weeks.indexOf(defaultWeek);

  function update() {
    const w = weeks[+slider.value];
    label.textContent = w;
    const wkData = fires.filter(d => d.week === w && projection([d.lon, d.lat]));
    const sel = cellLayer.selectAll("circle").data(wkData, d => `${d.lat},${d.lon}`);
    sel.enter().append("circle")
      .attr("stroke", "#fff").attr("stroke-opacity", 0.25)
      .on("mousemove", function(event, d) {
        tip.style("display", "block")
          .style("left", (event.pageX + 14) + "px")
          .style("top", (event.pageY + 14) + "px")
          .html(`
            <div><strong>${d.lat.toFixed(2)}°N, ${(-d.lon).toFixed(2)}°W</strong></div>
            <div>Week of ${d.week}</div>
            <div>Fire detections: ${d.fires}</div>
            <div>Total power: ${d.power.toLocaleString()} MW</div>
            <div>Peak intensity: ${d.maxPower.toLocaleString()} MW</div>
          `);
      })
      .on("mouseleave", () => tip.style("display", "none"))
      .merge(sel)
      .attr("cx", d => projection([d.lon, d.lat])[0])
      .attr("cy", d => projection([d.lon, d.lat])[1])
      .attr("r", d => sizeScale(d.power))
      .attr("fill", d => colorScale(d.maxPower))
      .attr("fill-opacity", 0.85);
    sel.exit().remove();
  }
  slider.addEventListener("input", update);
  update();
}

// -------------------------------------------------------------------
// SCENE 2: side-by-side fire & lightning maps with shared slider
// -------------------------------------------------------------------
// Bivariate color matrix.  Rows = fire (low/mid/high), Cols = lightning.
// Stevens-style palette adapted: gray (LL) -> red (HL) on the fire axis,
// gray -> blue on the lightning axis, with a deep purple at the corner where both are high.
const BIVARIATE = [
  ["#e8e8e8", "#b3d4e4", "#5ac8c8"], // fire low
  ["#e4acac", "#a5add3", "#5698b9"], // fire mid
  ["#c85a5a", "#985dc8", "#574caf"], // fire high
];

function renderScene2(fires, lights, weeks, usTopo) {
  const W = 720, H = 460;
  const { svg, projection, path } = buildBaseMap("map2-biv", { width: W, height: H });
  const stateFC = topojson.feature(usTopo, usTopo.objects.states);

  // Assign each fire/lightning cell to a state via point-in-polygon (cached).
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

  // Per-week-per-state aggregates (used for the detail panel time series)
  const firePerWeekState = new Map();    // key: "week_state" -> total fire power
  const lightPerWeekState = new Map();   // key: "week_state" -> total flashes
  const priorPerWeekState = new Map();   // key: "week_state" -> sum of prior-day lightning indicator
  const fireCountPerWeekState = new Map(); // key: "week_state" -> # of fire cells

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

  // Per-state totals for the bivariate map color
  const stateTotals = new Map();  // state -> { fire, light, fireCount, priorCount }
  for (const f of stateFC.features) {
    stateTotals.set(f.id, { fire: 0, light: 0, fireCount: 0, priorCount: 0, name: f.properties.name });
  }
  for (const [k, v] of firePerWeekState) {
    const [, st] = k.split("_");
    stateTotals.get(st).fire += v;
  }
  for (const [k, v] of lightPerWeekState) {
    const [, st] = k.split("_");
    if (stateTotals.has(st)) stateTotals.get(st).light += v;
  }
  for (const [k, v] of priorPerWeekState) {
    const [, st] = k.split("_");
    stateTotals.get(st).priorCount += v;
  }
  for (const [k, v] of fireCountPerWeekState) {
    const [, st] = k.split("_");
    stateTotals.get(st).fireCount += v;
  }

  // Bivariate binning: tertiles among states that have ANY fire OR ANY lightning
  const activeStates = [...stateTotals.values()].filter(s => s.fire > 0 || s.light > 0);
  const fireBreaks = [
    d3.quantile(activeStates.map(s => s.fire).sort(d3.ascending), 0.33),
    d3.quantile(activeStates.map(s => s.fire).sort(d3.ascending), 0.66),
  ];
  const lightBreaks = [
    d3.quantile(activeStates.map(s => s.light).sort(d3.ascending), 0.33),
    d3.quantile(activeStates.map(s => s.light).sort(d3.ascending), 0.66),
  ];
  function binFire(v) { return v <= fireBreaks[0] ? 0 : v <= fireBreaks[1] ? 1 : 2; }
  function binLight(v) { return v <= lightBreaks[0] ? 0 : v <= lightBreaks[1] ? 1 : 2; }
  function bivColor(stateRec) {
    if (stateRec.fire === 0 && stateRec.light === 0) return "#1c1c22";
    return BIVARIATE[binFire(stateRec.fire)][binLight(stateRec.light)];
  }

  // Paint state polygons
  const statePaths = svg.append("g").selectAll("path")
    .data(stateFC.features).enter()
    .append("path").attr("class", "state-biv").attr("d", path)
    .attr("fill", d => bivColor(stateTotals.get(d.id)))
    .attr("stroke", "#2c2c33").attr("stroke-width", 0.6)
    .style("cursor", "pointer");

  const tip = d3.select("#tooltip2");

  statePaths
    .on("mousemove", function(event, d) {
      const s = stateTotals.get(d.id);
      tip.style("display", "block")
        .style("left", (event.pageX + 14) + "px")
        .style("top", (event.pageY + 14) + "px")
        .html(`<strong>${s.name}</strong><br>
               Fire power: ${s.fire ? s.fire.toLocaleString(undefined, {maximumFractionDigits:0}) + " MW" : "—"}<br>
               Lightning: ${s.light ? s.light.toLocaleString() + " flashes" : "—"}<br>
               <em>click to see weekly timeline</em>`);
      statePaths.attr("stroke-width", x => x.id === d.id ? 2 : 0.6)
                .attr("stroke", x => x.id === d.id ? "#fff" : "#2c2c33");
    })
    .on("mouseleave", function() {
      tip.style("display", "none");
      statePaths.attr("stroke-width", 0.6).attr("stroke", "#2c2c33");
    })
    .on("click", function(event, d) {
      renderStatePanel(d.id, stateTotals.get(d.id),
                        firePerWeekState, lightPerWeekState,
                        priorPerWeekState, fireCountPerWeekState,
                        weeks);
      statePaths.attr("stroke-width", x => x.id === d.id ? 2.5 : 0.6)
                .attr("stroke", x => x.id === d.id ? "#fff" : "#2c2c33");
    });

  // Bivariate legend (3x3 swatch)
  renderBivLegend(stateTotals, fireBreaks, lightBreaks);
}

// 3x3 legend with axis labels
function renderBivLegend() {
  const container = d3.select("#biv-legend");
  container.selectAll("*").remove();
  const size = 22;
  const svg = container.append("svg").attr("width", 130).attr("height", 110);
  // axis labels first
  svg.append("text").attr("x", 30).attr("y", 12).attr("fill", "#9b9794")
    .style("font-size", "10px").style("text-transform", "uppercase").style("letter-spacing", "1px")
    .text("Lightning →");
  svg.append("text").attr("x", 12).attr("y", 30 + size * 1.5)
    .attr("fill", "#9b9794").attr("transform", "rotate(-90, 12, " + (30 + size * 1.5) + ")")
    .style("font-size", "10px").style("text-transform", "uppercase").style("letter-spacing", "1px")
    .text("Fire →");
  // 3x3 grid (top row = high fire, bottom row = low fire — visually intuitive)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      svg.append("rect")
        .attr("x", 30 + col * size)
        .attr("y", 20 + (2 - row) * size)
        .attr("width", size).attr("height", size)
        .attr("fill", BIVARIATE[row][col])
        .attr("stroke", "#0f0f12").attr("stroke-width", 1);
    }
  }
}

// Render the detail panel for a clicked state
function renderStatePanel(stateId, totals, firePWS, lightPWS, priorPWS, fireCountPWS, weeks) {
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
  rows.append("div").attr("class", "stat-row")
    .html(`<span class="stat-label">Total lightning flashes</span>
           <span class="stat-val light">${totals.light ? totals.light.toLocaleString() : "—"}</span>`);
  rows.append("div").attr("class", "stat-row")
    .html(`<span class="stat-label">Fire cells observed</span>
           <span class="stat-val">${totals.fireCount.toLocaleString()}</span>`);
  rows.append("div").attr("class", "stat-row")
    .html(`<span class="stat-label">Cells <em>with</em> prior-day lightning</span>
           <span class="stat-val">${totals.priorCount.toLocaleString()}</span>`);

  // weekly time series chart
  const W = 280, H = 130, M = { top: 10, right: 16, bottom: 22, left: 30 };
  const chart = panel.append("div").attr("class", "panel-chart")
    .append("svg").attr("viewBox", `0 0 ${W} ${H}`)
    .style("width", "100%").style("height", H + "px");

  const series = weeks.map(w => ({
    week: w,
    fire: firePWS.get(`${w}_${stateId}`) || 0,
    light: lightPWS.get(`${w}_${stateId}`) || 0,
  }));
  const x = d3.scaleBand().domain(weeks).range([M.left, W - M.right]).padding(0.1);
  const yFire = d3.scaleLinear()
    .domain([0, d3.max(series, d => d.fire) || 1])
    .range([H - M.bottom, M.top]);
  const yLight = d3.scaleLinear()
    .domain([0, d3.max(series, d => d.light) || 1])
    .range([H - M.bottom, M.top]);

  // Fire bars (orange)
  chart.append("g").selectAll("rect").data(series).enter().append("rect")
    .attr("x", d => x(d.week))
    .attr("y", d => yFire(d.fire))
    .attr("width", x.bandwidth())
    .attr("height", d => H - M.bottom - yFire(d.fire))
    .attr("fill", "#e0532a").attr("fill-opacity", 0.85);
  // Lightning line (yellow)
  const line = d3.line()
    .x(d => x(d.week) + x.bandwidth() / 2)
    .y(d => yLight(d.light))
    .curve(d3.curveMonotoneX);
  chart.append("path").datum(series).attr("d", line)
    .attr("fill", "none").attr("stroke", "#f0c419").attr("stroke-width", 2);

  // Tick labels: first / mid / last
  const tickWeeks = [weeks[0], weeks[Math.floor(weeks.length / 2)], weeks[weeks.length - 1]];
  chart.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${H - M.bottom})`)
    .call(d3.axisBottom(x).tickValues(tickWeeks).tickFormat(d => d.slice(5)));

  // Axis labels in panel
  panel.append("div").attr("class", "panel-sub")
    .style("text-align", "center").style("margin-top", "0")
    .html(`<span style="color:#e0532a">■</span> fire MW &nbsp; <span style="color:#f0c419">━</span> lightning flashes`);

  // Verdict sentence
  let verdict;
  if (totals.fireCount === 0) {
    verdict = "No fires were detected here in 2024.";
  } else if (pctNoPrior >= 70) {
    verdict = `Of ${totals.fireCount} fire cells in ${totals.name}, only ${totals.priorCount} had lightning within 24 hours before. <strong>${pctNoPrior}% had no lightning preceding them.</strong>`;
  } else {
    verdict = `Of ${totals.fireCount} fire cells in ${totals.name}, ${totals.priorCount} had prior-day lightning — ${100 - pctNoPrior}% had a lightning antecedent.`;
  }
  panel.append("div").attr("class", "panel-verdict").html(verdict);
}

// -------------------------------------------------------------------
// SCENE 3: scatter with brush, region filter, headline number, bars
// -------------------------------------------------------------------
function renderScene3(joined) {
  const W = 900, H = 380, M = { top: 20, right: 24, bottom: 50, left: 60 };
  const svg = d3.select("#scatter").append("svg")
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
    .append("text").attr("x", -H / 2).attr("y", -42)
    .attr("transform", "rotate(-90)").attr("fill", "currentColor")
    .attr("text-anchor", "middle").style("font-size", "12px")
    .text("Total fire radiative power (MW, log scale)");

  // Jitter X for points stacked at 0
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

    // Headline number = fraction with NO prior lightning
    const noL = data.filter(d => d.priorLightning < 5).length;
    const pct = data.length ? Math.round(100 * noL / data.length) : 0;
    d3.select("#headline-num").text(`${pct}%`);

    drawBars(data);
  }

  // Brush on x
  const brush = d3.brushX()
    .extent([[M.left, M.top], [W - M.right, H - M.bottom]])
    .on("end", (event) => {
      if (!event.selection) { xRange = x.domain(); }
      else { xRange = event.selection.map(x.invert); }
      draw();
    });
  svg.append("g").attr("class", "brush").call(brush);

  d3.selectAll(".region-btn").on("click", function() {
    d3.selectAll(".region-btn").classed("active", false);
    d3.select(this).classed("active", true);
    activeRegion = this.dataset.region;
    draw();
  });

  function drawBars(data) {
    const barsSvg = d3.select("#region-bars").selectAll("svg").data([null]);
    const bsv = barsSvg.enter().append("svg")
      .attr("viewBox", `0 0 ${W} 180`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%").style("height", "100%")
      .merge(barsSvg);

    const regions = ["West", "Mountain/Plains", "South-Central", "East"];
    const summary = regions.map(r => {
      const sub = data.filter(d => d.region === r);
      const noL = sub.filter(d => d.priorLightning < 5).length;
      return { region: r, n: sub.length, pctNoLight: sub.length ? noL / sub.length : 0 };
    });

    const xb = d3.scaleBand().domain(regions).range([M.left, W - M.right]).padding(0.2);
    const yb = d3.scaleLinear().domain([0, 1]).range([140, 20]);

    let g = bsv.selectAll("g.bars-root").data([null]);
    g = g.enter().append("g").attr("class", "bars-root").merge(g);
    const bars = g.selectAll("rect").data(summary, d => d.region);
    bars.enter().append("rect").merge(bars)
      .attr("x", d => xb(d.region))
      .attr("y", d => yb(d.pctNoLight))
      .attr("width", xb.bandwidth())
      .attr("height", d => 140 - yb(d.pctNoLight))
      .attr("fill", d => regionColor(d.region))
      .attr("fill-opacity", 0.9);
    bars.exit().remove();

    const labels = g.selectAll("text.region-label").data(summary, d => d.region);
    labels.enter().append("text").attr("class", "region-label")
      .attr("text-anchor", "middle").attr("fill", "#e8e6e1").style("font-size", "12px")
      .merge(labels)
      .attr("x", d => xb(d.region) + xb.bandwidth() / 2)
      .attr("y", d => yb(d.pctNoLight) - 6)
      .text(d => `${Math.round(d.pctNoLight * 100)}%`);
    labels.exit().remove();

    const names = g.selectAll("text.region-name").data(summary, d => d.region);
    names.enter().append("text").attr("class", "region-name")
      .attr("text-anchor", "middle").attr("fill", "#9b9794").style("font-size", "11px")
      .merge(names)
      .attr("x", d => xb(d.region) + xb.bandwidth() / 2)
      .attr("y", 160)
      .text(d => `${d.region}  (n=${d.n})`);
    names.exit().remove();

    const title = g.selectAll("text.bars-title").data([null]);
    title.enter().append("text").attr("class", "bars-title")
      .attr("x", M.left).attr("y", 14).attr("fill", "#9b9794").style("font-size", "11px")
      .merge(title).text("% of fire cells WITHOUT prior-day lightning, by region");
  }

  draw();
}
