import { useSyncExternalStore } from 'react'
import type { ProbeData } from '../api/client'
import { DEFAULT_BBOX, type BBox } from '../types/geo'

type MapStoreState = {
  bbox: BBox
  boundaryGeoJson: Record<string, unknown> | null
  heatmapData: boolean
  tileOpacity: number
  layerVisible: boolean
  hasAnalysed: boolean
  error: string | null
  loading: boolean
  queryMeta: {
    startDate: string
    endDate: string
    cached: boolean
    mode: 'absolute' | 'anomaly'
  } | null
  analysisTileUrl: string | null
  analysisTiles: Record<number, { tileUrl: string; cached: boolean }>
  cursorProbe: ProbeData | null
  basemap: 'street' | 'satellite' | 'terrain'
  showMapDetails: boolean
  timeseriesData: { series: Array<{ date: string; temp: number }>; image_count: number } | null
  timeseriesLoading: boolean
}

type MapStoreActions = {
  setBBox: (bbox: BBox) => void
  setBoundaryGeoJson: (boundaryGeoJson: Record<string, unknown> | null) => void
  setTileOpacity: (n: number) => void
  toggleLayer: () => void
  setError: (message: string | null) => void
  setLoading: (loading: boolean) => void
  setQueryMeta: (meta: { startDate: string; endDate: string; cached: boolean; mode: 'absolute' | 'anomaly' } | null) => void
  setAnalysisTileUrl: (tileUrl: string | null) => void
  setAnalysisTileForBand: (band: number, tileUrl: string, cached: boolean) => void
  clearAnalysisTiles: () => void
  setCursorProbe: (probe: ProbeData | null) => void
  setBasemap: (basemap: 'street' | 'satellite' | 'terrain') => void
  toggleMapDetails: () => void
  setLayerVisible: (visible: boolean) => void
  setHasAnalysed: (value: boolean) => void
  setTimeseriesData: (data: { series: Array<{ date: string; temp: number }>; image_count: number } | null) => void
  setTimeseriesLoading: (loading: boolean) => void
}

let state: MapStoreState = {
  bbox: DEFAULT_BBOX,
  boundaryGeoJson: null,
  heatmapData: true,
  tileOpacity: 0.5,
  layerVisible: true,
  hasAnalysed: false,
  error: null,
  loading: false,
  queryMeta: null,
  analysisTileUrl: null,
  analysisTiles: {},
  cursorProbe: null,
  basemap: 'street',
  showMapDetails: true,
  timeseriesData: null,
  timeseriesLoading: false,
}

const listeners = new Set<() => void>()

const actions: MapStoreActions = {
  setBBox: (bbox) => {
    state = { ...state, bbox }
    listeners.forEach((listener) => listener())
  },
  setBoundaryGeoJson: (boundaryGeoJson) => {
    state = { ...state, boundaryGeoJson }
    listeners.forEach((listener) => listener())
  },
  setTileOpacity: (n) => {
    const tileOpacity = Math.max(0.05, Math.min(0.9, n))
    state = { ...state, tileOpacity }
    listeners.forEach((listener) => listener())
  },
  toggleLayer: () => {
    state = { ...state, layerVisible: !state.layerVisible }
    listeners.forEach((listener) => listener())
  },
  setError: (message) => {
    state = { ...state, error: message }
    listeners.forEach((listener) => listener())
  },
  setLoading: (loading) => {
    state = { ...state, loading }
    listeners.forEach((listener) => listener())
  },
  setQueryMeta: (meta) => {
    state = { ...state, queryMeta: meta }
    listeners.forEach((listener) => listener())
  },
  setAnalysisTileUrl: (tileUrl) => {
    state = { ...state, analysisTileUrl: tileUrl }
    listeners.forEach((listener) => listener())
  },
  setAnalysisTileForBand: (band, tileUrl, cached) => {
    state = {
      ...state,
      analysisTiles: { ...state.analysisTiles, [band]: { tileUrl, cached } },
    }
    listeners.forEach((listener) => listener())
  },
  clearAnalysisTiles: () => {
    state = { ...state, analysisTiles: {}, analysisTileUrl: null }
    listeners.forEach((listener) => listener())
  },
  setCursorProbe: (probe) => {
    state = { ...state, cursorProbe: probe }
    listeners.forEach((listener) => listener())
  },
  setBasemap: (basemap) => {
    state = { ...state, basemap }
    listeners.forEach((listener) => listener())
  },
  toggleMapDetails: () => {
    state = { ...state, showMapDetails: !state.showMapDetails }
    listeners.forEach((listener) => listener())
  },
  setLayerVisible: (visible) => {
    state = { ...state, layerVisible: visible }
    listeners.forEach((listener) => listener())
  },
  setHasAnalysed: (value) => {
    state = { ...state, hasAnalysed: value }
    listeners.forEach((listener) => listener())
  },
  setTimeseriesData: (data) => {
    state = { ...state, timeseriesData: data }
    listeners.forEach((listener) => listener())
  },
  setTimeseriesLoading: (loading) => {
    state = { ...state, timeseriesLoading: loading }
    listeners.forEach((listener) => listener())
  },
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): MapStoreState & MapStoreActions {
  return { ...state, ...actions }
}

export function useMapStore<T>(selector: (store: MapStoreState & MapStoreActions) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot()), () => selector(getSnapshot()))
}
