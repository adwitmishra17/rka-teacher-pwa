// Single source of truth: derive a teacher's classes from the timetable collection
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'

// Timetable slots belonging to this teacher (id match, name fallback, then
// email→teachers-doc fallback for legacy auth identities).
async function resolveMySlots(teacher, user) {
  const teacherId = teacher?.id || ''
  const teacherName = (teacher?.fullName || '').toLowerCase().trim()
  const emailLower = (teacher?.email || teacher?.personalEmail || user?.email || '').toLowerCase().trim()

  const ttSnap = await getDocs(collection(db, 'timetable'))
  const allSlots = ttSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  let mySlots = allSlots.filter(s =>
    (teacherId && s.teacherId === teacherId) ||
    (teacherName && s.teacherName?.toLowerCase().trim() === teacherName)
  )

  if (mySlots.length === 0 && emailLower) {
    const teachersSnap = await getDocs(collection(db, 'teachers'))
    const matched = teachersSnap.docs.find(d => {
      const data = d.data()
      return (data.email || '').toLowerCase().trim() === emailLower ||
             (data.personalEmail || '').toLowerCase().trim() === emailLower
    })
    if (matched) {
      const rId = matched.id
      const rName = (matched.data().fullName || '').toLowerCase().trim()
      mySlots = allSlots.filter(s =>
        s.teacherId === rId ||
        s.teacherName?.toLowerCase().trim() === rName
      )
    }
  }
  return mySlots
}

// Expand a slot's class field(s) — combined slots carry classNames[] or a
// 'Class 11 Science + Class 11 Humanities' string.
function slotClasses(slot) {
  if (Array.isArray(slot.classNames) && slot.classNames.length) {
    return slot.classNames.map(c => (c || '').trim()).filter(Boolean)
  }
  if (slot.className) {
    return slot.className.split('+').map(s => s.trim()).filter(Boolean)
  }
  return []
}

export async function getTeacherClasses(teacher, user) {
  try {
    const mySlots = await resolveMySlots(teacher, user)
    const classNames = new Set()
    mySlots.forEach(slot => slotClasses(slot).forEach(c => classNames.add(c)))
    return [...classNames].sort()
  } catch (e) {
    console.error('getTeacherClasses error:', e)
    return []
  }
}

// Distinct (className, subject, branchCode) pairs this teacher teaches —
// the unit the monthly-test regime materializes slots for.
export async function getTeacherClassSubjects(teacher, user) {
  try {
    const mySlots = await resolveMySlots(teacher, user)
    const seen = new Map()
    for (const slot of mySlots) {
      const subject = (slot.subject || '').trim()
      if (!subject) continue
      const branchCode = (slot.branchCode || 'MAIN').trim() || 'MAIN'
      for (const className of slotClasses(slot)) {
        const key = `${branchCode}¦${className}¦${subject}`
        if (!seen.has(key)) seen.set(key, { className, subject, branchCode })
      }
    }
    return [...seen.values()].sort((a, b) =>
      a.className.localeCompare(b.className) || a.subject.localeCompare(b.subject))
  } catch (e) {
    console.error('getTeacherClassSubjects error:', e)
    return []
  }
}
