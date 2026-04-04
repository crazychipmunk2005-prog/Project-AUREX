import { useMapStore } from '../store/mapStore'

export function StatusBar() {
  const queryMeta = useMapStore((store) => store.queryMeta)

  if (!queryMeta) {
    return null
  }

  const modeLabel = queryMeta.mode === 'anomaly' ? 'LST ANOMALY' : 'LST'
  const text = `${modeLabel} · Landsat 8/9 · ${queryMeta.startDate} → ${queryMeta.endDate} · ${
    queryMeta.cached ? 'CACHED' : 'LIVE'
  }`

  return (
    <div className="status-bar-wrap">
      <div key={text} className="status-bar">
        {text}
      </div>
      <div className="status-note">Landsat resolution is ~30m and shows fine local detail.</div>
    </div>
  )
}
