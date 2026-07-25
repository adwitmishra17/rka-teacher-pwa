import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

// Same Node-20 WebSocket shim as lib/supabase.js — supabase-js constructs a
// RealtimeClient eagerly and throws without a WebSocket global. REST only here.
if (!globalThis.WebSocket) globalThis.WebSocket = ws

// Client for the HRMS / attendance Supabase project (rka-attendance) — a
// DIFFERENT project from lib/supabase.js (which points at the SMS project for
// exam/marks routes). Used by the Hikvision punch receiver.
// Service-role key — NEVER expose this to the browser.
let _client = null

export function getHrmsSupabase() {
  if (_client) return _client
  const url = process.env.HRMS_SUPABASE_URL
  const key = process.env.HRMS_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('HRMS_SUPABASE_URL / HRMS_SUPABASE_SERVICE_ROLE_KEY env vars are not set')
  _client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  })
  return _client
}

export function hrmsConfigured() {
  return Boolean(
    process.env.HRMS_SUPABASE_URL &&
    process.env.HRMS_SUPABASE_SERVICE_ROLE_KEY &&
    process.env.HIK_SHARED_SECRET
  )
}
