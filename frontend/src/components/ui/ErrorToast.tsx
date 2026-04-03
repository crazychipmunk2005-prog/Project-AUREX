import { useEffect } from 'react'
import { useMapStore } from '../../store/mapStore'

export function ErrorToast() {
  const error = useMapStore((store) => store.error)
  const setError = useMapStore((store) => store.setError)

  useEffect(() => {
    if (!error) {
      return
    }

    const timer = window.setTimeout(() => {
      setError(null)
    }, 5000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [error, setError])

  return (
    <div className={`error-toast ${error ? 'is-visible' : ''}`} role="status" aria-live="polite">
      <span>{error ?? ''}</span>
      <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
        X
      </button>
    </div>
  )
}
