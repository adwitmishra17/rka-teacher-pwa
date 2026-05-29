import { getAdminAuth } from '../lib/firebase-admin.js'

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
