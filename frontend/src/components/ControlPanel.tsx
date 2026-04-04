import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchHeatmap } from '../api/client'
import { geocodeCity } from '../api/geocoder'
import { fetchTimeseries } from '../api/timeseries'
import { useMapStore } from '../store/mapStore'
import type { BBox } from '../types/geo'
import { mapRef } from './AurexMap'
import { StatsPanel } from './StatsPanel'

type ControlPanelProps = {
  step: number
  selectedMonth: string
  timelineMonthLabels: string[]
  onStepChange: (step: number) => void
}

type TimeseriesRangeMode = 'short' | 'analysis'

const MAX_AREA_KM2 = 50_000
const MAX_AREA_TARGET_KM2 = 49_000
const ANALYSIS_REQUEST_LIMIT = 1
const ABSOLUTE_FOCUS_RADIUS_KM = 15
const ANOMALY_FOCUS_RADIUS_KM = 8
const TIMELINE_FETCH_DEBOUNCE_MS = 250
const SEASONAL_MONTHS = [1, 4, 8] as const
type SeasonalMonth = (typeof SEASONAL_MONTHS)[number]

const SEASONAL_MONTH_LABEL: Record<SeasonalMonth, string> = {
  1: 'JAN',
  4: 'APRIL',
  8: 'AUGUST',
}

function findBandByYearMonth(timelineMonthLabels: string[], year: number, month: number): number | null {
  for (let i = 0; i < timelineMonthLabels.length; i += 1) {
    const [yearStr, monthStr] = timelineMonthLabels[i].split('-')
    if (Number(yearStr) === year && Number(monthStr) === month) {
      return i + 1
    }
  }

  return null
}

function dateRangeFromBand(
  band: number,
  timelineMonthLabels: string[],
  options?: { singleDay: boolean; fixedMonth: SeasonalMonth; fixedDay: number },
): { start: string; end: string } {
  const index = Math.max(1, Math.min(timelineMonthLabels.length, band)) - 1
  const monthLabel = timelineMonthLabels[index] ?? timelineMonthLabels[0] ?? '2019-01'
  const [yearStr, monthStr] = monthLabel.split('-')
  const year = Number(yearStr)
  const baseMonth = Number(monthStr)
  const month = options?.fixedMonth ?? baseMonth

  let start = new Date(Date.UTC(year, month - 1, 1))
  let end = new Date(Date.UTC(year, month, 0))

  if (options?.singleDay) {
    const rawDay = Math.max(1, Math.min(31, options.fixedDay))
    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const safeDay = Math.min(rawDay, maxDay)
    start = new Date(Date.UTC(year, month - 1, safeDay))
    end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 1)
  }

  const toIso = (value: Date) => value.toISOString().slice(0, 10)
  return { start: toIso(start), end: toIso(end) }
}

function areaKm2FromBBox(bbox: BBox): number {
  const widthDeg = Math.abs(bbox.maxLon - bbox.minLon)
  const heightDeg = Math.abs(bbox.maxLat - bbox.minLat)
  return Math.abs(widthDeg * heightDeg * 111 * 111)
}

function clampBBoxToMaxArea(bbox: BBox): { bbox: BBox; clamped: boolean } {
  const widthDeg = Math.abs(bbox.maxLon - bbox.minLon)
  const heightDeg = Math.abs(bbox.maxLat - bbox.minLat)
  const areaKm2 = areaKm2FromBBox(bbox)

  if (areaKm2 <= MAX_AREA_KM2 || widthDeg === 0 || heightDeg === 0) {
    return { bbox, clamped: false }
  }

  const scale = Math.sqrt(MAX_AREA_TARGET_KM2 / areaKm2)
  const centerLon = (bbox.minLon + bbox.maxLon) / 2
  const centerLat = (bbox.minLat + bbox.maxLat) / 2
  let nextHalfWidth = (widthDeg * scale) / 2
  let nextHalfHeight = (heightDeg * scale) / 2

  let nextBBox: BBox = {
    minLon: centerLon - nextHalfWidth,
    minLat: centerLat - nextHalfHeight,
    maxLon: centerLon + nextHalfWidth,
    maxLat: centerLat + nextHalfHeight,
  }

  for (let i = 0; i < 3; i += 1) {
    const nextArea = areaKm2FromBBox(nextBBox)
    if (nextArea <= MAX_AREA_KM2) {
      break
    }

    const downscale = Math.sqrt(MAX_AREA_TARGET_KM2 / nextArea)
    nextHalfWidth *= downscale
    nextHalfHeight *= downscale
    nextBBox = {
      minLon: centerLon - nextHalfWidth,
      minLat: centerLat - nextHalfHeight,
      maxLon: centerLon + nextHalfWidth,
      maxLat: centerLat + nextHalfHeight,
    }
  }

  return {
    bbox: nextBBox,
    clamped: true,
  }
}

function makeRadiusBBox(centerLat: number, centerLon: number, radiusKm: number): BBox {
  const deltaLat = radiusKm / 111
  const safeCos = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.2)
  const deltaLon = radiusKm / (111 * safeCos)

  return {
    minLon: Math.max(-180, centerLon - deltaLon),
    minLat: Math.max(-90, centerLat - deltaLat),
    maxLon: Math.min(180, centerLon + deltaLon),
    maxLat: Math.min(90, centerLat + deltaLat),
  }
}

function getViewportBBox(): BBox | null {
  const map = mapRef.current
  if (!map) {
    return null
  }

  const bounds = map.getBounds()
  return {
    minLon: bounds.getWest(),
    minLat: bounds.getSouth(),
    maxLon: bounds.getEast(),
    maxLat: bounds.getNorth(),
  }
}

function isViewportWithinBBox(target: BBox): boolean {
  const viewportBBox = getViewportBBox()
  if (!viewportBBox) {
    return true
  }

  return (
    viewportBBox.minLon >= target.minLon &&
    viewportBBox.maxLon <= target.maxLon &&
    viewportBBox.minLat >= target.minLat &&
    viewportBBox.maxLat <= target.maxLat
  )
}

export function ControlPanel({
  step,
  selectedMonth,
  timelineMonthLabels,
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
  const setHasAnalysed = useMapStore((store) => store.setHasAnalysed)
  const timeseriesLoading = useMapStore((store) => store.timeseriesLoading)
  const setTimeseriesLoading = useMapStore((store) => store.setTimeseriesLoading)
  const setTimeseriesData = useMapStore((store) => store.setTimeseriesData)
  const [cityName, setCityName] = useState('')
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [geocodeError, setGeocodeError] = useState('')
  const [startDate, setStartDate] = useState('2019-01-01')
  const [endDate, setEndDate] = useState('2019-01-02')
  const [analysisMode, setAnalysisMode] = useState<'absolute' | 'anomaly'>('absolute')
  const [timeseriesRangeMode, setTimeseriesRangeMode] = useState<TimeseriesRangeMode>('short')
  const [seasonalMonth, setSeasonalMonth] = useState<SeasonalMonth>(1)
  const [seasonalDay, setSeasonalDay] = useState(29)
  const skipBlurRef = useRef(false)
  const timelineFetchTimerRef = useRef<number | null>(null)
  const analysisTokenRef = useRef(0)
  const pendingAnalysesRef = useRef(0)

  const timelineBands = useMemo(() => {
    const bands: number[] = []
    timelineMonthLabels.forEach((label, index) => {
      const [, monthStr] = label.split('-')
      if (Number(monthStr) === seasonalMonth) {
        bands.push(index + 1)
      }
    })

    return bands.length > 0 ? bands : [step]
  }, [seasonalMonth, step, timelineMonthLabels])

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

  const selectedYear = useMemo(() => {
    const [yearStr] = selectedMonth.split('-')
    const parsed = Number(yearStr)
    return Number.isFinite(parsed) ? parsed : 2019
  }, [selectedMonth])

  const timelineLabel = `${selectedYear}-${String(seasonalMonth).padStart(2, '0')}-${String(Math.max(1, Math.min(31, seasonalDay))).padStart(2, '0')}`
  const timelineHint = 'Compares the same day for selected month across all years'
  const analysisYearRange = useMemo(() => {
    const years = timelineMonthLabels
      .map((label) => Number(label.split('-')[0]))
      .filter((year) => Number.isFinite(year))

    const startYear = years.length > 0 ? Math.min(...years) : 2019
    const endYear = years.length > 0 ? Math.max(...years) : 2025
    return {
      startYear,
      endYear,
      startDate: `${startYear}-01-01`,
      endDate: `${endYear}-12-31`,
    }
  }, [timelineMonthLabels])

  const startMs = Date.parse(`${startDate}T00:00:00Z`)
  const endMs = Date.parse(`${endDate}T00:00:00Z`)

  const startDateError = Number.isNaN(startMs) ? 'Enter a valid date' : ''

  let endDateError = ''
  if (Number.isNaN(endMs)) {
    endDateError = 'Enter a valid end date'
  } else if (!Number.isNaN(startMs) && endMs <= startMs) {
    endDateError = 'end_date must be after start_date'
  }

  const canAnalyse = !startDateError && !endDateError && !loading
  const hasBBox =
    Number.isFinite(bbox.minLon) &&
    Number.isFinite(bbox.minLat) &&
    Number.isFinite(bbox.maxLon) &&
    Number.isFinite(bbox.maxLat) &&
    bbox.maxLon > bbox.minLon &&
    bbox.maxLat > bbox.minLat
  const canFetchTimeseries = hasBBox && !timeseriesLoading && !loading

  const clearTimelineFetchTimer = () => {
    if (timelineFetchTimerRef.current !== null) {
      window.clearTimeout(timelineFetchTimerRef.current)
      timelineFetchTimerRef.current = null
    }
  }

  const nextAnalysisToken = () => {
    analysisTokenRef.current += 1
    return analysisTokenRef.current
  }

  const beginAnalysisLoading = () => {
    pendingAnalysesRef.current += 1
    setLoading(true)
  }

  const endAnalysisLoading = () => {
    pendingAnalysesRef.current = Math.max(0, pendingAnalysesRef.current - 1)
    if (pendingAnalysesRef.current === 0) {
      setLoading(false)
    }
  }

  useEffect(() => {
    return () => {
      clearTimelineFetchTimer()
    }
  }, [])

  const getRangeForBand = (band: number) => {
    return dateRangeFromBand(band, timelineMonthLabels, {
      singleDay: true,
      fixedMonth: seasonalMonth,
      fixedDay: seasonalDay,
    })
  }

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
  ): Promise<{
    success: boolean
    cached: boolean
    tileUrl: string | null
    startDate: string
    endDate: string
    error: string | null
  }> => {
    const range = getRangeForBand(band)
    const response = await fetchHeatmap({
      bbox: [analysisBBox.minLon, analysisBBox.minLat, analysisBBox.maxLon, analysisBBox.maxLat],
      start_date: range.start,
      end_date: range.end,
      mode: analysisMode,
    })

    if (!response.success) {
      return {
        success: false,
        cached: false,
        tileUrl: null,
        startDate: range.start,
        endDate: range.end,
        error: response.error ?? 'Satellite data unavailable. Try a smaller area.',
      }
    }

    const tileUrl = response.data?.tile_url ?? null
    if (tileUrl) {
      setAnalysisTileForBand(band, tileUrl, response.cached)
    }

    return {
      success: true,
      cached: response.cached,
      tileUrl,
      startDate: range.start,
      endDate: range.end,
      error: null,
    }
  }

  const onAnalyse = async (
    targetBand: number = step,
    options?: { preserveExisting: boolean; token?: number },
  ) => {
    const token = options?.token ?? nextAnalysisToken()
    if (!canAnalyse) {
      return
    }

    if (token !== analysisTokenRef.current) {
      return
    }

    clearTimelineFetchTimer()

    beginAnalysisLoading()
    setError(null)

    try {
      const preserveExisting = Boolean(options?.preserveExisting)
      const viewportBBox = getViewportBBox()
      const hasViewport = viewportBBox !== null
      const centerLat = hasViewport ? (viewportBBox.minLat + viewportBBox.maxLat) / 2 : (bbox.minLat + bbox.maxLat) / 2
      const centerLon = hasViewport ? (viewportBBox.minLon + viewportBBox.maxLon) / 2 : (bbox.minLon + bbox.maxLon) / 2

      const focusRadius = analysisMode === 'anomaly' ? ANOMALY_FOCUS_RADIUS_KM : ABSOLUTE_FOCUS_RADIUS_KM
      const focusBbox = makeRadiusBBox(centerLat, centerLon, focusRadius)
      const inPrefetchRadius = isViewportWithinBBox(focusBbox)
      const effectiveBbox = analysisMode === 'anomaly' ? focusBbox : inPrefetchRadius ? focusBbox : (viewportBBox ?? bbox)

      const { bbox: analysisBBox, clamped } = clampBBoxToMaxArea(effectiveBbox)
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

      if (!preserveExisting) {
        clearAnalysisTiles()
      }

      const requestedBands = [targetBand]
      const uniqueBands = Array.from(new Set(requestedBands))
      const results: Array<{
        success: boolean
        cached: boolean
        tileUrl: string | null
        startDate: string
        endDate: string
        error: string | null
      }> = []

      for (let i = 0; i < uniqueBands.length; i += ANALYSIS_REQUEST_LIMIT) {
        const chunk = uniqueBands.slice(i, i + ANALYSIS_REQUEST_LIMIT)
        const chunkResults = await Promise.all(chunk.map((band) => fetchBandAnalysis(analysisBBox, band)))
        if (token !== analysisTokenRef.current) {
          return
        }
        results.push(...chunkResults)
      }

      if (token !== analysisTokenRef.current) {
        return
      }

      const successfulResults = results.filter((result) => result.success && result.tileUrl)
      if (successfulResults.length === 0) {
        const failedResult = results.find((result) => !result.success)
        setError(failedResult?.error ?? 'Satellite data unavailable. Try a smaller area.')
        return
      }

      const targetIndex = uniqueBands.indexOf(targetBand)
      let currentBandResult = results[targetIndex >= 0 ? targetIndex : 0]
      if (!currentBandResult?.tileUrl) {
        currentBandResult = successfulResults[0]
      }

      setQueryMeta({
        startDate: currentBandResult.startDate,
        endDate: currentBandResult.endDate,
        cached: currentBandResult.cached,
        mode: analysisMode,
      })
      setStartDate(currentBandResult.startDate)
      setEndDate(currentBandResult.endDate)
      setAnalysisTileUrl(currentBandResult.tileUrl)
      setLayerVisible(true)
      setHasAnalysed(true)

      if (successfulResults.length < uniqueBands.length) {
        setError(`Loaded ${successfulResults.length}/${uniqueBands.length} map attempts.`)
      } else {
        setError(null)
      }
    } finally {
      endAnalysisLoading()
    }
  }

  const onTimelineChange = (index: number) => {
    clearTimelineFetchTimer()
    const token = nextAnalysisToken()

    const band = timelineBands[index] ?? step
    onStepChange(band)

    const range = getRangeForBand(band)
    setStartDate(range.start)
    setEndDate(range.end)

    const preloaded = analysisTiles[band]
    if (preloaded?.tileUrl) {
      setAnalysisTileUrl(preloaded.tileUrl)
      setQueryMeta({ startDate: range.start, endDate: range.end, cached: preloaded.cached, mode: analysisMode })
      return
    }

    if (loading || startDateError || endDateError) {
      return
    }

    timelineFetchTimerRef.current = window.setTimeout(() => {
      void onAnalyse(band, { preserveExisting: true, token })
    }, TIMELINE_FETCH_DEBOUNCE_MS)
  }

  const applySeasonalControls = (nextMonth: SeasonalMonth, nextDay: number) => {
    const clampedDay = Math.max(1, Math.min(31, Math.round(nextDay) || 1))
    const currentYearBand = findBandByYearMonth(timelineMonthLabels, selectedYear, nextMonth)
    const fallbackBand = findBandByYearMonth(timelineMonthLabels, 2019, nextMonth)
    const nextBand = currentYearBand ?? fallbackBand ?? step

    setSeasonalMonth(nextMonth)
    setSeasonalDay(clampedDay)
    onStepChange(nextBand)

    const range = dateRangeFromBand(nextBand, timelineMonthLabels, {
      singleDay: true,
      fixedMonth: nextMonth,
      fixedDay: clampedDay,
    })

    setStartDate(range.start)
    setEndDate(range.end)

    clearAnalysisTiles()
    setAnalysisTileUrl(null)
    setQueryMeta(null)
    setError(null)
  }

  const onFetchTimeseries = async () => {
    if (!canFetchTimeseries) {
      return
    }

    setError(null)
    setTimeseriesLoading(true)
    try {
      const timeseriesStart =
        timeseriesRangeMode === 'analysis' ? analysisYearRange.startDate : `${selectedYear}-01-01`
      const timeseriesEnd =
        timeseriesRangeMode === 'analysis' ? analysisYearRange.endDate : `${selectedYear}-12-31`
      const result = await fetchTimeseries(bbox, timeseriesStart, timeseriesEnd)
      if (!result.success || !result.data) {
        setError(result.error ?? 'Request failed. Please try again.')
        return
      }

      setTimeseriesData(result.data)
      if (result.error) {
        setError(result.error)
      }
    } finally {
      setTimeseriesLoading(false)
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
            placeholder="eg: Kochi"
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
        <label>Month</label>
        <div className="toggle-row">
          {SEASONAL_MONTHS.map((month) => (
            <button
              key={month}
              className={seasonalMonth === month ? 'active' : ''}
              onClick={() => applySeasonalControls(month, seasonalDay)}
            >
              {SEASONAL_MONTH_LABEL[month]}
            </button>
          ))}
        </div>
      </div>

      <div className="control-block">
        <label htmlFor="seasonal-day">Date of month</label>
        <input
          id="seasonal-day"
          type="number"
          min={1}
          max={31}
          value={seasonalDay}
          onChange={(event) => setSeasonalDay(Math.max(1, Math.min(31, Number(event.target.value) || 1)))}
          onBlur={() => applySeasonalControls(seasonalMonth, seasonalDay)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              applySeasonalControls(seasonalMonth, seasonalDay)
            }
          }}
        />
        <div className="hint">Single day compare across years (2019-2025)</div>
      </div>

      <div className="control-block">
        <label htmlFor="timeline">Timeline: {timelineLabel}</label>
        <input
          id="timeline"
          type="range"
          min={0}
          max={timelineBands.length - 1}
          value={nearestTimelineIndex}
          step={1}
          onChange={(event) => onTimelineChange(Number(event.target.value))}
        />
        <div className="hint">{timelineHint}</div>
      </div>

      <div className="control-block">
        <button type="button" className="analyse-btn" disabled={!canAnalyse} onClick={() => void onAnalyse()}>
          {loading ? 'ANALYSING...' : 'ANALYSE'}
        </button>
      </div>

      <div className="control-block">
        <label>Time Series Range</label>
        <div className="toggle-row">
          <button
            type="button"
            className={timeseriesRangeMode === 'short' ? 'active' : ''}
            disabled={timeseriesLoading}
            onClick={() => setTimeseriesRangeMode('short')}
          >
            SHORT
          </button>
          <button
            type="button"
            className={timeseriesRangeMode === 'analysis' ? 'active' : ''}
            disabled={timeseriesLoading}
            onClick={() => setTimeseriesRangeMode('analysis')}
          >
            {analysisYearRange.startYear}-{analysisYearRange.endYear}
          </button>
        </div>
        <div className="hint">
          {timeseriesRangeMode === 'analysis'
            ? `Full analysis period (${analysisYearRange.startYear}-${analysisYearRange.endYear})`
            : `Selected year (${selectedYear})`}
        </div>
      </div>

      <div className="control-block">
        <button
          type="button"
          className="analyse-btn"
          disabled={!canFetchTimeseries}
          onClick={() => void onFetchTimeseries()}
        >
          {timeseriesLoading ? (
            <>
              <span className="btn-spinner" aria-hidden="true" /> FETCHING...
            </>
          ) : (
            'TIME SERIES'
          )}
        </button>
      </div>

      <StatsPanel bbox={bbox} />
    </aside>
  )
}
