import { useState, useEffect } from 'react'

// ── Vite build-time defaults (lowest priority) ────────────────────────────────
const VITE_DEFAULTS = {
  streamUrl:      import.meta.env.VITE_STREAM_URL || `http://${window.location.hostname}:8080/stream`,
  settingsUrl:    import.meta.env.VITE_SETTINGS_URL    || '',
  gamepadEnabled: import.meta.env.VITE_GAMEPAD_ENABLED || 'false',
  gamepadWsUrl:   import.meta.env.VITE_GAMEPAD_WS_URL  || '',
}

// URL of the remote config REST endpoint (optional)
const CONFIG_URL = import.meta.env.VITE_CONFIG_URL || ''

/**
 * Maps raw API response keys → internal config shape.
 * Expected response JSON:
 *   {
 *     "stream_url":      "http://host:port/path",
 *     "settings_url":    "http://host:port/path",
 *     "gamepad_ws_url":  "ws://host:port/path",
 *     "gamepad_enabled": true
 *   }
 * Any key absent from the response keeps its Vite default value.
 */
function mergeApiResponse(defaults, raw) {
  const out = { ...defaults }
  if (raw.stream_url      != null) out.streamUrl      = String(raw.stream_url)
  if (raw.settings_url    != null) out.settingsUrl    = String(raw.settings_url)
  if (raw.gamepad_ws_url  != null) out.gamepadWsUrl   = String(raw.gamepad_ws_url)
  if (raw.gamepad_enabled != null) out.gamepadEnabled = Boolean(raw.gamepad_enabled)
  return out
}

/**
 * useAppConfig()
 *
 * Fetches remote config from VITE_CONFIG_URL on mount and merges it with
 * Vite build-time defaults. Remote values take precedence.
 * If VITE_CONFIG_URL is not set, resolves immediately with Vite defaults.
 *
 * Returns { config, loading }
 *   config  — always a fully-populated object (never null)
 *   loading — true only while the remote fetch is in flight
 */
export function useAppConfig() {
  const [config,  setConfig]  = useState(VITE_DEFAULTS)
  const [loading, setLoading] = useState(!!CONFIG_URL)

  useEffect(() => {
    if (!CONFIG_URL) return

    let cancelled = false

    fetch(CONFIG_URL)
      .then(r => {
        if (!r.ok) throw new Error(`Config fetch failed: ${r.status}`)
        return r.json()
      })
      .then(raw => {
        if (!cancelled) setConfig(mergeApiResponse(VITE_DEFAULTS, raw))
      })
      .catch(err => {
        console.error('App config: fetch failed, using Vite defaults.', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, []) // run once on mount

  return { config, loading }
}
