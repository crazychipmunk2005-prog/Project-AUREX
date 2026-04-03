# AUREX Landsat Upgrade Steps

This guide upgrades AUREX LST from MODIS (~1km) to Landsat (~30m) monthly composites.

## 1) Run the new Earth Engine export

1. Open https://code.earthengine.google.com/
2. Create a new script and paste:
   - `scripts/gee/export_westcoast_context_landsat_lst_monthly.js`
3. Click **Run**
4. In **Tasks**, start export:
   - `AUREX_westcoast_context_Landsat_LST_2019_2025_monthly_stack_v2`
5. Wait for completion (large export; can take time)

## 2) Download and host the exported COG

1. From Google Drive folder `AUREX_exports`, download:
   - `aurex_westcoast_context_landsat_lst_2019_2025_monthly_stack_v2.tif`
2. Upload to your static data host (R2/GitHub release/x-data)
3. Keep previous MODIS file as fallback/version history

## 3) Point frontend to Landsat stack

In `frontend/src/App.tsx`:

1. Update `COG_URLS.lst` to the new Landsat COG URL
2. Set timeline years:
   - `START_YEAR = 2019`
   - `END_YEAR = 2025`

## 4) Restart app

1. Restart frontend dev server
2. Hard refresh browser (`Ctrl+F5`)
3. Click **ANALYSE** once to preload timeline stops

## 5) Validate expected behavior

- Slider should switch between preloaded stops smoothly
- Local detail should be sharper than MODIS
- Cloudy months may have sparse/no data in some places

## Notes

- Landsat improves spatial detail significantly, but temporal continuity is less uniform than MODIS.
- For mission-critical coverage, keep MODIS as fallback for missing/very cloudy months.
