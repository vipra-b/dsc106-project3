"""Probe one GLM file — see what's inside."""
import s3fs
import xarray as xr

fs = s3fs.S3FileSystem(anon=True)
files = sorted(fs.ls("noaa-goes16/GLM-L2-LCFA/2024/180/14/"))
key = files[5]
print(f"file: {key.rsplit('/', 1)[-1]}")

with fs.open(key) as f:
    ds = xr.open_dataset(f, engine="h5netcdf")
    ds.load()

print()
print("variables:", list(ds.data_vars))
print()
# GLM files report 3 entity types: events, groups, flashes
# Flashes are the top-level lightning events
print(f"# flashes in this 20-second file: {int(ds.flash_count.values) if 'flash_count' in ds.data_vars else len(ds.flash_id) if 'flash_id' in ds else '?'}")
print(f"# groups: {len(ds.group_id) if 'group_id' in ds else '?'}")
print(f"# events: {len(ds.event_id) if 'event_id' in ds else '?'}")
print()

# Try to print a few flashes with lat/lon/time
if 'flash_lat' in ds.data_vars:
    n = min(5, ds.flash_lat.size)
    for i in range(n):
        t = ds.flash_time_offset_of_first_event.values[i]
        print(f"  flash {i}: lat={float(ds.flash_lat.values[i]):.2f} lon={float(ds.flash_lon.values[i]):.2f} energy={float(ds.flash_energy.values[i]):.2e}")
