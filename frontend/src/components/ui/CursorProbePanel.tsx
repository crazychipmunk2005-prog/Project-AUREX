import { useMapStore } from '../../store/mapStore'

export function CursorProbePanel() {
  const cursorProbe = useMapStore((store) => store.cursorProbe)

  if (!cursorProbe) {
    return null
  }

  return (
    <div className="cursor-probe">
      <div className="cursor-probe-title">Cursor Probe</div>
      <div>
        Lat/Lon: {cursorProbe.lat.toFixed(4)}, {cursorProbe.lon.toFixed(4)}
      </div>
      <div>Avg Temp: {cursorProbe.avg_temp.toFixed(2)}°C</div>
      <div>Anomaly: {cursorProbe.anomaly_temp.toFixed(2)}°C</div>
      <div>Wind: {cursorProbe.wind_speed.toFixed(2)} m/s</div>
    </div>
  )
}
