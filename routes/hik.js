import express from 'express'
import { getHrmsSupabase, hrmsConfigured } from '../lib/hrmsSupabase.js'

// ============================================================================
// /hik/punch — Hikvision attendance receiver (port of the hik-punch Supabase
// edge function). The devices' HTTP Listening Server POSTs here instead of the
// edge function so that heartbeats (a keepalive every few seconds, ~99% of all
// requests) are absorbed by this always-on server for free — Supabase is only
// called for real authentication events, via the unmetered REST API.
//
// Mounted BEFORE the global express.json() so this router controls its own
// body parsing: devices push multipart/form-data (JSON part + snapshot image)
// or plain JSON depending on firmware/config.
//
// Auth (either):
//   1. `?token=<secret>` query string — what the device URL carries.
//   2. HTTP Basic Auth password — for curl/manual testing.
// Both compare against HIK_SHARED_SECRET (same value the edge function uses).
//
// Idempotency: upsert on (kiosk_device_id, device_event_id) — device retries
// and edge-function/Hostinger overlap during migration merge silently.
// ============================================================================

const router = express.Router()

// Hikvision "minor" event codes that mean "successful authentication".
// 75 = multi-method authenticated success on K1Tx terminals, 38 = legacy
// successful auth on older firmware. Everything else (failed auths, tamper,
// online/offline pings) is acknowledged with 200 and skipped.
const SUCCESS_MINOR_CODES = new Set([75, 38])

// Snapshot payloads can reach a few hundred KB; 10 MB is comfortable headroom.
const rawBody = express.raw({ type: () => true, limit: '10mb' })

// Liveness ledger — every AUTHENTICATED device request (heartbeats included,
// which never reach the database) stamps its branch here. In-memory on
// purpose: a restart repopulates within one heartbeat interval.
const deviceSeen = new Map() // branch -> { mac, lastSeenMs }

function markSeen(branch, mac) {
  const cur = deviceSeen.get(branch) || {}
  deviceSeen.set(branch, { mac: mac || cur.mac || null, lastSeenMs: Date.now() })
}

// Deploy/config probe: confirms the route is live and env vars landed,
// without leaking any values. Safe to open in a browser.
router.get('/health', (_req, res) => {
  res.json({ ok: true, configured: hrmsConfigured() })
})

// Public read-only device liveness for the HRMS dashboard. No secrets, no
// MACs beyond what the school's own devices broadcast; CORS open because the
// HRMS admin runs on a different origin (Vercel).
router.get('/status', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Cache-Control', 'no-store')
  const now = Date.now()
  const devices = [...deviceSeen.entries()].map(([branch, d]) => ({
    branch,
    secondsAgo: Math.round((now - d.lastSeenMs) / 1000),
    online: now - d.lastSeenMs < 90_000,
  }))
  res.json({ now: new Date(now).toISOString(), devices })
})

router.post('/punch', rawBody, async (req, res) => {
  // Own catch so a throw returns 500 (device retries) instead of hanging the
  // request until the process-level unhandledRejection logger swallows it.
  try {
    await handlePunch(req, res)
  } catch (e) {
    console.error('[hik] handler error:', e && e.stack ? e.stack : e)
    if (!res.headersSent) res.status(500).json({ error: 'internal' })
  }
})

async function handlePunch(req, res) {
  const HIK_SECRET = process.env.HIK_SHARED_SECRET

  // -------- 1. Auth -------------------------------------------------------
  if (!HIK_SECRET) {
    console.error('[hik] HIK_SHARED_SECRET not configured')
    return res.status(500).json({ error: 'server_misconfigured' })
  }

  const queryToken = String(req.query.token || '')
  const authHeader = req.headers.authorization || ''
  let basicPassword = ''
  if (authHeader.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8')
      basicPassword = decoded.split(':').slice(1).join(':') // password may contain ':'
    } catch {
      // bad base64 — fall through
    }
  }

  const providedSecret = queryToken || basicPassword
  const authed = providedSecret && providedSecret === HIK_SECRET
  if (authed) {
    // Any valid device request — heartbeat or punch — proves the device is up.
    markSeen(String(req.query.branch || 'MAIN').toUpperCase())
  }
  if (!authed) {
    const authScheme = authHeader.split(' ')[0] || '(none)'
    console.log('[hik] auth_failed: scheme=%s header_len=%d query_token_present=%s',
      JSON.stringify(authScheme), authHeader.length, !!queryToken)
    return res.status(401).json({ error: 'unauthorized' })
  }

  // -------- 2. Parse body -------------------------------------------------
  // Hikvision sends multipart/form-data with one JSON part named "event_log"
  // (plus optional snapshot image parts), or a plain JSON body.
  // NOTE: keep the original casing — the multipart boundary is case-sensitive.
  const contentType = String(req.headers['content-type'] || '')
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)

  let payload = null
  if (contentType.toLowerCase().includes('multipart')) {
    payload = extractJsonFromMultipart(buf, contentType)
  } else {
    // JSON content-type or last-ditch: try to parse the raw text as JSON.
    try { payload = JSON.parse(buf.toString('utf8')) } catch { /* leave null */ }
  }

  if (!payload) {
    return res.json({ skipped: 'no_json_in_body' }) // 200 so device doesn't retry forever
  }

  // -------- 3. Filter to access-control success events --------------------
  // Heartbeats and non-access events die HERE — no Supabase call is made.
  if (payload.eventType !== 'AccessControllerEvent') {
    if (process.env.HIK_DEBUG) console.log('[hik] skipped non-access event:', payload.eventType)
    return res.json({ skipped: 'not_access_event', eventType: payload.eventType })
  }
  const ace = payload.AccessControllerEvent || {}
  const minor = Number(ace.minor || ace.subEventType || 0)
  if (!SUCCESS_MINOR_CODES.has(minor)) {
    return res.json({ skipped: 'not_success_event', minor })
  }
  const employeeNoString = ace.employeeNoString || (ace.employeeNo ? String(ace.employeeNo) : '')
  if (!employeeNoString) {
    return res.json({ skipped: 'no_employee_id_on_event' })
  }
  const dateTime = payload.dateTime || ace.time
  if (!dateTime) {
    return res.json({ skipped: 'no_timestamp' })
  }

  // -------- 4. Branch resolution + employee lookup ------------------------
  const branchFromQuery = String(req.query.branch || 'MAIN').toUpperCase()

  const supabase = getHrmsSupabase()

  const { data: emp, error: empErr } = await supabase
    .from('employees')
    .select('id, branch_codes')
    .eq('biometric_code', employeeNoString)
    .maybeSingle()

  if (empErr) {
    console.error('[hik] employee lookup error:', empErr)
    // Don't 500 — let the event log itself with employee_id=null so we can
    // see unmatched punches and clean them up later.
  }

  const employeeId = emp?.id ?? null
  // Branch precedence: matched employee → URL query param → 'MAIN'
  const branchCode = (emp?.branch_codes && emp.branch_codes[0]) || branchFromQuery

  // -------- 5. Derive event_type (in / out) ------------------------------
  // Hikvision sends attendanceStatus = "checkIn" | "checkOut" | "undefined".
  // On the value-series DS-K1T320EFWX without an explicit IN/OUT button it's
  // almost always "undefined" → alternate off the employee's last event today;
  // first-of-day is "in".
  let eventType
  const attStatus = String(ace.attendanceStatus || '').toLowerCase()
  if (attStatus === 'checkin') eventType = 'in'
  else if (attStatus === 'checkout') eventType = 'out'
  else if (employeeId) {
    const { data: prevList } = await supabase
      .from('attendance_events')
      .select('event_type')
      .eq('employee_id', employeeId)
      .gte('event_time', isoDayStart(dateTime))
      .lt('event_time', isoDayEnd(dateTime))
      .order('event_time', { ascending: false })
      .limit(1)
    const prev = prevList && prevList[0]
    eventType = prev?.event_type === 'in' ? 'out' : 'in'
  } else {
    // No employee match → can't alternate. Default 'in'; admin will reconcile.
    eventType = 'in'
  }

  // -------- 6. Build dedupe key ------------------------------------------
  // Hikvision serialNo is a per-device monotonic counter — perfect idempotency
  // key composed with the device MAC so two devices' serialNos can't collide.
  const deviceEventId = String(ace.serialNo || `${dateTime}-${employeeNoString}`)
  const kioskDeviceId =
    payload.macAddress ||
    payload.MACAddr ||
    ace.MACAddr ||
    ace.deviceName ||
    `hik-${branchCode.toLowerCase()}`

  // -------- 7. Insert (upsert on dedupe key) -----------------------------
  const { error: insertErr } = await supabase
    .from('attendance_events')
    .upsert({
      employee_id: employeeId,
      event_time: dateTime,
      event_type: eventType,
      identification_method: 'fingerprint',
      face_confidence: null,
      face_snapshot_url: null,
      kiosk_device_id: kioskDeviceId,
      synced_from_offline: false,
      branch_code: branchCode,
      device_event_id: deviceEventId,
    }, { onConflict: 'kiosk_device_id,device_event_id', ignoreDuplicates: false })

  if (insertErr) {
    console.error('[hik] insert error:', insertErr)
    // 500 so the device retries — DB transient errors are usually recoverable;
    // unique-index violations come back as success via upsert.
    return res.status(500).json({ error: 'db_error', detail: insertErr.message })
  }

  console.log('[hik] punch: emp=%s matched=%s type=%s branch=%s serial=%s',
    employeeNoString, !!employeeId, eventType, branchCode, deviceEventId)

  return res.json({
    ok: true,
    employee_matched: !!employeeId,
    event_type: eventType,
    branch_code: branchCode,
    device_event_id: deviceEventId,
  })
}

// ----- helpers -------------------------------------------------------------

// Binary-safe multipart walk: split on the boundary, drop part headers, skip
// anything image-sized (>100 KB) or not JSON-shaped, return the first part
// that parses as JSON. Mirrors the edge function's formData() walk without
// needing a multipart dependency.
function extractJsonFromMultipart(buf, contentType) {
  const m = /boundary="?([^=";,\s]+)"?/i.exec(contentType)
  if (!m) return null
  const delim = Buffer.from('--' + m[1])
  for (const part of splitBuffer(buf, delim)) {
    if (part.length === 0) continue
    const sep = part.indexOf('\r\n\r\n')
    if (sep === -1) continue
    let body = part.slice(sep + 4)
    let end = body.length
    while (end > 0 && (body[end - 1] === 0x0a || body[end - 1] === 0x0d)) end--
    body = body.slice(0, end)
    if (body.length === 0 || body.length > 100_000) continue // snapshot image
    const text = body.toString('utf8').trim()
    if (!text.startsWith('{') && !text.startsWith('[')) continue
    try { return JSON.parse(text) } catch { /* try next part */ }
  }
  return null
}

function splitBuffer(buf, delim) {
  const out = []
  let start = 0
  for (let idx = buf.indexOf(delim); idx !== -1; idx = buf.indexOf(delim, start)) {
    out.push(buf.slice(start, idx))
    start = idx + delim.length
  }
  out.push(buf.slice(start))
  return out
}

// "2026-05-05T10:30:00+05:30" → "2026-05-05T00:00:00+05:30" — preserve the
// device's timezone so day boundaries match its local clock (Asia/Kolkata).
function isoDayStart(iso) {
  const tzMatch = iso.match(/([+-]\d\d:?\d\d|Z)$/)
  const tz = tzMatch ? tzMatch[0] : 'Z'
  return `${iso.slice(0, 10)}T00:00:00${tz}`
}

function isoDayEnd(iso) {
  const tzMatch = iso.match(/([+-]\d\d:?\d\d|Z)$/)
  const tz = tzMatch ? tzMatch[0] : 'Z'
  return `${iso.slice(0, 10)}T23:59:59.999${tz}`
}

export default router
