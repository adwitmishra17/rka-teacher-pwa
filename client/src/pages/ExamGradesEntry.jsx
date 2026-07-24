import React, { useState, useEffect } from 'react'
import { api } from '../lib/api'

// ============================================================
// ExamGradesEntry — Co-scholastic grade entry
//
// Flow: pick subject (co_scholastic) → pick term → enter
// A+ / A / B / C / D per student → save to exam_coscholastic_grades
// ============================================================

const GRADE_OPTIONS = ['A+', 'A', 'B', 'C', 'D']

function Spinner({ size = 24 }) {
  return <div style={{ width: size, height: size, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
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
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--green-dark)' }}>{title}</h1>
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

function GradeButton({ grade, selected, onClick }) {
  const colors = {
    'A+': { bg: '#e8f5e9', border: '#4caf50', text: '#1b5e20' },
    'A':  { bg: '#f1f8e9', border: '#8bc34a', text: '#33691e' },
    'B':  { bg: '#fff8e1', border: '#ffc107', text: '#e65100' },
    'C':  { bg: '#fff3e0', border: '#ff9800', text: '#bf360c' },
    'D':  { bg: '#fce4ec', border: '#e91e63', text: '#880e4f' },
  }
  const c = selected ? colors[grade] : {}
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      border: selected ? `1.5px solid ${c.border}` : '1.5px solid var(--gray-200)',
      background: selected ? c.bg : 'var(--white)',
      color: selected ? c.text : 'var(--text-muted)',
      transition: 'all 0.12s',
    }}>
      {grade}
    </button>
  )
}

export default function ExamGradesEntry() {
  const [subjects, setSubjects] = useState([])
  const [terms, setTerms] = useState([])
  const [students, setStudents] = useState([])

  const [selectedSubject, setSelectedSubject] = useState(null)
  const [selectedTerm, setSelectedTerm] = useState(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [saveResult, setSaveResult] = useState(null)

  // Load co-scholastic subjects
  useEffect(() => {
    api.getMySubjects()
      .then(({ subjects: all }) => setSubjects(all.filter(s => s.kind === 'co_scholastic')))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Terms when subject selected
  useEffect(() => {
    if (!selectedSubject) return
    setTerms([]); setSelectedTerm(null); setStudents([])
    api.getTerms(selectedSubject.sessionCode, selectedSubject.branchId)
      .then(({ terms: list }) => setTerms(list))
      .catch(e => setError(e.message))
  }, [selectedSubject])

  // Students + existing grades when term selected
  useEffect(() => {
    if (!selectedSubject || !selectedTerm) return

    const loadStudents = api.getStudents(selectedSubject.className, selectedSubject.branchCode)
    const loadGrades = api.getGrades(selectedSubject.id, selectedTerm.id)

    Promise.all([loadStudents, loadGrades])
      .then(([{ students: list }, { grades: existing }]) => {
        const byAdmission = new Map((existing ?? []).map(g => [g.admissionNo, g]))
        setStudents(list.map(s => ({
          admissionNo: s.admission_no,
          name: s.full_name,
          rollNumber: s.roll_number,
          grade: byAdmission.get(s.admission_no)?.grade ?? '',
          remarks: byAdmission.get(s.admission_no)?.remarks ?? '',
        })))
      })
      .catch(e => setError(e.message))
  }, [selectedSubject, selectedTerm])

  function updateStudent(idx, field, value) {
    setStudents(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  async function handleSave() {
    if (!selectedSubject || !selectedTerm || students.length === 0) return
    setSaving(true); setError('')
    try {
      const payload = students.map(s => ({
        admissionNo: s.admissionNo,
        grade: s.grade || null,
        remarks: s.remarks || null,
      }))
      const result = await api.saveGrades(selectedTerm.id, selectedSubject.id, payload)
      setSaveResult(result)
      setSaved(true)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const gradedCount = students.filter(s => s.grade).length
  const ungradedCount = students.length - gradedCount

  if (loading) return <div style={{ padding: 24, display: 'flex', justifyContent: 'center', paddingTop: 60 }}><Spinner size={32} /></div>

  if (!subjects.length) return (
    <div style={{ padding: 24 }}>
      <PageHeader title="Co-Scholastic Grades" />
      <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-lg)', padding: '28px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--gold-dark)', fontWeight: 500, marginBottom: 6 }}>No co-scholastic subjects assigned</p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ask the admin to assign co-scholastic subjects to you in the Tracker.</p>
      </div>
    </div>
  )

  return (
    <div style={{ padding: 20 }}>
      {/* Success modal */}
      {saved && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20, animation: 'fadeIn 0.2s ease' }}>
          <div className="fade-up" style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '28px 24px', width: '100%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--green-light)', border: '2px solid var(--green-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>Grades saved</h3>
            {saveResult && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>{saveResult.saved} saved{saveResult.skipped > 0 ? `, ${saveResult.skipped} skipped (manual)` : ''}</p>}
            <button onClick={() => { setSaved(false); setSelectedTerm(null); setStudents([]) }}
              style={{ width: '100%', padding: '11px', background: 'var(--green)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 14 }}>
              OK
            </button>
          </div>
        </div>
      )}

      {/* STEP 1: pick subject */}
      {!selectedSubject && (
        <>
          <PageHeader title="Co-Scholastic Grades" subtitle="Select a subject to enter grades" />
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

      {/* STEP 2: pick term */}
      {selectedSubject && !selectedTerm && (
        <>
          <PageHeader title={selectedSubject.subjectName} subtitle={`${selectedSubject.className} · ${selectedSubject.branchCode}`} onBack={() => setSelectedSubject(null)} />
          <ErrorBanner message={error} onDismiss={() => setError('')} />
          {terms.length === 0 ? (
            <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-lg)', padding: '24px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--gold-dark)', fontWeight: 500 }}>No terms configured</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Ask the admin to set up terms in the Academic Tracker.</p>
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

      {/* STEP 3: enter grades */}
      {selectedSubject && selectedTerm && (
        <>
          <PageHeader title="Enter Grades" onBack={() => setSelectedTerm(null)} />
          <ErrorBanner message={error} onDismiss={() => setError('')} />

          {/* Context strip */}
          <div style={{ background: 'var(--green-light)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, border: '1px solid var(--green-muted)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--green-dark)' }}>{selectedSubject.subjectName}</div>
            <div style={{ fontSize: 12, color: 'var(--green-mid)', marginTop: 2 }}>
              {selectedSubject.className} · {selectedTerm.label ?? selectedTerm.id}
              {gradedCount > 0 && ` · ${gradedCount}/${students.length} graded`}
            </div>
          </div>

          {/* Grade key */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {GRADE_OPTIONS.map(g => <GradeButton key={g} grade={g} selected={false} onClick={() => {}} />)}
            <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 4 }}>tap to assign</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {students.map((s, i) => (
              <div key={i} style={{ background: 'var(--white)', borderRadius: 'var(--radius-md)', border: '1px solid var(--gray-100)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--green)' }}>{s.rollNumber}</span>
                  </div>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{s.name}</span>
                  {s.grade && (
                    <button onClick={() => updateStudent(i, 'grade', '')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, padding: '0 4px', lineHeight: 1 }}>×</button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {GRADE_OPTIONS.map(g => (
                    <GradeButton key={g} grade={g} selected={s.grade === g} onClick={() => updateStudent(i, 'grade', s.grade === g ? '' : g)} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {ungradedCount > 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 12 }}>
              {ungradedCount} student{ungradedCount > 1 ? 's' : ''} without a grade — saved as blank.
            </p>
          )}

          <button onClick={handleSave} disabled={saving || students.length === 0}
            style={{ width: '100%', padding: '15px', background: students.length === 0 ? 'var(--gray-200)' : 'var(--green)', color: students.length === 0 ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 15, fontWeight: 600, cursor: students.length === 0 ? 'not-allowed' : 'pointer', boxShadow: students.length === 0 ? 'none' : '0 4px 14px rgba(26,74,46,0.25)' }}>
            {saving ? 'Saving…' : `Save Grades (${students.length} students)`}
          </button>
        </>
      )}
    </div>
  )
}
