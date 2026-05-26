import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

function ensureInit() {
  if (getApps().length) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON env var is not set')
  initializeApp({ credential: cert(JSON.parse(raw)) })
}

export function getAdminAuth() { ensureInit(); return getAuth() }
export function getAdminFirestore() { ensureInit(); return getFirestore() }
