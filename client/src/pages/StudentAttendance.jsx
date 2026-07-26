// =========================================================================
// StudentAttendance.jsx — class teacher's daily attendance marking page
// Route: /student-attendance
//
// Mirrors admin AttendanceClass but:
//   - Forced to teacher's classTeacherOf + branchCodes[0]
//   - Date picker limited to today + last 7 days (the edit window)
//   - Cannot edit beyond 7 days (admin path only)
// =========================================================================

import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  collection, query, where, getDocs, doc, getDoc, setDoc, deleteDoc, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { writeAttendanceAudit } from '../lib/attendanceAudit'
import { todayIST, lastSevenDays, friendlyDateLabel, isSunday, isWithinTeacherEditWindow } from '../lib/attendanceDates'

function docIdFor(date, studentId) { return `${date}_${studentId}` }

export default function StudentAttendance() {
  const { user, teacher } = useAuth()

  // Source class teacher assignment from classTeacherByEmail/<email>, which is
  // also what Firestore rules check. This avoids a class of bugs where the
  // teacher doc and the lookup doc disagree (e.g. branchCodes reordered after
  // assignment, or stale teacher.classTeacherOf from a deleted assignment).
  const myEmail = (teacher?.personalEmail || teacher?.email || user?.email || '').toLowerCase().trim()
  const [assignment, setAssignment] = useState(null)   // { className, branchCode } | null
  const [assignmentLoading, setAssignmentLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!myEmail) { setAssignmentLoading(false); return }
    ;(async () => {
      try {
        const s = await getDoc(doc(db, 'classTeacherByEmail', myEmail))
        if (cancelled) return
        if (s.exists()) {
          const d = s.data()
          setAssignment({ className: d.className, branchCode: d.branchCode })
        } else {
          setAssignment(null)
        }
      } catch (e) {
        console.error('classTeacherByEmail lookup failed:', e)
        if (!cancelled) setAssignment(null)
      } finally {
        if (!cancelled) setAssignmentLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [myEmail])

  const classTeacherOf = assignment?.className || null
  const branchCode = assignment?.branchCode || null

  const [selectedDate, setSelectedDate] = useState(todayIST())
  const [students, setStudents] = useState([])
  const [attendance, setAttendance] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Explicit-save model: taps only change local state; `dirty` maps
  // studentId → { before, after } until Save commits the batch.
  // `before` is the ORIGINAL server state (kept across re-taps) so the
  // audit trail records the true transition, and a tap back to the
  // original state drops the entry from the batch entirely.
  const [dirty, setDirty] = useState({})
  const [savingAll, setSavingAll] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const dirtyCount = Object.keys(dirty).length

  // Don't let a phone back-swipe or tab close silently eat unsaved marks.
  useEffect(() => {
    if (dirtyCount === 0) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirtyCount])

  async function load() {
    if (!classTeacherOf || !branchCode) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      // Roster comes LIVE from SMS (single source of truth for students).
      // Attendance docs are keyed `${date}_${smsStudentId}` from here on.
      const token = await (await import('../firebase/config')).auth.currentUser.getIdToken()
      const qs = new URLSearchParams({ className: classTeacherOf, branchCode })
      const rosterRes = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? '/api'}/students?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const rosterData = await rosterRes.json()
      if (!rosterRes.ok) throw new Error(rosterData.error || `HTTP ${rosterRes.status}`)
      const list = (rosterData.students || []).map(s => ({
        id: s.id,
        fullName: s.full_name,
        rollNumber: s.roll_number || '',
        admissionNo: s.admission_no,
        className: classTeacherOf,
        branchCode,
      }))
      setStudents(list)

      const attSnap = await getDocs(query(
        collection(db, 'studentAttendance'),
        where('className', '==', classTeacherOf),
        where('branchCode', '==', branchCode),
        where('date', '==', selectedDate),
      ))
      const map = {}
      attSnap.forEach(d => {
        const x = d.data()
        map[x.studentId] = { status: x.status, isLate: x.isLate, docId: d.id, markedAt: x.markedAt }
      })
      setAttendance(map)
      setDirty({})
    } catch (e) {
      console.error(e); setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [classTeacherOf, branchCode, selectedDate])

  function actor() {
    return {
      performedBy: teacher?.id || user?.uid || 'unknown',
      performedByName: teacher?.fullName || user?.email || 'unknown',
      performedByRole: 'class_teacher',
    }
  }

  // Tap = LOCAL change only. Nothing touches Firestore until Save.
  function mark(student, target) {
    if (!isWithinTeacherEditWindow(selectedDate)) {
      alert('This date is outside your 7-day edit window. Contact admin to make changes.')
      return
    }
    const current = attendance[student.id] || null
    const existingDirty = dirty[student.id]
    // The audit `before` is the original SERVER state — first tap captures it,
    // later taps on the same student keep it.
    const original = existingDirty ? existingDirty.before : current

    let after
    if (target === 'unmark') {
      if (!current) return
      after = null
    } else {
      after = target === 'absent'
        ? { status: 'absent', isLate: false }
        : { status: 'present', isLate: target === 'late' }
    }

    // Local display state
    setAttendance(prev => {
      const next = { ...prev }
      if (after === null) delete next[student.id]
      else next[student.id] = { ...after, markedAt: original?.markedAt }
      return next
    })

    // Dirty bookkeeping — tapping back to the original state removes the entry.
    setDirty(prev => {
      const next = { ...prev }
      const same = after === null
        ? original === null
        : original != null && original.status === after.status && !!original.isLate === !!after.isLate
      if (same) delete next[student.id]
      else next[student.id] = { before: original, after, student }
      return next
    })
    setSavedFlash(false)
  }

  // Commit every pending change in one go: writes + audit rows per student.
  async function saveAll() {
    if (dirtyCount === 0 || savingAll) return
    setSavingAll(true)
    const entries = Object.entries(dirty)
    const failures = []
    await Promise.all(entries.map(async ([studentId, { before, after, student }]) => {
      const docId = docIdFor(selectedDate, studentId)
      const ref = doc(db, 'studentAttendance', docId)
      try {
        if (after === null) {
          await deleteDoc(ref)
          await writeAttendanceAudit({
            attendanceDocId: docId,
            student: { ...student, branchCode, className: classTeacherOf },
            date: selectedDate, action: 'unmark',
            before: { status: before.status, isLate: before.isLate }, after: null,
            ...actor(),
          })
        } else {
          const a = actor()
          const payload = {
            studentId, studentName: student.fullName || '',
            rollNumber: student.rollNumber || '',
            className: classTeacherOf, branchCode, date: selectedDate,
            status: after.status, isLate: after.isLate,
            markedBy: a.performedBy, markedByName: a.performedByName, markedByRole: 'class_teacher',
            markedAt: before?.markedAt || Timestamp.now(),
            editedAt: before ? Timestamp.now() : null,
            editedBy: before ? a.performedBy : null,
          }
          await setDoc(ref, payload)
          await writeAttendanceAudit({
            attendanceDocId: docId,
            student: { ...student, branchCode, className: classTeacherOf },
            date: selectedDate, action: before ? 'edit' : 'mark',
            before: before ? { status: before.status, isLate: before.isLate } : null,
            after,
            ...a,
          })
        }
      } catch (e) {
        failures.push(`${student.fullName}: ${e.message || e}`)
      }
    }))
    setSavingAll(false)
    if (failures.length > 0) {
      alert(`Some marks failed to save:\n${failures.join('\n')}`)
      load()
    } else {
      setDirty({})
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2500)
    }
  }

  function discardChanges() {
    load()
  }

  // Guards
  if (!teacher || assignmentLoading) return <div style={loadingStyle}>Loading your profile…</div>
  if (!classTeacherOf || !branchCode) {
    return (
      <div style={containerStyle}>
        <Link to="/" style={backLinkStyle}>&larr; Back to home</Link>
        <h1 style={titleStyle}>Student Attendance</h1>
        <div style={emptyBoxStyle}>
          <p style={{ fontSize: 14, color: '#6b6b6b', marginBottom: 8 }}>You are not assigned as a class teacher.</p>
          <p style={{ fontSize: 13, color: '#999' }}>Ask the admin to assign you a class through the admin portal.</p>
        </div>
      </div>
    )
  }

  // `students` is already filtered to active-only at load time.
  const presentCount = students.filter(s => attendance[s.id]?.status === 'present' && !attendance[s.id]?.isLate).length
  const lateCount = students.filter(s => attendance[s.id]?.status === 'present' && attendance[s.id]?.isLate).length
  const absentCount = students.filter(s => attendance[s.id]?.status === 'absent').length
  const unmarkedCount = students.length - presentCount - lateCount - absentCount

  return (
    <div style={containerStyle}>
      <Link to="/" style={backLinkStyle}>&larr; Back to home</Link>
      <h1 style={titleStyle}>
        {classTeacherOf} <span style={{ fontSize: 14, color: '#6b6b6b', fontWeight: 400 }}>({branchCode})</span>
      </h1>
      <p style={{ fontSize: 13, color: '#6b6b6b', margin: '0 0 16px' }}>{friendlyDateLabel(selectedDate)}</p>

      <div style={dateBarStyle}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: 1 }}>
          {lastSevenDays().map(d => {
            const isActiveDate = d === selectedDate
            const sunday = isSunday(d)
            return (
              <button key={d} onClick={() => {
                if (d !== selectedDate && dirtyCount > 0
                  && !window.confirm('You have unsaved attendance changes. Discard them and switch date?')) return
                setSelectedDate(d)
              }} style={{
                padding: '7px 11px', borderRadius: 6,
                border: '1px solid', borderColor: isActiveDate ? '#1a4a2e' : '#d9d6cb',
                background: isActiveDate ? '#1a4a2e' : '#fff',
                color: isActiveDate ? '#fff' : sunday ? '#999' : '#1a4a2e',
                fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
                {friendlyDateLabel(d).replace(/\s*\(.*\)/, '')}
              </button>
            )
          })}
        </div>
      </div>

      {isSunday(selectedDate) && (
        <div style={infoBoxStyle}>
          {selectedDate === todayIST()
            ? 'Today is Sunday — no attendance to mark.'
            : 'This was a Sunday — typically no attendance.'}
        </div>
      )}

      {!loading && students.length > 0 && (
        <div style={statsBarStyle}>
          <Chip label="P" count={presentCount} color="#1a4a2e" />
          <Chip label="L" count={lateCount} color="#c9a227" />
          <Chip label="A" count={absentCount} color="#8b1a1a" />
          <Chip label="—" count={unmarkedCount} color="#999" />
        </div>
      )}

      {loading && <div style={loadingStyle}>Loading roster…</div>}
      {error && <div style={errorStyle}>{error}</div>}
      {!loading && students.length === 0 && (
        <div style={emptyBoxStyle}>No active students in {classTeacherOf} in SMS. Contact the office if that looks wrong.</div>
      )}

      {!loading && students.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {students.map(s => {
            const a = attendance[s.id]
            const currentBtn =
              !a ? 'none' :
              a.status === 'absent' ? 'absent' :
              a.isLate ? 'late' : 'present'
            return (
              <li key={s.id} style={{
                background: '#fff', border: '1px solid #e8e6dc', borderRadius: 7,
                padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{
                  minWidth: 30, height: 30, borderRadius: '50%', background: '#1a4a2e',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 600, fontSize: 12,
                }}>{s.rollNumber}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.fullName}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <BtnLabel label="P" color="#1a4a2e" active={currentBtn === 'present'} onClick={() => mark(s, 'present')} />
                  <BtnLabel label="L" color="#c9a227" active={currentBtn === 'late'}    onClick={() => mark(s, 'late')} />
                  <BtnLabel label="A" color="#8b1a1a" active={currentBtn === 'absent'}  onClick={() => mark(s, 'absent')} />
                  <BtnLabel label="✕" color="#999"    active={false} faded={currentBtn === 'none'} onClick={() => mark(s, 'unmark')} />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Sticky save bar — appears only when there are unsaved changes. */}
      {(dirtyCount > 0 || savedFlash) && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
          background: 'rgba(250,249,245,0.96)', borderTop: '1px solid #e8e6dc',
          padding: '10px 16px calc(10px + env(safe-area-inset-bottom))',
        }}>
          <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {savedFlash && dirtyCount === 0 ? (
              <div style={{ flex: 1, textAlign: 'center', fontSize: 13.5, fontWeight: 600, color: '#1a4a2e' }}>
                ✓ Attendance saved
              </div>
            ) : (
              <>
                <button onClick={discardChanges} disabled={savingAll} style={{
                  padding: '11px 14px', background: '#fff', border: '1px solid #d9d6cb',
                  borderRadius: 8, color: '#6b6b6b', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>
                  Discard
                </button>
                <button onClick={saveAll} disabled={savingAll} style={{
                  flex: 1, padding: '11px', background: savingAll ? '#9db3a5' : '#1a4a2e',
                  border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 700,
                  cursor: savingAll ? 'default' : 'pointer', boxShadow: '0 4px 14px rgba(26,74,46,0.25)',
                }}>
                  {savingAll ? 'Saving…' : `Save attendance (${dirtyCount} change${dirtyCount === 1 ? '' : 's'})`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function BtnLabel({ label, color, active, faded, onClick }) {
  return (
    <button onClick={onClick} disabled={faded} style={{
      width: 30, height: 30, borderRadius: 5, border: '1.5px solid',
      borderColor: active ? color : '#d9d6cb',
      background: active ? color : '#fff',
      color: active ? '#fff' : color,
      fontSize: 13, fontWeight: 700,
      cursor: faded ? 'default' : 'pointer',
      opacity: faded ? 0.25 : 1,
      transition: 'all 0.12s',
    }}>{label}</button>
  )
}

function Chip({ label, count, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', background: '#fff', border: '1px solid #e8e6dc', borderRadius: 12 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 11, color: '#6b6b6b' }}>{label}</span>
      <strong style={{ fontSize: 12 }}>{count}</strong>
    </div>
  )
}

const containerStyle = { maxWidth: 600, margin: '0 auto', padding: '16px 16px 80px' }
const backLinkStyle = { display: 'inline-block', fontSize: 13, color: '#1a4a2e', textDecoration: 'none', marginBottom: 12 }
const titleStyle = { fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 600, color: '#1a4a2e', margin: '0 0 4px' }
const dateBarStyle = { display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto' }
const statsBarStyle = { display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }
const loadingStyle = { padding: '32px 16px', textAlign: 'center', color: '#6b6b6b', fontSize: 14 }
const errorStyle = { padding: 10, background: '#fdecec', border: '1px solid #f5c7c7', borderRadius: 6, color: '#8b1a1a', fontSize: 13 }
const infoBoxStyle = { padding: '8px 12px', background: '#fff8e6', border: '1px solid #f0d895', color: '#8a6d18', borderRadius: 6, fontSize: 13, marginBottom: 12 }
const emptyBoxStyle = { background: '#fff', border: '1px solid #e8e6dc', borderRadius: 8, padding: 20, marginTop: 12, textAlign: 'center' }
