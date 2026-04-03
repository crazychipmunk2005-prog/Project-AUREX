import { useMapStore } from '../../store/mapStore'

export function LayerControls() {
  const tileOpacity = useMapStore((store) => store.tileOpacity)
  const setTileOpacity = useMapStore((store) => store.setTileOpacity)
  const layerVisible = useMapStore((store) => store.layerVisible)
  const toggleLayer = useMapStore((store) => store.toggleLayer)
  const basemap = useMapStore((store) => store.basemap)
  const setBasemap = useMapStore((store) => store.setBasemap)
  const showMapDetails = useMapStore((store) => store.showMapDetails)
  const toggleMapDetails = useMapStore((store) => store.toggleMapDetails)

  return (
    <div className="layer-controls" aria-label="Layer Controls">
      <div className="layer-controls-title">Layer Controls</div>
      <label htmlFor="opacity" className="layer-controls-label">
        Opacity {tileOpacity.toFixed(2)}
      </label>
      <input
        id="opacity"
        type="range"
        min={0.2}
        max={1}
        step={0.05}
        value={tileOpacity}
        onChange={(event) => setTileOpacity(Number(event.target.value))}
      />
      <label htmlFor="basemap" className="layer-controls-label">
        Base Map
      </label>
      <select id="basemap" value={basemap} onChange={(event) => setBasemap(event.target.value as 'street' | 'satellite' | 'terrain')}>
        <option value="street">Street</option>
        <option value="satellite">Satellite</option>
        <option value="terrain">Terrain</option>
      </select>
      <button
        type="button"
        className={`layer-toggle ${showMapDetails ? 'is-on' : 'is-off'}`}
        onClick={toggleMapDetails}
      >
        {showMapDetails ? 'MAP DETAILS ON' : 'MAP DETAILS OFF'}
      </button>
      <button
        type="button"
        className={`layer-toggle ${layerVisible ? 'is-on' : 'is-off'}`}
        onClick={toggleLayer}
      >
        {layerVisible ? 'HEAT LAYER ON' : 'HEAT LAYER OFF'}
      </button>
    </div>
  )
}
