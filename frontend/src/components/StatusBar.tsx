import { useMapStore } from '../store/mapStore'

export function StatusBar() {
  const queryMeta = useMapStore((store) => store.queryMeta)

  if (!queryMeta) {
    return null
  }

  const modeLabel = queryMeta.mode === 'anomaly' ? 'LST ANOMALY' : 'LST'
  const text = `${modeLabel} · MODIS MOD11A2 · ${queryMeta.startDate} → ${queryMeta.endDate} · ${
    queryMeta.cached ? 'CACHED' : 'LIVE'
  }`

  return (
    <div className="status-bar-wrap">
      <div key={text} className="status-bar">
        {text}
      </div>
      <div className="status-note">MODIS resolution is ~1km and best for regional patterns.</div>
    </div>
  )
}
