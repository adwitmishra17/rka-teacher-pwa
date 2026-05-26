import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// POST /api/hpc
// Upsert one HPC assessment for a student.
//
// SECURITY RULES:
//   1. source='teacher_pwa' on every write.
//   2. Skip if existing row has source='manual'.
//   3. Student resolved by admission_no server-side.
//   4. Student snapshot frozen at assessment time (name, class, roll, etc.).
//
// Body: { sessionCode, termId, branchCode, studentAdmissionNo, domains, generalRemarks? }
//
// NOTE: The hpc_assessments table has "frozen student snapshot" columns whose
// exact names depend on your Supabase schema. The fields prefixed snap_* below
// match a sensible convention — update the names if your schema differs.
// If your schema stores the snapshot as a single JSONB column instead,
// replace the individual snap_* keys with: student_snapshot: { ...snapData }
router.post('/hpc', requireAuth, async (req, res) => {
  const { sessionCode, termId, branchCode, studentAdmissionNo, domains, generalRemarks } = req.body

  if (!sessionCode || !termId || !branchCode || !studentAdmissionNo) {
    return res.status(400).json({
      error: 'sessionCode, termId, branchCode, studentAdmissionNo are required',
    })
  }

  // Resolve branch
  const { data: branch, error: bErr } = await supabase
    .from('branches')
    .select('id')
    .eq('code', branchCode)
    .single()

  if (bErr || !branch) {
    return res.status(400).json({ error: `Branch '${branchCode}' not found` })
  }

  // Resolve student + freeze snapshot
  const { data: student, error: stErr } = await supabase
    .from('students')
    .select('id, full_name, admission_no, class_name, section, roll_number, father_name, mother_name, date_of_birth')
    .eq('admission_no', studentAdmissionNo)
    .eq('branch_id', branch.id)
    .eq('is_active', true)
    .single()

  if (stErr || !student) {
    return res.status(404).json({ error: `Student '${studentAdmissionNo}' not found in ${branchCode}` })
  }

  // Check for existing assessment (source guard)
  const { data: existing } = await supabase
    .from('hpc_assessments')
    .select('id, source')
    .eq('student_id', student.id)
    .eq('session_code', sessionCode)
    .eq('term_id', termId)
    .eq('is_void', false)
    .maybeSingle()

  if (existing?.source === 'manual') {
    return res.status(409).json({
      error: 'This assessment was entered manually and cannot be overwritten by the teacher PWA.',
    })
  }

  const now = new Date().toISOString()

  const payload = {
    branch_id: branch.id,
    session_code: sessionCode,
    term_id: termId,
    student_id: student.id,
    // Frozen student snapshot — adjust column names to match your schema
    snap_student_name:    student.full_name,
    snap_admission_no:    student.admission_no,
    snap_class_name:      student.class_name,
    snap_section:         student.section,
    snap_roll_number:     student.roll_number,
    snap_father_name:     student.father_name,
    snap_mother_name:     student.mother_name,
    snap_date_of_birth:   student.date_of_birth,
    // Assessment data
    domains:              domains ?? {},
    general_remarks:      generalRemarks ?? null,
    source:               'teacher_pwa',
    assessed_by:          req.user.email ?? req.user.uid,
    assessed_at:          now,
    is_void:              false,
  }

  const { data: result, error } = existing
    ? await supabase.from('hpc_assessments').update(payload).eq('id', existing.id).select().single()
    : await supabase.from('hpc_assessments').insert(payload).select().single()

  if (error) return res.status(500).json({ error: error.message })

  res.json({ assessment: result })
})

export default router
