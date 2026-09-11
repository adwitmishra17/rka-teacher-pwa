import React, { useState, useEffect } from 'react'
import { api } from '../lib/api'

/* ============================================================
   Report Card Entries — the CLASS TEACHER's pack (Phase 2).

   For the class teacher's own class, per term:
   · co-scholastic areas + graded subjects (grade chips; scales
     come from the class's card template)
   · discipline grade + class-teacher remarks
   · achievement, height, weight (session-level)

   Office ('manual') grades are locked here — shown, not editable.
   Saves per student.
   ============================================================ */

export default function ReportCardEntries() {
  const [identity, setIdentity] = useState(null)   // { classTeacherOf, terms, sessionCode }
  const [termId, setTermId] = useState('')
  const [pack, setPack] = useState(null)
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(null)           // expanded studentId
  const [savingId, setSavingId] = useState(null)
  const [savedIds, setSavedIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getCardEntries()
      .then(d => { setIdentity(d); if ((d.terms || []).length) setTermId(d.terms[0].id) })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!termId) return
    setLoading(true); setPack(null); setRows([]); setSavedIds(new Set()); setOpen(null)
    api.getCardEntries(termId)
      .then(d => {
        setPack(d)
        setRows((d.students || []).map(s => {
          const g = d.grades?.[s.id] || {}
          const m = d.meta?.[s.id] || {}
          return {
            studentId: s.id, roll: s.roll_number || '', name: s.full_name,
            grades: Object.fromEntries((d.areas || []).map(a => [a.id, g[a.id]?.grade || ''])),
            locked: Object.fromEntries((d.areas || []).map(a => [a.id, !!g[a.id]?.locked])),
            discipline: m.discipline || '', remarks: m.remarks || '',
            achievement: m.achievement || '', heightCm: m.heightCm ?? '', weightKg: m.weightKg ?? '',
          }
        }))
      })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false))
  }, [termId])

  function upd(id, patch) {
    setRows(rs => rs.map(r => r.studentId === id ? { ...r, ...patch } : r))
    setSavedIds(s => { const n = new Set(s); n.delete(id); return n })
  }

  async function saveStudent(r) {
    setSavingId(r.studentId); setError('')
    try {
      await api.saveCardEntries(termId, pack.sessionCode, [{
        studentId: r.studentId,
        grades: r.grades,
        discipline: r.discipline || null,
        remarks: r.remarks || null,
        achievement: r.achievement || null,
        heightCm: r.heightCm, weightKg: r.weightKg,
      }])
      setSavedIds(s => new Set([...s, r.studentId]))
    } catch (e) { setError('Save failed: ' + (e.message || e)) }
    setSavingId(null)
  }

  const chipBtn = (active, locked) => ({
    minWidth: 38, padding: '7px 0', borderRadius: 9, fontSize: 13, fontWeight: 600, textAlign: 'center',
    border: '1.5px solid ' + (active ? 'var(--green)' : 'var(--gray-200)'),
    background: locked ? 'var(--gray-100)' : active ? 'var(--green)' : 'var(--white)',
    color: locked ? 'var(--gray-400)' : active ? 'white' : 'var(--text-muted)',
    cursor: locked ? 'not-allowed' : 'pointer',
  })
  const inp = { padding: '9px 11px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13.5, width: '100%', fontFamily: 'var(--font-body)' }
  const lbl = { fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', display: 'block', margin: '12px 0 6px' }

  if (loading && !identity) {
    return <div style={{ textAlign: 'center', padding: 48 }}><div style={{ width: 28, height: 28, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} /></div>
  }

  if (identity && !identity.classTeacherOf) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-lg)', padding: '28px 20px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--gold-dark)', fontWeight: 500, marginBottom: 6 }}>You are not set as a class teacher</p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Report-card entries (discipline, remarks, co-scholastic grades) are made by each class's class teacher. Ask the admin to set your class in Teacher Management.</p>
        </div>
      </div>
    )
  }

  const gradedAreas = (pack?.areas || []).filter(a => a.subject_code === 'RCG')
  const coshAreas   = (pack?.areas || []).filter(a => a.subject_code === 'RCA')
  const scales = pack?.scales || { area: ['A', 'B', 'C'], graded: ['A'], discipline: ['A', 'B', 'C'] }
  const doneCount = rows.filter(r => r.discipline && (coshAreas.every(a => r.grades[a.id]) || coshAreas.length === 0)).length

  return (
    <div style={{ padding: 20 }}>
      <div className="fade-up" style={{ marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--green-dark)' }}>Report Card Entries</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          {identity?.classTeacherOf} · your class · {doneCount}/{rows.length} complete
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--green-light)', border: '1px solid var(--green-muted)', borderRadius: 'var(--radius-md)', padding: '9px 12px', fontSize: 12, color: 'var(--green-dark)', lineHeight: 1.5, marginBottom: 14 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>Class-teacher pack for your own class: co-scholastic area grades, graded subjects, discipline, remarks, achievement, height & weight — everything on the card that is not a subject mark. Subject marks are entered by each subject teacher under <b>Enter Exam Marks</b>.</span>
        </div>

      {/* Term picker */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {(identity?.terms || []).map(t => (
          <button key={t.id} onClick={() => setTermId(t.id)} style={{ padding: '8px 15px', borderRadius: 'var(--radius-md)', fontSize: 12.5, fontWeight: termId === t.id ? 600 : 400, border: '1px solid ' + (termId === t.id ? 'var(--green)' : 'var(--gray-200)'), background: termId === t.id ? 'var(--green)' : 'var(--white)', color: termId === t.id ? 'white' : 'var(--text-muted)', cursor: 'pointer' }}>
            {t.name}
          </button>
        ))}
      </div>

      {error && <div style={{ color: 'var(--crimson)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div style={{ width: 26, height: 26, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const expanded = open === r.studentId
            const saved = savedIds.has(r.studentId)
            return (
              <div key={r.studentId} style={{ background: 'var(--white)', border: '1px solid ' + (expanded ? 'var(--green-muted)' : 'var(--gray-100)'), borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <button onClick={() => setOpen(expanded ? null : r.studentId)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--green-light)', color: 'var(--green)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{r.roll}</span>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{r.name}</span>
                  {saved && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ saved</span>}
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><polyline points="9 18 15 12 9 6"/></svg>
                </button>

                {expanded && (
                  <div style={{ padding: '2px 14px 16px', borderTop: '1px solid var(--gray-50)' }}>
                    {gradedAreas.length > 0 && gradedAreas.map(a => (
                      <div key={a.id}>
                        <span style={lbl}>{a.subject_name} <span style={{ fontWeight: 400 }}>(graded subject)</span>{r.locked[a.id] && <span style={{ color: 'var(--gold-dark)' }}> · locked by office</span>}</span>
                        <div style={{ display: 'flex', gap: 7 }}>
                          {scales.graded.map(g => (
                            <button key={g} disabled={r.locked[a.id]} onClick={() => upd(r.studentId, { grades: { ...r.grades, [a.id]: r.grades[a.id] === g ? '' : g } })} style={chipBtn(r.grades[a.id] === g, r.locked[a.id])}>{g}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {coshAreas.map(a => (
                      <div key={a.id}>
                        <span style={lbl}>{a.subject_name}{r.locked[a.id] && <span style={{ color: 'var(--gold-dark)' }}> · locked by office</span>}</span>
                        <div style={{ display: 'flex', gap: 7 }}>
                          {scales.area.map(g => (
                            <button key={g} disabled={r.locked[a.id]} onClick={() => upd(r.studentId, { grades: { ...r.grades, [a.id]: r.grades[a.id] === g ? '' : g } })} style={chipBtn(r.grades[a.id] === g, r.locked[a.id])}>{g}</button>
                          ))}
                        </div>
                      </div>
                    ))}

                    <span style={lbl}>Discipline</span>
                    <div style={{ display: 'flex', gap: 7 }}>
                      {scales.discipline.map(g => (
                        <button key={g} onClick={() => upd(r.studentId, { discipline: r.discipline === g ? '' : g })} style={chipBtn(r.discipline === g, false)}>{g}</button>
                      ))}
                    </div>

                    <span style={lbl}>Class teacher's remarks (this term)</span>
                    <input value={r.remarks} onChange={e => upd(r.studentId, { remarks: e.target.value })} placeholder="e.g. Keep it up." style={inp} />

                    <span style={lbl}>Achievement (session)</span>
                    <input value={r.achievement} onChange={e => upd(r.studentId, { achievement: e.target.value })} placeholder="—" style={inp} />

                    <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ ...lbl, margin: '0 0 6px' }}>Height (cm)</span>
                        <input type="number" value={r.heightCm} onChange={e => upd(r.studentId, { heightCm: e.target.value })} style={inp} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <span style={{ ...lbl, margin: '0 0 6px' }}>Weight (kg)</span>
                        <input type="number" value={r.weightKg} onChange={e => upd(r.studentId, { weightKg: e.target.value })} style={inp} />
                      </div>
                    </div>

                    <button onClick={() => saveStudent(r)} disabled={savingId === r.studentId}
                      style={{ width: '100%', marginTop: 16, padding: '12px', background: savingId === r.studentId ? 'var(--gray-200)' : 'var(--green)', color: savingId === r.studentId ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                      {savingId === r.studentId ? 'Saving…' : `Save ${r.name.split(' ')[0]}`}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
