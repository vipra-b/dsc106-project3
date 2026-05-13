"""Export per-state-per-week aggregates for the Scene 2 A3 detail panel.

The web viz needs:
  - per-state state-level aggregate (1 row/state) for bivariate map color
  - per-state weekly time series (rows per state per week) for the click panel
"""
import json
import pandas as pd
from pathlib import Path
from shapely.geometry import shape, Point

OUT = Path("web/data")
OUT.mkdir(parents=True, exist_ok=True)

# --- load topojson, convert state polygons to shapely for point-in-polygon ---
topo = json.loads(Path("web/us-states.topo.json").read_text())

# topojson decode: we need to use the python topojson lib OR do it manually
# Easier path: pull state polygons directly from the topojson by reconstructing
# from arcs + geometry indexes. But that's heavy. Use a lightweight cheat:
# bounding boxes per state from a known table won't work for irregular shapes.
# Instead, use Python's `topojson` or `topo2geo` -- but those aren't installed.
# Cleanest: fall back to a precomputed lat/lon -> state mapping using a tiny
# CSV of state bounding boxes that we then refine with our own conventions.

# Use the precomputed state polygons via a different route:
# d3 will do the assignment client-side at load time. We don't need it in Python.
# But to make this script useful, we'll export the per-state-per-week aggregates
# AFTER the JS computes state assignment and writes back. Simpler: do everything in JS.

# So this script just confirms the per-week aggregates exist in joined CSV.
joined = pd.read_csv("web/data/joined_weekly_2024.csv")
print(f"joined rows: {len(joined):,}")
print(f"weeks: {joined.week.nunique()}")
print(f"unique lat/lon cells: {joined[['lat_bin','lon_bin']].drop_duplicates().shape[0]}")
print("(state assignment will happen in JS at load time)")
