#!/usr/bin/env python3
"""Extract GOES-16 ABI-L2-FDCC fire-detection pixels to Parquet.

One snapshot per day at a chosen UTC hour, across a date range.
Default window is the CONUS fire season: June 1 -> October 31.
"""
import argparse
import datetime as dt
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
import pyproj
import s3fs
import xarray as xr

DEFAULT_BUCKET = "noaa-goes16"
PRODUCT = "ABI-L2-FDCC"

FIRE_COLS = ["time", "y", "x", "lat", "lon", "Mask", "Temp", "Power", "Area", "source_file"]


def make_lonlat_transformer(ds):
    p = ds["goes_imager_projection"]
    crs_geos = pyproj.CRS.from_cf({
        "grid_mapping_name": "geostationary",
        "perspective_point_height": float(p.perspective_point_height),
        "longitude_of_projection_origin": float(p.longitude_of_projection_origin),
        "sweep_angle_axis": str(p.sweep_angle_axis),
        "semi_major_axis": float(p.semi_major_axis),
        "semi_minor_axis": float(p.semi_minor_axis),
    })
    h = float(p.perspective_point_height)
    return pyproj.Transformer.from_crs(crs_geos, "EPSG:4326", always_xy=True), h


def extract_fire_pixels(ds, source_key):
    power = ds["Power"]
    valid = power.notnull().values
    if not valid.any():
        return pd.DataFrame(columns=FIRE_COLS)

    ys, xs = np.where(valid)
    y_rad = ds["y"].values[ys]
    x_rad = ds["x"].values[xs]

    transformer, h = make_lonlat_transformer(ds)
    lon, lat = transformer.transform(x_rad * h, y_rad * h)

    t = pd.to_datetime(ds["t"].values)
    return pd.DataFrame({
        "time": t,
        "y": y_rad.astype("float32"),
        "x": x_rad.astype("float32"),
        "lat": lat.astype("float32"),
        "lon": lon.astype("float32"),
        "Mask": ds["Mask"].values[ys, xs].astype("int16"),
        "Temp": ds["Temp"].values[ys, xs].astype("float32"),
        "Power": power.values[ys, xs].astype("float32"),
        "Area": ds["Area"].values[ys, xs].astype("float32"),
        "source_file": source_key,
    })


def process_one_day(fs, bucket, year, doy, hour):
    prefix = f"{bucket}/{PRODUCT}/{year}/{doy:03d}/{hour:02d}/"
    try:
        files = sorted(fs.ls(prefix))
    except FileNotFoundError:
        return None, "no-prefix"
    if not files:
        return None, "empty"
    key = files[0]
    with fs.open(key) as f:
        ds = xr.open_dataset(f, engine="h5netcdf")
        ds.load()
    return extract_fire_pixels(ds, key), None


def daterange(year, start_date, end_date):
    d = start_date
    while d <= end_date:
        yield d
        d += dt.timedelta(days=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--start", default=None, help="YYYY-MM-DD; default <year>-06-01")
    ap.add_argument("--end", default=None, help="YYYY-MM-DD; default <year>-10-31")
    ap.add_argument("--hour", type=int, default=20, help="UTC hour (default 20)")
    ap.add_argument("--workers", type=int, default=24, help="parallel S3 workers")
    ap.add_argument("--bucket", default=DEFAULT_BUCKET, help="S3 bucket (default noaa-goes16)")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    start = dt.date.fromisoformat(args.start) if args.start else dt.date(args.year, 6, 1)
    end = dt.date.fromisoformat(args.end) if args.end else dt.date(args.year, 10, 31)

    fs = s3fs.S3FileSystem(anon=True)
    dates = list(daterange(args.year, start, end))
    n_days = len(dates)
    t0 = time.time()
    frames = []
    n_ok = n_empty = n_err = 0
    total_px = 0

    def task(date):
        doy = date.timetuple().tm_yday
        return date, doy, process_one_day(fs, args.bucket, args.year, doy, args.hour)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(task, d): d for d in dates}
        for i, fut in enumerate(as_completed(futures), 1):
            d = futures[fut]
            try:
                date, doy, (df, _reason) = fut.result()
            except Exception as e:
                n_err += 1
                print(f"\n  ! {d}: {e}", file=sys.stderr)
                continue
            if df is None:
                n_empty += 1
            else:
                n_ok += 1
                total_px += len(df)
                if len(df):
                    frames.append(df)
            elapsed = time.time() - t0
            rate = i / elapsed if elapsed > 0 else 0
            eta = (n_days - i) / rate if rate > 0 else 0
            sys.stdout.write(
                f"\rok={n_ok} empty={n_empty} err={n_err}  "
                f"px={total_px:,}  {i}/{n_days}  ETA {eta:5.0f}s   "
            )
            sys.stdout.flush()

    print()
    if not frames:
        print("no fire pixels extracted", file=sys.stderr)
        sys.exit(1)
    out = pd.concat(frames, ignore_index=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(args.out, compression="zstd")
    sz_mb = args.out.stat().st_size / 1e6
    print(
        f"wrote {len(out):,} rows to {args.out} ({sz_mb:.2f} MB) "
        f"covering {out['time'].min()} -> {out['time'].max()}"
    )


if __name__ == "__main__":
    main()
