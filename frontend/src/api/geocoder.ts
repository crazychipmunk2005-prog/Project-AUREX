import type { BBox } from '../types/geo'

type NominatimResult = {
  lat: string
  lon: string
  boundingbox: [string, string, string, string]
  type?: string
  addresstype?: string
  class?: string
  geojson?: Record<string, unknown>
}

const TARGET_RADIUS_KM = 5
const SETTLEMENT_TYPES = new Set([
  'city',
  'town',
  'municipality',
  'village',
  'hamlet',
  'suburb',
  'neighbourhood',
  'quarter',
  'locality',
])
const DISTRICT_HINTS = ['district', 'state_district', 'county']

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function buildRadiusBBox(lat: number, lon: number): BBox {
  const latDelta = TARGET_RADIUS_KM / 110.574
  const lonKmPerDegree = 111.32 * Math.cos((lat * Math.PI) / 180)
  const lonDelta = lonKmPerDegree > 0 ? TARGET_RADIUS_KM / lonKmPerDegree : 0

  return {
    minLon: clamp(lon - lonDelta, -180, 180),
    minLat: clamp(lat - latDelta, -90, 90),
    maxLon: clamp(lon + lonDelta, -180, 180),
    maxLat: clamp(lat + latDelta, -90, 90),
  }
}

function isDistrictLike(result: NominatimResult): boolean {
  const type = (result.type ?? '').toLowerCase()
  const addressType = (result.addresstype ?? '').toLowerCase()
  return DISTRICT_HINTS.some((hint) => type.includes(hint) || addressType.includes(hint))
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return 6371 * c
}

function pickBestResult(results: NominatimResult[], query: string): NominatimResult {
  const wantsDistrict = /\bdistrict\b/i.test(query)

  if (wantsDistrict) {
    return results[0]
  }

  const settlement = results.find((result) => {
    const type = (result.type ?? '').toLowerCase()
    const addressType = (result.addresstype ?? '').toLowerCase()
    return SETTLEMENT_TYPES.has(type) || SETTLEMENT_TYPES.has(addressType)
  })

  if (settlement) {
    return settlement
  }

  const nonDistrict = results.find((result) => !isDistrictLike(result))
  return nonDistrict ?? results[0]
}

function isAreaGeoJson(geoJson: Record<string, unknown> | undefined): geoJson is Record<string, unknown> {
  if (!geoJson || typeof geoJson !== 'object') {
    return false
  }

  const type = String(geoJson.type ?? '')
  if (type === 'Polygon' || type === 'MultiPolygon') {
    return true
  }

  if (type === 'Feature') {
    const geometry = geoJson.geometry as { type?: string } | undefined
    return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon'
  }

  if (type === 'FeatureCollection') {
    const features = geoJson.features as Array<{ geometry?: { type?: string } }> | undefined
    return Array.isArray(features)
      ? features.some(
          (feature) =>
            feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon',
        )
      : false
  }

  return false
}

async function fetchBoundaryGeoJson(
  query: string,
  centerLat: number,
  centerLon: number,
  wantsDistrict: boolean,
): Promise<Record<string, unknown> | null> {
  const boundaryQueries = wantsDistrict
    ? [query]
    : [query, `${query} municipality`, `${query} town`, `${query} city`]

  const allResults: NominatimResult[] = []
  for (const q of boundaryQueries) {
    const params = new URLSearchParams({
      q,
      format: 'json',
      limit: '20',
      addressdetails: '1',
      polygon_geojson: '1',
    })

    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        'User-Agent': 'AUREX/1.0',
      },
    })

    if (!response.ok) {
      continue
    }

    const data = (await response.json()) as NominatimResult[]
    if (Array.isArray(data)) {
      allResults.push(...data)
    }
  }

  const polygonCandidates = allResults.filter((result) => {
    if (!isAreaGeoJson(result.geojson)) {
      return false
    }
    if (wantsDistrict) {
      return true
    }

    const className = (result.class ?? '').toLowerCase()
    const type = (result.type ?? '').toLowerCase()
    const addressType = (result.addresstype ?? '').toLowerCase()
    const districtLike = isDistrictLike(result)
    const settlementLike =
      SETTLEMENT_TYPES.has(type) ||
      SETTLEMENT_TYPES.has(addressType) ||
      className === 'place' ||
      className === 'boundary'

    return settlementLike && !districtLike
  })

  if (polygonCandidates.length === 0) {
    return null
  }

  const nearest = polygonCandidates
    .map((candidate) => {
      const lat = Number(candidate.lat)
      const lon = Number(candidate.lon)
      const score = Number.isFinite(lat) && Number.isFinite(lon)
        ? distanceKm(centerLat, centerLon, lat, lon)
        : Number.POSITIVE_INFINITY
      return { candidate, score }
    })
    .sort((a, b) => a.score - b.score)[0]

  return isAreaGeoJson(nearest.candidate.geojson) ? nearest.candidate.geojson : null
}

export async function geocodeCity(
  name: string,
): Promise<{ lat: number; lon: number; bbox: BBox; boundaryGeoJson: Record<string, unknown> | null } | null> {
  const q = name.trim()
  if (!q) {
    return null
  }

  const wantsDistrict = /\bdistrict\b/i.test(q)
  const params = new URLSearchParams({ q, format: 'json', limit: '10', addressdetails: '1', polygon_geojson: '1' })
  if (!wantsDistrict) {
    params.set('featuretype', 'settlement')
  }

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      'User-Agent': 'AUREX/1.0',
    },
  })

  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as NominatimResult[]
  if (!Array.isArray(data) || data.length === 0) {
    return null
  }

  const result = pickBestResult(data, q)
  const lat = Number(result.lat)
  const lon = Number(result.lon)
  const [south, north, west, east] = result.boundingbox.map((value) => Number(value))

  if (
    Number.isNaN(lat) ||
    Number.isNaN(lon) ||
    Number.isNaN(south) ||
    Number.isNaN(north) ||
    Number.isNaN(west) ||
    Number.isNaN(east)
  ) {
    return null
  }

  const boundaryGeoJson = await fetchBoundaryGeoJson(q, lat, lon, wantsDistrict)

  return {
    lat,
    lon,
    bbox: buildRadiusBBox(lat, lon),
    boundaryGeoJson,
  }
}
