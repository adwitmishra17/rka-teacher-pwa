import { getAdminAuth, getAdminFirestore } from '../lib/firebase-admin.js'

// Staff-membership gate. requireAuth only proves the token is a VALID Firebase
// token for this project — but the project also holds parent-app sessions and
// (until disabled) self-signup accounts, so "valid token" != "is our staff".
// This mirrors the Firestore isRealTeacher()/isSchoolUser() check server-side:
// the caller's email must have a userBranches doc (active teacher, HRMS-synced)
// or an admins doc. Without this, any valid token can read any class roster.
// Cached 5 min per identity to avoid a Firestore read on every request.
const staffCache = new Map()
const STAFF_TTL_MS = 5 * 60 * 1000

export async function requireStaff(req, res, next) {
  const user = req.user
  if (!user) return res.status(401).json({ error: 'Not authenticated' })
  const email = (user.email || '').trim().toLowerCase()
  const uid = user.uid
  const key = email || uid
  const hit = staffCache.get(key)
  if (hit && hit.exp > Date.now()) {
    return hit.ok ? next() : res.status(403).json({ error: 'Not authorized — staff access only' })
  }
  try {
    const db = getAdminFirestore()
    let ok = false
    if (email) {
      const [ub, adminByEmail] = await Promise.all([
        db.collection('userBranches').doc(email).get(),
        db.collection('admins').doc(email).get(),
      ])
      ok = ub.exists || adminByEmail.exists
    }
    if (!ok && uid) ok = (await db.collection('admins').doc(uid).get()).exists
    staffCache.set(key, { ok, exp: Date.now() + STAFF_TTL_MS })
    return ok ? next() : res.status(403).json({ error: 'Not authorized — staff access only' })
  } catch (e) {
    console.error('requireStaff check failed:', e.message)
    return res.status(500).json({ error: 'authorization check failed' })
  }
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' })
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(header.slice(7))
    req.user = decoded   // { uid, email, name, ... }
    next()
  } catch (e) {
    // Log the REAL reason server-side — never swallow it. The client still gets a
    // generic message (don't leak token internals), but the server log tells us
    // exactly why verification failed. The most common cause in this app is a
    // PROJECT MISMATCH: the backend's FIREBASE_SERVICE_ACCOUNT_JSON must belong to
    // the SAME Firebase project as the frontend's VITE_FIREBASE_PROJECT_ID. A
    // mismatch surfaces here as:
    //   "Firebase ID token has incorrect \"aud\" (audience) claim.
    //    Expected \"<backend-project>\" but got \"<frontend-project>\"."
    // Other causes: auth/id-token-expired, auth/id-token-revoked,
    // auth/argument-error (malformed token). Cross-check against the
    // "firebase-admin initialized for project: …" line logged at startup.
    console.error(`requireAuth: token verification failed [${e.code || 'no-code'}]: ${e.message}`)
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
