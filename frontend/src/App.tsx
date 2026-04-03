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

const DEFAULT_LST_COG_URL =
  'https://raw.githubusercontent.com/crazychipmunk2005-prog/Project-AUREX/main/x-data/v1/region/lst/aurex_westcoast_context_lst_2019_2024_monthly_stack_v1.tif'
const DEFAULT_NDVI_COG_URL =
  'https://raw.githubusercontent.com/crazychipmunk2005-prog/Project-AUREX/main/x-data/v1/region/ndvi/aurex_westcoast_context_ndvi_2019_2024_monthly_stack_v1.tif'

const END_YEAR_OVERRIDE = Number(import.meta.env.VITE_TIMELINE_END_YEAR)
const START_YEAR = Number(import.meta.env.VITE_TIMELINE_START_YEAR) || 2019
const END_YEAR = Number.isFinite(END_YEAR_OVERRIDE) && END_YEAR_OVERRIDE >= START_YEAR
  ? END_YEAR_OVERRIDE
  : 2024

const COG_URLS = {
  lst: import.meta.env.VITE_LST_COG_URL ?? DEFAULT_LST_COG_URL,
  ndvi: import.meta.env.VITE_NDVI_COG_URL ?? DEFAULT_NDVI_COG_URL,
} as const

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
  for (let y = START_YEAR; y <= END_YEAR; y += 1) {
    for (let m = 1; m <= 12; m += 1) {
      labels.push(`${y}-${String(m).padStart(2, '0')}`)
    }
  }
  return labels
}

const MONTH_LABELS = buildMonthLabels()
const TOTAL_BANDS = MONTH_LABELS.length

function buildTileUrl(metric: Metric, bandIndex: number): string {
  const sourceUrl = `${COG_URLS[metric]}${KERALA_REGION.sourceSuffix}`
  const source = encodeURIComponent(sourceUrl)
  const rescale = metric === 'lst' ? '20,45' : '0,1'
  const colormap = metric === 'lst' ? 'inferno' : 'ylgn'
  return `${TITILER_BASE}/cog/tiles/{z}/{x}/{y}?url=${source}&bidx=${bandIndex}&rescale=${rescale}&colormap_name=${colormap}`
}

function App() {
  const [metric, setMetric] = useState<Metric>('lst')
  const [step, setStep] = useState(1)
  const setAnalysisTileUrl = useMapStore((store) => store.setAnalysisTileUrl)
  const clearAnalysisTiles = useMapStore((store) => store.clearAnalysisTiles)
  const setQueryMeta = useMapStore((store) => store.setQueryMeta)
  const setCursorProbe = useMapStore((store) => store.setCursorProbe)

  const selectedMonth = MONTH_LABELS[step - 1]
  const tileUrl = useMemo(() => buildTileUrl(metric, step), [metric, step])

  const onMetricChange = (nextMetric: Metric) => {
    setMetric(nextMetric)
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
        step={step}
        selectedMonth={selectedMonth}
        totalBands={TOTAL_BANDS}
        timelineStartYear={START_YEAR}
        onMetricChange={onMetricChange}
        onStepChange={onStepChange}
      />

      <main className="map-wrap">
        <AurexMap
          center={KERALA_REGION.center}
          zoom={KERALA_REGION.zoom}
          maxBounds={KERALA_LOCK_BOUNDS}
          tileUrl={tileUrl}
          tileKey={`${metric}-${step}`}
          step={step}
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
