"""Quick EDA across all fdcc_YYYY.parquet files."""
import glob
import pandas as pd
import numpy as np

FIRE_MASKS = {10, 11, 13, 14, 30, 31, 33, 34}

frames = []
for path in sorted(glob.glob("fdcc_*.parquet")):
    df = pd.read_parquet(path)
    frames.append(df)
raw = pd.concat(frames, ignore_index=True)

# Drop the one corrupt 2023 timestamp row, restrict to real fire masks
df = raw[(raw.time.dt.year >= 2018) & (raw.Mask.isin(FIRE_MASKS))].copy()
df["year"] = df.time.dt.year
df["month"] = df.time.dt.month
df["date"] = df.time.dt.date

print(f"raw rows: {len(raw):,}  cleaned rows: {len(df):,}")
print(f"years: {sorted(df.year.unique())}")
print()

# 1. Yearly summary
print("=== Yearly fire-pixel totals & intensity ===")
yr = df.groupby("year").agg(
    n_detections=("Power", "size"),
    days_with_fire=("date", "nunique"),
    total_power_GW=("Power", lambda s: s.sum()/1000),
    median_power_MW=("Power", "median"),
    p95_power_MW=("Power", lambda s: s.quantile(0.95)),
    max_power_MW=("Power", "max"),
).round(1)
print(yr)

# 2. Mask code distribution
print("\n=== Detection-type mix by year (% of detections) ===")
m = df.assign(kind=df.Mask.map({
    10: "good", 11: "saturated", 13: "high_prob", 14: "med_prob",
    30: "good_tf", 31: "sat_tf", 33: "high_prob_tf", 34: "med_prob_tf",
}))
print((m.groupby(["year", "kind"]).size().unstack(fill_value=0)
       .div(m.groupby("year").size(), axis=0).mul(100).round(1)))

# 3. Monthly within each year (the "shape" of fire season)
print("\n=== Detections per month, by year ===")
mo = df.groupby(["year", "month"]).size().unstack(fill_value=0)
print(mo)

# 4. Geographic spread — West vs East (split at -100° lon)
print("\n=== West-of-100W vs East-of-100W ===")
df["region"] = np.where(df.lon < -100, "West", "East")
print(df.groupby(["year", "region"]).size().unstack(fill_value=0))

# 5. Roughly state-binning by lat/lon for the West (most fires)
print("\n=== Top lat/lon hotspots: 1-degree cells with most detections ===")
df["lat_bin"] = df.lat.round().astype(int)
df["lon_bin"] = df.lon.round().astype(int)
top_cells = (df.groupby(["lat_bin", "lon_bin"]).size()
             .sort_values(ascending=False).head(15))
print(top_cells)

# 6. Most intense single days across the whole archive
print("\n=== Top 10 single days by total radiative power ===")
daily = df.groupby("date").agg(
    n=("Power", "size"),
    total_power_GW=("Power", lambda s: s.sum()/1000),
    max_power_MW=("Power", "max"),
).sort_values("total_power_GW", ascending=False).head(10)
print(daily.round(1))

# 7. Diurnal isn't applicable (one sample/day) but seasonal timing of peak day each year
print("\n=== Peak fire day of each year ===")
peak = (df.groupby(["year", "date"])["Power"].sum().reset_index()
        .sort_values(["year", "Power"], ascending=[True, False])
        .groupby("year").head(1).reset_index(drop=True))
peak["doy"] = pd.to_datetime(peak["date"]).dt.dayofyear
print(peak.round(1))
