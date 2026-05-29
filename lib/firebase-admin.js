import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

// The service account is delivered via the FIREBASE_SERVICE_ACCOUNT_JSON env var.
// Some hosting panels (Hostinger among them) CORRUPT raw JSON on save — they
// backslash-escape the quotes/braces or wrap the whole value in quotes — so a
// plain JSON.parse fails with errors like:
//   Unexpected token '\', "\{"type":""... is not valid JSON
// To be paste-proof we accept the credential in any of these encodings and
// normalise before parsing:
//   1. base64-encoded JSON  ← RECOMMENDED: base64 is only [A-Za-z0-9+/=], so no
//                              env-var UI can escape or mangle it.
//   2. plain JSON            ← still works (backward compatible).
//   3. JSON wrapped in one layer of quotes.
function parseServiceAccount(raw) {
  let text = String(raw).trim()

  // Strip a single layer of matched wrapping quotes, if a panel added them.
  if (text.length >= 2 &&
      ((text[0] === '"' && text[text.length - 1] === '"') ||
       (text[0] === "'" && text[text.length - 1] === "'"))) {
    text = text.slice(1, -1).trim()
  }

  // If it doesn't look like JSON, assume it's base64-encoded JSON and decode.
  // Buffer.from(..., 'base64') ignores stray whitespace/newlines, so a value the
  // panel wrapped across lines still decodes cleanly.
  if (!text.startsWith('{')) {
    const decoded = Buffer.from(text, 'base64').toString('utf8').trim()
    if (decoded.startsWith('{')) text = decoded
  }

  return JSON.parse(text)
}

function ensureInit() {
  if (getApps().length) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON env var is not set')

  let creds
  try {
    creds = parseServiceAccount(raw)
  } catch (e) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON could not be parsed (tried base64 + plain JSON): ${e.message}`)
  }

  initializeApp({ credential: cert(creds) })

  // Log the project this backend verifies tokens against. ID-token verification
  // ONLY succeeds for tokens minted by this SAME project, so this line is the
  // fastest way to diagnose a 401 storm: creds.project_id MUST equal the
  // frontend's VITE_FIREBASE_PROJECT_ID. A mismatch makes every requireAuth 401.
  console.log(`firebase-admin initialized for project: ${creds.project_id}`)
}

export function getAdminAuth() { ensureInit(); return getAuth() }
export function getAdminFirestore() { ensureInit(); return getFirestore() }
