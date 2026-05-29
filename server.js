import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import subjectsRouter from './routes/subjects.js'
import studentsRouter from './routes/students.js'
import papersRouter from './routes/papers.js'
import marksRouter from './routes/marks.js'
import gradesRouter from './routes/grades.js'
import hpcRouter from './routes/hpc.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001

// ─── Crash containment ──────────────────────────────────────────────────────
// A single bad request must NEVER take the whole process down. An unhandled
// rejection inside an async route handler — which Express 4 does not catch — is
// FATAL on Node ≥18 by default: the process exits, the host restarts it, and the
// browser sees a 503. These handlers log the full stack (so the real culprit is
// visible) and deliberately DO NOT exit, so the server keeps serving the next
// request instead of entering a restart loop.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err)
})

const app = express()

app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : true,
}))
app.use(express.json())

// Authenticated API responses must never be cached — not by the browser, not by
// a CDN, not by Hostinger's edge. This also guarantees a transient 5xx can never
// be cached and replayed, and that one teacher's data is never served to another.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

app.use('/api', subjectsRouter)
app.use('/api', studentsRouter)
app.use('/api', papersRouter)
app.use('/api', marksRouter)
app.use('/api', gradesRouter)
app.use('/api', hpcRouter)

// Health check (Hostinger / load balancer ping)
app.get('/health', (_req, res) => res.json({ ok: true }))

// Serve the React build. express.static is safe even if the folder doesn't
// exist yet — it just passes through. The catch-all checks for index.html
// explicitly so a missing build gives a clear error instead of "Cannot GET /".
const clientDist = join(__dirname, 'client', 'dist')
const indexHtml  = join(clientDist, 'index.html')

console.log('[server] __dirname  :', __dirname)
console.log('[server] clientDist :', clientDist)
console.log('[server] dist exists:', existsSync(clientDist))
console.log('[server] index.html :', existsSync(indexHtml))

app.use(express.static(clientDist))
app.get('*', (_req, res) => {
  if (existsSync(indexHtml)) {
    res.sendFile(indexHtml)
  } else {
    res.status(503).send(
      `<pre>React build not found.\n` +
      `Expected: ${indexHtml}\n\n` +
      `Run on the server:\n  npm install\n  npm run build\n</pre>`
    )
  }
})

// Express error handler (4-arg) — catches synchronous throws in handlers and
// anything passed to next(err), returning a clean 500 instead of a hung request.
// (Async-handler rejections are caught by the process-level handler above.)
app.use((err, _req, res, _next) => {
  console.error('[express-error]', err && err.stack ? err.stack : err)
  if (res.headersSent) return
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`RKA Teacher API on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
})
