import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// Verify the caller owns the subject (assigned_teacher_email = their email).
// Returns the subject row or throws.
async function assertSubjectOwner(subjectId, email) {
  const { data, error } = await supabase
    .from('exam_subjects')
    .select('id, class_name, subject_name, kind, branches(id, code)')
    .eq('id', subjectId)
    .eq('assigned_teacher_email', email)
    .single()
  if (error || !data) throw Object.assign(new Error('Subject not assigned to you'), { status: 403 })
  return data
}

// GET /api/paper?subjectId=&termId=
// Returns all papers for the subject+term pair.
router.get('/paper', requireAuth, async (req, res) => {
  const { subjectId, termId } = req.query
  if (!subjectId || !termId) {
    return res.status(400).json({ error: 'subjectId and termId are required' })
  }

  const email = (req.user.email || '').toLowerCase()
  try {
    const subject = await assertSubjectOwner(subjectId, email)

    const { data: papers, error } = await supabase
      .from('exam_papers')
      .select('id, paper_name, max_marks, passing_marks, exam_date, term_id, has_practical, theory_max, practical_max')
      .eq('subject_id', subjectId)
      .eq('term_id', termId)
      .order('exam_date', { ascending: true, nullsFirst: false })

    if (error) return res.status(500).json({ error: error.message })

    res.json({ papers, subject })
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})

// POST /api/paper
// Create a new paper, or update an existing one (pass paperId to update).
// Teachers may create multiple papers per subject+term; admin marks the final one.
router.post('/paper', requireAuth, async (req, res) => {
  const { subjectId, termId, paperName, maxMarks, passingMarks, examDate, paperId,
          hasPractical, theoryMax, practicalMax } = req.body

  if (!subjectId || !termId || !paperName) {
    return res.status(400).json({ error: 'subjectId, termId, paperName are required' })
  }

  // Max-marks split (migration 079). max_marks is always the TOTAL so existing
  // report-card logic keeps working: with a practical it's theory_max +
  // practical_max; without, it's the single maxMarks the teacher entered.
  const practical = Boolean(hasPractical)
  let max_marks, theory_max, practical_max
  if (practical) {
    theory_max    = Number(theoryMax)
    practical_max = Number(practicalMax)
    if (!(theory_max >= 0) || !(practical_max >= 0) || (theory_max + practical_max) <= 0) {
      return res.status(400).json({ error: 'theoryMax and practicalMax must be non-negative and sum to > 0' })
    }
    max_marks = theory_max + practical_max
  } else {
    if (maxMarks == null) return res.status(400).json({ error: 'maxMarks is required' })
    max_marks     = Number(maxMarks)
    theory_max    = null
    practical_max = 0
  }

  const email = (req.user.email || '').toLowerCase()
  try {
    await assertSubjectOwner(subjectId, email)
  } catch (e) {
    return res.status(403).json({ error: e.message })
  }

  const payload = {
    subject_id: subjectId,
    term_id: termId,
    paper_name: paperName,
    max_marks,
    passing_marks: passingMarks != null ? Number(passingMarks) : null,
    exam_date: examDate || null,
    has_practical: practical,
    theory_max,
    practical_max,
  }

  if (paperId) {
    // Update — must still belong to this teacher's subject
    const { data, error } = await supabase
      .from('exam_papers')
      .update(payload)
      .eq('id', paperId)
      .eq('subject_id', subjectId)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ paper: data })
  }

  const { data, error } = await supabase
    .from('exam_papers')
    .insert(payload)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ paper: data })
})

export default router
