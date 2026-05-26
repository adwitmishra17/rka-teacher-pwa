import { createClient } from '@supabase/supabase-js'

// Service-role key — NEVER expose this to the browser.
// Client is created lazily so missing env vars don't crash the server on startup.
let _client = null

export function getSupabase() {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars are not set')
  _client = createClient(url, key, { auth: { persistSession: false } })
  return _client
}

// Convenience alias — routes import `supabase` and call it like a client.
// With lazy init, routes must call getSupabase() instead. Update alias:
export const supabase = new Proxy({}, {
  get(_t, prop) { return getSupabase()[prop] },
})
