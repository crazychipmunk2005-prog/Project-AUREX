import { useMapStore } from '../../store/mapStore'

export function LoadingOverlay() {
  const loading = useMapStore((store) => store.loading)

  return (
    <div className={`loading-overlay ${loading ? 'is-visible' : ''}`} aria-hidden={!loading}>
      <div className="loading-radar" aria-label="Loading">
        <span className="ring ring-a" />
        <span className="ring ring-b" />
      </div>
      <div className="loading-title">ANALYSING THERMAL DATA...</div>
      <div className="loading-subtext">Querying Landsat satellite archive</div>
    </div>
  )
}
