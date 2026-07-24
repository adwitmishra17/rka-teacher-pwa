import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { api } from '../lib/api'
import { format } from 'date-fns'

// ============================================================
// Homework — teacher gives homework to a class SECTION.
//
// Broadcast model (v1): one Firestore `homework` doc per give; parents
// read it via their server for their child's class+section+branch. No
// per-student rows, no submissions. Class + subject come from the
// teacher's own timetable (both slot shapes: classNames[] and legacy
// 'A+B' className strings); the section list comes from the live SMS
// roster (single-section classes auto-select).
//
// Rules: create/update/delete require teacherEmail == the caller's
// email (firestore.rules `homework` block) — admins can correct.
// ============================================================

const todayStr = () => format(new Date(), 'yyyy-MM-dd')

function currentSessionCode(d = new Date()) {
  const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

// Classes a slot covers — same tolerance as LogLesson / the admin app.
function slotClasses(slot) {
  if (Array.isArray(slot.classNames) && slot.classNames.length) {
    return slot.classNames.map(c => (c || '').trim()).filter(Boolean)
  }
  return (slot.className || '').split('+').map(c => c.trim()).filter(Boolean)
}

export default function Homework() {
  const { teacher, user } = useAuth()
  const myEmail = (user?.email || '').toLowerCase()

  // ---- my (class, subject, branch) pairs from the timetable ----
  const [pairs, setPairs] = useState([])          // [{className, subject, branchCode}]
  const [loadingPairs, setLoadingPairs] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDocs(collection(db, 'timetable'))
        const teacherId = teacher?.id || ''
        const teacherName = (teacher?.fullName || '').toLowerCase().trim()
        const mine = snap.docs.map(d => d.data()).filter(s =>
          (teacherId && s.teacherId === teacherId) ||
          (teacherName && (s.teacherName || '').toLowerCase().trim() === teacherName)
        )
        const seen = new Map()
        for (const s of mine) {
          const subject = (s.subject || '').trim()
          if (!subject) continue
          for (const cls of slotClasses(s)) {
            const key = `${cls}|${subject}`
            if (!seen.has(key)) {
              seen.set(key, {
                className: cls,
                subject,
                branchCode: s.branchCode || teacher?.branchCodes?.[0] || 'MAIN',
              })
            }
          }
        }
        if (!cancelled) setPairs([...seen.values()].sort((a, b) =>
          a.className.localeCompare(b.className) || a.subject.localeCompare(b.subject)))
      } catch (e) {
        console.error('timetable load error:', e)
      } finally {
        if (!cancelled) setLoadingPairs(false)
      }
    })()
    return () => { cancelled = true }
  }, [teacher])

  // ---- form state ----
  const [pairKey, setPairKey] = useState('')       // `${className}|${subject}`
  const pair = useMemo(() => pairs.find(p => `${p.className}|${p.subject}` === pairKey) || null, [pairs, pairKey])
  const [sections, setSections] = useState([])     // distinct sections of the class roster
  const [section, setSection] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedDate, setAssignedDate] = useState(todayStr())
  const [dueDate, setDueDate] = useState('')       // optional
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Section list follows the picked class (SMS roster is authoritative).
  useEffect(() => {
    setSections([]); setSection('')
    if (!pair) return
    let cancelled = false
    api.getStudents(pair.className, pair.branchCode)
      .then(({ students }) => {
        if (cancelled) return
        const list = [...new Set((students || []).map(s => (s.section || '').trim()).filter(Boolean))].sort()
        const effective = list.length ? list : ['A']
        setSections(effective)
        if (effective.length === 1) setSection(effective[0])
      })
      .catch(e => { if (!cancelled) setError(`Could not load sections: ${e.message}`) })
    return () => { cancelled = true }
  }, [pairKey])   // eslint-disable-line react-hooks/exhaustive-deps

  // ---- my recent homework (equality-only query — no composite index) ----
  const [recent, setRecent] = useState([])
  async function loadRecent() {
    if (!myEmail) return
    try {
      const snap = await getDocs(query(collection(db, 'homework'), where('teacherEmail', '==', myEmail)))
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => (b.assignedDate || '').localeCompare(a.assignedDate || '')
        || (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      setRecent(rows.slice(0, 20))
    } catch (e) { console.error('recent homework load error:', e) }
  }
  useEffect(() => { loadRecent() }, [myEmail])   // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(h) {
    setEditingId(h.id)
    setPairKey(`${h.className}|${h.subject}`)
    setSection(h.section || '')
    setTitle(h.title || '')
    setDescription(h.description || '')
    setAssignedDate(h.assignedDate || todayStr())
    setDueDate(h.dueDate || '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function resetForm() {
    setEditingId(null); setTitle(''); setDescription(''); setDueDate('')
    setAssignedDate(todayStr())
  }

  async function handleSave() {
    setError('')
    if (!pair) { setError('Pick a class & subject.'); return }
    if (!section) { setError('Pick the section.'); return }
    if (!title.trim()) { setError('Write the homework title.'); return }
    if (dueDate && dueDate < assignedDate) { setError('Due date is before the given date.'); return }
    setSaving(true)
    try {
      const payload = {
        className: pair.className,
        section,
        branchCode: pair.branchCode,
        subject: pair.subject,
        title: title.trim(),
        description: description.trim(),
        assignedDate,
        dueDate: dueDate || null,
        sessionCode: currentSessionCode(),
        teacherEmail: myEmail,
        teacherName: teacher?.fullName || user?.displayName || '',
        source: 'teacher_pwa',
        updatedAt: Timestamp.now(),
      }
      if (editingId) {
        await updateDoc(doc(db, 'homework', editingId), payload)
      } else {
        await addDoc(collection(db, 'homework'), { ...payload, createdAt: Timestamp.now() })
      }
      resetForm()
      setSaved(true)
      setTimeout(() => setSaved(false), 3500)
      await loadRecent()
    } catch (e) {
      console.error('homework save error:', e)
      setError(`Failed to save: ${e.message}`)
    }
    setSaving(false)
  }

  async function handleDelete(h) {
    if (!window.confirm(`Delete homework "${h.title}" for ${h.className}-${h.section}?`)) return
    try {
      await deleteDoc(doc(db, 'homework', h.id))
      if (editingId === h.id) resetForm()
      await loadRecent()
    } catch (e) { setError(`Delete failed: ${e.message}`) }
  }

  const chip = (active) => ({
    padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: active ? '1.5px solid var(--green)' : '1px solid var(--border)',
    background: active ? 'var(--green-light)' : 'white',
    color: active ? 'var(--green-dark)' : 'var(--text)',
  })
  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', margin: '14px 0 6px' }
  const input = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit' }

  return (
    <div style={{ padding: '20px 16px 40px', maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 4 }}>
        {editingId ? 'Edit homework' : 'Give homework'}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Parents see it in the parent app for that class &amp; section.
      </p>

      {saved && (
        <div style={{ background: 'var(--green-light)', border: '1px solid var(--green-muted)', color: 'var(--green-dark)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13.5, marginBottom: 14 }}>
          ✓ Homework saved.
        </div>
      )}

      <span style={label}>Class &amp; subject</span>
      {loadingPairs ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading your timetable…</div>
      ) : pairs.length === 0 ? (
        <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-md)', padding: '12px 14px', fontSize: 13, color: 'var(--gold-dark)' }}>
          No timetable periods found for you. Ask the admin to add your periods.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {pairs.map(p => {
            const k = `${p.className}|${p.subject}`
            return (
              <button key={k} onClick={() => setPairKey(k)} style={chip(pairKey === k)}>
                {p.className} · {p.subject}
              </button>
            )
          })}
        </div>
      )}

      {pair && (
        <>
          <span style={label}>Section</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {sections.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading sections…</span>}
            {sections.map(s => (
              <button key={s} onClick={() => setSection(s)} style={chip(section === s)}>
                Section {s}
              </button>
            ))}
          </div>
        </>
      )}

      <span style={label}>Homework title</span>
      <input style={input} value={title} onChange={e => setTitle(e.target.value)}
        placeholder="e.g. Ch. 4 — exercise 4.2, Q1 to Q10" maxLength={160} />

      <span style={label}>Details (optional)</span>
      <textarea style={{ ...input, minHeight: 90, resize: 'vertical' }} value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Anything extra — page numbers, instructions, what to bring…" maxLength={2000} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <span style={label}>Given on</span>
          <input type="date" style={input} value={assignedDate} onChange={e => setAssignedDate(e.target.value)} />
        </div>
        <div>
          <span style={label}>Due date (optional)</span>
          <input type="date" style={input} value={dueDate} min={assignedDate} onChange={e => setDueDate(e.target.value)} />
        </div>
      </div>

      {error && (
        <div style={{ background: '#fdecea', border: '1px solid rgba(139,26,26,0.25)', color: 'var(--crimson)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, marginTop: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        {editingId && (
          <button onClick={resetForm} style={{ flex: 1, padding: '12px 0', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Cancel edit
          </button>
        )}
        <button onClick={handleSave} disabled={saving}
          style={{ flex: 2, padding: '12px 0', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--green)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : editingId ? 'Save changes' : 'Give homework'}
        </button>
      </div>

      {/* ---- my recent homework ---- */}
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--green-dark)', margin: '30px 0 10px' }}>Recent homework</h2>
      {recent.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing given yet.</p>
      ) : recent.map(h => (
        <div key={h.id} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>
              {h.className}-{h.section} · {h.subject}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h.assignedDate}</div>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--text)', marginTop: 4 }}>{h.title}</div>
          {h.description && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{h.description}</div>}
          <div style={{ display: 'flex', gap: 14, marginTop: 8, alignItems: 'center' }}>
            {h.dueDate && <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--gold-dark)', background: 'var(--gold-light)', padding: '2px 8px', borderRadius: 10 }}>Due {h.dueDate}</span>}
            <button onClick={() => startEdit(h)} style={{ border: 'none', background: 'none', color: 'var(--green)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>Edit</button>
            <button onClick={() => handleDelete(h)} style={{ border: 'none', background: 'none', color: 'var(--crimson)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  )
}
