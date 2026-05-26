# rka-teacher-pwa

RKA Academy Teacher PWA — React + Vite frontend with an Express backend proxy.

## Architecture

```
Browser (teacher)
  │
  ├── Firebase Auth (Google OAuth / phone OTP)  ← unchanged from v56
  │
  └── Express backend (Hostinger Node.js)
        ├── Verifies Firebase ID token (Firebase Admin SDK)
        ├── Resolves branch by code, student by admission_no
        └── Upserts to Supabase (service-role key, server-side only)
              ├── exam_subjects   (read — assigned_teacher_id = Firebase UID)
              ├── exam_papers     (read/write)
              ├── exam_marks      (write — source='teacher_pwa', source guard)
              ├── exam_coscholastic_grades (write — source guard)
              └── hpc_assessments (write — source guard)

Firestore (unchanged):
  teachers, lessons, syllabus, attendance, HRMS data
  academicSessions  ← Tracker writes here; backend reads for term list
  hpcTemplates      ← Tracker writes here; backend reads for HPC domain config
```

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite 5, React Router 6 |
| Auth | Firebase Auth (Google OAuth + phone OTP via Supabase Edge Function) |
| Backend | Node.js 18+, Express 4 |
| Database | Supabase PostgreSQL (service-role writes server-side) |
| Legacy read | Firestore (teachers, lessons, syllabus, HRMS) |
| Hosting | Hostinger Node.js (server.js serves API + built React app) |

## Env vars

Copy `.env.example` → `.env` and fill in values.

| Var | Where to get it |
|-----|----------------|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Console → Project settings → Service accounts → Generate new private key → paste entire JSON as one line |
| `SUPABASE_URL` | Supabase Dashboard → Project settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project settings → API → service_role (secret) |
| `PORT` | 3001 locally; Hostinger sets this automatically in production |
| `CORS_ORIGIN` | Your production domain, e.g. `https://teacher.rkacademyballia.in` |

**The service-role key must never reach the browser.** It lives only in `.env` / Hostinger environment variables.

## Local dev

```bash
# Install server deps
npm install

# Install client deps
cd client && npm install && cd ..

# Start both (server on :3001, Vite on :5173 with /api proxy)
npm run dev
```

Open http://localhost:5173 — the Vite dev server proxies `/api/*` to port 3001.

## Production build + deploy

```bash
# Build the React app
npm run build          # outputs to client/dist/

# Start the Express server (serves API + static client build)
node server.js         # or: npm start
```

On Hostinger:
1. Upload all files (server.js, routes/, middleware/, lib/, client/dist/, package.json).
2. Set env vars in Hostinger → Node.js → Environment variables.
3. Run `npm install` (production deps only; Hostinger does this on deploy).
4. Point the Node.js app entry point to `server.js`.

## First-deploy checklist

- [ ] Supabase `exam_subjects` rows have `assigned_teacher_id` (Firebase UID) set for each teacher.  
      The Admin Tracker must write this when assigning teachers to subjects.
- [ ] Firestore `academicSessions/{sessionCode}` doc exists with `isActive: true` and a `terms` array.  
      Shape: `{ sessionCode, label, isActive, terms: [{ id, label }] }`
- [ ] Firestore `hpcTemplates` doc exists (optional — backend falls back to default Indian-school domains).  
      Doc IDs tried in order: `{BRANCHCODE}_{sessionCode}`, `{sessionCode}`, `default`.  
      Shape: `{ domains: [{ id, label, gradeOptions: ['A+','A','B','C','D'] }], generalRemarksEnabled: true }`
- [ ] Firebase Admin SDK service account has Firestore read permissions.
- [ ] CORS_ORIGIN set to the production teacher PWA domain.
- [ ] version.txt is served at the root path (Express serves from client/dist/).

## Route map

| URL | Component |
|-----|-----------|
| `/exam-marks` | ExamMarksEntry — scholastic marks entry via Supabase |
| `/exam-grades` | ExamGradesEntry — co-scholastic grades via Supabase |
| `/hpc-entry` | HpcEntry — HPC assessment via Supabase |
| `/enter-marks` | Redirects to `/exam-marks` (backward compat for installed PWA tiles) |
| `/log-lesson` | LogLesson — unchanged, writes to Firestore |
| `/my-syllabus` | MySyllabus — unchanged |
| `/my-marks` | MyMarks — unchanged, reads historical marks from Firestore |
| `/hrms/*` | Hub, MyAttendance, MyDocuments — unchanged |

## API endpoints

All endpoints require `Authorization: Bearer <Firebase ID token>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/my-subjects` | Subjects assigned to the caller (from `exam_subjects`) |
| GET | `/api/terms?sessionCode=` | Term list for a session (from Firestore `academicSessions`) |
| GET | `/api/hpc-template?sessionCode=&branchCode=` | HPC domain config (from Firestore `hpcTemplates`) |
| GET | `/api/students?className=&branchCode=` | Active student roster |
| GET | `/api/paper?subjectId=&termId=` | Papers for a subject+term |
| POST | `/api/paper` | Create or update a paper |
| GET | `/api/marks?paperId=` | Existing marks for a paper |
| POST | `/api/marks` | Bulk upsert exam marks |
| GET | `/api/grades?subjectId=&termId=` | Existing co-scholastic grades |
| POST | `/api/grades` | Bulk upsert co-scholastic grades |
| POST | `/api/hpc` | Upsert one HPC assessment |

## Security rules (non-negotiable)

1. **source column guard**: every write sets `source='teacher_pwa'`. Rows with `source='manual'` are skipped silently (school-office corrections).
2. **service-role key server-side only**: the Supabase service-role key lives in `.env` and is never sent to the browser.
3. **IDs resolved server-side**: branch by `branches.code`, student by `students.admission_no` — no UUIDs from the client.

## HPC snapshot columns

`routes/hpc.js` writes individual `snap_*` columns for the frozen student snapshot.  
If your `hpc_assessments` schema uses different column names, update the `payload` object in that file.  
Alternatively, if your schema uses a single `student_snapshot JSONB` column, replace the individual keys with:

```js
student_snapshot: {
  name: student.full_name,
  admission_no: student.admission_no,
  class_name: student.class_name,
  section: student.section,
  roll_number: student.roll_number,
  father_name: student.father_name,
  mother_name: student.mother_name,
  date_of_birth: student.date_of_birth,
},
```

## What's unchanged from v56

- Login page (Google OAuth + phone OTP via Supabase Edge Function)
- LogLesson, MySyllabus, LessonPlan → Firestore writes
- MyMarks → reads historical marks from Firestore (new marks in Supabase not yet reflected here — separate task)
- MyAttendance, MyDocuments → HRMS reads
- MyStudents, StudentAttendance, StudentAnalytics
- Version-watcher banner (versionCheck.js)
- Firebase config (rka-academic-tracker project)

## Out of scope (separate tasks)

- Admin Tracker refactor to Supabase
- Backfilling old Firestore marks into Supabase
- Retiring the old Cloud Functions
- MyMarks reading from Supabase (currently reads legacy Firestore data)
