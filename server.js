import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
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

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = join(__dirname, 'client', 'dist')
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => res.sendFile(join(clientDist, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`RKA Teacher API on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
})
