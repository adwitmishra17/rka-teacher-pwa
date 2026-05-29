import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

// supabase-js v2 eagerly constructs a RealtimeClient inside createClient(). On
// Node < 22 (Hostinger runs Node 20), newer @supabase/realtime-js THROWS at
// construction when there is no global WebSocket:
//   "Node.js 20 detected without native WebSocket support"
// We never use realtime here (REST only), but construction still requires a
// WebSocket constructor to exist. Provide one from the `ws` package — both as the
// global that realtime-js probes for AND via the realtime transport option.
if (!globalThis.WebSocket) globalThis.WebSocket = ws

// Service-role key — NEVER expose this to the browser.
// Client is created lazily so missing env vars don't crash the server on startup.
let _client = null

export function getSupabase() {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars are not set')
  _client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  })
  return _client
}

// Convenience alias — routes import `supabase` and call it like a client.
// The client is created lazily on first property access.
//
// CRITICAL: methods must be BOUND to the real client. Returning `client[prop]`
// unbound means `supabase.from(...)` runs with `this` = this Proxy, not the
// SupabaseClient. supabase-js reads `this.rest`, `this.headers`, and (in some
// versions) private `#fields` internally — with the wrong `this` that throws,
// and because route handlers are `async`, Express 4 doesn't catch it: the
// rejection is unhandled and Node ≥18 kills the whole process (→ 503 + restart).
// Binding to the real client makes `this` correct so the call works normally.
export const supabase = new Proxy({}, {
  get(_t, prop) {
    const client = getSupabase()
    const value = client[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})
