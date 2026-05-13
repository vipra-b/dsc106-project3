"""Generate a plausible mock lightning grid for 2024 fire season.

Schema matches what glm_extract.py produces:
  date, lat_bin, lon_bin, n_flash_sampled, n_flash_est

Climatology baseline (flashes/0.5deg-cell/day, summer):
  Florida peninsula: high (~25-60)
  Gulf coast / SE: moderate (~8-25)
  Plains / Mississippi valley: 5-15
  Mountain West (high terrain): 3-10 spikes, 0 most days
  Desert SW / PNW / Northeast: low (1-5)
"""
import datetime as dt
import numpy as np
import pandas as pd
from pathlib import Path

np.random.seed(42)

LAT_MIN, LAT_MAX = 20.0, 55.0
LON_MIN, LON_MAX = -130.0, -65.0
CELL = 0.5

# Build cell grid
lats = np.arange(LAT_MIN, LAT_MAX, CELL)
lons = np.arange(LON_MIN, LON_MAX, CELL)
lat_grid, lon_grid = np.meshgrid(lats, lons, indexing="ij")


def climatology(lat, lon):
    """Base mean flash count per cell-day in summer."""
    fl = np.exp(-((lat - 28) ** 2) / 30 - ((lon + 82) ** 2) / 40) * 50
    gulf = np.exp(-((lat - 30) ** 2) / 20 - ((lon + 90) ** 2) / 200) * 25
    se = np.exp(-((lat - 34) ** 2) / 60 - ((lon + 88) ** 2) / 600) * 15
    plains = np.exp(-((lat - 38) ** 2) / 80 - ((lon + 98) ** 2) / 500) * 10
    rockies = np.exp(-((lat - 40) ** 2) / 50 - ((lon + 108) ** 2) / 100) * 6
    monsoon = np.exp(-((lat - 33) ** 2) / 25 - ((lon + 110) ** 2) / 60) * 8
    background = 0.5
    base = fl + gulf + se + plains + rockies + monsoon + background
    return base


base_intensity = climatology(lat_grid, lon_grid)
base_intensity *= (1 + np.random.normal(0, 0.1, base_intensity.shape))
base_intensity = np.clip(base_intensity, 0, None)

# Build per-day grid
start = dt.date(2024, 6, 1)
end = dt.date(2024, 10, 31)
days = pd.date_range(start, end).date


def season_modulation(date):
    doy = date.timetuple().tm_yday
    # Peak in mid-July
    return np.exp(-((doy - 200) ** 2) / 3000)


rows = []
for date in days:
    season = season_modulation(date)
    # Different weather days have different lightning levels
    day_factor = np.random.lognormal(0, 0.5)
    cell_factor = np.random.gamma(2, 0.5, size=base_intensity.shape)
    mean_flashes = base_intensity * season * day_factor * cell_factor * 0.7
    flashes = np.random.poisson(mean_flashes)

    # Keep only meaningful cells (>= 3 flashes) so the file stays browser-friendly
    nz_idx = np.argwhere(flashes >= 3)
    for i, j in nz_idx:
        rows.append({
            "date": date,
            "lat_bin": round(float(lats[i]), 2),
            "lon_bin": round(float(lons[j]), 2),
            "n_flash_est": int(flashes[i, j]),
        })

df = pd.DataFrame(rows)
df["lat_bin"] = df["lat_bin"].astype("float32")
df["lon_bin"] = df["lon_bin"].astype("float32")
out = Path("data/lightning_grid_mock_2024.parquet")
out.parent.mkdir(parents=True, exist_ok=True)
df.to_parquet(out, compression="zstd")
df.to_csv("data/lightning_grid_mock_2024.csv", index=False)
print(f"wrote {out}: {len(df):,} rows, {out.stat().st_size/1e3:.1f} KB")
print(f"total mock flashes: {df.n_flash_est.sum():,}")
print(f"date range: {df.date.min()} -> {df.date.max()}")
print(f"unique cells: {df[['lat_bin','lon_bin']].drop_duplicates().shape[0]}")
