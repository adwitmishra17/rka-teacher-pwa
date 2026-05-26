import { auth } from '../firebase/config'

// In dev, Vite proxies /api → http://localhost:3001.
// In production, the Express server serves the client build and handles /api.
// VITE_API_BASE_URL can override both (e.g. for a separate staging backend).
const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

async function apiFetch(path, options = {}) {
  if (!auth.currentUser) throw new Error('Not authenticated')

  // Always fetch a fresh token — Firebase caches it and refreshes silently.
  const token = await auth.currentUser.getIdToken()

  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), {
      status: res.status,
      data,
    })
  }
  return data
}

export const api = {
  // --- Subject discovery ---
  getMySubjects: () =>
    apiFetch('/my-subjects'),

  getTerms: (sessionCode) =>
    apiFetch('/terms' + (sessionCode ? `?sessionCode=${encodeURIComponent(sessionCode)}` : '')),

  getHpcTemplate: (sessionCode, branchCode) =>
    apiFetch(`/hpc-template?sessionCode=${encodeURIComponent(sessionCode ?? '')}&branchCode=${encodeURIComponent(branchCode ?? '')}`),

  // --- Roster ---
  getStudents: (className, branchCode) =>
    apiFetch(`/students?className=${encodeURIComponent(className)}&branchCode=${encodeURIComponent(branchCode)}`),

  // --- Papers ---
  getPapers: (subjectId, termId) =>
    apiFetch(`/paper?subjectId=${encodeURIComponent(subjectId)}&termId=${encodeURIComponent(termId)}`),

  savePaper: ({ subjectId, termId, paperName, maxMarks, passingMarks, examDate, paperId }) =>
    apiFetch('/paper', {
      method: 'POST',
      body: JSON.stringify({ subjectId, termId, paperName, maxMarks, passingMarks, examDate, paperId }),
    }),

  // --- Marks ---
  getMarks: (paperId) =>
    apiFetch(`/marks?paperId=${encodeURIComponent(paperId)}`),

  saveMarks: (paperId, marks) =>
    apiFetch('/marks', { method: 'POST', body: JSON.stringify({ paperId, marks }) }),

  // --- Co-scholastic grades ---
  getGrades: (subjectId, termId) =>
    apiFetch(`/grades?subjectId=${encodeURIComponent(subjectId)}&termId=${encodeURIComponent(termId)}`),

  saveGrades: (termId, subjectId, grades) =>
    apiFetch('/grades', { method: 'POST', body: JSON.stringify({ termId, subjectId, grades }) }),

  // --- HPC assessments ---
  saveHpc: (payload) =>
    apiFetch('/hpc', { method: 'POST', body: JSON.stringify(payload) }),
}
