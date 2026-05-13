"""Visualization B: month-by-month fire detection maps + centroid track.

Produces:
  - monthly_maps.png : 5-panel small-multiples (Jun, Jul, Aug, Sep, Oct)
  - centroid_track.png : single-panel CONUS map with the seasonal centroid path
  - monthly_grid.csv : per-(lat_bin, lon_bin, month) detection counts for D3
  - monthly_centroids.csv : per-month centroid + power-weighted centroid
"""
import glob
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
import pandas as pd

FIRE_MASKS = {10, 11, 13, 14, 30, 31, 33, 34}
MONTHS = [(6, "June"), (7, "July"), (8, "August"), (9, "September"), (10, "October")]

frames = [pd.read_parquet(p) for p in sorted(glob.glob("fdcc_*.parquet"))]
df = pd.concat(frames, ignore_index=True)
df = df[(df.time.dt.year >= 2018) & (df.Mask.isin(FIRE_MASKS))].copy()
df["month"] = df.time.dt.month

# CONUS bounding box
us = df[(df.lat >= 25) & (df.lat <= 50) & (df.lon >= -125) & (df.lon <= -66)].copy()
print(f"CONUS detections: {len(us):,}")

# ------ 1. Monthly small-multiples (5 panels) ------
fig, axes = plt.subplots(1, 5, figsize=(20, 4.5), sharey=True)
LON_MIN, LON_MAX = -125, -66
LAT_MIN, LAT_MAX = 25, 50
GRID_LON, GRID_LAT = 60, 25

# Same vmax across panels so colors are comparable
H_all = []
for m, _ in MONTHS:
    mo = us[us.month == m]
    H, _, _ = np.histogram2d(
        mo.lon, mo.lat, bins=[GRID_LON, GRID_LAT],
        range=[[LON_MIN, LON_MAX], [LAT_MIN, LAT_MAX]],
    )
    H_all.append(H)
vmax = np.percentile(np.concatenate([h.flatten() for h in H_all]), 99)

for ax, (m, name), H in zip(axes, MONTHS, H_all):
    im = ax.imshow(
        H.T, origin="lower", extent=[LON_MIN, LON_MAX, LAT_MIN, LAT_MAX],
        cmap="hot_r", vmin=0, vmax=vmax, aspect="auto", interpolation="bilinear",
    )
    mo = us[us.month == m]
    cx = (mo.lon * mo.Power).sum() / mo.Power.sum()
    cy = (mo.lat * mo.Power).sum() / mo.Power.sum()
    ax.plot(cx, cy, "co", markersize=12, markeredgecolor="black", markeredgewidth=1.5)
    ax.set_title(f"{name}  (n={len(mo):,})", fontsize=12)
    ax.set_xlim(LON_MIN, LON_MAX)
    ax.set_ylim(LAT_MIN, LAT_MAX)
    ax.set_xlabel("lon")

axes[0].set_ylabel("lat")
fig.suptitle("GOES-16/19 fire detections by month, pooled 2018-2025 (cyan = power-weighted centroid)", fontsize=13)
fig.tight_layout()
fig.subplots_adjust(top=0.86)
fig.savefig("monthly_maps.png", dpi=140)
print("wrote monthly_maps.png")

# ------ 2. Centroid track on one panel ------
fig2, ax2 = plt.subplots(figsize=(10, 6))
H_total, xedges, yedges = np.histogram2d(
    us.lon, us.lat, bins=[GRID_LON, GRID_LAT],
    range=[[LON_MIN, LON_MAX], [LAT_MIN, LAT_MAX]],
)
ax2.imshow(
    H_total.T, origin="lower", extent=[LON_MIN, LON_MAX, LAT_MIN, LAT_MAX],
    cmap="Greys", aspect="auto", interpolation="bilinear", alpha=0.6,
)
colors = plt.cm.plasma(np.linspace(0.05, 0.85, len(MONTHS)))
cents = []
for (m, name), c in zip(MONTHS, colors):
    mo = us[us.month == m]
    cx = (mo.lon * mo.Power).sum() / mo.Power.sum()
    cy = (mo.lat * mo.Power).sum() / mo.Power.sum()
    cents.append((m, name, cx, cy, len(mo), mo.Power.sum()))
    ax2.plot(cx, cy, "o", color=c, markersize=18, markeredgecolor="black", markeredgewidth=1.5, label=name, zorder=3)

# Draw arrows between consecutive months
for i in range(len(cents) - 1):
    _, _, x1, y1, _, _ = cents[i]
    _, _, x2, y2, _, _ = cents[i + 1]
    ax2.annotate("", xy=(x2, y2), xytext=(x1, y1),
                 arrowprops=dict(arrowstyle="->", color="black", lw=2, alpha=0.7))

ax2.set_xlim(LON_MIN, LON_MAX)
ax2.set_ylim(LAT_MIN, LAT_MAX)
ax2.set_xlabel("longitude")
ax2.set_ylabel("latitude")
ax2.set_title("Power-weighted centroid of CONUS fire detections by month, pooled 2018-2025\n(traveling fire-season)")
ax2.legend(loc="lower left", title="Month", framealpha=0.9)
ax2.grid(True, alpha=0.3)
fig2.tight_layout()
fig2.savefig("centroid_track.png", dpi=140)
print("wrote centroid_track.png")

# ------ 3. Data exports for D3 / Observable ------
us["lat_bin"] = (us.lat * 2).round() / 2
us["lon_bin"] = (us.lon * 2).round() / 2
grid = (us.groupby(["month", "lat_bin", "lon_bin"])
          .agg(n=("Power", "size"), power_MW=("Power", "sum"))
          .reset_index())
grid.to_csv("monthly_grid.csv", index=False)
print(f"wrote monthly_grid.csv ({len(grid):,} cells)")

cdf = pd.DataFrame([
    {"month": m, "month_name": n, "lon_centroid": cx, "lat_centroid": cy,
     "n_detections": cnt, "total_power_MW": tp}
    for (m, n, cx, cy, cnt, tp) in cents
])
cdf.to_csv("monthly_centroids.csv", index=False)
print("wrote monthly_centroids.csv")
print(cdf.round(2))
