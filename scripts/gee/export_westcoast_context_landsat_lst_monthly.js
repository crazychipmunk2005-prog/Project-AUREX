// AUREX Landsat LST export script
// Scope: Kerala + Lakshadweep + context buffer
// Output: Monthly LST stack (2019-01 .. 2025-12), 30m where clear-sky data exists

var START_YEAR = 2019;
var END_YEAR = 2025;
var EXPORT_SCALE = 30;
var EXPORT_CRS = 'EPSG:4326';

// Administrative boundaries (GAUL level1)
var indiaL1 = ee.FeatureCollection('FAO/GAUL/2015/level1')
  .filter(ee.Filter.eq('ADM0_NAME', 'India'));

var kerala = indiaL1.filter(ee.Filter.eq('ADM1_NAME', 'Kerala')).geometry();
var lakshadweep = indiaL1.filter(ee.Filter.eq('ADM1_NAME', 'Lakshadweep')).geometry();

var contextStates = indiaL1
  .filter(ee.Filter.inList('ADM1_NAME', ['Karnataka', 'Tamil Nadu']))
  .geometry();

var keralaBuffer = kerala.buffer(25000);
var offshoreContext = kerala.buffer(150000);

var studyArea = ee.Geometry(
  kerala
    .union(lakshadweep)
    .union(keralaBuffer.intersection(contextStates, 1))
    .union(offshoreContext)
).dissolve();

Map.centerObject(kerala, 7);
Map.addLayer(studyArea, { color: 'cyan' }, 'AUREX Study Area');

var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2');
var l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2');
var landsat = l8.merge(l9);

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function monthPairs(startYear, endYear) {
  var out = [];
  for (var y = startYear; y <= endYear; y++) {
    for (var m = 1; m <= 12; m++) {
      out.push({ year: y, month: m });
    }
  }
  return out;
}

function maskAndConvertLST(img) {
  var qa = img.select('QA_PIXEL');

  var clearMask = qa.bitwiseAnd(1 << 1).eq(0) // dilated cloud
    .and(qa.bitwiseAnd(1 << 2).eq(0)) // cirrus
    .and(qa.bitwiseAnd(1 << 3).eq(0)) // cloud
    .and(qa.bitwiseAnd(1 << 4).eq(0)) // cloud shadow
    .and(qa.bitwiseAnd(1 << 5).eq(0)); // snow

  // Landsat Collection 2 L2 ST conversion to Kelvin then Celsius
  var lstC = img
    .select('ST_B10')
    .multiply(0.00341802)
    .add(149.0)
    .subtract(273.15)
    .updateMask(clearMask)
    .copyProperties(img, ['system:time_start']);

  return lstC;
}

function monthlyLandsatLST(year, month, region) {
  var start = ee.Date.fromYMD(year, month, 1);
  var end = start.advance(1, 'month');
  var bandName = 'LST_' + year + '_' + pad2(month);

  var col = landsat
    .filterDate(start, end)
    .filterBounds(region)
    .map(maskAndConvertLST);

  var hasData = col.size().gt(0);

  var monthImage = ee.Image(
    ee.Algorithms.If(
      hasData,
      col.median(),
      ee.Image.constant(0).updateMask(ee.Image.constant(0))
    )
  );

  return monthImage
    .clip(region)
    .rename(bandName)
    .toFloat();
}

function buildLandsatStack(region) {
  var pairs = monthPairs(START_YEAR, END_YEAR);
  var images = pairs.map(function(pair) {
    return monthlyLandsatLST(pair.year, pair.month, region);
  });
  return ee.ImageCollection(images).toBands();
}

var lstStack = buildLandsatStack(studyArea);

Map.addLayer(
  lstStack.select(0),
  { min: 20, max: 45, palette: ['313695', '74add1', 'ffffbf', 'f46d43', 'a50026'] },
  'Landsat LST first band preview'
);

Export.image.toDrive({
  image: lstStack,
  description: 'AUREX_westcoast_context_Landsat_LST_2019_2025_monthly_stack_v2',
  folder: 'AUREX_exports',
  fileNamePrefix: 'aurex_westcoast_context_landsat_lst_2019_2025_monthly_stack_v2',
  region: studyArea,
  scale: EXPORT_SCALE,
  crs: EXPORT_CRS,
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF',
  formatOptions: { cloudOptimized: true }
});
