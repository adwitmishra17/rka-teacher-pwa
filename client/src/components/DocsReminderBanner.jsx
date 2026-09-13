// =========================================================================
// DocsReminderBanner
//
// Non-blocking nudge shown to a signed-in teacher who still has required
// onboarding documents missing (the 7 slots on MyDocuments). Links there.
// Dismissible for 3 days via localStorage; disappears once all 7 are uploaded.
// =========================================================================

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { auth } from '../firebase/config'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
const SLOTS = ['class_10', 'class_12', 'graduation', 'post_graduation', 'bed', 'aadhaar', 'pan']
const DISMISS_KEY = 'rka.docsReminder.dismissedUntil'

export default function DocsReminderBanner() {
  const [state, setState] = useState(null) // { done, total }

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const until = Number(localStorage.getItem(DISMISS_KEY) || 0)
        if (until && Date.now() < until) return
      } catch { /* ignore */ }
      try {
        const user = auth.currentUser
        if (!user) return
        const token = await user.getIdToken()
        const res = await fetch(`${FUNCTIONS_URL}/get-my-documents`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        const docs = Array.isArray(data.documents) ? data.documents : []
        const have = new Set(docs.map((d) => d.doc_type).filter(Boolean))
        const done = SLOTS.filter((s) => have.has(s)).length
        if (!cancelled && done < SLOTS.length) setState({ done, total: SLOTS.length })
      } catch { /* silent — the banner is just a nudge */ }
    }
    run()
    return () => { cancelled = true }
  }, [])

  if (!state) return null

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 3 * 24 * 60 * 60 * 1000)) } catch { /* ignore */ }
    setState(null)
  }

  return (
    <div style={bar}>
      <span style={{ fontSize: 16 }}>📄</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>Complete your documents</b>
        <div style={{ fontSize: 12, opacity: 0.92 }}>
          {state.done} of {state.total} uploaded — add your marksheets, Aadhaar &amp; PAN.
        </div>
      </div>
      <Link to="/hrms/documents" style={cta} onClick={dismiss}>Upload</Link>
      <button onClick={dismiss} aria-label="Dismiss" style={close}>×</button>
    </div>
  )
}

const bar = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 14px', background: '#1a4a2e', color: '#fff',
  fontSize: 13.5,
}
const cta = {
  background: '#fff', color: '#1a4a2e', textDecoration: 'none',
  fontWeight: 700, fontSize: 12.5, padding: '6px 14px', borderRadius: 7, whiteSpace: 'nowrap',
}
const close = {
  background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.8)',
  fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: '0 4px',
}
