import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// GET /api/students?className=&branchCode=&subject=
// Returns active students for the given class + branch.
// Branch is resolved by code ('MAIN'/'CITY') → UUID server-side (rule #3).
//
// `subject` (optional) enables optional-subject scoping for Class 11/12
// electives: if it's passed AND at least one student in the class picked it as
// their optional subject, only those students are returned — so an elective's
// teacher (Computer Science, Hindi, Physical Education, or Maths-for-Commerce)
// marks just their own roster. See the scoping note below.
router.get('/students', requireAuth, async (req, res) => {
  const { className, branchCode, subject } = req.query
  if (!className || !branchCode) {
    return res.status(400).json({ error: 'className and branchCode are required' })
  }

  const { data: branch, error: bErr } = await supabase
    .from('branches')
    .select('id')
    .eq('code', branchCode)
    .single()

  if (bErr || !branch) {
    return res.status(400).json({ error: `Branch '${branchCode}' not found` })
  }

  const { data, error } = await supabase
    .from('students')
    .select('id, full_name, admission_no, roll_number, class_name, section, father_name, photo_key, optional_subject')
    .eq('class_name', className)
    .eq('branch_id', branch.id)
    .eq('is_active', true)
    // Non-regular students (attachments / own reduced-fee) exist for board
    // records only — they never attend, so they must not appear on any
    // teacher-facing roster (attendance, marks, co-scholastic grades).
    .eq('enrollment_kind', 'regular')
    .order('roll_number', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })

  // Optional-subject scoping (Class 11/12 electives). If a `subject` is given AND
  // ≥1 student in this class took it as their optional subject, it's an elective
  // → return only those students. Otherwise it's a core subject (or no subject)
  // → whole class. This is DATA-DRIVEN on purpose: it needs no per-subject flag
  // (exam_subjects.is_optional is unused) and self-resolves the core/elective
  // ambiguity per class — e.g. "Mathematics" scopes for Commerce (students opt
  // in) but stays whole-class for Science, where nobody opts in because it's the
  // PCM core. Subject names align exactly with students.optional_subject.
  let students = data ?? []
  let scopedToOptional = false
  if (subject) {
    const takers = students.filter((s) => s.optional_subject === subject)
    if (takers.length > 0) {
      students = takers
      scopedToOptional = true
    }
  }

  res.json({ students, scopedToOptional, subject: scopedToOptional ? subject : null })
})

// GET /api/attendance-flags?className=&branchCode=
// Students in this class currently on a run of 3+ consecutive school-day
// absences (excludes Sundays + non-working days; strict). Returns a map of
// studentId → streak. Uses the same SMS RPC as the SMS "At-risk" list, so the
// teacher and office see identical flags. The service-role key makes the RPC
// trust the passed branch/class (it pins JWT-based admins server-side instead).
router.get('/attendance-flags', requireAuth, async (req, res) => {
  const { className, branchCode } = req.query
  if (!className || !branchCode) {
    return res.status(400).json({ error: 'className and branchCode are required' })
  }
  const { data: branch, error: bErr } = await supabase
    .from('branches').select('id').eq('code', branchCode).single()
  if (bErr || !branch) return res.status(400).json({ error: `Branch '${branchCode}' not found` })

  const { data, error } = await supabase.rpc('students_absent_streak', {
    p_branch_id: branch.id,
    p_class_name: className,
    p_min_days: 3,
  })
  if (error) return res.status(500).json({ error: error.message })

  const flags = {}
  for (const r of (data ?? [])) flags[r.student_id] = Number(r.streak)
  res.json({ flags })
})

export default router
