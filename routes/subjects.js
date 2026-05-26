import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'
import { getAdminFirestore } from '../lib/firebase-admin.js'

const router = Router()

// GET /api/my-subjects
// Returns exam_subjects rows where assigned_teacher_id = caller's Firebase UID.
router.get('/my-subjects', requireAuth, async (req, res) => {
  const { uid } = req.user
  const { data, error } = await supabase
    .from('exam_subjects')
    .select('id, session_code, class_name, subject_name, kind, sort_order, branches(id, code)')
    .eq('assigned_teacher_id', uid)
    .order('sort_order', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })

  res.json({
    subjects: data.map(s => ({
      id: s.id,
      sessionCode: s.session_code,
      className: s.class_name,
      subjectName: s.subject_name,
      kind: s.kind,
      sortOrder: s.sort_order,
      branchId: s.branches?.id,
      branchCode: s.branches?.code,
    })),
  })
})

// GET /api/terms?sessionCode=
// Reads session/term config from Firestore collection `academicSessions` (written by Admin Tracker).
// Falls back to an empty list if not configured — the Tracker must create the collection first.
router.get('/terms', requireAuth, async (req, res) => {
  const { sessionCode } = req.query
  const db = getAdminFirestore()

  try {
    let session = null

    if (sessionCode) {
      const snap = await db.collection('academicSessions').doc(sessionCode).get()
      if (snap.exists) session = { id: snap.id, ...snap.data() }
    }

    if (!session) {
      // Get the most-recent active session
      const snap = await db
        .collection('academicSessions')
        .where('isActive', '==', true)
        .limit(1)
        .get()
      if (!snap.empty) session = { id: snap.docs[0].id, ...snap.docs[0].data() }
    }

    if (!session) {
      return res.json({ sessionCode: null, label: null, terms: [] })
    }

    res.json({
      sessionCode: session.sessionCode ?? session.id,
      label: session.label ?? session.id,
      terms: session.terms ?? [],  // [{id, label}, ...]
    })
  } catch (e) {
    console.error('GET /api/terms', e)
    res.status(500).json({ error: 'Failed to fetch terms from Firestore' })
  }
})

// GET /api/hpc-template?sessionCode=&branchCode=
// Reads HPC domain config from Firestore `hpcTemplates` (written by Admin Tracker).
// Resolution order: {branchCode}_{sessionCode} → {sessionCode} → default.
// If nothing found, returns a standard Indian-school HPC template so the page always renders.
router.get('/hpc-template', requireAuth, async (req, res) => {
  const { sessionCode, branchCode } = req.query
  const db = getAdminFirestore()

  const DEFAULT_TEMPLATE = {
    domains: [
      { id: 'physical_health', label: 'Physical Health & Education', gradeOptions: ['A+', 'A', 'B', 'C', 'D'] },
      { id: 'work_education',  label: 'Work Education',              gradeOptions: ['A+', 'A', 'B', 'C', 'D'] },
      { id: 'art_education',   label: 'Art Education',               gradeOptions: ['A+', 'A', 'B', 'C', 'D'] },
      { id: 'discipline',      label: 'Discipline',                  gradeOptions: ['A+', 'A', 'B', 'C', 'D'] },
      { id: 'attitude_values', label: 'Attitude & Values',           gradeOptions: ['A+', 'A', 'B', 'C', 'D'] },
    ],
    generalRemarksEnabled: true,
  }

  try {
    const tryDoc = async (id) => {
      const snap = await db.collection('hpcTemplates').doc(id).get()
      return snap.exists ? snap.data() : null
    }

    const template =
      (branchCode && sessionCode && (await tryDoc(`${branchCode}_${sessionCode}`))) ||
      (sessionCode && (await tryDoc(sessionCode))) ||
      (await tryDoc('default')) ||
      DEFAULT_TEMPLATE

    res.json(template)
  } catch (e) {
    console.error('GET /api/hpc-template', e)
    res.json(DEFAULT_TEMPLATE)  // degrade gracefully — page can still render
  }
})

export default router
