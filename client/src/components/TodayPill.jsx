// TodayPill — compact home-screen card showing today's punch-in/out and
// number of timetable periods. Taps through to /hrms/attendance.
//
// Punch data  : Supabase Edge Function `get-my-attendance` (same source as
//               MyAttendance.jsx). Requires VITE_SUPABASE_FUNCTIONS_URL.
// Period count: Firestore `timetable` collection. Filters slots by today's
//               day name when the slot has a `day` field; falls back to total
//               unique-class count when there is no day field.

import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { auth, db } from '../firebase/config'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
const IST_TZ        = 'Asia/Kolkata'

// Formatters pinned to IST regardless of device timezone.
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
})
const timeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
})
const dayFullFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TZ, weekday: 'long',   // "Monday"
})
const dayShortFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TZ, weekday: 'short',  // "Mon"
})

function todayKey()   { return dayKeyFmt.format(new Date()) }
function todayFull()  { return dayFullFmt.format(new Date()).toLowerCase() }  // "monday"
function todayShort() { return dayShortFmt.format(new Date()).toLowerCase() } // "mon"

// ─── punch data ──────────────────────────────────────────────────────────────

async function fetchTodayPunch() {
  if (!FUNCTIONS_URL) return null
  const currentUser = auth.currentUser
  if (!currentUser) return null
  const token = await currentUser.getIdToken(/* forceRefresh */ true)
  const res = await fetch(`${FUNCTIONS_URL}/get-my-attendance`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const body = await res.json()
  const today = todayKey()
  const events = (body.events || [])
    .filter(e => dayKeyFmt.format(new Date(e.event_time)) === today)
    .sort((a, b) => new Date(a.event_time) - new Date(b.event_time))
  return {
    inAt:  events[0]?.event_time  ?? null,
    outAt: events.length >= 2 ? events[events.length - 1].event_time : null,
  }
}

// ─── timetable period count ───────────────────────────────────────────────────

async function fetchTodayPeriodCount(teacher) {
  const teacherId   = teacher?.id || ''
  const teacherName = (teacher?.fullName || '').toLowerCase().trim()
  if (!teacherId && !teacherName) return null

  const snap = await getDocs(collection(db, 'timetable'))
  const dayFull  = todayFull()   // "monday"
  const dayShort = todayShort()  // "mon"
  const dayIdx   = new Date().getDay() // 0=Sun … 6=Sat

  let hasAnyDayField = false
  let todaySlotCount = 0
  const uniqueClasses = new Set()

  snap.docs.forEach(d => {
    const s = d.data()
    const mine = (teacherId   && s.teacherId === teacherId) ||
                 (teacherName && (s.teacherName || '').toLowerCase().trim() === teacherName)
    if (!mine) return

    // Collect unique class names (used as fallback if no day field exists)
    if (Array.isArray(s.classNames)) {
      s.classNames.forEach(c => c && uniqueClasses.add(c.trim()))
    } else if (s.className) {
      s.className.split('+').map(x => x.trim()).filter(Boolean).forEach(c => uniqueClasses.add(c))
    }

    // Try every common day-field name
    const raw = s.day ?? s.dayOfWeek ?? s.weekDay ?? s.weekday ?? null
    if (raw == null) return
    hasAnyDayField = true

    const v = String(raw).toLowerCase().trim()
    const matchesDay =
      v === dayFull      ||   // "monday"
      v === dayShort     ||   // "mon"
      v === String(dayIdx)    // "0"–"6"  (JS getDay() style)

    if (matchesDay) todaySlotCount++
  })

  return hasAnyDayField ? todaySlotCount : uniqueClasses.size
}

// ─── component ────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div style={{ display:'flex', gap:16, animation:'pulse 1.5s ease infinite', padding:'2px 0' }}>
      {[52, 52, 48].map((w, i) => (
        <div key={i} style={{ width:w, height:22, background:'var(--gray-100)', borderRadius:6 }} />
      ))}
    </div>
  )
}

function Cell({ label, value, color }) {
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:9.5, fontWeight:600, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--text-muted)', marginBottom:3 }}>{label}</div>
      <div style={{ fontSize:15, fontWeight:700, color, fontFamily:'var(--font-display)', lineHeight:1 }}>{value}</div>
    </div>
  )
}

export default function TodayPill({ teacher }) {
  const [punch,      setPunch]      = useState(null)   // null = loading
  const [punchError, setPunchError] = useState(false)
  const [periods,    setPeriods]    = useState(null)   // null = loading/unavailable

  useEffect(() => {
    let gone = false
    fetchTodayPunch()
      .then(r  => { if (!gone) { setPunch(r); if (!r) setPunchError(true) } })
      .catch(() => { if (!gone) setPunchError(true) })
    return () => { gone = true }
  }, [])

  useEffect(() => {
    if (!teacher) return
    let gone = false
    fetchTodayPeriodCount(teacher)
      .then(n => { if (!gone) setPeriods(n) })
      .catch(() => {/* silently hide count */})
    return () => { gone = true }
  }, [teacher?.id, teacher?.fullName])

  const loading = punch === null && !punchError
  const inTime  = punch?.inAt  ? timeFmt.format(new Date(punch.inAt))  : '—'
  const outTime = punch?.outAt ? timeFmt.format(new Date(punch.outAt)) : '—'

  return (
    <Link to="/hrms/attendance" style={{ textDecoration:'none', display:'block', marginBottom:14 }}>
      <div className="fade-up" style={{
        background:'var(--white)', borderRadius:'var(--radius-lg)',
        border:'1px solid var(--gray-100)', boxShadow:'var(--shadow-sm)',
        display:'flex', alignItems:'stretch', overflow:'hidden',
      }}>
        {/* Green left accent bar */}
        <div style={{ width:5, background:'var(--green)', flexShrink:0 }} />

        <div style={{ flex:1, padding:'12px 16px', display:'flex', alignItems:'center', gap:12 }}>
          {/* "Today" label */}
          <div style={{ minWidth:0, flexShrink:0 }}>
            <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--green)', lineHeight:1 }}>Today</div>
          </div>

          {/* Divider */}
          <div style={{ width:1, height:34, background:'var(--gray-100)', flexShrink:0 }} />

          {/* Data cells */}
          {loading ? <Skeleton /> : (
            <div style={{ display:'flex', alignItems:'center', gap:0, flex:1 }}>
              <Cell label="In"  value={inTime}  color={punch?.inAt  ? 'var(--green)'   : 'var(--gray-400)'} />
              <div style={{ width:1, height:30, background:'var(--gray-100)', margin:'0 12px' }} />
              <Cell label="Out" value={outTime} color={punch?.outAt ? 'var(--crimson)' : 'var(--gray-400)'} />
              {periods !== null && (
                <>
                  <div style={{ width:1, height:30, background:'var(--gray-100)', margin:'0 12px' }} />
                  <Cell label="Classes" value={periods} color="var(--text)" />
                </>
              )}
            </div>
          )}

          {/* Chevron */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ marginLeft:'auto', flexShrink:0 }}>
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>
    </Link>
  )
}
