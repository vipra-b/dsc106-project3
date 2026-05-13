"""Aggregate FDCC fire pixels to (date, 0.5-degree cell) for join with GLM grid."""
import argparse
import glob
import sys
from pathlib import Path

import numpy as np
import pandas as pd

FIRE_MASKS = {10, 11, 13, 14, 30, 31, 33, 34}
CELL_DEG = 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--in", dest="inp", default=None, help="parquet to aggregate (default data/fdcc_<year>.parquet)")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    inp = args.inp or f"data/fdcc_{args.year}.parquet"
    df = pd.read_parquet(inp)
    # Real fires only, this year only
    df = df[df.Mask.isin(FIRE_MASKS) & (df.time.dt.year == args.year)].copy()
    df["date"] = df.time.dt.date
    df["lat_bin"] = (df.lat // CELL_DEG) * CELL_DEG
    df["lon_bin"] = (df.lon // CELL_DEG) * CELL_DEG

    grid = (df.groupby(["date", "lat_bin", "lon_bin"])
              .agg(fire_count=("Power", "size"),
                   fire_power_MW=("Power", "sum"),
                   max_temp_K=("Temp", "max"),
                   max_power_MW=("Power", "max"))
              .reset_index())
    grid["lat_bin"] = grid["lat_bin"].astype("float32")
    grid["lon_bin"] = grid["lon_bin"].astype("float32")
    grid["fire_count"] = grid["fire_count"].astype("int32")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    grid.to_parquet(args.out, compression="zstd")
    print(f"wrote {args.out}: {len(grid):,} rows, {args.out.stat().st_size/1e3:.1f} KB")
    print(f"  dates: {grid.date.min()} -> {grid.date.max()}")
    print(f"  unique cells: {grid[['lat_bin','lon_bin']].drop_duplicates().shape[0]}")
    print(f"  total fire detections: {grid.fire_count.sum():,}")


if __name__ == "__main__":
    main()
