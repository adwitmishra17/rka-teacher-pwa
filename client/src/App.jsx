import React, { useState, useEffect, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { onAuthStateChanged, signInWithCustomToken } from 'firebase/auth'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { auth, db } from './firebase/config'
import Login from './pages/Login'
import Home from './pages/Home'
import LogLesson from './pages/LogLesson'
import MySyllabus from './pages/MySyllabus'
import MyMarks from './pages/MyMarks'
import LessonPlan from './pages/LessonPlan'
import StudentAnalytics from './pages/StudentAnalytics'
import Hub from './pages/Hub'
import MyAttendance from './pages/MyAttendance'
import MyDocuments from './pages/MyDocuments'
import MyStudents from './pages/MyStudents'
import StudentAttendance from './pages/StudentAttendance'
import ErrorBoundary from './components/ErrorBoundary'
import EnterMarks from './pages/EnterMarks'
import ExamMarksEntry from './pages/ExamMarksEntry'
import ExamGradesEntry from './pages/ExamGradesEntry'
import HpcEntry from './pages/HpcEntry'
import Layout from './components/Layout'
import ImpersonationBanner, { setImpersonationState, clearImpersonationState } from './components/ImpersonationBanner'
import { startVersionWatcher, reloadForUpdate } from './lib/versionCheck'

export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export default function App() {
  const [user, setUser] = useState(undefined)
  const [teacher, setTeacher] = useState(null)
  const [signingInAsImpersonator, setSigningInAsImpersonator] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token  = params.get('impersonate')
    const actor  = params.get('actor')
    console.log('[impersonation] App mount; token present:', !!token)
    if (!token) return
    // Strip params immediately so refresh/back doesn't reuse an expired token.
    const url = new URL(window.location.href)
    url.searchParams.delete('impersonate')
    url.searchParams.delete('actor')
    window.history.replaceState({}, '', url.pathname + (url.search || ''))
    setImpersonationState(actor || 'admin')
    setSigningInAsImpersonator(true)
    signInWithCustomToken(auth, token)
      .then(cred => {
        console.log('[impersonation] signed in as', cred.user.email)
        setSigningInAsImpersonator(false)
      })
      .catch(e => {
        console.error('[impersonation] sign-in failed:', e)
        clearImpersonationState()
        setSigningInAsImpersonator(false)
        alert('Impersonation failed: ' + (e.message || 'unknown error'))
      })
  }, [])

  useEffect(() => {
    return onAuthStateChanged(auth, async u => {
      if (u) {
        setUser(u)
        try {
          const cleanEmail = (s) =>
            (s || '').replace(/[​-‏‪-‮﻿ ]/g, '').trim().toLowerCase()
          const emailLower = cleanEmail(u.email)

          let snap = await getDocs(query(collection(db, 'teachers'), where('email', '==', emailLower)))
          if (snap.empty && u.email !== emailLower) {
            snap = await getDocs(query(collection(db, 'teachers'), where('email', '==', u.email)))
          }
          if (snap.empty) {
            snap = await getDocs(query(collection(db, 'teachers'), where('personalEmail', '==', emailLower)))
          }
          if (snap.empty && u.email !== emailLower) {
            snap = await getDocs(query(collection(db, 'teachers'), where('personalEmail', '==', u.email)))
          }
          if (snap.empty) {
            const allSnap = await getDocs(collection(db, 'teachers'))
            const matched = allSnap.docs.find(d => {
              const data = d.data()
              return cleanEmail(data.email) === emailLower ||
                cleanEmail(data.personalEmail) === emailLower
            })
            if (matched) {
              setTeacher({ id: matched.id, ...matched.data() })
              return
            }
          }
          if (!snap.empty) {
            const t = { id: snap.docs[0].id, ...snap.docs[0].data() }
            // HRMS-synced inactive flag — deactivated staff cannot sign in.
            if (t.isActive === false) {
              alert('Your account has been deactivated. Contact the school office.')
              await auth.signOut()
              setUser(null)
              setTeacher(null)
              return
            }
            setTeacher(t)
          } else {
            await auth.signOut()
            setUser(null)
            setTeacher(null)
          }
        } catch (e) {
          console.error('Teacher lookup error:', e)
          setTeacher({ email: u.email, fullName: u.displayName, id: null })
        }
      } else {
        setUser(null)
        setTeacher(null)
      }
    })
  }, [])

  if (user === undefined || signingInAsImpersonator) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
    </div>
  )

  return (
    <AuthContext.Provider value={{ user, teacher }}>
      <ImpersonationBanner />
      <VersionBanner />
      <BrowserRouter>
        <ErrorBoundary>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
          <Route path="/" element={user ? <Layout /> : <Navigate to="/login" />}>
            <Route index element={<Home />} />
            <Route path="log-lesson" element={<LogLesson />} />
            <Route path="my-syllabus" element={<MySyllabus />} />
            <Route path="my-marks" element={<MyMarks />} />
            <Route path="lesson-plan" element={<LessonPlan />} />
            <Route path="student-analytics" element={<StudentAnalytics />} />
            <Route path="hrms" element={<Hub />} />
            <Route path="hrms/attendance" element={<MyAttendance />} />
            <Route path="hrms/documents" element={<MyDocuments />} />
            <Route path="my-students" element={<MyStudents />} />
            <Route path="student-attendance" element={<StudentAttendance />} />
            {/* Firestore-backed internal test marks */}
            <Route path="test-marks" element={<EnterMarks />} />
            {/* Supabase-backed term exam data entry */}
            <Route path="exam-marks" element={<ExamMarksEntry />} />
            <Route path="exam-grades" element={<ExamGradesEntry />} />
            <Route path="hpc-entry" element={<HpcEntry />} />
            {/* Legacy redirect — installed PWA tiles that still point to old /enter-marks */}
            <Route path="enter-marks" element={<Navigate to="/test-marks" replace />} />
          </Route>
        </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}

function VersionBanner() {
  const [show, setShow] = useState(false)
  useEffect(() => { startVersionWatcher(() => setShow(true)) }, [])
  if (!show) return null
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: '#1a4a2e', color: 'white', padding: '10px 16px',
      fontSize: 13, textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
    }}>
      <span>A new version is available.</span>
      <button onClick={reloadForUpdate} style={{
        background: 'white', color: '#1a4a2e', border: 'none', padding: '5px 14px',
        borderRadius: 4, fontWeight: 600, cursor: 'pointer', fontSize: 12,
      }}>Refresh</button>
    </div>
  )
}
