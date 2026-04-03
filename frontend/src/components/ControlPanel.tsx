import { useMemo, useRef, useState } from 'react'
import { fetchHeatmap } from '../api/client'
import { geocodeCity } from '../api/geocoder'
import { useMapStore } from '../store/mapStore'
import type { BBox } from '../types/geo'
import { mapRef } from './AurexMap'
import { StatsPanel } from './StatsPanel'

type Metric = 'lst' | 'ndvi'

type ControlPanelProps = {
  metric: Metric
  step: number
  selectedMonth: string
  totalBands: number
  timelineStartYear: number
  onMetricChange: (metric: Metric) => void
  onStepChange: (step: number) => void
}

const MAX_AREA_KM2 = 50_000
const TIMELINE_STOP_COUNT = 10

function dateRangeFromBand(band: number, totalBands: number, timelineStartYear: number): { start: string; end: string } {
  const index = Math.max(1, Math.min(totalBands, band)) - 1
  const year = timelineStartYear + Math.floor(index / 12)
  const month = (index % 12) + 1
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  const toIso = (value: Date) => value.toISOString().slice(0, 10)
  return { start: toIso(start), end: toIso(end) }
}

function areaKm2FromBBox(bbox: BBox): number {
  const widthDeg = Math.abs(bbox.maxLon - bbox.minLon)
  const heightDeg = Math.abs(bbox.maxLat - bbox.minLat)
  const centerLatRad = ((bbox.minLat + bbox.maxLat) / 2) * (Math.PI / 180)
  const widthKm = widthDeg * 111.32 * Math.cos(centerLatRad)
  const heightKm = heightDeg * 110.574
  return Math.abs(widthKm * heightKm)
}

function clampBBoxToMaxArea(bbox: BBox): { bbox: BBox; clamped: boolean } {
  const widthDeg = Math.abs(bbox.maxLon - bbox.minLon)
  const heightDeg = Math.abs(bbox.maxLat - bbox.minLat)
  const areaKm2 = areaKm2FromBBox(bbox)

  if (areaKm2 <= MAX_AREA_KM2 || widthDeg === 0 || heightDeg === 0) {
    return { bbox, clamped: false }
  }

  const scale = Math.sqrt(MAX_AREA_KM2 / areaKm2)
  const centerLon = (bbox.minLon + bbox.maxLon) / 2
  const centerLat = (bbox.minLat + bbox.maxLat) / 2
  const nextHalfWidth = (widthDeg * scale) / 2
  const nextHalfHeight = (heightDeg * scale) / 2

  return {
    bbox: {
      minLon: centerLon - nextHalfWidth,
      minLat: centerLat - nextHalfHeight,
      maxLon: centerLon + nextHalfWidth,
      maxLat: centerLat + nextHalfHeight,
    },
    clamped: true,
  }
}

export function ControlPanel({
  metric,
  step,
  selectedMonth,
  totalBands,
  timelineStartYear,
  onMetricChange,
  onStepChange,
}: ControlPanelProps) {
  const bbox = useMapStore((store) => store.bbox)
  const setBBox = useMapStore((store) => store.setBBox)
  const setBoundaryGeoJson = useMapStore((store) => store.setBoundaryGeoJson)
  const setError = useMapStore((store) => store.setError)
  const loading = useMapStore((store) => store.loading)
  const setLoading = useMapStore((store) => store.setLoading)
  const setQueryMeta = useMapStore((store) => store.setQueryMeta)
  const setAnalysisTileUrl = useMapStore((store) => store.setAnalysisTileUrl)
  const analysisTiles = useMapStore((store) => store.analysisTiles)
  const setAnalysisTileForBand = useMapStore((store) => store.setAnalysisTileForBand)
  const clearAnalysisTiles = useMapStore((store) => store.clearAnalysisTiles)
  const setLayerVisible = useMapStore((store) => store.setLayerVisible)
  const [cityName, setCityName] = useState('')
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [geocodeError, setGeocodeError] = useState('')
  const [startDate, setStartDate] = useState('2019-01-01')
  const [endDate, setEndDate] = useState('2024-12-31')
  const [analysisMode, setAnalysisMode] = useState<'absolute' | 'anomaly'>('absolute')
  const skipBlurRef = useRef(false)

  const timelineBands = useMemo(() => {
    const bands: number[] = []
    for (let i = 0; i < TIMELINE_STOP_COUNT; i += 1) {
      const ratio = i / (TIMELINE_STOP_COUNT - 1)
      const band = Math.round(1 + ratio * (totalBands - 1))
      if (bands[bands.length - 1] !== band) {
        bands.push(band)
      }
    }
    return bands
  }, [totalBands])

  const nearestTimelineIndex = useMemo(() => {
    let nearestIndex = 0
    let nearestDistance = Number.POSITIVE_INFINITY
    timelineBands.forEach((band, index) => {
      const distance = Math.abs(band - step)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })
    return nearestIndex
  }, [step, timelineBands])

  const minStartDate = '2001-01-01'
  const startMs = Date.parse(`${startDate}T00:00:00Z`)
  const endMs = Date.parse(`${endDate}T00:00:00Z`)
  const minStartMs = Date.parse('2001-01-01T00:00:00Z')

  const startDateError = Number.isNaN(startMs)
    ? 'Enter a valid start date'
    : startMs < minStartMs
      ? 'start_date cannot be before 2001-01-01'
      : ''

  let endDateError = ''
  if (Number.isNaN(endMs)) {
    endDateError = 'Enter a valid end date'
  } else if (!Number.isNaN(startMs) && endMs <= startMs) {
    endDateError = 'end_date must be after start_date'
  }

  const canAnalyse = !startDateError && !endDateError && !loading

  const runGeocode = async () => {
    if (!cityName.trim()) {
      setGeocodeError('')
      setBoundaryGeoJson(null)
      return
    }

    setIsGeocoding(true)
    setGeocodeError('')

    try {
      const result = await geocodeCity(cityName)
      if (!result) {
        setGeocodeError('City not found')
        setBoundaryGeoJson(null)
        return
      }

      setBBox(result.bbox)
      setBoundaryGeoJson(result.boundaryGeoJson)
      mapRef.current?.flyToBounds(
        [
          [result.bbox.minLat, result.bbox.minLon],
          [result.bbox.maxLat, result.bbox.maxLon],
        ],
        { animate: true, duration: 1.4 },
      )
    } catch {
      setGeocodeError('City not found')
    } finally {
      setIsGeocoding(false)
    }
  }

  const fetchBandAnalysis = async (
    analysisBBox: BBox,
    band: number,
  ): Promise<{ success: boolean; cached: boolean; tileUrl: string | null; startDate: string; endDate: string }> => {
        const range = dateRangeFromBand(band, totalBands, timelineStartYear)
    const response = await fetchHeatmap({
      bbox: [analysisBBox.minLon, analysisBBox.minLat, analysisBBox.maxLon, analysisBBox.maxLat],
      start_date: range.start,
      end_date: range.end,
      mode: analysisMode,
    })

    if (!response.success) {
      return { success: false, cached: false, tileUrl: null, startDate: range.start, endDate: range.end }
    }

    const tileUrl = response.data?.tile_url ?? null
    if (tileUrl) {
      setAnalysisTileForBand(band, tileUrl, response.cached)
    }

    return { success: true, cached: response.cached, tileUrl, startDate: range.start, endDate: range.end }
  }

  const onAnalyse = async () => {
    if (!canAnalyse) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { bbox: analysisBBox, clamped } = clampBBoxToMaxArea(bbox)
      if (clamped) {
        setBBox(analysisBBox)
        mapRef.current?.flyToBounds(
          [
            [analysisBBox.minLat, analysisBBox.minLon],
            [analysisBBox.maxLat, analysisBBox.maxLon],
          ],
          { animate: true, duration: 1.2 },
        )
      }

      clearAnalysisTiles()

      const currentBandResult = await fetchBandAnalysis(analysisBBox, step)
      if (!currentBandResult.success || !currentBandResult.tileUrl) {
        setError('Satellite data unavailable. Try a smaller area.')
        return
      }

      setQueryMeta({
        startDate: currentBandResult.startDate,
        endDate: currentBandResult.endDate,
        cached: currentBandResult.cached,
        mode: analysisMode,
      })
      setAnalysisTileUrl(currentBandResult.tileUrl)
      setLayerVisible(true)

      const remainingBands = timelineBands.filter((band) => band !== step)
      for (const band of remainingBands) {
        const cached = analysisTiles[band]
        if (cached?.tileUrl) {
          continue
        }
        void fetchBandAnalysis(analysisBBox, band)
      }
    } finally {
      setLoading(false)
    }
  }

  const onTimelineChange = (index: number) => {
    const band = timelineBands[index] ?? step
    onStepChange(band)

    const range = dateRangeFromBand(band, totalBands, timelineStartYear)
    setStartDate(range.start)
    setEndDate(range.end)

    const preloaded = analysisTiles[band]
    if (preloaded?.tileUrl) {
      setAnalysisTileUrl(preloaded.tileUrl)
      setQueryMeta({ startDate: range.start, endDate: range.end, cached: preloaded.cached, mode: analysisMode })
      return
    }

    if (!loading && !startDateError && !endDateError) {
      void onAnalyse()
    }
  }

  return (
    <aside className="panel">
      <div className="brand">
        <img src="/aurex-logo.png" alt="AUREX logo" className="brand-logo" />
        <h1>AUREX</h1>
      </div>
      <p className="sub">Kerala Thermal Explorer</p>

      <div className="control-block">
        <label htmlFor="city">City</label>
        <div className="city-input-wrap">
          <input
            id="city"
            type="text"
            value={cityName}
            placeholder="Try Mumbai or Delhi"
            onChange={(event) => setCityName(event.target.value)}
            onBlur={() => {
              if (skipBlurRef.current) {
                skipBlurRef.current = false
                return
              }
              void runGeocode()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                skipBlurRef.current = true
                void runGeocode()
              }
            }}
          />
          {isGeocoding ? <span className="spinner" aria-label="Loading" /> : null}
        </div>
        {geocodeError ? <div className="warn">City not found</div> : null}
      </div>

      <div className="control-block">
        <label>Metric</label>
        <div className="toggle-row">
          <button className={metric === 'lst' ? 'active' : ''} onClick={() => onMetricChange('lst')}>
            LST
          </button>
          <button className={metric === 'ndvi' ? 'active' : ''} onClick={() => onMetricChange('ndvi')}>
            NDVI
          </button>
        </div>
      </div>

      <div className="control-block">
        <label>Analysis Mode</label>
        <div className="toggle-row">
          <button
            className={analysisMode === 'absolute' ? 'active' : ''}
            onClick={() => {
              setAnalysisMode('absolute')
              clearAnalysisTiles()
              setAnalysisTileUrl(null)
              setQueryMeta(null)
            }}
          >
            ABSOLUTE
          </button>
          <button
            className={analysisMode === 'anomaly' ? 'active' : ''}
            onClick={() => {
              setAnalysisMode('anomaly')
              clearAnalysisTiles()
              setAnalysisTileUrl(null)
              setQueryMeta(null)
            }}
          >
            ANOMALY
          </button>
        </div>
      </div>

      <div className="control-block">
        <label htmlFor="timeline">Timeline: {selectedMonth}</label>
        <input
          id="timeline"
          type="range"
          min={0}
          max={timelineBands.length - 1}
          value={nearestTimelineIndex}
          step={1}
          onChange={(event) => onTimelineChange(Number(event.target.value))}
        />
        <div className="hint">{timelineBands.length - 2} stops between start and end, auto-analysed</div>
      </div>

      <div className="control-block">
        <label htmlFor="start-date">Start Date</label>
        <input
          id="start-date"
          type="date"
          value={startDate}
          min={minStartDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        {startDateError ? <div className="warn">{startDateError}</div> : null}
      </div>

      <div className="control-block">
        <label htmlFor="end-date">End Date</label>
        <input
          id="end-date"
          type="date"
          value={endDate}
          min={minStartDate}
          onChange={(event) => setEndDate(event.target.value)}
        />
        {endDateError ? <div className="warn">{endDateError}</div> : null}
      </div>

      <div className="control-block">
        <button type="button" className="analyse-btn" disabled={!canAnalyse} onClick={() => void onAnalyse()}>
          {loading ? 'ANALYSING...' : 'ANALYSE'}
        </button>
      </div>

      <StatsPanel bbox={bbox} />
    </aside>
  )
}
