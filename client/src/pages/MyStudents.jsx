// =========================================================================
// MyStudents.jsx — READ-ONLY class roster for the class teacher.
// Route: /my-students
//
// SMS is the single source of truth for student data. This page shows the
// live SMS roster (via the server API) — adding, editing or removing
// students happens ONLY at the school office in SMS. The old Firestore
// roster editing (add / edit / withdraw / CSV upload) that used to live
// here has been removed deliberately; Firestore rules now reject student
// writes from every client as the hard boundary.
// =========================================================================

import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db, auth } from '../firebase/config'
import { useAuth } from '../App'

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

export default function MyStudents() {
  const { user, teacher } = useAuth()
  const myEmail = (teacher?.personalEmail || teacher?.email || user?.email || '').toLowerCase().trim()

  const [assignment, setAssignment] = useState(null)
  const [assignmentLoading, setAssignmentLoading] = useState(true)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!myEmail) { setAssignmentLoading(false); return }
    ;(async () => {
      try {
        const s = await getDoc(doc(db, 'classTeacherByEmail', myEmail))
        if (cancelled) return
        setAssignment(s.exists() ? { className: s.data().className, branchCode: s.data().branchCode } : null)
      } catch { if (!cancelled) setAssignment(null) }
      finally { if (!cancelled) setAssignmentLoading(false) }
    })()
    return () => { cancelled = true }
  }, [myEmail])

  useEffect(() => {
    let cancelled = false
    if (!assignment) { setLoading(false); return }
    ;(async () => {
      setLoading(true); setError('')
      try {
        const token = await auth.currentUser.getIdToken()
        const qs = new URLSearchParams({ className: assignment.className, branchCode: assignment.branchCode })
        const res = await fetch(`${BASE}/students?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) setStudents(data.students || [])
      } catch (e) { if (!cancelled) setError(e.message || String(e)) }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [assignment])

  if (assignmentLoading) return <div style={pad}>Loading…</div>
  if (!assignment) {
    return (
      <div style={pad}>
        <Link to="/" style={back}>&larr; Back to home</Link>
        <h1 style={h1}>My Class Students</h1>
        <div style={infoBox}>You are not assigned as a class teacher. Ask the admin to assign you a class.</div>
      </div>
    )
  }

  return (
    <div style={pad}>
      <Link to="/" style={back}>&larr; Back to home</Link>
      <h1 style={h1}>{assignment.className} <span style={{ fontSize: 14, color: '#6b6b6b', fontWeight: 400 }}>({assignment.branchCode})</span></h1>
      <div style={{ ...infoBox, background: '#f2f7f3', borderColor: '#cfe3d4', color: '#1a4a2e' }}>
        This roster comes live from the school office (SMS). To admit, edit or withdraw a student, contact the office — changes appear here automatically.
      </div>

      {loading && <div style={{ padding: 20, color: '#999' }}>Loading roster…</div>}
      {error && <div style={{ padding: 12, color: '#b3261e', fontSize: 13 }}>{error}</div>}

      {!loading && !error && (
        <>
          <div style={{ fontSize: 13, color: '#6b6b6b', margin: '14px 0 8px' }}>{students.length} students · roll order</div>
          {students.map((s) => (
            <div key={s.id} style={row}>
              <div style={rollBadge}>{s.roll_number || '—'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: '#222' }}>{s.full_name}</div>
                <div style={{ fontSize: 11.5, color: '#8a8a8a' }}>
                  Adm {s.admission_no}{s.section ? ` · Sec ${s.section}` : ''}{s.father_name ? ` · ${s.father_name}` : ''}
                </div>
              </div>
            </div>
          ))}
          {students.length === 0 && <div style={infoBox}>No active students in {assignment.className} yet.</div>}
        </>
      )}
    </div>
  )
}

const pad = { padding: '18px 16px 40px', maxWidth: 560, margin: '0 auto' }
const back = { fontSize: 13, color: '#1a4a2e', textDecoration: 'none', display: 'inline-block', marginBottom: 10 }
const h1 = { fontSize: 20, fontWeight: 700, color: '#1a4a2e', margin: '0 0 12px' }
const infoBox = { padding: '12px 14px', background: '#faf9f4', border: '1px solid #e2e0d6', borderRadius: 10, fontSize: 13, color: '#6b6b6b', lineHeight: 1.5 }
const row = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#fff', border: '1px solid #eee', borderRadius: 10, marginBottom: 8 }
const rollBadge = { minWidth: 34, height: 34, borderRadius: 8, background: '#f2f7f3', color: '#1a4a2e', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }
