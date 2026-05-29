import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'
import { getAdminFirestore } from '../lib/firebase-admin.js'

const router = Router()

// GET /api/my-subjects
// Returns exam_subjects rows where assigned_teacher_email = caller's lowercased email.
// The Admin Tracker Cloud Function (syncExamSubjects) resolves the teacher's email
// from the teachers collection and writes it here.
router.get('/my-subjects', requireAuth, async (req, res) => {
  const email = (req.user.email || '').toLowerCase()
  if (!email) return res.status(400).json({ error: 'Auth token has no email claim' })

  const { data, error } = await supabase
    .from('exam_subjects')
    .select('id, session_code, class_name, subject_name, kind, sort_order, branch_id, branches(id, code)')
    .eq('assigned_teacher_email', email)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('GET /api/my-subjects', error.message)
    return res.status(500).json({ error: error.message })
  }

  res.json({
    subjects: (data ?? []).map(s => ({
      id:          s.id,
      sessionCode: s.session_code,
      className:   s.class_name,
      subjectName: s.subject_name,
      kind:        s.kind,
      sortOrder:   s.sort_order,
      branchId:    s.branches?.id   ?? s.branch_id,
      branchCode:  s.branches?.code ?? null,
    })),
  })
})

// GET /api/terms?sessionCode=&branchId=
// Reads the term list from Supabase `exam_terms`, which the Admin Tracker's
// syncExamTerms Cloud Function populates when the admin sets up a session.
//
// `id` in the response is the REAL exam_terms UUID. The PWA passes it straight
// back as exam_papers.term_id / exam_coscholastic_grades.term_id /
// hpc_assessments.term_id — all UUID FKs to exam_terms — so it MUST be the row
// id, never a short code.
//
// branchId is required for correctness: exam_terms is unique per
// (branch_id, session_code, short_code), so MAIN and CITY each have their own
// term rows (distinct UUIDs) for the same session. Filtering by branch keeps a
// teacher from seeing duplicate terms and linking a paper to the wrong branch.
// It is treated as optional here (filter only when provided) so a missing param
// degrades to "all branches" rather than hard-failing; every PWA caller passes it.
router.get('/terms', requireAuth, async (req, res) => {
  const { sessionCode, branchId } = req.query
  if (!sessionCode) return res.status(400).json({ error: 'sessionCode required' })

  let query = supabase
    .from('exam_terms')
    .select('id, name, short_code, sort_order, session_code, branch_id')
    .eq('session_code', sessionCode)
    .order('sort_order', { ascending: true })

  if (branchId) query = query.eq('branch_id', branchId)

  const { data, error } = await query
  if (error) {
    console.error('GET /api/terms', error.message)
    return res.status(500).json({ error: error.message })
  }

  res.json({
    sessionCode,
    label: sessionCode,
    terms: (data ?? []).map(t => ({
      id:        t.id,          // real exam_terms UUID → term_id FK
      label:     t.name,
      shortCode: t.short_code,
      sortOrder: t.sort_order,
    })),
  })
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
