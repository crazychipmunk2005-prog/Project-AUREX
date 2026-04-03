// AUREX Landsat LST export script - KERALA ONLY (Seasonal Anchors)
// Scope: Kerala (with 25km land context buffer)
// Output: Monthly LST GeoTIFFs for Jan (01), Apr (04), Aug (08) [2019 - 2025]

var START_YEAR = 2019;
var END_YEAR = 2025;
var EXPORT_SCALE = 30;
var EXPORT_CRS = 'EPSG:4326';

// 1. Define Administrative boundaries
var indiaL1 = ee.FeatureCollection('FAO/GAUL/2015/level1')
  .filter(ee.Filter.eq('ADM0_NAME', 'India'));

var kerala = indiaL1.filter(ee.Filter.eq('ADM1_NAME', 'Kerala')).geometry();

var contextStates = indiaL1
  .filter(ee.Filter.inList('ADM1_NAME', ['Karnataka', 'Tamil Nadu']))
  .geometry();

var keralaBuffer = kerala.buffer(25000);

// 2. Isolate the processing region
var keralaRegion = kerala.union(keralaBuffer.intersection(contextStates, 1));

Map.centerObject(kerala, 7);
Map.addLayer(keralaRegion, { color: 'cyan' }, 'Kerala Region');

var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2');
var l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2');
var landsat = l8.merge(l9);

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

// FUNCTION: Only pulls months 1, 4, and 8
function monthPairs(startYear, endYear) {
  var out = [];
  var targetMonths = [1, 4, 8]; // January, April, August

  for (var y = startYear; y <= endYear; y++) {
    for (var i = 0; i < targetMonths.length; i++) {
      out.push({ year: y, month: targetMonths[i] });
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

  var lstC = img.select('ST_B10')
    .multiply(0.00341802).add(149.0).subtract(273.15)
    .updateMask(clearMask)
    .copyProperties(img, ['system:time_start']);
  return lstC;
}

function monthlyLandsatLST(year, month, region) {
  var start = ee.Date.fromYMD(year, month, 1);
  var end = start.advance(1, 'month');

  var col = landsat
    .filterDate(start, end)
    .filterBounds(region)
    .map(maskAndConvertLST);

  var hasData = col.size().gt(0);

  return ee.Image(
    ee.Algorithms.If(
      hasData,
      col.median(),
      ee.Image.constant(0).updateMask(ee.Image.constant(0))
    )
  ).clip(region).toFloat();
}

// 3. Client-Side Loop to generate isolated tasks (Kerala Only)
var pairs = monthPairs(START_YEAR, END_YEAR);

pairs.forEach(function (pair) {
  var mStr = pad2(pair.month);

  // -- KERALA TASK --
  var kImg = monthlyLandsatLST(pair.year, pair.month, keralaRegion);
  var kName = 'AUREX_LST_Kerala_' + pair.year + '_' + mStr;

  Export.image.toDrive({
    image: kImg,
    description: kName,
    folder: 'AUREX_exports',
    fileNamePrefix: kName,
    region: keralaRegion,
    scale: EXPORT_SCALE,
    crs: EXPORT_CRS,
    maxPixels: 1e13,
    fileFormat: 'GeoTIFF',
    formatOptions: { cloudOptimized: true }
  });
});

print('Kerala-Only Seasonal script loaded. You should see exactly 21 tasks queued in your Tasks tab.');