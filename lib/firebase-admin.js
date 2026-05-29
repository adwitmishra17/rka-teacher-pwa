import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

function ensureInit() {
  if (getApps().length) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON env var is not set')

  let creds
  try {
    creds = JSON.parse(raw)
  } catch (e) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${e.message}`)
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
