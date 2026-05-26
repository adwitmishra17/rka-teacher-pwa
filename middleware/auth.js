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
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
