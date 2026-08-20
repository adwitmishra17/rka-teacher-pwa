import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'
import { getAdminFirestore, getSyllabusBucket, SYLLABUS_BUCKET } from '../lib/firebase-admin.js'

/* ============================================================
   Teacher syllabus PDF upload. A teacher can upload/replace/delete
   the syllabus PDF ONLY for a class+subject assigned to them
   (exam_subjects.assigned_teacher_email). The PDF goes to the shared
   Firebase Storage bucket (same one the Tracker admin uses) and a
   `syllabusFiles/<class>__<subject>` Firestore doc holds the metadata,
   which the parent app reads class-wise. All writes go through the
   Admin SDK here (rules-exempt) so ownership is enforced server-side.
   ============================================================ */

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

const sanitize = (s) => String(s || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const fileKey = (c, s) => `${sanitize(c)}__${sanitize(s)}`
const storagePathFor = (c, s) => `syllabus/${sanitize(c)}/${sanitize(s)}.pdf`
const publicUrl = (p) => `https://firebasestorage.googleapis.com/v0/b/${SYLLABUS_BUCKET}/o/${encodeURIComponent(p)}?alt=media`

// Does the caller teach this exact class + subject?
async function ownsSubject(email, className, subject) {
  const { data, error } = await supabase.from('exam_subjects')
    .select('id').eq('assigned_teacher_email', email)
    .eq('class_name', className).eq('subject_name', subject).limit(1)
  if (error) throw error
  return (data ?? []).length > 0
}

// GET /api/my-syllabus — the caller's assigned class+subjects (deduped), each
// with its current syllabus PDF (if any). Drives the teacher's Syllabus screen.
router.get('/my-syllabus', requireAuth, async (req, res) => {
  try {
    const email = (req.user.email || '').toLowerCase()
    if (!email) return res.status(400).json({ error: 'Auth token has no email claim' })
    const { data, error } = await supabase.from('exam_subjects')
      .select('class_name, subject_name, sort_order')
      .eq('assigned_teacher_email', email).order('class_name').order('sort_order')
    if (error) throw error
    const seen = new Set(); const pairs = []
    for (const r of data ?? []) {
      const k = `${r.class_name}||${r.subject_name}`
      if (seen.has(k)) continue
      seen.add(k); pairs.push({ className: r.class_name, subject: r.subject_name })
    }
    // The Tracker's subject vocabulary differs from exam_subjects: the office
    // uploads "English Grammar"/"English Literature" while the teacher is
    // assigned "English"; Class 9/10 science teachers are assigned
    // Biology/Chemistry/Physics but the upload is one "Science" PDF; and
    // Nursery–8 publish a single class-wide "Complete Syllabus". An exact
    // doc-id lookup misses all of those and the teacher wrongly sees
    // "Not uploaded". So: fetch each class's docs once and match by
    // normalized name, name-family prefix, component alias, then class-wide.
    const norm = (s) => sanitize(s).toLowerCase()
    const COMPONENT_ALIAS = { biology: 'science', chemistry: 'science', physics: 'science' }
    const db = getAdminFirestore()
    const docsByClass = new Map()
    for (const cls of [...new Set(pairs.map((p) => p.className))]) {
      const snap = await db.collection('syllabusFiles').where('className', '==', cls).get()
      docsByClass.set(cls, snap.docs.map((d) => d.data()).filter((d) => d && d.pdfUrl))
    }
    const items = pairs.map((p) => {
      const docs = docsByClass.get(p.className) || []
      const sn = norm(p.subject)
      const exact = docs.find((d) => norm(d.subject) === sn)
      let matches = exact ? [exact] : docs.filter((d) => {
        const dn = norm(d.subject)
        return dn.startsWith(sn + '_') || sn.startsWith(dn + '_')       // English ↔ English_Grammar
      })
      if (!matches.length && COMPONENT_ALIAS[sn]) {
        matches = docs.filter((d) => norm(d.subject) === COMPONENT_ALIAS[sn])   // Physics → Science
      }
      if (!matches.length) {
        matches = docs.filter((d) => norm(d.subject) === 'complete_syllabus')   // class-wide PDF covers all
      }
      const first = matches[0] || null
      return {
        className: p.className, subject: p.subject,
        pdfUrl: first?.pdfUrl || null, fileName: first?.fileName || null,
        // exact-owned docs can be replaced/removed under this subject name;
        // family/class-wide coverage is view-only for the teacher.
        exact: Boolean(exact),
        files: matches.map((d) => ({ subject: d.subject, pdfUrl: d.pdfUrl, fileName: d.fileName || null })),
      }
    })
    res.json({ subjects: items })
  } catch (e) {
    console.error('GET /api/my-syllabus', e.message)
    res.status(500).json({ error: 'Could not load your subjects' })
  }
})

// POST /api/syllabus — upload/replace. multipart: pdf + className + subject.
router.post('/syllabus', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    const email = (req.user.email || '').toLowerCase()
    const className = (req.body.className || '').trim()
    const subject = (req.body.subject || '').trim()
    if (!className || !subject) return res.status(400).json({ error: 'Class and subject are required' })
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' })
    if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'File must be a PDF' })
    if (!(await ownsSubject(email, className, subject))) {
      return res.status(403).json({ error: 'You are not assigned to this class and subject' })
    }
    const path = storagePathFor(className, subject)
    await getSyllabusBucket().file(path).save(req.file.buffer, {
      resumable: false, contentType: 'application/pdf', metadata: { contentType: 'application/pdf' },
    })
    const url = publicUrl(path)
    await getAdminFirestore().collection('syllabusFiles').doc(fileKey(className, subject)).set({
      className, subject, pdfUrl: url, storagePath: path,
      fileName: req.file.originalname || 'syllabus.pdf', fileSize: req.file.size,
      uploadedByRole: 'teacher', uploadedByEmail: email, uploadedAt: new Date(),
    })
    res.json({ ok: true, pdfUrl: url })
  } catch (e) {
    console.error('POST /api/syllabus', e.message)
    res.status(500).json({ error: 'Upload failed — try again.' })
  }
})

// DELETE /api/syllabus?className=&subject= — remove the caller's syllabus.
router.delete('/syllabus', requireAuth, async (req, res) => {
  try {
    const email = (req.user.email || '').toLowerCase()
    const className = (req.query.className || '').trim()
    const subject = (req.query.subject || '').trim()
    if (!className || !subject) return res.status(400).json({ error: 'Class and subject are required' })
    if (!(await ownsSubject(email, className, subject))) {
      return res.status(403).json({ error: 'You are not assigned to this class and subject' })
    }
    const path = storagePathFor(className, subject)
    try { await getSyllabusBucket().file(path).delete() } catch (e) { /* may already be gone */ }
    await getAdminFirestore().collection('syllabusFiles').doc(fileKey(className, subject)).delete()
    res.json({ ok: true })
  } catch (e) {
    console.error('DELETE /api/syllabus', e.message)
    res.status(500).json({ error: 'Delete failed — try again.' })
  }
})

export default router
