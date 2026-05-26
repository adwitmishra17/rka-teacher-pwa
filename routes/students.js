import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// GET /api/students?className=&branchCode=
// Returns active students for the given class + branch.
// Branch is resolved by code ('MAIN'/'CITY') → UUID server-side (rule #3).
router.get('/students', requireAuth, async (req, res) => {
  const { className, branchCode } = req.query
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
    .select('id, full_name, admission_no, roll_number, class_name, section, father_name, photo_key')
    .eq('class_name', className)
    .eq('branch_id', branch.id)
    .eq('is_active', true)
    .order('roll_number', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })

  res.json({ students: data })
})

export default router
