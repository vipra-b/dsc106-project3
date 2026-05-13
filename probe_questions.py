"""Stress-test a few candidate research questions to see if the data backs them."""
import glob
import numpy as np
import pandas as pd

FIRE_MASKS = {10, 11, 13, 14, 30, 31, 33, 34}

frames = [pd.read_parquet(p) for p in sorted(glob.glob("fdcc_*.parquet"))]
df = pd.concat(frames, ignore_index=True)
df = df[(df.time.dt.year >= 2018) & (df.Mask.isin(FIRE_MASKS))].copy()
df["year"] = df.time.dt.year
df["date"] = df.time.dt.date

# === Q1: How concentrated is fire impact?  (Pareto / heavy tail) ===
print("=== Q1: Concentration of total radiative power ===")
for y in sorted(df.year.unique()):
    yp = df[df.year == y].Power.sort_values(ascending=False).values
    tot = yp.sum()
    if tot == 0:
        continue
    n = len(yp)
    top1 = yp[: max(1, n // 100)].sum() / tot * 100
    top5 = yp[: max(1, n // 20)].sum() / tot * 100
    top10 = yp[: max(1, n // 10)].sum() / tot * 100
    print(f"  {y}: top-1% of detections = {top1:5.1f}% of power | top-5% = {top5:5.1f}% | top-10% = {top10:5.1f}%")

# === Q2: How concentrated is fire impact IN TIME? ===
print("\n=== Q2: What fraction of seasonal power comes from the worst N days? ===")
for y in sorted(df.year.unique()):
    daily = df[df.year == y].groupby("date").Power.sum().sort_values(ascending=False)
    tot = daily.sum()
    if tot == 0: continue
    print(f"  {y}: worst 1 day = {daily.iloc[0]/tot*100:4.1f}% | worst 3 days = {daily.head(3).sum()/tot*100:4.1f}% | worst 7 days = {daily.head(7).sum()/tot*100:4.1f}% | (of {len(daily)} fire-days)")

# === Q3: Are GOES "fires" actually wildfires? Persistence test. ===
# A persistent thermal source (industrial flare, oil platform, refinery) will
# appear on most days of the season. A real wildfire appears on a few days.
print("\n=== Q3: Persistence of detection cells (industrial vs. wildfire) ===")
df["lat_q"] = (df.lat * 4).round() / 4   # 0.25 deg ~ 25 km cells
df["lon_q"] = (df.lon * 4).round() / 4
cell_persistence = (df.groupby(["lat_q", "lon_q"])["date"]
                    .nunique().sort_values(ascending=False))
print(f"  total 0.25-deg cells with any detection: {len(cell_persistence):,}")
print(f"  cells appearing on >= 200 of ~1200 fire-days (persistent sources): {(cell_persistence >= 200).sum()}")
print(f"  cells appearing on >= 500 fire-days (near-daily, almost certainly industrial): {(cell_persistence >= 500).sum()}")
print()
print("  Top 10 most-persistent cells (likely flares/refineries, not wildfires):")
print(cell_persistence.head(10))
print()
# what % of all detections come from cells that appear on >=200 days?
persistent_cells = set(cell_persistence[cell_persistence >= 200].index)
df["is_persistent"] = list(zip(df.lat_q, df.lon_q))
df["is_persistent"] = df["is_persistent"].isin(persistent_cells)
share = df.is_persistent.mean() * 100
print(f"  share of ALL detections from persistent (>=200 day) cells: {share:.1f}%")
print(f"  share of total POWER from persistent cells: {df[df.is_persistent].Power.sum()/df.Power.sum()*100:.1f}%")

# === Q4: Big-fire dominance — do a few mega-events drive each season? ===
# Cluster detections that are within 0.5 deg + within 3 days using a simple
# transitive grouping (we'll approximate with grid+window for speed).
print("\n=== Q4: Mega-fire dominance (rough multi-day cluster proxy) ===")
df["lat_c"] = (df.lat * 2).round() / 2
df["lon_c"] = (df.lon * 2).round() / 2
df["week"] = pd.to_datetime(df.date).dt.to_period("W")
clusters = (df.groupby(["year", "lat_c", "lon_c", "week"])
              .agg(n=("Power", "size"), p=("Power", "sum")).reset_index())
for y in sorted(df.year.unique()):
    yc = clusters[clusters.year == y].sort_values("p", ascending=False)
    if len(yc) == 0: continue
    tot_p = yc.p.sum()
    top10 = yc.head(10).p.sum() / tot_p * 100
    print(f"  {y}: top 10 (cell x week) clusters = {top10:4.1f}% of total power | top 1 cluster = {yc.iloc[0].p/tot_p*100:4.1f}%")
