import { useMemo, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import './App.css'

type Metric = 'lst' | 'ndvi'
type Region = 'westcoast' | 'kerala'

const TITILER_BASE = 'https://aurex-tiles.onrender.com'

const COG_URLS = {
  lst: 'https://raw.githubusercontent.com/crazychipmunk2005-prog/Project-AUREX/main/x-data/v1/region/lst/aurex_westcoast_context_lst_2019_2024_monthly_stack_v1.tif',
  ndvi:
    'https://raw.githubusercontent.com/crazychipmunk2005-prog/Project-AUREX/main/x-data/v1/region/ndvi/aurex_westcoast_context_ndvi_2019_2024_monthly_stack_v1.tif',
} as const

const REGION_CONFIG = {
  westcoast: {
    label: 'Westcoast Context',
    center: [10.6, 76.2] as [number, number],
    zoom: 7,
    sourceSuffix: '',
  },
  kerala: {
    label: 'Kerala Focus',
    center: [10.35, 76.35] as [number, number],
    zoom: 8,
    sourceSuffix: '?v=2',
  },
} as const

const START_YEAR = 2019
const END_YEAR = 2024

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

function buildTileUrl(metric: Metric, region: Region, bandIndex: number): string {
  const sourceUrl = `${COG_URLS[metric]}${REGION_CONFIG[region].sourceSuffix}`
  const source = encodeURIComponent(sourceUrl)
  const rescale = metric === 'lst' ? '20,45' : '0,1'
  const colormap = metric === 'lst' ? 'inferno' : 'ylgn'
  return `${TITILER_BASE}/cog/tiles/{z}/{x}/{y}?url=${source}&bidx=${bandIndex}&rescale=${rescale}&colormap_name=${colormap}`
}

function App() {
  const [metric, setMetric] = useState<Metric>('lst')
  const [region, setRegion] = useState<Region>('westcoast')
  const [step, setStep] = useState(1)

  const selectedMonth = MONTH_LABELS[step - 1]
  const tileUrl = useMemo(() => buildTileUrl(metric, region, step), [metric, region, step])

  return (
    <div className="app">
      <aside className="panel">
        <div className="brand">
          <img src="/aurex-logo.png" alt="AUREX logo" className="brand-logo" />
          <h1>AUREX</h1>
        </div>
        <p className="sub">Kerala + Lakshadweep Historical Explorer</p>

        <div className="control-block">
          <label htmlFor="region">Region</label>
          <select
            id="region"
            value={region}
            onChange={(event) => setRegion(event.target.value as Region)}
          >
            <option value="westcoast">Westcoast Context</option>
            <option value="kerala">Kerala Focus</option>
          </select>
        </div>

        <div className="control-block">
          <label>Metric</label>
          <div className="toggle-row">
            <button
              className={metric === 'lst' ? 'active' : ''}
              onClick={() => setMetric('lst')}
            >
              LST
            </button>
            <button
              className={metric === 'ndvi' ? 'active' : ''}
              onClick={() => setMetric('ndvi')}
            >
              NDVI
            </button>
          </div>
        </div>

        <div className="control-block">
          <label htmlFor="timeline">Timeline: {selectedMonth}</label>
          <input
            id="timeline"
            type="range"
            min={1}
            max={72}
            value={step}
            onChange={(event) => setStep(Number(event.target.value))}
          />
          <div className="hint">Band {step} of 72</div>
        </div>
      </aside>

      <main className="map-wrap">
        <MapContainer
          key={region}
          center={REGION_CONFIG[region].center}
          zoom={REGION_CONFIG[region].zoom}
          className="map"
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <TileLayer key={`${metric}-${step}`} url={tileUrl} opacity={0.75} />
        </MapContainer>
      </main>
    </div>
  )
}

export default App
