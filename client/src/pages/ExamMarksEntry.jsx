import React, { useState, useEffect } from 'react'
import { api } from '../lib/api'

// ============================================================
// ExamMarksEntry — Supabase-backed exam marks entry
//
// Flow:
//   1. Load scholastic subjects assigned to this teacher
//   2. Pick a subject (class + branch already determined by exam_subjects row)
//   3. Pick a term (from Firestore academicSessions via backend)
//   4. Pick or create a paper for that subject+term
//   5. Enter marks per student from the live Supabase roster
//   6. Review → Confirm → backend bulk-upserts to exam_marks
// ============================================================

function Spinner({ size = 24 }) {
  return (
    <div style={{ width: size, height: size, border: `2px solid var(--green-muted)`, borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
  )
}

function PageHeader({ title, subtitle, onBack }) {
  return (
    <div className="fade-up" style={{ marginBottom: 20 }}>
      {onBack && (
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, fontWeight: 500, padding: 0, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
      )}
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--green-dark)' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</p>}
    </div>
  )
}

function ErrorBanner({ message, onDismiss }) {
  if (!message) return null
  return (
    <div style={{ background: 'rgba(139,26,26,0.08)', border: '1px solid rgba(139,26,26,0.2)', borderRadius: 'var(--radius-md)', padding: '11px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 13, color: 'var(--crimson)', flex: 1 }}>{message}</span>
      {onDismiss && <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crimson)', fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>}
    </div>
  )
}

export default function ExamMarksEntry() {
  // Data
  const [subjects, setSubjects] = useState([])
  const [terms, setTerms] = useState([])
  const [papers, setPapers] = useState([])
  const [students, setStudents] = useState([])

  // Selections
  const [selectedSubject, setSelectedSubject] = useState(null)
  const [selectedTerm, setSelectedTerm] = useState(null)
  const [selectedPaper, setSelectedPaper] = useState(null)

  // Paper creation/edit form
  const [showPaperForm, setShowPaperForm] = useState(false)
  const [editingPaper, setEditingPaper] = useState(null)  // null = new
  const [paperForm, setPaperForm] = useState({ paperName: '', maxMarks: '', passingMarks: '', examDate: '' })

  // UI
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [error, setError] = useState('')
  const [saveResult, setSaveResult] = useState(null)

  // ── Load subjects on mount ──────────────────────────────────
  useEffect(() => {
    api.getMySubjects()
      .then(({ subjects: all }) => setSubjects(all.filter(s => s.kind === 'scholastic')))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // ── When subject chosen → load terms ───────────────────────
  useEffect(() => {
    if (!selectedSubject) return
    setTerms([])
    setSelectedTerm(null)
    setPapers([])
    setSelectedPaper(null)
    setStudents([])
    api.getTerms(selectedSubject.sessionCode, selectedSubject.branchId)
      .then(({ terms: list }) => setTerms(list))
      .catch(e => setError(e.message))
  }, [selectedSubject])

  // ── When term chosen → load papers + roster ─────────────────
  useEffect(() => {
    if (!selectedSubject || !selectedTerm) return
    setPapers([])
    setSelectedPaper(null)

    const loadPapers = api.getPapers(selectedSubject.id, selectedTerm.id)
      .then(({ papers: list }) => setPapers(list))
      .catch(e => setError(e.message))

    const loadStudents = api.getStudents(selectedSubject.className, selectedSubject.branchCode)
      .then(({ students: list }) => {
        setStudents(list.map(s => ({
          admissionNo: s.admission_no,
          name: s.full_name,
          rollNumber: s.roll_number,
          marks: '',
          isAbsent: false,
        })))
      })
      .catch(e => setError(e.message))

    Promise.all([loadPapers, loadStudents])
  }, [selectedSubject, selectedTerm])

  // ── When paper chosen → pre-populate existing marks ─────────
  useEffect(() => {
    if (!selectedPaper) return
    api.getMarks(selectedPaper.id)
      .then(({ marks: existing }) => {
        if (!existing.length) return
        const byAdmission = new Map(existing.map(m => [m.admissionNo, m]))
        setStudents(prev => prev.map(s => {
          const m = byAdmission.get(s.admissionNo)
          if (!m) return s
          return {
            ...s,
            marks: m.isAbsent ? '' : (m.marksObtained != null ? String(m.marksObtained) : ''),
            isAbsent: m.isAbsent ?? false,
          }
        }))
      })
      .catch(() => {})  // non-fatal — form stays blank
  }, [selectedPaper])

  function updateMark(idx, field, value) {
    if (field === 'marks' && value !== '' && selectedPaper) {
      const max = Number(selectedPaper.max_marks ?? 0)
      const num = Number(value)
      if (isNaN(num)) return
      value = String(Math.min(Math.max(num, 0), max || Infinity))
    }
    setStudents(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  async function handleSavePaper() {
    if (!paperForm.paperName.trim() || !paperForm.maxMarks) {
      setError('Paper name and max marks are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { paper } = await api.savePaper({
        subjectId: selectedSubject.id,
        termId: selectedTerm.id,
        paperName: paperForm.paperName.trim(),
        maxMarks: Number(paperForm.maxMarks),
        passingMarks: paperForm.passingMarks ? Number(paperForm.passingMarks) : null,
        examDate: paperForm.examDate || null,
        paperId: editingPaper?.id,
      })
      setPapers(prev => {
        const idx = prev.findIndex(p => p.id === paper.id)
        return idx >= 0 ? prev.map((p, i) => (i === idx ? paper : p)) : [...prev, paper]
      })
      setSelectedPaper(paper)
      setShowPaperForm(false)
      setEditingPaper(null)
      setPaperForm({ paperName: '', maxMarks: '', passingMarks: '', examDate: '' })
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  async function handleSubmitMarks() {
    if (!selectedPaper || students.length === 0) return
    setSaving(true)
    setError('')
    try {
      const payload = students.map(s => ({
        admissionNo: s.admissionNo,
        marksObtained: s.isAbsent ? 0 : Number(s.marks || 0),
        isAbsent: s.isAbsent,
      }))
      const result = await api.saveMarks(selectedPaper.id, payload)
      setSaveResult(result)
      setSaved(true)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const absentCount = students.filter(s => s.isAbsent).length
  const appeared = students.filter(s => !s.isAbsent && s.marks !== '')
  const avgMarks = appeared.length > 0
    ? Math.round(appeared.reduce((sum, s) => sum + Number(s.marks || 0), 0) / appeared.length)
    : 0
  const blankCount = students.filter(s => !s.isAbsent && (s.marks === '' || s.marks == null)).length

  // ── Render ─────────────────────────────────────────────────

  if (loading) return (
    <div style={{ padding: 24, display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
      <Spinner size={32} />
    </div>
  )

  if (!subjects.length) return (
    <div style={{ padding: 24 }}>
      <PageHeader title="Enter Exam Marks" />
      <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-lg)', padding: '28px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--gold-dark)', fontWeight: 500, marginBottom: 6 }}>No scholastic subjects assigned</p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ask the admin to assign subjects to you in the Tracker.</p>
      </div>
    </div>
  )

  return (
    <div style={{ padding: 20 }}>
      {/* ── Success modal ─────────────────────────────────── */}
      {saved && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20, animation: 'fadeIn 0.2s ease' }}>
          <div className="fade-up" style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '28px 24px', width: '100%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--green-light)', border: '2px solid var(--green-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>Marks saved</h3>
            {saveResult && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
                {saveResult.saved} saved{saveResult.skipped > 0 ? `, ${saveResult.skipped} skipped (manual entries)` : ''}
              </p>
            )}
            {saveResult?.errors?.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--crimson)', marginBottom: 4 }}>{saveResult.errors.length} error(s)</p>
            )}
            <button onClick={() => { setSaved(false); setSelectedPaper(null); setPapers([]); setSelectedTerm(null); setStudents(prev => prev.map(s => ({ ...s, marks: '', isAbsent: false }))) }}
              style={{ width: '100%', padding: '11px', background: 'var(--green)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 14 }}>
              OK
            </button>
          </div>
        </div>
      )}

      {/* ── Review modal ──────────────────────────────────── */}
      {showReview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, animation: 'fadeIn 0.2s ease' }}>
          <div className="fade-up" style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', width: '100%', maxWidth: 520, maxHeight: '85vh', boxShadow: '0 -8px 40px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--gray-100)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--green-dark)' }}>Review entries</h3>
                <button onClick={() => setShowReview(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, padding: 4, lineHeight: 1 }}>×</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedPaper?.paper_name} · {selectedSubject?.className} · Max {selectedPaper?.max_marks}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: 'var(--green-light)', color: 'var(--green)', fontWeight: 600 }}>{appeared.length} appeared</span>
                <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: 'var(--crimson-light)', color: 'var(--crimson)', fontWeight: 600 }}>{absentCount} absent</span>
                {blankCount > 0 && <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: 'var(--gold-light)', color: 'var(--gold-dark)', fontWeight: 600 }}>{blankCount} blank</span>}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px' }}>
              {students.map((s, i) => {
                const marksNum = s.isAbsent ? null : (s.marks === '' ? null : Number(s.marks))
                const pct = marksNum != null && selectedPaper?.max_marks ? Math.round((marksNum / Number(selectedPaper.max_marks)) * 100) : null
                const passed = pct != null && selectedPaper?.passing_marks != null ? marksNum >= Number(selectedPaper.passing_marks) : null
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i === students.length - 1 ? 'none' : '1px solid var(--gray-100)' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: s.isAbsent ? 'var(--crimson)' : marksNum == null ? 'var(--gold-light)' : 'var(--green-light)', color: s.isAbsent ? 'white' : marksNum == null ? 'var(--gold-dark)' : 'var(--green)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.rollNumber}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {s.isAbsent ? (
                        <span style={{ fontSize: 11, color: 'var(--crimson)', fontWeight: 600 }}>Absent</span>
                      ) : marksNum == null ? (
                        <span style={{ fontSize: 11, color: 'var(--gold-dark)', fontWeight: 600 }}>—</span>
                      ) : (
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: passed === false ? 'var(--crimson)' : 'var(--green)' }}>{s.marks}<span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>/{selectedPaper?.max_marks}</span></div>
                          {pct != null && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{pct}%</div>}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ padding: '14px 20px 18px', borderTop: '1px solid var(--gray-100)', flexShrink: 0, background: 'var(--white)' }}>
              {blankCount > 0 && (
                <p style={{ fontSize: 11, color: 'var(--gold-dark)', marginBottom: 10, padding: '7px 10px', background: 'var(--gold-light)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(201,162,39,0.25)' }}>
                  ⚠ {blankCount} student{blankCount > 1 ? 's have' : ' has'} no marks — saved as blank.
                </p>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setShowReview(false)} style={{ flex: 1, padding: '12px', background: 'var(--white)', color: 'var(--green)', border: '1.5px solid var(--green-muted)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>← Edit</button>
                <button onClick={async () => { setShowReview(false); await handleSubmitMarks() }} disabled={saving}
                  style={{ flex: 2, padding: '12px', background: saving ? 'var(--gray-200)' : 'var(--green)', color: saving ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', boxShadow: saving ? 'none' : '0 4px 14px rgba(26,74,46,0.25)' }}>
                  {saving ? 'Saving…' : 'Confirm & save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Paper form modal ──────────────────────────────── */}
      {showPaperForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, animation: 'fadeIn 0.2s ease' }}>
          <div className="fade-up" style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', width: '100%', maxWidth: 520, boxShadow: '0 -8px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--gray-100)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--green-dark)' }}>{editingPaper ? 'Edit paper' : 'New paper'}</h3>
                <button onClick={() => { setShowPaperForm(false); setEditingPaper(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, padding: 4, lineHeight: 1 }}>×</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{selectedSubject?.subjectName} · {selectedTerm?.label ?? selectedTerm?.id}</p>
            </div>
            <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Paper name', key: 'paperName', placeholder: 'e.g. Unit Test 1', required: true },
                { label: 'Max marks', key: 'maxMarks', placeholder: '100', type: 'number', required: true },
                { label: 'Passing marks', key: 'passingMarks', placeholder: '33', type: 'number' },
                { label: 'Exam date', key: 'examDate', type: 'date' },
              ].map(({ label, key, placeholder, type = 'text', required }) => (
                <div key={key}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>{label}{required && ' *'}</label>
                  <input
                    type={type}
                    value={paperForm[key]}
                    onChange={e => setPaperForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 14, boxSizing: 'border-box' }}
                  />
                </div>
              ))}
              <button onClick={handleSavePaper} disabled={saving || !paperForm.paperName.trim() || !paperForm.maxMarks}
                style={{ width: '100%', padding: '13px', background: (!paperForm.paperName.trim() || !paperForm.maxMarks) ? 'var(--gray-200)' : 'var(--green)', color: (!paperForm.paperName.trim() || !paperForm.maxMarks) ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {saving ? 'Saving…' : editingPaper ? 'Update paper' : 'Create paper'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ──────────────────────────────────── */}

      {/* STEP 1: Pick subject */}
      {!selectedSubject && (
        <>
          <PageHeader title="Enter Exam Marks" subtitle="Select the subject you want to enter marks for" />
          <ErrorBanner message={error} onDismiss={() => setError('')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {subjects.map(s => (
              <button key={s.id} onClick={() => setSelectedSubject(s)}
                style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '14px 16px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{s.subjectName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.className} · {s.branchCode}</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            ))}
          </div>
        </>
      )}

      {/* STEP 2: Pick term */}
      {selectedSubject && !selectedTerm && (
        <>
          <PageHeader title={selectedSubject.subjectName} subtitle={`${selectedSubject.className} · ${selectedSubject.branchCode}`} onBack={() => setSelectedSubject(null)} />
          <ErrorBanner message={error} onDismiss={() => setError('')} />
          {terms.length === 0 ? (
            <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-lg)', padding: '24px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--gold-dark)', fontWeight: 500, marginBottom: 4 }}>No terms configured</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ask the admin to set up terms in the Academic Tracker.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {terms.map(t => (
                <button key={t.id} onClick={() => setSelectedTerm(t)}
                  style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '14px 16px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{t.label ?? t.id}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* STEP 3: Pick or create paper */}
      {selectedSubject && selectedTerm && !selectedPaper && (
        <>
          <PageHeader title={selectedTerm.label ?? selectedTerm.id} subtitle={`${selectedSubject.subjectName} · ${selectedSubject.className}`} onBack={() => setSelectedTerm(null)} />
          <ErrorBanner message={error} onDismiss={() => setError('')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {papers.map(p => (
              <button key={p.id} onClick={() => setSelectedPaper(p)}
                style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '14px 16px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{p.paper_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Max {p.max_marks}{p.passing_marks ? ` · Pass ${p.passing_marks}` : ''}{p.exam_date ? ` · ${p.exam_date}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <button onClick={e => { e.stopPropagation(); setEditingPaper(p); setPaperForm({ paperName: p.paper_name, maxMarks: String(p.max_marks), passingMarks: p.passing_marks ? String(p.passing_marks) : '', examDate: p.exam_date ?? '' }); setShowPaperForm(true) }}
                    style={{ background: 'var(--gray-100)', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 500 }}>Edit</button>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => { setEditingPaper(null); setPaperForm({ paperName: '', maxMarks: '', passingMarks: '', examDate: '' }); setShowPaperForm(true) }}
            style={{ width: '100%', padding: '13px', background: 'transparent', border: '1.5px dashed var(--green-muted)', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, color: 'var(--green)', cursor: 'pointer' }}>
            + Add new paper
          </button>
        </>
      )}

      {/* STEP 4: Enter marks */}
      {selectedSubject && selectedTerm && selectedPaper && (
        <>
          <PageHeader title="Enter Marks" onBack={() => setSelectedPaper(null)} />
          <ErrorBanner message={error} onDismiss={() => setError('')} />

          {/* Paper info strip */}
          <div style={{ background: 'var(--green-light)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, border: '1px solid var(--green-muted)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--green-dark)' }}>{selectedPaper.paper_name}</h2>
              <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>{selectedSubject.subjectName}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--green-mid)', marginTop: 2 }}>
              {selectedSubject.className} · Max: {selectedPaper.max_marks}{selectedPaper.passing_marks ? ` · Pass: ${selectedPaper.passing_marks}` : ''}
            </div>
          </div>

          {/* Live summary */}
          {students.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Students', value: students.length },
                { label: 'Absent', value: absentCount, color: absentCount > 0 ? 'var(--crimson)' : 'var(--text)' },
                { label: 'Class avg', value: avgMarks || '—', color: selectedPaper.passing_marks && avgMarks < Number(selectedPaper.passing_marks) ? 'var(--crimson)' : 'var(--green)' },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--white)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--gray-100)', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color || 'var(--text)', fontFamily: 'var(--font-display)' }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Student rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {students.map((s, i) => (
              <div key={i} style={{ background: s.isAbsent ? 'var(--crimson-light)' : 'var(--white)', borderRadius: 'var(--radius-md)', border: `1px solid ${s.isAbsent ? 'rgba(139,26,26,0.15)' : 'var(--gray-100)'}`, padding: '12px 14px', transition: 'all 0.15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: s.isAbsent ? 0 : 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: s.isAbsent ? 'var(--crimson)' : 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: s.isAbsent ? 'white' : 'var(--green)' }}>{s.rollNumber}</span>
                  </div>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{s.name}</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flexShrink: 0 }}>
                    <input type="checkbox" checked={s.isAbsent} onChange={e => updateMark(i, 'isAbsent', e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--crimson)' }} />
                    <span style={{ fontSize: 11, color: s.isAbsent ? 'var(--crimson)' : 'var(--text-muted)', fontWeight: s.isAbsent ? 600 : 400 }}>Absent</span>
                  </label>
                </div>
                {!s.isAbsent && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="number" min="0" max={selectedPaper.max_marks} step="0.5" value={s.marks}
                      onChange={e => updateMark(i, 'marks', e.target.value)}
                      placeholder="Marks"
                      style={{ width: 80, padding: '7px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 14, textAlign: 'center' }} />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ {selectedPaper.max_marks}</span>
                    {s.marks !== '' && (
                      <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 'auto', color: selectedPaper.passing_marks && Number(s.marks) < Number(selectedPaper.passing_marks) ? 'var(--crimson)' : 'var(--green)' }}>
                        {Math.round(Number(s.marks) / Number(selectedPaper.max_marks || 1) * 100)}%
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <button onClick={() => setShowReview(true)} disabled={saving || students.length === 0}
            style={{ width: '100%', padding: '15px', background: students.length === 0 ? 'var(--gray-200)' : 'var(--green)', color: students.length === 0 ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 15, fontWeight: 600, cursor: students.length === 0 ? 'not-allowed' : 'pointer', boxShadow: students.length === 0 ? 'none' : '0 4px 14px rgba(26,74,46,0.25)' }}>
            Review & Save ({students.length} students)
          </button>
        </>
      )}
    </div>
  )
}
