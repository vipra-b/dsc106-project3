"""Probe Question B: Where does the fire season travel each year?

Test: does fire activity shift geographically through June -> October?
"""
import glob
import numpy as np
import pandas as pd

FIRE_MASKS = {10, 11, 13, 14, 30, 31, 33, 34}

frames = [pd.read_parquet(p) for p in sorted(glob.glob("fdcc_*.parquet"))]
df = pd.concat(frames, ignore_index=True)
df = df[(df.time.dt.year >= 2018) & (df.Mask.isin(FIRE_MASKS))].copy()
df["month"] = df.time.dt.month
df["year"] = df.time.dt.year

# CONUS-only filter (drop Mexico/Caribbean — keep lat 25-50, lon -125 to -66)
us = df[(df.lat >= 25) & (df.lat <= 50) & (df.lon >= -125) & (df.lon <= -66)].copy()

print(f"All detections (incl. Mexico/Canada): {len(df):,}")
print(f"CONUS-only detections: {len(us):,}")
print()

# === Centroid by month (CONUS) ===
print("=== Monthly centroid of CONUS fire detections (pooled across 8 years) ===")
print(f"{'month':>6}  {'n':>6}  {'lat_mean':>9}  {'lon_mean':>9}  {'lat_med':>8}  {'lon_med':>8}")
for m in [6, 7, 8, 9, 10]:
    mo = us[us.month == m]
    print(f"  {m:>4}  {len(mo):>6}  {mo.lat.mean():>9.2f}  {mo.lon.mean():>9.2f}  "
          f"{mo.lat.median():>8.2f}  {mo.lon.median():>8.2f}")

# === Power-weighted centroid by month ===
print("\n=== Power-weighted centroid by month ===")
print(f"{'month':>6}  {'lat_w':>8}  {'lon_w':>8}")
for m in [6, 7, 8, 9, 10]:
    mo = us[us.month == m]
    if len(mo):
        lat_w = (mo.lat * mo.Power).sum() / mo.Power.sum()
        lon_w = (mo.lon * mo.Power).sum() / mo.Power.sum()
        print(f"  {m:>4}  {lat_w:>8.2f}  {lon_w:>8.2f}")

# === Regional bucket counts by month (intuitive geography) ===
def region(lat, lon):
    if lon < -114 and lat < 38: return "1_SW (CA-S, AZ, NM)"
    if lon < -114 and lat >= 38: return "2_PNW + N. Rockies"
    if -114 <= lon < -100 and lat < 38: return "3_S. Plains/TX"
    if -114 <= lon < -100 and lat >= 38: return "4_N. Plains/CO/MT"
    if -100 <= lon < -85: return "5_Mississippi Valley"
    if lon >= -85: return "6_Southeast"
    return "other"

us["region"] = us.apply(lambda r: region(r.lat, r.lon), axis=1)
print("\n=== Detections by region x month (% within month) ===")
ct = us.groupby(["month", "region"]).size().unstack(fill_value=0)
pct = ct.div(ct.sum(axis=1), axis=0) * 100
print(pct.round(1))

# === Same but power-weighted ===
print("\n=== Total radiative POWER by region x month (% within month) ===")
pw = us.groupby(["month", "region"])["Power"].sum().unstack(fill_value=0)
pct_p = pw.div(pw.sum(axis=1), axis=0) * 100
print(pct_p.round(1))
