import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'
import { getAdminFirestore } from '../lib/firebase-admin.js'

// ============================================================================
// /api/card-entries — the CLASS-TEACHER PACK (report-card rework Phase 2).
//
// Everything on the printed card that isn't subject marks, entered by the
// CLASS TEACHER for their own class:
//   · co-scholastic areas + graded subjects (exam_subjects rows with
//     subject_code RCA/RCG, seeded from the card templates) → grades land in
//     exam_coscholastic_grades (source='teacher_pwa'; office 'manual' wins)
//   · discipline + remarks (per term) and achievement / height / weight
//     (per session) → report_card_student_meta
//
// Ownership: the caller's Firestore teachers doc must have classTeacherOf set;
// branch = branchCodes[0]. Same resolution the attendance screen uses.
// ============================================================================

const router = Router()

async function resolveClassTeacher(email) {
  const db = getAdminFirestore()
  const snap = await db.collection('teachers').get()
  const t = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .find(x => x.isActive !== false && (
      (x.email || '').trim().toLowerCase() === email ||
      (x.personalEmail || '').trim().toLowerCase() === email))
  if (!t) return null
  return {
    teacherId: t.id,
    fullName: t.fullName || '',
    classTeacherOf: (t.classTeacherOf || '').trim() || null,
    branchCode: (t.branchCodes && t.branchCodes[0]) || 'MAIN',
  }
}

async function branchIdFor(code) {
  const { data } = await supabase.from('branches').select('id').eq('code', code).maybeSingle()
  return data?.id || null
}

function currentSessionCode(d = new Date()) {
  const y = d.getFullYear()
  const sy = (d.getMonth() + 1) >= 4 ? y : y - 1
  return `${sy}-${String((sy + 1) % 100).padStart(2, '0')}`
}

// GET /api/card-entries[?termId=]
// Without termId: identity + term list (for the picker). With termId: the pack.
router.get('/card-entries', requireAuth, async (req, res) => {
  try {
    const email = (req.user.email || '').toLowerCase()
    const me = await resolveClassTeacher(email)
    if (!me?.classTeacherOf) {
      return res.json({ classTeacherOf: null, terms: [], students: [], areas: [] })
    }
    const bid = await branchIdFor(me.branchCode)
    if (!bid) return res.status(500).json({ error: `Unknown branch ${me.branchCode}` })
    const sessionCode = String(req.query.sessionCode || currentSessionCode())

    const { data: terms, error: tErr } = await supabase.from('exam_terms')
      .select('id, name, short_code, sort_order, session_code')
      .eq('branch_id', bid).eq('session_code', sessionCode).order('sort_order')
    if (tErr) throw tErr

    const termId = req.query.termId
    if (!termId) {
      return res.json({ classTeacherOf: me.classTeacherOf, branchCode: me.branchCode, sessionCode, terms: terms ?? [] })
    }
    if (!(terms ?? []).some(t => t.id === termId)) {
      return res.status(400).json({ error: 'termId not in your branch/session' })
    }

    // Scales come from the class's card template (fall back to A–C / A).
    let scales = { area: ['A', 'B', 'C'], graded: ['A'], discipline: ['A', 'B', 'C'] }
    try {
      const { data: map } = await supabase.from('report_card_template_classes')
        .select('template_id').eq('session_code', sessionCode).eq('class_name', me.classTeacherOf).maybeSingle()
      if (map?.template_id) {
        const { data: tpl } = await supabase.from('report_card_templates')
          .select('definition').eq('id', map.template_id).maybeSingle()
        const def = tpl?.definition || {}
        scales = {
          area: def.coScholastic?.scale || scales.area,
          graded: def.gradedSubjects?.scale || scales.graded,
          discipline: def.discipline?.scale || def.coScholastic?.scale || scales.discipline,
        }
      }
    } catch { /* template optional — defaults stand */ }

    const [stRes, areaRes] = await Promise.all([
      supabase.from('students')
        .select('id, full_name, admission_no, section, roll_number')
        .eq('branch_id', bid).eq('class_name', me.classTeacherOf)
        .eq('is_active', true).eq('deleted_in_sms', false)
        .order('section').order('roll_number').order('full_name'),
      supabase.from('exam_subjects')
        .select('id, subject_name, subject_code, sort_order')
        .eq('branch_id', bid).eq('session_code', sessionCode).eq('class_name', me.classTeacherOf)
        .eq('kind', 'co_scholastic').in('subject_code', ['RCA', 'RCG'])
        .order('sort_order'),
    ])
    if (stRes.error) throw stRes.error
    if (areaRes.error) throw areaRes.error
    const students = stRes.data ?? []
    const areas = areaRes.data ?? []
    const sids = students.map(s => s.id)

    const grades = {}
    if (sids.length && areas.length) {
      const { data, error } = await supabase.from('exam_coscholastic_grades')
        .select('student_id, subject_id, grade, source')
        .eq('term_id', termId).in('student_id', sids).in('subject_id', areas.map(a => a.id))
      if (error) throw error
      for (const g of data ?? []) (grades[g.student_id] ||= {})[g.subject_id] = { grade: g.grade, locked: g.source === 'manual' }
    }

    const meta = {}
    if (sids.length) {
      const { data, error } = await supabase.from('report_card_student_meta')
        .select('student_id, term_id, discipline, remarks, achievement, height_cm, weight_kg')
        .eq('session_code', sessionCode).in('student_id', sids)
        .or(`term_id.eq.${termId},term_id.is.null`)
      if (error) throw error
      for (const m of data ?? []) {
        const slot = (meta[m.student_id] ||= {})
        if (m.term_id) { slot.discipline = m.discipline; slot.remarks = m.remarks }
        else { slot.achievement = m.achievement; slot.heightCm = m.height_cm; slot.weightKg = m.weight_kg }
      }
    }
    res.json({ classTeacherOf: me.classTeacherOf, branchCode: me.branchCode, sessionCode, terms, scales, students, areas, grades, meta })
  } catch (e) {
    console.error('GET /api/card-entries', e)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/card-entries { termId, sessionCode, students: [{studentId, grades:{subjectId:grade}, discipline, remarks, achievement, heightCm, weightKg}] }
router.post('/card-entries', requireAuth, async (req, res) => {
  try {
    const email = (req.user.email || '').toLowerCase()
    const me = await resolveClassTeacher(email)
    if (!me?.classTeacherOf) return res.status(403).json({ error: 'You are not a class teacher' })
    const bid = await branchIdFor(me.branchCode)
    const { termId, students } = req.body || {}
    const sessionCode = String(req.body?.sessionCode || currentSessionCode())
    if (!termId || !Array.isArray(students) || !students.length) {
      return res.status(400).json({ error: 'termId and students[] required' })
    }

    // Every student written must belong to MY class.
    const { data: myStudents, error: msErr } = await supabase.from('students')
      .select('id').eq('branch_id', bid).eq('class_name', me.classTeacherOf).eq('is_active', true)
    if (msErr) throw msErr
    const mine = new Set((myStudents ?? []).map(s => s.id))
    const rows = students.filter(s => s.studentId && mine.has(s.studentId))
    if (!rows.length) return res.status(403).json({ error: 'No students belong to your class' })

    // Valid area ids for my class (RCA/RCG only — nothing else writable here).
    const { data: areaRows } = await supabase.from('exam_subjects')
      .select('id').eq('branch_id', bid).eq('session_code', sessionCode)
      .eq('class_name', me.classTeacherOf).eq('kind', 'co_scholastic').in('subject_code', ['RCA', 'RCG'])
    const validAreas = new Set((areaRows ?? []).map(a => a.id))

    const now = new Date().toISOString()
    let saved = 0, skippedManual = 0

    // Grades — office 'manual' rows win, same rule as /api/grades.
    const gradeWrites = rows.flatMap(s => Object.entries(s.grades || {})
      .filter(([subjectId]) => validAreas.has(subjectId))
      .map(([subjectId, grade]) => ({ studentId: s.studentId, subjectId, grade })))
    if (gradeWrites.length) {
      const { data: existing } = await supabase.from('exam_coscholastic_grades')
        .select('id, student_id, subject_id, source')
        .eq('term_id', termId).in('student_id', rows.map(r => r.studentId))
      const exByKey = new Map((existing ?? []).map(e => [`${e.student_id}¦${e.subject_id}`, e]))
      const payload = []
      for (const g of gradeWrites) {
        const ex = exByKey.get(`${g.studentId}¦${g.subjectId}`)
        if (ex?.source === 'manual') { skippedManual++; continue }
        payload.push({
          term_id: termId, subject_id: g.subjectId, student_id: g.studentId,
          grade: g.grade == null || g.grade === '' ? null : String(g.grade),
          source: 'teacher_pwa', entered_by: email, entered_at: now, updated_at: now,
        })
      }
      if (payload.length) {
        const { error } = await supabase.from('exam_coscholastic_grades')
          .upsert(payload, { onConflict: 'term_id,subject_id,student_id' })
        if (error) throw error
        saved += payload.length
      }
    }

    // Meta — term row (discipline/remarks) + session row (achievement/ht/wt).
    const termRows = [], sessRows = []
    for (const s of rows) {
      if (s.discipline !== undefined || s.remarks !== undefined) {
        termRows.push({ student_id: s.studentId, session_code: sessionCode, term_id: termId,
          discipline: s.discipline ?? null, remarks: s.remarks ?? null, entered_by: email, updated_at: now })
      }
      if (s.achievement !== undefined || s.heightCm !== undefined || s.weightKg !== undefined) {
        sessRows.push({ student_id: s.studentId, session_code: sessionCode, term_id: null,
          achievement: s.achievement ?? null,
          height_cm: s.heightCm == null || s.heightCm === '' ? null : Number(s.heightCm),
          weight_kg: s.weightKg == null || s.weightKg === '' ? null : Number(s.weightKg),
          entered_by: email, updated_at: now })
      }
    }
    for (const batch of [termRows, sessRows]) {
      if (!batch.length) continue
      const { error } = await supabase.from('report_card_student_meta')
        .upsert(batch, { onConflict: 'student_id,session_code,term_id' })
      if (error) throw error
      saved += batch.length
    }

    res.json({ saved, skippedManual })
  } catch (e) {
    console.error('POST /api/card-entries', e)
    res.status(500).json({ error: e.message })
  }
})

export default router
