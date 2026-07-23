import { useState, useEffect, useRef, useCallback } from 'react'
import NoSleep from 'nosleep.js'

// VITE_STREAM_HOST / VITE_STREAM_PORT can be set in .env.local or via the shell:
//   VITE_STREAM_HOST=192.168.1.10 VITE_STREAM_PORT=8080 npm run dev
// If not set, HOST defaults to the page's hostname and PORT defaults to 8080.
const STREAM_HOST = import.meta.env.VITE_STREAM_HOST || window.location.hostname
const STREAM_PORT = import.meta.env.VITE_STREAM_PORT || 8080

const STREAM_URL = `http://${STREAM_HOST}:${STREAM_PORT}/stream`

const CONTROLS_TIMEOUT = 3000

export default function App() {
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(false)
  const noSleepRef = useRef(null)
  const hideTimerRef = useRef(null)

  useEffect(() => {
    noSleepRef.current = new NoSleep()
    return () => {
      noSleepRef.current.disable()
    }
  }, [])

  // Re-enable wake lock when returning to the tab while playing
  useEffect(() => {
    const onVisibility = () => {
      if (playing && document.visibilityState === 'visible') {
        noSleepRef.current.enable().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [playing])

  const requestFullscreen = useCallback(() => {
    const el = document.documentElement
    const fn =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.webkitEnterFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen
    if (fn) {
      Promise.resolve(fn.call(el)).catch(() => {})
    }
  }, [])

  const exitFullscreen = useCallback(() => {
    const fn =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen
    if (fn && (document.fullscreenElement || document.webkitFullscreenElement)) {
      Promise.resolve(fn.call(document)).catch(() => {})
    }
  }, [])

  const showControls = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_TIMEOUT)
  }, [])

  const play = useCallback(() => {
    setError(false)
    setPlaying(true)
    setControlsVisible(false)
    clearTimeout(hideTimerRef.current)
    // Both must be called within the click gesture
    noSleepRef.current.enable().catch(() => {})
    requestFullscreen()
  }, [requestFullscreen])

  const stop = useCallback(() => {
    setPlaying(false)
    setError(false)
    setControlsVisible(false)
    clearTimeout(hideTimerRef.current)
    noSleepRef.current.disable()
    exitFullscreen()
  }, [exitFullscreen])

  const handleError = useCallback(() => {
    // Ignore the error fired when src is set to '' on stop
    if (playing) {
      setError(true)
    }
  }, [playing])

  // While playing, the button is only shown after the user taps the video.
  // When stopped, the Play button is always visible.
  const buttonShown = !playing || controlsVisible

  return (
    <div className="container" onClick={playing ? showControls : undefined}>
      <img
        src={playing ? STREAM_URL : ''}
        alt="Camera stream"
        className={`stream${!playing ? ' hidden' : ''}`}
        onError={handleError}
      />

      {error && (
        <div className="error">
          <p>Stream unavailable</p>
        </div>
      )}

      <button
        className={`control${buttonShown ? '' : ' hidden'}`}
        onClick={(e) => {
          e.stopPropagation()
          playing ? stop() : play()
        }}
        aria-label={playing ? 'Stop' : 'Play'}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
    </div>
  )
}
