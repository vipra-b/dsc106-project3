"""Feasibility check: pull one SUVI Fe171 image and render it."""
import os
os.environ.setdefault("MPLBACKEND", "Agg")

import s3fs
from astropy.io import fits
import matplotlib.pyplot as plt
import numpy as np

# Solar maximum: pick May 14, 2024 -- the X8.7 flare day
# day-of-year for 2024-05-14 = 31+29+31+30+14 = 135
prefix = "noaa-goes16/SUVI-L1b-Fe171/2024/135/18/"
fs = s3fs.S3FileSystem(anon=True)

files = sorted([f for f in fs.ls(prefix) if f.endswith(".fits")])
print(f"files in hour 18 on 2024-135 (May 14): {len(files)}")

# Take a file from mid-hour
key = files[len(files)//2]
print(f"using {key}")

with fs.open(key, "rb") as f:
    with fits.open(f) as hdul:
        print("HDUs:", len(hdul))
        for i, h in enumerate(hdul):
            print(f"  HDU {i}: type={type(h).__name__}, data shape={getattr(h.data, 'shape', None)}")
        # SUVI L1b puts science image in HDU[1] typically (or HDU[0])
        for h in hdul:
            if h.data is not None and h.data.ndim == 2:
                img = h.data.astype(float)
                hdr = h.header
                break

print("image shape:", img.shape, "dtype:", img.dtype)
print(f"value range: {np.nanmin(img):.2f} to {np.nanmax(img):.2f}")
print(f"WAVELENGTH (Angstrom) from header:", hdr.get("WAVELNTH"))
print(f"obs time:", hdr.get("DATE-OBS"))

# Standard solar rendering: log scale + sdoaia171 colormap
img_show = np.clip(img, 1, None)
fig, ax = plt.subplots(figsize=(7, 7), facecolor="black")
try:
    import sunpy.visualization.colormaps as cmaps  # noqa
    cmap = plt.get_cmap("sdoaia171")
except Exception:
    cmap = "inferno"
ax.imshow(np.log10(img_show), cmap=cmap, origin="lower")
ax.set_facecolor("black")
ax.set_xticks([]); ax.set_yticks([])
title = f"GOES-16 SUVI Fe171  {hdr.get('DATE-OBS', '')}"
ax.set_title(title, color="white", fontsize=11)
fig.tight_layout()
out = "/Users/viprabindal/dsc106_p3/suvi_sample.png"
fig.savefig(out, dpi=130, facecolor="black")
print(f"wrote {out}")
