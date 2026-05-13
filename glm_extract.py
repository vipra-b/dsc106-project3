"""Stream GOES-16 GLM lightning files and aggregate flash counts to a daily CONUS grid.

Strategy: stride through GLM files (default 1 file per 5 minutes), filter each
to CONUS, bin to 0.5-degree cells. Per-cell counts get scaled by the inverse
sampling rate so the totals approximate full coverage.
"""
import argparse
import datetime as dt
import io
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
import s3fs
import xarray as xr

BUCKET = "noaa-goes16"
PRODUCT = "GLM-L2-LCFA"

LAT_MIN, LAT_MAX = 20.0, 55.0
LON_MIN, LON_MAX = -130.0, -65.0
CELL_DEG = 0.5
STRIDE_FILES_PER_HOUR = 12  # 180 = full cadence (every 20 s); 12 = every 5 min


def list_hour(fs, year, doy, hour):
    prefix = f"{BUCKET}/{PRODUCT}/{year}/{doy:03d}/{hour:02d}/"
    try:
        files = sorted(fs.ls(prefix))
        return [f for f in files if f.endswith(".nc")]
    except FileNotFoundError:
        return []


def stride_files(all_files, n_keep):
    if not all_files:
        return []
    if n_keep >= len(all_files):
        return all_files
    idx = np.linspace(0, len(all_files) - 1, n_keep).round().astype(int)
    return [all_files[i] for i in sorted(set(idx))]


def process_file(fs, key):
    """Return DataFrame of CONUS flashes: (date, lat_bin, lon_bin) counts."""
    with fs.open(key, "rb") as f:
        buf = f.read()
    ds = xr.open_dataset(io.BytesIO(buf), engine="h5netcdf")
    if ds.flash_lat.size == 0:
        ds.close()
        return None
    lat = ds.flash_lat.values
    lon = ds.flash_lon.values
    t = ds.flash_time_offset_of_first_event.values
    ds.close()
    mask = (lat >= LAT_MIN) & (lat <= LAT_MAX) & (lon >= LON_MIN) & (lon <= LON_MAX)
    if not mask.any():
        return None
    lat = lat[mask]; lon = lon[mask]; t = t[mask]
    date = pd.to_datetime(t).date
    lat_bin = (lat // CELL_DEG) * CELL_DEG
    lon_bin = (lon // CELL_DEG) * CELL_DEG
    return pd.DataFrame({"date": date, "lat_bin": lat_bin.astype("float32"),
                         "lon_bin": lon_bin.astype("float32")})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--start", default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--workers", type=int, default=24)
    ap.add_argument("--stride-per-hour", type=int, default=STRIDE_FILES_PER_HOUR)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    start = dt.date.fromisoformat(args.start) if args.start else dt.date(args.year, 6, 1)
    end = dt.date.fromisoformat(args.end) if args.end else dt.date(args.year, 10, 31)

    fs = s3fs.S3FileSystem(anon=True)

    # Build list of all files to fetch across the full date range
    print("listing files ...", flush=True)
    all_keys = []
    d = start
    while d <= end:
        doy = d.timetuple().tm_yday
        for hour in range(24):
            files = list_hour(fs, args.year, doy, hour)
            kept = stride_files(files, args.stride_per_hour)
            all_keys.extend(kept)
        d += dt.timedelta(days=1)
    print(f"total files to fetch: {len(all_keys):,}", flush=True)

    t0 = time.time()
    rows = []
    done = 0
    flashes_total = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(process_file, fs, k): k for k in all_keys}
        for fut in as_completed(futures):
            done += 1
            try:
                df = fut.result()
            except Exception:
                df = None
            if df is not None and len(df):
                rows.append(df)
                flashes_total += len(df)
            if done % 200 == 0 or done == len(all_keys):
                el = time.time() - t0
                rate = done / max(el, 1e-3)
                eta = (len(all_keys) - done) / rate
                sys.stdout.write(
                    f"\r{done:,}/{len(all_keys):,}  "
                    f"flashes_so_far={flashes_total:,}  "
                    f"ETA {eta:5.0f}s  ({rate:.1f}/s)   "
                )
                sys.stdout.flush()
    print()

    if not rows:
        print("no flashes captured", file=sys.stderr); sys.exit(1)
    big = pd.concat(rows, ignore_index=True)
    print(f"raw CONUS flashes (sampled): {len(big):,}")

    grid = (big.groupby(["date", "lat_bin", "lon_bin"]).size()
             .rename("n_flash_sampled").reset_index())
    # Scale up to estimate full-cadence flash counts (since we sampled 1 per 5 min)
    grid["n_flash_est"] = (grid["n_flash_sampled"] * (180 // args.stride_per_hour)).astype("int32")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    grid.to_parquet(args.out, compression="zstd")
    print(f"wrote {args.out} ({len(grid):,} rows, {args.out.stat().st_size/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
