"""Build browser-friendly CSV exports: weekly-aggregated fires + lightning, plus joined scatter data."""
import pandas as pd
import numpy as np
from pathlib import Path

OUT = Path("docs/data")
OUT.mkdir(parents=True, exist_ok=True)

# --- load daily grids ---
fires = pd.read_parquet("data/fires_grid_2024.parquet")
fires["date"] = pd.to_datetime(fires["date"])
# Real GLM data (replaces mock)
ltg = pd.read_parquet("data/glm_2024.parquet")
ltg["date"] = pd.to_datetime(ltg["date"])
ltg = ltg.rename(columns={"n_flash_est": "n_flash_est"})

# --- per-fire-day prior-24h-lightning check (daily, precise) ---
# Build lookup: (date, cell) -> flash_count
ltg_lookup = ltg.set_index(["date", "lat_bin", "lon_bin"])["n_flash_est"].to_dict()
def prior_lightning(row):
    d = row["date"]
    key_today = (d, row["lat_bin"], row["lon_bin"])
    key_yest = (d - pd.Timedelta(days=1), row["lat_bin"], row["lon_bin"])
    return ltg_lookup.get(key_today, 0) + ltg_lookup.get(key_yest, 0)

fires["prior_lightning_count"] = fires.apply(prior_lightning, axis=1).astype(int)
fires["had_prior_lightning"] = (fires["prior_lightning_count"] >= 5).astype(int)

# --- weekly aggregation for display ---
fires["week"] = fires["date"].dt.to_period("W-SUN").apply(lambda p: p.start_time.date())
fires_w = (fires.groupby(["week", "lat_bin", "lon_bin"])
                .agg(fire_count=("fire_count", "sum"),
                     fire_power_MW=("fire_power_MW", "sum"),
                     max_power_MW=("max_power_MW", "max"),
                     prior_lightning_count=("prior_lightning_count", "max"),
                     had_prior_lightning=("had_prior_lightning", "max"))
                .reset_index())
fires_w["fire_power_MW"] = fires_w["fire_power_MW"].round(1)
fires_w["max_power_MW"] = fires_w["max_power_MW"].round(1)
fires_w.to_csv(OUT / "fires_weekly_2024.csv", index=False)
print(f"fires_weekly_2024.csv: {len(fires_w):,} rows")

ltg["week"] = ltg["date"].dt.to_period("W-SUN").apply(lambda p: p.start_time.date())
ltg_w = (ltg.groupby(["week", "lat_bin", "lon_bin"])
            .agg(flash_count=("n_flash_est", "sum"))
            .reset_index())
ltg_w = ltg_w[ltg_w.flash_count >= 5]
ltg_w.to_csv(OUT / "lightning_weekly_2024.csv", index=False)
print(f"lightning_weekly_2024.csv: {len(ltg_w):,} rows")

joined = fires_w.copy()
joined.rename(columns={"prior_lightning_count": "flash_count"}, inplace=True)

# Tag region by lon
def region(lon):
    if lon < -114: return "West"
    if lon < -100: return "Mountain/Plains"
    if lon < -85:  return "South-Central"
    return "East"
joined["region"] = joined["lon_bin"].apply(region)

joined.to_csv(OUT / "joined_weekly_2024.csv", index=False)
print(f"joined_weekly_2024.csv: {len(joined):,} rows")
print()
print("Verdict numbers for the headline:")
print(f"  fire-cells total: {len(joined):,}")
print(f"  fire-cells WITH lightning ≥5: {int(joined.had_prior_lightning.sum()):,} "
      f"({100*joined.had_prior_lightning.mean():.1f}%)")
print(f"  fire-cells WITHOUT lightning: {int((1-joined.had_prior_lightning).sum()):,} "
      f"({100*(1-joined.had_prior_lightning).mean():.1f}%)")
print()
print("By region:")
for r, sub in joined.groupby("region"):
    pct = 100 * sub.had_prior_lightning.mean()
    print(f"  {r:20s}  cells={len(sub):4d}  with_lightning={pct:5.1f}%")
