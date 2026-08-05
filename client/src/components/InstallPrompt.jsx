import { useEffect, useState } from 'react'

/* ============================================================
   "Install app" prompt (Chrome / Edge / Android).

   Chrome fires `beforeinstallprompt` when the app meets the
   installability bar (manifest + icons + a service worker with a
   fetch handler). The event must be captured and re-fired later
   from a real user gesture — you cannot call prompt() on your own
   schedule — so we stash it and show our own banner.

   Not shown when: already running installed (display-mode:
   standalone), the user dismissed it (remembered for 30 days), or
   the browser never fires the event (iOS Safari — which has no
   programmatic install; those users get the Share → Add to Home
   Screen hint instead).
   ============================================================ */

const DISMISS_KEY = 'rka.installPrompt.dismissedUntil'
const DISMISS_DAYS = 30

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}
function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    && !/crios|fxios/i.test(window.navigator.userAgent)
}
function dismissedRecently() {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY))
    return Number.isFinite(until) && until > Date.now()
  } catch { return false }
}

export default function InstallPrompt({ appName = 'this app' }) {
  const [deferred, setDeferred] = useState(null)
  const [show, setShow] = useState(false)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return undefined

    const onBeforeInstall = (e) => {
      e.preventDefault()          // stop Chrome's own mini-infobar
      setDeferred(e)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // iOS never fires the event and has no install API — surface the
    // manual route instead, but only on iOS Safari and not in-app.
    if (isIos()) {
      const t = setTimeout(() => { setIosHint(true); setShow(true) }, 2500)
      return () => { clearTimeout(t); window.removeEventListener('beforeinstallprompt', onBeforeInstall) }
    }

    const onInstalled = () => setShow(false)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  function dismiss() {
    setShow(false)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 864e5))
    } catch { /* ignore */ }
  }

  async function install() {
    if (!deferred) return
    deferred.prompt()
    try { await deferred.userChoice } catch { /* ignore */ }
    setDeferred(null)
    setShow(false)
  }

  if (!show) return null

  return (
    <div
      role="dialog"
      aria-label={`Install ${appName}`}
      style={{
        position: 'fixed', left: 12, right: 12, zIndex: 4000,
        bottom: `calc(84px + env(safe-area-inset-bottom, 0px))`,
        margin: '0 auto', maxWidth: 440,
        background: '#fff', border: '1px solid #e8e6dc', borderRadius: 12,
        boxShadow: '0 10px 34px rgba(0,0,0,0.18)', padding: '13px 14px',
        display: 'flex', alignItems: 'center', gap: 12,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <img src="/icon-192.png" alt="" width="42" height="42"
           style={{ borderRadius: 9, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a4a2e' }}>
          Install {appName}
        </div>
        <div style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.4, marginTop: 2 }}>
          {iosHint
            ? <>Tap <strong>Share</strong> then <strong>Add to Home Screen</strong>.</>
            : 'Add it to your home screen — opens full-screen, like an app.'}
        </div>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          border: 'none', background: 'transparent', color: '#9ca3af',
          fontSize: 13, cursor: 'pointer', padding: '6px 4px', flexShrink: 0,
        }}
      >
        Not now
      </button>
      {!iosHint && (
        <button
          onClick={install}
          style={{
            border: 'none', background: '#1a4a2e', color: '#fff', borderRadius: 8,
            padding: '9px 15px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
          }}
        >
          Install
        </button>
      )}
    </div>
  )
}
