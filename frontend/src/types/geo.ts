export type BBox = {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

export const DEFAULT_BBOX: BBox = {
  minLon: 74.8,
  minLat: 8.1,
  maxLon: 77.6,
  maxLat: 12.8,
}
