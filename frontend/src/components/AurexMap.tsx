import { createRef, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L, { type Layer, type Map } from 'leaflet'
import { fetchProbe } from '../api/client'
import { useMapStore } from '../store/mapStore'
import { TileOverlay } from './TileOverlay'

type AurexMapProps = {
  center: [number, number]
  zoom: number
  maxBounds: [[number, number], [number, number]]
  tileUrl: string
  tileKey: string
  step: number
  selectedMonth: string
}

export const mapRef = createRef<Map>()

type BasemapConfig = {
  url: string
  attribution: string
  detailsOverlayUrl?: string
  detailsOverlayAttribution?: string
}

function getBasemapConfig(
  basemap: 'street' | 'satellite' | 'terrain',
  showMapDetails: boolean,
): BasemapConfig {
  if (basemap === 'satellite') {
    return {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
      detailsOverlayUrl: showMapDetails
        ? 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
        : undefined,
      detailsOverlayAttribution: showMapDetails ? 'Labels &copy; Esri' : undefined,
    }
  }

  if (basemap === 'terrain') {
    if (showMapDetails) {
      return {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap',
      }
    }

    return {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
    }
  }

  if (showMapDetails) {
    return {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
    }
  }

  return {
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  }
}

const MapRefSetter = () => {
  const map = useMap()

  useEffect(() => {
    mapRef.current = map
    return () => {
      if (mapRef.current === map) {
        mapRef.current = null
      }
    }
  }, [map])

  return null
}

const BoundaryOverlay = () => {
  const map = useMap()
  const boundaryGeoJson = useMapStore((store) => store.boundaryGeoJson)
  const layerRef = useRef<Layer | null>(null)

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }

    const style = {
      color: 'var(--accent)',
      weight: 2,
      opacity: 0.9,
      fillColor: 'var(--accent)',
      fillOpacity: 0.03,
      dashArray: '4 4',
    }

    if (boundaryGeoJson) {
      layerRef.current = L.geoJSON(boundaryGeoJson as never, { style: () => style }).addTo(map)
    }

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
  }, [map, boundaryGeoJson])

  return null
}

function getMonthDateRange(monthLabel: string): { start: string; end: string } {
  const [year, month] = monthLabel.split('-').map((value) => Number(value))
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  const toIso = (value: Date) => value.toISOString().slice(0, 10)
  return { start: toIso(start), end: toIso(end) }
}

const CursorProbeLayer = ({ selectedMonth }: { selectedMonth: string }) => {
  const map = useMap()
  const queryMeta = useMapStore((store) => store.queryMeta)
  const setCursorProbe = useMapStore((store) => store.setCursorProbe)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const onMove = (event: L.LeafletMouseEvent) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }

      timerRef.current = window.setTimeout(async () => {
        const activeRange = queryMeta
          ? { start: queryMeta.startDate, end: queryMeta.endDate }
          : getMonthDateRange(selectedMonth)

        const response = await fetchProbe({
          lat: event.latlng.lat,
          lon: event.latlng.lng,
          start_date: activeRange.start,
          end_date: activeRange.end,
        })
        if (response.success) {
          setCursorProbe(response.data)
        }
      }, 110)
    }

    map.on('mousemove', onMove)
    return () => {
      map.off('mousemove', onMove)
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [map, queryMeta, selectedMonth, setCursorProbe])

  return null
}

export function AurexMap({ center, zoom, maxBounds, tileUrl, tileKey, step, selectedMonth }: AurexMapProps) {
  const baseTileOpacity = useMapStore((store) => store.tileOpacity)
  const layerVisible = useMapStore((store) => store.layerVisible)
  const heatmapData = useMapStore((store) => store.heatmapData)
  const hasAnalysed = useMapStore((store) => store.hasAnalysed)
  const analysisTileUrl = useMapStore((store) => store.analysisTileUrl)
  const analysisTiles = useMapStore((store) => store.analysisTiles)
  const basemap = useMapStore((store) => store.basemap)
  const showMapDetails = useMapStore((store) => store.showMapDetails)
  const baseMapConfig = getBasemapConfig(basemap, showMapDetails)
  const timelineTile = analysisTiles[step]?.tileUrl
  const activeOverlayUrl = timelineTile ?? analysisTileUrl ?? tileUrl
  const mapZoom = mapRef.current?.getZoom() ?? zoom
  const tileOpacity = mapZoom >= 14 ? Math.min(baseTileOpacity, 0.42) : mapZoom >= 12 ? Math.min(baseTileOpacity, 0.58) : baseTileOpacity
  const activeOverlayKey = timelineTile
    ? `analysis-band-${step}`
    : analysisTileUrl
      ? `analysis-${analysisTileUrl}`
      : tileKey

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom={true}
      className="map"
      maxBounds={maxBounds}
      maxBoundsViscosity={1}
      minZoom={7}
      maxZoom={18}
    >
      <MapRefSetter />
      <BoundaryOverlay />
      <TileLayer attribution={baseMapConfig.attribution} url={baseMapConfig.url} />
      {baseMapConfig.detailsOverlayUrl ? (
        <TileLayer
          attribution={baseMapConfig.detailsOverlayAttribution}
          url={baseMapConfig.detailsOverlayUrl}
          opacity={0.9}
        />
      ) : null}
      {hasAnalysed && layerVisible && heatmapData ? (
        <TileOverlay tileKey={activeOverlayKey} tileUrl={activeOverlayUrl} opacity={tileOpacity} />
      ) : null}
      <CursorProbeLayer selectedMonth={selectedMonth} />
    </MapContainer>
  )
}
