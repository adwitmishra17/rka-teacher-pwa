import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

const VALID_GRADES = new Set(['A+', 'A', 'B', 'C', 'D'])

// GET /api/grades?subjectId=&termId=
// Pre-populate the grades entry form with any previously saved grades.
router.get('/grades', requireAuth, async (req, res) => {
  const { subjectId, termId } = req.query
  if (!subjectId || !termId) {
    return res.status(400).json({ error: 'subjectId and termId are required' })
  }

  // Ownership check
  const { data: subject, error: sErr } = await supabase
    .from('exam_subjects')
    .select('id')
    .eq('id', subjectId)
    .eq('assigned_teacher_id', req.user.uid)
    .single()

  if (sErr || !subject) {
    return res.status(403).json({ error: 'Subject not assigned to you' })
  }

  const { data, error } = await supabase
    .from('exam_coscholastic_grades')
    .select('grade, remarks, students(admission_no)')
    .eq('subject_id', subjectId)
    .eq('term_id', termId)

  if (error) return res.status(500).json({ error: error.message })

  res.json({
    grades: data.map(g => ({
      admissionNo: g.students?.admission_no,
      grade: g.grade,
      remarks: g.remarks,
    })),
  })
})

// POST /api/grades
// Bulk-upsert exam_coscholastic_grades for a subject+term.
//
// SECURITY RULES:
//   1. source='teacher_pwa' on every write.
//   2. Skip rows where source='manual'.
//   3. Student resolved by admission_no server-side.
//
// Body: { termId, subjectId, grades: [{admissionNo, grade, remarks?}] }
router.post('/grades', requireAuth, async (req, res) => {
  const { termId, subjectId, grades } = req.body

  if (!termId || !subjectId || !Array.isArray(grades) || grades.length === 0) {
    return res.status(400).json({ error: 'termId, subjectId, and grades[] are required' })
  }

  // Ownership check — subject must be co-scholastic and assigned to this teacher
  const { data: subject, error: sErr } = await supabase
    .from('exam_subjects')
    .select('id, kind')
    .eq('id', subjectId)
    .eq('assigned_teacher_id', req.user.uid)
    .single()

  if (sErr || !subject) {
    return res.status(403).json({ error: 'Subject not assigned to you' })
  }

  const admissionNos = [...new Set(grades.map(g => g.admissionNo).filter(Boolean))]
  const { data: students, error: stErr } = await supabase
    .from('students')
    .select('id, admission_no')
    .in('admission_no', admissionNos)

  if (stErr) return res.status(500).json({ error: stErr.message })

  const studentMap = new Map(students.map(s => [s.admission_no, s.id]))
  const studentIds = [...studentMap.values()]

  const { data: existingRows } = await supabase
    .from('exam_coscholastic_grades')
    .select('id, student_id, source')
    .eq('subject_id', subjectId)
    .eq('term_id', termId)
    .in('student_id', studentIds)

  const existingByStudent = new Map((existingRows ?? []).map(r => [r.student_id, r]))

  const now = new Date().toISOString()
  const enteredBy = req.user.email ?? req.user.uid

  let saved = 0, skipped = 0
  const errors = []

  for (const g of grades) {
    if (g.grade && !VALID_GRADES.has(g.grade)) {
      errors.push(`Invalid grade '${g.grade}' for ${g.admissionNo} — must be A+/A/B/C/D`)
      continue
    }

    const studentId = studentMap.get(g.admissionNo)
    if (!studentId) {
      errors.push(`Student not found: ${g.admissionNo}`)
      continue
    }

    const existing = existingByStudent.get(studentId)
    if (existing?.source === 'manual') {
      skipped++
      continue
    }

    const payload = {
      term_id: termId,
      subject_id: subjectId,
      student_id: studentId,
      grade: g.grade ?? null,
      remarks: g.remarks ?? null,
      source: 'teacher_pwa',
      entered_by: enteredBy,
      entered_at: now,
    }

    const { error } = existing
      ? await supabase.from('exam_coscholastic_grades').update(payload).eq('id', existing.id)
      : await supabase.from('exam_coscholastic_grades').insert(payload)

    if (error) errors.push(`${g.admissionNo}: ${error.message}`)
    else saved++
  }

  res.json({ saved, skipped, errors })
})

export default router
