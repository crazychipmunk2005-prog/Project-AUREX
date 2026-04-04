import { useMemo, useState } from 'react'
import { AurexMap } from './components/AurexMap'
import { ControlPanel } from './components/ControlPanel'
import { StatusBar } from './components/StatusBar'
import { CursorProbePanel } from './components/ui/CursorProbePanel'
import { ErrorToast } from './components/ui/ErrorToast'
import { LayerControls } from './components/ui/LayerControls'
import { LoadingOverlay } from './components/ui/LoadingOverlay'
import { useMapStore } from './store/mapStore'
import './App.css'

type Metric = 'lst' | 'ndvi'

const TITILER_BASE = 'https://aurex-tiles.onrender.com'

const DEFAULT_LST_COG_FOLDER_URL =
  'https://raw.githubusercontent.com/crazychipmunk2005-prog/Project-AUREX/main/x-data/v1/region/lst/seasonal_landsat_2019_2025'
const DEFAULT_LST_COG_FILE_TEMPLATE = 'AUREX_LST_Kerala_{yyyy}_{mm}.tif'
const DEFAULT_NDVI_COG_URL =
  'https://raw.githubusercontent.com/crazychipmunk2005-prog/Project-AUREX/main/x-data/v1/region/ndvi/aurex_westcoast_context_ndvi_2019_2024_monthly_stack_v1.tif'

const LST_END_YEAR = Number(import.meta.env.VITE_LST_END_YEAR) || 2025
const NDVI_END_YEAR = Number(import.meta.env.VITE_TIMELINE_END_YEAR) || 2024
const START_YEAR = Number(import.meta.env.VITE_TIMELINE_START_YEAR) || 2019

const LST_COG_FOLDER_URL = import.meta.env.VITE_LST_COG_FOLDER_URL ?? DEFAULT_LST_COG_FOLDER_URL
const LST_COG_FILE_TEMPLATE = import.meta.env.VITE_LST_COG_FILE_TEMPLATE ?? DEFAULT_LST_COG_FILE_TEMPLATE
const NDVI_COG_URL = import.meta.env.VITE_NDVI_COG_URL ?? DEFAULT_NDVI_COG_URL

const KERALA_REGION = {
  center: [10.45, 76.4] as [number, number],
  zoom: 8,
  sourceSuffix: '',
} as const

const KERALA_LOCK_BOUNDS = [
  [7.2, 73.9],
  [13.7, 78.5],
] as [[number, number], [number, number]]

function buildMonthLabels(): string[] {
  const labels: string[] = []
  for (let y = START_YEAR; y <= NDVI_END_YEAR; y += 1) {
    for (let m = 1; m <= 12; m += 1) {
      labels.push(`${y}-${String(m).padStart(2, '0')}`)
    }
  }
  return labels
}

function buildSeasonalMonthLabels(startYear: number, endYear: number): string[] {
  const labels: string[] = []
  const seasonalMonths = [1, 4, 8]
  for (let y = startYear; y <= endYear; y += 1) {
    for (const m of seasonalMonths) {
      labels.push(`${y}-${String(m).padStart(2, '0')}`)
    }
  }
  return labels
}

const NDVI_MONTH_LABELS = buildMonthLabels()
const LST_MONTH_LABELS = buildSeasonalMonthLabels(START_YEAR, LST_END_YEAR)

function getMonthLabelsForMetric(metric: Metric): string[] {
  return metric === 'lst' ? LST_MONTH_LABELS : NDVI_MONTH_LABELS
}

function buildLstCogFileName(monthLabel: string): string {
  const [year, month] = monthLabel.split('-')
  return LST_COG_FILE_TEMPLATE
    .replace('{yyyy}', year)
    .replace('{mm}', month)
}

function buildTileUrl(metric: Metric, bandIndex: number, monthLabels: string[]): string {
  const clampedBandIndex = Math.max(1, Math.min(monthLabels.length, bandIndex))
  const monthLabel = monthLabels[clampedBandIndex - 1]
  const lstSourceUrl = `${LST_COG_FOLDER_URL}/${buildLstCogFileName(monthLabel)}`
  const sourceUrl = metric === 'lst'
    ? `${lstSourceUrl}${KERALA_REGION.sourceSuffix}`
    : `${NDVI_COG_URL}${KERALA_REGION.sourceSuffix}`
  const source = encodeURIComponent(sourceUrl)
  const rescale = metric === 'lst' ? '20,45' : '0,1'
  const colormap = metric === 'lst' ? 'inferno' : 'ylgn'
  const resolvedBandIndex = metric === 'lst' ? 1 : clampedBandIndex
  return `${TITILER_BASE}/cog/tiles/{z}/{x}/{y}?url=${source}&bidx=${resolvedBandIndex}&rescale=${rescale}&colormap_name=${colormap}`
}

function App() {
  const [metric, setMetric] = useState<Metric>('lst')
  const [step, setStep] = useState(1)
  const setAnalysisTileUrl = useMapStore((store) => store.setAnalysisTileUrl)
  const clearAnalysisTiles = useMapStore((store) => store.clearAnalysisTiles)
  const setQueryMeta = useMapStore((store) => store.setQueryMeta)
  const setCursorProbe = useMapStore((store) => store.setCursorProbe)

  const monthLabels = useMemo(() => getMonthLabelsForMetric(metric), [metric])
  const totalBands = monthLabels.length
  const safeStep = Math.max(1, Math.min(totalBands, step))
  const selectedMonth = monthLabels[safeStep - 1]
  const tileUrl = useMemo(() => buildTileUrl(metric, safeStep, monthLabels), [metric, monthLabels, safeStep])

  const onMetricChange = (nextMetric: Metric) => {
    const nextMonthLabels = getMonthLabelsForMetric(nextMetric)
    setMetric(nextMetric)
    setStep((currentStep) => Math.max(1, Math.min(nextMonthLabels.length, currentStep)))
    setAnalysisTileUrl(null)
    clearAnalysisTiles()
    setQueryMeta(null)
    setCursorProbe(null)
  }

  const onStepChange = (nextStep: number) => {
    setStep(nextStep)
  }

  return (
    <div className="app">
      <ControlPanel
        metric={metric}
        step={safeStep}
        selectedMonth={selectedMonth}
        totalBands={totalBands}
        timelineMonthLabels={monthLabels}
        onMetricChange={onMetricChange}
        onStepChange={onStepChange}
      />

      <main className="map-wrap">
        <AurexMap
          center={KERALA_REGION.center}
          zoom={KERALA_REGION.zoom}
          maxBounds={KERALA_LOCK_BOUNDS}
          tileUrl={tileUrl}
          tileKey={`${metric}-${safeStep}`}
          step={safeStep}
          selectedMonth={selectedMonth}
        />
        <CursorProbePanel />
        <StatusBar />
        <LayerControls />
      </main>
      <LoadingOverlay />
      <ErrorToast />
    </div>
  )
}

export default App
