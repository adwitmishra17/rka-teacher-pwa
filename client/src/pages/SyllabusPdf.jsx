import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

// ============================================================
// Syllabus PDF — a teacher uploads/replaces the syllabus PDF for the
// class+subjects assigned to them (exam_subjects.assigned_teacher_email).
// The server enforces ownership + stores it in the shared Firebase
// Storage; parents see it class-wise in the parent app.
// ============================================================

export default function SyllabusPdf() {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const fileRefs = useRef({})

  async function load() {
    setError('')
    try {
      const { subjects } = await api.getMySyllabus()
      setRows(subjects || [])
    } catch (e) { setError(e.message || 'Could not load your subjects') }
  }
  useEffect(() => { load() }, [])

  async function onPick(row, e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.type !== 'application/pdf') { setError('Please choose a PDF file.'); return }
    if (file.size > 25 * 1024 * 1024) { setError('PDF too large. Max 25 MB.'); return }
    const key = `${row.className}||${row.subject}`
    setBusyKey(key); setError('')
    try {
      await api.uploadSyllabus(row.className, row.subject, file)
      await load()
    } catch (e2) { setError(e2.message || 'Upload failed') } finally { setBusyKey('') }
  }

  async function onRemove(row) {
    if (!window.confirm(`Remove the syllabus PDF for ${row.className} · ${row.subject}?`)) return
    const key = `${row.className}||${row.subject}`
    setBusyKey(key); setError('')
    try { await api.deleteSyllabus(row.className, row.subject); await load() }
    catch (e) { setError(e.message || 'Delete failed') } finally { setBusyKey('') }
  }

  return (
    <div className="fade-up" style={{ padding: '18px 16px 90px', maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', fontSize: 20, padding: 0 }}>‹</button>
        <h1 style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 20, fontWeight: 700, color: 'var(--green-dark, #1a4a2e)', margin: 0 }}>Syllabus PDF</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted, #667)', margin: '0 0 16px' }}>Upload a syllabus PDF for your subjects — parents can then open it in the parent app.</p>

      {error && <div style={{ fontSize: 13, color: '#8b1a1a', background: '#fdeaea', padding: '10px 14px', borderRadius: 10, marginBottom: 12 }}>{error}</div>}
      {rows === null && <div style={{ textAlign: 'center', color: 'var(--text-muted,#667)', padding: 40 }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <div style={{ background: 'var(--white,#fff)', borderRadius: 12, padding: 24, textAlign: 'center', color: 'var(--text-muted,#667)', fontSize: 13.5, border: '1px solid #eee' }}>
          No subjects are assigned to you yet. Subject assignments are set up in the Tracker.
        </div>
      )}

      {rows && rows.map((row) => {
        const key = `${row.className}||${row.subject}`
        const busy = busyKey === key
        return (
          <div key={key} style={{ background: 'var(--white,#fff)', border: '1px solid #eee', borderRadius: 12, padding: '13px 15px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink,#1c2733)' }}>{row.subject}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted,#667)' }}>{row.className}</div>
              </div>
              {row.pdfUrl
                ? <span style={{ fontSize: 11, fontWeight: 700, color: '#1a7a3a', background: '#e7f6ec', padding: '3px 9px', borderRadius: 20 }}>Uploaded</span>
                : <span style={{ fontSize: 11, fontWeight: 600, color: '#9a7b12', background: '#fbf3d6', padding: '3px 9px', borderRadius: 20 }}>Not uploaded</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
              <input ref={(el) => { fileRefs.current[key] = el }} type="file" accept="application/pdf,.pdf" onChange={(e) => onPick(row, e)} style={{ display: 'none' }} />
              <button disabled={busy} onClick={() => fileRefs.current[key]?.click()} style={{ padding: '8px 14px', background: busy ? '#cfd8d3' : 'var(--green,#1a4a2e)', color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'Working…' : (row.pdfUrl ? 'Replace PDF' : 'Upload PDF')}
              </button>
              {row.pdfUrl && !busy && (
                <>
                  {/* One PDF can cover several subjects (office uploads: "English
                      Grammar"+"English Literature" for English; one "Science" for
                      Phy/Chem/Bio; a class-wide "Complete Syllabus" for Nursery–8)
                      — link every covering file. */}
                  {(row.files?.length ? row.files : [{ subject: row.subject, pdfUrl: row.pdfUrl }]).map((f) => (
                    <a key={f.pdfUrl} href={f.pdfUrl} target="_blank" rel="noreferrer" style={{ padding: '8px 14px', background: '#fff', color: 'var(--green,#1a4a2e)', border: '1px solid #cfe0d6', borderRadius: 9, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                      {(row.files?.length > 1 || (row.files?.length === 1 && row.files[0].subject !== row.subject)) ? `View · ${f.subject}` : 'View'}
                    </a>
                  ))}
                  {/* Only a PDF uploaded under this exact subject can be removed
                      here — office/family uploads are managed in the Tracker. */}
                  {row.exact && (
                    <button onClick={() => onRemove(row)} style={{ padding: '8px 14px', background: '#fff', color: '#8b1a1a', border: '1px solid #f0d5d5', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
