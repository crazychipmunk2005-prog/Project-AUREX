import { useEffect, useState } from 'react'
import { mapRef } from '../AurexMap'

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusKm = 6371
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

function computeViewportRadiusKm(): number | null {
  const map = mapRef.current
  if (!map) {
    return null
  }

  const bounds = map.getBounds()
  const center = bounds.getCenter()
  const northEast = bounds.getNorthEast()
  return haversineKm(center.lat, center.lng, northEast.lat, northEast.lng)
}

export function ViewportScale() {
  const [radiusKm, setRadiusKm] = useState<number | null>(null)

  useEffect(() => {
    let pollTimer: number | null = null
    let cleanupMapListeners: (() => void) | null = null

    const attachToMap = (): boolean => {
      const map = mapRef.current
      if (!map) {
        return false
      }

      const update = () => {
        setRadiusKm(computeViewportRadiusKm())
      }

      update()
      map.on('zoomend', update)
      map.on('moveend', update)
      map.on('resize', update)
      cleanupMapListeners = () => {
        map.off('zoomend', update)
        map.off('moveend', update)
        map.off('resize', update)
      }

      return true
    }

    if (!attachToMap()) {
      pollTimer = window.setInterval(() => {
        if (attachToMap() && pollTimer !== null) {
          window.clearInterval(pollTimer)
          pollTimer = null
        }
      }, 250)
    }

    return () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
      }
      if (cleanupMapListeners) {
        cleanupMapListeners()
      }
    }
  }, [])

  if (radiusKm === null) {
    return null
  }

  return (
    <div className="viewport-scale" aria-label="Viewport radius">
      VIEW RADIUS: {radiusKm.toFixed(2)} km
    </div>
  )
}
