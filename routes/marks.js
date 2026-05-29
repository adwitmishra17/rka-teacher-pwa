import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// Resolve paperId → paper row, verifying the caller owns the linked subject.
async function assertPaperOwner(paperId, email) {
  const { data, error } = await supabase
    .from('exam_papers')
    .select('id, max_marks, subject_id, exam_subjects(assigned_teacher_email)')
    .eq('id', paperId)
    .single()
  if (error || !data) throw Object.assign(new Error('Paper not found'), { status: 404 })
  if (data.exam_subjects.assigned_teacher_email !== email) {
    throw Object.assign(new Error('You are not assigned to this subject'), { status: 403 })
  }
  return data
}

// GET /api/marks?paperId=
// Returns existing marks for a paper so the entry form can pre-populate.
router.get('/marks', requireAuth, async (req, res) => {
  const { paperId } = req.query
  if (!paperId) return res.status(400).json({ error: 'paperId required' })

  const email = (req.user.email || '').toLowerCase()
  try {
    await assertPaperOwner(paperId, email)
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message })
  }

  const { data, error } = await supabase
    .from('exam_marks')
    .select('marks_obtained, is_absent, remarks, students(admission_no)')
    .eq('paper_id', paperId)

  if (error) return res.status(500).json({ error: error.message })

  res.json({
    marks: data.map(m => ({
      admissionNo: m.students?.admission_no,
      marksObtained: m.marks_obtained,
      isAbsent: m.is_absent,
      remarks: m.remarks,
    })),
  })
})

// POST /api/marks
// Bulk-upsert exam_marks for one paper.
//
// SECURITY RULES (non-negotiable):
//   1. source='teacher_pwa' on every write.
//   2. Skip any existing row where source='manual' (school-office correction).
//   3. Student resolved by admission_no server-side — no UUIDs from the client.
//
// Body: { paperId, marks: [{admissionNo, marksObtained, isAbsent, remarks?}] }
router.post('/marks', requireAuth, async (req, res) => {
  const { paperId, marks } = req.body

  if (!paperId || !Array.isArray(marks) || marks.length === 0) {
    return res.status(400).json({ error: 'paperId and marks[] are required' })
  }

  const email = (req.user.email || '').toLowerCase()
  let paper
  try {
    paper = await assertPaperOwner(paperId, email)
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message })
  }

  // Resolve admission_nos → student UUIDs in one query
  const admissionNos = [...new Set(marks.map(m => m.admissionNo).filter(Boolean))]
  const { data: students, error: stErr } = await supabase
    .from('students')
    .select('id, admission_no')
    .in('admission_no', admissionNos)

  if (stErr) return res.status(500).json({ error: stErr.message })

  const studentMap = new Map(students.map(s => [s.admission_no, s.id]))
  const studentIds = [...studentMap.values()]

  // Load existing rows for this paper (for source guard + update vs insert)
  const { data: existingRows } = await supabase
    .from('exam_marks')
    .select('id, student_id, source')
    .eq('paper_id', paperId)
    .in('student_id', studentIds)

  const existingByStudent = new Map((existingRows ?? []).map(r => [r.student_id, r]))

  const now = new Date().toISOString()
  const enteredBy = req.user.email ?? req.user.uid
  const maxMarks = Number(paper.max_marks ?? 0)

  let saved = 0, skipped = 0
  const errors = []

  for (const m of marks) {
    const studentId = studentMap.get(m.admissionNo)
    if (!studentId) {
      errors.push(`Student not found: ${m.admissionNo}`)
      continue
    }

    const existing = existingByStudent.get(studentId)

    // SOURCE GUARD — never overwrite a school-office correction
    if (existing?.source === 'manual') {
      skipped++
      continue
    }

    const marksObtained = m.isAbsent
      ? 0
      : Math.min(Math.max(Number(m.marksObtained ?? 0), 0), maxMarks || Infinity)

    const payload = {
      paper_id: paperId,
      student_id: studentId,
      marks_obtained: marksObtained,
      is_absent: Boolean(m.isAbsent),
      remarks: m.remarks ?? null,
      source: 'teacher_pwa',
      entered_by: enteredBy,
      entered_at: now,
    }

    const { error } = existing
      ? await supabase.from('exam_marks').update(payload).eq('id', existing.id)
      : await supabase.from('exam_marks').insert(payload)

    if (error) errors.push(`${m.admissionNo}: ${error.message}`)
    else saved++
  }

  res.json({ saved, skipped, errors })
})

export default router
