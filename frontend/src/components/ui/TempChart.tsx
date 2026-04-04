import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useMapStore } from '../../store/mapStore'

export function TempChart() {
  const [collapsed, setCollapsed] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [position, setPosition] = useState({ left: 16, bottom: 120 })
  const [dragging, setDragging] = useState(false)
  const timeseriesData = useMapStore((store) => store.timeseriesData)

  const anchorStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      left: `${position.left}px`,
      bottom: `${position.bottom}px`,
      zIndex: expanded ? 1100 : 1000,
      width: expanded ? 'min(92vw, 900px)' : '420px',
      height: collapsed ? 'auto' : expanded ? 'min(72vh, 560px)' : '220px',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      background: 'color-mix(in srgb, var(--bg-panel) 94%, transparent)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      flexDirection: 'column' as const,
      boxShadow: dragging ? '0 0 0 1px var(--accent)' : 'none',
    }),
    [collapsed, dragging, expanded, position.bottom, position.left],
  )

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const startX = event.clientX
    const startY = event.clientY
    const originLeft = position.left
    const originBottom = position.bottom
    setDragging(true)
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const deltaX = moveEvent.clientX - startX
      const deltaY = moveEvent.clientY - startY
      const nextLeft = Math.max(8, originLeft + deltaX)
      const nextBottom = Math.max(8, originBottom - deltaY)
      setPosition({ left: nextLeft, bottom: nextBottom })
    }

    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (!timeseriesData) {
    return null
  }

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        style={{
          position: 'absolute',
          left: '1rem',
          bottom: '1rem',
          zIndex: 1000,
          border: '1px solid var(--border)',
          borderRadius: '4px',
          background: 'color-mix(in srgb, var(--bg-panel) 94%, transparent)',
          color: 'var(--accent)',
          fontFamily: "'Consolas', 'Courier New', monospace",
          fontSize: '0.72rem',
          letterSpacing: '0.05em',
          padding: '6px 8px',
          cursor: 'pointer',
        }}
      >
        SHOW TIME SERIES
      </button>
    )
  }

  const chartData = timeseriesData.series.map((point, index) => ({
    ...point,
    tickLabel: index % (expanded ? 2 : 4) === 0 ? point.date : '',
  }))

  return (
    <section
      aria-label="Temperature time series panel"
      style={anchorStyle}
    >
      <div
        style={{
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          padding: '6px 8px',
        }}
      >
        <button
          type="button"
          onPointerDown={startDrag}
          style={{
            border: '1px dashed var(--border-soft)',
            borderRadius: '4px',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: '0.7rem',
            letterSpacing: '0.04em',
            padding: '3px 6px',
            cursor: dragging ? 'grabbing' : 'grab',
          }}
          title="Drag to reposition chart"
        >
          MOVE
        </button>

        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--accent)',
            fontFamily: "'Consolas', 'Courier New', monospace",
            fontSize: '0.75rem',
            letterSpacing: '0.06em',
            textAlign: 'left',
            padding: '0',
            cursor: 'pointer',
            flex: 1,
          }}
        >
          LST TIME SERIES · {timeseriesData.image_count} LANDSAT SCENES
        </button>

        <button
          type="button"
          onClick={() => setHidden(true)}
          style={{
            border: '1px solid var(--border-soft)',
            borderRadius: '4px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: '0.7rem',
            padding: '3px 6px',
            cursor: 'pointer',
          }}
          title="Hide chart panel"
        >
          HIDE
        </button>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          style={{
            border: '1px solid var(--border-soft)',
            borderRadius: '4px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: '0.7rem',
            padding: '3px 6px',
            cursor: 'pointer',
          }}
          title={expanded ? 'Return chart to compact size' : 'Expand chart for detail'}
        >
          {expanded ? 'SHRINK' : 'EXPAND'}
        </button>
      </div>

      {collapsed ? null : (
        <div style={{ flex: 1, padding: '8px 8px 6px' }}>
          {chartData.length === 0 ? (
            <div
              style={{
                color: 'var(--text-muted)',
                fontSize: '0.82rem',
                height: '100%',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              No cloud-free scenes in this window
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="tempChartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>

                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  tickFormatter={(_value, index) => chartData[index]?.tickLabel ?? ''}
                  minTickGap={8}
                />
                <YAxis
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  label={{ value: '°C', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }}
                  domain={['auto', 'auto']}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-panel)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                  formatter={(value) => {
                    const numeric = typeof value === 'number' ? value : Number(value)
                    const display = Number.isFinite(numeric) ? numeric.toFixed(2) : String(value)
                    return [`${display} °C`, 'Temp']
                  }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                />
                <Area type="monotone" dataKey="temp" stroke="var(--accent)" strokeWidth={2} fill="url(#tempChartGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </section>
  )
}
