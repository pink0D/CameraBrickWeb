import { useEffect, useRef, useState, useCallback } from 'react'

const PROMPT_TIMEOUT_MS = 10_000

/**
 * Evaluate WiFi signal level from RSSI value (dBm).
 * Returns one of: 'good', 'fair', 'poor', 'none'
 */
function evalWifiLevel(rssi) {
  if (rssi == null || Number.isNaN(rssi)) return null
  if (rssi >= -60) return 'good'
  if (rssi >= -75) return 'fair'
  if (rssi >= -85) return 'poor'
  return 'none'
}

/**
 * useGamepad({ enabled, wsUrl, playing })
 *
 * Manages HTML5 Gamepad API polling, the "click a button" prompt,
 * forwarding gamepad data over a WebSocket, and receiving incoming
 * WebSocket messages (e.g. RSSI) — all tied to video playback.
 *
 * Parameters:
 *   enabled {boolean}  – whether gamepad support is active (from config)
 *   wsUrl   {string}   – WebSocket URL for gamepad/RSSI data (from config)
 *   playing {boolean}  – whether video playback is active
 *
 * Returns:
 *   gamepadConnected {boolean}               – gamepad visible to the browser
 *   gamepadPrompt   {null|'initial'|'retry'} – which prompt message to show
 *   wifiLevel       {null|'good'|'fair'|'poor'|'none'} – WiFi signal level
 */
export function useGamepad({ enabled, wsUrl, playing }) {
  const [gamepadConnected, setGamepadConnected] = useState(false)
  const [gamepadPrompt, setGamepadPrompt]       = useState(null)
  const [wifiLevel, setWifiLevel]               = useState(null)

  // Refs shared between the polling loop and event handlers
  const wsRef            = useRef(null)   // active WebSocket
  const gamepadIndexRef  = useRef(null)   // index of the first gamepad we've locked onto
  const lastTimestampRef = useRef(0)      // last gp.timestamp we processed
  const hasDataRef       = useRef(false)  // have we received any gamepad data this session?
  const connectedRef     = useRef(false)  // shadow of gamepadConnected (avoids stale closures)

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Set gamepadConnected only when it actually changes (avoids 60 fps re-renders). */
  const updateConnected = useCallback((val) => {
    if (val !== connectedRef.current) {
      connectedRef.current = val
      setGamepadConnected(val)
    }
  }, [])

  // ── Gamepad connect / disconnect events ─────────────────────────────────────
  useEffect(() => {
    if (!enabled) return

    // Detect gamepads that the browser already knows about
    // (e.g. after a page refresh with a gamepad already paired)
    const initial = navigator.getGamepads?.() ?? []
    for (let i = 0; i < initial.length; i++) {
      if (initial[i]) {
        // Don't lock the index here; let the poll loop pick the first one.
        updateConnected(true)
        break
      }
    }

    const onConnect = (e) => {
      // Only track the very first gamepad; ignore extras
      if (gamepadIndexRef.current === null || e.gamepad.index === gamepadIndexRef.current) {
        gamepadIndexRef.current = e.gamepad.index
        updateConnected(true)
      }
    }

    const onDisconnect = (e) => {
      if (e.gamepad.index === gamepadIndexRef.current) {
        // Release the index so the next available gamepad becomes "first"
        gamepadIndexRef.current = null
        updateConnected(false)
      }
    }

    window.addEventListener('gamepadconnected',    onConnect)
    window.addEventListener('gamepaddisconnected', onDisconnect)
    return () => {
      window.removeEventListener('gamepadconnected',    onConnect)
      window.removeEventListener('gamepaddisconnected', onDisconnect)
    }
  }, [enabled, updateConnected])

  // ── Polling loop — starts / stops with video playback ──────────────────────
  useEffect(() => {
    if (!enabled || !playing) return

    // Reset WiFi level when playback starts
    setWifiLevel(null)

    // Open WebSocket
    if (wsUrl) {
      try {
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        // ── Incoming WS messages (e.g. WiFi RSSI) ───────────────────────
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            // Try several common keys for RSSI
            const rssi = data.rssi ?? data.RSSI ?? data.signal ?? data.Signal
            if (rssi != null) {
              const r = Number(rssi)
              if (!Number.isNaN(r)) {
                setWifiLevel(evalWifiLevel(r))
              }
            }
          } catch (_) {
            // Ignore non-JSON or malformed messages
          }
        }
      } catch (err) {
        console.error('Gamepad WS: failed to open', err)
      }
    }

    // Reset per-session state and show the initial prompt
    hasDataRef.current       = false
    lastTimestampRef.current = 0
    setGamepadPrompt('initial')

    // After 10 s without any input, escalate the prompt
    const promptTimer = setTimeout(() => {
      if (!hasDataRef.current) setGamepadPrompt('retry')
    }, PROMPT_TIMEOUT_MS)

    // ── RAF polling loop ───────────────────────────────────────────────────
    let rafId
    const poll = () => {
      const gamepads = navigator.getGamepads?.() ?? []

      // Prefer the already-locked gamepad; fall back to first available
      let gp = gamepadIndexRef.current !== null
        ? (gamepads[gamepadIndexRef.current] ?? null)
        : null

      if (!gp) {
        for (let i = 0; i < gamepads.length; i++) {
          if (gamepads[i]) { gp = gamepads[i]; gamepadIndexRef.current = i; break }
        }
      }

      // Keep the connection indicator in sync with what the poll sees
      updateConnected(gp != null)

      // Only act when the browser reports genuinely new data (timestamp changed)
      if (gp && gp.timestamp !== lastTimestampRef.current) {
        lastTimestampRef.current = gp.timestamp

        // First data received → hide the prompt
        if (!hasDataRef.current) {
          hasDataRef.current = true
          clearTimeout(promptTimer)
          setGamepadPrompt(null)
        }

        // Forward to WebSocket, mirroring the Gamepad JS object structure
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            id:        gp.id,
            index:     gp.index,
            connected: gp.connected,
            timestamp: gp.timestamp,
            mapping:   gp.mapping,
            axes:      Array.from(gp.axes),
            buttons:   Array.from(gp.buttons).map(b => ({
              pressed: b.pressed,
              touched: b.touched,
              value:   b.value,
            })),
          }))
        }
      }

      rafId = requestAnimationFrame(poll)
    }

    rafId = requestAnimationFrame(poll)

    // ── Cleanup (called when playing → false or on unmount) ────────────────
    return () => {
      cancelAnimationFrame(rafId)
      clearTimeout(promptTimer)
      setGamepadPrompt(null)
      setWifiLevel(null)
      hasDataRef.current       = false
      lastTimestampRef.current = 0
      // Keep gamepadIndexRef so we reuse the same gamepad on next play
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [enabled, wsUrl, playing, updateConnected])

  return { gamepadConnected, gamepadPrompt, wifiLevel }
}