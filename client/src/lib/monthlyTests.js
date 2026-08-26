// =========================================================================
// monthlyTests.js — the monthly-test REGIME (Option C: lazy materialization).
//
// Nobody schedules monthly tests. A single config doc (settings/testRegime)
// declares the rule — which months are exam/vacation months, default marks,
// and which subjects each class is tested in. The teacher PWA computes the
// expected "slots" for the current month from (teacher's timetable pairs ×
// regime) and shows an auto card per slot. The tests/{id} doc only comes
// into existence on the FIRST marks save, with a DETERMINISTIC id:
//
//   MT_{session}_{MM}_{class}_{subject}_{branch}   e.g.
//   MT_2026-27_08_Class-9_Science_MAIN
//
// so two teachers can never create duplicates, and everything downstream
// (TestDetail, analytics, parent app) keeps working on plain tests docs.
// =========================================================================
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

export const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// Indian academic session code for a date: April→March.
export function sessionCodeFor(d = new Date()) {
  const y = d.getFullYear()
  const startYear = (d.getMonth() + 1) >= 4 ? y : y - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

export async function fetchTestRegime() {
  try {
    const s = await getDoc(doc(db, 'settings', 'testRegime'))
    return s.exists() ? s.data() : null
  } catch { return null }
}

// Doc-id-safe token (doc ids cannot contain '/', and 'Reading/Writing' exists).
const sanitize = (s) => String(s || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export function monthlySlotId(session, monthNo, className, subject, branchCode) {
  return `MT_${session}_${String(monthNo).padStart(2, '0')}_${sanitize(className)}_${sanitize(subject)}_${sanitize(branchCode || 'MAIN')}`
}

// Why a month has no monthly test: an exam is held, or it's vacation.
export function monthBlockReason(regime, monthNo) {
  if (!regime) return 'no regime'
  const exam = (regime.examMonths || {})[String(monthNo)] ?? (regime.examMonths || {})[monthNo]
  if (exam) return exam
  if ((regime.skipMonths || []).includes(monthNo)) return 'Vacation'
  return null
}

// Is this (class, subject) tested monthly? Empty/missing list for a class
// = the class is exempt from the regime entirely.
export function subjectTested(regime, className, subject) {
  const list = regime?.testedSubjects?.[className]
  if (!Array.isArray(list) || list.length === 0) return false
  return list.includes(subject)
}

// Which month-windows are currently open for entry: the running month
// (if not blocked), plus the previous month while within graceDays.
export function openWindows(regime, now = new Date()) {
  if (!regime) return []
  const out = []
  const m = now.getMonth() + 1
  const y = now.getFullYear()
  if (!monthBlockReason(regime, m)) {
    out.push({ monthNo: m, year: y, session: sessionCodeFor(now), late: false })
  }
  const grace = Number(regime.graceDays ?? 7)
  if (now.getDate() <= grace) {
    const pm = m === 1 ? 12 : m - 1
    const py = m === 1 ? y - 1 : y
    if (!monthBlockReason(regime, pm)) {
      out.push({ monthNo: pm, year: py, session: sessionCodeFor(new Date(py, pm - 1, 15)), late: true })
    }
  }
  return out
}
