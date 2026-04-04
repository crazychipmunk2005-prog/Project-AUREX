import { useMemo, useState } from 'react'
import { AurexMap } from './components/AurexMap'
import { ControlPanel } from './components/ControlPanel'
import { StatusBar } from './components/StatusBar'
import { CursorProbePanel } from './components/ui/CursorProbePanel'
import { ErrorToast } from './components/ui/ErrorToast'
import { LayerControls } from './components/ui/LayerControls'
import { LoadingOverlay } from './components/ui/LoadingOverlay'
import { TempChart } from './components/ui/TempChart'
import { ViewportScale } from './components/ui/ViewportScale'
import './App.css'

const TITILER_BASE = 'https://aurex-tiles.onrender.com'

const DEFAULT_LST_COG_FOLDER_URL =
  'https://media.githubusercontent.com/media/crazychipmunk2005-prog/Project-AUREX/main/x-data/v1/region/lst/seasonal_landsat_2019_2025'
const DEFAULT_LST_COG_FILE_TEMPLATE = 'AUREX_LST_Kerala_{yyyy}_{mm}.tif'

const LST_END_YEAR = Number(import.meta.env.VITE_LST_END_YEAR) || 2025
const START_YEAR = Number(import.meta.env.VITE_TIMELINE_START_YEAR) || 2019

const LST_COG_FOLDER_URL = import.meta.env.VITE_LST_COG_FOLDER_URL ?? DEFAULT_LST_COG_FOLDER_URL
const LST_COG_FILE_TEMPLATE = import.meta.env.VITE_LST_COG_FILE_TEMPLATE ?? DEFAULT_LST_COG_FILE_TEMPLATE

const KERALA_REGION = {
  center: [10.45, 76.4] as [number, number],
  zoom: 8,
  sourceSuffix: '',
} as const

const KERALA_LOCK_BOUNDS = [
  [7.2, 73.9],
  [13.7, 78.5],
] as [[number, number], [number, number]]

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

const LST_MONTH_LABELS = buildSeasonalMonthLabels(START_YEAR, LST_END_YEAR)

function buildLstCogFileName(monthLabel: string): string {
  const [year, month] = monthLabel.split('-')
  return LST_COG_FILE_TEMPLATE
    .replace('{yyyy}', year)
    .replace('{mm}', month)
}

function buildTileUrl(bandIndex: number, monthLabels: string[]): string {
  const clampedBandIndex = Math.max(1, Math.min(monthLabels.length, bandIndex))
  const monthLabel = monthLabels[clampedBandIndex - 1]
  const lstSourceUrl = `${LST_COG_FOLDER_URL}/${buildLstCogFileName(monthLabel)}`
  const sourceUrl = `${lstSourceUrl}${KERALA_REGION.sourceSuffix}`
  const source = encodeURIComponent(sourceUrl)
  return `${TITILER_BASE}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}?url=${source}&bidx=1&rescale=20,45&colormap_name=inferno`
}

function App() {
  const [step, setStep] = useState(1)

  const monthLabels = useMemo(() => LST_MONTH_LABELS, [])
  const totalBands = monthLabels.length
  const safeStep = Math.max(1, Math.min(totalBands, step))
  const selectedMonth = monthLabels[safeStep - 1]
  const tileUrl = useMemo(() => buildTileUrl(safeStep, monthLabels), [monthLabels, safeStep])

  const onStepChange = (nextStep: number) => {
    setStep(nextStep)
  }

  return (
    <div className="app">
      <ControlPanel
        step={safeStep}
        selectedMonth={selectedMonth}
        timelineMonthLabels={monthLabels}
        onStepChange={onStepChange}
      />

      <main className="map-wrap">
        <AurexMap
          center={KERALA_REGION.center}
          zoom={KERALA_REGION.zoom}
          maxBounds={KERALA_LOCK_BOUNDS}
          tileUrl={tileUrl}
          tileKey={`lst-${safeStep}`}
          step={safeStep}
          selectedMonth={selectedMonth}
        />
        <CursorProbePanel />
        <StatusBar />
        <ViewportScale />
        <LayerControls />
        <TempChart />
      </main>
      <LoadingOverlay />
      <ErrorToast />
    </div>
  )
}

export default App
