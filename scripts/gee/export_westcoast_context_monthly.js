// AUREX static export script
// Scope: Kerala + Lakshadweep + context buffer
// Output: 72-band monthly stacks for LST and NDVI (2019-01 .. 2024-12)

var START_YEAR = 2019;
var END_YEAR = 2024;
var EXPORT_SCALE_LST = 1000;
var EXPORT_SCALE_NDVI = 1000;
var EXPORT_CRS = 'EPSG:4326';

// Administrative boundaries (GAUL level1)
var indiaL1 = ee.FeatureCollection('FAO/GAUL/2015/level1')
  .filter(ee.Filter.eq('ADM0_NAME', 'India'));

var kerala = indiaL1.filter(ee.Filter.eq('ADM1_NAME', 'Kerala')).geometry();
var lakshadweep = indiaL1.filter(ee.Filter.eq('ADM1_NAME', 'Lakshadweep')).geometry();

// Context extension into neighboring states + offshore context
var contextStates = indiaL1
  .filter(ee.Filter.inList('ADM1_NAME', ['Karnataka', 'Tamil Nadu']))
  .geometry();

var keralaBuffer = kerala.buffer(25000); // 25 km contextual land continuity
var offshoreContext = kerala.buffer(150000); // Arabian Sea context zone

var studyArea = ee.Geometry(
  kerala
    .union(lakshadweep)
    .union(keralaBuffer.intersection(contextStates, 1))
    .union(offshoreContext)
).dissolve();

Map.centerObject(kerala, 7);
Map.addLayer(studyArea, {color: 'cyan'}, 'AUREX Study Area');

var lstCol = ee.ImageCollection('MODIS/061/MOD11A2');
var ndviCol = ee.ImageCollection('MODIS/061/MOD13A2');

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function monthPairs(startYear, endYear) {
  var out = [];
  for (var y = startYear; y <= endYear; y++) {
    for (var m = 1; m <= 12; m++) {
      out.push({year: y, month: m});
    }
  }
  return out;
}

function monthlyLST(year, month, region) {
  var start = ee.Date.fromYMD(year, month, 1);
  var end = start.advance(1, 'month');

  return lstCol
    .filterDate(start, end)
    .filterBounds(region)
    .select('LST_Day_1km')
    .mean()
    .multiply(0.02)
    .subtract(273.15)
    .clip(region)
    .rename('LST_' + year + '_' + pad2(month))
    .toFloat();
}

function monthlyNDVI(year, month, region) {
  var start = ee.Date.fromYMD(year, month, 1);
  var end = start.advance(1, 'month');

  return ndviCol
    .filterDate(start, end)
    .filterBounds(region)
    .select('NDVI')
    .mean()
    .multiply(0.0001)
    .clip(region)
    .rename('NDVI_' + year + '_' + pad2(month))
    .toFloat();
}

function buildStack(metric, region) {
  var pairs = monthPairs(START_YEAR, END_YEAR);
  var images = pairs.map(function(pair) {
    return metric === 'LST'
      ? monthlyLST(pair.year, pair.month, region)
      : monthlyNDVI(pair.year, pair.month, region);
  });
  return ee.ImageCollection(images).toBands();
}

var lstStack = buildStack('LST', studyArea);
var ndviStack = buildStack('NDVI', studyArea);

Export.image.toDrive({
  image: lstStack,
  description: 'AUREX_westcoast_context_LST_2019_2024_monthly_stack_v1',
  folder: 'AUREX_exports',
  fileNamePrefix: 'aurex_westcoast_context_lst_2019_2024_monthly_stack_v1',
  region: studyArea,
  scale: EXPORT_SCALE_LST,
  crs: EXPORT_CRS,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF',
  formatOptions: {cloudOptimized: true}
});

Export.image.toDrive({
  image: ndviStack,
  description: 'AUREX_westcoast_context_NDVI_2019_2024_monthly_stack_v1',
  folder: 'AUREX_exports',
  fileNamePrefix: 'aurex_westcoast_context_ndvi_2019_2024_monthly_stack_v1',
  region: studyArea,
  scale: EXPORT_SCALE_NDVI,
  crs: EXPORT_CRS,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF',
  formatOptions: {cloudOptimized: true}
});
