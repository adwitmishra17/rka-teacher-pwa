import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)

// Service worker — required for Chrome's "install app" prompt. It only
// provides an offline fallback page and never caches app code, so a new
// deploy is always picked up immediately (see public/sw.js).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[sw] registration failed:', e?.message || e)
    })
  })
}
