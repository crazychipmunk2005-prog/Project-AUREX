import { TileLayer } from 'react-leaflet'

type TileOverlayProps = {
  tileKey: string
  tileUrl: string
  opacity: number
}

export function TileOverlay({ tileKey, tileUrl, opacity }: TileOverlayProps) {
  return <TileLayer key={tileKey} url={tileUrl} opacity={opacity} />
}
