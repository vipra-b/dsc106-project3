# DSC 106 Project 3 — Lightning Doesn't Light Most U.S. Wildfires

An interactive visualization that tests a common public belief about wildfire
causes against NOAA satellite data.

**Proposition:** "Lightning causes most U.S. wildfires." → **Probably not.**

## Data

- **GOES-16 ABI-L2-FDCC** — fire detection pixels, June–October 2018–2025.
  One snapshot per day at 20:00 UTC, aggregated to 0.5° cells.
- **GOES-16 GLM-L2-LCFA** — lightning flash detections. (Mock data in this
  draft while the real extract finishes.)

Both products are public on AWS Open Data (`s3://noaa-goes16/`).

## Layout

```
docs/                Static viz (deploy this to Pages)
data/               Source parquets + intermediate CSVs
*.py                Reproducible extractors / aggregators
```

## Local preview

```sh
cd docs && python3 -m http.server 8765
# then open http://localhost:8765/
```

## Scenes

1. **Where America burned in 2024** — fire map, time slider, hover tooltip
2. **Where lightning happens vs. where fires happen** — bivariate choropleth;
   click any state to open the weekly fire vs. lightning timeline
3. **The verdict** — scatter of fire-cells by prior-24h lightning, headline
   number that updates with the brush and region filter
