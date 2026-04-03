import type { BBox } from '../types/geo'

type StatsPanelProps = {
  bbox: BBox
}

function formatCoord(value: number): string {
  return value.toFixed(4)
}

export function StatsPanel({ bbox }: StatsPanelProps) {
  return (
    <div className="control-block">
      <label>Stats</label>
      <div className="bbox-grid">
        <div>
          <span>minLon</span>
          <strong>{formatCoord(bbox.minLon)}</strong>
        </div>
        <div>
          <span>minLat</span>
          <strong>{formatCoord(bbox.minLat)}</strong>
        </div>
        <div>
          <span>maxLon</span>
          <strong>{formatCoord(bbox.maxLon)}</strong>
        </div>
        <div>
          <span>maxLat</span>
          <strong>{formatCoord(bbox.maxLat)}</strong>
        </div>
      </div>

      <div className="lst-legend" aria-label="LST palette legend">
        <div className="lst-legend-bar" />
        <div className="lst-legend-labels">
          <span>20°C</span>
          <span>50°C</span>
        </div>
      </div>
    </div>
  )
}
