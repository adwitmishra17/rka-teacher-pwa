import React, { useState, useEffect } from 'react'
import { api } from '../lib/api'

// ============================================================
// HpcEntry — Holistic Progress Card assessment entry
//
// Flow:
//   1. Pick a subject (to determine branchCode + sessionCode)
//      OR fall back to any assigned subject's metadata.
//   2. Pick a term.
//   3. Pick a student from the class roster.
//   4. Fill in domain grades (template from backend / Firestore).
//   5. Save → backend upserts hpc_assessments with source='teacher_pwa'.
// ============================================================

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

export default function HpcEntry() {
  // Context: loaded once, gives us branchCode + sessionCode for the API
  const [context, setContext] = useState(null)  // { branchCode, sessionCode, className }
  const [terms, setTerms] = useState([])
  const [hpcTemplate, setHpcTemplate] = useState(null)
  const [students, setStudents] = useState([])

  const [selectedTerm, setSelectedTerm] = useState(null)
  const [selectedStudent, setSelectedStudent] = useState(null)

  // Per-domain grade map: { [domainId]: grade }
  const [domainGrades, setDomainGrades] = useState({})
  const [generalRemarks, setGeneralRemarks] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Bootstrap: load any assigned subject to get session/branch context
  useEffect(() => {
    api.getMySubjects()
      .then(({ subjects }) => {
        if (!subjects.length) {
          setLoading(false)
          return
        }
        // Use the first subject for context (all subjects share the same branch/session)
        const s = subjects[0]
        const ctx = { branchCode: s.branchCode, sessionCode: s.sessionCode, className: s.className }
        setContext(ctx)

        return Promise.all([
          api.getTerms(s.sessionCode),
          api.getHpcTemplate(s.sessionCode, s.branchCode),
          api.getStudents(s.className, s.branchCode),
        ])
      })
      .then(results => {
        if (!results) return
        const [{ terms: termList }, template, { students: studentList }] = results
        setTerms(termList)
        setHpcTemplate(template)
        setStudents(studentList.map(s => ({
          admissionNo: s.admission_no,
          name: s.full_name,
          rollNumber: s.roll_number,
        })))
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function setDomainGrade(domainId, grade) {
    setDomainGrades(prev => {
      if (prev[domainId] === grade) {
        const next = { ...prev }
        delete next[domainId]
        return next
      }
      return { ...prev, [domainId]: grade }
    })
  }

  async function handleSave() {
    if (!context || !selectedTerm || !selectedStudent) return
    setSaving(true); setError('')
    try {
      await api.saveHpc({
        sessionCode: context.sessionCode,
        termId: selectedTerm.id,
        branchCode: context.branchCode,
        studentAdmissionNo: selectedStudent.admissionNo,
        domains: domainGrades,
        generalRemarks: generalRemarks.trim() || null,
      })
      setSaved(true)
    } catch (e) {
      if (e.status === 409) {
        setError(e.data?.error ?? 'This assessment was entered manually and cannot be overwritten.')
      } else {
        setError(e.message)
      }
    }
    setSaving(false)
  }

  const domainsComplete = hpcTemplate?.domains?.every(d => domainGrades[d.id]) ?? false

  if (loading) return <div style={{ padding: 24, display: 'flex', justifyContent: 'center', paddingTop: 60 }}><Spinner size={32} /></div>

  if (!context) return (
    <div style={{ padding: 24 }}>
      <PageHeader title="HPC Assessment" />
      <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-lg)', padding: '28px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--gold-dark)', fontWeight: 500, marginBottom: 6 }}>No subjects assigned</p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ask the admin to assign subjects to you in the Tracker.</p>
      </div>
    </div>
  )

  return (
    <div style={{ padding: 20 }}>
      {/* Success modal */}
      {saved && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20, animation: 'fadeIn 0.2s ease' }}>
          <div className="fade-up" style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '28px 24px', width: '100%', maxWidth: 340, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f5f0fb', border: '2px solid #c4a0e8', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7c3cb4" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>HPC saved</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>{selectedStudent?.name}</p>
            <button onClick={() => {
              setSaved(false); setSelectedStudent(null)
              setDomainGrades({}); setGeneralRemarks('')
            }}
              style={{ width: '100%', padding: '11px', background: '#7c3cb4', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 14 }}>
              Next student
            </button>
          </div>
        </div>
      )}

      {/* STEP 1: pick term */}
      {!selectedTerm && (
        <>
          <PageHeader title="HPC Assessment" subtitle="Holistic Progress Card — select term" />
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

      {/* STEP 2: pick student */}
      {selectedTerm && !selectedStudent && (
        <>
          <PageHeader title={selectedTerm.label ?? selectedTerm.id} subtitle={`${context.className} · ${context.branchCode}`} onBack={() => setSelectedTerm(null)} />
          <ErrorBanner message={error} onDismiss={() => setError('')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {students.map(s => (
              <button key={s.admissionNo} onClick={() => { setSelectedStudent(s); setDomainGrades({}); setGeneralRemarks('') }}
                style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '12px 16px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f5f0fb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#7c3cb4' }}>{s.rollNumber}</span>
                </div>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{s.name}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            ))}
          </div>
        </>
      )}

      {/* STEP 3: fill domains */}
      {selectedTerm && selectedStudent && (
        <>
          <PageHeader title={selectedStudent.name} subtitle={`HPC · ${selectedTerm.label ?? selectedTerm.id}`} onBack={() => { setSelectedStudent(null); setDomainGrades({}); setGeneralRemarks('') }} />
          <ErrorBanner message={error} onDismiss={() => setError('')} />

          {hpcTemplate?.domains?.map(domain => (
            <div key={domain.id} style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>{domain.label}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(domain.gradeOptions ?? ['A+', 'A', 'B', 'C', 'D']).map(g => (
                  <GradeButton key={g} grade={g} selected={domainGrades[domain.id] === g} onClick={() => setDomainGrade(domain.id, g)} />
                ))}
              </div>
            </div>
          ))}

          {hpcTemplate?.generalRemarksEnabled !== false && (
            <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 20 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 8 }}>General remarks</label>
              <textarea
                value={generalRemarks}
                onChange={e => setGeneralRemarks(e.target.value)}
                placeholder="Optional remarks for this student…"
                rows={3}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
              />
            </div>
          )}

          {!domainsComplete && hpcTemplate?.domains?.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 12 }}>
              {hpcTemplate.domains.filter(d => !domainGrades[d.id]).length} domain{hpcTemplate.domains.filter(d => !domainGrades[d.id]).length > 1 ? 's' : ''} without a grade — will be saved as blank.
            </p>
          )}

          <button onClick={handleSave} disabled={saving}
            style={{ width: '100%', padding: '15px', background: saving ? 'var(--gray-200)' : '#7c3cb4', color: saving ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 15, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', boxShadow: saving ? 'none' : '0 4px 14px rgba(124,60,180,0.3)' }}>
            {saving ? 'Saving…' : 'Save HPC Assessment'}
          </button>
        </>
      )}
    </div>
  )
}
