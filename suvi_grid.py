"""Year-grid: one Fe171 image per year 2019-2025.

Pre-2023 SUVI files are NetCDF only (.nc); 2023+ also FITS. We read both.
2025: GOES-19 (GOES-16 retired April 2025).
"""
import os
os.environ.setdefault("MPLBACKEND", "Agg")
import io
import numpy as np
import s3fs
import xarray as xr
from astropy.io import fits
from astropy.visualization import AsinhStretch, ImageNormalize, PercentileInterval
import matplotlib.pyplot as plt
import sunpy.visualization.colormaps  # registers sdoaia171

# (year, bucket, day-of-year-to-try-first)
TARGETS = [
    (2019, "noaa-goes16", 200),
    (2020, "noaa-goes16", 200),
    (2021, "noaa-goes16", 200),
    (2022, "noaa-goes16", 200),
    (2023, "noaa-goes16", 200),
    (2024, "noaa-goes16", 200),
    (2025, "noaa-goes19", 200),
]
HOUR_TRY = [18, 17, 19, 16, 20, 15, 12]

fs = s3fs.S3FileSystem(anon=True)


def first_image_for_year(year, bucket, doy_start, tries=15):
    for d in range(doy_start, doy_start + tries):
        for h in HOUR_TRY:
            prefix = f"{bucket}/SUVI-L1b-Fe171/{year}/{d:03d}/{h:02d}/"
            try:
                contents = fs.ls(prefix)
            except FileNotFoundError:
                continue
            nc = sorted([c for c in contents if c.endswith(".nc")])
            ft = sorted([c for c in contents if c.endswith(".fits")])
            for key in (ft + nc):
                try:
                    img, hdr = read_suvi(key)
                    if img is not None:
                        return img, hdr, key
                except Exception:
                    continue
    return None, None, None


def read_suvi(s3_key):
    with fs.open(s3_key, "rb") as f:
        buf = f.read()
    if s3_key.endswith(".fits"):
        with fits.open(io.BytesIO(buf)) as hdul:
            for h in hdul:
                if h.data is not None and h.data.ndim == 2:
                    return h.data.astype(float), dict(h.header)
    else:
        ds = xr.open_dataset(io.BytesIO(buf), engine="h5netcdf")
        for v in ds.data_vars:
            arr = ds[v]
            if arr.ndim == 2:
                hdr = {"DATE-OBS": str(ds.attrs.get("time_coverage_start", "")),
                       "WAVELNTH": ds.attrs.get("wavelength", "")}
                return arr.values.astype(float), hdr
    return None, None


results = []
for year, bucket, doy in TARGETS:
    img, hdr, key = first_image_for_year(year, bucket, doy)
    if img is None:
        print(f"{year}: NO image found")
        results.append((year, None, ""))
    else:
        date = hdr.get("DATE-OBS", "")[:10]
        print(f"{year}: shape={img.shape} range=[{np.nanmin(img):.1f}, {np.nanmax(img):.1f}]  {date}  {bucket}")
        results.append((year, img, date))

cmap = plt.get_cmap("sdoaia171")
fig, axes = plt.subplots(1, len(results), figsize=(3 * len(results), 3.4), facecolor="black")
if len(results) == 1: axes = [axes]
for ax, (year, img, date) in zip(axes, results):
    ax.set_facecolor("black"); ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values(): s.set_visible(False)
    if img is None:
        ax.text(0.5, 0.5, f"{year}\n(no data)", color="white", ha="center", va="center", transform=ax.transAxes)
        continue
    norm = ImageNormalize(img, interval=PercentileInterval(99.7), stretch=AsinhStretch(0.03))
    ax.imshow(img, cmap=cmap, origin="lower", norm=norm)
    ax.set_title(f"{year}\n{date}", color="white", fontsize=11)

fig.suptitle("The Sun, mid-July of each year — Solar Cycle 25 rising  (GOES SUVI Fe171, 17.1 nm corona)",
             color="white", fontsize=13)
fig.tight_layout()
fig.subplots_adjust(top=0.82)
out = "/Users/viprabindal/dsc106_p3/suvi_year_grid.png"
fig.savefig(out, dpi=130, facecolor="black")
print(f"\nwrote {out}")
