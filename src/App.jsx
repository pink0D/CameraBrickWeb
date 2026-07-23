import { useState, useEffect, useRef, useCallback } from 'react'
import NoSleep from 'nosleep.js'
import { useAppConfig } from './config'
import { useGamepad } from './gamepad'

const CONTROLS_TIMEOUT = 3000

export default function App() {
  const { config, loading } = useAppConfig()

  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(false)
  const noSleepRef = useRef(null)
  const hideTimerRef = useRef(null)

  // Gamepad support — driven entirely by runtime config
  const { gamepadConnected, gamepadPrompt } = useGamepad({
    enabled: config.gamepadEnabled,
    wsUrl:   config.gamepadWsUrl,
    playing,
  })

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

  // Block rendering until remote config is resolved so all URLs are correct
  if (loading) return null

  return (
    <div className="container" onClick={playing ? showControls : undefined}>
      <img
        src={playing ? config.streamUrl : ''}
        alt="Camera stream"
        className={`stream${!playing ? ' hidden' : ''}`}
        onError={handleError}
      />

      {error && (
        <div className="error">
          <p>Stream unavailable</p>
        </div>
      )}

      {/* Gamepad "click a button" prompt — shown above the video frame */}
      {config.gamepadEnabled && gamepadPrompt && (
        <div className="gamepad-prompt">
          {gamepadPrompt === 'initial'
            ? 'Click any button on the gamepad'
            : 'Ensure the controller is listed in connected Bluetooth devices, then click any button on the gamepad'}
        </div>
      )}

      {/* Gamepad connection status indicator — top-left corner, only while polling */}
      {config.gamepadEnabled && playing && (
        <div
          className={`gamepad-indicator${gamepadConnected ? ' gamepad-indicator--on' : ''}`}
          title={gamepadConnected ? 'Gamepad connected' : 'Gamepad disconnected'}
          aria-label={gamepadConnected ? 'Gamepad connected' : 'Gamepad disconnected'}
        >
          {/* Generic gamepad icon */}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M17 6H7C3.69 6 1 8.69 1 12s2.69 6 6 6h10c3.31 0 6-2.69 6-6s-2.69-6-6-6zm-9 7H7v1a1 1 0 0 1-2 0v-1H4a1 1 0 0 1 0-2h1v-1a1 1 0 0 1 2 0v1h1a1 1 0 0 1 0 2zm7 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm2-2a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
          </svg>
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

      {config.settingsUrl && (
        <button
          className="settings-btn"
          onClick={(e) => {
            e.stopPropagation()
            window.location.href = config.settingsUrl
          }}
          aria-label="Settings"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.01 7.01 0 0 0-1.62-.94l-.36-2.54A.484.484 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.63 8.48a.48.48 0 0 0 .12.61l2.03 1.58C4.74 11.36 4.72 11.67 4.72 12s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.04.7 1.62.94l.36 2.54c.05.24.26.42.49.42h4c.25 0 .46-.18.49-.42l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </button>
      )}
    </div>
  )
}
