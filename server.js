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

const app = express()

app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : true,
}))
app.use(express.json())

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

app.listen(PORT, () => {
  console.log(`RKA Teacher API on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
})
